import { Logger } from '@nestjs/common';

/**
 * MES → WMS 工单接口客户端
 * ------------------------------------------------------------------
 * 文档：WMS工单下发接口_对接文档_20261030.md（v1.0）
 * Base : http://192.168.6.27:8080/api/itf/wms
 * Auth : 请求头 X-Api-Key
 *
 * 设计要点：
 *  1. 只做 HTTP + 协议解析，不碰数据库，便于单独联调；
 *  2. 所有响应都带 requestId，出错时把 requestId 一起抛出去，
 *     用户拿这个号找 MES 维护人就能定位到那一次调用；
 *  3. MES 的时间是「越南时间 +07:00 的裸字符串」，这里统一按 +07:00 解析、
 *     按 +07:00 回写，避免部署机时区不同导致增量游标漂移。
 */

export const MES_TZ_OFFSET_MIN = 7 * 60; // +07:00（文档：越南时间）

export interface MesConfig {
  baseUrl: string;
  apiKey: string;
  autoSync: boolean;
  intervalMinutes: number;
  autoPicking: boolean;
  /** MES 领料单是否直接生效（免审批） */
  pickingAutoApprove: boolean;
  /**
   * 对接操作人（sys_account.id）
   * ------------------------------------------------------------------
   * MES 接口目前不返回「下单人 / 批准人」，台账上又不能空着，
   * 这里指定一个 WMS 账号代签：MES 同步出来的领料单，申请人/审批人都记他，
   * 备注里注明是系统同步。等 MES 开放人员字段后，真人优先、匹配不上才落这个账号。
   */
  operatorId: string;
  /** 发料结果是否回写 MES（MES 写接口未开放前保持关闭） */
  writebackEnabled: boolean;
}

export interface MesMoItem {
  moNo: string;
  woType: string;
  productCode: string;
  productName: string;
  productModel: string;
  spec: string;
  unit: string;
  panelCount: number;
  planQty: number;
  outQty: number;
  ngQty: number;
  lineCode: string;
  status: string;
  poNo: string;
  poLine: string;
  custCode: string;
  planStart: string;
  planEnd: string;
  actualStart: string;
  actualEnd: string;
  bomVersion: string;
  fgCode: string;
  srcMoNo: string;
  remark: string;
  createdAt: string;
  updatedAt: string;
  issueNo: string;
  issueStatus: string;
  issueCount: number;
}

export interface MesMaterial {
  materialCode: string;
  materialName: string;
  spec: string;
  unit: string;
  qtyPer: number;
  needQty: number;
  issueQty: number;
  openQty: number;
  mpq: number;
  posRef: string;
  altList: string;
  isAlt: number;
  segment: string;
  mainCode: string;
  source: string;
  suggestIssueQty: number;
}

export interface MesMoPage {
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  items: MesMoItem[];
  requestId?: string;
}

export interface MesMaterialsResult {
  moNo: string;
  productCode: string;
  planQty: number;
  source: string;
  bomVersionUsed: string;
  materialCount: number;
  materials: MesMaterial[];
  issues: any[];
  requestId?: string;
}

export interface MesPendingMo extends MesMoItem {
  materials: MesMaterial[];
}

/** MES 返回的错误：带上 requestId，方便对方查日志 */
export class MesApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: number | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = 'MesApiError';
  }

  /** 给界面看的完整描述（用户截图给 MES 就能定位） */
  toDisplay(): string {
    const parts = [this.message];
    if (this.code != null) parts.push(`code=${this.code}`);
    if (this.httpStatus) parts.push(`HTTP ${this.httpStatus}`);
    if (this.requestId) parts.push(`requestId=${this.requestId}`);
    return parts.join('，');
  }
}

/** "2026-10-30 23:58:12" → Date（按 +07:00 解释）；也接受标准 ISO */
export function parseMesTime(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (m) {
    // 文档明确：不带时区后缀的时间就是 +07:00
    const utc = Date.UTC(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] ?? 0),
    ) - MES_TZ_OFFSET_MIN * 60_000;
    return new Date(utc);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → "2026-10-30 23:58:12"（+07:00 墙面时间），用于回传给 updated_since */
export function formatMesTime(d: Date): string {
  const t = new Date(d.getTime() + MES_TZ_OFFSET_MIN * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} `
    + `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
}

/** "2026-10-26" → "2026-10-26"；空值/非法返回 null，避免日期列报错 */
export function safeMesDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export class MesClient {
  private readonly logger = new Logger(MesClient.name);

  constructor(private config: MesConfig) {}

  setConfig(cfg: MesConfig) {
    this.config = cfg;
  }

  get configured(): boolean {
    return !!(this.config.baseUrl && this.config.apiKey);
  }

  private url(path: string, params?: Record<string, string | number | boolean | undefined | null>) {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const u = new URL(`${base}/api/itf/wms${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  private async request<T>(
    path: string,
    params?: Record<string, any>,
    timeoutMs = 20_000,
    init?: { method?: string; body?: any },
  ): Promise<T & { requestId?: string }> {
    if (!this.config.baseUrl) throw new MesApiError('MES 接口地址未配置', 0, null, null);
    if (!this.config.apiKey) throw new MesApiError('MES 接口密钥未配置', 0, null, null);

    const url = this.url(path, params);
    const started = Date.now();
    const method = init?.method || 'GET';
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'X-Api-Key': this.config.apiKey,
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: any) {
      const msg = e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? `连接 MES 超时（${timeoutMs / 1000}s）：${url}`
        : `连接 MES 失败：${e?.message || e}`;
      throw new MesApiError(msg, 0, null, null);
    }

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new MesApiError(
        `MES 返回的不是 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`,
        res.status, null, null,
      );
    }

    const requestId = json?.requestId ?? null;
    // 文档错误码：200/0 成功；40101 密钥错；40404 工单不存在；50001 内部错误
    if (!res.ok || (json?.code !== undefined && json.code !== 0)) {
      const msg = json?.message || `MES 返回 HTTP ${res.status}`;
      if (res.status === 401 || json?.code === 40101) {
        throw new MesApiError(`MES 鉴权失败：${msg}（密钥可能已重置，请重新复制）`, res.status, json?.code ?? null, requestId);
      }
      throw new MesApiError(msg, res.status, json?.code ?? null, requestId);
    }

    this.logger.log(`GET ${path} ${res.status} ${Date.now() - started}ms rid=${requestId ?? '-'}`);
    return { ...(json?.data ?? {}), requestId: requestId ?? undefined } as T & { requestId?: string };
  }

  /** 探活：返回服务名与 MES 服务器时间 */
  ping() {
    return this.request<{ service: string; ok: boolean; serverTime: string; utcOffset: string }>(
      '/ping', undefined, 10_000,
    );
  }

  /** 工单清单（支持增量、分页、过滤） */
  listMo(q: {
    updatedSince?: string;
    page?: number;
    pageSize?: number;
    onlyOpen?: boolean;
    status?: string;
    lineCode?: string;
    poNo?: string;
    custCode?: string;
    woType?: string;
  }) {
    return this.request<MesMoPage>('/mo', {
      updated_since: q.updatedSince,
      page: q.page ?? 1,
      page_size: q.pageSize ?? 200,
      only_open: q.onlyOpen ? 'true' : undefined,
      status: q.status,
      line_code: q.lineCode,
      po_no: q.poNo,
      cust_code: q.custCode,
      wo_type: q.woType,
    }, 60_000);
  }

  /** 工单详情（含 materials[] 与 issues[]） */
  getMo(moNo: string) {
    return this.request<MesMoItem & { materials: MesMaterial[]; issues: any[] }>(
      `/mo/${encodeURIComponent(moNo)}`, undefined, 60_000,
    );
  }

  /** 只取领料明细 —— 生成备料/领料任务用这个 */
  getMaterials(moNo: string) {
    return this.request<MesMaterialsResult>(`/mo/${encodeURIComponent(moNo)}/materials`, undefined, 60_000);
  }

  /**
   * 待领料工单：未完工且仍有缺口，materials 已只含 openQty>0 的行。
   * 文档没给这个接口的包装字段示例，这里对 items / list / mos / 裸数组都做兼容，
   * 免得 MES 换成另一种包装就整块功能失效。
   */
  async listPending(limit = 50) {
    const res = await this.request<any>('/issue/pending', { limit }, 60_000);
    let items: MesPendingMo[] = [];
    if (Array.isArray(res)) items = res;
    else items = res?.items ?? res?.list ?? res?.mos ?? res?.rows ?? [];
    return { items, requestId: res?.requestId as string | undefined };
  }

  /**
   * 发料结果回写：把某张 MES 领料单的实发明细推回 MES。
   * MES 侧应按 idempotencyKey 去重，重复推送只记一次。
   */
  postIssued(issueNo: string, payload: Record<string, any>) {
    return this.request<any>(
      `/issue/${encodeURIComponent(issueNo)}/issued`,
      undefined,
      15_000,
      { method: 'POST', body: payload },
    );
  }
}
