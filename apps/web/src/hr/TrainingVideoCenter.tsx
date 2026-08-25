import { useEffect, useMemo, useState } from "react";
import { hrApi, type TrainingVideo } from "../api";

const DOMAIN_NAMES: Record<string, string> = {
  HR: "人事与员工", MES: "生产与MES", WMS: "仓库与WMS",
  QUALITY: "质量管理", SAFETY: "安全与合规", STATION: "工位操作",
};
const LANGUAGE_NAMES: Record<string, string> = {
  "zh-CN": "中文", en: "English", vi: "Tiếng Việt",
};

function formatDuration(seconds: number | null) {
  if (!seconds) return "时长待补";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function displayTitle(video: TrainingVideo) {
  return video.titleZh || video.titleEn || video.titleVi || video.videoCode;
}

export function TrainingVideoCenter() {
  const [videos, setVideos] = useState<TrainingVideo[]>([]);
  const [selected, setSelected] = useState<TrainingVideo | null>(null);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [language, setLanguage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadVideos() {
    setLoading(true);
    setError("");
    try {
      const result = await hrApi.getTrainingVideos({
        q: query.trim() || undefined,
        domain: domain || undefined,
        language: language || undefined,
        status: "PUBLISHED",
      });
      const rows = result?.items || [];
      setVideos(rows);
      setSelected((current) => rows.find((item) => item.id === current?.id) || rows[0] || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "视频目录读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(loadVideos, 220);
    return () => window.clearTimeout(timer);
  }, [query, domain, language]);

  const grouped = useMemo(() => {
    const map = new Map<string, TrainingVideo[]>();
    for (const video of videos) {
      const key = `${video.businessDomain}:${video.topicCode}`;
      map.set(key, [...(map.get(key) || []), video]);
    }
    return [...map.entries()];
  }, [videos]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(310px, 42%) minmax(360px, 1fr)", gap: 16 }}>
      <section className="surface-panel" style={{ padding: 16, minHeight: 560 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, color: "#f8fafc" }}>培训视频中心</h3>
            <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>按主题集中管理，相关内容一处找到</div>
          </div>
          <span style={{ marginLeft: "auto", color: "#67e8f9", fontWeight: 700 }}>{videos.length} 个视频</span>
        </div>
        <input className="field-input" value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索：员工登记、人脸录入、PDA、工位、维修…"
          style={{ width: "100%", fontSize: 15, padding: "11px 12px", marginBottom: 10 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          <select className="field-input" value={domain} onChange={(event) => setDomain(event.target.value)}>
            <option value="">全部业务域</option>
            {Object.entries(DOMAIN_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
          <select className="field-input" value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="">全部语言</option>
            {Object.entries(LANGUAGE_NAMES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </div>
        {loading && <div style={{ color: "#94a3b8", padding: 24, textAlign: "center" }}>正在查找相关视频…</div>}
        {error && <div style={{ background: "#7f1d1d", color: "#fecaca", padding: 12, borderRadius: 10 }}>{error}</div>}
        {!loading && !error && grouped.length === 0 && <div style={{ color: "#94a3b8", padding: 36, textAlign: "center" }}>没有找到相关视频。</div>}
        <div style={{ display: "grid", gap: 12, maxHeight: 425, overflowY: "auto", paddingRight: 4 }}>
          {grouped.map(([key, items]) => (
            <div key={key}>
              <div style={{ color: "#67e8f9", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                {DOMAIN_NAMES[items[0].businessDomain] || items[0].businessDomain} · {items[0].topicCode}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {items.map((video) => {
                  const active = selected?.id === video.id;
                  return <button key={video.id} type="button" onClick={() => setSelected(video)} style={{
                    textAlign: "left", borderRadius: 10, padding: "10px 12px", cursor: "pointer",
                    border: active ? "1px solid #22d3ee" : "1px solid #334155",
                    background: active ? "#164e63" : "#111827", color: "#f8fafc",
                  }}>
                    <div style={{ fontWeight: 700, lineHeight: 1.4 }}>{displayTitle(video)}</div>
                    <div style={{ display: "flex", gap: 8, color: "#94a3b8", fontSize: 12, marginTop: 5, flexWrap: "wrap" }}>
                      <span>{LANGUAGE_NAMES[video.languageCode] || video.languageCode}</span>
                      <span>V{video.versionNo}</span><span>{formatDuration(video.durationSeconds)}</span>
                      {video.stationCode && <span>工位：{video.stationCode}</span>}
                    </div>
                  </button>;
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="surface-panel" style={{ padding: 18, minHeight: 560 }}>
        {!selected ? <div style={{ color: "#94a3b8", height: "100%", display: "grid", placeItems: "center" }}>从左侧选择视频</div> : <>
          <div style={{ color: "#67e8f9", fontSize: 12, fontWeight: 700 }}>
            {DOMAIN_NAMES[selected.businessDomain] || selected.businessDomain} / {selected.topicCode}
          </div>
          <h2 style={{ color: "#f8fafc", margin: "8px 0 4px" }}>{displayTitle(selected)}</h2>
          <div style={{ color: "#94a3b8", marginBottom: 14 }}>
            {selected.videoCode} · {LANGUAGE_NAMES[selected.languageCode] || selected.languageCode} · V{selected.versionNo}
          </div>
          <video key={selected.id} controls preload="metadata" poster={selected.thumbnailUrl || undefined}
            style={{ width: "100%", maxHeight: 380, borderRadius: 12, background: "#020617", border: "1px solid #334155" }}>
            <source src={selected.fileUrl} type={selected.mimeType || "video/mp4"} />
            当前设备不支持视频播放。
          </video>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
            {(selected.tags || []).map((tag) => <span key={tag} style={{
              background: "#1e293b", color: "#cbd5e1", borderRadius: 999, padding: "4px 9px", fontSize: 12,
            }}>{tag}</span>)}
          </div>
          {selected.routeKeys?.length > 0 && <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 12 }}>
            相关页面：{selected.routeKeys.join(" · ")}
          </div>}
        </>}
      </section>
    </div>
  );
}
