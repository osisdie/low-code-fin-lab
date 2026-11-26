# 範本 Google Sheet：「數據」與「報價表」分頁

範本 Sheet 用到的分頁：

| 分頁 | 誰會讀 | 用在 |
|---|---|---|
| **數據** | `Code.gs` | Stage 2–3 每日日報 |
| **報價表** | `Secretary.gs` | Stage 4 商務秘書（報價金額只從這裡算） |
| 日報紀錄 | `Code.gs` 自動建立 | 每天一列：日期、更新時間、更新方式（每日排程／手動寄送／手動更新）、各項數字與漲跌%、秘書待辦數量（新項目自動加欄）；同一天重跑會覆寫那一列 |
| 秘書紀錄 | `Secretary.gs` 自動建立 | 每處理一封信記一列：時間、客戶、意圖、主旨、報價合計、需人工確認、狀態、信件連結 |

> 學員通常不用自己建：講師提供的「建立副本」連結已經包含「數據」「報價表」與程式；兩個「紀錄」分頁第一次執行時自動產生，範本不用先建。這頁是給講師建範本、或想手動重建的人參考。

## 「數據」分頁

第 1 列是標題，之後每列一個追蹤項目。

| 欄 | 內容 | 說明 |
|----|------|------|
| A | 名稱 | 你想在報告看到的名字，例如「USD/TWD」 |
| B | 代碼 | GOOGLEFINANCE 用的代碼 |
| C | 現價 | `=IFERROR(GOOGLEFINANCE(B2,"price"),GOOGLEFINANCE(B2))`（匯率不接受 `"price"`，改用不帶屬性的寫法；股票不受影響） |
| D | 前一收盤 | `=IFERROR(GOOGLEFINANCE(B2,"closeyest"),"")` |
| E | 漲跌幅 % | `=IFERROR(GOOGLEFINANCE(B2,"changepct"),"")` |

## 為什麼 D、E 欄不用歷史資料公式
`GOOGLEFINANCE(代碼,"close",開始日,結束日)` 這類**歷史資料**只能在試算表畫面上看，Google 規定 Apps Script 讀到的會是 `#N/A`（引用它的儲存格也一樣）。所以 D、E 欄一律用即時屬性 `closeyest`（前一收盤）與 `changepct`（今日漲跌幅 %），程式才讀得到。

- 匯率（`CURRENCY:` 開頭）不提供 `closeyest`／`changepct`，D、E 欄會是空白，這是正常的：C 欄有現價，漲跌幅由程式向 Yahoo Finance 補（信裡來源欄寫「Google Finance；漲跌由 Yahoo USDTWD=X 補」）。其他項目有 C、D 兩欄時程式自己算漲跌幅；都拿不到就在信裡寫「查無資料」，不會亂補。
- 匯率在程式裡保留 4 位小數（例如 JPY/TWD 0.2134），其他項目保留 2 位。

## 建議的起始列（代碼需在你的 Sheet 實測，改名後以能出數字為準；查證日期 2026-11-24）
| 名稱 | 代碼 |
|------|------|
| USD/TWD | `CURRENCY:USDTWD` |
| JPY/TWD | `CURRENCY:JPYTWD` |
| EUR/USD | `CURRENCY:EURUSD` |
| S&P 500 | `INDEXSP:.INX` |
| Nasdaq | `INDEXNASDAQ:.IXIC` |
| Dow Jones | `INDEXDJX:.DJI` |
| NVDA | `NVDA` |
| MSFT | `MSFT` |
| 台積電 2330 | `TPE:2330` |
| 聯發科 2454 | `TPE:2454` |
| 台股加權指數 | `TPE:IX0001` |

> ⚠️ 以上代碼為依 Google Finance 命名慣例整理，**尚未在課堂用的範本逐一實測**；課堂前請講師實測並更新此表。

### 代碼查證紀錄（2026-11-24）
- **台股加權指數**：舊代碼 `INDEXTPE:TAIEX` 在彩排時顯示 `#N/A`，Google 財經網站上也已找不到這個代碼。Google 財經的加權指數頁面是 [`IX0001:TPE`](https://www.google.com/finance/quote/IX0001:TPE)，試算表寫成 `TPE:IX0001`（多個中文教學也用這個寫法）。指數類通常沒有 `closeyest`／`changepct` 以外的財務欄位，這是正常的。
- **匯率**：`CURRENCY:USDTWD`、`CURRENCY:JPYTWD`、`CURRENCY:EURUSD` 是一般通用的寫法，Google 財經網站上也有 [USD-TWD](https://www.google.com/finance/quote/USD-TWD)、[JPY-TWD](https://www.google.com/finance/quote/JPY-TWD)、[EUR-USD](https://www.google.com/finance/quote/EUR-USD) 頁面；2026-11-26 實測確認：`GOOGLEFINANCE` 不接受 `CURRENCY:` 代碼加上 `"price"` 屬性（會出現 `#N/A`，錯誤說明是 `parameter 2 value is invalid for the symbol specified`），不帶屬性的 `=GOOGLEFINANCE("CURRENCY:USDTWD")` 才出得來現價。所以 C 欄公式寫成 `=IFERROR(GOOGLEFINANCE(B2,"price"),GOOGLEFINANCE(B2))`：股票照樣用 `"price"`，匯率改用不帶屬性的寫法，C 欄就有數字。匯率的 D、E 欄（`closeyest`／`changepct`）還是拿不到、會是空白，**這是正常的**，漲跌幅由程式向 Yahoo 補（見下方「程式備援」）。另外請注意代碼中間**不能有斜線**（`USD/TWD` 一定 `#N/A`），也不要多空白。
- **程式備援**：`Code.gs` 讀到匯率或加權指數**有現價、沒有漲跌**時，保留 Google 的現價，只向 Yahoo Finance（`USDTWD=X`／`JPYTWD=X`／`EURUSD=X`、`^TWII`）補前一收盤與漲跌，來源欄寫「Google Finance；漲跌由 Yahoo … 補」。C 欄是 `#N/A`（例如還沒改公式的舊副本）時，現價和漲跌都改抓 Yahoo，來源欄寫「Google Finance 查無資料，改用備援」。其他代碼可加在 `Code.gs` 的 `YAHOO_FALLBACK`。Yahoo 端點是非官方的，備援也失敗時一樣寫「查無資料」，不會亂補數字。
> 黃金、美債殖利率、BTC 不在 Sheet 內：由 `Code.gs` 另外抓取（Google Finance 沒有現貨黃金）。
> `GOOGLEFINANCE` 資料可能延遲約 20 分鐘，且只能在 Sheet 儲存格中使用，不能在 Apps Script 內直接呼叫。

## A 欄名稱會變成知識庫的欄位名稱
日報存進 Obsidian 知識庫時，A 欄名稱會轉成 frontmatter 欄位與 `[[連結]]`：括號內文字去掉、空白和符號換成 `_`。
例如「USD/TWD」→ `USD_TWD`、「台積電 2330」→ `台積電_2330`。範例 vault 的 `日報總覽.base` 用的就是這兩個名稱，改名後請一併修改儀表板欄位。

## 「報價表」分頁

`Secretary.gs` 依客戶來信判讀出的品項名稱，到這裡查單價並計算小計、稅與合計。**AI 不會產生任何金額**；查不到的品項會標記「需人工確認」。

| 欄 | 內容 | 說明 |
|----|------|------|
| A | 品項 | 名稱要跟 AI 判讀的結果完全一致（AI 只能從這一欄挑選） |
| B | 單價 | 數字（新台幣，未稅） |
| C | 單位 | 例如「小時」「月」「式」 |
| D | 備註 | 給自己看的，程式不會用 |

範例資料（虛構公司「小島數位工作室」，金額皆為範本）：

| 品項 | 單價 | 單位 | 備註 |
|------|------|------|------|
| 品牌顧問諮詢（小時） | 3000 | 小時 | |
| 官網改版方案 | 120000 | 式 | 含 5 頁版型 |
| 社群貼文代操（月） | 18000 | 月 | 每月 12 篇 |
| 活動攝影（半天） | 8000 | 場 | 4 小時內 |
| 年度維護合約 | 36000 | 年 | |

> 營業稅率在 `Secretary.gs` 的 `TAX_RATE`（預設 5%），請依實際情況調整。
