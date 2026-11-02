import { Controller, Get, Post, Put, Patch, Delete, Body, Query, Param } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { BomService } from './bom.service';
import type { Bom, BomItem, PaginatedResponse } from '@shared/api.interface';

@Controller('api/bom')
@NeedLogin()
export class BomController {
  constructor(private readonly bomService: BomService) {}

  @Get('list')
  async getBomList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('bomCode') bomCode?: string,
    @Query('productCode') productCode?: string,
    @Query('productName') productName?: string,
    @Query('status') status?: string,
  ): Promise<PaginatedResponse<Bom>> {
    return this.bomService.getBomList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      bomCode,
      productCode,
      productName,
      status,
    });
  }

  @Get('list/:id')
  async getBomDetail(@Param('id') id: string): Promise<Bom & { items: BomItem[] }> {
    return this.bomService.getBomDetail(id);
  }

  @Post('list')
  async createBom(
    @Body() body: {
      bomCode: string;
      productCode: string;
      productName: string;
      version?: string;
      description?: string;
      items: Array<{
        materialId: string;
        materialCode: string;
        vietnamCode?: string;
        materialName: string;
        specification?: string;
        unit: string;
        quantity: number;
        workSection: string;
        sortOrder: number;
        remark?: string;
      }>;
    },
  ): Promise<Bom & { items: BomItem[] }> {
    return this.bomService.createBom(body);
  }

  @Put('list/:id')
  async updateBom(
    @Param('id') id: string,
    @Body() body: {
      bomCode?: string;
      productCode?: string;
      productName?: string;
      version?: string;
      description?: string;
      status?: string;
      items?: Array<{
        materialId: string;
        materialCode: string;
        vietnamCode?: string;
        materialName: string;
        specification?: string;
        unit: string;
        quantity: number;
        workSection: string;
        sortOrder: number;
        remark?: string;
      }>;
    },
  ): Promise<Bom & { items: BomItem[] }> {
    return this.bomService.updateBom(id, body);
  }

  @Delete('list/:id')
  async deleteBom(@Param('id') id: string): Promise<{ success: boolean }> {
    return this.bomService.deleteBom(id);
  }

  @Patch('list/:id/status')
  async updateBomStatus(
    @Param('id') id: string,
    @Body() body: { status: 'active' | 'inactive' },
  ): Promise<{ success: boolean }> {
    return this.bomService.updateBomStatus(id, body.status);
  }

  @Get('all')
  async getAllActiveBoms(): Promise<Bom[]> {
    return this.bomService.getAllActiveBoms();
  }
}
