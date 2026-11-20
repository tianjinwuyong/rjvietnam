import { Controller, Post, Get, Put, Delete, Body, Query, Param, Req, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { networkInterfaces } from 'os';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { Public } from '../../common/auth/public.decorator';
import { NeedRoles } from '../../common/auth/auth.decorator';
import { SystemService } from './system.service';
import type { RoleInfo } from './system.service';

@Controller('api/system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  // ========== 运行时配置（公开，无需登录） ==========

  /**
   * 供移动端/证书页读取的运行时网络配置。
   *
   * 手机端摄像头（getUserMedia）必须在 HTTPS 安全上下文下使用，
   * PDA 页面据此把用户从 HTTP 引导到正确的 HTTPS 地址，
   * 避免此前写死 IP/端口在换网络后失效。
   */
  @Public()
  @Get('runtime-config')
  getRuntimeConfig() {
    const httpPort = Number(process.env.SERVER_PORT || '3000');
    const httpsPort = Number(process.env.HTTPS_PORT || '3443');
    const lanIps: string[] = [];
    const nets = networkInterfaces();
    for (const addrs of Object.values(nets)) {
      for (const a of addrs || []) {
        if (a.family !== 'IPv4' || a.internal) continue;
        if (a.address.startsWith('169.254.')) continue;
        lanIps.push(a.address);
      }
    }
    const primaryIp = lanIps[0] || 'localhost';
    return {
      code: 0,
      message: 'success',
      data: {
        httpPort,
        httpsPort,
        lanIps,
        httpsUrl: `https://${primaryIp}:${httpsPort}`,
      },
    };
  }

  // ========== 系统参数 ==========

  @NeedRoles('admin')
  @Get('param/list')
  async getParamList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('paramKey') paramKey?: string,
  ) {
    const result = await this.systemService.getParamList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      paramKey,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Post('param')
  async createParam(
    @Body() body: {
      paramKey: string;
      paramValue: string;
      paramNameZh?: string;
      paramNameVi?: string;
      paramNameEn?: string;
      description?: string;
    },
  ) {
    const result = await this.systemService.createParam(body);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Put('param/:id')
  async updateParam(
    @Param('id') id: string,
    @Body() body: {
      paramValue?: string;
      paramNameZh?: string;
      paramNameVi?: string;
      paramNameEn?: string;
      description?: string;
    },
  ) {
    const result = await this.systemService.updateParam(id, body);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Delete('param/:id')
  async deleteParam(@Param('id') id: string) {
    await this.systemService.deleteParam(id);
    return {
      code: 0,
      message: 'success',
      data: null,
    };
  }

  @NeedRoles('admin')
  @Get('param/:key')
  async getParamByKey(@Param('key') key: string) {
    const result = await this.systemService.getParamByKey(key);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  // ========== 操作日志 ==========

  @NeedRoles('admin')
  @Get('log/list')
  async getOperationLogList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('module') module?: string,
    @Query('operation') operation?: string,
    @Query('operator') operator?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('relatedId') relatedId?: string,
  ) {
    return this._queryOperationLog({ page, pageSize, module, operation, operator, startDate, endDate, relatedId });
  }

  @NeedRoles('admin')
  @Get('operation-log')
  async getOperationLogAlias(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('module') module?: string,
    @Query('operation') operation?: string,
    @Query('operator') operator?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('relatedId') relatedId?: string,
  ) {
    return this._queryOperationLog({ page, pageSize, module, operation, operator, startDate, endDate, relatedId });
  }

  private async _queryOperationLog(params: {
    page: string; pageSize: string; module?: string; operation?: string;
    operator?: string; startDate?: string; endDate?: string; relatedId?: string;
  }) {
    const result = await this.systemService.getOperationLogList({
      page: parseInt(params.page, 10),
      pageSize: parseInt(params.pageSize, 10),
      module: params.module,
      operation: params.operation,
      operator: params.operator,
      startDate: params.startDate,
      endDate: params.endDate,
      relatedId: params.relatedId,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  // ⚠️ 已移除 `POST /api/system/operation-log`（审计补录写接口，2026-10-15）
  //
  // 移除原因：该接口允许管理员**手工写入任意审计记录**（module/operation/operatorId
  // 均由请求体指定），等于给审计台账开了一个可伪造的口子——治理风险高于任何一处
  // 「操作人字段可冒名」问题。而审计日志自 2026-10-14 起已由
  // `OperationLogInterceptor`（全局 APP_INTERCEPTOR）在业务成功时自动写入，
  // 覆盖全部敏感操作，不再需要手工补录。
  //
  // 经全仓库核查：该接口除自身的前端封装 `client/src/api/system.ts` 外**无任何调用方**，
  // 移除不影响任何业务流程。查询接口 `GET /api/system/operation-log` 保持不变。
  // 如需恢复，`SystemService.createOperationLog` 方法仍然保留，重新挂上路由即可。

  // ========== 角色管理（新） ==========

  @NeedRoles('admin')
  @Get('role-user/list')
  async getRoleUserList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('roleCode') roleCode?: string,
  ) {
    const result = await this.systemService.getRoleUserList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      roleCode,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  // ========== 登录 ==========

  @Public()
  @Post('login')
  async login(@Body() body: { account: string; password: string }) {
    const result = await this.systemService.login(body.account, body.password);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedLogin()
  @Post('logout')
  async logout() {
    const result = await this.systemService.logout();
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  /**
   * 当前登录账号的最新状态。
   *
   * 用途：前端在启动时用它校正本地缓存的登录态（`isFirstLogin` 等）。
   * 「是否已改密」是账号级事实，但各端把登录态缓存在 localStorage，
   * PC 端改完密码后 PDA 端的缓存不会自动更新，会重复弹出改密框。
   */
  @NeedLogin()
  @Get('me')
  async getMe(@Req() req: Request) {
    return {
      code: 0,
      message: 'success',
      data: await this.systemService.getCurrentUser(req.userContext?.userId || ''),
    };
  }

  /**
   * 自助改密：任何已登录用户修改自己的密码。
   *
   * 请求体只接受密码字段，账号身份一律取登录态 `req.userContext.userId`，
   * 因此不存在「改他人密码」的越权路径。
   */
  @NeedLogin()
  @Post('change-password')
  async changePassword(
    @Req() req: Request,
    @Body() body: { oldPassword?: string; newPassword?: string; confirmPassword?: string },
  ) {
    await this.systemService.changePassword({
      userId: req.userContext?.userId || '',
      oldPassword: body.oldPassword || '',
      newPassword: body.newPassword || '',
      confirmPassword: body.confirmPassword || '',
    });
    return {
      code: 0,
      message: 'success',
      data: null,
    };
  }

  // ========== 系统初始化（危险操作，仅系统管理员） ==========

  /**
   * 初始化预览：界面先把「会被清空多少张表 / 多少行 / 多少个账号」摆出来，
   * 避免用户在不知道代价的情况下点下不可逆的按钮。
   */
  @NeedRoles('admin')
  @Get('initialize/preview')
  async previewInitialize() {
    const result = await this.systemService.previewInitialize();
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  /**
   * 执行系统初始化：清空全部业务数据，只保留 admin 账号。
   *
   * 身份取登录态 `req.userContext.userId`，密码在服务层重新验哈希 ——
   * 即使前端被绕过，没有正确的当前密码也执行不了。
   */
  @NeedRoles('admin')
  @Post('initialize')
  async initializeSystem(
    @Req() req: Request,
    @Body() body: { password?: string; confirmText?: string; clearLogs?: boolean },
  ) {
    const result = await this.systemService.initializeSystem({
      userId: req.userContext?.userId || '',
      password: body.password || '',
      confirmText: body.confirmText || '',
      clearLogs: body.clearLogs,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  // ========== 角色管理（新） ==========

  @NeedRoles('admin')
  @Get('role/all')
  async getAllRoles() {
    const result = await this.systemService.getAllRoles();
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Get('role/list')
  async getSysRoleList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('roleName') roleName?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.systemService.getSysRoleList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      roleName,
      status,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Post('role')
  async createRole(@Body() body: {
    roleCode: string;
    roleName: string;
    description?: string;
    menuPermissions: string[];
  }) {
    const result = await this.systemService.createRole(body);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Put('role/:id')
  async updateRole(
    @Param('id') id: string,
    @Body() body: {
      roleName?: string;
      description?: string;
      menuPermissions?: string[];
      status?: string;
    },
  ) {
    const result = await this.systemService.updateRole(id, body);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Delete('role/:id')
  async deleteRole(@Param('id') id: string) {
    await this.systemService.deleteRole(id);
    return {
      code: 0,
      message: 'success',
      data: null,
    };
  }

  // ========== 账号管理 ==========

  @NeedRoles('admin')
  @Get('account/list')
  async getAccountList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('account') account?: string,
    @Query('name') name?: string,
    @Query('roleCode') roleCode?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.systemService.getAccountList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      account,
      name,
      roleCode,
      status,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Post('account')
  async createAccount(@Body() body: {
    account: string;
    name: string;
    roleCode: string;
    workSection?: string;
  }) {
    const result = await this.systemService.createAccount(body);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Put('account/:id')
  async updateAccount(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      roleCode?: string;
      workSection?: string;
      status?: string;
    },
  ) {
    const result = await this.systemService.updateAccount(id, body);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('admin')
  @Post('account/:id/reset-password')
  async resetPassword(@Param('id') id: string) {
    await this.systemService.resetPassword(id);
    return {
      code: 0,
      message: 'success',
      data: null,
    };
  }

  @NeedRoles('admin')
  @Delete('account/:id')
  async deleteAccount(@Param('id') id: string) {
    await this.systemService.deleteAccount(id);
    return {
      code: 0,
      message: 'success',
      data: null,
    };
  }

  /**
   * 账号批量导入（模版 → 人工填写 → 导入）。
   *
   * 与 material/supplier 的导入保持一致：文件以 base64 放在请求体里传
   * （**不是 multipart**），因此不需要 multer，也就不需要新增任何依赖。
   *
   * 权限：仅 admin。导入本质是「批量建号」，而账号的 role_code 直接决定
   * 该账号能过哪些角色闸门（如 MRB 终审），必须由管理员把关。
   *
   * 操作人一律取登录态，忽略请求体里可能传入的 operatorId（防冒名）。
   */
  @NeedRoles('admin')
  @Post('account/import')
  async importAccounts(
    @Req() req: Request,
    @Body() body: { fileBase64: string },
  ) {
    if (!body?.fileBase64) {
      throw new BadRequestException('未接收到上传的文件数据');
    }
    const buffer = Buffer.from(body.fileBase64, 'base64');
    const result = await this.systemService.importAccounts(
      buffer,
      req.userContext?.userId || '',
    );
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  // ========== 批量库位生成 ==========

  @NeedRoles('admin')
  @Post('location/batch-create')
  async batchCreateLocations(@Body() body: {
    warehouseId: string;
    areaCode: string;
    shelfCode: string;
    layerCode: string;
    startNo: number;
    endNo: number;
    locationType: string;
    digitLen?: number;
  }) {
    const result = await this.systemService.batchCreateLocations(body);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }
}
