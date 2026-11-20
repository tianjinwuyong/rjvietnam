import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { AgentScopeGuard } from './agent-scope.guard';
import { AgentScope } from './agent-scope.decorator';

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

/**
 * 组合装饰器：Agent 身份校验 + 权限域校验。
 *
 * 等价于：
 *   @AgentScope(...scopes)
 *   @UseGuards(JwtAuthGuard, AgentScopeGuard)
 *
 * 用法：
 *   @NeedAgentScope('material:write')
 *   @Post(':id')
 *   async update(...) { ... }
 *
 * 与 @NeedRoles / @NeedLogin **共存**，不是二选一：
 *   NeedRoles 管「人/角色能不能做」，NeedAgentScope 管「Agent 权限域够不够」。
 *   同时标注时两组守卫都会执行。
 *
 * ⚠️ 未声明 scope 的路由，AgentScopeGuard 默认放行（见 agent-scope.guard.ts 顶部说明）——
 *    写接口请一律显式标注。
 */
export function NeedAgentScope(...scopes: string[]) {
  return applyDecorators(
    AgentScope(...scopes),
    UseGuards(JwtAuthGuard, AgentScopeGuard),
  );
}
