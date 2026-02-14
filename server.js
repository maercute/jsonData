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
   2. 權限規則設定 (保留原本的高安全性設定)
======================== */
const rules = auth.rewriter({
  users: 600, // 保留：只有本人可讀寫
  collections: 600, // 保留：只有本人可讀寫
  reviews: 664,
  dishes: 664,
  restaurants: 444,
  news: 444,
});

server.use(rules);
server.use(auth); // 解析 Token 並產生 req.user

/* ========================
   3. 核心邏輯：強制過濾 (Force Filter Middleware)
   這個中間件會確保 Router 收到帶有過濾參數的請求
======================== */
server.use((req, res, next) => {
  if (!req.user) return next(); // 沒登入會被上面的 rules:600 擋下

  const urlPath = req.path;
  const currentUserId = Number(req.user.sub || req.user.id); // 確保是數字
  const userRole = req.user.role;

  // --- [A. 讀取過濾] GET 請求 ---
  if (req.method === "GET") {
    // 針對 Collections: 如果不是管理員，強制加上 userId 過濾
    // 使用 startsWith 確保能處理 /collections 也能處理 /collections?_expand=...
    if (urlPath === "/collections" || urlPath.startsWith("/collections/")) {
      if (userRole !== "admin") {
        // 1. 修改 query 物件 (給 Express 看的)
        req.query.userId = currentUserId;

        // 2. [關鍵修正] 修改 url 字串 (給 json-server Router 看的)
        // 如果網址原本沒有 ?，就加 ?userId=...，如果有 ?，就加 &userId=...
        const separator = req.url.includes("?") ? "&" : "?";
        req.url += `${separator}userId=${currentUserId}`;

        console.log(`🔒 [Auto-Filter] 已強制將請求重寫為: ${req.url}`);
      }
    }

    // 針對 Users: 限制只能看自己
    if (urlPath === "/users" || urlPath.startsWith("/users/")) {
      if (userRole !== "admin") {
        req.query.id = currentUserId;
        // 同樣重寫 URL 確保 Router 吃到參數
        const separator = req.url.includes("?") ? "&" : "?";
        req.url += `${separator}id=${currentUserId}`;
      }
    }
  }

  // --- [B. 寫入綁定] POST / PATCH / PUT ---
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    // 針對需要歸屬權的資源，強制綁定 userId
    if (
      urlPath.includes("/collections") ||
      urlPath.includes("/reviews") ||
      urlPath.includes("/dishes")
    ) {
      delete req.body.userId; // 刪除前端傳的，防止偽造
      req.body.userId = currentUserId;
    }

    // 針對 dishes 的特殊邏輯
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
