import { Controller, Get, Post, Put, Body, Query, Param, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { NeedRoles } from '../../common/auth/auth.decorator';
import { HrService } from './hr.service';
import type { Request } from 'express';

@Controller('api/hr')
@NeedLogin()
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Get('departments')
  async listDepartments() {
    const result = await this.hrService.listDepartments();
    return { code: 0, message: 'success', data: result };
  }

  @NeedRoles('hr_manager', 'hr_staff', 'admin')
  @Post('departments')
  async createDepartment(@Body() body: any, @Req() req: Request) {
    const { userId } = (req as any).userContext || { userId: '' };
    const result = await this.hrService.createDepartment(body, userId);
    return { code: 0, message: 'success', data: result };
  }

  @NeedRoles('hr_manager', 'admin')
  @Put('departments/:id')
  async updateDepartment(@Param('id') id: string, @Body() body: any) {
    const result = await this.hrService.updateDepartment(id, body);
    return { code: 0, message: 'success', data: result };
  }

  @Get('employees')
  async listEmployees(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Query('keyword') keyword?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    const result = await this.hrService.listEmployees(page, pageSize, keyword, departmentId);
    return { code: 0, message: 'success', data: result };
  }

  @Get('employees/:id')
  async getEmployee(@Param('id') id: string) {
    const result = await this.hrService.getEmployee(id);
    return { code: 0, message: 'success', data: result };
  }

  @NeedRoles('hr_manager', 'hr_staff', 'admin')
  @Post('employees')
  async createEmployee(@Body() body: any, @Req() req: Request) {
    const { userId } = (req as any).userContext || { userId: '' };
    const result = await this.hrService.createEmployee(body, userId);
    return { code: 0, message: 'success', data: result };
  }

  @NeedRoles('hr_manager', 'hr_staff', 'admin')
  @Put('employees/:id')
  async updateEmployee(@Param('id') id: string, @Body() body: any) {
    const result = await this.hrService.updateEmployee(id, body);
    return { code: 0, message: 'success', data: result };
  }
}
