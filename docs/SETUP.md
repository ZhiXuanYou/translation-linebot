# 人工設定指南

本文件描述從零開始的設定流程；不代表目前環境已完成。部署與真實 API 驗證必須由明確任務授權後才可執行。

## 1. LINE Official Account 與 Messaging API

1. 建立 LINE Official Account，啟用 Messaging API channel。
2. 在 LINE Developers Console 取得 Channel secret，並發行 Channel access token。
3. 關閉不需要的 Official Account Manager 自動回覆，避免與 Bot 回覆重複。
4. 在 Messaging API 設定中允許 Bot 加入群組聊天（Allow bot to join group chats）。
5. 憑證只存入 GAS Script Properties，不貼入程式碼、文件、log 或測試資料。

## 2. Google Apps Script

1. 建立或選擇 GAS 專案。
2. 確認 manifest 與預期 runtime/timezone 權限；只要求實際需要的 scopes。
3. 若使用 clasp，確認 `.clasp.json` 指向正確專案；不得任意修改 `scriptId`。
4. 未經明確指示不得執行 `clasp push`。

## 3. Gemini API

1. 在 Google AI Studio 或正式採用的平台建立 Gemini API key。
2. 本階段確認的 model identifier 為 `gemini-3.5-flash-lite`；正式設定前仍應確認該 identifier 對目前帳號與 API endpoint 可用。
3. 將 key 與 model identifier 分別存入 `GEMINI_API_KEY`、`GEMINI_MODEL`，不得寫死於 production logic。
4. 不在設定驗證時將 key 或完整 provider response 輸出。

## 4. Script Properties

在 GAS Project Settings → Script Properties 建立：

| Property | 用途 | 敏感性 |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE reply/push API 授權 | secret |
| `LINE_CHANNEL_SECRET` | 保留供未來支援標準 LINE webhook signature verification 的架構使用；第一版純 GAS 不假裝已使用 | secret |
| `GEMINI_API_KEY` | Gemini API 授權 | secret |
| `GEMINI_MODEL` | 可替換的 Gemini model identifier | config |
| `ALLOWED_GROUP_ID` | 唯一正式家庭群組 | private identifier |
| `ADMIN_USER_ID` | 唯一可私訊測試的管理者 | private identifier |

不得 hard-code。正式 runtime 不建立額外的 group discovery property。

## 5. Group ID 與 Admin User ID

目標家庭群組 ID 與管理者 user ID 已於初始化階段取得。正式值分別存於 `ALLOWED_GROUP_ID` 與 `ADMIN_USER_ID`；runtime 不再執行 identifier discovery，也不寫入任何 discovery property。這些 identifier 只用於 application authorization，不能證明 HTTP request 來自 LINE。

替代方式是以只供管理者執行的開發 helper 檢視已去除訊息內容的 source metadata。identifier 不得回覆到群組。由於 transport authenticity 未獲標準驗證，應以 LINE 用戶端上的已知操作時間與 event type/source type 交叉核對，並了解這仍不是 signature verification。

## 6. Web App Deployment（未授權時不得執行）

1. 以 GAS Web App 建立 deployment。
2. Execute as 選擇專案擁有者；Who has access 需允許 LINE 平台呼叫 webhook URL。
3. 複製 `/exec` URL，勿使用僅供編輯者測試的 `/dev` URL。
4. 每次程式更新後確認使用的是正確 deployment/version；不得在未審查下重建 deployment。

## 7. LINE Webhook

1. 將 GAS Web App `/exec` URL 填入 LINE Messaging API 的 Webhook URL。
2. 使用 LINE Console 的 Verify 功能確認 endpoint 可達。
3. 啟用 Use webhook。
4. Verify 成功僅表示 endpoint 連線可用，不表示 application 已完成 `X-Line-Signature` 驗證。
5. 以 mock tests 與受控事件驗證 application authorization 及回覆流程。

### 第一版 Webhook 安全限制

純 GAS `doPost(e)` 無法可靠取得 `X-Line-Signature` header，因此第一版不實作 LINE 官方標準 signature verification。不得假設 `e.headers` 可用，也不得把 groupId/userId 比對稱為 signature verification。此限制及風險接受詳見 `ARCHITECTURE.md` 與 `specs/04-error-handling-security.md`。

## 8. 設定驗證清單

- 必要 Script Properties 全部存在且非空；診斷只列出「property 名稱＋缺漏狀態」。
- `ALLOWED_GROUP_ID` 與 `ADMIN_USER_ID` 不相同且符合各自 source type。
- 文件與實作不得宣稱第一版已完成 LINE webhook signature verification。
- 未授權群組及非管理者私訊皆靜默忽略，Gemini 呼叫數為 0。
- 非文字 event 靜默忽略，Gemini 呼叫數為 0。
- Cache key 在不同群組／私訊 namespace 間隔離。
- 真實 endpoint/API 驗證只在使用者另行明確授權時進行。

`LINE_CHANNEL_SECRET` 必須繼續保留在 Script Properties，不 hard-code、不輸出至 log。第一版不假裝用它完成驗證；未來若 endpoint 架構升級，可用於正式 signature verification。
