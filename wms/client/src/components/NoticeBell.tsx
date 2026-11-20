import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@client/src/i18n';
import { logger } from '@client/src/utils/logger';
import { Bell, CheckCheck } from 'lucide-react';
import {
  getNotices,
  getUnreadNoticeCount,
  markAllNoticesRead,
  markNoticeRead,
  type SysNotice,
} from '@client/src/api/notice';

/**
 * 顶部消息铃铛（MRB 抄送 / 后续返工提醒都走这里）。
 *
 * 为什么轮询而不是 WebSocket：
 *   本系统是内网单机部署，消息量极小（一天几十条），上 WS 要维护连接、
 *   处理重连与心跳，收益远不如一个 60s 的 COUNT 查询（走
 *   `(user_id, is_read, _created_at)` 索引，成本可忽略）。
 *
 * 为什么切到后台就少轮询：`document.hidden` 时不发请求，
 * 避免用户挂着几十个标签页把服务端打满。
 */
const POLL_INTERVAL_MS = 60_000;

const fmtTime = (v: string | null): string => {
  if (!v) return '';
  // 只显示到分钟，跨天加日期，避免窄面板里一长串 ISO
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 16).replace('T', ' ');
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
};

const NoticeBell: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<SysNotice[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const fetchCount = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await getUnreadNoticeCount();
      setUnread(Number(res?.data?.count ?? 0));
    } catch (error) {
      // 角标失败不打扰用户，只留痕
      logger.error('get unread notice count failed', error);
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const timer = window.setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchCount]);

  // 点空白处收起
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getNotices({ page: 1, pageSize: 20 });
      setItems(res?.data?.items ?? []);
    } catch (error) {
      logger.error('get notices failed', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  };

  const handleItemClick = async (n: SysNotice) => {
    if (!n.isRead) {
      try {
        await markNoticeRead(n.id);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
        setUnread((v) => Math.max(0, v - 1));
      } catch (error) {
        logger.error('mark notice read failed', error);
      }
    }
    setOpen(false);
    // 消息来源：MRB 抄送、返工复检、不良品调拨待办。各自跳对应列表（列表页可按单号再筛）
    if (n.bizType === 'mrb') navigate('/mrb/list');
    else if (n.bizType === 'rework') navigate('/rework/list');
    else if (n.bizType === 'defective_move') navigate('/inventory/defective-transfer');
  };

  const handleReadAll = async () => {
    try {
      await markAllNoticesRead();
      setItems((prev) => prev.map((x) => ({ ...x, isRead: true })));
      setUnread(0);
    } catch (error) {
      logger.error('mark all notices read failed', error);
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={handleToggle}
        className="relative flex items-center px-2 py-1.5 text-muted-foreground hover:text-primary hover:bg-primary-soft rounded-md transition-colors duration-150"
        title={t('notice.title')}
        aria-label={t('notice.title')}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-destructive text-xs leading-[15px] text-white text-center font-medium">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 bg-popover/95 backdrop-blur-xl border border-border/60 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
            <span className="text-xs font-medium text-foreground">
              {t('notice.title')}
              {unread > 0 ? `（${unread}）` : ''}
            </span>
            {items.some((x) => !x.isRead) && (
              <button
                onClick={handleReadAll}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
              >
                <CheckCheck size={12} />
                {t('notice.readAll')}
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t('common.loading')}
              </div>
            ) : items.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t('notice.empty')}
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  className={`w-full text-left px-3 py-2 border-b border-border/40 last:border-b-0 hover:bg-muted transition-colors ${
                    n.isRead ? '' : 'bg-primary-soft/40'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && (
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate">
                        {n.title}
                      </div>
                      {n.content && (
                        <div className="mt-0.5 text-xs text-muted-foreground whitespace-pre-line line-clamp-3">
                          {n.content}
                        </div>
                      )}
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {fmtTime(n.createdAt)}
                        {n.bizNo ? ` ｜ ${n.bizNo}` : ''}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NoticeBell;
