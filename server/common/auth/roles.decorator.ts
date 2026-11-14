import { SetMetadata } from '@nestjs/common';

/**
 * 角色元数据 key。
 * 配合 RolesGuard 使用，声明当前路由允许的角色 code 列表。
 */
export const ROLES_KEY = 'roles';

/**
 * 声明当前路由允许访问的角色 code 列表。
 *
 * 用法：
 *   @NeedRoles('admin')            // 等价于 @NeedLogin + @Roles('admin') + RolesGuard
 *   @NeedRoles('iqc_manager', 'admin', 'quality_manager')
 *
 * 若需仅做登录校验、不限制角色，继续使用 @NeedLogin() 即可。
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
