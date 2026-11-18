// 定时任务：超时扫描、上岗证到期提醒、设备保养任务生成
// 用轻量自调度实现，不引入 cron 依赖
import { many, one, query } from '../db/index.js';
import { config } from '../config/index.js';
import { scanTimeout } from './flow-engine.js';
import { notify } from './notify.js';
import { scanCalibrationAlerts } from './equipment-alert.js';
import { generateInspectTasks } from './modules-service.js';
import { generateIpqcTasks } from './ipqc-service.js';
import { scanEcnReminders, scanExternalQuarterly, scanPeriodicReview } from './doc-cron.js';
import { purgeExpiredTrash } from './drive-service.js';
import { scanMeetingReminders, scanActionOverdue } from './meeting-service.js';
import { scanOverdue } from './comp-service.js';
import { rotateLogIfNeeded } from './logger.js';
import { scanIntegrationAlerts } from './integration-alert.js';
import { runIntegrationReconcile } from './integration-reconcile.js';

const timers = [];

function schedule(fn, intervalMin, name) {
  const tick = async () => {
    try {
      const n = await fn();
      if (n) console.log(`[cron] ${name}: 处理 ${n} 条`);
    } catch (err) {
      console.error(`[cron] ${name} 执行失败:`, err.message);
    }
  };
  // 首延迟 10 秒，之后按周期执行
  const timer = setInterval(tick, intervalMin * 60000);
  timer.unref?.();
  timers.push(timer);
  setTimeout(tick, 10000).unref?.();
}

/** 上岗证到期检查：提前 cert_warn_days 天提醒，复核后已过期的置为 expired */
async function checkCertificateExpiry() {
  const cfg = await one(`SELECT value FROM sys_config WHERE key = 'cert_warn_days'`);
  const warnDays = Number(cfg?.value || 30);

  const expiring = await many(
    `SELECT c.id, c.cert_no, c.expire_at, c.user_id, u.real_name
       FROM staff_certificate c JOIN org_user u ON u.id = c.user_id
      WHERE c.status = 'valid'
        AND c.expire_at <= now() + ($1 || ' days')::interval`,
    [warnDays]
  );
  for (const c of expiring) {
    const days = Math.ceil((new Date(c.expire_at) - Date.now()) / 86400000);
    await notify(c.user_id, {
      title: `【上岗证到期提醒】${c.real_name}`,
      content: `上岗证 ${c.cert_no} 将于 ${c.expire_at} 到期（剩余 ${days} 天），需重新考试合格后换发。`,
      link: '/training/certificate',
      category: 'reminder',
    });
    await query(`UPDATE staff_certificate SET status = 'expiring' WHERE id = $1`, [c.id]);
  }

  const expired = await query(
    `UPDATE staff_certificate SET status = 'expired'
      WHERE status IN ('valid','expiring') AND expire_at < now()`
  );
  return expiring.length + expired.rowCount;
}

/** 设备保养点检与外校：按周期生成任务并提醒责任人 */
async function generateEquipmentTasks() {
  const rows = await many(
    `SELECT id, code, name, next_maintain_date, next_external_date, department_id
       FROM equipment
      WHERE status = 'running'
        AND (next_maintain_date <= current_date OR next_external_date <= current_date)`
  );
  let created = 0;

  for (const eq of rows) {
    // 保养
    if (eq.next_maintain_date && eq.next_maintain_date <= new Date().toISOString().slice(0, 10)) {
      const dup = await one(
        `SELECT 1 FROM equipment_task WHERE equipment_id=$1 AND task_type='maintain'
           AND status='pending' AND plan_date >= current_date - interval '1 day'`,
        [eq.id]
      );
      if (!dup) {
        const staff = await one(
          `SELECT u.id FROM org_user u WHERE u.department_id = $1 AND u.active = TRUE LIMIT 1`,
          [eq.department_id]
        );
        const task = (await query(
          `INSERT INTO equipment_task (equipment_id, task_type, plan_date, assignee_id, status)
           VALUES ($1,'maintain',$2,$3,'pending') RETURNING id`,
          [eq.id, eq.next_maintain_date, staff?.id || null]
        )).rows[0];
        // 推送到下一次保养日期
        const next = new Date(eq.next_maintain_date);
        const cycle = (await one(`SELECT maintain_cycle_days FROM equipment WHERE id=$1`, [eq.id]))?.maintain_cycle_days || 30;
        next.setDate(next.getDate() + cycle);
        await query(`UPDATE equipment SET next_maintain_date = $2 WHERE id = $1`,
          [eq.id, next.toISOString().slice(0, 10)]);
        if (staff) {
          await notify(staff.id, {
            title: `【保养任务】${eq.name}`,
            content: `设备「${eq.name}」（${eq.code}）的定期保养已到期，任务号 #${task.id}。`,
            link: `/equipment/task/${task.id}`,
            category: 'todo',
          });
        }
        created++;
      }
    }

    // 外校
    if (eq.next_external_date && eq.next_external_date <= new Date().toISOString().slice(0, 10)) {
      const dup = await one(
        `SELECT 1 FROM equipment_task WHERE equipment_id=$1 AND task_type='external'
           AND status='pending' AND plan_date >= current_date - interval '1 day'`,
        [eq.id]
      );
      if (!dup) {
        const info = await one(`SELECT external_cycle_days FROM equipment WHERE id=$1`, [eq.id]);
        const task = (await query(
          `INSERT INTO equipment_task (equipment_id, task_type, plan_date, status)
           VALUES ($1,'external',$2,'pending') RETURNING id`,
          [eq.id, eq.next_external_date]
        )).rows[0];
        const next = new Date(eq.next_external_date);
        next.setDate(next.getDate() + (info?.external_cycle_days || 365));
        await query(`UPDATE equipment SET next_external_date = $2 WHERE id = $1`,
          [eq.id, next.toISOString().slice(0, 10)]);
        const staff = await many(
          `SELECT u.id FROM org_user u
             JOIN sys_user_role ur ON ur.user_id = u.id
             JOIN sys_role r ON r.id = ur.role_id
            WHERE r.code = 'admin' AND u.active = TRUE LIMIT 5`
        );
        for (const s of staff) {
          await notify(s.id, {
            title: `【外校到期】${eq.name}`,
            content: `设备「${eq.name}」（${eq.code}）外部校准已到期，请安排外校，任务号 #${task.id}。`,
            link: '/equipment',
            category: 'reminder',
          });
        }
        created++;
      }
    }
  }
  return created;
}

/**
 * ECN 4 小时提醒扫描（S8 需求 A9）。
 * doc-cron 的扫描函数带内部去重（同人同实例 24h 只提醒一次），故可高频调度。
 * @returns {Promise<number>} 新增提醒条数
 */
async function runEcnReminders() {
  return scanEcnReminders();
}

/** 外来文件季度评审扫描（S8 需求 A14），按天粒度调度 */
async function runExternalQuarterly() {
  return scanExternalQuarterly();
}

/** 体系文件 2 年定期评审扫描，按天粒度调度 */
async function runPeriodicReview() {
  return scanPeriodicReview();
}

/** 公共盘回收站「7 个工作日」自动清理（用户口径 2026-10-12），按天粒度调度 */
async function runTrashPurge() {
  const r = await purgeExpiredTrash();
  if (r.total) console.log(`[cron] 回收站7工作日清理: 文件 ${r.files} 条、文件夹 ${r.folders} 条、物理文件 ${r.physicalDeleted} 个`);
  return r.total;
}

/** 会议会前提醒扫描：会前 remind_hours 内推送（函数内部按"同会议同日"去重，故可较高频调度） */
async function runMeetingReminders() {
  return scanMeetingReminders();
}

/** 会议待办逾期扫描：due < 今天且未关闭（函数内部按"同事项同日"去重，可每日调度） */
async function runMeetingOverdue() {
  return scanActionOverdue();
}

/**
 * 【调休】欠班逾期提醒扫描（第 35 轮）。
 * 扫描 open 且临近/超过应还截止日的欠班，逐条给本人推送提醒并抄送 HR。
 * 同日同欠班不重复提醒（用 notify 的 link + 当日去重口径：按 ledger id 生成唯一 link 片段）。
 */
async function runCompOweAlert() {
  let scan;
  try {
    scan = await scanOverdue();
  } catch (err) {
    if (err?.code === '42P01') return 0; // 账本表未迁移
    throw err;
  }
  const rows = scan?.rows || [];
  if (!rows.length) return 0;
  let sent = 0;
  for (const r of rows) {
    const overdue = !!r.overdue;
    const title = overdue ? '欠班已逾期未补' : '欠班即将到期提醒';
    const content = `您 ${String(r.work_date).slice(0, 10)} 的欠班 ${Number(r.hours)} 小时，` +
      (overdue ? `应还截止日 ${String(r.expire_date).slice(0, 10)} 已过，请尽快安排补班或申请年假抵扣。`
               : `应还截止日 ${String(r.expire_date).slice(0, 10)}（剩余 ${Number(r.days_left)} 天），请按时补班。`);
    try {
      await notify(r.user_id, { title, content, link: '/attendance/comp', category: 'todo' });
      sent++;
    } catch { /* 已忽略 */ }
  }
  return sent;
}

/**
 * 会话表清理：删除"过期超过 7 天"的会话，并顺带清理 90 天前的已读通知。
 * 保留 7 天而非过期即删：多留窗口便于排障（追溯最近登录/设备），且条件更保守、更不易误删；
 *   删除条件 `expires_at < now()-7d` 与活跃计数条件 `expires_at > ref` 天然互斥，故计数行永不被删。
 */
let sessionPurgeRunning = false;                     // ★ 重入保护：cron.js 的 tick 无 in-flight 标志，耗时超间隔会并发重入
export async function runSessionPurge() {
  if (sessionPurgeRunning) return 0;                 // 上一轮未结束 → 跳过本轮
  sessionPurgeRunning = true;
  try {
    const ref = new Date();                          // 固定参照：now() 会走，ref 不走，避免跨语句自然过期漂移误报
    const before = (await one(`SELECT COUNT(*)::int AS n FROM sys_session WHERE expires_at > $1`, [ref])).n;
    const s = await query(`DELETE FROM sys_session WHERE expires_at < now() - interval '7 days'`);
    const after = (await one(`SELECT COUNT(*)::int AS n FROM sys_session WHERE expires_at > $1`, [ref])).n;
    if (after < before) throw new Error(`活跃会话数下降 ${before}→${after}，疑似误删，已中止`);
    const n = await query(`DELETE FROM notification WHERE read_at IS NOT NULL AND created_at < now() - interval '90 days'`);
    if (n.rowCount) console.log(`[cron] 通知清理: 删除 ${n.rowCount} 条已读旧通知`);
    return s.rowCount;                               // schedule() 打印「会话清理: 处理 N 条」
  } finally {
    sessionPurgeRunning = false;                     // ★ 异常也复位；错误抛给 cron.js 既有 try/catch 记日志、不崩进程
  }
}

/**
 * 日志轮转巡检：每 10 分钟检查当前日志是否超限，超限则同步轮转。
 * 与写入侧的尺寸判断互为双保险（幂等）：正常情况下写入侧已经轮转过，此处多为 0。
 */
let logRotateRunning = false;                        // ★ 重入保护：tick 无 in-flight 标志，巡检耗时超间隔会并发重入
export async function runLogRotate() {
  if (logRotateRunning) return 0;                    // 上一轮未结束 → 跳过本轮
  logRotateRunning = true;
  try {
    return rotateLogIfNeeded() ? 1 : 0;              // 返回 1 ⇒ schedule 打印「日志轮转: 处理 1 条」
  } finally {
    logRotateRunning = false;                        // ★ 异常也复位
  }
}

/* ---------------- 集成中枢：告警扫描 / 对账 ---------------- */
/** 5 分钟一轮：回写失败、卡住、积压、系统不可达 → 产生告警并通知管理员 */
async function runIntegrationAlertScan() {
  const r = await scanIntegrationAlerts();
  return r.raised || 0;   // 只有真产生新告警才打印，避免每 5 分钟刷一行
}

/** 6 小时一轮：回写对账 + IQC 三向对账；返回差异条数供日志打印 */
async function runIntegrationReconcileCron() {
  const r = await runIntegrationReconcile({ hours: 72, iqc: true, kind: 'cron' });
  return (r.outbox?.diffs || 0) + (r.iqc?.diffs || 0);
}

export function startCron() {
  schedule(scanTimeout, config.cron.scanTimeout, '流程超时扫描');  schedule(checkCertificateExpiry, config.cron.scanCertificate, '上岗证到期检查');
  schedule(generateEquipmentTasks, config.cron.scanEquipment, '设备保养任务生成');
  // 外校分级预警：复用 scanEquipment 周期（默认每日），按剩余天数递进升级推送
  schedule(scanCalibrationAlerts, config.cron.scanEquipment, '设备外校分级预警');
  // 点检任务生成：按模板频率驱动（S3-T04）
  schedule(generateInspectTasks, config.cron.scanEquipment, '设备点检任务生成');
  // IPQC 巡线任务生成（S4：按模板产线+班次每日生成）
  schedule(generateIpqcTasks, config.cron.scanIpqc, 'IPQC 巡线任务生成');
  // 体系文件定时扫描（S8：挂载 doc-cron，需求 A9/A14）
  //   ECN 4 小时下发提醒 → 每小时扫一次（函数内部有 4h/24h 去重）
  schedule(runEcnReminders, 60, 'ECN 超时提醒');
  //   外来文件季度评审 / 文件 2 年定期评审 → 按天粒度足够，每天扫一次
  schedule(runExternalQuarterly, 1440, '外来文件季度评审');
  schedule(runPeriodicReview, 1440, '体系文件定期评审');
  // 公共盘回收站「7 个工作日」自动清理（用户口径 2026-10-12），每天扫一次
  // 工作日仅排除周六周日，不含法定节假日；到点后真删物理文件。
  schedule(runTrashPurge, 1440, '回收站7工作日清理');
  // 会议模块：会前提醒（默认提前 24h，函数内同日去重）每小时扫一次
  schedule(runMeetingReminders, config.cron.scanMeeting, '会议会前提醒');
  // 会议模块：待办逾期扫描（默认每日 08:00 口径，函数内同日去重）每天扫一次
  schedule(runMeetingOverdue, 1440, '会议待办逾期扫描');
  // 调休模块：欠班逾期提醒（临近/超过应还截止日推送本人）每天扫一次
  schedule(runCompOweAlert, 1440, '欠班逾期提醒');
  // 会话清理：每日一次；过期后保留 7 天便于排障（首次清理预期删 0 行）
  schedule(runSessionPurge, 1440, '会话清理');
  // 日志轮转：每 10 分钟巡检一次（与写入侧尺寸判断互备）
  schedule(runLogRotate, 10, '日志轮转');
  // 集成中枢：告警扫描 5 分钟一轮、对账 6 小时一轮（用户 2026-10-26 补齐）
  schedule(runIntegrationAlertScan, 5, '集成告警扫描');
  schedule(runIntegrationReconcileCron, 360, '集成对账');
  console.log('  定时任务已启动');
}

export function stopCron() {
  timers.forEach(t => clearInterval(t));
  timers.length = 0;
}

// 供手工触发调试
export {
  scanTimeout, checkCertificateExpiry, generateEquipmentTasks, scanCalibrationAlerts,
  generateInspectTasks, generateIpqcTasks,
  runEcnReminders, runExternalQuarterly, runPeriodicReview, runTrashPurge,
  runMeetingReminders, runMeetingOverdue,
};
// runSessionPurge 已用 `export async function` 直接导出（契约 §3.2），此处不得重复导出