import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Trim } from '../../../common/utils/dto-transform';

/**
 * 发起 MRB 的入参。
 *
 * ⚠️ 发起人一律取登录态（`req.userContext.userId`），
 *   请求体里的 `initiatorId` / `initiatorName` 仅为兼容老前端保留、服务端忽略。
 *
 * ⚠️ 只有 `iqcLotId` / `reason` 做必填校验，其余字段的**业务校验在 service 里**
 *   （数量上限依赖实时可评审量、急件原因依赖 isUrgent），DTO 层重复校验只会
 *   把报错换成更笼统的文案。
 */
export class MrbReviewerItemDto {
  /** 账号 UUID 或工号（服务端统一规范化为 UUID） */
  @Trim()
  @IsString({ message: '评审人员格式不正确' })
  @IsNotEmpty({ message: '评审人员不能为空' })
  reviewerId!: string;

  @IsOptional()
  @IsString()
  reviewerName?: string;

  @IsOptional()
  @IsString()
  reviewerRole?: string;
}

export class MrbInitiateDto {
  /** IQC 批次 ID：UUID / 检验编号 / 批次号 三者皆可（沿用 resolveIqcLotId） */
  @Trim()
  @IsString({ message: 'IQC 批次 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'IQC 批次 ID 不能为空' })
  iqcLotId!: string;

  /** 不合格原因 */
  @Trim()
  @IsString({ message: '不合格原因格式不正确' })
  @IsNotEmpty({ message: '请填写不合格原因' })
  reason!: string;

  /** 本次评审数量 N（1 ≤ N ≤ 可评审量 M），缺省 = M；支持 4 位小数 */
  @IsOptional()
  @IsNumber({}, { message: '本次评审数量必须是数字' })
  quantity?: number;

  /** 是否直接提交：缺省 true（兼容旧前端） */
  @IsOptional()
  @IsBoolean({ message: 'submit 必须是布尔值' })
  submit?: boolean;

  /** 急件 */
  @IsOptional()
  @IsBoolean({ message: 'isUrgent 必须是布尔值' })
  isUrgent?: boolean;

  /** 急件原因（isUrgent=true 时必填，服务端校验） */
  @IsOptional()
  @IsString()
  urgentReason?: string;

  /** 评审员（submit=true 且需要一步到位时传） */
  @IsOptional()
  @IsArray({ message: '评审人员必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => MrbReviewerItemDto)
  reviewers?: MrbReviewerItemDto[];

  /** @deprecated 发起人一律取登录态，此字段被服务端忽略（仅兼容老前端） */
  @IsOptional()
  initiatorId?: string;

  /** @deprecated 发起人一律取登录态，此字段被服务端忽略（仅兼容老前端） */
  @IsOptional()
  initiatorName?: string;
}
