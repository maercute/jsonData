const jsonServer = require("json-server");
const auth = require("json-server-auth");
const path = require("path");
const fs = require("fs");

const server = jsonServer.create();

// 設定 JWT Secret
auth.secret = process.env.JWT_SECRET || "dev_secret";

/* ========================
   1. 資料庫初始化
======================== */
const isProd = process.env.NODE_ENV === "production";
const dbDirectory = isProd ? "/data" : __dirname;
const dbPath = path.join(dbDirectory, "db.json");

if (!fs.existsSync(dbDirectory)) fs.mkdirSync(dbDirectory, { recursive: true });

if (!fs.existsSync(dbPath)) {
  console.log("初始化資料庫 db.json ...");
  fs.writeFileSync(
    dbPath,
    JSON.stringify(
      {
        users: [],
        restaurants: [],
        dishes: [],
        reviews: [],
        collections: [],
        news: [],
      },
      null,
      2,
    ),
  );
}

const router = jsonServer.router(dbPath);
server.db = router.db;
auth.router = router;

server.use(jsonServer.bodyParser);
server.use(jsonServer.defaults());

/* ========================
   2. 權限規則設定
======================== */
const rules = auth.rewriter({
  users: 600, // 只有本人可讀寫
  collections: 600, // 只有本人可讀寫
  reviews: 664,
  dishes: 664,
  restaurants: 444,
  news: 444,
});

server.use(rules);
server.use(auth); // 解析 Token 並產生 req.user

/* ========================
   3. 強制過濾 Middleware
======================== */
server.use((req, res, next) => {
  const user = req.user;

  // --- GET 請求過濾 ---
  if (req.method === "GET") {
    if (user) {
      const currentUserId = Number(user.sub || user.id);

      // Collections: 普通使用者只看自己的
      if (req.path.startsWith("/collections") && user.role !== "admin") {
        req.query = { ...req.query, userId: currentUserId };
      }

      // Users: 普通使用者只看自己
      if (req.path.startsWith("/users") && user.role !== "admin") {
        req.query = { ...req.query, id: currentUserId };
      }
    }
  }

  // --- POST / PATCH / PUT 綁定 userId ---
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    if (user) {
      const currentUserId = Number(user.sub || user.id);

      if (
        req.path.includes("/collections") ||
        req.path.includes("/reviews") ||
        req.path.includes("/dishes")
      ) {
        delete req.body.userId; // 防止偽造
        req.body.userId = currentUserId;
      }

      // dishes POST 預設 draft
      if (req.path.includes("/dishes") && req.method === "POST") {
        req.body.status = "draft";
      }
    }
  }

  next();
});

/* ========================
   4. 管理員權限檢查
======================== */
server.use((req, res, next) => {
  if (req.method === "PATCH" && req.path.includes("/dishes")) {
    if (req.body.status === "published") {
      if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ error: "只有管理員可發布料理" });
      }
    }
  }
  next();
});

/* ========================
   5. router.render 安全過濾
======================== */
router.render = (req, res) => {
  const data = res.locals.data;
  const user = req.user;

  // Collections 過濾
  if (req.method === "GET" && req.path.startsWith("/collections")) {
    if (Array.isArray(data) && user && user.role !== "admin") {
      const currentUserId = Number(user.sub || user.id);
      const filtered = data.filter(
        (item) => Number(item.userId) === currentUserId,
      );
      return res.jsonp(filtered);
    }
  }

  // Dishes 可見性過濾
  if (req.method === "GET" && req.path.includes("/dishes")) {
    const isVisible = (dish) => {
      if (!dish) return false;
      if (user && user.role === "admin") return true;
      if (user && Number(dish.userId) === Number(user.sub || user.id))
        return true;
      return dish.status === "published";
    };

    if (Array.isArray(data)) return res.jsonp(data.filter(isVisible));
    if (data && !isVisible(data))
      return res.status(404).json({ error: "無權限查看" });
  }

  res.jsonp(data);
};

/* ========================
   6. 啟動 Server
======================== */
server.use(router);

const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`Spoonful API Running on port ${port}`);
});
