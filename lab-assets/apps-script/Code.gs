/**
 * 每日財經報告 — Google Apps Script
 *
 * 流程：讀「數據」分頁（GOOGLEFINANCE 公式算出來的數字）
 *       → 補抓 BTC（CoinGecko）與黃金／美債殖利率（Yahoo Finance 公開圖表端點）
 *       → 交給 OpenRouter 的免費 AI 模型整理成繁體中文日報（數字只來自資料，LLM 不負責查數字）
 *       → 加上秘書待辦（待確認草稿、需人工的信、昨天處理過的信），合併成一封「今日總覽」
 *       → 依你選的版面（Templates.gs）用你自己的 Gmail 寄給自己
 *       → 數字記一列到「日報紀錄」分頁；同一份日報另存成 Markdown 到雲端硬碟「FinLab-Vault/日報」
 *
 * 安全：
 *   - 寄信用 MailApp，以「你自己的 Google 帳號」寄出，完全不需要密碼。
 *   - OpenRouter API key 放在「專案設定 → 指令碼屬性」(OPENROUTER_API_KEY)，不要寫進這份程式碼。
 *     程式不會把 key 印到紀錄、對話框或信件裡。
 *
 * 第一次使用：重新整理試算表 → 上方選單「📰 我的 AI 助理」→ ① 一鍵設定（OpenRouter key 可留空，改走「關閉 AI」）→ ② 立即寄一封今日總覽 → ③ 開啟每日自動寄送
 *   （不用打開這個編輯器；手動執行時依序跑 setupWizard → sendDailyReport → setupDailyTrigger 也可以）
 * 詳細點擊步驟見 README.md 與 docs/student/student-stage-2-lab.md
 * 秘書功能在 Secretary.gs；建立知識庫資料夾與起始檔案在 Vault.gs；信件版面在 Templates.gs。
 */

// ============ 可調整的設定 ============
const SHEET_NAME = '數據';          // 放 GOOGLEFINANCE 公式的分頁名稱
// AI 模型：免費模型常常換，名單以 https://openrouter.ai/models?max_price=0 為準（查證日期 2026-11-24）
// 先用 AI_MODEL_PRIMARY；失敗（錯誤、空白回覆、429 額度用完）就改用 AI_MODEL_FALLBACK 再試一次；兩個都失敗就只寄原始數據
// 想換模型：直接改這兩行，或在指令碼屬性設 OPENROUTER_MODEL／OPENROUTER_FALLBACK_MODEL 覆寫（不用改程式）
const AI_MODEL_PRIMARY = 'openrouter/free';            // OpenRouter 自動挑一個當下可用的免費模型
const AI_MODEL_FALLBACK = 'google/gemma-4-31b-it:free'; // 備用：指定一個中文表現穩定的免費模型
const AI_KEY_PROP = 'OPENROUTER_API_KEY';              // key 存在指令碼屬性的名稱
const AI_ENABLED_PROP = 'AI_ENABLED';                   // true／false（也接受 on／off）；沒設時：有 key 就開啟，沒有就關閉
const AI_OFF_SUMMARY = 'AI 摘要已關閉，以下為原始數據。';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEYS_PAGE = 'https://openrouter.ai/settings/keys';
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

// 「數據」分頁某列 GOOGLEFINANCE 查無資料（#N/A）時，改用 Yahoo Finance 補抓（失敗就維持「查無資料」）
// 匯率（CURRENCY:USDTWD 這種）會自動換成 Yahoo 的 USDTWD=X，不用列在這裡
const YAHOO_FALLBACK = {
  'TPE:IX0001': '^TWII',     // 台股加權指數
  'INDEXTPE:TAIEX': '^TWII', // 舊範本的代碼（Google Finance 已查不到）
};

// 日報提示詞（與 lab-assets/prompts/03-stage2-ai-summary.txt 同步；修改請兩邊一起改）
const PROMPT_TEMPLATE = [
  '你是「財經日報整理員」。下面的【今日數據】是從資料表自動抓到的真實數字（JSON）。',
  '你的工作只有「把這些數字整理成易讀的繁體中文日報」，不是查資料。',
  '',
  '【規則】',
  '1. 只能使用【今日數據】裡的數字。沒有的欄位（值為 null 或「查無資料」）就寫「查無資料」，絕對不要憑記憶或猜測補數字。',
  '2. 漲跌用 📈（上漲）／📉（下跌），標示百分比；百分比已提供，不要自己重算。',
  '3. 每個項目用一句話描述變化即可；若數據裡沒有原因，就不要編造原因。',
  '4. 美股欄位若 usMarketOpen 為 false，要明確寫「美股休市（沿用 X 收盤數字）」，X 直接用【今日數據】的 usLastCloseDate，不要自己推算日期。',
  '5. 【匯率】段落要把 fxPairs 列出的每一組匯率都寫出來，一組一行，不可省略；其他段落的重點總數控制在 8～10 項，優先呈現漲跌幅較大的。',
  '6. 禁止任何投資建議、買賣建議、預測或個人觀點。',
  '7. 全程使用自然、專業的繁體中文。',
  '8. source 欄位只是資料來源說明，不要把裡面的文字或數字寫進摘要。',
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

/** 一鍵設定：收 OpenRouter key（可留空以關閉 AI）→ 有 key 且 AI 開啟時才測試 → 建立知識庫資料夾與起始檔案 */
function setupWizard() {
  // 一次確認所有權限：授權畫面上沒勾到的，這裡會再跳出來請你補勾
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  runMenu_('一鍵設定', setupWizardSteps_);
}

function setupWizardSteps_() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const hasKey = !!props.getProperty(AI_KEY_PROP);
  const res = ui.prompt('一鍵設定：OpenRouter key（可留空）',
    (hasKey ? '已經設定過 key。要換新的才貼；留空直接按「確定」就沿用舊的。\n\n' : '') +
    '用 Google 帳號登入 https://openrouter.ai ，到 Keys 頁面（' + OPENROUTER_KEYS_PAGE + '）按「Create」建立 key，複製後貼在下面。\n' +
    '免費模型不用綁信用卡。key 是 sk-or- 開頭的一長串字。\n' +
    '還沒有 key、或想先只用原始數據的話，這裡留空按「確定」即可：程式會關閉 AI 摘要，仍會建立知識庫資料夾。\n' +
    'key 只會存進這份檔案的「指令碼屬性」，不會出現在表格裡，分享表格也看不到。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().replace(/\s+/g, '');
  if (key && !looksLikeOpenRouterKey_(key)) {
    // 不要把貼上的內容顯示出來（可能是別的密碼）
    ui.alert('這看起來不是 OpenRouter key',
      'OpenRouter key 是「sk-or-」開頭的一長串字。請回到 ' + OPENROUTER_KEYS_PAGE + ' 重新複製，再點一次「① 一鍵設定」。\n' +
      '剛剛貼的內容沒有存起來。', ui.ButtonSet.OK);
    return;
  }
  if (key) {
    props.setProperty(AI_KEY_PROP, key);
    props.setProperty(AI_ENABLED_PROP, 'true');
    // 舊版（Gemini）留下的設定用不到了，順手清掉
    props.deleteProperty('GEMINI_API_KEY');
    props.deleteProperty('GEMINI_MODEL');
  } else if (!hasKey) {
    props.setProperty(AI_ENABLED_PROP, 'false');
  }

  if (isAiEnabled_()) {
    try {
      callAi_('請只回答：OK');
    } catch (err) {
      ui.alert('key 測試失敗', err.message + '\n\n處理好之後，再點一次「① 一鍵設定」。', ui.ButtonSet.OK);
      return;
    }
  }

  let root;
  try {
    root = setupVault_();
  } catch (err) {
    logError_('一鍵設定：建立知識庫資料夾', err);
    ui.alert('知識庫資料夾建立失敗',
      (getProp_(AI_KEY_PROP) ? 'OpenRouter key 已經存好了，但' : '') +
      '在雲端硬碟建立「' + VAULT_ROOT_NAME + '」時出錯：\n' + err.message + '\n\n' +
      '最常見的原因是授權時沒有勾選雲端硬碟權限。請再點一次「① 一鍵設定」（key 留空就會沿用），授權畫面全部勾選後按「允許」。',
      ui.ButtonSet.OK);
    return;
  }
  const aiLine = isAiEnabled_()
    ? 'OpenRouter key 測試成功，AI 摘要已開啟。\n'
    : '目前 AI 摘要已關閉。每日總覽會寄出原始數據，並註明「' + AI_OFF_SUMMARY + '」。\n若要開啟，再點一次「① 一鍵設定」貼上 OpenRouter key，或把指令碼屬性 AI_ENABLED 設為 true。\n';
  ui.alert('設定完成 ✅',
    aiLine +
    '已在你的雲端硬碟建立資料夾「' + root.getName() + '」（Obsidian 知識庫，Stage 3 會用到；追蹤項目筆記在「' + vaultSymbolFolder_() + '」）。\n\n' +
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

/** 寄出三種版面的樣張（AI 摘要只產生一次），讓你比較後再用「選擇信件版面」決定 */
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
  // 摘要的【匯率】段落要逐一列出這幾組（免費模型常常只挑一組寫）
  data.fxPairs = data.items.filter(isFxItem_).map(function (it) { return it.name; });

  const summary = buildAiSummary_(dateStr, data);

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
      const item = { name: r[0], symbol: r[1], key: noteKey_(r[0]), price: price, prevClose: prevClose, changePct: changePct, source: 'Google Finance' };
      return price === null ? sheetFallback_(item, digits) : item;
    });
}

/** Google Finance 查無資料時，若有對應的 Yahoo 代碼就補抓；補不到就原樣回傳（信裡會寫「查無資料」） */
function sheetFallback_(item, digits) {
  const sym = String(item.symbol).trim().toUpperCase();
  const fx = sym.match(/^CURRENCY:([A-Z]{3})([A-Z]{3})$/);
  const ySymbol = fx ? fx[1] + fx[2] + '=X' : YAHOO_FALLBACK[sym];
  if (!ySymbol) return item;
  try {
    const q = fetchYahooQuote_(ySymbol, digits);
    return { name: item.name, symbol: item.symbol, key: item.key, price: q.price, prevClose: q.prevClose, changePct: q.changePct,
      source: 'Yahoo Finance ' + ySymbol + '（Google Finance 查無資料，改用備援）' };
  } catch (err) {
    console.warn('Yahoo 備援 ' + ySymbol + ' 失敗：' + err.message);
    item.source = 'Google Finance（查無資料；Yahoo 備援也暫時無法取得）';
    return item;
  }
}

/**
 * BTC：先用 CoinGecko 公開端點（免 API key）；被限流（429）或暫時故障就等幾秒重試，
 * 還是不行就改用 Yahoo Finance 的 BTC-USD；都失敗才寫「查無資料」。
 * 錯誤碼只記到執行紀錄，不放進給 AI 的資料（不然摘要會把「429」當成數字寫進去）。
 */
const BTC_NAME = 'Bitcoin BTC/USD（24h）';
const COINGECKO_RETRIES = 2;        // CoinGecko 失敗後再試幾次
const COINGECKO_RETRY_WAIT_MS = 3000; // 每次重試前等幾毫秒（3 秒）

function fetchBitcoin_() {
  const base = { name: BTC_NAME, symbol: 'BTC', key: 'BTC', prevClose: null };
  try {
    const cg = fetchCoinGeckoBtc_();
    return [Object.assign({}, base, { price: cg.price, changePct: cg.changePct, source: 'CoinGecko' })];
  } catch (err) {
    console.warn('CoinGecko 取不到比特幣，改用 Yahoo BTC-USD：' + err.message);
  }
  try {
    const q = fetchYahooQuote_('BTC-USD', 2);
    return [Object.assign({}, base, { price: q.price, prevClose: q.prevClose, changePct: q.changePct,
      source: 'Yahoo Finance BTC-USD（CoinGecko 暫時無法取得，改用備援；漲跌為與前一日收盤相比）' })];
  } catch (err) {
    console.warn('Yahoo BTC-USD 也失敗：' + err.message);
  }
  return [Object.assign({}, base, { price: null, changePct: null, source: '暫時無法取得（CoinGecko 與 Yahoo 備援都沒有回應）' })];
}

/** CoinGecko 現價與 24 小時漲跌；429 或 5xx 會等一下再試，最後仍失敗就丟出錯誤 */
function fetchCoinGeckoBtc_() {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true';
  let lastErr = null;
  for (let attempt = 0; attempt <= COINGECKO_RETRIES; attempt++) {
    if (attempt > 0) Utilities.sleep(COINGECKO_RETRY_WAIT_MS * attempt);
    try {
      const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      const code = res.getResponseCode();
      if (code === 200) {
        const j = JSON.parse(res.getContentText());
        if (!j.bitcoin || typeof j.bitcoin.usd !== 'number') throw new Error('CoinGecko 回傳格式不對');
        return { price: j.bitcoin.usd, changePct: round2_(j.bitcoin.usd_24h_change) };
      }
      lastErr = new Error('CoinGecko HTTP ' + code);
      if (code !== 429 && code < 500) break; // 4xx（429 以外）重試也沒用
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('CoinGecko 沒有回應');
}

/** 黃金、美債殖利率：Yahoo Finance 公開圖表端點（非官方，可能變動；失敗時回傳「查無資料」） */
function fetchYahooItems_() {
  return YAHOO_ITEMS.map(function (it) {
    try {
      const q = fetchYahooQuote_(it.symbol, 2);
      return { name: it.name, symbol: it.symbol, key: it.key, price: q.price, prevClose: q.prevClose, changePct: q.changePct, source: 'Yahoo Finance' };
    } catch (err) {
      console.warn('Yahoo ' + it.symbol + ' 失敗：' + err.message);
      return { name: it.name, symbol: it.symbol, key: it.key, price: null, prevClose: null, changePct: null, source: 'Yahoo Finance（暫時無法取得）' };
    }
  });
}

/** Yahoo Finance 最近兩個日收盤 → 現價、前一收盤、漲跌幅%（失敗會丟出錯誤，由呼叫端決定怎麼處理） */
function fetchYahooQuote_(symbol, digits) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=5d&interval=1d';
  const res = UrlFetchApp.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const closes = JSON.parse(res.getContentText()).chart.result[0].indicators.quote[0].close
    .filter(function (v) { return v !== null; });
  if (closes.length < 2) throw new Error('資料不足');
  const price = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  return { price: roundTo_(price, digits), prevClose: roundTo_(prev, digits), changePct: round2_((price / prev - 1) * 100) };
}

/** AI 開不開：指令碼屬性 AI_ENABLED 為 false／off／0／no 就是關；沒設這個屬性時，有 OpenRouter key 才算開。 */
function isAiEnabled_() {
  const flag = String(getProp_(AI_ENABLED_PROP) || '').trim().toLowerCase();
  if (flag === 'false' || flag === 'off' || flag === '0' || flag === 'no') return false;
  return !!getProp_(AI_KEY_PROP);
}

/** 關閉 AI 或沒有 key 時，日報與信件使用的說明（不會當成錯誤） */
function buildAiSummary_(dateStr, data) {
  if (!isAiEnabled_()) return AI_OFF_SUMMARY;
  try {
    const summary = ensureFxLines_(callAi_(buildPrompt_(dateStr, data)), data);
    const odd = checkSummaryNumbers_(summary, data);
    if (odd.length) {
      return '⚠️ 自動檢查：摘要裡有數字在原始數據找不到（' + odd.slice(0, 5).join('、') + (odd.length > 5 ? '…' : '') +
        '），可能是 AI 抄錯或自己換算，請以下方「原始數據」為準。\n\n' + summary;
    }
    return summary;
  } catch (err) {
    console.warn('AI 摘要失敗，改寄原始數據：' + err.message);
    return '（這次沒有 AI 摘要，以下僅列出原始數據，數字一樣可以用。原因：' + err.message + '）';
  }
}

/** ⑤⑥ 在 AI 關閉時用的說明，避免被當成執行失敗 */
function alertAiOffForSecretary_(title) {
  SpreadsheetApp.getUi().alert(
    title,
    '秘書功能需要開啟 AI 才能判讀信件、撰寫回覆草稿。\n\n' +
    '目前 AI 摘要已關閉，每日總覽仍會寄出原始數據。\n\n' +
    '若要使用⑤⑥，請先點「① 一鍵設定」貼上 OpenRouter key，或把指令碼屬性 AI_ENABLED 設為 true。\n' +
    '若你改用 ChatGPT 或 Claude 的訂閱在瀏覽器整理信件，請不要使用這兩個選單。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============ AI 摘要（OpenRouter）============
function buildPrompt_(dateStr, data) {
  // 用函式當替換值：資料裡的 $ 符號不會被當成特殊字元
  return PROMPT_TEMPLATE
    .replace('{date}', function () { return dateStr; })
    .replace('{data_json}', function () { return JSON.stringify(data, null, 2); });
}

/** 「數據」分頁裡的匯率列（代碼是 CURRENCY:USDTWD 這種） */
function isFxItem_(it) {
  return /^CURRENCY:/i.test(String(it.symbol));
}

/** 一組匯率的固定寫法（程式產生，數字直接取自原始數據） */
function fxLine_(it) {
  if (it.price === null) return it.name + '：查無資料';
  const pct = it.changePct === null ? '' : '（' + (it.changePct >= 0 ? '📈 +' : '📉 ') + it.changePct + '%）';
  return it.name + '：' + it.price + pct;
}

// 常見幣別的中文寫法（摘要可能寫「美元/台幣」「美元兌新台幣」）
const FX_ZH = {
  USD: ['美元', '美金'], TWD: ['新台幣', '台幣', '新臺幣', '臺幣'], JPY: ['日圓', '日幣', '日元'],
  EUR: ['歐元'], CNY: ['人民幣'], HKD: ['港幣', '港元'], GBP: ['英鎊'], KRW: ['韓元', '韓圜'], AUD: ['澳幣', '澳元'],
};

/** 比對前統一：全形轉半形、去空白、英文轉大寫、「／」轉「/」 */
function fxNormalize_(s) {
  return String(s).normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}

/** 一組匯率在摘要裡可能的寫法：分頁名稱、USD/TWD、USDTWD、USD-TWD、美元/台幣、美元兌台幣（簡體「兑」「对」也算）… */
function fxAliases_(it) {
  const out = [fxNormalize_(it.name)];
  const m = String(it.symbol).trim().toUpperCase().match(/^CURRENCY:([A-Z]{3})([A-Z]{3})$/);
  if (m) {
    const a = m[1], b = m[2];
    out.push(a + '/' + b, a + b, a + '-' + b);
    (FX_ZH[a] || []).forEach(function (za) {
      (FX_ZH[b] || []).forEach(function (zb) {
        ['/', '兌', '兑', '對', '对', ''].forEach(function (sep) { out.push(za + sep + zb); });
      });
    });
  }
  return out.filter(function (x, i) { return x && out.indexOf(x) === i; });
}

/**
 * 摘要的【匯率】段落漏寫了哪組匯率，就由程式依原始數據補上一行（不再交給 AI）。
 * 有【匯率】標題就補在標題下面；連標題都沒有就在摘要最前面加一段。
 */
function ensureFxLines_(summary, data) {
  const text = String(summary);
  const fx = data.items.filter(isFxItem_);
  const flat = fxNormalize_(text);
  const missing = fx.filter(function (it) {
    return !fxAliases_(it).some(function (a) { return flat.indexOf(a) !== -1; });
  });
  if (!missing.length) return text;
  const lines = missing.map(fxLine_);
  const i = text.indexOf('【匯率】');
  if (i === -1) return '【匯率】\n' + lines.join('\n') + '\n\n' + text;
  const eol = text.indexOf('\n', i);
  if (eol === -1) return text + '\n' + lines.join('\n');
  return text.slice(0, eol + 1) + lines.join('\n') + '\n' + text.slice(eol + 1);
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

/**
 * 呼叫 AI，回傳文字。先用主要模型，失敗就換備用模型再試一次；兩個都失敗時丟出中文說明（呼叫端決定怎麼退場）。
 * opts.json = true 時要求回傳 JSON（秘書判讀信件用）。
 * 安全：key 只放在 Authorization 標頭，錯誤訊息與紀錄都不會包含 key。
 */
function callAi_(prompt, opts) {
  opts = opts || {};
  const key = getProp_(AI_KEY_PROP);
  if (!isAiEnabled_()) {
    if (key) throw new Error('AI 摘要已關閉（指令碼屬性 AI_ENABLED 設為 false）。若要開啟，把它改成 true。');
    throw new Error('尚未設定 OpenRouter key，請先點選單「① 一鍵設定」。');
  }
  const models = aiModels_();
  const reasons = [];
  for (let i = 0; i < models.length; i++) {
    try {
      return callOpenRouterOnce_(key, models[i], prompt, opts);
    } catch (err) {
      reasons.push((i === 0 ? '主要模型' : '備用模型') + '「' + models[i] + '」：' + err.message);
      if (err.stopRetry) break; // 例如 key 無效：換模型也沒用
      if (i < models.length - 1) console.warn('AI 模型「' + models[i] + '」失敗，改用備用模型：' + err.message);
    }
  }
  throw new Error('AI 暫時無法使用。' + reasons.join('；'));
}

/** 要依序嘗試的模型：指令碼屬性可覆寫；重複的只試一次 */
function aiModels_() {
  const list = [getProp_('OPENROUTER_MODEL') || AI_MODEL_PRIMARY, getProp_('OPENROUTER_FALLBACK_MODEL') || AI_MODEL_FALLBACK];
  return list.filter(function (m, i) { return m && list.indexOf(m) === i; });
}

/** OpenRouter key 大致長這樣：sk-or- 開頭、沒有空白（只做寬鬆檢查，真正能不能用由測試呼叫決定） */
function looksLikeOpenRouterKey_(key) {
  return /^sk-or-[A-Za-z0-9_-]{10,}$/.test(String(key));
}

/** 呼叫一次指定模型；任何失敗都丟出學員看得懂的中文錯誤 */
function callOpenRouterOnce_(key, model, prompt, opts) {
  const payload = { model: model, messages: [{ role: 'user', content: prompt }] };
  if (opts.json) payload.response_format = { type: 'json_object' };

  let res;
  try {
    res = UrlFetchApp.fetch(OPENROUTER_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + key,
        // 選填的來源標示；hidden 代表不要出現在 OpenRouter 公開排行榜
        'HTTP-Referer': 'https://github.com/osisdie/low-code-fin-lab',
        'X-OpenRouter-Title': 'low-code-fin-lab',
        'X-OpenRouter-App-Visibility': 'hidden',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (err) {
    throw new Error('連不上 OpenRouter（' + err.message + '），請稍後再試。');
  }

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code < 200 || code >= 300) throw openRouterHttpError_(code, body, model);

  let j;
  try {
    j = JSON.parse(body);
  } catch (err) {
    throw new Error('回傳的內容看不懂，請稍後再試。');
  }
  // 有時 HTTP 200 但內容是錯誤（例如上游模型中途失敗）
  if (j.error) throw openRouterHttpError_(Number(j.error.code) || 0, body, model);

  const choice = j.choices && j.choices[0];
  if (!choice) throw new Error('沒有回傳任何內容，請稍後再試。');
  const reason = choice.finish_reason || '';
  if (reason === 'content_filter') throw new Error('內容被安全機制擋下，請換一封信或調整內容再試。');
  if (reason === 'error') throw new Error('模型中途出錯，請稍後再試。');
  // 部分推理模型會把思考過程包在 <think>…</think>，只留最後的答案
  const text = String((choice.message && choice.message.content) || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!text) throw new Error('回傳空白（結束原因：' + (reason || '未知') + '），請稍後再試。');
  if (reason === 'length') console.warn('AI 回覆太長被截斷');
  if (j.model) console.log('這次的 AI 回覆來自模型：' + j.model);
  return text;
}

/**
 * 429 是不是「每天的免費模型額度」用完（整個帳號共用，換模型沒用）。
 * OpenRouter 這種錯誤的訊息會寫 free-models-per-day；每分鐘限制（free-models-per-min）或上游模型忙碌的 429 不算，仍會換備用模型。
 */
function isFreeDailyLimit_(body) {
  return /free-models-per-day|free model requests per day/i.test(String(body || ''));
}

/** 把 OpenRouter 的 HTTP 錯誤翻成學員看得懂的話（回傳 Error；body 只取 OpenRouter 的錯誤說明，不含 key） */
function openRouterHttpError_(code, body, model) {
  let detail = '';
  try {
    const e = JSON.parse(body).error;
    detail = String((e && e.message) || '').slice(0, 160);
  } catch (err) {
    detail = String(body || '').slice(0, 160);
  }
  const tail = detail ? '（原始訊息：' + detail + '）' : '';
  let msg;
  let stopRetry = false;
  if (code === 401) {
    msg = 'OpenRouter key 無效（401）：請確認 key 有完整貼上（sk-or- 開頭、沒有少字），或到 ' + OPENROUTER_KEYS_PAGE +
      ' 重新建立一把，再點「① 一鍵設定」貼上新的。';
    stopRetry = true;
  } else if (code === 429 && isFreeDailyLimit_(body)) {
    // 每天的免費額度是整個帳號共用，換備用模型也一樣會被擋，直接停
    msg = '今天的免費額度用完了（429）。免費模型每天約 50 次（以官網為準），整個帳號共用，' +
      '台灣時間早上 8 點（UTC 00:00）重置，明天再試。';
    stopRetry = true;
  } else if (code === 429) {
    msg = '免費額度暫時用完（429）。免費模型每分鐘約 20 次、每天約 50 次（以官網為準），' +
      '每天台灣時間早上 8 點（UTC 00:00）重置；等一分鐘再試，整天都失敗就明天再試。';
  } else if (code === 402) {
    msg = 'OpenRouter 帳戶點數不足（402）：免費模型本來不用點數，請到 openrouter.ai 的 Credits 頁確認餘額不是負數。';
    stopRetry = true;
  } else if (code === 404) {
    msg = '找不到可用的模型「' + model + '」（404）：免費模型可能已下架，或你的 OpenRouter 隱私設定排除了所有提供者。' +
      '可到程式最上方改 AI_MODEL_PRIMARY／AI_MODEL_FALLBACK，或到 https://openrouter.ai/settings/privacy 檢查免費模型的設定。';
  } else if (code === 403) {
    msg = 'OpenRouter 拒絕這次請求（403）：可能是內容被安全機制擋下，或 key 設了用量上限。';
  } else if (code === 400) {
    msg = '請求格式有問題（400），可能是這個模型不支援某個選項。';
  } else if (code >= 500 || code === 408) {
    msg = 'OpenRouter 或模型暫時忙碌（HTTP ' + code + '），請稍後再試。';
  } else {
    msg = 'OpenRouter 錯誤（HTTP ' + code + '）。';
  }
  const err = new Error(msg + tail);
  err.stopRetry = stopRetry;
  return err;
}

/** 單獨測試 OpenRouter key 是否可用（不會印出 key） */
function testAiKey() {
  Logger.log(callAi_('請只回答：OK'));
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
    const label = symbolWikiLink_(it);
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
