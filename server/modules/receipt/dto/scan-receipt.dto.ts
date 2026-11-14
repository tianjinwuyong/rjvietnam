import { IsNotEmpty, IsString } from 'class-validator';

/**
 * 收料扫码解析入参（task #118 修复）
 *
 * 背景：`ReceiptService.parseQr` 直接对 `qrContent` 调 `.split('*')`。
 * 当请求体为空 / 缺 `qrContent` 时，`qrContent` 为 `undefined` →
 * TypeError 被 `verifyQr` 的 catch 重新抛出 → 全局异常过滤器落到 500，
 * 把「调用方漏传参数」误报成「服务端故障」。
 *
 * 这里在 DTO 层拦住必填，让缺参返回 400 + 明确中文提示。
 *
 * 注意：
 * 1) `locationId` / `actualQty` 在本 DTO 中**只作可选声明、不挂任何校验装饰器**，
 *    由 ValidationPipe 的 whitelist:false 原样透传给 service，零回归
 *    （不挂 `@IsOptional()` 等会导致这两个字段此前可接受的任意值被拒）。
 * 2) 控制器形参必须写成 `ScanReceiptDto` **本身**，不能写成
 *    `ScanReceiptDto & {...}`：TypeScript 对交叉类型发出的 design:paramtypes
 *    是 `Object`，ValidationPipe 会因 metatype 为原生类型而跳过整个 DTO 校验。
 * 3) 此处**故意不做 trim**：`qrContent` 在库中是精确匹配的唯一键
 *    （`receipt_order.qr_content` 去重比对），改写字符串会超出本次
 *    「消 500」的范围。全空格输入仍会在 `parseQr` 里被判为格式错误（400）。
 *
 * ⚠️ 装饰器顺序：class-validator 按「自下而上」执行，配合全局
 * stopAtFirstError，`@IsNotEmpty` 必须写在最贴近属性的位置。
 */
export class ScanReceiptDto {
  @IsString({ message: '二维码内容格式不正确，应为字符串' })
  @IsNotEmpty({ message: '二维码内容不能为空' })
  qrContent!: string;

  /** 库位 ID（可选，原样透传，不做校验） */
  locationId?: string;

  /** 实收数量（可选，原样透传，不做校验） */
  actualQty?: number;
}

/**
 * 二维码预校验入参（`POST /api/receipt/verify-qr`）
 *
 * 与 `scan` 走同一个 `parseQr`，同样存在 `undefined.split` 的 500 风险，
 * 一并收敛为 400。
 */
export class VerifyQrDto {
  @IsString({ message: '二维码内容格式不正确，应为字符串' })
  @IsNotEmpty({ message: '二维码内容不能为空' })
  qrContent!: string;
}
