import { translate } from '../../i18n';
import { extractApiError } from '../../utils/apiError';

/**
 * 从 axios 错误中提取可读信息。
 * 统一走后端 `{ error: { code, message } }` 结构的取值链，
 * 避免只读 data.message 而回落到 "Request failed with status code 500"。
 */
export function errMsg(err: any, fallback = translate('ui.操作失败')): string {
  return extractApiError(err, fallback).message;
}

/** 解析 6 段来料二维码：供应商|物料|生产日期|数量|批号|序列号 */
export interface ParsedQr {
  supplierCode: string;
  materialCode: string;
  productionDate: string;
  quantity: number;
  batchNo: string;
  serialNo: string;
  raw: string;
}

export function parseQr(raw: string): ParsedQr | null {
  const parts = raw.split('|');
  if (parts.length < 6) return null;
  const [supplierCode, materialCode, productionDate, qtyStr, batchNo, serialNo] = parts;
  const quantity = Number(qtyStr);
  if (!materialCode || Number.isNaN(quantity)) return null;
  return {
    supplierCode: (supplierCode || '').trim(),
    materialCode: materialCode.trim(),
    productionDate: (productionDate || '').trim(),
    quantity,
    batchNo: (batchNo || '').trim(),
    serialNo: (serialNo || '').trim(),
    raw,
  };
}
