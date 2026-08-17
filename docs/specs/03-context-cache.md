# Spec 03：Context Cache

## Storage

只使用 GAS `CacheService`，不使用永久儲存。CacheService 不保證保存完整 TTL，因此任何 cache miss、提前淘汰或過期都屬正常狀況。

## Conversation Key

使用 Script Cache，並以 namespace 與 identifier 的 SHA-256 digest 隔離 source type，避免 key 直接暴露 groupId/userId：

```text
ctx:v1:g:<SHA-256(groupId)>
ctx:v1:u:<SHA-256(userId)>
```

只有 `ALLOWED_GROUP_ID` 可產生 group key，只有 `ADMIN_USER_ID` 可產生 admin key。key 不得包含訊息文字；log 不輸出完整 key 或 identifier。

## Message Structure

每則 Context 記錄只含翻譯所需的最少資料：

```json
{
  "speaker": "Speaker A",
  "text": "原始文字訊息"
}
```

- 不保存 Bot 譯文、reply token、display name、真實角色、credentials 或 provider response。
- speaker label 只在單一 conversation 內一致區分參與者，不代表固定語言或 Father/Caregiver role。
- userId 與匿名 speaker label 的短期對應若需保存，必須放在同一 cache payload 中且同 TTL；不得永久保存。

完整 cache payload schema：

```json
{
  "version": 1,
  "messages": [
    { "speaker": "Speaker A", "text": "原始文字訊息" }
  ],
  "speakerMap": {
    "<SHA-256(sender userId)>": "Speaker A"
  }
}
```

不接受額外欄位。`speakerMap` 只為同一 Context window 維持穩定匿名 label，不傳給 Gemini；裁切 messages 後，不再被目前 window 使用的 mapping 會移除，label 可在 window 外回收。

## Limit and TTL

- 最多保留最新 20 則成功處理的使用者原始文字。
- 每次新增有效訊息後裁切舊訊息，再以 `expirationInSeconds = 3600` 重寫。
- 此為 sliding expiration：約 1 小時從最近一次成功寫入重新計算。
- 讀取本身不延長 TTL；未新增訊息時不重寫。

## Cache Miss and Corruption

- miss、過期、JSON 解析失敗、schema 不合或空 payload 均退化為空 Context。
- miss 不記為 error；可記低敏感度 execution metadata，但非必要。
- 無 Context 時仍執行當前單句翻譯。
- 損壞 payload 不應回覆內部錯誤，也不得阻止翻譯。

## Write Timing

只在 AI 輸出驗證及 LINE reply 均成功後寫入當前原文。AI 失敗、LINE reply 失敗、未授權、非文字、空白文字與 join event 均不寫入。

若 LINE reply 成功但 cache write 失敗，不重送翻譯，也不向使用者再發錯誤訊息；只回傳安全的 `CONTEXT_WRITE_ERROR` internal status。後續請求可在較少或空 Context 下繼續。

## Privacy Behavior

- Context 只提供給處理同一授權 conversation 的 Gemini request。
- 不跨群組／私訊合併，不提供歷史查詢，也不提供 `/清除`。
- Cache 是短期處理資料，不可稱為永久紀錄或可靠備份。
- log 不得輸出 payload、完整文字、userId/groupId 或序列化 Context。

## Acceptance Cases

- 第 21 則加入後只保留第 2–21 則。
- 新訊息成功寫入時 TTL 參數為 3600。
- 不同 source namespace 的 Context 不互相可見。
- cache miss／損壞時翻譯仍被呼叫，Context 為空。
- AI 或 LINE reply 失敗時 Context 不變。
