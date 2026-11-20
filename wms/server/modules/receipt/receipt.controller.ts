import { Controller, Post, Get, Body, Query, Param, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { NeedRoles } from '../../common/auth/auth.decorator';
import { ReceiptService } from './receipt.service';
import { ScanReceiptDto, VerifyQrDto } from './dto/scan-receipt.dto';
import type { Request } from 'express';

@Controller('api/receipt')
@NeedLogin()
export class ReceiptController {
  constructor(private readonly receiptService: ReceiptService) {}

  @Get('warehouses')
  async getWarehouses() {
    const result = await this.receiptService.getActiveWarehouses();
    return { code: 0, message: 'success', data: result };
  }

  @Post('verify-location')
  async verifyLocation(@Body() body: { locationCode: string; warehouseId: string }) {
    const result = await this.receiptService.verifyLocationCode(body.locationCode, body.warehouseId);
    return { code: 0, message: 'success', data: result };
  }

  /** 只读预览：返回本次将提交的收料单数与合并后的批次数，供前端确认框显示范围 */
  @Post('submit-iqc/preview')
  async previewSubmitIqc() {
    const result = await this.receiptService.previewSubmitIqc();
    return { code: 0, message: 'success', data: result };
  }

  @Post('submit-iqc')
  async submitIqc(@Req() req: Request) {
    const { userId } = (req as any).userContext || { userId: '' };
    const result = await this.receiptService.submitIqc(userId);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('wh_keeper', 'wh_manager', 'admin')
  @Post('batch-receipt')
  async batchReceipt(
    @Body() body: { items: Array<{ qrContent: string; quantity?: number }>; locationId: string },
    @Req() req: Request,
  ) {
    const { userId } = (req as any).userContext || { userId: '' };
    const result = await this.receiptService.batchReceipt(body.items, body.locationId, userId);
    return { code: 0, message: 'success', data: result };
  }

  @Post('verify-qr')
  async verifyQr(@Body() body: VerifyQrDto) {
    const result = await this.receiptService.verifyQr(body.qrContent);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @NeedRoles('wh_keeper', 'wh_manager', 'admin')
  @Post('scan')
  async scan(@Body() body: ScanReceiptDto, @Req() req: Request) {
    const { userId } = (req as any).userContext || { userId: '' };
    const result = await this.receiptService.scanReceipt(
      body.qrContent,
      body.locationId,
      body.actualQty,
      userId,
    );
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('list')
  async getList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('receiptNo') receiptNo?: string,
    @Query('supplierCode') supplierCode?: string,
    @Query('materialCode') materialCode?: string,
    @Query('batchNo') batchNo?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
  ) {
    const result = await this.receiptService.getReceiptList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      receiptNo,
      supplierCode,
      materialCode,
      batchNo,
      startDate,
      endDate,
      status,
    });
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('list/:id')
  async getDetail(@Param('id') id: string) {
    const result = await this.receiptService.getReceiptDetail(id);
    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }
}
