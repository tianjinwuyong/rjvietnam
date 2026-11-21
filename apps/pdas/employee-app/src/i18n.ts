export type Locale = "zh-CN" | "vi-VN" | "en-US";

const dict: Record<string, Record<Locale, string>> = {
  // App
  app_title: { "zh-CN": "员工App", "vi-VN": "Nhân viên App", "en-US": "Employee App" },
  loading: { "zh-CN": "加载中...", "vi-VN": "Đang tải...", "en-US": "Loading..." },
  no_data: { "zh-CN": "暂无数据", "vi-VN": "Không có dữ liệu", "en-US": "No data" },
  error: { "zh-CN": "出错了", "vi-VN": "Có lỗi", "en-US": "Error" },
  refresh: { "zh-CN": "刷新", "vi-VN": "Làm mới", "en-US": "Refresh" },
  submit: { "zh-CN": "提交", "vi-VN": "Gửi", "en-US": "Submit" },
  cancel: { "zh-CN": "取消", "vi-VN": "Hủy", "en-US": "Cancel" },
  confirm: { "zh-CN": "确认", "vi-VN": "Xác nhận", "en-US": "Confirm" },
  // Login
  login_title: { "zh-CN": "员工登录", "vi-VN": "Đăng nhập nhân viên", "en-US": "Employee Login" },
  username: { "zh-CN": "账号", "vi-VN": "Tài khoản", "en-US": "Username" },
  password: { "zh-CN": "密码", "vi-VN": "Mật khẩu", "en-US": "Password" },
  login_btn: { "zh-CN": "登录", "vi-VN": "Đăng nhập", "en-US": "Login" },
  login_failed: { "zh-CN": "登录失败", "vi-VN": "Đăng nhập thất bại", "en-US": "Login failed" },
  logout: { "zh-CN": "退出登录", "vi-VN": "Đăng xuất", "en-US": "Logout" },
  // Tabs
  tab_checkin: { "zh-CN": "打卡", "vi-VN": "Chấm công", "en-US": "Check-in" },
  tab_leave: { "zh-CN": "请假", "vi-VN": "Nghỉ phép", "en-US": "Leave" },
  tab_attendance: { "zh-CN": "考勤", "vi-VN": "Chấm công", "en-US": "Attendance" },
  tab_salary: { "zh-CN": "工资", "vi-VN": "Lương", "en-US": "Salary" },
  tab_notification: { "zh-CN": "通知", "vi-VN": "Thông báo", "en-US": "Notifications" },
  tab_profile: { "zh-CN": "我的", "vi-VN": "Của tôi", "en-US": "Profile" },
  // Check-in
  clock_in: { "zh-CN": "上班打卡", "vi-VN": "Chấm công vào", "en-US": "Clock In" },
  clock_out: { "zh-CN": "下班打卡", "vi-VN": "Chấm công ra", "en-US": "Clock Out" },
  today_history: { "zh-CN": "今日打卡记录", "vi-VN": "Lịch sử hôm nay", "en-US": "Today's Records" },
  // Leave
  leave_balance: { "zh-CN": "请假余额", "vi-VN": "Số dư nghỉ phép", "en-US": "Leave Balance" },
  new_leave: { "zh-CN": "新建请假", "vi-VN": "Tạo nghỉ phép", "en-US": "New Leave" },
  my_leaves: { "zh-CN": "我的请假", "vi-VN": "Nghỉ phép của tôi", "en-US": "My Leaves" },
  leave_type: { "zh-CN": "假别", "vi-VN": "Loại", "en-US": "Type" },
  start_date: { "zh-CN": "开始日期", "vi-VN": "Ngày bắt đầu", "en-US": "Start" },
  end_date: { "zh-CN": "结束日期", "vi-VN": "Ngày kết thúc", "en-US": "End" },
  days_count: { "zh-CN": "天数", "vi-VN": "Số ngày", "en-US": "Days" },
  reason: { "zh-CN": "原因", "vi-VN": "Lý do", "en-US": "Reason" },
  leave_status_pending: { "zh-CN": "审批中", "vi-VN": "Chờ duyệt", "en-US": "Pending" },
  leave_status_approved: { "zh-CN": "已批准", "vi-VN": "Đã duyệt", "en-US": "Approved" },
  leave_status_rejected: { "zh-CN": "已拒绝", "vi-VN": "Đã từ chối", "en-US": "Rejected" },
  // Attendance
  attendance_stats: { "zh-CN": "考勤统计", "vi-VN": "Thống kê", "en-US": "Stats" },
  normal: { "zh-CN": "正常", "vi-VN": "Bình thường", "en-US": "Normal" },
  late: { "zh-CN": "迟到", "vi-VN": "Đi trễ", "en-US": "Late" },
  early: { "zh-CN": "早退", "vi-VN": "Về sớm", "en-US": "Early" },
  absent: { "zh-CN": "缺勤", "vi-VN": "Vắng mặt", "en-US": "Absent" },
  // Salary
  salary_detail: { "zh-CN": "工资详情", "vi-VN": "Chi tiết lương", "en-US": "Salary Details" },
  net_salary: { "zh-CN": "实发工资", "vi-VN": "Lương thực nhận", "en-US": "Net Salary" },
  gross_salary: { "zh-CN": "应发工资", "vi-VN": "Tổng lương", "en-US": "Gross Salary" },
  deductions: { "zh-CN": "扣款", "vi-VN": "Khấu trừ", "en-US": "Deductions" },
  base_salary: { "zh-CN": "基本工资", "vi-VN": "Lương cơ bản", "en-US": "Base Salary" },
  ot_pay: { "zh-CN": "加班费", "vi-VN": "Tăng ca", "en-US": "OT Pay" },
  bonus: { "zh-CN": "奖金", "vi-VN": "Thưởng", "en-US": "Bonus" },
  // Notifications
  notif_title: { "zh-CN": "通知", "vi-VN": "Thông báo", "en-US": "Notifications" },
  mark_read: { "zh-CN": "标记已读", "vi-VN": "Đánh dấu đã đọc", "en-US": "Mark Read" },
  no_notifications: { "zh-CN": "暂无通知", "vi-VN": "Không có thông báo", "en-US": "No notifications" },
  // Profile
  my_profile: { "zh-CN": "个人信息", "vi-VN": "Thông tin cá nhân", "en-US": "My Profile" },
  settings: { "zh-CN": "设置", "vi-VN": "Cài đặt", "en-US": "Settings" },
  about: { "zh-CN": "关于", "vi-VN": "Giới thiệu", "en-US": "About" },
  version: { "zh-CN": "版本", "vi-VN": "Phiên bản", "en-US": "Version" },
};

export function t(key: string, locale: Locale): string {
  return dict[key]?.[locale] ?? key;
}
