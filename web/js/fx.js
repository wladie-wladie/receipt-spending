// Exchange rates: converts operations in other currencies into the main one,
// at the rate of the operation's date. Free daily rates, no key needed.

const memo = new Map(); // "base|date" -> Promise<rates>

function urls(base, date) {
  const b = base.toLowerCase();
  const tag = date || "latest";
  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/${b}.min.json`,
    `https://${tag}.currency-api.pages.dev/v1/currencies/${b}.min.json`,
  ];
}

async function fetchRates(base, date) {
  for (const u of urls(base, date)) {
    try {
      const res = await fetch(u, { cache: "force-cache" });
      if (!res.ok) continue;
      const json = await res.json();
      const rates = json && json[base.toLowerCase()];
      if (rates && typeof rates === "object") return { rates, date: json.date || date };
    } catch (_) {}
  }
  return null;
}

/** Rates for 1 unit of `base` on `date` (YYYY-MM-DD); falls back to the latest published day. */
export function ratesFor(base, date) {
  const today = new Date().toISOString().slice(0, 10);
  const day = !date || date >= today ? null : date; // today's file may not be published yet
  const k = base + "|" + (day || "latest");
  if (!memo.has(k)) {
    memo.set(k, (async () => (day && await fetchRates(base, day)) || await fetchRates(base, null))());
    memo.get(k).then(r => { if (!r) memo.delete(k); });
  }
  return memo.get(k);
}

/**
 * Converts `amount` of `from` into `to`. Resolves { amount, rate, rateDate } where
 * rate = how many `to` for one `from`; or null when rates are unavailable (offline).
 */
export async function convert(amount, from, to, date) {
  if (!from || !to || from === to) return { amount, rate: 1, rateDate: date };
  const r = await ratesFor(to, date);
  const perTo = r && r.rates[from.toLowerCase()];
  if (!perTo || !(perTo > 0)) return null;
  const rate = 1 / perTo;
  return { amount: Math.round(amount * rate * 100) / 100, rate, rateDate: r.date };
}
