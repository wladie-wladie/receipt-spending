import * as store from "./db.js";
import { CATS, MODELS, checkKey, recognizeWithClaude, recognizeFree, unitPrice, classifyOperations } from "./recognize.js";
import { isNative, takePhoto, shareTextFile, initUpdates, applyUpdateNow, appVersion, checkForUpdates, updateStatus, shareImageFile, notificationsAvailable, scheduleReportNotification, onReportNotificationTap } from "./native.js";
import { buildReport, drawReport, monthName, monthIn } from "./report.js";
import * as bank from "./bank.js";

const { SPEND_CATS, INCOME_CAT } = bank;
const NEW_CAT = "__new__";
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_G = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const CONSOLE_KEYS = "https://platform.claude.com/settings/keys";
const CONSOLE_BILLING = "https://platform.claude.com/settings/billing";
const CONSOLE_LIMITS = "https://platform.claude.com/settings/limits";
const APK_URL = "https://wladie-wladie.github.io/receipt-spending/traty.apk";

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pad = n => String(n).padStart(2, "0");
const isoDay = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const hhmm = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
const money = v => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = v => Math.round(num(v) * 100) / 100;
function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }
function hash(s) { let h = 0; s = String(s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

/* ---------- settings (kept only on this device) ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem("rs." + k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem("rs." + k); else localStorage.setItem("rs." + k, v); } catch (_) {} },
  json(k, d) { try { return JSON.parse(LS.get(k, "")) || d; } catch (_) { return d; } },
};
const apiKey = () => LS.get("apiKey", "");

/* ---------- categories: built-in plus the user's own ---------- */
const customCats = () => LS.json("customCats", []).filter(c => typeof c === "string" && c.trim());
const allCats = () => { const c = customCats().filter(x => !SPEND_CATS.includes(x)); const i = SPEND_CATS.indexOf("Другое"); return [...SPEND_CATS.slice(0, i), ...c, ...SPEND_CATS.slice(i)]; };
function addCustomCat(name) {
  name = String(name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) return { error: "Введите название категории" };
  const exists = [...allCats(), INCOME_CAT].find(c => c.toLowerCase() === name.toLowerCase());
  if (exists) return { name: exists, existed: true };
  LS.set("customCats", JSON.stringify([...customCats(), name]));
  return { name };
}
const modelKey = () => (LS.get("model", "accurate") in MODELS ? LS.get("model", "accurate") : "accurate");

/* ---------- currency ---------- */
const CURRENCIES = { GEL: "₾", RUB: "₽", EUR: "€", USD: "$", GBP: "£", KZT: "₸", UAH: "₴", AMD: "֏", AZN: "₼", BYN: "Br", UZS: "сўм", KGS: "сом", TRY: "₺", PLN: "zł", ILS: "₪", AED: "AED", THB: "฿", RSD: "дин" };
const REGION_CURRENCY = { GE: "GEL", RU: "RUB", KZ: "KZT", UA: "UAH", AM: "AMD", AZ: "AZN", BY: "BYN", UZ: "UZS", KG: "KGS", TR: "TRY", PL: "PLN", IL: "ILS", AE: "AED", TH: "THB", RS: "RSD", US: "USD", GB: "GBP", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", CY: "EUR", ME: "EUR", PT: "EUR", FI: "EUR", LV: "EUR", LT: "EUR", EE: "EUR" };
function currencyCode() {
  const saved = LS.get("currency", "");
  if (CURRENCIES[saved]) return saved;
  const counts = {};
  records.forEach(r => { if (r.currency && CURRENCIES[r.currency]) counts[r.currency] = (counts[r.currency] || 0) + 1; });
  const fromRecords = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (fromRecords) return fromRecords;
  const region = ((navigator.language || "").split("-")[1] || "").toUpperCase();
  return REGION_CURRENCY[region] || "USD";
}
const symbolOf = code => CURRENCIES[code] || code || "";
const cur = () => symbolOf(currencyCode());
const rCur = r => r.currency || currencyCode();
const fmt = (v, code) => money(v) + " " + symbolOf(code || currencyCode());

/* ---------- state ---------- */
let records = [];
const now = new Date();
const ym = { y: now.getFullYear(), m: now.getMonth() };
let tab = "spend", statsView = "all", openId = null, sheetMode = null;
const parsingNow = new Set();
const photoUrls = new Map();
let installEvent = null;
let updateInfo = null;
let bankState = { enabled: false, watched: [], candidates: [] };

async function reload() { records = await store.allReceipts(); render(); }

/* ---------- toast ---------- */
let tt;
function toast(msg, ms = 3400) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------- record helpers ---------- */
const ITEM_TO_SPEND = { "Кафе и доставка": "Кафе и рестораны", "Бытовая химия": "Дом", "Гигиена и аптека": "Здоровье", "Другое": null };
const rKind = r => r.kind === "income" ? "income" : "expense";
function spendCat(r) {
  if (rKind(r) === "income") return INCOME_CAT;
  if (r.category && allCats().includes(r.category)) return r.category;
  const its = r.items || [];
  if (its.length) {
    const sums = {};
    its.forEach(i => { const c = i.category in ITEM_TO_SPEND ? ITEM_TO_SPEND[i.category] : "Продукты"; if (c) sums[c] = (sums[c] || 0) + num(i.price); });
    const best = Object.keys(sums).sort((a, b) => sums[b] - sums[a])[0];
    return best || "Другое";
  }
  return "Другое";
}
const rDate = r => (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : String(r.createdAt || "").slice(0, 10);
const inMonth = r => rDate(r).slice(0, 7) === ym.y + "-" + pad(ym.m + 1);
const rTotal = r => (r.total != null && r.total !== "") ? num(r.total) : (r.items || []).reduce((s, i) => s + num(i.price), 0);
const rName = r => r.store || r.merchant || (r.source === "manual" ? (r.note || "Без чека") : r.source === "bank" ? "Операция" : "Чек");
const isStuck = r => r.status === "parsing" && !parsingNow.has(r.id);
const needsParse = r => !!r.photo && (r.status === "pending" || isStuck(r));
const isInbox = r => r.source === "bank" && r.review === "new";
const CAT_SHORT = { "Продукты": "Пр", "Кафе и рестораны": "Ка", "Транспорт": "Тр", "Жильё и коммунальные": "Жк", "Связь и подписки": "Св", "Здоровье": "Зд", "Одежда и обувь": "Од", "Дом": "Дм", "Развлечения": "Рз", "Путешествия": "Пт", "Подарки": "Пд", "Образование": "Об", "Переводы": "Пе", "Другое": "Др", "Поступления": "+" };

function dayLabel(d) {
  const [y, m, dd] = d.split("-").map(Number);
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  if (d === isoDay(new Date())) return "Сегодня";
  if (d === isoDay(yd)) return "Вчера";
  const wd = new Date(y, m - 1, dd).toLocaleDateString("ru-RU", { weekday: "short" });
  return wd.charAt(0).toUpperCase() + wd.slice(1) + ", " + dd + " " + MONTHS_G[m - 1];
}
async function photoUrl(id) {
  if (!id) return null;
  if (photoUrls.has(id)) return photoUrls.get(id);
  const blob = await store.getPhoto(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  photoUrls.set(id, url);
  return url;
}
function emptyState(t, p, actions) { const e = el("div", "empty"); e.append(el("h3", null, t)); if (p) e.append(el("p", null, p)); if (actions) { const b = el("div", "btns"); b.style.justifyContent = "center"; actions.forEach(a => b.append(a)); e.append(b); } return e; }
function button(text, cls, onClick) { const b = el("button", "btn " + (cls || ""), text); b.type = "button"; b.onclick = onClick; return b; }
function link(text, href, cls) { const a = el("a", "btn " + (cls || ""), text); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }

/* ---------- category rules learned from the user ---------- */
const MERCHANT_HINTS = [
  [/(taxi|такси|uber|bolt(?! food)|yandex go|яндекс go|metro|метро|transport|транспорт|автобус|fuel|азс|gulf|wissol|rompetrol|socar|lukoil|лукойл|shell|parking|парковк)/i, "Транспорт"],
  [/(wolt|glovo|bolt food|яндекс еда|delivery club|cafe|café|кафе|coffee|кофе|restaurant|ресторан|\bbar\b|pizza|пицц|burger|mcdonald|kfc|starbucks|sushi|суши|bakery|пекарн)/i, "Кафе и рестораны"],
  [/(spar|carrefour|nikora|nabiji|goodwill|agrohub|magnit|магнит|pyaterochka|пят[её]рочк|перекр[её]ст|lenta|лента|auchan|ашан|vkusvill|вкусвилл|lidl|aldi|tesco|supermarket|супермаркет|продукт|grocery|magnum|market|маркет)/i, "Продукты"],
  [/(pharm|аптек|aversi|clinic|клиник|dental|стомат|hospital|больниц|medical|мед\.)/i, "Здоровье"],
  [/(netflix|spotify|youtube|apple\.com|itunes|google\s?(one|play|storage)|icloud|magti|silknet|beeline|билайн|\bmts\b|мтс|megafon|мегафон|tele2|internet|интернет|subscription|подписк|openai|anthropic|claude)/i, "Связь и подписки"],
  [/(zara|h&m|lc waikiki|mango|nike|adidas|decathlon|одежд|обув|shoes)/i, "Одежда и обувь"],
  [/(ikea|leroy|леруа|hardware|хозтовар|home center)/i, "Дом"],
  [/(cinema|кино|theatre|театр|steam|playstation|xbox|concert|концерт|tickets?|билет)/i, "Развлечения"],
  [/(booking|airbnb|airline|airways|авиа|hotel|отель|hostel|wizz|ryanair|pegasus|aeroflot|аэрофлот)/i, "Путешествия"],
  [/(utility|коммунал|energo|электроэнерг|газоснаб|водоканал|water supply|rent|аренд|жкх)/i, "Жильё и коммунальные"],
  [/(course|курс|school|школ|university|университет|udemy|coursera|skillbox)/i, "Образование"],
];
const rules = () => LS.json("rules", {});
function learnRule(name, cat) {
  const k = bank.normMerchant(name); if (!k || !cat) return;
  const r = rules(); r[k] = cat; LS.set("rules", JSON.stringify(r));
}
function suggestCategory(name, transfer) {
  const k = bank.normMerchant(name);
  if (k && rules()[k]) return { cat: rules()[k], sure: true };
  for (const [re, cat] of MERCHANT_HINTS) if (re.test(name || "")) return { cat, sure: false };
  if (transfer) return { cat: "Переводы", sure: false };
  return { cat: null, sure: false };
}
function frequentCats() {
  const c = {};
  records.forEach(r => { if (rKind(r) === "expense") { const k = spendCat(r); c[k] = (c[k] || 0) + 1; } });
  const top = Object.keys(c).sort((a, b) => c[b] - c[a]);
  ["Продукты", "Кафе и рестораны", "Транспорт", "Другое"].forEach(k => { if (!top.includes(k)) top.push(k); });
  return top;
}

/* ---------- render ---------- */
function render() {
  $("#mlabel").textContent = MONTHS[ym.m] + " " + ym.y;
  renderBanner();
  const list = records.filter(inMonth);
  if (tab === "spend") renderSpend(list); else renderStats(list);
}

function isStandalone() { return isNative() || window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
const isIOS = () => !isNative() && /iphone|ipad|ipod/i.test(navigator.userAgent);

function banner(title, text, actions) {
  const b = el("div", "banner"); const t = el("div", "b-text");
  t.append(el("b", null, title), el("p", null, text));
  const a = el("div", "b-actions"); actions.forEach(x => a.append(x));
  t.append(a); b.append(t); $("#banner").append(b);
}
function renderBanner() {
  $("#banner").innerHTML = "";
  if (updateInfo) {
    banner("Загружена новая версия", "Она включится сама при следующем запуске, или можно перезапустить сейчас.",
      [button("Перезапустить", "small primary", () => applyUpdateNow().catch(() => toast("Не удалось обновить. Перезапустите приложение."))), button("Позже", "small ghost", () => { updateInfo = null; render(); })]);
    return;
  }
  const pr = prevMonthReport();
  if (pr) {
    banner("Отчёт за " + monthName(pr.m).toLowerCase() + " готов", "Сколько ушло, на что и что изменилось по сравнению с прошлым месяцем. Отчётом можно поделиться.",
      [button("Открыть", "small primary", () => openReport(pr.y, pr.m)), button("Позже", "small ghost", () => { LS.set("reportSeen", pr.key); render(); })]);
    return;
  }
  if (bank.bankAvailable() && bankState.candidates.length) {
    const c = bankState.candidates[0];
    banner("Похоже, «" + c.app + "» сообщает о покупках", "Учитывать траты из его уведомлений? Пример: " + String(c.sample || "").slice(0, 90),
      [button("Учитывать", "small primary", () => watchApp(c.pkg, c.app)), button("Не нужно", "small ghost", () => ignoreCandidate(c.pkg))]);
    return;
  }
  if (isNative() && !bank.bankAvailable() && LS.get("apkUpdateDismissed") !== "1") {
    banner("Новая функция: траты из уведомлений банка", "Чтобы она заработала, один раз установите свежий APK поверх текущего. Все чеки и настройки сохранятся.",
      [link("Скачать APK", APK_URL, "small primary"), button("Позже", "small ghost", () => { LS.set("apkUpdateDismissed", "1"); render(); })]);
    return;
  }
  if (bank.bankAvailable() && (!bankState.enabled || !bankState.watched.length) && LS.get("bankDismissed") !== "1") {
    banner("Подключите банк", "Траты будут добавляться сами по уведомлениям банковского приложения. Всё остаётся на телефоне.",
      [button("Подключить", "small primary", openBankSettings), button("Позже", "small ghost", () => { LS.set("bankDismissed", "1"); render(); })]);
    return;
  }
  if (!apiKey() && LS.get("connectDismissed") !== "1") {
    banner("Подключите Claude", "Тогда чеки будут сами разбираться на позиции, а операции из банка — получать категории. Без него работает бесплатное распознавание, но хуже.",
      [button("Подключить", "small primary", openSettings), button("Позже", "small ghost", () => { LS.set("connectDismissed", "1"); render(); })]);
    return;
  }
  if (!isStandalone() && LS.get("installDismissed") !== "1" && (installEvent || isIOS())) {
    const acts = [];
    if (installEvent) acts.push(button("Установить", "small primary", doInstall));
    acts.push(button("Не сейчас", "small ghost", () => { LS.set("installDismissed", "1"); render(); }));
    banner("Установите приложение", isIOS() ? "Нажмите «Поделиться» внизу Safari, затем «На экран „Домой“»." : "Оно появится на главном экране и будет открываться как обычное приложение.", acts);
  }
}

function renderSpend(list) {
  const main = currencyCode();
  const expenses = list.filter(r => rKind(r) === "expense");
  const incomes = list.filter(r => rKind(r) === "income");
  const mainExp = expenses.filter(r => rCur(r) === main);
  const total = mainExp.reduce((s, r) => s + rTotal(r), 0);
  const tEl = $("#total"); tEl.textContent = money(total); tEl.append(el("small", null, cur()));
  const st = $("#stats"); st.innerHTML = "";
  const add = (b, t) => { const s = el("span"); s.append(el("b", null, b), " " + t); st.append(s); };
  add(String(expenses.length), plural(expenses.length, "трата", "траты", "трат"));
  const isCur = ym.y === now.getFullYear() && ym.m === now.getMonth();
  const dayCount = isCur ? new Date().getDate() : new Date(ym.y, ym.m + 1, 0).getDate();
  if (mainExp.length) add(fmt(total / dayCount), "в день");
  const other = {};
  expenses.filter(r => rCur(r) !== main).forEach(r => { other[rCur(r)] = (other[rCur(r)] || 0) + rTotal(r); });
  Object.entries(other).forEach(([c, v]) => add("+" + fmt(v, c), "в другой валюте"));
  const inc = incomes.filter(r => rCur(r) === main).reduce((s, r) => s + rTotal(r), 0);
  if (inc) add("+" + fmt(inc), "поступило");
  const pending = list.filter(needsParse).length;
  if (pending) add(String(pending), "ждут разбора");

  const box = $("#list"); box.innerHTML = "";
  renderInbox(box);
  if (!list.length) {
    box.append(emptyState("В этом месяце пока пусто", bank.bankAvailable() ? "Сфотографируйте чек, добавьте трату вручную или подключите банк, чтобы операции добавлялись сами." : "Нажмите зелёную кнопку внизу и сфотографируйте чек или добавьте трату вручную.",
      [button("Выбрать фото из галереи", "small", () => pickPhoto(true))]));
    return;
  }
  const groups = {};
  list.forEach(r => { (groups[rDate(r)] = groups[rDate(r)] || []).push(r); });
  Object.keys(groups).sort().reverse().forEach(d => {
    const g = groups[d].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const sec = el("div", "day"); const h = el("div", "dayhead");
    const dayExp = g.filter(r => rKind(r) === "expense" && rCur(r) === main).reduce((s, r) => s + rTotal(r), 0);
    h.append(el("b", null, dayLabel(d)), el("span", "num", fmt(dayExp)));
    const rows = el("div", "rows"); g.forEach(r => rows.append(rowEl(r)));
    sec.append(h, rows); box.append(sec);
  });
}

function renderInbox(box) {
  const inbox = records.filter(isInbox).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!inbox.length) return;
  const card = el("div", "inbox");
  const head = el("div", "inbox-head");
  head.append(el("b", null, "Новые операции · " + inbox.length));
  if (inbox.some(r => r.category)) head.append(button("Подтвердить все", "small ghost", confirmAll));
  card.append(head);
  const cats = frequentCats();
  inbox.slice(0, 20).forEach(r => {
    const row = el("div", "inbox-row");
    const top = el("button", "inbox-main"); top.type = "button"; top.onclick = () => openReceipt(r.id);
    const t = el("div", "rmain");
    t.append(el("div", "rname", rName(r)));
    const when = new Date(r.createdAt);
    t.append(el("div", "rsub", (r.bankApp || "Банк") + " · " + (rDate(r) === isoDay(new Date()) ? "" : dayLabel(rDate(r)) + ", ") + hhmm(when)));
    top.append(t, el("div", "ramt" + (rKind(r) === "income" ? " income" : ""), (rKind(r) === "income" ? "+" : "") + fmt(rTotal(r), rCur(r))));
    const chips = el("div", "chips");
    const opts = [];
    if (r.category) opts.push(r.category);
    cats.forEach(c => { if (opts.length < 4 && !opts.includes(c)) opts.push(c); });
    opts.forEach((c, i) => {
      const ch = el("button", "chip-btn" + (i === 0 && r.category ? " on" : ""), c); ch.type = "button";
      ch.onclick = () => confirmOp(r, c);
      chips.append(ch);
    });
    const more = el("button", "chip-btn", "Другая…"); more.type = "button"; more.onclick = () => openReceipt(r.id);
    chips.append(more);
    row.append(top, chips); card.append(row);
  });
  if (inbox.length > 20) card.append(el("p", "hint", "И ещё " + (inbox.length - 20) + ". Подтвердите эти, и появятся следующие."));
  box.append(card);
}

async function confirmOp(r, cat) {
  await store.updateReceipt(r.id, { category: cat, review: "done" });
  learnRule(rName(r), cat);
  // Same place waiting in the inbox: apply the choice to it too.
  const k = bank.normMerchant(rName(r));
  for (const o of records) if (o.id !== r.id && isInbox(o) && k && bank.normMerchant(rName(o)) === k) await store.updateReceipt(o.id, { category: cat, review: "done" });
  toast(rName(r) + " → " + cat);
  reload();
}
async function confirmAll() {
  let n = 0;
  for (const r of records.filter(isInbox)) if (r.category) { await store.updateReceipt(r.id, { review: "done" }); learnRule(rName(r), r.category); n++; }
  toast("Подтверждено: " + n); reload();
}

function rowEl(r) {
  const b = el("button", "row"); b.type = "button"; b.onclick = () => openReceipt(r.id);
  const cat = spendCat(r);
  const ph = el("div", "thumb" + (rKind(r) === "income" ? " income" : ""), r.photo ? "" : (CAT_SHORT[cat] || "₽"));
  b.append(ph);
  if (r.photo) photoUrl(r.photo).then(u => { if (u) { const im = el("img", "thumb"); im.src = u; im.alt = ""; ph.replaceWith(im); } });
  const m = el("div", "rmain");
  m.append(el("div", "rname", rName(r)));
  const sub = el("div", "rsub");
  if (r.status === "parsing" && !isStuck(r)) { const c = el("span", "chip"); c.append(el("span", "spin"), "Распознаю"); sub.append(c, " "); }
  else if (needsParse(r)) sub.append(el("span", "chip", "Ждёт разбора"), " ");
  if (isInbox(r)) sub.append(el("span", "chip", "Новая"), " ");
  const bits = [cat];
  const it = r.items || [];
  if (it.length) bits.push(it.length + " " + plural(it.length, "позиция", "позиции", "позиций"));
  if (r.source === "bank") bits.push(r.photo ? "банк + чек" : "банк");
  sub.append(bits.join(" · "));
  m.append(sub); b.append(m);
  const amt = r.status === "parsing" && r.total == null ? "…" : (rKind(r) === "income" ? "+" : "") + fmt(rTotal(r), rCur(r));
  b.append(el("div", "ramt" + (rKind(r) === "income" ? " income" : ""), amt));
  return b;
}

/* ---------- analytics ---------- */
/** Horizontal bars. An entry may carry parts: [[name, value], ...] drawn as coloured segments of one bar. */
function bars(container, entries, emptyText) {
  container.innerHTML = "";
  entries = entries.filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { container.append(el("p", "hint", emptyText)); return; }
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const max = entries[0][1];
  entries.forEach(([k, v, parts]) => {
    const row = el("div", "bar");
    const r = el("span", "num", fmt(v)); r.append(el("span", "pct", Math.round(v / total * 100) + "%"));
    const tr = el("div", "track");
    if (parts && parts.length > 1) {
      tr.classList.add("stacked");
      const legend = el("div", "bar-legend");
      parts.forEach(([name, pv], i) => {
        const f = el("div", "fill part" + i); f.style.width = (pv / max * 100) + "%"; f.title = name + ": " + fmt(pv); tr.append(f);
        const li = el("span", "lg"); li.append(el("i", "dot part" + i), name + " " + fmt(pv)); legend.append(li);
      });
      row.append(el("span", null, k), r, tr, legend);
    } else {
      const f = el("div", "fill"); f.style.width = Math.max(2, v / max * 100) + "%"; tr.append(f);
      row.append(el("span", null, k), r, tr);
    }
    container.append(row);
  });
}
function renderStats(list) {
  $("#st-all").setAttribute("aria-pressed", String(statsView === "all"));
  $("#st-food").setAttribute("aria-pressed", String(statsView === "food"));
  $("#stats-all").hidden = statsView !== "all"; $("#stats-food").hidden = statsView !== "food";
  const main = currencyCode();
  const exp = list.filter(r => rKind(r) === "expense" && rCur(r) === main);
  if (statsView === "all") {
    const byCat = {};
    exp.forEach(r => { const c = spendCat(r); byCat[c] = (byCat[c] || 0) + rTotal(r); });
    // Groceries and eating out share one bar: together they are "food", split by colour.
    const entries = Object.entries(byCat).filter(([k]) => k !== "Продукты" && k !== "Кафе и рестораны");
    const food = [["Продукты", byCat["Продукты"] || 0], ["Кафе и рестораны", byCat["Кафе и рестораны"] || 0]].filter(([, v]) => v > 0.004);
    if (food.length) entries.push([food.length > 1 ? "Еда" : food[0][0], food.reduce((a, [, v]) => a + v, 0), food.length > 1 ? food : null]);
    bars($("#spendCats"), entries, "Здесь появится разбивка, когда в месяце будут траты.");
    const places = {};
    exp.forEach(r => { const k = bank.normMerchant(rName(r)) || rName(r); const o = places[k] = places[k] || { name: rName(r), sum: 0, count: 0 }; o.sum += rTotal(r); o.count++; });
    fillTop($("#topPlaces"), Object.values(places).sort((a, b) => b.sum - a.sum).slice(0, 8), o => fmt(o.sum), o => o.count > 1 ? "×" + o.count : "");
    return;
  }
  const cats = {}; const items = {};
  exp.forEach(r => {
    const its = r.items || [];
    if (!its.length) return;
    its.forEach(i => {
      const c = CATS.includes(i.category) ? i.category : "Другое";
      cats[c] = (cats[c] || 0) + num(i.price);
      const key = (i.generic || i.name || "").trim().toLowerCase();
      if (!key || key === "скидка") return;
      const o = items[key] = items[key] || { name: i.generic || i.name, sum: 0, count: 0 };
      o.sum += num(i.price); o.count += 1;
    });
  });
  const food = exp.filter(r => spendCat(r) === "Продукты");
  const noItems = food.filter(r => !(r.items || []).length).reduce((s, r) => s + rTotal(r), 0);
  if (noItems) cats["Без чека"] = noItems;
  bars($("#cats"), Object.entries(cats), "Здесь появится разбивка продуктов, когда будут чеки.");
  const arr = Object.values(items);
  fillTop($("#topItems"), arr.slice().sort((a, b) => b.sum - a.sum).slice(0, 8), o => fmt(o.sum), o => o.count > 1 ? "×" + o.count : "");
  fillTop($("#freqItems"), arr.filter(o => o.count > 1).sort((a, b) => b.count - a.count || b.sum - a.sum).slice(0, 8), o => "×" + o.count, o => fmt(o.sum));
}
function fillTop(ul, arr, right, mid) {
  ul.innerHTML = "";
  if (!arr.length) { ul.append(el("li", "hint", "Пока недостаточно данных.")); return; }
  arr.forEach(o => { const li = el("li"); li.append(el("span", "nm", o.name), el("span", "ct", mid(o)), el("span", "num", right(o))); ul.append(li); });
}

/* ---------- tabs & month ---------- */
function setTab(t) {
  tab = t; $("#view-spend").hidden = t !== "spend"; $("#view-stats").hidden = t !== "stats";
  $("#tab-spend").setAttribute("aria-selected", t === "spend"); $("#tab-stats").setAttribute("aria-selected", t === "stats");
  render();
}
$("#tab-spend").onclick = () => setTab("spend");
$("#tab-stats").onclick = () => setTab("stats");
$("#st-all").onclick = () => { statsView = "all"; render(); };
$("#openReport").onclick = () => openReport(ym.y, ym.m);
$("#st-food").onclick = () => { statsView = "food"; render(); };
$("#prev").onclick = () => { ym.m--; if (ym.m < 0) { ym.m = 11; ym.y--; } render(); };
$("#next").onclick = () => { ym.m++; if (ym.m > 11) { ym.m = 0; ym.y++; } render(); };

/* ---------- photo flow ---------- */
let attachTo = null; // when set, the next photo is attached to this operation
async function pickPhoto(fromGallery, targetId) {
  attachTo = targetId || null;
  if (isNative()) {
    try { const blob = await takePhoto(fromGallery); if (blob) onPhoto(blob); }
    catch (_) { toast("Не удалось открыть камеру. Проверьте, что приложению разрешён доступ к камере."); }
    return;
  }
  const input = fromGallery ? $("#galleryInput") : $("#photoInput");
  input.value = ""; input.click();
}
$("#camBtn").onclick = () => pickPhoto(false);
$("#photoInput").onchange = e => { const f = e.target.files && e.target.files[0]; if (f) onPhoto(f); };
$("#galleryInput").onchange = e => { const f = e.target.files && e.target.files[0]; if (f) onPhoto(f); e.target.value = ""; };

async function compress(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("toBlob")), "image/jpeg", 0.85));
  } finally { URL.revokeObjectURL(url); }
}

async function onPhoto(file) {
  const target = attachTo; attachTo = null;
  let blob;
  try { blob = await compress(file); } catch (_) { toast("Не удалось открыть фото. Попробуйте ещё раз."); return; }
  const photoId = store.uid();
  const nowIso = new Date().toISOString();
  let id = target;
  try {
    await store.putPhoto(photoId, blob);
    if (target) await store.updateReceipt(target, { photo: photoId, status: "parsing" });
    else {
      id = photoId;
      await store.putReceipt({ id, createdAt: nowIso, updatedAt: nowIso, date: isoDay(new Date()), photo: photoId, status: "parsing", items: [], total: null, store: "", currency: currencyCode(), source: "photo", kind: "expense" });
    }
  } catch (_) { toast("Не хватает места на телефоне, чтобы сохранить фото."); return; }
  store.requestPersistence();
  if (!target) { const d = new Date(); ym.y = d.getFullYear(); ym.m = d.getMonth(); }
  closeSheet();
  if (tab !== "spend") setTab("spend");
  await reload();
  parse(id, blob);
}

async function parse(id, blob) {
  parsingNow.add(id);
  await store.updateReceipt(id, { status: "parsing", parseError: null });
  await reload();
  const key = apiKey();
  try {
    let res;
    if (key) { res = await recognizeWithClaude(blob, key, MODELS[modelKey()].id); res.parsedBy = "claude"; }
    else { res = await recognizeFree(blob, msg => toast(msg, 6000)); res.parsedBy = "free"; }
    if (!res.currency) delete res.currency;
    const rec = await store.getReceipt(id);
    let patch = Object.assign({ status: "parsed", parseError: null }, res);
    if (rec && rec.source === "bank") {
      // The bank already knows the real amount, date and currency: take only the contents of the receipt.
      patch = { status: "parsed", parseError: null, items: res.items, store: res.store || rec.store || "", parsedBy: res.parsedBy, receiptTotal: res.total };
      if (rec.review === "new" && res.category) patch.category = res.category;
    } else if (rec && rec.category && !res.category) delete patch.category;
    await store.updateReceipt(id, patch);
    const n = res.items.length;
    let merged = false;
    if (rec && rec.source !== "bank") merged = await tryMergeReceipt(id);
    toast(merged ? "Чек прикреплён к операции из банка" : n ? "Чек разобран: " + n + " " + plural(n, "позиция", "позиции", "позиций") + (key ? "" : ". Проверьте суммы и категории.") : "Позиции не нашлись. Заполните вручную или подключите Claude.");
  } catch (e) {
    await store.updateReceipt(id, { status: "pending", parseError: e.code || "error" });
    toast(e.message || "Не удалось распознать. Фото сохранено, попробуйте ещё раз.", 5000);
  } finally {
    parsingNow.delete(id);
    await reload();
    if (openId === id) openReceipt(id);
  }
}

async function reparse(r) {
  const blob = await store.getPhoto(r.photo);
  if (!blob) { toast("Фото этого чека не найдено."); return; }
  closeSheet();
  parse(r.id, blob);
}

/* ---------- receipts and bank operations: one purchase, one record ---------- */
const dayDiff = (a, b) => Math.abs((new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / 86400000);
function sameMoney(a, b) { return Math.abs(rTotal(a) - rTotal(b)) < 0.015 && (!a.currency || !b.currency || a.currency === b.currency); }
function mergeInto(bankRec, receipt) {
  const patch = { photo: receipt.photo, items: receipt.items || [], store: receipt.store || bankRec.store || "", parsedBy: receipt.parsedBy, status: receipt.status, receiptTotal: receipt.total };
  if (bankRec.review === "new") {
    const cat = receipt.category || spendCat(receipt);
    patch.category = cat; patch.review = "done";
    learnRule(bankRec.merchant || rName(bankRec), cat);
  }
  return patch;
}
async function tryMergeReceipt(receiptId) {
  const all = await store.allReceipts();
  const rec = all.find(r => r.id === receiptId);
  if (!rec || rec.source === "bank" || rKind(rec) !== "expense" || !rTotal(rec)) return false;
  const cands = all.filter(b => b.source === "bank" && rKind(b) === "expense" && !b.photo && sameMoney(b, rec) && dayDiff(rDate(b), rDate(rec)) <= 1);
  if (!cands.length) return false;
  cands.sort((a, b) => dayDiff(rDate(a), rDate(rec)) - dayDiff(rDate(b), rDate(rec)));
  await store.updateReceipt(cands[0].id, mergeInto(cands[0], rec));
  await store.deleteReceipt(rec.id);
  if (openId === rec.id) openId = cands[0].id;
  return true;
}
async function tryMergeBank(bankRec) {
  const all = await store.allReceipts();
  const cands = all.filter(r => (r.source === "photo" || r.source === "manual") && rKind(r) === "expense" && r.status !== "parsing" && sameMoney(r, bankRec) && dayDiff(rDate(r), rDate(bankRec)) <= 1);
  if (!cands.length) return false;
  const rec = cands[0];
  const patch = rec.source === "photo" ? mergeInto(bankRec, rec) : { category: spendCat(rec), review: "done", note: rec.note || rec.store };
  await store.updateReceipt(bankRec.id, patch);
  await store.deleteReceipt(rec.id);
  return true;
}

/* ---------- bank notifications → operations ---------- */
let importing = false;
async function importBank() {
  if (!bank.bankAvailable() || importing) return;
  importing = true;
  try {
    const pending = await bank.getPending();
    const done = [];
    const fresh = [];
    for (const n of pending) {
      done.push(n.id);
      const p = bank.parseNotification(n);
      if (!p) continue;
      const id = "bank-" + hash(n.id);
      if (await store.getReceipt(id)) continue;
      const when = new Date(Number(n.time) || Date.now());
      const sug = p.kind === "income" ? { cat: INCOME_CAT, sure: true } : suggestCategory(p.merchant, p.transfer);
      const rec = {
        id, source: "bank", kind: p.kind, createdAt: when.toISOString(), updatedAt: new Date().toISOString(),
        date: isoDay(when), time: hhmm(when), total: p.amount, currency: p.currency || currencyCode(),
        merchant: bank.prettyMerchant(p.merchant), store: "", bankApp: n.app || "", bankPkg: n.pkg || "", raw: [n.title, n.text].filter(Boolean).join("\n"),
        category: sug.cat, review: sug.sure ? "done" : "new", items: [], photo: null, status: "parsed",
      };
      await store.putReceipt(rec);
      fresh.push(rec);
    }
    if (done.length) await bank.ackPending(done);
    let merged = 0;
    for (const r of fresh) if (rKind(r) === "expense" && await tryMergeBank(r)) merged++;
    if (fresh.length) {
      await reload();
      const exp = fresh.filter(r => rKind(r) === "expense");
      if (exp.length === 1) toast("Из банка: " + fmt(exp[0].total, exp[0].currency) + (exp[0].merchant ? " · " + exp[0].merchant : "") + (merged ? " (чек прикреплён)" : ""));
      else if (fresh.length > 1) toast("Из банка добавлено операций: " + fresh.length);
      classifyNew();
    }
  } catch (_) {
    // Will try again the next time the app opens.
  } finally { importing = false; }
}

// Ask Claude to tidy merchant names and suggest categories for operations the app is not sure about.
let classifying = false;
async function classifyNew() {
  const key = apiKey(); if (!key || classifying) return;
  const todo = (await store.allReceipts()).filter(r => r.source === "bank" && r.review === "new" && !r.aiChecked).slice(0, 25);
  if (!todo.length) return;
  classifying = true;
  try {
    const res = await classifyOperations(todo.map((r, i) => ({ i, text: r.raw || r.merchant, amount: r.total, currency: r.currency, merchant: r.merchant })), key, allCats());
    for (const x of res) {
      const r = todo[x.i]; if (!r) continue;
      const patch = { aiChecked: true };
      if (x.merchant) patch.merchant = x.merchant;
      if (x.kind === "income") { patch.kind = "income"; patch.category = INCOME_CAT; patch.review = "done"; }
      else if (x.category) {
        const learned = suggestCategory(x.merchant || r.merchant);
        patch.category = learned.sure ? learned.cat : x.category;
        if (learned.sure) patch.review = "done";
      }
      await store.updateReceipt(r.id, patch);
    }
    await reload();
  } catch (_) {
    for (const r of todo) await store.updateReceipt(r.id, { aiChecked: true });
  } finally { classifying = false; }
}

async function refreshBankState() {
  if (!bank.bankAvailable()) return;
  try {
    const st = await bank.bankStatus();
    bankState.enabled = !!st.enabled;
    bankState.watched = st.watched || [];
    bankState.candidates = st.enabled ? await bank.getCandidates() : [];
  } catch (_) {}
}
async function watchApp(pkg, name) {
  const set = new Set(bankState.watched); set.add(pkg);
  await bank.setWatched([...set]);
  await refreshBankState();
  toast("Теперь учитываются уведомления «" + (name || pkg) + "»");
  render();
  if (sheetMode === "bank") openBankSettings();
}
async function ignoreCandidate(pkg) {
  await bank.dismissCandidate(pkg);
  await refreshBankState(); render();
  if (sheetMode === "bank") openBankSettings();
}

/* ---------- sheet plumbing ---------- */
function closeSheet() { openId = null; sheetMode = null; $("#overlay").hidden = true; }
$("#overlay").addEventListener("click", e => { if (e.target.id === "overlay") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#overlay").hidden) closeSheet(); });
function sheetStart(title, mode) {
  sheetMode = mode || null;
  const sh = $("#sheet"); sh.innerHTML = ""; sh.scrollTop = 0;
  sh.append(el("div", "grab"));
  const head = el("div", "sh-head"); head.append(el("h2", null, title));
  const x = el("button", "x", "×"); x.type = "button"; x.setAttribute("aria-label", "Закрыть"); x.onclick = closeSheet; head.append(x);
  sh.append(head); $("#overlay").hidden = false; return sh;
}
function field(label, input, wide) { const f = el("div", "f" + (wide ? " wide" : "")); const l = el("label", null, label); l.htmlFor = input.id; f.append(l, input); return f; }
function inp(id, type, val) { const i = el("input"); i.id = id; i.type = type; if (val != null) i.value = val; return i; }
const catChoices = () => [...allCats(), [NEW_CAT, "+ Новая категория…"]];
/** Category picker; choosing "+ Новая категория…" shows a field to name it right below. */
function catSelect(id, options, val) {
  const s = select(id, options, val);
  let prev = s.value;
  s.addEventListener("change", () => {
    if (s.value !== NEW_CAT) { prev = s.value; return; }
    s.value = prev;
    const host = s.parentElement; if (!host || host.querySelector(".newcat")) return;
    const box = el("div", "keyrow newcat"); box.style.marginTop = "8px";
    const i = inp(id + "-new", "text", ""); i.placeholder = "Название, например «Спорт»"; i.maxLength = 40;
    const ok = button("Добавить", "primary small", () => {
      const res = addCustomCat(i.value);
      if (res.error) { toast(res.error); i.focus(); return; }
      if (!res.existed) { const o = el("option", null, res.name); o.value = res.name; s.insertBefore(o, s.querySelector('option[value="Другое"]') || s.querySelector('option[value="' + NEW_CAT + '"]')); toast("Категория «" + res.name + "» добавлена"); }
      s.value = res.name; prev = res.name; box.remove();
      s.dispatchEvent(new Event("change"));
    });
    ok.style.flex = "none";
    const cancel = button("×", "small ghost", () => box.remove()); cancel.style.flex = "none"; cancel.setAttribute("aria-label", "Отмена");
    i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } });
    box.append(i, ok, cancel); host.append(box); setTimeout(() => i.focus(), 30);
  });
  return s;
}
function select(id, options, val) { const s = el("select"); s.id = id; options.forEach(c => { const o = el("option", null, Array.isArray(c) ? c[1] : c); o.value = Array.isArray(c) ? c[0] : c; if (o.value === val) o.selected = true; s.append(o); }); return s; }

/* ---------- record details ---------- */
async function openReceipt(id) {
  const r = records.find(x => x.id === id); if (!r) return;
  openId = id;
  const sh = sheetStart(rName(r), "record");
  if (r.photo) {
    const u = await photoUrl(r.photo);
    if (u) { const im = el("img", "photo"); im.src = u; im.alt = "Фото чека"; im.onclick = () => im.classList.toggle("full"); sh.append(im); }
  }
  const busy = r.status === "parsing" && !isStuck(r);
  if (busy) { const n = el("div", "note"); n.append(el("span", "spin"), "Распознаю позиции, результат появится сам."); sh.append(n); }
  else if (needsParse(r)) sh.append(el("div", "note", "Позиции ещё не разобраны. Нажмите «Распознать» или заполните вручную."));
  else if (r.parsedBy === "free") sh.append(el("div", "note", "Распознано бесплатно: проверьте названия, суммы и категории."));
  if (r.source === "bank") {
    const n = el("div", "src-note");
    n.append(el("b", null, "Из уведомления " + (r.bankApp || "банка") + ", " + (r.time || "")), el("div", null, r.raw || ""));
    sh.append(n);
    if (r.receiptTotal && Math.abs(num(r.receiptTotal) - rTotal(r)) > 0.05) sh.append(el("div", "note", "Сумма в чеке (" + fmt(r.receiptTotal, rCur(r)) + ") отличается от суммы в банке."));
  }

  const fs = el("div", "fields");
  const fStore = inp("e-store", "text", r.store || r.merchant || "");
  const fDate = inp("e-date", "date", rDate(r));
  const fTotal = inp("e-total", "text", r.total != null ? String(r.total) : ""); fTotal.inputMode = "decimal";
  const fKind = select("e-kind", [["expense", "Расход"], ["income", "Поступление"]], rKind(r));
  const catOptions = () => fKind.value === "income" ? [INCOME_CAT] : catChoices();
  let fCat = catSelect("e-cat", catOptions(), rKind(r) === "income" ? INCOME_CAT : spendCat(r));
  const catField = field("Категория", fCat, true);
  fKind.onchange = () => { const n = catSelect("e-cat", catOptions(), fKind.value === "income" ? INCOME_CAT : spendCat(r)); fCat.replaceWith(n); fCat = n; };
  fs.append(field("Место или получатель", fStore, true), field("Дата", fDate), field("Сумма, " + symbolOf(rCur(r)), fTotal), catField, field("Тип", fKind, true));
  sh.append(fs);

  const items = (r.items || []).map(i => Object.assign({}, i));
  const paper = el("div", "paper");
  const updSum = () => {
    const s = paper.querySelector(".sumline"); if (!s) return;
    const sum = items.reduce((a, i) => a + num(i.price), 0);
    s.innerHTML = ""; s.append(el("span", null, "Сумма позиций"), el("span", null, fmt(sum, rCur(r))));
    const t = num(fTotal.value); s.classList.toggle("mismatch", items.length > 0 && t > 0 && Math.abs(t - sum) > 0.05);
  };
  const drawItems = () => {
    paper.innerHTML = ""; paper.append(el("div", "paper-title", "Позиции"));
    if (!items.length) paper.append(el("p", "hint", busy ? "Появятся после распознавания." : "Позиций нет. Можно добавить вручную."));
    items.forEach((it, idx) => {
      const row = el("div", "item");
      const n = inp("it-n-" + idx, "text", it.name); n.className = "nm"; n.setAttribute("aria-label", "Название"); n.oninput = () => { it.name = n.value; };
      const p = inp("it-p-" + idx, "text", String(it.price)); p.className = "pr"; p.inputMode = "decimal"; p.setAttribute("aria-label", "Сумма"); p.oninput = () => { it.price = num(p.value); updSum(); };
      const d = el("button", "del", "×"); d.type = "button"; d.setAttribute("aria-label", "Удалить позицию"); d.onclick = () => { items.splice(idx, 1); drawItems(); };
      const c = select("it-c-" + idx, CATS, it.category); c.setAttribute("aria-label", "Категория позиции"); c.onchange = () => { it.category = c.value; };
      row.append(n, p, d, c);
      const meta = [];
      if (it.generic && it.generic.toLowerCase() !== (it.name || "").toLowerCase()) meta.push(it.generic);
      if (it.size && it.unit) meta.push((it.qty > 1 ? it.qty + " × " : "") + String(it.size).replace(".", ",") + " " + ({ kg: "кг", g: "г", l: "л", ml: "мл", pcs: "шт" }[it.unit] || it.unit));
      const up = unitPrice(it); if (up) meta.push(money(up.value) + " " + symbolOf(rCur(r)) + "/" + up.per);
      if (meta.length) row.append(el("div", "orig", meta.join(" · ")));
      else if (it.orig && it.orig !== it.name) row.append(el("div", "orig", it.orig));
      paper.append(row);
    });
    paper.append(el("div", "sumline")); updSum();
  };
  fTotal.oninput = updSum;
  const showItems = !!(items.length || r.photo);
  if (showItems) { drawItems(); sh.append(paper); }

  const b1 = el("div", "btns");
  if (showItems) b1.append(button("+ Позиция", "ghost", () => { items.push({ name: "", orig: "", qty: 1, price: 0, category: "Другое" }); drawItems(); const last = paper.querySelector("#it-n-" + (items.length - 1)); if (last) last.focus(); }));
  if (r.photo && !busy) b1.append(button(r.status === "parsed" ? "Распознать снова" : "Распознать", "ghost", () => reparse(r)));
  if (!r.photo && rKind(r) === "expense") {
    b1.append(button("Прикрепить чек", "ghost", () => pickPhoto(false, r.id)));
    b1.append(button("Из галереи", "ghost", () => pickPhoto(true, r.id)));
  }
  if (b1.childElementCount) sh.append(b1);

  const b2 = el("div", "btns");
  const save = button(isInbox(r) ? "Подтвердить" : "Сохранить", "primary", async () => {
    save.disabled = true;
    const clean = items.filter(i => (i.name || "").trim() || num(i.price)).map(i => {
      const it = Object.assign({}, i, { name: (i.name || "").trim() || "Без названия", orig: i.orig || "", qty: num(i.qty) || 1, price: r2(i.price), category: CATS.includes(i.category) ? i.category : "Другое" });
      const up = unitPrice(it); it.unitPrice = up ? up.value : null; it.unitPer = up ? up.per : null;
      return it;
    });
    const name = fStore.value.trim();
    const patch = { date: fDate.value || rDate(r), total: fTotal.value.trim() === "" ? null : r2(fTotal.value), kind: fKind.value, category: fCat.value };
    if (r.source === "bank") patch.merchant = name; else patch.store = name;
    if (showItems) patch.items = clean;
    if (!busy && clean.length && r.photo) patch.status = "parsed";
    if (r.source === "bank") patch.review = "done";
    try {
      await store.updateReceipt(r.id, patch);
      if (fKind.value === "expense" && name && (r.source === "bank" || fCat.value !== spendCat(r))) learnRule(name, fCat.value);
      toast(isInbox(r) ? "Подтверждено" : "Сохранено"); closeSheet(); reload();
    } catch (_) { toast("Не удалось сохранить."); save.disabled = false; }
  });
  let armed = false;
  const del = button("Удалить", "danger", async () => {
    if (!armed) { armed = true; del.textContent = "Точно удалить?"; setTimeout(() => { armed = false; del.textContent = "Удалить"; }, 4000); return; }
    del.disabled = true;
    await store.deleteReceipt(r.id);
    if (r.photo) { await store.deletePhoto(r.photo); const u = photoUrls.get(r.photo); if (u) { URL.revokeObjectURL(u); photoUrls.delete(r.photo); } }
    toast("Удалено"); closeSheet(); reload();
  });
  b2.append(save, del); sh.append(b2);
}

/* ---------- monthly report ---------- */
const reportHelpers = () => ({ spendCat, rTotal, rKind, rName, rCur, rDate, norm: bank.normMerchant, currency: currencyCode(), symbol: cur(), fmt: v => fmt(v), money, plural });
function prevMonthReport() {
  const d = new Date();
  if (d.getDate() > 10) return null;
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(), m = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
  const key = y + "-" + pad(m + 1);
  if (LS.get("reportSeen", "") === key) return null;
  if (!records.some(r => rDate(r).slice(0, 7) === key && rKind(r) === "expense")) return null;
  return { y, m, key };
}
async function openReport(y, m) {
  openId = null;
  const key = y + "-" + pad(m + 1);
  const sh = sheetStart("Отчёт · " + monthName(m) + " " + y, "report");
  const R = buildReport(records, y, m, reportHelpers());
  if (!R.count) { sh.append(el("p", "small-print", "В этом месяце ещё нет трат, отчёт строить не из чего.")); return; }
  const wait = el("div", "note ok"); wait.append(el("span", "spin"), "Готовлю отчёт…"); sh.append(wait);
  let canvas;
  try { canvas = await drawReport(R, reportHelpers()); }
  catch (_) { wait.remove(); sh.append(el("div", "note", "Не удалось построить отчёт.")); return; }
  if (sheetMode !== "report") return;
  wait.remove();
  LS.set("reportSeen", key); renderBanner();
  const img = el("img", "report-img"); img.src = canvas.toDataURL("image/png"); img.alt = "Отчёт за " + monthName(m).toLowerCase() + " " + y;
  sh.append(img);
  const fileName = "traty-otchet-" + key + ".png";
  const title = "Мои траты в " + monthIn(m) + " " + y;
  const b = el("div", "btns sticky-btns");
  const share = button("Поделиться", "primary", async () => {
    share.disabled = true;
    try {
      if (isNative()) await shareImageFile(fileName, img.src.split(",")[1], title);
      else {
        const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
        const file = new File([blob], fileName, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title });
        else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fileName; document.body.append(a); a.click(); a.remove(); toast("Картинка отчёта сохранена"); }
      }
    } catch (e) { if (!/cancel|abort/i.test(String(e && (e.message || e.name)))) toast("Не удалось поделиться отчётом."); }
    share.disabled = false;
  });
  b.append(share);
  sh.append(b);
}
async function planReportNotification() {
  if (!notificationsAvailable() || !records.length) return;
  const d = new Date();
  const at = new Date(d.getFullYear(), d.getMonth() + 1, 1, 10, 0, 0);
  const key = d.getFullYear() + "-" + pad(d.getMonth() + 1);
  try {
    const res = await scheduleReportNotification({
      at, title: "Отчёт за " + monthName(d.getMonth()).toLowerCase() + " готов",
      body: "Сколько ушло, на что и что изменилось за месяц. Отчётом можно поделиться.",
      extra: { report: key }, mayAsk: LS.get("notifAsked") !== "1",
    });
    LS.set("notifAsked", "1");
    return res;
  } catch (_) {}
}
onReportNotificationTap(extra => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(extra.report || ""));
  if (m) openReport(Number(m[1]), Number(m[2]) - 1);
});

/* ---------- manual entry ---------- */
$("#addManual").onclick = () => {
  openId = null;
  const sh = sheetStart("Трата без чека", "manual");
  const fs = el("div", "fields");
  const fSum = inp("m-sum", "text", ""); fSum.inputMode = "decimal"; fSum.placeholder = "0.00";
  const fCat = catSelect("m-cat", catChoices(), "Кафе и рестораны");
  const fStore = inp("m-store", "text", ""); fStore.placeholder = "Кафе, рынок, такси, кому перевели";
  const fDate = inp("m-date", "date", isoDay(new Date()));
  const fKind = select("m-kind", [["expense", "Расход"], ["income", "Поступление"]], "expense");
  fKind.onchange = () => { fCat.disabled = fKind.value === "income"; };
  fs.append(field("Сумма, " + cur(), fSum), field("Дата", fDate), field("Категория", fCat, true), field("Где или что", fStore, true), field("Тип", fKind, true));
  sh.append(fs);
  const b = el("div", "btns");
  const save = button("Добавить", "primary", async () => {
    const s = r2(fSum.value); if (!s) { toast("Укажите сумму"); fSum.focus(); return; }
    save.disabled = true;
    const nowIso = new Date().toISOString();
    const income = fKind.value === "income";
    await store.putReceipt({ id: store.uid(), createdAt: nowIso, updatedAt: nowIso, date: fDate.value || isoDay(new Date()), photo: null, status: "manual", source: "manual",
      kind: income ? "income" : "expense", category: income ? INCOME_CAT : fCat.value, store: fStore.value.trim(), total: s, currency: currencyCode(), items: [] });
    if (!income && fStore.value.trim()) learnRule(fStore.value.trim(), fCat.value);
    toast("Добавлено"); closeSheet(); reload();
  });
  b.append(save); sh.append(b);
  setTimeout(() => fSum.focus(), 60);
};

/* ---------- bank settings ---------- */
let allApps = null, showAllApps = false, appFilter = "";
async function openBankSettings() {
  openId = null;
  const sh = sheetStart("Банки", "bank");
  if (!isNative()) {
    sh.append(el("p", "small-print", "Учёт трат по уведомлениям банка работает в Android-приложении. В браузере и на iPhone траты добавляются фото чека или вручную."));
    sh.append(link("Скачать Android-приложение", APK_URL, "small"));
    return;
  }
  if (!bank.bankAvailable()) {
    sh.append(el("p", "small-print", "Для этой функции нужна свежая версия приложения. Скачайте APK и установите поверх текущего: чеки и настройки сохранятся."));
    sh.append(link("Скачать APK", APK_URL, "small primary"));
    return;
  }
  await refreshBankState();

  /* step 1: access */
  const s1 = el("div", "set-sec"); s1.append(el("h3", null, "1. Доступ к уведомлениям"));
  if (bankState.enabled) s1.append(el("div", "note ok", "Доступ есть. Приложение видит уведомления только выбранных ниже банков."));
  else {
    s1.append(el("p", "small-print", "Откройте настройки и включите переключатель у приложения «Траты». Затем вернитесь сюда."));
    const b = el("div", "btns"); b.append(button("Открыть настройки", "small primary", () => bank.openListenerSettings().catch(() => toast("Не удалось открыть настройки."))));
    s1.append(b);
    s1.append(el("p", "small-print", "Если переключатель серый и не нажимается (Android 13 и новее): откройте «О приложении», нажмите ⋮ в правом верхнем углу, выберите «Разрешить ограниченные настройки» и повторите."));
    const b2 = el("div", "btns"); b2.append(button("О приложении", "small", () => bank.openAppInfo().catch(() => {}))); s1.append(b2);
  }
  sh.append(s1);

  /* step 2: banking apps */
  const s2 = el("div", "set-sec"); s2.append(el("h3", null, "2. Банковские приложения"));
  if (!allApps) { try { allApps = (await bank.listApps()).sort((a, b) => a.name.localeCompare(b.name)); } catch (_) { allApps = []; } }
  const watched = new Set(bankState.watched);
  const banks = allApps.filter(a => bank.looksLikeBankApp(a) || watched.has(a.pkg));
  s2.append(el("p", "small-print", banks.length ? "Нашли на телефоне. Отметьте те, уведомления которых нужно учитывать:" : "Похожих на банк приложений не нашли. Выберите нужное в полном списке."));
  const listBox = el("div", "app-list");
  const appRow = a => {
    const row = el("label", "app-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = watched.has(a.pkg); cb.id = "app-" + a.pkg.replace(/[^a-z0-9]/gi, "_");
    cb.onchange = async () => {
      if (cb.checked) watched.add(a.pkg); else watched.delete(a.pkg);
      await bank.setWatched([...watched]); await refreshBankState(); render();
      toast(cb.checked ? "Учитываю «" + a.name + "»" : "Больше не учитываю «" + a.name + "»");
    };
    row.append(cb, el("span", null, a.name));
    return row;
  };
  banks.forEach(a => listBox.append(appRow(a)));
  s2.append(listBox);
  const toggle = button(showAllApps ? "Скрыть остальные приложения" : "Показать все приложения", "small ghost", () => { showAllApps = !showAllApps; openBankSettings(); });
  s2.append(toggle);
  if (showAllApps) {
    const q = inp("app-search", "search", appFilter); q.placeholder = "Поиск приложения"; q.className = "search";
    const full = el("div", "app-list");
    const draw = () => {
      full.innerHTML = "";
      allApps.filter(a => !banks.includes(a) && (!appFilter || a.name.toLowerCase().includes(appFilter.toLowerCase()))).slice(0, 80).forEach(a => full.append(appRow(a)));
    };
    q.oninput = () => { appFilter = q.value; draw(); };
    draw(); s2.append(q, full);
  }
  sh.append(s2);

  /* step 3: detected */
  const s3 = el("div", "set-sec"); s3.append(el("h3", null, "3. Найдено по уведомлениям"));
  if (!bankState.enabled) s3.append(el("p", "small-print", "Когда доступ будет включён, здесь появятся приложения, которые присылают уведомления об оплатах."));
  else if (!bankState.candidates.length) s3.append(el("p", "small-print", "Пока ничего нового. Если какое-то приложение пришлёт уведомление с суммой, оно появится здесь и в виде подсказки на главном экране."));
  else bankState.candidates.forEach(c => {
    const box = el("div", "cand");
    box.append(el("b", null, c.app + " · " + c.count + " " + plural(c.count, "уведомление", "уведомления", "уведомлений")), el("div", "small-print", String(c.sample || "").slice(0, 140)));
    const b = el("div", "btns"); b.append(button("Учитывать", "small primary", () => watchApp(c.pkg, c.app)), button("Не нужно", "small ghost", () => ignoreCandidate(c.pkg)));
    box.append(b); s3.append(box);
  });
  sh.append(s3);
  sh.append(el("p", "small-print", "Уведомления обрабатываются только на телефоне. Если Claude подключён, ему отправляется только текст уведомлений о покупках, чтобы определить место и категорию."));
}

/* ---------- settings ---------- */
$("#openSettings").onclick = openSettings;

function openSettings() {
  openId = null;
  const sh = sheetStart("Настройки", "settings");
  const key = apiKey();

  /* banks */
  const sb = el("div", "set-sec"); sb.append(el("h3", null, "Банки"));
  sb.append(el("p", "small-print", !isNative() ? "Траты из уведомлений банка доступны в Android-приложении." : !bank.bankAvailable() ? "Нужна свежая версия приложения." : bankState.enabled && bankState.watched.length ? "Учитываются уведомления: " + bankState.watched.length + " " + plural(bankState.watched.length, "приложение", "приложения", "приложений") + "." : "Не подключено."));
  sb.append(button("Настроить", "small", openBankSettings));
  sh.append(sb);

  /* categories */
  const sk = el("div", "set-sec"); sk.append(el("h3", null, "Категории"));
  const mine = customCats();
  sk.append(el("p", "small-print", "Стандартные: " + SPEND_CATS.join(", ") + "."));
  if (mine.length) {
    const lst = el("div", "app-list");
    mine.forEach(c => {
      const row = el("div", "app-row cat-row");
      const used = records.filter(r => r.category === c).length;
      row.append(el("span", null, c + (used ? " · " + used : "")));
      let armed = false;
      const del = button("Удалить", "small ghost danger", async () => {
        if (!armed) { armed = true; del.textContent = used ? "Траты → «Другое»?" : "Точно?"; setTimeout(() => { armed = false; del.textContent = "Удалить"; }, 4000); return; }
        LS.set("customCats", JSON.stringify(customCats().filter(x => x !== c)));
        const rl = rules(); Object.keys(rl).forEach(k => { if (rl[k] === c) delete rl[k]; }); LS.set("rules", JSON.stringify(rl));
        for (const r of records.filter(x => x.category === c)) await store.updateReceipt(r.id, { category: "Другое" });
        toast("Категория «" + c + "» удалена"); await reload(); openSettings();
      });
      del.style.marginLeft = "auto";
      row.append(del); lst.append(row);
    });
    sk.append(lst);
  }
  const addRow = el("div", "keyrow");
  const ci = inp("new-cat", "text", ""); ci.placeholder = "Новая категория"; ci.maxLength = 40;
  const ca = button("Добавить", "primary small", () => {
    const res = addCustomCat(ci.value);
    if (res.error) { toast(res.error); ci.focus(); return; }
    toast(res.existed ? "Такая категория уже есть" : "Категория «" + res.name + "» добавлена");
    if (!res.existed) openSettings();
  });
  ca.style.flex = "none";
  ci.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); ca.click(); } });
  addRow.append(ci, ca); sk.append(addRow);
  sh.append(sk);

  /* Claude connection */
  const sec = el("div", "set-sec"); sec.append(el("h3", null, "Распознавание через Claude"));
  if (key) {
    sec.append(el("div", "note ok", "Claude подключён. Ключ хранится только на этом телефоне."));
    const seg = el("div", "seg"); seg.style.marginTop = "12px";
    Object.entries(MODELS).forEach(([k, m]) => {
      const b = el("button"); b.type = "button"; b.setAttribute("aria-pressed", String(modelKey() === k));
      b.append(el("b", null, m.label), el("span", null, m.hint));
      b.onclick = () => { LS.set("model", k); openSettings(); };
      seg.append(b);
    });
    sec.append(seg);
    const btns = el("div", "btns");
    btns.append(link("Баланс и пополнение", CONSOLE_BILLING, "small"), link("Лимит трат", CONSOLE_LIMITS, "small"));
    let armed = false;
    const off = button("Отключить", "small danger", () => {
      if (!armed) { armed = true; off.textContent = "Точно отключить?"; setTimeout(() => { armed = false; off.textContent = "Отключить"; }, 4000); return; }
      LS.set("apiKey", null); toast("Claude отключён"); openSettings(); render();
    });
    btns.append(off); sec.append(btns);
  } else {
    const ol = el("ol", "steps");
    const s1 = el("li"); const d1 = el("div"); d1.append("Откройте консоль Claude и войдите (можно через Google). ", link("Открыть консоль", CONSOLE_KEYS, "small")); s1.append(d1);
    const s2 = el("li"); s2.append(el("div", null, "Нажмите «Create key», назовите его, например, «Траты», и скопируйте ключ. Он начинается с sk-ant-."));
    const s3 = el("li"); s3.append(el("div", null, "Пополните баланс в разделе Billing (на планах Max и Team ежемесячные кредиты на API начисляются бесплатно)."));
    const s4 = el("li"); const d4 = el("div"); d4.append(el("div", null, "Вставьте ключ сюда:"));
    const row = el("div", "keyrow"); row.style.marginTop = "8px";
    const kIn = inp("api-key", "password", ""); kIn.placeholder = "sk-ant-…"; kIn.autocomplete = "off"; kIn.spellcheck = false;
    const go = button("Подключить", "primary small", async () => {
      const v = kIn.value.trim();
      if (!v) { toast("Вставьте ключ"); kIn.focus(); return; }
      if (!v.startsWith("sk-ant-")) { toast("Похоже, это не ключ Claude: он начинается с sk-ant-"); return; }
      go.disabled = true; go.textContent = "Проверяю…";
      try { await checkKey(v); LS.set("apiKey", v); toast("Claude подключён"); openSettings(); render(); classifyNew(); }
      catch (e) { toast(e.message || "Ключ не подошёл.", 5000); go.disabled = false; go.textContent = "Подключить"; }
    });
    go.style.flex = "none";
    row.append(kIn, go); d4.append(row); s4.append(d4);
    ol.append(s1, s2, s3, s4); sec.append(ol);
    sec.append(el("p", "small-print", "Ключ хранится только на этом телефоне и отправляется только в Anthropic. Распознавание оплачивается с вашего баланса API, в консоли можно поставить лимит трат. Без ключа работает бесплатное распознавание прямо на телефоне."));
  }
  sh.append(sec);

  /* install */
  if (!isStandalone()) {
    const si = el("div", "set-sec"); si.append(el("h3", null, "Установка"));
    if (installEvent) si.append(button("Установить на главный экран", "", doInstall));
    else if (isIOS()) si.append(el("p", "small-print", "В Safari нажмите «Поделиться», затем «На экран „Домой“»."));
    else si.append(el("p", "small-print", "Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран»."));
    sh.append(si);
  }

  /* currency */
  const sc = el("div", "set-sec"); sc.append(el("h3", null, "Основная валюта"));
  const curF = el("div", "f");
  const curSel = select("currency", Object.entries(CURRENCIES).map(([code, s]) => [code, s + "  " + code]), currencyCode());
  curSel.onchange = () => { LS.set("currency", curSel.value); render(); toast("Валюта: " + curSel.value); };
  curF.append(curSel);
  sc.append(curF, el("p", "small-print", "По умолчанию определяется по вашим тратам. Траты в других валютах показываются отдельно."));
  sh.append(sc);

  /* data */
  const sd = el("div", "set-sec"); sd.append(el("h3", null, "Мои данные"));
  sd.append(el("p", "small-print", "Все траты, чеки и фото хранятся только на этом телефоне. Сохраняйте копию, чтобы не потерять их при смене телефона."));
  const bd = el("div", "btns");
  bd.append(button("Сохранить копию", "small", exportData), button("Восстановить из копии", "small ghost", () => { $("#importInput").value = ""; $("#importInput").click(); }), button("Фото из галереи", "small ghost", () => { closeSheet(); pickPhoto(true); }));
  sd.append(bd);
  sh.append(sd);

  /* updates */
  const su = el("div", "set-sec"); su.append(el("h3", null, "Обновления"));
  su.append(el("p", "small-print", "Версия " + appVersion()));
  if (isNative()) {
    const line = el("p", "small-print");
    const describe = st => ({
      idle: "Проверка ещё не запускалась.",
      checking: "Проверяю…",
      latest: "Установлена последняя версия.",
      downloading: "Скачиваю версию " + st.detail + "…",
      ready: "Версия " + st.detail + " скачана. Нажмите «Перезапустить».",
      error: st.detail,
    }[st.state] || "");
    line.textContent = describe(updateStatus());
    const bu = el("div", "btns");
    const chk = button("Проверить обновления", "small", async () => {
      chk.disabled = true; line.textContent = "Проверяю…";
      const st = await checkForUpdates();
      line.textContent = describe(st); chk.disabled = false;
      if (st.state === "ready") openSettings();
    });
    bu.append(chk);
    if (updateStatus().apk) bu.append(link("Скачать APK", APK_URL + "?v=" + Date.now(), "small"));
    if (updateStatus().ready) bu.append(button("Перезапустить", "small primary", () => applyUpdateNow().catch(() => toast("Не удалось перезапустить. Закройте и откройте приложение."))));
    su.append(line, bu);
  }
  sh.append(su);
}

async function doInstall() {
  if (!installEvent) return;
  installEvent.prompt();
  try { await installEvent.userChoice; } catch (_) {}
  installEvent = null; render();
}

async function exportData() {
  const all = await store.allReceipts();
  const data = { app: "receipt-spending", version: 2, exportedAt: new Date().toISOString(), receipts: all, rules: rules(), customCats: customCats() };
  const fileName = "traty-" + isoDay(new Date()) + ".json";
  if (isNative()) {
    try { await shareTextFile(fileName, JSON.stringify(data, null, 2)); }
    catch (e) { if (!/cancel/i.test(String(e && e.message))) toast("Не удалось сохранить копию."); }
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Копия сохранена (без фото)");
}
$("#importInput").onchange = async e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data.receipts) ? data.receipts : [];
    let n = 0;
    for (const r of list) { if (r && r.id) { await store.putReceipt(Object.assign({}, r, { status: r.status === "parsing" ? "pending" : r.status })); n++; } }
    if (Array.isArray(data.customCats)) data.customCats.forEach(c => addCustomCat(c));
    if (data.rules && typeof data.rules === "object") LS.set("rules", JSON.stringify(Object.assign({}, data.rules, rules())));
    toast("Восстановлено записей: " + n); closeSheet(); reload();
  } catch (_) { toast("Этот файл не похож на копию приложения."); }
};

/* ---------- install & offline ---------- */
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; render(); });
window.addEventListener("appinstalled", () => { installEvent = null; toast("Приложение установлено"); render(); });
if (!isNative() && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}

/* ---------- start ---------- */
async function onResume() {
  if (!bank.bankAvailable()) return;
  await refreshBankState();
  await importBank();
  render();
  if (sheetMode === "bank") openBankSettings();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") onResume(); });
if (bank.bankAvailable()) bank.onBankNotification(() => importBank());

initUpdates(info => { updateInfo = info; render(); });
reload().then(onResume).then(classifyNew).then(planReportNotification);
