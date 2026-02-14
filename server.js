const jsonServer = require("json-server");
const auth = require("json-server-auth");
const path = require("path");
const fs = require("fs");

const server = jsonServer.create();

// 1. 設定 JWT Secret (確保驗證與加密使用同一把鎖)
auth.secret = process.env.JWT_SECRET || "dev_secret";

/* ========================
   1. 資料庫與路徑初始化
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
   2. 權限規則設定 (Rewriter)
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
server.use(auth); // 解析 Token 並將結果存入 req.user

/* ========================
   3. 核心邏輯：身分綁定與自動過濾
======================== */
server.use((req, res, next) => {
  // 若未登入，則交給後面的路由處理 (由 600 規則擋下)
  if (!req.user) return next();

  const urlPath = req.path;
  // 取得登入者 ID：json-server-auth 通常將 ID 存於 sub 或 id 欄位
  const currentUserId = req.user.sub || req.user.id;

  // A. [寫入權限] POST / PATCH / PUT: 強制綁定身分，防止竄改他人資料
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    delete req.body.userId; // 安全考量：移除前端傳入的 userId

    if (
      urlPath.includes("/collections") ||
      urlPath.includes("/reviews") ||
      urlPath.includes("/dishes")
    ) {
      req.body.userId = Number(currentUserId);
    }

    // dishes 路由特殊邏輯：新投稿預設為草稿
    if (urlPath.includes("/dishes") && req.method === "POST") {
      req.body.status = "draft";
    }
  }

  // B. [讀取過濾] GET: 實現「我的資料只有我能看」
  if (req.method === "GET") {
    // 收藏清單過濾：確保查詢參數 userId 與登入者一致
    if (urlPath.includes("/collections")) {
      req.query.userId = Number(currentUserId);
    }
    // 使用者資訊過濾：限制只能查詢自己的 ID
    if (urlPath.includes("/users")) {
      req.query.id = Number(currentUserId);
    }
  }

  next();
});

/* ========================
   4. 管理員特權：料理發布審核
======================== */
server.use((req, res, next) => {
  if (req.method === "PATCH" && req.path.includes("/dishes")) {
    if (req.body.status === "published") {
      // 只有 role 為 admin 的使用者可以發布料理
      if (!req.user || req.user.role !== "admin") {
        return res
          .status(403)
          .json({ error: "權限不足：只有管理員可執行此操作" });
      }
    }
  }
  next();
});

/* ========================
   5. 自定義 Render：控制 dishes 可見性
======================== */
router.render = (req, res) => {
  const data = res.locals.data;
  const user = req.user;

  // 針對 dishes 路由進行特殊可見性過濾
  if (req.method === "GET" && req.path.includes("/dishes")) {
    const isVisible = (dish) => {
      if (user && user.role === "admin") return true; // 管理員可看全部
      if (user && dish.userId === (user.sub || user.id)) return true; // 本人可看草稿
      return dish.status === "published"; // 一般大眾僅能看已發布內容
    };

    if (Array.isArray(data)) return res.jsonp(data.filter(isVisible));
    if (data && !isVisible(data))
      return res.status(404).json({ error: "找不到該內容或無權限查看" });
  }

  res.jsonp(data);
};

server.use(router);

const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`Spoonful API 已成功啟動 | Port: ${port}`);
});
