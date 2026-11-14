import { apiGet, apiPost } from './request';
import type { PaginatedResponse } from '@shared/api.interface';

// ============================================================================
// PDA 专用 API 模块
// 说明：尽量复用现有 api 模块函数，此处仅做 PDA 场景的薄封装与新端点补充。
// 后端响应存在两种形态：
//   1) 直接返回业务数据（如 /api/inventory/list 返回 {items,total,...}）
//   2) 包装在 {code,message,data} 中
// 因此对新端点使用 unwrap() 做兼容解包。
// ============================================================================

// ---- 复用现有模块函数 ----
export {
  getActiveWarehouses,
  verifyLocationCode,
  verifyQr,
  batchReceipt,
  getReceiptList,
  getReceiptDetail,
} from './receipt';
export type { VerifyQrResult } from './receipt';

export {
  getInventoryList,
  intraTransfer,
  verifySourceLocation,
  verifyTargetLocation,
  batchIntraTransfer,
  getExpiryInventory,
  extendExpiry,
  submitExpiryReinspection,
  transferStock,
  getTransferList,
} from './inventory';
export type { ExpiryInventoryItem, ScannedMoveItem } from './inventory';

export {
  getPickingOrderList,
  getPickingOrderByNo,
  pickMaterial,
  receivePicking,
  getSupplementList,
} from './workorder';

export { getMyTasks, getMrbDetail, finalApprove, submitReview } from './mrb';

export { login } from './system';

// ---- 工具：兼容解包 {code,message,data} 与裸数据 ----
function unwrap<T>(res: any): T {
  if (res && typeof res === 'object' && 'data' in res && 'code' in res) {
    return res.data as T;
  }
  return res as T;
}

// ---- PDA 待办统计 ----
export interface PdaTasks {
  pendingReceipt: number;
  pendingIqc: number;
  pendingPicking: number;
  pendingMrb: number;
  expiryWarning: number;
  expiryExpired: number;
}

export async function getPdaTasks(): Promise<PdaTasks> {
  const res = await apiGet<any>('/api/dashboard/pda-tasks');
  const data = unwrap<Partial<PdaTasks>>(res);
  return {
    pendingReceipt: data?.pendingReceipt ?? 0,
    pendingIqc: data?.pendingIqc ?? 0,
    pendingPicking: data?.pendingPicking ?? 0,
    pendingMrb: data?.pendingMrb ?? 0,
    expiryWarning: data?.expiryWarning ?? 0,
    expiryExpired: data?.expiryExpired ?? 0,
  };
}

// ---- 盘点调整（后端并行开发中）----
export async function adjustInventory(data: {
  inventoryId: string;
  actualQty: number;
  reason: string;
}): Promise<any> {
  const res = await apiPost<any>('/api/inventory/adjust', data);
  return unwrap<any>(res);
}

// ---- 通用列表分页查询库存（PDA 库存查询/盘点用）----
export async function queryInventory(params: {
  materialCode?: string;
  locationCode?: string;
  batchNo?: string;
  warehouseId?: string;
  stockStatus?: string;
}): Promise<PaginatedResponse<any>> {
  const res = await apiGet<PaginatedResponse<any> & { data?: PaginatedResponse<any> }>(
    '/api/inventory/list',
    params,
  );
  return unwrap<PaginatedResponse<any>>(res);
}
