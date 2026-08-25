// ── Scan engine — core decision logic for scanner-station ────────────────────

import { db } from './db';
import { getUpstreamCheck, postStationEvent } from './mesApi';

export type ScanOutcome =
  | { outcome: 'PASS'; source: 'cleared' | 'local_sn_record' | 'upstream_ok'; synced: boolean }
  | { outcome: 'NG'; source: 'local_ng_pool' | 'upstream_block'; synced: boolean }
  | { outcome: 'DUP'; source: 'local_dup_pool' | 'local_sn_record'; synced: boolean }
  | { outcome: 'BLOCKED'; reason: string };

export interface ScanContext {
  stationCode: string;
  lineName: string;
  operator: string;
  workOrderCode?: string;
}

/** Normalize scanner framing without changing the identifier alphabet. */
export function normalizeScannedSerial(sn: string): string {
  return sn.trim().toUpperCase();
}

/** Main entry point for processing a scanned SN */
export async function processScan(
  sn: string,
  ctx: ScanContext,
): Promise<ScanOutcome> {
  const normalized = normalizeScannedSerial(sn);
  if (!normalized) return { outcome: 'BLOCKED', reason: 'empty_sn' };

  // 1. Check local NG pool
  const ngMatch = await db.ngPool.where('sn').equals(normalized).first();
  if (ngMatch) {
    return { outcome: 'NG', source: 'local_ng_pool', synced: ngMatch.synced };
  }

  // 2. Check local DUP pool
  const dupMatch = await db.dupPool.where('sn').equals(normalized).first();
  if (dupMatch) {
    return { outcome: 'DUP', source: 'local_dup_pool', synced: dupMatch.synced };
  }

  // 3. Check local SN records (already processed this SN)
  const snMatch = await db.snRecords.where('sn').equals(normalized).first();
  if (snMatch) {
    return { outcome: 'DUP', source: 'local_sn_record', synced: snMatch.synced };
  }

  // 4. Call MES upstream-check
  let upstreamCheck: Awaited<ReturnType<typeof getUpstreamCheck>> | null = null;
  let upstreamError = false;
  try {
    upstreamCheck = await getUpstreamCheck(normalized, ctx.stationCode);
  } catch {
    upstreamError = true;
  }

  if (!upstreamError && upstreamCheck) {
    // BLOCK_NG — upstream fail found
    if (upstreamCheck.verdict === 'BLOCK_NG') {
      // A scanner observation is a guard check only. It must never create a
      // local NG/SN fact; production sources and MES own those records.
      return { outcome: 'NG', source: 'upstream_block', synced: true };
    }

    // mustRepair — board must go to repair before more retests
    // Allow FAIL to pass through (for recording), but PASS will be blocked later
    if (upstreamCheck.mustRepair) {
      // Just record it — the UI will handle blocking PASS
    }
  }

  // 5. Fail closed. An unavailable MES cannot prove that an SN is clean,
  // duplicate-free and in the correct route position.
  if (upstreamError || !upstreamCheck) {
    return { outcome: 'BLOCKED', reason: 'mes_guard_unavailable' };
  }

  // Scanner PASS is an observation only: no snRecords, NG pool or sync queue.
  return { outcome: 'PASS', source: 'upstream_ok', synced: true };
}

/** Record FAIL/NG result */
export async function recordScanFail(
  sn: string,
  defectCode: string,
  defectDescription: string,
  ctx: ScanContext,
): Promise<void> {
  const normalized = normalizeScannedSerial(sn);
  const now = new Date().toISOString();

  // Local record
  await db.ngPool.add({
    sn: normalized,
    result: 'NG',
    time: now,
    source: 'scanner',
    station: ctx.stationCode,
    lineName: ctx.lineName,
    operator: ctx.operator,
    synced: false,
  });

  // Queue sync
  await db.syncQueue.add({
    action: 'add_ng',
    payload: {
      stationCode: ctx.stationCode,
      pcbSerial: normalized,
      result: 'fail',
      eventType: 'output',
      defectCode,
      defectDescription,
      operator: ctx.operator,
      workOrderCode: ctx.workOrderCode,
    },
    createdAt: now,
    retries: 0,
  });

  // Try immediate sync if online
  try {
    await postStationEvent({
      stationCode: ctx.stationCode,
      pcbSerial: normalized,
      result: 'fail',
      eventType: 'output',
      defectCode,
      defectDescription,
      operator: ctx.operator,
    });
    // Mark as synced
    await db.ngPool.where('sn').equals(normalized).modify({ synced: true });
    const queueItems = await db.syncQueue
      .where('action')
      .equals('add_ng')
      .filter((i) => (i.payload as Record<string, unknown>).pcbSerial === normalized)
      .toArray();
    for (const item of queueItems) {
      if (item.id) await db.syncQueue.delete(item.id);
    }
  } catch {
    // offline — stays in queue
  }
}
