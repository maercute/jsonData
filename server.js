const jsonServer = require("json-server");
const auth = require("json-server-auth");
const path = require("path");
const fs = require("fs");

const server = jsonServer.create();

// 設定 JWT Secret (確保與你登入時產生 Token 的 Secret 一致)
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
server.use(auth); // 這裡會解析 Header 並產生 req.user

/* ========================
   3. 核心邏輯：自動過濾 & 綁定 ID
   (不再手寫 401 攔截，交給 rules 處理)
======================== */
server.use((req, res, next) => {
  // 如果經過 auth 後還是沒有 user，代表 Token 無效或沒給
  // 針對 600 的資源，後面的 router 會自動噴 401，我們不需要手寫攔截
  if (!req.user) return next();

  const urlPath = req.path;

  // A. POST / PATCH / PUT: 防偽造並強制綁定 userId
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    delete req.body.userId; // 刪除前端傳來的 userId 避免竄改

    if (
      urlPath.includes("/collections") ||
      urlPath.includes("/reviews") ||
      urlPath.includes("/dishes")
    ) {
      req.body.userId = req.user.id;
    }

    // dishes 特殊邏輯：新增時預設為草稿
    if (urlPath.includes("/dishes") && req.method === "POST") {
      req.body.status = "draft";
    }
  }

  // B. GET: 自動過濾 (確保 User A 看不到 User B 的私有資料)
  if (req.method === "GET") {
    if (urlPath.includes("/collections")) {
      req.query.userId = req.user.id;
    }
    // users 路由：限制只能看自己的 id
    if (urlPath.includes("/users")) {
      req.query.id = req.user.id;
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
   5. 自定義 Render (處理 dishes 可見性)
======================== */
router.render = (req, res) => {
  const data = res.locals.data;
  const user = req.user;

  if (req.method === "GET" && req.path.includes("/dishes")) {
    const isVisible = (dish) => {
      if (user && user.role === "admin") return true;
      if (user && dish.userId === user.id) return true;
      return dish.status === "published";
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
  console.log(`Spoonful API 運行中 | Port: ${port}`);
});
