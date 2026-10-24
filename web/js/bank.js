// Bank notifications: access to the native listener (APK only) and parsing texts into operations.
import { isNative } from "./native.js";

export const SPEND_CATS = ["Продукты", "Кафе и рестораны", "Транспорт", "Жильё и коммунальные", "Связь и подписки", "Здоровье", "Одежда и обувь", "Дом", "Развлечения", "Путешествия", "Подарки", "Образование", "Переводы", "Другое"];
export const INCOME_CAT = "Поступления";

let pluginRef = null;
function plugin() {
  const cap = window.Capacitor;
  if (!pluginRef) pluginRef = cap.registerPlugin("BankNotifications");
  return pluginRef;
}
/** True only in an APK that contains the native listener (older APKs do not). */
export const bankAvailable = () => isNative() && !!(window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable("BankNotifications"));

export const bankStatus = () => plugin().status();
export const openListenerSettings = () => plugin().openSettings();
export const openAppInfo = () => plugin().openAppInfo();
export const listApps = () => plugin().listApps().then(r => r.apps || []);
export const setWatched = packages => plugin().setWatched({ packages });
export const getPending = () => plugin().getPending().then(r => r.items || []);
export const ackPending = ids => plugin().ack({ ids });
export const getCandidates = () => plugin().getCandidates().then(r => r.items || []);
export const dismissCandidate = pkg => plugin().dismissCandidate({ pkg });
export const onBankNotification = fn => { try { plugin().addListener("notification", fn); } catch (_) {} };

/* ---------- which installed apps look like banks ---------- */
const BANK_HINTS = /(bank|банк|banco|banca|bankas|pay\b|pay$|wallet|кошел[её]к|card|finance|финанс|money|деньг|revolut|wise|monzo|n26|paypal|sber|сбер|tinkoff|т-банк|t-bank|alfa|альфа|vtb|втб|raiffeisen|райф|gazprombank|газпромбанк|ozon банк|kaspi|halyk|freedom|tbc|bog\b|bank of georgia|credo|liberty|basis|terabank|ziraat|garanti|akbank|isbank|yapı kredi|monobank|privat|приват|ameria|ardshin|inecobank|idram|kapital|abb|payoneer|unicredit|ing\b|bunq|starling|chase|wells fargo|citi|hsbc|barclays|santander|bbva|caixa|millennium|pko|mbank|otp|erste|intesa)/i;
const NOT_BANK = /(google pay services|play|store|магазин|youtube|camera|gallery|calculator|калькулятор|clock|часы|weather|погода|game|игр)/i;
export function looksLikeBankApp(app) {
  const s = (app.name || "") + " " + (app.pkg || "");
  return BANK_HINTS.test(s) && !NOT_BANK.test(app.name || "");
}

/* ---------- parsing a notification text ---------- */
const CUR_MAP = {
  "₾": "GEL", "лари": "GEL", "gel": "GEL", "₽": "RUB", "руб": "RUB", "руб.": "RUB", "р.": "RUB", "р": "RUB", "rub": "RUB", "rur": "RUB",
  "€": "EUR", "eur": "EUR", "$": "USD", "usd": "USD", "£": "GBP", "gbp": "GBP", "₸": "KZT", "тг": "KZT", "kzt": "KZT",
  "₴": "UAH", "грн": "UAH", "uah": "UAH", "֏": "AMD", "amd": "AMD", "₼": "AZN", "azn": "AZN", "byn": "BYN", "br": "BYN",
  "uzs": "UZS", "сум": "UZS", "kgs": "KGS", "сом": "KGS", "₺": "TRY", "try": "TRY", "tl": "TRY", "zł": "PLN", "pln": "PLN",
  "₪": "ILS", "ils": "ILS", "aed": "AED", "฿": "THB", "thb": "THB", "rsd": "RSD", "дин": "RSD",
};
const CUR_RE = "(₾|₽|€|\\$|£|₸|₴|֏|₼|₺|zł|₪|฿|GEL|USD|EUR|RUB|RUR|KZT|UAH|AMD|AZN|BYN|UZS|KGS|TRY|TL|PLN|GBP|ILS|AED|THB|RSD|лари|руб\\.?|р\\.?(?![а-яa-z])|грн|сум|сом|тг|дин)";
const NUM_RE = "(\\d{1,3}(?:[\\s\\u00a0\\u202f]\\d{3})+(?:[.,]\\d{1,2})?|\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
const MONEY_RE = new RegExp("(?:" + NUM_RE + "\\s?" + CUR_RE + "|" + CUR_RE + "\\s?" + NUM_RE + ")", "giu");

const BALANCE_WORDS = /(баланс|остаток|доступно|доступный|лимит|balance|available|avail\.?|bal\.?|ნაშთი|ხელმისაწვდომი|kalan|bakiye|saldo|залишок)\s*:?\s*$/iu;
const INCOME_WORDS = /(зачислен|поступлен|пополнен|получен|перевод от|вам перевели|возврат|кэшбэк|кешбэк|cashback|refund|received|credited|incoming|deposit|salary|зарплат|ჩაირიცხა|შემოსავალი)/iu;
const TRANSFER_WORDS = /(перевод|transfer|p2p|по номеру телефона|сбп|გადარიცხვა)/iu;
const NOT_PAYMENT = /(код подтверждения|одноразов|никому не сообщайте|verification code|one-time|otp|пароль|password|вход в|login|войти|отклонен|отказ|declined|insufficient|недостаточно)/iu;

export function parseAmount(raw) {
  let s = String(raw).replace(/[\s  ]/g, "");
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot > -1 && !/\.\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = parseFloat(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function currencyCode(token) {
  const t = String(token || "").toLowerCase().replace(/\.$/, "");
  return CUR_MAP[t] || CUR_MAP[t + "."] || (t.length === 3 ? t.toUpperCase() : null);
}

/** Merchant: what is left after removing amounts, card numbers, dates and service words. */
function guessMerchant(text, title) {
  let s = " " + String(text) + " ";
  s = s.replace(MONEY_RE, " | ");
  s = s.replace(/(?:карт[аыу]?|card|счёт|счет|acc(?:ount)?)\s*[*•·.x×#№]*\s*\d{2,}/giu, " | ");
  s = s.replace(/[*•·x×#]{1,6}\d{3,}/giu, " | ");
  s = s.replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g, " | ");
  s = s.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " | ");
  s = s.replace(/(?<![\p{L}\d])\d{4}(?![\p{L}\d])/gu, " ");
  s = s.replace(/(?<!\p{L})(баланс|остаток|доступно|доступный остаток|balance|available|покупка|оплата|списание|платеж|платёж|успешн\p{L}*|операция|purchase|payment of|payment|you paid|paid|debit|transaction|approved|одобрено|по карте|картой|с карты|на сумму|сумма|amount|в магазине|merchant|место|мерчант|перевод|transfer|at|to|for|в|на|ნაშთი|გადახდა|ბარათი)(?!\p{L})\s*:?/giu, " | ");
  const parts = s.split(/[|\n;]+/).map(p => p.replace(/^[\s,.:\-–—]+|[\s,.:\-–—]+$/g, "")).filter(p => p.length >= 2 && /[A-Za-zА-Яа-яЁёႠ-ჿ]/.test(p));
  parts.sort((a, b) => {
    const score = p => (/[A-Z]{3,}/.test(p) ? 3 : 0) + Math.min(p.length, 25) / 25;
    return score(b) - score(a);
  });
  let m = parts[0] || "";
  if (!m && title && !/(bank|банк|уведомлен|операци)/i.test(title)) m = title;
  return m.slice(0, 60);
}

/**
 * Turns a notification into an operation, or null if it is not a payment.
 * Returns { amount, currency, merchant, kind: "expense" | "income", transfer, confidence }.
 */
export function parseNotification(n) {
  const title = String(n.title || ""), text = String(n.text || "");
  const all = (title + "\n" + text).trim();
  if (NOT_PAYMENT.test(all)) return null;
  const found = [];
  MONEY_RE.lastIndex = 0;
  let m;
  while ((m = MONEY_RE.exec(all))) {
    const num = m[1] || m[4], cur = m[2] || m[3];
    const before = all.slice(Math.max(0, m.index - 24), m.index);
    found.push({ amount: parseAmount(num), currency: currencyCode(cur), isBalance: BALANCE_WORDS.test(before), index: m.index });
  }
  const pick = found.find(f => !f.isBalance && f.amount > 0);
  if (!pick) return null;
  const income = INCOME_WORDS.test(all) && !/(списан|покупк|оплат|purchase|payment|debit)/iu.test(all);
  const transfer = TRANSFER_WORDS.test(all);
  const merchant = guessMerchant(text || title, title);
  return {
    amount: pick.amount,
    currency: pick.currency,
    merchant,
    kind: income ? "income" : "expense",
    transfer,
    confidence: merchant ? "ok" : "low",
  };
}

export const normMerchant = s => String(s || "").toLowerCase().replace(/[^a-zа-яё0-9Ⴀ-ჿ]+/giu, " ").replace(/\b(llc|ооо|ип|ltd|inc|шпс|შპს)\b/g, " ").replace(/\s+/g, " ").trim();

/** "COFFEE LAB" → "Coffee Lab": shouting card-terminal names are hard to read. */
export function prettyMerchant(s) {
  s = String(s || "").trim();
  if (s.length < 4 || /[a-zа-яё]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}
