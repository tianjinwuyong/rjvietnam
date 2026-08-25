// Q18: 离线暂存队列 — localStorage 持久化，联网自动上报
const QUEUE_KEY = 'hr_offline_queue';
const MAX_RETRIES = 3;

export type OfflineRequest = {
  id: string;          // unique local id
  type: 'leave' | 'swap';
  payload: any;
  createdAt: string;    // ISO timestamp
  retries: number;
};

export function enqueue(type: OfflineRequest['type'], payload: any): OfflineRequest {
  const queue = getQueue();
  const item: OfflineRequest = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2),
    type,
    payload,
    createdAt: new Date().toISOString(),
    retries: 0,
  };
  queue.push(item);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return item;
}

export function getQueue(): OfflineRequest[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch { return []; }
}

export function removeItem(id: string): void {
  const queue = getQueue().filter(i => i.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function updateItem(id: string, updates: Partial<OfflineRequest>): void {
  const queue = getQueue().map(i => i.id === id ? { ...i, ...updates } : i);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function processQueue(): Promise<{ success: number; failed: number }> {
  const queue = getQueue();
  let success = 0, failed = 0;

  for (const item of queue) {
    try {
      const endpoint = item.type === 'leave'
        ? '/api/hr/mobile/leave/submit'
        : '/api/hr/mobile/swap/submit';

      const formData = new FormData();
      for (const [k, v] of Object.entries(item.payload)) {
        if (v instanceof File) formData.append(k, v);
        else formData.append(k, String(v));
      }

      const r = await fetch(endpoint, { method: 'POST', body: formData });
      if (r.ok) {
        removeItem(item.id);
        success++;
      } else {
        throw new Error('HTTP ' + r.status);
      }
    } catch {
      const newRetries = item.retries + 1;
      if (newRetries >= MAX_RETRIES) {
        removeItem(item.id); // discard after max retries
        failed++;
      } else {
        updateItem(item.id, { retries: newRetries });
      }
    }
  }
  return { success, failed };
}

// ── useOnlineStatus hook ──────────────────────────────────────────────────────
import { useState, useEffect } from 'react';

export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return online;
}

// ── Auto-sync hook ────────────────────────────────────────────────────────────
export function useOfflineSync(onSyncComplete?: (res: { success: number; failed: number }) => void) {
  const online = useOnlineStatus();
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(getQueue().length);

  const sync = async () => {
    if (syncing || !navigator.onLine) return;
    const q = getQueue();
    if (q.length === 0) return;
    setSyncing(true);
    try {
      const res = await processQueue();
      setPendingCount(getQueue().length);
      onSyncComplete?.(res);
    } finally {
      setSyncing(false);
    }
  };

  // When coming back online, sync
  useEffect(() => {
    if (online) sync();
  }, [online]);

  // Periodic sync every 30s when online
  useEffect(() => {
    if (!online) return;
    const interval = setInterval(sync, 30000);
    return () => clearInterval(interval);
  }, [online, syncing]);

  const refreshCount = () => setPendingCount(getQueue().length);

  return { syncing, pendingCount, sync, refreshCount, online };
}
