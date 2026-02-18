const jsonServer = require("json-server");
const auth = require("json-server-auth");

const server = jsonServer.create();
const router = jsonServer.router("db.json");

server.db = router.db;

server.use(jsonServer.defaults());
server.use(jsonServer.bodyParser());

const rules = auth.rewriter({
  users: 600,
  restaurants: 444,
  dishes: 644,
  reviews: 644,
  collections: 600,
  reports: 600,
});

server.use(rules);
server.use(auth);

// ★ admin 可讀 users
server.use((req, res, next) => {
  if (!req.user) return next();

  const user = server.db.get("users").find({ id: req.user.id }).value();

  if (user?.role === "admin" && req.path.startsWith("/users")) {
    return router.handle(req, res);
  }
  next();
});

server.use(router);

server.listen(8080, () => console.log("running"));
