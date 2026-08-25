// AOI module i18n dictionary
export const aoiI18n = {
  // Page title
  "aoi.title": {
    "zh-CN": "AOI 自动光学检测站",
    "vi-VN": "Trạm kiểm tra AOI",
    "en-US": "AOI Station",
  },
  "aoi.pageTitle": {
    "zh-CN": "AOI 质量管理",
    "vi-VN": "Quản lý chất lượng AOI",
    "en-US": "AOI Quality Management",
  },

  // Scan
  "aoi.scanPlaceholder": {
    "zh-CN": "扫描 PCB 序列号...",
    "vi-VN": "Quét số serial PCB...",
    "en-US": "Scan PCB serial number...",
  },
  "aoi.inspectionReady": {
    "zh-CN": "检测就绪",
    "vi-VN": "Sẵn sàng kiểm tra",
    "en-US": "Inspection Ready",
  },
  "aoi.boardId": {
    "zh-CN": "板卡编号",
    "vi-VN": "Mã board",
    "en-US": "Board ID",
  },
  "aoi.program": {
    "zh-CN": "程序",
    "vi-VN": "Chương trình",
    "en-US": "Program",
  },

  // Defect entry
  "aoi.defectEntry": {
    "zh-CN": "缺陷录入",
    "vi-VN": "Nhập khiếm khuyết",
    "en-US": "Defect Entry",
  },
  "aoi.selectDefect": {
    "zh-CN": "选择缺陷",
    "vi-VN": "Chọn lỗi",
    "en-US": "Select Defect",
  },
  "aoi.location": {
    "zh-CN": "位置",
    "vi-VN": "Vị trí",
    "en-US": "Location",
  },
  "aoi.addDefect": {
    "zh-CN": "添加缺陷",
    "vi-VN": "Thêm lỗi",
    "en-US": "Add Defect",
  },
  "aoi.defectRequired": {
    "zh-CN": "请输入至少一个缺陷",
    "vi-VN": "Vui lòng nhập ít nhất một lỗi",
    "en-US": "Please enter at least one defect",
  },
  "aoi.defects": {
    "zh-CN": "个缺陷",
    "vi-VN": "lỗi",
    "en-US": "defects",
  },

  // Stats
  "aoi.total": {
    "zh-CN": "总计",
    "vi-VN": "Tổng",
    "en-US": "Total",
  },
  "aoi.yield": {
    "zh-CN": "良率",
    "vi-VN": "Tỷ lệ đạt",
    "en-US": "Yield",
  },
  "aoi.recentInspections": {
    "zh-CN": "最近检测记录",
    "vi-VN": "Bản ghi kiểm tra gần đây",
    "en-US": "Recent Inspections",
  },

  // Defect Pareto
  "aoi.defectPareto": {
    "zh-CN": "缺陷帕累托",
    "vi-VN": "Pareto lỗi",
    "en-US": "Defect Pareto",
  },
  "aoi.machineStatus": {
    "zh-CN": "设备状态",
    "vi-VN": "Trạng thái máy",
    "en-US": "Machine Status",
  },
  "aoi.uptime": {
    "zh-CN": "运行时间",
    "vi-VN": "Thời gian chạy",
    "en-US": "Uptime",
  },
  "aoi.passRate": {
    "zh-CN": "通过率",
    "vi-VN": "Tỷ lệ đạt",
    "en-US": "Pass Rate",
  },
  "aoi.ngRate": {
    "zh-CN": "不良率",
    "vi-VN": "Tỷ lệ lỗi",
    "en-US": "NG Rate",
  },
  "aoi.defectCode": {
    "zh-CN": "缺陷代码",
    "vi-VN": "Mã lỗi",
    "en-US": "Defect Code",
  },
  "aoi.defectCount": {
    "zh-CN": "缺陷数量",
    "vi-VN": "Số lỗi",
    "en-US": "Defect Count",
  },
} as const;

export type AoiI18nKey = keyof typeof aoiI18n;
