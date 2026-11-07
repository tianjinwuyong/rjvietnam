import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      userContext?: {
        userId: string;
        userName: string;
        account: string;
        roleCode: string;
        roleName?: string;
        workSection?: string;
      };
      /**
       * Agent 调用上下文，由 AgentScopeGuard 在通过权限域校验后写入。
       * 仅当路由标注了 @AgentScope / @NeedAgentScope 且请求头合法时才有值。
       */
      agentContext?: {
        agentKey: string;
        /** 已授予的权限域（多值以逗号分隔） */
        agentScope: string | null;
        createdByType: string | null;
        createdById: string | null;
      };
      __platform_data__?: Record<string, any>;
    }
  }
}

export {};
