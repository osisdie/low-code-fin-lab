/**
 * 每日財經報告 — Google Apps Script
 *
 * 流程：讀「數據」分頁（GOOGLEFINANCE 公式算出來的數字）
 *       → 補抓 BTC（CoinGecko）與黃金／美債殖利率（Yahoo Finance 公開圖表端點）
 *       → 交給 OpenRouter 的免費 AI 模型整理成繁體中文日報（數字只來自資料，LLM 不負責查數字）
 *       → 加上秘書待辦（待確認草稿、需人工的信、昨天處理過的信），合併成一封「今日總覽」
 *       → 依你選的版面（Templates.gs）用你自己的 Gmail 寄給自己
 *       → 數字記一列到「日報紀錄」分頁；同一份日報另存成 Markdown 到雲端硬碟「FinLab-Vault/日報」
 *       → 日報裡第一次出現的追蹤項目，自動在「FinLab-Vault/標的」建一篇筆記（Vault.gs）
 *
 * 安全：
 *   - 寄信用 MailApp，以「你自己的 Google 帳號」寄出，完全不需要密碼。
 *   - AI 服務的 key（OpenRouter、Gemini 或 OpenAI）放在「專案設定 → 指令碼屬性」(AI_API_KEY；舊版的 OPENROUTER_API_KEY 也認得)，不要寫進這份程式碼。
 *     程式不會把 key 印到紀錄、對話框或信件裡。
 *
 * 指令碼屬性（專案設定 → 指令碼屬性；全部都可以不設，key 由一鍵設定幫你存）：
 *   AI_API_KEY          AI 服務的 key，依開頭自動判斷：sk-or- ＝OpenRouter（課堂主線，免費模型）；AIza ＝Gemini（Google AI Studio 免費額度）；
 *                       其他 sk- 開頭（例如 sk-proj-）＝OpenAI（付費，講師緊急備案）
 *   OPENROUTER_API_KEY  舊版存 key 的名稱，還是認得（一鍵設定貼新 key 時會改存到 AI_API_KEY）
 *   AI_PROVIDER         （選填）openrouter／gemini／openai：不想依 key 開頭自動判斷時才設
 *   AI_BASE_URL         （選填）換 API 網址（例如相容 OpenAI 格式的服務）；可以寫到 /v1 或完整的 /chat/completions
 *   AI_MODEL／AI_FALLBACK_MODEL  （選填）換主要／最後備用模型（三種服務都適用）
 *   AI_ENABLED          true／false：要不要呼叫 AI；false 時 0 次 AI 呼叫，只寄原始數據
 *   REPORT_TO           收件信箱，不填就寄給自己
 *   REPORT_TEMPLATE     信件版面 compact／full／table（用選單「🎨 選擇信件版面」設定比較方便）
 *   REPORT_HOUR         每天幾點寄出（0～23 的整數，台灣時間，建議 6～11），不設就是 TRIGGER_HOUR（7 點）；改完要再點一次選單 ③ 才會生效
 *   OPENROUTER_MODEL／OPENROUTER_SECONDARY_MODEL／OPENROUTER_FALLBACK_MODEL  換主要／第二／最後備用的免費模型，不用改程式
 *   VAULT_SYMBOL_FOLDER 知識庫裡追蹤項目筆記的資料夾名稱（預設「標的」，見 Vault.gs）
 *   VAULT_ROOT_ID       程式自動寫入的 FinLab-Vault 資料夾 ID，不用自己填
 *
 * 第一次使用：重新整理試算表 → 上方選單「📰 我的 AI 助理」→ ① 一鍵設定（OpenRouter key 可留空，改走「關閉 AI」）→ ② 立即寄一封今日總覽 → ③ 開啟每日自動寄送
 *   （不用打開這個編輯器；手動執行時依序跑 setupWizard → sendDailyReport → setupDailyTrigger 也可以）
 * 詳細點擊步驟見 README.md 與 docs/student/student-stage-2-lab.md
 * 秘書功能在 Secretary.gs；建立知識庫資料夾與起始檔案在 Vault.gs；信件版面在 Templates.gs。
 */

// ============ 可調整的設定 ============
const SHEET_NAME = '數據';          // 放 GOOGLEFINANCE 公式的分頁名稱
// AI 模型：免費模型常常換，名單以 https://openrouter.ai/models?max_price=0 為準（查證日期 2026-11-26）
// 依序試：AI_MODEL_PRIMARY → AI_MODEL_SECONDARY → AI_MODEL_FALLBACK；失敗（錯誤、空白回覆、429 額度用完）才換下一個；都失敗就只寄原始數據
// 為什麼不再用 openrouter/free 當主要模型：它常挑到「一定要先思考」的推理模型，實測判讀與回覆各要 1～2 分鐘（甚至把額度想光、回覆空白），
//   一堂課按好幾次 ⑤ 才處理得完。2026-11-26 的免費模型清單（GET https://openrouter.ai/api/v1/models，共 12 個）每個都支援推理，
//   沒有「完全不推理」的免費模型，所以挑「思考可以關掉」的：Gemma 4 31B（官方說明：configurable thinking/reasoning mode）、
//   Ling 3.2 Flash（hybrid reasoning），並送 reasoning: { effort: 'none' } 關掉思考。
// 想換模型：直接改這三行，或在指令碼屬性設 OPENROUTER_MODEL／OPENROUTER_SECONDARY_MODEL／OPENROUTER_FALLBACK_MODEL 覆寫（不用改程式）
const AI_MODEL_PRIMARY = 'google/gemma-4-31b-it:free';       // 主要：中文穩定、可以關掉思考
const AI_MODEL_SECONDARY = 'inclusionai/ling-3.2-flash:free'; // 第二：可以關掉思考的 flash 模型
const AI_MODEL_FALLBACK = 'openrouter/free';                 // 最後備用：OpenRouter 自動挑一個當下可用的免費模型（可能比較慢）
const AI_KEY_PROP = 'AI_API_KEY';                      // key 存在指令碼屬性的名稱（OpenRouter、Gemini、OpenAI 都存這裡）
const LEGACY_AI_KEY_PROP = 'OPENROUTER_API_KEY';       // 舊版的名稱：還是認得
// Gemini（學員的免費備案）：Google AI Studio 的 key（AIza 開頭），走 Gemini 的「OpenAI 相容」網址。
// 2026-11-26 實測：3.5 Flash-Lite 判讀不到 1 秒、回覆約 1.5 秒，JSON 模式可用、回覆是繁體中文；2.5 Flash-Lite 新帳號已不能用（404），
// 2.5 Flash 官方標示已淘汰。Gemini 3 以後的模型不能完全關掉思考，只能設最低的 minimal（2.x 用 none）。
// 免費額度以官網為準；免費方案的輸入可能被 Google 用來改善產品，課堂範例信件一律虛構。
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_KEYS_PAGE = 'https://aistudio.google.com/apikey';
const GEMINI_MODEL_PRIMARY = 'gemini-3.5-flash-lite';
const GEMINI_MODEL_FALLBACK = 'gemini-3.5-flash';
const GEMINI_REASONING_EFFORT = 'minimal';
// OpenAI（講師緊急備案，付費）：OpenRouter 免費模型塞車時，① 改貼 OpenAI key 就會自動切過去
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_KEYS_PAGE = 'https://platform.openai.com/api-keys';
const OPENAI_MODEL_PRIMARY = 'gpt-4.1-mini';
const OPENAI_MODEL_FALLBACK = 'gpt-4o-mini';
const AI_ENABLED_PROP = 'AI_ENABLED';                   // true／false（也接受 on／off）；沒設時：有 key 就開啟，沒有就關閉
const AI_OFF_SUMMARY = 'AI 摘要已關閉，以下為原始數據。';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEYS_PAGE = 'https://openrouter.ai/settings/keys';
// 每次 AI 回覆最多幾個 token（max_tokens）：只是防止回覆無限長，要遠大於實際輸出。
// 推理模型的「思考」也算在 max_tokens 裡（OpenRouter 文件，查證日期 2026-11-26）：openrouter/free 常會挑到推理模型，
// 實測判讀上限 800 時，思考把額度用光，回覆是空的（finish_reason: length），所以放寬到 4000 以上。
const AI_MAX_TOKENS = { summary: 6000, triage: 4000, reply: 4000, check: 2000 };
// 關掉思考（OpenRouter 的 reasoning 物件：effort 可為 max／xhigh／high／medium／low／minimal／none，查證日期 2026-11-26）。
// 「一定要思考」的模型會回 400（實測 baidu/ernie-5.5-flash-preview:free：Reasoning is mandatory…cannot be disabled），
// 這時會自動改用不帶 max_tokens／reasoning 的請求再試一次（見 callAi_）。
const AI_REASONING = { effort: 'none' };
// 請 OpenRouter 優先挑「回應快」的提供者（provider.sort：price／throughput／latency，查證日期 2026-11-26）；不支援的模型會忽略
const AI_PROVIDER_SORT = 'latency';
const AI_SUMMARY_DEADLINE_MS = 200000; // 日報摘要：主要模型花超過 200 秒才失敗，就不再試備用模型，直接寄原始數據
// 每天幾點寄出的預設值（依 appsscript.json 的時區：Asia/Taipei）；想改時間不用改程式，設指令碼屬性 REPORT_HOUR 再點一次 ③
const TRIGGER_HOUR = 7;
const REPORT_HOUR_PROP = 'REPORT_HOUR';
// 日報上的日期用台灣時間（與 appsscript.json 的 timeZone 一致）
const REPORT_TIMEZONE = 'Asia/Taipei';
// 星期幾自己對照，不用格式字 E：真正的 Apps Script 會把 E 印成英文（Thu）。u 是 1=週一 … 7=週日
const WEEKDAYS_ZH = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
// 「日報紀錄」的「更新方式」欄與 Markdown 的 trigger: 欄位會寫這三種之一
const RUN_BY_SCHEDULE = '每日排程';
const RUN_BY_SEND = '手動寄送';
const RUN_BY_REFRESH = '手動更新';
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

// 「數據」分頁某列缺現價（#N/A）或缺漲跌時，改用 Yahoo Finance 補抓（失敗就維持「查無資料」）
// 匯率（CURRENCY:USDTWD 這種）會自動換成 Yahoo 的 USDTWD=X，不用列在這裡
// 為什麼匯率要補：GOOGLEFINANCE 不接受 CURRENCY: 代碼加 "price" 屬性（2026-11-26 實測，錯誤訊息是
// parameter 2 value is invalid for the symbol specified），closeyest／changepct 也拿不到。範本 C 欄用
// =IFERROR(GOOGLEFINANCE(B2,"price"),GOOGLEFINANCE(B2)) 讓匯率也有現價；漲跌則由下面的 sheetFallback_ 向 Yahoo 補。
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
  '5. 【匯率】段落要把 fxPairs 列出的每一組匯率都寫出來，一組一行，不可省略。【黃金】與【比特幣】段落也一定要寫，寫出 price（price 是 null 就寫「查無資料」）；changePct 是 null 時寫「漲跌查無資料」，絕對不要自己算或猜百分比。其他段落的重點總數控制在 8～10 項，優先呈現漲跌幅較大的。',
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
/** 打開試算表時 Google 會自動執行：在上方加「📰 我的 AI 助理」選單。每一項後面的英文字是按下去會執行的函式名稱 */
function onOpen() {
  // 選單上的時間跟著 REPORT_HOUR；讀不到屬性就顯示預設時間，選單照樣出現
  let hour = TRIGGER_HOUR;
  try {
    hour = reportHour_();
  } catch (err) {
    // 開啟試算表時的權限比較少，讀不到就算了
  }
  SpreadsheetApp.getUi().createMenu('📰 我的 AI 助理')
    .addItem('① 一鍵設定（第一次用）', 'setupWizard')
    .addItem('② 立即寄一封今日總覽', 'menuSendNow')
    .addItem('↻ 只更新數字與知識庫（不寄信）', 'menuRefreshNow')
    .addItem('🎨 選擇信件版面', 'menuChooseTemplate')
    .addItem('🎨 寄三種版面樣張給我', 'menuSendSamples')
    .addSeparator()
    .addItem('③ 開啟每日 ' + hourLabel_(hour) + ' 自動寄送', 'menuEnableDaily')
    .addItem('④ 停止每日自動寄送', 'menuDisableDaily')
    .addSeparator()
    .addItem('⑤ 秘書：處理「AI秘書」標籤的信', 'menuProcessSecretary')
    .addItem('⑥ 秘書：開啟每小時自動處理', 'menuEnableSecretary')
    .addItem('⑦ 秘書：停止自動處理', 'menuDisableSecretary')
    .addToUi();
}

/** 一鍵設定：收 AI 服務的 key（OpenRouter、Gemini 或 OpenAI，依開頭自動判斷；可留空以關閉 AI）→ 有 key 且 AI 開啟時才測試 → 建立知識庫資料夾與起始檔案 */
function setupWizard() {
  // 一次確認所有權限：授權畫面上沒勾到的，這裡會再跳出來請你補勾
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  runMenu_('一鍵設定', setupWizardSteps_);
}

/** 一鍵設定的實際步驟（由 setupWizard 透過 runMenu_ 執行，出錯會變成中文對話框並記進「錯誤紀錄」） */
function setupWizardSteps_() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const hasKey = !!aiKey_();
  const res = ui.prompt('一鍵設定：AI 服務的 key（可留空）',
    (hasKey ? '已經設定過 key（' + aiProviderInfo_().name + '）。要換新的才貼。\n\n' : '') +
    '課堂用 OpenRouter（免費）：用 Google 帳號登入 https://openrouter.ai ，到 Keys 頁面（' + OPENROUTER_KEYS_PAGE + '）按「Create」建立 key，複製後貼在下面。\n' +
    '免費模型不用綁信用卡。OpenRouter 的 key 是 sk-or- 開頭的一長串字。\n' +
    '也可以貼 Google AI Studio 的 Gemini key（AIza 開頭，免費額度），或講師現場提供的臨時 key；程式會自動認出是哪一家。\n' +
    (hasKey ? '留空按「確定」會問你要沿用舊 key，還是刪掉它、關閉 AI 摘要。\n'
      : '還沒有 key、或想先只用原始數據的話，這裡留空按「確定」即可：程式會關閉 AI 摘要，仍會建立知識庫資料夾。\n') +
    'key 只會存進這份檔案的「指令碼屬性」，不會出現在表格裡，分享表格也看不到。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().replace(/\s+/g, '');
  if (key && !looksLikeAiKey_(key)) {
    // 不要把貼上的內容顯示出來（可能是別的密碼）
    ui.alert('這看起來不是 AI 服務的 key',
      'OpenRouter 的 key 是「sk-or-」開頭的一長串字（' + OPENROUTER_KEYS_PAGE + '）；Gemini 的是「AIza」開頭；OpenAI 的是「sk-」開頭。請重新複製，再點一次「① 一鍵設定」。\n' +
      '剛剛貼的內容沒有存起來。', ui.ButtonSet.OK);
    return;
  }
  if (key) {
    props.setProperty(AI_KEY_PROP, key);
    props.deleteProperty(LEGACY_AI_KEY_PROP); // 舊名稱的 key 換成新的，免得兩把 key 混在一起
    // 依新 key 自動判斷服務：清掉手動指定的服務與網址（一步就能切換）
    props.deleteProperty('AI_PROVIDER');
    props.deleteProperty('AI_BASE_URL');
    props.setProperty(AI_ENABLED_PROP, 'true');
    // 舊版（Gemini）留下的設定用不到了，順手清掉
    props.deleteProperty('GEMINI_API_KEY');
    props.deleteProperty('GEMINI_MODEL');
  } else if (!hasKey) {
    props.setProperty(AI_ENABLED_PROP, 'false');
  } else {
    // 留空但原本有 key：問要沿用還是刪掉（例如講師的臨時 key 下課後就失效，學員選「否」就能乾淨關掉）
    const keep = ui.alert('要沿用現在的 key 嗎？',
      '這次沒有貼新的 key。目前存的是 ' + aiProviderInfo_().name + ' 的 key。\n\n' +
      '「是」：沿用這把 key。\n「否」：刪掉這把 key 並關閉 AI 摘要（每日總覽只寄原始數據；之後可以再點①貼上新的 key）。',
      ui.ButtonSet.YES_NO);
    if (keep === ui.Button.NO) clearAiKey_(props);
  }

  // AI 關閉（key 留空或 AI_ENABLED=false）就跳過測試：這一步完全不呼叫 AI 服務
  if (isAiEnabled_()) {
    try {
      callAi_('請只回答：OK', { maxTokens: AI_MAX_TOKENS.check });
    } catch (err) {
      ui.alert('key 測試失敗', err.message + '\n\n處理好之後，再點一次「① 一鍵設定」。', ui.ButtonSet.OK);
      return;
    }
  }

  let root;
  const upgrade = {};
  try {
    root = setupVault_(upgrade);
  } catch (err) {
    logError_('一鍵設定：建立知識庫資料夾', err);
    ui.alert('知識庫資料夾建立失敗',
      (aiKey_() ? 'AI 服務的 key 已經存好了，但' : '') +
      '在雲端硬碟建立「' + VAULT_ROOT_NAME + '」時出錯：\n' + err.message + '\n\n' +
      '最常見的原因是授權時沒有勾選雲端硬碟權限。請再點一次「① 一鍵設定」（key 留空就會沿用），授權畫面全部勾選後按「允許」。',
      ui.ButtonSet.OK);
    return;
  }
  const info = aiProviderInfo_();
  const costNote = { openai: '付費，用量記在這把 key 的 OpenAI 帳號；請在 OpenAI 後台設定用量上限', gemini: 'Google AI Studio 免費額度，以官網為準', openrouter: '免費模型' };
  const aiLine = isAiEnabled_()
    ? 'AI 服務：' + info.name + '（' + costNote[info.id] + '）。key 測試成功，AI 摘要已開啟。\n'
    : '目前 AI 摘要已關閉。每日總覽會寄出原始數據，並註明「' + AI_OFF_SUMMARY + '」。\n若要開啟，再點一次「① 一鍵設定」貼上 AI 服務的 key（OpenRouter、Gemini 或 OpenAI），或把指令碼屬性 AI_ENABLED 設為 true。\n';
  ui.alert('設定完成 ✅',
    aiLine +
    '已在你的雲端硬碟建立資料夾「' + root.getName() + '」（Obsidian 知識庫，Stage 3 會用到；追蹤項目筆記在「' + vaultSymbolFolder_() + '」）。\n\n' +
    (upgrade.upgraded.length ? '知識庫的起始檔已更新成新版（你沒改過的才換）：' + upgrade.upgraded.join('、') + '。\n\n' : '') +
    (upgrade.sideBySide.length ? '⚠️ 這些檔案你改過，所以沒有覆蓋；新版另外存成：' + upgrade.sideBySide.join('、') +
      '。請在 Obsidian 打開兩個檔案比較，把需要的部分複製到你的版本（或改用新版，再把舊檔刪掉、把新版改回原本的名稱）。\n\n' : '') +
    '下一步：選單「② 立即寄一封今日總覽」，到信箱看看。',
    ui.ButtonSet.OK);
}

/** 選單 ②：先確認權限都有勾，再寄一封今日總覽 */
function menuSendNow() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DAILY_SCOPES);
  runMenu_('寄出今日總覽', function () {
    const res = runDailyPipeline_({ sendMail: true, runBy: RUN_BY_SEND });
    SpreadsheetApp.getUi().alert(savedHeadline_(res, true) + '\n' + savedLines_(res));
  });
}

/** 選單 ↻：跑一樣的流程（抓數字、AI 摘要、日報紀錄、知識庫），但不寄信 */
function menuRefreshNow() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DAILY_SCOPES);
  runMenu_('更新數字與知識庫', function () {
    const res = runDailyPipeline_({ sendMail: false, runBy: RUN_BY_REFRESH });
    SpreadsheetApp.getUi().alert(savedHeadline_(res, false) + '\n' + savedLines_(res));
  });
}

/**
 * ② 與 ↻ 對話框的第一行：看「日報紀錄」與知識庫有沒有存成功來決定，不會失敗了還寫 ✅。
 * sent 為 true 表示信已經寄出（②），所以寫「已寄出」再補上沒存成功的部分。
 */
function savedHeadline_(res, sent) {
  const failed = (res.logError ? 1 : 0) + (res.vaultError ? 1 : 0);
  if (sent) {
    if (failed === 2) return '已寄出 ✅ 請到信箱查看。但 ⚠️「' + DAILY_LOG_SHEET + '」和知識庫都沒有更新成功：';
    if (failed === 1) return '已寄出 ✅ 請到信箱查看。但 ⚠️ 只有部分完成：';
    return '已寄出 ✅ 請到信箱查看。';
  }
  if (failed === 2) return '⚠️ 沒有更新成功（這次沒有寄信）：';
  if (failed === 1) return '⚠️ 部分完成（這次沒有寄信）：';
  return '已更新 ✅（這次沒有寄信）';
}

/** ② 與 ↻ 完成後的說明：存到哪裡、資料更新時間；沒存成功的也照實說 */
function savedLines_(res) {
  const lines = [
    '資料更新時間：' + res.ctx.updatedAt + '（台灣時間）',
    res.logError ? '⚠️ 沒寫進「' + DAILY_LOG_SHEET + '」：' + res.logError : '數字已記進「' + DAILY_LOG_SHEET + '」分頁（同一天只有一列，會更新成最新的）。',
    res.vaultError ? '⚠️ 沒存進知識庫：' + res.vaultError + '（點「① 一鍵設定」可重建資料夾）' : '日報已存進雲端硬碟「' + VAULT_ROOT_NAME + '/日報」。',
  ];
  return lines.join('\n');
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

/** 選單 🎨：輸入編號選版面，存進指令碼屬性 REPORT_TEMPLATE（只改排版，不影響數字） */
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

/** 選單 ③：建立每天 REPORT_HOUR 點（沒設就是 TRIGGER_HOUR）的自動寄送 */
function menuEnableDaily() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DAILY_SCOPES);
  runMenu_('開啟每日自動寄送', function () {
    const hour = setupDailyTrigger();
    const bad = reportHourRaw_() !== '' && !isValidHour_(reportHourRaw_());
    SpreadsheetApp.getUi().alert('已開啟 ✅ 之後每天 ' + hourLabel_(hour) + ' 左右自動寄出（Google 會在 ' + hourLabel_(hour) + '～' +
      hourLabel_(hour).replace(':00', ':59') + ' 之間執行）。\n\n' +
      (bad ? '⚠️ 指令碼屬性 ' + REPORT_HOUR_PROP + ' 不是 0～23 的整數，先用預設 ' + hourLabel_(TRIGGER_HOUR) + '。\n' : '') +
      '想換時間：到「專案設定 → 指令碼屬性」把 ' + REPORT_HOUR_PROP + ' 設成 0～23 的整數（例如 6），再點一次「③」才會生效。' +
      '選單上的時間要重新整理試算表才會跟著變。');
  });
}

/** 選單 ④：刪掉自動寄送的觸發器（不會刪任何資料或信件） */
function menuDisableDaily() {
  runMenu_('停止每日自動寄送', function () {
    removeTriggers_('sendDailyReport');
    SpreadsheetApp.getUi().alert('已停止每日自動寄送。');
  });
}

// ============ 主流程（設定觸發器時請選這個）============
/**
 * 每天的觸發器執行的就是這個函式：跑一次今日總覽並寄出。
 * 觸發器會傳入事件資料 e，所以有 e 就記成「每日排程」；在編輯器直接按「執行」沒有 e，記成「手動寄送」。
 */
function sendDailyReport(e) {
  runDailyPipeline_({ sendMail: true, runBy: e ? RUN_BY_SCHEDULE : RUN_BY_SEND });
}

/**
 * 今日總覽主流程（② 寄送、↻ 更新、每日排程共用這一個）：
 * 收集資料（含 AI 摘要）→ sendMail 為 true 才依版面排版、用 MailApp 寄到 REPORT_TO（沒設就是你自己）
 * → 記一列「日報紀錄」→ 存一份 Markdown 到知識庫。
 * 回傳 { ctx, logError, vaultError }：後兩個是沒存成功的原因（成功就是空字串）。
 */
function runDailyPipeline_(opts) {
  const ctx = buildBriefingContext_(opts.runBy);
  if (opts.sendMail) {
    const out = renderBriefing_(getTemplateKey_(), ctx);
    MailApp.sendEmail({ to: getReportTo_(), subject: out.subject, body: out.text, htmlBody: out.html });
  }

  // 以下失敗都不影響寄信（例如還沒跑過一鍵設定）；原因記在執行紀錄，選單也會顯示
  const res = { ctx: ctx, logError: '', vaultError: '' };
  try {
    appendDailyLog_(ctx);
  } catch (err) {
    res.logError = err.message;
    console.warn('未寫入「' + DAILY_LOG_SHEET + '」：' + err.message);
    logError_('日報紀錄', err); // 每日排程沒有對話框，記進「錯誤紀錄」分頁才看得到
  }
  try {
    // 往前找最近一篇日報，今天的日報連過去；寫完再把那篇的「後一天」換成連到今天
    ctx.prevDate = findPrevReportDate_(ctx.isoDate);
    writeVaultFile_('日報', ctx.isoDate + ' 財經日報.md', buildReportMarkdown_(ctx.isoDate, ctx.data, ctx.summary, ctx.secretary, ctx));
    linkPrevReport_(ctx.prevDate, ctx.isoDate);
  } catch (err) {
    res.vaultError = err.message;
    console.warn('日報未存進知識庫：' + err.message);
    logError_('日報存知識庫', err);
  }
  if (!res.vaultError) {
    // 標的筆記：第一次出現的項目自動建立；你自己寫過的內容不會被改。失敗不影響日報
    try {
      // 「日報紀錄」沒寫成功（或讀不到）時，走勢圖資料不完整：已經有的標的筆記不動，只建新的
      let history = null;
      if (!res.logError) {
        try {
          history = readDailyLogHistory_(SYMBOL_CHART_DAYS);
        } catch (err) {
          console.warn('讀不到「' + DAILY_LOG_SHEET + '」，標的筆記這次不更新走勢圖：' + err.message);
        }
      }
      ensureSymbolNotes_(ctx.data.items, history || [], history === null);
    } catch (err) {
      console.warn('標的筆記沒有建立：' + err.message);
      logError_('標的筆記', err);
    }
  }
  return res;
}

/** 收集今日總覽需要的一切：財經數字、AI 摘要、秘書待辦；runBy 是「更新方式」（樣張不寫紀錄，可以不給） */
function buildBriefingContext_(runBy) {
  const now = new Date();
  const dateStr = Utilities.formatDate(now, REPORT_TIMEZONE, 'yyyy年M月d日') + '（' + zhWeekday_(now) + '）';
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
    // 資料更新時間（開始抓數字的那一刻）：給「日報紀錄」、信件頁尾看的，以及 Markdown 用的 ISO 格式（+08:00）
    updatedAt: Utilities.formatDate(now, REPORT_TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
    updatedIso: Utilities.formatDate(now, REPORT_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    runBy: runBy || '',
    data: data,
    summary: summary,
    secretary: secretary,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
  };
}

/** 目前選的版面；屬性沒設或填錯就用預設 DEFAULT_TEMPLATE（完整版） */
function getTemplateKey_() {
  const key = getProp_('REPORT_TEMPLATE');
  return REPORT_TEMPLATES[key] ? key : DEFAULT_TEMPLATE;
}

// ============ 日報紀錄（每天一列）============

/**
 * 依標題列對欄位寫入；新的追蹤項目（或舊表沒有的「更新時間」「更新方式」）會自動加在最右邊；
 * 同一天重跑會覆寫同一列，所以「更新時間」永遠是當天最後一次的時間
 */
function appendDailyLog_(ctx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DAILY_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DAILY_LOG_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['日期', '更新時間', '更新方式', '美股開盤']]);
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
  // 「更新時間」存成文字，才會照 yyyy-MM-dd HH:mm:ss 顯示，不會被試算表改成別的日期格式
  sheet.getRange(target, header.indexOf('更新時間') + 1).setNumberFormat('@');
  sheet.getRange(target, 1, 1, values.length).setValues([values]);
}

/**
 * 讀「日報紀錄」最近幾列（依日期由舊到新）：[{ date: 'yyyy-MM-dd', values: { USD_TWD: 32.5, USD_TWD_漲跌%: 0.3, … } }]。
 * 標的筆記的走勢圖用（只畫最近 days 個日曆天，多讀一些列，中間停過幾天也夠）；空白（查無資料）的格子保留成空字串，由畫圖的程式略過。
 */
function readDailyLogHistory_(days) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DAILY_LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const header = data[0].map(function (h) { return String(h); });
  return data.slice(1)
    .filter(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(String(r[0])); })
    .map(function (r) {
      const values = {};
      header.forEach(function (h, i) { if (i > 0) values[h] = r[i]; });
      return { date: String(r[0]), values: values };
    })
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
    .slice(-days * 2);
}

/** 一天一列：日期、更新時間與方式、各項數字與漲跌，以及秘書待辦數量（查無資料留空） */
function dailyLogRow_(ctx) {
  const row = {
    '日期': ctx.isoDate,
    '更新時間': ctx.updatedAt,
    '更新方式': ctx.runBy,
    '美股開盤': ctx.data.usMarketOpen ? '是' : '否',
  };
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
      // 現價或漲跌缺一個（舊範本的匯率 C 欄 #N/A，或新範本匯率只有現價），才去 Yahoo 補；股票 D、E 欄有值就不會多抓
      return price === null || changePct === null ? sheetFallback_(item, digits) : item;
    });
}

/** 這一列對應的 Yahoo 代碼：匯率 CURRENCY:USDTWD → USDTWD=X，其他查 YAHOO_FALLBACK；沒有對應就回傳空字串 */
function yahooSymbolFor_(symbol) {
  const sym = String(symbol).trim().toUpperCase();
  const fx = sym.match(/^CURRENCY:([A-Z]{3})([A-Z]{3})$/);
  return fx ? fx[1] + fx[2] + '=X' : (YAHOO_FALLBACK[sym] || '');
}

/**
 * 「數據」分頁缺數字時，若有對應的 Yahoo 代碼就補抓；沒有代碼或補不到就原樣回傳（信裡會寫「查無資料」）。
 *   - C 欄有現價、只缺漲跌（新範本的匯率：GOOGLEFINANCE 給不了前一收盤與漲跌）：保留 Google 的現價，只用 Yahoo 補前一收盤與漲跌
 *   - C 欄也是 #N/A（舊範本的匯率、查不到的代碼）：現價和漲跌都改用 Yahoo
 */
function sheetFallback_(item, digits) {
  const ySymbol = yahooSymbolFor_(item.symbol);
  if (!ySymbol) return item;
  const hasPrice = item.price !== null;
  try {
    const q = fetchYahooQuote_(ySymbol, digits);
    if (hasPrice) {
      return Object.assign({}, item, { prevClose: q.prevClose, changePct: q.changePct,
        source: q.changePct === null
          ? 'Google Finance（漲跌查無資料：Yahoo ' + ySymbol + ' ' + YAHOO_NO_PREV + '）'
          : 'Google Finance；漲跌由 Yahoo ' + ySymbol + ' 補' });
    }
    return Object.assign({}, item, { price: q.price, prevClose: q.prevClose, changePct: q.changePct,
      source: 'Yahoo Finance ' + ySymbol + '（Google Finance 查無資料，改用備援' + (q.changePct === null ? '；' + YAHOO_NO_PREV + '，漲跌查無資料' : '') + '）' });
  } catch (err) {
    console.warn('Yahoo 備援 ' + ySymbol + ' 失敗：' + err.message);
    return Object.assign({}, item, { source: hasPrice
      ? 'Google Finance（漲跌查無資料；Yahoo 備援 ' + ySymbol + ' 暫時無法取得）'
      : 'Google Finance（查無資料；Yahoo 備援也暫時無法取得）' });
  }
}

/**
 * BTC：先用 CoinGecko 公開端點（免 API key）；被限流（429）或暫時故障就等幾秒重試，
 * 還是不行就改用 Yahoo Finance 的 BTC-USD；都失敗才寫「查無資料」。
 * 錯誤碼只記到執行紀錄，不放進給 AI 的資料（不然摘要會把「429」當成數字寫進去）。
 */
const BTC_NAME = 'Bitcoin BTC/USD（24h）';               // CoinGecko 的漲跌是「過去 24 小時」
const BTC_NAME_YAHOO = 'Bitcoin BTC/USD（與前一 UTC 日收盤比）'; // Yahoo 的日 K 在 UTC 00:00 切日，不是 24 小時
const COINGECKO_RETRIES = 2;        // CoinGecko 失敗後再試幾次
const COINGECKO_RETRY_WAIT_MS = 3000; // 每次重試前等幾毫秒（3 秒）

function fetchBitcoin_() {
  const base = { name: BTC_NAME, symbol: 'BTC', key: 'BTC', prevClose: null }; // key 固定是 BTC，換來源也不會多一欄
  try {
    const cg = fetchCoinGeckoBtc_();
    return [Object.assign({}, base, { price: cg.price, changePct: cg.changePct, source: 'CoinGecko' })];
  } catch (err) {
    console.warn('CoinGecko 取不到比特幣，改用 Yahoo BTC-USD：' + err.message);
  }
  try {
    const q = fetchYahooQuote_('BTC-USD', 2);
    return [Object.assign({}, base, { name: BTC_NAME_YAHOO, price: q.price, prevClose: q.prevClose, changePct: q.changePct,
      source: 'Yahoo Finance BTC-USD（CoinGecko 暫時無法取得，改用備援；' +
        (q.changePct === null ? YAHOO_NO_PREV + '，漲跌查無資料' : '漲跌為與前一 UTC 日收盤相比') + '）' })];
  } catch (err) {
    console.warn('Yahoo BTC-USD 也失敗：' + err.message);
  }
  return [Object.assign({}, base, { name: 'Bitcoin BTC/USD', price: null, changePct: null, source: '暫時無法取得（CoinGecko 與 Yahoo 備援都沒有回應）' })];
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
      return { name: it.name, symbol: it.symbol, key: it.key, price: q.price, prevClose: q.prevClose, changePct: q.changePct,
        source: q.changePct === null ? 'Yahoo Finance（' + YAHOO_NO_PREV + '，漲跌查無資料）' : 'Yahoo Finance' };
    } catch (err) {
      console.warn('Yahoo ' + it.symbol + ' 失敗：' + err.message);
      return { name: it.name, symbol: it.symbol, key: it.key, price: null, prevClose: null, changePct: null, source: 'Yahoo Finance（暫時無法取得）' };
    }
  });
}

/**
 * Yahoo Finance 日 K → 現價、前一收盤、漲跌幅%（抓不到現價會丟出錯誤，由呼叫端決定怎麼處理）。
 * 只跟「緊接在前的那一根日 K」比：Yahoo 有時前一天的收盤是 null（2026-11-26 實測 BTC-USD），
 * 不能把 null 濾掉、拿更早一天的收盤來比，不然漲跌會算錯（實測把 +2.5% 算成 +1.35%）。
 * 股票、匯率只有交易日才有日 K，所以週一的前一根是週五，這樣是對的。
 * 前一根是 null、或跟今天隔太久（資料有缺口）時，前一收盤與漲跌回傳 null（信裡寫「查無資料」），不往前找。
 * meta.previousClose 在 range=5d 時不會出現；meta.chartPreviousClose 是「抓回來的第一根之前」的收盤，
 * 只有今天剛好是第一根時才等於前一天收盤，所以只在那種情況用它。
 */
const YAHOO_MAX_GAP_DAYS = 4;            // 前一根日 K 最多隔幾天（週末再加一天假日）；更久就當資料有缺口
const YAHOO_NO_PREV = '前一日收盤缺資料'; // 前一收盤拿不到時，來源欄的說明

function fetchYahooQuote_(symbol, digits) {
  // 抓最近 5 天的日 K；加上一般瀏覽器的 User-Agent，減少被這個非官方端點拒絕
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=5d&interval=1d';
  const res = UrlFetchApp.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const r = JSON.parse(res.getContentText()).chart.result[0];
  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const closes = r.indicators.quote[0].close || [];
  const last = closes.length - 1;
  // 今天這一根還沒有收盤值時，用 meta 的即時價
  const price = isNum_(closes[last]) ? closes[last] : meta.regularMarketPrice;
  if (last < 0 || !isNum_(price)) throw new Error('資料不足');

  let prev = null;
  if (last >= 1) {
    const gapDays = (ts[last] - ts[last - 1]) / 86400;
    if (isNum_(closes[last - 1]) && gapDays > 0 && gapDays <= YAHOO_MAX_GAP_DAYS) prev = closes[last - 1];
  } else if (isNum_(meta.chartPreviousClose)) {
    prev = meta.chartPreviousClose; // 只有今天這一根：chartPreviousClose 就是緊接在前的收盤
  }
  if (!prev) {
    console.warn('Yahoo ' + symbol + '：' + YAHOO_NO_PREV + '（前一根日 K 是空的或隔太久），漲跌寫查無資料');
    return { price: roundTo_(price, digits), prevClose: null, changePct: null };
  }
  return { price: roundTo_(price, digits), prevClose: roundTo_(prev, digits), changePct: round2_((price / prev - 1) * 100) };
}

/** 是有效的數字（Yahoo 的 null、undefined、NaN 都不算） */
function isNum_(v) {
  return typeof v === 'number' && isFinite(v);
}

/** AI 開不開：指令碼屬性 AI_ENABLED 為 false／off／0／no 就是關；沒設這個屬性時，有 AI 服務的 key 才算開。 */
function isAiEnabled_() {
  const flag = String(getProp_(AI_ENABLED_PROP) || '').trim().toLowerCase();
  if (flag === 'false' || flag === 'off' || flag === '0' || flag === 'no') return false;
  return !!aiKey_();
}

/** AI 服務的 key：AI_API_KEY，沒有就看舊版的 OPENROUTER_API_KEY */
function aiKey_() {
  return getProp_(AI_KEY_PROP) || getProp_(LEGACY_AI_KEY_PROP) || '';
}

/** 刪掉 key（新舊名稱都刪）、手動指定的服務與網址，並關閉 AI 摘要 */
function clearAiKey_(props) {
  [AI_KEY_PROP, LEGACY_AI_KEY_PROP, 'AI_PROVIDER', 'AI_BASE_URL'].forEach(function (name) { props.deleteProperty(name); });
  props.setProperty(AI_ENABLED_PROP, 'false');
}

/**
 * 用哪一個 AI 服務：指令碼屬性 AI_PROVIDER（openrouter／gemini／openai）優先；
 * 沒設就看 key 開頭：sk-or- ＝ OpenRouter；AIza ＝ Gemini；其他 sk- 開頭（例如 sk-proj-）＝ OpenAI；看不出來就當 OpenRouter。
 */
function aiProvider_() {
  const forced = String(getProp_('AI_PROVIDER') || '').trim().toLowerCase();
  if (forced === 'openrouter' || forced === 'openai' || forced === 'gemini') return forced;
  const key = aiKey_();
  if (/^sk-or-/.test(key)) return 'openrouter';
  if (/^AIza/.test(key)) return 'gemini';
  if (/^sk-/.test(key)) return 'openai';
  return 'openrouter';
}

/** 目前服務的名稱、網址、建 key 的頁面（AI_BASE_URL 可換網址：寫到 /v1 會自動補上 /chat/completions） */
function aiProviderInfo_() {
  const id = aiProvider_();
  const base = String(getProp_('AI_BASE_URL') || '').trim().replace(/\/+$/, '');
  const known = {
    openrouter: { name: 'OpenRouter', url: OPENROUTER_URL, keysPage: OPENROUTER_KEYS_PAGE, prefix: 'sk-or-' },
    gemini: { name: 'Gemini', url: GEMINI_URL, keysPage: GEMINI_KEYS_PAGE, prefix: 'AIza' },
    openai: { name: 'OpenAI', url: OPENAI_URL, keysPage: OPENAI_KEYS_PAGE, prefix: 'sk-' },
  }[id];
  const url = base ? (/\/chat\/completions$/.test(base) ? base : base + '/chat/completions') : known.url;
  return { id: id, name: known.name, url: url, keysPage: known.keysPage, prefix: known.prefix };
}

/**
 * 產生日報的摘要文字。
 * 安全：AI 關閉（沒有 key 或 AI_ENABLED=false）時直接回傳 AI_OFF_SUMMARY，0 次 AI 呼叫，不當成錯誤；
 * AI 失敗時退回「只寄原始數據」，信照樣寄得出去；摘要裡有原始數據找不到的數字，最前面加 ⚠️ 提醒。
 */
function buildAiSummary_(dateStr, data) {
  if (!isAiEnabled_()) return AI_OFF_SUMMARY;
  try {
    const summary = ensureFxLines_(toTraditional_(callAi_(buildPrompt_(dateStr, data), { maxTokens: AI_MAX_TOKENS.summary, deadline: Date.now() + AI_SUMMARY_DEADLINE_MS }), '日報摘要'), data);
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
    '若要使用⑤⑥，請先點「① 一鍵設定」貼上 AI 服務的 key（OpenRouter、Gemini 或 OpenAI），或把指令碼屬性 AI_ENABLED 設為 true。\n' +
    '若你改用 ChatGPT 或 Claude 的訂閱在瀏覽器整理信件，請不要使用這兩個選單。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============ AI 摘要（OpenRouter、Gemini 或 OpenAI）============
/** 把日期與今天的數據（JSON）填進 PROMPT_TEMPLATE；AI 看得到的數字只有這份資料 */
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
 * 呼叫 AI，回傳文字。依序試主要、第二、最後備用模型（aiModels_），失敗才換下一個；都失敗時丟出中文說明（呼叫端決定怎麼退場）。
 * opts.json = true 時要求回傳 JSON（秘書判讀信件用）；opts.maxTokens 是回覆長度上限（max_tokens）。
 * 同一個模型回覆空白（finish_reason: length，推理模型把額度用在思考）或回 400 時，先用不帶 max_tokens／reasoning 的請求再試一次，才換備用模型。
 * opts.deadline（時間戳，毫秒）：過了這個時間就不再試下一個模型，直接丟出錯誤（err.outOfTime = true），
 *   讓呼叫端乾淨退場（日報寄原始數據；秘書把信留到下次）。Apps Script 每次最多 6 分鐘，一次 AI 呼叫偶爾會卡好幾分鐘。
 * 安全：key 只放在 Authorization 標頭，錯誤訊息與紀錄都不會包含 key。
 */
function callAi_(prompt, opts) {
  opts = opts || {};
  const key = aiKey_();
  if (!isAiEnabled_()) {
    if (key) throw new Error('AI 摘要已關閉（指令碼屬性 AI_ENABLED 設為 false）。若要開啟，把它改成 true。');
    throw new Error('尚未設定 AI 服務的 key，請先點選單「① 一鍵設定」。');
  }
  const models = aiModels_();
  const reasons = [];
  let outOfTime = false;
  for (let i = 0; i < models.length; i++) {
    if (opts.deadline && Date.now() > opts.deadline) {
      reasons.push('時間不夠，' + (i === 0 ? '這次不呼叫 AI' : '沒有改用備用模型'));
      outOfTime = true;
      break;
    }
    try {
      try {
        return callAiOnce_(key, models[i], prompt, opts);
      } catch (first) {
        // 推理模型把額度用在思考、回覆空白（length），或模型不接受 max_tokens／reasoning 欄位（400）：
        // 同一個模型改用「不帶這些欄位」的請求再試一次；時間不夠就不試
        if (!(first.emptyLength || first.badRequest) || (opts.deadline && Date.now() > opts.deadline)) throw first;
        console.warn('AI 模型「' + models[i] + '」' + (first.emptyLength ? '回覆空白（思考用光額度）' : '不接受部分欄位') + '，不帶 max_tokens／reasoning 再試一次');
        return callAiOnce_(key, models[i], prompt, Object.assign({}, opts, { plain: true }));
      }
    } catch (err) {
      reasons.push(['主要模型', '第二個模型', '備用模型'][Math.min(i, 2)] + '「' + models[i] + '」：' + err.message);
      if (err.stopRetry) break; // 例如 key 無效：換模型也沒用
      if (i < models.length - 1) console.warn('AI 模型「' + models[i] + '」失敗，改用下一個模型「' + models[i + 1] + '」：' + err.message);
    }
  }
  const err = new Error('AI 暫時無法使用。' + reasons.join('；'));
  err.outOfTime = outOfTime;
  throw err;
}

/**
 * 要依序嘗試的模型；指令碼屬性可覆寫；重複的只試一次。
 *   OpenRouter：主要 → 第二 → 最後備用（AI_MODEL／OPENROUTER_MODEL、OPENROUTER_SECONDARY_MODEL、AI_FALLBACK_MODEL／OPENROUTER_FALLBACK_MODEL）
 *   Gemini：gemini-3.5-flash-lite → gemini-3.5-flash（AI_MODEL、AI_FALLBACK_MODEL）
 *   OpenAI：gpt-4.1-mini → gpt-4o-mini（AI_MODEL、AI_FALLBACK_MODEL）
 */
function aiModels_() {
  const provider = aiProvider_();
  const list = provider === 'openai'
    ? [getProp_('AI_MODEL') || OPENAI_MODEL_PRIMARY, getProp_('AI_FALLBACK_MODEL') || OPENAI_MODEL_FALLBACK]
    : provider === 'gemini'
    ? [getProp_('AI_MODEL') || GEMINI_MODEL_PRIMARY, getProp_('AI_FALLBACK_MODEL') || GEMINI_MODEL_FALLBACK]
    : [getProp_('AI_MODEL') || getProp_('OPENROUTER_MODEL') || AI_MODEL_PRIMARY, getProp_('OPENROUTER_SECONDARY_MODEL') || AI_MODEL_SECONDARY,
      getProp_('AI_FALLBACK_MODEL') || getProp_('OPENROUTER_FALLBACK_MODEL') || AI_MODEL_FALLBACK];
  return list.filter(function (m, i) { return m && list.indexOf(m) === i; });
}

/** AI 服務的 key 大致長這樣：sk- 開頭（OpenRouter 是 sk-or-，OpenAI 例如 sk-proj-）或 AIza 開頭（Gemini）、沒有空白；只做寬鬆檢查，真正能不能用由測試呼叫決定 */
function looksLikeAiKey_(key) {
  return /^(sk-[A-Za-z0-9_-]{10,}|AIza[A-Za-z0-9_-]{20,})$/.test(String(key));
}

/**
 * 一次請求的內容（依服務不同）：
 *   OpenRouter：帶 provider.sort、reasoning（OpenRouter 才有的欄位）與 max_tokens
 *   OpenAI：不能帶 OpenRouter 的欄位（未知參數會回 400）；gpt-5／o 系列用 max_completion_tokens，其他用 max_tokens
 *   Gemini（OpenAI 相容網址）：max_tokens＋最上層的 reasoning_effort：Gemini 3 以後是 minimal（不能完全關掉思考），2.x 是 none
 * opts.plain：重試時不帶長度上限與推理設定（最單純的請求）；Gemini 連 JSON 模式也不帶（文件沒寫 json_object，實測可用；萬一回 400 就改靠 parseJson_ 從文字取出）
 */
function aiPayload_(provider, model, prompt, opts) {
  const payload = { model: model, messages: [{ role: 'user', content: prompt }] };
  const limit = opts.maxTokens || AI_MAX_TOKENS.check;
  if (provider === 'openai') {
    if (!opts.plain) payload[/^(gpt-5|o\d)/.test(model) ? 'max_completion_tokens' : 'max_tokens'] = limit;
  } else if (provider === 'gemini') {
    if (opts.plain) return payload;
    payload.max_tokens = limit;
    payload.reasoning_effort = /^gemini-2\./.test(model) ? 'none' : GEMINI_REASONING_EFFORT;
  } else {
    payload.provider = { sort: AI_PROVIDER_SORT };
    if (!opts.plain) {
      payload.max_tokens = limit;
      payload.reasoning = AI_REASONING;
    }
  }
  if (opts.json) payload.response_format = { type: 'json_object' };
  return payload;
}

/** 呼叫一次指定模型（OpenRouter、Gemini 或 OpenAI）；任何失敗都丟出學員看得懂的中文錯誤 */
function callAiOnce_(key, model, prompt, opts) {
  const info = aiProviderInfo_();
  const headers = { Authorization: 'Bearer ' + key };
  if (info.id === 'openrouter') {
    // 選填的來源標示；hidden 代表不要出現在 OpenRouter 公開排行榜（Gemini、OpenAI 不用、也不送）
    headers['HTTP-Referer'] = 'https://github.com/osisdie/low-code-fin-lab';
    headers['X-OpenRouter-Title'] = 'low-code-fin-lab';
    headers['X-OpenRouter-App-Visibility'] = 'hidden';
  }
  let res;
  try {
    res = UrlFetchApp.fetch(info.url, {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(aiPayload_(info.id, model, prompt, opts)),
      // 出錯時不要直接丟出英文例外，交給下面翻成中文說明
      muteHttpExceptions: true,
    });
  } catch (err) {
    throw new Error('連不上 ' + info.name + '（' + err.message + '），請稍後再試。');
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
  if (!text) {
    const empty = new Error('回傳空白（結束原因：' + (reason || '未知') + '），請稍後再試。');
    empty.emptyLength = reason === 'length'; // 推理模型把 max_tokens 用在思考：呼叫端會不帶上限再試一次
    throw empty;
  }
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

/** 把 AI 服務（OpenRouter、Gemini 或 OpenAI）的 HTTP 錯誤翻成學員看得懂的話（回傳 Error；body 只取服務的錯誤說明，不含 key） */
function openRouterHttpError_(code, body, model) {
  const info = aiProviderInfo_();
  const openai = info.id === 'openai';
  // 原始訊息只留前 160 個字：看得出原因，對話框又不會太長
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    const e = (Array.isArray(parsed) ? parsed[0] || {} : parsed).error; // Gemini 有時回 [{ error: … }]
    detail = String((e && e.message) || '').slice(0, 160);
  } catch (err) {
    detail = String(body || '').slice(0, 160);
  }
  const tail = detail ? '（原始訊息：' + detail + '）' : '';
  let msg;
  let stopRetry = false;
  // Gemini 的 key 錯誤回 400（API_KEY_INVALID），不是 401
  const badKey = code === 401 || (info.id === 'gemini' && code === 400 && /API_KEY_INVALID|API key not valid/i.test(String(body || '')));
  if (badKey) {
    msg = info.name + ' key 無效（' + code + '）：請確認 key 有完整貼上（' + info.prefix + ' 開頭、沒有少字），或到 ' + info.keysPage +
      ' 重新建立一把，再點「① 一鍵設定」貼上新的。';
    stopRetry = true;
  } else if (code === 429 && info.id === 'gemini') {
    // Gemini 免費額度：每分鐘或每天的請求上限；換備用模型再試，都失敗就交給人處理
    msg = 'Gemini 免費額度暫時用完（429）：可能是每分鐘或每天的上限，等一下再試，或明天再處理。';
  } else if (code === 429 && openai) {
    // OpenAI：每分鐘上限或帳戶額度／用量上限（insufficient_quota）；換備用模型再試，都失敗就交給人處理
    msg = /insufficient_quota/.test(String(body || ''))
      ? 'OpenAI 帳戶額度用完或達到用量上限（429）：請到 OpenAI 後台確認付款與用量上限。'
      : 'OpenAI 暫時太多請求（429）：等一分鐘再試。';
  } else if (code === 429 && isFreeDailyLimit_(body)) {
    // 每天的免費額度是整個帳號共用，換備用模型也一樣會被擋，直接停
    msg = '今天的免費額度用完了（429）。免費模型每天約 50 次（以官網為準），整個帳號共用，' +
      '台灣時間早上 8 點（UTC 00:00）重置，明天再試。';
    stopRetry = true;
  } else if (code === 429) {
    msg = '免費額度暫時用完（429）。免費模型每分鐘約 20 次、每天約 50 次（以官網為準），' +
      '每天台灣時間早上 8 點（UTC 00:00）重置；等一分鐘再試，整天都失敗就明天再試。';
  } else if (code === 402 && info.id === 'openrouter') {
    msg = 'OpenRouter 帳戶點數不足（402）：免費模型本來不用點數，請到 openrouter.ai 的 Credits 頁確認餘額不是負數。';
    stopRetry = true;
  } else if (code === 404 && info.id !== 'openrouter') {
    msg = '找不到模型「' + model + '」（404）：請確認指令碼屬性 AI_MODEL／AI_FALLBACK_MODEL 的模型名稱。';
  } else if (code === 404) {
    msg = '找不到可用的模型「' + model + '」（404）：免費模型可能已下架，或你的 OpenRouter 隱私設定排除了所有提供者。' +
      '可到程式最上方改 AI_MODEL_PRIMARY／AI_MODEL_SECONDARY／AI_MODEL_FALLBACK，或到 https://openrouter.ai/settings/privacy 檢查免費模型的設定。';
  } else if (code === 403) {
    msg = info.name + ' 拒絕這次請求（403）：可能是內容被安全機制擋下，或 key 設了用量上限。';
  } else if (code === 400) {
    msg = '請求格式有問題（400），可能是這個模型不支援某個選項。';
  } else if (code >= 500 || code === 408) {
    msg = info.name + ' 或模型暫時忙碌（HTTP ' + code + '），請稍後再試。';
  } else {
    msg = info.name + ' 錯誤（HTTP ' + code + '）。';
  }
  const err = new Error(msg + tail);
  err.badRequest = code === 400 && !badKey; // 可能是模型不接受 max_tokens／reasoning：呼叫端會用單純的請求再試一次
  err.stopRetry = stopRetry;
  return err;
}

/** 單獨測試 AI 服務的 key 是否可用（不會印出 key） */
function testAiKey() {
  Logger.log(callAi_('請只回答：OK', { maxTokens: AI_MAX_TOKENS.check }));
}

// ============ 排程 ============
/**
 * 執行一次即可：建立每天 REPORT_HOUR 點（沒設就是 TRIGGER_HOUR）寄信的觸發器（先刪舊的避免重複）。
 * 觸發器建立時就記住了時間，之後改 REPORT_HOUR 要再執行一次（選單 ③）才會換時間。回傳設定的小時。
 */
function setupDailyTrigger() {
  // 觸發器在背景執行時沒辦法跳授權，所以建立前先確認權限都有勾
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DAILY_SCOPES);
  const hour = reportHour_();
  removeTriggers_('sendDailyReport');
  ScriptApp.newTrigger('sendDailyReport').timeBased().everyDays(1).atHour(hour).create();
  return hour;
}

/** 每天寄出的小時：指令碼屬性 REPORT_HOUR（0～23 的整數）；沒設或填錯就用 TRIGGER_HOUR，填錯會在執行紀錄留一行提醒 */
function reportHour_() {
  const s = reportHourRaw_();
  if (!s) return TRIGGER_HOUR;
  if (isValidHour_(s)) return Number(s);
  console.warn('指令碼屬性 ' + REPORT_HOUR_PROP + '「' + s + '」不是 0～23 的整數，改用預設 ' + TRIGGER_HOUR + ' 點');
  return TRIGGER_HOUR;
}

/** REPORT_HOUR 填的字（去掉前後空白）；沒設就是空字串 */
function reportHourRaw_() {
  return String(getProp_(REPORT_HOUR_PROP) || '').trim();
}

/** 是不是 0～23 的整數（接受「7」「07」，不接受「7.5」「abc」「25」） */
function isValidHour_(s) {
  return /^\d{1,2}$/.test(s) && Number(s) <= 23;
}

/** 7 →「07:00」 */
function hourLabel_(h) {
  return (h < 10 ? '0' : '') + h + ':00';
}

/** 刪掉某個函式的所有觸發器（重新開啟前先清掉，才不會一天寄兩封） */
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

/** 把常見的權限錯誤翻成中文並附上解法；其他錯誤原樣顯示 */
function friendlyError_(err) {
  const msg = String((err && err.message) || err);
  if (/authoriz|permission|not sufficient|權限/i.test(msg)) {
    return '權限不足：' + msg + '\n\n請點「① 一鍵設定」重新授權，授權畫面的權限全部勾選後按「允許」。';
  }
  return msg;
}

/** 記到執行紀錄與「錯誤紀錄」分頁：只記在做什麼和錯誤訊息，不會記 key；這裡自己出錯也不會往外丟 */
function logError_(where, err) {
  try {
    console.error(where + '：' + ((err && err.stack) || err));
  } catch (e) {
    // 印不出來就算了
  }
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

/** 讀一個指令碼屬性；沒設就回傳 null */
function getProp_(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

/** 儲存格是數字才用（#N/A、空白、文字都當成查無資料）；digits 預設 2 位小數 */
function numOrNull_(v, digits) {
  return typeof v === 'number' && isFinite(v) ? roundTo_(v, digits === undefined ? 2 : digits) : null;
}

/** 四捨五入到小數 2 位 */
function round2_(v) {
  return roundTo_(v, 2);
}

/** 四捨五入到小數 digits 位；不是數字就回傳 null（信裡會寫「查無資料」，不會補數字） */
function roundTo_(v, digits) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/** 台灣時間的星期幾 →「週四」（用 u 的數字對照，不受 Apps Script 語系影響） */
function zhWeekday_(now) {
  return WEEKDAYS_ZH[Number(Utilities.formatDate(now, REPORT_TIMEZONE, 'u')) - 1];
}

/**
 * 以美東時間判斷是否為平日；國定假日無法自動判斷（見 README 已知限制）。
 * 台灣早上 7 點 = 美東前一天傍晚 18:00（冬令）／19:00（夏令），美股已收盤：
 * 台灣週二～週六早上算「有開盤」（看的是前一晚的收盤），週日、週一早上算「休市」（沿用週五收盤）。
 * REPORT_HOUR 設在 6～11 點都是這個結果（美東還是前一天、已收盤）。設在 12～21 點，美東已經過了午夜，
 * 「今天有沒有開盤」看的是美東當天，數字仍是前一個收盤；設在 22 點到隔天 5 點，美股可能正在交易，數字會是盤中的。
 */
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

/** 純文字版的「原始數據」：每項一行並附來源，數字直接取自 data（不經過 AI） */
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
 * meta（可省略）提供 updatedIso 與 runBy，寫成 updated:（ISO 時間，+08:00）與 trigger:（每日排程／手動寄送／手動更新），
 * 以及 prevDate（前一篇日報的日期，導覽列用；沒有就寫「沒有更早的日報」）。
 * frontmatter 的欄位名稱不要改：日報總覽.base、標的筆記的「近期走勢」、每週回顧都靠它們。
 */
function buildReportMarkdown_(isoDate, data, summary, secretary, meta) {
  const fm = ['---', '類型: 日報', '日期: ' + isoDate];
  if (meta && meta.updatedIso) fm.push('updated: ' + meta.updatedIso);
  if (meta && meta.runBy) fm.push('trigger: ' + meta.runBy);
  fm.push('美股開盤: ' + (data.usMarketOpen ? 'true' : 'false'));
  data.items.forEach(function (it) {
    if (!it.key) return;
    fm.push(it.key + ': ' + (it.price === null ? '' : it.price));
    fm.push(it.key + '_漲跌: ' + (it.changePct === null ? '' : it.changePct));
  });
  if (secretary) fm.push('待確認草稿: ' + secretary.drafts.length);
  fm.push('---');

  const rows = data.items.map(function (it) {
    // 表格裡的連結別名要寫成 \|，否則會被當成欄位分隔
    const label = symbolWikiLink_(it, true);
    return '| ' + label + ' | ' + (it.price === null ? '查無資料' : it.price) + ' | ' + mdPct_(it.changePct) + ' | ' + it.source + ' |';
  });

  return fm.concat([
    '',
    '# ' + isoDate + ' 財經日報',
    '',
  ], reportNavMarkdown_(isoDate, meta && meta.prevDate), [
    '',
    '## 今日重點',
    '',
  ], highlightsMarkdown_(data, secretary), [
    '',
    '## AI 整理的摘要',
    '',
    summary,
    '',
    '## 原始數據（可自行核對）',
    '',
    '| 項目 | 數字 | 漲跌 | 來源 |',
    '|---|---|---|---|',
  ], rows, secretary ? ['', '## 秘書待辦', ''].concat(secretaryMarkdown_(secretary), secretaryNoteLinks_(secretary)) : [], [
    '',
    '> 本頁由 Apps Script 自動產生；數字來自資料表與公開端點，AI 只負責整理文字。僅供參考，不構成投資建議。',
    '',
  ]).join('\n');
}

/** 漲跌幅 → 「📈 +1.23%」／「📉 -0.45%」；查無資料回傳空字串 */
function mdPct_(pct) {
  return pct === null || pct === undefined ? '' : (pct >= 0 ? '📈 +' : '📉 ') + pct + '%';
}

/**
 * 日報最上面的導覽列：前一天（往前 7 天內最近的一篇）｜今天的每日筆記｜後一天。
 * 「後一天」先寫 NAV_NEXT_PENDING，明天的日報產生時才換成連結（linkPrevReport_），
 * 這樣不會出現點了會建出空白檔的「還不存在的日報」連結。
 */
function reportNavMarkdown_(isoDate, prevDate) {
  const prev = prevDate ? '[[日報/' + prevDate + ' 財經日報|← 前一天]]' : '← 前一天（沒有更早的日報）';
  return [
    '導覽：' + prev + '｜[[筆記/' + isoDate + '|📝 今天的筆記]]｜' + NAV_NEXT_PENDING,
    '',
    '> 📝 每日筆記請用左側欄「開啟今天的每日筆記」建立，才會套用範本；建好之後上面的連結就通了。',
  ];
}

/**
 * 「今日重點」：全部由程式依 data 計算，不經過 AI。
 *   - 變動最大的 3 項：依漲跌幅絕對值排序（topMovers_，查無資料的不算；一樣大時照「數據」分頁的順序）
 *   - 美股休市時寫「沿用 X 收盤數字」（X 是程式算的 usLastCloseDate）
 *   - 查無資料幾項、秘書待辦數量
 */
function highlightsMarkdown_(data, secretary) {
  const lines = ['> 由程式依下方「原始數據」計算，不經過 AI。', ''];
  const movers = topMovers_(data.items, 3);
  if (movers.length) {
    lines.push('- 變動最大的 ' + movers.length + ' 項（依漲跌幅大小）：');
    movers.forEach(function (it, i) {
      lines.push('  ' + (i + 1) + '. ' + symbolWikiLink_(it, false) + '：' + it.price + '（' + mdPct_(it.changePct) + '）');
    });
  } else {
    lines.push('- 變動最大的項目：今天沒有可以比較的漲跌資料。');
  }
  if (!data.usMarketOpen) lines.push('- 🇺🇸 美股休市（沿用 ' + data.usLastCloseDate + ' 收盤數字）');
  const missing = data.items.filter(function (it) { return it.price === null; }).length;
  if (missing) lines.push('- 查無資料：' + missing + ' 項（見下方原始數據）');
  if (secretary) {
    lines.push('- 秘書：待確認草稿 ' + secretary.drafts.length + ' 封、需人工 ' + secretary.failedCount + ' 封（見下方「秘書待辦」）');
  }
  return lines;
}

/** 日報 .md 專用：過去 24 小時的秘書紀錄筆記與報價單連結（信件版面不用，信裡不顯示 [[連結]]） */
function secretaryNoteLinks_(sec) {
  const withNote = sec.recent.concat(sec.quiet || []).filter(function (r) { return r.note; });
  if (!withNote.length) return ['- 全部還沒處理完的信：[[秘書總覽.base|秘書總覽]]（「待我處理」）'];
  const lines = ['- 秘書紀錄（點開看摘要與下一步）：'];
  withNote.forEach(function (r) {
    lines.push('  - [[秘書/' + r.note + '|' + mdCell_(r.intent + '｜' + readCustomer_(r.customer)) + ']]（' + r.status + '）' +
      (r.quote ? '｜報價單：[[秘書/' + r.quote + '|草稿]]' : ''));
  });
  lines.push('- 全部還沒處理完的信：[[秘書總覽.base|秘書總覽]]（「待我處理」）');
  return lines;
}

/** 秘書待辦 → Markdown 清單（日報 .md、「完整」版信件與純文字信共用） */
function secretaryMarkdown_(sec) {
  const lines = ['- 待確認草稿：' + sec.drafts.length + ' 封（在 Gmail「草稿」）'];
  sec.drafts.forEach(function (d) { lines.push('  - [ ] ' + mdInline_(redactEmails_(d.subject)) + (d.checks ? '（' + d.checks + ' 處需人工確認）' : '')); });
  lines.push('- 需人工處理的信：' + sec.failedCount + ' 封（Gmail 標籤「AI秘書/需人工」）');
  lines.push('- 過去 24 小時處理：' + sec.recent.length + ' 封');
  sec.recent.forEach(function (r) {
    lines.push('  - ' + r.intent + '｜' + mdInline_(readCustomer_(r.customer)) + '｜' + mdInline_(redactEmails_(r.subject)) + (r.total === '' ? '' : '｜報價合計 ' + r.total));
  });
  // 沒有建立草稿的信（推銷「略過」、感謝「不需回覆」）也列出來：程式是依關鍵字判斷的，可能看錯，請掃一眼
  const quiet = sec.quiet || [];
  if (quiet.length) {
    lines.push('- 略過／不需回覆：' + quiet.length + ' 封，請掃一眼（程式依關鍵字判斷，可能看錯）');
    quiet.forEach(function (r) { lines.push('  - ' + r.status + '｜' + mdInline_(readCustomer_(r.customer)) + '｜' + mdInline_(redactEmails_(r.subject))); });
  }
  return lines;
}
