import { useMemo, useState } from "react";
import { Lightbulb, LightbulbOff, PackagePlus, PackageMinus, Tag, RotateCcw, Plus, Trash2, ChevronRight } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import {
  SmartShelfClient,
  createMockShelfServer,
  type ShelfRecord,
  type ShelfSlot,
  type ShelfOutColor,
} from "../../../../integrations/smart-shelf/src";

// ── Light color palette (matches spec) ──────────────────────────
const LIGHT_COLORS: Record<number, { fill: string; glow: string; label: string }> = {
  0: { fill: "#9ca3af", glow: "transparent", label: "0" },
  1: { fill: "#fafafa", glow: "#fafafa", label: "1" },
  3: { fill: "#3b82f6", glow: "#3b82f6", label: "3 蓝" },
  4: { fill: "#facc15", glow: "#facc15", label: "4 黄" },
  5: { fill: "#ec4899", glow: "#ec4899", label: "5 洋红" },
  6: { fill: "#06b6d4", glow: "#06b6d4", label: "6 青" },
  7: { fill: "#ffffff", glow: "#ffffff", label: "7 白" },
};

const COLS = 4;
const ROWS = 2;
const SLOT_W = 86;
const SLOT_H = 62;
const SLOT_GAP = 6;
const SHELF_PAD = 14;
const SHELF_HEADER = 36;

type Selection = { shelfCode: string; slotIndex: number } | null;

export function WmsShelfSimulator({ locale }: { locale: Locale }) {
  // One mock server for the lifetime of the page
  const [mock] = useState(() => createMockShelfServer());
  const [tick, setTick] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [actionLog, setActionLog] = useState<Array<{ time: string; msg: string; tone: "ok" | "ng" | "info" }>>([]);
  const [newShelfCode, setNewShelfCode] = useState("");
  const [newLabelId, setNewLabelId] = useState("");
  const [outLabelList, setOutLabelList] = useState("");

  const client = useMemo(() => new SmartShelfClient({
    baseUrl: "http://mock.local:8093",
    fetchImpl: mock.fetch,
  }), [mock]);

  // Force re-render on any mock mutation
  const refresh = () => setTick((t) => t + 1);

  const log = (msg: string, tone: "ok" | "ng" | "info" = "info") => {
    const time = new Date().toLocaleTimeString();
    setActionLog((prev) => [{ time, msg, tone }, ...prev].slice(0, 20));
  };

  const shelves = Array.from(mock.state.shelves.values());
  const totalSlots = shelves.reduce((s, sh) => s + sh.slots.length, 0);
  const occupied = shelves.reduce(
    (s, sh) => s + sh.slots.filter((sl) => sl.labelId !== null).length, 0,
  );
  void tick;

  // ── Light control ────────────────────────────────────────────
  const setLight = async (shelfCode: string, color: 0 | 1) => {
    try {
      const res = await client.lightOnAllEmptyLocation({ shelfCode, color });
      log(`Light ${shelfCode} color=${color} → ${res.Result}`, "ok");
      refresh();
    } catch (err) {
      log(`Light ${shelfCode} → NG: ${err instanceof Error ? err.message : String(err)}`, "ng");
    }
  };

  const setLightColor = async (shelfCode: string, color: ShelfOutColor) => {
    const shelf = mock.state.shelves.get(shelfCode);
    if (!shelf) return;
    // LightOnAllEmptyLocation only takes 0|1; for color, use a hack: light on, then store color
    // The spec doesn't define colored light via LightOn; we'll just toggle on with color=1
    // and visually override via the shelf record. For ShelfOut, color works.
    // For demo: pretend we set the light via the API and also update our local state.
    try {
      await client.lightOnAllEmptyLocation({ shelfCode, color: 1 });
      shelf.lightOn = true;
      shelf.lightColor = color;
      log(`Set ${shelfCode} light color=${color}`, "ok");
      refresh();
    } catch (err) {
      log(`Set color ${shelfCode} → NG: ${err instanceof Error ? err.message : String(err)}`, "ng");
    }
  };

  // ── Put in ───────────────────────────────────────────────────
  const putIn = async (shelfCode: string, labelId: string) => {
    try {
      const res = await client.shelfIn({ labelId, shelfCode });
      log(`ShelfIn ${labelId} → ${shelfCode}: ${res.Result}${res.Result === "NG" ? ` (${res.Message})` : ""}`, res.Result === "OK" ? "ok" : "ng");
      refresh();
    } catch (err) {
      log(`ShelfIn → NG: ${err instanceof Error ? err.message : String(err)}`, "ng");
    }
  };

  // ── Take out (ShelfOut) ──────────────────────────────────────
  const takeOut = async (labelIds: string[]) => {
    try {
      const res = await client.shelfOut({ labelIdList: labelIds, color: 3 });
      log(`ShelfOut [${labelIds.join(",")}] → ${res.Result}${res.Result === "NG" ? ` (${res.Message})` : ""}`, res.Result === "OK" ? "ok" : "ng");
      refresh();
    } catch (err) {
      log(`ShelfOut → NG: ${err instanceof Error ? err.message : String(err)}`, "ng");
    }
  };

  // ── Remove (InventoryRemoveLable) ────────────────────────────
  const removeLable = async (labelId: string) => {
    try {
      const res = await client.inventoryRemoveLable({ labelId });
      log(`RemoveLable ${labelId} → ${res.Result}${res.Result === "NG" ? ` (${res.Message})` : ""}`, res.Result === "OK" ? "ok" : "ng");
      refresh();
    } catch (err) {
      log(`RemoveLable → NG: ${err instanceof Error ? err.message : String(err)}`, "ng");
    }
  };

  // ── Shelf management ─────────────────────────────────────────
  const addShelf = () => {
    const code = newShelfCode.trim().toUpperCase();
    if (!code) { log("请输入货架号", "ng"); return; }
    if (mock.state.shelves.has(code)) { log(`货架 ${code} 已存在`, "ng"); return; }
    mock.state.shelves.set(code, {
      code,
      slots: Array.from({ length: COLS * ROWS }, () => ({ labelId: null })),
      lightOn: false,
      lightColor: 0,
    });
    log(`新增货架 ${code}（${COLS * ROWS} 个库位）`, "ok");
    setNewShelfCode("");
    refresh();
  };

  const addSlot = (shelfCode: string) => {
    const shelf = mock.state.shelves.get(shelfCode);
    if (!shelf) return;
    shelf.slots.push({ labelId: null });
    log(`为 ${shelfCode} 增加 1 个库位（现共 ${shelf.slots.length}）`, "ok");
    refresh();
  };

  const removeShelf = (shelfCode: string) => {
    mock.state.shelves.delete(shelfCode);
    log(`删除货架 ${shelfCode}`, "info");
    if (selection?.shelfCode === shelfCode) setSelection(null);
    refresh();
  };

  const resetAll = () => {
    mock.reset();
    setSelection(null);
    setActionLog([]);
    log("已重置所有货架状态", "info");
    refresh();
  };

  // ── Quick put-in form ────────────────────────────────────────
  const quickPutIn = () => {
    const sel = selection;
    if (!sel) { log("请先在左侧货架图上点击一个库位", "ng"); return; }
    if (!newLabelId.trim()) { log("请输入料盘唯一码", "ng"); return; }
    putIn(sel.shelfCode, newLabelId.trim());
    setNewLabelId("");
  };

  const quickTakeOut = () => {
    const list = outLabelList.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) { log("请输入唯一码列表（逗号分隔）", "ng"); return; }
    takeOut(list);
    setOutLabelList("");
  };

  // ── Helpers for slot rendering ───────────────────────────────
  const getSlotState = (shelf: ShelfRecord, slot: ShelfSlot, idx: number) => {
    const isSelected = selection?.shelfCode === shelf.code && selection.slotIndex === idx;
    const filled = slot.labelId !== null;
    const lit = shelf.lightOn && shelf.lightColor !== 0 && shelf.lightColor !== undefined;
    const color = LIGHT_COLORS[shelf.lightColor ?? 0] ?? LIGHT_COLORS[0];
    return { isSelected, filled, lit, color };
  };

  return (
    <div className="screen-stack">
      {/* Header + Stats */}
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("shelfSim.title", locale)}</h2>
            <p>{t("shelfSim.subtitle", locale)}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="action-button" onClick={resetAll}>
              <RotateCcw size={14} />
              {t("shelfSim.reset", locale)}
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 8 }}>
          <StatBox label={t("shelfSim.totalShelves", locale)} value={String(shelves.length)} color="#3b82f6" />
          <StatBox label={t("shelfSim.totalSlots", locale)} value={String(totalSlots)} color="#6b7280" />
          <StatBox label={t("shelfSim.occupiedSlots", locale)} value={`${occupied} / ${totalSlots}`} color="#10b981" />
          <StatBox label={t("shelfSim.removedLabels", locale)} value={String(mock.state.removedLabels.length)} color="#f59e0b" />
        </div>

        {/* Legend */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
          <span style={{ fontWeight: 600 }}>{t("shelfSim.legend", locale)}:</span>
          <LegendSwatch fill="#d1d5db" border="#9ca3af" label={t("shelfSim.legendEmpty", locale)} />
          <LegendSwatch fill="#d1d5db" border="#9ca3af" glow="#10b981" label={t("shelfSim.legendEmptyLit", locale)} />
          <LegendSwatch fill="#3b82f6" border="#1e40af" label={t("shelfSim.legendFilled", locale)} />
          <LegendSwatch fill="#3b82f6" border="#1e40af" glow="#3b82f6" label={t("shelfSim.legendFilledLit", locale)} />
          <LegendSwatch fill="#d1d5db" border="#fbbf24" borderWidth={2} label={t("shelfSim.legendSelected", locale)} />
        </div>

        {/* Add shelf */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <input
            value={newShelfCode}
            onChange={(e) => setNewShelfCode(e.target.value)}
            placeholder="L002A"
            style={{ height: 34, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 13, fontFamily: "monospace" }}
          />
          <button type="button" className="action-button" onClick={addShelf}>
            <Plus size={14} />
            {t("shelfSim.addShelf", locale)}
          </button>
        </div>
      </section>

      {/* Main grid: SVG racks on left, side panel on right */}
      <div className="content-grid two">
        {/* SVG racks */}
        <section className="surface-panel" style={{ overflow: "auto" }}>
          <div className="section-header">
            <h3 style={{ margin: 0, fontSize: 15 }}>货架布局</h3>
          </div>
          {shelves.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
              暂无货架 — 点击上方「新增货架」添加
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: 16, justifyContent: "flex-start" }}>
              {shelves.map((shelf) => (
                <ShelfSvg
                  key={shelf.code}
                  shelf={shelf}
                  getSlotState={getSlotState}
                  onSelectSlot={(idx) => setSelection({ shelfCode: shelf.code, slotIndex: idx })}
                  onAddSlot={() => addSlot(shelf.code)}
                  onRemoveShelf={() => removeShelf(shelf.code)}
                  onLightOn={() => setLight(shelf.code, 1)}
                  onLightOff={() => setLight(shelf.code, 0)}
                  onSetColor={(c) => setLightColor(shelf.code, c)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Side panel: selection + actions */}
        <section className="surface-panel">
          <div className="section-header">
            <h3 style={{ margin: 0, fontSize: 15 }}>操作面板</h3>
          </div>

          {/* Selected slot details */}
          <div style={{ padding: 12, background: "var(--bg)", borderRadius: 6, border: "1px solid var(--border)" }}>
            {selection ? (() => {
              const shelf = mock.state.shelves.get(selection.shelfCode);
              const slot = shelf?.slots[selection.slotIndex];
              if (!shelf || !slot) return <div style={{ color: "var(--muted)", fontSize: 13 }}>库位不存在</div>;
              return (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <ChevronRight size={14} />
                    <strong style={{ fontSize: 13 }}>{t("shelfSim.selectedSlot", locale)}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                    <div>货架: <code style={{ color: "var(--text)" }}>{shelf.code}</code></div>
                    <div>库位: <code style={{ color: "var(--text)" }}>{slot.locationCode ?? `${shelf.code}-${String(selection.slotIndex + 1).padStart(2, "0")}`}</code></div>
                    <div>状态: {slot.labelId ? (
                      <span style={{ color: "#3b82f6" }}>{t("shelfSim.slotHasLabel", locale)} <code>{slot.labelId}</code></span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>{t("shelfSim.slotEmpty", locale)}</span>
                    )}</div>
                  </div>
                </>
              );
            })() : (
              <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 12 }}>
                {t("shelfSim.empty", locale)}
              </div>
            )}
          </div>

          {/* Put in */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>入库到选中库位</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={newLabelId}
                onChange={(e) => setNewLabelId(e.target.value)}
                placeholder="TSN0001"
                style={{ flex: 1, height: 34, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 13, fontFamily: "monospace" }}
                onKeyDown={(e) => { if (e.key === "Enter") quickPutIn(); }}
              />
              <button type="button" className="action-button" onClick={quickPutIn}>
                <PackagePlus size={14} />
                {t("shelfSim.putIn", locale)}
              </button>
            </div>
          </div>

          {/* Take out */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>出库（按唯一码列表）</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={outLabelList}
                onChange={(e) => setOutLabelList(e.target.value)}
                placeholder="TSN0001,TSN0002"
                style={{ flex: 1, height: 34, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 13, fontFamily: "monospace" }}
                onKeyDown={(e) => { if (e.key === "Enter") quickTakeOut(); }}
              />
              <button type="button" className="action-button" onClick={quickTakeOut}>
                <PackageMinus size={14} />
                {t("shelfSim.takeOut", locale)}
              </button>
            </div>
          </div>

          {/* Remove single label */}
          {selection && (() => {
            const shelf = mock.state.shelves.get(selection.shelfCode);
            const slot = shelf?.slots[selection.slotIndex];
            if (!slot?.labelId) return null;
            return (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>移除选中库位的标签</div>
                <button type="button" className="action-button" onClick={() => removeLable(slot.labelId!)}>
                  <Tag size={14} />
                  {t("shelfSim.remove", locale)} <code style={{ marginLeft: 4 }}>{slot.labelId}</code>
                </button>
              </div>
            );
          })()}

          {/* Action log */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>操作日志</div>
            <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)" }}>
              {actionLog.length === 0 ? (
                <div style={{ padding: 8, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>暂无操作</div>
              ) : actionLog.map((entry, i) => (
                <div key={i} style={{ padding: "4px 8px", fontSize: 11, borderBottom: "1px solid var(--border)", color: entry.tone === "ok" ? "#10b981" : entry.tone === "ng" ? "#ef4444" : "var(--muted)" }}>
                  <span style={{ color: "var(--muted)", marginRight: 6 }}>{entry.time}</span>
                  {entry.msg}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ── Shelf SVG component ────────────────────────────────────────
function ShelfSvg({
  shelf,
  getSlotState,
  onSelectSlot,
  onAddSlot,
  onRemoveShelf,
  onLightOn,
  onLightOff,
  onSetColor,
}: {
  shelf: ShelfRecord;
  getSlotState: (shelf: ShelfRecord, slot: ShelfSlot, idx: number) => { isSelected: boolean; filled: boolean; lit: boolean; color: { fill: string; glow: string; label: string } };
  onSelectSlot: (idx: number) => void;
  onAddSlot: () => void;
  onRemoveShelf: () => void;
  onLightOn: () => void;
  onLightOff: () => void;
  onSetColor: (c: ShelfOutColor) => void;
}) {
  const totalW = SHELF_PAD * 2 + COLS * SLOT_W + (COLS - 1) * SLOT_GAP;
  const totalH = SHELF_PAD * 2 + SHELF_HEADER + ROWS * SLOT_H + (ROWS - 1) * SLOT_GAP;
  const color = LIGHT_COLORS[shelf.lightColor ?? 0] ?? LIGHT_COLORS[0];
  const lit = shelf.lightOn && (shelf.lightColor ?? 0) !== 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <svg width={totalW} height={totalH} style={{ display: "block", filter: lit ? `drop-shadow(0 0 6px ${color.glow})` : "none" }}>
        {/* Shelf frame */}
        <rect x={0} y={0} width={totalW} height={totalH} rx={8} fill="#1f2937" />
        {/* Header bar */}
        <rect x={0} y={0} width={totalW} height={SHELF_HEADER} rx={8} fill="#111827" />
        <rect x={0} y={SHELF_HEADER - 8} width={totalW} height={8} fill="#111827" />
        {/* Shelf code label */}
        <text x={SHELF_PAD} y={SHELF_HEADER / 2 + 4} fill="#f9fafb" fontSize={13} fontWeight={700} fontFamily="monospace">
          {shelf.code}
        </text>
        {/* Light indicator */}
        <circle
          cx={totalW - SHELF_PAD - 8}
          cy={SHELF_HEADER / 2}
          r={6}
          fill={lit ? color.fill : "#374151"}
          stroke={lit ? color.fill : "#4b5563"}
          strokeWidth={1}
        />
        {lit && (
          <circle
            cx={totalW - SHELF_PAD - 8}
            cy={SHELF_HEADER / 2}
            r={10}
            fill="none"
            stroke={color.fill}
            strokeWidth={1}
            opacity={0.4}
          />
        )}
        {/* Slots */}
        {shelf.slots.map((slot, idx) => {
          const col = idx % COLS;
          const row = Math.floor(idx / COLS);
          const x = SHELF_PAD + col * (SLOT_W + SLOT_GAP);
          const y = SHELF_HEADER + SHELF_PAD + row * (SLOT_H + SLOT_GAP);
          const state = getSlotState(shelf, slot, idx);
          return (
            <g
              key={idx}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectSlot(idx)}
            >
              {/* Glow circle when lit */}
              {state.lit && (
                <rect
                  x={x - 2} y={y - 2}
                  width={SLOT_W + 4} height={SLOT_H + 4}
                  rx={4}
                  fill="none"
                  stroke={state.color.fill}
                  strokeWidth={1.5}
                  opacity={0.6}
                />
              )}
              {/* Slot body */}
              <rect
                x={x} y={y}
                width={SLOT_W} height={SLOT_H}
                rx={3}
                fill={state.filled ? "#1e3a8a" : "#374151"}
                stroke={state.isSelected ? "#fbbf24" : state.filled ? "#3b82f6" : "#4b5563"}
                strokeWidth={state.isSelected ? 3 : 1}
              />
              {/* Light glow overlay (if lit) */}
              {state.lit && (
                <rect
                  x={x + 2} y={y + 2}
                  width={SLOT_W - 4} height={SLOT_H - 4}
                  rx={2}
                  fill={state.color.fill}
                  opacity={state.filled ? 0.15 : 0.08}
                />
              )}
              {/* Label text */}
              {state.filled ? (
                <text
                  x={x + SLOT_W / 2}
                  y={y + SLOT_H / 2 + 2}
                  fill="#dbeafe"
                  fontSize={10}
                  fontWeight={600}
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {slot.labelId!.length > 9 ? slot.labelId!.slice(0, 8) + "…" : slot.labelId}
                </text>
              ) : (
                <text
                  x={x + SLOT_W / 2}
                  y={y + SLOT_H / 2 + 3}
                  fill="#6b7280"
                  fontSize={10}
                  textAnchor="middle"
                >
                  {String(idx + 1).padStart(2, "0")}
                </text>
              )}
              {/* Location code (small) */}
              <text
                x={x + SLOT_W - 3}
                y={y + SLOT_H - 3}
                fill="#4b5563"
                fontSize={7}
                fontFamily="monospace"
                textAnchor="end"
              >
                {String(idx + 1).padStart(2, "0")}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Shelf controls */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="action-button"
          onClick={onLightOn}
          title="亮灯"
          style={{ padding: "4px 8px", fontSize: 11 }}
        >
          <Lightbulb size={12} />
        </button>
        <button
          type="button"
          className="action-button"
          onClick={onLightOff}
          title="灭灯"
          style={{ padding: "4px 8px", fontSize: 11 }}
        >
          <LightbulbOff size={12} />
        </button>
        <select
          onChange={(e) => onSetColor(Number(e.target.value) as ShelfOutColor)}
          defaultValue={shelf.lightColor ?? 0}
          style={{ height: 26, padding: "0 6px", fontSize: 11, borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
          title="亮灯颜色"
        >
          <option value={0} key="sim-color-0">0 关</option>
          <option value={3} key="sim-color-3">3 蓝</option>
          <option value={4} key="sim-color-4">4 黄</option>
          <option value={5} key="sim-color-5">5 洋红</option>
          <option value={6} key="sim-color-6">6 青</option>
          <option value={7} key="sim-color-7">7 白</option>
        </select>
        <button
          type="button"
          className="action-button"
          onClick={onAddSlot}
          title="加库位"
          style={{ padding: "4px 8px", fontSize: 11 }}
        >
          <Plus size={12} />
        </button>
        <button
          type="button"
          className="action-button"
          onClick={onRemoveShelf}
          title="删除货架"
          style={{ padding: "4px 8px", fontSize: 11, color: "var(--danger)" }}
        >
          <Trash2 size={12} />
        </button>
        <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 4 }}>
          {shelf.slots.filter((s) => s.labelId).length}/{shelf.slots.length}
        </span>
      </div>
    </div>
  );
}

// ── Stat box ───────────────────────────────────────────────────
function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ padding: "10px 14px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
      <strong style={{ fontSize: 20, color, fontVariantNumeric: "tabular-nums" }}>{value}</strong>
    </div>
  );
}

// ── Legend swatch ─────────────────────────────────────────────
function LegendSwatch({ fill, border, glow, borderWidth = 1, label }: { fill: string; border: string; glow?: string; borderWidth?: number; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          width: 16, height: 12, borderRadius: 2,
          background: fill, border: `${borderWidth}px solid ${border}`,
          boxShadow: glow ? `0 0 4px ${glow}` : "none",
        }}
      />
      <span>{label}</span>
    </span>
  );
}
