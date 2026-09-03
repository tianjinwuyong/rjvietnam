const normalized = value => String(value || '').trim().toUpperCase();
const includesAny = (value, terms) => terms.some(term => normalized(value).includes(term));

export function evaluatePutawayLocation(location, goods) {
  const rejected = [];
  const reasons = [];
  const qty = Math.max(0, Number(goods.qty || 0));
  const capacity = Number(location.capacityQty || 0);
  const occupied = Math.max(0, Number(location.occupiedQty || 0));
  const pallets = Math.max(0, Number(location.occupiedPallets || 0));
  const zoneType = normalized(location.zoneType);
  const iqcStatus = normalized(goods.iqcStatus);

  if (normalized(location.status) !== 'ACTIVE') rejected.push('LOCATION_INACTIVE');
  if (normalized(location.warehouseStatus) !== 'ACTIVE') rejected.push('WAREHOUSE_INACTIVE');
  if (normalized(location.zoneStatus) !== 'ACTIVE') rejected.push('ZONE_INACTIVE');
  if (location.allowPutaway === false) rejected.push('PUTAWAY_NOT_ALLOWED');
  if (location.lockedReason) rejected.push('LOCATION_LOCKED');
  if (capacity > 0 && occupied + qty > capacity) rejected.push('CAPACITY_EXCEEDED');
  if (Number(location.maxPallets || 0) > 0 && pallets + Number(goods.palletCount || 1) > Number(location.maxPallets)) rejected.push('PALLET_CAPACITY_EXCEEDED');
  if (goods.weightKg != null && location.maxWeightKg != null && Number(goods.weightKg) > Number(location.maxWeightKg)) rejected.push('WEIGHT_CAPACITY_EXCEEDED');
  if (goods.msdLevel && normalized(goods.msdLevel) !== 'N/A' && location.msdAllowed === false) rejected.push('MSD_NOT_ALLOWED');

  const length = Number(goods.lengthCm || 0), width = Number(goods.widthCm || 0), height = Number(goods.heightCm || 0);
  const locLength = Number(location.lengthCm || 0), locWidth = Number(location.widthCm || 0), locHeight = Number(location.heightCm || 0);
  if (length && width && locLength && locWidth && !((length <= locLength && width <= locWidth) || (length <= locWidth && width <= locLength))) rejected.push('FOOTPRINT_EXCEEDED');
  if (height && locHeight && height > locHeight) rejected.push('HEIGHT_EXCEEDED');
  const volumeM3 = length && width && height ? (length * width * height) / 1_000_000 : 0;
  if (volumeM3 && Number(location.maxVolumeM3 || 0) > 0 && volumeM3 > Number(location.maxVolumeM3)) rejected.push('VOLUME_CAPACITY_EXCEEDED');

  const temperature = goods.temperature == null ? null : Number(goods.temperature);
  const humidity = goods.humidity == null ? null : Number(goods.humidity);
  if (temperature != null && ((location.temperatureMin != null && temperature < Number(location.temperatureMin)) || (location.temperatureMax != null && temperature > Number(location.temperatureMax)))) rejected.push('TEMPERATURE_OUT_OF_RANGE');
  if (humidity != null && ((location.humidityMin != null && humidity < Number(location.humidityMin)) || (location.humidityMax != null && humidity > Number(location.humidityMax)))) rejected.push('HUMIDITY_OUT_OF_RANGE');

  const quarantineZone = includesAny(zoneType, ['IQC', 'HOLD', 'QUARANTINE', 'REJECT', 'DEFECT']);
  if (['PENDING', 'HOLD'].includes(iqcStatus) && !includesAny(zoneType, ['IQC', 'HOLD', 'RECEIV'])) rejected.push('IQC_HOLD_ZONE_REQUIRED');
  if (['REJECTED', 'FAIL'].includes(iqcStatus) && !includesAny(zoneType, ['QUARANTINE', 'REJECT', 'DEFECT', 'NG'])) rejected.push('QUARANTINE_ZONE_REQUIRED');
  if (iqcStatus === 'RELEASED' && quarantineZone) rejected.push('RELEASED_GOODS_CANNOT_USE_HOLD_ZONE');

  if (rejected.length) return { eligible: false, score: 0, rejected, reasons };

  let score = 50;
  if (Number(location.sameMaterialLots || 0) > 0) { score += 20; reasons.push('SAME_MATERIAL_CONSOLIDATION'); }
  if (['PENDING', 'HOLD'].includes(iqcStatus)) { score += 20; reasons.push('IQC_FLOW_MATCH'); }
  else if (iqcStatus === 'RELEASED' && !quarantineZone) { score += 15; reasons.push('RELEASED_STORAGE_MATCH'); }
  if (goods.msdLevel && normalized(goods.msdLevel) !== 'N/A' && location.msdAllowed !== false) { score += 10; reasons.push('MSD_STORAGE_MATCH'); }
  if (capacity > 0) {
    const utilization = (occupied + qty) / capacity;
    if (utilization >= 0.35 && utilization <= 0.85) { score += 10; reasons.push('BALANCED_CAPACITY_USE'); }
    else if (utilization > 0.9) { score -= 10; reasons.push('NEAR_CAPACITY_LIMIT'); }
  }
  if (location.zoneStorageMatch) { score += 10; reasons.push('MATERIAL_STORAGE_CONDITION_MATCH'); }
  if (Number.isFinite(Number(location.routeDistance))) { score += Math.max(0, 10 - Math.min(10, Number(location.routeDistance) / 10)); reasons.push('SHORT_SAFE_PATH'); }
  return { eligible: true, score: Math.max(0, Math.min(100, score)), rejected, reasons };
}

export function rankPutawayLocations(locations, goods, limit = 5) {
  return locations.map(location => ({ ...location, ...evaluatePutawayLocation(location, goods) }))
    .filter(location => location.eligible)
    .sort((a, b) => b.score - a.score || Number(a.utilization || 0) - Number(b.utilization || 0) || String(a.code).localeCompare(String(b.code)))
    .slice(0, Math.max(1, Math.min(20, Number(limit || 5))));
}

export const PUTAWAY_RULES = Object.freeze([
  { order: 1, id: 'STATUS_AND_PERMISSION', type: 'HARD', rule: 'Warehouse, zone and location must be active, unlocked and allow put-away.' },
  { order: 2, id: 'QUALITY_SEGREGATION', type: 'HARD', rule: 'Pending/Hold goods stay in IQC or receiving Hold; rejected goods stay in quarantine; released goods cannot enter Hold.' },
  { order: 3, id: 'MSD_AND_ENVIRONMENT', type: 'HARD', rule: 'MSD permission and configured temperature/humidity limits must match the goods.' },
  { order: 4, id: 'CAPACITY_AND_DIMENSIONS', type: 'HARD', rule: 'Quantity, pallet count, weight, volume and pallet dimensions must fit the location.' },
  { order: 5, id: 'TRACEABILITY', type: 'HARD', rule: 'Lot, pallet and location QR must be scanned before placement is confirmed.' },
  { order: 6, id: 'CONSOLIDATION', type: 'SCORE', rule: 'Prefer a compliant location already holding the same material.' },
  { order: 7, id: 'BALANCED_UTILIZATION', type: 'SCORE', rule: 'Prefer 35%-85% projected utilization and avoid nearly full locations.' },
  { order: 8, id: 'SHORTEST_SAFE_PATH', type: 'SCORE', rule: 'Among equally safe locations, prefer the shortest configured route from receiving.' },
]);

export function buildPutawayPath(location, source = {}) {
  const steps = [
    { type: 'START', code: source.code || 'RECEIVING_STAGING', instructionKey: 'wms.putawayPath.start' },
    location.warehouseCode && { type: 'WAREHOUSE', code: location.warehouseCode, instructionKey: 'wms.putawayPath.warehouse' },
    location.zoneCode && { type: 'ZONE', code: location.zoneCode, instructionKey: 'wms.putawayPath.zone' },
    location.aisleCode && { type: 'AISLE', code: location.aisleCode, instructionKey: 'wms.putawayPath.aisle' },
    location.crossAisleCode && { type: 'CROSS_AISLE', code: location.crossAisleCode, instructionKey: 'wms.putawayPath.crossAisle' },
    location.rackCode && { type: 'RACK', code: location.rackCode, instructionKey: 'wms.putawayPath.rack' },
    location.levelCode && { type: 'LEVEL', code: location.levelCode, instructionKey: 'wms.putawayPath.level' },
    { type: 'BIN', code: location.binCode || location.code, instructionKey: 'wms.putawayPath.bin' },
    { type: 'SCAN_CONFIRM', code: location.code, instructionKey: 'wms.putawayPath.scanConfirm' },
  ].filter(Boolean);
  const rawCoordinates = [source.xCoord, source.yCoord, location.xCoord, location.yCoord];
  const hasCoordinates = rawCoordinates.every(value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
  const [sx, sy, dx, dy] = rawCoordinates.map(Number);
  return {
    mode: hasCoordinates ? 'COORDINATE_GUIDED' : 'HIERARCHY_GUIDED',
    steps,
    destination: { code: location.code, aisleSide: location.aisleSide ?? null, accessDirection: location.accessDirection ?? null, xCoord: location.xCoord ?? null, yCoord: location.yCoord ?? null },
    estimatedDistance: hasCoordinates ? Number(Math.hypot(dx - sx, dy - sy).toFixed(2)) : null,
    warning: hasCoordinates ? 'WAREHOUSE_ROUTE_GRAPH_NOT_CONFIGURED' : 'LOCATION_COORDINATES_NOT_CONFIGURED',
  };
}
