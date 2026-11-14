import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * MES 接口统一错误格式
 * ------------------------------------------------------------------
 * 第三方系统只认 HTTP 状态码 + 一个固定的 JSON 结构，避免拿到
 * Nest 默认的 {statusCode, message, error} 还要做兼容。
 *
 *   { "code": 40101, "message": "API Key 无效", "requestId": "..." }
 */
const CODE_BY_STATUS: Record<number, number> = {
  [HttpStatus.BAD_REQUEST]: 40001,
  [HttpStatus.UNAUTHORIZED]: 40101,
  [HttpStatus.FORBIDDEN]: 40301,
  [HttpStatus.NOT_FOUND]: 40401,
  [HttpStatus.TOO_MANY_REQUESTS]: 42901,
  [HttpStatus.SERVICE_UNAVAILABLE]: 50301,
  [HttpStatus.INTERNAL_SERVER_ERROR]: 50000,
};

@Catch()
export class MesApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MesApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest();
    const requestId = randomUUID();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = '服务内部错误';
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object' && 'message' in body) {
        const m = (body as any).message;
        message = Array.isArray(m) ? m.join('; ') : String(m);
      }
    } else if (exception instanceof Error) {
      message = '服务内部错误';
    }

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${req?.method} ${req?.originalUrl} -> ${status}: ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    } else {
      this.logger.warn(`[${requestId}] ${req?.method} ${req?.originalUrl} -> ${status}: ${message}`);
    }

    res.status(status).json({
      code: CODE_BY_STATUS[status] ?? status * 100,
      message,
      requestId,
    });
  }
}
