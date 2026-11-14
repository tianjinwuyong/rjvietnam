import { Transform } from 'class-transformer';

/**
 * 字符串入参去首尾空格。
 *
 * 用途：创建类接口的必填校验。若不 trim，前端传 "   " 会被 `@IsNotEmpty()` 判为「非空」
 * 而绕过校验，最终仍可能撞数据库约束。统一在 DTO 层做 trim，保证「全空格 == 空」。
 */
export const Trim = (): PropertyDecorator =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
