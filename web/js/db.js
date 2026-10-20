// Local storage on the device: receipts and their photos live in IndexedDB.
const DB_NAME = "receipt-spending";
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("receipts")) db.createObjectStore("receipts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const allReceipts = () => tx("receipts", "readonly", s => s.getAll()).then(r => r || []);
export const getReceipt = id => tx("receipts", "readonly", s => s.get(id));
export const putReceipt = r => tx("receipts", "readwrite", s => s.put(r));
export const deleteReceipt = id => tx("receipts", "readwrite", s => s.delete(id));

export const putPhoto = (id, blob) => tx("photos", "readwrite", s => s.put({ id, blob }));
export const getPhoto = id => tx("photos", "readonly", s => s.get(id)).then(r => r ? r.blob : null);
export const deletePhoto = id => tx("photos", "readwrite", s => s.delete(id));

export async function updateReceipt(id, patch) {
  const r = await getReceipt(id);
  if (!r) return null;
  const next = Object.assign({}, r, patch, { updatedAt: new Date().toISOString() });
  await putReceipt(next);
  return next;
}

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (_) {}
  return false;
}
