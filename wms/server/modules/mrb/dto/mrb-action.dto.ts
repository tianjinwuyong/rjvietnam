import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Trim } from '../../../common/utils/dto-transform';
import { MrbReviewerItemDto } from './initiate.dto';

/**
 * MRB 生命周期写端点入参（submit / cancel / pre-approve / reject）。
 *
 * 设计原则与 final-approve.dto.ts 一致：
 *  - 只对「漏传就必然 500」的 mrbId 做必填校验；
 *  - 其余字段只做可选声明并透传给 service，由服务端状态机 + 业务规则校验，
 *    因为同一字段在不同状态下的必填性不同（如 remark 在 complete 时可空、
 *    在 incomplete 时必须 ≥5 字），DTO 层重复校验只会把报错换成更笼统的文案。
 */

/** POST /api/mrb/submit { mrbId } —— 草稿提交 */
export class MrbSubmitDto {
  @Trim()
  @IsString({ message: 'MRB 评审单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'MRB 评审单 ID 不能为空' })
  mrbId!: string;
}

/** POST /api/mrb/cancel { mrbId, reason } —— 作废 */
export class MrbCancelDto {
  @Trim()
  @IsString({ message: 'MRB 评审单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'MRB 评审单 ID 不能为空' })
  mrbId!: string;

  /** 作废原因（≥5 字，服务端校验） */
  @IsOptional()
  @IsString()
  reason?: string;
}

/** POST /api/mrb/assign-reviewers { mrbId, reviewers } */
export class MrbAssignReviewersDto {
  @Trim()
  @IsString({ message: 'MRB 评审单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'MRB 评审单 ID 不能为空' })
  mrbId!: string;

  @IsArray({ message: '评审人员必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => MrbReviewerItemDto)
  reviewers!: MrbReviewerItemDto[];
}

/** POST /api/mrb/withdraw { mrbId, reason } —— 撤回方案（评审中 → 待制定方案） */
export class MrbWithdrawDto {
  @Trim()
  @IsString({ message: 'MRB 评审单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'MRB 评审单 ID 不能为空' })
  mrbId!: string;

  /** 撤回原因（≥5 字，服务端校验） */
  @IsOptional()
  @IsString()
  reason?: string;
}

/** POST /api/mrb/return-back { mrbId, reason } —— 审批驳回（退回 SQE 改方案） */
export class MrbReturnBackDto {
  @Trim()
  @IsString({ message: 'MRB 评审单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'MRB 评审单 ID 不能为空' })
  mrbId!: string;

  /** 驳回原因（≥5 字，服务端校验） */
  @IsOptional()
  @IsString()
  reason?: string;
}

/** POST /api/mrb/pre-approve { mrbId, result, remark?, separationRemark? } */
export class MrbPreApproveDto {
  @Trim()
  @IsString({ message: 'MRB 评审单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'MRB 评审单 ID 不能为空' })
  mrbId!: string;

  /** complete=资料齐全 / incomplete=驳回（退回 SQE 改方案） / skip=管理员人工跳过 */
  @IsIn(['complete', 'incomplete', 'skip'], {
    message: '预审结果仅支持：complete / incomplete / skip',
  })
  result!: 'complete' | 'incomplete' | 'skip';

  /** 预审说明 / 驳回原因（incomplete、skip 必填且 ≥5 字，服务端校验） */
  @IsOptional()
  @IsString()
  remark?: string;

  /** 单人审批代审说明（2~200 字） */
  @IsOptional()
  @IsString()
  separationRemark?: string;
}

/** POST /api/mrb/reject { mrbId, reason, separationRemark? } */
export class MrbRejectDto {
  @Trim()
  @IsString({ message: 'MRB 评审单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'MRB 评审单 ID 不能为空' })
  mrbId!: string;

  /** 驳回理由（≥5 字，服务端校验） */
  @IsOptional()
  @IsString()
  reason?: string;

  /** 单人审批代审说明（2~200 字） */
  @IsOptional()
  @IsString()
  separationRemark?: string;
}

/** POST /api/mrb/disposition/:id/destroy { remark? } —— 报废销毁（MRB v3） */
export class MrbDestroyScrapDto {
  /** 销毁说明（可选，写进库存流水备注，便于事后追溯） */
  @IsOptional()
  @IsString()
  remark?: string;
}
