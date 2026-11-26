/**
 * 私人商務秘書 — 讀「AI秘書」標籤的信 → 判讀 → 建立 Gmail 回覆草稿（不寄出）＋ 報價單草稿存進知識庫
 *
 * 流程：
 *   1. 你在 Gmail 把要處理的信貼上標籤「AI秘書」（手動或用篩選器自動貼）
 *   2. AI（OpenRouter 免費模型）判讀信件：意圖、客戶、品項與數量、需要人工確認的事（prompts/04）
 *   3. 價格一律由「報價表」分頁計算（AI 不碰數字）
 *   4. AI 寫回覆內文（prompts/05，禁止寫金額與承諾），系統把報價明細附在信末
 *   5. 存成 Gmail「草稿」——不會寄出；有報價就另存一份 Markdown 到 FinLab-Vault/秘書
 *   6. 標籤換成「AI秘書/已處理」（失敗的換成「AI秘書/需人工」），並記一列到「秘書紀錄」分頁
 *   7. 隔天早上的「今日總覽」信會列出還沒確認的草稿（getSecretaryStatus_）
 *
 * ⚠️ 隱私：信件內容會經過 OpenRouter 送到免費模型的提供者。部分免費模型的提供者可能保留或用輸入資料訓練模型
 *    （依各提供者條款，以官網為準：https://openrouter.ai/docs/guides/privacy/provider-logging），
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
  '  "customer": "寄件人姓名或公司，信裡沒有就空字串",',
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
  '4. needs_human 裡的每一項，在信中相關位置標上【需人工確認：事項內容】，例如【需人工確認：折扣】；冒號後面一定要寫出具體事項，不可留空或只寫刪節號。needs_human 是空的就不要出現這個標記。',
  '5. 不要編造公司政策、人名、電話或網址；署名寫「（請填入你的署名）」。',
  '6. 只輸出信件內文，不要加任何說明或 Markdown 符號。',
].join('\n');

// ============ 選單 ============
/** 選單 ⑤：手動處理一次。AI 關閉時只跳說明：不讀信、不呼叫 AI、不改標籤 */
function menuProcessSecretary() {
  if (!isAiEnabled_()) { alertAiOffForSecretary_('秘書處理'); return; }
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, SECRETARY_SCOPES);
  runMenu_('秘書處理', function () {
    const r = processSecretaryMail();
    SpreadsheetApp.getUi().alert('秘書處理完成',
      '已建立 ' + r.drafted + ' 封回覆草稿（在 Gmail「草稿」），' + r.quotes + ' 份報價單草稿（在「' + VAULT_ROOT_NAME + '/秘書」）。\n' +
      (r.failed ? r.failed + ' 封處理失敗，已貼上「' + SECRETARY_FAIL_LABEL + '」標籤，請人工處理。\n' : '') +
      (r.skipped ? r.skipped + ' 封已經有 AI 草稿，這次略過（不會重複建立）。\n' : '') +
      (r.priceSkipped.length ? '報價表有 ' + r.priceSkipped.length + ' 列單價看不懂、已略過：' + r.priceSkipped.join('、') + '。請把 B 欄改成數字。\n' : '') +
      (r.drafted + r.failed + r.skipped === 0 ? '\n沒有找到貼著「' + SECRETARY_LABEL + '」標籤的信。' : '\n提醒：草稿不會自動寄出，請逐封檢查【需人工確認】的地方。'),
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
 * 秘書主流程：每次最多處理 MAX_THREADS_PER_RUN 串信；每串信只建立一封回覆「草稿」，不寄出。
 * 回傳 { drafted, quotes, failed, skipped, priceSkipped } 給選單 ⑤ 顯示。每小時的觸發器執行的就是這個函式。
 */
function processSecretaryMail() {
  // 安全：AI 關閉就整個略過（排程觸發也一樣）：0 次 AI 呼叫、不讀信、標籤不動
  if (!isAiEnabled_()) {
    console.warn('AI 已關閉，略過秘書處理。');
    return { drafted: 0, quotes: 0, failed: 0, skipped: 0, priceSkipped: [] };
  }
  const inbox = getOrCreateLabel_(SECRETARY_LABEL);
  const done = getOrCreateLabel_(SECRETARY_DONE_LABEL);
  const fail = getOrCreateLabel_(SECRETARY_FAIL_LABEL);
  const priceList = readPriceList_();
  const prices = priceList.map;
  const result = { drafted: 0, quotes: 0, failed: 0, skipped: 0, priceSkipped: priceList.skipped };

  inbox.getThreads(0, MAX_THREADS_PER_RUN).forEach(function (thread) {
    try {
      // 重跑時不重複建立：這串信已經有 AI 草稿就直接移到「已處理」
      if (hasAiDraft_(thread)) {
        thread.removeLabel(inbox).addLabel(done);
        result.skipped++;
        logSecretary_([new Date(), '', '', thread.getFirstMessageSubject(), '', '', '略過：已有 AI 草稿', thread.getPermalink()]);
        return;
      }
      // 草稿也算在 thread 裡，先排除，才不會拿自己的草稿去判讀
      const msgs = thread.getMessages().filter(function (m) { return !m.isDraft(); });
      if (!msgs.length) throw new Error('這串信裡沒有可以判讀的信');
      const msg = msgs[msgs.length - 1];
      const triage = triageEmail_(msg, prices);
      // 只有詢價才算報價；改期、客訴不附報價明細、不存報價單
      const quote = triage.intent === '詢價' && (triage.items.length || triage.unmatched.length) ? buildQuote_(triage, prices) : null;
      // 詢價但對不到任何品項（例如關鍵字改判、或客戶沒寫具體品項）：沒有明細可附，請人工報價
      if (triage.intent === '詢價' && !quote) triage.needs_human.push(NO_QUOTE_CHECK);
      triage.hasQuote = !!quote; // 回覆提示詞依這個決定要不要寫「報價明細請見信末」

      const reply = flagAmounts_(stripQuoteMentions_(fixEmptyChecks_(draftReply_(triage), triage.needs_human), triage.hasQuote, triage.intent));
      let body = DRAFT_MARK + '\n\n' + reply.text;
      if (quote) body += '\n\n' + quoteText_(quote);

      // 先存報價單：存檔失敗不擋草稿，但會記在「秘書紀錄」的狀態
      let status = '草稿已建立';
      if (quote) {
        try {
          const isoDate = Utilities.formatDate(new Date(), REPORT_TIMEZONE, 'yyyy-MM-dd');
          const who = noteKey_(triage.customer || '未具名客戶') || '未具名客戶';
          writeVaultFile_('秘書', '報價單草稿-' + who + '-' + isoDate + '.md',
            buildQuoteMarkdown_(isoDate, triage, quote, msg.getSubject(), thread.getPermalink()));
          result.quotes++;
        } catch (err) {
          logError_('秘書：報價單存進知識庫', err);
          status = '草稿已建立（報價單未存檔：' + err.message + '）';
        }
      }

      // 安全：createDraftReply 只建立「草稿」，不會寄出；整份程式沒有任何寄信給客戶的動作
      msg.createDraftReply(body);
      result.drafted++;

      thread.removeLabel(inbox).addLabel(done);
      if (ADD_INTENT_LABEL && INTENTS.indexOf(triage.intent) !== -1) {
        thread.addLabel(getOrCreateLabel_(SECRETARY_LABEL + '/' + triage.intent));
      }
      // 客訴：草稿照常建立，但另外貼「需人工」，讓今日總覽的「需人工的信」也算到它
      if (COMPLAINT_NEEDS_HUMAN && triage.intent === '客訴') {
        thread.addLabel(fail);
        status += '（客訴，已貼「' + SECRETARY_FAIL_LABEL + '」）';
      }
      logSecretary_([new Date(), triage.customer || '未具名客戶', triage.intent || '其他', msg.getSubject(),
        quote ? (quote.complete ? quote.total : '（未完成）') : '',
        triage.needs_human.length + (quote && !quote.complete ? 1 : 0) + (reply.flagged ? 1 : 0), status, thread.getPermalink()]);
    } catch (err) {
      logError_('秘書：' + thread.getFirstMessageSubject(), err);
      thread.removeLabel(inbox).addLabel(fail);
      result.failed++;
      logSecretary_([new Date(), '', '', thread.getFirstMessageSubject(), '', '', '失敗：' + err.message, thread.getPermalink()]);
    }
  });
  return result;
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
function triageEmail_(msg, prices) {
  const names = Object.keys(prices).map(function (k) { return '- ' + prices[k].name; }).join('\n') || '（報價表是空的）';
  const from = msg.getFrom();
  const subject = msg.getSubject();
  const body = msg.getPlainBody().slice(0, MAX_BODY_CHARS);
  // 用函式當替換值：信裡的 $ 符號（例如 NT$）不會被當成特殊字元
  const prompt = TRIAGE_PROMPT
    .replace('{item_names}', function () { return names; })
    .replace('{from}', function () { return from; })
    .replace('{subject}', function () { return subject; })
    .replace('{body}', function () { return body; });
  const t = parseJson_(callAi_(prompt, { json: true }));
  t.items = Array.isArray(t.items) ? t.items : [];
  t.unmatched = Array.isArray(t.unmatched) ? t.unmatched : [];
  t.needs_human = Array.isArray(t.needs_human) ? t.needs_human : [];
  return normalizeTriage_(t, subject, body);
}

/**
 * 判讀結果的保險：
 *   - intent 不是四個選項之一（例如「報價」「inquiry」）或是「其他」時，用 INTENT_KEYWORDS 補判，並寫進 needs_human 請你確認
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
function draftReply_(triage) {
  const json = JSON.stringify(triage, null, 2);
  return callAi_(REPLY_PROMPT.replace('{triage_json}', function () { return json; })).trim();
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
    '客戶: "' + String(triage.customer || '未具名客戶').replace(/"/g, "'") + '"',
    '日期: ' + isoDate,
    '合計: ' + (q.complete ? q.total : '"（未完成）"'),
    '狀態: 待確認',
    '---',
    '',
    '# 報價單草稿：' + (triage.customer || '未具名客戶'),
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

// ============ 秘書紀錄與今日總覽 ============
/** 「秘書紀錄」分頁加一列；寫不進去只記警告，不影響已建立的草稿 */
function logSecretary_(row) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SECRETARY_LOG_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(SECRETARY_LOG_SHEET);
      sheet.appendRow(['處理時間', '客戶', '意圖', '主旨', '報價合計', '需人工確認', '狀態', '信件連結']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow(row);
  } catch (err) {
    console.warn('未寫入「' + SECRETARY_LOG_SHEET + '」：' + err.message);
  }
}

/**
 * 給今日總覽用：
 *   drafts      還留在 Gmail 草稿匣的 AI 草稿（= 還沒確認寄出）
 *   failedCount 貼著「AI秘書/需人工」的信
 *   recent      過去 24 小時「秘書紀錄」裡處理過的信
 */
function getSecretaryStatus_() {
  const drafts = GmailApp.getDrafts()
    .map(function (d) { return d.getMessage(); })
    .filter(function (m) { return m.getPlainBody().indexOf(DRAFT_MARK) === 0; })
    // 總覽最多列 10 封，信才不會太長
    .slice(0, 10)
    .map(function (m) {
      return { subject: m.getSubject(), checks: (m.getPlainBody().match(/【需人工確認/g) || []).length };
    });

  const fail = GmailApp.getUserLabelByName(SECRETARY_FAIL_LABEL);
  // 最多數 50 串（Gmail 一次讀太多會變慢）
  const failedCount = fail ? fail.getThreads(0, 50).length : 0;

  const recent = [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SECRETARY_LOG_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    // 只讀前 7 欄（處理時間～狀態）；狀態是「失敗」或「略過」的不算「已處理」
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues().forEach(function (r) {
      if (r[0] instanceof Date && r[0].getTime() >= since && String(r[6]).indexOf('失敗') !== 0 && String(r[6]).indexOf('略過') !== 0) {
        recent.push({ customer: r[1], intent: r[2], subject: r[3], total: r[4] });
      }
    });
  }
  return { drafts: drafts, failedCount: failedCount, recent: recent };
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
