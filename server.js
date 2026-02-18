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
        reports: [],
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

// 1. 定義規則 (但先不要 use 它！)
const rules = auth.rewriter({
  users: 600,
  restaurants: 444,
  dishes: 644,
  reviews: 644,
  collections: 600,
  reports: 600,
});

// 2. 自定義 Middleware：判斷 Admin 並決定是否套用規則
server.use((req, res, next) => {
  const header = req.headers.authorization;

  // A. 沒有 Token (路人) -> 直接套用規則
  if (!header) {
    return rules(req, res, next);
  }

  try {
    // B. 有 Token -> 手動解碼看身分
    const token = header.split(" ")[1];
    const payloadPart = token.split(".")[1];
    const payloadStr = Buffer.from(payloadPart, "base64").toString();
    const payload = JSON.parse(payloadStr);

    // 解決 ID 數字/字串問題 (使用 ==)
    const user = router.db
      .get("users")
      .find((u) => u.id == payload.sub)
      .value();

    // C. 如果是 Admin -> 直接 next() (跳過 rules，上帝模式！)
    if (user && user.role === "admin") {
      // 這裡可以加個 log 確認是否觸發
      // console.log("Admin 權限觸發，跳過規則檢查");
      return next();
    }
  } catch (error) {
    // 解碼失敗忽略
  }

  // D. 如果是 一般登入者 -> 套用規則
  return rules(req, res, next);
});

// 3. 原本的 server.use(rules) 必須刪除！
// server.use(rules);  <-- 這行千萬不要留，留了就破功

// 4. 啟動驗證
server.use(auth);

// 5. 啟動路由
server.use(router);

const port = process.env.PORT || 8080;
server.listen(port, "0.0.0.0", () => {
  console.log(`JSON Server + Auth running on port ${port}`);
});
