import { IsNotEmpty, IsString } from 'class-validator';
import { Trim } from '../../../common/utils/dto-transform';

/**
 * 返工单动作入参（task #118 扩展）：开工 / 完工 / 复检
 *
 * 三处均以 `body.id`（返工单 ID）为必填。此前缺该字段会把 `undefined` 透传进
 * SQL，postgres-js 抛 `UNDEFINED_VALUE` → 500；现在统一在 DTO 层拦成 400。
 *
 * `operatorId` 由控制器用登录态覆盖（防冒名），故不在此声明。
 *
 * `remark` 只作可选声明、不挂校验装饰器，由 whitelist:false 原样透传。
 *
 * ⚠️ 控制器形参必须写成本类（或其子类），**不能**写成 `ReworkIdDto & {...}`：
 * TypeScript 对交叉类型发出的 design:paramtypes 是 `Object`，
 * ValidationPipe 会因 metatype 为原生类型而跳过整个 DTO 校验。
 * 需要额外字段时用继承（见下），不要用交叉类型。
 */
export class ReworkIdDto {
  @Trim()
  @IsString({ message: '返工单 ID 格式不正确，应为字符串' })
  @IsNotEmpty({ message: '返工单 ID 不能为空' })
  id!: string;

  /** 备注（可选，原样透传，不做校验） */
  remark?: string;
}

/**
 * 返工复检入参：在 id 必填的基础上多一个 `result`。
 *
 * 刻意不给 `result` 加 `@IsIn`：服务端已有业务校验并给出更贴切的提示，
 * 在 DTO 层重复校验只会把报错信息换成通用文案，反而更难排查。
 */
export class ReworkReinspectDto extends ReworkIdDto {
  /** 复检结论（pass / fail），由服务端校验 */
  result!: 'pass' | 'fail';
}
