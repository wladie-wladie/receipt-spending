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
let checking = false;

export const appVersion = () => APP_VERSION;

export async function initUpdates(onUpdateReady) {
  if (!isNative()) return;
  const updater = plugin("CapacitorUpdater");
  // Tell the updater this version started fine; otherwise it rolls back to the previous one.
  try { await updater.notifyAppReady(); } catch (_) {}
  const check = async () => {
    if (checking || readyBundle) return;
    checking = true;
    try {
      const res = await fetch(UPDATE_MANIFEST + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      const info = await res.json();
      if (!info || !info.version || !info.url || cmpVersion(info.version, APP_VERSION) <= 0) return;
      let bundle = null;
      try {
        const list = await updater.list();
        bundle = (list.bundles || []).find(b => b.version === info.version && b.status !== "error") || null;
      } catch (_) {}
      if (!bundle) bundle = await updater.download({ url: info.url, version: info.version });
      await updater.next({ id: bundle.id }); // applies automatically next time the app is reopened
      readyBundle = bundle;
      onUpdateReady && onUpdateReady(info);
    } catch (_) {
      // No network or a broken download: try again next time.
    } finally { checking = false; }
  };
  check();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
}

export async function applyUpdateNow() {
  if (!readyBundle) return;
  await plugin("CapacitorUpdater").set({ id: readyBundle.id });
}
