const jsonServer = require("json-server");
const auth = require("json-server-auth");
auth.secret = process.env.JWT_SECRET || "dev_secret";
const path = require("path");
const fs = require("fs");
const server = jsonServer.create();

/* ========================
   DB 初始化
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

server.use(jsonServer.bodyParser);
server.use(jsonServer.defaults());

/* ========================
   工具：取得資源名稱
======================== */
const getResource = (req) => req.path.split("/").filter(Boolean).pop();

/* ========================
   權限規則 (600 = 僅本人)
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
server.use(auth);

/* ========================
   未登入禁止會員資料
======================== */
server.use((req, res, next) => {
  if (!req.user) {
    const resource = getResource(req);
    if (resource === "users" || resource === "collections")
      return res.status(401).json({ error: "需要登入" });
  }
  next();
});

/* ========================
   綁定 owner + 防偽造
======================== */
server.use((req, res, next) => {
  if (!req.user) return next();

  delete req.body.userId;
  const resource = getResource(req);

  if (["POST", "PATCH"].includes(req.method)) {
    if (resource === "collections") req.body.userId = req.user.id;

    if (resource === "reviews") req.body.userId = req.user.id;

    if (resource === "dishes") {
      req.body.userId = req.user.id;
      if (req.method === "POST") req.body.status = "draft";
    }
  }

  next();
});

/* ========================
   GET 只讀自己的資料
   (解決 600 → 401 的核心)
======================== */
server.use((req, res, next) => {
  if (!req.user) return next();
  if (req.method !== "GET") return next();

  const resource = getResource(req);

  if (resource === "collections") req.query.userId = req.user.id;

  if (resource === "users") req.query.id = req.user.id;

  next();
});

/* ========================
   只有管理員可發佈料理
======================== */
server.use((req, res, next) => {
  if (req.method === "PATCH" && getResource(req) === "dishes") {
    if (req.body.status === "published") {
      if (!req.user || req.user.role !== "admin")
        return res.status(403).json({ error: "只有管理員可發布" });
    }
  }
  next();
});

/* ========================
   dishes 可見性過濾
======================== */
router.render = (req, res) => {
  const data = res.locals.data;

  if (req.method === "GET" && getResource(req) === "dishes") {
    const user = req.user;

    const visible = (dish) => {
      if (user && user.role === "admin") return true;
      if (user && dish.userId === user.id) return true;
      return dish.status === "published";
    };

    if (Array.isArray(data)) return res.jsonp(data.filter(visible));
    if (!visible(data)) return res.status(404).json({ error: "Not found" });

    return res.jsonp(data);
  }

  res.jsonp(data);
};

server.use(router);

/* ======================== */
const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`JSON Server + Auth running on port ${port}`);
});
