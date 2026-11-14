import { IsNotEmpty, IsString } from 'class-validator';
import { Trim } from '../../../common/utils/dto-transform';

/**
 * 工单动作入参（task #118 扩展）：下发 / 关闭 / 取消
 *
 * 这三处此前直接把 `body.workOrderNo` 透传进 SQL，缺该字段时 postgres-js 抛
 * `UNDEFINED_VALUE` → 500。现在在 DTO 层拦住，返回 400 + 字段级中文提示。
 *
 * 说明：`@Trim()` 是刻意加的——PDA/扫码枪录入的工单号常带首尾空格或换行，
 * 去空格能让「带空格的正确单号」照常命中，比严格比较更贴合现场用法。
 * 其它未声明字段由 ValidationPipe 的 whitelist:false 原样透传，零回归。
 *
 * ⚠️ 装饰器顺序：class-validator 自下而上执行，`@IsNotEmpty` 必须最贴近属性，
 * 否则「缺字段」会被 `@IsString` 之类的规则抢答。
 */
export class WorkOrderNoDto {
  @Trim()
  @IsString({ message: '工单号格式不正确，应为字符串' })
  @IsNotEmpty({ message: '工单号不能为空' })
  workOrderNo!: string;
}

/**
 * 生成领料单入参（`POST /api/workorder/picking/generate`）
 *
 * `reqId` 为物料需求单 ID（必填）。`applicantId` / `applicantName` 由控制器
 * 用登录态覆盖，故不在此声明。
 */
export class GeneratePickingDto {
  @Trim()
  @IsString({ message: '需求单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: '需求单 ID 不能为空' })
  reqId!: string;
}
