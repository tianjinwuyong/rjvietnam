import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../common/utils/dto-transform';

/**
 * 创建供应商入参（BUG-002 同类，创建接口必填校验补齐）
 *
 * 校验范围只覆盖「NOT NULL 且无默认值」的列：
 *   supplier.supplier_code varchar(50)  NOT NULL UNIQUE
 *   supplier.supplier_name varchar(200) NOT NULL
 * 其余字段（status 有默认值，contact_* / address / description 可空）不加约束。
 *
 * ⚠️ @IsNotEmpty 必须写在最贴近属性的位置（class-validator 自下而上执行 + 全局 stopAtFirstError）。
 */
export class CreateSupplierDto {
  @Trim()
  @IsString({ message: '供应商编码格式不正确，应为字符串' })
  @MaxLength(50, { message: '供应商编码长度不能超过 50 个字符' })
  @IsNotEmpty({ message: '供应商编码不能为空' })
  supplierCode!: string;

  @Trim()
  @IsString({ message: '供应商名称格式不正确，应为字符串' })
  @MaxLength(200, { message: '供应商名称长度不能超过 200 个字符' })
  @IsNotEmpty({ message: '供应商名称不能为空' })
  supplierName!: string;
}
