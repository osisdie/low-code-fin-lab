# Prompt 對照表

| 檔案 | 用在哪個 Stage | 工具 | 說明 |
|------|----------------|------|------|
| `00-longxia-original.txt` | 對照用 | Grok Automation（講師原版） | 「龍蝦財經」原始 system prompt。學生**不需要**訂閱 Grok，只作為「這就是起點」的參考 |
| `01-stage0-warmup-task.txt` | Stage 0 暖身 | ChatGPT Tasks（免費） | 一句話的每日任務，體驗「排程」 |
| `02-stage1-chatgpt-task.txt` | Stage 1 | ChatGPT Tasks（免費，上限 3 個任務） | 改寫自原版：去掉 Grok 專屬語句，加上「先上網搜尋」「查不到就說查不到」 |
| `03-stage2-ai-summary.txt` | Stage 2–3 | OpenRouter 免費模型（`Code.gs` 呼叫） | 數字由資料表提供，LLM 只負責整理；含 `{date}`、`{data_json}` 兩個佔位符 |
| `04-secretary-triage.txt` | Stage 4 | OpenRouter 免費模型（`Secretary.gs` 呼叫） | 判讀客戶來信 → JSON（意圖、品項、數量、需人工確認事項）；**不輸出金額**。佔位符 `{item_names}`、`{from}`、`{subject}`、`{body}` |
| `05-reply-draft.txt` | Stage 4 | OpenRouter 免費模型（`Secretary.gs` 呼叫） | 依判讀結果寫回覆草稿；禁止寫金額、折扣、交期與退款承諾。佔位符 `{triage_json}` |

## 注意
- 03–05 是**程式**會讀的（內容與 `Code.gs`、`Secretary.gs` 裡的常數同步），佔位符請勿刪除；修改請兩邊一起改。
- 免費額度（ChatGPT Tasks、OpenRouter 免費模型）會變動，請以官網為準；查證日期 2026-10-31（OpenRouter 為 2026-11-24）。
- 所有財經 prompt 都禁止投資建議；所有秘書 prompt 都禁止 AI 產生金額與承諾。修改時請保留這兩條。
