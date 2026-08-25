
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