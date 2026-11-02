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
      __platform_data__?: Record<string, any>;
    }
  }
}

export {};
