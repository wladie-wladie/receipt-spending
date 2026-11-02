// "Экономия" tab: finds where money can be saved, using the operations, receipts and budget already in the app.
// Everything is computed on the phone; Claude is asked only on an explicit tap.

const DAY = 86400000;
const pad = n => String(n).padStart(2, "0");
const isoDay = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const daysAgo = n => isoDay(new Date(Date.now() - n * DAY));
const toDate = s => new Date(s + "T12:00:00");
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function nice(v) { if (v <= 0) return 0; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

const DELIVERY = /(wolt|glovo|bolt food|яндекс еда|yandex eats|delivery club|deliveroo|uber eats|самокат|доставк|delivery)/i;
const COFFEE = /(coffee|кофе|кофей|starbucks|costa|espresso|латте|капучино)/i;

/* ---------- analysis ---------- */
/**
 * c: context from the app — { records, mainAmt, inMain, rKind, rDate, rName, spendCat, norm, fxFactor, timeOf }
 */
export function analyse(c) {
  const exp = c.records.filter(r => c.rKind(r) === "expense" && c.inMain(r));
  const inc = c.records.filter(r => c.rKind(r) === "income" && c.inMain(r));
  const since = d => exp.filter(r => c.rDate(r) >= d);
  const last30 = since(daysAgo(30)), last90 = since(daysAgo(90));
  const sum = list => list.reduce((s, r) => s + c.mainAmt(r), 0);
  const out = { hasData: exp.length > 0, days: exp.length ? Math.round((Date.now() - toDate(exp.map(c.rDate).sort()[0])) / DAY) + 1 : 0 };

  /* recurring payments (subscriptions, rent, phone…) */
  const groups = {};
  since(daysAgo(150)).forEach(r => { const k = c.norm(c.rName(r)); if (k) (groups[k] = groups[k] || []).push(r); });
  out.recurring = [];
  const NOT_RECURRING = ["Продукты", "Кафе и рестораны", "Транспорт", "Переводы"];
  Object.entries(groups).forEach(([k, list]) => {
    if (list.length < 2 || NOT_RECURRING.includes(c.spendCat(list[0]))) return;
    const amounts = list.map(c.mainAmt), med = median(amounts);
    if (!med) return;
    const same = list.filter(r => Math.abs(c.mainAmt(r) - med) / med <= 0.15).sort((a, b) => c.rDate(a).localeCompare(c.rDate(b)));
    const months = new Set(same.map(r => c.rDate(r).slice(0, 7)));
    if (same.length < 2 || months.size < 2) return;
    const gaps = [];
    for (let i = 1; i < same.length; i++) gaps.push((toDate(c.rDate(same[i])) - toDate(c.rDate(same[i - 1]))) / DAY);
    const gap = median(gaps);
    let period = null;
    if (gap >= 25 && gap <= 35) period = "month";
    else if (gap >= 6 && gap <= 8) period = "week";
    else if (c.spendCat(same[0]) === "Связь и подписки" && gaps.every(g => g >= 20)) period = "month";
    if (!period) return;
    const last = c.rDate(same[same.length - 1]);
    const perMonth = period === "week" ? med * 4.33 : med;
    const next = new Date(toDate(last).getTime() + (period === "week" ? 7 : Math.round(gap)) * DAY);
    if ((Date.now() - toDate(last)) / DAY > (period === "week" ? 21 : 50)) return; // looks stopped
    out.recurring.push({ key: k, name: c.rName(same[same.length - 1]), amount: med, period, perMonth, perYear: perMonth * 12, last, next: isoDay(next), cat: c.spendCat(same[0]), count: same.length });
  });
  out.recurring.sort((a, b) => b.perYear - a.perYear);

  /* small purchases that add up */
  const amounts90 = last90.map(c.mainAmt).filter(v => v > 0);
  out.smallLimit = nice(Math.max(1, median(amounts90)));
  const small = last30.filter(r => c.mainAmt(r) <= out.smallLimit && c.spendCat(r) !== "Продукты" && c.spendCat(r) !== "Жильё и коммунальные");
  const byPlace = {};
  small.forEach(r => { const k = c.norm(c.rName(r)) || c.rName(r); const o = byPlace[k] = byPlace[k] || { name: c.rName(r), sum: 0, count: 0 }; o.sum += c.mainAmt(r); o.count++; });
  out.small = { count: small.length, sum: sum(small), perYear: sum(small) * 365 / 30, top: Object.values(byPlace).sort((a, b) => b.sum - a.sum).slice(0, 3), share: sum(last30) ? sum(small) / sum(last30) : 0 };

  /* impulsive spending */
  const timed = last30.filter(r => c.timeOf(r));
  const late = timed.filter(r => { const h = parseInt(c.timeOf(r).slice(0, 2), 10); return h >= 22 || h < 5; });
  const delivery = last30.filter(r => DELIVERY.test(c.rName(r)) || DELIVERY.test(r.raw || ""));
  const paydays = inc.filter(r => c.mainAmt(r) >= Math.max(1, sum(last30) * 0.3)).map(c.rDate);
  let afterPay = null;
  if (paydays.length && last90.length) {
    const inWindow = r => paydays.some(p => { const d = (toDate(c.rDate(r)) - toDate(p)) / DAY; return d >= 0 && d <= 2; });
    const w = last90.filter(inWindow), days = paydays.filter(p => p >= daysAgo(90)).length * 3;
    const avgDay = sum(last90) / 90;
    if (days && avgDay) afterPay = { perDay: sum(w) / days, avgDay, ratio: (sum(w) / days) / avgDay };
  }
  out.impulse = { late: { count: late.length, sum: sum(late) }, delivery: { count: delivery.length, sum: sum(delivery) }, afterPay, timedShare: last30.length ? timed.length / last30.length : 0 };

  /* product prices: where cheaper, what got more expensive */
  const lines = [];
  exp.filter(r => c.rDate(r) >= daysAgo(120)).forEach(r => {
    const f = c.fxFactor(r), store = (r.store || r.merchant || "").trim();
    (r.items || []).forEach(i => {
      if (!i.generic || !(i.unitPrice > 0) || !(i.price > 0)) return;
      lines.push({ g: i.generic, store, unit: i.unitPrice * f, per: i.unitPer, paid: i.price * f, amount: i.price / i.unitPrice, date: c.rDate(r) });
    });
  });
  out.itemLines = lines.length;
  const byG = {};
  lines.forEach(l => (byG[l.g] = byG[l.g] || []).push(l));
  out.cheaper = [];
  out.rises = [];
  Object.entries(byG).forEach(([g, ls]) => {
    const stores = {};
    ls.forEach(l => { if (l.store) (stores[l.store] = stores[l.store] || []).push(l.unit); });
    const names = Object.keys(stores);
    if (names.length >= 2) {
      const meds = names.map(s => ({ s, p: median(stores[s]) })).sort((a, b) => a.p - b.p);
      const paid = ls.reduce((a, l) => a + l.paid, 0), amount = ls.reduce((a, l) => a + l.amount, 0);
      const avgUnit = paid / amount, best = meds[0];
      const recent = ls.filter(l => l.date >= daysAgo(60));
      const monthlyAmount = recent.reduce((a, l) => a + l.amount, 0) / 2;
      const save = (avgUnit - best.p) * monthlyAmount;
      if (best.p < avgUnit * 0.95 && save > 0) out.cheaper.push({ g, per: ls[0].per, best: best.s, bestPrice: best.p, avgUnit, diff: 1 - best.p / avgUnit, perMonth: save, stores: meds });
    }
    // Compare within the same store, so a switch to a cheaper shop does not hide a price rise.
    const cut = daysAgo(30), ratios = [];
    let was = 0, nowP = 0;
    names.concat(names.length ? [] : [""]).forEach(st => {
      const own = ls.filter(l => (l.store || "") === st);
      const b = own.filter(l => l.date < cut).map(l => l.unit), n = own.filter(l => l.date >= cut).map(l => l.unit);
      if (b.length && n.length && median(b) > 0) { ratios.push(median(n) / median(b)); was = median(b); nowP = median(n); }
    });
    if (ratios.length) {
      const r = median(ratios);
      if (r >= 1.1) out.rises.push({ g, per: ls[0].per, was, now: nowP, rise: r - 1 });
    }
  });
  out.cheaper.sort((a, b) => b.perMonth - a.perMonth);
  out.rises.sort((a, b) => b.rise - a.rise);

  /* eating out vs cooking at home */
  const cafe = last30.filter(r => c.spendCat(r) === "Кафе и рестораны"), groc = last30.filter(r => c.spendCat(r) === "Продукты");
  if (cafe.length) {
    const avgCheck = sum(cafe) / cafe.length;
    const homeMeal = groc.length ? sum(groc) / (30 * 2.5) : null;
    out.cafe = { count: cafe.length, sum: sum(cafe), avgCheck, homeMeal, save8: homeMeal != null ? Math.max(0, 8 * (avgCheck - homeMeal)) : null, delivery: sum(cafe.filter(r => DELIVERY.test(c.rName(r)))) };
  }

  /* food basket for Claude */
  const items = {};
  exp.filter(r => c.rDate(r) >= daysAgo(30)).forEach(r => {
    const f = c.fxFactor(r);
    (r.items || []).forEach(i => {
      const k = (i.generic || i.name || "").toLowerCase(); if (!k || k === "скидка") return;
      const o = items[k] = items[k] || { name: i.generic || i.name, type: i.type || "", tags: new Set(), sum: 0, count: 0 };
      (i.tags || []).forEach(t => o.tags.add(t)); o.sum += (Number(i.price) || 0) * f; o.count++;
    });
  });
  out.basket = Object.values(items).sort((a, b) => b.sum - a.sum).slice(0, 70).map(o => ({ name: o.name, type: o.type, tags: [...o.tags], sum: Math.round(o.sum * 100) / 100, count: o.count }));
  out.food30 = { groceries: sum(groc), cafe: sum(cafe) };
  return out;
}

/* ---------- challenges ---------- */
export const CHALLENGES = [
  { id: "delivery", title: "Неделя без доставки еды", hint: "Ни одного заказа в Wolt, Glovo и подобных", match: (c, r) => DELIVERY.test(c.rName(r)) || DELIVERY.test(r.raw || "") },
  { id: "coffee", title: "Кофе дома", hint: "Без покупок в кофейнях", match: (c, r) => COFFEE.test(c.rName(r)) },
  { id: "small", title: "Без мелких покупок", hint: "Ничего дешевле порога мелких трат, кроме продуктов", match: (c, r, a) => c.mainAmt(r) <= a.smallLimit && c.spendCat(r) !== "Продукты" },
  { id: "cafe", title: "Неделя без кафе", hint: "Едим дома, кафе и рестораны — пауза", match: (c, r) => c.spendCat(r) === "Кафе и рестораны" },
];
export function challengeProgress(c, a, ch) {
  const def = CHALLENGES.find(x => x.id === ch.id); if (!def) return null;
  const exp = c.records.filter(r => c.rKind(r) === "expense" && c.inMain(r));
  const start = ch.start, end = isoDay(new Date(toDate(start).getTime() + 6 * DAY));
  const afterStart = r => c.rDate(r) > start || (c.rDate(r) === start && (!ch.at || !r.createdAt || new Date(r.createdAt).getTime() >= ch.at));
  const fails = exp.filter(r => afterStart(r) && c.rDate(r) <= end && def.match(c, r, a));
  const base = exp.filter(r => c.rDate(r) < start && c.rDate(r) >= isoDay(new Date(toDate(start).getTime() - 28 * DAY)) && def.match(c, r, a));
  const baseWeek = base.reduce((s, r) => s + c.mainAmt(r), 0) / 4;
  const elapsed = Math.min(7, Math.max(1, Math.round((Date.now() - toDate(start)) / DAY) + 1));
  const spent = fails.reduce((s, r) => s + c.mainAmt(r), 0);
  return { def, fails, spent, saved: Math.max(0, baseWeek * elapsed / 7 - spent), baseWeek, elapsed, done: isoDay(new Date()) > end, end };
}
