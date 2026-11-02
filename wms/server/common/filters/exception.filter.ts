import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { BusinessException } from '../interfaces/exception.interface';
import { HTTP_STATUS_TO_RESPONSE_CODE_MAP, ResponseCode } from '../constants/api_response_code';
import { ApiErrorResponse } from '../interfaces/api_response.interface';

/**
 * 从异常对象中提取 Postgres / Drizzle 的错误码。
 *
 * Drizzle 会把底层的 PostgresError 包一层（DrizzleQueryError），
 * 真实错误码位于 `exception.cause.code`，而不是 `exception.code`。
 * 因此这里需要沿 cause 链向下查找，否则会漏判。
 */
function extractDbErrorCode(exception: unknown): string | undefined {
  let cur: unknown = exception;
  for (let depth = 0; depth < 5 && cur && typeof cur === 'object'; depth++) {
    const c = (cur as { code?: unknown }).code;
    if (typeof c === 'string' && c.length > 0) return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * 是否向客户端回传 stack / cause 等内部细节。
 *
 * 默认**关闭**（安全优先）：不再以 NODE_ENV 作为开关——此前交付配置是
 * `NODE_ENV=development`，导致线上 500 响应直接泄漏源码绝对路径与完整 SQL。
 * 现在只有显式设置 `EXPOSE_ERROR_DETAIL=true` 才回传，供本地排障临时开启。
 */
function exposeErrorDetail(): boolean {
  return process.env.EXPOSE_ERROR_DETAIL === 'true';
}

// 全局异常过滤器，用于捕获所有未处理的异常
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // 如果响应头已发送，则不处理
    if (response.headersSent) {
      return;
    }

    let errorResponse: Omit<ApiErrorResponse, 'httpStatus'>;
    let httpStatus: HttpStatus;

    if (exception instanceof BusinessException) {
      // 业务异常
      httpStatus = exception.httpStatus;
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          fieldErrors: exception.fieldErrors,
          timestamp: Date.now(),
        },
      };
    } else if (exception instanceof HttpException) {
      // HTTP异常
      httpStatus = exception.getStatus() as HttpStatus;
      const exceptionResponse = exception.getResponse();

      errorResponse = {
        error: {
          code: HTTP_STATUS_TO_RESPONSE_CODE_MAP[httpStatus],
          message: typeof exceptionResponse === 'string' ? exceptionResponse : exception.message,
          details: typeof exceptionResponse === 'object' ? JSON.stringify(exceptionResponse) : undefined,
          timestamp: Date.now(),
        },
      };
    } else {
      // 非 HttpException：多为数据库 / 运行时错误，按 Postgres 错误码做语义映射
      const dbCode = extractDbErrorCode(exception);

      if (dbCode === '22P02') {
        // invalid_text_representation：路径/查询参数与列类型不匹配（最常见是非法 UUID）
        // 与「合法 UUID 但记录不存在」走同一条 not-found 语义，避免 500 噪声
        httpStatus = HttpStatus.NOT_FOUND;
        errorResponse = {
          error: {
            code: ResponseCode.NOT_FOUND,
            message: '资源不存在',
            timestamp: Date.now(),
          },
        };
      } else if (dbCode === '23505') {
        // unique_violation：唯一约束冲突，属并发/重复提交，语义上是冲突而非服务端故障
        httpStatus = HttpStatus.CONFLICT;
        errorResponse = {
          error: {
            code: ResponseCode.CONFLICT,
            message: '数据已存在或已被处理，请刷新后重试',
            timestamp: Date.now(),
          },
        };
      } else if (dbCode === '23502') {
        // not_null_violation：必填字段缺失或为空。
        // 此前未映射该错误码，导致缺必填字段的创建请求直接抛 500（BUG-001 / BUG-002）。
        // 这里作为 DTO 校验之外的最后一道兜底：即使某个 create 接口漏接 DTO，
        // 也只会得到 400 与可读提示，不会再出现 500 与未处理异常日志。
        httpStatus = HttpStatus.BAD_REQUEST;
        errorResponse = {
          error: {
            code: ResponseCode.BAD_REQUEST,
            message: '必填字段缺失或为空，请填写完整后重试',
            timestamp: Date.now(),
          },
        };
      } else if (dbCode === '23503') {
        // foreign_key_violation：引用了不存在的关联记录
        httpStatus = HttpStatus.BAD_REQUEST;
        errorResponse = {
          error: {
            code: ResponseCode.BAD_REQUEST,
            message: '关联数据不存在或不可用',
            timestamp: Date.now(),
          },
        };
      } else if (dbCode === 'UNDEFINED_VALUE') {
        // postgres-js 专属错误码（非 PG 服务端码）：SQL 参数里绑定了 JS `undefined`。
        // 典型场景是创建/操作类接口漏接 DTO，调用方没传必填字段时直接把 undefined
        // 透传到 SQL，被驱动拒绝并抛这个错误——语义上属调用方漏参，HTTP 400 才对。
        // 与 23502（非空约束）同为 BUG-001/002 同根因的兜底，覆盖范围更靠前一层。
        // 仍打一条 warn + 堆栈：若某天是「服务端内部漏传值」而非调用方漏参，
        // 日志里依然查得到，不会被这条映射掩盖成无声的 400。
        httpStatus = HttpStatus.BAD_REQUEST;
        errorResponse = {
          error: {
            code: ResponseCode.BAD_REQUEST,
            message: '请求缺少必填参数，请检查后重试',
            timestamp: Date.now(),
          },
        };
        const uErr = exception as Error;
        this.logger.warn(
          `SQL 参数含 undefined（多为调用方漏传必填字段，已按 400 返回）: ${uErr?.message ?? exception}`,
          uErr?.stack,
        );
      } else if (
        exception instanceof Error &&
        exception.message === 'No values to set'
      ) {
        // drizzle 的 mapUpdateSet 在 update 语句没有任何可写列时抛这个普通 Error
        // （无 error code，只能按消息匹配）。触发场景是 PUT 接口收到空请求体 /
        // 全部字段都为 undefined。属调用方问题，应为 400 而非 500。
        // 各 update service 已各自加了显式守卫，这里是防止将来新增 PUT 接口再踩坑的兜底网。
        // 注意：drizzle 升级若改了这句文案，此分支会静默失效，届时回归到 500，不会误判。
        httpStatus = HttpStatus.BAD_REQUEST;
        errorResponse = {
          error: {
            code: ResponseCode.BAD_REQUEST,
            message: '没有需要更新的字段',
            timestamp: Date.now(),
          },
        };
      } else {
        // 未知异常：服务端记录完整日志，但只向客户端返回脱敏信息
        httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
        const err = exception as Error;
        // 默认不回传 stack / cause（避免泄漏 SQL 与源码路径）；
        // 仅在显式设置 EXPOSE_ERROR_DETAIL=true 时回传，供本地排障使用。
        errorResponse = {
          error: {
            code: ResponseCode.INTERNAL_ERROR,
            message: '服务器内部错误',
            ...(exposeErrorDetail() ? { stack: err?.stack, cause: err?.cause as string } : {}),
            timestamp: Date.now(),
          },
        };
        this.logger.error(
          `未处理异常: ${err?.message ?? exception}`,
          err?.stack,
        );
      }
    }

    response.status(httpStatus).json(errorResponse);
  }
}
