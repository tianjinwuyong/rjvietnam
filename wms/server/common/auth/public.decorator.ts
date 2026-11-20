import { SetMetadata } from '@nestjs/common';

/**
 * 公开路由标记（配合全局 JwtAuthGuard 使用）。
 *
 * 系统采用「默认拒绝」策略：全局 JwtAuthGuard 对**所有**控制器路由生效，
 * 仅当处理器或控制器上标注了 @Public() 时才放行未登录请求。
 *
 * 这样新增模块忘记挂 @NeedLogin() 也不会造成鉴权缺口
 * （历史上 defective-move 模块正是因逐控制器 opt-in 而整体漏挂）。
 *
 * 仅限以下类型使用：登录接口、运行时配置、SPA 兜底页等无需身份即可访问的路由。
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
