# 免費工具選單 — 不訂閱也能做每日財經報告與商務秘書

> 老師用 Grok Automation，一個工具就包辦排程、查資料、整理、推送。但你不一定有訂閱。
> 這頁整理**現在（2026）能免費上手**的替代方案，依「積木」分類。

> ⚠️ **免費額度會變**：以下為撰寫時（查證日期 2026-10-03；知識庫與秘書相關項目 2026-10-31）的狀況，**以各家官網為準**。

## 「免費」的真相
| 工具 | 免費到什麼程度 | 要留意 |
|------|----------------|--------|
| ChatGPT Tasks | 免費帳號可排程，上限約 3 個任務 | 觸發條件（如 Gmail、Slack 事件）為付費功能；通知方式依平台而異 |
| Gemini（聊天 app）Scheduled Actions | 目前僅付費方案可用 | 免費版不能排程；但 Gemini API 有免費額度（Stage 2 使用） |
| Gemini API（AI Studio） | 有免費額度，採用量限制 | 型號、額度會調整；超過會被限流 |
| Google Sheets + Apps Script + Gmail | 免費（個人帳號） | 有每日寄信與執行時間配額，個人日報遠遠夠用；公司 Workspace 帳號可能被管理員限制 |
| Gemini API 免費方案用在秘書 | 可用 | **輸入內容可能被用於改進服務**（以官網條款為準），真實客戶信件不要送進免費方案 |
| Obsidian | 個人與商業用途皆免費 | 付費的 Sync、Publish 本課程用不到 |
| Google 雲端硬碟電腦版 | 免費（共用 15 GB 空間） | 公司電腦可能不能安裝 → 改用網頁下載 |
| CoinGecko 公開端點 | 免 key 可查價格 | 有頻率限制，每天一次沒問題 |
| Yahoo Finance 圖表端點 | 免 key | 非官方，可能變動 |

**平台免費 ≠ 全部免費**：背後的 AI 呼叫和資料源才是主要限制。

## A. 最好上手
| 工具 | 一句話 | 適合 |
|------|--------|------|
| ChatGPT Tasks | 一句話建每日任務 | Stage 0–1，完全不想設定 |
| Google Sheets + GOOGLEFINANCE | 表格就是資料庫，匯率、股價自動更新 | Stage 2 的資料來源 |
| Apps Script | 免費排程＋寄信＋Gmail 草稿 | Stage 2、4 的主角（講師提供一鍵副本，不用寫程式） |
| Obsidian | 免費的 Markdown 知識庫檢視器 | Stage 3 |

## B. 想更進一步
| 工具 | 一句話 | 備註 |
|------|--------|------|
| n8n（自架） | 視覺化流程，串更多服務 | 軟體免費，需自己架設環境 |
| Make.com 免費版 | 雲端拖拉流程 | 免費額度有限且常調整 |
| 自架 Python + GitHub Actions | 全自動、可版本控管 | 偏工程，非本課程範圍 |

## 知識庫：用哪個軟體打開 Markdown 資料夾？
Stage 3 的知識庫是一個**純 Markdown 資料夾**，用什麼軟體打開都可以。比較如下：

| 工具 | 費用 | 資料格式 | 給商務人士的評語 |
|---|---|---|---|
| **Obsidian**（本課程推薦） | 免費（含商用） | 純 Markdown 資料夾 | 有繁中介面；內建每日筆記、範本、Bases 表格、關聯圖，不用裝外掛；教學資源最多 |
| VS Code | 免費 | 直接編輯資料夾 | 功能強但偏工程師 |
| Typora | 付費（買斷） | 單一 Markdown 檔編輯 | 好看好寫，但沒有知識庫功能 |
| 記事本／文字編輯 | 內建 | 純文字 | 證明你的資料沒被綁住：任何電腦都打得開 |

> 結論：**資料放在 Markdown 資料夾，檢視器先用 Obsidian**；哪天想換，資料夾帶走就好。

## C. 付費（本課程不需要）
Grok Automation、ChatGPT 付費方案、Gemini Pro 的 Scheduled Actions、n8n Cloud、Obsidian Sync 等：功能更完整，但不是學會「每日財經報告」與「商務秘書」的必要條件。
例外：要讓秘書處理**真實客戶信件**時，建議改用不會拿資料改進服務的付費方案，或公司已採購的 AI 方案（先跟 IT／法務確認）。

## 官網
- ChatGPT — https://chatgpt.com
- Google AI Studio — https://aistudio.google.com
- Apps Script — https://script.google.com
- CoinGecko API — https://www.coingecko.com/en/api
- Obsidian — https://obsidian.md
- Google 雲端硬碟電腦版 — https://www.google.com/drive/download/
