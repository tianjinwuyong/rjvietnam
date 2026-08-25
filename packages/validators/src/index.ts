import { validateWorkOrderCode } from "../../business-rules/src/workOrderCoding";

export function isBarcodeScan(value: string): boolean {
  return /^[A-Z0-9._:-]{4,80}$/i.test(value.trim());
}

export function isBusinessCode(value: string): boolean {
  return /^[A-Z0-9._:/-]{3,80}$/i.test(value.trim());
}

export function assertBarcodeScan(value: string): void {
  if (!isBarcodeScan(value)) {
    throw new Error("Invalid barcode scan");
  }
}

export function assertBusinessCode(value: string): void {
  if (!isBusinessCode(value)) {
    throw new Error("Invalid business code");
  }
}

export function isCustomerPoNumber(value: string): boolean {
  return isBusinessCode(value);
}

export function assertCustomerPoNumber(value: string): void {
  if (!isCustomerPoNumber(value)) {
    throw new Error("Invalid customer PO number");
  }
}

export function assertWorkOrderCode(value: string): void {
  if (!validateWorkOrderCode(value)) {
    throw new Error("Invalid work order code");
  }
}

export function isMaterialLotNumber(value: string): boolean {
  return isBusinessCode(value);
}

export function assertMaterialLotNumber(value: string): void {
  if (!isMaterialLotNumber(value)) {
    throw new Error("Invalid material lot number");
  }
}

export function isPcbSerialNumber(value: string): boolean {
  return isBusinessCode(value);
}

export function assertPcbSerialNumber(value: string): void {
  if (!isPcbSerialNumber(value)) {
    throw new Error("Invalid PCB serial number");
  }
}

export function isStorageLocationCode(value: string): boolean {
  return isBusinessCode(value);
}

export function assertStorageLocationCode(value: string): void {
  if (!isStorageLocationCode(value)) {
    throw new Error("Invalid storage location code");
  }
}

export function isFeederCode(value: string): boolean {
  return isBusinessCode(value);
}

export function assertFeederCode(value: string): void {
  if (!isFeederCode(value)) {
    throw new Error("Invalid feeder code");
  }
}

export function isStationCode(value: string): boolean {
  return isBusinessCode(value);
}

export function assertStationCode(value: string): void {
  if (!isStationCode(value)) {
    throw new Error("Invalid station code");
  }
}

export function isUsername(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9._-]{2,79}$/i.test(value.trim());
}

export function isPassword(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 8 && trimmed.length <= 128;
}

export function isSessionToken(value: string): boolean {
  return /^[A-Z0-9._~-]{24,128}$/i.test(value.trim());
}

export function isPermissionKey(value: string): boolean {
  return /^[a-z]+(?:\.[a-z]+)+$/i.test(value.trim());
}
