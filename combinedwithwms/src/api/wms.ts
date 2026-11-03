import request from '@/utils/request';
import type { AxiosResponse } from 'axios';

/** WMS 健康检查返回结构 */
export interface WmsHealth {
  status: string;
  uptime?: number;
  timestamp?: string;
}

/** 库存概览（示例结构，按 WMS 实际接口调整） */
export interface InventorySummary {
  totalSkus: number;
  totalQty: number;
  pendingIqc: number;
}

/** 获取 WMS 服务健康状态 */
export async function getWmsHealth(): Promise<WmsHealth> {
  const res: AxiosResponse<WmsHealth> = await request.get('/api/health');
  return res.data;
}

/** 获取库存概览（示例接口，待 WMS 提供真实端点后替换） */
export async function getInventorySummary(): Promise<InventorySummary> {
  const res: AxiosResponse<InventorySummary> = await request.get(
    '/api/inventory/summary',
  );
  return res.data;
}
