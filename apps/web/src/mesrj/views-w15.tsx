// MES-ruijing W15 前端 —— 班次填报看板 / 汇总（源 web/pages.js「班次填报」页 + api/shift.py）
// 路由（后端 services/api/src/routes/mesrj.js）：
//   GET  /shift/board  /shift/summary  /shift/options  /shift/stationmap
//   POST /shift/save   /shift/delete   /shift/stationmap
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesrjApi } from "./api";
import { t } from "./i18n";

const box = { border: "1px solid var(--border, #e2e8f0)", borderRadius: 10, padding: 14, marginBottom: 14 } as const;
const inp = { padding: "6px 8px", marginRight: 6 } as const;
const cell = { padding: "4px 6px", borderBottom: "1px solid #f1f5f9" } as const;
const numInp = { ...inp, width: 80 } as const;

function Err({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#b91c1c", padding: "6px 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{msg}</div>;
}
function Ok({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div style={{ color: "#15803d", padding: "6px 0", fontSize: 13 }}>{msg}</div>;
}

interface BoardRow {
  mo_no: string; process: string; product_code: string; model?: string; line_code?: string;
  plan_qty: number; done_qty: number; ng_qty: number; headcount: number; work_hours: number;
  uph: number; upph: number; total_hours: number; rate: number; eff: number;
  remark: string; report_id: number | null; filled: boolean; manual: boolean;
  std_uph: number; std_headcount: number; plan_id?: number | null;
}
interface Board { date: string; shift: string; rows: BoardRow[]; hours: number;
  totals: { plan_qty: number; done_qty: number; ng_qty: number } }
interface SummaryRow { k: string; cnt: number; plan_qty: number; done_qty: number; ng_qty: number;
  total_hours: number; rate: number | null; ng_rate: number; upph: number }

export function ShiftBoardView({ locale }: { locale: Locale }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState("DAY");
  const [line, setLine] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<BoardRow>>>({});
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"board" | "summary" | "map">("board");

  const [sumGroup, setSumGroup] = useState("day");
  const [sumRows, setSumRows] = useState<SummaryRow[]>([]);
  const [map, setMap] = useState<Record<string, string[]>>({});
  const [mapText, setMapText] = useState("");

  const loadBoard = useCallback(async () => {
    setErr(""); setEdits({});
    try {
      setBoard(await mesrjApi.get<Board>("/shift/board", { date, shift, line_code: line }));
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, [date, shift, line]);

  const loadSummary = useCallback(async () => {
    setErr("");
    try {
      const d = await mesrjApi.get<{ rows: SummaryRow[] }>("/shift/summary",
        { d1: date, d2: date, group: sumGroup, line_code: line });
      setSumRows(d.rows || []);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, [date, sumGroup, line]);

  const loadMap = useCallback(async () => {
    try {
      const d = await mesrjApi.get<{ map: Record<string, string[]> }>("/shift/stationmap");
      setMap(d.map || {});
      setMapText(JSON.stringify(d.map || {}, null, 2));
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  }, []);

  useEffect(() => { if (tab === "board") loadBoard(); }, [tab, loadBoard]);
  useEffect(() => { if (tab === "summary") loadSummary(); }, [tab, loadSummary]);
  useEffect(() => { if (tab === "map") loadMap(); }, [tab, loadMap]);

  const patch = (key: string, field: keyof BoardRow, value: number) =>
    setEdits(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  const valOf = (r: BoardRow, field: keyof BoardRow) =>
    Number(edits[`${r.mo_no}|${r.process}`]?.[field] ?? r[field] ?? 0);

  const save = async () => {
    setErr(""); setMsg("");
    const rows = (board?.rows || []).map(r => ({
      ...r,
      done_qty: valOf(r, "done_qty"), ng_qty: valOf(r, "ng_qty"),
      headcount: valOf(r, "headcount"), work_hours: valOf(r, "work_hours"),
      remark: edits[`${r.mo_no}|${r.process}`]?.remark ?? r.remark,
    }));
    try {
      const r = await mesrjApi.post<{ saved: number }>("/shift/save", { date, shift, rows });
      setMsg(`${t("common.save", locale)} ${r.saved ?? ""}`);
      await loadBoard();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const saveMap = async () => {
    setErr(""); setMsg("");
    try {
      const parsed = JSON.parse(mapText);
      await mesrjApi.post("/shift/stationmap", { map: parsed });
      setMsg(t("shift.msg.mapSaved", locale)); setMap(parsed);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
  };

  const cols: [keyof BoardRow, string][] = [
    ["mo_no", t("shift.field.mo", locale)], ["product_code", t("shift.field.product", locale)],
    ["process", t("shift.field.process", locale)], ["line_code", t("shift.field.line", locale)],
    ["plan_qty", t("shift.field.plan", locale)], ["done_qty", t("shift.field.done", locale)],
    ["ng_qty", t("shift.field.ng", locale)], ["headcount", t("shift.field.headcount", locale)],
    ["work_hours", t("shift.field.hours", locale)], ["uph", "UPH"], ["upph", "UPPH"],
    ["total_hours", t("shift.field.totalHours", locale)], ["rate", t("shift.field.rate", locale)],
    ["eff", t("shift.field.eff", locale)], ["remark", t("shift.field.remark", locale)],
  ];

  return (
    <div>
      <div style={box}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{t("shift.field.date", locale)}</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{t("shift.field.shift", locale)}</div>
            <select value={shift} onChange={e => setShift(e.target.value)} style={inp}>
              <option value="DAY">{t("shift.shift.day", locale)}</option>
              <option value="NIGHT">{t("shift.shift.night", locale)}</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{t("shift.field.line", locale)}</div>
            <input value={line} onChange={e => setLine(e.target.value)} style={{ ...inp, width: 120 }} />
          </div>
          <button onClick={tab === "board" ? loadBoard : tab === "summary" ? loadSummary : loadMap}>
            {t("snlist.search", locale)}
          </button>
          <button onClick={() => setTab("board")}>{t("shift.tab.board", locale)}</button>
          <button onClick={() => setTab("summary")}>{t("shift.tab.summary", locale)}</button>
          <button onClick={() => setTab("map")}>{t("shift.tab.map", locale)}</button>
          {tab === "board" ? <button onClick={save}>{t("common.save", locale)}</button> : null}
          {tab === "map" ? <button onClick={saveMap}>{t("common.save", locale)}</button> : null}
        </div>
        <Err msg={err} />
        <Ok msg={msg} />
      </div>

      {tab === "board" ? (
        <div style={box}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>{cols.map(([k, label]) => (
                  <th key={k} style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{label}</th>
                ))}</tr>
              </thead>
              <tbody>
                {(board?.rows || []).map(r => {
                  const key = `${r.mo_no}|${r.process}`;
                  return (
                    <tr key={key} style={{ background: r.manual ? "#fffbeb" : undefined }}>
                      {cols.map(([c]) => {
                        if (c === "done_qty" || c === "ng_qty" || c === "headcount" || c === "work_hours") {
                          return (
                            <td key={c} style={cell}>
                              <input value={String(valOf(r, c))} onChange={e => patch(key, c, Number(e.target.value))}
                                style={{ ...numInp, marginRight: 0 }} />
                            </td>
                          );
                        }
                        if (c === "remark") {
                          return (
                            <td key={c} style={cell}>
                              <input value={edits[key]?.remark ?? r.remark ?? ""}
                                onChange={e => setEdits(prev => ({ ...prev, [key]: { ...prev[key], remark: e.target.value } }))}
                                style={{ ...inp, width: 160, marginRight: 0 }} />
                            </td>
                          );
                        }
                        return <td key={c} style={cell}>{String(r[c] ?? "")}</td>;
                      })}
                    </tr>
                  );
                })}
                {board && !board.rows.length ? (
                  <tr><td colSpan={cols.length} style={{ ...cell, color: "#94a3b8" }}>{t("snlist.empty", locale)}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {board ? (
            <div style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>
              {t("shift.field.plan", locale)} {board.totals.plan_qty} · {t("shift.field.done", locale)} {board.totals.done_qty}
              {" · "}{t("shift.field.ng", locale)} {board.totals.ng_qty}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "summary" ? (
        <div style={box}>
          <select value={sumGroup} onChange={e => setSumGroup(e.target.value)} style={inp}>
            <option value="day">{t("shift.group.day", locale)}</option>
            <option value="line">{t("shift.field.line", locale)}</option>
            <option value="process">{t("shift.field.process", locale)}</option>
            <option value="mo">{t("shift.field.mo", locale)}</option>
            <option value="product">{t("shift.field.product", locale)}</option>
          </select>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>{[["k", t("shift.field.key", locale)], ["cnt", t("shift.field.cnt", locale)],
                  ["plan_qty", t("shift.field.plan", locale)], ["done_qty", t("shift.field.done", locale)],
                  ["ng_qty", t("shift.field.ng", locale)], ["rate", t("shift.field.rate", locale)],
                  ["ng_rate", t("shift.field.ngRate", locale)], ["upph", "UPPH"]].map(([k, label]) => (
                    <th key={k} style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{label}</th>
                  ))}</tr>
              </thead>
              <tbody>
                {sumRows.map(r => (
                  <tr key={r.k}>
                    {["k", "cnt", "plan_qty", "done_qty", "ng_qty", "rate", "ng_rate", "upph"].map(c => (
                      <td key={c} style={cell}>{String((r as unknown as Record<string, unknown>)[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "map" ? (
        <div style={box}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{t("shift.msg.mapHint", locale)}</div>
          <textarea value={mapText} onChange={e => setMapText(e.target.value)}
            style={{ width: "100%", minHeight: 220, fontFamily: "monospace", fontSize: 12, padding: 8 }} />
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
            {Object.keys(map).length} {t("shift.field.mapKeys", locale)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
