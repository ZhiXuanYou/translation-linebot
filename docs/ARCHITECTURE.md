# 系統架構

## 系統邊界

```text
LINE 使用者
  │ webhook event
  ▼
LINE Messaging API
  │ HTTPS
  ▼
Google Apps Script Web App
  ├─ authorization / routing
  ├─ CacheService（短期 Context）
  └─ Gemini request coordination
        │ HTTPS
        ▼
     Gemini API
```

GAS 是唯一應用執行環境。不得加入 Sheets、Firebase、其他資料庫或自架 Server。

## Component Responsibilities

- `Config`：讀取及驗證 Script Properties；不記錄 property 值。
- `Code`：接收 GAS Web App request、檢查 payload 與 event 基本結構並交由服務處理；保持薄層。第一版不宣稱驗證 request 來源真實性。
- `LineService`：解析 LINE event/source、取得 reply token、建立單一 text reply request、呼叫 reply API 並安全處理 HTTP 結果。第一版不實作 push。
- `TranslationService`：依序協調授權、Context、AI 翻譯、輸出格式、回覆與 Context 更新。
- `ContextService`：產生 conversation key、讀寫 CacheService、限制 20 則及 3600 秒 sliding TTL。
- `AiService`：建立翻譯 prompt、呼叫 Gemini、驗證 provider 回覆與譯文契約。
- `DevelopmentTest`：提供 mock event、mock provider 與整合測試 helper；不得預設呼叫真實 API。

## Request Flow

### Webhook 接收

1. `doPost(e)` 將處理交給 `WebhookHandler`，自身只負責以 `HtmlService.createHtmlOutput("OK")` 回傳固定且不含內部資訊的 response。原本的 `ContentService.createTextOutput("OK")` 會依 Google Apps Script 的安全機制 redirect 至 `script.googleusercontent.com`；HtmlService 相容性修正已由使用者在新 deployment version 上以 LINE Developers Verify 實測通過，但不代表完成 webhook authenticity verification。
2. `WebhookHandler` 安全讀取 `e.postData.contents` 並解析 JSON；缺漏、空白、格式錯誤或非 array 的 `events` 均安全結束，不記錄 raw body。
3. 載入正式 authorization config；目標家庭群組 ID 已於初始化階段取得，runtime 不執行 groupId discovery 或 Script Property write。
4. 對每個 event 沿用 `LineService.classifyEvent()`，不建立第二套授權邏輯；只有 `ALLOWED_GROUP_ID` 指定的群組可通過。
5. `AUTHORIZED_TEXT` 交給 `TranslationService.handleText()`，依序讀取 Context、執行 Gemini 翻譯、格式化並呼叫 LINE reply；reply 成功後才 commit 原始訊息。
6. `AUTHORIZED_JOIN` 以 event replyToken 回覆固定雙語介紹。
7. `AUTHORIZED_NON_TEXT`、`UNAUTHORIZED`、`UNSUPPORTED` 全部靜默忽略。

單一 event 發生內部錯誤時不把詳細資訊放入 HTTP response，也不阻止其他 event 被逐筆處理。

### 文字訊息

1. GAS 接收 LINE webhook event。
2. 檢查 payload 與必要 event 欄位；此步驟不是 transport authenticity verification。
3. 依 source type/id 執行 application authorization；未授權立即結束。
4. 非 text message 立即結束。
5. 以 source type namespace 與 identifier SHA-256 digest 計算 conversation key，讀取最近 Context；miss／損壞／read error 均以空 Context 繼續。
6. 將匿名 speaker history 與獨立的 current message 交給翻譯流程。
7. 驗證 AI 輸出並加上唯一允許的國旗 prefix。
8. 透過 LINE reply 回覆。
9. 將「使用者原始文字」加入 Context、裁切為 20 則後以 TTL 3600 秒重寫。

若 AI 翻譯失敗，不把當前訊息加入 Context。若翻譯成功但 LINE reply 失敗，也不加入 Context；Context 只包含已完成端到端處理的訊息。

### Join Event

只有 Bot 加入 `ALLOWED_GROUP_ID` 時才回覆簡短雙語介紹；其他群組不得回覆，也不得呼叫 Gemini。

## Trust Boundaries

- GAS Web App 收到的 webhook payload 是不可信輸入。第一版只能檢查 payload/event schema，無法以 LINE 官方標準流程確認 transport authenticity。
- event 宣稱的 groupId/userId 必須與 Script Properties 精確比對；這是 application authorization，不是 request 來源證明。
- Gemini 是外部服務：request 僅帶完成翻譯所需的最少 Context；response 必須驗證，不可信任其遵循格式。
- CacheService 是暫存且不可靠的儲存：可能提前 miss，不可當作授權或唯一狀態來源。
- Script Properties 是 secret/config 邊界：不得輸出至 log、回覆或測試快照。

## Transport Authenticity 與 Application Authorization

### Transport authenticity

LINE 官方標準驗證需要從 HTTP header 取得 `X-Line-Signature`，使用 `LINE_CHANNEL_SECRET` 對原始 request body 執行 HMAC-SHA256，再比對 signature。純 GAS Web App 的標準 `doPost(e)` event object 無法可靠提供該 header，因此第一版：

- 不假設 `e.headers` 存在。
- 不使用未經官方保證的 header API。
- 不建立假的 signature verification。
- 不宣稱 webhook request 已被驗證為 LINE 所發送。

### Application authorization

第一版僅依 event payload 宣稱的來源做限制：

- `source.type === "group"` 且 `source.groupId === ALLOWED_GROUP_ID`。
- `source.type === "user"` 且 `source.userId === ADMIN_USER_ID`。

其他來源靜默忽略，不呼叫 Gemini、不寫 Context、不呼叫 LINE reply。此控制能縮小應用接受的 event source，但不能證明 payload 或 HTTP request 的真實來源，亦不等同 signature verification。

## Risk Acceptance

第一版是使用範圍有限的私人家庭 MVP，為維持 `LINE Messaging API → Google Apps Script → Gemini API → GAS CacheService` 的簡化架構，明確接受無法完成 LINE 標準 webhook authenticity verification 的限制。這不代表系統完全安全，也不代表 application authorization 可提供相同保證。

若 Bot 擴大使用者、公開、商業化、處理更高敏感度資料，或需要正式 webhook authenticity guarantee，必須重新評估 endpoint 架構。屆時可考慮能可靠取得原始 HTTP headers/body 並完成 LINE signature verification 的服務；第一版不增加或實作該服務。

## Cache Flow

```text
authorized text event
  → derive scoped key
  → cache get
  → missing/invalid = empty context
  → translate with context
  → append original message
  → keep newest 20
  → cache put(..., 3600)
```

群組與管理者私訊使用不同 key namespace，避免 identifier 型態碰撞。詳細格式見 `specs/03-context-cache.md`。

## Source Structure

```text
src/
├─ appsscript.json
├─ Config.js
├─ Code.js
├─ LineService.js
├─ TranslationService.js
├─ ContextService.js
├─ AiService.js
└─ DevelopmentTest.js
```

目前已建立上述 GAS-compatible 結構。Config、LINE source 授權、event classification、webhook parsing／dispatch、LINE text reply transport、Gemini 翻譯，以及以 GAS Script Cache 為 production boundary 的短期 Context 均已實作。

目前確認的 model identifier 為 `gemini-3.5-flash-lite`，只透過 Script Property `GEMINI_MODEL` 提供，不寫死於 production logic。
