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
  users: 600,
  collections: 600,
  reviews: 664,
  dishes: 664,
  restaurants: 444,
  news: 444,
});

server.use(rules);
server.use(auth); // 解析 Token

/* ========================
   3. 寫入時強制綁定 ID (GET 邏輯移除了)
======================== */
server.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PATCH") {
    if (req.user) {
      // 取得 ID (兼容 sub 與 id)
      const currentUserId = req.user.sub || req.user.id;
      const urlPath = req.path;

      delete req.body.userId; // 防止竄改

      if (
        urlPath.includes("/collections") ||
        urlPath.includes("/reviews") ||
        urlPath.includes("/dishes")
      ) {
        req.body.userId = Number(currentUserId);
      }

      if (urlPath.includes("/dishes") && req.method === "POST") {
        req.body.status = "draft";
      }
    }
  }
  next();
});

/* ========================
   4. 管理員權限
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
   ⭐ 5. 輸出攔截器 (核彈級過濾) ⭐
   既然 req.query 無效，我們就在資料送出前暴力篩選
======================== */
router.render = (req, res) => {
  let data = res.locals.data;
  const user = req.user;
  const urlPath = req.path;

  // 如果 data 是空或錯誤，直接回傳
  if (!data) return res.jsonp(data);

  // === 針對 Collections 做暴力過濾 ===
  if (req.method === "GET" && urlPath.includes("/collections")) {
    if (Array.isArray(data)) {
      // 如果沒登入，理論上 rules:600 會擋，但這裡再保險一次
      if (!user) {
        return res.status(401).json({ error: "請先登入" });
      }

      const currentUserId = Number(user.sub || user.id);
      console.log(
        `[Render Filter] 過濾 collections for User: ${currentUserId}`,
      );

      // ⭐ 這裡就是核心：手動用 JS 過濾陣列，誰都擋不了這招
      data = data.filter((item) => item.userId === currentUserId);
    }
  }

  // === 針對 Users 做暴力過濾 ===
  if (req.method === "GET" && urlPath.includes("/users")) {
    if (Array.isArray(data)) {
      if (!user) return res.status(401).json({ error: "請先登入" });
      const currentUserId = Number(user.sub || user.id);
      // 只回傳自己的那筆
      data = data.filter((item) => item.id === currentUserId);
    }
  }

  // === 針對 Dishes 的可見性過濾 ===
  if (req.method === "GET" && urlPath.includes("/dishes")) {
    const isVisible = (dish) => {
      if (user && user.role === "admin") return true;
      if (user && dish.userId === (user.sub || user.id)) return true;
      return dish.status === "published";
    };

    if (Array.isArray(data)) {
      data = data.filter(isVisible);
    } else {
      // 如果是單筆資料 (GET /dishes/1)
      if (!isVisible(data)) {
        return res.status(404).json({ error: "無權限查看" });
      }
    }
  }

  res.jsonp(data);
};

server.use(router);

const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`Spoonful API Running on port ${port}`);
});
