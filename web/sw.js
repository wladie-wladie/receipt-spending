// Offline support: the app shell is cached; API calls always go to the network.
const VERSION = "__APP_VERSION__";
const CACHE = "receipt-spending-" + VERSION;
const SHELL = ["./", "index.html", "styles.css", "js/app.js", "js/db.js", "js/recognize.js", "js/native.js", "js/version.js", "js/capacitor.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("receipt-spending-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname === "api.anthropic.com") return;
  if (url.origin === location.origin) {
    // Network first so updates arrive quickly; fall back to cache offline.
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    })));
  }
});
