import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

/**
 * 角色守卫。
 *
 * 通过 @Roles(...) 元数据读取当前路由要求的角色 code 列表；
 * 若未声明角色则直接放行（交给上游 JwtAuthGuard 做登录校验）。
 *
 * 必须与 JwtAuthGuard 配合使用：JwtAuthGuard 会把解析后的角色写入
 * request.userContext.roleCode（同时 request.user.role 也保留原始 JWT 角色）。
 * 守卫执行顺序由组合装饰器 @NeedRoles 在单次 UseGuards 中保证：JwtAuthGuard 先运行。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 未声明角色要求：放行（登录与否由 JwtAuthGuard 负责）
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.userContext || request.user;
    if (!user) {
      throw new ForbiddenException('未登录');
    }

    const roleCode: string | undefined = user.roleCode || user.role;
    if (!roleCode || !requiredRoles.includes(roleCode)) {
      throw new ForbiddenException('您没有权限执行此操作');
    }
    return true;
  }
}
