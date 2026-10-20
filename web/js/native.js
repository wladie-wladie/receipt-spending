// Native (Android APK) integration: camera, sharing files, self-updates.
// In the browser version all of this is skipped and the web fallbacks are used.
import { APP_VERSION } from "./version.js";

const UPDATE_MANIFEST = "https://wladie-wladie.github.io/receipt-spending/update.json";
const cap = () => window.Capacitor;
export const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());

const plugins = {};
function plugin(name) {
  if (!plugins[name]) plugins[name] = cap().registerPlugin(name);
  return plugins[name];
}

/* ---------- camera ---------- */
// Returns a Blob, or null when the user cancels.
export async function takePhoto(fromGallery) {
  try {
    const photo = await plugin("Camera").getPhoto({
      source: fromGallery ? "PHOTOS" : "CAMERA",
      resultType: "uri",
      quality: 85,
      correctOrientation: true,
      saveToGallery: false,
    });
    const res = await fetch(photo.webPath);
    return await res.blob();
  } catch (e) {
    const msg = String((e && e.message) || e || "");
    if (/cancel/i.test(msg)) return null;
    throw e;
  }
}

/* ---------- export a file through the system share sheet ---------- */
export async function shareTextFile(fileName, text) {
  const fs = plugin("Filesystem");
  const written = await fs.writeFile({ path: fileName, data: text, directory: "CACHE", encoding: "utf8" });
  await plugin("Share").share({ title: fileName, files: [written.uri], dialogTitle: "Сохранить копию" });
}

/* ---------- self-updates ---------- */
const cmpVersion = (a, b) => {
  const pa = String(a).split(".").map(n => parseInt(n, 10) || 0), pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
};

let readyBundle = null;
let checking = null;
let onReady = null;
const status = { state: "idle", detail: "", at: null };
const setStatus = (state, detail) => { status.state = state; status.detail = detail || ""; status.at = new Date(); };

export const appVersion = () => APP_VERSION;
export const updateStatus = () => Object.assign({}, status, { ready: !!readyBundle });

async function check() {
  if (readyBundle) { setStatus("ready", readyBundle.version); return status; }
  if (checking) return checking;
  checking = (async () => {
    setStatus("checking");
    try {
      const updater = plugin("CapacitorUpdater");
      let info;
      try {
        const res = await fetch(UPDATE_MANIFEST + "?t=" + Date.now(), { cache: "no-store" });
        if (!res.ok) { setStatus("error", "Сервер обновлений ответил " + res.status); return status; }
        info = await res.json();
      } catch (e) { setStatus("error", "Нет связи с сервером обновлений (" + ((e && e.message) || e) + ")"); return status; }
      if (!info || !info.version || !info.url) { setStatus("error", "Непонятный ответ сервера обновлений"); return status; }
      if (cmpVersion(info.version, APP_VERSION) <= 0) { setStatus("latest", info.version); return status; }
      setStatus("downloading", info.version);
      let bundle = null;
      try {
        const list = await updater.list();
        bundle = (list.bundles || []).find(b => b.version === info.version && b.status !== "error") || null;
      } catch (_) {}
      if (!bundle) bundle = await updater.download({ url: info.url, version: info.version });
      await updater.next({ id: bundle.id });
      readyBundle = bundle;
      setStatus("ready", info.version);
      onReady && onReady(info);
    } catch (e) {
      setStatus("error", "Не удалось скачать обновление (" + ((e && e.message) || e) + ")");
    } finally { checking = null; }
    return status;
  })();
  return checking;
}
export const checkForUpdates = () => (isNative() ? check() : Promise.resolve(Object.assign(status, { state: "web" })));

export async function initUpdates(onUpdateReady) {
  if (!isNative()) return;
  onReady = onUpdateReady;
  // Tell the updater this version started fine; otherwise it rolls back to the previous one.
  try { await plugin("CapacitorUpdater").notifyAppReady(); } catch (e) { setStatus("error", "Модуль обновлений не отвечает (" + ((e && e.message) || e) + ")"); }
  check();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
}

export async function applyUpdateNow() {
  if (!readyBundle) return;
  await plugin("CapacitorUpdater").set({ id: readyBundle.id });
}
