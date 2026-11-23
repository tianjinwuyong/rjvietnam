// Local trilingual strings for the virtual factory scene.
// Deliberately NOT wired into apps/web/src/i18n.ts (other lane owns that file).
import type { Locale } from "./types";

export const LOCALES: Locale[] = ["zh-CN", "vi-VN", "en-US"];

export const LOCALE_NAMES: Record<Locale, string> = {
  "zh-CN": "中文",
  "vi-VN": "Tiếng Việt",
  "en-US": "English",
};

type Entry = Record<Locale, string>;

const S: Record<string, Entry> = {
  "app.title": { "zh-CN": "瑞晶虚拟工厂", "vi-VN": "Nhà máy ảo RuiJing", "en-US": "RuiJing Virtual Factory" },
  "app.subtitle": { "zh-CN": "AI 虚拟员工 · 实时自主运行", "vi-VN": "Nhân viên ảo AI · vận hành tự động thời gian thực", "en-US": "AI virtual employees · live autonomous shift" },
  "app.connecting": { "zh-CN": "正在连接工厂系统…", "vi-VN": "Đang kết nối hệ thống nhà máy…", "en-US": "Connecting to factory system…" },
  "app.loginFailed": { "zh-CN": "开发令牌获取失败", "vi-VN": "Không lấy được mã thông báo dev", "en-US": "Dev token bootstrap failed" },
  "app.retry": { "zh-CN": "重试", "vi-VN": "Thử lại", "en-US": "Retry" },
  "app.loading": { "zh-CN": "正在加载虚拟员工…", "vi-VN": "Đang tải nhân viên ảo…", "en-US": "Loading virtual employees…" },
  "app.loadFailed": { "zh-CN": "数据加载失败：{detail}（每 10 秒自动重试）", "vi-VN": "Tải dữ liệu thất bại: {detail} (tự thử lại mỗi 10 giây)", "en-US": "Data load failed: {detail} (auto-retrying every 10 s)" },
  "app.empty": { "zh-CN": "暂无启用的虚拟员工", "vi-VN": "Chưa có nhân viên ảo nào được bật", "en-US": "No enabled virtual employees" },
  "stats.onShift": { "zh-CN": "在岗", "vi-VN": "Đang ca", "en-US": "On shift" },
  "stats.executors": { "zh-CN": "自主执行", "vi-VN": "Thực thi chủ động", "en-US": "Executors" },
  "stats.openTasks": { "zh-CN": "待办任务", "vi-VN": "Việc đang mở", "en-US": "Open tasks" },
  "stats.approvals": { "zh-CN": "待人工审批", "vi-VN": "Chờ phê duyệt", "en-US": "Awaiting approval" },
  "legend.active": { "zh-CN": "自主执行者", "vi-VN": "Người thực thi chủ động", "en-US": "Active executor" },
  "legend.scaffold": { "zh-CN": "受控骨架", "vi-VN": "Khung có kiểm soát", "en-US": "Governed scaffold" },
  "legend.waiting": { "zh-CN": "等待人工审批", "vi-VN": "Đang chờ người duyệt", "en-US": "Waiting for human approval" },
  "controls.autoRotate": { "zh-CN": "自动环视", "vi-VN": "Tự xoay", "en-US": "Auto-orbit" },
  "controls.autoRotateOn": { "zh-CN": "自动环视：开", "vi-VN": "Tự xoay: BẬT", "en-US": "Auto-orbit: on" },
  "controls.autoRotateOff": { "zh-CN": "自动环视：关", "vi-VN": "Tự xoay: TẮT", "en-US": "Auto-orbit: off" },
  "controls.hint": {
    "zh-CN": "拖拽旋转 · 滚轮或 +/− 缩放 · 点击或 ← → 切换员工 · ↑ ↓ 视角 · H 主页 · F 聚焦 · 1/2/3 前/侧/顶",
    "vi-VN": "Kéo để xoay · lăn hoặc +/− để phóng · nhấp hoặc ← → chọn nhân viên · ↑ ↓ góc nhìn · H trang chủ · F tập trung · 1/2/3 trước/bên/trên",
    "en-US": "Drag to orbit · scroll or +/− to zoom · click or ← → to cycle workers · ↑ ↓ view · H home · F focus · 1/2/3 front/side/top",
  },
  "controls.prev": { "zh-CN": "上一位员工", "vi-VN": "Nhân viên trước", "en-US": "Previous worker" },
  "controls.next": { "zh-CN": "下一位员工", "vi-VN": "Nhân viên tiếp", "en-US": "Next worker" },
  "controls.worker": { "zh-CN": "聚焦员工", "vi-VN": "Xem nhân viên", "en-US": "Focus worker" },
  "controls.overview": { "zh-CN": "工厂总览", "vi-VN": "Tổng quan nhà máy", "en-US": "Factory overview" },
  "controls.home": { "zh-CN": "回到主页视角", "vi-VN": "Về góc nhìn mặc định", "en-US": "Home view" },
  "controls.zoomIn": { "zh-CN": "放大", "vi-VN": "Phóng to", "en-US": "Zoom in" },
  "controls.zoomOut": { "zh-CN": "缩小", "vi-VN": "Thu nhỏ", "en-US": "Zoom out" },
  "controls.front": { "zh-CN": "正面视角", "vi-VN": "Góc nhìn chính diện", "en-US": "Front view" },
  "controls.side": { "zh-CN": "侧面视角", "vi-VN": "Góc nhìn bên", "en-US": "Side view" },
  "controls.top": { "zh-CN": "俯视视角", "vi-VN": "Góc nhìn từ trên", "en-US": "Top view" },
  "controls.selectionGroup": { "zh-CN": "员工切换", "vi-VN": "Chuyển nhân viên", "en-US": "Worker navigation" },
  "controls.cameraGroup": { "zh-CN": "相机控制", "vi-VN": "Điều khiển camera", "en-US": "Camera controls" },
  "panel.title": { "zh-CN": "员工档案", "vi-VN": "Hồ sơ nhân viên", "en-US": "Employee profile" },
  "panel.close": { "zh-CN": "关闭", "vi-VN": "Đóng", "en-US": "Close" },
  "panel.id": { "zh-CN": "编号", "vi-VN": "Mã", "en-US": "ID" },
  "panel.domain": { "zh-CN": "部门", "vi-VN": "Bộ phận", "en-US": "Domain" },
  "panel.level": { "zh-CN": "职级", "vi-VN": "Cấp bậc", "en-US": "Level" },
  "panel.mode": { "zh-CN": "运行模式", "vi-VN": "Chế độ", "en-US": "Mode" },
  "panel.status": { "zh-CN": "状态", "vi-VN": "Trạng thái", "en-US": "Status" },
  "panel.jobDescription": { "zh-CN": "岗位职责", "vi-VN": "Mô tả công việc", "en-US": "Job description" },
  "panel.capabilities": { "zh-CN": "能力", "vi-VN": "Năng lực", "en-US": "Capabilities" },
  "panel.humanGates": { "zh-CN": "人工审批门", "vi-VN": "Cổng cần người duyệt", "en-US": "Human gates" },
  "panel.taskCounts": { "zh-CN": "任务统计", "vi-VN": "Thống kê việc", "en-US": "Task counts" },
  "panel.none": { "zh-CN": "无", "vi-VN": "Không có", "en-US": "None" },
  "chat.title": { "zh-CN": "对话", "vi-VN": "Trò chuyện", "en-US": "Chat" },
  "chat.placeholder": { "zh-CN": "输入消息，例如：你现在在做什么？", "vi-VN": "Nhập tin nhắn, ví dụ: bạn đang làm gì?", "en-US": "Ask something, e.g. what are you doing?" },
  "chat.send": { "zh-CN": "发送", "vi-VN": "Gửi", "en-US": "Send" },
  "chat.mic": { "zh-CN": "语音输入", "vi-VN": "Nhập bằng giọng nói", "en-US": "Voice input" },
  "chat.you": { "zh-CN": "你", "vi-VN": "Bạn", "en-US": "You" },
  "chat.ve": { "zh-CN": "虚拟员工", "vi-VN": "Nhân viên ảo", "en-US": "VE" },
  "chat.thinking": { "zh-CN": "正在思考…", "vi-VN": "Đang suy nghĩ…", "en-US": "Thinking…" },
  "chat.localFallback": { "zh-CN": "（AI 服务不可用，以下为本地情境回复）", "vi-VN": "(Dịch vụ AI không sẵn; phản hồi theo ngữ cảnh tại máy)", "en-US": "(AI service unavailable — local context reply)" },
  "chat.reply.greeting": { "zh-CN": "你好，我是{name}，{domain}的{level}。目前{mode}，想问任务还是审批？", "vi-VN": "Xin chào, tôi là {name}, {level} của {domain}. Hiện đang {mode}. Bạn muốn hỏi việc hay phê duyệt?", "en-US": "Hi, I'm {name}, {level} in {domain}. Currently {mode}. Ask me about tasks or approvals." },
  "chat.reply.working": { "zh-CN": "我在{zone}值守，当前{status}；手上有{n}个待办任务。", "vi-VN": "Tôi đang trực tại {zone}, trạng thái {status}; đang có {n} việc mở.", "en-US": "I'm at the {zone}, status {status}, with {n} open tasks on my desk." },
  "chat.reply.tasks": { "zh-CN": "我这边有{n}个待办，已完成{d}个任务。", "vi-VN": "Tôi có {n} việc đang mở và đã hoàn thành {d} việc.", "en-US": "I have {n} open tasks and {d} completed in {domain}." },
  "chat.reply.approval": { "zh-CN": "目前有{m}个任务卡在人工审批，这是我当前的阻塞点。", "vi-VN": "Hiện có {m} việc chờ phê duyệt; đó là điểm đang chờ của tôi.", "en-US": "{m} tasks are waiting on a human approval gate — that's my current blocker." },
  "chat.reply.help": { "zh-CN": "我可以汇报岗位、待办、审批和完成数量。直接问这些就可以。", "vi-VN": "Tôi có thể báo cáo ca trực, việc mở, phê duyệt và số việc hoàn thành. Bạn cứ hỏi nhé.", "en-US": "I can report my shift, open tasks, approvals and done count. Just ask about those." },
  "chat.reply.done": { "zh-CN": "本班次我在{domain}已完成{d}个任务。", "vi-VN": "Trong ca này tôi đã hoàn thành {d} việc tại {domain}.", "en-US": "I've completed {d} tasks in {domain} this shift." },
  "chat.reply.fallback": { "zh-CN": "我是{name}，{domain}的{level}，当前{status}。关于任务、审批或值班我都可以说明。", "vi-VN": "Tôi là {name}, {level} của {domain}, trạng thái {status}. Tôi có thể nói về việc, phê duyệt hoặc ca trực.", "en-US": "I'm {name}, {level} in {domain}, status {status}. I can explain my tasks, approvals or shift." },
  "task.OPEN": { "zh-CN": "待办", "vi-VN": "Đang mở", "en-US": "Open" },
  "task.WAITING_APPROVAL": { "zh-CN": "待审批", "vi-VN": "Chờ duyệt", "en-US": "Approval" },
  "task.DONE": { "zh-CN": "已完成", "vi-VN": "Hoàn thành", "en-US": "Done" },
  "mode.ACTIVE_EXECUTOR": { "zh-CN": "自主执行者", "vi-VN": "Thực thi chủ động", "en-US": "Active executor" },
  "mode.GOVERNED_SCAFFOLD": { "zh-CN": "受控骨架", "vi-VN": "Khung có kiểm soát", "en-US": "Governed scaffold" },
  "level.SUPERVISOR": { "zh-CN": "主管", "vi-VN": "Giám sát", "en-US": "Supervisor" },
  "level.SPECIALIST": { "zh-CN": "专员", "vi-VN": "Chuyên viên", "en-US": "Specialist" },
  "level.COORDINATOR": { "zh-CN": "协调员", "vi-VN": "Điều phối viên", "en-US": "Coordinator" },
  "level.PLACEHOLDER": { "zh-CN": "预留岗位", "vi-VN": "Vị trí dự phòng", "en-US": "Placeholder" },
  "status.IDLE": { "zh-CN": "空闲", "vi-VN": "Rảnh", "en-US": "Idle" },
  "status.BUSY": { "zh-CN": "忙碌", "vi-VN": "Bận", "en-US": "Busy" },
  "status.RUNNING": { "zh-CN": "运行中", "vi-VN": "Đang chạy", "en-US": "Running" },
  "status.ERROR": { "zh-CN": "异常", "vi-VN": "Lỗi", "en-US": "Error" },
  "status.OFFLINE": { "zh-CN": "离线", "vi-VN": "Ngoại tuyến", "en-US": "Offline" },
  "bubble.waiting": { "zh-CN": "待人工审批", "vi-VN": "Chờ người duyệt", "en-US": "Awaiting approval" },
  "speech.greeting": { "zh-CN": "你好，我在岗。", "vi-VN": "Xin chào, tôi đang trực ca.", "en-US": "Hello, I'm on shift." },
  "speech.greeting.waiting": { "zh-CN": "{name}在岗：有{n}个任务等待人工审批，需要你确认。", "vi-VN": "{name} đang trực ca: có {n} việc chờ bạn phê duyệt.", "en-US": "{name} on shift: {n} tasks need your approval." },
  "speech.greeting.busy": { "zh-CN": "{name}在岗：手上有{n}个待办，我继续处理。", "vi-VN": "{name} đang trực ca: {n} việc đang mở, tôi tiếp tục xử lý.", "en-US": "{name} on shift: {n} open tasks, I'm on them." },
  "speech.greeting.clear": { "zh-CN": "{name}在岗：工位正常，随时可以交办。", "vi-VN": "{name} đang trực ca: trạm làm việc ổn định, sẵn sàng nhận việc.", "en-US": "{name} on shift: station is clear and ready." },
  "bubble.reason.approval": { "zh-CN": "前往总控台：人工审批阻塞", "vi-VN": "Đi đến bàn điều phối: chờ người duyệt", "en-US": "To command desk: approval blocked" },
  "bubble.reason.workload": { "zh-CN": "前往总控台：任务积压协调", "vi-VN": "Đi đến bàn điều phối: quá tải công việc", "en-US": "To command desk: escalating workload" },
  "bubble.reason.handoff": { "zh-CN": "跨部门交接", "vi-VN": "Bàn giao liên phòng", "en-US": "Cross-department handoff" },
  "ticker.connected": { "zh-CN": "已连接：{n} 名虚拟员工在岗，工厂开始运转", "vi-VN": "Đã kết nối: {n} nhân viên ảo vào ca, nhà máy bắt đầu vận hành", "en-US": "Connected: {n} virtual employees on shift, the factory comes alive" },
  "ticker.newOpen": { "zh-CN": "{name}：新增 {n} 个待办任务", "vi-VN": "{name}: {n} việc mới đang mở", "en-US": "{name}: {n} new open tasks" },
  "ticker.approval": { "zh-CN": "{name}：{n} 个任务等待人工审批", "vi-VN": "{name}: {n} việc chờ người phê duyệt", "en-US": "{name}: {n} tasks waiting for human approval" },
  "ticker.done": { "zh-CN": "{name}：完成了 {n} 个任务", "vi-VN": "{name}: hoàn thành {n} việc", "en-US": "{name}: completed {n} tasks" },
  "ticker.modeChanged": { "zh-CN": "{name}：模式切换为 {mode}", "vi-VN": "{name}: chuyển sang chế độ {mode}", "en-US": "{name}: mode changed to {mode}" },
  "ticker.statusChanged": { "zh-CN": "{name}：状态变为 {status}", "vi-VN": "{name}: trạng thái chuyển thành {status}", "en-US": "{name}: status is now {status}" },
  "ticker.enabled": { "zh-CN": "{name}：已上岗", "vi-VN": "{name}: đã vào ca", "en-US": "{name}: came on shift" },
  "ticker.disabled": { "zh-CN": "{name}：已离岗", "vi-VN": "{name}: đã rời ca", "en-US": "{name}: went off shift" },
  "zone.warehouse": { "zh-CN": "仓储区", "vi-VN": "Kho nguyên liệu", "en-US": "Warehouse" },
  "zone.receiving": { "zh-CN": "收料月台", "vi-VN": "Khu nhận hàng", "en-US": "Receiving dock" },
  "zone.quality": { "zh-CN": "IQC / 品质实验室", "vi-VN": "IQC / Phòng chất lượng", "en-US": "IQC / Quality lab" },
  "zone.smt": { "zh-CN": "SMT 产线", "vi-VN": "Chuyền SMT", "en-US": "SMT lines" },
  "zone.packing": { "zh-CN": "包装出货", "vi-VN": "Đóng gói & xuất hàng", "en-US": "Packing / Shipping" },
  "zone.pmc": { "zh-CN": "计划办公室", "vi-VN": "Phòng kế hoạch", "en-US": "Planning office" },
  "zone.office": { "zh-CN": "综合办公区", "vi-VN": "Khối văn phòng", "en-US": "Office block" },
  "zone.maintenance": { "zh-CN": "维修车间", "vi-VN": "Xưởng bảo trì", "en-US": "Maintenance bay" },
  "zone.it": { "zh-CN": "服务器机房", "vi-VN": "Phòng máy chủ", "en-US": "Server corner" },
  "zone.cmd": { "zh-CN": "总控台", "vi-VN": "Bục điều phối", "en-US": "Supervisor podium" },
  "zone.finance": { "zh-CN": "财务", "vi-VN": "Tài chính", "en-US": "Finance" },
  "zone.hr": { "zh-CN": "人事", "vi-VN": "Nhân sự", "en-US": "HR" },
  "zone.oa": { "zh-CN": "行政", "vi-VN": "Hành chính", "en-US": "OA" },
  "domain.wms": { "zh-CN": "仓储", "vi-VN": "Kho", "en-US": "WMS" },
  "domain.quality": { "zh-CN": "品质", "vi-VN": "Chất lượng", "en-US": "Quality" },
  "domain.mes": { "zh-CN": "制造", "vi-VN": "Sản xuất", "en-US": "MES" },
  "domain.pmc": { "zh-CN": "计划", "vi-VN": "Kế hoạch", "en-US": "PMC" },
  "domain.procurement": { "zh-CN": "采购", "vi-VN": "Mua hàng", "en-US": "Procurement" },
  "domain.maintenance": { "zh-CN": "设备维护", "vi-VN": "Bảo trì", "en-US": "Maintenance" },
  "domain.finance": { "zh-CN": "财务", "vi-VN": "Tài chính", "en-US": "Finance" },
  "domain.hr": { "zh-CN": "人事", "vi-VN": "Nhân sự", "en-US": "HR" },
  "domain.it": { "zh-CN": "IT", "vi-VN": "CNTT", "en-US": "IT" },
  "domain.cmd": { "zh-CN": "总控", "vi-VN": "Điều phối", "en-US": "Command" },
  "domain.oa": { "zh-CN": "行政", "vi-VN": "Hành chính", "en-US": "OA" },
  "domain.supplier": { "zh-CN": "供应商", "vi-VN": "Nhà cung cấp", "en-US": "Supplier" },
};

/** Translate a key with optional {placeholder} interpolation. Unknown keys fall back to en-US, then the key itself. */
export function t(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = S[key];
  let text = entry ? entry[locale] || entry["en-US"] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

/** Localized domain name with raw-code fallback for unknown domains. */
export function domainLabel(domain: string, locale: Locale): string {
  return S[`domain.${domain}`] ? t(`domain.${domain}`, locale) : domain.toUpperCase();
}

/** Localized mode/status/level with raw fallback (forward-compatible with new backend values). */
export function modeLabel(mode: string | undefined, locale: Locale): string {
  if (!mode) return "—";
  return S[`mode.${mode}`] ? t(`mode.${mode}`, locale) : mode;
}
export function statusLabel(status: string | undefined, locale: Locale): string {
  if (!status) return "—";
  return S[`status.${status}`] ? t(`status.${status}`, locale) : status;
}
export function levelLabel(level: string | undefined, locale: Locale): string {
  if (!level) return "—";
  return S[`level.${level}`] ? t(`level.${level}`, locale) : level;
}
