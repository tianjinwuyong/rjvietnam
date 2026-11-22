// ============================================================================
// 镭雕发码台账/配置（源 api/exec.py laser 段） —— 从 routes/mesrj.js 整段搬迁（refactor-plan-2026-11-21 阶段3轮1续）。
// 依赖经 registerLaserRoutes(router, deps) 注入，与 smta-routes/ultra 同一约定；
// 注册位置在 createMesrjRouter 内保持不变（JWT 之后，顺序即原块顺序）。
// ============================================================================
import * as laser from "./laser.js";

export function registerLaserRoutes(router, { query, ok, fail, getParam, setParam, audit, perm: requireMesrjPerm, anyPerm: requireAnyPerm }) {
  // ════════════════════════════════════════════════════════════════════════════
  // 镭雕发码（源 api/exec.py laser 段 + 设备对接工具/镭雕机/laser_sn_server.py）
  //   TCP 取号服务单独起（npm run laser-sn-server）；这里提供台账 / 配置 / 健康检查入口。
  // ════════════════════════════════════════════════════════════════════════════
  const L_R = (p, ...args) => router.get(`/exec/laser/${p}`, requireAnyPerm("prod.pass", "prod.trace"), ...args);
  const L_W = (p, ...args) => router.post(`/exec/laser/${p}`, requireMesrjPerm("prod.pass"), ...args);

  L_R("panel", async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请传 SN");
    const row = await laser.panel(sn);
    if (!row) return fail(res, `SN ${sn} 不在发码台账里`);
    return ok(res, row);
  });

  L_R("panels", async (req, res) => {
    return ok(res, await laser.panels({
      moNo: String(req.query.mo_no || "").trim(),
      page: Number(req.query.page || 1),
      size: Number(req.query.size || 50),
    }));
  });

  L_R("next-seq", async (_req, res) => {
    const [seqNext, seqStart, panelSize, curMo] = await Promise.all([
      getParam("laser.seq_next", ""), getParam("laser.seq_start", ""),
      getParam("laser.panel_size", "12"), getParam("laser.cur_mo", "")]);
    return ok(res, { seq_next: seqNext, seq_start: seqStart, panel_size: panelSize, cur_mo: curMo });
  });

  // 试取号：算一个号不写库（源 test-draw 现场探针）
  L_R("test-draw", async (_req, res) => {
    const out = await laser.takeSn("test-draw", { dry: true });
    return ok(res, { sn: out.sn, dry: true, // takeSn 返回的 sn 是字符串；原 `...out.sn` 把字符串按字符下标展开成垃圾键，删除
      note: "演练取号：未写库、未递增序列。真正取号请连 TCP 服务（npm run laser-sn-server）。" });
  });

  L_R("cur-mo", async (_req, res) => {
    const moNo = String(await getParam("laser.cur_mo", "")).trim();
    const mo = moNo ? (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0] : null;
    const issued = moNo ? Number((await query(
      "SELECT COUNT(*)::int AS n FROM prd_laser_sn WHERE mo_no=$1", [moNo])).rows[0]?.n || 0) : 0;
    return ok(res, { mo_no: moNo, mo, issued });
  });

  L_W("cur-mo", async (req, res) => {
    const moNo = String((req.body || {}).mo_no || "").trim();
    if (!moNo) return fail(res, "请传 mo_no");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    if (["已完工", "已关闭", "已取消"].includes(mo.status)) {
      return fail(res, `工单 ${moNo} 状态为「${mo.status}」，请选在制工单`);
    }
    // 换单时若序列游标为空，从库内最大序列接着发（换单不清游标，序列全局连续）
    const cur = String(await getParam("laser.seq_next", "")).trim();
    if (!cur) await laser.initSeq({ dry: false });
    await setParam("laser.cur_mo", moNo, "镭雕当前生产工单", "镭雕机");
    const fg = String(mo.fg_code || mo.product_code || "").trim();
    const layout = fg ? (await query(
      `SELECT model, total FROM cfg_panel_layout WHERE enabled=1 AND product_code=$1
        ORDER BY id DESC LIMIT 1`, [fg])).rows[0] : null;
    return ok(res, { mo_no: moNo, panel_size: Number(layout?.total || 0), product_model: layout?.model || "" },
      `当前工单已设为 ${moNo}`);
  });

  // 发码台账健康检查（源 laser_code_health）
  L_R("code-health", async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "请选择工单");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    const plan = Number(mo.plan_qty || 0);
    const isPool = Number(mo.is_pool || 0);
    const issued = Number((await query(
      `SELECT COUNT(*)::int AS n FROM prd_laser_sn WHERE mo_no=$1 AND status='issued'`, [moNo])).rows[0]?.n || 0);
    const filed = Number((await query(
      `SELECT COUNT(*)::int AS n FROM prd_laser_sn WHERE mo_no=$1 AND status='filed'`, [moNo])).rows[0]?.n || 0);
    const built = Number((await query(
      `SELECT COUNT(*)::int AS n FROM prd_sn WHERE mo_no=$1 AND status<>'作废'`, [moNo])).rows[0]?.n || 0);
    const gapFill = Math.max(built - issued - filed, 0);
    const gapProd = plan > 0 ? Math.max(plan - built, 0) : 0;
    const pending = gapFill > 0 ? (await query(
      `SELECT DISTINCT s.sn FROM prd_sn s WHERE s.mo_no=$1 AND s.status<>'作废'
        AND NOT EXISTS (SELECT 1 FROM prd_laser_sn l WHERE l.sn=s.sn) ORDER BY s.id LIMIT 300`,
      [moNo])).rows.map(r => r.sn) : [];
    return ok(res, { mo_no: moNo, status: mo.status, plan_qty: plan,
      is_pool: isPool, unlimited: plan <= 0, issued, filed, built,
      gap_fill: gapFill, gap_prod: gapProd, pending, pending_total: gapFill });
  });

  // 一键补登：把「已建档但没镭雕码」的 SN 登记进台账（status='filed'，不生成新码、不占序列）
  L_W("backfill", async (req, res) => {
    const moNo = String((req.body || {}).mo_no || "").trim();
    if (!moNo) return fail(res, "请选择工单");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    if (mo.status === "已取消") return fail(res, `工单 ${moNo} 已取消，不能补登`);
    const pc = String(mo.fg_code || mo.product_code || "").trim();
    const model = pc ? (await query(
      `SELECT model FROM cfg_panel_layout WHERE enabled=1 AND product_code=$1 ORDER BY id DESC LIMIT 1`,
      [pc])).rows[0]?.model || "" : "";
    const pending = (await query(
      `SELECT DISTINCT s.sn FROM prd_sn s WHERE s.mo_no=$1 AND s.status<>'作废'
        AND NOT EXISTS (SELECT 1 FROM prd_laser_sn l WHERE l.sn=s.sn)`, [moNo])).rows.map(r => r.sn);
    let n = 0, errs = 0;
    for (const sn of pending) {
      try {
        await query(
          `INSERT INTO prd_laser_sn (sn, seq_no, machine_code, client_ip, status,
             panel_no, panel_pos, mo_no, product_code, product_model, machine_no, panel_size)
           VALUES ($1,0,'BACKFILL','backfill','filed',0,0,$2,$3,$4,'补登',0)`,
          [sn, moNo, pc, model]);
        n += 1;
      } catch { errs += 1; }
    }
    await audit(req.mesrjUser?.login_name || "system", "镭雕", "补登发码",
      `${moNo} 补登 ${n} 个（跳过 ${errs}）`, req.ip);
    return ok(res, { mo_no: moNo, filled: n, skipped: errs });
  });

  // 机台映射（按 IP 认机台）
  L_R("machines", async (_req, res) => {
    const rows = (await query("SELECT * FROM cfg_laser_machine ORDER BY machine_no, id")).rows;
    return ok(res, rows);
  });
  L_W("machines", async (req, res) => {
    const d = req.body || {};
    const machineNo = String(d.machine_no || "").trim();
    const ip = String(d.ip || "").trim();
    if (!machineNo || !ip) return fail(res, "machine_no 与 ip 都要填");
    await query(
      `INSERT INTO cfg_laser_machine (machine_no, ip, line_code, enabled, remark)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (ip) WHERE enabled=1 DO UPDATE SET
         machine_no=EXCLUDED.machine_no, line_code=EXCLUDED.line_code,
         enabled=EXCLUDED.enabled, remark=EXCLUDED.remark`,
      [machineNo, ip, String(d.line_code || "").trim(),
        Number(d.enabled ?? 1) ? 1 : 0, String(d.remark || "").trim()]);
    return ok(res, null, "已保存");
  });
  router.delete("/exec/laser/machines/:id", requireMesrjPerm("prod.pass"), async (req, res) => {
    await query("DELETE FROM cfg_laser_machine WHERE id=$1", [Number(req.params.id || 0)]);
    return ok(res, null, "已删除");
  });
}
