/**
 * 会议模块 · 路由（一期）
 * ----------------------------------------------------------------------------
 * 前缀：/api/meeting。
 * 鉴权：登录（authenticate）。写操作的权限由服务层按「关系 + 管理权 + 管理员」判定
 *       （一期：可见性隔离集中实现，详见 services/meeting-service.js）。
 * 路由顺序：静态段（series / actions / decisions / minutes）必须先于动态段 :id 注册，
 *           照 routes/system.js 里 /minutes/export 在 /:id 之前的既有做法。
 */
import { authenticate, ok, wrap } from '../middleware/index.js';
import { toId } from '../utils/params.js';
import { listMinutes } from '../services/minutes-service.js';
import {
  // 系列
  listSeries, getSeries, createSeries, updateSeries, deleteSeries,
  // 会议
  listMeetings, getMeeting, createMeeting, updateMeeting,
  scheduleMeeting, rescheduleMeeting, cancelMeeting, startMeeting, endMeeting, closeMeeting, deleteMeeting,
  // 参会人
  listAttendees, addAttendees, updateAttendee, removeAttendee, markAttend, notifyMeeting,
  // 纪要
  saveMinutes, confirmMinutes,
  // 决议
  listDecisions, createDecision, updateDecision, deleteDecision,
  // 待办
  listActions, getAction, createAction, updateAction,
  addProgress, claimAction, doneAction, closeAction, reopenAction, cancelAction, deleteAction,
  // 交付件
  submitDeliverable, reviewDeliverable, listSubmissions, addSubmissionAttachment,
  // 会前回顾
  listReview, handleReview,
  // 跟进表 / 我的待办 / 我的会议 / 导出
  seriesFollowTable, myActions, myMeetings, exportFollow,
} from '../services/meeting-service.js';

export default async function meetingRoutes(app) {
  app.addHook('preHandler', authenticate);

  const withId = (v, msg = '参数不正确') => {
    const id = toId(v);
    if (id === null) throw Object.assign(new Error(msg), { statusCode: 400 });
    return id;
  };

  // ==========================================================================
  // 静态段：系列（/meeting/series ...）
  // ==========================================================================
  app.get('/api/meeting/series', wrap(async (req, reply) =>
    ok(reply, await listSeries(req.query || {}, req.user))));

  app.post('/api/meeting/series', wrap(async (req, reply) =>
    ok(reply, await createSeries(req.body || {}, req.user), '系列已创建')));

  app.get('/api/meeting/series/:id', wrap(async (req, reply) =>
    ok(reply, await getSeries(withId(req.params.id), req.user))));

  app.put('/api/meeting/series/:id', wrap(async (req, reply) =>
    ok(reply, await updateSeries(withId(req.params.id), req.body || {}, req.user), '已保存')));

  app.delete('/api/meeting/series/:id', wrap(async (req, reply) =>
    ok(reply, await deleteSeries(withId(req.params.id), req.user), '系列已停用')));

  // 系列跟进表（一张表：决议 ∪ 待办）+ 导出
  app.get('/api/meeting/series/:id/follow', wrap(async (req, reply) =>
    ok(reply, await seriesFollowTable(withId(req.params.id), req.query || {}, req.user))));

  app.get('/api/meeting/series/:id/follow/export', wrap(async (req, reply) =>
    ok(reply, await exportFollow(withId(req.params.id), req.query || {}, req.user))));

  // ==========================================================================
  // 静态段：决议（/meeting/decisions/:id）
  // ==========================================================================
  app.put('/api/meeting/decisions/:id', wrap(async (req, reply) =>
    ok(reply, await updateDecision(withId(req.params.id), req.body || {}, req.user), '已保存')));

  app.delete('/api/meeting/decisions/:id', wrap(async (req, reply) =>
    ok(reply, await deleteDecision(withId(req.params.id), req.user), '已删除')));

  app.get('/api/meeting/decisions/:id/submissions', wrap(async (req, reply) =>
    ok(reply, await listSubmissions('decision', withId(req.params.id), req.user))));

  app.post('/api/meeting/decisions/:id/deliverables', wrap(async (req, reply) =>
    ok(reply, await submitDeliverable('decision', withId(req.params.id), req.body || {}, req.user), '交付件已提交，待确认')));

  // ==========================================================================
  // 静态段：待办（/meeting/actions ... 与 /meeting/actions/:id ...）
  // ==========================================================================
  app.get('/api/meeting/actions', wrap(async (req, reply) =>
    ok(reply, await myActions(req.query || {}, req.user))));

  app.get('/api/meeting/actions/:id', wrap(async (req, reply) =>
    ok(reply, await getAction(withId(req.params.id), req.user))));

  app.put('/api/meeting/actions/:id', wrap(async (req, reply) =>
    ok(reply, await updateAction(withId(req.params.id), req.body || {}, req.user), '已保存')));

  app.delete('/api/meeting/actions/:id', wrap(async (req, reply) =>
    ok(reply, await deleteAction(withId(req.params.id), req.user), '已删除')));

  app.post('/api/meeting/actions/:id/progress', wrap(async (req, reply) =>
    ok(reply, await addProgress(withId(req.params.id), req.body || {}, req.user), '进展已记录')));

  app.post('/api/meeting/actions/:id/claim', wrap(async (req, reply) =>
    ok(reply, await claimAction(withId(req.params.id), req.user), '已认领')));

  app.post('/api/meeting/actions/:id/done', wrap(async (req, reply) =>
    ok(reply, await doneAction(withId(req.params.id), req.body || {}, req.user), '已标记完成')));

  app.post('/api/meeting/actions/:id/close', wrap(async (req, reply) =>
    ok(reply, await closeAction(withId(req.params.id), req.body || {}, req.user), '已关闭')));

  app.post('/api/meeting/actions/:id/reopen', wrap(async (req, reply) =>
    ok(reply, await reopenAction(withId(req.params.id), req.body || {}, req.user), '已重开')));

  app.post('/api/meeting/actions/:id/cancel', wrap(async (req, reply) =>
    ok(reply, await cancelAction(withId(req.params.id), req.body || {}, req.user), '已取消')));

  // 交付件（待办）
  app.get('/api/meeting/actions/:id/submissions', wrap(async (req, reply) =>
    ok(reply, await listSubmissions('action', withId(req.params.id), req.user))));

  app.post('/api/meeting/actions/:id/deliverables', wrap(async (req, reply) =>
    ok(reply, await submitDeliverable('action', withId(req.params.id), req.body || {}, req.user), '交付件已提交，待确认')));

  // 交付件确认/驳回 + 附件关联
  app.post('/api/meeting/submissions/:id/review', wrap(async (req, reply) =>
    ok(reply, await reviewDeliverable(withId(req.params.id), req.body || {}, req.user), '已处理')));

  app.post('/api/meeting/submissions/:id/attachments', wrap(async (req, reply) =>
    ok(reply, await addSubmissionAttachment(withId(req.params.id), req.body || {}, req.user), '附件已关联')));

  // ==========================================================================
  // 静态段：遗留会议纪要入口（复用现有 /api/org/minutes 语义）
  // ==========================================================================
  app.get('/api/meeting/minutes', wrap(async (req, reply) => {
    const { keyword, page, pageSize } = req.query || {};
    return ok(reply, await listMinutes({ keyword, page, pageSize }));
  }));

  // ==========================================================================
  // 静态段：我的会议（首页「我的会议」栏）。必须先于 /api/meeting/:id 注册。
  // 返回：data 为数组（未结束优先、planned_start 升序）。
  // ==========================================================================
  app.get('/api/meeting/my', wrap(async (req, reply) =>
    ok(reply, await myMeetings(req.user, req.query || {}))));

  // ==========================================================================
  // 动态段：/meeting 列表 与 /meeting/:id
  // ==========================================================================
  app.get('/api/meeting', wrap(async (req, reply) =>
    ok(reply, await listMeetings(req.query || {}, req.user))));

  app.post('/api/meeting', wrap(async (req, reply) =>
    ok(reply, await createMeeting(req.body || {}, req.user), '会议已创建')));

  app.get('/api/meeting/:id', wrap(async (req, reply) =>
    ok(reply, await getMeeting(withId(req.params.id), req.user))));

  app.put('/api/meeting/:id', wrap(async (req, reply) =>
    ok(reply, await updateMeeting(withId(req.params.id), req.body || {}, req.user), '已保存')));

  app.delete('/api/meeting/:id', wrap(async (req, reply) =>
    ok(reply, await deleteMeeting(withId(req.params.id), req.user), '已删除')));

  // 生命周期
  app.post('/api/meeting/:id/schedule', wrap(async (req, reply) =>
    ok(reply, await scheduleMeeting(withId(req.params.id), req.body || {}, req.user), '已发布并通知')));

  app.post('/api/meeting/:id/reschedule', wrap(async (req, reply) =>
    ok(reply, await rescheduleMeeting(withId(req.params.id), req.body || {}, req.user), '已改期并通知')));

  app.post('/api/meeting/:id/cancel', wrap(async (req, reply) =>
    ok(reply, await cancelMeeting(withId(req.params.id), req.body || {}, req.user), '已取消')));

  app.post('/api/meeting/:id/start', wrap(async (req, reply) =>
    ok(reply, await startMeeting(withId(req.params.id), req.user), '会议已开始')));

  app.post('/api/meeting/:id/end', wrap(async (req, reply) =>
    ok(reply, await endMeeting(withId(req.params.id), req.user), '会议已结束')));

  app.post('/api/meeting/:id/close', wrap(async (req, reply) =>
    ok(reply, await closeMeeting(withId(req.params.id), req.user), '会议已关闭')));

  // 参会人
  app.get('/api/meeting/:id/attendees', wrap(async (req, reply) =>
    ok(reply, await listAttendees(withId(req.params.id), req.user))));

  app.post('/api/meeting/:id/attendees', wrap(async (req, reply) =>
    ok(reply, await addAttendees(withId(req.params.id), req.body?.items, req.user), '已添加参会人')));

  app.put('/api/meeting/:id/attendees/:aid', wrap(async (req, reply) =>
    ok(reply, await updateAttendee(withId(req.params.id), withId(req.params.aid), req.body || {}, req.user), '已保存')));

  app.delete('/api/meeting/:id/attendees/:aid', wrap(async (req, reply) =>
    ok(reply, await removeAttendee(withId(req.params.id), withId(req.params.aid), req.user), '已移除')));

  app.post('/api/meeting/:id/attendees/:aid/attend', wrap(async (req, reply) =>
    ok(reply, await markAttend(withId(req.params.id), withId(req.params.aid), req.body || {}, req.user), '已更新到场状态')));

  app.post('/api/meeting/:id/notify', wrap(async (req, reply) =>
    ok(reply, await notifyMeeting(withId(req.params.id), req.body?.userIds, req.user), '已推送')));

  // 纪要（硬门槛：仅 ended/minuted/closed 可写）
  app.put('/api/meeting/:id/minutes', wrap(async (req, reply) =>
    ok(reply, await saveMinutes(withId(req.params.id), req.body || {}, req.user), '纪要已保存')));

  app.post('/api/meeting/:id/minutes/confirm', wrap(async (req, reply) =>
    ok(reply, await confirmMinutes(withId(req.params.id), req.body || {}, req.user), '纪要已确认并发布')));

  // 会议决议 / 待办
  app.get('/api/meeting/:id/decisions', wrap(async (req, reply) =>
    ok(reply, await listDecisions(withId(req.params.id), req.user))));

  app.post('/api/meeting/:id/decisions', wrap(async (req, reply) =>
    ok(reply, await createDecision(withId(req.params.id), req.body || {}, req.user), '决议已记录')));

  app.get('/api/meeting/:id/actions', wrap(async (req, reply) =>
    ok(reply, await listActions(withId(req.params.id), req.user))));

  app.post('/api/meeting/:id/actions', wrap(async (req, reply) =>
    ok(reply, await createAction(withId(req.params.id), req.body || {}, req.user), '待办已创建')));

  // 会前回顾清单
  app.get('/api/meeting/:id/review', wrap(async (req, reply) =>
    ok(reply, await listReview(withId(req.params.id), req.user))));

  app.post('/api/meeting/:id/review/:rid', wrap(async (req, reply) =>
    ok(reply, await handleReview(withId(req.params.id), withId(req.params.rid), req.body || {}, req.user), '已处理')));
}
