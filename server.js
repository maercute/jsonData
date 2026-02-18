const jsonServer = require("json-server");
const auth = require("json-server-auth");
const path = require("path");
const fs = require("fs");

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, "db.json"));
const middlewares = jsonServer.defaults();

// 1. 基本設定
server.db = router.db;
server.use(middlewares);
server.use(jsonServer.bodyParser);

// 2. 定義權限規則 (標準寫法)
const rules = auth.rewriter({
  users: 600, // 只有自己能看自己 (Admin 例外)
  restaurants: 444, // 唯讀
  dishes: 644, // 公開讀取，登入者唯讀 (Admin 例外)
  reviews: 644, // 公開讀取
  collections: 600,
  reports: 660, // 建議改成 660 讓一般登入者能回報
});

// ★★★ 3. 關鍵修正：Admin 特權 Middleware ★★★
server.use((req, res, next) => {
  const header = req.headers.authorization;

  // A. 如果沒有 Token，直接進入 rules (讓遊客可以 GET 公開資料)
  if (!header) {
    return rules(req, res, next);
  }

  try {
    // B. 有 Token，解析身分
    const token = header.split(" ")[1];
    const payloadPart = token.split(".")[1];
    const payloadStr = Buffer.from(payloadPart, "base64").toString();
    const payload = JSON.parse(payloadStr);

    // C. 寬鬆比對 ID (解決 1 vs "1" 問題)
    const user = router.db
      .get("users")
      .find((u) => u.id == payload.sub)
      .value();

    // D. 如果是 Admin -> 直接 next() 跳過 rules 檢查 (上帝模式)
    if (user && user.role === "admin") {
      // console.log("Admin 通過，跳過權限檢查");
      return next();
    }
  } catch (e) {
    // 解析失敗，不處理，繼續往下走
  }

  // E. 如果是 一般登入者 -> 乖乖套用 rules
  return rules(req, res, next);
});

// 4. 啟動驗證與路由 (標準順序)
server.use(auth);
server.use(router);

// 5. 啟動 Server
const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`JSON Server + Auth running on port ${port}`);
});
