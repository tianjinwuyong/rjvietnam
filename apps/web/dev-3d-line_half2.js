
      React.createElement("boxGeometry", { args: [zoneW, 0.08, zoneD] }),
      React.createElement("meshStandardMaterial", { color: "#1a2332", metalness: 0.1, roughness: 0.9 })
    ),
    React.createElement("mesh", { position: [0, 0.3, -zoneD / 2 - 0.05], receiveShadow: true },
      React.createElement("boxGeometry", { args: [zoneW, 0.6, 0.06] }),
      React.createElement("meshStandardMaterial", { color: "#f59e0b", metalness: 0.4, roughness: 0.5 })
    ),
    React.createElement("mesh", { position: [0, 0.3, zoneD / 2 + 0.05], receiveShadow: true },
      React.createElement("boxGeometry", { args: [zoneW, 0.6, 0.06] }),
      React.createElement("meshStandardMaterial", { color: "#f59e0b", metalness: 0.4, roughness: 0.5 })
    ),
    React.createElement("mesh", { position: [-zoneW / 2 - 0.05, 0.3, 0], receiveShadow: true },
      React.createElement("boxGeometry", { args: [0.06, 0.6, zoneD] }),
      React.createElement("meshStandardMaterial", { color: "#f59e0b", metalness: 0.4, roughness: 0.5 })
    ),
    React.createElement("mesh", { position: [zoneW / 2 + 0.05, 0.3, 0], receiveShadow: true },
      React.createElement("boxGeometry", { args: [0.06, 0.6, zoneD] }),
      React.createElement("meshStandardMaterial", { color: "#f59e0b", metalness: 0.4, roughness: 0.5 })
    ),
    React.createElement(Text, { position: [0, 1.5, -zoneD / 2 - 0.6], fontSize: 0.55, color: "#f59e0b", anchorX: "center", anchorY: "middle" }, label),
    ...racks.map((rack, ri) => React.createElement(Rack3D, { key: ri, cx: rack.cx, cz: rack.cz || 0, label: rack.label, cells: rack.cells, perRow: rack.perRow, onCellHover: onCellHover, onCellUnhover: onCellUnhover }))
  );
}

function Scene({ manuStations, smtStations, whCells, onStationClick, onNgBlockClick, flashes, wsAlive, ngRecords, onCellHover, onCellUnhover }) {
  const smt1fCells = whCells.filter(c => c.zone === "SMT-1F");
  const smt2fCells = whCells.filter(c => c.zone === "SMT-2F");
  const rawCells = whCells.filter(c => c.zone === "RAW");
  const L001A = smt1fCells.slice(0, 20);
  const L001B = smt1fCells.slice(20, 32);
  const L002A = smt2fCells;
  const RAW_A = rawCells.slice(0, 10);
  const RAW_B = rawCells.slice(10, 20);
  const smt1fRacks = [{ cx: -12, cz: -3, label: "L001A", cells: L001A, perRow: 5 }, { cx: 2, cz: -3, label: "L001B", cells: L001B, perRow: 4 }, { cx: 14, cz: -3, label: "L002A", cells: L002A, perRow: 4 }];
  const rawRacks = [{ cx: -12, cz: -3, label: "RAW-A", cells: RAW_A, perRow: 5 }, { cx: 2, cz: -3, label: "RAW-B", cells: RAW_B, perRow: 5 }];
  const iqcHoldRacks = [{ cx: -6, cz: -2, label: "IQC", cells: whCells.filter(c => c.zone === "IQC"), perRow: 2 }, { cx: 6, cz: -2, label: "HOLD", cells: whCells.filter(c => c.zone === "HOLD"), perRow: 2 }];
  return React.createElement(React.Fragment, null,
    React.createElement("ambientLight", { intensity: 0.5 }),
    React.createElement("directionalLight", { position: [15, 20, -6], intensity: 1.2, castShadow: true }),
    React.createElement("directionalLight", { position: [45, 20, 10], intensity: 0.8, castShadow: true }),
    React.createElement("directionalLight", { position: [30, 15, -50], intensity: 0.6, castShadow: true }),
    React.createElement(LineGroup, { stations: manuStations, zPos: 0, isSmt: false, onStationClick, flashes, wsAlive, ngRecords, onNgBlockClick }),
    React.createElement(LineGroup, { stations: smtStations, zPos: -12, isSmt: true, onStationClick, flashes, wsAlive, ngRecords, onNgBlockClick }),
    React.createElement(WarehouseZone3D, { cx: 5, cz: -30, label: "SMT原料仓 SMT-1F", racks: smt1fRacks, onCellHover: onCellHover, onCellUnhover: onCellUnhover }),
    React.createElement(WarehouseZone3D, { cx: 5, cz: -44, label: "原材料仓 RAW", racks: rawRacks, onCellHover: onCellHover, onCellUnhover: onCellUnhover }),
    React.createElement(WarehouseZone3D, { cx: 65, cz: -36, label: "IQC / HOLD", racks: iqcHoldRacks, onCellHover: onCellHover, onCellUnhover: onCellUnhover }),
    React.createElement("mesh", { position: [40, -0.06, -38], receiveShadow: true },
      React.createElement("boxGeometry", { args: [130, 0.08, 45] }),
      React.createElement("meshStandardMaterial", { color: "#0f172a" })
    ),
    React.createElement("gridHelper", { args: [130, 26, "#2a3a4a", "#1e293b"], position: [40, 0.01, -38] })
  );
}

function App() {
  const [flashes, setFlashes] = useState({});
  const [ngRecords, setNgRecords] = useState({ 4: [{ sn: "NBT-26V5060-EPS18R1G-36", defectCode: "BRIDGE", time: Date.now() - 300000 }, { sn: "NBT-26V5061-EPS18R1G-37", defectCode: "OPEN", time: Date.now() - 600000 }, { sn: "NBT-26V5062-EPS18R1G-38", defectCode: "SHORT", time: Date.now() - 900000 }], 101: [{ sn: "SMT-ABC001-2026", defectCode: "MISSING", time: Date.now() - 120000 }] });
  const [wsAlive, setWsAlive] = useState({});
  const [cameraView, setCameraView] = useState({ id: "overview", label: "总览", position: [27, 12, 65], target: [27, 1, -6] });
  const [hoveredCell, setHoveredCell] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 100, y: 100 });
  const lastMsgAtRef = useRef({});
  const ALL_STATIONS = [...SMT_STATIONS, ...MANU_STATIONS];
  const whStats = useMemo(() => ({ total: WH_CELLS.length, occupied: WH_CELLS.filter(c => c.status === "occupied").length, empty: WH_CELLS.filter(c => c.status === "empty").length, iqc: WH_CELLS.filter(c => c.status === "iqc").length, hold: WH_CELLS.filter(c => c.status === "hold").length }), []);
  const zoneStats = useMemo(() => { const byZone = (z) => WH_CELLS.filter(c => c.zone === z); const occOf = (cells) => cells.filter(c => c.status === "occupied").length; const totOf = (cells) => cells.length; return { "SMT-1F": { occ: occOf(byZone("SMT-1F")), tot: totOf(byZone("SMT-1F")) }, "SMT-2F": { occ: occOf(byZone("SMT-2F")), tot: totOf(byZone("SMT-2F")) }, "RAW": { occ: occOf(byZone("RAW")), tot: totOf(byZone("RAW")) }, "IQC": { occ: occOf(byZone("IQC")), tot: totOf(byZone("IQC")) }, "HOLD": { occ: occOf(byZone("HOLD")), tot: totOf(byZone("HOLD")) } }; }, []);
  useEffect(() => { const iv = setInterval(() => { const now = Date.now(); setWsAlive((prev) => { const next = { ...prev }; for (const s of ALL_STATIONS) next[s.id] = lastMsgAtRef.current[s.id] !== undefined && (now - lastMsgAtRef.current[s.id]) < 10000; return next; }); }, 3000); return () => clearInterval(iv); }, []);
  useEffect(() => { const iv = setInterval(() => { const now = Date.now(); const ms = MANU_STATIONS[3]; const mSn = "NBT-" + Date.now().toString().slice(-10); setNgRecords((prev) => ({ ...prev, [ms.id]: [...(prev[ms.id] || []).slice(-19), { sn: mSn, defectCode: "OPEN", time: now }] })); setFlashes((prev) => ({ ...prev, [ms.id]: { sn: "NG:" + mSn, scannedAt: now } })); lastMsgAtRef.current[ms.id] = now; const ss = SMT_STATIONS[3]; const sSn = "SMT-" + Date.now().toString().slice(-8); setNgRecords((prev) => ({ ...prev, [ss.id]: [...(prev[ss.id] || []).slice(-19), { sn: sSn, defectCode: "VOID", time: now }] })); setFlashes((prev) => ({ ...prev, [ss.id]: { sn: "NG:" + sSn, scannedAt: now } })); lastMsgAtRef.current[ss.id] = now; }, 8000); return () => clearInterval(iv); }, []);
  const handleNgBlockClick = useCallback((item) => { alert("NG Block!
SN: " + item.sn + "
Defect: " + (item.defectCode || "N/A")); }, []);
  const handleStationClick = useCallback((station) => { console.log("Station:", station.nameZh, "| ID:", station.id); }, []);
  const handleCellHover = useCallback((cell) => setHoveredCell(cell), []);
  const handleCellUnhover = useCallback(() => setHoveredCell(null), []);
  useEffect(() => { const onMove = (e) => setTooltipPos({ x: e.clientX + 12, y: e.clientY + 12 }); window.addEventListener("mousemove", onMove); return () => window.removeEventListener("mousemove", onMove); }, []);
  const CAM_VIEWS = [{ id: "overview", label: "总览", position: [27, 12, 65], target: [27, 1, -6] }, { id: "topdown", label: "俯视", position: [27, 70, -20], target: [27, 0, -20] }, { id: "side", label: "侧视", position: [27, 5, 30], target: [27, 1, -6] }, { id: "smt", label: "SMT线", position: [10, 10, 20], target: [10, 1, -12] }, { id: "manual", label: "手动线", position: [30, 10, 30], target: [30, 1, 0] }, { id: "warehouse", label: "仓库", position: [40, 25, -15], target: [40, 0, -40] }];
  const totalPass = 127; const totalFail = Object.values(ngRecords).flat().length;
  const manuRunning = MANU_STATIONS.filter((s) => wsAlive[s.id]).length;
  const smtRunning = SMT_STATIONS.filter((s) => wsAlive[s.id]).length;
  const whRow = (zoneKey, label) => React.createElement("div", { className: "wh-row" },
    React.createElement("span", { className: "wh-label" }, label),
    React.createElement("div", { className: "wh-bar" },
      React.createElement("div", { style: { height: "100%", width: String((zoneStats[zoneKey].occ / zoneStats[zoneKey].tot) * 100) + "%", background: zoneStats[zoneKey].occ > 0 ? "#22c55e" : "#64748b", borderRadius: 2 } })
    ),
    React.createElement("span", { style: { color: zoneStats[zoneKey].occ > 0 ? "#22c55e" : "#64748b", fontSize: 10 } }, String(zoneStats[zoneKey].occ) + "/" + String(zoneStats[zoneKey].tot))
  );
  return React.createElement("div", { style: { width: "100vw", height: "100vh", background: "#0f172a" } },
    React.createElement(Canvas, { shadows: true, camera: { position: cameraView.position, fov: 55 }, gl: { antialias: true }, style: { width: "100%", height: "100%" } },
      React.createElement(OrbitControls, { enableDamping: true, dampingFactor: 0.05, target: cameraView.target }),
      React.createElement(Scene, { manuStations: MANU_STATIONS, smtStations: SMT_STATIONS, whCells: WH_CELLS, onStationClick: handleStationClick, onNgBlockClick: handleNgBlockClick, flashes, wsAlive, ngRecords, onCellHover: handleCellHover, onCellUnhover: handleCellUnhover })
    ),
    React.createElement("div", { className: "panel" },
      React.createElement("h3", null, "🏭 三维监控中心"),
      React.createElement("div", { className: "stat" },
        React.createElement("span", null, "SMT:"), React.createElement("span", { className: "value" }, String(SMT_STATIONS.length) + " 工站"),
        React.createElement("span", null, "手动:"), React.createElement("span", { className: "value" }, String(MANU_STATIONS.length) + " 工站"),
        React.createElement("span", null, "PASS:"), React.createElement("span", { className: "value", style: { color: "#4ade80" } }, totalPass),
        React.createElement("span", null, "FAIL:"), React.createElement("span", { className: "value", style: { color: "#ef4444" } }, totalFail)
      ),
      React.createElement("div", { style: { marginTop: 6 } },
        React.createElement("div", { className: "line-row" },
          React.createElement("span", { className: "line-label" }, "SMT产线"),
          React.createElement("div", { className: "line-bar" }, React.createElement("div", { className: "line-bar-fill", style: { width: String((smtRunning / SMT_STATIONS.length) * 100) + "%", background: "#f59e0b" } })),
          React.createElement("span", { style: { color: "#f59e0b", fontSize: 10 } }, String(smtRunning) + "/" + String(SMT_STATIONS.length))
        ),
        React.createElement("div", { className: "line-row" },
          React.createElement("span", { className: "line-label" }, "手动线"),
          React.createElement("div", { className: "line-bar" }, React.createElement("div", { className: "line-bar-fill", style: { width: String((manuRunning / MANU_STATIONS.length) * 100) + "%", background: "#22d3ee" } })),
          React.createElement("span", { style: { color: "#22d3ee", fontSize: 10 } }, String(manuRunning) + "/" + String(MANU_STATIONS.length))
        )
      ),
      React.createElement("div", { style: { marginTop: 8, paddingTop: 8, borderTop: "1px solid #334155", fontSize: 11, color: "#f59e0b", fontWeight: 700 } }, "货架状态"),
      whRow("SMT-1F", "SMT-1F"),
      whRow("SMT-2F", "SMT-2F"),
      whRow("RAW", "原材料仓"),
      React.createElement("div", { className: "wh-row" },
        React.createElement("span", { className: "wh-label" }, "IQC"),
        React.createElement("div", { className: "wh-bar" }, React.createElement("div", { style: { height: "100%", width: "100%", background: "#f59e0b", borderRadius: 2 } })),
        React.createElement("span", { style: { color: "#f59e0b", fontSize: 10 } }, String(zoneStats["IQC"].occ) + "/" + String(zoneStats["IQC"].tot))
      ),
      React.createElement("div", { className: "wh-row" },
        React.createElement("span", { className: "wh-label" }, "HOLD"),
        React.createElement("div", { className: "wh-bar" }, React.createElement("div", { style: { height: "100%", width: "100%", background: "#ef4444", borderRadius: 2 } })),
        React.createElement("span", { style: { color: "#ef4444", fontSize: 10 } }, String(zoneStats["HOLD"].occ) + "/" + String(zoneStats["HOLD"].tot))
      ),
      React.createElement("div", { style: { marginTop: 8, paddingTop: 8, borderTop: "1px solid #334155", fontSize: 11, color: "#64748b" } }, "更新: " + new Date().toLocaleTimeString()),
      React.createElement("button", { className: "sim-btn", onClick: () => { const s = MANU_STATIONS[3]; const sn = "SN-" + Date.now().toString().slice(-8); const now = Date.now(); setNgRecords((prev) => ({ ...prev, [s.id]: [...(prev[s.id] || []), { sn, defectCode: "OPEN", time: now }] })); setFlashes((prev) => ({ ...prev, [s.id]: { sn: "NG:" + sn, scannedAt: now } })); lastMsgAtRef.current[s.id] = now; } }, "📡 模拟NG流程")
    ),
    React.createElement("div", { className: "heartbeat-panel" },
      React.createElement("div", { className: "label" }, "心跳"),
      React.createElement("div", { className: "dots" },
        ...SMT_STATIONS.map((s) => React.createElement("div", { key: s.id, className: "dot smt " + (wsAlive[s.id] ? "" : "offline"), title: "SMT | " + s.nameZh }, s.code.replace("smt_", ""))),
        React.createElement("span", { className: "heartbeat-sep" }, "|"),
        ...MANU_STATIONS.map((s) => React.createElement("div", { key: s.id, className: "dot " + (wsAlive[s.id] ? "" : "offline"), title: "手动 | " + s.nameZh }, s.code.replace("manu_", "").replace("pda_", "PDA").replace("wave_", "W").replace("bind", "B"))),
        React.createElement("span", { className: "heartbeat-sep" }, "|"),
        React.createElement("div", { className: "dot wh", title: "仓库" }, "WH")
      )
    ),
    React.createElement("div", { className: "cam-panel" }, ...CAM_VIEWS.map((v) => React.createElement("button", { key: v.id, className: "cam-btn " + (cameraView.id === v.id ? "active" : ""), onClick: () => setCameraView(v) }, v.label))),
    React.createElement("div", { className: "legend" },
      React.createElement("div", { className: "legend-section" }, "工站 (手动线 z=0)"),
      React.createElement("div", { className: "legend-item" }, React.createElement("div", { className: "legend-color", style: { background: "#ef4444" } }), "NG 不良品"),
      React.createElement("div", { className: "legend-item" }, React.createElement("div", { className: "legend-color", style: { background: "#22d3ee" } }), "PASS 良品"),
      React.createElement("div", { className: "legend-item" }, React.createElement("div", { className: "legend-color", style: { background: "#a855f7" } }), "NG SQLite"),
      React.createElement("div", { className: "legend-item" }, React.createElement("div", { className: "legend-color", style: { background: "#6b7280" } }), "老化 NG ≥2h"),
      React.createElement("div", { className: "legend-sep" }),
      React.createElement("div", { className: "legend-section" }, "货架 (z=-30 后端)"),
      React.createElement("div", { className: "legend-item" }, React.createElement("div", { className: "legend-color", style: { background: "#22c55e" } }), "有料"),
      React.createElement("div", { className: "legend-item" }, React.createElement("div", { className: "legend-color", style: { background: "#334155" } }), "空位"),
      React.createElement("div", { className: "legend-item" }, React.createElement("div", { className: "legend-color", style: { background: "#f59e0b" } }), "IQC 待检"),
      React.createElement("div", { className: "legend-item" }, React.createElement("div", { className: "legend-color", style: { background: "#ef4444" } }), "HOLD")
    ),
    hoveredCell && React.createElement("div", { className: "wh-tooltip", style: { left: tooltipPos.x, top: tooltipPos.y } },
      React.createElement("div", { className: "wt-title" }, hoveredCell.code),
      React.createElement("div", { className: "wt-row" }, React.createElement("span", { className: "wt-key" }, "状态"), React.createElement("span", { className: "wt-val" }, hoveredCell.status === "occupied" ? "有料" : hoveredCell.status === "empty" ? "空" : hoveredCell.status === "iqc" ? "IQC待检" : hoveredCell.status === "hold" ? "冻结" : hoveredCell.status)),
      hoveredCell.lot && React.createElement("div", { className: "wt-row" }, React.createElement("span", { className: "wt-key" }, "批次"), React.createElement("span", { className: "wt-val" }, hoveredCell.lot))
    )
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
