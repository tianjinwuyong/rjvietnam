export const CANONICAL_LINES = Object.freeze({ MANUAL: 'L004', AUTO: 'L002', SMT: 'L001', PACK: 'PACK-LINE' });

const LINE_ALIASES = new Map([
  ['L004','L004'], ['MANUAL-LINE','L004'], ['004-MANUAL','L004'],
  ['L002','L002'], ['AUTO-LINE','L002'], ['002-AUTO','L002'],
  ['L001','L001'], ['SMT-LINE','L001'], ['001-SMT','L001'], ['PACK-LINE','PACK-LINE'],
]);

export const MANUAL_STATIONS = Object.freeze([
  { code:'manu_pda', nameZh:'PDA扫码上料', nameEn:'PDA Loading', nameVi:'Nạp liệu PDA', aliases:['PDA-01'] },
  { code:'manu_aio', nameZh:'AOI质量工位', nameEn:'AOI Quality', nameVi:'Kiểm tra AOI', aliases:['AOI-01','manu_aoi'] },
  { code:'manu_ict', nameZh:'ICT', nameEn:'ICT', nameVi:'ICT', aliases:['ICT-01','MAN-ICT-01'] },
  { code:'manu_fct', nameZh:'FCT', nameEn:'FCT', nameVi:'FCT', aliases:['FCT-01','MAN-FCT-01'] },
  { code:'manu_depanel', nameZh:'分板工位', nameEn:'Depanel', nameVi:'Tách bảng', aliases:['DEPANEL-01','MAN-DEPANEL-01'] },
  { code:'manu_shellbinding', nameZh:'PCBA外壳绑码', nameEn:'Shell Binding', nameVi:'Gán mã vỏ', aliases:['SHELL-BIND-01','manu_qr_binding'] },
  { code:'manu_assem_ate', nameZh:'组装ATE', nameEn:'Assembly ATE', nameVi:'ATE lắp ráp', aliases:['ASSY-ATE-01','ASM-ATE1-01','manu_assembly_ate'] },
  { code:'manu_supersonic', nameZh:'超声工位', nameEn:'Ultrasonic', nameVi:'Siêu âm', aliases:['ULTRA-01'] },
  { code:'manu_agingcab', nameZh:'成品老化', nameEn:'Aging', nameVi:'Lão hóa', aliases:['AGING-01','manu_aging'] },
  { code:'manu_hivolt_ate', nameZh:'高压ATE', nameEn:'High-voltage ATE', nameVi:'ATE cao áp', aliases:['HIPOT-01'] },
  { code:'manu_package_ate', nameZh:'包装ATE', nameEn:'Packaging ATE', nameVi:'ATE đóng gói', aliases:['PACK-ATE-01'] },
  { code:'manu_case_binding', nameZh:'外箱码绑定', nameEn:'Outer-box Binding', nameVi:'Gán mã thùng', aliases:['CARTON-BIND-01','manu_outer_box_binding'] },
  { code:'manu_pallet_binding', nameZh:'栈板绑码', nameEn:'Pallet Binding', nameVi:'Gán mã pallet', aliases:['PALLET-BIND-01'] },
  { code:'manu_rework', nameZh:'回修站', nameEn:'Maintenance / Rework', nameVi:'Trạm sửa chữa', aliases:['REWORK-01'] },
]);

export const AUTO_STATIONS = Object.freeze([
  { code:'auto_pda', nameZh:'PDA扫码上料', nameEn:'PDA Loading', nameVi:'Nạp liệu PDA', aliases:['PDA-01','AUTO-LOAD-01'] },
  { code:'auto_aio', nameZh:'AOI', nameEn:'AOI', nameVi:'AOI', aliases:['AOI-01','AUTO-AOI-01','auto_aoi'] },
  { code:'auto_ict', nameZh:'ICT', nameEn:'ICT', nameVi:'ICT', aliases:['ICT-01','AUTO-ICT-01'] },
  { code:'auto_fct', nameZh:'FCT', nameEn:'FCT', nameVi:'FCT', aliases:['FCT-01','AUTO-FCT-01'] },
  { code:'auto_depanel', nameZh:'分板工位', nameEn:'Depanel', nameVi:'Tách bảng', aliases:['DEPANEL-01','AUTO-PCBA-01'] },
  { code:'auto_shellbinding', nameZh:'PCBA外壳绑码', nameEn:'Shell Binding', nameVi:'Gán mã vỏ', aliases:['SHELL-BIND-01','AUTO-ASM-01'] },
  { code:'auto_assem_ate', nameZh:'组装ATE', nameEn:'Assembly ATE', nameVi:'ATE lắp ráp', aliases:['ASSY-ATE-01'] },
  { code:'auto_supersonic', nameZh:'超声工位', nameEn:'Ultrasonic', nameVi:'Siêu âm', aliases:['ULTRA-01'] },
  { code:'auto_agingcab', nameZh:'成品老化', nameEn:'Aging', nameVi:'Lão hóa', aliases:['AGING-01','AGING-CAB-01'] },
  { code:'auto_hivolt_ate', nameZh:'高压ATE', nameEn:'High-voltage ATE', nameVi:'ATE cao áp', aliases:['HIPOT-01'] },
  { code:'auto_package_ate', nameZh:'包装ATE', nameEn:'Packaging ATE', nameVi:'ATE đóng gói', aliases:['PACK-ATE-01','AUTO-ATE-L','AUTO-ATE-R','auto_ate_left','auto_ate_right'] },
  { code:'auto_case_binding', nameZh:'外箱码绑定', nameEn:'Outer-box Binding', nameVi:'Gán mã thùng', aliases:['CARTON-BIND-01'] },
  { code:'auto_pallet_binding', nameZh:'栈板绑码', nameEn:'Pallet Binding', nameVi:'Gán mã pallet', aliases:['PALLET-BIND-01'] },
]);

export const SMT_STATIONS = Object.freeze([
  { code:'smt_pda_loading', nameZh:'PD扫码上料', nameEn:'PDA Material Loading', nameVi:'Quét cấp liệu PDA', aliases:['SMT-PDA','SMT-LOAD'] },
  { code:'smt_laser_marking', nameZh:'镭雕机', nameEn:'Laser Marking', nameVi:'Khắc laser', aliases:['SMT-LASER'] },
  { code:'smt_auto_insertion', nameZh:'AI插件机', nameEn:'Automatic Insertion', nameVi:'Máy cắm linh kiện AI', aliases:['SMT-AI'] },
  { code:'smt_printer', nameZh:'印刷机', nameEn:'Solder Paste Printer', nameVi:'Máy in kem hàn', aliases:['SMT-PRINTER'] },
  { code:'smt_spi', nameZh:'SPI锡膏检测', nameEn:'Solder Paste Inspection', nameVi:'Kiểm tra kem hàn SPI', aliases:['SMT-SPI'] },
  { code:'smt_placement', nameZh:'贴片机', nameEn:'Pick and Place', nameVi:'Máy gắn linh kiện', aliases:['SMT-PLACEMENT'] },
  { code:'smt_aoi', nameZh:'SMT-AOI', nameEn:'SMT AOI', nameVi:'Kiểm tra SMT-AOI', aliases:['SMT-AOI'] },
]);

const MANUAL_ALIAS_LOOKUP = new Map();
for (const station of MANUAL_STATIONS) {
  MANUAL_ALIAS_LOOKUP.set(station.code.toUpperCase(), station.code);
  for (const alias of station.aliases) MANUAL_ALIAS_LOOKUP.set(alias.toUpperCase(), station.code);
}
const AUTO_ALIAS_LOOKUP = new Map();
for (const station of AUTO_STATIONS) {
  AUTO_ALIAS_LOOKUP.set(station.code.toUpperCase(), station.code);
  for (const alias of station.aliases) AUTO_ALIAS_LOOKUP.set(alias.toUpperCase(), station.code);
}
const SMT_ALIAS_LOOKUP = new Map();
for (const station of SMT_STATIONS) {
  SMT_ALIAS_LOOKUP.set(station.code.toUpperCase(), station.code);
  for (const alias of station.aliases) SMT_ALIAS_LOOKUP.set(alias.toUpperCase(), station.code);
}

export function canonicalLineCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  return LINE_ALIASES.get(raw) || raw;
}

export function canonicalStationCode(value, lineCode) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  // Modular station packages use the `mod_manu_*` prefix while legacy MES
  // records use `manu_*`. Treat both as the same physical manual-line station.
  const lookupRaw = raw.toLowerCase().startsWith('mod_') ? raw.slice(4) : raw;
  if (canonicalLineCode(lineCode) === CANONICAL_LINES.MANUAL) {
    return MANUAL_ALIAS_LOOKUP.get(lookupRaw.toUpperCase()) || lookupRaw.toLowerCase();
  }
  if (canonicalLineCode(lineCode) === CANONICAL_LINES.AUTO) {
    return AUTO_ALIAS_LOOKUP.get(lookupRaw.toUpperCase()) || lookupRaw.toLowerCase();
  }
  if (canonicalLineCode(lineCode) === CANONICAL_LINES.SMT) {
    return SMT_ALIAS_LOOKUP.get(lookupRaw.toUpperCase()) || lookupRaw.toLowerCase();
  }
  return lookupRaw;
}

export function canonicalLineId(lineCode) {
  return `line:${canonicalLineCode(lineCode)}`;
}

export function canonicalStationId(lineCode, stationCode) {
  const line = canonicalLineCode(lineCode);
  return `station:${line}:${canonicalStationCode(stationCode, line)}`;
}
