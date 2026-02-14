const jsonServer = require("json-server");
const auth = require("json-server-auth");
const path = require("path");
const fs = require("fs");

const server = jsonServer.create();

// 設定 JWT Secret
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
server.use(auth); // 解析 Token 並產生 req.user

/* ========================
   3. 核心邏輯：自動過濾 & 綁定 ID (修正版)
======================== */
server.use((req, res, next) => {
  if (!req.user) return next();

  // 取得 ID：json-server-auth 解析出來的 ID 可能在 sub 或 id
  const currentUserId = req.user.sub || req.user.id;
  const urlPath = req.path;

  // --- [寫入權限] POST / PATCH / PUT ---
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
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

  // --- [讀取過濾] GET：解決看到所有人資料的關鍵 ---
  if (req.method === "GET") {
    // 修正：使用 URL 物件來強制添加 userId 查詢參數
    // 這能確保即便原本網址有 _expand 等參數也不會衝突
    if (urlPath === "/collections" || urlPath.startsWith("/collections/")) {
      req.query.userId = Number(currentUserId);
      console.log(
        `[Filter] 已將 userId=${currentUserId} 加入 collections 請求`,
      );
    }

    // 針對單一用戶查詢：限制只能看自己
    if (urlPath === "/users" || urlPath.startsWith("/users/")) {
      req.query.id = Number(currentUserId);
    }
  }

  next();
});

/* ========================
   4. 管理員與渲染邏輯 (保持不變)
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
      if (user && dish.userId === (user.sub || user.id)) return true;
      return dish.status === "published";
    };
    if (Array.isArray(data)) return res.jsonp(data.filter(isVisible));
    if (data && !isVisible(data))
      return res.status(404).json({ error: "找不到該內容" });
  }
  res.jsonp(data);
};

server.use(router);

const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`✅ Spoonful API 運行中 | Port: ${port}`);
});
