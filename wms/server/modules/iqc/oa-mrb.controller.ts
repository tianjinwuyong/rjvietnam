/**
 * OA → WMS：MRB 决策入站（P2）
 * 鉴权同 IQC 入站：X-Api-Key 常量时间比较，未配置即拒绝。
 */
import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { OaMrbService } from './oa-mrb.service';

function assertApiKey(key?: string): void {
  const expected = process.env.OA_API_KEY || '';
  if (!expected) throw new UnauthorizedException('OA_API_KEY 未配置，入站接口已禁用');
  const got = String(key || '');
  if (got.length !== expected.length) throw new UnauthorizedException('API Key 无效');
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) throw new UnauthorizedException('API Key 无效');
}

@Controller('api/oa/mrb')
export class OaMrbController {
  constructor(private readonly svc: OaMrbService) {}

  /** OA 审批结论回填（通过 / 否决统一入口，finalDecision='reject' 表示否决） */
  @Public()
  @Post('decision')
  async decision(@Body() body: any, @Headers('x-api-key') key?: string) {
    assertApiKey(key);
    return this.svc.applyDecision(body);
  }
}
