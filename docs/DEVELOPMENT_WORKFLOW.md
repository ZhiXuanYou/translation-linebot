# 開發流程與限制

本文件對後續 Codex 或其他開發者具有約束力。

## 修改前

1. 閱讀 README、與任務直接相關的 spec，以及現有程式。
2. 檢查 worktree／專案現況，保留不相關與使用者既有內容。
3. 明確列出本次範圍；一次只處理使用者指定的任務。
4. 若需求、spec 與 implementation 衝突，先回報，不得暗中改寫需求。

## 實作原則

- 不自行增加需求、移除設定或省略步驟。
- 不因設定目前暫時用不到而省略文件要求的 property。
- secret/identifier 不得 hard-code。
- 正式變更需求時，implementation、spec 與測試必須同步。
- 使用 mock/stub 隔離 LINE、Gemini 與 CacheService；除非明確授權，不呼叫真實服務。
- log 與 test output 不得包含 credentials、完整私人聊天或完整 provider response。
- 第一版純 GAS 不得假設 `e.headers` 存在、使用未經官方保證的 header API，或宣稱已完成 `X-Line-Signature` verification。
- `ALLOWED_GROUP_ID`／`ADMIN_USER_ID` 比對只能稱為 application authorization，不得描述為 transport authenticity verification。
- `LINE_CHANNEL_SECRET` 必須保留於設定規格，但在 endpoint 架構未升級前不得假裝已用於 signature verification。

## 驗證順序

1. 執行語法檢查。
2. 執行變更範圍的單元／mock tests。
3. 執行相關 regression tests。
4. 檢查授權失敗與非文字流程的 Gemini 呼叫數為 0。
5. 檢查敏感資訊未出現在 source、fixture、snapshot 或輸出。
6. 回報測試命令、結果、未測範圍與風險。

## 禁止自行執行

- Git commit、push 或其他遠端變更。
- `clasp push`。
- GAS deployment。
- 真實 Gemini API request。
- 真實 LINE 訊息或 LINE API request。
- 修改 `.clasp.json` 的 `scriptId`。

只有使用者針對該動作明確下令後，才可在確認目標、影響與憑證安全後執行。

## 完成條件

- 實作符合全部相關 spec。
- syntax check 與相關 mock/regression tests 通過。
- 文件與測試同步更新。
- 沒有暴露 credentials 或私人聊天。
- 清楚回報修改內容、驗證結果、限制與待確認決策，然後停止等待下一步。
