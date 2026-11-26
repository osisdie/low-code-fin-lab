/**
 * 知識庫（Obsidian vault）— 在你的 Google 雲端硬碟建立「FinLab-Vault」資料夾
 *
 * 這個資料夾就是一個 Obsidian vault：裡面全是純 Markdown 檔，
 * 用 Google 雲端硬碟電腦版同步到電腦後，Obsidian（或任何編輯器）都能直接打開。
 *
 * 一鍵設定（setupWizard）會呼叫 setupVault_()：
 *   - 建立 FinLab-Vault/日報、FinLab-Vault/秘書、FinLab-Vault/筆記、FinLab-Vault/標的
 *     （「標的」資料夾名稱可用指令碼屬性 VAULT_SYMBOL_FOLDER 更改；股票、匯率、加密貨幣都放這裡）
 *   - 放入起始檔案（首頁、每日筆記範本、儀表板、Obsidian 每日筆記／範本／關聯圖設定、標的資料夾說明）
 *   已經存在的檔案不會被覆蓋，你自己改過的內容不會不見。
 *
 * STARTER_FILES 與 lab-assets/obsidian-vault/ 裡的同名檔案內容一致；修改請兩邊一起改。
 */

// 第一次建立時用的資料夾名稱；之後靠指令碼屬性 VAULT_ROOT_ID 記住的資料夾 ID 找回來（你改了資料夾名稱也找得到）
const VAULT_ROOT_NAME = 'FinLab-Vault';
const VAULT_SYMBOL_FOLDER_DEFAULT = '標的';
const VAULT_SYMBOL_FOLDER_PROP = 'VAULT_SYMBOL_FOLDER';

/** 標的筆記資料夾名稱：指令碼屬性可改；空白或不合法（含路徑分隔或會弄壞 wikilink 的字元）就用預設「標的」 */
function vaultSymbolFolder_() {
  const raw = String(getProp_(VAULT_SYMBOL_FOLDER_PROP) || VAULT_SYMBOL_FOLDER_DEFAULT).trim();
  if (!raw || raw === '.' || raw === '..' || /[\\/:|\[\]#^]/.test(raw)) return VAULT_SYMBOL_FOLDER_DEFAULT;
  return raw;
}

/** 日報表格用的 wikilink：[[標的/USD_TWD\|USD/TWD]]，新建筆記就會落在標的資料夾而不是 vault 根目錄 */
function symbolWikiLink_(it) {
  if (!it.key) return it.name;
  return '[[' + vaultSymbolFolder_() + '/' + it.key + '\\|' + it.name + ']]';
}

// 起始檔案清單：path 是相對於 FinLab-Vault 的路徑（可含子資料夾），content 是檔案內容；只在檔案不存在時建立
const STARTER_FILES = [
  {
    path: '首頁.md',
    content: [
      '# 🏠 我的財經知識庫',
      '',
      '這個資料夾每天會自動多一篇日報（`日報/`），秘書處理過的報價單草稿放在 `秘書/`。',
      '追蹤項目的筆記放在 `標的/`（股票、匯率、加密貨幣都可以）。',
      '全部都是純 Markdown 檔，換任何編輯器都打得開。',
      '',
      '## 最近的日報',
      '',
      '![[日報總覽.base]]',
      '',
      '## 待確認的報價單草稿',
      '',
      '![[秘書總覽.base]]',
      '',
      '## 每天怎麼用（3 分鐘）',
      '',
      '1. 點左側欄的「📅 開啟今天的每日筆記」（或命令面板搜尋「每日筆記」）。',
      '2. 筆記裡會自動帶出今天的日報，在「我的觀察」寫一兩句自己的看法。',
      '3. 有報價單草稿就打開確認，改好後把 `狀態` 改成「已確認」。',
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
      '日期: {{date:YYYY-MM-DD}}',
      '---',
      '# {{date:YYYY-MM-DD}} 每日筆記',
      '',
      '## 今天的日報',
      '',
      '![[{{date:YYYY-MM-DD}} 財經日報]]',
      '',
      '## 我的觀察（自己寫，不是 AI 寫）',
      '',
      '- ',
      '',
      '## 今天要追的事',
      '',
      '- [ ] ',
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
    path: '秘書總覽.base',
    content: [
      'filters:',
      '  and:',
      '    - file.inFolder("秘書")',
      'views:',
      '  - type: table',
      '    name: 報價單草稿',
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
  ['日報', '秘書', '筆記', symbolFolder].forEach(function (name) { getSubFolder_(root, name); });
  STARTER_FILES.forEach(function (f) {
    const parts = f.path.split('/');
    const fileName = parts.pop();
    const folder = parts.reduce(getSubFolder_, root);
    // 安全：同名檔案已經存在就跳過，不會覆蓋你改過的內容
    if (!folder.getFilesByName(fileName).hasNext()) folder.createFile(fileName, f.content, 'text/plain');
  });
  const symbolDir = getSubFolder_(root, symbolFolder);
  if (!symbolDir.getFilesByName('說明.md').hasNext()) {
    symbolDir.createFile('說明.md', [
      '# ' + symbolFolder,
      '',
      '這個資料夾放每個追蹤項目的筆記，股票、匯率、加密貨幣都可以。',
      '',
      '日報「原始數據」表格裡的項目名稱是連結，第一次點會在這裡建立空白筆記，你可以寫「我為什麼追蹤它」。',
      '',
    ].join('\n'), 'text/plain');
  }
  return root;
}

/** 把內容寫進 FinLab-Vault/<subFolder>/<fileName>；同名檔已存在就覆寫（同一天重跑不會重複） */
function writeVaultFile_(subFolder, fileName, content) {
  // 一定從 FinLab-Vault 根資料夾往下找，不會寫到雲端硬碟的其他地方
  const folder = getSubFolder_(getVaultRoot_(), subFolder);
  const existing = folder.getFilesByName(fileName);
  if (existing.hasNext()) existing.next().setContent(content);
  else folder.createFile(fileName, content, 'text/plain');
}

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
