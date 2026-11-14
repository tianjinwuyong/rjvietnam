import { X509Certificate } from 'crypto';
import { networkInterfaces } from 'os';
import { existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';

/**
 * HTTPS 证书工具：负责"证书是否还能用"的判断与自动续期。
 *
 * 背景：手机端调用摄像头（getUserMedia）要求页面处于安全上下文，
 * 即必须通过 HTTPS 访问，且证书要被设备信任。自 Chrome 58 / iOS Safari 12
 * 起浏览器只认证书的 SAN（Subject Alternative Name）字段、完全忽略 CN，
 * 因此证书里的 SAN 必须覆盖手机实际访问用的那个 IP。
 *
 * 局域网 IP 会随路由器/热点变化，所以这里在每次启动时做一次校验，
 * 发现证书缺失或未覆盖当前 IP 就自动重新生成。
 */

export interface LanAddress {
  /** IPv4 地址，如 192.168.3.163 */
  address: string;
  /** 网卡名称，仅用于日志 */
  iface: string;
}

/** 本机可用于被手机访问的 IPv4 地址（排除回环与 169.254 链路本地地址） */
export function getLanIPv4(): LanAddress[] {
  const out: LanAddress[] = [];
  const nets = networkInterfaces();
  for (const [iface, addrs] of Object.entries(nets)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      out.push({ address: a.address, iface });
    }
  }
  return out;
}

/** 证书信息摘要 */
export interface CertInfo {
  subject: string;
  issuer: string;
  notAfter: Date;
  /** SAN 原文，如 "DNS:localhost, IP Address:192.168.3.163" */
  san: string;
  /** 从 SAN 中解析出的所有条目 */
  entries: string[];
  expired: boolean;
}

/** 解析 DER/PEM 证书文件，失败返回 null */
export function readCert(crtPath: string): CertInfo | null {
  try {
    if (!existsSync(crtPath)) return null;
    const buf = readFileSync(crtPath);
    const cert = new X509Certificate(buf);
    const san = cert.subjectAltName || '';
    const entries = san
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      subject: cert.subject.replace(/\n/g, ' '),
      issuer: cert.issuer.replace(/\n/g, ' '),
      notAfter: new Date(cert.validTo),
      san,
      entries,
      expired: new Date(cert.validTo).getTime() < Date.now(),
    };
  } catch {
    return null;
  }
}

/** 从 SAN 条目中提取 IP 列表与 DNS 列表 */
export function parseSanEntries(entries: string[]): { ips: string[]; dns: string[] } {
  const ips: string[] = [];
  const dns: string[] = [];
  for (const e of entries) {
    const m = /^(DNS|IP Address|IPAddress)\s*[:=]\s*(.+)$/i.exec(e);
    if (!m) continue;
    const value = m[2].trim();
    if (/^ip/i.test(m[1])) ips.push(value);
    else dns.push(value);
  }
  return { ips, dns };
}

export interface CertCheckResult {
  /** 证书是否已足够覆盖当前访问地址 */
  ok: boolean;
  /** 不满足时的原因（用于日志） */
  reason?: string;
  info: CertInfo | null;
  /** 缺失覆盖的地址 */
  missing: string[];
}

/**
 * 校验证书能否覆盖给定的 IP / 主机名集合。
 * 只要 SAN 里出现了所有需要覆盖的项，就认为可用。
 */
export function checkCertCoverage(
  crtPath: string,
  requiredIps: string[],
  requiredDns: string[] = [],
): CertCheckResult {
  const info = readCert(crtPath);
  if (!info) {
    return { ok: false, reason: '证书文件不存在或无法解析', info: null, missing: [] };
  }
  if (info.expired) {
    return { ok: false, reason: `证书已过期（${info.notAfter.toISOString().slice(0, 10)}）`, info, missing: [] };
  }
  const { ips, dns } = parseSanEntries(info.entries);
  if (ips.length === 0 && dns.length === 0) {
    return {
      ok: false,
      reason: '证书缺少 SAN（Subject Alternative Name）扩展，现代浏览器会直接判定为不安全',
      info,
      missing: [...requiredIps, ...requiredDns],
    };
  }
  const hasIp = new Set(ips);
  const hasDns = new Set(dns.map((d) => d.toLowerCase()));
  const missing: string[] = [];
  for (const ip of requiredIps) if (!hasIp.has(ip)) missing.push(ip);
  for (const name of requiredDns) if (!hasDns.has(name.toLowerCase())) missing.push(name);
  if (missing.length > 0) {
    return { ok: false, reason: `证书未覆盖以下地址：${missing.join(', ')}`, info, missing };
  }
  return { ok: true, info, missing: [] };
}

export interface EnsureCertOptions {
  /** 项目根目录（含 ssl/ 与 scripts/） */
  root: string;
  /** PFX 密码，需与 HTTPS 服务读取时一致 */
  passphrase?: string;
  /** 需要覆盖的 IP，默认取本机全部局域网 IP */
  ips?: string[];
  /** 额外需要覆盖的主机名 */
  dns?: string[];
}

export interface EnsureCertResult {
  /** 是否重新生成了证书 */
  regenerated: boolean;
  /** 生成/校验后的证书信息 */
  info: CertInfo | null;
  /** 说明信息，用于日志 */
  message: string;
  /** 本次脚本报告的可用 IP（用于日志展示） */
  ips: string[];
}

/**
 * 确保证书存在且覆盖当前局域网地址；不满足时调用 PowerShell 脚本重新生成。
 * 生成失败不抛异常（返回 regenerated=false），以免影响服务启动 ——
 * 服务仍会以 HTTP 启动，只是手机端摄像头不可用。
 */
export function ensureSslCert(opts: EnsureCertOptions): EnsureCertResult {
  const { root } = opts;
  const passphrase = opts.passphrase || 'wms2024';
  const pfxPath = join(root, 'ssl', 'wms-cert.pfx');
  const crtPath = join(root, 'ssl', 'wms-cert.crt');
  const scriptPath = join(root, 'scripts', 'gen-ssl-cert.ps1');

  const lan = getLanIPv4();
  const requiredIps = opts.ips ?? ['127.0.0.1', ...lan.map((l) => l.address)];
  const requiredDns = opts.dns ?? ['localhost'];

  const check = checkCertCoverage(crtPath, requiredIps, requiredDns);
  if (check.ok && existsSync(pfxPath)) {
    return {
      regenerated: false,
      info: check.info,
      message: `证书有效，有效期至 ${check.info?.notAfter.toISOString().slice(0, 10)}`,
      ips: parseSanEntries(check.info?.entries || []).ips,
    };
  }

  if (!existsSync(scriptPath)) {
    return {
      regenerated: false,
      info: check.info,
      message: `证书需要更新（${check.reason}），但未找到生成脚本 ${scriptPath}`,
      ips: [],
    };
  }

  try {
    const stdout = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        // 部分机器的执行策略为 Restricted，会直接拒绝运行脚本，这里显式放行
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Json',
        '-Passphrase',
        passphrase,
      ],
      { cwd: root, encoding: 'utf8', timeout: 60_000, windowsHide: true },
    );
    const jsonLine = stdout.split(/\r?\n/).find((l) => l.trim().startsWith('{'));
    const parsed = jsonLine ? JSON.parse(jsonLine) : null;
    const newInfo = readCert(crtPath);
    return {
      regenerated: true,
      info: newInfo,
      message: `检测到证书需要更新（${check.reason}），已重新生成`,
      ips: parsed?.ips ?? [],
    };
  } catch (e: any) {
    return {
      regenerated: false,
      info: check.info,
      message: `证书自动生成失败：${e?.message || e}`,
      ips: [],
    };
  }
}
