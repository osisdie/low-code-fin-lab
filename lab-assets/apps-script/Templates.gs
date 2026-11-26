/**
 * 今日總覽的信件版面 — 同一份內容（財經數字＋秘書待辦），三種排法，看你喜歡哪一種
 *
 * 換版面：試算表選單「🎨 選擇信件版面」（存在指令碼屬性 REPORT_TEMPLATE）
 * 想比較：選單「🎨 寄三種版面樣張給我」
 *
 * 這裡只負責「排版」，不產生任何數字：數字來自 ctx.data（資料表），文字摘要來自 AI（OpenRouter 免費模型）。
 * 想自己做第四種版面：在 REPORT_TEMPLATES 加一項，並在 renderBriefing_ 對應一個 xxxHtml_ 函式。
 */

// 沒選過版面時用「完整」。REPORT_TEMPLATES 的 key（compact／full／table）就是存進指令碼屬性 REPORT_TEMPLATE 的值
const DEFAULT_TEMPLATE = 'full';
const REPORT_TEMPLATES = {
  compact: { name: '精簡', desc: '手機一眼看完：變動最大的 3 項＋秘書待辦數量' },
  full: { name: '完整', desc: 'AI 摘要全文＋秘書待辦清單＋原始數據' },
  table: { name: '表格', desc: '主管版：行情表與秘書表，數字對齊好比較' },
};

const UP_COLOR = '#c8341e';   // 台灣習慣：紅漲綠跌
const DOWN_COLOR = '#1f8a4c';
// 灰色：說明文字；淺米色：分隔線與表格框線
const MUTED_COLOR = '#6b6a60';
const LINE_COLOR = '#e3ddcc';

/** 回傳 { subject, html, text }；text 是給不顯示 HTML 的信箱用的純文字版 */
function renderBriefing_(key, ctx) {
  const pending = ctx.secretary ? ctx.secretary.drafts.length : 0;
  const subject = '📰 今日總覽 ' + ctx.dateStr + (pending ? '｜待確認草稿 ' + pending + ' 封' : '');
  const render = key === 'compact' ? compactHtml_ : key === 'table' ? tableHtml_ : fullHtml_;
  return { subject: subject, html: wrapHtml_(ctx, render(ctx)), text: briefingText_(ctx) };
}

// ============ 三種版面 ============

/** 精簡：最大的 3 個變動＋秘書三個數字 */
function compactHtml_(ctx) {
  const movers = topMovers_(ctx.data.items, 3);
  const missing = ctx.data.items.filter(function (it) { return it.price === null; }).length;
  const sec = ctx.secretary;
  let html = h2_('今天變動最大') +
    movers.map(function (it) {
      return '<div style="padding:10px 0;border-bottom:1px solid ' + LINE_COLOR + ';font-size:17px">' +
        '<b>' + esc_(shortName_(it.name)) + '</b>　' + fmtNum_(it.price) + '　' + pctHtml_(it.changePct) + '</div>';
    }).join('') +
    (missing ? '<p style="color:' + MUTED_COLOR + ';font-size:13px">另有 ' + missing + ' 項今天查無資料。</p>' : '');

  html += h2_('秘書');
  if (!sec) return html + secretaryOff_();
  html += '<table role="presentation" width="100%" style="border-collapse:collapse;text-align:center"><tr>' +
    bigNumber_(sec.drafts.length, '待確認草稿') + bigNumber_(sec.failedCount, '需人工的信') + bigNumber_(sec.recent.length, '昨日處理') +
    '</tr></table>';
  sec.drafts.slice(0, 3).forEach(function (d) {
    html += '<div style="font-size:15px;padding:4px 0">☐ ' + esc_(d.subject) + '</div>';
  });
  return html + quietHtml_(sec);
}

/** 完整：AI 摘要全文＋秘書清單＋原始數據 */
function fullHtml_(ctx) {
  let html = h2_('財經摘要');
  html += '<div style="white-space:pre-wrap;font-size:15px;line-height:1.75">' + esc_(ctx.summary) + '</div>';

  html += h2_('秘書待辦');
  html += ctx.secretary
    ? '<div style="font-size:15px;line-height:1.75">' + secretaryMarkdown_(ctx.secretary).map(mdLineHtml_).join('') + '</div>'
    : secretaryOff_();

  html += h2_('原始數據（可自行核對）') +
    '<div style="font-size:13px;color:' + MUTED_COLOR + ';line-height:1.8">' +
    ctx.data.items.map(function (it) {
      return esc_(it.name) + '：' + (it.price === null ? '查無資料' : fmtNum_(it.price)) + ' ' + pctHtml_(it.changePct) + '　<span>[' + esc_(it.source) + ']</span>';
    }).join('<br>') + '</div>';
  return html;
}

/** 表格：行情表＋秘書表，摘要放最後 */
function tableHtml_(ctx) {
  // 手機上欄位不能太多：來源已寫在頁尾，這裡只放項目、數字、漲跌
  let html = h2_('行情') + table_(['項目', '數字', '漲跌'], ctx.data.items.map(function (it) {
    return [esc_(shortName_(it.name)), it.price === null ? '查無資料' : fmtNum_(it.price), pctHtml_(it.changePct)];
  }), [false, true, true]);

  const sec = ctx.secretary;
  html += h2_('秘書｜待確認草稿 ' + (sec ? sec.drafts.length : 0) + ' 封');
  if (!sec) {
    html += secretaryOff_();
  } else {
    html += sec.drafts.length
      ? table_(['主旨', '需人工確認'], sec.drafts.map(function (d) { return [esc_(d.subject), d.checks + ' 處']; }), [false, true])
      : '<p style="font-size:14px">目前沒有待確認的草稿 👍</p>';
    if (sec.failedCount) html += '<p style="font-size:14px;color:' + UP_COLOR + '">⚠️ 有 ' + sec.failedCount + ' 封信貼著「AI秘書/需人工」，請直接處理。</p>';
    html += quietHtml_(sec);
    html += h2_('過去 24 小時處理的信');
    html += sec.recent.length
      ? table_(['客戶', '意圖', '報價合計'], sec.recent.map(function (r) {
          return [esc_(r.customer), esc_(r.intent), r.total === '' ? '—' : fmtNum_(r.total)];
        }), [false, false, true])
      : '<p style="font-size:14px">沒有。</p>';
  }

  html += h2_('AI 摘要') +
    '<div style="white-space:pre-wrap;font-size:13px;color:' + MUTED_COLOR + ';line-height:1.7">' + esc_(ctx.summary) + '</div>';
  return html;
}

// ============ 共用 ============

/**
 * 信件外框：標題、日期、版面內容、頁尾。
 * 頁尾的「僅供參考，不構成投資建議」「AI 草稿一律不會自動寄出」寫在這裡，三種版面都會有；
 * 美股休市那一行也在這裡（日期下面），三種版面都會有。
 */
function wrapHtml_(ctx, inner) {
  return '<div style="background:#faf7f0;padding:16px 12px;font-family:\'Noto Sans TC\',\'PingFang TC\',\'Microsoft JhengHei\',sans-serif;color:#20211c">' +
    '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid ' + LINE_COLOR + ';border-radius:10px;padding:20px 22px">' +
    '<div style="font-size:12px;letter-spacing:.12em;color:' + UP_COLOR + '">MY AI BRIEFING</div>' +
    '<div style="font-size:22px;font-weight:700;margin:2px 0 4px">📰 今日總覽</div>' +
    '<div style="font-size:14px;color:' + MUTED_COLOR + '">' + esc_(ctx.dateStr) + '</div>' +
    // 美股休市：三種版面都在最上面顯示同一行（AI 關閉時也有）
    (ctx.data && !ctx.data.usMarketOpen ? usClosedHtml_(ctx.data) : '') +
    inner +
    '<div style="margin-top:22px;padding-top:12px;border-top:1px solid ' + LINE_COLOR + ';font-size:12px;color:' + MUTED_COLOR + ';line-height:1.7">' +
    '數字來自 Google Finance、CoinGecko、Yahoo Finance 與你的報價表；AI 只整理文字。僅供參考，不構成投資建議。<br>' +
    'AI 草稿一律不會自動寄出。' + (ctx.sheetUrl ? '　<a href="' + esc_(ctx.sheetUrl) + '" style="color:' + UP_COLOR + '">打開試算表看「日報紀錄」「秘書紀錄」</a>' : '') +
    (ctx.updatedAt ? '<br>資料更新時間：' + esc_(ctx.updatedAt) + '（台灣時間）' : '') +
    '</div></div></div>';
}

/** 純文字版的整封信（收信軟體不顯示 HTML 時看這個）；一樣有原始數據與免責聲明 */
function briefingText_(ctx) {
  return [
    '📰 今日總覽 ' + ctx.dateStr,
    '',
    ctx.data.usMarketOpen ? null : '🇺🇸 ' + usClosedLine_(ctx.data) + '\n',
    ctx.summary,
    '',
    '──────── 秘書待辦 ────────',
    ctx.secretary ? secretaryMarkdown_(ctx.secretary).join('\n') : '秘書尚未啟用。',
    '',
    '──────── 原始數據（可自行核對）────────',
    rawTable_(ctx.data),
    '',
    '僅供參考，不構成投資建議。AI 草稿一律不會自動寄出。',
    ctx.updatedAt ? '資料更新時間：' + ctx.updatedAt + '（台灣時間）' : '',
  ].filter(function (line) { return line !== null; }).join('\n');
}

/** 把秘書待辦的 Markdown 清單行轉成 HTML（縮排＝子項目，- [ ] ＝待辦勾選框） */
function mdLineHtml_(line) {
  const text = line.trim().replace(/^- \[ \] /, '☐ ').replace(/^- /, '• ');
  return '<div style="padding-left:' + (/^\s/.test(line) ? 18 : 0) + 'px">' + esc_(text) + '</div>';
}

/** 段落小標題（底下一條紅線） */
function h2_(title) {
  return '<div style="font-size:16px;font-weight:700;margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid ' + UP_COLOR + '">' + esc_(title) + '</div>';
}

/**
 * 簡單表格：head 是標題列，rows 是每一列的儲存格，alignRight 決定每欄靠右（數字）或靠左（文字）。
 * 注意：rows 裡的文字要先經過 esc_ 或 fmtNum_ 處理，這裡不再跳脫。
 */
function table_(head, rows, alignRight) {
  const cell = function (v, i, tag) {
    return '<' + tag + ' style="border:1px solid ' + LINE_COLOR + ';padding:6px 8px;font-size:14px;text-align:' + (alignRight[i] ? 'right' : 'left') +
      (tag === 'th' ? ';background:#faf7f0' : '') + '">' + v + '</' + tag + '>';
  };
  return '<table style="border-collapse:collapse;width:100%">' +
    '<tr>' + head.map(function (v, i) { return cell(esc_(v), i, 'th'); }).join('') + '</tr>' +
    rows.map(function (r) { return '<tr>' + r.map(function (v, i) { return cell(v, i, 'td'); }).join('') + '</tr>'; }).join('') +
    '</table>';
}

/** 精簡版的大數字格子：0 用灰色，大於 0 用紅色提醒 */
function bigNumber_(n, label) {
  return '<td style="padding:8px 4px"><div style="font-size:28px;font-weight:700;color:' + (n ? UP_COLOR : MUTED_COLOR) + '">' + n + '</div>' +
    '<div style="font-size:12px;color:' + MUTED_COLOR + '">' + esc_(label) + '</div></td>';
}

/** 精簡／表格版：沒有建立草稿的信（略過、不需回覆）提醒一行，列出主旨；完整版已經在 secretaryMarkdown_ 裡 */
function quietHtml_(sec) {
  const quiet = (sec && sec.quiet) || [];
  if (!quiet.length) return '';
  return '<p style="font-size:13px;color:' + MUTED_COLOR + '">略過／不需回覆 ' + quiet.length + ' 封，請掃一眼（程式依關鍵字判斷，可能看錯）：' +
    quiet.map(function (r) { return esc_(r.status + '｜' + r.subject); }).join('；') + '</p>';
}

/** 還沒用秘書（或讀不到秘書待辦）時顯示的一行 */
function secretaryOff_() {
  return '<p style="font-size:14px;color:' + MUTED_COLOR + '">秘書尚未啟用（Stage 4 會設定）。</p>';
}

/** 漲跌幅 → ▲ +1.23%（紅）／▼ -0.45%（綠）；查無資料就留空 */
function pctHtml_(pct) {
  if (pct === null || pct === undefined) return '';
  const up = pct >= 0;
  return '<span style="color:' + (up ? UP_COLOR : DOWN_COLOR) + ';font-weight:700;white-space:nowrap">' + (up ? '▲ +' : '▼ ') + pct + '%</span>';
}

/** 美股休市那一行（HTML）：wrapHtml_ 放在日期下面，三種版面都有，AI 關閉時也一樣 */
function usClosedHtml_(data) {
  return '<p style="font-size:14px;margin:12px 0 0;padding:8px 10px;background:#faf7f0;border-left:3px solid ' + MUTED_COLOR + '">🇺🇸 ' + esc_(usClosedLine_(data)) + '</p>';
}

/** 美股休市那一行：日期由程式算（usLastCloseDate），不讓 AI 推算；精簡／完整／表格三種版面、純文字信與日報 .md 共用 */
function usClosedLine_(data) {
  return '美股今日休市（沿用 ' + data.usLastCloseDate + ' 收盤數字）';
}

/**
 * 依漲跌幅絕對值排序，取前 n 項（查無資料的不列入）。
 * 一樣大時維持原本的順序（「數據」分頁由上而下；Apps Script V8 的排序是穩定的）。精簡版信件與日報「今日重點」共用。
 */
function topMovers_(items, n) {
  return items
    .filter(function (it) { return it.price !== null && it.changePct !== null; })
    .sort(function (a, b) { return Math.abs(b.changePct) - Math.abs(a.changePct); })
    .slice(0, n);
}

/** 「黃金期貨 GC=F（US$/盎司）」→「黃金期貨 GC=F」，手機上比較好讀 */
function shortName_(name) {
  return String(name).replace(/[（(].*?[）)]/g, '').trim();
}

/** 數字加千分位逗號：120000 → 120,000（只改顯示，不改數值）；不是數字就跳脫後原樣顯示 */
function fmtNum_(v) {
  if (typeof v !== 'number') return esc_(v);
  const parts = String(v).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
}

/**
 * 安全：把 & < > " 換成 HTML 安全的寫法。AI 摘要、信件主旨、客戶名稱都是外來的文字，
 * 放進信件 HTML 前一律經過這裡，才不會被當成 HTML 執行或弄亂版面。
 */
function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
