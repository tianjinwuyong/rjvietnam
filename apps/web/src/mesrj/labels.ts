// MES-ruijing 本模块新增标签（源 web/i18n.js 词典未覆盖的页面/字段文案）
// 全部三语齐备；key 约定：menu.<code>（菜单项）、md.<res>.<field>（列表/表单列）
export interface Trilingual {
  zh: string;
  en: string;
  vi: string;
}

export const LABELS: Record<string, Trilingual> = {
  // ── 通用 ──
  "wip.title": { zh: "建设中", en: "Under construction", vi: "Đang xây dựng" },
  "wip.desc": {
    zh: "该页面在移植计划中，随对应波次交付。",
    en: "This page is scheduled in the porting plan and ships with its wave.",
    vi: "Trang này nằm trong kế hoạch chuyển đổi, sẽ giao theo đợt.",
  },
  "common.actions": { zh: "操作", en: "Actions", vi: "Thao tác" },
  "common.keyword": { zh: "关键词", en: "Keyword", vi: "Từ khóa" },
  "common.total": { zh: "共", en: "Total", vi: "Tổng" },
  "common.items": { zh: "条", en: "records", vi: "bản ghi" },
  "common.prev": { zh: "上一页", en: "Prev", vi: "Trước" },
  "common.next": { zh: "下一页", en: "Next", vi: "Sau" },
  "common.new": { zh: "新增", en: "New", vi: "Thêm mới" },
  "common.edit": { zh: "编辑", en: "Edit", vi: "Sửa" },
  "common.delete": { zh: "删除", en: "Delete", vi: "Xóa" },
  "common.deleteConfirm": {
    zh: "确认删除该记录？",
    en: "Delete this record?",
    vi: "Xác nhận xóa bản ghi này?",
  },
  "common.enabled.y": { zh: "启用", en: "Enabled", vi: "Bật" },
  "common.enabled.n": { zh: "停用", en: "Disabled", vi: "Tắt" },
  "common.yes": { zh: "是", en: "Yes", vi: "Có" },
  "common.no": { zh: "否", en: "No", vi: "Không" },
  "common.loadFail": { zh: "加载失败", en: "Failed to load", vi: "Tải thất bại" },
  "common.required": { zh: "必填", en: "Required", vi: "Bắt buộc" },

  // ── 菜单（与后端 /mesrj/menu 的 code 对应）──
  "menu.home": { zh: "首页", en: "Home", vi: "Trang chủ" },
  "menu.md": { zh: "基础数据", en: "Master Data", vi: "Dữ liệu gốc" },
  "menu.md.customer": { zh: "客户", en: "Customers", vi: "Khách hàng" },
  "menu.md.model": { zh: "机型维护", en: "Models", vi: "Quản lý model" },
  "menu.md.line": { zh: "产线", en: "Lines", vi: "Chuyền" },
  "menu.md.station": { zh: "工位", en: "Stations", vi: "Trạm" },
  "menu.cfg.feederslot": { zh: "SMT 站位表", en: "SMT Feeder Slots", vi: "Bản đồ vị trí SMT" },
  "menu.md.employee": { zh: "员工管理", en: "Employees", vi: "Nhân viên" },
  "menu.md.shift": { zh: "班次", en: "Shifts", vi: "Ca làm việc" },
  "menu.md.defect": { zh: "不良代码", en: "Defect Codes", vi: "Mã lỗi" },
  "menu.md.rootcause": { zh: "根因代码", en: "Root Causes", vi: "Mã nguyên nhân" },
  "menu.bom": { zh: "物料与 BOM", en: "Materials & BOM", vi: "Vật tư & BOM" },
  "menu.md.material": { zh: "物料", en: "Materials", vi: "Vật tư" },
  "menu.bom.header": { zh: "BOM 版本", en: "BOM Versions", vi: "Phiên bản BOM" },
  "menu.bom.tree": { zh: "BOM 结构", en: "BOM Tree", vi: "Cấu trúc BOM" },
  "menu.bom.item": { zh: "BOM 明细", en: "BOM Items", vi: "Chi tiết BOM" },
  "menu.bom.import": { zh: "BOM 导入", en: "BOM Import", vi: "Nhập BOM" },
  "menu.plan": { zh: "排产计划", en: "Planning", vi: "Kế hoạch sản xuất" },
  "menu.plan.board": { zh: "排产看板", en: "Plan Board", vi: "Bảng kế hoạch" },
  "menu.plan.load": { zh: "产线负载", en: "Line Load", vi: "Tải chuyền" },
  "menu.plan.capacity": { zh: "产能标准维护", en: "Capacity Master", vi: "Danh mục năng suất" },
  "menu.order": { zh: "订单与工单", en: "Orders & Work Orders", vi: "Đơn & Lệnh sản xuất" },
  "menu.po": { zh: "客户 PO", en: "Customer PO", vi: "PO khách hàng" },
  "menu.mo": { zh: "生产计划", en: "Work Orders", vi: "Lệnh sản xuất" },
  "menu.issue": { zh: "领料单", en: "Material Issues", vi: "Đơn领料" },
  "menu.wmsmo": { zh: "领料下发 WMS", en: "Issue to WMS", vi: "Xuất WMS" },
  "menu.route": { zh: "工艺路线", en: "Routes", vi: "Định tuyến" },
  "menu.route.process": { zh: "机型路线", en: "Model Routes", vi: "Đường model" },
  "menu.route.rule": { zh: "工位规则", en: "Station Rules", vi: "Quy tắc trạm" },
  "menu.exec": { zh: "生产执行", en: "Execution", vi: "Thực thi" },
  "menu.smt": { zh: "SMT 总控", en: "SMT Control", vi: "Điều phối SMT" },
  "menu.qc": { zh: "品质与追溯", en: "Quality & Trace", vi: "Chất lượng & Truy xuất" },
  "menu.dev": { zh: "设备", en: "Equipment", vi: "Thiết bị" },
  "menu.md.equipment": { zh: "设备台账", en: "Equipment List", vi: "Danh mục thiết bị" },
  "menu.dev.machinesource": { zh: "机台数据源", en: "Machine Sources", vi: "Nguồn dữ liệu máy" },
  "menu.report": { zh: "报表与看板", en: "Reports", vi: "Báo cáo" },
  "menu.cfg": { zh: "配置中心", en: "Configuration", vi: "Cấu hình" },
  "menu.sys": { zh: "系统管理", en: "System", vi: "Hệ thống" },
  "menu.sys.user": { zh: "用户", en: "Users", vi: "Người dùng" },
  "menu.sys.role": { zh: "角色权限", en: "Roles & Perms", vi: "Vai trò & Quyền" },
  "menu.sys.param": { zh: "系统参数", en: "Parameters", vi: "Tham số" },
  "menu.sys.log": { zh: "操作日志", en: "Audit Log", vi: "Nhật ký" },
  "menu.sys.info": { zh: "系统信息", en: "System Info", vi: "Thông tin hệ thống" },
  "menu.erp": { zh: "业务数据", en: "Business Data", vi: "Dữ liệu nghiệp vụ" },

  // ── md.customer ──
  "md.customer.cust_code": { zh: "客户编码", en: "Customer Code", vi: "Mã khách hàng" },
  "md.customer.cust_name": { zh: "客户名称", en: "Customer Name", vi: "Tên khách hàng" },
  "md.customer.short_name": { zh: "简称", en: "Short Name", vi: "Tên viết tắt" },
  "md.customer.country": { zh: "国家/地区", en: "Country", vi: "Quốc gia" },

  // ── md.product ──
  "md.product.product_code": { zh: "产品料号", en: "Product Code", vi: "Mã sản phẩm" },
  "md.product.product_name": { zh: "产品名称", en: "Product Name", vi: "Tên sản phẩm" },
  "md.product.product_model": { zh: "机型", en: "Model", vi: "Model" },
  "md.product.product_type": { zh: "类型", en: "Type", vi: "Loại" },
  "md.product.cust_code": { zh: "客户", en: "Customer", vi: "Khách hàng" },
  "md.product.spec": { zh: "规格", en: "Spec", vi: "Thông số" },
  "md.product.color": { zh: "颜色", en: "Color", vi: "Màu" },
  "md.product.sku": { zh: "SKU", en: "SKU", vi: "SKU" },
  "md.product.unit": { zh: "单位", en: "Unit", vi: "Đơn vị" },

  // ── md.material ──
  "md.material.material_code": { zh: "工料号", en: "Material Code", vi: "Mã vật tư" },
  "md.material.vn_code": { zh: "越南料号", en: "VN Code", vi: "Mã VN" },
  "md.material.material_name": { zh: "物料名称", en: "Material Name", vi: "Tên vật tư" },
  "md.material.mpq": { zh: "最小包装", en: "MPQ", vi: "MPQ" },
  "md.material.loss_rate": { zh: "损耗率", en: "Loss Rate", vi: "Tỷ lệ hao hụt" },
  "md.material.origin_code": { zh: "产地", en: "Origin", vi: "Xuất xứ" },
  "md.material.maker": { zh: "制造商", en: "Maker", vi: "Nhà sản xuất" },
  "md.material.category": { zh: "类别", en: "Category", vi: "Nhóm" },
  "md.material.is_aux": { zh: "辅料", en: "Auxiliary", vi: "Phụ liệu" },

  // ── md.line ──
  "md.line.line_code": { zh: "产线编码", en: "Line Code", vi: "Mã chuyền" },
  "md.line.line_name": { zh: "产线名称", en: "Line Name", vi: "Tên chuyền" },
  "md.line.line_type": { zh: "线别类型", en: "Line Type", vi: "Loại chuyền" },
  "md.line.process_code": { zh: "工序", en: "Process", vi: "Công đoạn" },
  "md.line.tact_time": { zh: "节拍(秒/台)", en: "Tact Time (s)", vi: "Nhịp (giây)" },
  "md.line.plan_hours": { zh: "计划工时", en: "Plan Hours", vi: "Giờ kế hoạch" },

  // ── md.station ──
  "md.station.station_code": { zh: "工位编码", en: "Station Code", vi: "Mã trạm" },
  "md.station.station_name": { zh: "工位名称", en: "Station Name", vi: "Tên trạm" },
  "md.station.short_name": { zh: "简称", en: "Short Name", vi: "Tên viết tắt" },
  "md.station.seq_no": { zh: "顺序", en: "Seq", vi: "Thứ tự" },
  "md.station.station_type": { zh: "工位类型", en: "Station Type", vi: "Loại trạm" },

  // ── md.track ──
  "md.track.track_code": { zh: "轨道编码", en: "Track Code", vi: "Mã lane" },
  "md.track.track_name": { zh: "轨道名称", en: "Track Name", vi: "Tên lane" },

  // ── machine-source ──
  "md.machine-source.machine_no": { zh: "机台号", en: "Machine No.", vi: "Số máy" },
  "md.machine-source.station_code": { zh: "工位", en: "Station", vi: "Trạm" },
  "md.machine-source.track": { zh: "轨道", en: "Track", vi: "Lane" },
  "md.machine-source.mo_hint": { zh: "工单提示", en: "MO Hint", vi: "Gợi ý lệnh" },

  // ── md.equipment ──
  "md.equipment.equip_code": { zh: "设备编码", en: "Equipment Code", vi: "Mã thiết bị" },
  "md.equipment.equip_name": { zh: "设备名称", en: "Equipment Name", vi: "Tên thiết bị" },
  "md.equipment.equip_type": { zh: "设备类型", en: "Type", vi: "Loại" },
  "md.equipment.model": { zh: "型号", en: "Model", vi: "Model" },
  "md.equipment.brand": { zh: "品牌", en: "Brand", vi: "Hãng" },
  "md.equipment.connect_mode": { zh: "连接方式", en: "Connection", vi: "Kết nối" },

  // ── md.defect ──
  "md.defect.defect_code": { zh: "不良代码", en: "Defect Code", vi: "Mã lỗi" },
  "md.defect.name_cn": { zh: "中文名", en: "Name (zh)", vi: "Tên (zh)" },
  "md.defect.name_en": { zh: "英文名", en: "Name (en)", vi: "Tên (en)" },
  "md.defect.name_vi": { zh: "越南文名", en: "Name (vi)", vi: "Tên (vi)" },
  "md.defect.category": { zh: "等级", en: "Category", vi: "Cấp" },
  "md.defect.can_retest": { zh: "可重测", en: "Retestable", vi: "Test lại được" },
  "md.defect.is_scrap": { zh: "必报废", en: "Scrap", vi: "Phải hủy" },
  "md.defect.is_terminal": { zh: "终判", en: "Terminal", vi: "Kết thúc" },

  // ── md.rootcause ──
  "md.rootcause.rc_code": { zh: "根因代码", en: "Root Cause Code", vi: "Mã nguyên nhân" },
  "md.rootcause.description": { zh: "说明", en: "Description", vi: "Mô tả" },

  // ── md.shift ──
  "md.shift.shift_code": { zh: "班次编码", en: "Shift Code", vi: "Mã ca" },
  "md.shift.shift_name": { zh: "班次名称", en: "Shift Name", vi: "Tên ca" },
  "md.shift.begin_time": { zh: "开始", en: "Start", vi: "Bắt đầu" },
  "md.shift.end_time": { zh: "结束", en: "End", vi: "Kết thúc" },
  "md.shift.cross_day": { zh: "跨天", en: "Cross-day", vi: "Qua ngày" },

  // ── md.calendar ──
  "md.calendar.cal_date": { zh: "日期", en: "Date", vi: "Ngày" },
  "md.calendar.is_workday": { zh: "工作日", en: "Workday", vi: "Ngày làm việc" },

  // ── sys.user / sys.role ──
  "sys.user.login_name": { zh: "登录名", en: "Login Name", vi: "Tên đăng nhập" },
  "sys.user.emp_name": { zh: "姓名", en: "Name", vi: "Họ tên" },
  "sys.user.dept": { zh: "部门", en: "Dept", vi: "Phòng ban" },
  "sys.user.phone": { zh: "电话", en: "Phone", vi: "Điện thoại" },
  "sys.role.role_code": { zh: "角色编码", en: "Role Code", vi: "Mã vai trò" },
  "sys.role.role_name": { zh: "角色名称", en: "Role Name", vi: "Tên vai trò" },

  // ── 通用字段 ──
  "field.status": { zh: "状态", en: "Status", vi: "Trạng thái" },
  "field.remark": { zh: "备注", en: "Remark", vi: "Ghi chú" },
  "field.line_code": { zh: "产线", en: "Line", vi: "Chuyền" },
  "field.process_code": { zh: "工序", en: "Process", vi: "Công đoạn" },
};
