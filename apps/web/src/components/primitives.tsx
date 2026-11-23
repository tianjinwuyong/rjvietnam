// 共享 UI 基元 —— 阶段4步2 从 App.tsx 整段搬迁（refactor-plan-2026-11-21）。
// 各域 dispatcher(Wms/Mes/Hr/Admin/Dashboard…)共用;唯一改动是 React.CSSProperties
// 改为显式 import CSSProperties(新文件没有 React UMD 全局)。声明体逐字未改。
import type { CSSProperties, ReactNode } from "react";
import type { StatusTone } from "../../../../packages/shared-types/src/factory";

export function toneForStatus(status: string): StatusTone {
  if (
    status === "running" ||
    status === "released" ||
    status === "PASS" ||
    status === "CLOSED" ||
    status === "confirmed" ||
    status === "received" ||
    status === "stored" ||
    status === "picked" ||
    status === "issued" ||
    status === "bound" ||
    status === "mounted" ||
    status === "packed" ||
    status === "shipped" ||
    status === "approved"
  ) {
    return "ok";
  }
  if (status === "changeover" || status === "pending" || status === "hold" || status === "REPAIRING" || status === "draft") {
    return "warning";
  }
  if (status === "down" || status === "FAIL" || status === "rejected" || status === "fail" || status === "blocked") {
    return "danger";
  }
  return "info";
}

export function Badge({ tone, children, title }: { tone: StatusTone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title ?? (typeof children === "string" ? children : undefined)}>
      {children}
    </span>
  );
}

export function Progress({ value, title }: { value: number; title?: string }) {
  return (
    <div className="progress" aria-label={title ?? `${Math.round(value)}%`} title={title ?? `${Math.round(value)}%`}>
      <span style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  trend,
  tone,
}: {
  label: string;
  value: string;
  trend: string;
  tone: StatusTone;
}) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <Badge tone={tone}>{trend}</Badge>
    </article>
  );
}

export function SurfacePanel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <section className="surface-panel" style={style}>{children}</section>;
}

export function TableShell({ children }: { children: ReactNode }) {
  return <div className="table-shell">{children}</div>;
}

