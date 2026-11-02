import { IsNotEmpty, IsString } from 'class-validator';
import { Trim } from '../../../common/utils/dto-transform';

/**
 * MRB 方案制定入参（MRB v3）
 *
 * SQE 在评审开始前定死：评审员 + 各类处置 + 每个处置从哪些收货箱分走多少。
 * 数量一律由 `labels` 汇总得出，**不允许**单独传 quantity，
 * 避免「处置行数量」与「箱级分摊」两套数字对不上。
 */
export class MrbPlanLabelDto {
  /** 收货单 ID（= 一个收货箱 = 一个二维码） */
  receiptId!: string;

  /** 本箱分给该处置的数量 */
  quantity!: number;
}

export class MrbPlanDispositionDto {
  /** special_admit(特采) / return(退货) / rework(返工) / scrap(报废) / other(其他) */
  dispositionType!: 'special_admit' | 'return' | 'rework' | 'scrap' | 'other';

  /** 仅 other 时有效：customer_return / sample / hold */
  otherType?: string;
  refNo?: string;
  holdUntil?: string;
  remark?: string;

  /** 箱级分摊明细，必须非空 */
  labels!: MrbPlanLabelDto[];
}

export class MrbPlanDto {
  @Trim()
  @IsString({ message: 'MRB 评审单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'MRB 评审单 ID 不能为空' })
  mrbId!: string;

  /** 评审人员（不传则保留原有名单） */
  reviewers?: { reviewerId: string; reviewerName?: string; reviewerRole?: string }[];

  /** 处置方案（提交时必须非空） */
  dispositions?: MrbPlanDispositionDto[];

  /** 不合格原因（提交方案时必填，覆盖系统自动触发的说明文案） */
  failReason?: string;

  /** true=提交评审，false=存草稿；缺省 true */
  submit?: boolean;

  /** 是否跳过资料齐全性预审（缺省 true，见设计文档 §4.2） */
  skipPreApproval?: boolean;
}
