import { SetMetadata } from '@nestjs/common';
import { AGENT_SCOPE_KEY } from './agent-scope.constants';

/**
 * 声明当前路由所需的 Agent 权限域（scope）列表。
 *
 * 配合 AgentScopeGuard 使用：
 *   - 声明了 scope 的路由：请求必须带完整 Agent 身份头，且 x-agent-scope 需包含所需 scope；
 *   - 未声明 scope 的路由：**AgentScopeGuard 直接放行**（见 agent-scope.guard.ts 顶部说明）。
 *
 * 用法：
 *   @AgentScope('material:write')
 *   @AgentScope('material:write', 'material:admin')
 */
export const AgentScope = (...scopes: string[]) => SetMetadata(AGENT_SCOPE_KEY, scopes);
