import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { sql } from 'drizzle-orm';

/**
 * 站内消息（顶部铃铛）。
 *
 * 设计取舍：**只做轻量站内消息，不发邮件/短信**。
 *  MRB 的抄送对象（IQC 检验员 / 仓管 / 仓库主管 / 计划主管 / 生产主管）
 *  本来就是系统内部岗位，一天要登几十次系统，站内未读角标足够触达；
 *  上邮件还要配 SMTP、模板、退信处理，投入产出比不成立。
 *
 * 写入侧统一走 `push()`，读取侧只按登录人过滤 —— 消息表没有「广播」概念，
 * 一条消息只属于一个人，避免「已读」状态在多人之间互相打架。
 */
@Injectable()
export class NoticeService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** user_profile 复合类型列的写入表达式（直接传 uuid 字符串会报 22P02） */
  private userLit(userId?: string | null) {
    return userId ? sql`ROW(${userId})::user_profile` : sql`null`;
  }

  /**
   * 推一条消息给一个人。可传 tx 以纳入调用方事务。
   *
   * 为什么允许 tx：抄送必须是「终审成功」的副作用。若先提交 MRB 再单独写消息，
   * 写消息失败就会出现「单子过了但没人收到通知」的静默漏抄；反之放进同一事务，
   * 消息写不进去就整体回滚，问题当场暴露。
   */
  async push(
    params: {
      userId: string;
      title: string;
      content?: string | null;
      bizType?: string;
      bizId?: string | null;
      bizNo?: string | null;
      createdBy?: string | null;
    },
    tx?: any,
  ): Promise<void> {
    if (!params.userId) return;
    const run = async (conn: any) => {
      await conn.execute(sql`
        INSERT INTO sys_notice (user_id, title, content, biz_type, biz_id, biz_no, is_read, _created_by)
        VALUES (
          ${this.userLit(params.userId)},
          ${params.title},
          ${params.content ?? null},
          ${params.bizType || 'mrb'},
          ${params.bizId ?? null},
          ${params.bizNo ?? null},
          false,
          ${this.userLit(params.createdBy ?? null)}
        )
      `);
    };
    if (tx) await run(tx);
    else await this.db.transaction((t) => run(t));
  }

  /** 批量推送（同一标题发给多人） */
  async pushMany(
    params: {
      userIds: string[];
      title: string;
      content?: string | null;
      bizType?: string;
      bizId?: string | null;
      bizNo?: string | null;
      createdBy?: string | null;
    },
    tx?: any,
  ): Promise<number> {
    const ids = [...new Set((params.userIds || []).filter(Boolean))];
    let n = 0;
    for (const userId of ids) {
      await this.push({ ...params, userId }, tx);
      n += 1;
    }
    return n;
  }

  /** 我的消息列表（分页，支持只看未读） */
  async list(params: {
    userId: string;
    page?: number;
    pageSize?: number;
    onlyUnread?: boolean;
  }): Promise<{ items: any[]; total: number }> {
    const { userId } = params;
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
    const offset = (page - 1) * pageSize;
    const unreadCond = params.onlyUnread ? sql` AND is_read = false` : sql``;

    const rows = await this.db.execute(sql`
      SELECT id, title, content, biz_type, biz_id, biz_no, is_read, read_at, _created_at
      FROM sys_notice
      WHERE ((user_id).user_id)::uuid = ${userId}::uuid${unreadCond}
      ORDER BY _created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    const totalRows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM sys_notice
      WHERE ((user_id).user_id)::uuid = ${userId}::uuid${unreadCond}
    `);

    const items = (rows as unknown as Array<Record<string, any>>).map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      bizType: r.biz_type,
      bizId: r.biz_id,
      bizNo: r.biz_no,
      isRead: !!r.is_read,
      readAt: r.read_at,
      createdAt: r._created_at,
    }));

    return {
      items,
      total: Number((totalRows as unknown as Array<{ total: number }>)[0]?.total || 0),
    };
  }

  /** 未读数（铃铛角标；每 30s 轮询一次，务必走 (user_id,is_read,_created_at) 索引） */
  async unreadCount(userId: string): Promise<number> {
    if (!userId) return 0;
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM sys_notice
      WHERE ((user_id).user_id)::uuid = ${userId}::uuid AND is_read = false
    `);
    return Number((rows as unknown as Array<{ cnt: number }>)[0]?.cnt || 0);
  }

  /**
   * 标记已读。
   * `(user_id).user_id = ?` 这个条件是**权限边界**，不是性能优化：
   * 少了它，任何人拿别人的 notice id 就能把别人的消息点成已读。
   */
  async markRead(userId: string, noticeId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      UPDATE sys_notice
      SET is_read = true, read_at = CURRENT_TIMESTAMP
      WHERE id = ${noticeId}::uuid
        AND ((user_id).user_id)::uuid = ${userId}::uuid
        AND is_read = false
      RETURNING id
    `);
    return (rows as unknown as any[]).length;
  }

  /** 全部标为已读 */
  async markAllRead(userId: string): Promise<number> {
    const rows = await this.db.execute(sql`
      UPDATE sys_notice
      SET is_read = true, read_at = CURRENT_TIMESTAMP
      WHERE ((user_id).user_id)::uuid = ${userId}::uuid AND is_read = false
      RETURNING id
    `);
    return (rows as unknown as any[]).length;
  }
}
