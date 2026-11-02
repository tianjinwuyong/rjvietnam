/**
 * OA 事件入队（WMS 侧工具）
 *
 * 为什么单独成文件而不是用 OaOutboxService：
 *   MRB 模块需要入队「处置执行完成」，而 OaOutboxService 在 IQC 模块里、
 *   MrbModule 又被 IqcModule 依赖 —— 互相注入会形成模块环。
 *   这里只依赖 db 句柄，谁都能调，投递仍由 OaOutboxService 统一负责。
 */
import { sql } from 'drizzle-orm';

/**
 * @param {any} db drizzle 实例
 * @param {string} event 事件名（lot.created / mrb.created / mrb.executed）
 * @param {string} bizKey 幂等键
 * @param {Record<string, unknown>} payload
 */
export async function enqueueOaEvent(
  db: any,
  event: string,
  bizKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO oa_event_outbox (event, biz_key, payload)
    VALUES (${event}, ${bizKey}, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT DO NOTHING
  `);
}
