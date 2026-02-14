const jsonServer = require("json-server");
const auth = require("json-server-auth");
const path = require("path");
const fs = require("fs");

const server = jsonServer.create();
auth.secret = process.env.JWT_SECRET || "dev_secret";

/* ========================
   資料庫初始化
======================== */
const isProd = process.env.NODE_ENV === "production";
const dbDirectory = isProd ? "/data" : __dirname;
const dbPath = path.join(dbDirectory, "db.json");

if (!fs.existsSync(dbDirectory)) fs.mkdirSync(dbDirectory, { recursive: true });
if (!fs.existsSync(dbPath)) {
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
   權限規則
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
   綁定 userId
======================== */
server.use((req, res, next) => {
  const user = req.user;
  if (!user) return next();

  const currentUserId = Number(user.sub || user.id);

  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    if (
      req.path.includes("/collections") ||
      req.path.includes("/reviews") ||
      req.path.includes("/dishes")
    ) {
      delete req.body.userId;
      req.body.userId = currentUserId;
    }

    if (req.path.includes("/dishes") && req.method === "POST") {
      req.body.status = "draft";
    }
  }

  next();
});

/* ========================
   管理員權限檢查
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
   router.render 安全過濾
======================== */
router.render = (req, res) => {
  const data = res.locals.data;
  const user = req.user;

  // --- Collections ---
  if (req.path.startsWith("/collections")) {
    if (!user) {
      // 未登入不能看任何 collections
      return res.status(401).json({ error: "需要登入" });
    }

    const isAdmin = user.role === "admin";
    const currentUserId = Number(user.sub || user.id);

    if (Array.isArray(data)) {
      if (!isAdmin) {
        const filtered = data.filter(
          (item) => Number(item.userId) === currentUserId,
        );
        return res.jsonp(filtered);
      }
      return res.jsonp(data);
    }

    if (data) {
      if (!isAdmin && Number(data.userId) !== currentUserId) {
        return res.status(404).json({ error: "無權限查看" });
      }
      return res.jsonp(data);
    }

    return res.jsonp([]); // 安全 fallback
  }

  // --- Dishes ---
  if (req.path.includes("/dishes")) {
    const isAdmin = user && user.role === "admin";
    const currentUserId = user ? Number(user.sub || user.id) : null;

    const isVisible = (dish) => {
      if (!dish) return false;
      if (isAdmin) return true;
      if (user && Number(dish.userId) === currentUserId) return true;
      return dish.status === "published";
    };

    if (Array.isArray(data)) return res.jsonp(data.filter(isVisible));
    if (data && !isVisible(data))
      return res.status(404).json({ error: "無權限查看" });
  }

  // 其他資源直接返回
  res.jsonp(data);
};

server.use(router);

const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`Spoonful API Running on port ${port}`);
});
