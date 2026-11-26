# Apps Script：每日財經報告＋商務秘書

一份 Google Sheet 就是整個「AI 助理」：每天早上寄一封「今日總覽」（財經數字＋秘書待辦，版面任選）、每天記一列「日報紀錄」、把日報存進 Obsidian 知識庫，並幫你把客戶來信變成回覆草稿與報價單草稿。**全部免費，只需要一個 Google 帳號。** AI 摘要再加一把免費的 OpenRouter key（不用綁卡）；沒有 key、或把指令碼屬性 `AI_ENABLED` 設為 `false` 時，每日總覽仍會寄出原始數據，只是不會呼叫 AI。

| 檔案 | 做什麼 |
|---|---|
| `Code.gs` | 選單、一鍵設定、今日總覽（讀表 → 補抓 BTC／黃金 → AI（OpenRouter 免費模型）整理 → 加上秘書待辦 → 寄信 → 記「日報紀錄」→ 存成 Markdown） |
| `Templates.gs` | 今日總覽的三種信件版面：精簡／完整／表格（只排版，不產生數字） |
| `Vault.gs` | 在你的雲端硬碟建立 `FinLab-Vault`（Obsidian 知識庫）與起始檔案 |
| `Secretary.gs` | 商務秘書：讀「AI秘書」標籤的信 → Gmail 回覆**草稿**＋報價單草稿 `.md`＋「秘書紀錄」一列（不會寄出任何信） |
| `appsscript.json` | 時區（Asia/Taipei）與權限清單 |

## 路線一（主線）：講師的「建立副本」連結，不用碰程式

1. 用**個人 Gmail 帳號**登入 Google（公司 Workspace 帳號可能被管理員擋掉 Apps Script 或 Gmail 權限）。
2. 打開講師提供的連結（網址結尾是 `/copy`）→ 按 **建立副本**。你會得到一份自己的 Sheet，裡面已經有「數據」「報價表」分頁和全部程式。
3. 重新整理頁面，等幾秒，上方會出現選單 **📰 我的 AI 助理**。
4. 點 **① 一鍵設定（第一次用）**：
   - 跳出「需要授權」→ 選你的帳號。
   - 出現「**Google 尚未驗證這個應用程式**」→ 點 **進階** → **前往「…」（不安全）**。這是因為程式是你自己這份副本、沒有送 Google 審查，不是病毒；權限清單見下方說明。
   - 權限清單可以逐項勾選：**請全部勾選**（或按「全選」）再按 **允許**。少勾的話，程式會在用到時再跳一次授權。
   - 授權完如果沒有跳出貼 key 的對話框，**再點一次 ① 一鍵設定**（第一次點選單常常只會跳授權）。
   - 貼上 OpenRouter API key → 確定。還沒有 key、或想先只用原始數據的話，**這裡可以留空**：程式會關閉 AI 摘要，仍會建立知識庫資料夾。之後要開啟，再點一次 ① 貼上 key 即可。取得 key 的步驟見下方「[取得 OpenRouter key](#取得-openrouter-key免費不用綁卡)」。
   - 看到「設定完成 ✅」，雲端硬碟會多一個 `FinLab-Vault` 資料夾（含 `日報`、`秘書`、`筆記`、`標的`）。
5. 點 **② 立即寄一封今日總覽** → 到信箱看信，與 Google Finance／CoinGecko 網頁核對數字；試算表會多一個「日報紀錄」分頁。
   - 只想更新數字、不想收信時，點 **↻ 只更新數字與知識庫（不寄信）**：一樣會抓數字、寫「日報紀錄」、存日報 `.md`，只是不寄信。AI 開著的話，每按一次會用掉 1～2 次免費額度（以官網為準，查證日期 2026-11-24）；AI 摘要失敗（例如額度用完）時，今天的日報 `.md` 會被改寫成只有原始數據。
6. 點 **🎨 寄三種版面樣張給我** 比較，再用 **🎨 選擇信件版面** 選一種（預設「完整」）。
7. 點 **③ 開啟每日 07:00 自動寄送**（預設早上 7 點；想換時間見下方 `REPORT_HOUR`）。
8. （Stage 4）照 [`../secretary/sample-emails.md`](../secretary/sample-emails.md) 寄 3 封練習信給自己、貼上「AI秘書」標籤 → 點 **⑤ 秘書：處理「AI秘書」標籤的信**。

## 路線二（備援）：自己貼程式

講師連結失效，或想從空白開始時使用。

1. 建立新的 Google Sheet，依 [`../sheet-template/README.md`](../sheet-template/README.md) 建好 **數據** 與 **報價表** 分頁，確認「數據」C 欄出現數字，匯率也要有（C 欄公式是 `=IFERROR(GOOGLEFINANCE(B2,"price"),GOOGLEFINANCE(B2))`；匯率的 D、E 欄空白是正常的，漲跌由程式向 Yahoo 補）。
2. 選單 **擴充功能 → Apps Script**。把預設 `Code.gs` 換成本資料夾的 `Code.gs`；左側 **＋ → 指令碼** 新增 `Vault`、`Secretary`、`Templates` 三個檔案，貼上對應內容。
3. 左側 **專案設定（齒輪）→ 勾選「在編輯器中顯示『appsscript.json』資訊清單檔案」**，把內容換成本資料夾的 `appsscript.json`。
4. 存檔，回到 Sheet 重新整理，之後就跟路線一的第 3 步一樣。

> 想手動設定也可以：**專案設定 → 指令碼屬性**，新增 `OPENROUTER_API_KEY`。（選填）`AI_ENABLED` 設為 `false`（也接受 `off`／`0`／`no`）會關閉 AI 摘要，即使已經有 key 也不會呼叫 OpenRouter；每日總覽改寫「AI 摘要已關閉，以下為原始數據。」，秘書選單 ⑤⑥ 會跳出說明而不是失敗。不設這個屬性時：有 key 就開啟，沒有就關閉。（選填）`VAULT_SYMBOL_FOLDER` 是知識庫裡追蹤項目筆記的資料夾名稱，預設「標的」（股票、匯率、加密貨幣都放這裡）；改名後再跑一次「① 一鍵設定」會建立新資料夾，請自行把舊筆記移過去。若 vault 根目錄裡已經有舊連結（例如 `[[USD_TWD]]`）建出來的標的筆記，請自行移到 `標的/`（或你設定的 `VAULT_SYMBOL_FOLDER`）。（選填）`REPORT_TO` 是收件信箱，不填就寄給自己；（選填）`OPENROUTER_MODEL`／`OPENROUTER_FALLBACK_MODEL` 是主要／備用模型，不填就用 `Code.gs` 最上方 `AI_MODEL_PRIMARY`／`AI_MODEL_FALLBACK` 的預設值；`REPORT_TEMPLATE` 是版面（`compact`／`full`／`table`），用選單選比較方便。（選填）`REPORT_HOUR` 是每天幾點寄（0～23 的整數，台灣時間，例如 `6`），不填或填錯就用預設 7 點（`Code.gs` 的 `TRIGGER_HOUR`）；**改完要再點一次「③」才會換時間**，選單上的時間要重新整理試算表才會跟著變。建議設在早上 6～11 點（美股前一晚已收盤）：設在晚上 10 點到清晨 5 點，美股可能還在交易，數字會是盤中的；中午到晚上，「美股休市」的說明可能不準。

## 取得 OpenRouter key（免費，不用綁卡）

1. 打開 [openrouter.ai](https://openrouter.ai)，右上角 **Sign in** → 選 **Continue with Google**，用你的 Google 帳號登入。
2. 打開 [Keys 頁面](https://openrouter.ai/settings/keys)（右上角頭像 → **Keys**）→ 按 **Create**（或 Create API Key）。
3. 名稱隨意填（例如 `finlab`），額度上限（Credit limit）留空即可 → 建立。
4. 畫面上會出現一串 **`sk-or-` 開頭** 的 key，**只會顯示這一次**：按複製，直接貼進「① 一鍵設定」的對話框。不要貼到聊天室、表格或截圖。
5. 不用儲值、不用綁信用卡：本程式只用名稱結尾是 `:free` 的免費模型與 `openrouter/free`。

### 免費額度（以官網為準，查證日期 2026-11-24）

依 OpenRouter 官方 [Limits 文件](https://openrouter.ai/docs/api/reference/limits)，使用免費模型（ID 結尾是 `:free`）時：

| 帳號累計購買點數 | 每分鐘 | 每天 |
|---|---|---|
| 少於 10 美元（學員一般是這種） | 20 次 | 50 次 |
| 至少 10 美元 | 20 次 | 1000 次 |

- 每天的次數依 UTC 計算，也就是台灣時間每天早上 8 點重置。
- 日報預設早上 7 點寄，用的是**前一天（UTC）剩下的額度**：前一天如果把 50 次用完，7 點那封會沒有 AI 摘要，改寄原始數據；8 點過後按「② 立即寄一封」或「↻ 只更新」就會有。
- 多開帳號或多建 key 不會增加額度（官方說明額度是整體控管）。
- 本課程的用量：每天日報約 1～2 次（主要模型失敗才多 1 次；按「②」或「↻ 只更新」也一樣），一鍵設定測試 1 次，秘書每封信 2 次（每次最多 5 封）。正常練習遠低於每天 50 次；若同一天反覆按 ⑤ 或樣張，可能用完，隔天就恢復。
- 免費模型名單：[openrouter.ai/models?max_price=0](https://openrouter.ai/models?max_price=0)；`openrouter/free` 說明：[Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)。
- 如果出現「找不到可用的模型（404）」，可能是你在 OpenRouter [隱私設定](https://openrouter.ai/settings/privacy) 排除了會保留資料的提供者，導致沒有免費模型可用；調整設定或改用別的免費模型即可。

## 出錯了怎麼辦？

選單功能出錯時會跳出中文說明，同時在試算表多一個 **錯誤紀錄** 分頁（時間、在做什麼、錯誤訊息）。需要協助時，把那一列給講師看就好，不用打開程式編輯器。

## 這些權限是做什麼的？

| 權限（授權畫面的說法） | 為什麼需要 |
|---|---|
| 查看及管理這份試算表 | 讀「數據」「報價表」 |
| 以你的名義傳送電子郵件 | 寄日報給你自己（MailApp） |
| 讀取、撰寫、傳送及永久刪除 Gmail 郵件 | 秘書讀「AI秘書」標籤的信、換標籤、建立草稿。Apps Script 的 Gmail 功能（GmailApp）需要這個權限；**本程式不會寄出或刪除任何客戶信件**，原始碼就在 `Secretary.gs` 可以檢查 |
| 查看、編輯、建立及刪除你所有的 Google 雲端硬碟檔案 | 建立 `FinLab-Vault`、寫入日報與報價單。Apps Script 的雲端硬碟功能（DriveApp）建立資料夾與檔案一定要這個權限，沒辦法只要「本程式建立的檔案」；**本程式只會讀寫 `FinLab-Vault` 裡的檔案**，原始碼就在 `Vault.gs` 可以檢查 |
| 連線到外部服務 | 呼叫 OpenRouter（AI 摘要）、CoinGecko、Yahoo Finance |
| 在試算表中顯示提示與選單、管理觸發條件 | 一鍵設定的對話框、每天自動執行 |

不想用了：到 [Google 帳戶 → 安全性 → 第三方存取](https://myaccount.google.com/permissions) 移除這個專案的存取權，再刪掉這份 Sheet。

## 安全提醒
- 寄信與讀信都用你自己的 Google 帳號**授權**，**不需要、也不要輸入 Gmail 密碼**。
- key 只放在「指令碼屬性」（一鍵設定會幫你存）；不要貼進程式碼、表格、聊天室或截圖。key 外洩請到 [OpenRouter Keys 頁面](https://openrouter.ai/settings/keys) 刪除重建。
- 分享這份 Sheet 前要知道：拿到**編輯權**的人可以看到 Apps Script 與指令碼屬性。只分享「檢視」權限，或乾脆不分享。
- **信件與數據會經過 OpenRouter 送到免費模型的提供者，部分提供者可能保留或用輸入資料訓練模型**（依各提供者條款，以官網為準：[Provider Logging](https://openrouter.ai/docs/guides/privacy/provider-logging)）。OpenRouter 本身預設不儲存提示內容（[Data Collection](https://openrouter.ai/docs/guides/privacy/data-collection)）。秘書功能請用虛構信件練習；真實客戶信件與報價請改用付費且不訓練的方案，或保留人工處理。

## 已知限制
- 美股休市只能判斷週末，**無法自動判斷美國國定假日**；假日當天數字會是前一交易日，信中的「原始數據」可供核對。
- Yahoo Finance 圖表端點為非官方公開端點，可能變動或限流；失敗時該項目顯示「查無資料」。匯率的現價來自 Google Finance，漲跌幅由 Yahoo 補（Google 不提供匯率的前一收盤與漲跌）；Yahoo 失敗時匯率只有現價、漲跌寫「查無資料」。
- Yahoo 的漲跌只跟**緊接在前的那一個交易日**收盤比（股票週一就是跟週五比）。Yahoo 偶爾會缺前一天的收盤（2026-11-26 實測 BTC-USD 就缺了一天），這時漲跌寫「查無資料」、來源欄註明「前一日收盤缺資料」，不會拿更早一天來比。
- 比特幣先抓 CoinGecko；被限流（429）或暫時故障會等幾秒重試，還是不行就改用 Yahoo Finance `BTC-USD`（這時名稱改成「Bitcoin BTC/USD（與前一 UTC 日收盤比）」，不是 24 小時漲跌，來源欄會註明）。錯誤碼只寫進執行紀錄，不會放進給 AI 的資料，避免摘要把「429」當成數字。
- 摘要的【匯率】段落由 AI 撰寫；若漏寫「數據」分頁裡的某組匯率，程式會依原始數據自動補上那一行。
- OpenRouter 免費模型的名單與額度常常變動，以官網為準（查證日期 2026-11-24，見下方「免費額度」）。主要模型 `openrouter/free` 失敗（錯誤、空白回覆、每分鐘額度或上游忙碌的 429）會自動改用備用模型 `google/gemma-4-31b-it:free` 再試一次；每天的免費額度是整個帳號共用，用完時換模型也沒用，就不再重試；兩個都失敗時仍會寄出原始數據，信裡會用中文寫出原因，秘書則把該封信改貼「AI秘書/需人工」標籤。模型下架時，改 `Code.gs` 最上方的 `AI_MODEL_PRIMARY`／`AI_MODEL_FALLBACK` 即可。沒有 key、或 `AI_ENABLED` 為 `false` 時不會呼叫 OpenRouter，信裡改寫「AI 摘要已關閉，以下為原始數據。」，不會出現「尚未設定 OpenRouter key」。
- `openrouter/free` 每次可能挑到不同的免費模型，摘要的文筆會有差異；數字一律以信中「原始數據」為準，程式也會自動檢查摘要裡的數字。
- 時間觸發器會在指定的那個小時內執行，不一定剛好整點（預設 7 點，例如 07:00～07:59 之間）。觸發器建立時就記住了時間，改 `REPORT_HOUR` 後沒有重按「③」，還是舊的時間。
- 「日報紀錄」一天只有一列：同一天重跑（②、↻ 或排程）會覆寫那一列，「更新時間」「更新方式」（每日排程／手動寄送／手動更新）記的是最後一次。
- 雲端硬碟權限用完整的 `drive`：Apps Script 的 `DriveApp` 不接受只限本程式檔案的 `drive.file`（用了會在一鍵設定時出現權限錯誤）。
- 程式已通過語法檢查，Markdown／報價計算邏輯也已用 node 測試；**授權、寄信、Gmail 草稿、雲端硬碟寫入需講師用真實帳號課前實測**。

## 講師課前檢查清單

發出「建立副本」連結前，請用一個**全新的個人 Gmail**（沒有用過 Apps Script、沒有用過 OpenRouter）從頭走一次，這些項目沒辦法在本機測：

1. **清空範本的指令碼屬性**：範本 Sheet → 擴充功能 → Apps Script → 專案設定 → 指令碼屬性，刪掉 `OPENROUTER_API_KEY`、`AI_ENABLED`、`VAULT_ROOT_ID`、`VAULT_SYMBOL_FOLDER`、`REPORT_TO`、`OPENROUTER_MODEL`、`OPENROUTER_FALLBACK_MODEL`、`REPORT_TEMPLATE`、`REPORT_HOUR`（舊版留下的 `GEMINI_API_KEY`、`GEMINI_MODEL` 也一起刪）。副本會不會帶走這些值請以實測為準，先清空最保險，避免學員共用你的 key 和額度。
2. **刪掉範本的觸發器**（左側「觸發條件」），範本本身不要每天寄信。
3. 全新帳號打開 `/copy` 連結 → 建立副本 → 選單出現。
4. **① 一鍵設定**：授權畫面全部勾選；用新帳號建立的 key 測試成功；雲端硬碟出現 `FinLab-Vault`（確認 `drive` 權限可用）。
5. 故意在授權畫面少勾 Gmail，再點 ⑤，確認會再跳授權而不是直接失敗。
6. **② 立即寄一封**：信裡 Google Finance 項目的**漲跌幅有數字**（確認 `closeyest`／`changepct` 讀得到，不是「查無資料」）；範本「數據」分頁的 C 欄已換成 `=IFERROR(GOOGLEFINANCE(B2,"price"),GOOGLEFINANCE(B2))`、3 列匯率 C 欄都有數字；信裡匯率列有漲跌幅，來源欄寫「Google Finance；漲跌由 Yahoo … 補」。信件日期的星期是中文（例如「（週四）」），頁尾有「資料更新時間」。再按一次 **↻ 只更新數字與知識庫**：沒有收到新信，「日報紀錄」同一列的「更新時間」變新、「更新方式」是「手動更新」。
7. 信裡的 AI 摘要沒有出現「⚠️ 自動檢查」提醒；有的話看是哪個數字對不上。
8. **③ 開啟每日寄送** 與 **⑥ 秘書每小時處理**，隔天確認觸發器真的有跑（左側「執行作業」），「日報紀錄」的「更新方式」是「每日排程」。
9. Stage 4：寄 3 封練習信、貼標籤、按 ⑤；再把其中一封重新貼「AI秘書」按一次 ⑤，確認**不會重複建立草稿**。
10. 試算表沒有多出非預期的「錯誤紀錄」分頁；有的話照著錯誤訊息修正。
