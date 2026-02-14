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
   3. 核心邏輯：強制過濾 Middleware
======================== */
server.use((req, res, next) => {
  if (!req.user) return next(); // 沒登入會被上面的 rules 擋下

  const urlPath = req.path;
  const currentUserId = Number(req.user.sub || req.user.id);
  const userRole = req.user.role;

  // --- GET 請求過濾 ---
  if (req.method === "GET") {
    // Collections: 強制加上 userId 過濾
    if (urlPath.startsWith("/collections")) {
      if (userRole !== "admin") {
        req.query = { ...req.query, userId: currentUserId };
      }
    }

    // Users: 強制只能看到自己
    if (urlPath.startsWith("/users")) {
      if (userRole !== "admin") {
        req.query = { ...req.query, id: currentUserId };
      }
    }
  }

  // --- 寫入綁定 ---
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    if (
      urlPath.includes("/collections") ||
      urlPath.includes("/reviews") ||
      urlPath.includes("/dishes")
    ) {
      delete req.body.userId; // 防止偽造
      req.body.userId = currentUserId;
    }

    // dishes POST 預設 draft
    if (urlPath.includes("/dishes") && req.method === "POST") {
      req.body.status = "draft";
    }
  }

  next();
});

/* ========================
   4. 管理員權限與 Render 邏輯
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

router.render = (req, res) => {
  const data = res.locals.data;
  const user = req.user;

  // --- 強制過濾 collections ---
  if (req.method === "GET" && req.path.startsWith("/collections")) {
    if (Array.isArray(data) && user.role !== "admin") {
      const filtered = data.filter(
        (item) => item.userId === Number(user.sub || user.id),
      );
      return res.jsonp(filtered);
    }
  }

  // --- dishes 可見性過濾 ---
  if (req.method === "GET" && req.path.includes("/dishes")) {
    const isVisible = (dish) => {
      if (user && user.role === "admin") return true;
      if (user && dish.userId === Number(user?.sub || user?.id)) return true;
      return dish.status === "published";
    };

    if (Array.isArray(data)) return res.jsonp(data.filter(isVisible));
    if (data && !isVisible(data))
      return res.status(404).json({ error: "無權限查看" });
  }

  res.jsonp(data);
};

server.use(router);

const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`Spoonful API Running on port ${port}`);
});
