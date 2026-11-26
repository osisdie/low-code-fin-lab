/**
 * 私人商務秘書 — 讀「AI秘書」標籤的信 → 判讀 → 建立 Gmail 回覆草稿（不寄出）＋ 每封信一篇紀錄存進知識庫
 *
 * 流程：
 *   1. 你在 Gmail 把要處理的信貼上標籤「AI秘書」（手動或用篩選器自動貼）
 *   2. AI（OpenRouter 免費模型；或 ① 貼的 Gemini／OpenAI key）判讀信件：意圖、客戶、品項與數量、需要人工確認的事（prompts/04）
 *      推銷／廣告與單純的感謝信由程式依關鍵字判斷，不建立草稿（狀態「略過」「不需回覆」）
 *   3. 價格一律由「報價表」分頁計算（AI 不碰數字）
 *   4. AI 寫回覆內文（prompts/05，禁止寫金額與承諾），系統把報價明細附在信末；內文出現金額或退款承諾會被標成【需人工確認】
 *   5. 存成 Gmail「草稿」——不會寄出；有報價就另存一份報價單 Markdown 到 FinLab-Vault/秘書
 *   6. 每封信都寫一篇紀錄：FinLab-Vault/秘書/<日期>-<意圖>-<客戶>.md，並確保有 FinLab-Vault/客戶/<客戶>.md
 *   7. 標籤換成「AI秘書/已處理」（失敗的換成「AI秘書/需人工」），並記一列到「秘書紀錄」分頁
 *   8. 每次執行前先更新之前還沒結案的紀錄：草稿還在、已經回覆、或草稿被刪掉（refreshSecretaryStatuses_）
 *   9. 隔天早上的「今日總覽」信會列出還沒確認的草稿（getSecretaryStatus_）
 *
 * ⚠️ 隱私：信件內容會經過 OpenRouter 送到免費模型的提供者。部分免費模型的提供者可能保留或用輸入資料訓練模型
 *    （依各提供者條款，以官網為準：https://openrouter.ai/docs/guides/privacy/provider-logging），
 *    改貼 Gemini 免費 key 時，免費方案的輸入也可能被 Google 用來改善產品（以官網為準）。
 *    課堂請只用 lab-assets/secretary/sample-emails.md 的虛構信件練習，不要把真實客戶個資、合約、報價送進免費模型。
 */

// ============ 可調整的設定 ============
const SECRETARY_LABEL = 'AI秘書';
const SECRETARY_DONE_LABEL = 'AI秘書/已處理';
const SECRETARY_FAIL_LABEL = 'AI秘書/需人工';
const PRICE_SHEET_NAME = '報價表';   // A 品項 / B 單價 / C 單位 / D 備註，第 1 列為標題
const SECRETARY_LOG_SHEET = '秘書紀錄'; // 每處理一封信記一列（自動建立）
const DRAFT_MARK = '【AI 草稿，寄出前請人工確認】';
const TAX_RATE = 0.05;               // 營業稅率（依你的實際情況調整）
const MAX_THREADS_PER_RUN = 5;       // 一次最多處理幾封，避免用光免費額度
const MAX_BODY_CHARS = 4000;         // 信件內文太長時只送前面這麼多字給 AI
const ADD_INTENT_LABEL = true;        // 依判讀結果多貼一個標籤，例如「AI秘書/詢價」（不想要就改成 false）
const INTENTS = ['詢價', '改期', '客訴', '其他'];
const NO_QUOTE_CHECK = '信中的品項無法對應報價表，請人工報價';
const COMPLAINT_NEEDS_HUMAN = true;  // 客訴一定要人看：草稿照常建立，但另外貼「AI秘書/需人工」標籤（不想要就改成 false）
// AI 判成「其他」或回傳不在清單裡的意圖時，用關鍵字補判（依序比對，先對到的算數）
const INTENT_KEYWORDS = [
  { intent: '客訴', re: /客訴|抱怨|投訴|退費|退款|退還|賠償|不滿|complain/i },
  { intent: '詢價', re: /詢價|報價|價格|價錢|多少錢|費用多少|估價|quot(e|ation)|pricing|price/i },
  { intent: '改期', re: /改期|改時間|改到|延期|延後|順延|reschedul/i },
];
// 推銷／廣告、單純感謝：只在 AI 判成「其他」（或判讀結果不在清單裡）時才看，對到就不建立草稿（今日總覽會列出來請你掃一眼）
//   只看主旨＋內文「去掉引用的舊信」之後的部分（quietText_），舊信與頁尾的字不算
//   unless：信裡有提問或請求（例如「請問」「麻煩」「？」）就一律照常建立草稿
//   推銷要「強關鍵字」（取消訂閱、unsubscribe、退訂）或「2 個以上不同的弱關鍵字」才算，單一個「廣告」不算
const NO_REPLY_RULES = [
  { status: '略過', strong: /取消訂閱|unsubscribe|退訂/i,
    weak: [/廣告/, /推銷/, /促銷/, /限時(優惠|特價|搶購)/, /電子報|newsletter/i, /名額有限/, /把握機會/, /優惠方案/], minWeak: 2,
    unless: /[?？]|請問|能否|可否|是否|麻煩|煩請|想請|希望(貴公司|你們|您)|請(貴公司|你們|您)/,
    reason: '系統依關鍵字判斷為推銷或廣告，沒有建立回覆草稿' },
  { status: '不需回覆', re: /感謝|謝謝|thank/i, unless: /[?？]|請問|能否|可否|是否|麻煩|煩請|想請|請.{0,6}(提供|協助|回覆|確認|報價|安排)/,
    reason: '系統判斷為感謝或通知信，不需要回覆，沒有建立回覆草稿' },
];
// 回覆內文像是在替你承諾（AI 不該承諾）：對到就在最上面加【需人工確認】，紀錄狀態改成「需人工」。
// 這兩條規則只能「降低風險」，不保證抓得到所有寫法；寄出前一定要自己讀過。比對前會先拿掉【需人工確認…】標記。
//   REFUND_PROMISE_RE：退款、賠償（「會為您退款」「退款將於…入帳」「款項會全額退回」「已為您辦理退費」「補償金」「We'll refund」…）
//   PROMISE_RE：折扣、免費、保證、交期（「打九折」「優惠價」「免費」「保證」「月底前完成」「guarantee」「discount」…）
const REFUND_PROMISE_RE = new RegExp([
  '(會|將|可以|可|同意|立即|馬上|盡快|願意)(為您|幫您|替您)?[^。！？!?\\n【]{0,8}(全額)?(退款|退費|退還|退回|返還|賠償|補償|折抵|免費重做)',
  '(退款|退費|款項|費用|訂金|金額)[^。！？!?\\n【]{0,12}(將|會|已|可)[^。！？!?\\n【]{0,8}(入帳|退回|退還|返還|匯回|退給|撥還)',
  '已(經)?(為您|幫您|替您)?(辦理|安排|完成)[^。！？!?\\n【]{0,6}(退款|退費|退還|退回|返還|賠償|補償)',
  '補償金',
  "\\b(we'?ll|we will|will be|will|can|shall|have|has been)\\b[^.!?\\n]{0,30}\\b(refund|reimburs|compensat)",
  '\\bfull refund\\b',
].join('|'), 'i');
// ACTION_CLAIM_RE：說事情「已經」做了（已完成審核、已啟動流程、已確認收款…），或提出／答應具體時段（可於 11/13 上午安排、11/14 下午兩點）。
//   這種話是 AI 編出來的事實或承諾，正規表示式只能抓常見寫法，提示詞（prompts/05 第 6、7 條）才是第一道防線。
const ACTION_CLAIM_RE = /已(經)?(完成|確認|審核|啟動|安排|處理好|收到款項|收到匯款|入帳|開立|寄出)|可(於|在|以在)[^。！？!?\n【]{0,20}(安排|進行|見面|開會|拜訪)|\d{1,2}\s*[\/月]\s*\d{1,2}\s*[日號]?[^。！？!?\n【]{0,8}(上午|下午|早上|晚上|中午|\d{1,2}\s*[:：點])/;
const PROMISE_RE = /保證|一定會|免費|優惠價|[一二三四五六七八九]折|打[^。！？!?\n【]{0,3}折|[0-9０-９一二三四五六七八九十月日號週天底中初/\-]{1,8}\s*前(交件|交貨|交付|完成|送達|寄出|上線)|\bguarantee|\bfree of charge|\bdiscount/i;
const FAILED_INTENT = '未判讀'; // 處理失敗、沒有判讀結果的信
const UNSIGNED_CUSTOMER = '未署名客戶'; // 信裡找不到客戶名稱（或只找到你自己）時用這個
const CUSTOMER_MAX_CHARS = 40;          // 客戶名稱最多幾個字（太長的截掉，檔名才不會太長）

// ============ 秘書紀錄的狀態（試算表「秘書紀錄」、知識庫筆記的 狀態、秘書總覽.base 都用這幾個字）============
// 改名要一起改 Vault.gs 的 秘書總覽.base 與 範本
const SECRETARY_STATUS = {
  DRAFT: '待確認草稿',   // AI 已建立回覆草稿，等你確認後自己寄出
  HUMAN: '需人工',       // 客訴、退款、處理失敗、或草稿內文有疑慮：要你親自判斷
  REPLIED: '已回覆',     // 草稿已經不在，這串信裡有你寄出的回覆
  DISCARDED: '已捨棄',   // 草稿已經不在，也沒有你的回覆（多半是你刪掉了草稿）
  SKIPPED: '略過',       // 推銷或廣告：沒有建立草稿
  NO_REPLY: '不需回覆',  // 感謝或通知：沒有建立草稿
};
const STATUS_HELP = {
  '待確認草稿': 'AI 已建立回覆草稿，等你確認後自己寄出',
  '需人工': '這封信要你親自判斷（客訴、退款、處理失敗，或草稿內文有疑慮）',
  '已回覆': '草稿已經不在，而且這串信裡有你寄出的回覆',
  '已捨棄': '草稿已經不在，這串信裡也沒有你的回覆（多半是你刪掉了草稿）',
  '略過': '判斷為推銷或廣告，沒有建立草稿',
  '不需回覆': '判斷為感謝或通知，不需要回覆，沒有建立草稿',
};
// 還沒結案的狀態：每次執行會回頭檢查這些紀錄
const OPEN_STATUSES = [SECRETARY_STATUS.DRAFT, SECRETARY_STATUS.HUMAN];
// 已結案的狀態：重新貼「AI秘書」標籤時，如果客戶沒有新的來信，就直接略過（不呼叫 AI、不建草稿）
const CLOSED_STATUSES = [SECRETARY_STATUS.REPLIED, SECRETARY_STATUS.DISCARDED, SECRETARY_STATUS.SKIPPED, SECRETARY_STATUS.NO_REPLY];
const REFRESH_MAX_PER_RUN = 20;          // 每次最多回頭檢查幾筆，控制 Gmail 讀取次數（找不到的信不算）
const REFRESH_TIME_BUDGET_MS = 120000;   // 回頭檢查最多花 120 秒，剩下的時間留給處理新信
const SECRETARY_RUN_LIMIT_MS = 270000;   // 整輪約 270 秒後就不再開始處理新的一串信（Apps Script 每次最多 6 分鐘）
const SECRETARY_RESERVE_MS = 90000;      // 回頭檢查舊紀錄時，至少留這麼多時間給新信
// 依實測調整：免費模型一封要寫草稿的信約 40～75 秒（2 次 AI），不寫草稿的約 40 秒，5 封一輪約 4 分鐘。
// 開始下一封之前先估：已用時間 + max(90 秒, 這一輪平均每封 × 1.3) 超過 330 秒就停（Apps Script 360 秒會被強制中斷）
const SECRETARY_THREAD_ESTIMATE_MS = 90000; // 這一輪還沒處理過任何一封時，預估一封要這麼久
const SECRETARY_RUN_SAFE_MS = 330000;       // 預估做完下一封會超過這個時間，就不開始
// 一次 AI 呼叫偶爾會卡好幾分鐘（實測一次回覆草稿卡了約 5 分鐘）：
const SECRETARY_REPLY_START_LIMIT_MS = 250000; // 這一輪已經過了 250 秒，就不開始寫回覆草稿，這封信留到下次（標籤不動）
const SECRETARY_AI_DEADLINE_MS = 300000;       // 這一輪過了 300 秒，AI 失敗就不再試備用模型
const REFRESH_CURSOR_PROP = 'SECRETARY_REFRESH_CURSOR'; // 程式自動寫入：下次從第幾筆還沒結案的紀錄接著檢查（輪流，舊的不會一直排不到）
const NEXT_STEP_HEADING = '## 下一步（你要做的事）';
// 「秘書紀錄」分頁的欄位（與知識庫筆記的 frontmatter 對應）；舊表缺的欄位會自動加在最右邊
// 「最後來信」：秘書處理過的最新一封來信的時間（判斷客戶有沒有再來信、回覆從什麼時候算起）
const SECRETARY_LOG_COLUMNS = ['時間', '客戶', '主旨', '意圖', '狀態', '草稿', '報價單', '報價合計', '需人工原因', '下一步', '更新時間', '最後來信', 'Gmail 連結', '信件ID', '草稿ID', '知識庫筆記'];
// 舊版「秘書紀錄」的欄位名稱：同一個意思，沿用舊欄位，不重複加
const SECRETARY_LOG_ALIASES = { '時間': ['處理時間'], 'Gmail 連結': ['信件連結'] };

const SECRETARY_SCOPES = [           // 秘書需要的權限（建立觸發器前先確認）
  'https://www.googleapis.com/auth/spreadsheets.currentonly',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/drive',
  'https://mail.google.com/',
];

// 判讀提示詞（與 lab-assets/prompts/04-secretary-triage.txt 同步；修改請兩邊一起改）
const TRIAGE_PROMPT = [
  '你是「商務秘書」，負責判讀一封客戶來信。只根據信件內容回答，不要猜測信裡沒寫的事。',
  '',
  '【意圖（intent）只能是下面四個字串之一，一字不差】',
  '- 詢價：想知道價格、費用、報價，或想請我們提供某項服務／商品（例如「想請貴公司協助」「請提供報價」「多少錢」「有沒有折扣」）。只要信裡有要報價或問價格，就算同時有其他內容，也選「詢價」。',
  '- 改期：要更改、延後、取消已經約好的會議、拍攝或交期時間。',
  '- 客訴：抱怨服務或產品出問題、表達不滿、要求退費、賠償或補救。',
  '- 其他：以上都不是（例如單純感謝、通知、廣告）。',
  '',
  '【判讀範例】',
  '信：「想請貴公司報價：官網設計 1 式、主機代管 1 年，月底前要。」',
  '→ {"intent":"詢價","items":[{"name":"官網設計","qty":1},{"name":"主機代管（年）","qty":1}],"deadline":"月底前","needs_human":[]}',
  '信：「原訂週三的拍攝想改到下週一，可以嗎？」',
  '→ {"intent":"改期","items":[],"deadline":"下週一","needs_human":["新的拍攝日期"]}',
  '信：「上週交的影片有錯字，客戶很不滿意，請盡快重做，否則要求退費。」',
  '→ {"intent":"客訴","items":[],"deadline":"","needs_human":["退費要求","重做時程"]}',
  '（範例裡的品項名稱只是示意；實際只能用下面【可報價品項】清單裡的名稱）',
  '',
  '【可報價品項】（只能從這份清單選，名稱要完全一樣；清單沒有的寫進 unmatched）',
  '{item_names}',
  '',
  '【請只輸出一個 JSON 物件，不要加任何說明文字或 ``` 符號】',
  '{',
  '  "intent": "詢價" 或 "改期" 或 "客訴" 或 "其他",',
  '  "customer": "客戶的「公司 聯絡人」，從信件內文的署名或公司名稱找（例如「星河咖啡 陳小姐」）；不要用寄件人欄位或信箱；信裡沒寫就空字串",',
  '  "summary": "一句話摘要客戶需求",',
  '  "items": [{"name": "清單中的品項名稱", "qty": 數量或 null}],',
  '  "unmatched": ["客戶提到但清單沒有的品項"],',
  '  "deadline": "客戶提到的日期或期限，沒有就空字串",',
  '  "needs_human": ["需要人工確認的事項"],',
  '  "tone": "一般" 或 "急迫" 或 "不滿"',
  '}',
  '',
  '【規則】',
  '1. qty 只能填信裡明確寫出的數字；沒寫就填 null，不要自己估。',
  '2. 不要輸出任何價格或金額；價格由系統從報價表計算。',
  '3. 折扣、交期承諾、退款、賠償、合約或法律相關要求，一律寫進 needs_human。',
  '4. 有任何不確定的地方，也寫進 needs_human。',
  '5. 只有 intent 是「詢價」時才填 items 與 unmatched；改期、客訴、其他一律填空陣列 []。',
  '6. customer 只看信件內文（通常在最後的署名），寫成「公司 聯絡人」；寄件人欄位可能是你自己或轉寄的人，不要拿來當客戶，也不要輸出任何信箱。',
  '7. summary、needs_human 等文字欄位只用繁體中文（台灣用語），不可出現簡體字。',
  '',
  '【信件】',
  '寄件人：{from}',
  '主旨：{subject}',
  '內容：',
  '{body}',
].join('\n');

// 回覆提示詞（與 lab-assets/prompts/05-reply-draft.txt 同步；修改請兩邊一起改）
const REPLY_PROMPT = [
  '你是「商務秘書」，要替我寫一封回覆草稿。我會先檢查，再決定要不要寄出。',
  '',
  '【判讀結果】',
  '{triage_json}',
  '',
  '【規則】',
  '1. 用專業、有禮貌的繁體中文商務書信語氣，150～250 字。',
  '2. 不要寫任何金額、價格、折扣或交期承諾。只有 hasQuote 是 true 時，才寫「報價明細請見信末」，明細由系統附上；hasQuote 是 false 時不要提到信末明細或附上報價。',
  '3. 不要答應退款、賠償或任何沒有依據的承諾；遇到這類要求，寫「我們確認後會盡快回覆您」。',
  '4. needs_human 裡的每一項，在信中相關位置標上【需人工確認：事項內容】，例如【需人工確認：折扣】；冒號後面一定要寫出具體事項，不可留空或只寫刪節號。needs_human 是空的、也沒有第 6、7 條的情況，就不要出現這個標記。',
  '5. 不要編造公司政策、人名、電話或網址；不要寫署名，系統會在信末加上署名欄。',
  '6. 不要說任何事情「已經」做了：不要寫已確認、已完成、已審核、已收到款項、已安排、已啟動流程這類話；這些要由我親自確認，請寫成【需人工確認：要確認的事】。',
  '7. 不要提出或答應具體的日期、時間或可以的時段（例如「可於 11/13 上午安排」）；需要時間的地方寫【需人工確認：可以的時間】。',
  '8. 只用繁體中文（台灣用語），不可出現簡體字。',
  '9. 只輸出信件內文，不要加任何說明、Markdown 符號或大括號 { }。',
].join('\n');

// ============ 選單 ============
/** 選單 ⑤：手動處理一次。AI 關閉時只跳說明：不讀信、不呼叫 AI、不改標籤 */
function menuProcessSecretary() {
  if (!isAiEnabled_()) { alertAiOffForSecretary_('秘書處理'); return; }
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, SECRETARY_SCOPES);
  runMenu_('秘書處理', function () {
    const r = processSecretaryMail();
    SpreadsheetApp.getUi().alert('秘書處理完成',
      '已建立 ' + r.drafted + ' 封回覆草稿（在 Gmail「草稿」），' + r.quotes + ' 份報價單草稿；每封信的紀錄都在「' + VAULT_ROOT_NAME + '/秘書」與「' + SECRETARY_LOG_SHEET + '」分頁。\n' +
      (r.noReply ? r.noReply + ' 封判斷為推銷、廣告或感謝信，沒有建立草稿（狀態「略過」或「不需回覆」）。\n' : '') +
      (r.failed ? r.failed + ' 封處理失敗，已貼上「' + SECRETARY_FAIL_LABEL + '」標籤，請人工處理。\n' : '') +
      (r.skipped ? r.skipped + ' 封略過：已經有 AI 草稿、已經結案、或只有你自己寄的信（不會重複建立草稿）。\n' : '') +
      (r.followups ? r.followups + ' 封是客戶在你回覆後又來信，已在原本的紀錄加上「追蹤」並建立新的回覆草稿。\n' : '') +
      (r.recovered ? r.recovered + ' 封上次處理到一半中斷（草稿有建、紀錄沒寫），這次補寫了紀錄。\n' : '') +
      (r.deferred ? r.deferred + ' 封因為時間不夠，留到下次處理（「' + SECRETARY_LABEL + '」標籤沒動）。\n' : '') +
      (r.refreshed ? '之前的紀錄有 ' + r.refreshed + ' 筆更新了狀態（已回覆、已捨棄，或照你在 Obsidian 改的狀態）。\n' : '') +
      (r.priceSkipped.length ? '報價表有 ' + r.priceSkipped.length + ' 列單價看不懂、已略過：' + r.priceSkipped.join('、') + '。請把 B 欄改成數字。\n' : '') +
      (r.drafted + r.failed + r.skipped + r.noReply + r.recovered + r.deferred === 0 ? '\n沒有找到貼著「' + SECRETARY_LABEL + '」標籤的信。' : '\n提醒：草稿不會自動寄出，請逐封檢查【需人工確認】的地方。'),
      SpreadsheetApp.getUi().ButtonSet.OK);
  });
}

/** 選單 ⑥：建立每小時一次的自動處理（AI 關閉時只跳說明，不建立觸發器） */
function menuEnableSecretary() {
  if (!isAiEnabled_()) { alertAiOffForSecretary_('開啟秘書自動處理'); return; }
  // 觸發器在背景執行時沒辦法跳授權，所以建立前先確認權限都有勾
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, SECRETARY_SCOPES);
  runMenu_('開啟秘書自動處理', function () {
    removeTriggers_('processSecretaryMail');
    ScriptApp.newTrigger('processSecretaryMail').timeBased().everyHours(1).create();
    SpreadsheetApp.getUi().alert('已開啟 ✅ 之後每小時檢查一次「' + SECRETARY_LABEL + '」標籤的信，只建立草稿、不會寄出。');
  });
}

/** 選單 ⑦：刪掉秘書的觸發器（已建立的草稿不會被刪） */
function menuDisableSecretary() {
  runMenu_('停止秘書自動處理', function () {
    removeTriggers_('processSecretaryMail');
    SpreadsheetApp.getUi().alert('已停止秘書自動處理。');
  });
}

// ============ 主流程（設定觸發器時請選這個）============
/**
 * 秘書主流程：先回頭更新之前還沒結案的紀錄，再處理最多 MAX_THREADS_PER_RUN 串新信；
 * 每串信最多建立一封回覆「草稿」，不寄出。推銷／廣告與單純感謝信不建立草稿。
 * 時間有上限（Apps Script 每次最多 6 分鐘）：整輪約 SECRETARY_RUN_LIMIT_MS（270 秒）後就不再開始處理新的一串信，
 * 沒處理到的信標籤不動，下次再處理；回頭更新舊紀錄最多花 min(120 秒, 剩下的時間 − 保留給新信的時間)。
 * 回傳 { drafted, quotes, failed, skipped, noReply, refreshed, recovered, deferred, priceSkipped } 給選單 ⑤ 顯示。
 * 每小時的觸發器執行的就是這個函式。
 */
function processSecretaryMail() {
  const started = Date.now();
  // 安全：AI 關閉就整個略過（排程觸發也一樣）：0 次 AI 呼叫、不讀信、標籤不動、不寫紀錄
  if (!isAiEnabled_()) {
    console.warn('AI 已關閉，略過秘書處理。');
    return { drafted: 0, quotes: 0, failed: 0, skipped: 0, noReply: 0, refreshed: 0, recovered: 0, deferred: 0, followups: 0, priceSkipped: [] };
  }
  const labels = {
    inbox: getOrCreateLabel_(SECRETARY_LABEL),
    done: getOrCreateLabel_(SECRETARY_DONE_LABEL),
    fail: getOrCreateLabel_(SECRETARY_FAIL_LABEL),
  };
  const priceList = readPriceList_();
  const result = { drafted: 0, quotes: 0, failed: 0, skipped: 0, noReply: 0, refreshed: 0, recovered: 0, deferred: 0, followups: 0, priceSkipped: priceList.skipped };

  // 舊版留下的客戶欄若有信箱（例如「admin <信箱>」），先整理掉（只改那一格）
  try {
    cleanLegacyCustomers_();
  } catch (err) {
    logError_('秘書：整理舊紀錄的客戶名稱', err);
  }
  // 先更新之前的紀錄（草稿還在嗎？回了沒？）；只看還沒結案的，有上限；失敗不影響處理新信
  try {
    const left = SECRETARY_RUN_LIMIT_MS - SECRETARY_RESERVE_MS - (Date.now() - started);
    result.refreshed = refreshSecretaryStatuses_(Math.min(refreshBudgetMs_(), left));
  } catch (err) {
    logError_('秘書：更新舊紀錄的狀態', err);
  }

  const threads = labels.inbox.getThreads(0, MAX_THREADS_PER_RUN);
  const spent = []; // 這一輪每封花了幾毫秒
  for (let i = 0; i < threads.length; i++) {
    if (secretaryTimeUp_(started) || secretaryNextTooLong_(Date.now() - started, spent)) {
      // 時間不夠：剩下的信「AI秘書」標籤不動，下次執行再處理
      result.deferred += threads.length - i; // 加上前面因為時間不夠留下的
      console.warn('秘書：時間快用完，' + (threads.length - i) + ' 封信留到下次處理（「' + SECRETARY_LABEL + '」標籤沒動）');
      break;
    }
    const t0 = Date.now();
    processSecretaryThread_(threads[i], labels, priceList.map, result, started);
    spent.push(Date.now() - t0);
  }
  return result;
}

/**
 * 依這一輪的速度，判斷「再開始一封」會不會太晚：已用時間 + max(預設 90 秒, 平均每封 × 1.3) 超過 330 秒就不開始。
 * 第一封還沒有平均，用預設 90 秒。270 秒的上限（secretaryTimeUp_）另外照樣有效。
 */
function secretaryNextTooLong_(elapsedMs, spent) {
  const avg = spent.length ? spent.reduce(function (a, b) { return a + b; }, 0) / spent.length : 0;
  return elapsedMs + Math.max(SECRETARY_THREAD_ESTIMATE_MS, 1.3 * avg) > SECRETARY_RUN_SAFE_MS;
}

/** 這一輪是不是該停了（不再開始處理新的一串信）；寫成函式方便測試 */
function secretaryTimeUp_(started) {
  return Date.now() - started > SECRETARY_RUN_LIMIT_MS;
}

/**
 * 處理一串信（processSecretaryMail 的迴圈每次呼叫一次）。任何錯誤都在這裡接住：貼「需人工」、留一筆失敗紀錄。
 * 順序：判讀 → 報價單 → 建草稿 → 寫紀錄 → 換標籤。萬一在「建草稿」之後中斷，下次會補寫紀錄（見 recoverSecretaryRecord_）。
 */
function processSecretaryThread_(thread, labels, prices, result, started) {
  let msg = null;
  const runStart = started || Date.now();
  const deadline = runStart + SECRETARY_AI_DEADLINE_MS;
  try {
    // 重跑時不重複建立：這串信已經有 AI 草稿（開頭有標記，或「秘書紀錄」記下的草稿ID 還在）
    if (hasAiDraft_(thread) || recordDraftAlive_(thread)) {
      if (!findSecretaryRow_(thread.getId())) {
        // 上次建好草稿後就中斷了、還沒寫紀錄：補寫一筆，不再建第二封草稿
        recoverSecretaryRecord_(thread, prices);
        result.recovered++;
      } else {
        result.skipped++;
        console.log('略過（已有 AI 草稿與紀錄）：' + thread.getFirstMessageSubject());
      }
      thread.removeLabel(labels.inbox).addLabel(labels.done);
      return;
    }
    // 草稿也算在 thread 裡，先排除，才不會拿自己的草稿去判讀
    const msgs = thread.getMessages().filter(function (m) { return !m.isDraft(); });
    if (!msgs.length) throw new Error('這串信裡沒有可以判讀的信');
    // 只處理「來信」：絕不替你自己寄出的信（例如你已經寄出的回覆）寫草稿
    const me = myAddresses_();
    const inbound = inboundMessages_(msgs, me);
    if (!inbound.length) {
      thread.removeLabel(labels.inbox).addLabel(labels.done);
      result.skipped++;
      console.log('沒有來信（只有你自己寄的信），略過：' + thread.getFirstMessageSubject());
      return;
    }
    msg = inbound[inbound.length - 1];
    // 這串信之前處理過：沒有新的來信 → 已結案就略過；客戶在上次處理（或你的回覆）之後又來信 → 追蹤
    const row = findSecretaryRow_(thread.getId());
    let followup = false;
    // 之前判讀失敗（意圖「未判讀」）的信：重新貼標籤就是要重試，沒有新的來信也照樣處理
    const retry = !!row && String(row.get('意圖')) === FAILED_INTENT;
    if (row) {
      // 「新的來信」＝比上次處理過的來信新，也比你最後一次寄出的信新（舊列沒有「最後來信」就用處理時間）
      const lastHandled = Math.max(rowTime_(row.get('最後來信')) || rowTime_(row.get('時間')), latestOwnReply_(msgs, inbound, me));
      if (msg.getDate().getTime() <= lastHandled && !retry) {
        // 沒有新的來信：不呼叫 AI、不建草稿、紀錄不動（想讓秘書重寫：先刪掉「秘書紀錄」那一列，再貼標籤）
        thread.removeLabel(labels.inbox).addLabel(labels.done);
        result.skipped++;
        console.log((CLOSED_STATUSES.indexOf(String(row.get('狀態'))) !== -1 ? '已結案，略過：' : '沒有新的來信，略過：') + thread.getFirstMessageSubject());
        return;
      }
      followup = msg.getDate().getTime() > lastHandled;
    }
    const triage = triageEmail_(msg, prices, deadline);
    triage.customer = canonicalCustomer_(triage.customer); // 同一位客戶只用一個名字
    const rec = newSecretaryRecord_(thread, msg, triage, prices);
    if (row) {
      // 同一筆紀錄（同一列、同一篇筆記）：主旨與第一次處理的時間照舊
      const firstAt = row.get('時間');
      if (firstAt instanceof Date) rec.time = firstAt;
      rec.subject = redactEmails_(String(row.get('主旨') || rec.subject).replace(/^'/, ''));
      // 意圖：之前判讀失敗（未判讀）就用這次的判讀；否則維持原本的
      const oldIntent = String(row.get('意圖') || '');
      if (oldIntent && oldIntent !== FAILED_INTENT) rec.intent = oldIntent;
      // 客戶：原本是「未署名客戶」才用這次判讀到的；否則維持原本的（不讓同一件事換名字）
      const oldCustomer = sanitizeCustomer_(String(row.get('客戶') || '').replace(/^'/, ''), myIdentityNames_(msg));
      if (oldCustomer && oldCustomer !== UNSIGNED_CUSTOMER && oldCustomer !== '未具名寄件人') rec.customer = oldCustomer;
    }
    if (followup) {
      // 追蹤：另外記一筆「追蹤」
      rec.followup = { at: new Date(), subject: redactEmails_(msg.getSubject()), summary: triage.summary || '' };
      rec.reasons.push('客戶在上次處理之後又來信（追蹤），草稿是回覆最新的那封');
      result.followups = (result.followups || 0) + 1;
    }

    if (triage.noReply) {
      // 推銷／廣告、單純感謝：不建立草稿，只留紀錄
      rec.status = triage.noReply.status;
      rec.reasons.push(triage.noReply.reason);
      saveSecretaryRecord_(rec);
      thread.removeLabel(labels.inbox).addLabel(labels.done);
      addIntentLabel_(thread, triage.intent);
      result.noReply++;
      return;
    }

    // 只有詢價才算報價；改期、客訴不附報價明細、不存報價單
    const quote = triage.intent === '詢價' && (triage.items.length || triage.unmatched.length) ? buildQuote_(triage, prices) : null;
    // 詢價但對不到任何品項（例如關鍵字改判、或客戶沒寫具體品項）：沒有明細可附，請人工報價
    if (triage.intent === '詢價' && !quote) triage.needs_human.push(NO_QUOTE_CHECK);
    triage.hasQuote = !!quote; // 回覆提示詞依這個決定要不要寫「報價明細請見信末」

    // 時間不夠就不開始寫回覆（這次 AI 呼叫可能很久）：什麼都還沒寫，信留著標籤，下次從頭處理
    if (Date.now() - runStart > SECRETARY_REPLY_START_LIMIT_MS) throw outOfTimeError_('時間不夠，沒有開始寫回覆草稿');
    const draftText = tidyPlaceholders_(toTraditional_(draftReply_(triage, deadline), '回覆草稿'));
    const reply = flagAmounts_(stripQuoteMentions_(fixEmptyChecks_(draftText, triage.needs_human), triage.hasQuote, triage.intent));
    const refund = flagRefundPromise_(reply.text);
    const promise = flagPromises_(refund.text);
    const claim = flagClaims_(promise.text);
    let body = DRAFT_MARK + '\n\n' + claim.text;
    if (quote) body += '\n\n' + quoteText_(quote);

    // 先存報價單：存檔失敗不擋草稿，但會寫進紀錄的「需人工原因」
    if (quote) {
      rec.total = quote.complete ? quote.total : '（未完成）';
      try {
        const name = quoteNoteName_('報價單草稿-' + customerNoteKey_(triage.customer) + '-' + rec.isoDate, thread.getPermalink());
        writeVaultFile_('秘書', name + '.md', buildQuoteMarkdown_(rec.isoDate, triage, quote, redactEmails_(msg.getSubject()), thread.getPermalink()));
        rec.quoteNote = name;
        result.quotes++;
      } catch (err) {
        logError_('秘書：報價單存進知識庫', err);
        rec.reasons.push('報價單沒有存進知識庫：' + err.message);
      }
    }

    rec.reasons = triage.needs_human.concat(
      quote && !quote.complete ? ['部分品項缺價格或數量，報價合計還沒完成'] : [],
      reply.flagged ? ['回覆內文出現金額或折扣，寄出前請確認或刪除'] : [],
      refund.flagged ? ['回覆內文提到退款或賠償，AI 不能替你承諾，寄出前請確認或改寫'] : [],
      promise.flagged ? ['回覆內文提到折扣、免費、保證或交期，AI 不能替你承諾，寄出前請確認或改寫'] : [],
      claim.flagged ? ['回覆內文說某件事已經做了，或提出了具體日期時間，寄出前請確認或改寫'] : [],
      rec.reasons);
    // 客訴、或草稿看起來在替你承諾：草稿照常建立，但狀態是「需人工」並另外貼「需人工」標籤（今日總覽也會算到它）
    const human = (COMPLAINT_NEEDS_HUMAN && triage.intent === '客訴') || refund.flagged || promise.flagged || claim.flagged;
    rec.status = human ? SECRETARY_STATUS.HUMAN : SECRETARY_STATUS.DRAFT;

    // 安全：createDraftReply 只建立「草稿」，不會寄出；整份程式沒有任何寄信給客戶的動作
    const draft = msg.createDraftReply(body);
    result.drafted++;
    rec.draft = true;
    // 草稿 ID：之後用它判斷「草稿還在不在」（你刪掉開頭標記、改寫內文，草稿 ID 都不變）
    try {
      rec.draftId = draft && draft.getId ? String(draft.getId()) : '';
    } catch (err) {
      rec.draftId = '';
    }
    // 先寫紀錄再換標籤：換標籤之前中斷，下次會看到草稿和紀錄都在，只補換標籤
    saveSecretaryRecord_(rec);
    thread.removeLabel(labels.inbox).addLabel(labels.done);
    addIntentLabel_(thread, triage.intent);
    if (human) thread.addLabel(labels.fail);
  } catch (err) {
    if (err && err.outOfTime) {
      // 時間不夠（不是信的問題）：標籤不動、不寫紀錄、不建草稿，下次執行從頭處理這封
      result.deferred++;
      console.warn('秘書：' + err.message + '，「' + thread.getFirstMessageSubject() + '」留到下次處理');
      return;
    }
    logError_('秘書：' + thread.getFirstMessageSubject(), err);
    thread.removeLabel(labels.inbox).addLabel(labels.fail);
    result.failed++;
    saveSecretaryRecord_(failedSecretaryRecord_(thread, msg, err));
  }
}

/**
 * 上次建好 AI 草稿後就中斷（還沒寫紀錄）：補寫一筆紀錄，不再建第二封草稿。
 * 會再請 AI 判讀一次（只為了摘要與意圖）；判讀失敗也照樣寫一筆最基本的紀錄。狀態是「待確認草稿」（客訴是「需人工」）。
 */
function recoverSecretaryRecord_(thread, prices) {
  const msgs = thread.getMessages().filter(function (m) { return !m.isDraft(); });
  const inbound = inboundMessages_(msgs, myAddresses_());
  const msg = inbound[inbound.length - 1] || msgs[0] || thread.getMessages()[0];
  let triage;
  try {
    triage = triageEmail_(msg, prices);
  } catch (err) {
    triage = { intent: '其他', customer: resolveCustomer_('', msg, msg.getPlainBody()), summary: '', items: [], unmatched: [], needs_human: [] };
  }
  triage.customer = canonicalCustomer_(triage.customer);
  const rec = newSecretaryRecord_(thread, msg, triage, prices);
  rec.draft = true;
  rec.draftId = threadDraftId_(thread);
  rec.status = COMPLAINT_NEEDS_HUMAN && triage.intent === '客訴' ? SECRETARY_STATUS.HUMAN : SECRETARY_STATUS.DRAFT;
  rec.reasons = (triage.needs_human || []).concat(['上次處理到一半中斷，這筆紀錄是事後補上的；請打開 Gmail 草稿確認內容']);
  saveSecretaryRecord_(rec);
  console.warn('秘書：補寫中斷的紀錄：' + msg.getSubject());
}

/** 這串信目前的草稿ID（找不到就空字串） */
function threadDraftId_(thread) {
  try {
    const tid = thread.getId();
    const d = GmailApp.getDrafts().filter(function (x) { return x.getMessage().getThread().getId() === tid; })[0];
    return d ? String(d.getId()) : '';
  } catch (err) {
    return '';
  }
}

/**
 * 報價單草稿的檔名：同一天、同一位客戶已經有一份時，只有「同一封信、而且狀態還是『待確認』」才覆寫；
 * 你已經改成「已確認」的、或別封信的報價單，一律不覆寫，改用 -2、-3…
 */
function quoteNoteName_(base, permalink) {
  for (let i = 1; i <= 9; i++) {
    const name = i === 1 ? base : base + '-' + i;
    const cur = readVaultFile_('秘書', name + '.md');
    if (!cur) return name;
    if (cur.content.indexOf(permalink) !== -1 && frontmatterValue_(cur.content, '狀態') === '待確認') return name;
  }
  return base + '-' + Date.now();
}

/** 依判讀結果多貼一個標籤，例如「AI秘書/詢價」（ADD_INTENT_LABEL 為 false 就不貼） */
function addIntentLabel_(thread, intent) {
  if (ADD_INTENT_LABEL && INTENTS.indexOf(intent) !== -1) thread.addLabel(getOrCreateLabel_(SECRETARY_LABEL + '/' + intent));
}

/** 這串信裡是否已經有 AI 草稿（開頭標記還在） */
function hasAiDraft_(thread) {
  return thread.getMessages().some(function (m) {
    return m.isDraft() && m.getPlainBody().indexOf(DRAFT_MARK) !== -1;
  });
}

// ============ 判讀與撰寫 ============
/**
 * 請 AI 判讀一封信，回傳 { intent, customer, summary, items, unmatched, deadline, needs_human, tone }。
 * 只送「品項名稱」給 AI，不送單價；信件內文只送前 MAX_BODY_CHARS 個字。
 */
/** 「時間不夠」的錯誤：呼叫端看到 err.outOfTime 就把信留到下次，不當成處理失敗 */
function outOfTimeError_(message) {
  const err = new Error(message);
  err.outOfTime = true;
  return err;
}

function triageEmail_(msg, prices, deadline) {
  const names = Object.keys(prices).map(function (k) { return '- ' + prices[k].name; }).join('\n') || '（報價表是空的）';
  // 寄件人只給顯示名稱、不給信箱（少送一點個資給免費模型；客戶名稱也要從內文找）
  const from = senderName_(msg.getFrom());
  const subject = msg.getSubject();
  const body = msg.getPlainBody().slice(0, MAX_BODY_CHARS);
  // 用函式當替換值：信裡的 $ 符號（例如 NT$）不會被當成特殊字元
  const prompt = TRIAGE_PROMPT
    .replace('{item_names}', function () { return names; })
    .replace('{from}', function () { return from; })
    .replace('{subject}', function () { return subject; })
    .replace('{body}', function () { return body; });
  const t = parseJson_(callAi_(prompt, { json: true, maxTokens: AI_MAX_TOKENS.triage, deadline: deadline }));
  t.items = Array.isArray(t.items) ? t.items : [];
  t.unmatched = Array.isArray(t.unmatched) ? t.unmatched : [];
  t.needs_human = Array.isArray(t.needs_human) ? t.needs_human : [];
  const out = normalizeTriage_(t, subject, body);
  // 客戶名稱由程式把關：不放信箱、不把你自己當客戶，找不到就是「未署名客戶」
  out.customer = resolveCustomer_(out.customer, msg, body);
  // 會寫進筆記與試算表的文字，信箱一律隱藏
  // 會寫進筆記與試算表的文字：信箱一律隱藏、簡體字轉成繁體
  const clean = function (x) { return toTraditional_(redactEmails_(x), '判讀結果'); };
  out.summary = clean(out.summary);
  out.deadline = clean(out.deadline);
  out.needs_human = out.needs_human.map(clean);
  out.items.forEach(function (it) { it.name = clean(it.name); });
  out.unmatched = out.unmatched.map(clean);
  out.customer = toTraditional_(out.customer, '客戶');
  return out;
}

/**
 * 判讀結果的保險：
 *   - intent 不是四個選項之一（例如「報價」「inquiry」）或是「其他」時：
 *       先看 NO_REPLY_RULES（推銷／廣告、單純感謝）→ 對到就設 t.noReply = { status, reason }，不建立草稿；
 *       否則用 INTENT_KEYWORDS 補判，並寫進 needs_human 請你確認
 *   - 不是詢價就清掉品項（才不會替改期、客訴算報價）
 *   - 客訴一定要人工確認
 */
function normalizeTriage_(t, subject, body) {
  t.needs_human = t.needs_human.map(function (x) { return String(x === null || x === undefined ? '' : x).trim(); })
    .filter(function (x) { return x && !/^[.。…⋯\s]*$/.test(x); });
  const raw = String(t.intent === null || t.intent === undefined ? '' : t.intent).trim();
  let intent = INTENTS.indexOf(raw) !== -1 ? raw : '';
  if (!intent || intent === '其他') {
    const text = String(subject || '') + '\n' + String(body || '');
    const own = quietText_(text);
    const quiet = NO_REPLY_RULES.filter(function (k) { return quietMatch_(k, own); })[0];
    if (quiet) {
      t.intent = '其他';
      t.items = [];
      t.unmatched = [];
      t.noReply = { status: quiet.status, reason: quiet.reason + (raw && raw !== '其他' ? '（AI 判讀為「' + raw + '」）' : '') + '；如果判斷錯了，請自己回覆' };
      return t;
    }
    const hit = INTENT_KEYWORDS.filter(function (k) { return k.re.test(text); })[0];
    if (hit) {
      t.needs_human.push('AI 判讀為「' + (raw || '空白') + '」，系統依關鍵字改判為「' + hit.intent + '」，請確認');
      intent = hit.intent;
    } else {
      intent = '其他';
    }
  }
  t.intent = intent;
  if (intent !== '詢價') {
    t.items = [];
    t.unmatched = [];
  }
  if (intent === '客訴' && !t.needs_human.length) t.needs_human.push('客訴內容與後續處理方式');
  return t;
}

/** 依判讀結果請 AI 寫回覆內文（REPLY_PROMPT 禁止寫金額與承諾）；報價明細之後由系統附在信末 */
function draftReply_(triage, deadline) {
  const json = JSON.stringify(triage, null, 2);
  return callAi_(REPLY_PROMPT.replace('{triage_json}', function () { return json; }), { maxTokens: AI_MAX_TOKENS.reply, deadline: deadline }).trim();
}

/**
 * AI 偶爾會照抄格式，留下沒寫內容的【需人工確認：…】。
 * 空的標記一律補上具體事項：依序用還沒出現在信裡的 needs_human，用完就寫通用提醒。
 */
function fixEmptyChecks_(text, needsHuman) {
  const pending = (needsHuman || []).filter(function (x) { return String(text).indexOf(x) === -1; });
  return String(text).replace(/【需人工確認[：:]?[\s.。…⋯_＿\-－—]*】/g, function () {
    const item = pending.shift();
    return '【需人工確認：' + (item || 'AI 在這裡留了空白標記，請檢查這段內容後補上或刪除') + '】';
  });
}

/**
 * 沒有附報價明細時，AI 還是寫了「報價明細請見信末」這類「叫讀者去看報價」的句子，避免客戶找不到明細。
 * 只處理同時有：指示詞（請見、請參考、詳見、請參閱、參見、如下）＋「報價」或「明細」＋位置詞（信末、下方、附件…）的句子，
 * 例如「感謝您隨信附上的訂單明細」沒有指示詞，不會動到。
 * 不會默默刪字：符合的句子換成【需人工確認】提醒（詢價：請人工報價；其他意圖：請確認），句子裡原本的【需人工確認…】標記一律保留。
 * 有明細（hasQuote 為 true）就原樣回傳。
 */
const QUOTE_DIRECTIVE_RE = /請見|請參考|詳見|請參閱|參見|如下/;
const QUOTE_WORD_RE = /報價|明細/;
const QUOTE_PLACE_RE = /信末|文末|信尾|下方|下列|以下|如下|附件|附檔|隨信/;

function stripQuoteMentions_(text, hasQuote, intent) {
  if (hasQuote) return String(text);
  const mark = intent === '詢價'
    ? '【需人工確認：本信沒有附報價明細，請人工報價後再寄出】'
    : '【需人工確認：此處提到報價明細，請確認】';
  return splitSentences_(String(text)).map(function (sen) {
    if (!(QUOTE_DIRECTIVE_RE.test(sen) && QUOTE_WORD_RE.test(sen) && QUOTE_PLACE_RE.test(sen))) return sen;
    const kept = sen.match(/【需人工確認[^】]*】/g) || [];
    return mark + kept.join('');
  }).join('');
}

/** 依 。！？!? 與換行切句（標點留在句尾、換行自成一段）；【…】裡的標點不切，標記才不會被拆開 */
function splitSentences_(text) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '【') depth++;
    if (ch === '】' && depth > 0) depth--;
    if (depth === 0 && ch === '\n') {
      if (cur) out.push(cur);
      out.push(ch);
      cur = '';
      continue;
    }
    cur += ch;
    if (depth === 0 && /[。！？!?]/.test(ch)) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 回覆內文不該有金額；萬一 AI 還是寫了，在最上面加【需人工確認】提醒 */
function flagAmounts_(text) {
  const hasAmount = /(NT\$|US\$|＄|\$|新台幣|台幣|美金)\s*[\d０-９]|[\d０-９][\d０-９,，.]*\s*(元|塊|萬|折)/.test(text);
  return {
    text: hasAmount ? '【需人工確認：回覆內文出現金額或折扣，報價以信末明細為準，寄出前請確認或刪除】\n\n' + text : text,
    flagged: hasAmount,
  };
}

/**
 * 推銷／感謝規則要看的文字：去掉引用的舊信（> 開頭的行、「On … wrote:」「… 寫道：」「-----Original Message-----」之後），
 * 舊信與信件頁尾的字才不會讓一封真正的詢價被當成推銷。
 */
function quietText_(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  const cut = s.search(/\n(On [\s\S]{0,300}?wrote:|[^\n]{0,80}(寫道|写道)：|-{3,}\s*(Original Message|原始郵件|原始邮件)\s*-{3,}|\s*(From|寄件者|发件人)\s*[:：][^\n]*\n\s*(Sent|Date|寄件日期|日期|發送時間|发送时间|To|收件者)\s*[:：])/i);
  return (cut === -1 ? s : s.slice(0, cut)).split('\n').filter(function (l) { return !/^\s*>/.test(l); }).join('\n');
}

/** 一條「不建草稿」規則對不對得上：有提問或請求（unless）就不算；推銷要強關鍵字或 minWeak 個以上不同的弱關鍵字 */
function quietMatch_(rule, text) {
  if (rule.unless && rule.unless.test(text)) return false;
  if (rule.re) return rule.re.test(text);
  if (rule.strong && rule.strong.test(text)) return true;
  return (rule.weak || []).filter(function (w) { return w.test(text); }).length >= (rule.minWeak || 1);
}

/** 比對承諾前先拿掉【需人工確認…】標記（標記裡的「退費要求」「折扣」不是承諾） */
function withoutChecks_(text) {
  return String(text).replace(/【需人工確認[^】]*】/g, '');
}

/** 回覆內文像是在答應退款或賠償（AI 不能替你承諾）：在最上面加【需人工確認】提醒，不會默默改字 */
function flagRefundPromise_(text) {
  const hit = REFUND_PROMISE_RE.test(withoutChecks_(text));
  return {
    text: hit ? '【需人工確認：回覆內文提到退款或賠償，AI 不能替你承諾，寄出前請確認或改寫】\n\n' + text : String(text),
    flagged: hit,
  };
}

/**
 * 回覆內文說某件事「已經」做了，或提出具體日期時間：在最上面加【需人工確認】提醒、狀態改成「需人工」。
 * 跟退款、折扣的檢查一樣，只加提醒、不改字：AI 寫的句子由你決定要刪還是改，程式不默默改寫。
 */
function flagClaims_(text) {
  const hit = ACTION_CLAIM_RE.test(withoutChecks_(text));
  return {
    text: hit ? '【需人工確認：回覆內文說某件事已經做了（例如已完成審核、已啟動流程），或提出了具體日期時間，AI 不能替你確認或答應，寄出前請確認或改寫】\n\n' + text : String(text),
    flagged: hit,
  };
}

/** 回覆內文像是在答應折扣、免費、保證或交期：在最上面加【需人工確認】提醒，不會默默改字 */
function flagPromises_(text) {
  const hit = PROMISE_RE.test(withoutChecks_(text));
  return {
    text: hit ? '【需人工確認：回覆內文提到折扣、免費、保證或交期，AI 不能替你承諾，寄出前請確認或改寫】\n\n' + text : String(text),
    flagged: hit,
  };
}

// ============ 報價（數字只來自報價表）============

/** 品項名稱比對前先統一：全形半形、空白（「活動攝影(半天)」＝「活動攝影（半天）」） */
function normalizeName_(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFKC').replace(/\s+/g, '');
}

/** 單價：數字直接用；文字容許「3,000」「NT$3000」「3000元」；看不懂回傳 null */
function parsePrice_(v) {
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? v : null;
  const t = String(v === null || v === undefined ? '' : v).normalize('NFKC').replace(/NT\$|US\$|\$|元|,|\s/gi, '');
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** 讀「報價表」分頁 → { map: { 統一後名稱: { name, price, unit, note } }, skipped: ['第 3 列 品項'] } */
function readPriceList_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRICE_SHEET_NAME);
  if (!sheet) throw new Error('找不到分頁「' + PRICE_SHEET_NAME + '」，請確認分頁名稱');
  const map = {};
  const skipped = [];
  sheet.getDataRange().getValues().slice(1).forEach(function (r, i) {
    const name = String(r[0]).trim();
    if (!name) return;
    const price = parsePrice_(r[1]);
    if (price === null) {
      skipped.push('第 ' + (i + 2) + ' 列「' + name + '」');
      return;
    }
    map[normalizeName_(name)] = { name: name, price: price, unit: r[2] || '', note: r[3] || '' };
  });
  if (skipped.length) console.warn('報價表略過（單價看不懂）：' + skipped.join('、'));
  return { map: map, skipped: skipped };
}

/** 依判讀出的品項與數量計算；查不到價格或沒有數量的，標記為需人工，不估算 */
function buildQuote_(triage, prices) {
  const lines = triage.items.map(function (it) {
    const p = prices[normalizeName_(it.name)];
    const n = it.qty === null || it.qty === undefined || it.qty === '' ? NaN : Number(it.qty);
    const qty = isFinite(n) && n > 0 ? n : null;
    if (!p) return { name: it.name, qty: qty, unit: '', price: null, subtotal: null, issue: '報價表查無此品項' };
    if (qty === null) return { name: p.name, qty: null, unit: p.unit, price: p.price, subtotal: null, issue: '客戶未提供數量' };
    return { name: p.name, qty: qty, unit: p.unit, price: p.price, subtotal: Math.round(p.price * qty * 100) / 100, issue: '' };
  });
  (triage.unmatched || []).forEach(function (n) {
    lines.push({ name: n, qty: null, unit: '', price: null, subtotal: null, issue: '報價表查無此品項' });
  });
  // 金額四捨五入到小數 2 位（避免電腦小數誤差）；營業稅取整數元
  const subtotal = Math.round(lines.reduce(function (s, l) { return s + (l.subtotal || 0); }, 0) * 100) / 100;
  const tax = Math.round(subtotal * TAX_RATE);
  return {
    lines: lines,
    subtotal: subtotal,
    tax: tax,
    total: subtotal + tax,
    complete: lines.every(function (l) { return !l.issue; }),
  };
}

/** 金額顯示：NT$120,000 */
function money_(n) {
  return 'NT$' + fmtNum_(n);
}

/** 信末的報價明細（純文字）：每個數字都來自 buildQuote_（報價表）；缺價格或數量就標【需人工確認】，合計寫「未完成」 */
function quoteText_(q) {
  const rows = q.lines.map(function (l) {
    return '・' + l.name + '　' + (l.qty === null ? '數量待確認' : l.qty + ' ' + l.unit) +
      (l.price === null ? '' : '　單價 ' + money_(l.price)) +
      (l.subtotal === null ? '　【需人工確認：' + l.issue + '】' : '　小計 ' + money_(l.subtotal));
  });
  const totalLine = q.complete
    ? '小計：' + money_(q.subtotal) + '　營業稅 ' + Math.round(TAX_RATE * 100) + '%：' + money_(q.tax) + '　合計：' + money_(q.total)
    : '已計價品項小計：' + money_(q.subtotal) + '　合計：（未完成）';
  return ['──── 報價明細（系統依報價表計算，寄出前請核對）────']
    .concat(rows, [
      totalLine,
      q.complete ? '' : '【需人工確認：部分品項缺價格或數量，合計尚未完成】',
      '報價有效期限：（請填入）',
    ]).filter(function (s) { return s !== ''; }).join('\n');
}

/** 報價單草稿 .md（存進 FinLab-Vault/秘書）；狀態固定寫「待確認」，確認後由你自己改 */
function buildQuoteMarkdown_(isoDate, triage, q, subject, permalink) {
  const rows = q.lines.map(function (l) {
    return '| ' + l.name + ' | ' + (l.qty === null ? '待確認' : l.qty) + ' | ' + l.unit + ' | ' +
      (l.price === null ? '' : money_(l.price)) + ' | ' + (l.subtotal === null ? '' : money_(l.subtotal)) + ' | ' + l.issue + ' |';
  });
  const checks = triage.needs_human.length ? triage.needs_human : ['（無）'];
  const totalLines = q.complete
    ? ['- 小計：' + money_(q.subtotal), '- 營業稅 ' + Math.round(TAX_RATE * 100) + '%：' + money_(q.tax), '- **合計：' + money_(q.total) + '**']
    : ['- 已計價品項小計：' + money_(q.subtotal), '- **合計：（未完成）** 部分品項缺價格或數量，尚未計入'];
  return [
    '---',
    '類型: 報價單草稿',
    '客戶: ' + yamlStr_(triage.customer || UNSIGNED_CUSTOMER),
    '日期: ' + isoDate,
    '合計: ' + (q.complete ? q.total : '"（未完成）"'),
    '狀態: 待確認',
    '---',
    '',
    '# 報價單草稿：' + mdInline_(triage.customer || UNSIGNED_CUSTOMER),
    '',
    '> 由 AI 秘書依「報價表」產生，**尚未寄出**。確認後請把上方 `狀態` 改成「已確認」。',
    '',
    '- 原信主旨：' + subject,
    '- 原信連結：' + permalink,
    '- 需求摘要：' + (triage.summary || ''),
    '- 期限：' + (triage.deadline || '未提及'),
    '',
    '| 品項 | 數量 | 單位 | 單價 | 小計 | 備註 |',
    '|---|---|---|---|---|---|',
  ].concat(rows, [''], totalLines, [
    '',
    '## 需人工確認',
    '',
  ], checks.map(function (c) { return '- [ ] ' + c; }), ['']).join('\n');
}

// ============ 繁體中文與占位字整理（AI 寫的字由程式再把關）============

// 簡體 → 繁體：只收「一對一、不會誤改」的常用字（商務信件常見）。
// 刻意不收有歧義或本身也是繁體字的：后（皇后）、系、干、面、里、台、余、并、准、复、历、据、体、内、签、账、冲、只、才、范、松、谷、致、制、咨。
const SIMPLIFIED_TO_TRADITIONAL = {
  // 整個詞換（單獨的字有歧義，詞沒有）：「后」單獨可能是皇后，「后续」「之后」一定是後
  '复印': '複印', '后续': '後續', '之后': '之後', '然后': '然後', '以后': '以後', '最后': '最後', '后来': '後來',
  '谢': '謝', '们': '們', '这': '這', '为': '為', '时': '時', '会': '會', '请': '請', '问': '問', '题': '題', '联': '聯',
  '价': '價', '单': '單', '报': '報', '务': '務', '发': '發', '个': '個', '对': '對', '关': '關', '应': '應', '项': '項',
  '订': '訂', '认': '認', '确': '確', '资': '資', '讯': '訊', '费': '費', '预': '預', '约': '約', '议': '議', '处': '處',
  '经': '經', '济': '濟', '汇': '匯', '币': '幣', '银': '銀', '涨': '漲', '数': '數', '还': '還', '进': '進', '运': '運',
  '营': '營', '业': '業', '产': '產', '设': '設', '计': '計', '网': '網', '页': '頁', '让': '讓', '说': '說', '话': '話',
  '带': '帶', '欢': '歡', '见': '見', '觉': '覺', '间': '間', '场': '場', '摄': '攝', '动': '動', '电': '電', '邮': '郵',
  '东': '東', '车': '車', '门': '門', '开': '開', '买': '買', '卖': '賣', '实': '實', '际': '際', '现': '現', '样': '樣',
  '过': '過', '没': '沒', '与': '與', '当': '當', '补': '補', '偿': '償', '赔': '賠', '额': '額', '优': '優', '节': '節',
  '质': '質', '级': '級', '线': '線', '给': '給', '统': '統', '维': '維', '护': '護', '码': '碼', '写': '寫', '读': '讀',
  '员': '員', '师': '師', '长': '長', '张': '張', '陈': '陳', '刘': '劉', '吴': '吳', '杨': '楊', '黄': '黃', '郑': '鄭',
  '谁': '誰', '览': '覽', '记': '記', '录': '錄', '状': '狀', '态': '態', '证': '證', '难': '難', '环': '環', '销': '銷',
  '购': '購', '货': '貨', '输': '輸', '尽': '盡', '决': '決', '协': '協', '谅': '諒', '误': '誤', '错': '錯', '帮': '幫',
  '办': '辦', '递': '遞', '变': '變', '换': '換', '续': '續', '视': '視', '频': '頻', '辑': '輯', '诊': '診', '医': '醫',
  '园': '園', '馆': '館', '书': '書', '图': '圖', '询': '詢', '户': '戶', '来': '來', '国': '國', '学': '學', '习': '習',
  '财': '財', '兑': '兌', '贬': '貶', '盘': '盤', '债': '債', '较': '較', '稳': '穩', '势': '勢', '绿': '綠', '岛': '島',
};
// 對照表沒收、但只有簡體才會用的字：還出現就記一行提醒（不擋下）
const SIMPLIFIED_ONLY_HINT = /[么叶号块坏层岁庄库归异蛮虽烦恼脑圣灵阶阴阳顾]/;

/** 把對照表裡的簡體字換成繁體；繁體字原樣不動。還有對照表外的簡體字就記一行提醒，不擋下 */
function toTraditional_(s, where) {
  let t = String(s === null || s === undefined ? '' : s);
  Object.keys(SIMPLIFIED_TO_TRADITIONAL).forEach(function (k) {
    if (t.indexOf(k) !== -1) t = t.split(k).join(SIMPLIFIED_TO_TRADITIONAL[k]);
  });
  const left = t.match(SIMPLIFIED_ONLY_HINT);
  if (left) console.warn('可能還有簡體字「' + left[0] + '」' + (where ? '（' + where + '）' : '') + '，寄出前請檢查');
  return t;
}

const SIGNATURE_PLACEHOLDER = '（請填入你的署名）';

/**
 * 回覆草稿的占位字整理：
 *   - 拿掉多出來的 { }（提示詞裡有 JSON，AI 偶爾會把括號抄進信裡，例如實測的「（請填入你的署名}」）
 *   - 每一行的【與】、「與」數量不對時，在行尾補上缺的右括號
 *   - AI 自己寫的署名占位字一律拿掉，由程式在信末加一行固定的（請填入你的署名）
 */
function tidyPlaceholders_(text) {
  let t = String(text).replace(/[{}｛｝]/g, '');
  t = t.replace(/[「『（(]*\s*請填入你的署名\s*[）)」』\]】]*/g, '');
  t = t.split('\n').map(function (line) {
    let l = line;
    const opens = (l.match(/【/g) || []).length - (l.match(/】/g) || []).length;
    for (let i = 0; i < opens; i++) l += '】';
    const q = (l.match(/「/g) || []).length - (l.match(/」/g) || []).length;
    for (let i = 0; i < q; i++) l += '」';
    return l;
  }).join('\n');
  return t.replace(/\s+$/, '') + '\n' + SIGNATURE_PLACEHOLDER;
}

// ============ 客戶名稱（不放信箱、不把你自己當客戶、同一位客戶合併）============

/** 文字裡的信箱換成「（信箱已隱藏）」：摘要、原因、主旨等寫進筆記與試算表前用 */
function redactEmails_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[^\s<>()（）「」"',，;；:：]+@[^\s<>()（）「」"',，;；:：]+/g, '（信箱已隱藏）');
}

/**
 * 你自己的名字與信箱（小寫）：帳號信箱、別名、信箱 @ 前面那段，以及「這封信如果是你寄的」寄件人顯示名稱。
 * 課堂練習信都是寄給自己，寄件人就是你；這些名字一律不能當客戶。
 */
function myIdentityNames_(msg) {
  const addrs = myAddresses_();
  const out = addrs.slice();
  addrs.forEach(function (a) { out.push(a.split('@')[0]); });
  try {
    const from = String(msg.getFrom() || '');
    const m = from.match(/<([^>]+)>/);
    const addr = (m ? m[1] : from).trim().toLowerCase();
    if (addrs.indexOf(addr) !== -1) out.push(senderName_(from).toLowerCase());
  } catch (err) {
    // 讀不到寄件人就算了
  }
  return out.filter(function (x) { return x && x !== '未具名寄件人'; });
}

/**
 * 整理客戶名稱：拿掉 <…>、含 @ 的字、網址、反斜線與引號，去頭尾空白，最多 CUSTOMER_MAX_CHARS 個字。
 * 整理完是空的、或是你自己的名字／信箱（myNames），就回傳空字串（由呼叫的地方決定改寫成什麼）。
 */
function sanitizeCustomer_(raw, myNames) {
  let s = String(raw === null || raw === undefined ? '' : raw).normalize('NFKC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .split(/\s+/).filter(function (w) { return w.indexOf('@') === -1; }).join(' ')
    .replace(/[\\"'“”‘’「」『』]/g, '')
    .replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > CUSTOMER_MAX_CHARS) s = s.slice(0, CUSTOMER_MAX_CHARS).trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if ((myNames || []).some(function (n) { return n === low; })) return '';
  return s;
}

/**
 * 備援：AI 沒給客戶（或給的是你自己）時，從內文最後一行的署名找。
 * 只接受：內文至少兩行、最後一行不超過 30 個字、沒有 @ 或網址、不是句子（不以標點結尾）、不是問候語。
 */
function signatureCustomer_(body, myNames) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l; });
  if (lines.length < 2) return '';
  const last = lines[lines.length - 1];
  if (last.length > 30 || /@|https?:|www\./i.test(last) || /[。！？!?.,，、：:;；]$/.test(last)) return '';
  if (/^(您好|你好|謝謝|感謝|敬祝|順頌|祝好|Best|Regards|Thanks|Thank you|Sincerely|Cheers)/i.test(last)) return '';
  return sanitizeCustomer_(last, myNames);
}

/** 這封信的客戶名稱：AI 給的 → 整理；不能用就看署名；都沒有就是「未署名客戶」。絕不包含信箱 */
function resolveCustomer_(aiCustomer, msg, body) {
  const me = myIdentityNames_(msg);
  return sanitizeCustomer_(aiCustomer, me) || signatureCustomer_(body, me) || UNSIGNED_CUSTOMER;
}

/** 比對用的客戶名稱：全形半形、空白、標點都拿掉，英文小寫，結尾的稱謂（小姐、先生、經理…）也拿掉 */
function customerNorm_(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[\s.,，。、·・\-_()（）'"「」]/g, '')
    .replace(/(小姐|先生|女士|經理|院長|老師|店長|老闆|總監|主任|mr|ms|mrs)$/, '');
}

/** 讀出來比對用的「你自己」：帳號信箱、別名與它們 @ 前面那段（小寫） */
function myReadNames_() {
  const addrs = myAddresses_();
  return addrs.concat(addrs.map(function (a) { return a.split('@')[0]; }));
}

/** 從試算表讀出的客戶名稱：拿掉信箱等，是你自己或空的就寫「未署名客戶」 */
function readCustomer_(v, me) {
  return sanitizeCustomer_(String(v || '').replace(/^'/, ''), me) || UNSIGNED_CUSTOMER;
}

/** 「秘書紀錄」客戶欄裡含 @ 的舊資料，改成整理過的名稱（一格一格寫，只動這一欄）；回傳改了幾格 */
function cleanLegacyCustomers_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SECRETARY_LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h); });
  const c = secretaryLogCol_(header, '客戶');
  if (c === -1) return 0;
  const me = myReadNames_();
  let n = 0;
  sheet.getRange(2, c + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r, i) {
    const v = String(r[0] || '');
    if (v.indexOf('@') === -1) return;
    sheet.getRange(i + 2, c + 1).setValue(sheetSafe_(readCustomer_(v, me)));
    n++;
  });
  return n;
}

/** 「秘書紀錄」裡出現過的客戶名稱（不含未署名、處理失敗的寄件人） */
function knownCustomers_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SECRETARY_LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h); });
  const c = secretaryLogCol_(header, '客戶');
  if (c === -1) return [];
  const seen = {};
  sheet.getRange(2, c + 1, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
    const v = sanitizeCustomer_(String(r[0] || '').replace(/^'/, ''));
    if (v && v !== UNSIGNED_CUSTOMER && v !== '未具名客戶' && v !== '未具名寄件人') seen[v] = true;
  });
  return Object.keys(seen);
}

/**
 * 同一位客戶只用一個名字（客戶筆記才會合併）。規則：
 *   - 比對用 customerNorm_（不看空白、標點、全半形、結尾稱謂）
 *   - 一樣 → 用比較長的寫法（例如「星河咖啡 陳小姐」勝過「星河咖啡陳小姐」以外的短寫法）
 *   - 一個是另一個的開頭（「星河咖啡」與「星河咖啡 陳小姐」）→ 用比較長的「公司 聯絡人」
 *   - 新的比較長時，把之前用短名稱的紀錄（試算表、紀錄筆記、報價單、客戶筆記）改成長名稱（upgradeCustomer_）
 *   - 太短（比對用的字少於 2 個）或「未署名客戶」不合併
 */
function canonicalCustomer_(name) {
  if (!name || name === UNSIGNED_CUSTOMER) return name || UNSIGNED_CUSTOMER;
  const nn = customerNorm_(name);
  if (nn.length < 2) return name;
  const known = knownCustomers_();
  for (let i = 0; i < known.length; i++) {
    const k = known[i];
    const nk = customerNorm_(k);
    if (nk.length < 2) continue;
    if (nk === nn || nk.indexOf(nn) === 0 || nn.indexOf(nk) === 0) {
      if (k.length >= name.length) return k;
      upgradeCustomer_(k, name);
      return name;
    }
  }
  return name;
}

/**
 * 把舊的（比較短的）客戶名稱改成新的長名稱：試算表「客戶」欄、紀錄筆記與報價單的 frontmatter 客戶、
 * 紀錄筆記裡的客戶連結、舊的客戶筆記的 客戶（兩篇客戶筆記都會列出同樣的紀錄）。只改這些欄位，你寫的字不動。
 */
function upgradeCustomer_(oldName, newName) {
  try {
    const log = secretaryLogSheet_();
    const col = function (n) { return secretaryLogCol_(log.header, n); };
    const n = log.sheet.getLastRow() - 1;
    if (n < 1) return;
    const rows = log.sheet.getRange(2, 1, n, log.header.length).getValues();
    const oldLink = '[[' + VAULT_CUSTOMER_FOLDER + '/' + customerNoteKey_(oldName) + '|' + mdCell_(oldName) + ']]';
    const newLink = '[[' + VAULT_CUSTOMER_FOLDER + '/' + customerNoteKey_(newName) + '|' + mdCell_(newName) + ']]';
    const touch = function (name, withLink) {
      if (!name) return;
      const cur = readVaultFile_('秘書', name + '.md');
      if (!cur || frontmatterValue_(cur.content, '客戶') !== oldName) return;
      let t = setFrontmatterKeys_(cur.content, { '客戶': yamlStr_(newName) });
      if (withLink) t = t.split(oldLink).join(newLink);
      cur.file.setContent(t);
    };
    rows.forEach(function (r, i) {
      if (String(r[col('客戶')]).replace(/^'/, '') !== oldName) return;
      log.sheet.getRange(i + 2, col('客戶') + 1).setValue(sheetSafe_(newName));
      touch(String(r[col('知識庫筆記')] || ''), true);
      touch(String(r[col('報價單')] || ''), false);
    });
    const oldNote = readVaultFile_(VAULT_CUSTOMER_FOLDER, customerNoteKey_(oldName) + '.md');
    if (oldNote && frontmatterValue_(oldNote.content, '客戶') === oldName) {
      oldNote.file.setContent(setFrontmatterKeys_(oldNote.content, { '客戶': yamlStr_(newName) }));
    }
    console.log('秘書：客戶名稱「' + oldName + '」合併成「' + newName + '」');
  } catch (err) {
    logError_('秘書：合併客戶名稱', err);
  }
}

// ============ 秘書紀錄（試算表＋知識庫筆記）============

/**
 * 外來文字（主旨、摘要、客戶、品項…）放進筆記前先整理成一行，避免弄壞筆記：
 * 換行變空白、HTML 註解記號 <!-- --> 與 wikilink 的 [[ ]] 換成全形、行首的 # 換成全形（不會變成標題）。
 * mdCell_ 另外把 | 換成全形（表格儲存格用）。
 */
function mdInline_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[\r\n]+/g, ' ')
    .replace(/<!--/g, '＜!--').replace(/-->/g, '--＞')
    .replace(/\[\[/g, '［［').replace(/\]\]/g, '］］')
    .replace(/^\s*#+/, function (m) { return m.replace(/#/g, '＃'); })
    .trim();
}
function mdCell_(s) {
  return mdInline_(s).replace(/\|/g, '｜');
}

/** 寫進試算表的文字：= + - @（或 tab、CR）開頭的前面加 '，試算表才不會把它當成公式執行 */
function sheetSafe_(v) {
  return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

/** 一封信的紀錄（之後寫進「秘書紀錄」分頁與 秘書/<日期>-<意圖>-<客戶>.md）；品項只記名稱、數量、報價表有沒有 */
function newSecretaryRecord_(thread, msg, triage, prices) {
  const items = (triage.items || []).map(function (it) {
    const p = prices[normalizeName_(it.name)];
    const n = it.qty === null || it.qty === undefined || it.qty === '' ? NaN : Number(it.qty);
    return { name: p ? p.name : String(it.name), qty: isFinite(n) && n > 0 ? n : null, inList: !!p };
  }).concat((triage.unmatched || []).map(function (n) { return { name: String(n), qty: null, inList: false }; }));
  const now = new Date();
  return {
    time: now,
    isoDate: Utilities.formatDate(now, REPORT_TIMEZONE, 'yyyy-MM-dd'),
    customer: triage.customer || UNSIGNED_CUSTOMER,
    subject: redactEmails_(msg.getSubject()),
    intent: triage.intent || '其他',
    summary: triage.summary || '',
    deadline: triage.deadline || '',
    tone: triage.tone || '',
    items: items,
    permalink: thread.getPermalink(),
    threadId: thread.getId(),
    lastInbound: msgDate_(msg),
    draftId: '',
    quoteNote: '',
    total: '',
    draft: false,
    status: '',
    reasons: [],
  };
}

/** 信的時間；讀不到就空字串 */
function msgDate_(m) {
  try {
    return m && m.getDate ? m.getDate() : '';
  } catch (err) {
    return '';
  }
}

/** 處理失敗的信也留一篇紀錄（狀態「需人工」、沒有草稿）；客戶寫寄件人的顯示名稱，不寫信箱 */
function failedSecretaryRecord_(thread, msg, err) {
  let customer = UNSIGNED_CUSTOMER;
  let subject = '';
  try {
    const m = msg || thread.getMessages()[0];
    customer = canonicalCustomer_(resolveCustomer_(senderName_(m.getFrom()), m, m.getPlainBody()));
    subject = m.getSubject();
  } catch (e) {
    subject = thread.getFirstMessageSubject();
  }
  const now = new Date();
  return {
    time: now,
    isoDate: Utilities.formatDate(now, REPORT_TIMEZONE, 'yyyy-MM-dd'),
    customer: customer,
    subject: redactEmails_(subject),
    intent: FAILED_INTENT,
    summary: '',
    deadline: '',
    tone: '',
    items: [],
    permalink: thread.getPermalink(),
    threadId: thread.getId(),
    draftId: '',
    quoteNote: '',
    total: '',
    draft: false,
    status: SECRETARY_STATUS.HUMAN,
    reasons: ['處理失敗：' + String((err && err.message) || err), '沒有建立草稿，請自己讀信並回覆'],
  };
}

/** 「"王經理" <wang@example.com>」→「王經理」；沒有顯示名稱就寫「未具名寄件人」（不把信箱寫進紀錄） */
function senderName_(from) {
  const name = String(from || '').replace(/<[^>]*>/g, '').replace(/["'\\]/g, '').trim();
  return name && name.indexOf('@') === -1 ? name : '未具名寄件人';
}

/**
 * 狀態對應的「下一步」清單（知識庫筆記用）；意圖、有沒有報價單、有沒有草稿會影響內容。
 * 用一般的項目符號、不用勾選框：這一段由程式產生，狀態一變就整段換掉，勾了也會不見。想打勾記錄請寫在「我的備註」。
 */
function nextStepLines_(status, intent, hasQuote, hasDraft) {
  const S = SECRETARY_STATUS;
  const lines = ['- 目前狀態：**' + status + '**（' + (STATUS_HELP[status] || '你自己設定的狀態') + '）'];
  if (status === S.DRAFT || (status === S.HUMAN && hasDraft)) {
    if (status === S.HUMAN) lines.push('- 先自己讀完原信，了解狀況（這封信要你親自判斷）');
    if (intent === '客訴') lines.push('- 退費、賠償、補救方式由你決定；AI 草稿不會替你答應');
    lines.push('- 打開 Gmail「草稿」，把每個【需人工確認】處理掉');
    if (hasQuote) lines.push('- 核對報價單的品項與數量，確認後把報價單的 `狀態` 改成「已確認」');
    if (intent === '改期') lines.push('- 確認新的時間你可以，再寫進草稿');
    lines.push('- 改好之後由你自己按「傳送」（程式不會寄信）；寄出後，下次秘書執行會自動改成「已回覆」');
  } else if (status === S.HUMAN) {
    lines.push('- 這封信沒有草稿：請自己讀信，直接在 Gmail 回覆');
    lines.push('- 回覆後，下次秘書執行會自動改成「已回覆」');
  } else if (status === S.REPLIED) {
    lines.push('- 已經回覆，不用再做什麼。想留紀錄可以寫在下方「我的備註」。');
  } else if (status === S.DISCARDED) {
    lines.push('- 草稿被刪掉了，也沒有看到你的回覆。還要回就直接在 Gmail 回覆；不用回就放著。');
  } else if (status === S.SKIPPED || status === S.NO_REPLY) {
    lines.push('- 不用處理。如果其實是重要的信，請自己回覆，並把上方 `狀態` 改成「已回覆」。');
  }
  return lines;
}

/** 試算表「下一步」欄用的一行版本 */
function nextStepShort_(status, intent, hasQuote, hasDraft) {
  return nextStepLines_(status, intent, hasQuote, hasDraft).slice(1)
    .map(function (l) { return l.replace(/^- (\[ \] )?/, ''); }).join('；');
}

/** 知識庫筆記的「下一步」段落（狀態更新時整段換掉；一定是程式產生段落的最後一段） */
function nextStepSection_(status, intent, hasQuote, hasDraft) {
  return NEXT_STEP_HEADING + '\n\n' + nextStepLines_(status, intent, hasQuote, hasDraft).join('\n') + '\n\n';
}

/** 秘書紀錄筆記中程式產生的那一段（只有摘要，不存信件全文；金額只來自報價表；外來文字都經過 mdInline_／mdCell_） */
function secretaryNoteBlock_(rec) {
  const lines = [
    '<!-- 信件ID: ' + rec.threadId + ' -->',
    '> AI 秘書整理的紀錄：只有摘要，不存信件全文。回覆草稿一律不會自動寄出。',
    '',
    '- 客戶：[[' + VAULT_CUSTOMER_FOLDER + '/' + customerNoteKey_(rec.customer) + '|' + mdCell_(rec.customer) + ']]',
    '- 主旨：' + mdInline_(rec.subject),
    '- 處理時間：' + Utilities.formatDate(rec.time, REPORT_TIMEZONE, 'yyyy-MM-dd HH:mm'),
    '- 原信：[在 Gmail 打開](' + rec.permalink + ')',
    '- 回覆草稿：' + (rec.draft ? '已建立（Gmail「草稿」匣，主旨「Re: ' + mdInline_(rec.subject) + '」；寄出或刪掉後就不在草稿匣）' : '沒有建立'),
    '',
    '## 來信摘要',
    '',
    mdInline_(rec.summary) || (rec.intent === FAILED_INTENT ? '（處理失敗，沒有摘要）' : '（AI 沒有提供摘要）'),
    '',
    '- 客戶提到的期限：' + (mdInline_(rec.deadline) || '未提及'),
  ];
  if (rec.tone) lines.push('- 語氣：' + mdInline_(rec.tone));
  if (rec.intent === '詢價') {
    lines.push('', '## 判讀出的品項', '');
    if (rec.items.length) {
      lines.push('| 品項 | 數量 | 報價表 |', '|---|---|---|');
      rec.items.forEach(function (it) {
        lines.push('| ' + mdCell_(it.name) + ' | ' + (it.qty === null ? '待確認' : it.qty) + ' | ' + (it.inList ? '有（單價見報價單）' : '查無此品項，需人工報價') + ' |');
      });
    } else {
      lines.push('（信裡沒有對得上報價表的品項，請人工報價）');
    }
    if (rec.total !== '') lines.push('', '- 報價合計（系統依報價表計算）：' + (typeof rec.total === 'number' ? money_(rec.total) : rec.total));
    if (rec.quoteNote) lines.push('- 報價單：[[秘書/' + rec.quoteNote + '|' + rec.quoteNote + ']]');
  }
  if (rec.followups && rec.followups.length) {
    lines.push('', '## 追蹤紀錄', '');
    rec.followups.forEach(function (f) { lines.push(f); });
  }
  lines.push('', '## 為什麼需要人工處理', '');
  if (rec.reasons.length) rec.reasons.forEach(function (r) { lines.push('- ' + mdInline_(redactEmails_(r))); });
  else lines.push('- （沒有特別標記；寄出前仍請把草稿讀過一次）');
  lines.push('');
  return lines.join('\n') + '\n' + nextStepSection_(rec.status, rec.intent, !!rec.quoteNote, rec.draft);
}

/** 程式負責的 frontmatter 欄位（重新處理同一封信時只更新這些，其他欄位與標題是你的） */
function secretaryNoteKeys_(rec) {
  return {
    '客戶': yamlStr_(rec.customer),
    '意圖': rec.intent,
    '狀態': rec.status,
    '草稿': rec.draft ? 'yes' : 'no',
    '草稿ID': rec.draftId ? yamlStr_(rec.draftId) : '',
    '報價單': rec.quoteNote ? yamlStr_('[[' + rec.quoteNote + ']]') : '',
  };
}

/** 秘書紀錄筆記的完整內容（第一次建立用） */
function secretaryNoteContent_(rec) {
  const keys = secretaryNoteKeys_(rec);
  return [
    '---',
    '類型: 秘書紀錄',
    '日期: ' + rec.isoDate,
  ].concat(Object.keys(keys).filter(function (k) { return k !== '草稿ID' || keys[k]; }).map(function (k) { return k + ': ' + keys[k]; }), [
    '---',
    '# ' + mdInline_(rec.intent + '｜' + rec.customer),
    '',
    GEN_START,
    secretaryNoteBlock_(rec) + GEN_END,
  ]).join('\n') + '\n\n## 我的備註（自己寫，程式不會改）\n\n- \n';
}

/**
 * 只改 frontmatter 裡指定的欄位（值是空字串且原本沒有的欄位不加）；其他欄位、其他內容原樣保留。
 * 換行可以是 \n 或 \r\n；沒有 frontmatter 就原樣回傳。
 */
function setFrontmatterKeys_(text, keys) {
  const m = String(text).match(/^---(\r?\n)([\s\S]*?)\r?\n---/);
  if (!m) return String(text);
  const nl = m[1];
  const lines = m[2].split(/\r?\n/);
  Object.keys(keys).forEach(function (k) {
    const i = lines.findIndex(function (l) { return l.indexOf(k + ':') === 0; });
    if (i !== -1) lines[i] = k + ': ' + keys[k];
    else if (keys[k] !== '') lines.push(k + ': ' + keys[k]);
  });
  return '---' + nl + lines.join(nl) + nl + '---' + String(text).slice(m[0].length);
}

/** frontmatter 某個欄位的值（去掉引號）；沒有 frontmatter 或沒有這個欄位回傳空字串 */
function frontmatterValue_(text, key) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return '';
  const line = m[1].split(/\r?\n/).filter(function (l) { return l.indexOf(key + ':') === 0; })[0];
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : '';
}

/** 「秘書紀錄」裡這封信（信件ID）最新的那一列：{ row（第幾列）, get(欄位名稱) }；沒有就回傳 null */
function findSecretaryRow_(threadId) {
  if (!threadId) return null;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SECRETARY_LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h); });
  const idCol = secretaryLogCol_(header, '信件ID');
  if (idCol === -1) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][idCol]) === String(threadId)) {
      const r = rows[i];
      return { row: i + 2, get: function (name) { const c = secretaryLogCol_(header, name); return c === -1 ? '' : r[c]; } };
    }
  }
  return null;
}

/** 試算表的時間（Date 或文字）→ 毫秒；讀不懂回傳 0 */
function rowTime_(v) {
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v || ''));
  return isFinite(t) ? t : 0;
}

/** 這封信是不是你（帳號或別名）寄的 */
function fromMe_(m, me) {
  const from = String(m.getFrom() || '').toLowerCase();
  return me.some(function (a) { return from.indexOf(a) !== -1; });
}

/**
 * 這串信裡的「來信」（依時間順序）：不是你寄的信；或是這串信的第一封、而且是你寄給你自己的（課堂練習信）。
 * 你自己寄出的其他信（例如已經寄出的回覆）一律不算，秘書絕不替它們寫回覆草稿。
 */
function inboundMessages_(msgs, me) {
  return msgs.filter(function (m, i) {
    if (!fromMe_(m, me)) return true;
    if (i !== 0) return false;
    const to = String((m.getTo && m.getTo()) || '').toLowerCase();
    return me.some(function (a) { return to.indexOf(a) !== -1; });
  });
}

/** 你在這串信裡最後一次寄出（不是來信）的時間；沒有就回傳 0 */
function latestOwnReply_(msgs, inbound, me) {
  return msgs.reduce(function (t, m) {
    return inbound.indexOf(m) === -1 && fromMe_(m, me) ? Math.max(t, m.getDate().getTime()) : t;
  }, 0);
}

/** 一行追蹤紀錄：時間、最新那封的主旨與摘要（外來文字都經過整理） */
function followupLine_(f) {
  return '- ' + Utilities.formatDate(f.at, REPORT_TIMEZONE, 'yyyy-MM-dd HH:mm') + '　客戶又來信（主旨「' + mdInline_(f.subject) + '」）' +
    (f.summary ? '：' + mdInline_(redactEmails_(f.summary)) : '');
}

/** 舊筆記裡程式產生段落中「## 追蹤紀錄」底下的那幾行 */
function followupLines_(block) {
  const i = String(block).indexOf('## 追蹤紀錄');
  if (i === -1) return [];
  const out = [];
  String(block).slice(i).split('\n').slice(1).some(function (l) {
    if (/^## /.test(l)) return true;
    if (/^- /.test(l)) out.push(l);
    return false;
  });
  return out;
}

/** 這串信之前建立的 AI 草稿還在嗎？（用「秘書紀錄」記下的草稿ID 查，你刪掉開頭標記也認得） */
function recordDraftAlive_(thread) {
  try {
    const row = findSecretaryRow_(thread.getId());
    const id = row ? String(row.get('草稿ID') || '') : '';
    if (!id) return false;
    const d = GmailApp.getDraft(id);
    return !!(d && d.getMessage().getId()); // 草稿已經寄出或刪掉時，這裡會丟出錯誤
  } catch (err) {
    return false; // 草稿不存在時 getDraft 會丟出錯誤
  }
}

/**
 * 找這封信的紀錄筆記要寫在哪裡：
 *   1. 先用「秘書紀錄」裡同一個信件ID 的「知識庫筆記」找（隔天重新處理也找得到，不會多一篇）
 *   2. 再看 <日期>-<意圖>-<客戶>、-2、-3…：檔裡有同一個信件ID 就沿用，沒有這個檔就用這個名字
 * 沿用的筆記只換程式產生的段落（回傳 parts）；開始／結束標記壞掉的筆記一律不覆寫，改用下一個名字並記一筆紀錄。
 * 回傳 { name, parts }（parts 為 null 表示建立新檔）。
 */
function secretaryNoteTarget_(rec) {
  const tryExisting = function (name) {
    const cur = readVaultFile_('秘書', name + '.md');
    if (!cur) return { free: true };
    // 檔裡沒有這封信的信件ID：別封信的紀錄，或你自己寫的筆記，不碰
    if (cur.content.indexOf('<!-- 信件ID: ' + rec.threadId + ' -->') === -1) return { other: true };
    const parts = splitGenerated_(cur.content);
    return parts ? { parts: parts } : { broken: true };
  };
  const row = findSecretaryRow_(rec.threadId);
  const known = row ? String(row.get('知識庫筆記') || '') : '';
  if (known) {
    const r = tryExisting(known);
    if (r.parts || r.free) return { name: known, parts: r.parts || null };
    if (r.broken) console.warn('秘書紀錄筆記「' + known + '」的自動更新標記壞掉了，不覆寫，改寫到新的一篇');
  }
  const base = rec.isoDate + '-' + rec.intent + '-' + customerNoteKey_(rec.customer);
  for (let i = 1; i <= 9; i++) {
    const name = i === 1 ? base : base + '-' + i;
    if (name === known) continue;
    const r = tryExisting(name);
    if (r.free) return { name: name, parts: null };
    if (r.parts) return { name: name, parts: r.parts };
    if (r.broken) console.warn('秘書紀錄筆記「' + name + '」的自動更新標記壞掉了，不覆寫');
  }
  // 9 個名字都被占用：用信件ID 當檔名；連這個也存在（而且不是可沿用的）就再加上時間，絕不覆寫
  const last = base + '-' + rec.threadId;
  const r = tryExisting(last);
  if (r.parts) return { name: last, parts: r.parts };
  return { name: r.free ? last : last + '-' + Date.now(), parts: null };
}

/**
 * 把「…-未判讀-…」的紀錄筆記改名成新的意圖：日期沿用原本檔名的日期，撞名就加 -2、-3…；回傳新名稱（不含 .md）。
 * 只會被 saveSecretaryRecord_ 對「試算表記著、檔裡有這封信信件ID」的筆記呼叫，你自己建的檔不會被改名。
 * 改名失敗就沿用舊名稱（內容照樣更新）。
 */
function renameFailedNote_(oldName, rec) {
  const date = /^\d{4}-\d{2}-\d{2}/.test(oldName) ? oldName.slice(0, 10) : rec.isoDate;
  const base = date + '-' + rec.intent + '-' + customerNoteKey_(rec.customer);
  let name = '';
  for (let i = 1; i <= 9 && !name; i++) {
    const n = i === 1 ? base : base + '-' + i;
    if (!readVaultFile_('秘書', n + '.md')) name = n;
  }
  if (!name) return oldName;
  try {
    const cur = readVaultFile_('秘書', oldName + '.md');
    if (!cur) return oldName;
    cur.file.setName(name + '.md');
    console.log('秘書：紀錄筆記改名「' + oldName + '」→「' + name + '」');
    return name;
  } catch (err) {
    logError_('秘書：紀錄筆記改名', err);
    return oldName;
  }
}

/** 寫紀錄：知識庫（客戶筆記＋紀錄筆記）與「秘書紀錄」分頁；知識庫寫不進去也照樣記試算表 */
function saveSecretaryRecord_(rec) {
  let note = '';
  try {
    ensureCustomerNote_(rec.customer);
    const target = secretaryNoteTarget_(rec);
    // 追蹤紀錄：沿用舊筆記裡的，再加上這一次
    rec.followups = (target.parts ? followupLines_(target.parts.block) : []).concat(rec.followup ? [followupLine_(rec.followup)] : []);
    let before = target.parts ? target.parts.before : '';
    if (target.parts && target.name.indexOf('-' + FAILED_INTENT + '-') !== -1 && rec.intent !== FAILED_INTENT) {
      // 之前判讀失敗（檔名是 …-未判讀-…）、這次判讀出意圖：檔名改成新的意圖（撞名就加 -2、-3）
      target.name = renameFailedNote_(target.name, rec);
      // 標題還是程式當初寫的「未判讀｜…」才跟著換；你改過的標題不動
      before = before.replace(new RegExp('\\n# ' + FAILED_INTENT + '｜[^\\n]*'), '\n# ' + mdInline_(rec.intent + '｜' + rec.customer));
    }
    const content = target.parts
      // 沿用舊筆記：frontmatter 只改程式負責的欄位，標題、你加的欄位、「我的備註」都保留
      ? setFrontmatterKeys_(before, secretaryNoteKeys_(rec)) + GEN_START + '\n' + secretaryNoteBlock_(rec) + GEN_END + target.parts.after
      : secretaryNoteContent_(rec);
    writeVaultFile_('秘書', target.name + '.md', content);
    note = target.name;
  } catch (err) {
    logError_('秘書：紀錄存進知識庫', err);
  }
  logSecretary_({
    '時間': rec.time,
    '客戶': rec.customer,
    '主旨': rec.subject,
    '意圖': rec.intent,
    '狀態': rec.status,
    '草稿': rec.draft ? 'yes' : 'no',
    '報價單': rec.quoteNote,
    '報價合計': rec.total,
    '需人工原因': redactEmails_(rec.reasons.join('；')),
    '下一步': nextStepShort_(rec.status, rec.intent, !!rec.quoteNote, rec.draft),
    '更新時間': new Date(),
    '最後來信': rec.lastInbound || '',
    'Gmail 連結': rec.permalink,
    '信件ID': rec.threadId,
    '草稿ID': rec.draftId,
    '知識庫筆記': note,
  });
}

/** 在標題列找欄位（含舊名稱，例如「處理時間」＝「時間」）；找不到回傳 -1 */
function secretaryLogCol_(header, name) {
  const names = [name].concat(SECRETARY_LOG_ALIASES[name] || []);
  for (let i = 0; i < names.length; i++) {
    const idx = header.indexOf(names[i]);
    if (idx !== -1) return idx;
  }
  return -1;
}

/** 取得「秘書紀錄」分頁與標題列；沒有就建立，舊表缺的欄位加在最右邊（舊的列不動） */
function secretaryLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SECRETARY_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SECRETARY_LOG_SHEET);
    sheet.getRange(1, 1, 1, SECRETARY_LOG_COLUMNS.length).setValues([SECRETARY_LOG_COLUMNS]);
    sheet.setFrozenRows(1);
  }
  const header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(function (h) { return String(h); });
  while (header.length && header[header.length - 1] === '') header.pop();
  SECRETARY_LOG_COLUMNS.forEach(function (col) {
    if (secretaryLogCol_(header, col) === -1) {
      header.push(col);
      sheet.getRange(1, header.length).setValue(col);
    }
  });
  return { sheet: sheet, header: header };
}

/**
 * 「秘書紀錄」分頁加一列（依標題列對欄位）；同一封信（信件ID 一樣）再處理一次就更新原本那列，不會重複，
 * 而且只改程式的欄位，你自己加的欄位不動。文字經過 sheetSafe_（不會被當成公式）。
 * 寫不進去只記警告，不影響已建立的草稿。
 */
function logSecretary_(row) {
  try {
    const log = secretaryLogSheet_();
    const idCol = secretaryLogCol_(log.header, '信件ID');
    let target = -1;
    if (row['信件ID'] && log.sheet.getLastRow() > 1) {
      const ids = log.sheet.getRange(2, idCol + 1, log.sheet.getLastRow() - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0]) === String(row['信件ID'])) { target = i + 2; break; }
      }
    }
    if (target === -1) {
      const values = log.header.map(function () { return ''; });
      Object.keys(row).forEach(function (k) {
        const i = secretaryLogCol_(log.header, k);
        if (i !== -1) values[i] = sheetSafe_(row[k]);
      });
      log.sheet.appendRow(values);
    } else {
      // 更新同一列：只一格一格寫程式的欄位；你自己加的欄位（含公式、「00123」這種文字）完全不碰
      Object.keys(row).forEach(function (k) {
        const i = secretaryLogCol_(log.header, k);
        if (i !== -1) log.sheet.getRange(target, i + 1).setValue(sheetSafe_(row[k]));
      });
    }
  } catch (err) {
    console.warn('未寫入「' + SECRETARY_LOG_SHEET + '」：' + err.message);
  }
}

/** 回頭檢查最多花多久（毫秒）；寫成函式方便測試 */
function refreshBudgetMs_() {
  return REFRESH_TIME_BUDGET_MS;
}

/** 這個帳號的信箱與別名（小寫）：別名寄出的回覆也算「你回了」 */
function myAddresses_() {
  const out = [];
  try { out.push(String(Session.getEffectiveUser().getEmail() || '')); } catch (err) { /* 讀不到就算了 */ }
  try { (GmailApp.getAliases() || []).forEach(function (a) { out.push(String(a)); }); } catch (err) { /* 讀不到就算了 */ }
  return out.map(function (a) { return a.trim().toLowerCase(); }).filter(function (a) { return a; });
}

/**
 * 回頭更新還沒結案的紀錄（狀態是「待確認草稿」或「需人工」、而且有信件ID）：
 *   - 輪流檢查：從上次停下來的地方接著看（REFRESH_CURSOR_PROP），每次最多 REFRESH_MAX_PER_RUN 筆、最多 120 秒；
 *     找不到的信（被刪掉）不算在 20 筆裡。舊的紀錄不會一直排不到。
 *   - 先看知識庫筆記：你在 Obsidian 已經把 狀態 改成別的（例如「已回覆」），就以你的為準，試算表跟著改，不查 Gmail。
 *   - 再看 Gmail（每串信只讀一次）：草稿還在（記下的草稿ID 還在，或這串信裡還有任何草稿）→ 不變；
 *     草稿不在了、這串信裡有你（含別名）在處理之後寄出的信 → 已回覆；草稿不在、也沒回 → 已捨棄。
 *     沒有草稿的「需人工」紀錄維持不變，直到你回覆。處理時間讀不懂的列不改（避免誤判成已回覆）。
 * 變了才寫：試算表的 狀態／下一步／更新時間，以及筆記的 狀態 與「下一步」段落（你寫的備註不動）。回傳更新了幾筆。
 */
function refreshSecretaryStatuses_(budgetMs) {
  const started = Date.now();
  const budget = budgetMs === undefined ? refreshBudgetMs_() : budgetMs;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SECRETARY_LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const log = secretaryLogSheet_();
  const col = function (name) { return secretaryLogCol_(log.header, name); };
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, log.header.length).getValues();
  const open = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (OPEN_STATUSES.indexOf(String(rows[i][col('狀態')])) !== -1 && String(rows[i][col('信件ID')] || '')) open.push(i);
  }
  if (!open.length) return 0;
  const props = PropertiesService.getScriptProperties();
  const cursor = (Number(props.getProperty(REFRESH_CURSOR_PROP)) || 0) % open.length;
  const order = open.slice(cursor).concat(open.slice(0, cursor));
  const me = myAddresses_();
  let draftIds = null; // 第一次需要時才讀一次草稿匣
  let checked = 0;
  let visited = 0;
  let changed = 0;
  try {
  for (let k = 0; k < order.length && checked < REFRESH_MAX_PER_RUN; k++) {
    if (Date.now() - started > budget) break;
    visited++;
    const i = order[k];
    try {
    const r = rows[i];
    const status = String(r[col('狀態')]);
    const intent = String(r[col('意圖')]);
    const hasQuote = !!r[col('報價單')];
    const hasDraft = String(r[col('草稿')]) === 'yes';
    const noteName = String(r[col('知識庫筆記')] || '');
    const write = function (final) {
      sheet.getRange(i + 2, col('狀態') + 1).setValue(final);
      sheet.getRange(i + 2, col('下一步') + 1).setValue(nextStepShort_(final, intent, hasQuote, hasDraft));
      sheet.getRange(i + 2, col('更新時間') + 1).setValue(new Date());
      changed++;
    };
    // 1. 你在 Obsidian 改過的狀態優先
    const noteStatus = noteName ? secretaryNoteStatus_(noteName) : '';
    if (noteStatus && noteStatus !== status && OPEN_STATUSES.indexOf(noteStatus) === -1) {
      checked++;
      write(noteStatus);
      continue;
    }
    // 2. 看 Gmail
    let thread = null;
    try {
      thread = GmailApp.getThreadById(String(r[col('信件ID')]));
    } catch (err) {
      thread = null;
    }
    if (!thread) continue; // 找不到的信不算在上限裡
    checked++;
    // 回覆從「處理時間」與「最後來信」較晚的那個算起：追蹤之後，你之前的舊回覆不算
    const since = Math.max(rowTime_(r[col('時間')]), rowTime_(r[col('最後來信')]));
    if (!(since > 0)) continue; // 處理時間讀不懂：不改，避免把原信當成你的回覆
    const draftId = String(r[col('草稿ID')] || '');
    if (draftId && draftIds === null) {
      try {
        draftIds = GmailApp.getDrafts().map(function (d) { return String(d.getId()); });
      } catch (err) {
        draftIds = [];
      }
    }
    const next = nextSecretaryStatus_(thread.getMessages(), status, hasDraft, draftId, draftIds, since, me);
    if (next === status) continue;
    write(updateSecretaryNoteStatus_(noteName, next, intent, hasQuote, hasDraft));
    } catch (err) {
      // 一筆出錯不影響其他筆
      logError_('秘書：更新紀錄狀態（第 ' + (i + 2) + ' 列）', err);
    }
  }
  } finally {
    // 游標：這次看過、但還沒結案的筆數。結案的（changed）下次不在清單裡，扣掉才不會跳過還沒看的
    const remaining = open.length - changed;
    props.setProperty(REFRESH_CURSOR_PROP, String(remaining > 0 ? (cursor + visited - changed + remaining) % remaining : 0));
  }
  return changed;
}

/** 依這串信現在的樣子決定新狀態（msgs 是這串信的全部訊息，只讀一次；見 refreshSecretaryStatuses_ 的說明） */
function nextSecretaryStatus_(msgs, status, hasDraft, draftId, draftIds, since, me) {
  const draftLeft = (draftId && draftIds && draftIds.indexOf(draftId) !== -1) ||
    msgs.some(function (m) { return m.isDraft(); });
  if (hasDraft && draftLeft) return status;
  const replied = me.length > 0 && msgs.some(function (m) {
    if (m.isDraft() || m.getDate().getTime() <= since) return false;
    const from = String(m.getFrom()).toLowerCase();
    return me.some(function (a) { return from.indexOf(a) !== -1; });
  });
  if (replied) return SECRETARY_STATUS.REPLIED;
  return hasDraft ? SECRETARY_STATUS.DISCARDED : status;
}

/** 讀知識庫紀錄筆記 frontmatter 的 狀態；筆記不存在或讀不到回傳空字串 */
function secretaryNoteStatus_(noteName) {
  try {
    const cur = readVaultFile_('秘書', noteName + '.md');
    return cur ? frontmatterValue_(cur.content, '狀態') : '';
  } catch (err) {
    return '';
  }
}

/**
 * 更新知識庫筆記的 狀態（只改 frontmatter 那一行）與「下一步」段落；回傳最後採用的狀態。
 * 筆記的 狀態 已經被你改成「待確認草稿」「需人工」以外的值 → 不動筆記，回傳你的狀態（試算表跟著改）。
 */
function updateSecretaryNoteStatus_(noteName, next, intent, hasQuote, hasDraft) {
  if (!noteName) return next;
  try {
    const cur = readVaultFile_('秘書', noteName + '.md');
    if (!cur) return next;
    const noteStatus = frontmatterValue_(cur.content, '狀態');
    if (noteStatus && OPEN_STATUSES.indexOf(noteStatus) === -1) return noteStatus;
    let text = setFrontmatterKeys_(cur.content, { '狀態': next });
    const parts = splitGenerated_(text);
    if (!parts) {
      // 自動更新標記壞掉了：筆記一字不改（試算表照樣更新），記一筆提醒
      console.warn('秘書紀錄筆記「' + noteName + '」的自動更新標記壞掉了，狀態只更新在試算表');
      return next;
    }
    // 「下一步」一定是程式產生段落的最後一段：用最後一次出現的位置，摘要裡就算有同樣的字也不會切錯
    const k = parts.block.lastIndexOf(NEXT_STEP_HEADING);
    if (k !== -1) {
      text = parts.before + GEN_START + '\n' + parts.block.slice(0, k) + nextStepSection_(next, intent, hasQuote, hasDraft) + GEN_END + parts.after;
    }
    cur.file.setContent(text);
  } catch (err) {
    logError_('秘書：更新紀錄筆記的狀態', err);
  }
  return next;
}

// ============ 今日總覽 ============
/**
 * 給今日總覽用：
 *   drafts      還留在 Gmail 草稿匣的 AI 草稿（開頭有 DRAFT_MARK，或是「秘書紀錄」裡還沒結案的草稿ID）
 *   failedCount 貼著「AI秘書/需人工」的信
 *   recent      過去 24 小時「秘書紀錄」裡處理過的信（不含「略過」「不需回覆」與處理失敗；新舊欄位都讀得懂）
 *   quiet       過去 24 小時判斷為「略過」「不需回覆」、沒有建立草稿的信（請你掃一眼，關鍵字判斷可能看錯）
 */
function getSecretaryStatus_() {
  const me = myReadNames_();
  const recent = [];
  const quiet = [];
  const openDraftIds = [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SECRETARY_LOG_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h); });
    const since = Date.now() - 24 * 60 * 60 * 1000;
    sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues().forEach(function (r) {
      const get = function (name) { const i = secretaryLogCol_(header, name); return i === -1 ? '' : r[i]; };
      const t = get('時間');
      const st = String(get('狀態'));
      const intent = String(get('意圖') || '');
      if (OPEN_STATUSES.indexOf(st) !== -1 && get('草稿ID')) openDraftIds.push(String(get('草稿ID')));
      if (!(t instanceof Date) || t.getTime() < since) return;
      // 讀出來也把關（舊版留下的「名字 <信箱>」）：客戶過 sanitizeCustomer_、主旨過 redactEmails_
      const item = { customer: readCustomer_(get('客戶'), me), intent: intent, subject: redactEmails_(get('主旨')), total: get('報價合計'), status: st,
        note: String(get('知識庫筆記') || ''), quote: String(get('報價單') || '') };
      if (st === SECRETARY_STATUS.SKIPPED || st === SECRETARY_STATUS.NO_REPLY) { quiet.push(item); return; }
      // 舊版的「失敗：…」「略過：已有 AI 草稿」與處理失敗（意圖「未判讀」）都不算
      if (intent && intent !== FAILED_INTENT && st.indexOf('失敗') !== 0 && st.indexOf('略過') !== 0) recent.push(item);
    });
  }

  const drafts = GmailApp.getDrafts()
    .filter(function (d) {
      let id = '';
      try { id = String(d.getId()); } catch (err) { id = ''; }
      return (id && openDraftIds.indexOf(id) !== -1) || d.getMessage().getPlainBody().indexOf(DRAFT_MARK) === 0;
    })
    // 總覽最多列 10 封，信才不會太長
    .slice(0, 10)
    .map(function (d) {
      const m = d.getMessage();
      return { subject: redactEmails_(m.getSubject()), checks: (m.getPlainBody().match(/【需人工確認/g) || []).length };
    });

  const fail = GmailApp.getUserLabelByName(SECRETARY_FAIL_LABEL);
  // 最多數 50 串（Gmail 一次讀太多會變慢）
  const failedCount = fail ? fail.getThreads(0, 50).length : 0;
  return { drafts: drafts, failedCount: failedCount, recent: recent, quiet: quiet };
}

// ============ 小工具 ============
/** 找 Gmail 標籤，沒有就建立 */
function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** AI 偶爾會把 JSON 包在 ``` 裡，或在前後多講幾句話，先剝掉再解析 */
function parseJson_(text) {
  const t = String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch (err) {
    // 免費模型有時會在 JSON 前後加一句說明：只取第一個 { 到最後一個 } 再試一次
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    const notJson = 'AI 回傳的判讀結果不是 JSON，請再處理一次或改人工處理。';
    if (a === -1 || b <= a) throw new Error(notJson);
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch (err2) {
      throw new Error(notJson);
    }
  }
}
