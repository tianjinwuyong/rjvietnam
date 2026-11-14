import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { Trim } from '../../../common/utils/dto-transform';

/**
 * 创建库位入参（BUG-001 同类，创建接口必填校验补齐）
 *
 * 校验范围只覆盖「NOT NULL 且无默认值」的列：
 *   warehouse_location.location_code varchar(100) NOT NULL UNIQUE
 *   warehouse_location.warehouse_id  uuid         NOT NULL
 * 其余字段（location_type / status 有默认值，area/shelf/layer/position 可空）不加约束。
 *
 * ⚠️ @IsNotEmpty 必须写在最贴近属性的位置（class-validator 自下而上执行 + 全局 stopAtFirstError）。
 */
export class CreateLocationDto {
  @Trim()
  @IsString({ message: '库位编码格式不正确，应为字符串' })
  @MaxLength(100, { message: '库位编码长度不能超过 100 个字符' })
  @IsNotEmpty({ message: '库位编码不能为空' })
  locationCode!: string;

  @IsUUID('all', { message: '所属仓库 ID 格式不正确' })
  @IsNotEmpty({ message: '所属仓库不能为空' })
  warehouseId!: string;
}
