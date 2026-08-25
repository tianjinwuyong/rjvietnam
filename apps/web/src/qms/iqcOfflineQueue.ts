/**
 * IQC Offline Queue Service
 * Handles offline inspection data queuing and sync for PDA devices.
 */

const QUEUE_KEY = "iqc_offline_queue";
const DB_NAME = "iqc_pda_db";
const STORE_NAME = "pending_inspections";

interface QueuedInspection {
  id: string;
  type: "inspection" | "defect" | "spc_measurement";
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function enqueueIqcInspection(payload: Record<string, unknown>): string {
  const queue = getQueue();
  const item: QueuedInspection = {
    id: generateId(),
    type: "inspection",
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  };
  queue.push(item);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  storeInIDB(item).catch(() => {});
  return item.id;
}

export function getQueue(): QueuedInspection[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch { return []; }
}

export function getQueueCount(): number { return getQueue().length; }

export function removeFromQueue(id: string): void {
  const queue = getQueue().filter(item => item.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  removeFromIDB(id).catch(() => {});
}

export function clearQueue(): void {
  localStorage.setItem(QUEUE_KEY, "[]");
  clearIDB().catch(() => {});
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeInIDB(item: QueuedInspection): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function removeFromIDB(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clearIDB(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function syncItem(item: QueuedInspection): Promise<boolean> {
  const endpoints: Record<string, string> = {
    inspection: "/api/qms/iqc/inspections",
    defect: "/api/qms/iqc/inspections/0/defects",
    spc_measurement: "/api/qms/iqc/sPc/data",
  };
  const token = localStorage.getItem("token");
  if (!token) return false;
  try {
    const resp = await fetch(endpoints[item.type], {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(item.payload),
    });
    if (resp.ok) { removeFromQueue(item.id); return true; }
    item.lastError = `HTTP ${resp.status}`;
    item.retryCount++;
  } catch (err) {
    item.lastError = String(err);
    item.retryCount++;
  }
  const queue = getQueue();
  const idx = queue.findIndex(q => q.id === item.id);
  if (idx >= 0) queue[idx] = item;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return false;
}

export async function processQueue(onProgress?: (done: number, total: number) => void): Promise<number> {
  const queue = getQueue();
  let success = 0;
  for (const item of queue) {
    if (item.retryCount >= 5) continue;
    const ok = await syncItem(item);
    if (ok) success++;
    if (onProgress) onProgress(success, queue.length);
  }
  return success;
}

export function useIqcOnlineStatus(callback: (online: boolean) => void): () => void {
  const handler = () => callback(navigator.onLine);
  window.addEventListener("online", handler);
  window.addEventListener("offline", handler);
  handler();
  return () => { window.removeEventListener("online", handler); window.removeEventListener("offline", handler); };
}

export function getOnlineStatus(): boolean { return navigator.onLine; }

let syncInterval: ReturnType<typeof setInterval> | null = null;
export function startAutoSync(intervalMs = 30000): void {
  stopAutoSync();
  syncInterval = setInterval(async () => {
    if (!navigator.onLine) return;
    const count = getQueueCount();
    if (count === 0) return;
    await processQueue();
  }, intervalMs);
}
export function stopAutoSync(): void {
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}
