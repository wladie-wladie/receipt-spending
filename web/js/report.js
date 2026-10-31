// Monthly report: numbers for a month and a shareable picture of them.

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_P = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const MONTHS_D = ["январю", "февралю", "марту", "апрелю", "маю", "июню", "июлю", "августу", "сентябрю", "октябрю", "ноябрю", "декабрю"];
export const monthName = m => MONTHS[m];
export const monthIn = m => MONTHS_P[m];
const pad = n => String(n).padStart(2, "0");
const FOOD = ["Продукты", "Кафе и рестораны"];

/**
 * h: helpers from the app — { spendCat, rTotal, rKind, rName, rCur, rDate, norm, currency, symbol }
 * Only operations in the main currency are counted.
 */
export function buildReport(records, y, m, h) {
  const key = y + "-" + pad(m + 1);
  const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1;
  const pkey = py + "-" + pad(pm + 1);
  const mainCur = r => h.rCur(r) === h.currency;
  const inM = (r, k) => h.rDate(r).slice(0, 7) === k;
  const exp = records.filter(r => inM(r, key) && h.rKind(r) === "expense" && mainCur(r));
  const prev = records.filter(r => inM(r, pkey) && h.rKind(r) === "expense" && mainCur(r));
  const inc = records.filter(r => inM(r, key) && h.rKind(r) === "income" && mainCur(r));
  const sum = list => list.reduce((s, r) => s + h.rTotal(r), 0);
  const byCat = list => { const o = {}; list.forEach(r => { const c = h.spendCat(r); o[c] = (o[c] || 0) + h.rTotal(r); }); return o; };

  const total = sum(exp), prevTotal = sum(prev), income = sum(inc);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const now = new Date();
  const isCurrent = now.getFullYear() === y && now.getMonth() === m;
  const daysCounted = isCurrent ? now.getDate() : daysInMonth;

  const cats = byCat(exp), prevCats = byCat(prev);
  const days = Array.from({ length: daysInMonth }, () => 0);
  exp.forEach(r => { const d = parseInt(h.rDate(r).slice(8, 10), 10); if (d >= 1 && d <= daysInMonth) days[d - 1] += h.rTotal(r); });

  const places = {};
  exp.forEach(r => { const k = h.norm(h.rName(r)) || h.rName(r); const o = places[k] = places[k] || { name: h.rName(r), sum: 0, count: 0 }; o.sum += h.rTotal(r); o.count++; });
  const topPlaces = Object.values(places).sort((a, b) => b.sum - a.sum).slice(0, 5);

  const biggest = exp.slice().sort((a, b) => h.rTotal(b) - h.rTotal(a))[0] || null;

  const items = {};
  exp.forEach(r => { const f = h.factor ? h.factor(r) : 1; (r.items || []).forEach(i => {
    const k = String(i.generic || i.name || "").trim().toLowerCase();
    if (!k || k === "скидка" || !(Number(i.price) > 0)) return;
    const o = items[k] = items[k] || { name: i.generic || i.name, sum: 0, count: 0 };
    o.sum += Number(i.price) * f; o.count++;
  }); });
  const topItems = Object.values(items).sort((a, b) => b.sum - a.sum).slice(0, 3);

  // A few plain-language observations.
  const notes = [];
  if (prevTotal > 0 && total > 0) {
    const d = (total - prevTotal) / prevTotal;
    if (Math.abs(d) >= 0.03) notes.push({ tone: d < 0 ? "good" : "bad", text: "Потрачено на " + Math.round(Math.abs(d) * 100) + "% " + (d < 0 ? "меньше" : "больше") + ", чем в " + MONTHS_P[pm] + " (" + h.fmt(prevTotal) + ")." });
    else notes.push({ tone: "plain", text: "Почти столько же, сколько в " + MONTHS_P[pm] + "." });
    const changes = Object.keys({ ...cats, ...prevCats })
      .map(c => ({ c, now: cats[c] || 0, was: prevCats[c] || 0 }))
      .filter(x => x.was > 0 && Math.abs(x.now - x.was) >= Math.max(total * 0.04, 1) && Math.abs(x.now - x.was) / x.was >= 0.15)
      .sort((a, b) => Math.abs(b.now - b.was) - Math.abs(a.now - a.was));
    const up = changes.find(x => x.now > x.was), down = changes.find(x => x.now < x.was);
    if (up) notes.push({ tone: "bad", text: "«" + up.c + "» выросли на " + Math.round((up.now - up.was) / up.was * 100) + "%: +" + h.fmt(up.now - up.was) + "." });
    if (down) notes.push({ tone: "good", text: "«" + down.c + "» снизились на " + Math.round((down.was - down.now) / down.was * 100) + "%: −" + h.fmt(down.was - down.now) + "." });
  } else if (total > 0) {
    notes.push({ tone: "plain", text: "Первый месяц учёта. Со следующего отчёта появится сравнение с прошлым месяцем." });
  }
  const food = (cats["Продукты"] || 0) + (cats["Кафе и рестораны"] || 0);
  if (total > 0 && food > 0 && notes.length < 3) {
    const out = cats["Кафе и рестораны"] || 0;
    notes.push({ tone: "plain", text: "На еду ушло " + Math.round(food / total * 100) + "% трат" + (out > 0 ? ", из них " + Math.round(out / food * 100) + "% — кафе и рестораны." : ".") });
  }

  return {
    key, y, m, monthTitle: MONTHS[m] + " " + y, prevName: MONTHS_D[pm], total, prevTotal, income, count: exp.length,
    perDay: daysCounted ? total / daysCounted : 0, isCurrent, cats, days, topPlaces, biggest, topItems, notes,
  };
}

/* ---------- drawing ---------- */
const C = {
  band: "#1D6B57", bandInk: "#FFFFFF", bandSoft: "rgba(255,255,255,.72)", paper: "#FFFFFF", ground: "#EEF2F0",
  ink: "#15201C", muted: "#5B6A64", line: "#D7DFDB", soft: "#DDEDE7", accent: "#1D6B57", accent2: "#C98A2B",
  good: "#1D6B57", bad: "#B3261E", goodSoft: "#DDEDE7", badSoft: "#F6DEDC",
};
const DISPLAY = '"Unbounded", "Golos Text", system-ui, sans-serif';
const BODY = '"Golos Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

async function fontsReady() {
  if (!document.fonts || !document.fonts.load) return;
  const wait = Promise.all([
    document.fonts.load("700 100px Unbounded"), document.fonts.load("500 40px Unbounded"),
    document.fonts.load("400 36px 'Golos Text'"), document.fonts.load("600 36px 'Golos Text'"), document.fonts.load("600 32px 'JetBrains Mono'"),
  ]).catch(() => {});
  await Promise.race([wait, new Promise(r => setTimeout(r, 2500))]);
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
function wrap(ctx, text, maxW) {
  const words = String(text).split(" "); const lines = []; let line = "";
  words.forEach(w => { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
  if (line) lines.push(line);
  return lines;
}

/** Draws the report and resolves with a canvas (1080 px wide). */
export async function drawReport(R, h) {
  await fontsReady();
  const W = 1080, P = 72, IW = W - P * 2;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = 4200;
  const ctx = cv.getContext("2d");
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.ground; ctx.fillRect(0, 0, W, cv.height);

  /* header band with a torn-receipt edge */
  const bandH = 560;
  ctx.fillStyle = C.band;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, bandH);
  const tooth = 36; for (let x = W; x > 0; x -= tooth) { ctx.lineTo(x - tooth / 2, bandH - 18); ctx.lineTo(x - tooth, bandH); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.bandSoft; ctx.font = "600 30px " + BODY;
  ctx.fillText(("Отчёт за месяц").toUpperCase().split("").join(String.fromCharCode(8202)), P, 112);
  ctx.fillStyle = C.bandInk; ctx.font = "500 56px " + DISPLAY; ctx.fillText(R.monthTitle, P, 190);
  ctx.font = "700 118px " + DISPLAY;
  const totalText = h.money(R.total);
  ctx.fillText(totalText, P, 340);
  const tw = ctx.measureText(totalText).width;
  ctx.font = "500 64px " + DISPLAY; ctx.fillStyle = C.bandSoft; ctx.fillText(h.symbol, P + tw + 18, 340);
  ctx.font = "400 34px " + BODY; ctx.fillStyle = C.bandSoft;
  ctx.fillText(R.count + " " + h.plural(R.count, "трата", "траты", "трат") + "  ·  " + h.fmt(R.perDay) + " в день" + (R.isCurrent ? " (месяц ещё идёт)" : ""), P, 404);
  if (R.prevTotal > 0) {
    const d = (R.total - R.prevTotal) / R.prevTotal;
    const label = (d < 0 ? "▼ " : "▲ ") + Math.round(Math.abs(d) * 100) + "% к " + R.prevName;
    ctx.font = "600 32px " + BODY; const lw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(255,255,255,.16)"; roundRect(ctx, P, 438, lw + 48, 60, 30); ctx.fill();
    ctx.fillStyle = C.bandInk; ctx.fillText(label, P + 24, 479);
  }
  let y = bandH + 56;

  const card = (height, draw) => {
    ctx.fillStyle = C.paper; roundRect(ctx, P - 24, y, IW + 48, height, 28); ctx.fill();
    draw(y); y += height + 32;
  };
  const heading = (text, top) => { ctx.fillStyle = C.ink; ctx.font = "600 38px " + BODY; ctx.fillText(text, P + 12, top + 70); };

  /* observations */
  if (R.notes.length) {
    ctx.font = "400 34px " + BODY;
    const blocks = R.notes.map(n => ({ n, lines: wrap(ctx, n.text, IW - 80) }));
    const height = 100 + blocks.reduce((s, b) => s + b.lines.length * 46 + 26, 0);
    card(height, top => {
      heading("Главное", top);
      let ly = top + 128;
      blocks.forEach(({ n, lines }) => {
        ctx.fillStyle = n.tone === "good" ? C.good : n.tone === "bad" ? C.bad : C.muted;
        ctx.beginPath(); ctx.arc(P + 22, ly - 11, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.ink; ctx.font = "400 34px " + BODY;
        lines.forEach((l, i) => ctx.fillText(l, P + 52, ly + i * 46));
        ly += lines.length * 46 + 26;
      });
    });
  }

  /* categories, food as one two-colour bar */
  const entries = Object.entries(R.cats).filter(([k, v]) => v > 0.004 && !FOOD.includes(k)).map(([k, v]) => ({ k, v }));
  const foodParts = FOOD.map(k => [k, R.cats[k] || 0]).filter(([, v]) => v > 0.004);
  if (foodParts.length) entries.push({ k: foodParts.length > 1 ? "Еда" : foodParts[0][0], v: foodParts.reduce((a, [, v]) => a + v, 0), parts: foodParts.length > 1 ? foodParts : null });
  entries.sort((a, b) => b.v - a.v);
  let shown = entries.slice(0, 6);
  if (entries.length > 6) shown.push({ k: "Остальное", v: entries.slice(6).reduce((a, e) => a + e.v, 0) });
  if (shown.length) {
    const rowH = 104, height = 110 + shown.reduce((s, e) => s + rowH + (e.parts ? 44 : 0), 0);
    card(height, top => {
      heading("По категориям", top);
      let ry = top + 132;
      const max = Math.max(...shown.map(e => e.v));
      shown.forEach(e => {
        ctx.fillStyle = C.ink; ctx.font = "400 34px " + BODY; ctx.fillText(fitText(ctx, e.k, IW - 360), P + 12, ry);
        ctx.textAlign = "right";
        ctx.font = "400 26px " + BODY; ctx.fillStyle = C.muted; const pct = Math.round(e.v / (R.total || 1) * 100) + "%";
        ctx.fillText(pct, P + IW - 12, ry); const pw = ctx.measureText(pct).width;
        ctx.font = "600 32px " + MONO; ctx.fillStyle = C.ink; ctx.fillText(h.fmt(e.v), P + IW - 24 - pw, ry);
        ctx.textAlign = "left";
        const by = ry + 22, bw = IW - 24, bh = 18;
        ctx.fillStyle = C.soft; roundRect(ctx, P + 12, by, bw, bh, 9); ctx.fill();
        ctx.save(); roundRect(ctx, P + 12, by, Math.max(bh, bw * e.v / max), bh, 9); ctx.clip();
        if (e.parts) {
          let x = P + 12;
          e.parts.forEach(([, pv], i) => { const w = bw * pv / max; ctx.fillStyle = i ? C.accent2 : C.accent; ctx.fillRect(x, by, w, bh); x += w; });
        } else { ctx.fillStyle = C.accent; ctx.fillRect(P + 12, by, bw, bh); }
        ctx.restore();
        ry += rowH;
        if (e.parts) {
          let lx = P + 12; ctx.font = "400 26px " + BODY;
          e.parts.forEach(([name, pv], i) => {
            ctx.fillStyle = i ? C.accent2 : C.accent; roundRect(ctx, lx, ry - 50, 18, 18, 4); ctx.fill();
            ctx.fillStyle = C.muted; const t = name + " " + h.fmt(pv); ctx.fillText(t, lx + 28, ry - 34); lx += 28 + ctx.measureText(t).width + 36;
          });
          ry += 44;
        }
      });
    });
  }

  /* spending by day */
  if (R.total > 0) {
    card(420, top => {
      heading("По дням", top);
      const max = Math.max(...R.days), n = R.days.length;
      const cx = P + 12, cw = IW - 24, base = top + 350, chH = 210, gap = 6;
      const bw = (cw - gap * (n - 1)) / n;
      const peak = R.days.indexOf(max);
      ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, base + 1); ctx.lineTo(cx + cw, base + 1); ctx.stroke();
      R.days.forEach((v, i) => {
        const bh = max ? Math.max(v > 0 ? 6 : 0, v / max * chH) : 0;
        ctx.fillStyle = i === peak ? C.accent2 : C.accent;
        if (bh) { roundRect(ctx, cx + i * (bw + gap), base - bh, bw, bh, Math.min(6, bw / 2)); ctx.fill(); }
      });
      ctx.font = "400 24px " + BODY; ctx.fillStyle = C.muted;
      [1, 10, 20, n].forEach(d => { const x = cx + (d - 1) * (bw + gap) + bw / 2; ctx.textAlign = d === 1 ? "left" : d === n ? "right" : "center"; ctx.fillText(String(d), d === 1 ? cx : d === n ? cx + cw : x, base + 36); });
      if (max > 0) {
        const px = cx + peak * (bw + gap) + bw / 2, label = "Больше всего: " + (peak + 1) + " числа, " + h.fmt(max);
        ctx.font = "600 26px " + BODY; ctx.fillStyle = C.ink; ctx.textAlign = px > W / 2 ? "right" : "left";
        ctx.fillText(label, px > W / 2 ? Math.min(px + 20, cx + cw) : Math.max(px - 20, cx), top + 120);
      }
      ctx.textAlign = "left";
    });
  }

  /* places */
  if (R.topPlaces.length) {
    card(110 + R.topPlaces.length * 64, top => {
      heading("Где тратил больше всего", top);
      R.topPlaces.forEach((p, i) => {
        const ly = top + 136 + i * 64;
        ctx.fillStyle = C.muted; ctx.font = "600 28px " + MONO; ctx.fillText(String(i + 1), P + 12, ly);
        ctx.fillStyle = C.ink; ctx.font = "400 34px " + BODY; ctx.fillText(fitText(ctx, p.name + (p.count > 1 ? "  ×" + p.count : ""), IW - 340), P + 60, ly);
        ctx.textAlign = "right"; ctx.font = "600 32px " + MONO; ctx.fillText(h.fmt(p.sum), P + IW - 12, ly); ctx.textAlign = "left";
      });
    });
  }

  /* biggest purchase and income */
  const facts = [];
  if (R.biggest) facts.push(["Самая крупная трата", h.rName(R.biggest) + ", " + parseInt(h.rDate(R.biggest).slice(8, 10), 10) + " числа", h.fmt(h.rTotal(R.biggest))]);
  if (R.income > 0) facts.push(["Поступления", "Разница с тратами: " + (R.income - R.total >= 0 ? "+" : "−") + h.fmt(Math.abs(R.income - R.total)), h.fmt(R.income)]);
  if (R.topItems.length) facts.push(["Из продуктов дороже всего", R.topItems.map(i => i.name).join(", "), h.fmt(R.topItems.reduce((s, i) => s + i.sum, 0))]);
  facts.forEach(([title, text, amount]) => {
    card(200, top => {
      ctx.fillStyle = C.muted; ctx.font = "600 28px " + BODY; ctx.fillText(title, P + 12, top + 62);
      ctx.fillStyle = C.ink; ctx.font = "400 34px " + BODY; ctx.fillText(fitText(ctx, text, IW - 330), P + 12, top + 140);
      ctx.textAlign = "right"; ctx.font = "700 44px " + DISPLAY; ctx.fillText(amount, P + IW - 12, top + 140); ctx.textAlign = "left";
    });
  });

  /* footer */
  ctx.fillStyle = C.muted; ctx.font = "400 26px " + BODY; ctx.textAlign = "center";
  ctx.fillText("Сделано в приложении «Траты»", W / 2, y + 30); ctx.textAlign = "left";
  y += 72;

  const out = document.createElement("canvas"); out.width = W; out.height = Math.ceil(y);
  out.getContext("2d").drawImage(cv, 0, 0);
  return out;
}
