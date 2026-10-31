# low-code-fin-lab 專案慣例

本 repo 是給「不懂技術的人」的課程：一步步做出自己的 AI 數位分身（每日財經報告＋知識庫＋商務秘書）。

## 內容原則
- 全程繁體中文（工具名稱保留英文）；語氣平實、鼓勵，不用行話。
- **一律以免費資源為前提**，學生不一定有付費訂閱。凡提到免費額度，需註明「以官網為準」與查證日期。
- 報告內容**不得包含投資建議或買賣建議**；數字必須來自工具／資料表，LLM 只負責整理文字，不得憑記憶補數字。
- 商務秘書只建立 Gmail **草稿**、不寄信；報價金額只來自「報價表」，LLM 不得產生金額、折扣、交期或退款承諾。課堂範例信件一律虛構（免費 Gemini 方案的輸入可能被用於改進服務）。
- 範例公司、帳號、金額皆為虛構或範本。

## 安全
- 真實密碼、API key 不得出現在 repo、截圖或聊天室。祕密只放 `.env`（已 gitignore）或 Apps Script「指令碼屬性」。
- 寄信主線用 Apps Script `MailApp`，不碰密碼；若需 SMTP，只能用 Google「應用程式密碼」，絕不使用真實登入密碼。
- 提交前執行：`gitleaks git --staged --no-banner` 與 `git grep -iE "app_password|api[_-]?key|sk-|AIza"`，確認沒有真實密鑰。
- repo 是**公開的通用開源教材**：價格、開課日期、場地、主辦單位、講師個資、名單、範本 Sheet 實際連結只能放 `docs/instructor/`。

## 結構
`docs/student/`（學員講義）、`docs/instructor-template/`（去敏講師範本；**開課後才公開，目前在 .gitignore**）、`docs/instructor/`（實際版，gitignored，永不公開）、`lab-assets/`（apps-script、sheet-template、prompts、obsidian-vault、secretary）、`slides/`。README 目錄結構需與實際檔名一致。
- 會同步的內容：`prompts/03–05` ↔ `Code.gs`／`Secretary.gs` 的提示詞常數；`obsidian-vault/` 的起始檔 ↔ `Vault.gs` 的 `STARTER_FILES`。修改請兩邊一起改。
- 範例 vault 的 `.obsidian/` 只收 `daily-notes.json`、`templates.json`、`graph.json`。

## Git
- Commit 訊息格式：`scope: message`（英文小寫，例如 `docs: add stage 1 lab`），必要時括號補原因。
- **commit 訊息與 PR 描述不得提及 AI 工具名稱或模型名稱，也不加 Co-Authored-By 等 AI 協作字樣。**
- 只有使用者要求時才 commit / push。
