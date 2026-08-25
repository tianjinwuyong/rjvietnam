import type { StationQueryFilters, StationQueryRow } from './station-query';

/** Single MES read source consumed by Web, PDA, and station Agent adapters. */
export async function fetchStationQuery(baseUrl: string, filters: StationQueryFilters = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/mes/station-query?${params}`, { signal });
  if (!response.ok) throw new Error(`MES station query failed: ${response.status}`);
  return await response.json() as { source: 'MES'; rows: StationQueryRow[]; generatedAt: string };
}
