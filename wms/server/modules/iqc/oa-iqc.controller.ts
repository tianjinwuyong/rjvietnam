/**
 * OA → WMS 入站接口（P1）
 * ------------------------------------------------------------------
 * 鉴权：`X-Api-Key` 必须等于 WMS 的 `OA_API_KEY`（与 WMS→OA 出站用的是同一个共享密钥）。
 *   · 常量时间比较，避免时序侧信道
 *   · 未配置 OA_API_KEY 时**一律拒绝**（不能因为漏配变成开放接口）
 * 为什么不复用 oa-integration 的 callback：那个是"OA 审批状态回调"，走 HMAC 验签；
 * 这里是 OA 主动推送业务结果，语义不同，单独一组端点便于按需开关与限流。
 * ------------------------------------------------------------------
 */
import { Body, Controller, Get, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { OaIqcService } from './oa-iqc.service';

function assertApiKey(key?: string): void {
  const expected = process.env.OA_API_KEY || '';
  if (!expected) throw new UnauthorizedException('OA_API_KEY 未配置，入站接口已禁用');
  const got = String(key || '');
  if (got.length !== expected.length) throw new UnauthorizedException('API Key 无效');
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) throw new UnauthorizedException('API Key 无效');
}

@Controller('api/oa/iqc')
export class OaIqcController {
  constructor(private readonly svc: OaIqcService) {}

  /** OA 提交检验结果（写报告待审 + 检验记录） */
  @Public()
  @Post('result')
  async result(@Body() body: any, @Headers('x-api-key') key?: string) {
    assertApiKey(key);
    return this.svc.receiveResult(body);
  }

  /** OA 审批通过 → 触发 WMS 落账（库存/欠料/自动MRB/严格度，全部在 reviewReport 内完成） */
  @Public()
  @Post('approve')
  async approve(@Body() body: any, @Headers('x-api-key') key?: string) {
    assertApiKey(key);
    return this.svc.approve(body);
  }

  /** OA 认领批次（防双入口） */
  @Public()
  @Post('claim')
  async claim(@Body() body: any, @Headers('x-api-key') key?: string) {
    assertApiKey(key);
    return this.svc.claim(body);
  }

  /** 可评审量（OA 的 MRB 页面显示"还能评多少"，口径与 WMS 内部一致） */
  @Public()
  @Get('reviewable')
  async reviewable(@Query() query: any, @Headers('x-api-key') key?: string) {
    assertApiKey(key);
    return this.svc.reviewable(query);
  }

  /** OA 释放认领 */
  @Public()
  @Post('release')
  async release(@Body() body: any, @Headers('x-api-key') key?: string) {
    assertApiKey(key);
    return this.svc.release(body);
  }
}
