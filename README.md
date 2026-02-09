# json-server-sample 說明

## 版本跟說明

本專案 Demo 使用 `json-server@0.17.1` 和 `json-server-auth@2.1.0`。

依照目前官方 [json-server-auth](https://github.com/jeremyben/json-server-auth) 的安裝（`npm install -D json-server json-server-auth`），在預設上 json-server 會去安裝最新的版本（目前是 1.0.0-beta.3），這個新版本的核心架構已經拔除原先的 Node Express。
而 json-server-auth 已經有四年沒有更新，當初這個套件是基於 json-server v0.17.x 搭配 Express 的核心架構來製作的，所以目前會跟移除 Express 的 json-server v1.x 版本不相容。

如果想知道更細節的資訊，可參考：[json-server-auth 版本差異與解決方案連結](https://docs.google.com/document/d/11dKlKx7kFxXLQs0e9BLmc4KG8fuGH7Ial6L58Wv4k9c/edit?tab=t.0)

---

## 運作步驟

1. 拿到這個專案時，先執行 `npm install`
2. 使用 `npx json-server-auth db.json` 來啟動這個 JSON server（這邊使用 npx 執行，來確保使用的是專案內的 0.17.1 版本，而非系統全域可能殘留的其他版本）
3. 看到終端機有跑出 `http://localhost:3000` 並且可以點選，就表示成功啟動 JSON server，再來就可往後續操作邁進囉
