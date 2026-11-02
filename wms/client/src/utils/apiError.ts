/**
 * 统一解析后端错误信息。
 *
 * 为什么需要它：
 *   后端全局异常过滤器（server/common/filters/exception.filter.ts）对所有异常
 *   统一返回 `{ error: { code, message, details?, fieldErrors?, timestamp } }`，
 *   但前端的 catch 普遍只读 `err.response.data.message`（取不到）→ 最终回落到
 *   axios 的 `err.message`（形如 "Request failed with status code 500"），
 *   把服务端给出的真实原因盖掉，用户只看到「扫码失败 / 请求失败」这类误报标题。
 *
 *   本函数提供一条统一、兼容旧结构的取值链，供各页面与扫码组件复用。
 */
export interface ApiErrorInfo {
  /** 业务 / HTTP 语义错误码，如 unregistered_material、CONFLICT、INTERNAL_ERROR */
  code: string;
  /** 面向用户的可读信息（优先取服务端 error.message） */
  message: string;
  /** error.details 的解析结果；HttpException 场景下含 errorCode / data 等业务明细 */
  details?: any;
}

/**
 * 从 axios 错误对象中提取可读信息与错误码。
 *
 * @param err      catch 到的异常（通常是 axios error）
 * @param fallback 全部取值都为空时的兜底文案
 */
export function extractApiError(err: any, fallback = ''): ApiErrorInfo {
  const data = err?.response?.data;
  const errorObj = data?.error;

  let code: string = errorObj?.code || data?.errorCode || err?.errorCode || '';
  let message: string =
    errorObj?.message || data?.message || data?.errorMessage || err?.message || fallback;

  // details 可能是对象，也可能是后端 JSON.stringify 后的字符串
  let details: any = errorObj?.details;
  if (typeof details === 'string') {
    try {
      details = JSON.parse(details);
    } catch {
      /* 非 JSON，保持原字符串 */
    }
  }

  // 后端对 HttpException 映射的是 HTTP 语义码（BAD_REQUEST / VALIDATION_ERROR），
  // 真正的业务码（如 unregistered_material）被塞进 details.errorCode，这里恢复它，
  // 以便弹窗标题能按业务原因展示，而不是一律「失败」。
  if ((!code || code === 'BAD_REQUEST' || code === 'VALIDATION_ERROR') && details?.errorCode) {
    code = details.errorCode;
  }

  if (!message) message = fallback;
  return { code, message, details };
}
