import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { catchError, from, mergeMap, throwError, type Observable } from 'rxjs';

import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { operationLog } from '../../database/schema';
import { OPERATION_LOG_RULES, type OperationLogRule } from './operation-log.rules';

/** operation_log 各列的物理长度上限（见 schema.ts），写入前统一截断，避免被 PG 拒绝 */
const MAX_BIZ_NO = 100;
const MAX_OPERATOR_NAME = 100;
const MAX_IP = 50;
const MAX_DETAIL = 2000;

/** 审计明细中需要脱敏的字段名（小写比较） */
const REDACT_KEYS = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'confirmpassword',
  'pwd',
  'token',
  'accesstoken',
  'passwordhash',
  'secret',
  'authorization',
  // 批量导入接口把整个文件以 base64 放在请求体里；不脱敏会把 2000 字符的
  // base64 垃圾写进审计明细，把真正有用的信息挤掉
  'filebase64',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 业务单号候选字段（按优先级）。用于从响应体 / 请求体 / 路径参数中尽力提取
 * 一条「人可读的关联单据号」写入 operation_log.biz_no。
 * 提取不到就留空——审计记录的核心价值在「谁、何时、做了什么」，单号是增强项，
 * 不允许因提取失败而阻断写日志。
 */
const BIZ_NO_KEYS = [
  'bizNo',
  'receiptNo',
  'workOrderNo',
  'workorderNo',
  'mrbNo',
  'pickingNo',
  'requirementNo',
  'returnNo',
  'transferNo',
  'stockTakeNo',
  'stocktakeNo',
  'overPickingNo',
  'paramKey',
  'whCode',
  'locationCode',
  'materialCode',
  'supplierCode',
  'roleCode',
  'account',
  'lotNo',
  'batchNo',
  'code',
  'no',
];

/**
 * 敏感操作审计拦截器（task #117 / BUG-006）
 *
 * 职责：对命中 `OPERATION_LOG_RULES` 的**写操作**，在业务成功后向 operation_log
 * 自动落一条审计记录（操作人 / 时间 / 模块 / 动作 / 关联单据 / IP）。
 *
 * 三条硬约束：
 *  1. **绝不影响主业务**：所有落库动作都包在 try/catch 里，异常只记 warn 日志。
 *     审计是旁路，不能因为写日志失败而让业务请求报错。
 *  2. **只记录成功操作**（`statusCode < 400`）；对标注了 `logFailure` 的动作
 *     （目前仅登录）额外记录失败尝试，action 追加 `_failed`。
 *  3. **先落库再回响应**：用 `mergeMap` 等待写入完成，保证调用方在拿到响应后
 *     立即查审计就能看到记录（QA 回归 TC-SEC-012 依赖这一点）。
 *     本地 PG 单条 insert 约 1ms，对响应时延无感。
 *
 * 埋点范围与排除项见 `operation-log.rules.ts`。
 */
@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // 只处理 HTTP（另有非 HTTP 上下文时直接放行）
    if (context.getType() !== 'http') return next.handle();

    const key = this.buildRouteKey(context);
    const rule = key ? OPERATION_LOG_RULES[key] : undefined;
    if (!rule) return next.handle();

    return next.handle().pipe(
      mergeMap(async (data: unknown) => {
        const res = context.switchToHttp().getResponse<{ statusCode?: number }>();
        const status = res?.statusCode ?? 200;
        if (status < 400) {
          await this.safeWrite(context, rule, data, status, null);
        }
        return data;
      }),
      catchError((err: unknown) => {
        const status = this.resolveErrorStatus(err);
        if (rule.logFailure) {
          // 失败审计同样不能吞掉业务异常：先写日志，再把原异常继续抛给全局过滤器
          return from(this.safeWrite(context, rule, null, status, err)).pipe(
            mergeMap(() => throwError(() => err)),
          );
        }
        return throwError(() => err);
      }),
    );
  }

  /** `POST /api/system/account/:id/reset-password` 形式的规范化路由键 */
  private buildRouteKey(context: ExecutionContext): string | null {
    const method = this.reflector.getAllAndOverride<RequestMethod>(METHOD_METADATA, [
      context.getHandler(),
    ]);
    if (method === undefined || method === null) return null;

    const controllerPath = this.reflector.getAllAndOverride<string | string[]>(PATH_METADATA, [
      context.getClass(),
    ]);
    const handlerPath = this.reflector.getAllAndOverride<string | string[]>(PATH_METADATA, [
      context.getHandler(),
    ]);

    const segments = [controllerPath, handlerPath]
      .flatMap((p) => (Array.isArray(p) ? p : [p]))
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .flatMap((p) => p.split('/'))
      .filter(Boolean);

    if (segments.length === 0) return null;
    return `${RequestMethod[method]} /${segments.join('/')}`;
  }

  private resolveErrorStatus(err: unknown): number {
    const anyErr = err as { status?: number; getStatus?: () => number } | undefined;
    if (typeof anyErr?.getStatus === 'function') {
      try {
        return anyErr.getStatus();
      } catch {
        /* ignore */
      }
    }
    if (typeof anyErr?.status === 'number') return anyErr.status;
    return 500;
  }

  /**
   * 落一条审计记录。任何异常都在此吞掉（只打 warn），返回 Promise<void> 用于等待。
   * `failed` 场景由 err 非空标识，明细里带上 HTTP 状态与错误信息。
   */
  private async safeWrite(
    context: ExecutionContext,
    rule: OperationLogRule,
    data: unknown,
    status: number,
    err: unknown,
  ): Promise<void> {
    try {
      const http = context.switchToHttp();
      const req = http.getRequest<{
        userContext?: { userId?: string; userName?: string; account?: string };
        user?: { userId?: string; username?: string; roleName?: string };
        body?: unknown;
        params?: Record<string, unknown>;
        method?: string;
        originalUrl?: string;
        ip?: string;
        headers?: Record<string, unknown>;
        socket?: { remoteAddress?: string };
      }>();

      // 大多数控制器把返回体包成 { code, message, data }，真实业务负载在 data 里
      const payload = this.unwrap(data);
      const body = this.asObject(req.body);
      const params = this.asObject(req.params);

      const operator = this.resolveOperator(req, payload, body);
      const bizNo = this.pickBizNo([payload, body, params]);
      const bizId = this.pickBizId([payload, params]);
      const ipAddress = this.resolveIp(req);

      const actionDetail = this.buildDetail(req, body, status, err);

      await this.db.insert(operationLog).values({
        bizType: rule.bizType,
        action: err ? `${rule.action}_failed`.slice(0, 50) : rule.action,
        // operator_id 是 PG 复合类型 user_profile，cast 时首字段必须是合法 uuid，
        // 取不到（如未登录上下文）时留 NULL，不能塞空串
        operatorId: this.isUuid(operator.id) ? operator.id : undefined,
        operatorName: this.truncate(operator.name, MAX_OPERATOR_NAME),
        bizId: this.isUuid(bizId) ? bizId : undefined,
        bizNo: this.truncate(bizNo, MAX_BIZ_NO),
        actionDetail: actionDetail.slice(0, MAX_DETAIL),
        ipAddress: this.truncate(ipAddress, MAX_IP),
      });
    } catch (e: unknown) {
      // 审计失败绝不能影响主业务，也不允许抛出未处理拒绝
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `写入操作日志失败（不影响业务）：${rule.bizType}/${rule.action} - ${msg}`,
      );
    }
  }

  private unwrap(data: unknown): unknown {
    const obj = this.asObject(data);
    if (obj && Object.prototype.hasOwnProperty.call(obj, 'data')) return obj.data;
    return data;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  /** 只接受非空字符串 / 非空数字，其它一律视为「未提供」 */
  private str(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const t = value.trim();
      return t.length > 0 ? t : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return undefined;
  }

  private isUuid(value: unknown): boolean {
    return typeof value === 'string' && UUID_RE.test(value);
  }

  private truncate(value: string | undefined, max: number): string | undefined {
    if (!value) return undefined;
    return value.length > max ? value.slice(0, max) : value;
  }

  /**
   * 操作人解析优先级：
   *  1. JwtAuthGuard 写入的 req.userContext（绝大多数业务请求）
   *  2. 登录接口：@Public() 放行，守卫未写 userContext → 从登录响应体取
   *     （data = { id, account, name, ... }）；失败登录则退回请求体里的账号名
   */
  private resolveOperator(
    req: { userContext?: { userId?: string; userName?: string; account?: string }; user?: { userId?: string; username?: string; roleName?: string } },
    payload: unknown,
    body: Record<string, unknown> | null,
  ): { id?: string; name?: string } {
    const uc = req.userContext;
    if (uc?.userId) {
      return { id: uc.userId, name: uc.userName || uc.account || req.user?.username };
    }
    const p = this.asObject(payload);
    const id = this.str(p?.id) || this.str(req.user?.userId);
    const name =
      this.str(p?.name) ||
      this.str(p?.account) ||
      this.str(body?.account) ||
      this.str(req.user?.username) ||
      this.str(req.user?.roleName);
    return { id, name };
  }

  private pickBizNo(sources: unknown[]): string | undefined {
    for (const src of sources) {
      const obj = this.asObject(src);
      if (!obj) continue;
      for (const key of BIZ_NO_KEYS) {
        const v = this.str(obj[key]);
        if (v) return v;
      }
    }
    return undefined;
  }

  private pickBizId(sources: unknown[]): string | undefined {
    for (const src of sources) {
      const obj = this.asObject(src);
      if (!obj) continue;
      if (this.isUuid(obj.id)) return String(obj.id);
      for (const [k, v] of Object.entries(obj)) {
        if (k.endsWith('Id') && this.isUuid(v)) return String(v);
      }
    }
    return undefined;
  }

  private resolveIp(req: { ip?: string; headers?: Record<string, unknown>; socket?: { remoteAddress?: string } }): string | undefined {
    const fwd = req.headers?.['x-forwarded-for'];
    let raw = typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : undefined;
    if (!raw) raw = req.ip || req.socket?.remoteAddress;
    if (!raw) return undefined;
    // Express 在双栈监听下会给出 IPv4-mapped IPv6，统一还原成点分 IPv4，便于排查
    return raw.replace(/^::ffff:/i, '').replace(/^::1$/, '127.0.0.1');
  }

  /** 明细：方法 + 路径 + 脱敏后的请求体（+ 失败时的状态与原因），JSON 字符串 */
  private buildDetail(
    req: { method?: string; originalUrl?: string },
    body: Record<string, unknown> | null,
    status: number,
    err: unknown,
  ): string {
    const detail: Record<string, unknown> = {
      method: req.method,
      path: req.originalUrl,
    };
    if (body && Object.keys(body).length > 0) {
      detail.body = this.redact(body, 0);
    }
    if (err) {
      detail.result = 'failed';
      detail.status = status;
      const errObj = err as { message?: unknown };
      detail.error = this.str(errObj?.message) || (err instanceof Error ? err.message : undefined);
    } else {
      detail.status = status;
    }
    try {
      return JSON.stringify(detail) ?? '';
    } catch {
      // 理论上不会发生（已做深度/长度限制），兜底避免循环引用炸在这里
      return JSON.stringify({ method: req.method, path: req.originalUrl });
    }
  }

  /** 递归脱敏 + 限深限宽，避免把大 body（如批量收货明细）整包塞进日志表 */
  private redact(value: unknown, depth: number): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= 3) return '…';
    if (Array.isArray(value)) {
      const head = value.slice(0, 20).map((v) => this.redact(v, depth + 1));
      return value.length > 20 ? [...head, `…(+${value.length - 20})`] : head;
    }
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '***' : this.redact(v, depth + 1);
      }
      return out;
    }
    return String(value);
  }
}
