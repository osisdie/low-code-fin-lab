/**
 * 知識庫（Obsidian vault）— 在你的 Google 雲端硬碟建立「FinLab-Vault」資料夾
 *
 * 這個資料夾就是一個 Obsidian vault：裡面全是純 Markdown 檔，
 * 用 Google 雲端硬碟電腦版同步到電腦後，Obsidian（或任何編輯器）都能直接打開。
 *
 * 一鍵設定（setupWizard）會呼叫 setupVault_()：
 *   - 建立 FinLab-Vault/日報、秘書、筆記、客戶、標的
 *     （「標的」資料夾名稱可用指令碼屬性 VAULT_SYMBOL_FOLDER 更改；股票、匯率、加密貨幣都放這裡）
 *   - 放入起始檔案（首頁、每日筆記與每週回顧範本、儀表板、Obsidian 每日筆記／範本／關聯圖設定、標的資料夾說明）
 *   已經存在的檔案不會被覆蓋，你自己改過的內容不會不見。
 *
 * 之後程式還會自動寫這些筆記（都不會蓋掉你自己寫的字）：
 *   - 標的/<代號>.md：追蹤項目第一次出現在日報時建立（ensureSymbolNotes_）
 *   - 客戶/<客戶>.md：秘書第一次處理這位客戶的信時建立（ensureCustomerNote_，在 Secretary.gs 呼叫）
 *   程式產生的段落夾在 GEN_START 與 GEN_END 兩行註解中間；只有這一段會被更新，其他地方是你的。
 *
 * STARTER_FILES 與 lab-assets/obsidian-vault/ 裡的同名檔案內容一致；修改請兩邊一起改。
 */

// 第一次建立時用的資料夾名稱；之後靠指令碼屬性 VAULT_ROOT_ID 記住的資料夾 ID 找回來（你改了資料夾名稱也找得到）
const VAULT_ROOT_NAME = 'FinLab-Vault';
const VAULT_SYMBOL_FOLDER_DEFAULT = '標的';
const VAULT_SYMBOL_FOLDER_PROP = 'VAULT_SYMBOL_FOLDER';
const VAULT_CUSTOMER_FOLDER = '客戶';
// 程式產生的段落用這兩行 HTML 註解夾起來（Obsidian 閱讀模式看不到註解）；只認開頭，後面的說明文字可以不同
const GEN_START = '<!-- 自動更新開始：這兩行之間由 Apps Script 產生，請不要在中間寫字 -->';
const GEN_END = '<!-- 自動更新結束 -->';
const GEN_START_PREFIX = '<!-- 自動更新開始';
const SYMBOL_TREND_DAYS = 14; // 標的筆記的「近期走勢」表格列出最近幾篇日報
const SYMBOL_CHART_DAYS = 30; // 標的筆記的走勢圖畫最近幾個日曆天（資料來自「日報紀錄」分頁）

/** 標的筆記資料夾名稱：指令碼屬性可改；空白或不合法（含路徑分隔或會弄壞 wikilink 的字元）就用預設「標的」 */
function vaultSymbolFolder_() {
  const raw = String(getProp_(VAULT_SYMBOL_FOLDER_PROP) || VAULT_SYMBOL_FOLDER_DEFAULT).trim();
  if (!raw || raw === '.' || raw === '..' || /[\\/:|\[\]#^]/.test(raw)) return VAULT_SYMBOL_FOLDER_DEFAULT;
  return raw;
}

/**
 * 標的的 wikilink：[[標的/USD_TWD|USD/TWD]]，新建筆記會落在標的資料夾而不是 vault 根目錄。
 * inTable 為 true 時（日報的原始數據表格）別名前的 | 要寫成 \|，否則會被當成欄位分隔。
 */
function symbolWikiLink_(it, inTable) {
  if (!it.key) return it.name;
  return '[[' + vaultSymbolFolder_() + '/' + it.key + (inTable === false ? '|' : '\\|') + it.name + ']]';
}

/** frontmatter 的文字值一律加雙引號；反斜線要跳脫、雙引號換成單引號、換行換成空白（避免弄壞 YAML） */
function yamlStr_(s) {
  return '"' + String(s === null || s === undefined ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, "'").replace(/[\r\n]+/g, ' ') + '"';
}

// 起始檔案清單：path 是相對於 FinLab-Vault 的路徑（可含子資料夾），content 是檔案內容；只在檔案不存在時建立
// 範本 frontmatter 裡的 {{date:…}} 一定要加雙引號：沒加引號的 {{ }} 在 YAML 是另一種語法，Obsidian 會說屬性不合法
const STARTER_FILES = [
  {
    path: '首頁.md',
    content: [
      '# 🏠 我的財經知識庫',
      '',
      '這個資料夾每天會自動多一篇日報（`日報/`），秘書處理過的每一封信都會留一篇紀錄（`秘書/`）。',
      '追蹤項目的筆記放在 `標的/`（第一次出現在日報時自動建立），客戶的往來紀錄放在 `客戶/`。',
      '全部都是純 Markdown 檔，換任何編輯器都打得開。',
      '',
      '## 待我處理的信',
      '',
      '![[秘書總覽.base#待我處理]]',
      '',
      '## 最近的日報',
      '',
      '![[日報總覽.base]]',
      '',
      '## 快速前往',
      '',
      '| 想做什麼 | 點這裡 |',
      '|---|---|',
      '| 看全部秘書紀錄（依狀態、依意圖、報價單） | [[秘書總覽.base\\|秘書總覽]] |',
      '| 看每個追蹤項目的走勢 | 打開 `標的/` 資料夾裡的任一篇（項目第一次出現在日報時自動建立） |',
      '| 寫今天的每日筆記 | 左側欄「📅 開啟今天的每日筆記」 |',
      '| 寫這週的回顧 | 在 `筆記/` 新增一篇（例如「2026-W48 每週回顧」）→ 命令面板「範本：插入範本」→ 選「每週回顧」 |',
      '',
      '## 每天怎麼用（3 分鐘）',
      '',
      '1. 點左側欄的「📅 開啟今天的每日筆記」（或命令面板搜尋「每日筆記」）。',
      '2. 筆記會帶出今天日報的「今日重點」和今天的秘書紀錄，在「我的觀察」寫一兩句自己的看法。',
      '3. 看上面「待我處理的信」：打開 Gmail 草稿確認、改好後自己寄出；有報價單就核對後把 `狀態` 改成「已確認」。',
      '4. 週末用「每週回顧」範本，把這 7 天的日報、秘書紀錄和自己的筆記放在一起看。',
      '',
      '> 本知識庫內容僅供學習與個人紀錄，不構成投資建議。',
      '',
    ].join('\n'),
  },
  {
    path: '範本/每日筆記.md',
    content: [
      '---',
      '類型: 每日筆記',
      '日期: "{{date:YYYY-MM-DD}}"',
      '---',
      '# {{date:YYYY-MM-DD}} 每日筆記',
      '',
      '完整日報：[[{{date:YYYY-MM-DD}} 財經日報]]',
      '',
      '## 今日重點（從日報帶進來）',
      '',
      '![[{{date:YYYY-MM-DD}} 財經日報#今日重點]]',
      '',
      '## 今天的秘書事項',
      '',
      '```base',
      'filters:',
      '  and:',
      '    - file.inFolder("秘書")',
      '    - 類型 == "秘書紀錄"',
      '    - file.name.startsWith(this.file.name)',
      'views:',
      '  - type: table',
      '    name: 今天處理的信',
      '    order:',
      '      - file.name',
      '      - 客戶',
      '      - 意圖',
      '      - 狀態',
      '      - 草稿',
      '```',
      '',
      '## 我的觀察（自己寫，不是 AI 寫）',
      '',
      '> 寫下你看到的，不用寫結論；不確定的地方就寫「不確定」。這裡是學習紀錄，不是買賣決定。',
      '',
      '- 今天哪個數字和我原本想的不一樣？我原本以為會怎樣？',
      '  - ',
      '- 這個變化可能和什麼新聞或事件有關？（查到來源再寫，附上連結）',
      '  - ',
      '- 我想記住的一件事：',
      '  - ',
      '',
      '## 今天要追的事',
      '',
      '- [ ] ',
      '',
    ].join('\n'),
  },
  {
    path: '範本/每週回顧.md',
    content: [
      '---',
      '類型: 每週回顧',
      '日期: "{{date:YYYY-MM-DD}}"',
      '週: "{{date:GGGG-[W]WW}}"',
      '---',
      '# {{date:GGGG-[W]WW}} 每週回顧',
      '',
      '> 「這週」＝上方 `日期` 往前算 7 天（含當天）。想回顧別週，把 `日期` 改成那週的最後一天，下面的表格會自動換。',
      '',
      '## 這 7 天的日報',
      '',
      '```base',
      'filters:',
      '  and:',
      '    - file.inFolder("日報")',
      '    - date(日期) > date(this.日期) - "7d"',
      '    - date(日期) <= date(this.日期)',
      'views:',
      '  - type: table',
      '    name: 這 7 天的日報',
      '    order:',
      '      - file.name',
      '      - 美股開盤',
      '      - USD_TWD',
      '      - USD_TWD_漲跌',
      '      - 台積電_2330',
      '      - 台積電_2330_漲跌',
      '      - BTC',
      '      - BTC_漲跌',
      '      - 待確認草稿',
      '    sort:',
      '      - property: 日期',
      '        direction: ASC',
      '```',
      '',
      '## 這 7 天的秘書紀錄',
      '',
      '```base',
      'filters:',
      '  and:',
      '    - file.inFolder("秘書")',
      '    - 類型 == "秘書紀錄"',
      '    - date(日期) > date(this.日期) - "7d"',
      '    - date(日期) <= date(this.日期)',
      'views:',
      '  - type: table',
      '    name: 這 7 天的信',
      '    groupBy:',
      '      property: 狀態',
      '      direction: ASC',
      '    order:',
      '      - file.name',
      '      - 客戶',
      '      - 意圖',
      '      - 狀態',
      '```',
      '',
      '## 這 7 天的每日筆記',
      '',
      '```base',
      'filters:',
      '  and:',
      '    - file.inFolder("筆記")',
      '    - 類型 == "每日筆記"',
      '    - date(日期) > date(this.日期) - "7d"',
      '    - date(日期) <= date(this.日期)',
      'views:',
      '  - type: table',
      '    name: 這 7 天的筆記',
      '    order:',
      '      - file.name',
      '    sort:',
      '      - property: 日期',
      '        direction: ASC',
      '```',
      '',
      '## 回顧一下（自己寫，不是 AI 寫）',
      '',
      '> 只寫觀察和感想，不寫買賣決定。數字請以日報裡的表格為準。',
      '',
      '- 這週哪一個項目的變化最讓我意外？我當時在每日筆記怎麼寫？',
      '  - ',
      '- 有沒有哪件事我原本以為會發生，結果沒有？',
      '  - ',
      '- 秘書這週處理了哪些信？有沒有哪一封應該早點回？',
      '  - ',
      '- 這週學到的一個新名詞或觀念：',
      '  - ',
      '- 下週想多留意哪個項目？為什麼？',
      '  - ',
      '',
      '> 本筆記是個人學習紀錄，不構成投資建議。',
      '',
    ].join('\n'),
  },
  {
    path: '日報總覽.base',
    content: [
      'filters:',
      '  and:',
      '    - file.inFolder("日報")',
      'views:',
      '  - type: table',
      '    name: 最近日報',
      '    order:',
      '      - file.name',
      '      - USD_TWD',
      '      - 台積電_2330',
      '      - 台積電_2330_漲跌',
      '      - BTC',
      '      - 黃金',
      '      - 待確認草稿',
      '    sort:',
      '      - property: 日期',
      '        direction: DESC',
      '    limit: 14',
      '',
    ].join('\n'),
  },
  {
    // 狀態的名稱與 Secretary.gs 的 SECRETARY_STATUS 一致；改名要兩邊一起改
    path: '秘書總覽.base',
    content: [
      'filters:',
      '  and:',
      '    - file.inFolder("秘書")',
      'views:',
      '  - type: table',
      '    name: 待我處理',
      '    filters:',
      '      and:',
      '        - 類型 == "秘書紀錄"',
      '        - or:',
      '            - 狀態 == "待確認草稿"',
      '            - 狀態 == "需人工"',
      '    order:',
      '      - file.name',
      '      - 日期',
      '      - 客戶',
      '      - 意圖',
      '      - 狀態',
      '      - 草稿',
      '      - 報價單',
      '    sort:',
      '      - property: 日期',
      '        direction: DESC',
      '  - type: table',
      '    name: 依狀態',
      '    filters:',
      '      and:',
      '        - 類型 == "秘書紀錄"',
      '    groupBy:',
      '      property: 狀態',
      '      direction: ASC',
      '    order:',
      '      - file.name',
      '      - 日期',
      '      - 客戶',
      '      - 意圖',
      '      - 草稿',
      '    sort:',
      '      - property: 日期',
      '        direction: DESC',
      '  - type: table',
      '    name: 依意圖',
      '    filters:',
      '      and:',
      '        - 類型 == "秘書紀錄"',
      '    groupBy:',
      '      property: 意圖',
      '      direction: ASC',
      '    order:',
      '      - file.name',
      '      - 日期',
      '      - 客戶',
      '      - 狀態',
      '    sort:',
      '      - property: 日期',
      '        direction: DESC',
      '  - type: table',
      '    name: 報價單草稿',
      '    filters:',
      '      and:',
      '        - 類型 == "報價單草稿"',
      '    order:',
      '      - file.name',
      '      - 客戶',
      '      - 日期',
      '      - 合計',
      '      - 狀態',
      '    sort:',
      '      - property: 日期',
      '        direction: DESC',
      '',
    ].join('\n'),
  },
  {
    path: '.obsidian/daily-notes.json',
    content: '{\n  "folder": "筆記",\n  "format": "YYYY-MM-DD",\n  "template": "範本/每日筆記"\n}\n',
  },
  {
    path: '.obsidian/templates.json',
    content: '{\n  "folder": "範本"\n}\n',
  },
  {
    // 關聯圖不顯示範本資料夾（範本裡的 {{date}} 連結會變成灰色空節點）
    path: '.obsidian/graph.json',
    content: '{\n  "search": "-path:範本"\n}\n',
  },
];

/** 建立（或找回）FinLab-Vault，並放入起始檔案；回傳根資料夾 */
function setupVault_() {
  const root = getVaultRoot_();
  const symbolFolder = vaultSymbolFolder_();
  ['日報', '秘書', '筆記', VAULT_CUSTOMER_FOLDER, symbolFolder].forEach(function (name) { getSubFolder_(root, name); });
  STARTER_FILES.forEach(function (f) {
    const parts = f.path.split('/');
    const fileName = parts.pop();
    const folder = parts.reduce(getSubFolder_, root);
    // 安全：同名檔案已經存在就跳過，不會覆蓋你改過的內容
    if (!folder.getFilesByName(fileName).hasNext()) folder.createFile(fileName, f.content, 'text/plain');
  });
  const symbolDir = getSubFolder_(root, symbolFolder);
  if (!symbolDir.getFilesByName('說明.md').hasNext()) {
    symbolDir.createFile('說明.md', symbolFolderReadme_(symbolFolder), 'text/plain');
  }
  return root;
}

/** 標的資料夾的說明.md（與 lab-assets/obsidian-vault/標的/說明.md 一致，標題跟著資料夾名稱） */
function symbolFolderReadme_(symbolFolder) {
  return [
    '# ' + symbolFolder,
    '',
    '這個資料夾放每個追蹤項目的筆記，股票、匯率、加密貨幣都可以。',
    '',
    '- 項目**第一次出現在日報**時，程式會自動建立一篇（例如 `USD_TWD.md`），裡面有欄位說明和「近期走勢」表格。',
    '- 「我為什麼追蹤它」「觀察紀錄」是留給你自己寫的，程式不會改。',
    '- 筆記裡夾在「自動更新開始／結束」兩行註解中間的段落由程式產生，請不要在中間寫字。',
    '- 你已經自己寫過的筆記（沒有那兩行註解），程式一律不碰。',
    '',
  ].join('\n');
}

/** 把內容寫進 FinLab-Vault/<subFolder>/<fileName>；同名檔已存在就覆寫（同一天重跑不會重複） */
function writeVaultFile_(subFolder, fileName, content) {
  // 一定從 FinLab-Vault 根資料夾往下找，不會寫到雲端硬碟的其他地方
  const folder = getSubFolder_(getVaultRoot_(), subFolder);
  const existing = folder.getFilesByName(fileName);
  if (existing.hasNext()) existing.next().setContent(content);
  else folder.createFile(fileName, content, 'text/plain');
}

/** 讀 FinLab-Vault/<subFolder>/<fileName> 的內容；檔案不存在回傳 null（不會建立資料夾以外的東西） */
function readVaultFile_(subFolder, fileName) {
  const it = getSubFolder_(getVaultRoot_(), subFolder).getFilesByName(fileName);
  if (!it.hasNext()) return null;
  const file = it.next();
  return { file: file, content: file.getSize() ? file.getBlob().getDataAsString('UTF-8') : '' };
}

/**
 * 把一段文字依 GEN_START／GEN_END 切成 { before, block, after }；沒有這兩行（或順序不對）回傳 null。
 * block 不含那兩行本身。
 */
function splitGenerated_(content) {
  const s = String(content);
  const a = s.indexOf(GEN_START_PREFIX);
  if (a === -1) return null;
  const aEnd = s.indexOf('\n', a);
  const b = s.indexOf(GEN_END, aEnd === -1 ? a : aEnd);
  if (aEnd === -1 || b === -1) return null;
  return { before: s.slice(0, a), block: s.slice(aEnd + 1, b), after: s.slice(b + GEN_END.length) };
}

/**
 * 建立或更新一篇「有程式產生段落」的筆記，絕不蓋掉使用者自己寫的字：
 *   - 檔案不存在、或是 0 位元組／只有空白（在 Obsidian 點連結建出來的空白筆記）→ 寫入完整內容 full
 *   - 檔案有 GEN_START／GEN_END → 只換掉中間那一段（block），前後原樣保留；內容一樣就不寫（省雲端硬碟寫入）
 *   - 檔案有內容但沒有那兩行（使用者自己寫的筆記）→ 不動
 * createOnly 為 true 時（例如今天的「日報紀錄」沒寫成功、走勢圖資料不完整）：只建新檔、補空白檔，已經有內容的一律不動。
 * 回傳 'created'｜'filled'｜'updated'｜'unchanged'｜'skipped'
 */
function upsertGeneratedNote_(subFolder, fileName, full, block, createOnly) {
  const cur = readVaultFile_(subFolder, fileName);
  if (!cur) {
    writeVaultFile_(subFolder, fileName, full);
    return 'created';
  }
  if (!cur.content.trim()) {
    cur.file.setContent(full);
    return 'filled';
  }
  if (createOnly) return 'skipped';
  const parts = splitGenerated_(cur.content);
  if (!parts) return 'skipped';
  if (parts.block === block) return 'unchanged';
  cur.file.setContent(parts.before + GEN_START + '\n' + block + GEN_END + parts.after);
  return 'updated';
}

// ============ 標的筆記（追蹤項目第一次出現在日報時自動建立）============

// 每個分類的白話說明（放在標的筆記的「這些欄位是什麼意思」）
const SYMBOL_CATEGORY_NOTES = {
  '匯率': '匯率的數字是「1 單位前面的貨幣可以換多少後面的貨幣」。例如 USD/TWD 32.5＝1 美元換 32.5 新台幣；數字往上＝前面的貨幣變貴（後面的貨幣貶值）。',
  '指數': '指數是一籃子股票的綜合表現，用「點數」表示；漲跌 % 是和前一個交易日收盤相比。休市的日子會沿用前一個收盤。',
  '個股': '個股的數字是一家公司的股價。台股 13:30 收盤，早上的日報是前一交易日的收盤；美股看的是前一晚的收盤。',
  '商品': '商品（例如黃金）用的是期貨價格，和新聞常說的現貨價格會有些微差距。',
  '加密貨幣': '加密貨幣 24 小時交易、沒有收盤：CoinGecko 的漲跌是「過去 24 小時」；改用 Yahoo 備援時是「與前一個 UTC 日收盤相比」，名稱會註明。',
  '債券': '債券這裡看的是殖利率（單位 %）。漲跌 % 是「殖利率本身的變化比例」，不是「幾個百分點」，閱讀時要留意。',
  '其他': '程式看不出這個代碼屬於哪一類，請自己把上方的 `分類` 改成正確的分類，並在下面補上說明。',
};

/**
 * 依代碼判斷分類（只看代碼的固定格式，認不出來就寫「其他」，不亂猜）：
 *   CURRENCY:USDTWD → 匯率；BTC、ETH-USD → 加密貨幣；^TNX 這類美債殖利率 → 債券；GC=F 這類期貨 → 商品；
 *   INDEX…、^GSPC、TPE:IX0001 → 指數；TPE:2330、NASDAQ:NVDA、NVDA → 個股；TPE:0050 這種 ETF → 其他
 */
function symbolCategory_(it) {
  const sym = String(it.symbol || '').trim().toUpperCase();
  if (/^CURRENCY:/.test(sym)) return '匯率';
  if (it.key === 'BTC' || /^(BTC|ETH|SOL|XRP|DOGE)(-USD)?$/.test(sym)) return '加密貨幣';
  if (/^\^(TNX|TYX|FVX|IRX)$/.test(sym)) return '債券';
  if (/=F$/.test(sym)) return '商品';
  if (/^INDEX/.test(sym) || /^\^/.test(sym) || /^TPE:IX\d+$/.test(sym)) return '指數';
  if (/^(TPE|TWO):00\d{2,4}[A-Z]?$/.test(sym)) return '其他';
  if (/^(TPE|TWO):\d{4}$/.test(sym)) return '個股';
  if (/^(NASDAQ|NYSE|NYSEAMERICAN|HKG|TYO):[A-Z0-9.]{1,6}$/.test(sym) || /^[A-Z]{1,5}(\.[A-Z])?$/.test(sym)) return '個股';
  return '其他';
}

/** 資料來源（依程式抓數字的固定路線寫，不看當天有沒有改用備援） */
function symbolSourceLabel_(it) {
  if (it.key === 'BTC') return 'CoinGecko 公開端點（抓不到時改用 Yahoo Finance BTC-USD）';
  const yahoo = YAHOO_ITEMS.filter(function (y) { return y.key === it.key; })[0];
  if (yahoo) return 'Yahoo Finance 公開端點（' + yahoo.symbol + '，非官方）';
  return 'Google Finance（試算表「數據」分頁 ' + it.symbol + '）' + (yahooSymbolFor_(it.symbol) ? '；缺資料時改用 Yahoo Finance ' + yahooSymbolFor_(it.symbol) : '');
}

/**
 * 走勢圖（Obsidian 內建的 Mermaid xychart-beta 折線圖，不用裝外掛）：
 * 數字全部來自「日報紀錄」分頁（history，由 readDailyLogHistory_ 讀出，舊到新），由程式整理，不經過 AI。
 *   - 範圍：最新一篇日報往前 SYMBOL_CHART_DAYS 個日曆天；資料還不夠 30 天時，標題照實寫「目前有 N 天資料」
 *   - 查無資料（空白）的日子不畫
 *   - 休市沿用前一天的日子不重複畫：數字和漲跌 % 都跟前一個畫出的點一模一樣，就當成沒有新數字
 *     （股票、匯率的週末與國定假日；比特幣每天交易，不會被略過）
 *   - 說明文字寫出實際畫了哪幾天、略過幾天
 *   - 可以畫的日子少於 2 天就不畫圖，只寫一句說明
 *   - x 軸每一點只寫「日」（例如 03），第一點和換月份的那一點寫「月-日」（例如 10-28、11-03），字才不會擠在一起；
 *     30 天內不會重複。Mermaid 的 xychart 沒有斜放標籤的設定（2026-11-26 查 Obsidian 1.14.4 內建版本），所以改用小一點的字
 *   - y 軸範圍是最小值～最大值各留約 2%；標題是項目名稱；只放數字，不加任何解讀
 */
function symbolChartMarkdown_(it, history) {
  const all = history || [];
  const last = all.length ? all[all.length - 1].date : '';
  const cutoff = last ? isoAddDays_(last, -(SYMBOL_CHART_DAYS - 1)) : '';
  const rows = all.filter(function (r) { return r.date >= cutoff; });
  const chg = it.key + '_漲跌%';
  let missing = 0;
  let stale = 0;
  const pts = [];
  rows.forEach(function (r) {
    const v = r.values[it.key];
    if (!isNum_(v)) { missing++; return; }
    const prev = pts[pts.length - 1];
    if (prev && prev.v === v && prev.c === r.values[chg]) { stale++; return; }
    pts.push({ date: r.date, v: v, c: r.values[chg] });
  });
  const span = rows.length && rows[0].date > cutoff ? '目前有 ' + rows.length + ' 天資料' : '最近 ' + SYMBOL_CHART_DAYS + ' 天';
  const head = ['## 走勢圖（' + span + '）', ''];
  if (pts.length < 2) {
    return head.concat(['> 「日報紀錄」裡可以畫的資料還不到 2 天，先不畫圖；之後每天會自動更新。', '']).join('\n');
  }
  const vals = pts.map(function (p) { return p.v; });
  const lo = Math.min.apply(null, vals);
  const hi = Math.max.apply(null, vals);
  // 小數位數跟著數字大小（匯率 0.2 要 4 位，指數 3 萬取整數）
  const mag = Math.floor(Math.log(Math.max(Math.abs(hi), Math.abs(lo), 1e-9)) / Math.LN10);
  const digits = Math.min(6, Math.max(0, 3 - mag));
  const yMin = roundTo_(lo * (lo >= 0 ? 0.98 : 1.02), digits);
  const yMax = roundTo_(hi * (hi >= 0 ? 1.02 : 0.98), digits);
  const labels = chartDateLabels_(pts.map(function (p) { return p.date; }));
  const notes = [];
  if (stale) notes.push(stale + ' 天休市沿用前一天的數字，沒有重複畫');
  if (missing) notes.push(missing + ' 天查無資料，沒有畫進去');
  return head.concat([
    '```mermaid',
    // 線條顏色：預設主題的線太淡，改成深藍（只改顏色，不影響數字）
    '%%{init: {"xyChart": {"xAxis": {"labelFontSize": 10}}, "themeVariables": {"xyChart": {"plotColorPalette": "#2f5f9e"}}}}%%',
    'xychart-beta',
    '    title "' + String(it.name).replace(/"/g, "'") + '"',
    '    x-axis "日期" [' + labels.map(function (l) { return '"' + l + '"'; }).join(', ') + ']',
    '    y-axis "數字" ' + yMin + ' --> ' + yMax,
    '    line [' + vals.join(', ') + ']',
    '```',
    '',
    '> 圖的數字來自試算表「日報紀錄」分頁：' + pts[0].date + '～' + pts[pts.length - 1].date + '，畫了 ' + pts.length + ' 天' +
      (notes.length ? '；' + notes.join('；') : '') + '。第一次出現「Display Mermaid diagrams in this vault?」時按 Allow 才會顯示圖；看不到圖時，請看下面的表格。',
    '',
  ]).join('\n');
}

/** 走勢圖 x 軸的字：['2026-10-28', '2026-10-29', '2026-11-03'] → ['10-28', '29', '11-03']（第一點與換月份寫月-日，其他只寫日） */
function chartDateLabels_(dates) {
  return dates.map(function (iso, i) {
    return i === 0 || iso.slice(5, 7) !== dates[i - 1].slice(5, 7) ? iso.slice(5) : iso.slice(8);
  });
}

/** 標的筆記裡程式產生的那一段：欄位說明＋走勢圖（Mermaid，每天更新）＋近期走勢表格（Obsidian Bases，自動多一列） */
function symbolNoteBlock_(it, category, history) {
  const q = function (k) { return '"' + k + '"'; };
  return [
    '> 這篇筆記是程式在「' + mdInline_(it.name) + '」第一次出現在日報時自動建立的。分類由程式依代碼判斷，不對可以直接改上方的 `分類`。',
    '',
    '## 這些欄位是什麼意思',
    '',
    '- **數字**：最近一次抓到的價格、點數或殖利率。',
    '- **漲跌 %**：和前一個收盤相比的百分比；📈 是漲、📉 是跌。',
    '- 查無資料的日子留空，程式不會自己補數字。',
    '- ' + SYMBOL_CATEGORY_NOTES[category],
    '',
    symbolChartMarkdown_(it, history),
    '## 近期走勢（最近 ' + SYMBOL_TREND_DAYS + ' 篇日報）',
    '',
    '```base',
    'filters:',
    '  and:',
    '    - file.inFolder("日報")',
    'properties:',
    '  file.name:',
    '    displayName: 日報',
    '  note.' + it.key + ':',
    '    displayName: 數字',
    '  note.' + it.key + '_漲跌:',
    '    displayName: 漲跌 %',
    'views:',
    '  - type: table',
    '    name: 近期走勢',
    '    order:',
    '      - file.name',
    '      - ' + q(it.key),
    '      - ' + q(it.key + '_漲跌'),
    '    sort:',
    '      - property: 日期',
    '        direction: DESC',
    '    limit: ' + SYMBOL_TREND_DAYS,
    '```',
    '',
    '> 表格用 Obsidian 內建的「Bases」（1.9 以上），數字直接讀每篇日報上方的欄位；點日期就能打開那天的日報。',
    '',
  ].join('\n');
}

/** 一篇完整的標的筆記：frontmatter、標題、程式產生的段落、留給自己寫的段落 */
function symbolNoteContent_(it, history) {
  const category = symbolCategory_(it);
  const block = symbolNoteBlock_(it, category, history);
  const full = [
    '---',
    '類型: 標的',
    '名稱: ' + yamlStr_(it.name),
    '代碼: ' + yamlStr_(it.symbol),
    '分類: ' + category,
    '資料來源: ' + yamlStr_(symbolSourceLabel_(it)),
    '---',
    '# ' + mdInline_(it.name),
    '',
    GEN_START,
    block + GEN_END,
    '',
    '## 我為什麼追蹤它（自己寫）',
    '',
    '- ',
    '',
    '## 觀察紀錄',
    '',
    '- 日期：看到什麼、想到什麼（只寫觀察，不寫買賣決定）',
    '',
    '> 想看它出現在哪幾天的日報：打開右側欄的「反向連結（Backlinks）」。本筆記僅供學習紀錄，不構成投資建議。',
    '',
  ].join('\n');
  return { full: full, block: block };
}

/**
 * 日報裡每個有 key 的項目，都確保有一篇 標的/<key>.md（資料夾跟著 VAULT_SYMBOL_FOLDER）。
 * history 是「日報紀錄」最近幾天的數字（畫走勢圖用，可省略）。
 * 已經有你自己寫的內容就不動；只換掉程式產生的那一段（走勢圖每天會變，所以每天寫一次；內容一樣就不寫）。
 * createOnly 為 true（今天的「日報紀錄」沒寫成功）：已經存在的標的筆記不動，免得走勢圖被換成「資料不足」；只建新的。
 * 回傳 { created, updated, skipped } 數量。
 */
function ensureSymbolNotes_(items, history, createOnly) {
  const folder = vaultSymbolFolder_();
  const count = { created: 0, updated: 0, skipped: 0 };
  const seen = {};
  items.forEach(function (it) {
    if (!it.key || seen[it.key]) return; // 同名（同 key）的項目只建一篇
    seen[it.key] = true;
    const note = symbolNoteContent_(it, history);
    const r = upsertGeneratedNote_(folder, it.key + '.md', note.full, note.block, createOnly);
    if (r === 'created' || r === 'filled') count.created++;
    else if (r === 'updated') count.updated++;
    else if (r === 'skipped') count.skipped++;
  });
  return count;
}

// ============ 客戶筆記（秘書第一次處理這位客戶的信時建立）============

/** 客戶筆記的檔名（不含 .md）：「星河咖啡 陳小姐」→「星河咖啡_陳小姐」；先經過 sanitizeCustomer_，檔名絕不含信箱 */
function customerNoteKey_(customer) {
  return noteKey_(sanitizeCustomer_(customer) || UNSIGNED_CUSTOMER) || UNSIGNED_CUSTOMER;
}

/** 客戶筆記裡程式產生的那一段：用 Bases 列出「秘書」資料夾裡同一位客戶的紀錄與報價單（客戶 == this.客戶） */
function customerNoteBlock_() {
  return [
    '> 秘書第一次處理這位客戶的信時自動建立。下面的表格會自動列出「秘書」資料夾裡同一位客戶的每一封信和報價單草稿。',
    '',
    '## 往來紀錄',
    '',
    '```base',
    'filters:',
    '  and:',
    '    - file.inFolder("秘書")',
    '    - 客戶 == this.客戶',
    'views:',
    '  - type: table',
    '    name: 往來紀錄',
    '    order:',
    '      - file.name',
    '      - 日期',
    '      - 類型',
    '      - 意圖',
    '      - 狀態',
    '      - 草稿',
    '    sort:',
    '      - property: 日期',
    '        direction: DESC',
    '```',
    '',
  ].join('\n');
}

/** 確保有 客戶/<客戶>.md；已經存在就只更新程式產生的那一段（通常一樣，不會寫入）。回傳筆記名稱（不含 .md） */
function ensureCustomerNote_(customer) {
  const name = sanitizeCustomer_(customer) || UNSIGNED_CUSTOMER;
  const key = customerNoteKey_(name);
  const block = customerNoteBlock_();
  const full = [
    '---',
    '類型: 客戶',
    '客戶: ' + yamlStr_(name),
    '---',
    '# ' + mdInline_(name),
    '',
    GEN_START,
    block + GEN_END,
    '',
    '## 聯絡窗口與備註（自己寫）',
    '',
    '- ',
    '',
    '> 只記工作需要的資訊。真實客戶的個資請小心保管，不要送進免費 AI 模型。',
    '',
  ].join('\n');
  upsertGeneratedNote_(VAULT_CUSTOMER_FOLDER, key + '.md', full, block);
  return key;
}

// ============ 日報的前一天／後一天連結 ============

// 今天的日報先寫這句；明天的日報產生時，程式把它換成「後一天 →」的連結
const NAV_NEXT_PENDING = '後一天（明天的日報產生後會自動補上）';
const NAV_LOOKBACK_DAYS = 7; // 往前找幾天內最近的一篇日報（中間停過幾天也找得到）

/** 'yyyy-MM-dd' 加減幾天（純日期計算，不受時區影響） */
function isoAddDays_(iso, n) {
  const p = String(iso).split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n, 12));
  const pad = function (x) { return (x < 10 ? '0' : '') + x; };
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/** 往前 NAV_LOOKBACK_DAYS 天內最近一篇日報的日期；找不到回傳空字串 */
function findPrevReportDate_(isoDate) {
  const folder = getSubFolder_(getVaultRoot_(), '日報');
  for (let i = 1; i <= NAV_LOOKBACK_DAYS; i++) {
    const d = isoAddDays_(isoDate, -i);
    if (folder.getFilesByName(d + ' 財經日報.md').hasNext()) return d;
  }
  return '';
}

/** 把前一篇日報的「後一天（…自動補上）」換成連到今天的連結；已經換過（或被你改掉）就不寫 */
function linkPrevReport_(prevDate, isoDate) {
  if (!prevDate) return false;
  const cur = readVaultFile_('日報', prevDate + ' 財經日報.md');
  if (!cur || cur.content.indexOf(NAV_NEXT_PENDING) === -1) return false;
  cur.file.setContent(cur.content.replace(NAV_NEXT_PENDING, '[[日報/' + isoDate + ' 財經日報|後一天 →]]'));
  return true;
}

// ============ 雲端硬碟 ============

/** 資料夾 ID 記在指令碼屬性 VAULT_ROOT_ID；找不到（被刪掉或第一次用）就重新建立 */
function getVaultRoot_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('VAULT_ROOT_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) {
      // 資料夾不存在或沒有權限，往下重新建立
    }
  }
  const root = DriveApp.createFolder(VAULT_ROOT_NAME);
  props.setProperty('VAULT_ROOT_ID', root.getId());
  return root;
}

/** 在 parent 底下找同名子資料夾，沒有才建立（重跑不會多建一個同名資料夾） */
function getSubFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
