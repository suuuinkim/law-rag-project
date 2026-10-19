// Local copies of uploaded PDFs, keyed by the backend's document_id.
//
// The backend keeps the original file on disk but exposes no endpoint to read
// it back, so the viewer can only show PDFs this browser uploaded (or that the
// user re-attached). Falls back to memory when IndexedDB is unavailable.

const DB_NAME = "lawlens";
const STORE = "pdfs";
const memory = new Map();

let dbPromise = null;

function openDb() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: "documentId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function run(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) {
          resolve(undefined);
          return;
        }
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export async function getAllRecords() {
  try {
    const rows = await run("readonly", (store) => store.getAll());
    if (rows) {
      return rows;
    }
  } catch {
    // fall through to memory
  }
  return [...memory.values()];
}

export async function putRecord(record) {
  memory.set(record.documentId, record);
  try {
    await run("readwrite", (store) => store.put(record));
  } catch {
    // memory copy is enough for this session
  }
  return record;
}

export async function deleteRecord(documentId) {
  memory.delete(documentId);
  try {
    await run("readwrite", (store) => store.delete(documentId));
  } catch {
    // ignore
  }
}
