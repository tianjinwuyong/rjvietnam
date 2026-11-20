/**
 * 安全上下文 / HTTPS 相关工具。
 *
 * 手机端调用摄像头（getUserMedia）要求页面处于"安全上下文"：
 *   1) 通过 https:// 访问，且证书被设备信任；或
 *   2) 通过 http://localhost / 127.0.0.1 访问（本地开发的例外）。
 *
 * 局域网 IP 用 HTTP 访问时不属于安全上下文，navigator.mediaDevices 直接为
 * undefined，任何摄像头调用都会失败。本模块负责判断当前处于哪种状态，
 * 并给出可用于跳转的 HTTPS 地址。
 */

export type SecureContextState =
  /** 安全上下文，摄像头可用 */
  | 'secure'
  /** HTTP 访问（局域网 IP），需要切到 HTTPS */
  | 'insecure-http'
  /** HTTPS 但证书不被信任，浏览器同样不认为是安全上下文 */
  | 'insecure-cert';

export interface RuntimeConfig {
  httpPort: number;
  httpsPort: number;
  lanIps: string[];
  /** 服务端推测的主访问地址，如 https://192.168.3.163:3443 */
  httpsUrl: string;
}

let cachedConfig: RuntimeConfig | null = null;
let pending: Promise<RuntimeConfig | null> | null = null;

/**
 * 读取服务端运行时网络配置（HTTP / HTTPS 端口、局域网 IP）。
 * 该接口无需登录，结果会缓存，失败返回 null 并由调用方走默认值。
 */
export function fetchRuntimeConfig(): Promise<RuntimeConfig | null> {
  if (cachedConfig) return Promise.resolve(cachedConfig);
  if (pending) return pending;
  pending = fetch('/api/system/runtime-config')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const data = j?.data ?? j;
      if (data && typeof data.httpsPort === 'number') {
        cachedConfig = data as RuntimeConfig;
        return cachedConfig;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** 同步获取已缓存的配置（未加载过则为 null） */
export function getRuntimeConfigSync(): RuntimeConfig | null {
  return cachedConfig;
}

/** 当前页面的安全上下文状态 */
export function getSecureContextState(): SecureContextState {
  if (window.isSecureContext && !!navigator.mediaDevices?.getUserMedia) {
    return 'secure';
  }
  return window.location.protocol === 'https:' ? 'insecure-cert' : 'insecure-http';
}

/**
 * 生成与当前页面路径一致的 HTTPS 访问地址。
 *
 * 此前实现用 href.replace(':3000', ':3443')，当访问地址不带端口、
 * 或 HTTP/HTTPS 端口被改过时会拼错。这里改为按主机名 + 实际 HTTPS 端口拼接，
 * 端口优先取服务端运行时配置，未取到时回退到 3443。
 */
export function buildHttpsUrl(): string {
  const { hostname, pathname, search, hash, protocol } = window.location;
  if (protocol === 'https:') return window.location.href;
  const httpsPort = cachedConfig?.httpsPort ?? 3443;
  // 80/443 这类默认端口不写进 URL
  const portPart = httpsPort === 443 ? '' : `:${httpsPort}`;
  return `https://${hostname}${portPart}${pathname}${search}${hash}`;
}

/** 跳转到 HTTPS 版本的同名页面 */
export function redirectToHttps(): void {
  window.location.href = buildHttpsUrl();
}

/** 进入系统时预热一次运行时配置，供后续同步使用 */
export function primeRuntimeConfig(): void {
  void fetchRuntimeConfig();
}
