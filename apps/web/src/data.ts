// Static configuration only: permission catalogue, role matrix and the station topology
// the MES renders. Every dataset that used to live here (lots, work orders, employees,
// invoices, inspection results, spare parts...) was fabricated demo content: the screens
// now read those from the API and render an empty state when a call fails, so production
// never displays invented numbers.
import type { RoleKey, StationDef, StationKey } from "../../../packages/shared-types/src/factory";

export const ALL_PERMISSIONS: string[] = [
  "dashboard.view", "erp.view", "pmc.view", "pmc.manage",
  "wms.view", "wms.receive", "wms.iqc", "wms.issue",
  "mes.view", "mes.execute",
  "quality.view", "quality.review",
  "traceability.view", "reports.view",
  "finance.view", "finance.manage",
  "sales.view", "sales.manage",
  "service.view", "service.manage",
  "admin.view", "admin.users.manage", "admin.roles.manage",
  "admin.audit.read", "admin.settings.manage",
  "auth.session.read", "auth.session.manage",
  // Lifecycle management
  "lifecycle.view", "lifecycle.edit", "lifecycle.approve",
];

export const roleMatrix: Record<RoleKey, string[]> = {
  management: [
    "dashboard.view", "reports.view", "traceability.view",
    "pmc.view", "pmc.manage", "wms.view", "quality.view",
    "finance.view", "sales.view", "service.view",
    "maintenance.view",
  ],
  pmc: ["pmc.view", "pmc.manage", "wms.view", "traceability.view", "sales.view"],
  warehouse: ["wms.view", "wms.receive", "wms.iqc", "wms.issue", "inventory", "lifecycle.view", "lifecycle.edit"],
  iqc: ["wms.view", "wms.iqc", "quality.view", "supplier_quality", "hold_release", "service.view"],
  smt_operator: ["mes.view", "mes.execute", "pda.view", "line_start", "feeder_scan", "pcb_scan", "output", "downtime"],
  engineering: ["mes.view", "process_route", "first_article", "abnormal_analysis", "quality.review", "maintenance.view", "maintenance.manage"],
  quality: ["quality.view", "quality.review", "spi", "aoi", "ict", "repair", "capa", "service.view", "lifecycle.view", "lifecycle.edit", "lifecycle.approve"],
  admin: ALL_PERMISSIONS,
};

// ── WMS demo data ──────────────────────────────────────────────────

export const stationDefs: StationDef[] = [
  // SMT section
  { key: "printer", name: { name_zh: "印刷机", name_en: "Solder Paste Printer", name_vi: "Máy in" }, section: "smt", integration: "hardware", description: { name_zh: "锡膏印刷参数自动核对", name_en: "Auto-verify print parameters with SOP", name_vi: "Tự động đối chiếu thông số in với SOP" } },
  { key: "spi", name: { name_zh: "SPI检测", name_en: "SPI Check", name_vi: "Kiểm tra SPI" }, section: "smt", integration: "hardware", description: { name_zh: "锡膏厚度检测参数上传", name_en: "Solder paste inspection parameters upload", name_vi: "Tải lên thông số kiểm tra kem hàn" } },
  { key: "ai1", name: { name_zh: "AI1插件机", name_en: "AI1 Inserter", name_vi: "Máy cắm AI1" }, section: "smt", integration: "hardware", description: { name_zh: "立式插件防错料", name_en: "Vertical insertion anti-mistake", name_vi: "Chống nhầm linh kiện cắm đứng" } },
  { key: "ai2", name: { name_zh: "AI2插件机", name_en: "AI2 Inserter", name_vi: "Máy cắm AI2" }, section: "smt", integration: "hardware", description: { name_zh: "异型插件防错料", name_en: "Odd-form insertion anti-mistake", name_vi: "Chống nhầm linh kiện cắm đặc thù" } },
  { key: "mount1", name: { name_zh: "贴片1", name_en: "Mount 1", name_vi: "Gắp chip 1" }, section: "smt", integration: "hardware", description: { name_zh: "贴片机防错料", name_en: "Mounter anti-mistake", name_vi: "Chống nhầm máy gắp chip" } },
  { key: "mount2", name: { name_zh: "贴片2", name_en: "Mount 2", name_vi: "Gắp chip 2" }, section: "smt", integration: "hardware", description: { name_zh: "贴片机防错料", name_en: "Mounter anti-mistake", name_vi: "Chống nhầm máy gắp chip" } },
  { key: "reflow", name: { name_zh: "回流焊", name_en: "Reflow Oven", name_vi: "Hàn reflow" }, section: "smt", integration: "hardware", description: { name_zh: "回流焊温度PWI实时监控", name_en: "Real-time reflow temperature/PWI monitoring", name_vi: "Giám sát thời gian thực nhiệt độ/PWI" } },
  { key: "smt_aoi", name: { name_zh: "SMT-AOI检测", name_en: "SMT-AOI Check", name_vi: "Kiểm tra SMT-AOI" }, section: "smt", integration: "hardware", description: { name_zh: "SMT段AOI检测报表实时上传", name_en: "SMT AOI inspection report real-time upload", name_vi: "Tải lên thời gian thực báo cáo AOI SMT" } },
  { key: "pcba_load", name: { name_zh: "PCBA上料", name_en: "PCBA Loading", name_vi: "Nạp PCBA" }, section: "smt", integration: "software", description: { name_zh: "PCB开封管控结束时间", name_en: "PCB opening control end time", name_vi: "Thời gian kết thúc kiểm soát mở PCB" } },
  { key: "pda_load", name: { name_zh: "PDA上料", name_en: "PDA Loading", name_vi: "Nạp PDA" }, section: "smt", integration: "hardware", description: { name_zh: "PDA扫码上料记录物料D/C", name_en: "PDA scan loading records material D/C", name_vi: "Quét PDA nạp liệu ghi D/C vật tư" } },
  // Post-SMT section
  { key: "ws_aoi", name: { name_zh: "WS-AOI检测", name_en: "WS-AOI Check", name_vi: "Kiểm tra WS-AOI" }, section: "post_smt", integration: "hardware", description: { name_zh: "波峰焊后AOI误报率/真性不良统计", name_en: "Post-wave-solder AOI false call / true defect stats", name_vi: "Thống kê sai lệch AOI sau hàn sóng" } },
  { key: "ict", name: { name_zh: "ICT检测", name_en: "ICT Check", name_vi: "Kiểm tra ICT" }, section: "post_smt", integration: "hardware", description: { name_zh: "ICT测试数据实时上传/顶针寿命管控", name_en: "ICT test data upload / pin life management", name_vi: "Tải dữ liệu test ICT/quản lý tuổi thọ kim" } },
  { key: "fct", name: { name_zh: "FCT检测", name_en: "FCT Check", name_vi: "Kiểm tra FCT" }, section: "post_smt", integration: "hardware", description: { name_zh: "FCT测试数据实时上传/顶针寿命管控", name_en: "FCT test data upload / pin life management", name_vi: "Tải dữ liệu test FCT/quản lý tuổi thọ kim" } },
  { key: "pcba_divide", name: { name_zh: "分板", name_en: "PCBA Divide", name_vi: "Cắt PCBA" }, section: "post_smt", integration: "software", description: { name_zh: "分板机铣刀寿命管控", name_en: "Router bit life management", name_vi: "Quản lý tuổi thọ mũi cắt" } },
  { key: "pcba_link", name: { name_zh: "PCBA绑码", name_en: "PCBA Link", name_vi: "Liên kết PCBA" }, section: "post_smt", integration: "software", description: { name_zh: "PCBA SN与外壳SN绑定", name_en: "Bind PCBA SN to case SN", name_vi: "Liên kết SN PCBA với SN vỏ" } },
  { key: "ate1", name: { name_zh: "ATE1测试", name_en: "ATE1 Test", name_vi: "Kiểm tra ATE1" }, section: "post_smt", integration: "hardware", description: { name_zh: "ATE半成品测试数据上传/模版下载", name_en: "ATE semi-product test data upload / template download", name_vi: "Tải lên dữ liệu test ATE bán thành phẩm" } },
  { key: "ultrasonic", name: { name_zh: "超声", name_en: "Ultrasonic", name_vi: "Hàn siêu âm" }, section: "post_smt", integration: "hardware", description: { name_zh: "超声参数上传/实时监控", name_en: "Ultrasonic parameter upload / real-time monitoring", name_vi: "Tải thông số siêu âm/giám sát thời gian thực" } },
  { key: "bi_loading", name: { name_zh: "老化上机", name_en: "Burn-in Loading", name_vi: "Nạp già hóa" }, section: "post_smt", integration: "hardware", description: { name_zh: "老化柜装载", name_en: "Burn-in chamber loading", name_vi: "Nạp tủ già hóa" } },
  { key: "burn_in", name: { name_zh: "老化", name_en: "Burn-in", name_vi: "Già hóa" }, section: "post_smt", integration: "hardware", description: { name_zh: "老化测试数据上传/模版下载", name_en: "Burn-in test data upload / template download", name_vi: "Tải dữ liệu test già hóa" } },
  { key: "hi_pot", name: { name_zh: "高压测试", name_en: "Hi-Pot Test", name_vi: "Kiểm tra cao áp" }, section: "post_smt", integration: "hardware", description: { name_zh: "耐压测试数据上传/模版下载", name_en: "Hi-Pot test data upload / template download", name_vi: "Tải dữ liệu test cao áp" } },
  { key: "ate2", name: { name_zh: "ATE2测试", name_en: "ATE2 Test", name_vi: "Kiểm tra ATE2" }, section: "post_smt", integration: "hardware", description: { name_zh: "ATE成品测试数据上传/真性误报统计", name_en: "ATE final test data upload / true defect stats", name_vi: "Tải dữ liệu test ATE thành phẩm" } },
  { key: "code_link", name: { name_zh: "CODE绑码", name_en: "Code Link", name_vi: "Liên kết CODE" }, section: "post_smt", integration: "software", description: { name_zh: "外壳SN与铭牌SN绑定", name_en: "Bind case SN to nameplate SN", name_vi: "Liên kết SN vỏ với SN nhãn" } },
  // Packaging section
  { key: "packing", name: { name_zh: "包装", name_en: "Packing", name_vi: "Đóng gói" }, section: "packaging", integration: "software", description: { name_zh: "外箱标签打印（含所有SN信息）", name_en: "Outer box label print (with all SN info)", name_vi: "In nhãn thùng (bao gồm tất cả SN)" } },
  { key: "pallet_label", name: { name_zh: "栈板标签", name_en: "Pallet Label", name_vi: "Nhãn pallet" }, section: "packaging", integration: "software", description: { name_zh: "PO/客户/数量/多箱集成栈板标签", name_en: "PO/customer/qty pallet label generation", name_vi: "Tạo nhãn pallet PO/khách hàng/số lượng" } },
  // OQC section
  { key: "oqc_hi_pot", name: { name_zh: "OQC耐压", name_en: "OQC Hi-Pot", name_vi: "OQC cao áp" }, section: "oqc", integration: "hardware", description: { name_zh: "OQC耐压测试数据上传", name_en: "OQC hi-pot test data upload", name_vi: "Tải lên dữ liệu test OQC cao áp" } },
  { key: "oqc_ate2", name: { name_zh: "OQC-ATE2", name_en: "OQC-ATE2", name_vi: "OQC-ATE2" }, section: "oqc", integration: "hardware", description: { name_zh: "OQC-ATE2测试数据上传", name_en: "OQC-ATE2 test data upload", name_vi: "Tải lên dữ liệu test OQC-ATE2" } },
  { key: "oqc_cosmetic", name: { name_zh: "OQC外观", name_en: "OQC Cosmetic", name_vi: "OQC ngoại quan" }, section: "oqc", integration: "software", description: { name_zh: "OQC外观检验", name_en: "OQC cosmetic inspection", name_vi: "Kiểm tra ngoại quan OQC" } },
  { key: "oqc_replace", name: { name_zh: "OQC替换", name_en: "OQC Replace", name_vi: "OQC thay thế" }, section: "oqc", integration: "software", description: { name_zh: "OQC不良品替换并重新打印标签", name_en: "OQC defective replacement and reprint label", name_vi: "Thay thế sản phẩm lỗi OQC và in lại nhãn" } },
  { key: "oqc_report", name: { name_zh: "OQC报表记录", name_en: "OQC Report Records", name_vi: "Báo cáo OQC" }, section: "oqc", integration: "software", description: { name_zh: "OQC检验报表记录与归档", name_en: "OQC inspection report records and archiving", name_vi: "Ghi chép và lưu trữ báo cáo OQC" } },
  // Auxiliary section
  { key: "barcode_convert", name: { name_zh: "条码转换", name_en: "Barcode Convert", name_vi: "Chuyển đổi mã vạch" }, section: "auxiliary", integration: "software", description: { name_zh: "不良标签更换", name_en: "Defective label replacement", name_vi: "Thay thế nhãn lỗi" } },
  { key: "decoding", name: { name_zh: "解码", name_en: "Decoding", name_vi: "Giải mã" }, section: "auxiliary", integration: "software", description: { name_zh: "功能测试不良后系统解锁重新测试", name_en: "System unlock for retest after functional failure", name_vi: "Mở khóa hệ thống để kiểm tra lại" } },
  { key: "pcba_bake", name: { name_zh: "PCBA烘烤", name_en: "PCBA Bake", name_vi: "Sấy PCBA" }, section: "auxiliary", integration: "software", description: { name_zh: "PCBA开封超168H需烘烤2H", name_en: "PCBA opened >168H requires 2H bake", name_vi: "PCBA mở >168H cần sấy 2H" } },
  { key: "visual_defect_upload", name: { name_zh: "外观不良上传", name_en: "Visual Defect Upload", name_vi: "Tải lên lỗi ngoại quan" }, section: "auxiliary", integration: "software", description: { name_zh: "外观不良图片上传记录", name_en: "Visual defect photo upload record", name_vi: "Tải lên ảnh lỗi ngoại quan" } },
  { key: "repair_report", name: { name_zh: "维修报表", name_en: "Repair Report", name_vi: "Báo cáo sửa lỗi" }, section: "auxiliary", integration: "software", description: { name_zh: "维修记录报表", name_en: "Repair record report", name_vi: "Báo cáo ghi chép sửa lỗi" } },
];

export const lineStationMap: Record<string, StationKey[]> = {
  "line-smt-01": ["printer", "spi", "mount1", "mount2", "reflow", "smt_aoi", "pcba_load"],
  "line-smt-02": ["printer", "spi", "ai1", "mount1", "mount2", "reflow", "smt_aoi", "pcba_load", "pda_load"],
  "line-semi-auto-02": ["ai1", "pda_load", "ws_aoi", "ict", "fct", "pcba_divide", "pcba_link", "ate1", "ultrasonic", "hi_pot", "ate2", "code_link"],
  "line-pkg-03": ["packing", "pallet_label", "oqc_hi_pot", "oqc_ate2", "oqc_cosmetic", "oqc_replace", "oqc_report"],
  "line-manual-04": ["pcba_divide", "pcba_link", "ate1", "ultrasonic", "bi_loading", "burn_in", "hi_pot", "ate2", "code_link"],
  "line-rework-99": ["barcode_convert", "decoding", "pcba_bake", "visual_defect_upload", "repair_report"],
};

