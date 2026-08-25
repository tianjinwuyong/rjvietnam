
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