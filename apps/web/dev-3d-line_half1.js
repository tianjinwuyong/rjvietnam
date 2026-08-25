
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";

const SMT_STATIONS = [
  { id: 101, nameZh: "镭雕机",   code: "smt_laser",   px: -5 },
  { id: 102, nameZh: "AI插件机", code: "smt_ai",       px:  0 },
  { id: 103, nameZh: "印刷机",   code: "smt_print",    px:  5 },
  { id: 104, nameZh: "SPI",     code: "smt_spi",      px: 10 },
  { id: 105, nameZh: "贴片机",   code: "smt_mounter",  px: 15 },
  { id: 106, nameZh: "SMT-AOI", code: "smt_aoi",      px: 20 },
  { id: 107, nameZh: "PDA上料",  code: "smt_pda",     px: 25 },
];

const MANU_STATIONS = [
  { id:   1, nameZh: "PDA扫码上料", code: "pda_load",    px:  0 },
  { id:   2, nameZh: "波峰焊",      code: "wave_solder", px:  5 },
  { id:   3, nameZh: "AOI",         code: "manu_aio",   px: 10 },
  { id:   4, nameZh: "ICT",         code: "manu_ict",   px: 15 },
  { id:   5, nameZh: "FCT",         code: "manu_fct",   px: 20 },
  { id:   6, nameZh: "分板机",       code: "manu_depanel",px: 25 },
  { id:   7, nameZh: "绑码",        code: "manu_bind",  px: 30 },
  { id:   8, nameZh: "组装ATE",     code: "manu_assem", px: 35 },
  { id:   9, nameZh: "超声波",       code: "manu_ultra", px: 40 },
  { id:  10, nameZh: "老化",         code: "manu_aging", px: 45 },
  { id:  11, nameZh: "高压测试",     code: "manu_hivolt",px: 50 },
  { id:  12, nameZh: "包装ATE",     code: "manu_pkg_ate",px: 55 },
  { id:  13, nameZh: "包装",         code: "manu_pkg",   px: 60 },
];

const WH_CELLS = [
  { code: "L001A-01", zone: "SMT-1F", status: "occupied", lot: "VN-R240616-01" },
  { code: "L001A-02", zone: "SMT-1F", status: "occupied", lot: "VN-R240620-02" },
  { code: "L001A-03", zone: "SMT-1F", status: "occupied", lot: "VN-CAP240617-01" },
  { code: "L001A-04", zone: "SMT-1F", status: "empty" },
  { code: "L001A-05", zone: "SMT-1F", status: "occupied", lot: "VN-CAP240618-01" },
  { code: "L001A-06", zone: "SMT-1F", status: "empty" },
  { code: "L001A-07", zone: "SMT-1F", status: "occupied", lot: "VN-DDR240620-01" },
  { code: "L001A-08", zone: "SMT-1F", status: "empty" },
  { code: "L001A-09", zone: "SMT-1F", status: "occupied", lot: "VN-FL240620-01" },
  { code: "L001A-10", zone: "SMT-1F", status: "empty" },
  { code: "L001A-11", zone: "SMT-1F", status: "occupied", lot: "VN-HDMI240621-01" },
  { code: "L001A-12", zone: "SMT-1F", status: "empty" },
  { code: "L001A-13", zone: "SMT-1F", status: "occupied", lot: "VN-USBC240621-01" },
  { code: "L001A-14", zone: "SMT-1F", status: "empty" },
  { code: "L001A-15", zone: "SMT-1F", status: "occupied", lot: "VN-IND240622-01" },
  { code: "L001A-16", zone: "SMT-1F", status: "empty" },
  { code: "L001A-17", zone: "SMT-1F", status: "occupied", lot: "VN-DIO240622-01" },
  { code: "L001A-18", zone: "SMT-1F", status: "empty" },
  { code: "L001A-19", zone: "SMT-1F", status: "occupied", lot: "VN-TR240623-01" },
  { code: "L001A-20", zone: "SMT-1F", status: "empty" },
  { code: "L001B-01", zone: "SMT-1F", status: "occupied", lot: "VN-PCB240617-04" },
  { code: "L001B-02", zone: "SMT-1F", status: "empty" },
  { code: "L001B-03", zone: "SMT-1F", status: "occupied", lot: "VN-PCB240616-03" },
  { code: "L001B-04", zone: "SMT-1F", status: "empty" },
  { code: "L001B-05", zone: "SMT-1F", status: "occupied", lot: "VN-R240616-01" },
  { code: "L001B-06", zone: "SMT-1F", status: "empty" },
  { code: "L001B-07", zone: "SMT-1F", status: "empty" },
  { code: "L001B-08", zone: "SMT-1F", status: "empty" },
  { code: "L001B-09", zone: "SMT-1F", status: "empty" },
  { code: "L001B-10", zone: "SMT-1F", status: "empty" },
  { code: "L001B-11", zone: "SMT-1F", status: "empty" },
  { code: "L001B-12", zone: "SMT-1F", status: "empty" },
  { code: "L002A-01", zone: "SMT-2F", status: "empty" },
  { code: "L002A-02", zone: "SMT-2F", status: "empty" },
  { code: "L002A-03", zone: "SMT-2F", status: "empty" },
  { code: "L002A-04", zone: "SMT-2F", status: "empty" },
  { code: "L002A-05", zone: "SMT-2F", status: "empty" },
  { code: "L002A-06", zone: "SMT-2F", status: "empty" },
  { code: "L002A-07", zone: "SMT-2F", status: "empty" },
  { code: "L002A-08", zone: "SMT-2F", status: "empty" },
  { code: "L002A-09", zone: "SMT-2F", status: "empty" },
  { code: "L002A-10", zone: "SMT-2F", status: "empty" },
  { code: "L002A-11", zone: "SMT-2F", status: "empty" },
  { code: "L002A-12", zone: "SMT-2F", status: "empty" },
  { code: "RAW-A01", zone: "RAW", status: "occupied", lot: "LOT-RAW-A01" },
  { code: "RAW-A02", zone: "RAW", status: "occupied", lot: "LOT-RAW-A02" },
  { code: "RAW-A03", zone: "RAW", status: "empty" },
  { code: "RAW-A04", zone: "RAW", status: "empty" },
  { code: "RAW-A05", zone: "RAW", status: "empty" },
  { code: "RAW-A06", zone: "RAW", status: "empty" },
  { code: "RAW-A07", zone: "RAW", status: "empty" },
  { code: "RAW-A08", zone: "RAW", status: "empty" },
  { code: "RAW-A09", zone: "RAW", status: "empty" },
  { code: "RAW-A10", zone: "RAW", status: "empty" },
  { code: "RAW-B01", zone: "RAW", status: "occupied", lot: "LOT-RAW-B01" },
  { code: "RAW-B02", zone: "RAW", status: "empty" },
  { code: "RAW-B03", zone: "RAW", status: "empty" },
  { code: "RAW-B04", zone: "RAW", status: "empty" },
  { code: "RAW-B05", zone: "RAW", status: "empty" },
  { code: "RAW-B06", zone: "RAW", status: "empty" },
  { code: "RAW-B07", zone: "RAW", status: "empty" },
  { code: "RAW-B08", zone: "RAW", status: "empty" },
  { code: "RAW-B09", zone: "RAW", status: "empty" },
  { code: "RAW-B10", zone: "RAW", status: "empty" },
  { code: "IQC-01", zone: "IQC", status: "iqc", lot: "VN-CAP240617-02" },
  { code: "IQC-02", zone: "IQC", status: "iqc", lot: "VN-IC240619-01" },
  { code: "HOLD-01", zone: "HOLD", status: "hold", lot: "VN-IC240619-02" },
  { code: "HOLD-02", zone: "HOLD", status: "hold", lot: "VN-HOLD-02" },
];

const CELL_STATUS_COLOR = { occupied: "#22c55e", empty: "#334155", iqc: "#f59e0b", hold: "#ef4444" };
const BUCKET_COLORS = { NG: "#ef4444", PASS: "#22d3ee", NG_SQLITE: "#a855f7", AGED_NG: "#6b7280" };

function NgBlock({ position, sn, onClick }) {
  const [hovered, setHovered] = useState(false);
  return React.createElement("group", { position },
    React.createElement("mesh", { castShadow: true, onClick: (e) => { e.stopPropagation(); onClick && onClick({ sn }); }, onPointerOver: () => setHovered(true), onPointerOut: () => setHovered(false) },
      React.createElement("boxGeometry", { args: [0.35, 0.18, 0.06] }),
      React.createElement("meshStandardMaterial", { color: hovered ? "#fbbf24" : "#1e293b", metalness: 0.2, roughness: 0.8, emissive: hovered ? "#f59e0b" : "#000000", emissiveIntensity: hovered ? 0.3 : 0 })
    ),
    React.createElement(Text, { position: [0, 0.02, 0.035], fontSize: 0.055, color: "#f1f5f9", anchorX: "center", anchorY: "middle" }, sn),
    React.createElement("mesh", { position: [0, -0.08, 0.035] },
      React.createElement("boxGeometry", { args: [0.2, 0.025, 0.001] }),
      React.createElement("meshBasicMaterial", { color: "#ef4444" })
    )
  );
}

function Bucket({ position, label, color, items, onNgBlockClick, needsAuth }) {
  const displayCount = items.length;
  const isNg = label === "NG";
  return React.createElement("group", { position, onClick: (e) => e.stopPropagation() },
    React.createElement("group", { scale: 0.4 },
      React.createElement("mesh", { position: [0, 0.3, 0], castShadow: true },
        React.createElement("cylinderGeometry", { args: [0.25, 0.2, 0.6, 16] }),
        React.createElement("meshStandardMaterial", { color: "#374151", metalness: 0.3, roughness: 0.7 })
      ),
      React.createElement("mesh", { position: [0, 0.62, 0] },
        React.createElement("torusGeometry", { args: [0.26, 0.03, 8, 16] }),
        React.createElement("meshStandardMaterial", { color: isNg ? "#dc2626" : "#0891b2", metalness: 0.4, roughness: 0.5 })
      )
    ),
    React.createElement(Text, { position: [0, 0.9, 0], fontSize: 0.22, color, anchorX: "center", anchorY: "middle" }, label),
    React.createElement("mesh", { position: [0.2, 0.9, 0] },
      React.createElement("sphereGeometry", { args: [0.12, 8, 8] }),
      React.createElement("meshBasicMaterial", { color })
    ),
    React.createElement(Text, { position: [0.2, 0.9, 0], fontSize: 0.14, color: "#fff", anchorX: "center", anchorY: "middle" }, displayCount),
    needsAuth && React.createElement(Text, { position: [0.3, 0.65, 0], fontSize: 0.14, color: "#fbbf24", anchorX: "center", anchorY: "middle" }, "🔒"),
    ...items.slice(0, 20).map((item, i) => {
      const col = i % 5; const row = Math.floor(i / 5);
      return React.createElement(NgBlock, { key: item.sn + "-" + i, position: [(col - 2) * 0.22, 0.1, 0.4 + row * 0.15], sn: item.sn, onClick: onNgBlockClick });
    })
  );
}

function StationBox({ station, onClick, flash, wsAlive, isSmt }) {
  const accentColor = isSmt ? "#f59e0b" : "#22d3ee";
  const bodyColor = isSmt ? "#292524" : "#1e293b";
  const isAlive = !!wsAlive;
  return React.createElement("group", { position: [station.px, 0, 0], onClick: (e) => { e.stopPropagation(); onClick && onClick(station); } },
    React.createElement("mesh", { position: [0, 0.02, 0], receiveShadow: true },
      React.createElement("boxGeometry", { args: [2, 0.04, 2] }),
      React.createElement("meshStandardMaterial", { color: bodyColor })
    ),
    React.createElement("mesh", { position: [0, 1, 0], castShadow: true },
      React.createElement("boxGeometry", { args: [1.4, 2, 1.4] }),
      React.createElement("meshStandardMaterial", { color: bodyColor, metalness: 0.2, roughness: 0.8 })
    ),
    React.createElement("mesh", { position: [0, 2.1, 0], castShadow: true },
      React.createElement("boxGeometry", { args: [1.6, 0.2, 1.6] }),
      React.createElement("meshStandardMaterial", { color: flash ? "#fbbf24" : accentColor, metalness: 0.3, roughness: 0.7 })
    ),
    React.createElement("mesh", { position: [0, 2.35, 0] },
      React.createElement("sphereGeometry", { args: [0.08, 8, 8] }),
      React.createElement("meshBasicMaterial", { color: isAlive ? accentColor : "#334155" })
    ),
    React.createElement(Text, { position: [0, 2.6, 0], fontSize: 0.28, color: "#f1f5f9", anchorX: "center", anchorY: "middle" }, station.nameZh),
    React.createElement("mesh", { position: [0, 0.04, 1.0], receiveShadow: true },
      React.createElement("boxGeometry", { args: [0.6, 0.02, 2] }),
      React.createElement("meshStandardMaterial", { color: "#475569", metalness: 0.5, roughness: 0.5 })
    )
  );
}

function Conveyor({ zPos, xStart, xEnd }) {
  const cx = (xStart + xEnd) / 2; const len = xEnd - xStart;
  return React.createElement("group", null,
    React.createElement("mesh", { position: [cx, 0.04, zPos], receiveShadow: true },
      React.createElement("boxGeometry", { args: [len, 0.08, 0.5] }),
      React.createElement("meshStandardMaterial", { color: "#334155", metalness: 0.4, roughness: 0.6 })
    ),
    React.createElement("mesh", { position: [cx, 0.12, zPos - 0.32], castShadow: true },
      React.createElement("boxGeometry", { args: [len, 0.08, 0.02] }),
      React.createElement("meshStandardMaterial", { color: "#475569", metalness: 0.5, roughness: 0.5 })
    ),
    React.createElement("mesh", { position: [cx, 0.12, zPos + 0.32], castShadow: true },
      React.createElement("boxGeometry", { args: [len, 0.08, 0.02] }),
      React.createElement("meshStandardMaterial", { color: "#475569", metalness: 0.5, roughness: 0.5 })
    )
  );
}

function LineGroup({ stations, zPos, isSmt, onStationClick, flashes, wsAlive, ngRecords, onNgBlockClick }) {
  const convZ = zPos + 1.25;
  const xS = stations[0].px; const xE = stations[stations.length - 1].px;
  const midX = (xS + xE) / 2; const floorW = (xE - xS) + 10;
  return React.createElement("group", null,
    React.createElement(Conveyor, { zPos: convZ, xStart: xS, xEnd: xE }),
    ...stations.map((s) =>
      React.createElement("group", { key: s.id, position: [s.px, 0, zPos] },
        React.createElement(StationBox, { station: s, onClick: onStationClick, flash: flashes[s.id], wsAlive: wsAlive[s.id], isSmt }),
        React.createElement(Bucket, { position: [-1.0, 0.5, 2.0], label: "NG", color: BUCKET_COLORS.NG, items: ngRecords[s.id] || [], onNgBlockClick }),
        React.createElement(Bucket, { position: [ 1.0, 0.5, 2.0], label: "PASS", color: BUCKET_COLORS.PASS, items: [] }),
        React.createElement(Bucket, { position: [ 0.0, 0.5, 2.0], label: "NG SQLite", color: BUCKET_COLORS.NG_SQLITE, items: [], onNgBlockClick }),
        React.createElement(Bucket, { position: [ 2.2, 0.5, 2.0], label: "Aged NG", color: BUCKET_COLORS.AGED_NG, items: [], needsAuth: true, onNgBlockClick }),
        React.createElement(Text, { position: [0, 2.75, 2.0], fontSize: 0.32, color: "#f1f5f9", anchorX: "center", anchorY: "middle" }, s.nameZh)
      )
    ),
    React.createElement("mesh", { position: [midX, -0.5, zPos], receiveShadow: true },
      React.createElement("boxGeometry", { args: [floorW, 0.1, 20] }),
      React.createElement("meshStandardMaterial", { color: "#1e293b" })
    ),
    React.createElement("mesh", { rotation: [-Math.PI / 2, 0, 0], position: [midX, 0.005, zPos], receiveShadow: true },
      React.createElement("planeGeometry", { args: [floorW, 20] }),
      React.createElement("meshStandardMaterial", { color: "#0f172a" })
    ),
    React.createElement("gridHelper", { args: [floorW, 14, "#3a4a5a", "#2a3a4a"], position: [midX, 0.01, zPos] })
  );
}

function ShelfCell3D({ position, cell, onHover, onUnhover }) {
  const [hovered, setHovered] = useState(false);
  const color = CELL_STATUS_COLOR[cell.status] || "#334155";
  return React.createElement("group", { position },
    React.createElement("mesh", {
      onClick: (e) => { e.stopPropagation(); },
      onPointerOver: (e) => { e.stopPropagation(); setHovered(true); onHover && onHover(cell); },
      onPointerOut: () => { setHovered(false); onUnhover && onUnhover(); }
    },
      React.createElement("boxGeometry", { args: [0.9, 0.6, 0.5] }),
      React.createElement("meshStandardMaterial", { color: hovered ? color : "#1e293b", metalness: 0.3, roughness: 0.7, emissive: hovered ? color : "#000000", emissiveIntensity: hovered ? 0.5 : 0 })
    ),
    React.createElement("mesh", { position: [0, 0.18, 0.26] },
      React.createElement("sphereGeometry", { args: [0.06, 6, 6] }),
      React.createElement("meshBasicMaterial", { color })
    ),
    React.createElement(Text, { position: [0, -0.05, 0.26], fontSize: 0.09, color: "#94a3b8", anchorX: "center", anchorY: "middle" },
      cell.code.replace("L001A-", "A").replace("L001B-", "B").replace("L002A-", "C").replace("RAW-", "R").replace("IQC-", "IQC").replace("HOLD-", "H"))
  );
}

function Rack3D({ cx, cz, label, cells, perRow, onCellHover, onCellUnhover }) {
  const cellW = 1.1; const cellH = 0.6; const cellD = 0.5; const rowGap = 1.2;
  const rows = Math.ceil(cells.length / perRow);
  const rackW = perRow * cellW;
  const frameColor = "#374151"; const frameT = 0.05;
  const rackH = rows * (cellH + rowGap);
  return React.createElement("group", { position: [cx, 0, cz] },
    React.createElement("mesh", { position: [0, rackH / 2, -cellD / 2 - 0.02], receiveShadow: true },
      React.createElement("boxGeometry", { args: [rackW + 0.2, rackH + 0.2, frameT] }),
      React.createElement("meshStandardMaterial", { color: frameColor, metalness: 0.2, roughness: 0.8 })
    ),
    React.createElement("mesh", { position: [-rackW / 2 - 0.05, rackH / 2, 0], castShadow: true },
      React.createElement("boxGeometry", { args: [frameT, rackH + 0.2, cellD + 0.1] }),
      React.createElement("meshStandardMaterial", { color: frameColor, metalness: 0.3, roughness: 0.7 })
    ),
    React.createElement("mesh", { position: [rackW / 2 + 0.05, rackH / 2, 0], castShadow: true },
      React.createElement("boxGeometry", { args: [frameT, rackH + 0.2, cellD + 0.1] }),
      React.createElement("meshStandardMaterial", { color: frameColor, metalness: 0.3, roughness: 0.7 })
    ),
    React.createElement("mesh", { position: [0, rackH + 0.05, 0], castShadow: true },
      React.createElement("boxGeometry", { args: [rackW + 0.2, frameT, cellD + 0.1] }),
      React.createElement("meshStandardMaterial", { color: frameColor, metalness: 0.3, roughness: 0.7 })
    ),
    ...cells.map((cell, i) => {
      const row = Math.floor(i / perRow); const col = i % perRow;
      const x = -rackW / 2 + cellW / 2 + col * cellW;
      const y = row * (cellH + rowGap) + cellH / 2;
      return React.createElement(ShelfCell3D, { key: cell.code, position: [x, y, 0], cell, onHover: onCellHover, onUnhover: onCellUnhover });
    }),
    React.createElement(Text, { position: [0, rackH + 0.5, -cellD / 2 - 0.1], fontSize: 0.2, color: "#f59e0b", anchorX: "center", anchorY: "middle" }, label)
  );
}

function WarehouseZone3D({ cx, cz, label, racks, onCellHover, onCellUnhover }) {
  const zoneW = 55; const zoneD = 18;
  return React.createElement("group", { position: [cx, 0, cz] },
    React.createElement("mesh", { position: [0, -0.02, 0], receiveShadow: true },