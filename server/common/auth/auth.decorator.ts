import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';

/**
 * 组合装饰器：登录校验 + 角色校验。
 *
 * 在单次 UseGuards(JwtAuthGuard, RolesGuard) 中同时挂载两个守卫，
 * 保证执行顺序为「先 JwtAuthGuard 解析 JWT 并写入 request.userContext，
 * 再 RolesGuard 校验角色」，避免 userContext 未填充导致误判 403。
 *
 * 等价于：
 *   @NeedLogin()
 *   @UseGuards(RolesGuard)
 *   @Roles(...roles)
 *
 * 用法：
 *   @NeedRoles('admin')
 *   @NeedRoles('iqc_manager', 'admin', 'quality_manager')
 */
export function NeedRoles(...roles: string[]) {
  return applyDecorators(
    Roles(...roles),
    UseGuards(JwtAuthGuard, RolesGuard),
  );
}
