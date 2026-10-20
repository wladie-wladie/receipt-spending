import * as store from "./db.js";
import { CATS, MODELS, checkKey, recognizeWithClaude, recognizeFree, unitPrice } from "./recognize.js";
import { isNative, takePhoto, shareTextFile, initUpdates, applyUpdateNow, appVersion } from "./native.js";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_G = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const CONSOLE_KEYS = "https://platform.claude.com/settings/keys";
const CONSOLE_BILLING = "https://platform.claude.com/settings/billing";
const CONSOLE_LIMITS = "https://platform.claude.com/settings/limits";

const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pad = n => String(n).padStart(2, "0");
const isoDay = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const money = v => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = v => Math.round(num(v) * 100) / 100;
function plural(n, a, b, c) { n = Math.abs(n) % 100; const n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }

/* ---------- settings (kept only on this device) ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem("rs." + k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem("rs." + k); else localStorage.setItem("rs." + k, v); } catch (_) {} },
};
const apiKey = () => LS.get("apiKey", "");

/* ---------- currency ---------- */
const CURRENCIES = { GEL: "₾", RUB: "₽", EUR: "€", USD: "$", GBP: "£", KZT: "₸", UAH: "₴", AMD: "֏", AZN: "₼", BYN: "Br", UZS: "сўм", KGS: "сом", TRY: "₺", PLN: "zł", ILS: "₪", AED: "AED", THB: "฿", RSD: "дин" };
const REGION_CURRENCY = { GE: "GEL", RU: "RUB", KZ: "KZT", UA: "UAH", AM: "AMD", AZ: "AZN", BY: "BYN", UZ: "UZS", KG: "KGS", TR: "TRY", PL: "PLN", IL: "ILS", AE: "AED", TH: "THB", RS: "RSD", US: "USD", GB: "GBP", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", CY: "EUR", ME: "EUR", PT: "EUR", FI: "EUR", LV: "EUR", LT: "EUR", EE: "EUR" };
function currencyCode() {
  const saved = LS.get("currency", "");
  if (CURRENCIES[saved]) return saved;
  const counts = {};
  receipts.forEach(r => { if (r.currency && CURRENCIES[r.currency]) counts[r.currency] = (counts[r.currency] || 0) + 1; });
  const fromReceipts = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (fromReceipts) return fromReceipts;
  const region = ((navigator.language || "").split("-")[1] || "").toUpperCase();
  return REGION_CURRENCY[region] || "USD";
}
const cur = () => CURRENCIES[currencyCode()];
const modelKey = () => (LS.get("model", "accurate") in MODELS ? LS.get("model", "accurate") : "accurate");

/* ---------- state ---------- */
let receipts = [];
const now = new Date();
const ym = { y: now.getFullYear(), m: now.getMonth() };
let tab = "spend", openId = null;
const parsingNow = new Set();
const photoUrls = new Map();
let installEvent = null;
let updateInfo = null;

async function reload() { receipts = await store.allReceipts(); render(); }

/* ---------- toast ---------- */
let tt;
function toast(msg, ms = 3400) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, ms); }

/* ---------- helpers ---------- */
const rDate = r => (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : String(r.createdAt || "").slice(0, 10);
const inMonth = r => rDate(r).slice(0, 7) === ym.y + "-" + pad(ym.m + 1);
const rTotal = r => (r.total != null && r.total !== "") ? num(r.total) : (r.items || []).reduce((s, i) => s + num(i.price), 0);
const isStuck = r => r.status === "parsing" && !parsingNow.has(r.id);
const needsParse = r => r.status === "pending" || isStuck(r);
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
function topCat(items) { const s = {}; items.forEach(i => { s[i.category] = (s[i.category] || 0) + num(i.price); }); let best = null, v = -Infinity; for (const k in s) if (s[k] > v) { v = s[k]; best = k; } return best; }
function emptyState(t, p, actions) { const e = el("div", "empty"); e.append(el("h3", null, t)); if (p) e.append(el("p", null, p)); if (actions) { const b = el("div", "btns"); b.style.justifyContent = "center"; actions.forEach(a => b.append(a)); e.append(b); } return e; }
function button(text, cls, onClick) { const b = el("button", "btn " + (cls || ""), text); b.type = "button"; b.onclick = onClick; return b; }
function link(text, href, cls) { const a = el("a", "btn " + (cls || ""), text); a.href = href; a.target = "_blank"; a.rel = "noopener"; return a; }

/* ---------- render ---------- */
function render() {
  $("#mlabel").textContent = MONTHS[ym.m] + " " + ym.y;
  renderBanner();
  const list = receipts.filter(inMonth);
  if (tab === "spend") renderSpend(list); else renderStats(list);
}

function isStandalone() { return isNative() || window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
const isIOS = () => !isNative() && /iphone|ipad|ipod/i.test(navigator.userAgent);

function renderBanner() {
  const box = $("#banner"); box.innerHTML = "";
  if (updateInfo) {
    const b = el("div", "banner"); const t = el("div", "b-text");
    t.append(el("b", null, "Загружена новая версия"), el("p", null, updateInfo.notes || "Она включится сама при следующем запуске, или можно перезапустить сейчас."));
    const a = el("div", "b-actions");
    a.append(button("Перезапустить", "small primary", () => applyUpdateNow().catch(() => toast("Не удалось обновить. Перезапустите приложение."))), button("Позже", "small ghost", () => { updateInfo = null; render(); }));
    t.append(a); b.append(t); box.append(b); return;
  }
  if (!apiKey() && LS.get("connectDismissed") !== "1") {
    const b = el("div", "banner"); const t = el("div", "b-text");
    t.append(el("b", null, "Подключите Claude"), el("p", null, "Тогда чеки будут сами разбираться на позиции и категории. Без него работает бесплатное распознавание текста, но хуже."));
    const a = el("div", "b-actions"); a.append(button("Подключить", "small primary", openSettings), button("Позже", "small ghost", () => { LS.set("connectDismissed", "1"); render(); }));
    t.append(a); b.append(t); box.append(b); return;
  }
  if (!isStandalone() && LS.get("installDismissed") !== "1" && (installEvent || isIOS())) {
    const b = el("div", "banner"); const t = el("div", "b-text");
    t.append(el("b", null, "Установите приложение"), el("p", null, isIOS() ? "Нажмите «Поделиться» внизу Safari, затем «На экран „Домой“»." : "Оно появится на главном экране и будет открываться как обычное приложение."));
    const a = el("div", "b-actions");
    if (installEvent) a.append(button("Установить", "small primary", doInstall));
    a.append(button("Не сейчас", "small ghost", () => { LS.set("installDismissed", "1"); render(); }));
    t.append(a); b.append(t); box.append(b);
  }
}

function renderSpend(list) {
  const total = list.reduce((s, r) => s + rTotal(r), 0);
  const tEl = $("#total"); tEl.textContent = money(total); tEl.append(el("small", null, cur()));
  const st = $("#stats"); st.innerHTML = "";
  const add = (b, t) => { const s = el("span"); s.append(el("b", null, b), " " + t); st.append(s); };
  add(String(list.length), plural(list.length, "запись", "записи", "записей"));
  const isCur = ym.y === now.getFullYear() && ym.m === now.getMonth();
  const dayCount = isCur ? new Date().getDate() : new Date(ym.y, ym.m + 1, 0).getDate();
  if (list.length) add(money(total / dayCount) + " " + cur(), "в день");
  const pending = list.filter(needsParse).length;
  if (pending) add(String(pending), "ждут разбора");

  const box = $("#list"); box.innerHTML = "";
  if (!list.length) {
    box.append(emptyState("В этом месяце пока пусто", "Нажмите зелёную кнопку внизу и сфотографируйте чек. Позиции появятся здесь.",
      [button("Выбрать фото из галереи", "small", () => pickPhoto(true))]));
    return;
  }
  const groups = {};
  list.forEach(r => { (groups[rDate(r)] = groups[rDate(r)] || []).push(r); });
  Object.keys(groups).sort().reverse().forEach(d => {
    const g = groups[d].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const sec = el("div", "day"); const h = el("div", "dayhead");
    h.append(el("b", null, dayLabel(d)), el("span", "num", money(g.reduce((s, r) => s + rTotal(r), 0)) + " " + cur()));
    const rows = el("div", "rows"); g.forEach(r => rows.append(rowEl(r)));
    sec.append(h, rows); box.append(sec);
  });
}

function rowEl(r) {
  const b = el("button", "row"); b.type = "button"; b.onclick = () => openReceipt(r.id);
  const ph = el("div", "thumb", r.photo ? "" : ((r.items && r.items[0] && r.items[0].category) || cur()).slice(0, 2));
  b.append(ph);
  if (r.photo) photoUrl(r.photo).then(u => { if (u) { const im = el("img", "thumb"); im.src = u; im.alt = ""; ph.replaceWith(im); } });
  const m = el("div", "rmain");
  m.append(el("div", "rname", r.store || (r.source === "manual" ? "Без чека" : "Чек")));
  const sub = el("div", "rsub");
  if (r.status === "parsing" && !isStuck(r)) { const c = el("span", "chip"); c.append(el("span", "spin"), "Распознаю"); sub.append(c); }
  else if (needsParse(r)) sub.append(el("span", "chip", "Ждёт разбора"));
  else {
    const it = r.items || [];
    if (r.source === "manual") sub.append(it[0] ? it[0].category : "Другое");
    else sub.append(it.length + " " + plural(it.length, "позиция", "позиции", "позиций") + (topCat(it) ? " · " + topCat(it) : ""));
  }
  m.append(sub); b.append(m);
  b.append(el("div", "ramt", r.status === "parsing" && r.total == null ? "…" : money(rTotal(r)) + " " + cur()));
  return b;
}

function renderStats(list) {
  const cats = {}; let unparsed = 0; const items = {};
  list.forEach(r => {
    const its = r.items || [];
    if (!its.length) { unparsed += rTotal(r); return; }
    its.forEach(i => {
      const c = CATS.includes(i.category) ? i.category : "Другое";
      cats[c] = (cats[c] || 0) + num(i.price);
      if (r.source === "manual") return;
      const key = (i.name || "").trim().toLowerCase();
      if (!key || key === "скидка") return;
      const o = items[key] = items[key] || { name: i.name, sum: 0, count: 0 };
      o.sum += num(i.price); o.count += 1;
    });
    const diff = rTotal(r) - its.reduce((s, i) => s + num(i.price), 0);
    if (Math.abs(diff) > 0.05) cats["Другое"] = (cats["Другое"] || 0) + diff;
  });
  if (unparsed) cats["Не разобрано"] = unparsed;
  const entries = Object.entries(cats).filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  const cb = $("#cats"); cb.innerHTML = "";
  if (!entries.length) cb.append(el("p", "hint", "Здесь появится разбивка, когда в месяце будут чеки."));
  const max = entries.length ? entries[0][1] : 1;
  entries.forEach(([k, v]) => {
    const row = el("div", "bar");
    const r = el("span", "num", money(v) + " " + cur()); r.append(el("span", "pct", Math.round(v / total * 100) + "%"));
    const tr = el("div", "track"); const f = el("div", "fill"); f.style.width = Math.max(2, v / max * 100) + "%"; tr.append(f);
    row.append(el("span", null, k), r, tr); cb.append(row);
  });
  const arr = Object.values(items);
  fillTop($("#topItems"), arr.slice().sort((a, b) => b.sum - a.sum).slice(0, 8), o => money(o.sum) + " " + cur(), o => o.count > 1 ? "×" + o.count : "");
  fillTop($("#freqItems"), arr.filter(o => o.count > 1).sort((a, b) => b.count - a.count || b.sum - a.sum).slice(0, 8), o => "×" + o.count, o => money(o.sum) + " " + cur());
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
$("#prev").onclick = () => { ym.m--; if (ym.m < 0) { ym.m = 11; ym.y--; } render(); };
$("#next").onclick = () => { ym.m++; if (ym.m > 11) { ym.m = 0; ym.y++; } render(); };

/* ---------- photo flow ---------- */
async function pickPhoto(fromGallery) {
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
  let blob;
  try { blob = await compress(file); } catch (_) { toast("Не удалось открыть фото. Попробуйте ещё раз."); return; }
  const id = store.uid();
  const nowIso = new Date().toISOString();
  try {
    await store.putPhoto(id, blob);
    await store.putReceipt({ id, createdAt: nowIso, updatedAt: nowIso, date: isoDay(new Date()), photo: id, status: "parsing", items: [], total: null, store: "", currency: currencyCode(), source: "photo" });
  } catch (_) { toast("Не хватает места на телефоне, чтобы сохранить фото."); return; }
  store.requestPersistence();
  const d = new Date(); if (d.getFullYear() !== ym.y || d.getMonth() !== ym.m) { ym.y = d.getFullYear(); ym.m = d.getMonth(); }
  if (tab !== "spend") setTab("spend");
  await reload();
initUpdates(info => { updateInfo = info; render(); });
  parse(id, blob);
}

async function parse(id, blob) {
  parsingNow.add(id);
  await store.updateReceipt(id, { status: "parsing", parseError: null });
  await reload();
  const key = apiKey();
  try {
    let res;
    if (key) {
      res = await recognizeWithClaude(blob, key, MODELS[modelKey()].id);
      res.parsedBy = "claude";
    } else {
      res = await recognizeFree(blob, msg => toast(msg, 6000));
      res.parsedBy = "free";
    }
    if (!res.currency) delete res.currency;
    await store.updateReceipt(id, Object.assign({ status: "parsed", parseError: null }, res));
    const n = res.items.length;
    toast(n ? "Чек разобран: " + n + " " + plural(n, "позиция", "позиции", "позиций") + (key ? "" : ". Проверьте суммы и категории.") : "Позиции не нашлись. Заполните вручную или подключите Claude.");
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

/* ---------- sheet plumbing ---------- */
function closeSheet() { openId = null; $("#overlay").hidden = true; }
$("#overlay").addEventListener("click", e => { if (e.target.id === "overlay") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#overlay").hidden) closeSheet(); });
function sheetStart(title) {
  const sh = $("#sheet"); sh.innerHTML = ""; sh.scrollTop = 0;
  sh.append(el("div", "grab"));
  const head = el("div", "sh-head"); head.append(el("h2", null, title));
  const x = el("button", "x", "×"); x.type = "button"; x.setAttribute("aria-label", "Закрыть"); x.onclick = closeSheet; head.append(x);
  sh.append(head); $("#overlay").hidden = false; return sh;
}
function field(label, input, wide) { const f = el("div", "f" + (wide ? " wide" : "")); const l = el("label", null, label); l.htmlFor = input.id; f.append(l, input); return f; }
function inp(id, type, val) { const i = el("input"); i.id = id; i.type = type; if (val != null) i.value = val; return i; }
function catSelect(id, val) { const s = el("select"); s.id = id; CATS.forEach(c => { const o = el("option", null, c); o.value = c; if (c === val) o.selected = true; s.append(o); }); return s; }

/* ---------- receipt details ---------- */
async function openReceipt(id) {
  const r = receipts.find(x => x.id === id); if (!r) return;
  openId = id;
  const sh = sheetStart(r.store || (r.source === "manual" ? "Трата без чека" : "Чек"));
  if (r.photo) {
    const u = await photoUrl(r.photo);
    if (u) { const im = el("img", "photo"); im.src = u; im.alt = "Фото чека"; im.onclick = () => im.classList.toggle("full"); sh.append(im); }
  }
  const busy = r.status === "parsing" && !isStuck(r);
  if (busy) { const n = el("div", "note"); n.append(el("span", "spin"), "Распознаю позиции, результат появится сам."); sh.append(n); }
  else if (needsParse(r)) sh.append(el("div", "note", "Позиции ещё не разобраны. Нажмите «Распознать» или заполните вручную."));
  else if (r.parsedBy === "free") sh.append(el("div", "note", "Распознано бесплатно: проверьте названия, суммы и категории."));

  const fs = el("div", "fields");
  const fStore = inp("e-store", "text", r.store || "");
  const fDate = inp("e-date", "date", rDate(r));
  const fTotal = inp("e-total", "text", r.total != null ? String(r.total) : ""); fTotal.inputMode = "decimal";
  fs.append(field("Магазин / место", fStore, true), field("Дата", fDate), field("Итого, " + cur(), fTotal));
  sh.append(fs);

  const items = (r.items || []).map(i => Object.assign({}, i));
  const paper = el("div", "paper");
  const updSum = () => {
    const s = paper.querySelector(".sumline"); if (!s) return;
    const sum = items.reduce((a, i) => a + num(i.price), 0);
    s.innerHTML = ""; s.append(el("span", null, "Сумма позиций"), el("span", null, money(sum) + " " + cur()));
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
      const c = catSelect("it-c-" + idx, it.category); c.setAttribute("aria-label", "Категория"); c.onchange = () => { it.category = c.value; };
      row.append(n, p, d, c);
      const meta = [];
      if (it.generic && it.generic.toLowerCase() !== (it.name || "").toLowerCase()) meta.push(it.generic);
      if (it.size && it.unit) meta.push((it.qty > 1 ? it.qty + " × " : "") + String(it.size).replace(".", ",") + " " + ({ kg: "кг", g: "г", l: "л", ml: "мл", pcs: "шт" }[it.unit] || it.unit));
      const up = unitPrice(it); if (up) meta.push(money(up.value) + " " + cur() + "/" + up.per);
      if (meta.length) row.append(el("div", "orig", meta.join(" · ")));
      else if (it.orig && it.orig !== it.name) row.append(el("div", "orig", it.orig));
      paper.append(row);
    });
    paper.append(el("div", "sumline")); updSum();
  };
  fTotal.oninput = updSum;
  drawItems(); sh.append(paper);

  const b1 = el("div", "btns");
  b1.append(button("+ Позиция", "ghost", () => { items.push({ name: "", orig: "", qty: 1, price: 0, category: "Другое" }); drawItems(); const last = paper.querySelector("#it-n-" + (items.length - 1)); if (last) last.focus(); }));
  if (r.photo && !busy) b1.append(button(r.status === "parsed" ? "Распознать снова" : "Распознать", "ghost", () => reparse(r)));
  sh.append(b1);

  const b2 = el("div", "btns");
  const save = button("Сохранить", "primary", async () => {
    save.disabled = true;
    const clean = items.filter(i => (i.name || "").trim() || num(i.price)).map(i => {
      const it = Object.assign({}, i, { name: (i.name || "").trim() || "Без названия", orig: i.orig || "", qty: num(i.qty) || 1, price: r2(i.price), category: CATS.includes(i.category) ? i.category : "Другое" });
      const up = unitPrice(it); it.unitPrice = up ? up.value : null; it.unitPer = up ? up.per : null;
      return it;
    });
    const patch = { store: fStore.value.trim(), date: fDate.value || rDate(r), total: fTotal.value.trim() === "" ? null : r2(fTotal.value), items: clean };
    if (!busy && clean.length && r.source !== "manual") patch.status = "parsed";
    try { await store.updateReceipt(r.id, patch); toast("Сохранено"); closeSheet(); reload(); }
    catch (_) { toast("Не удалось сохранить."); save.disabled = false; }
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

/* ---------- manual entry ---------- */
$("#addManual").onclick = () => {
  openId = null;
  const sh = sheetStart("Трата без чека");
  const fs = el("div", "fields");
  const fWhat = inp("m-what", "text", ""); fWhat.placeholder = "Например: обед в кафе, овощи на рынке";
  const fStore = inp("m-store", "text", ""); fStore.placeholder = "Кафе, рынок, магазин";
  const fSum = inp("m-sum", "text", ""); fSum.inputMode = "decimal"; fSum.placeholder = "0.00";
  const fDate = inp("m-date", "date", isoDay(new Date()));
  const fCat = catSelect("m-cat", "Кафе и доставка");
  fs.append(field("Что купили", fWhat, true), field("Где", fStore, true), field("Сумма, " + cur(), fSum), field("Дата", fDate), field("Категория", fCat, true));
  sh.append(fs);
  const b = el("div", "btns");
  const save = button("Добавить", "primary", async () => {
    const s = r2(fSum.value); if (!s) { toast("Укажите сумму"); fSum.focus(); return; }
    save.disabled = true;
    const nowIso = new Date().toISOString();
    await store.putReceipt({ id: store.uid(), createdAt: nowIso, updatedAt: nowIso, date: fDate.value || isoDay(new Date()), photo: null, status: "manual", source: "manual",
      store: fStore.value.trim(), total: s, currency: currencyCode(), items: [{ name: fWhat.value.trim() || fCat.value, orig: "", qty: 1, price: s, category: fCat.value }] });
    toast("Добавлено"); closeSheet(); reload();
  });
  b.append(save); sh.append(b);
  setTimeout(() => fWhat.focus(), 60);
};

/* ---------- settings ---------- */
$("#openSettings").onclick = openSettings;

function openSettings() {
  openId = null;
  const sh = sheetStart("Настройки");
  const key = apiKey();

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
    const s2 = el("li"); s2.append(el("div", null, "Нажмите «Create key», назовите его, например, «Чеки», и скопируйте ключ. Он начинается с sk-ant-."));
    const s3 = el("li"); s3.append(el("div", null, "Пополните баланс в разделе Billing (на планах Max и Team ежемесячные кредиты на API начисляются бесплатно)."));
    const s4 = el("li"); const d4 = el("div"); d4.append(el("div", null, "Вставьте ключ сюда:"));
    const row = el("div", "keyrow"); row.style.marginTop = "8px";
    const kIn = inp("api-key", "password", ""); kIn.placeholder = "sk-ant-…"; kIn.autocomplete = "off"; kIn.spellcheck = false;
    const go = button("Подключить", "primary small", async () => {
      const v = kIn.value.trim();
      if (!v) { toast("Вставьте ключ"); kIn.focus(); return; }
      if (!v.startsWith("sk-ant-")) { toast("Похоже, это не ключ Claude: он начинается с sk-ant-"); return; }
      go.disabled = true; go.textContent = "Проверяю…";
      try { await checkKey(v); LS.set("apiKey", v); toast("Claude подключён"); openSettings(); render(); }
      catch (e) { toast(e.message || "Ключ не подошёл.", 5000); go.disabled = false; go.textContent = "Подключить"; }
    });
    go.style.flex = "none";
    row.append(kIn, go); d4.append(row); s4.append(d4);
    ol.append(s1, s2, s3, s4); sec.append(ol);
    sec.append(el("p", "small-print", "Ключ хранится только на этом телефоне и отправляется только в Anthropic. Чеки оплачиваются с вашего баланса API, в консоли можно поставить лимит трат. Без ключа работает бесплатное распознавание прямо на телефоне."));
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
  const sc = el("div", "set-sec"); sc.append(el("h3", null, "Валюта"));
  const curF = el("div", "f");
  const curSel = el("select"); curSel.id = "currency";
  Object.entries(CURRENCIES).forEach(([code, symbol]) => { const o = el("option", null, symbol + "  " + code); o.value = code; if (code === currencyCode()) o.selected = true; curSel.append(o); });
  curSel.onchange = () => { LS.set("currency", curSel.value); render(); toast("Валюта: " + curSel.value); };
  curF.append(curSel);
  sc.append(curF, el("p", "small-print", "По умолчанию определяется по распознанным чекам."));
  sh.append(sc);

  /* data */
  const sd = el("div", "set-sec"); sd.append(el("h3", null, "Мои данные"));
  sd.append(el("p", "small-print", "Все чеки и фото хранятся только на этом телефоне. Сохраняйте копию, чтобы не потерять их при смене телефона или очистке браузера."));
  const bd = el("div", "btns");
  bd.append(button("Сохранить копию", "small", exportData), button("Восстановить из копии", "small ghost", () => { $("#importInput").value = ""; $("#importInput").click(); }), button("Фото из галереи", "small ghost", () => { closeSheet(); pickPhoto(true); }));
  sd.append(bd);
  sh.append(sd);
  sh.append(el("p", "small-print", "Версия " + appVersion()));
}

async function doInstall() {
  if (!installEvent) return;
  installEvent.prompt();
  try { await installEvent.userChoice; } catch (_) {}
  installEvent = null; render();
}

async function exportData() {
  const all = await store.allReceipts();
  const data = { app: "receipt-spending", version: 1, exportedAt: new Date().toISOString(), receipts: all };
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
    toast("Восстановлено записей: " + n); closeSheet(); reload();
  } catch (_) { toast("Этот файл не похож на копию приложения."); }
};

/* ---------- install & offline ---------- */
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvent = e; render(); });
window.addEventListener("appinstalled", () => { installEvent = null; toast("Приложение установлено"); render(); });
if (!isNative() && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}

reload();
