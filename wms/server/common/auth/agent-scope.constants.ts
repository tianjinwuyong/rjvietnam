/**
 * Agent 权限域元数据 key。
 *
 * 集中定义，供 AgentScope 装饰器与 AgentScopeGuard 共用，
 * 避免两处各写一份字符串常量而拼错（review 2026-11-08）。
 */
export const AGENT_SCOPE_KEY = 'agent_scope';

/**
 * Agent 身份请求头名（小写读取，Express/Node 会归一化为小写）。
 *
 *   x-agent-key        Agent 唯一标识，必填
 *   x-agent-scope      Agent 权限域，可选；多值以逗号分隔
 *   x-created-by-type  调用方类型，Agent 调用必须为 'AGENT'
 *   x-created-by-id    调用方 ID，对应 created_by_id
 */
export const AGENT_HEADERS = {
  key: 'x-agent-key',
  scope: 'x-agent-scope',
  createdByType: 'x-created-by-type',
  createdById: 'x-created-by-id',
} as const;

/** Agent 调用方类型固定值。 */
export const AGENT_CREATED_BY_TYPE = 'AGENT';
