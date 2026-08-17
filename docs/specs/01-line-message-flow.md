# Spec 01：LINE 訊息流程

## 適用事件

第一版只對授權來源處理：

- `message` event 且 `message.type === "text"`。
- `join` event，用於授權群組的簡短介紹。

第一版純 GAS 無法可靠取得 `X-Line-Signature` header，因此不實作、也不宣稱已完成 LINE channel signature verification。事件 payload 必須視為不可信輸入並檢查必要結構；事件陣列應逐筆處理，單一事件失敗不得把內部資訊回傳為 webhook response。

## Webhook Authenticity Limitation

LINE 官方標準要求以 `LINE_CHANNEL_SECRET` 對原始 request body 執行 HMAC-SHA256，並與 `X-Line-Signature` 比對。但 GAS 標準 `doPost(e)` 無法可靠提供該 header。第一版不得假設 `e.headers` 存在、使用未保證的 header API 或建立假的驗證。

因此以下 source authorization 只能回答「event 宣稱的來源是否允許」，不能回答「HTTP request 是否真的由 LINE 傳送」。這是已接受的第一版安全限制。

## Source 與授權矩陣

| Source | 條件 | 行為 |
|---|---|---|
| group | `source.groupId === ALLOWED_GROUP_ID` | 允許文字翻譯與 join 介紹 |
| group | 其他 groupId | 靜默忽略 |
| user | `source.userId === ADMIN_USER_ID` | 允許私訊文字翻譯測試 |
| user | 其他 userId | 靜默忽略 |
| room／未知 | 全部 | 靜默忽略 |

未授權 event 不讀寫 Context、不呼叫 Gemini、不呼叫 LINE reply，且不得回覆「未授權」。授權比對使用完整字串精確比對。

## Group ID 初始化狀態

目標家庭群組 ID 已於初始化階段取得並設為 `ALLOWED_GROUP_ID`。Runtime 不執行 groupId discovery、不寫入 Script Properties，也不保留相關 history。所有 group event 直接進入正式 authorization；其他群組維持 `UNAUTHORIZED`，不呼叫 TranslationService、Gemini、LINE reply 或 Context。

## Text Message Flow

1. 檢查 payload 與 event 必要欄位；此步驟不驗證 transport authenticity。
2. 判斷 application-level source authorization；不通過即結束。
3. 確認 message type 為 text；否則結束。
4. 空字串或只含空白的 text 視為不可翻譯，靜默忽略。
5. 取得該 conversation Context。
6. 執行翻譯並驗證輸出。
7. 使用該 event 的 reply token 回覆一次。
8. 端到端成功後更新原始訊息 Context。

不得將 reply token 記錄或重複使用。第一版正常翻譯以 reply API 為主，不主動 push 訊息。

## Non-text Events

image、sticker、video、audio、file、location 及其他非文字訊息全部靜默忽略：不下載、不分析、不翻譯、不保存、不回覆，也不呼叫 Gemini。

## Join Event

Bot 加入授權群組時回覆：

```text
🇹🇼 我會自動將中文與印尼文互相翻譯。
🇮🇩 Saya akan menerjemahkan bahasa Mandarin Tradisional dan bahasa Indonesia secara otomatis.
```

此訊息不呼叫 Gemini、不寫入 Context。加入未授權群組時靜默忽略；營運上可由管理者另行將 Bot 移除，但第一版不規定自動 leave。

## Webhook Response

- `doPost(e)` 固定透過 `HtmlService.createHtmlOutput("OK")` 回傳不含內部資訊的 `OK` response。
- 原先使用的 `ContentService.createTextOutput("OK")` 會依 Google Apps Script 的安全機制 redirect 至 `script.googleusercontent.com`，LINE Developers Verify 因而可能先看到 `302 Found`。
- 改用 HtmlService 的相容性修正已由使用者在新 deployment version 上以 LINE Developers Verify 實測通過；此結果不改變 webhook authenticity limitation。
- 已接收且可安全解析的 webhook，無論 event 是否被忽略，均快速完成，避免因「沒有翻譯」造成未處理 exception。
- 缺少 postData/contents、空 body、invalid JSON、缺少 events 或 events 非 array 時安全結束；不記錄或回傳 raw body。
- 第一版不能以 signature 判斷 request 真實來源；不得在 response 或 log 宣稱已通過 signature verification。
- 不將內部錯誤內容放入 HTTP body。

## LINE Reply

- 只使用 Messaging API reply endpoint；第一版只建立一則 text message。
- Channel access token 由 `LINE_CHANNEL_ACCESS_TOKEN` 取得，使用 Bearer authorization，不 hard-code。
- request payload 只包含 event replyToken 與必要 messages 欄位。
- replyToken 缺漏或空白時不呼叫 HTTP transport。
- 2xx 視為成功；4xx、5xx、transport exception 或 malformed response 只產生安全內部結果，不解析、記錄或回覆 provider body。
- 不實作 push、multicast、broadcast、profile API 或 Rich Menu。

## Acceptance Cases

- 授權群組 text：一次 Gemini 翻譯、一次 LINE reply。
- 管理者私訊 text：同上，使用獨立 Context。
- 未授權 source：Gemini、Cache write、LINE reply 均為 0。
- 授權 source 的 sticker/photo：所有外部呼叫與 Cache write 均為 0。
- 授權群組 join：回覆固定雙語介紹，Gemini 呼叫為 0。
