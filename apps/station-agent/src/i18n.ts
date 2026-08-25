// Minimal i18n — mirrors the main web app's structure
export type Locale = 'zh-CN' | 'vi-VN' | 'en-US';

const dict: Record<string, Record<Locale, string>> = {
  'app.title': { 'zh-CN': '工位扫描站', 'vi-VN': 'Trạm Quét', 'en-US': 'Scanner Station' },
  'station.select': { 'zh-CN': '选择工位', 'vi-VN': 'Chọn trạm', 'en-US': 'Select Station' },
  'station.placeholder': { 'zh-CN': '— 选择工位 —', 'vi-VN': '— Chọn trạm —', 'en-US': '— Select Station —' },
  'scan.input': { 'zh-CN': '扫码输入', 'vi-VN': 'Quét mã', 'en-US': 'Scan Input' },
  'scan.placeholder': { 'zh-CN': '扫描或输入序列号', 'vi-VN': 'Quét hoặc nhập số serial', 'en-US': 'Scan or enter serial number' },
  'result.pass': { 'zh-CN': '通过', 'vi-VN': 'ĐẠT', 'en-US': 'PASS' },
  'result.ng': { 'zh-CN': '不良', 'vi-VN': 'LỖI', 'en-US': 'NG' },
  'result.dup': { 'zh-CN': '重复', 'vi-VN': 'TRÙNG', 'en-US': 'DUP' },
  'result.unknown': { 'zh-CN': '未知', 'vi-VN': 'KHÔNG RÕ', 'en-US': 'UNKNOWN' },
  'result.blocked': { 'zh-CN': '被阻止', 'vi-VN': 'BỊ CHẶN', 'en-US': 'BLOCKED' },
  'ng.blockReason': { 'zh-CN': '此板上游工序不良，禁止流往下游', 'vi-VN': 'Board có lỗi trạm trước, không cho phép xuống dòng', 'en-US': 'Board has upstream NG, blocked from flowing downstream' },
  'ng.repairRequired': { 'zh-CN': '此板需先维修才能通过', 'vi-VN': 'Board cần sửa chữa trước khi đạt', 'en-US': 'Board must be repaired before passing' },
  'stats.pass': { 'zh-CN': '通过', 'vi-VN': 'Đạt', 'en-US': 'Pass' },
  'stats.ng': { 'zh-CN': '不良', 'vi-VN': 'Lỗi', 'en-US': 'NG' },
  'stats.dup': { 'zh-CN': '重复', 'vi-VN': 'Trùng', 'en-US': 'Dup' },
  'stats.today': { 'zh-CN': '今日', 'vi-VN': 'Hôm nay', 'en-US': 'Today' },
  'sync.online': { 'zh-CN': '在线', 'vi-VN': 'Trực tuyến', 'en-US': 'Online' },
  'sync.offline': { 'zh-CN': '离线', 'vi-VN': 'Ngoại tuyến', 'en-US': 'Offline' },
  'sync.pending': { 'zh-CN': '待同步', 'vi-VN': 'Chờ đồng bộ', 'en-US': 'Pending' },
  'operator.login': { 'zh-CN': '操作员登录', 'vi-VN': 'Đăng nhập', 'en-US': 'Login' },
  'operator.logout': { 'zh-CN': '退出登录', 'vi-VN': 'Đăng xuất', 'en-US': 'Logout' },
  'operator.placeholder': { 'zh-CN': '扫描员工条码登录', 'vi-VN': 'Quét mã nhân viên để đăng nhập', 'en-US': 'Scan employee barcode to login' },
  'pool.title': { 'zh-CN': '本地池', 'vi-VN': 'Hồ cục bộ', 'en-US': 'Local Pools' },
  'pool.sn': { 'zh-CN': '合格记录', 'vi-VN': 'Bản ghi đạt', 'en-US': 'Pass Records' },
  'pool.ng': { 'zh-CN': '不良池', 'vi-VN': 'Hồ lỗi', 'en-US': 'NG Pool' },
  'pool.dup': { 'zh-CN': '重复池', 'vi-VN': 'Hồ trùng', 'en-US': 'Dup Pool' },
  'ng.alert': { 'zh-CN': '不良告警', 'vi-VN': 'Cảnh báo lỗi', 'en-US': 'NG Alert' },

  // ── Data Source Panel ────────────────────────────────────────────────
  'datasource.title': { 'zh-CN': '数据源配置', 'vi-VN': 'Cấu hình nguồn dữ liệu', 'en-US': 'Data Source Config' },
  'datasource.add': { 'zh-CN': '+ 添加数据源', 'vi-VN': '+ Thêm nguồn dữ liệu', 'en-US': '+ Add Data Source' },
  'datasource.empty': { 'zh-CN': '暂无数据源，请添加', 'vi-VN': 'Chưa có nguồn dữ liệu, vui lòng thêm', 'en-US': 'No data sources configured' },
  'datasource_edit_config': { 'zh-CN': '编辑数据源配置', 'vi-VN': 'Chỉnh sửa cấu hình', 'en-US': 'Edit Configuration' },
  'datasource_name': { 'zh-CN': '名称', 'vi-VN': 'Tên', 'en-US': 'Name' },
  'datasource_type': { 'zh-CN': '类型', 'vi-VN': 'Loại', 'en-US': 'Type' },
  'datasource_save': { 'zh-CN': '保存', 'vi-VN': 'Lưu', 'en-US': 'Save' },
  'datasource_cancel': { 'zh-CN': '取消', 'vi-VN': 'Hủy', 'en-US': 'Cancel' },
  'datasource_edit': { 'zh-CN': '编辑', 'vi-VN': 'Sửa', 'en-US': 'Edit' },
  'datasource_remove': { 'zh-CN': '删除', 'vi-VN': 'Xóa', 'en-US': 'Remove' },
  'datasource_enable': { 'zh-CN': '启用', 'vi-VN': 'Bật', 'en-US': 'Enable' },
  'datasource_disable': { 'zh-CN': '禁用', 'vi-VN': 'Tắt', 'en-US': 'Disable' },
  'datasource_test_connection': { 'zh-CN': '测试连接', 'vi-VN': 'Kiểm tra kết nối', 'en-US': 'Test Connection' },
  'datasource_testing': { 'zh-CN': '测试中…', 'vi-VN': 'Đang kiểm tra…', 'en-US': 'Testing…' },

  // ── Data Source Config Fields ───────────────────────────────────────
  'datasource_url': { 'zh-CN': 'URL', 'vi-VN': 'URL', 'en-US': 'URL' },
  'datasource_host': { 'zh-CN': '主机', 'vi-VN': 'Máy chủ', 'en-US': 'Host' },
  'datasource_port': { 'zh-CN': '端口', 'vi-VN': 'Cổng', 'en-US': 'Port' },
  'datasource_method': { 'zh-CN': 'HTTP方法', 'vi-VN': 'Phương thức', 'en-US': 'HTTP Method' },
  'datasource_poll_interval': { 'zh-CN': '轮询间隔(ms)', 'vi-VN': 'Chu kỳ (ms)', 'en-US': 'Poll Interval (ms)' },
  'datasource_sn_regex': { 'zh-CN': 'SN提取正则', 'vi-VN': 'Regex SN', 'en-US': 'SN Extract Regex' },
  'datasource_protocol': { 'zh-CN': '协议', 'vi-VN': 'Giao thức', 'en-US': 'Protocol' },
  'datasource_file_patterns': { 'zh-CN': '文件模式', 'vi-VN': 'Mẫu tệp', 'en-US': 'File Patterns' },
  'datasource_broker_url': { 'zh-CN': 'Broker URL', 'vi-VN': 'Broker URL', 'en-US': 'Broker URL' },
  'datasource_topic': { 'zh-CN': 'MQTT主题', 'vi-VN': 'Chủ đề', 'en-US': 'MQTT Topic' },
  'datasource_username': { 'zh-CN': '用户名', 'vi-VN': 'Tên đăng nhập', 'en-US': 'Username' },
  'datasource_password': { 'zh-CN': '密码', 'vi-VN': 'Mật khẩu', 'en-US': 'Password' },
  'datasource_database_name': { 'zh-CN': '数据库名', 'vi-VN': 'Tên CSDL', 'en-US': 'Database Name' },
  'datasource_sql_query': { 'zh-CN': 'SQL查询', 'vi-VN': 'Truy vấn SQL', 'en-US': 'SQL Query' },
  'datasource_path': { 'zh-CN': '串口路径', 'vi-VN': 'Đường dẫn cổng', 'en-US': 'Port Path' },
  'datasource_baud_rate': { 'zh-CN': '波特率', 'vi-VN': 'Baud rate', 'en-US': 'Baud Rate' },

  // ── Live Feed ──────────────────────────────────────────────────────
  'datasource_live_feed': { 'zh-CN': '实时数据流', 'vi-VN': 'Luồng dữ liệu trực tiếp', 'en-US': 'Live Data Feed' },
  'datasource_filter_sn': { 'zh-CN': '按SN过滤', 'vi-VN': 'Lọc SN', 'en-US': 'Filter by SN' },
  'datasource_no_records': { 'zh-CN': '暂无数据', 'vi-VN': 'Chưa có dữ liệu', 'en-US': 'No records yet' },

  // ── Tabs ──────────────────────────────────────────────────────────
  'scan_tab': { 'zh-CN': '扫描', 'vi-VN': 'Quét', 'en-US': 'Scan' },
  'datasource_tab': { 'zh-CN': '数据源', 'vi-VN': 'Nguồn dữ liệu', 'en-US': 'Data Sources' },
  'feed_tab': { 'zh-CN': '实时数据', 'vi-VN': 'Dữ liệu trực tiếp', 'en-US': 'Live Feed' },
  'datasource_adapter_status': { 'zh-CN': '适配器状态', 'vi-VN': 'Trạng thái bộ chuyển đổi', 'en-US': 'Adapter Status' },

  // ── Alert Rules ────────────────────────────────────────────────────
  'alertrule_title': { 'zh-CN': '告警规则', 'vi-VN': 'Quy tắc cảnh báo', 'en-US': 'Alert Rules' },
  'alertrule_empty': { 'zh-CN': '暂无告警规则', 'vi-VN': 'Chưa có quy tắc', 'en-US': 'No alert rules configured' },
  'alertrule_add': { 'zh-CN': '+ 添加规则', 'vi-VN': '+ Thêm quy tắc', 'en-US': '+ Add Rule' },
  'alertrule_name': { 'zh-CN': '规则名称', 'vi-VN': 'Tên quy tắc', 'en-US': 'Rule Name' },
  'alertrule_expression': { 'zh-CN': '表达式', 'vi-VN': 'Biểu thức', 'en-US': 'Expression' },
  'alertrule_severity': { 'zh-CN': '严重程度', 'vi-VN': 'Mức độ', 'en-US': 'Severity' },
  'alertrule_action': { 'zh-CN': '动作', 'vi-VN': 'Hành động', 'en-US': 'Action' },
  'alertrule_save': { 'zh-CN': '保存', 'vi-VN': 'Lưu', 'en-US': 'Save' },
  'alertrule_cancel': { 'zh-CN': '取消', 'vi-VN': 'Hủy', 'en-US': 'Cancel' },
  'alertrule_enable': { 'zh-CN': '启用', 'vi-VN': 'Bật', 'en-US': 'Enable' },
  'alertrule_disable': { 'zh-CN': '禁用', 'vi-VN': 'Tắt', 'en-US': 'Disable' },
  'alertrule_remove': { 'zh-CN': '删除', 'vi-VN': 'Xóa', 'en-US': 'Remove' },

  // ── Offline + Work Order ─────────────────────────────────────────────
  'offline_banner': { 'zh-CN': '网络断开 — 数据暂存本地，恢复后自动同步', 'vi-VN': 'Mất kết nối — Dữ liệu lưu cục bộ, đồng bộ khi khôi phục', 'en-US': 'Network offline — data stored locally, syncs when restored' },
  'wo.notFound': { 'zh-CN': '工单号不存在', 'vi-VN': 'Mã lệnh không tồn tại', 'en-US': 'Work order not found' },
  'workorder_placeholder': { 'zh-CN': '工单号 (可选)', 'vi-VN': 'Mã lệnh (tùy chọn)', 'en-US': 'Work order (optional)' },
  'station.refresh': { 'zh-CN': '刷新工位', 'vi-VN': 'Làm mới trạm', 'en-US': 'Refresh stations' },
  'batch_mode': { 'zh-CN': '批量扫描', 'vi-VN': 'Quét hàng loạt', 'en-US': 'Batch Scan' },
};

export function t(key: string, locale: Locale = 'zh-CN'): string {
  return dict[key]?.[locale] ?? key;
}
