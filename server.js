const jsonServer = require("json-server");
const auth = require("json-server-auth");
const path = require("path");
const fs = require("fs");

const server = jsonServer.create();

const isProd = process.env.NODE_ENV === "production";
const dbDirectory = isProd ? "/data" : __dirname;
const dbPath = path.join(dbDirectory, "db.json");

if (!fs.existsSync(dbDirectory)) {
  fs.mkdirSync(dbDirectory, { recursive: true });
}

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

// Ensure CORS allows Authorization and related headers (for axios / browser requests)
server.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-forwarded-authorization, x-access-token",
  );
  res.header("Access-Control-Expose-Headers", "Authorization");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const rules = auth.rewriter({
  users: 600,
  restaurants: 444,
  dishes: 444,
  reviews: 644,
  collections: 600,
});

server.use(rules);

// Normalize auth token from alternative locations so proxies (like Zeabur) that
// strip the standard `Authorization` header can still forward tokens.
server.use((req, res, next) => {
  if (!req.headers || req.headers.authorization) return next();

  const alt =
    req.headers["x-forwarded-authorization"] ||
    req.headers["x-access-token"] ||
    null;
  if (alt) {
    req.headers.authorization = /^Bearer\s+/i.test(alt) ? alt : `Bearer ${alt}`;
    return next();
  }

  if (req.query && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
    return next();
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const parts = cookieHeader.split(";").map((s) => s.trim());
    for (const part of parts) {
      const [k, v] = part.split("=");
      if (!k) continue;
      const key = k.trim();
      if (
        key === "token" ||
        key === "access_token" ||
        key.toLowerCase() === "authorization"
      ) {
        const val = (v || "").trim();
        req.headers.authorization = /^Bearer\s+/i.test(val)
          ? val
          : `Bearer ${val}`;
        break;
      }
    }
  }

  return next();
});

server.use(auth);

// Debug: log auth header and req.user for /collections requests
server.use((req, res, next) => {
  if (!req.path.startsWith("/collections")) return next();
  console.log("[DEBUG] /collections headers:", {
    authorization: req.headers["authorization"] || null,
    cookie: req.headers["cookie"] || null,
  });
  console.log("[DEBUG] req.user:", req.user || null);
  return next();
});

// Collections access control middleware
// - 要求登入（json-server-auth 會把使用者放在 req.user）
// - 非 admin 使用者只能看到/操作屬於自己的 collections（以 userId 欄位判斷）
server.use((req, res, next) => {
  if (!req.path.startsWith("/collections")) return next();

  const user = req.user;
  if (!user)
    return res.status(401).json({ error: "需登入才能存取 collections" });

  const isAdmin = user.role === "admin" || user.isAdmin === true;

  // GET /collections -> 僅回傳自己的 collections（非 admin）
  if (
    req.method === "GET" &&
    /^\/collections\/?$/.test(req.path.split("?")[0])
  ) {
    if (!isAdmin) {
      req.query = req.query || {};
      req.query.userId = String(user.id);
    }
    return next();
  }

  // GET /collections/:id 以及修改/刪除等需要檢查該資源是否屬於使用者
  const matchId = req.path.split("/")[2];
  const id = matchId ? Number(matchId.split("?")[0]) : null;

  if (id) {
    const item = server.db.get("collections").find({ id: id }).value();
    if (!item) return res.status(404).json({ error: "Collection not found" });
    if (item.userId !== user.id && !isAdmin) {
      return res.status(403).json({ error: "沒有權限存取此 collection" });
    }
  }

  // POST: 確保新建立的 collection 屬於登入者
  if (req.method === "POST") {
    req.body = req.body || {};
    req.body.userId = user.id;
  }

  return next();
});

server.use(router);

const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`JSON Server + Auth running on port ${port}`);
});
