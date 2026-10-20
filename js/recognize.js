// Receipt recognition: Claude API with the user's own key, or free on-device OCR.
export const CATS = ["Овощи и фрукты", "Мясо и рыба", "Молочное и яйца", "Хлеб и выпечка", "Крупы и бакалея", "Сладкое и снеки", "Напитки", "Алкоголь", "Готовая еда", "Кафе и доставка", "Бытовая химия", "Гигиена и аптека", "Другое"];

export const MODELS = {
  accurate: { id: "claude-sonnet-5-5", label: "Точнее", hint: "Лучше читает мятые и грузинские чеки" },
  cheap: { id: "claude-haiku-5-5", label: "Дешевле", hint: "Быстрее и в несколько раз дешевле" },
};

const API = "https://api.anthropic.com/v1";
const headers = key => ({
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
  "anthropic-dangerous-direct-browser-access": "true",
});

export class RecognizeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function apiError(status, body) {
  const msg = (body && body.error && body.error.message) || "";
  if (status === 401) return new RecognizeError("bad_key", "Ключ не подходит. Проверьте, что скопировали его целиком.");
  if (status === 403) return new RecognizeError("forbidden", "У ключа нет доступа. Создайте новый ключ в консоли Anthropic.");
  if (/credit balance/i.test(msg)) return new RecognizeError("no_credit", "На балансе API закончились деньги. Пополните его в консоли Anthropic.");
  if (status === 429) return new RecognizeError("rate", "Слишком много запросов или достигнут лимит трат. Попробуйте позже.");
  if (status === 529 || status >= 500) return new RecognizeError("busy", "Сервис Claude сейчас перегружен. Попробуйте через минуту.");
  return new RecognizeError("api", msg ? "Ошибка Claude: " + msg : "Не удалось распознать чек.");
}

export async function checkKey(key) {
  let res;
  try { res = await fetch(API + "/models?limit=1", { headers: headers(key) }); }
  catch (_) { throw new RecognizeError("network", "Нет связи с Claude. Проверьте интернет."); }
  if (!res.ok) { let b = null; try { b = await res.json(); } catch (_) {} throw apiError(res.status, b); }
  return true;
}

const PROMPT = `Это фото кассового чека. Скорее всего чек из Грузии: текст может быть на грузинском, русском или английском, валюта обычно лари (GEL).
Распознай чек и ответь ТОЛЬКО одним JSON-объектом без пояснений и без markdown:
{"store":"название магазина или заведения","date":"YYYY-MM-DD или null","currency":"GEL","total":12.35,"items":[{"name":"краткое понятное название товара по-русски","orig":"название как в чеке","qty":1,"price":3.20,"category":"Молочное и яйца"}]}
Правила:
- price — итоговая сумма по строке с учётом количества и скидки на эту позицию.
- Если есть общая скидка, добавь позицию "Скидка" с отрицательной price и категорией "Другое".
- total — итог к оплате из чека.
- category — строго одна из: ${CATS.join(", ")}. Чек из кафе или ресторана — "Кафе и доставка".
- Не выдумывай позиции. Если строку не прочитать, name = "Не распознано".
- Если на фото не чек, ответь {"error":"not_receipt"}.`;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function extractJson(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch (_) {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (_) {} }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
  return null;
}

const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = v => Math.round(num(v) * 100) / 100;

export function normalize(res) {
  const items = (Array.isArray(res.items) ? res.items : []).map(i => ({
    name: String((i && i.name) || "Не распознано").slice(0, 120),
    orig: String((i && i.orig) || "").slice(0, 160),
    qty: num(i && i.qty) || 1,
    price: r2(i && i.price),
    category: CATS.includes(i && i.category) ? i.category : "Другое",
  }));
  const sum = items.reduce((s, i) => s + i.price, 0);
  const out = { items, total: r2(res.total) || r2(sum), store: String(res.store || "").slice(0, 80), currency: String(res.currency || "GEL").slice(0, 6) };
  if (typeof res.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(res.date)) out.date = res.date;
  return out;
}

export async function recognizeWithClaude(blob, key, modelId) {
  const data = await blobToBase64(blob);
  const body = {
    model: modelId,
    max_tokens: 4096,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: blob.type || "image/jpeg", data } },
      { type: "text", text: PROMPT },
    ] }],
  };
  let res;
  try { res = await fetch(API + "/messages", { method: "POST", headers: headers(key), body: JSON.stringify(body) }); }
  catch (_) { throw new RecognizeError("network", "Нет связи с Claude. Фото сохранено, попробуйте позже."); }
  let json = null; try { json = await res.json(); } catch (_) {}
  if (!res.ok) throw apiError(res.status, json);
  const text = (json && Array.isArray(json.content) ? json.content : []).filter(c => c.type === "text").map(c => c.text).join("\n");
  const parsed = extractJson(text);
  if (!parsed) throw new RecognizeError("bad_answer", "Claude ответил непонятно. Нажмите «Распознать снова».");
  if (parsed.error) throw new RecognizeError("not_receipt", "Не похоже на чек. Переснимите или заполните вручную.");
  return normalize(parsed);
}

/* ---------- free mode: on-device OCR with Tesseract ---------- */
let tessLoading = null, worker = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  if (tessLoading) return tessLoading;
  tessLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = resolve;
    s.onerror = () => { tessLoading = null; reject(new RecognizeError("network", "Не удалось загрузить бесплатное распознавание. Нужен интернет.")); };
    document.head.appendChild(s);
  });
  return tessLoading;
}

const TOTAL_WORDS = /(ჯამი|სულ|გადასახდელი|итог|всего|к оплате|total|сумма)/i;
const SKIP_WORDS = /(დღგ|ндс|vat|сдача|ხურდა|наличн|карт|card|cash|ნაღდი|ბარათ|чек|тел|tel|www|http)/i;

export function parseOcrText(text) {
  const lines = String(text || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  const items = []; let total = 0; let date = null;
  for (const line of lines) {
    const d = line.match(/(\d{2})[./-](\d{2})[./-](\d{4})/);
    if (d && !date) date = `${d[3]}-${d[2]}-${d[1]}`;
    const m = line.match(/^(.*?)[\s.:*x×]+(-?\d{1,5}[.,]\d{2})\s*(?:₾|gel|ლ|a|b|ა)?\s*$/i);
    if (!m) continue;
    const name = m[1].replace(/\s+\d+([.,]\d+)?\s*[x×*]?\s*$/i, "").replace(/[\s.:*]+$/, "").trim();
    const price = num(m[2]);
    if (TOTAL_WORDS.test(name)) { total = Math.max(total, price); continue; }
    if (SKIP_WORDS.test(name) || name.length < 2) continue;
    items.push({ name, orig: name, qty: 1, price: r2(price), category: "Другое" });
  }
  const storeLine = lines.find(l => !/\d/.test(l) && l.length > 2) || "";
  const out = { items, total: r2(total) || r2(items.reduce((s, i) => s + i.price, 0)), store: storeLine.slice(0, 80), currency: "GEL" };
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.date = date;
  return out;
}

export async function recognizeFree(blob, onProgress) {
  await loadTesseract();
  if (!worker) {
    onProgress && onProgress("Первый запуск: загружаю распознавание (около 20 МБ)…");
    worker = await window.Tesseract.createWorker(["kat", "rus", "eng"]);
  }
  onProgress && onProgress("Читаю текст чека…");
  const { data } = await worker.recognize(blob);
  return parseOcrText(data && data.text);
}
