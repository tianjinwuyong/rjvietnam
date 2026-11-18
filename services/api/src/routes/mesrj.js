// ============================================================================
// MES-ruijing 移植后端（原生 Express + PostgreSQL）
// 源：D:\rj\repos\MES-ruijing\api\*.py（Flask + SQLite）逐语义移植
//   · _crud.py   → 本文件 CRUD 引擎（registerCrud）
//   · md.py      → /mesrj/md/*（主数据 + options/audit/clone/copy/rename）
//   · sys.py     → /mesrj/sys/*（me/menu/用户/角色/参数/接口配置/审计日志）
//   · basic.py   → /mesrj/cfg/basic/*（工序/班次/关键参数）+ /mesrj/md/model/*
//   · devsrc.py  → /mesrj/DeviceConfig/MachineSource（设备侧拉取，X-Api-Key）
// 认证：复用 SMT JWT（authenticateJWT 注入，单一登录策略）；
//       mesrj 自己的 sys_user/sys_role/sys_perm 仅作产线数据权限与菜单过滤。
// 信封：与源系统一致 {success, msg, data}（源 core/util.py ok/fail）。
// 挂载：server.js → api.use("/mesrj", createMesrjRouter({...}))
// ============================================================================
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { query } from "../db.js";
import { MENU } from "../mesrj/menu.js";
import { PARAM_DEFS } from "../mesrj/param-defs.js";

/** 源 util.ok(data, msg) */
function ok(res, data = null, msg = "") {
  res.json({ success: true, msg: msg || "", data: data ?? null });
}
/** 源 util.fail(msg, code) */
function fail(res, msg, code = 400) {
  res.status(code).json({ success: false, msg, data: null });
}

// ── 参数读写（源 util.get_param / set_param）────────────────────────────────

async function getParam(key, dflt = "") {
  const r = await query("SELECT param_val FROM sys_param WHERE param_key=$1", [key]);
  return r.rows[0] && r.rows[0].param_val != null ? r.rows[0].param_val : dflt;
}

async function setParam(key, val, name = "", group = "") {
  const r = await query("SELECT id FROM sys_param WHERE param_key=$1", [key]);
  if (r.rows[0]) {
    await query("UPDATE sys_param SET param_val=$1, param_name=COALESCE(NULLIF($2,''),param_name), group_name=COALESCE(NULLIF($3,''),group_name), updated_at=now() WHERE param_key=$4",
      [String(val), name, group, key]);
  } else {
    await query("INSERT INTO sys_param (param_key, param_val, param_name, group_name, updated_at) VALUES ($1,$2,$3,$4,now())",
      [key, String(val), name || key, group || ""]);
  }
}

// ── 审计（源 util.audit → sys_audit_log）────────────────────────────────────

async function audit(userName, module, action, target, detail = "", ip = "") {
  await query(
    "INSERT INTO sys_audit_log (user_name, module, action, target, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)",
    [userName || "", module || "", action || "", target || "", String(detail || ""), ip || ""]);
}

// ── 密码（源 util.hash_pwd / verify_pwd：sha256(salt + pwd)）────────────────

function hashPwd(pwd, salt = null) {
  salt = salt || randomBytes(8).toString("hex");
  const h = createHash("sha256").update(salt + String(pwd)).digest("hex");
  return [h, salt];
}

function verifyPwd(pwd, pwdHash, salt) {
  if (!pwdHash) return false;
  const h = createHash("sha256").update(salt + String(pwd)).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(h), Buffer.from(String(pwdHash)));
  } catch {
    return false;
  }
}

// ── 当前用户（SMT JWT → mesrj sys_user 自动建档）────────────────────────────
// 源系统 login 建会话；这里 JWT 即身份。首次访问按 login_name 建 sys_user 行，
// 使 sys_user_line（产线数据权限）等引用有落点。

async function currentUser(req) {
  const loginName = req.user?.username || "";
  if (!loginName) return null;
  let r = await query("SELECT * FROM sys_user WHERE login_name=$1", [loginName]);
  if (!r.rows[0]) {
    const [h, salt] = hashPwd(randomBytes(12).toString("hex")); // 不可登录的占位口令
    await query(
      "INSERT INTO sys_user (login_name, emp_name, password_hash, salt, status) VALUES ($1,$2,$3,$4,1) ON CONFLICT (login_name) DO NOTHING",
      [loginName, req.user?.username || loginName, h, salt]);
    r = await query("SELECT * FROM sys_user WHERE login_name=$1", [loginName]);
  }
  const u = r.rows[0];
  const roles = (await query(
    "SELECT r.role_code FROM sys_user_role ur JOIN sys_role r ON r.id=ur.role_id WHERE ur.user_id=$1",
    [u.id])).rows.map(x => x.role_code);
  const perms = new Set((await query(
    "SELECT p.perm_code FROM sys_role_perm rp JOIN sys_perm p ON p.id=rp.perm_id " +
    "JOIN sys_user_role ur ON ur.role_id=rp.role_id WHERE ur.user_id=$1",
    [u.id])).rows.map(x => x.perm_code));
  // 单一登录策略：SMT 侧管理员（roleKey=ADMIN 或通配权限）在 mesrj 亦为管理员，
  // 否则首个接入的管理员无法给自己在 mesrj 授权（先有鸡还是先有蛋）
  const smtAdmin = req.user?.roleKey === "ADMIN" ||
    (Array.isArray(req.user?.permissions) && req.user.permissions.includes("*"));
  return { ...u, roles, perms, is_admin: roles.includes("ADMIN") || smtAdmin };
}

/** 源 auth.has_perm：ADMIN 直通，否则查权限集 */
function hasPerm(u, perm) {
  if (!u) return false;
  if (u.is_admin) return true;
  return u.perms.has(perm);
}

/** 源 @auth.perm_required(perm) */
function requireMesrjPerm(perm) {
  return (req, res, next) => {
    if (!req.mesrjUser) return fail(res, "未登录或登录已过期", 401);
    if (perm && !hasPerm(req.mesrjUser, perm)) return fail(res, `没有权限（${perm}）`, 403);
    next();
  };
}

// ── 表列缓存（源 db.table_columns；_clean/_safe_order 用）───────────────────

const columnCache = new Map();

async function tableColumns(table) {
  if (columnCache.has(table)) return columnCache.get(table);
  const r = await query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
    [table]);
  const cols = new Set(r.rows.map(x => x.column_name));
  columnCache.set(table, cols);
  return cols;
}

// ── CRUD 引擎（源 api/_crud.py 逐语义移植）──────────────────────────────────
//
// 资源清单驱动：每个资源只声明 表/业务键/搜索列/过滤列/必填列/校验函数，
// 列表/详情/增/改/删/批量 六个端点由 registerCrud 统一生成：
//   GET    /:name          列表（page/size/keyword/f_列=值/order）
//   GET    /:name/:rid     详情
//   POST   /:name          新增（必填校验 + 业务键唯一 + check + 审计）
//   PUT    /:name/:rid     修改（immutable 剔除 + 业务键唯一 + check + 审计）
//   DELETE /:name/:rid     删除（soft_delete 资源置 status=0）
//   POST   /:name/bulk     批量导入（按业务键 upsert）

function Res(table, key, label, opts = {}) {
  return {
    table, key, label,
    search: opts.search || [],
    filters: opts.filters || [],
    order: opts.order || "id DESC",
    required: opts.required || [],
    immutable: opts.immutable || [],
    check: opts.check || null,
    softDelete: !!opts.soft_delete,
    permEdit: opts.perm_edit || null,
    readonly: !!opts.readonly,
  };
}

/** 源 _clean：只保留表内字段，null → ""，auto 时间戳 */
async function cleanRow(r, data) {
  const cols = await tableColumns(r.table);
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (cols.has(k) && k !== "id") out[k] = v === null || v === undefined ? "" : v;
  }
  return out;
}

/** 源 _safe_order：前端 order 参数白名单校验，非法即回默认 */
async function safeOrder(r, raw) {
  raw = (raw || "").trim();
  if (!raw) return r.order;
  const cols = await tableColumns(r.table);
  const out = [];
  for (const seg of raw.split(",")) {
    const parts = seg.trim().split(/\s+/);
    if (!parts.length || parts.length > 2) return r.order;
    if (!cols.has(parts[0])) return r.order;
    if (parts.length === 2) {
      const dir = parts[1].toUpperCase();
      if (dir !== "ASC" && dir !== "DESC") return r.order;
      out.push(`${parts[0]} ${dir}`);
    } else {
      out.push(parts[0]);
    }
  }
  return out.length ? out.join(", ") : r.order;
}

function cleanPageArgs(q) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const size = Math.min(500, Math.max(1, parseInt(q.size, 10) || 50));
  return [page, size];
}

/** 源 util.paged → {total, page, size, rows} */
async function paged(countSql, rowsSql, args, page, size) {
  const c = await query(countSql, args);
  const total = Number(c.rows[0]?.n ?? 0);
  const r = await query(`${rowsSql} LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, size, (page - 1) * size]);
  return { total, page, size, rows: r.rows };
}

/**
 * 在 router 上注册一组 CRUD 资源。
 * resources: { name: Res }；permView/permEdit 为模块级默认权限。
 * 权限：模块级默认 + 资源级 perm_edit 覆盖；readonly 资源拒绝写操作。
 */
function registerCrud(router, resources, permView, permEdit) {
  const getRes = name => resources[name] || null;
  // 源 _crud._guard 的 readonly 分支（登录/权限在外层已做）
  const guard = r => (r.readonly ? "只读数据，不允许修改或删除" : null);

  router.get("/:name", async (req, res) => {
    const r = getRes(req.params.name);
    if (!r) return fail(res, `未知资源（${req.params.name}）`, 404);
    const u = req.mesrjUser;
    if (permView && !hasPerm(u, permView)) return fail(res, `没有权限（${permView}）`, 403);
    const [page, size] = cleanPageArgs(req.query);
    const kw = (req.query.keyword || "").toString().trim();
    const where = ["1=1"];
    const args = [];
    if (kw && r.search.length) {
      args.push(`%${kw}%`);
      where.push("(" + r.search.map(c => `${c} ILIKE $${args.length}`).join(" OR ") + ")");
    }
    for (const [k, v] of Object.entries(req.query)) {
      if (!k.startsWith("f_") || v === "") continue;
      const col = k.slice(2);
      if (r.filters.includes(col) || col === "status") {
        args.push(v);
        where.push(`${col}=$${args.length}`);
      }
    }
    const w = where.join(" AND ");
    const order = await safeOrder(r, req.query.order || "");
    try {
      const rows = await paged(
        `SELECT COUNT(*)::int AS n FROM ${r.table} WHERE ${w}`,
        `SELECT * FROM ${r.table} WHERE ${w} ORDER BY ${order}`,
        args, page, size);
      return ok(res, rows);
    } catch (ex) {
      return fail(res, `查询失败：${ex.message}`);
    }
  });

  // 详情
  router.get("/:name/:rid", async (req, res) => {
    const r = getRes(req.params.name);
    if (!r) return fail(res, `未知资源（${req.params.name}）`, 404);
    if (permView && !hasPerm(req.mesrjUser, permView)) return fail(res, `没有权限（${permView}）`, 403);
    const row = (await query(`SELECT * FROM ${r.table} WHERE id=$1`, [req.params.rid])).rows[0];
    if (!row) return fail(res, "记录不存在", 404);
    return ok(res, row);
  });

  // 新增
  router.post("/:name", async (req, res) => {
    const r = getRes(req.params.name);
    if (!r) return fail(res, `未知资源（${req.params.name}）`, 404);
    const roErr = guard(r);
    if (roErr) return fail(res, roErr, 403);
    const perm = r.permEdit || permEdit;
    if (perm && !hasPerm(req.mesrjUser, perm)) return fail(res, `没有权限（${perm}）`, 403);
    const data = await cleanRow(r, req.body || {});
    for (const f of r.required) {
      if (String(data[f] ?? "").trim() === "") return fail(res, `必填字段未填：${f}`);
    }
    if (r.key && data[r.key]) {
      const ex = await query(`SELECT id FROM ${r.table} WHERE ${r.key}=$1`, [data[r.key]]);
      if (ex.rows[0]) return fail(res, `${r.label} 已存在：${data[r.key]}`);
    }
    if (r.check) {
      const [okk, msg] = await r.check(data, true, null);
      if (!okk) return fail(res, msg);
    }
    try {
      const cols = Object.keys(data);
      if (!cols.length) return fail(res, "没有可写入的字段");
      const ph = cols.map((_, i) => `$${i + 1}`).join(",");
      const ins = await query(
        `INSERT INTO ${r.table} (${cols.join(",")}) VALUES (${ph}) RETURNING id`,
        cols.map(c => data[c]));
      await audit(req.mesrjUser.login_name, r.label, "新增", r.table, JSON.stringify(data), req.ip);
      return ok(res, { id: ins.rows[0].id }, "已保存");
    } catch (ex) {
      return fail(res, `保存失败：${ex.message}`);
    }
  });

  // 修改
  router.put("/:name/:rid", async (req, res) => {
    const r = getRes(req.params.name);
    if (!r) return fail(res, `未知资源（${req.params.name}）`, 404);
    const roErr = guard(r);
    if (roErr) return fail(res, roErr, 403);
    const perm = r.permEdit || permEdit;
    if (perm && !hasPerm(req.mesrjUser, perm)) return fail(res, `没有权限（${perm}）`, 403);
    const old = (await query(`SELECT * FROM ${r.table} WHERE id=$1`, [req.params.rid])).rows[0];
    if (!old) return fail(res, "记录不存在", 404);
    const data = await cleanRow(r, req.body || {});
    for (const f of r.immutable) delete data[f];
    delete data.id;
    if (r.key && data[r.key] && data[r.key] !== old[r.key]) {
      const ex = await query(`SELECT id FROM ${r.table} WHERE ${r.key}=$1 AND id<>$2`,
        [data[r.key], req.params.rid]);
      if (ex.rows[0]) return fail(res, `${r.label} 已存在：${data[r.key]}`);
    }
    if (r.check) {
      const [okk, msg] = await r.check(data, false, old);
      if (!okk) return fail(res, msg);
    }
    const cols = Object.keys(data);
    if (!cols.length) return ok(res, null, "没有需要更新的数据");
    try {
      const sets = cols.map((c, i) => `${c}=$${i + 1}`).join(",");
      await query(`UPDATE ${r.table} SET ${sets} WHERE id=$${cols.length + 1}`,
        [...cols.map(c => data[c]), req.params.rid]);
      await audit(req.mesrjUser.login_name, r.label, "修改", r.table,
        `${req.params.rid} -> ${JSON.stringify(data)}`, req.ip);
      return ok(res, null, "已保存");
    } catch (ex) {
      return fail(res, `保存失败：${ex.message}`);
    }
  });

  // 删除
  router.delete("/:name/:rid", async (req, res) => {
    const r = getRes(req.params.name);
    if (!r) return fail(res, `未知资源（${req.params.name}）`, 404);
    const roErr = guard(r);
    if (roErr) return fail(res, roErr, 403);
    const perm = r.permEdit || permEdit;
    if (perm && !hasPerm(req.mesrjUser, perm)) return fail(res, `没有权限（${perm}）`, 403);
    const old = (await query(`SELECT * FROM ${r.table} WHERE id=$1`, [req.params.rid])).rows[0];
    if (!old) return fail(res, "记录不存在", 404);
    try {
      if (r.softDelete) {
        await query(`UPDATE ${r.table} SET status=0 WHERE id=$1`, [req.params.rid]);
      } else {
        await query(`DELETE FROM ${r.table} WHERE id=$1`, [req.params.rid]);
      }
    } catch (ex) {
      return fail(res, `删除失败（数据已被引用，不允许删除）：${ex.message}`);
    }
    await audit(req.mesrjUser.login_name, r.label, "删除", r.table,
      String(old[r.key] ?? req.params.rid), req.ip);
    return ok(res, null, "已删除");
  });

  // 批量导入（按业务键 upsert）
  router.post("/:name/bulk", async (req, res) => {
    const r = getRes(req.params.name);
    if (!r) return fail(res, `未知资源（${req.params.name}）`, 404);
    const roErr = guard(r);
    if (roErr) return fail(res, roErr, 403);
    const perm = r.permEdit || permEdit;
    if (perm && !hasPerm(req.mesrjUser, perm)) return fail(res, `没有权限（${perm}）`, 403);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return fail(res, "没有要导入的数据");
    let okN = 0;
    const failRows = [];
    for (let i = 0; i < rows.length; i++) {
      const data = await cleanRow(r, { ...rows[i] });
      const miss = r.required.filter(f => String(data[f] ?? "").trim() === "");
      if (miss.length) {
        failRows.push({ row: i + 1, msg: `缺少 ${miss.join("、")}` });
        continue;
      }
      try {
        if (r.key && data[r.key]) {
          const ex = await query(`SELECT id FROM ${r.table} WHERE ${r.key}=$1`, [data[r.key]]);
          if (ex.rows[0]) {
            const cols = Object.keys(data);
            const sets = cols.map((c, idx) => `${c}=$${idx + 1}`).join(",");
            await query(`UPDATE ${r.table} SET ${sets} WHERE id=$${cols.length + 1}`,
              [...cols.map(c => data[c]), ex.rows[0].id]);
            okN++;
            continue;
          }
        }
        const cols = Object.keys(data);
        if (!cols.length) throw new Error("没有可写入的字段");
        const ph = cols.map((_, idx) => `$${idx + 1}`).join(",");
        await query(`INSERT INTO ${r.table} (${cols.join(",")}) VALUES (${ph})`,
          cols.map(c => data[c]));
        okN++;
      } catch (ex) {
        failRows.push({ row: i + 1, msg: ex.message });
      }
    }
    await audit(req.mesrjUser.login_name, r.label, "批量导入", r.table,
      `成功 ${okN} 条，失败 ${failRows.length} 条`, req.ip);
    return ok(res, { ok: okN, fail: failRows },
      `导入完成：成功 ${okN} 条，失败 ${failRows.length} 条`);
  });
}

// ── 资源清单（源 md.py RES / sys.py RES 逐字移植）───────────────────────────

/** 源 md.py _check_material：一个越南料号只能对应一个工料号 */
async function checkMaterial(data, isNew, old) {
  const vn = (data.vn_code || "").toString().trim();
  if (!vn) return [true, ""];
  const cn = (data.material_code || "").toString().trim();
  const hit = (await query(
    "SELECT material_code, material_name FROM md_material WHERE trim(vn_code)=$1 AND material_code<>$2",
    [vn, cn])).rows[0];
  if (hit) {
    return [false, `越南料号 ${vn} 已经对应 ${hit.material_code}（${hit.material_name || ""}）。一个越南码只能对应一个工料号，请核对后再保存`];
  }
  return [true, ""];
}

/** 源 sys.py _check_user：新建时散列 password（默认 123456），修改时禁止直改密码列 */
function checkUser(data, isNew) {
  if (isNew) {
    if (!data.password_hash) {
      const pwd = data.password || "123456"; // DEFAULT_PARAM 由调用方传入前已解析，这里保持源默认
      const [h, salt] = hashPwd(pwd);
      data.password_hash = h;
      data.salt = salt;
    }
    delete data.password;
    data.status = data.status || 1;
  } else {
    delete data.password;
    delete data.password_hash;
    delete data.salt;
  }
  return [true, ""];
}

const MD_RES = {
  customer:  Res("md_customer", "cust_code", "客户",
    { search: ["cust_code", "cust_name", "short_name"], required: ["cust_code", "cust_name"] }),
  product:   Res("md_product", "product_code", "产品/SKU",
    { search: ["product_code", "product_name", "product_model", "sku"],
      filters: ["cust_code", "status"], required: ["product_code"], order: "product_code" }),
  material:  Res("md_material", "material_code", "物料",
    { search: ["material_code", "vn_code", "material_name", "spec"],
      filters: ["is_aux", "category", "status"], required: ["material_code"],
      order: "material_code", perm_edit: "md.material.edit", check: checkMaterial }),
  line:      Res("md_line", "line_code", "产线",
    { search: ["line_code", "line_name"], filters: ["line_type", "process_code", "status"],
      required: ["line_code", "line_name"], order: "line_code" }),
  station:   Res("md_station", "station_code", "工位",
    { search: ["station_code", "station_name", "station_name_en", "short_name"],
      filters: ["line_code", "process_code", "station_type", "status", "need_hardware"],
      required: ["station_code", "station_name"], order: "line_code, seq_no",
      perm_edit: "md.station.edit" }),
  track:     Res("md_track", "track_code", "轨道",
    { search: ["track_code", "track_name"], required: ["track_code"], order: "track_code" }),
  "machine-source": Res("cfg_machine_source", "machine_no", "机台数据源",
    { search: ["machine_no", "line_code", "station_code", "remark"], filters: ["enabled"],
      required: ["machine_no", "line_code", "station_code"], order: "machine_no" }),
  equipment: Res("md_equipment", "equip_code", "设备",
    { search: ["equip_code", "equip_name", "model", "brand"],
      filters: ["line_code", "equip_type", "connect_mode", "status"],
      required: ["equip_code", "equip_name"], order: "equip_code" }),
  defect:    Res("md_defect", "defect_code", "不良代码",
    { search: ["defect_code", "name_cn", "name_en"], filters: ["process_code", "category", "status"],
      required: ["defect_code", "name_cn"], order: "defect_code", perm_edit: "md.defect.edit" }),
  rootcause: Res("md_rootcause", "rc_code", "根因代码",
    { search: ["rc_code", "name_cn", "name_en"], required: ["rc_code", "name_cn"], order: "rc_code" }),
  shift:     Res("md_shift", "shift_code", "班次",
    { search: ["shift_code", "shift_name"], required: ["shift_code", "shift_name"], order: "shift_code" }),
  calendar:  Res("md_calendar", "cal_date", "工厂日历",
    { search: ["cal_date", "remark"], filters: ["line_code", "is_workday"],
      required: ["cal_date"], order: "cal_date DESC" }),
};

const SYS_RES = {
  user: Res("sys_user", "login_name", "用户",
    { search: ["login_name", "emp_name", "dept"], filters: ["dept", "status"],
      required: ["login_name", "emp_name"], check: (d, isNew) => checkUser(d, isNew) }),
  role: Res("sys_role", "role_code", "角色",
    { search: ["role_code", "role_name"], required: ["role_code", "role_name"] }),
};

// ── 路由装配 ────────────────────────────────────────────────────────────────

export function createMesrjRouter({ authenticateJWT }) {
  const router = Router();

  // 设备接口（X-Api-Key 鉴权，不走 JWT）——必须在 JWT 中间件之前注册。
  // 源 devsrc.py /DeviceConfig/MachineSource；mesapi.pyc 无源码，_guard_key 按
  // sys_api_key（enabled）表实现，W7 设备波次再对齐设备侧细节。
  router.get("/DeviceConfig/MachineSource", async (req, res) => {
    const key = (req.headers["x-api-key"] || req.query.api_key || "").toString();
    if (!key) return fail(res, "缺少 X-Api-Key", 401);
    const hit = (await query(
      "SELECT id FROM sys_api_key WHERE api_key=$1 AND enabled=1", [key])).rows[0];
    if (!hit) return fail(res, "API Key 无效", 401);
    const machine = (req.query.machine || "").toString().trim();
    if (!machine) return fail(res, "缺少 machine（缺机台号）");
    const row = (await query(
      "SELECT * FROM cfg_machine_source WHERE machine_no=$1 AND enabled=1", [machine])).rows[0];
    if (!row) return fail(res, `机台 ${machine} 未配置数据源`);
    return res.json({ Success: true, Message: "", Data: row });
  });

  // JWT 认证 + mesrj 用户装载（后续全部路由走这里）
  router.use(authenticateJWT, async (req, res, next) => {
    try {
      req.mesrjUser = await currentUser(req);
      if (!req.mesrjUser) return fail(res, "未登录或登录已过期", 401);
      next();
    } catch (ex) {
      fail(res, `用户装载失败：${ex.message}`, 500);
    }
  });

  // ═══ 源 sys.py ═══════════════════════════════════════════════════════════

  // 当前用户（源 /me：SMT JWT 即身份，is_admin 按 mesrj 角色）
  router.get("/me", (req, res) => {
    const u = req.mesrjUser;
    ok(res, {
      id: u.id, login_name: u.login_name, emp_name: u.emp_name,
      dept: u.dept, phone: u.phone, status: u.status,
      roles: u.roles, is_admin: u.is_admin,
    });
  });

  // 菜单（源 /menu：perm_any 组 + menu.<code> 页面级权限过滤）
  router.get("/menu", async (req, res) => {
    const u = req.mesrjUser;
    const known = new Set((await query(
      "SELECT perm_code FROM sys_perm WHERE perm_code LIKE 'menu.%'")).rows.map(x => x.perm_code));
    const out = [];
    for (const m of MENU) {
      const anyPerm = m.perm_any || [];
      if (anyPerm.length) {
        if (!anyPerm.some(p => hasPerm(u, p))) continue;
      } else if (m.perm && !hasPerm(u, m.perm)) {
        continue;
      }
      const item = {};
      for (const [k, v] of Object.entries(m)) {
        if (k !== "children" && k !== "perm_any") item[k] = v;
      }
      const kids = [];
      for (const c of m.children || []) {
        const pc = "menu." + (c.code || "");
        if (known.has(pc)) {
          if (!hasPerm(u, pc)) continue;
        } else if (c.perm && !hasPerm(u, c.perm)) {
          continue;
        }
        kids.push(c);
      }
      if ((m.children || []).length && !kids.length) continue;
      if (kids.length) item.children = kids;
      out.push(item);
    }
    ok(res, out);
  });

  // 系统信息（源 /sysinfo；db_path/port/ips 按 PG 部署改写）
  router.get("/sysinfo", async (req, res) => {
    const cnt = async sql => Number((await query(sql)).rows[0]?.n ?? 0);
    ok(res, {
      sys_name: await getParam("SYS_NAME", "瑞晶车间 MES 中间层"),
      version: await getParam("SYS_VERSION", "1.0.1"),
      factory: await getParam("FACTORY_NAME", ""),
      db: "PostgreSQL smt_factory",
      port: Number(process.env.API_PORT ?? 8080),
      started_at: process.env.MESRJ_BOOT_AT || "",
      counts: {
        工位: await cnt("SELECT COUNT(*)::int AS n FROM md_station"),
        物料: await cnt("SELECT COUNT(*)::int AS n FROM md_material"),
        产品: await cnt("SELECT COUNT(*)::int AS n FROM md_product"),
        "BOM明细": await cnt("SELECT COUNT(*)::int AS n FROM bom_item"),
        不良代码: await cnt("SELECT COUNT(*)::int AS n FROM md_defect"),
        设备: await cnt("SELECT COUNT(*)::int AS n FROM md_equipment"),
        用户: await cnt("SELECT COUNT(*)::int AS n FROM sys_user"),
      },
    });
  });

  // 用户口令（源 /user/<uid>/password：本人验旧密码，管理员直改）
  router.post("/sys/user/:uid/password", requireMesrjPerm(null), async (req, res) => {
    const uid = Number(req.params.uid);
    const me = req.mesrjUser;
    if (uid !== me.id && !hasPerm(me, "sys.user.edit")) return fail(res, "只能修改自己的密码", 403);
    const newPwd = (req.body?.new_password || "").toString().trim();
    if (newPwd.length < 6) return fail(res, "密码至少 6 位");
    if (uid === me.id && !hasPerm(me, "sys.user.edit")) {
      const okOld = verifyPwd(req.body?.old_password || "", me.password_hash, me.salt);
      if (!okOld) return fail(res, "原密码不正确");
    }
    const [h, salt] = hashPwd(newPwd);
    await query("UPDATE sys_user SET password_hash=$1, salt=$2 WHERE id=$3", [h, salt, uid]);
    await audit(me.login_name, "系统", "改密码", "sys_user", String(uid), req.ip);
    return ok(res, null, "密码已修改");
  });

  // 用户角色（源 /user/<uid>/roles）
  router.post("/sys/user/:uid/roles", requireMesrjPerm("sys.user.edit"), async (req, res) => {
    const uid = Number(req.params.uid);
    const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
    await query("DELETE FROM sys_user_role WHERE user_id=$1", [uid]);
    for (const rc of roles) {
      const rid = (await query("SELECT id FROM sys_role WHERE role_code=$1", [rc])).rows[0]?.id;
      if (rid) {
        await query(
          "INSERT INTO sys_user_role (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [uid, rid]);
      }
    }
    await audit(req.mesrjUser.login_name, "系统", "设置角色", "sys_user",
      `${uid} -> ${JSON.stringify(roles)}`, req.ip);
    return ok(res, null, "已保存");
  });

  // 用户产线（源 /user/<uid>/lines）
  router.post("/sys/user/:uid/lines", requireMesrjPerm("sys.user.edit"), async (req, res) => {
    const uid = Number(req.params.uid);
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    await query("DELETE FROM sys_user_line WHERE user_id=$1", [uid]);
    for (const lc of lines) {
      await query(
        "INSERT INTO sys_user_line (user_id, line_code) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [uid, lc]);
    }
    return ok(res, null, "已保存");
  });

  // 用户详情（源 /user/<uid>/detail）
  router.get("/sys/user/:uid/detail", requireMesrjPerm("sys.user.view"), async (req, res) => {
    const uid = Number(req.params.uid);
    const u = (await query(
      "SELECT id, login_name, emp_name, dept, phone, status, remark FROM sys_user WHERE id=$1",
      [uid])).rows[0];
    if (!u) return fail(res, "用户不存在", 404);
    u.roles = (await query(
      "SELECT r.role_code FROM sys_user_role ur JOIN sys_role r ON r.id=ur.role_id WHERE ur.user_id=$1",
      [uid])).rows.map(x => x.role_code);
    u.lines = (await query(
      "SELECT line_code FROM sys_user_line WHERE user_id=$1", [uid])).rows.map(x => x.line_code);
    return ok(res, u);
  });

  // 角色权限（源 /role/<rid>/perms POST/GET）
  router.post("/sys/role/:rid/perms", requireMesrjPerm("sys.role.edit"), async (req, res) => {
    const rid = Number(req.params.rid);
    const perms = Array.isArray(req.body?.perms) ? req.body.perms : [];
    await query("DELETE FROM sys_role_perm WHERE role_id=$1", [rid]);
    for (const pc of perms) {
      const pid = (await query("SELECT id FROM sys_perm WHERE perm_code=$1", [pc])).rows[0]?.id;
      if (pid) {
        await query(
          "INSERT INTO sys_role_perm (role_id, perm_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [rid, pid]);
      }
    }
    await audit(req.mesrjUser.login_name, "系统", "设置权限", "sys_role",
      `${rid} -> ${perms.length} 项`, req.ip);
    return ok(res, null, "已保存");
  });

  router.get("/sys/role/:rid/perms", requireMesrjPerm("sys.user.view"), async (req, res) => {
    const rows = (await query(
      "SELECT p.perm_code, p.perm_name, p.module FROM sys_role_perm rp " +
      "JOIN sys_perm p ON p.id=rp.perm_id WHERE rp.role_id=$1 ORDER BY p.module, p.perm_code",
      [Number(req.params.rid)])).rows;
    return ok(res, rows);
  });

  // 权限树（源 /perm/tree：按模块分组 + 每权限能解锁的菜单名）
  router.get("/sys/perm/tree", async (req, res) => {
    const rows = (await query(
      "SELECT perm_code, perm_name, module FROM sys_perm ORDER BY module, perm_code")).rows;
    const menus = {};
    for (const m of MENU) {
      for (const c of m.children || []) {
        if (c.perm) (menus[c.perm] = menus[c.perm] || []).push(c.name || c.code);
      }
    }
    const groups = {};
    for (const r of rows) {
      const d = { ...r, menus: menus[r.perm_code] || [] };
      (groups[r.module] = groups[r.module] || []).push(d);
    }
    ok(res, Object.entries(groups).map(([module, perms]) => ({ module, perms })));
  });

  // 系统参数（源 /param/list：全量按组）
  router.get("/sys/param/list", async (req, res) => {
    const rows = (await query(
      "SELECT * FROM sys_param ORDER BY group_name, param_key")).rows;
    const groups = {};
    for (const r of rows) {
      (groups[r.group_name || "其它"] = groups[r.group_name || "其它"] || []).push(r);
    }
    ok(res, Object.entries(groups).map(([group, items]) => ({ group, items })));
  });

  router.post("/sys/param/save", requireMesrjPerm("sys.param.edit"), async (req, res) => {
    const items = req.body?.items || {};
    for (const [k, v] of Object.entries(items)) await setParam(k, v);
    await audit(req.mesrjUser.login_name, "系统", "改参数", "sys_param",
      Object.keys(items).join(","), req.ip);
    return ok(res, null, "已保存");
  });

  // 接口对接配置（源 /itf/config 系列）
  router.get("/itf/config", async (req, res) => {
    const rows = (await query("SELECT * FROM itf_api_config ORDER BY id")).rows;
    ok(res, { rows, cfg_base_url: await getParam("mes.base_url", "") });
  });

  router.post("/itf/config/save", requireMesrjPerm("sys.param.edit"), async (req, res) => {
    const d = req.body || {};
    let rid = Number(d.id) || 0;
    const name = (d.api_name || "上级 MES").trim();
    if (!rid) {
      const ex = (await query(
        "SELECT id FROM itf_api_config WHERE api_name=$1 ORDER BY id LIMIT 1", [name])).rows[0];
      if (ex) rid = ex.id;
    }
    const data = {
      api_name: name,
      base_url: (d.base_url || "").trim(),
      api_key: d.api_key ?? "",
      timeout: Math.trunc(Number(d.timeout) || 10),
      use_proxy: [1, "1", true, "true"].includes(d.use_proxy) ? 1 : 0,
      enabled: [1, "1", true, "true", null, undefined].includes(d.enabled) ? 1 : 0,
      remark: d.remark ?? "",
    };
    if (rid) {
      await query(
        "UPDATE itf_api_config SET api_name=$1, base_url=$2, api_key=$3, timeout=$4, use_proxy=$5, enabled=$6, remark=$7, updated_at=now() WHERE id=$8",
        [data.api_name, data.base_url, data.api_key, data.timeout, data.use_proxy, data.enabled, data.remark, rid]);
    } else {
      const ins = await query(
        "INSERT INTO itf_api_config (api_name, base_url, api_key, timeout, use_proxy, enabled, remark, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING id",
        [data.api_name, data.base_url, data.api_key, data.timeout, data.use_proxy, data.enabled, data.remark]);
      rid = ins.rows[0].id;
    }
    await audit(req.mesrjUser.login_name, "系统", "改接口配置", "itf_api_config", data.base_url, req.ip);
    return ok(res, { id: rid }, "已保存");
  });

  router.post("/itf/config/test", async (req, res) => {
    let url = (req.body?.base_url || "").trim();
    if (!url) return fail(res, "请先填写 MES 服务器地址");
    if (!url.startsWith("http")) url = "http://" + url;
    const t0 = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      return ok(res, { http_status: r.status, cost_ms: Date.now() - t0 },
        `连接成功（HTTP ${r.status}）`);
    } catch (ex) {
      if (ex.name === "AbortError") return fail(res, "连接失败：超时（6 秒）");
      return fail(res, `连接失败：${ex.message}`);
    }
  });

  // 审计日志（源 /audit）
  router.get("/audit", requireMesrjPerm("sys.log.view"), async (req, res) => {
    const [page, size] = cleanPageArgs(req.query);
    const kw = (req.query.keyword || "").toString().trim();
    const where = ["1=1"];
    const args = [];
    if (kw) {
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
      where.push(`(user_name ILIKE $${args.length - 3} OR module ILIKE $${args.length - 2} OR action ILIKE $${args.length - 1} OR target ILIKE $${args.length})`);
    }
    const d1 = (req.query.d1 || "").toString().trim();
    const d2 = (req.query.d2 || "").toString().trim();
    if (d1) {
      args.push(`${d1} 00:00:00`);
      where.push(`created_at >= $${args.length}::timestamptz`);
    }
    if (d2) {
      args.push(`${d2} 23:59:59`);
      where.push(`created_at <= $${args.length}::timestamptz`);
    }
    const w = where.join(" AND ");
    const rows = await paged(
      `SELECT COUNT(*)::int AS n FROM sys_audit_log WHERE ${w}`,
      `SELECT * FROM sys_audit_log WHERE ${w} ORDER BY id DESC`,
      args, page, size);
    return ok(res, rows);
  });

  // ═══ 源 md.py ═════════════════════════════════════════════════════════════

  // 全局下拉（源 /md/options：一次取全，前端记住）
  router.get("/md/options", async (req, res) => {
    ok(res, {
      lines: (await query(
        "SELECT line_code AS v, line_name AS t FROM md_line WHERE status=1 ORDER BY line_code")).rows,
      products: (await query(
        "SELECT p.product_code AS v, p.product_model AS t, p.cust_code, " +
        "  (SELECT COUNT(*) FROM cfg_model_process c WHERE c.model=p.product_model) AS route_n " +
        "FROM md_product p WHERE p.status=1 AND COALESCE(p.product_type,'FG')='FG' " +
        "ORDER BY p.product_code")).rows,
      semi_products: (await query(
        "SELECT product_code AS v, product_model AS t FROM md_product " +
        "WHERE status=1 AND product_type='SFG' ORDER BY product_code")).rows,
      models: (await query(
        "SELECT DISTINCT product_model AS v, product_model AS t FROM md_product " +
        "WHERE status=1 AND COALESCE(product_type,'FG')='FG' " +
        "AND COALESCE(product_model,'')<>'' ORDER BY product_model")).rows,
      customers: (await query(
        "SELECT cust_code AS v, cust_name AS t FROM md_customer WHERE status=1 ORDER BY cust_code")).rows,
      tracks: (await query(
        "SELECT track_code AS v, track_name AS t FROM md_track WHERE status=1 ORDER BY track_code")).rows,
      processes: (await query(
        "SELECT code AS v, name AS t FROM cfg_code_dict WHERE dict_type='PROCESS_CODE' AND enabled=1 ORDER BY sort_no")).rows,
      wo_types: (await query(
        "SELECT code AS v, name AS t FROM cfg_code_dict WHERE dict_type='WO_TYPE' AND enabled=1 ORDER BY sort_no")).rows,
      shifts: (await query(
        "SELECT shift_code AS v, shift_name AS t FROM md_shift WHERE status=1 ORDER BY shift_code")).rows,
      defects: (await query(
        "SELECT defect_code AS v, name_cn AS t, process_code, category FROM md_defect WHERE status=1 ORDER BY defect_code")).rows,
      rootcauses: (await query(
        "SELECT rc_code AS v, name_cn AS t FROM md_rootcause WHERE status=1 ORDER BY rc_code")).rows,
      stations: (await query(
        "SELECT station_code AS v, " +
        "COALESCE(NULLIF(short_name,''), station_name) AS t, " +
        "station_name AS full_name, COALESCE(short_name,'') AS short_name, " +
        "COALESCE(type_code,'') AS type_code, line_code, process_code, seq_no, " +
        "COALESCE(panel_work,0) AS panel_work, COALESCE(is_sampling,0) AS is_sampling, " +
        "COALESCE(deny_manual_pass,0) AS deny_manual_pass " +
        "FROM md_station WHERE status=1 ORDER BY line_code, seq_no")).rows,
      roles: (await query(
        "SELECT role_code AS v, role_name AS t FROM sys_role ORDER BY role_code")).rows,
      equipments: (await query(
        "SELECT equip_code AS v, equip_name AS t, line_code, COALESCE(equip_type,'') AS equip_type " +
        "FROM md_equipment WHERE status=1 ORDER BY equip_code")).rows,
    });
  });

  // 产线体检（源 /md/line/audit：四类现场会直接卡住的问题）
  router.get("/md/line/audit", async (req, res) => {
    const issues = [];
    for (const L of (await query(
      "SELECT line_code, line_name FROM md_line WHERE status=1 ORDER BY line_code")).rows) {
      const n = Number((await query(
        "SELECT COUNT(*)::int AS n FROM md_station WHERE line_code=$1 AND status=1",
        [L.line_code])).rows[0]?.n ?? 0);
      if (n === 0) {
        issues.push({ level: "error", line: L.line_code,
          msg: "产线下一个工位都没有，排产时报工位会是空的，扫描没法过" });
      }
    }
    for (const r of (await query(
      "SELECT station_code, line_code FROM md_station WHERE status=1 " +
      "AND type_code IN ('PCBA Link','绑码')")).rows) {
      const hit = (await query(
        "SELECT id FROM cfg_bind_station WHERE station_code=$1", [r.station_code])).rows[0];
      if (!hit) {
        issues.push({ level: "error", line: r.line_code,
          msg: `${r.station_code} 是绑码工位，但没有配置绑码，扫描去会报"找不到绑码工位"` });
      }
    }
    for (const r of (await query(
      "SELECT line_code, type_code, COUNT(*)::int AS n, string_agg(station_code, ',') AS codes " +
      "FROM md_station WHERE status=1 AND COALESCE(type_code,'')<>'' " +
      "GROUP BY line_code, type_code HAVING COUNT(*)>1")).rows) {
      issues.push({ level: "warn", line: r.line_code,
        msg: `${r.type_code} 在同一条线出现了 ${r.n} 次（${r.codes}），扫描时会不知道选哪个` });
    }
    for (const r of (await query(
      "SELECT machine_no, station_code FROM cfg_machine_source")).rows) {
      const sc = (r.station_code || "").trim();
      if (sc) {
        const hit = (await query(
          "SELECT id FROM md_station WHERE station_code=$1", [sc])).rows[0];
        if (!hit) {
          issues.push({ level: "error", line: "",
            msg: `机台 ${r.machine_no} 指向的工位 ${sc} 不存在，机台设备的数据会全部丢失` });
        }
      }
    }
    const errs = issues.filter(x => x.level === "error").length;
    const msg = issues.length
      ? `发现 ${issues.length} 个问题（其中 ${errs} 个会让现场直接卡住）`
      : "没有发现问题，产线配置健康";
    return ok(res, { issues, count: issues.length, errors: errs }, msg);
  });

  // 整线克隆（源 /md/line/clone：新线 + 工位 + 绑码配置一次到位）
  router.post("/md/line/clone", requireMesrjPerm("md.station.edit"), async (req, res) => {
    const d = req.body || {};
    const src = (d.from_line || "").trim();
    const dst = (d.to_line || "").trim();
    const name = (d.to_name || "").trim() || dst;
    if (!src || !dst) return fail(res, "请选择源产线，并填新产线编码");
    if (src === dst) return fail(res, "新产线编码不能和源产线一样");
    const srows = (await query(
      "SELECT * FROM md_station WHERE line_code=$1 ORDER BY seq_no, station_code", [src])).rows;
    if (!srows.length) return fail(res, `源产线 ${src} 没有工位，没有可克隆的`);
    const dstCount = Number((await query(
      "SELECT COUNT(*)::int AS n FROM md_station WHERE line_code=$1", [dst])).rows[0]?.n ?? 0);
    if (dstCount) {
      return fail(res, `产线 ${dst} 已经有工位，克隆会覆盖它，不允许自动覆盖。要调整某个工位设置，请复制工位或改产线`);
    }
    const sl = (await query("SELECT * FROM md_line WHERE line_code=$1", [src])).rows[0];

    let nLine = 0;
    const hasLine = (await query("SELECT id FROM md_line WHERE line_code=$1", [dst])).rows[0];
    if (!hasLine) {
      await query(
        "INSERT INTO md_line (line_code, line_name, line_type, process_code, tact_time, plan_hours, status, remark) VALUES ($1,$2,$3,$4,$5,$6,1,$7)",
        [dst, name, d.line_type || sl?.line_type || "", d.process_code || sl?.process_code || "",
         sl?.tact_time || 0, sl?.plan_hours || 8, `从 ${src} 克隆产线`]);
      nLine = 1;
    }

    // 工位（数据源、绑码等原样复制；编码去掉源线前缀再接新前缀）
    const prefix = src + "-";
    const codeMap = {};
    let nSt = 0;
    for (const r of srows) {
      const tail = r.station_code.startsWith(prefix) ? r.station_code.slice(prefix.length) : r.station_code;
      const code = `${dst}-${tail}`;
      if ((await query("SELECT id FROM md_station WHERE station_code=$1", [code])).rows[0]) continue;
      const cols = Object.keys(r).filter(c => c !== "id");
      const vals = cols.map(c => {
        if (c === "station_code") return code;
        if (c === "line_code") return dst;
        if (c === "station_name") return (r.station_name || "").split(src).join(dst);
        if (c === "remark") return ((r.remark || "") + `；从 ${src} 整线复制`).trim();
        if (c === "created_at") return new Date();
        return r[c];
      });
      const ph = cols.map((_, i) => `$${i + 1}`).join(",");
      await query(`INSERT INTO md_station (${cols.join(",")}) VALUES (${ph})`, vals);
      codeMap[r.station_code] = code;
      nSt++;
    }

    // 绑码配置（工位编码精确匹配，克隆后绑码关系不断）
    let nBind = 0;
    for (const [oldCode, newCode] of Object.entries(codeMap)) {
      const row = (await query(
        "SELECT * FROM cfg_bind_station WHERE station_code=$1", [oldCode])).rows[0];
      if (!row) continue;
      const cols = Object.keys(row).filter(c => c !== "id");
      const vals = cols.map(c => (c === "station_code" ? newCode : (c === "created_at" || c === "updated_at") ? new Date() : row[c]));
      await query(`INSERT INTO cfg_bind_station (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals);
      nBind++;
      for (const br of (await query(
        "SELECT * FROM cfg_bind_rule WHERE station_code=$1", [oldCode])).rows) {
        const bcols = Object.keys(br).filter(c => c !== "id");
        const bvals = bcols.map(c => (c === "station_code" ? newCode : (c === "created_at" || c === "updated_at") ? new Date() : br[c]));
        await query(`INSERT INTO cfg_bind_rule (${bcols.join(",")}) VALUES (${bcols.map((_, i) => `$${i + 1}`).join(",")})`, bvals);
      }
    }

    // 系统管不到的，明确列出来
    const todos = [];
    const ms = (await query(
      "SELECT machine_no, station_code FROM cfg_machine_source WHERE line_code=$1", [src])).rows;
    if (ms.length) {
      const lst = ms.map(x => `${x.machine_no}（新工位 ${codeMap[x.station_code] || "?"}）`).join("、");
      todos.push(`设备要重新分配：${lst}。设备所连的工位要改成新编码，再到设备数据源里登记一台，数据才会进来`);
    }
    todos.push("工艺路线不用改：路线工位编码如果和新线一致，系统会按同一个工位自动匹配");
    todos.push("装箱/栈板不用管：已封箱记录 + 老产线，自动保留");

    await audit(req.mesrjUser.login_name, "工位", "克隆", dst,
      `从 ${src} 克隆工位 ${nSt}，绑码 ${nBind}`, req.ip);
    return ok(res, {
      line_code: dst, line_name: name, line_created: nLine,
      stations: nSt, binds: nBind, todos,
    }, `已克隆到 ${dst}（工位 ${nSt} 个，绑码配置 ${nBind} 项）`);
  });

  // 工位整线复制（源 /md/station/copy：只复制工位，不动绑码）
  router.post("/md/station/copy", requireMesrjPerm("md.station.edit"), async (req, res) => {
    const d = req.body || {};
    const src = (d.from_line || "").trim();
    const dst = (d.to_line || "").trim();
    if (!src || !dst) return fail(res, "请指定源产线和目标产线");
    if (src === dst) return fail(res, "源产线和目标产线相同");
    const rows = (await query(
      "SELECT * FROM md_station WHERE line_code=$1 ORDER BY seq_no", [src])).rows;
    if (!rows.length) return fail(res, "源产线没有工位");
    let n = 0;
    const prefix = src + "-";
    for (const r of rows) {
      const tail = r.station_code.startsWith(prefix) ? r.station_code.slice(prefix.length) : r.station_code;
      const code = `${dst}-${tail}`;
      if ((await query("SELECT id FROM md_station WHERE station_code=$1", [code])).rows[0]) continue;
      const cols = Object.keys(r).filter(c => c !== "id");
      const vals = cols.map(c => {
        if (c === "station_code") return code;
        if (c === "line_code") return dst;
        if (c === "created_at") return new Date();
        return r[c];
      });
      await query(`INSERT INTO md_station (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals);
      n++;
    }
    await audit(req.mesrjUser.login_name, "工位", "复制", "md_station",
      `${src} -> ${dst}，${n} 个工位`, req.ip);
    return ok(res, { copied: n }, `已复制 ${n} 个工位`);
  });

  // 工位简称批量改（源 /md/station/rename：只改显示，不动编码）
  router.post("/md/station/rename", requireMesrjPerm("md.station.edit"), async (req, res) => {
    const text = (req.body?.text || "").toString();
    if (!text.trim()) return fail(res, "请粘贴要修改的清单");
    let okN = 0;
    const miss = [];
    const err = [];
    for (const [ln, raw] of text.split(/\r?\n/).entries()) {
      const line = (raw || "").trim();
      if (!line || line.startsWith("#")) continue;
      const parts = line.replace(/\t/g, ",").replace(/，/g, ",").split(",").map(x => x.trim());
      if (parts.length < 2) continue;
      const [code, short, full] = parts;
      const row = (await query(
        "SELECT id FROM md_station WHERE station_code=$1", [code])).rows[0];
      if (!row) {
        miss.push(code);
        continue;
      }
      try {
        const vals = { short_name: short };
        if (full !== undefined) vals.station_name = full;
        await query("UPDATE md_station SET short_name=$1, station_name=COALESCE($2, station_name) WHERE id=$3",
          [short, full ?? null, row.id]);
        await query("UPDATE proc_step SET station_name=$1 WHERE station_code=$2", [short, code]);
        okN++;
      } catch (ex) {
        err.push(`${code}: ${ex.message}`);
      }
    }
    await audit(req.mesrjUser.login_name, "工位", "简称批量改", "md_station", `${okN} 条`, req.ip);
    let msg = `已更新 ${okN} 个工位名称（编码未动）`;
    if (miss.length) msg += `；${miss.length} 个编码不存在：${miss.slice(0, 6).join("、")}`;
    if (err.length) msg += `；${err.length} 条失败`;
    return ok(res, { updated: okN, missing: miss, errors: err }, msg);
  });

  // 不良代码按工序（源 /md/defect/by-process）
  router.get("/md/defect/by-process", async (req, res) => {
    const p = (req.query.process_code || "").toString().trim();
    const rows = p
      ? (await query(
        "SELECT * FROM md_defect WHERE status=1 AND process_code=$1 ORDER BY defect_code", [p])).rows
      : (await query(
        "SELECT * FROM md_defect WHERE status=1 ORDER BY defect_code")).rows;
    return ok(res, rows);
  });

  // 机型维护（源 basic.py /md/model/*：机型 ↔ 料号 ↔ 客户）
  router.get("/md/model/list", async (req, res) => {
    const kw = (req.query.keyword || "").toString().trim();
    const cust = (req.query.cust_code || "").toString().trim();
    const ptype = (req.query.product_type || "").toString().trim().toUpperCase();
    let sql = "SELECT p.*, c.cust_name FROM md_product p LEFT JOIN md_customer c ON c.cust_code=p.cust_code";
    const args = [];
    if (ptype === "FG" || ptype === "SFG") {
      sql += " WHERE COALESCE(p.product_type,'FG')=$1";
      args.push(ptype);
    }
    sql += " ORDER BY COALESCE(p.product_type,'FG') DESC, p.product_model, p.product_code";
    const rows = (await query(sql, args)).rows;
    const custMaster = {};
    for (const r of (await query("SELECT * FROM md_customer")).rows) custMaster[r.cust_code] = r;
    const groups = {};
    const order = [];
    for (const r of rows) {
      const m = (r.product_model || "").trim() || "（未设型号）";
      if (kw && !(m + " " + (r.product_code || "") + " " + (r.product_name || "")).toUpperCase().includes(kw.toUpperCase())) continue;
      if (cust && (r.cust_code || "") !== cust) continue;
      let g = groups[m];
      if (!g) {
        g = groups[m] = {
          model: m, cust_code: r.cust_code || "", cust_name: r.cust_name || "",
          codes: [], enabled: 0, product_type: r.product_type || "FG",
          cust_known: !r.cust_code || !!custMaster[r.cust_code],
        };
        order.push(m);
      }
      g.codes.push({
        product_code: r.product_code, product_name: r.product_name || "",
        product_type: r.product_type || "FG", spec: r.spec || "",
        color: r.color || "", sku: r.sku || "", unit: r.unit || "",
        status: r.status, id: r.id,
      });
      if (r.status) g.enabled++;
    }
    const out = order.map(m => groups[m]);
    const customers = [];
    const seen = new Set();
    for (const c of (await query(
      "SELECT cust_code, cust_name, status FROM md_customer ORDER BY cust_code")).rows) {
      seen.add(c.cust_code);
      customers.push({ ...c, known: 1 });
    }
    for (const r of (await query(
      "SELECT DISTINCT cust_code FROM md_product WHERE COALESCE(cust_code,'')<>'' ORDER BY cust_code")).rows) {
      if (!seen.has(r.cust_code)) {
        customers.push({ cust_code: r.cust_code, cust_name: "", status: 1, known: 0 });
      }
    }
    return ok(res, { rows: out, customers, total: out.reduce((a, g) => a + g.codes.length, 0) });
  });

  router.post("/md/model/save", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const oldM = (d.old_model || "").trim();
    const newM = (d.model || "").trim();
    const cust = (d.cust_code || "").trim();
    if (!oldM || !newM) return fail(res, "型号不能为空");
    if (newM !== oldM) {
      const n = Number((await query(
        "SELECT COUNT(*)::int AS n FROM md_product WHERE product_model=$1", [newM])).rows[0]?.n ?? 0);
      if (n) return fail(res, `型号「${newM}」已存在，请直接编辑那一个`);
    }
    const r = await query(
      "UPDATE md_product SET product_model=$1, cust_code=$2 WHERE product_model=$3",
      [newM, cust, oldM]);
    await audit(req.mesrjUser.login_name, "机型管理", "改机型", `${oldM} → ${newM}`,
      `客户 ${cust}，影响 ${r.rowCount} 个料号`, req.ip);
    return ok(res, { model: newM, cust_code: cust }, `已保存（${r.rowCount} 个料号）`);
  });

  router.post("/md/model/code/save", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const code = (d.product_code || "").trim();
    const model = (d.product_model || "").trim();
    if (!code) return fail(res, "产品料号必填");
    if (!model) return fail(res, "型号必填");
    const exist = (await query("SELECT * FROM md_product WHERE product_code=$1", [code])).rows[0];
    let ptype = (d.product_type || "FG").trim().toUpperCase();
    if (ptype !== "FG" && ptype !== "SFG") ptype = "FG";
    const data = {
      product_model: model, product_type: ptype,
      product_name: d.product_name || "", cust_code: d.cust_code || "",
      spec: d.spec || "", color: d.color || "", sku: d.sku || "",
      unit: d.unit || "PCS", status: d.status === 0 || d.status === false ? 0 : 1,
      remark: d.remark || "",
    };
    let msg;
    if (exist) {
      const cols = Object.keys(data);
      await query(
        `UPDATE md_product SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(",")} WHERE id=$${cols.length + 1}`,
        [...cols.map(c => data[c]), exist.id]);
      msg = `已更新料号 ${code}`;
    } else {
      await query(
        "INSERT INTO md_product (product_code, product_model, product_type, product_name, cust_code, spec, color, sku, unit, status, remark) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [code, data.product_model, data.product_type, data.product_name, data.cust_code,
         data.spec, data.color, data.sku, data.unit, data.status, data.remark]);
      msg = `新建料号 ${code}`;
    }
    await audit(req.mesrjUser.login_name, "机型管理", "保存产品料号", code, model, req.ip);
    return ok(res, { product_code: code }, msg);
  });

  router.post("/md/model/code/delete", requireMesrjPerm("md.edit"), async (req, res) => {
    const code = (req.body?.product_code || "").trim();
    if (!code) return fail(res, "缺料号");
    const used = [];
    for (const [table, field, name] of [
      ["bom_header", "product_code", "BOM"],
      ["ord_mo", "product_code", "工单"],
      ["bom_item", "material_code", "料号 BOM 的成品料"],
    ]) {
      const n = Number((await query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${field}=$1`, [code])).rows[0]?.n ?? 0);
      if (n) used.push(`${name} ${n} 条`);
    }
    if (used.length) return fail(res, `该料号已被引用（${used.join("、")}），不能删除。可把它停用`);
    await query("DELETE FROM md_product WHERE product_code=$1", [code]);
    await audit(req.mesrjUser.login_name, "机型管理", "删除料号", code, "", req.ip);
    return ok(res, null, "已删除");
  });

  // ═══ 源 basic.py ══════════════════════════════════════════════════════════

  // 工序字典（源 /cfg/basic/process 系列）
  router.get("/cfg/basic/process", async (req, res) => {
    const rows = (await query(
      "SELECT p.*, " +
      "(SELECT COUNT(*) FROM cfg_capacity c WHERE c.process=p.process_code) AS cap_cnt, " +
      "(SELECT COUNT(*) FROM pln_schedule s WHERE s.process=p.process_code) AS plan_cnt, " +
      "(SELECT COUNT(*) FROM prd_shift_report r WHERE r.process=p.process_code) AS rep_cnt " +
      "FROM cfg_process p ORDER BY p.sort_no, p.process_code")).rows;
    return ok(res, { rows });
  });

  router.post("/cfg/basic/process/save", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const d = req.body || {};
    const rid = Math.trunc(Number(d.id) || 0);
    const code = (d.process_code || "").trim();
    if (!code) return fail(res, "工序编码必填（排产/报表/班组都用它）");
    const name = (d.process_name || "").trim() || code;
    const kws = (d.station_keywords || "").trim().replace(/，/g, ",");
    try {
      if (rid) {
        const old = (await query("SELECT * FROM cfg_process WHERE id=$1", [rid])).rows[0];
        if (!old) return fail(res, "工序不存在");
        if (code !== old.process_code) {
          // 改代码 = 全业务链跟着改（历史数据要一起跟着走）
          await query("UPDATE cfg_capacity SET process=$1 WHERE process=$2", [code, old.process_code]);
          await query("UPDATE pln_schedule SET process=$1 WHERE process=$2", [code, old.process_code]);
          await query("UPDATE prd_shift_report SET process=$1 WHERE process=$2", [code, old.process_code]);
        }
        await query(
          "UPDATE cfg_process SET process_code=$1, process_name=$2, sort_no=$3, station_keywords=$4, enabled=$5, remark=$6, updated_at=now() WHERE id=$7",
          [code, name, Math.trunc(Number(d.sort_no) || 0), kws,
           d.enabled === 0 || d.enabled === false ? 0 : 1, d.remark || "", rid]);
        await audit(req.mesrjUser.login_name, "基础配置", "改工序",
          `${old.process_code} → ${code}`, `显示名 ${name}`, req.ip);
      } else {
        await query(
          "INSERT INTO cfg_process (process_code, process_name, sort_no, station_keywords, enabled, remark) VALUES ($1,$2,$3,$4,$5,$6)",
          [code, name, Math.trunc(Number(d.sort_no) || 0), kws,
           d.enabled === 0 || d.enabled === false ? 0 : 1, d.remark || ""]);
        await audit(req.mesrjUser.login_name, "基础配置", "加工序", code, name, req.ip);
      }
    } catch (ex) {
      return fail(res, `保存失败：${String(ex.message).slice(0, 100)}（编码可能已存在或重复）`);
    }
    return ok(res, null, "已保存");
  });

  router.post("/cfg/basic/process/delete", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const rid = Math.trunc(Number(req.body?.id) || 0);
    const row = (await query("SELECT * FROM cfg_process WHERE id=$1", [rid])).rows[0];
    if (!row) return fail(res, "工序不存在");
    const used = [];
    for (const [table, name] of [["cfg_capacity", "产能"], ["pln_schedule", "排产"], ["prd_shift_report", "报工"]]) {
      const n = Number((await query(
        `SELECT COUNT(*)::int AS n FROM ${table} WHERE process=$1`, [row.process_code])).rows[0]?.n ?? 0);
      if (n) used.push({ table, name, n });
    }
    if (used.length) {
      return fail(res, `该工序已被引用（${used.map(u => `${u.name} ${u.n}`).join("、")}），不能删除。建议把它停用`);
    }
    await query("DELETE FROM cfg_process WHERE id=$1", [rid]);
    await audit(req.mesrjUser.login_name, "基础配置", "删除工序", row.process_code, "", req.ip);
    return ok(res, null, "已删除");
  });

  // 班次与有效工时（源 /cfg/basic/shift 系列）
  router.get("/cfg/basic/shift", async (req, res) => {
    const rows = (await query("SELECT * FROM md_shift ORDER BY shift_code")).rows;
    const hours = {
      DAY: await getParam("plan.hours_day", "10"),
      NIGHT: await getParam("plan.hours_night", "10"),
    };
    for (const r of rows) r.work_hours = hours[r.shift_code] ?? hours.DAY;
    return ok(res, {
      rows, hours,
      note: "有效工时 = 扣掉休息等后的实际工作时间；排产计划量 = 标准 UPH × 有效工时",
    });
  });

  router.post("/cfg/basic/shift/save", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    for (const r of rows) {
      const code = (r.shift_code || "").trim().toUpperCase();
      if (!code) continue;
      const old = (await query("SELECT * FROM md_shift WHERE shift_code=$1", [code])).rows[0];
      if (old) {
        await query(
          "UPDATE md_shift SET shift_name=$1, begin_time=$2, end_time=$3, cross_day=$4 WHERE shift_code=$5",
          [r.shift_name || old.shift_name, r.begin_time || old.begin_time,
           r.end_time || old.end_time, r.cross_day ? 1 : 0, code]);
      } else {
        await query(
          "INSERT INTO md_shift (shift_code, shift_name, begin_time, end_time, cross_day, status) VALUES ($1,$2,$3,$4,$5,1)",
          [code, r.shift_name || code, r.begin_time || "08:00", r.end_time || "20:00", r.cross_day ? 1 : 0]);
      }
      if (r.work_hours !== null && r.work_hours !== undefined && r.work_hours !== "") {
        const hv = Number(r.work_hours);
        if (Number.isFinite(hv)) {
          await setParam(`plan.hours_${code.toLowerCase()}`, String(hv),
            `${r.shift_name || code}有效工时`, "计划");
        }
      }
    }
    await audit(req.mesrjUser.login_name, "基础配置", "改班次工时",
      `${rows.length} 条记录`, JSON.stringify(rows).slice(0, 200), req.ip);
    return ok(res, null, "已保存");
  });

  // 关键参数（源 /cfg/basic/params 系列：只暴露排产/报工/装箱相关）
  router.get("/cfg/basic/params", async (req, res) => {
    const groups = [];
    const index = {};
    for (const d of PARAM_DEFS) {
      const it = { ...d, value: await getParam(d.key, d.default ?? "") };
      if (!index[d.group]) {
        index[d.group] = { group: d.group, items: [] };
        groups.push(index[d.group]);
      }
      index[d.group].items.push(it);
    }
    return ok(res, { groups });
  });

  router.post("/cfg/basic/params/save", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const meta = Object.fromEntries(PARAM_DEFS.map(p => [p.key, p]));
    const changed = [];
    for (const it of items) {
      const k = (it.key || "").trim();
      if (!meta[k]) continue; // 只允许修改这里列出过的键
      let v = it.value ?? "";
      v = String(v);
      if (meta[k].type === "bool") v = ["1", "true", "True", "on"].includes(v) ? "1" : "0";
      await setParam(k, v, meta[k].name, meta[k].group);
      changed.push(`${k}=${v}`);
    }
    await audit(req.mesrjUser.login_name, "基础配置", "改关键参数",
      `${changed.length} 项`, changed.join("；").slice(0, 300), req.ip);
    return ok(res, null, `已保存 ${changed.length} 项`);
  });

  // ═══ 通用 CRUD（源 _crud.register；固定路径已全部注册完，通配放最后）═══════

  const mdCrud = Router();
  registerCrud(mdCrud, MD_RES, "md.view", "md.edit");
  router.use("/md", mdCrud);

  const sysCrud = Router();
  registerCrud(sysCrud, SYS_RES, "sys.user.view", "sys.user.edit");
  router.use("/sys", sysCrud);

  return router;
}

export { ok, fail, getParam, setParam, audit, hashPwd, verifyPwd, currentUser, hasPerm, requireMesrjPerm, tableColumns, Res, cleanRow, safeOrder, cleanPageArgs, paged, registerCrud, MD_RES, SYS_RES };
