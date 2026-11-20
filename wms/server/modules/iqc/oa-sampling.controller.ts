/**
 * OA → WMS：抽样方案单点计算（OQC/AQL）
 * ------------------------------------------------------------------
 * 为什么放在 WMS 而不是 OA 自建：
 *   国标表（GB/T 2828.1）只有一份事实来源，复制到 OA 后一旦改错，
 *   两边判定会出现"同批不同结论"，且极难发现。OA 只做调用方。
 *
 * 只读、无副作用，因此不需要事务，也不需要落库。
 */
import { BadRequestException, Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { SamplingPlanService } from './sampling-plan.service';

function assertApiKey(key?: string): void {
  const expected = process.env.OA_API_KEY || '';
  if (!expected) throw new UnauthorizedException('OA_API_KEY 未配置，入站接口已禁用');
  const got = String(key || '');
  if (got.length !== expected.length) throw new UnauthorizedException('API Key 无效');
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) throw new UnauthorizedException('API Key 无效');
}

@Controller('api/oa/sampling')
export class OaSamplingController {
  constructor(private readonly sampling: SamplingPlanService) {}

  /**
   * body: { lotSize, inspectionLevel, aql, strictness }
   * 返回: { sampleSize, ac, re, level, aql, codeLetter, strictness, lotSize }
   */
  @Public()
  @Post()
  compute(@Body() body: any, @Headers('x-api-key') key?: string) {
    assertApiKey(key);
    const lotSize = Math.trunc(Number(body?.lotSize));
    if (!Number.isFinite(lotSize) || lotSize < 2) {
      throw new BadRequestException('批量必须为大于 1 的整数');
    }
    const strictness = ['normal', 'tightened', 'reduced'].includes(body?.strictness)
      ? body.strictness
      : 'normal';

    const r = this.sampling.calculateSamplingPlan(
      strictness,
      String(body?.inspectionLevel || 'II'),
      String(body?.aql || '0.40'),
      lotSize,
    );

    return {
      lotSize,
      strictness,
      inspectionLevel: r.level,
      aql: r.aql,
      codeLetter: r.codeLetter,
      sampleSize: r.sampleSize,
      ac: r.ac,
      re: r.re,
    };
  }
}
