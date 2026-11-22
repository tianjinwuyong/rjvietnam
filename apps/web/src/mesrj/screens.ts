// ============================================================================
// W18 屏注册表 —— 把「同一后端数据、只是缺个入口」的菜单叶子登记成通用列表屏。
// 每条 = 一个 mesrj 既有 GET 端点 + 列定义（三语走 labels.ts 的 w18.* 键）。
// 判别过的端点与形状见 .factory/W18-frontend-embedding-state.md（实测，非推测）。
// ============================================================================
import type { ScreenDef } from "./GenericScreen";

export const SCREENS: Record<string, ScreenDef> = {
  // 上岗登记：在岗人员表（prd_emp_login）
  "exec.emplogin": {
    code: "exec.emplogin", endpoint: "/emp/duty",
    columns: [
      { key: "station_name", label: "w18.c.station" },
      { key: "emp_no", label: "w18.c.empNo" },
      { key: "emp_name", label: "w18.c.empName" },
      { key: "work_date", label: "w18.c.workDate" },
      { key: "shift_code", label: "w18.c.shift" },
      { key: "in_at", label: "w18.c.inAt" },
      { key: "out_at", label: "w18.c.outAt" },
      { key: "status", label: "w18.c.status" },
    ],
  },
  // 设备接入状态：IoT 设备心跳（deviceHealth）
  "exec.health": {
    code: "exec.health", endpoint: "/exec/device/health",
    columns: [
      { key: "device_id", label: "w18.c.deviceId" },
      { key: "device_name", label: "w18.c.deviceName" },
      { key: "device_type", label: "w18.c.deviceType" },
      { key: "status", label: "w18.c.status" },
      { key: "last_heartbeat_at", label: "w18.c.heartbeat" },
    ],
  },
  // 操作日志（sys.log ≙ /audit）
  "sys.log": {
    code: "sys.log", endpoint: "/audit",
    columns: [
      { key: "created_at", label: "w18.c.time" },
      { key: "user_name", label: "w18.c.user" },
      { key: "module", label: "w18.c.module" },
      { key: "action", label: "w18.c.action" },
      { key: "target", label: "w18.c.target" },
      { key: "detail", label: "w18.c.detail" },
      { key: "ip", label: "w18.c.ip" },
    ],
  },
  // 锡膏/红胶回温（smt/paste/list）
  "exec.paste": {
    code: "exec.paste", endpoint: "/smt/paste/list",
    columns: [
      { key: "material_code", label: "w18.c.material" },
      { key: "paste_type", label: "w18.c.pasteType" },
      { key: "batch_no", label: "w18.c.batch" },
      { key: "qty", label: "w18.c.qty" },
      { key: "out_time", label: "w18.c.outTime" },
      { key: "plan_ready_time", label: "w18.c.readyTime" },
      { key: "status", label: "w18.c.status" },
    ],
    filters: [{ key: "status", label: "w18.c.status", fromColumn: "status", type: "select" }],
  },
  // PCB 拆封/烘烤（smt/pcb/list）
  "exec.pcb": {
    code: "exec.pcb", endpoint: "/smt/pcb/list",
    columns: [
      { key: "reel_sn", label: "w18.c.reelSn" },
      { key: "rj_code", label: "w18.c.rjCode" },
      { key: "lot_no", label: "w18.c.lot" },
      { key: "qty", label: "w18.c.qty" },
      { key: "unseal_time", label: "w18.c.unsealTime" },
      { key: "bake_count", label: "w18.c.bakeCount" },
      { key: "status", label: "w18.c.status" },
      { key: "operator", label: "w18.c.operator" },
    ],
  },
  // 钢网管控（smt/stencil/list）
  "exec.stencil": {
    code: "exec.stencil", endpoint: "/smt/stencil/list",
    columns: [
      { key: "sn", label: "w18.c.stencilSn" },
      { key: "stencil_no", label: "w18.c.stencilNo" },
      { key: "thickness", label: "w18.c.thickness" },
      { key: "model", label: "w18.c.model" },
      { key: "used_print_times", label: "w18.c.usedPrints" },
      { key: "max_print_times", label: "w18.c.maxPrints" },
      { key: "clean_count", label: "w18.c.cleanCount" },
      { key: "status", label: "w18.c.status" },
    ],
  },
  // 设备上报数据（cfg/machine）
  "exec.machine": {
    code: "exec.machine", endpoint: "/cfg/machine",
    columns: [], // 列由首行键自动出（后端形状多，避免猜错）
  },
  // AOI / SPI 数据（cfg/aoi）
  "exec.aoi": {
    code: "exec.aoi", endpoint: "/cfg/aoi",
    columns: [
      { key: "pcb_sn", label: "w18.c.pcbSn" },
      { key: "device_name", label: "w18.c.deviceName" },
      { key: "project_name", label: "w18.c.project" },
      { key: "board_side", label: "w18.c.boardSide" },
      { key: "test_time", label: "w18.c.testTime" },
      { key: "final_result", label: "w18.c.finalResult" },
      { key: "user_result", label: "w18.c.userResult" },
      { key: "repair_user", label: "w18.c.repairUser" },
    ],
  },
  // 机型维护（md/model/list）
  "md.model": {
    code: "md.model", endpoint: "/md/model/list",
    columns: [
      { key: "model", label: "w18.c.model" },
      { key: "cust_code", label: "w18.c.custCode" },
      { key: "cust_name", label: "w18.c.custName" },
      { key: "product_type", label: "w18.c.productType" },
      { key: "codes", label: "w18.c.codes" },
      { key: "enabled", label: "w18.c.status" },
    ],
  },
  // 上料消耗（smt/consumption，data.items）
  "exec.consume": {
    code: "exec.consume", endpoint: "/smt/consumption", pick: "items",
    columns: [],
  },
  // OQC 看板（oqc/board，data.stations）
  "qlt.oqcboard": {
    code: "qlt.oqcboard", endpoint: "/oqc/board", pick: "stations",
    columns: [],
  },

  // ── W19：Tier-1 补齐（后端已存在，此前只是没登记入口）──
  // 不良记录（源 exec.defect：listPage over /api/exec/defect + 去维修/报废 两个行内动作）
  "exec.defect": {
    code: "exec.defect", endpoint: "/exec/defect",
    filters: [
      { key: "f_station_code", label: "w18.c.station", fromColumn: "station_code", type: "select" },
      { key: "f_defect_code", label: "w19.c.defectCode", fromColumn: "defect_code", type: "select" },
      { key: "f_handle", label: "w19.c.handle", type: "select", options: [
        { v: "待处理", t: "w19.h.pending" }, { v: "维修", t: "w19.h.repaired" }, { v: "报废", t: "w19.h.scrapped" }] },
    ],
    columns: [
      { key: "defect_time", label: "w19.c.occurred" },
      { key: "sn", label: "SN" },
      { key: "mo_no", label: "w18.col.mo" },
      { key: "process_code", label: "w19.c.process" },
      { key: "station_code", label: "w18.c.station" },
      { key: "defect_code", label: "w19.c.defectCode" },
      { key: "root_cause", label: "w19.c.rootCause" },
      { key: "handle", label: "w19.c.handle" },
      { key: "repair_times", label: "w19.c.times" },
    ],
    // 源 rowActions：待处理/维修 才给「去维修」；非报废才给「报废」
    actions: [
      { name: "toDesk", label: "w19.act.toDesk", kind: "goto", target: "qlt.repairdesk",
        show: r => r.handle === "待处理" || r.handle === "维修" },
      { name: "scrap", label: "w19.act.scrap", endpoint: "/exec/scrap",
        confirm: r => `确定把 ${String(r.sn)} 判定为报废？\n报废后该 SN 禁止再过站。`,
        body: r => ({ sn: r.sn, reason: "不良记录页判废" }),
        show: r => r.handle !== "报废" },
    ],
  },
  // 上料基准（首扫建档）
  "smt.baseline": {
    code: "smt.baseline", endpoint: "/smt/baseline/list",
    columns: [
      { key: "line_code", label: "w18.c.line" }, { key: "model", label: "w18.c.model" },
      { key: "material", label: "w18.c.material" }, { key: "machine_no", label: "w18.c.machine" },
      { key: "slot_no", label: "w18.c.slot" }, { key: "hits", label: "w19.c.hits" },
      { key: "locked", label: "w19.c.locked" }, { key: "by_user", label: "w18.c.operator" },
      { key: "created_at", label: "w18.c.time" },
    ],
    actions: [
      { name: "lock", label: "w19.act.lock", endpoint: "/smt/baseline/lock", body: r => ({ id: r.id, locked: true }) },
      { name: "clear", label: "w19.act.clear", endpoint: "/smt/baseline/clear", body: r => ({ id: r.id }),
        confirm: "w19.act.clearConfirm" },
    ],
  },
  // OQC 检验记录（/oqc/list 已返回 {total,rows}）
  "qlt.oqclist": {
    code: "qlt.oqclist", endpoint: "/oqc/list",
    columns: [],
  },
};
