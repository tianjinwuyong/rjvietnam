// Metres normalized from 新工厂布局图 WMS.dwg model space.
export type PlantArea = {
  code: string;
  name: string;
  type: "production" | "warehouse" | "quality" | "support" | "logistics";
  center: [number, number];
  size: [number, number];
};

export type PlantAnchor = {
  code: string;
  name: string;
  position: [number, number];
  kind: "rack" | "door";
};

export const PLANT_BOUNDS = { width: 74.063, depth: 60.006 };

export const PLANT_AREAS: PlantArea[] = [
  { code: "L001", name: "L001 SMT", type: "production", center: [20.12, -8.34], size: [25, 6.5] },
  { code: "L002", name: "L002 自动装配线", type: "production", center: [-29.99, -2.73], size: [34, 5.4] },
  { code: "L003", name: "L003 包装线", type: "production", center: [8.78, 1.93], size: [22, 5.2] },
  { code: "L004", name: "L004 手动装配线", type: "production", center: [-30.29, 9.06], size: [35, 6.4] },
  { code: "RAW", name: "原材料仓库（厂房西北端外侧）", type: "warehouse", center: [-21.53, -40], size: [31, 20] },
  { code: "IQC", name: "IQC 检验区", type: "quality", center: [-4.86, -15.69], size: [10.5, 7] },
  { code: "RECEIVING", name: "来料待检区", type: "logistics", center: [-14.62, -15.66], size: [8.5, 7] },
  { code: "REPAIR", name: "维修室", type: "support", center: [-20.75, 20.55], size: [8, 6] },
  { code: "FG-TEMP", name: "成品暂存区", type: "warehouse", center: [15.61, 18.40], size: [12, 5] },
  { code: "TOOL", name: "工具存储区", type: "support", center: [-28.53, 20.55], size: [7, 6] },
];

export const PLANT_ANCHORS: PlantAnchor[] = [
  { code: "SMART-RACK", name: "SMT 智能料架", position: [28.86, -18.63], kind: "rack" },
  { code: "NG-RACK", name: "不良品暂放", position: [-20.99, 24.77], kind: "rack" },
  { code: "JIG-RACK", name: "治具架", position: [-17.88, 24.69], kind: "rack" },
  { code: "ROLLER-DOOR", name: "物流卷帘门", position: [30.91, 18.35], kind: "door" },
  { code: "SMT-IO", name: "SMT 原料出入口", position: [12.69, -11.90], kind: "door" },
];
