/**
 * 每日財經報告 — Google Apps Script
 *
 * 流程：讀「數據」分頁（GOOGLEFINANCE 公式算出來的數字）
 *       → 補抓 BTC（CoinGecko）與黃金／美債殖利率（Yahoo Finance 公開圖表端點）
 *       → 交給 Gemini 整理成繁體中文日報（數字只來自資料，LLM 不負責查數字）
 *       → 加上秘書待辦（待確認草稿、需人工的信、昨天處理過的信），合併成一封「今日總覽」
 *       → 依你選的版面（Templates.gs）用你自己的 Gmail 寄給自己
 *       → 數字記一列到「日報紀錄」分頁；同一份日報另存成 Markdown 到雲端硬碟「FinLab-Vault/日報」
 *
 * 安全：
 *   - 寄信用 MailApp，以「你自己的 Google 帳號」寄出，完全不需要密碼。
 *   - Gemini API key 放在「專案設定 → 指令碼屬性」(GEMINI_API_KEY)，不要寫進這份程式碼。
 *
 * 第一次使用：重新整理試算表 → 上方選單「📰 我的 AI 助理」→ ① 一鍵設定 → ② 立即寄一封今日總覽 → ③ 開啟每日自動寄送
 *   （不用打開這個編輯器；手動執行時依序跑 setupWizard → sendDailyReport → setupDailyTrigger 也可以）
 * 詳細點擊步驟見 README.md 與 docs/student/student-stage-2-lab.md
 * 秘書功能在 Secretary.gs；建立知識庫資料夾與起始檔案在 Vault.gs；信件版面在 Templates.gs。
 */

// ============ 可調整的設定 ============
const SHEET_NAME = '數據';          // 放 GOOGLEFINANCE 公式的分頁名稱
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'; // 可在指令碼屬性 GEMINI_MODEL 覆寫（免費額度與型號以官網為準，查證日期 2026-11-24）
const GEMINI_RETRY_MS = 20000;      // 遇到 429（額度暫時用完）等多久再試一次
const TRIGGER_HOUR = 8;             // 每天幾點寄出（依 appsscript.json 的時區：Asia/Taipei）
const REPORT_TIMEZONE = 'Asia/Taipei';
const DAILY_LOG_SHEET = '日報紀錄';   // 每天一列數字，不用裝任何軟體就能看趨勢（自動建立）
const ERROR_LOG_SHEET = '錯誤紀錄';   // 選單或秘書出錯時記一列，方便講師幫忙看（自動建立）

// 授權畫面可以只勾部分權限；開始某個功能前，先確認它需要的權限都有勾（沒勾會再跳一次授權）
const DAILY_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.currentonly',
  'https://www.googleapis.com/auth/script.send_mail',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/drive',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/userinfo.email',
];

// 由 Yahoo Finance 公開圖表端點補抓的項目（Google Finance 沒有現貨黃金／美債殖利率）
// key 是存進 Markdown frontmatter 的欄位名稱（Obsidian 儀表板用）
const YAHOO_ITEMS = [
  { name: '黃金期貨 GC=F（US$/盎司）', symbol: 'GC=F', key: '黃金' },
  { name: '美國10年期公債殖利率 ^TNX（%）', symbol: '^TNX', key: '美債10年' },
];

// Gemini 提示詞（與 lab-assets/prompts/03-stage2-gemini-summary.txt 同步；修改請兩邊一起改）
const PROMPT_TEMPLATE = [
  '你是「財經日報整理員」。下面的【今日數據】是從資料表自動抓到的真實數字（JSON）。',
  '你的工作只有「把這些數字整理成易讀的繁體中文日報」，不是查資料。',
  '',
  '【規則】',
  '1. 只能使用【今日數據】裡的數字。沒有的欄位（值為 null 或「查無資料」）就寫「查無資料」，絕對不要憑記憶或猜測補數字。',
  '2. 漲跌用 📈（上漲）／📉（下跌），標示百分比；百分比已提供，不要自己重算。',
  '3. 每個項目用一句話描述變化即可；若數據裡沒有原因，就不要編造原因。',
  '4. 美股欄位若 usMarketOpen 為 false，要明確寫「美股休市（沿用 X 收盤數字）」，X 直接用【今日數據】的 usLastCloseDate，不要自己推算日期。',
  '5. 重點總數控制在 8～10 項，優先呈現漲跌幅較大的。',
  '6. 禁止任何投資建議、買賣建議、預測或個人觀點。',
  '7. 全程使用自然、專業的繁體中文。',
  '',
  '【輸出格式】（純文字，不要用 Markdown 表格）',
  '📰 每日財經摘要 — {date}',
  '',
  '【匯率】',
  '【美股】',
  '【黃金】',
  '【比特幣】',
  '【台股】',
  '【AI 相關個股】',
  '',
  '本摘要由自動化流程整理，數據來自 Google Finance、CoinGecko、Yahoo Finance；僅供參考，不構成投資建議。',
  '',
  '【今日數據】',
  '{data_json}',
].join('\n');

// ============ 試算表選單（學員只需要點這裡）============
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📰 我的 AI 助理')
    .addItem('① 一鍵設定（第一次用）', 'setupWizard')
    .addItem('② 立即寄一封今日總覽', 'menuSendNow')
    .addItem('🎨 選擇信件版面', 'menuChooseTemplate')
    .addItem('🎨 寄三種版面樣張給我', 'menuSendSamples')
    .addSeparator()
    .addItem('③ 開啟每日 08:00 自動寄送', 'menuEnableDaily')
    .addItem('④ 停止每日自動寄送', 'menuDisableDaily')
    .addSeparator()
    .addItem('⑤ 秘書：處理「AI秘書」標籤的信', 'menuProcessSecretary')
    .addItem('⑥ 秘書：開啟每小時自動處理', 'menuEnableSecretary')
    .addItem('⑦ 秘書：停止自動處理', 'menuDisableSecretary')
    .addToUi();
}

/** 一鍵設定：收 Gemini key → 測試 → 建立知識庫資料夾與起始檔案 */
function setupWizard() {
  // 一次確認所有權限：授權畫面上沒勾到的，這裡會再跳出來請你補勾
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  runMenu_('一鍵設定', setupWizardSteps_);
}

function setupWizardSteps_() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const hasKey = !!props.getProperty('GEMINI_API_KEY');
  const res = ui.prompt('一鍵設定：貼上 Gemini API key',
    (hasKey ? '已經設定過 key。要換新的才貼；留空直接按「確定」就沿用舊的。\n\n' : '') +
    '到 https://aistudio.google.com/apikey 免費建立 key，貼在下面。\n' +
    'key 只會存進這份檔案的「指令碼屬性」，不會出現在表格裡，分享表格也看不到。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (key) props.setProperty('GEMINI_API_KEY', key);
  else if (!hasKey) { ui.alert('沒有貼上 key，設定先暫停。準備好再點一次「① 一鍵設定」。'); return; }

  try {
    callGemini_('請只回答：OK');
  } catch (err) {
    ui.alert('key 測試失敗', err.message + '\n\n處理好之後，再點一次「① 一鍵設定」。', ui.ButtonSet.OK);
    return;
  }

  let root;
  try {
    root = setupVault_();
  } catch (err) {
    logError_('一鍵設定：建立知識庫資料夾', err);
    ui.alert('知識庫資料夾建立失敗',
      'Gemini key 已經測試成功並存好了，但在雲端硬碟建立「' + VAULT_ROOT_NAME + '」時出錯：\n' + err.message + '\n\n' +
      '最常見的原因是授權時沒有勾選雲端硬碟權限。請再點一次「① 一鍵設定」（key 留空就會沿用），授權畫面全部勾選後按「允許」。',
      ui.ButtonSet.OK);
    return;
  }
  ui.alert('設定完成 ✅',
    'Gemini key 測試成功。\n' +
    '已在你的雲端硬碟建立資料夾「' + root.getName() + '」（Obsidian 知識庫，Stage 3 會用到）。\n\n' +
    '下一步：選單「② 立即寄一封今日總覽」，到信箱看看。',
    ui.ButtonSet.OK);
}

function menuSendNow() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DAILY_SCOPES);
  runMenu_('寄出今日總覽', function () {
    sendDailyReport();
    SpreadsheetApp.getUi().alert('已寄出 ✅ 請到信箱查看。\n數字也記進「' + DAILY_LOG_SHEET + '」分頁，並存進雲端硬碟「' + VAULT_ROOT_NAME + '/日報」。');
  });
}

/** 寄出三種版面的樣張（只呼叫一次 Gemini），讓你比較後再用「選擇信件版面」決定 */
function menuSendSamples() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DAILY_SCOPES);
  runMenu_('寄出版面樣張', function () {
    const ctx = buildBriefingContext_();
    const to = getReportTo_();
    Object.keys(REPORT_TEMPLATES).forEach(function (key) {
      const out = renderBriefing_(key, ctx);
      MailApp.sendEmail({ to: to, subject: '【樣張：' + REPORT_TEMPLATES[key].name + '】' + out.subject, body: out.text, htmlBody: out.html });
    });
    SpreadsheetApp.getUi().alert('已寄出 3 封樣張 ✅ 看完喜歡哪一種，再點「🎨 選擇信件版面」。');
  });
}

function menuChooseTemplate() {
  const ui = SpreadsheetApp.getUi();
  const keys = Object.keys(REPORT_TEMPLATES);
  const current = getTemplateKey_();
  const res = ui.prompt('選擇信件版面',
    keys.map(function (k, i) {
      return (i + 1) + '. ' + REPORT_TEMPLATES[k].name + '：' + REPORT_TEMPLATES[k].desc + (k === current ? '　← 目前' : '');
    }).join('\n') + '\n\n輸入編號（1～' + keys.length + '）：',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = keys[Number(res.getResponseText().trim()) - 1];
  if (!key) { ui.alert('請輸入 1～' + keys.length + ' 的數字。'); return; }
  PropertiesService.getScriptProperties().setProperty('REPORT_TEMPLATE', key);
  ui.alert('已改成「' + REPORT_TEMPLATES[key].name + '」✅ 明天起生效；想馬上看就點「② 立即寄一封今日總覽」。');
}

function menuEnableDaily() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DAILY_SCOPES);
  runMenu_('開啟每日自動寄送', function () {
    setupDailyTrigger();
    SpreadsheetApp.getUi().alert('已開啟 ✅ 之後每天 ' + TRIGGER_HOUR + ':00 左右自動寄出（Google 會在該小時內執行）。');
  });
}

function menuDisableDaily() {
  runMenu_('停止每日自動寄送', function () {
    removeTriggers_('sendDailyReport');
    SpreadsheetApp.getUi().alert('已停止每日自動寄送。');
  });
}

// ============ 主流程（設定觸發器時請選這個）============
function sendDailyReport() {
  const ctx = buildBriefingContext_();
  const out = renderBriefing_(getTemplateKey_(), ctx);
  const to = getReportTo_();
  MailApp.sendEmail({ to: to, subject: out.subject, body: out.text, htmlBody: out.html });

  // 以下失敗都不影響寄信（例如還沒跑過一鍵設定）
  try {
    appendDailyLog_(ctx);
  } catch (err) {
    console.warn('未寫入「' + DAILY_LOG_SHEET + '」：' + err.message);
  }
  try {
    writeVaultFile_('日報', ctx.isoDate + ' 財經日報.md', buildReportMarkdown_(ctx.isoDate, ctx.data, ctx.summary, ctx.secretary));
  } catch (err) {
    console.warn('日報未存進知識庫：' + err.message);
  }
}

/** 收集今日總覽需要的一切：財經數字、AI 摘要、秘書待辦 */
function buildBriefingContext_() {
  const now = new Date();
  const dateStr = Utilities.formatDate(now, REPORT_TIMEZONE, 'yyyy年M月d日（E）');
  const data = {
    date: dateStr,
    usMarketOpen: isUsWeekday_(now),
    usLastCloseDate: lastUsCloseDate_(now), // 美股休市時摘要要寫的「沿用哪天收盤」，由程式算，不讓 AI 推算
    items: [].concat(readSheetItems_(), fetchYahooItems_(), fetchBitcoin_()),
  };

  let summary;
  try {
    summary = callGemini_(buildPrompt_(dateStr, data));
    const odd = checkSummaryNumbers_(summary, data);
    if (odd.length) {
      summary = '⚠️ 自動檢查：摘要裡有數字在原始數據找不到（' + odd.slice(0, 5).join('、') + (odd.length > 5 ? '…' : '') +
        '），可能是 AI 抄錯或自己換算，請以下方「原始數據」為準。\n\n' + summary;
    }
  } catch (err) {
    summary = '（AI 摘要暫時失敗，以下僅列出原始數據。原因：' + err.message + '）';
  }

  let secretary = null;
  try {
    secretary = getSecretaryStatus_();
  } catch (err) {
    console.warn('讀不到秘書待辦：' + err.message);
  }

  return {
    dateStr: dateStr,
    isoDate: Utilities.formatDate(now, REPORT_TIMEZONE, 'yyyy-MM-dd'),
    data: data,
    summary: summary,
    secretary: secretary,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  };
}

function getTemplateKey_() {
  const key = getProp_('REPORT_TEMPLATE');
  return REPORT_TEMPLATES[key] ? key : DEFAULT_TEMPLATE;
}

// ============ 日報紀錄（每天一列）============

/** 依標題列對欄位寫入；新的追蹤項目會自動加欄；同一天重跑會覆寫同一列 */
function appendDailyLog_(ctx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DAILY_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DAILY_LOG_SHEET);
    sheet.getRange(1, 1, 1, 2).setValues([['日期', '美股開盤']]);
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@'); // 日期存成文字，避免被轉成別的日期格式
  }
  const row = dailyLogRow_(ctx);
  let header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Object.keys(row).forEach(function (col) {
    if (header.indexOf(col) === -1) {
      header.push(col);
      sheet.getRange(1, header.length).setValue(col);
    }
  });
  const values = header.map(function (col) { return row.hasOwnProperty(col) ? row[col] : ''; });
  const dates = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  const idx = dates.findIndex(function (r) { return String(r[0]) === ctx.isoDate; });
  const target = idx === -1 ? sheet.getLastRow() + 1 : idx + 2;
  sheet.getRange(target, 1, 1, values.length).setValues([values]);
}

/** 一天一列：日期、各項數字與漲跌，以及秘書待辦數量（查無資料留空） */
function dailyLogRow_(ctx) {
  const row = { '日期': ctx.isoDate, '美股開盤': ctx.data.usMarketOpen ? '是' : '否' };
  ctx.data.items.forEach(function (it) {
    if (!it.key) return;
    row[it.key] = it.price === null ? '' : it.price;
    row[it.key + '_漲跌%'] = it.changePct === null ? '' : it.changePct;
  });
  if (ctx.secretary) {
    row['待確認草稿'] = ctx.secretary.drafts.length;
    row['需人工的信'] = ctx.secretary.failedCount;
    row['昨日處理信件'] = ctx.secretary.recent.length;
  }
  return row;
}

// ============ 資料來源 ============

/** 讀「數據」分頁：A 名稱 / B 代碼 / C 現價 / D 前一收盤 / E 漲跌幅%，第 1 列為標題 */
function readSheetItems_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('找不到分頁「' + SHEET_NAME + '」，請確認分頁名稱');
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      // 匯率數字小（例如 JPY/TWD 0.2134），保留 4 位小數；其他保留 2 位
      const digits = /^CURRENCY:/i.test(String(r[1])) ? 4 : 2;
      const price = numOrNull_(r[2], digits);
      const prevClose = numOrNull_(r[3], digits);
      let changePct = numOrNull_(r[4]);
      // E 欄空白（部分匯率沒有 changepct）但有現價與前一收盤時，自己算；都沒有就維持「查無資料」
      if (changePct === null && price !== null && prevClose) changePct = round2_((r[2] / r[3] - 1) * 100);
      return { name: r[0], symbol: r[1], key: noteKey_(r[0]), price: price, prevClose: prevClose, changePct: changePct, source: 'Google Finance' };
    });
}

/** BTC：CoinGecko 公開端點，免 API key */
function fetchBitcoin_() {
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true';
    const j = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: false }).getContentText());
    return [{ name: 'Bitcoin BTC/USD（24h）', symbol: 'BTC', key: 'BTC', price: j.bitcoin.usd, prevClose: null, changePct: round2_(j.bitcoin.usd_24h_change), source: 'CoinGecko' }];
  } catch (err) {
    return [{ name: 'Bitcoin BTC/USD（24h）', symbol: 'BTC', key: 'BTC', price: null, prevClose: null, changePct: null, source: 'CoinGecko（失敗：' + err.message + '）' }];
  }
}

/** 黃金、美債殖利率：Yahoo Finance 公開圖表端點（非官方，可能變動；失敗時回傳「查無資料」） */
function fetchYahooItems_() {
  return YAHOO_ITEMS.map(function (it) {
    try {
      const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(it.symbol) + '?range=5d&interval=1d';
      const res = UrlFetchApp.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const closes = JSON.parse(res.getContentText()).chart.result[0].indicators.quote[0].close
        .filter(function (v) { return v !== null; });
      const price = closes[closes.length - 1];
      const prev = closes[closes.length - 2];
      return { name: it.name, symbol: it.symbol, key: it.key, price: round2_(price), prevClose: round2_(prev), changePct: round2_((price / prev - 1) * 100), source: 'Yahoo Finance' };
    } catch (err) {
      return { name: it.name, symbol: it.symbol, key: it.key, price: null, prevClose: null, changePct: null, source: 'Yahoo Finance（失敗：' + err.message + '）' };
    }
  });
}

// ============ Gemini ============
function buildPrompt_(dateStr, data) {
  // 用函式當替換值：資料裡的 $ 符號不會被當成特殊字元
  return PROMPT_TEMPLATE
    .replace('{date}', function () { return dateStr; })
    .replace('{data_json}', function () { return JSON.stringify(data, null, 2); });
}

/**
 * 找出摘要裡「原始數據沒有」的數字（AI 偶爾會抄錯或自己算）。
 * 允許的數字：各項目的現價、前一收盤、漲跌幅（含四捨五入到摘要寫的位數）、名稱與代碼裡的數字、日期與美股最近收盤日。
 */
function checkSummaryNumbers_(summary, data) {
  const known = [];
  const addFromText = function (text) {
    (String(text === null || text === undefined ? '' : text).match(/\d+(?:\.\d+)?/g) || [])
      .forEach(function (n) { known.push(Number(n)); });
  };
  addFromText(data.date);
  addFromText(data.usLastCloseDate);
  data.items.forEach(function (it) {
    addFromText(it.name);
    addFromText(it.symbol);
    [it.price, it.prevClose, it.changePct].forEach(function (v) {
      if (typeof v === 'number' && isFinite(v)) known.push(Math.abs(v));
    });
  });
  const odd = [];
  (String(summary).match(/\d[\d,]*(?:\.\d+)?/g) || []).forEach(function (raw) {
    const n = Number(raw.replace(/,/g, ''));
    const decimals = (raw.split('.')[1] || '').length;
    const ok = known.some(function (v) { return v === n || roundTo_(v, decimals) === n; });
    if (!ok && odd.indexOf(raw) === -1) odd.push(raw);
  });
  return odd;
}

/** opts.json = true 時要求 Gemini 回傳 JSON（秘書判讀信件用）；失敗時丟出中文說明 */
function callGemini_(prompt, opts) {
  opts = opts || {};
  const key = getProp_('GEMINI_API_KEY');
  if (!key) throw new Error('尚未設定 Gemini key，請先點選單「① 一鍵設定」。');
  const model = getProp_('GEMINI_MODEL') || DEFAULT_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  if (opts.json) payload.generationConfig = { responseMimeType: 'application/json' };

  let res;
  for (let attempt = 1; attempt <= 2; attempt++) {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 429 || attempt === 2) break;
    Utilities.sleep(GEMINI_RETRY_MS); // 每分鐘額度用完時，等一下再試一次
  }
  if (res.getResponseCode() !== 200) throw new Error(geminiHttpError_(res.getResponseCode(), res.getContentText(), model));

  let j;
  try {
    j = JSON.parse(res.getContentText());
  } catch (err) {
    throw new Error('Gemini 回傳的內容看不懂，請稍後再試。');
  }
  if (j.promptFeedback && j.promptFeedback.blockReason) {
    throw new Error('Gemini 拒絕處理這段內容（原因：' + j.promptFeedback.blockReason + '）。請換一封信或調整內容再試。');
  }
  const cand = j.candidates && j.candidates[0];
  if (!cand) throw new Error('Gemini 沒有回傳任何內容，請稍後再試。');
  // 只取一般文字，略過「思考」片段；有多段就接起來
  const text = ((cand.content && cand.content.parts) || [])
    .filter(function (p) { return !p.thought && typeof p.text === 'string'; })
    .map(function (p) { return p.text; })
    .join('');
  const reason = cand.finishReason || '';
  if (reason && reason !== 'STOP' && reason !== 'MAX_TOKENS') {
    throw new Error('Gemini 中途停止（原因：' + reason + '，通常是內容被安全機制擋下）。請換一封信或調整內容再試。');
  }
  if (!text.trim()) throw new Error('Gemini 回傳空白（結束原因：' + (reason || '未知') + '），請稍後再試。');
  if (reason === 'MAX_TOKENS') console.warn('Gemini 回覆太長被截斷');
  return text;
}

/** 把 Gemini 的 HTTP 錯誤翻成學員看得懂的話 */
function geminiHttpError_(code, body, model) {
  const raw = String(body || '');
  if (code === 429) {
    return 'Gemini 免費額度暫時用完（429）。等一分鐘再試；如果一整天都失敗，代表今天的額度用完了，' +
      '約台灣時間下午 3～4 點重置後再試。';
  }
  if (/API_KEY_INVALID|API key not valid/i.test(raw) || code === 401) {
    return 'Gemini key 無效：請確認 key 有完整貼上（沒有多空白、沒有少字），或到 AI Studio 重新建立一把。';
  }
  if (code === 404) {
    return '找不到模型「' + model + '」：這個型號可能已停用，或你的帳號不能使用。' +
      '若你在指令碼屬性設過 GEMINI_MODEL，請刪掉或改成官網列出的型號（不填就用預設 ' + DEFAULT_MODEL + '）。';
  }
  if (code === 403) {
    return 'Gemini 拒絕存取（403）：key 可能沒有權限或所在地區不支援，請到 AI Studio 確認 key 的狀態。';
  }
  return 'Gemini 錯誤（HTTP ' + code + '）：' + raw.slice(0, 200);
}

/** 單獨測試 Gemini key 是否可用（不會印出 key） */
function testGeminiKey() {
  Logger.log(callGemini_('請只回答：OK'));
}

// ============ 排程 ============
/** 執行一次即可：建立每天 TRIGGER_HOUR 點寄信的觸發器（先刪舊的避免重複） */
function setupDailyTrigger() {
  // 觸發器在背景執行時沒辦法跳授權，所以建立前先確認權限都有勾
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DAILY_SCOPES);
  removeTriggers_('sendDailyReport');
  ScriptApp.newTrigger('sendDailyReport').timeBased().everyDays(1).atHour(TRIGGER_HOUR).create();
}

function removeTriggers_(handlerName) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handlerName) ScriptApp.deleteTrigger(t);
  });
}

// ============ 錯誤處理（學員看得懂的訊息）============

/** 選單共用：出錯時用中文對話框說明，並記一列到「錯誤紀錄」分頁 */
function runMenu_(title, fn) {
  try {
    fn();
  } catch (err) {
    logError_(title, err);
    const ui = SpreadsheetApp.getUi();
    ui.alert(title + '失敗', friendlyError_(err) + '\n\n（也記在試算表「' + ERROR_LOG_SHEET + '」分頁，需要協助時給講師看這一列）', ui.ButtonSet.OK);
  }
}

function friendlyError_(err) {
  const msg = String((err && err.message) || err);
  if (/authoriz|permission|not sufficient|權限/i.test(msg)) {
    return '權限不足：' + msg + '\n\n請點「① 一鍵設定」重新授權，授權畫面的權限全部勾選後按「允許」。';
  }
  return msg;
}

function logError_(where, err) {
  console.error(where + '：' + ((err && err.stack) || err));
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(ERROR_LOG_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(ERROR_LOG_SHEET);
      sheet.appendRow(['時間', '在做什麼', '錯誤訊息']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), where, String((err && err.message) || err)]);
  } catch (e) {
    // 連紀錄都寫不進去就算了，不要蓋掉原本的錯誤
  }
}

// ============ 小工具 ============
/** 收件信箱：指令碼屬性 REPORT_TO，不填就寄給執行程式的帳號（也就是你自己） */
function getReportTo_() {
  return getProp_('REPORT_TO') || Session.getEffectiveUser().getEmail();
}

function getProp_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

/** 儲存格是數字才用（#N/A、空白、文字都當成查無資料）；digits 預設 2 位小數 */
function numOrNull_(v, digits) {
  return typeof v === 'number' && isFinite(v) ? roundTo_(v, digits === undefined ? 2 : digits) : null;
}

function round2_(v) {
  return roundTo_(v, 2);
}

function roundTo_(v, digits) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/** 以美東時間判斷是否為平日；國定假日無法自動判斷（見 README 已知限制） */
function isUsWeekday_(now) {
  const d = Utilities.formatDate(now, 'America/New_York', 'u'); // 1=週一 … 7=週日
  return Number(d) <= 5;
}

/**
 * 最近一個美股收盤日（美東時間）→「11月21日」。
 * 週末往前找到週五；平日收盤（16:00）前算前一個平日。國定假日無法判斷（見 README 已知限制）。
 */
function lastUsCloseDate_(now) {
  const p = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd-u-H').split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); // 用 UTC 中午代表美東那一天，往前推日期不受時區影響
  let dow = p[3]; // 1=週一 … 7=週日
  if (dow <= 5 && p[4] < 16) {
    d.setUTCDate(d.getUTCDate() - 1);
    dow = dow - 1 || 7;
  }
  while (dow >= 6) {
    d.setUTCDate(d.getUTCDate() - 1);
    dow -= 1;
  }
  return (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
}

function rawTable_(data) {
  return data.items.map(function (it) {
    const arrow = it.changePct === null ? '' : it.changePct >= 0 ? '📈' : '📉';
    return arrow + ' ' + it.name + '：' + (it.price === null ? '查無資料' : it.price) +
      (it.changePct === null ? '' : '（' + (it.changePct >= 0 ? '+' : '') + it.changePct + '%）') + '  [' + it.source + ']';
  }).join('\n');
}

// ============ Markdown（存進 Obsidian 知識庫）============

/** 把名稱轉成適合當 frontmatter 欄位與筆記檔名的 key：「台積電 2330」→「台積電_2330」 */
function noteKey_(name) {
  return String(name)
    .replace(/[（(].*?[）)]/g, '')
    .trim()
    .replace(/[^0-9A-Za-z\u3400-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * 日報 → Markdown。frontmatter 的數字全部直接取自 data（不經過 AI），
 * 查無資料的欄位留空，不補任何數字。
 */
function buildReportMarkdown_(isoDate, data, summary, secretary) {
  const fm = ['---', '類型: 日報', '日期: ' + isoDate, '美股開盤: ' + (data.usMarketOpen ? 'true' : 'false')];
  data.items.forEach(function (it) {
    if (!it.key) return;
    fm.push(it.key + ': ' + (it.price === null ? '' : it.price));
    fm.push(it.key + '_漲跌: ' + (it.changePct === null ? '' : it.changePct));
  });
  if (secretary) fm.push('待確認草稿: ' + secretary.drafts.length);
  fm.push('---');

  const rows = data.items.map(function (it) {
    // 表格裡的連結別名要寫成 \|，否則會被當成欄位分隔
    const label = it.key ? '[[' + it.key + '\\|' + it.name + ']]' : it.name;
    const pct = it.changePct === null ? '' : (it.changePct >= 0 ? '📈 +' : '📉 ') + it.changePct + '%';
    return '| ' + label + ' | ' + (it.price === null ? '查無資料' : it.price) + ' | ' + pct + ' | ' + it.source + ' |';
  });

  return fm.concat([
    '',
    '# ' + isoDate + ' 財經日報',
    '',
    '## AI 整理的摘要',
    '',
    summary,
    '',
    '## 原始數據（可自行核對）',
    '',
    '| 項目 | 數字 | 漲跌 | 來源 |',
    '|---|---|---|---|',
  ], rows, secretary ? ['', '## 秘書待辦', ''].concat(secretaryMarkdown_(secretary)) : [], [
    '',
    '> 本頁由 Apps Script 自動產生；數字來自資料表與公開端點，AI 只負責整理文字。僅供參考，不構成投資建議。',
    '',
  ]).join('\n');
}

function secretaryMarkdown_(sec) {
  const lines = ['- 待確認草稿：' + sec.drafts.length + ' 封（在 Gmail「草稿」）'];
  sec.drafts.forEach(function (d) { lines.push('  - [ ] ' + d.subject + (d.checks ? '（' + d.checks + ' 處需人工確認）' : '')); });
  lines.push('- 需人工處理的信：' + sec.failedCount + ' 封（Gmail 標籤「AI秘書/需人工」）');
  lines.push('- 過去 24 小時處理：' + sec.recent.length + ' 封');
  sec.recent.forEach(function (r) {
    lines.push('  - ' + r.intent + '｜' + r.customer + '｜' + r.subject + (r.total === '' ? '' : '｜報價合計 ' + r.total));
  });
  return lines;
}
