// ── Background sync manager — drains sync queue to MES API ───────────────────

import { db } from './db';
import { postStationEvent, checkApiOnline, postHeartbeat } from './mesApi';

const SYNC_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;

let syncTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let isOnline = false;

// Heartbeat context — mutable refs so we can update without restarting the timer
const heartbeatCtx = { station: '', operator: '', line: '' };

export function setHeartbeatContext(stationCode: string, operator?: string, lineCode?: string) {
  heartbeatCtx.station = stationCode;
  heartbeatCtx.operator = operator ?? '';
  heartbeatCtx.line = lineCode ?? '';
}
type OfflineCallback = () => void;
const offlineCallbacks: OfflineCallback[] = [];

export function onOffline(cb: OfflineCallback): void {
  offlineCallbacks.push(cb);
}

async function processAlertRetryQueue(): Promise<void> {
  const now = new Date().toISOString();
  const due = await db.alertRetryQueue.where('nextRetryAt').belowOrEqual(now).toArray();
  for (const item of due) {
    try {
      await postStationEvent({
        stationCode: item.stationCode,
        pcbSerial: item.recordSn,
        result: 'NG',
        eventType: 'ALERT',
        defectCode: item.alertRuleId,
        defectDescription: `Alert retry #${item.attempts}: ${item.expression}`,
      });
      await db.alertRetryQueue.delete(item.id!);
    } catch {
      const delayMs = Math.min(Math.pow(2, item.attempts) * 30_000, MAX_BACKOFF_MS);
      await db.alertRetryQueue.update(item.id!, {
        attempts: item.attempts + 1,
        nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
        lastError: 'MES alert upload failed; retained for retry',
      });
    }
  }
}

async function sendHeartbeat(): Promise<void> {
  if (!heartbeatCtx.station) return;
  try {
    await postHeartbeat(
      heartbeatCtx.station,
      heartbeatCtx.operator || undefined,
      heartbeatCtx.line || undefined,
    );
  } catch {
    // heartbeat failures are non-fatal
  }
}

export function startSyncManager(onStatusChange?: (online: boolean, pendingCount: number) => void) {
  // Send first heartbeat immediately on start
  sendHeartbeat();

  heartbeatTimer = setInterval(() => {
    if (isOnline) sendHeartbeat();
  }, HEARTBEAT_INTERVAL_MS);

  async function tick() {
    const wasOnline = isOnline;
    isOnline = await checkApiOnline();
    if (isOnline !== wasOnline) {
      if (!isOnline) {
        for (const cb of offlineCallbacks) cb();
      }
      onStatusChange?.(isOnline, await db.syncQueue.count());
    }
    if (!isOnline) return;

    // Process alert retry queue
    await processAlertRetryQueue();

    const pending = await db.syncQueue.orderBy('createdAt').toArray();
    for (const item of pending) {
      if (item.nextRetryAt && item.nextRetryAt > new Date().toISOString()) continue;
      try {
        await postStationEvent(item.payload as unknown as Parameters<typeof postStationEvent>[0]);
        if (item.id) await db.syncQueue.delete(item.id);
        const sn = (item.payload as Record<string, unknown>).pcbSerial as string;
        if (sn) {
          if (item.action === 'add_sn') {
            await db.snRecords.where('sn').equals(sn).modify({ synced: true });
          } else if (item.action === 'add_ng') {
            await db.ngPool.where('sn').equals(sn).modify({ synced: true });
          }
        }
      } catch (error) {
        const retries = item.retries + 1;
        const delayMs = Math.min(Math.pow(2, Math.min(retries, 8)) * 5_000, MAX_BACKOFF_MS);
        await db.syncQueue.update(item.id!, {
          retries,
          nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
          lastError: error instanceof Error ? error.message : 'MES upload failed; retained for retry',
        });
      }
    }
    onStatusChange?.(isOnline, await db.syncQueue.count());
  }

  syncTimer = setInterval(tick, SYNC_INTERVAL_MS);
  tick();
}

export function stopSyncManager() {
  if (syncTimer !== null) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export async function getSyncStatus() {
  const pending = await db.syncQueue.count();
  return { isOnline, pending };
}
