# 專案總覽

## Problem

台灣家屬與印尼籍家庭看護在同一 LINE 群組討論日常照護時，語言差異會增加溝通成本。一般逐句翻譯缺少上下文，容易錯判代名詞、省略主詞及 `Ibu` 等照護情境稱呼；另有醫療數值或劑量被改寫的風險。

## Goal

讓雙方直接用慣用語言聊天，由 Bot 自動提供繁體中文／印尼文雙向翻譯，並以不永久保存的短期上下文改善譯文。Bot 僅翻譯，不回答問題、不給建議、不扮演一般聊天 AI。

## Users

- 台灣家屬。
- 印尼籍家庭看護。
- 管理者：以 `ADMIN_USER_ID` 私訊 Bot 進行開發及翻譯測試。
- 被照護者在提示詞中的固定稱呼為「阿嬤」，但不是系統帳號角色。

第一版不建立 Father/Caregiver role，也不把 userId 永久綁定到語言或角色。

## Use Cases

1. 授權群組成員輸入中文，Bot 回覆 `🇮🇩：<印尼文內容>`。
2. 授權群組成員輸入印尼文，Bot 回覆 `🇹🇼：<繁體中文內容>`。
3. 混合語句翻譯成對方最容易理解的主要語言。
4. 純英文依當前訊息與短期上下文選擇目標語言。
5. 管理者私訊進行同等的文字翻譯測試。
6. Bot 加入群組時發送一行中文、一行印尼文的簡短介紹。

## Functional Requirements

- FR-01：先驗證 conversation 授權，再進行任何 Gemini 呼叫或寫入 Context。
- FR-02：只處理 LINE text message；所有非文字訊息靜默忽略。
- FR-03：自動判斷語言與翻譯方向，不提供手動方向選擇。
- FR-04：AI 正常輸出只能是單一譯文，不解釋、評論、回答或補充。
- FR-05：每個 conversation 隔離保存最近 20 則原始文字；不保存 Bot 譯文。
- FR-06：Context TTL 為 3600 秒並於每次加入有效文字時重新寫入。
- FR-07：Cache miss 時仍執行單句翻譯。
- FR-08：忠實保留姓名、藥名、劑量、數字、日期、時間、血壓、血糖、體溫與單位。
- FR-09：AI/LINE/內部錯誤不得向使用者揭露敏感或內部資訊。
- FR-10：所有 secret 與授權 identifier 來自 Script Properties。

## Non-functional Requirements

- Privacy：不永久保存聊天；log 不含完整私人訊息或完整 provider response。
- Security：未授權來源不得呼叫 Gemini，也不得污染 Cache。
- Isolation：群組以 groupId、管理者私訊以 userId 分隔 Context。
- Resilience：CacheService 提前失效是正常狀況；無 Context 仍能翻譯。
- Accuracy：重要醫療與照護數值不得被推測、換算或修改。
- Maintainability：Webhook entry point 保持薄層；model 與設定不得寫死。
- Usability：輸出短而一致；非文字與未授權來源不產生干擾回覆。

## Non-goals

- Google Sheets、Firebase、任何 database 或永久聊天紀錄。
- 聊天歷史查詢、會員系統、Rich Menu。
- 圖片翻譯、OCR、語音翻譯、語音辨識。
- 醫療建議、醫囑修改、AI 一般聊天。
- `/清除` 指令。
- 使用者手動選擇翻譯方向。

## MVP Success Criteria

- 授權群組與管理者私訊的文字能依輸出契約完成雙向翻譯。
- 未授權群組、非管理者私訊及非文字訊息皆不呼叫 Gemini 且靜默忽略。
- 混合語句與純英文有明確、可測試的方向判斷行為。
- Context 依 conversation 隔離、最多 20 則，Cache miss 不影響單句翻譯。
- 測試案例確認 `145/80`、`1/2 顆` 等關鍵內容原樣保留。
- 使用者錯誤訊息不洩露 response、stack trace、憑證或私人內容。
- 所有必要 Script Properties 缺漏時能安全失敗並留下非敏感診斷。

