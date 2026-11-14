import { apiGet, apiPost } from './request';

export interface StockTakeOrder {
  id: string;
  takeNo: string;
  periodMonth: string;
  takeType: string;
  scope: string;
  /** 子单归属的主盘点单 */
  parentId?: string;
  /** standalone=单张盘点单 / main=主盘点单（只汇总） / sub=子盘点单（按库位范围） */
  orderType?: 'standalone' | 'main' | 'sub' | string;
  /** 子单范围 */
  scopeArea?: string;
  scopeShelf?: string;
  scopeLayer?: string;
  scopeLocFrom?: string;
  scopeLocTo?: string;
  childCount?: number;
  /** 主单详情返回的子单列表 */
  children?: StockTakeOrder[];
  /** 盘点所属仓库（按仓库代码建立盘点清单） */
  warehouseId?: string;
  warehouseCode?: string;
  warehouseName?: string;
  status: string;
  title?: string;
  operatorName?: string;
  approverName?: string;
  approvalTime?: string;
  approvalRemark?: string;
  submitTime?: string;
  unlockAuthorizedName?: string;
  unlockAuthorizedAt?: string;
  unlockReason?: string;
  revisionCount: number;
  totalLines: number;
  checkedLines: number;
  matchLines: number;
  profitLines: number;
  lossLines: number;
  bookQtyTotal: number;
  actualQtyTotal: number;
  diffQtyTotal: number;
  remark?: string;
  createdAt?: string;
}

export interface ScannedLabel {
  labelNo: string;
  materialCode?: string;
  batchNo?: string;
  qty: number;
  scanTime: string;
  operatorName?: string;
  manual?: boolean;
}

export interface StockTakeItem {
  id: string;
  takeId: string;
  inventoryId?: string;
  materialId?: string;
  materialCode: string;
  materialName?: string;
  specification?: string;
  unit: string;
  supplierId?: string;
  supplierCode?: string;
  supplierName?: string;
  locationId?: string;
  locationCode?: string;
  warehouseCode?: string;
  warehouseName?: string;
  stockStatus: string;
  batchNo?: string;
  labelNo?: string;
  productionDate?: string;
  bookQty: number;
  actualQty: number;
  diffQty: number;
  diffType: string;
  scannedLabels: ScannedLabel[];
  scanCount: number;
  checked: boolean;
  /** 主盘点单汇总视图里该行所属的子单号 */
  childTakeNo?: string;
  remark?: string;
}

export interface StockTakeListResult {
  items: StockTakeOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StockTakeItemsResult {
  items: StockTakeItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ScanResult {
  success: boolean;
  isProfit?: boolean;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
  item?: StockTakeItem;
  parsed?: {
    supplierCode?: string;
    materialCode?: string;
    productionDate?: string;
    quantity?: number;
    batchNo?: string;
    serialNo?: string;
  };
}

export interface StockTakeReport {
  order: StockTakeOrder;
  byWarehouse: Array<{
    stockStatus: string;
    warehouseCode?: string;
    warehouseName?: string;
    lines: number;
    profitLines: number;
    lossLines: number;
    bookQty: number;
    actualQty: number;
    diffQty: number;
  }>;
  bySupplier: Array<{
    supplierCode?: string;
    supplierName?: string;
    lines: number;
    profitLines: number;
    lossLines: number;
    bookQty: number;
    actualQty: number;
    diffQty: number;
  }>;
  diffItems: StockTakeItem[];
}

export interface StockTakeLog {
  id: string;
  action: string;
  detail?: string;
  operatorName?: string;
  createdAt?: string;
}

// 后端统一包裹 { code, message, data }，此处解包
const unwrap = <T,>(res: any): T => (res && res.data !== undefined ? res.data : res);

/** 全部仓库（每个仓库各建一单） */
export const ALL_WAREHOUSES = '__all__';

/** 可选仓库（新建盘点单时按仓库代码选择） */
export interface StockTakeWarehouseOption {
  id: string;
  code: string;
  name: string;
  whType: string;
  /** 仓库状态：active / inactive —— 查询筛选放开停用，新建盘点单只用 active */
  status?: string;
  stockLines: number;
  goodLines: number;
  defectiveLines: number;
  reworkLines: number;
  isGoodWarehouse: boolean;
  isDefectiveWarehouse: boolean;
}

/** 建单结果：可同时为多个仓库各建一单 */
export interface CreateStockTakeResult {
  orders: StockTakeOrder[];
  skipped: Array<{ warehouseCode: string; warehouseName: string; reason: string }>;
}

export async function getStockTakeWarehouseOptions(): Promise<StockTakeWarehouseOption[]> {
  return unwrap<StockTakeWarehouseOption[]>(await apiGet('/api/stock-take/warehouses'));
}

export async function createStockTake(data: {
  scope?: string;
  /** 仓库代码；传 __all__ 表示按仓库各建一单 */
  warehouseCode?: string;
  periodMonth?: string;
  takeType?: string;
  title?: string;
  remark?: string;
  /** standalone=单张盘点单；main=主盘点单（按区域/地址码拆子单） */
  orderType?: 'standalone' | 'main';
}): Promise<CreateStockTakeResult> {
  return unwrap<CreateStockTakeResult>(await apiPost('/api/stock-take', data));
}

/** 子盘点单范围预览：该范围会生成多少行、覆盖多少库位 */
export async function previewSubStockTakeScope(params: {
  warehouseCode?: string;
  warehouseId?: string;
  scope?: string;
  areaCode?: string;
  shelfCode?: string;
  layerCode?: string;
  locationFrom?: string;
  locationTo?: string;
}): Promise<{ lines: number; locations: number; bookQty: number; locationSamples: string[] }> {
  return unwrap(await apiGet('/api/stock-take/sub-scope/preview', params));
}

/** 在主盘点单下创建子盘点单 */
export async function createSubStockTake(parentId: string, data: {
  areaCode?: string;
  shelfCode?: string;
  layerCode?: string;
  locationFrom?: string;
  locationTo?: string;
  title?: string;
  remark?: string;
}): Promise<StockTakeOrder> {
  return unwrap<StockTakeOrder>(await apiPost(`/api/stock-take/${parentId}/sub-order`, data));
}

/** 主盘点单确认盈亏（子单全部提交后） */
export async function confirmStockTakeResult(id: string, remark?: string): Promise<StockTakeOrder> {
  return unwrap<StockTakeOrder>(await apiPost(`/api/stock-take/${id}/confirm-result`, { remark }));
}

export async function getStockTakeList(params: {
  page?: number;
  pageSize?: number;
  takeNo?: string;
  status?: string;
  periodMonth?: string;
  warehouseCode?: string;
}): Promise<StockTakeListResult> {
  return unwrap<StockTakeListResult>(await apiGet('/api/stock-take/list', params));
}

export async function getStockTakeDetail(id: string): Promise<StockTakeOrder> {
  return unwrap<StockTakeOrder>(await apiGet(`/api/stock-take/detail/${id}`));
}

export async function getStockTakeItems(id: string, params: {
  page?: number;
  pageSize?: number;
  materialCode?: string;
  materialName?: string;
  supplier?: string;
  diffType?: string;
  stockStatus?: string;
  locationCode?: string;
  batchNo?: string;
  onlyDiff?: string;
}): Promise<StockTakeItemsResult> {
  return unwrap<StockTakeItemsResult>(await apiGet(`/api/stock-take/${id}/items`, params));
}

export async function scanStockTakeLabel(id: string, qrContent: string, locationCode?: string): Promise<ScanResult> {
  return unwrap<ScanResult>(await apiPost(`/api/stock-take/${id}/scan`, { qrContent, locationCode }));
}

export async function adjustStockTakeItem(id: string, itemId: string, actualQty: number, remark?: string): Promise<StockTakeItem> {
  return unwrap<StockTakeItem>(await apiPost(`/api/stock-take/${id}/item/${itemId}/adjust`, { actualQty, remark }));
}

export async function confirmStockTakeItem(id: string, itemId: string, remark?: string): Promise<StockTakeItem> {
  return unwrap<StockTakeItem>(await apiPost(`/api/stock-take/${id}/item/${itemId}/confirm`, { remark }));
}

export async function submitStockTake(id: string, remark?: string): Promise<StockTakeOrder> {
  return unwrap<StockTakeOrder>(await apiPost(`/api/stock-take/${id}/submit`, { remark }));
}

export async function approveStockTake(id: string, pass: boolean, approvalRemark?: string): Promise<StockTakeOrder> {
  return unwrap<StockTakeOrder>(await apiPost(`/api/stock-take/${id}/approve`, { pass, approvalRemark }));
}

export async function unlockStockTake(id: string, reason: string): Promise<StockTakeOrder> {
  return unwrap<StockTakeOrder>(await apiPost(`/api/stock-take/${id}/unlock`, { reason }));
}

export async function cancelStockTake(id: string): Promise<StockTakeOrder> {
  return unwrap<StockTakeOrder>(await apiPost(`/api/stock-take/${id}/cancel`, {}));
}

export async function deleteStockTake(id: string): Promise<{ deleted: boolean; takeNo?: string }> {
  return unwrap<{ deleted: boolean; takeNo?: string }>(await apiPost(`/api/stock-take/${id}/delete`, {}));
}

export async function getStockTakeReport(id: string): Promise<StockTakeReport> {
  return unwrap<StockTakeReport>(await apiGet(`/api/stock-take/${id}/report`));
}

export async function getStockTakeLogs(id: string): Promise<StockTakeLog[]> {
  return unwrap<StockTakeLog[]>(await apiGet(`/api/stock-take/${id}/logs`));
}
