import { useState, useMemo } from "react";
import {
  mergeDepanelRecords,
  filterByNgCategory,
  ngCategoryPareto,
  buildDepanelNgMigrationPayload,
  type MergedBoard,
  type NgCategory,
  type TestRecord,
} from "./DepanelMergeEngine";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const copy = {
  "zh-CN": {
    title: "ICT+FCT 合并结果",
    subtitle: "DEPANEL · 母板级合并追踪",
    total: "母板总数",
    pass: "PASS",
    ictOnlyNg: "ICT唯NG",
    fctOnlyNg: "FCT唯NG",
    ictFctNg: "ICT+FCT双NG",
    migrate: "迁移 → 维修工单",
    migrateAll: "批量迁移 → 维修",
    boardId: "母板ID",
    slots: "槽位",
    ict: "ICT",
    fct: "FCT",
    noData: "等待 ICT+FCT 数据",
    migrated: "已迁移",
    failed: "迁移失败",
    clickBoard: "点击母板查看详情",
    result: "结果",
    defect: "不良代码",
    testCount: "测试次数",
    pareto: "NG分类帕累托",
  },
  "en-US": {
    title: "ICT+FCT Merge",
    subtitle: "DEPANEL · Motherboard-level merge tracking",
    total: "Total Boards",
    pass: "PASS",
    ictOnlyNg: "ICT-only NG",
    fctOnlyNg: "FCT-only NG",
    ictFctNg: "ICT+FCT NG",
    migrate: "Migrate → Maintenance",
    migrateAll: "Batch Migrate → Maintenance",
    boardId: "Board ID",
    slots: "Slots",
    ict: "ICT",
    fct: "FCT",
    noData: "Waiting for ICT+FCT data",
    migrated: "Migrated",
    failed: "Migration failed",
    clickBoard: "Click board for details",
    result: "Result",
    defect: "Defect",
    testCount: "Test count",
    pareto: "NG Pareto",
  },
  "vi-VN": {
    title: "Hợp nhất ICT+FCT",
    subtitle: "DEPANEL · Theo dõi hợp nhất cấp bo mạch",
    total: "Tổng bo",
    pass: "PASS",
    ictOnlyNg: "NG chỉ ICT",
    fctOnlyNg: "NG chỉ FCT",
    ictFctNg: "NG ICT+FCT",
    migrate: "Chuyển → Bảo trì",
    migrateAll: "Chuyển hàng loạt → Bảo trì",
    boardId: "ID bo mạch",
    slots: "Khe",
    ict: "ICT",
    fct: "FCT",
    noData: "Đang chờ dữ liệu ICT+FCT",
    migrated: "Đã chuyển",
    failed: "Chuyển thất bại",
    clickBoard: "Click bo để xem chi tiết",
    result: "Kết quả",
    defect: "Mã lỗi",
    testCount: "Số lần test",
    pareto: "Pareto NG",
  },
} as const;

interface DepanelMergePanelProps {
  locale: Locale;
  ictRecords: Record<string, unknown>[];
  fctRecords: Record<string, unknown>[];
  onMigrateNg?: (category: NgCategory, payload: object) => Promise<void>;
}

function SlotCell({ slot, lang }: { slot: { slot: number; sn: string; ictResult: string; fctResult: string; defectCode: string; testCount: number; retestRemaining: number }; lang: string }) {
  const ictFail = slot.ictResult === "FAIL";
  const fctFail = slot.fctResult === "FAIL";
  const bothFail = ictFail && fctFail;
  const ictOnly = ictFail && !fctFail;
  const fctOnly = !ictFail && fctFail;
  const pass = slot.ictResult === "PASS" && slot.fctResult === "PASS";
  const bg = bothFail ? "#581c87" : ictOnly ? "#9a3412" : fctOnly ? "#7f1d1d" : pass ? "#064e3b" : "#1e293b";
  const border = bothFail ? "#a855f7" : ictOnly ? "#f97316" : fctOnly ? "#ef4444" : pass ? "#22c55e" : "#334155";
  return (
    <div style={{
      border: `1px solid ${border}`,
      borderRadius: 6,
      padding: "5px 6px",
      background: bg,
      minWidth: 0,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, fontWeight: 900, color: "#e2e8f0" }}>
        <span>#{slot.slot}</span>
        <span style={{ color: slot.ictResult === "FAIL" ? "#fca5a5" : slot.ictResult === "PASS" ? "#86efac" : "#94a3b8" }}>
          {slot.ictResult}
        </span>
        <span style={{ color: slot.fctResult === "FAIL" ? "#fca5a5" : slot.fctResult === "PASS" ? "#86efac" : "#94a3b8" }}>
          {slot.fctResult}
        </span>
      </div>
      {slot.sn && <div style={{ fontSize: 8, fontFamily: "ui-monospace,monospace", color: "#94a3b8", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slot.sn}</div>}
      {slot.defectCode && <div style={{ fontSize: 7, color: "#fca5a5", marginTop: 1 }}>{slot.defectCode}</div>}
    </div>
  );
}

function BoardCard({ board, lang, t }: { board: MergedBoard; lang: string; t: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: "#0b1b2d", border: "1px solid #334155", borderRadius: 10, padding: 11, boxShadow: "inset 0 0 0 2px #07111f" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, color: "#7dd3fc", font: "700 11px ui-monospace,monospace" }}>
        <span>{board.boardId}</span>
        <span style={{ color: board.ngCategory === "PASS" ? "#22c55e" : board.ngCategory === "ICT_FCT_NG" ? "#a855f7" : board.ngCategory === "ICT_ONLY_NG" ? "#f97316" : "#ef4444" }}>
          {board.ngCategory}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
        {board.slots.map((slot) => (
          <SlotCell key={slot.slot} slot={slot} lang={lang} />
        ))}
      </div>
    </div>
  );
}

export function DepanelMergePanel({ locale, ictRecords, fctRecords, onMigrateNg }: DepanelMergePanelProps) {
  const lang = copy[locale] ? locale : "en-US";
  const t = copy[lang as keyof typeof copy] ?? copy["en-US"];

  const { boards, summary, paretoData } = useMemo(() => {
    const ict: TestRecord[] = ictRecords as TestRecord[];
    const fct: TestRecord[] = fctRecords as TestRecord[];
    const result = mergeDepanelRecords({ ictRecords: ict, fctRecords: fct, slotCount: 12, strategy: "MOTHERBOARD" });
    return {
      boards: result.boards,
      summary: result.summary,
      paretoData: ngCategoryPareto(result.boards),
    };
  }, [ictRecords, fctRecords]);

  const [activeCategory, setActiveCategory] = useState<NgCategory | null>(null);
  const [migrateStatus, setMigrateStatus] = useState<Record<NgCategory, string>>({} as Record<NgCategory, string>);

  const handleMigrate = async (category: NgCategory) => {
    if (!onMigrateNg) return;
    setMigrateStatus(prev => ({ ...prev, [category]: "迁移中…" }));
    try {
      const payload = buildDepanelNgMigrationPayload(boards, category, "DEPANEL_PANEL", "OPERATOR");
      await onMigrateNg(category, payload);
      setMigrateStatus(prev => ({ ...prev, [category]: t.migrated }));
    } catch {
      setMigrateStatus(prev => ({ ...prev, [category]: t.failed }));
    }
  };

  const filteredBoards = activeCategory ? filterByNgCategory(boards, [activeCategory]) : boards;

  return (
    <div style={{ fontFamily: "Inter,system-ui,sans-serif", color: "#e2e8f0" }}>
      <style>{`
        .dmp-root{display:flex;flex-direction:column;gap:12px;padding:12px;background:#07111f;min-height:400px;border-radius:12px;border:1px solid #1e3a5f}
        .dmp-head{display:flex;justify-content:space-between;align-items:center}.dmp-head h2{margin:0;font-size:18px;color:#7dd3fc}
        .dmp-summary{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
        .dmp-stat{padding:10px 12px;border-radius:8px;text-align:center;font-size:11px;font-weight:700;border:1px solid #1e3a5f;background:#0b1b2d}
        .dmp-stat span{display:block;font-size:20px;margin-top:3px}
        .dmp-cat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
        .dmp-cat-btn{padding:10px;border-radius:8px;border:2px solid #1e3a5f;background:#0b1b2d;cursor:pointer;font-weight:900;font-size:11px;text-align:center;transition:all .15s}
        .dmp-cat-btn:hover{border-color:#38bdf8;transform:translateY(-1px)}
        .dmp-cat-btn.ict-only{border-color:#f97316;background:#9a3412;color:#fff7ed}
        .dmp-cat-btn.fct-only{border-color:#ef4444;background:#7f1d1d;color:#fee2e2}
        .dmp-cat-btn.ict-fct{border-color:#a855f7;background:#581c87;color:#f3e8ff}
        .dmp-pareto{margin-top:8px;padding:10px;border:1px solid #1e3a5f;border-radius:8px;background:#0b1b2d}
        .dmp-pareto-title{font-size:11px;font-weight:900;color:#7dd3fc;margin-bottom:6px}
        .dmp-bar{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:10px}
        .dmp-bar-label{min-width:90px;color:#94a3b8}
        .dmp-bar-fill{height:10px;border-radius:5px;transition:width .3s}
        .dmp-bar-pct{min-width:40px;color:#e2e8f0;text-align:right}
        .dmp-boards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px;max-height:500px;overflow-y:auto;padding-right:4px}
        .dmp-board{background:#0b1b2d;border:1px solid #334155;border-radius:10px;padding:11px}
        .dmp-board-id{display:flex;justify-content:space-between;margin-bottom:8px;color:#7dd3fc;font:700 11px ui-monospace,monospace}
        .dmp-slot-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
        .dmp-migrate-btn{width:100%;padding:10px;border-radius:8px;border:2px solid #f97316;background:#9a3412;color:#fff7ed;font-weight:900;cursor:pointer;margin-top:8px}
        .dmp-migrate-btn:hover{background:#c2410c}
        .dmp-migrate-btn:disabled{opacity:.45;cursor:not-allowed}
      `}</style>

      <div className="dmp-root">
        <div className="dmp-head">
          <div>
            <h2>{t.title}</h2>
            <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 11 }}>{t.subtitle}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="dmp-migrate-btn" style={{ width: "auto", borderColor: "#a855f7", background: "#581c87", marginTop: 0 }}
              onClick={() => handleMigrate("ICT_FCT_NG")} disabled={summary.ictFctNgCount === 0}>
              {summary.ictFctNgCount > 0 ? `ICT+FCT NG ${summary.ictFctNgCount}板 → 维修` : "无ICT+FCT双NG"}
            </button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="dmp-summary">
          <div className="dmp-stat" style={{ color: "#7dd3fc" }}>{t.total}<span>{summary.totalBoards}</span></div>
          <div className="dmp-stat" style={{ color: "#22c55e" }}>{t.pass}<span>{summary.passCount}</span></div>
          <div className="dmp-stat" style={{ color: "#f97316" }}>{t.ictOnlyNg}<span>{summary.ictOnlyNgCount}</span></div>
          <div className="dmp-stat" style={{ color: "#ef4444" }}>{t.fctOnlyNg}<span>{summary.fctOnlyNgCount}</span></div>
          <div className="dmp-stat" style={{ color: "#a855f7" }}>{t.ictFctNg}<span>{summary.ictFctNgCount}</span></div>
        </div>

        {/* Category filter */}
        <div className="dmp-cat-grid">
          {(["ICT_ONLY_NG", "FCT_ONLY_NG", "ICT_FCT_NG"] as NgCategory[]).map((cat) => {
            const count = cat === "ICT_ONLY_NG" ? summary.ictOnlyNgCount : cat === "FCT_ONLY_NG" ? summary.fctOnlyNgCount : summary.ictFctNgCount;
            const cls = cat === "ICT_ONLY_NG" ? "ict-only" : cat === "FCT_ONLY_NG" ? "fct-only" : "ict-fct";
            const label = cat === "ICT_ONLY_NG" ? t.ictOnlyNg : cat === "FCT_ONLY_NG" ? t.fctOnlyNg : t.ictFctNg;
            return (
              <button key={cat} className={`dmp-cat-btn ${cls}`}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}>
                <div>{label}</div>
                <div style={{ fontSize: 22, marginTop: 4 }}>{count}</div>
                <div style={{ fontSize: 9, marginTop: 2, opacity: 0.7 }}>{migrateStatus[cat] || (count > 0 ? "点击查看" : "—")}</div>
              </button>
            );
          })}
        </div>

        {/* Pareto */}
        {paretoData.length > 0 && (
          <div className="dmp-pareto">
            <div className="dmp-pareto-title">{t.pareto}</div>
            {paretoData.map((item) => (
              <div key={item.category} className="dmp-bar">
                <div className="dmp-bar-label">{item.category}</div>
                <div style={{ flex: 1, background: "#1e293b", borderRadius: 5, height: 10 }}>
                  <div className="dmp-bar-fill" style={{
                    width: `${item.pct}%`,
                    background: item.category === "ICT_ONLY_NG" ? "#f97316" : item.category === "FCT_ONLY_NG" ? "#ef4444" : "#a855f7",
                  }} />
                </div>
                <div className="dmp-bar-pct">{item.count}件 ({item.pct.toFixed(0)}%)</div>
              </div>
            ))}
          </div>
        )}

        {/* Board grid */}
        {filteredBoards.length === 0 ? (
          <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}>{t.noData}</div>
        ) : (
          <div className="dmp-boards">
            {filteredBoards.map((board) => (
              <div key={board.boardId} className="dmp-board">
                <div className="dmp-board-id">
                  <span>{board.boardId}</span>
                  <span style={{ color: board.ngCategory === "PASS" ? "#22c55e" : "#ef4444" }}>{board.ngCategory}</span>
                </div>
                <div className="dmp-slot-grid">
                  {board.slots.map((slot) => (
                    <SlotCell key={slot.slot} slot={slot} lang={lang} />
                  ))}
                </div>
                {board.ngCategory !== "PASS" && (
                  <button className="dmp-migrate-btn" onClick={() => handleMigrate(board.ngCategory)} disabled={!!migrateStatus[board.ngCategory]}>
                    {migrateStatus[board.ngCategory] || t.migrate}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
