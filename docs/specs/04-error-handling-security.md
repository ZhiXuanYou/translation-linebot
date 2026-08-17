# Spec 04：錯誤處理與安全

## Error Categories

| Category | 範例 | 使用者行為 |
|---|---|---|
| Authorization | 未授權 group/user | 靜默忽略 |
| Validation | 非文字、空白文字、未知 source | 靜默忽略 |
| Webhook authenticity | 純 GAS 無法可靠取得 `X-Line-Signature` | 第一版接受此限制；不宣稱 request 已驗證 |
| Configuration | 必要 Script Property 缺漏 | 安全失敗；授權使用者可收到統一錯誤訊息 |
| Gemini | timeout、HTTP/schema/validation error | 固定雙語錯誤訊息 |
| LINE API | reply timeout/HTTP error | 無法可靠回覆時只做安全診斷，不重複洩漏內容 |
| Cache | miss、提前淘汰 | 正常退化為空 Context |
| Cache | parse/write error | 翻譯流程可行時繼續；安全診斷，不暴露 payload |
| Internal | unexpected exception | 統一錯誤處理，不暴露內部資訊 |

## User-facing Error

對已授權使用者，翻譯或內部處理失敗時只允許：

```text
🇹🇼 暫時無法翻譯，請稍後再試。
🇮🇩 Terjemahan sementara tidak tersedia. Silakan coba lagi nanti.
```

不得附 error code、HTTP response、stack trace、provider response、credentials、prompt 或內部實作資訊。未授權來源不得收到此訊息。

## Transport Authenticity

Transport authenticity 回答「HTTP webhook request 是否真的由 LINE 發送」。LINE 官方標準流程需要 `X-Line-Signature`、原始 request body 與 `LINE_CHANNEL_SECRET` 執行 HMAC-SHA256 驗證。

第一版純 GAS Web App 的標準 `doPost(e)` 無法可靠提供該 request header，因此：

- 不實作、也不宣稱已實作 LINE 官方標準 signature verification。
- 不假設 `e.headers` 存在。
- 不使用不存在或未經官方保證的 header API。
- 不建立假的 signature verification。

## Application Authorization and Ordering

1. 將 webhook payload 視為不可信輸入，檢查必要 event 結構。
2. 解析最少必要 source metadata。
3. 比對 `ALLOWED_GROUP_ID`／`ADMIN_USER_ID`。
4. 檢查 message type。
5. 只有通過以上條件才讀寫 Context 或呼叫 Gemini。

Application authorization 回答「event 宣稱的 source 是否為允許的家庭群組或管理者」。授權不得依賴 Cache；identifier 必須來自 Script Properties 並精確比對。這項控制不能證明 request 由 LINE 傳送，不能取代或等同 signature verification。

## Risk Acceptance

第一版為使用範圍有限的私人家庭 MVP，為維持純 GAS 與簡化架構，明確接受無法提供標準 LINE webhook authenticity guarantee 的風險。不得將此狀態描述為完全安全。

若 Bot 擴大使用者、公開、商業化、處理更高敏感度資料，或安全要求提高，必須重新評估 webhook endpoint。可考慮改用能取得原始 headers/body 並完成 LINE signature verification 的服務；本階段不建立該服務。

## Secret Handling

- `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`GEMINI_API_KEY` 永不寫入 source、文件值、log、錯誤回覆或 fixture。
- `LINE_CHANNEL_SECRET` 第一版仍保留於 Script Properties，供未來 endpoint 架構升級後執行正式 signature verification；目前不得假裝已使用它完成驗證。
- `ALLOWED_GROUP_ID`、`ADMIN_USER_ID` 視為私人 identifier，不記錄完整值。
- `GEMINI_MODEL` 是 config 但仍由 Script Properties 管理。
- Config 驗證僅可回報 property 名稱與 present/missing，不可回報 value。
- 外部 HTTP request header/body 的診斷必須遮罩或省略敏感欄位。

## Privacy

- 不永久保存聊天內容。
- Gemini request 只帶當前原文與同 conversation 必要的最近 Context。
- 不將完整私人聊天、完整 prompt、Context payload 或完整 provider response 寫入 log。
- 不把某 userId 永久推定為爸爸、看護或固定語言。

## Safe Diagnostics

允許的結構化欄位：

- stage（如 `webhook_validation`、`authorization`、`gemini_request`、`line_reply`、`cache_write`）
- error type（穩定、非敏感的內部分類）
- HTTP status（數值，不含 body）
- success/failure
- execution metadata（timestamp、duration、event type、source type、非可逆 request correlation id）

禁止記錄：

- API credentials、Channel Access Token、Channel Secret、Gemini API Key。
- 完整 groupId、userId、reply token。
- 完整私人聊天、Context、prompt。
- 完整 Gemini/LINE provider response 或 response body。
- 未清理的 exception object、request headers 或 stack trace。

Group ID 已於初始化階段取得；runtime 不執行 groupId discovery、不寫入 Script Properties，也不記錄 groupId。正式 application authorization 只讀取 `ALLOWED_GROUP_ID`。

開發階段若需 stack trace，只能在確認不含 payload/secret 的受控測試中使用；正式流程預設不記錄。

## Failure Containment

- Gemini 失敗不得回覆原始 provider 文字，也不更新 Context。
- Gemini diagnostics 只允許穩定類型（configuration、HTTP、rate limit、transport、invalid JSON/response/output）及必要 HTTP status；不得包含 endpoint、API key、prompt、私人原文或 provider body。
- Gemini 4xx、429、5xx、transport exception、invalid JSON、缺少 candidate/content、invalid structured output、空譯文或不支援的 target language 均使用固定雙語錯誤訊息。
- LINE reply 失敗不得改用未規格化的 push 重送，以免重複訊息。
- LINE reply diagnostics 只包含穩定 error type 與必要 HTTP status；不得包含 endpoint、access token、replyToken、response body 或 exception details。
- Malformed webhook 不回傳 raw body、parse error 或 stack trace；`doPost` 維持固定無敏感資訊 response。
- Cache 失敗不得變成永久儲存 fallback。
- Cache miss 是正常狀況；malformed payload 安全退化為空 Context。Read/write failure 只使用 `CONTEXT_READ_ERROR`／`CONTEXT_WRITE_ERROR`／`CONTEXT_INVALID_DATA` 等穩定類型，不包含 key、identifier、payload、message history 或 exception details。
- Context key 與短期 speaker mapping 使用 identifier digest；只有匿名 `{speaker,text}` messages 可傳給 Gemini，speaker mapping 不得傳送。
- Cache write failure 發生在成功 LINE reply 之後時，不得重送翻譯或再回覆第二則錯誤。
- 單一 event 的錯誤不得洩露到其他 conversation。

## Security Acceptance Cases

- 文件與實作不讀取未保證存在的 `e.headers`，也不宣稱第一版已驗證 signature。
- 模擬未授權 source：外部呼叫與 Context write 均為 0。
- 模擬含 secret 的 provider error：user message 與 captured log 都不含 secret/body。
- 模擬 Gemini invalid response：只回固定雙語錯誤訊息。
- 搜尋 source、fixtures、snapshots 不得出現真實 credential 或 identifier。
