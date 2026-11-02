import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../common/utils/dto-transform';

/**
 * 创建仓库入参（BUG-001 修复）
 *
 * 校验范围只覆盖数据库中「NOT NULL 且无默认值」的列：
 *   warehouse.wh_code   varchar(50)  NOT NULL UNIQUE
 *   warehouse.wh_name_zh varchar(100) NOT NULL
 * 其余字段（wh_type / status 有默认值，address / description 可空，wh_name_vi/en 可空）
 * 一律不加约束，避免给存量调用带来回归。
 *
 * 注意：本 DTO 只声明必填字段，未声明的字段由 ValidationPipe 的 whitelist:false
 * 原样透传给 service（class-transformer 默认保留未知属性）。
 *
 * ⚠️ 装饰器顺序有讲究：class-validator 按「自下而上」的顺序执行约束，
 * 配合全局 ValidationPipe 的 stopAtFirstError，每个字段只会报第一条失败。
 * 因此 @IsNotEmpty 必须写在最贴近属性的位置，保证「字段缺失/为空」优先得到
 * 「XXX不能为空」这条最贴切的提示，而不是被长度规则抢占。
 */
export class CreateWarehouseDto {
  @Trim()
  @IsString({ message: '仓库编码格式不正确，应为字符串' })
  @MaxLength(50, { message: '仓库编码长度不能超过 50 个字符' })
  @IsNotEmpty({ message: '仓库编码不能为空' })
  whCode!: string;

  @Trim()
  @IsString({ message: '仓库中文名格式不正确，应为字符串' })
  @MaxLength(100, { message: '仓库中文名长度不能超过 100 个字符' })
  @IsNotEmpty({ message: '仓库中文名不能为空' })
  whNameZh!: string;
}
