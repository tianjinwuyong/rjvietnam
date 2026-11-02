import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * MES / 第三方系统的 API Key 鉴权
 * ------------------------------------------------------------------
 * 与浏览器那套 JWT + 角色完全隔离：机器对机器调用没有登录态、没有角色，
 * 只认一把长期有效的 Key。
 *
 * 配置（.env）：
 *   MES_API_KEYS=key1:客户A,key2:客户B
 *   —— 逗号分隔，可用「Key:名称」标注调用方，名称只会出现在日志里。
 *
 * 安全约定：
 *   1) 未配置任何 Key 时**整体关闭**接口（503），不是放行；
 *   2) 用固定长度摘要 + timingSafeEqual 比较，避免时序侧信道；
 *   3) Key 只在首次加载时解析，请求期间不读环境变量。
 */

interface ClientKey {
  /** sha256(key) 的 Buffer，定长，便于 timingSafeEqual */
  digest: Buffer;
  label: string;
}

let cachedRaw: string | undefined;
let cachedKeys: ClientKey[] = [];

function loadKeys(): ClientKey[] {
  const raw = process.env.MES_API_KEYS || process.env.MES_API_KEY || '';
  if (raw === cachedRaw) return cachedKeys;

  cachedKeys = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(':');
      const key = idx > 0 ? entry.slice(0, idx).trim() : entry;
      const label = idx > 0 ? entry.slice(idx + 1).trim() : '未命名客户端';
      return { digest: createHash('sha256').update(key).digest(), label };
    });
  cachedRaw = raw;
  return cachedKeys;
}

@Injectable()
export class MesApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(MesApiKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const keys = loadKeys();
    if (keys.length === 0) {
      throw new ServiceUnavailableException('MES 接口未启用：请在 .env 配置 MES_API_KEYS');
    }

    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-api-key'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!provided || typeof provided !== 'string') {
      throw new UnauthorizedException('缺少请求头 X-Api-Key');
    }

    const digest = createHash('sha256').update(provided).digest();
    const hit = keys.find((k) => timingSafeEqual(k.digest, digest));
    if (!hit) {
      this.logger.warn(`API Key 校验失败，来源 ${req.ip}，路径 ${req.originalUrl}`);
      throw new UnauthorizedException('API Key 无效');
    }

    // 供后续日志/审计使用
    req.mesClient = hit.label;
    return true;
  }
}
