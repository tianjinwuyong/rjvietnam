import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from './public.decorator';
import { isTokenBeforeEpoch } from './system-epoch';

const JWT_SECRET = process.env.JWT_SECRET || 'wms-secret-key-change-in-production';

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
  roleName?: string;
  /** 签发时间（秒），由 jsonwebtoken 自动写入 */
  iat?: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 全局守卫：默认所有路由需登录；标注 @Public() 的路由（登录、运行时配置、
    // SPA 兜底页等）直接放行，无需携带 token。
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] || request.headers['Authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('未登录');
    }

    const token = String(authHeader).replace('Bearer ', '');
    if (!token) {
      throw new UnauthorizedException('未登录');
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;

      // 系统初始化会删除除 admin 外的全部账号，此处把「初始化之前签发的令牌」
      // 一并作废，否则被删账号在令牌过期前仍能调用接口。
      if (isTokenBeforeEpoch(payload.iat)) {
        throw new UnauthorizedException('系统已初始化，请重新登录');
      }

      request.user = payload;
      request.userContext = {
        userId: payload.userId,
        userName: payload.roleName || payload.username,
        account: payload.username,
        roleCode: payload.role,
        roleName: payload.roleName,
      };
      return true;
    } catch (err) {
      // 上面主动抛出的「系统已初始化」需要原样透出，否则会被下面的兜底
      // 覆盖成「登录已过期」，用户看不出真实原因。
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
  }
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
