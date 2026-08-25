import { apiClient } from './client';

export type StationQueryFilters = {
  sn?: string; station?: string; status?: string; workOrder?: string;
  boxQr?: string; shipmentId?: string; query?: string;
};

export type StationQueryResult = {
  source: 'MES'; rows: Record<string, unknown>[]; generatedAt: string;
};

/** One read source for MES Web; PDA and station adapters use the same endpoint. */
export const stationQueryApi = {
  query(filters: StationQueryFilters = {}) {
    return apiClient.get<StationQueryResult>('/mes/station-query', filters);
  },
};
