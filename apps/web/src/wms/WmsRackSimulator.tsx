/**
 * WmsRackSimulator — 2D rack grid showing ALL 2800 slots in real-time.
 *
 * Data source: SSE /api/shelf/stream
 *   Server fetches all T_BASE_BIN rows (2800 bins) merged with Sys_CellsInfo
 *   occupied status every 5 s and broadcasts to all clients.
 *
 * Physical layout (per side):
 *   20 columns × 35 layers = 700 bins per side
 *   4 sides: L001A · L001B · L002A · L002B  →  2800 total
 */
import { useEffect, useRef, useState } from "react";
import { useShelfStream, type ShelfSnapshot } from "./useShelfStream";

const OCCUPIED_COLOR = "#1d4ed8";
const EMPTY_COLOR    = "#1e293b";
const SELECTED_BORDER = "#f59e0b";
const GRID_COLS = 20;
const GRID_LAYERS = 35;

interface SlotInfo {
  binCode: string;
  side: string;
  col: number;
  layer: number;
  occupied: boolean;
  serialNumber: string | null;
  materialCode: string | null;
}

function groupBySide(cells: ShelfSnapshot["cells"]) {
  const map = new Map<string, SlotInfo[]>();
  for (const cell of cells) {
    if (!map.has(cell.sideCode)) map.set(cell.sideCode, []);
    map.get(cell.sideCode)!.push({
      binCode: cell.binCode,
      side: cell.sideCode,
      col: cell.colu,
      layer: cell.layer,
      occupied: cell.occupied,
      serialNumber: cell.serialNumber,
      materialCode: cell.materialCode,
    });
  }
  return map;
}

export function WmsRackSimulator() {
  const { snapshot, connected, error: sseError } = useShelfStream(5000);
  const [selectedSlot, setSelectedSlot] = useState<SlotInfo | null>(null);
  const [filter, setFilter] = useState<"all" | "occupied" | "empty">("all");
  const selectedRef = useRef<HTMLDivElement>(null);

  const sidesData = snapshot ? groupBySide(snapshot.cells) : null;
  const totalBins = snapshot ? snapshot.cells.length : 0;
  const totalOccupied = snapshot ? snapshot.cells.filter(c => c.occupied).length : 0;

  useEffect(() => {
    if (selectedSlot && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedSlot?.binCode]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 0 24px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            background: connected ? "#22c55e" : "#ef4444",
          }} />
          <span style={{ fontSize: 12, color: connected ? "#22c55e" : "#ef4444" }}>
            {connected ? "实时" : "离线"}
          </span>
          {snapshot && (
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {new Date(snapshot.ts).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#94a3b8" }}>
          <span>总槽位 <strong style={{ color: "#e2e8f0" }}>{totalBins.toLocaleString()}</strong></span>
          <span>已占用 <strong style={{ color: OCCUPIED_COLOR }}>{totalOccupied}</strong></span>
          <span>空槽 <strong style={{ color: "#64748b" }}>{totalBins - totalOccupied}</strong></span>
        </div>

        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {(["all", "occupied", "empty"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: "4px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer",
              border: "1px solid",
              borderColor: filter === f ? "#3b82f6" : "#334155",
              background: filter === f ? "#1e3a5f" : "transparent",
              color: filter === f ? "#93c5fd" : "#94a3b8",
            }}>
              {f === "all" ? "全部" : f === "occupied" ? "已占用" : "空闲"}
            </button>
          ))}
        </div>
      </div>

      {/* Shelf summary */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(snapshot?.shelves ?? []).map(s => (
          <div key={s.code} style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12,
            background: "#0f172a", border: "1px solid #1e293b", color: "#94a3b8",
          }}>
            <strong style={{ color: "#e2e8f0" }}>{s.code}</strong>
            {"  "}{s.occupiedCells}/{s.totalCells} 占用
          </div>
        ))}
      </div>

      {/* Racks */}
      {sidesData ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {(["L001A", "L001B", "L002A", "L002B"] as const).map(sideCode => {
            const side = sidesData.get(sideCode);
            if (!side) return null;

            const sorted = [...side].sort((a, b) =>
              a.layer !== b.layer ? a.layer - b.layer : a.col - b.col
            );

            const colHeaders = Array.from({ length: GRID_COLS }, (_, i) => i + 1);

            return (
              <div key={sideCode} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", padding: "4px 0" }}>
                  {sideCode}
                  <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>
                    {side.filter(c => c.occupied).length}/{side.length} 占用
                  </span>
                </div>

                {/* Column numbers */}
                <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${GRID_COLS}, 1fr)`, gap: 2, fontSize: 9, color: "#475569" }}>
                  <div />
                  {colHeaders.map(n => (
                    <div key={n} style={{ textAlign: "center" }}>{String(n).padStart(2, "0")}</div>
                  ))}
                </div>

                {/* Grid rows (layer 1 at top) */}
                {Array.from({ length: GRID_LAYERS }, (_, layerIdx) => {
                  const layerNum = layerIdx + 1;
                  const rowCells = sorted.filter(c => c.layer === layerNum);
                  return (
                    <div key={layerNum} style={{
                      display: "grid",
                      gridTemplateColumns: `28px repeat(${GRID_COLS}, 1fr)`,
                      gap: 2,
                      alignItems: "center",
                    }}>
                      <div style={{ fontSize: 9, color: "#475569", textAlign: "right", paddingRight: 4 }}>
                        {String(layerNum).padStart(2, "0")}
                      </div>
                      {rowCells.map(cell => {
                        const isSelected = selectedSlot?.binCode === cell.binCode;
                        const hidden = filter !== "all" && (
                          (filter === "occupied" && !cell.occupied) ||
                          (filter === "empty" && cell.occupied)
                        );
                        return (
                          <div
                            key={cell.binCode}
                            onClick={() => setSelectedSlot(prev =>
                              prev?.binCode === cell.binCode ? null : cell
                            )}
                            ref={isSelected ? selectedRef : undefined}
                            title={`${cell.binCode}${cell.occupied ? `\n${cell.materialCode ?? ""}\n${cell.serialNumber ?? ""}` : "\n空"}`}
                            style={{
                              height: 18,
                              borderRadius: 3,
                              cursor: "pointer",
                              border: isSelected ? `1.5px solid ${SELECTED_BORDER}` : "1px solid #0f172a",
                              background: cell.occupied ? OCCUPIED_COLOR : EMPTY_COLOR,
                              transition: "background 0.15s",
                              opacity: hidden ? 0.1 : 1,
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ color: "#64748b", fontSize: 13 }}>
          {sseError ? `连接错误: ${sseError}` : "等待实时数据..."}
        </div>
      )}

      {/* Selected slot detail */}
      {selectedSlot && (
        <div style={{
          marginTop: 8, padding: "12px 16px", borderRadius: 10,
          background: "#0f172a", border: `1px solid ${SELECTED_BORDER}`, fontSize: 13,
        }}>
          <div style={{ color: "#94a3b8", marginBottom: 6 }}>
            选中槽位 / Selected Slot
            <button onClick={() => setSelectedSlot(null)} style={{
              float: "right", background: "none", border: "none",
              color: "#64748b", cursor: "pointer", fontSize: 16,
            }}>×</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
            <div><span style={{ color: "#64748b" }}>编码</span> <strong style={{ color: "#f59e0b" }}>{selectedSlot.binCode}</strong></div>
            <div><span style={{ color: "#64748b" }}>列/层</span> <strong>{selectedSlot.col}/{selectedSlot.layer}</strong></div>
            <div>
              <span style={{ color: "#64748b" }}>状态</span>
              <strong style={{ color: selectedSlot.occupied ? "#22c55e" : "#64748b" }}>
                {selectedSlot.occupied ? "已占用" : "空闲"}
              </strong>
            </div>
            <div><span style={{ color: "#64748b" }}>物料</span> <strong>{selectedSlot.materialCode ?? "—"}</strong></div>
            <div style={{ gridColumn: "1/-1" }}>
              <span style={{ color: "#64748b" }}>序列号</span>
              <strong>{selectedSlot.serialNumber ?? "—"}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
