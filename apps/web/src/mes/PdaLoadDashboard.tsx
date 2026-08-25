import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Monitor, ScanBarcode, RefreshCw, Clock, Package, Layers, AlertCircle, CheckCircle, XCircle, Copy, ChevronDown, ChevronUp, Search, FileText, Check, AlertTriangle, Trophy, PartyPopper, Sparkles, Volume2, VolumeX } from "lucide-react";
import { wmsApi } from "../api/wms";
import { t } from "../i18n";

// ── Voice / TTS Utility ─────────────────────────────────────────────
type Locale = "zh-CN" | "en-US" | "vi-VN";

function getVoiceMap(): Map<Locale, string> {
  const map = new Map<Locale, string>();
  if (typeof window === "undefined" || !window.speechSynthesis) return map;
  const voices = window.speechSynthesis.getVoices();
  // Prefer native voices by lang suffix
  voices.forEach(v => {
    const lang = (v.lang || "").replace("_", "-");
    if (lang.startsWith("zh")) map.set("zh-CN", v.name);
    else if (lang.startsWith("vi")) map.set("vi-VN", v.name);
    else if (lang.startsWith("en")) map.set("en-US", v.name);
  });
  return map;
}

const VOICE_TEXTS: Record<Locale, { alert: string[]; congratsSingle: string[]; congratsAll: string[] }> = {
  "zh-CN": {
    alert: ["注意", "刷新失败，请重试", "未找到匹配记录", "数据已刷新"],
    congratsSingle: ["太棒了", "工单已完成", "干得漂亮"],
    congratsAll: ["恭喜", "今日上料已全部完成", "干得漂亮"],
  },
  "en-US": {
    alert: ["Attention", "Refresh failed, please retry", "No matching records found", "Data refreshed"],
    congratsSingle: ["Awesome", "Work order completed", "Great job"],
    congratsAll: ["Congratulations", "All work orders completed today", "Great job"],
  },
  "vi-VN": {
    alert: ["Chú ý", "Làm mới thất bại, vui lòng thử lại", "Không tìm thấy bản ghi phù hợp", "Dữ liệu đã được làm mới"],
    congratsSingle: ["Tuyệt vời", "Đơn hàng đã hoàn thành", "Làm tốt lắm"],
    congratsAll: ["Chúc mừng", "Tất cả đơn hàng hôm nay đã hoàn thành", "Làm tốt lắm"],
  },
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function speak(text: string, locale: Locale, voicesReadyRef?: React.MutableRefObject<boolean>) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  // Guard: wait for voices to be ready on first call (PDA WebView loads voices async)
  if (voicesReadyRef && !voicesReadyRef.current) {
    // Voices not ready yet — try anyway with lang-only setting, no specific voice
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = locale === "en-US" ? "en-US" : locale === "vi-VN" ? "vi-VN" : "zh-CN";
    utt.rate = locale === "en-US" ? 1.05 : 0.95;
    utt.pitch = 1;
    utt.volume = 0.9;
    try { window.speechSynthesis.speak(utt); } catch (_e) { /* silent fail on PDA */ }
    return;
  }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  const voiceMap = getVoiceMap();
  const voiceName = voiceMap.get(locale);
  if (voiceName) {
    const voice = window.speechSynthesis.getVoices().find(v => v.name === voiceName);
    if (voice) utt.voice = voice;
  }
  utt.lang = locale === "en-US" ? "en-US" : locale === "vi-VN" ? "vi-VN" : "zh-CN";
  utt.rate = locale === "en-US" ? 1.05 : 0.95;
  utt.pitch = 1;
  utt.volume = 0.9;
  try { window.speechSynthesis.speak(utt); } catch (_e) { /* silent fail on PDA */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function voiceAlert(locale: Locale, voicesReadyRef?: any) { speak(pick(VOICE_TEXTS[locale].alert), locale, voicesReadyRef); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function voiceCongratsSingle(locale: Locale, voicesReadyRef?: any) { speak(pick(VOICE_TEXTS[locale].congratsSingle), locale, voicesReadyRef); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function voiceCongratsAll(locale: Locale, voicesReadyRef?: any) { speak(pick(VOICE_TEXTS[locale].congratsAll), locale, voicesReadyRef); }


interface LoadingStats {
  totalWos: number;
  completedWos: number;
  activeWos: number;
  shelfOccupancyPct: number;
  shelfCounts: { shelf_code: string; cnt: number }[];
  lastPlacement: { wo_code: string; shelf_code: string; operator_name: string; created_at: string } | null;
}

interface ActiveWo {
  wo_code: string;
  product_code: string;
  product_name_zh: string;
  shelf_code: string;
  cells: { cell_number: number; material_code: string; lot_no: string; label_id: string }[];
  operator_name: string;
  placed_at: string;
}

interface HistoryRow {
  id: number;
  wo_code: string;
  shelf_code: string;
  cell_number: number;
  material_code: string;
  lot_no: string;
  qty: number;
  operator_name: string;
  created_at: string;
}

type Tab = "看板" | "管控台";

interface Toast { id: number; type: "success" | "error"; msg: string; }

const CELL_SIZE = 52;
const LIMIT = 20;

export function PdaLoadDashboard({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<Tab>("看板");
  const [stats, setStats] = useState<LoadingStats | null>(null);
  const [prevStats, setPrevStats] = useState<LoadingStats | null>(null);
  const [activeWos, setActiveWos] = useState<ActiveWo[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [filterWo, setFilterWo] = useState("");
  const [filterShelf, setFilterShelf] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [goPage, setGoPage] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [copiedWo, setCopiedWo] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [changedFields, setChangedFields] = useState<Set<string>>(new Set());
  /** Recently completed WOs (shown with celebration badge for 4s) */
  const [justCompleted, setJustCompleted] = useState<Map<string, number>>(new Map());
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  useEffect(() => { voiceEnabledRef.current = voiceEnabled; }, [voiceEnabled]);
  /** Tracks whether speechSynthesis voices have been loaded (PDA WebView loads async) */
  const voicesReadyRef = useRef(false);
  const toastId = useRef(0);
  const prevStatsRef = useRef<LoadingStats | null>(null);
  const prevActiveWosRef = useRef<string[]>([]);

  const addToast = (type: "success" | "error", msg: string) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  };

  const removeToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  const loadStats = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [s, a] = await Promise.all([wmsApi.getLoadingStats(), wmsApi.getLoadingActive()]);
      const incomingWos: string[] = (a.items ?? []).map((wo: ActiveWo) => wo.wo_code);

      // Detect changed stat fields for glow animation
      const prev = prevStatsRef.current;
      if (prev) {
        const changed = new Set<string>();
        if (s.totalWos !== prev.totalWos) changed.add("totalWos");
        if (s.completedWos !== prev.completedWos) changed.add("completedWos");
        if (s.activeWos !== prev.activeWos) changed.add("activeWos");
        if (s.shelfOccupancyPct !== prev.shelfOccupancyPct) changed.add("shelfOccupancyPct");
        if (changed.size > 0) {
          setChangedFields(changed);
          setTimeout(() => setChangedFields(new Set()), 1200);
        }
      }

      // Detect newly completed WOs (were in activeWos, now gone)
      const prevWoCodes = prevActiveWosRef.current;
      const newlyCompleted = prevWoCodes.filter((code: string) => !incomingWos.includes(code));
      if (newlyCompleted.length > 0) {
        const now = Date.now();
        const updated = new Map(justCompleted);
        newlyCompleted.forEach((code: string) => {
          updated.set(code, now);
          addToast("success", `${code} ${t("mes.pdaLoad.woCompleted", locale) ?? "上料已完成 ✓"}`);
        });
        setJustCompleted(updated);
        // Auto-remove after 4 seconds
        setTimeout(() => {
          setJustCompleted(prev => {
            const next = new Map(prev);
            newlyCompleted.forEach((code: string) => next.delete(code));
            return next;
          });
        }, 4000);
        // Voice: individual WO completed
        if (voiceEnabledRef.current) voiceCongratsSingle(locale as Locale, voicesReadyRef);
      }

      // Voice: all WOs completed
      const prevAllDone = prevStatsRef.current && prevStatsRef.current.totalWos > 0 && prevStatsRef.current.completedWos === prevStatsRef.current.totalWos;
      const currAllDone = s.totalWos > 0 && s.completedWos === s.totalWos;
      if (currAllDone && !prevAllDone) {
        if (voiceEnabledRef.current) setTimeout(() => voiceCongratsAll(locale as Locale, voicesReadyRef), 800);
      }
      prevActiveWosRef.current = incomingWos;
      prevStatsRef.current = s;
      setStats(s);
      setActiveWos(a.items ?? []);
    } catch (e) {
      console.error("[PdaLoadDashboard] loadStats:", e);
      addToast("error", t("mes.pdaLoad.refreshFailed", locale) ?? "刷新失败，请重试");
      if (voiceEnabledRef.current) voiceAlert(locale as Locale, voicesReadyRef);
    } finally {
      setIsRefreshing(false);
    }
  }, [locale, justCompleted]);

  const loadHistory = useCallback(async (page = 1, wo?: string, shelf?: string) => {
    setLoading(true);
    try {
      const res = await wmsApi.getLoadingHistory({ page, limit: LIMIT, wo_code: wo || undefined, shelf_code: shelf || undefined });
      setHistory(res.items ?? []);
      setHistoryTotal(res.total ?? 0);
      setHistoryPage(page);
      setExpandedRow(null);
      if ((wo || shelf) && (res.items ?? []).length === 0) {
        addToast("error", t("mes.pdaLoad.noResults", locale) ?? "未找到匹配记录");
        if (voiceEnabledRef.current) voiceAlert(locale as Locale, voicesReadyRef);
      }
    } catch (e) {
      console.error("[PdaLoadDashboard] loadHistory:", e);
      addToast("error", t("mes.pdaLoad.loadHistoryFailed", locale) ?? "历史记录加载失败");
      if (voiceEnabledRef.current) voiceAlert(locale as Locale, voicesReadyRef);
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    // Mark ready on first voices-changed event (voices load async on PDA WebView)
    const onVoices = () => { voicesReadyRef.current = true; };
    window.speechSynthesis.addEventListener("voiceschanged", onVoices);
    // Immediate attempt in case voices already cached
    if (window.speechSynthesis.getVoices().length > 0) voicesReadyRef.current = true;
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", onVoices);
  }, []);

  useEffect(() => { loadStats(); loadHistory(1); }, [loadStats, loadHistory]);

  // Auto-refresh看板 every 15s
  useEffect(() => {
    if (tab !== "看板") return;
    const id = setInterval(loadStats, 15000);
    return () => clearInterval(id);
  }, [tab, loadStats]);

  const handleRefresh = () => {
    loadStats();
    if (tab === "管控台") loadHistory(1, filterWo, filterShelf);
    addToast("success", t("mes.pdaLoad.refreshed", locale) ?? "数据已刷新");
  };

  const handleHistorySearch = () => loadHistory(1, filterWo, filterShelf);

  const handleHistoryReset = () => {
    setFilterWo(""); setFilterShelf(""); setGoPage("");
    loadHistory(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === "Enter") action();
  };

  const handleCopyWo = (wo: string) => {
    navigator.clipboard.writeText(wo).catch(() => {});
    setCopiedWo(wo);
    setTimeout(() => setCopiedWo(null), 1500);
  };

  const handleGoPage = () => {
    const p = parseInt(goPage);
    if (p >= 1 && p <= totalPages) { loadHistory(p, filterWo, filterShelf); setGoPage(""); }
    else addToast("error", t("mes.pdaLoad.invalidPage", locale) ?? "页码无效");
  };

  const totalPages = Math.ceil(historyTotal / LIMIT);

  const shelfMap = useMemo(() => {
    const map = new Map<string, { total: number; occupied: number; wo?: string }>();
    activeWos.forEach((wo) => {
      if (!map.has(wo.shelf_code)) map.set(wo.shelf_code, { total: 12, occupied: wo.cells.length, wo: wo.wo_code });
    });
    stats?.shelfCounts.forEach((s) => {
      const existing = map.get(s.shelf_code);
      if (existing) existing.occupied = s.cnt;
    });
    return map;
  }, [activeWos, stats]);

  function fmt(ts: string) {
    if (!ts) return "—";
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  const hasFilters = filterWo || filterShelf;

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", minHeight: "100vh", background: "#f5f7fa", position: "relative" }}>
      {/* Toast Notifications */}
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{
            background: toast.type === "success" ? "#16a34a" : "#dc2626",
            color: "#fff", borderRadius: 8, padding: "10px 16px",
            fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)", pointerEvents: "all",
            animation: "slideIn 0.25s ease-out",
            minWidth: 200,
          }}>
            {toast.type === "success" ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {toast.msg}
            <button onClick={() => removeToast(toast.id)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, opacity: 0.7 }}>
              <XCircle size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <ScanBarcode size={22} style={{ color: "#2563eb" }} />
          <span
            data-line-domain="MANUAL_LINE"
            title="MES owns the Manual Line PDA loading domain"
            style={{ fontSize: 11, fontWeight: 700, color: "#0f766e", background: "#ccfbf1", borderRadius: 999, padding: "3px 9px" }}
          >
            MANUAL_LINE · MES CONTROL
          </span>
          <span style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b" }}>
            {t("mes.pdaLoad.title", locale) ?? "PDA 上料管控"}
          </span>
          {tab === "看板" && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#dcfce7", borderRadius: 20, padding: "2px 10px" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", display: "inline-block", animation: "pulse 1.5s infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", letterSpacing: 0.5 }}>LIVE</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "12px", color: "#64748b" }}>
            {t("mes.pdaLoad.lastUpdate", locale) ?? "最近更新"}: {stats?.lastPlacement ? fmt(stats.lastPlacement.created_at) : "—"}
          </span>
          {/* Voice mute/unmute toggle */}
          <button
            onClick={() => setVoiceEnabled(v => !v)}
            title={voiceEnabled ? (t("mes.pdaLoad.voiceOn", locale) ?? "关闭语音") : (t("mes.pdaLoad.voiceOff", locale) ?? "开启语音")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: "6px",
              border: "1px solid #e2e8f0", background: voiceEnabled ? "#dcfce7" : "#fee2e2",
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            {voiceEnabled
              ? <Volume2 size={14} style={{ color: "#16a34a" }} />
              : <VolumeX size={14} style={{ color: "#dc2626" }} />
            }
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{
              display: "flex", alignItems: "center", gap: "4px",
              padding: "6px 12px", borderRadius: "6px",
              border: "1px solid #e2e8f0", background: "#fff", cursor: isRefreshing ? "wait" : "pointer",
              fontSize: "13px", color: isRefreshing ? "#94a3b8" : "#475569",
              transition: "all 0.2s",
            }}
          >
            <RefreshCw size={13} style={{ animation: isRefreshing ? "spin 0.8s linear infinite" : "none" }} />
            {isRefreshing ? (t("common.refreshing", locale) ?? "刷新中...") : (t("common.refresh", locale) ?? "刷新")}
          </button>
        </div>
      </div>

      {/* Tab Switcher */}
      <div style={{ display: "flex", gap: "4px", background: "#e2e8f0", borderRadius: "10px", padding: "4px", width: "fit-content" }}>
        {(["看板", "管控台"] as Tab[]).map((t_) => (
          <button
            key={t_}
            onClick={() => setTab(t_)}
            style={{
              padding: "7px 20px", borderRadius: "7px", border: "none", cursor: "pointer",
              fontSize: "13px", fontWeight: 600,
              background: tab === t_ ? "#2563eb" : "transparent",
              color: tab === t_ ? "#fff" : "#475569",
              transition: "all 0.2s",
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {t_ === "看板" ? <Monitor size={13} /> : <Layers size={13} />}
            {t_ === "看板" ? (t("mes.pdaLoad.tabBoard", locale) ?? "看板") : (t("mes.pdaLoad.tabControl", locale) ?? "管控台")}
          </button>
        ))}
      </div>

      {/* ── 看板 Tab ── */}
      {tab === "看板" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "fadeIn 0.2s ease-out" }}>
          {/* Stat Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
            <StatCard
              label={t("mes.pdaLoad.totalWos", locale) ?? "今日上料WO"}
              value={stats?.totalWos ?? 0}
              icon={<ScanBarcode size={18} />}
              color="#2563eb"
              isChanged={changedFields.has("totalWos")}
            />
            <StatCard
              label={t("mes.pdaLoad.completedWos", locale) ?? "已完成"}
              value={stats?.completedWos ?? 0}
              icon={<Package size={18} />}
              color="#16a34a"
              isChanged={changedFields.has("completedWos")}
            />
            <StatCard
              label={t("mes.pdaLoad.activeWos", locale) ?? "进行中"}
              value={stats?.activeWos ?? 0}
              icon={<Clock size={18} />}
              color="#d97706"
              isChanged={changedFields.has("activeWos")}
            />
            <StatCard
              label={t("mes.pdaLoad.shelfOccupancy", locale) ?? "货架占用率"}
              value={`${stats?.shelfOccupancyPct ?? 0}%`}
              icon={<AlertCircle size={18} />}
              color={Number(stats?.shelfOccupancyPct ?? 0) > 80 ? "#dc2626" : Number(stats?.shelfOccupancyPct ?? 0) > 60 ? "#d97706" : "#7c3aed"}
              isChanged={changedFields.has("shelfOccupancyPct")}
              warn={Number(stats?.shelfOccupancyPct ?? 0) > 80}
            />
          </div>

          {/* Active WO List */}
          <div style={{ background: "#fff", borderRadius: "12px", padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
              <Clock size={15} style={{ color: "#d97706" }} />
              {t("mes.pdaLoad.activeWoList", locale) ?? "进行中工单"}
              {activeWos.length > 0 && (
                <span style={{ marginLeft: 6, background: "#fef3c7", color: "#92400e", borderRadius: 12, padding: "1px 8px", fontSize: 12, fontWeight: 700 }}>
                  {activeWos.length}
                </span>
              )}
            </div>
            {/* All-Done Celebration */}
            {(stats?.totalWos ?? 0) > 0 && (stats?.completedWos ?? 0) === (stats?.totalWos ?? 0) ? (
              <CelebrationBanner completedWos={stats!.completedWos} locale={locale} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {/* Recently Completed WOs — celebration row */}
                {Array.from(justCompleted.entries()).map(([wo_code, ts]) => (
                  <CompletedWoCard key={wo_code} wo_code={wo_code} locale={locale} />
                ))}
                {/* Active WOs */}
                {activeWos.length === 0 && justCompleted.size === 0 ? (
                  <EmptyState icon="check" msg={t("mes.pdaLoad.noActive", locale) ?? "暂无进行中的上料工单"} />
                ) : (
                  activeWos.map((wo) => (
                    <WoCard key={wo.wo_code} wo={wo} locale={locale} copiedWo={copiedWo} onCopy={handleCopyWo} />
                  ))
                )}
              </div>
            )}
          </div>

          {/* Shelf Heatmap */}
          {shelfMap.size > 0 && (
            <div style={{ background: "#fff", borderRadius: "12px", padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Layers size={15} style={{ color: "#2563eb" }} />
                {t("mes.pdaLoad.shelfHeatmap", locale) ?? "货架占用热力图"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px" }}>
                {Array.from(shelfMap.entries()).map(([shelf, info]) => (
                  <ShelfHeatmapCard key={shelf} shelf={shelf} info={info} locale={locale} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 管控台 Tab ── */}
      {tab === "管控台" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", animation: "fadeIn 0.2s ease-out" }}>
          {/* Filter Bar - Controlled Inputs */}
          <div style={{ background: "#fff", borderRadius: "12px", padding: "12px 16px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: "13px", color: "#475569", display: "flex", alignItems: "center", gap: "4px" }}>
              <Search size={13} />
              WO:
              <input
                value={filterWo}
                onChange={e => setFilterWo(e.target.value)}
                onKeyDown={e => handleKeyDown(e, handleHistorySearch)}
                placeholder="26061010008"
                style={{ ...inputStyle, width: 140 }}
              />
            </label>
            <label style={{ fontSize: "13px", color: "#475569", display: "flex", alignItems: "center", gap: "4px" }}>
              {t("mes.pdaLoad.shelf", locale) ?? "货架"}:
              <input
                value={filterShelf}
                onChange={e => setFilterShelf(e.target.value)}
                onKeyDown={e => handleKeyDown(e, handleHistorySearch)}
                placeholder="L001A"
                style={{ ...inputStyle, width: 120 }}
              />
            </label>
            <button onClick={handleHistorySearch} style={{ ...btnStyle, background: "#2563eb", color: "#fff", border: "none" }}>
              <Search size={13} style={{ marginRight: 4 }} />
              {t("common.search", locale) ?? "查询"}
            </button>
            {hasFilters && (
              <button onClick={handleHistoryReset} style={{ ...btnStyle, background: "#fef3c7", color: "#92400e", border: "none" }}>
                {t("common.reset", locale) ?? "重置"} {hasFilters && <span style={{ marginLeft: 4, background: "#f59e0b", color: "#fff", borderRadius: 10, padding: "0 6px", fontSize: 11 }}>{[filterWo, filterShelf].filter(Boolean).length}</span>}
              </button>
            )}
          </div>

          {/* History Table */}
          <div style={{ background: "#fff", borderRadius: "12px", padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "12px", display: "flex", alignItems: "center", gap: 8 }}>
              <FileText size={15} style={{ color: "#2563eb" }} />
              {t("mes.pdaLoad.history", locale) ?? "上料历史"}
              {historyTotal > 0 && <span style={{ fontWeight: 400, color: "#64748b", fontSize: 13 }}>({historyTotal} {t("mes.pdaLoad.records", locale) ?? "条记录"})</span>}
            </div>
            {loading ? (
              <SkeletonRows />
            ) : history.length === 0 ? (
              hasFilters ? (
                <EmptyState icon="search" msg={t("mes.pdaLoad.noResultsFilter", locale) ?? "🔍 未找到匹配记录，请调整筛选条件"} />
              ) : (
                <EmptyState icon="doc" msg={t("mes.pdaLoad.noHistory", locale) ?? "📋 暂无上料记录"} />
              )
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                        <th style={thStyle}><span style={{ display: "flex", alignItems: "center", gap: 4 }}><ChevronDown size={12} /> ID</span></th>
                        <th style={thStyle}>{t("mes.pdaLoad.workOrder", locale) ?? "工单"}</th>
                        <th style={thStyle}>{t("mes.pdaLoad.shelf", locale) ?? "货架"}</th>
                        <th style={thStyle}>{t("mes.pdaLoad.cell", locale) ?? "格号"}</th>
                        <th style={thStyle}>{t("mes.pdaLoad.material", locale) ?? "物料"}</th>
                        <th style={thStyle}>LOT</th>
                        <th style={thStyle}>{t("mes.pdaLoad.qty", locale) ?? "数量"}</th>
                        <th style={thStyle}>{t("mes.pdaLoad.operator", locale) ?? "操作员"}</th>
                        <th style={thStyle}>{t("mes.pdaLoad.time", locale) ?? "时间"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row, idx) => (
                        <>
                          <tr
                            key={row.id}
                            onClick={() => setExpandedRow(expandedRow === row.id ? null : row.id)}
                            style={{
                              borderBottom: "1px solid #f1f5f9",
                              cursor: "pointer",
                              background: expandedRow === row.id ? "#f0f9ff" : idx % 2 === 0 ? "#fff" : "#fafbfc",
                              transition: "background 0.15s",
                            }}
                            onMouseEnter={e => { if (expandedRow !== row.id) (e.currentTarget as HTMLElement).style.background = "#f1f5f9"; }}
                            onMouseLeave={e => { if (expandedRow !== row.id) (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? "#fff" : "#fafbfc"; }}
                          >
                            <td style={tdStyle}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                {expandedRow === row.id ? <ChevronUp size={12} style={{ color: "#2563eb" }} /> : <ChevronDown size={12} style={{ color: "#94a3b8" }} />}
                                {row.id}
                              </div>
                            </td>
                            <td style={{ ...tdStyle, fontWeight: 600, color: "#2563eb" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); handleCopyWo(row.wo_code); }}>
                                  {row.wo_code}
                                </span>
                                <button onClick={e => { e.stopPropagation(); handleCopyWo(row.wo_code); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: copiedWo === row.wo_code ? "#16a34a" : "#94a3b8", display: "flex", alignItems: "center" }}>
                                  {copiedWo === row.wo_code ? <Check size={12} /> : <Copy size={11} />}
                                </button>
                              </div>
                            </td>
                            <td style={tdStyle}>{row.shelf_code}</td>
                            <td style={tdStyle}>
                              <span style={{ background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "1px 6px", fontWeight: 700, fontSize: 12 }}>
                                {row.cell_number}
                              </span>
                            </td>
                            <td style={tdStyle}>{row.material_code || "—"}</td>
                            <td style={tdStyle}>{row.lot_no || "—"}</td>
                            <td style={tdStyle}>{row.qty ?? "—"}</td>
                            <td style={tdStyle}>{row.operator_name || "—"}</td>
                            <td style={tdStyle}>{fmt(row.created_at)}</td>
                          </tr>
                          {expandedRow === row.id && (
                            <tr key={`${row.id}-detail`} style={{ background: "#f0f9ff", borderBottom: "1px solid #e2e8f0" }}>
                              <td colSpan={9} style={{ padding: "10px 16px" }}>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                                  <DetailItem label={t("mes.pdaLoad.material", locale) ?? "物料代码"} value={row.material_code || "—"} />
                                  <DetailItem label="LOT No." value={row.lot_no || "—"} />
                                  <DetailItem label={t("mes.pdaLoad.qty", locale) ?? "数量"} value={String(row.qty ?? "—")} />
                                  <DetailItem label={t("mes.pdaLoad.operator", locale) ?? "操作员"} value={row.operator_name || "—"} />
                                  <DetailItem label={t("mes.pdaLoad.shelf", locale) ?? "货架"} value={row.shelf_code} />
                                  <DetailItem label={t("mes.pdaLoad.cell", locale) ?? "格号"} value={String(row.cell_number)} />
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                {totalPages > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#64748b" }}>
                      {t("mes.pdaLoad.showing", locale) ?? "显示"} {((historyPage - 1) * LIMIT) + 1}–{Math.min(historyPage * LIMIT, historyTotal)} {t("mes.pdaLoad.of", locale) ?? "共"} {historyTotal}
                    </span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <button disabled={historyPage <= 1} onClick={() => loadHistory(historyPage - 1, filterWo, filterShelf)}
                        style={{ ...btnStyle, padding: "5px 12px", fontSize: 12, opacity: historyPage <= 1 ? 0.4 : 1, cursor: historyPage <= 1 ? "not-allowed" : "pointer" }}>
                        ← {t("common.prev", locale) ?? "上一页"}
                      </button>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>{historyPage} / {totalPages}</span>
                        {totalPages > 5 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 6 }}>
                            <span style={{ fontSize: 12, color: "#94a3b8" }}>|</span>
                            <input type="number" min={1} max={totalPages} value={goPage} onChange={e => setGoPage(e.target.value)} onKeyDown={e => handleKeyDown(e, handleGoPage)}
                              placeholder="#" style={{ width: 48, padding: "3px 6px", borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 12, textAlign: "center" }} />
                            <button onClick={handleGoPage} style={{ ...btnStyle, padding: "3px 8px", fontSize: 12 }}>GO</button>
                          </div>
                        )}
                      </div>
                      <button disabled={historyPage >= totalPages} onClick={() => loadHistory(historyPage + 1, filterWo, filterShelf)}
                        style={{ ...btnStyle, padding: "5px 12px", fontSize: 12, opacity: historyPage >= totalPages ? 0.4 : 1, cursor: historyPage >= totalPages ? "not-allowed" : "pointer" }}>
                        {t("common.next", locale) ?? "下一页"} →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Global Keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes glow {
          0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.1); }
          100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
        }
        @keyframes shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        @keyframes shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        @keyframes confettiFall {
          0% { transform: translateY(0) rotate(0deg); opacity: 0.7; }
          100% { transform: translateY(200px) rotate(360deg); opacity: 0; }
        }
        @keyframes trophyBounce {
          0% { transform: scale(0) rotate(-15deg); }
          60% { transform: scale(1.2) rotate(5deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        @keyframes sparkle {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ──

const inputStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: "6px",
  padding: "5px 10px",
  fontSize: "13px",
  outline: "none",
  transition: "border-color 0.15s",
};

const btnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "6px",
  border: "1px solid #e2e8f0",
  background: "#fff",
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 600,
  transition: "all 0.15s",
};

const thStyle: React.CSSProperties = {
  padding: "9px 12px",
  textAlign: "left" as const,
  color: "#64748b",
  fontWeight: 600,
  fontSize: "12px",
  whiteSpace: "nowrap" as const,
};

const tdStyle: React.CSSProperties = {
  padding: "9px 12px",
  color: "#334155",
  fontSize: "13px",
};

function StatCard({ label, value, icon, color, isChanged, warn }: { label: string; value: string | number; icon: React.ReactNode; color: string; isChanged?: boolean; warn?: boolean }) {
  return (
    <div style={{
      background: "#fff", borderRadius: "12px", padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      display: "flex", alignItems: "center", gap: "12px",
      border: warn ? "1.5px solid #fca5a5" : "1px solid transparent",
      transition: "all 0.3s",
      animation: isChanged ? "glow 1.2s ease-out" : "none",
      position: "relative", overflow: "hidden",
    }}>
      {isChanged && <div style={{ position: "absolute", inset: 0, background: `linear-gradient(135deg, ${color}08 0%, transparent 60%)`, pointerEvents: "none" }} />}
      <div style={{
        width: "44px", height: "44px", borderRadius: "12px",
        background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", color,
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "2px" }}>{label}</div>
        <div style={{ fontSize: "26px", fontWeight: 800, color: warn ? "#dc2626" : "#1e293b", lineHeight: 1.1 }}>{value}</div>
      </div>
      {warn && (
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <AlertTriangle size={14} style={{ color: "#dc2626" }} />
        </div>
      )}
    </div>
  );
}

function WoCard({ wo, locale, copiedWo, onCopy }: { wo: ActiveWo; locale: Locale; copiedWo: string | null; onCopy: (wo: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px",
        cursor: "pointer", transition: "all 0.15s",
        background: "#fff",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
    >
      <div style={{ display: "flex", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, color: "#2563eb", fontSize: "14px", cursor: "pointer" }} onClick={e => { e.stopPropagation(); onCopy(wo.wo_code); }}>
              {wo.wo_code}
            </span>
            <button onClick={e => { e.stopPropagation(); onCopy(wo.wo_code); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: copiedWo === wo.wo_code ? "#16a34a" : "#94a3b8", display: "flex", alignItems: "center" }}>
              {copiedWo === wo.wo_code ? <Check size={12} /> : <Copy size={11} />}
            </button>
            <span style={{ fontSize: "12px", color: "#64748b", background: "#f1f5f9", borderRadius: 4, padding: "1px 6px" }}>{wo.product_code}</span>
            <span style={{ fontSize: "12px", color: "#64748b" }}>{wo.product_name_zh}</span>
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <span>📦 {wo.shelf_code}</span>
            <span>👤 {wo.operator_name || "—"}</span>
            <span>🕐 {wo.placed_at ? new Date(wo.placed_at).toLocaleTimeString() : "—"}</span>
            <span>🔢 {wo.cells.length} {t("mes.pdaLoad.cells", locale) ?? "格"}</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(wo.cells.length, 6)}, ${CELL_SIZE}px)`, gap: "3px" }}>
          {wo.cells.map((cell) => (
            <div
              key={`${wo.wo_code}-${cell.cell_number}`}
              title={`${cell.material_code} / ${cell.lot_no}`}
              style={{
                width: CELL_SIZE, height: CELL_SIZE, borderRadius: "5px",
                background: cell.label_id ? "#dbeafe" : "#f1f5f9",
                border: cell.label_id ? "1.5px solid #93c5fd" : "1px solid #e2e8f0",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "11px", fontWeight: 700,
                color: cell.label_id ? "#1d4ed8" : "#94a3b8",
              }}
            >
              {cell.cell_number}
            </div>
          ))}
        </div>
        {expanded && (
          <div style={{ width: "100%", marginTop: 8, padding: 8, background: "#f8fafc", borderRadius: 6 }}>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, fontWeight: 700 }}>{t("mes.pdaLoad.cells", locale) ?? "格子详情"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {wo.cells.map(cell => (
                <div key={cell.cell_number} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 8px", minWidth: 120 }}>
                  <div style={{ fontWeight: 700, color: "#2563eb", fontSize: 12 }}>#{cell.cell_number}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{cell.material_code || "—"}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{cell.lot_no || "—"}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ShelfHeatmapCard({ shelf, info, locale }: { shelf: string; info: { total: number; occupied: number; wo?: string }; locale: Locale }) {
  const pct = info.total > 0 ? Math.round((info.occupied / info.total) * 100) : 0;
  const bgColor = pct > 80 ? "#fee2e2" : pct > 60 ? "#fed7aa" : pct > 30 ? "#fef9c3" : "#dcfce7";
  const barColor = pct > 80 ? "#dc2626" : pct > 60 ? "#d97706" : pct > 30 ? "#ca8a04" : "#16a34a";
  const borderColor = pct > 80 ? "#fca5a5" : pct > 60 ? "#fcd34d" : pct > 30 ? "#fde047" : "#86efac";

  return (
    <div style={{ borderRadius: "10px", padding: "12px", background: bgColor, border: `1.5px solid ${borderColor}`, transition: "all 0.2s", cursor: "default" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 8px rgba(0,0,0,0.08)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: "14px", color: "#1e293b" }}>{shelf}</span>
        {pct > 80 && <AlertTriangle size={13} style={{ color: "#dc2626" }} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ flex: 1, height: "7px", background: "rgba(0,0,0,0.1)", borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: "4px", transition: "width 0.5s ease-out" }} />
        </div>
        <span style={{ fontSize: "12px", fontWeight: 800, color: barColor, minWidth: "42px", textAlign: "right" }}>
          {pct}%
        </span>
      </div>
      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px", display: "flex", justifyContent: "space-between" }}>
        <span>{info.occupied}/{info.total} {t("mes.pdaLoad.cells", locale) ?? "格"}</span>
        {info.wo && <span style={{ fontWeight: 600, color: "#2563eb" }}>{info.wo}</span>}
      </div>
    </div>
  );
}

function CelebrationBanner({ completedWos, locale }: { completedWos: number; locale: Locale }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #16a34a 0%, #15803d 40%, #166534 100%)",
      borderRadius: "16px", padding: "40px 32px",
      textAlign: "center", position: "relative", overflow: "hidden",
      boxShadow: "0 8px 32px rgba(22, 163, 74, 0.35)",
    }}>
      {/* Confetti particles */}
      {CONFLETTI.map((c, i) => (
        <div key={i} style={{
          position: "absolute", borderRadius: c.shape === "circle" ? "50%" : "2px",
          width: c.size, height: c.size,
          background: c.color, opacity: 0.7,
          left: `${c.x}%`, top: `-${c.size}`,
          animation: `confettiFall ${1.5 + c.delay}s ease-in ${c.delay}s forwards`,
          transform: `rotate(${c.rotate}deg)`,
        }} />
      ))}

      {/* Glow ring */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "16px",
        background: "radial-gradient(circle at 50% 100%, rgba(255,255,255,0.15) 0%, transparent 60%)",
        pointerEvents: "none",
      }} />

      {/* Trophy icon */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center",
          animation: "trophyBounce 0.8s ease-out",
        }}>
          <Trophy size={38} style={{ color: "#fef08a" }} />
        </div>
      </div>

      {/* Main text */}
      <div style={{ fontSize: "28px", fontWeight: 800, color: "#fff", marginBottom: 8, letterSpacing: -0.5, animation: "fadeIn 0.5s ease-out 0.2s both" }}>
        🎉 {t("mes.pdaLoad.congratsTitle", locale) ?? "恭喜！今日上料已全部完成"}
      </div>
      <div style={{ fontSize: "15px", color: "rgba(255,255,255,0.85)", marginBottom: 24, animation: "fadeIn 0.5s ease-out 0.35s both" }}>
        {t("mes.pdaLoad.congratsSub", locale) ?? `${completedWos} 个工单全部上料完成，干得漂亮！`}
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, animation: "fadeIn 0.5s ease-out 0.5s both" }}>
        <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "12px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", fontWeight: 800, color: "#fef08a" }}>{completedWos}</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>{t("mes.pdaLoad.completedWos", locale) ?? "已完成工单"}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "12px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "32px", fontWeight: 800, color: "#fef08a" }}>
            <CheckCircle size={32} style={{ verticalAlign: "middle" }} />
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>{t("mes.pdaLoad.allDone", locale) ?? "全部完成"}</div>
        </div>
      </div>

      {/* Sparkles decoration */}
      <Sparkles size={20} style={{ position: "absolute", top: 16, left: 20, color: "#fef08a", opacity: 0.6, animation: "sparkle 2s ease-in-out infinite" }} />
      <Sparkles size={16} style={{ position: "absolute", top: 24, right: 28, color: "#fef08a", opacity: 0.5, animation: "sparkle 2s ease-in-out 0.5s infinite" }} />
      <PartyPopper size={20} style={{ position: "absolute", bottom: 16, left: 20, color: "#fef08a", opacity: 0.5, animation: "sparkle 1.5s ease-in-out 0.3s infinite" }} />
      <PartyPopper size={16} style={{ position: "absolute", bottom: 20, right: 24, color: "#fef08a", opacity: 0.4, animation: "sparkle 1.8s ease-in-out 0.8s infinite" }} />
    </div>
  );
}

const CONFLETTI = [
  { x: 5, size: 8, color: "#fbbf24", shape: "square", delay: 0, rotate: 45 },
  { x: 15, size: 6, color: "#f472b6", shape: "circle", delay: 0.2, rotate: 0 },
  { x: 25, size: 10, color: "#34d399", shape: "square", delay: 0.1, rotate: 15 },
  { x: 35, size: 7, color: "#60a5fa", shape: "circle", delay: 0.3, rotate: 90 },
  { x: 45, size: 9, color: "#fbbf24", shape: "square", delay: 0.05, rotate: 30 },
  { x: 55, size: 6, color: "#f472b6", shape: "circle", delay: 0.25, rotate: 60 },
  { x: 65, size: 8, color: "#a78bfa", shape: "square", delay: 0.15, rotate: 75 },
  { x: 75, size: 7, color: "#34d399", shape: "circle", delay: 0.35, rotate: 20 },
  { x: 85, size: 10, color: "#fbbf24", shape: "square", delay: 0.08, rotate: 50 },
  { x: 95, size: 6, color: "#f472b6", shape: "circle", delay: 0.28, rotate: 40 },
];

function CompletedWoCard({ wo_code, locale }: { wo_code: string; locale: Locale }) {
  return (
    <div style={{
      border: "2px dashed #86efac",
      borderRadius: "12px", padding: "14px 18px",
      background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)",
      display: "flex", alignItems: "center", gap: "14px",
      animation: "slideIn 0.4s ease-out",
      position: "relative", overflow: "hidden",
    }}>
      {/* Mini confetti */}
      {MINI_CONF.map((c, i) => (
        <div key={i} style={{
          position: "absolute", borderRadius: "50%",
          width: c.size, height: c.size, background: c.color,
          left: `${c.x}%`, top: `-${c.size}`,
          animation: `confettiFall ${0.8 + c.delay}s ease-in ${c.delay}s forwards`,
        }} />
      ))}

      <div style={{
        width: 44, height: 44, borderRadius: "50%",
        background: "linear-gradient(135deg, #16a34a, #15803d)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, animation: "trophyBounce 0.6s ease-out",
        boxShadow: "0 4px 12px rgba(22,163,74,0.3)",
      }}>
        <CheckCircle size={22} style={{ color: "#fff" }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "16px", fontWeight: 800, color: "#15803d", marginBottom: 2 }}>
          {wo_code}
        </div>
        <div style={{ fontSize: "13px", color: "#16a34a", fontWeight: 600 }}>
          ✓ {t("mes.pdaLoad.woDoneMsg", locale) ?? "上料已完成，干得漂亮！"}
        </div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <Sparkles size={16} style={{ color: "#fbbf24", animation: "sparkle 1.5s ease-in-out infinite" }} />
        <Sparkles size={14} style={{ color: "#fbbf24", animation: "sparkle 1.5s ease-in-out 0.5s infinite" }} />
        <Sparkles size={16} style={{ color: "#fbbf24", animation: "sparkle 1.5s ease-in-out 1s infinite" }} />
      </div>
    </div>
  );
}

const MINI_CONF = [
  { x: 10, size: 6, color: "#fbbf24", delay: 0 },
  { x: 30, size: 5, color: "#f472b6", delay: 0.15 },
  { x: 50, size: 7, color: "#34d399", delay: 0.1 },
  { x: 70, size: 5, color: "#60a5fa", delay: 0.25 },
  { x: 90, size: 6, color: "#fbbf24", delay: 0.05 },
];

function EmptyState({ icon, msg }: { icon: "check" | "doc" | "search"; msg: string }) {
  const icons = { check: <CheckCircle size={32} style={{ color: "#86efac" }} />, doc: <FileText size={32} style={{ color: "#94a3b8" }} />, search: <Search size={32} style={{ color: "#94a3b8" }} /> };
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8" }}>
      <div style={{ marginBottom: 12, opacity: 0.6 }}>{icons[icon]}</div>
      <div style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6 }}>{msg}</div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{ padding: "8px 0" }}>
      {[...Array(5)].map((_, i) => (
        <div key={i} style={{
          height: 44, margin: "6px 0", borderRadius: 6,
          background: "linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)",
          backgroundSize: "400px 100%",
          animation: "shimmer 1.4s ease-in-out infinite",
          animationDelay: `${i * 0.08}s`,
        }} />
      ))}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fff", borderRadius: 6, padding: "6px 10px", border: "1px solid #e2e8f0" }}>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>{value}</div>
    </div>
  );
}
