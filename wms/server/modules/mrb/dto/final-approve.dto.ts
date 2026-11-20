import { IsNotEmpty, IsString } from 'class-validator';
import type { MrbDispositionInput } from '@shared/api.interface';
import { Trim } from '../../../common/utils/dto-transform';

/**
 * MRB 终审入参（task #118 扩展）
 *
 * 本 DTO 只对 `mrbId` 做**必填**校验，让「漏传 mrbId」从 500（postgres-js 的
 * UNDEFINED_VALUE）回落为 400 + 字段级中文提示。
 *
 * 其余字段只作**可选声明、不挂任何校验装饰器**，由 ValidationPipe 的
 * whitelist:false 原样透传给 service（不加校验是为了保持既有业务语义：
 * `finalResult` 由服务端状态机校验，`dispositions` 由服务端归一化，
 * 在这里重复校验只会把报错换成更笼统的文案）。
 *
 * ⚠️ 控制器形参必须写成本类**本身**，不能写成 `MrbFinalApproveDto & {...}`：
 * TypeScript 对交叉类型发出的 design:paramtypes 是 `Object`，
 * ValidationPipe 会因 metatype 为原生类型而跳过整个 DTO 校验。
 *
 * ⚠️ 审批人来源（2026-10-15 已修）：`approverId` / `approverName` **不再取自请求体**，
 * 控制器一律以登录态（`req.userContext.userId` / `userName`）为准，防止已登录用户冒名审批。
 * 这里保留两个字段的**可选声明**仅为向后兼容（老前端仍会带上，服务端直接忽略，
 * 若删掉字段也不会报错，因为 whitelist:false 会原样透传）。
 */
export class MrbFinalApproveDto {
  @Trim()
  @IsString({ message: 'MRB 评审单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: 'MRB 评审单 ID 不能为空' })
  mrbId!: string;

  /**
   * 终审结论（兼容字段）。
   * @deprecated 服务端由 `dispositions` 推导「主处置」（数量最大的一行），此字段仅在
   *   **未传 dispositions 且非 other** 时被当作「全量单行处置」使用；
   *   `finalResult='other'` 且不传 dispositions 会直接 400「请填写处置明细」。
   */
  finalResult?: 'special_admit' | 'return' | 'rework' | 'scrap' | 'other';

  /** 终审备注（可选，原样透传） */
  finalRemark?: string;

  /**
   * 单人审批代审说明（2~200 字）。
   * 预审人（completeness_by）与终审人为同一人时**必填**，否则 400。
   */
  separationRemark?: string;

  /** @deprecated 审批人 ID 一律取登录态，此字段被服务端忽略（仅为兼容老前端保留） */
  approverId?: string;

  /** @deprecated 审批人名称一律取登录态，此字段被服务端忽略（仅为兼容老前端保留） */
  approverName?: string;

  /**
   * 拆分处置明细（服务端归一化 + 守恒校验）。
   * 每行可带 `otherType` / `refNo` / `holdUntil`（「其他」三类必填见设计文档 §4.3）。
   */
  dispositions?: MrbDispositionInput[];
}
