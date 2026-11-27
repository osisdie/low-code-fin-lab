# low-code-fin-lab — 打造你的 AI 數位分身：市場情報站 × 商務秘書

> 不用會寫程式，跟著做就能讓 AI 每天早上寄你一封「今日總覽」：匯率、股票、黃金、比特幣，加上秘書幫你準備好的
> **回覆草稿與報價單草稿**（寄出前由你確認）。版面挑你喜歡的，數字每天自動記進試算表與知識庫。
> 對象：投資人、老闆／主管、財會與金融從業人員、想開始學習 AI Agent 的人。**全程使用免費資源。**

這個 repo 是課程教材庫（學員講義、講師教案範本、簡報），也包含可直接使用的 Google Apps Script 與範例 Obsidian vault。
起點是講師在 Grok Automation 使用的「龍蝦財經」prompt；因為學生不一定訂閱 Grok，我們改用免費工具重做一遍。

## 課程一覽（4 小時）

| Stage | 主題 | 工具（皆免費） | 你會做出 | 碰到的天花板 |
|-------|------|----------------|----------|--------------|
| 0 | 概念＋期望管理＋5 分鐘暖身 | ChatGPT Tasks | 第一個每日自動任務 | 只有一行字，資訊太少 |
| 1 | No-Code：完整日報 | ChatGPT Tasks（免費上限 3 個任務） | 「龍蝦財經」風格的每日摘要 | 數字可能不準、格式不固定、只在 app 內 |
| 2 | Low-Code：真數據＋今日總覽 | 一鍵副本的 Google Sheet、Apps Script、OpenRouter 免費模型、Gmail | 每天一封數字可核對的今日總覽（三種版面）＋「日報紀錄」趨勢表 | 資料源延遲、美國假日、表格寫不下自己的觀察 |
| 3 | 知識庫（加分題） | Markdown 資料夾、Google 雲端硬碟電腦版、Obsidian | 會自己長大的財經知識庫＋儀表板 | 要裝軟體、欄位要自己維護 |
| 4 | 商務秘書：信件 → 草稿 | 同一份 Sheet、Gmail 標籤、OpenRouter 免費模型 | Gmail 回覆草稿＋報價單草稿＋「秘書紀錄」，隔天今日總覽列出待確認草稿 | AI 判讀會漏、免費方案不適合真實客戶資料 |
| 收尾 | 安全、免費的真相、行動清單 | — | 你的 1 週／1 月／3 月行動清單 | — |

**為什麼這個順序？** 每一段都從上一段的「天花板」開始：先體驗 AI 排程有多方便（Stage 0–1），再親眼看到「AI 憑搜尋給的數字不一定準」，才有動機讓數字改由資料表提供（Stage 2）；想寫下自己的觀察、把資料串起來，就用知識庫（Stage 3，加分題）；最後把同一套積木換個用途，變成商務秘書（Stage 4）。

**全自動的邊界**：整理、起草全自動；投資判斷、按下「傳送」、折扣與退款決定，永遠留給人。

## 目錄結構

```
README.md, LICENSE（程式碼 MIT／教材 CC BY 4.0）, CLAUDE.md, .env.example, .gitignore
index.html, .nojekyll                 GitHub Pages 入口（導向 slides/handbook.html）
docs/student/
  student-journey-map.md              一張圖看懂全程：路線圖、架構圖、每日流程、選單按鈕、安全感、卡關排除
  student-stage-0-concepts.md         概念、全自動的邊界、ChatGPT Tasks 5 分鐘暖身
  student-stage-1-lab.md              ChatGPT Tasks 完整日報
  student-stage-2-lab.md              一鍵副本 Sheet + OpenRouter + Gmail、三種版面、日報紀錄
  student-stage-3-obsidian-lab.md     Markdown 知識庫 + Obsidian
  student-stage-4-secretary-lab.md    商務秘書：信件 → 回覆草稿 + 報價單草稿
  student-free-tools-menu.md          免費工具選單、Markdown 檢視器比較、「免費的真相」
  student-security-gmail-keys.md      Gmail 授權、API key、客戶資料與知識庫保護
  img/                                journey-map.svg（路線圖）與編號截圖（stage2-template-*：三種版面樣張；stage3-*：Obsidian 實機）
docs/instructor-template/             講師教案「去敏範本」（時間表、教案、口白稿、彩排 checklist）——開課後公開，目前僅在講師本機
docs/instructor/                      （本機專用，被 .gitignore 忽略，永不公開）實際版：日期、場地、範本連結
lab-assets/
  apps-script/                        Code.gs（選單、今日總覽）、Templates.gs（三種版面）、Vault.gs（知識庫）、Secretary.gs（秘書）、appsscript.json、步驟
  sheet-template/                     「數據」「報價表」分頁欄位與公式（「日報紀錄」「秘書紀錄」自動產生）
  prompts/                            龍蝦財經原版與各 Stage 的 prompt（README 有對照表）
  obsidian-vault/                     範例 vault：首頁儀表板、範例日報、標的筆記（走勢圖）、秘書紀錄、客戶筆記、每日筆記與每週回顧範本
  secretary/sample-emails.md          秘書練習用的 12 封虛構客戶來信（每封附預期的意圖、狀態、草稿）
slides/
  handbook.html                       上課主檔：報紙格式滾動手冊（全場 5 段）
  obsidian.html                       特別報導：Markdown 知識庫與 Obsidian（為什麼不被軟體綁住）
  journey-map.html                    學員路線圖網頁版（與 student-journey-map.md 同內容，圖已內嵌、離線可看）
```

## 快速開始

**給學員**：覺得路很長？先看 [一張圖看懂全程](docs/student/student-journey-map.md)（[網頁版](slides/journey-map.html)）。接著照順序讀 `docs/student/student-stage-0-concepts.md` → `stage-1` → `stage-2` → `stage-3-obsidian` → `stage-4-secretary`。上課主檔是 [`slides/handbook.html`](slides/handbook.html)。

**給講師**：
1. 講師教案（時間表、口白稿、彩排 checklist）的去敏範本 `docs/instructor-template/` 預計**開課後公開**；在那之前只放在講師本機。
   開課時複製到本機 `docs/instructor/`（被 `.gitignore` 忽略）再填入實際值：`cp -r docs/instructor-template/. docs/instructor/`
2. 課前依彩排 checklist 建立範本 Sheet（貼上 [`lab-assets/apps-script/`](lab-assets/apps-script/README.md) 的四支程式）、取得 `/copy` 連結，並用一個**全新的個人 Gmail** 從頭走完 Stage 2–4。
3. 實測 [`sheet-template`](lab-assets/sheet-template/README.md) 的代碼是否都能出數字（目前標註為尚未逐一實測）。

## 設計理念
- **免費優先**：不要求訂閱 Grok、ChatGPT Plus、Gemini Pro 或 Claude。免費額度會變動，文件一律標註「以官網為準」與查證日期。
- **不寫程式也能跑**：講師提供「建立副本」連結，學員只要貼一把 key、點選單；想看程式的人，四支 `.gs` 都在 repo 裡。
- **數字不靠 AI 記憶**：日報的數字來自 Google Finance／CoinGecko／Yahoo Finance，報價金額來自「報價表」；AI 只負責整理文字，禁止給投資建議、禁止自己報價或承諾。
- **一天只看一封信**：財經數字與秘書待辦合併成「今日總覽」，精簡／完整／表格三種版面任選；不想裝軟體，試算表的「日報紀錄」就能看趨勢。
- **資料是你的**：知識庫是純 Markdown 資料夾，Obsidian 只是推薦的檢視器，換 VS Code 或記事本也打得開。
- **密碼零接觸**：主線用你自己的 Google 帳號授權寄信、建草稿，不需要 Gmail 密碼；API key 只放「指令碼屬性」。
- **每個步驟有檢核點**，每個階段有「你應該觀察到的天花板」。

## 授權與用途
程式碼為 MIT，教材為 CC BY 4.0（見 [LICENSE](LICENSE)）。範例數字、公司、帳號、金額皆為虛構或範本；報告內容僅供學習，**不構成投資建議**。
