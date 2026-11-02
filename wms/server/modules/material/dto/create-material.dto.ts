import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../common/utils/dto-transform';

/**
 * 创建物料入参（BUG-002 修复）
 *
 * 校验范围只覆盖「NOT NULL 且无默认值」的列：
 *   material.material_code varchar(100) NOT NULL UNIQUE
 *   material.material_name varchar(200) NOT NULL
 * 其余字段（unit / msl_level / status / unit_price / over_issue_ratio … 都有默认值，
 * specification / vietnam_code … 可空）一律不加约束，避免给存量调用带来回归。
 *
 * 重复的 materialCode 由数据库唯一约束抛出，统一异常过滤器映射为 409（BUG-002 验收要求），
 * 不走本 DTO。
 *
 * ⚠️ @IsNotEmpty 必须写在最贴近属性的位置（class-validator 自下而上执行 + 全局 stopAtFirstError）。
 */
export class CreateMaterialDto {
  @Trim()
  @IsString({ message: '物料编码格式不正确，应为字符串' })
  @MaxLength(100, { message: '物料编码长度不能超过 100 个字符' })
  @IsNotEmpty({ message: '物料编码不能为空' })
  materialCode!: string;

  @Trim()
  @IsString({ message: '物料名称格式不正确，应为字符串' })
  @MaxLength(200, { message: '物料名称长度不能超过 200 个字符' })
  @IsNotEmpty({ message: '物料名称不能为空' })
  materialName!: string;
}
