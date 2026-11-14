import { apiGet, apiPost } from './request';

/**
 * 站内消息（顶部铃铛）。
 *
 * 消息只属于登录人一条，服务端按 JWT 过滤，前端**不传 userId**——
 * 传了也只会让人误以为「可以看别人的消息」。
 */

export interface SysNotice {
  id: string;
  title: string;
  content: string | null;
  /** mrb / rework / system */
  bizType: string;
  bizId: string | null;
  bizNo: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export function getNotices(params: { page?: number; pageSize?: number; onlyUnread?: boolean } = {}) {
  return apiGet<{ code: number; message: string; data: { items: SysNotice[]; total: number } }>(
    '/api/notices',
    params,
  );
}

export function getUnreadNoticeCount() {
  return apiGet<{ code: number; message: string; data: { count: number } }>(
    '/api/notices/unread-count',
  );
}

export function markNoticeRead(id: string) {
  return apiPost<{ code: number; message: string; data: { updated: number } }>(
    `/api/notices/${id}/read`,
    {},
  );
}

export function markAllNoticesRead() {
  return apiPost<{ code: number; message: string; data: { updated: number } }>(
    '/api/notices/read-all',
    {},
  );
}
