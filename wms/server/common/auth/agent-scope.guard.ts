import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AGENT_CREATED_BY_TYPE,
  AGENT_HEADERS,
  AGENT_SCOPE_KEY,
} from './agent-scope.constants';

export interface AgentContext {
  agentKey: string;
  agentScope: string | null;
  createdByType: string | null;
  createdById: string | null;
}

/**
 * Agent 守卫。校验请求头中的 Agent 标识与权限域。
 *
 * 请求头约定：
 *   x-agent-key: <agent_id>        # 必填，Agent 唯一标识
 *   x-agent-scope: <scope>[,<scope>]  # 可选，权限域，如 material:write；多值逗号分隔
 *   x-created-by-type: AGENT       # 必填，固定值 AGENT
 *   x-created-by-id: <agent_id>    # 必填，对应 created_by_id
 *
 * ⚠️ 默认放行策略（review 2026-11-08 显式记录，勿静默改动）
 *   路由若**未**声明 @AgentScope(...) / @NeedAgentScope(...)，
 *   本守卫**直接放行**，Agent 身份不参与校验。
 *   原因：Guard 挂在路由上而非全局，避免把尚未接入 Agent 体系的历史接口一次性打挂。
 *   代价：新增写接口若忘记标注 @NeedAgentScope，就等于**静默裸奔**——
 *   Agent 可用普通登录态直接写主数据，人类侧的「可被接管」预期被绕过。
 *   因此约定：**任何写接口（@Post/@Put/@Patch/@Delete）都必须显式标注 scope**，
 *   新增接口时请一并检查此处注释是否仍成立。
 *   与 @NeedRoles 的关系：两者**共存**，不是二选一 ——
 *   NeedRoles 管「人/角色能不能做」，NeedAgentScope 管「Agent 的权限域够不够」；
 *   同时标注时两个守卫都会执行（JwtAuthGuard → AgentScopeGuard → RolesGuard）。
 */
@Injectable()
export class AgentScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
      AGENT_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 未声明 scope 要求：放行（见上方「默认放行策略」说明）
    if (!requiredScopes || requiredScopes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const headers = request.headers ?? {};

    const agentKey = headers[AGENT_HEADERS.key];
    const rawScope = headers[AGENT_HEADERS.scope];
    const createdByType = headers[AGENT_HEADERS.createdByType];
    const createdById = headers[AGENT_HEADERS.createdById];

    if (!agentKey || createdByType !== AGENT_CREATED_BY_TYPE || !createdById) {
      throw new ForbiddenException(
        'Agent 身份缺失：x-agent-key / x-created-by-type / x-created-by-id 必填',
      );
    }

    // x-agent-scope 支持逗号分隔的多值（review 2026-11-08：草案只支持单值）
    const grantedScopes = (Array.isArray(rawScope) ? rawScope.join(',') : String(rawScope ?? ''))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (grantedScopes.length === 0) {
      throw new ForbiddenException('Agent 权限域不足：x-agent-scope 未声明');
    }

    const missing = requiredScopes.filter((required) => !grantedScopes.includes(required));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Agent 权限域不足：x-agent-scope 缺少 ${missing.join(', ')}`,
      );
    }

    // 写入 request 上下文，供 service 层审计与 created_by_id 填充
    request.agentContext = {
      agentKey: String(agentKey),
      agentScope: grantedScopes.join(','),
      createdByType: String(createdByType),
      createdById: String(createdById),
    } satisfies AgentContext;

    return true;
  }
}
