/** Shared read-only query contract for station Agents, MES Web, and PDA apps. */
export type StationQueryRow = Record<string, unknown>;

export type StationQueryFilters = {
  sn?: string; station?: string; status?: string; workOrder?: string;
  boxQr?: string; shipmentId?: string; query?: string;
};

const value = (row: StationQueryRow, key: string, aliases: string[] = []) => {
  const found = row[key] ?? aliases.map((alias) => row[alias]).find((item) => item !== undefined);
  return String(found ?? '').toLowerCase();
};

export function queryStationRows(rows: StationQueryRow[], filters: StationQueryFilters = {}) {
  const match = (row: StationQueryRow, wanted: string | undefined, key: string, aliases: string[] = []) =>
    !wanted?.trim() || value(row, key, aliases).includes(wanted.trim().toLowerCase());
  return rows
    .filter((row) => match(row, filters.sn, 'sn', ['ng_sn']))
    .filter((row) => match(row, filters.station, 'station', ['station_code', 'source_station']))
    .filter((row) => match(row, filters.status, 'status', ['state', 'result']))
    .filter((row) => match(row, filters.workOrder, 'workOrder', ['work_order_no', 'repair_work_order_no']))
    .filter((row) => match(row, filters.boxQr, 'boxQr', ['bucket_qr', 'station_qr']))
    .filter((row) => match(row, filters.shipmentId, 'shipmentId', ['shipment_id', 'shipment']))
    .filter((row) => !filters.query || JSON.stringify(row).toLowerCase().includes(filters.query.toLowerCase()))
    .sort((a, b) => String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? '')));
}

export const queryHistory = (rows: StationQueryRow[], filters?: StationQueryFilters) => queryStationRows(rows, filters);
export const queryNg = (rows: StationQueryRow[], filters: StationQueryFilters = {}) =>
  queryStationRows(rows, {...filters, status: filters.status?.trim() || 'NG'});
export const queryStations = (rows: StationQueryRow[], filters?: StationQueryFilters) =>
  queryStationRows(rows.filter((row) => (row.record_type ?? 'station') === 'station'), filters);
export const queryInProcess = (rows: StationQueryRow[], filters?: StationQueryFilters) =>
  queryStationRows(rows.filter((row) => ['IN_PROCESS', 'WIP', 'REPAIR_RECEIVED', 'WAITING_RETEST'].includes(String(row.status ?? row.state).toUpperCase())), filters);
