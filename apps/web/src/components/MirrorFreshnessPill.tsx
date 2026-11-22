import { useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { t } from "../i18n";

// 评审 N5:WMS/OA 嫁接屏读的是 5 分钟镜像。源停摆时操作员侧原本毫无提示,
// 只有侧栏全局"数据同步"戳。本组件按当前模块映射到源 app,最近成功轮询
// 落后于 2×interval 时挂 warning pill;新鲜则完全静默(不占屏幕)。
// 放在模块外壳(整页挂载一次),不放进每个 tab —— tab 切换不重新挂载,
// 定时器也就不会泄漏。

type Freshness = {
  app: string;
  lastSuccessAt: string | null;
  intervalMinutes: number;
  autoSync: boolean;
};

const moduleToApp: Record<string, string[]> = {
  wms: ["wms-rjvn"],
  oa: ["oa-portal"],
  quality: ["wms-rjvn"],
};

const REFRESH_MS = 60_000;

export function MirrorFreshnessPill({ moduleKey, locale }: { moduleKey: string; locale: Locale }) {
  const apps = moduleToApp[moduleKey];
  const [stale, setStale] = useState<string | null>(null);

  useEffect(() => {
    if (!apps?.length) return undefined;
    let alive = true;
    const check = async () => {
      try {
        const res = await apiClient.get<{ items?: Freshness[] }>("/api/live-sync/freshness");
        if (!alive) return;
        const rows = res.items ?? [];
        const mine = rows.filter(r => apps.includes(r.app));
        for (const m of mine) {
          const ageMs = m.lastSuccessAt ? Date.now() - Date.parse(m.lastSuccessAt) : Infinity;
          if (ageMs > 2 * m.intervalMinutes * 60_000) { setStale(m.app); return; }
        }
        setStale(null);
      } catch {
        /* 探针失败不打扰操作员 —— 集成枢纽才是诊断入口 */
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), REFRESH_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [moduleKey]); // eslint-disable-line react-hooks/exhaustive-deps -- apps 由 moduleKey 决定

  if (!stale) return null;
  return (
    <div
      role="status"
      title={t("mirror.staleTooltip", locale)}
      style={{
        position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 18, zIndex: 230,
        background: "#fffbeb", color: "#92400e", border: "2px solid #f59e0b", borderRadius: 10,
        padding: "8px 14px", fontSize: 13, fontWeight: 700, boxShadow: "0 8px 24px rgba(15,23,42,.18)",
        maxWidth: "calc(100vw - 36px)",
      }}
    >
      {t("mirror.staleWarning", locale).replace("{source}", stale)}
    </div>
  );
}
