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
import express, { Router } from "express";
import { query } from "../db.js";
import { MENU } from "../mesrj/menu.js";
import { PARAM_DEFS } from "../mesrj/param-defs.js";
import {
  SEGS, SEG_ORDER, SEG_LABEL, PROC_OF_SEG, SEG_OF_PROC, AUX_SEG,
  ISSUE_GROUP, ISSUE_LABEL, ISSUE_ORDER,
  issueGroup, issueLabel, issueRank, segNormalize, segRank, segLabel, segEn,
  PROC_NAME, SEG_TO_PROC, SEG_TO_WO, SEG_TO_SFG, SFG_MAIN_SEG, SFG_ORDER, PROC_SEGMENTS,
  vnMapping, vnAttach,
  pickLine, templateProcess, modelProcess, modelProcessLive, modelProcessSegments,
  applyStationRetest, normalizeSteps, putGroupRoute, writeMembers, lockGroup,
  groupKeyOf, modelSlug, nowStr, todayStr, ymNow,
  etaCompute,
  latestBomVersion, allSfg, moNoAll, peekNextSeq, nextMoSeq, previewCreate, previewMoNos,
  outputOf, productRouteMap, lockMoRouteSteps, lockMoRoute, snapshotRoute, isSampling,
  lineBusyMo, createMoAll,
  mergeRows, aggBomItems, aggBomBySeg, writeIssueItems, nextIssueBase, createIssueForMo,
  segMapForMo, backfillIssueSegments,
  decorateMo, decorateItemVn, checkPo, buildIssueDoc,
} from "../mesrj/domain.js";

/** 源 util.ok(data, msg) */
function ok(res, data = null, msg = "") {
  res.json({ success: true, msg: msg || "", data: data ?? null });
}
/** 源 util.fail(msg, code) */
function fail(res, msg, code = 400) {  res.status(code).json({ success: false, msg, data: null });
}

// ── 参数读写（源 util.get_param / set_param）────────────────────────────────

async function getParam(key, dflt = "") {
  const r = await query("SELECT param_val FROM sys_param WHERE param_key=$1", [key]);
  return r.rows[0] && r.rows[0].param_val != null ? r.rows[0].param_val : dflt;
}

/** Date → "YYYY-MM-DD HH:MM:SS"（源 util.now_str 同格式，用于 ETA 展示） */
function fmtTs(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
    // 行装饰（源 decorate：列表行补型号/越南码/ETA 等派生列）
    decorate: opts.decorate || null,
    // 额外过滤（源 extra_filters：col -> 带占位 $n 的 SQL 片段，f_<col> 触发）
    extraFilters: opts.extra_filters || null,
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
      } else if (r.extraFilters && r.extraFilters[col]) {
        // 源 extra_filters：片段里可含多个 $N（同一参数值复用同一 $n）
        args.push(v);
        where.push(r.extraFilters[col].replace(/\$N/g, () => `$${args.length}`));
      }
    }
    const w = where.join(" AND ");
    const order = await safeOrder(r, req.query.order || "");
    try {
      const rows = await paged(
        `SELECT COUNT(*)::int AS n FROM ${r.table} WHERE ${w}`,
        `SELECT * FROM ${r.table} WHERE ${w} ORDER BY ${order}`,
        args, page, size);
      if (r.decorate) rows.rows = await r.decorate(rows.rows);
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

// ── W4 资源清单（源 bom.py / order.py / plan.py RES）─────────────────────────

const BOM_RES = {
  header: Res("bom_header", "", "BOM 版本", {
    search: ["product_code", "version", "cust_code"],
    filters: ["status", "product_code"],
    required: ["product_code", "version"],
    order: "product_code, version DESC",
  }),
  item: Res("bom_item", "", "BOM 明细", {
    search: ["product_code", "material_code", "material_name", "pos_ref"],
    filters: ["product_code", "version", "segment", "wo_type", "is_alt"],
    required: ["product_code", "material_code"],
    order: "product_code, segment, material_code",
    decorate: decorateItemVn,
    // 按机型过滤：成品机型 + 该机型半成品展开的 BOM 都算
    extra_filters: {
      model: `product_code IN (
        SELECT product_code FROM md_product WHERE COALESCE(product_model,'')=$N
        UNION
        SELECT b.material_code FROM bom_item b
          JOIN md_product p ON p.product_code=b.product_code
         WHERE COALESCE(p.product_model,'')=$N AND b.item_type='SFG')`,
    },
  }),
};

const ORD_RES = {
  po: Res("ord_po", "", "客户 PO", {
    search: ["po_no", "cust_code", "product_code"],
    filters: ["status", "cust_code"],
    required: ["po_no", "product_code", "order_qty"],
    order: "id DESC",
    check: checkPo,
  }),
  mo: Res("ord_mo", "mo_no", "生产工单", {
    search: ["mo_no", "po_no", "product_code", "fg_code"],
    filters: ["status", "process_code", "type_code", "wo_type", "line_code", "po_no",
      "product_code", "fg_code"],
    required: ["mo_no", "product_code"],
    // 单号与工头由系统生成；编辑时只能改数量、产线、日期（保证追溯对得上）
    immutable: ["mo_no", "yy", "mm", "type_code", "seq_no", "process_code", "wo_type",
      "product_code", "cust_code", "po_no", "po_line"],
    decorate: decorateMo,
    order: "id DESC",
  }),
  replenish: Res("ord_replenish", "rep_no", "补料单", {
    search: ["rep_no", "mo_no", "material_code"],
    filters: ["status", "reason"],
    required: ["mo_no", "material_code"],
    order: "id DESC",
  }),
  issueitem: Res("ord_issue_item", "issue_no", "领料明细", {
    search: ["issue_no", "material_code", "material_name"],
    filters: ["issue_no"],
    order: "issue_no, line_seq",
  }),
};

const PLAN_RES = {
  schedule: Res("pln_schedule", "", "排产计划", {
    search: ["mo_no", "line_code"],
    filters: ["plan_date", "line_code", "shift_code", "status"],
    required: ["plan_date", "line_code", "mo_no"],
    order: "plan_date DESC, line_code, seq_no",
  }),
  capacity: Res("pln_capacity", "", "产线产能", {
    search: ["line_code"],
    filters: ["line_code", "shift_code", "status"],
    required: ["line_code"],
    order: "line_code, shift_code",
  }),
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

  // ═══ W4 bom 域（源 api/bom.py）══════════════════════════════════════════

  // 某产品的 BOM（取最新有效版）
  router.get("/bom/product/:code", async (req, res) => {
    let ver = (req.query.version || "").toString().trim();
    if (!ver) {
      const r = await query(
        "SELECT version FROM bom_header WHERE product_code=$1 ORDER BY version DESC LIMIT 1",
        [req.params.code]);
      ver = r.rows[0]?.version ?? "";
    }
    if (!ver) return ok(res, { version: "", items: [], summary: {} });
    const rows = (await query(
      "SELECT * FROM bom_item WHERE product_code=$1 AND version=$2 ORDER BY segment, material_code",
      [req.params.code, ver])).rows;
    const sm = {};
    for (const r of rows) {
      const k = r.segment || "未分段";
      sm[k] = (sm[k] ?? 0) + 1;
    }
    return ok(res, { product_code: req.params.code, version: ver, items: rows, summary: sm });
  });

  // 版本列表（下拉用）
  router.get("/bom/versions", async (req, res) => {
    const pc = (req.query.product_code || "").toString().trim();
    const rows = pc
      ? (await query(
        "SELECT * FROM bom_header WHERE product_code=$1 ORDER BY version DESC", [pc])).rows
      : (await query("SELECT * FROM bom_header ORDER BY product_code, version DESC")).rows;
    return ok(res, rows);
  });

  // 保存 BOM 明细（前端解析好 JSON 提交；源 /bom/import）
  router.post("/bom/import", requireMesrjPerm("bom.import"), async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return fail(res, "没有要导入的数据");
    let okN = 0;
    const failRows = [];
    const heads = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const pc = String(r.product_code || "").trim();
      const mc = String(r.material_code || "").trim();
      if (!pc || !mc) { failRows.push({ row: i + 1, msg: "缺产品料号或物料料号" }); continue; }
      const ver = String(r.version || "V1.0").trim();
      const seg = String(r.segment || "").trim();
      heads.add(`${pc}|${ver}|${String(r.cust_code || "")}`);
      try {
        const ex = await query(
          "SELECT id FROM bom_item WHERE product_code=$1 AND version=$2 AND material_code=$3 AND pos_ref=$4",
          [pc, ver, mc, String(r.pos_ref || "")]);
        // 物料主数据里已是半成品 → 该行归半成品（免维护 item_type）
        const sfgHit = await query(
          "SELECT 1 AS x FROM md_product WHERE product_code=$1 AND product_type='SFG'", [mc]);
        const itemType = (sfgHit.rows[0] || String(r.item_type || "").toUpperCase() === "SFG") ? "SFG" : "RM";
        const data = {
          item_type: itemType, product_code: pc, version: ver, material_code: mc,
          material_name: r.material_name ?? "", spec: r.spec ?? "",
          unit: r.unit || "PCS", qty_per: Number(r.qty_per || 0),
          segment: seg, wo_type: SEG_TO_WO[seg] ?? (r.wo_type ?? ""),
          pos_ref: r.pos_ref ?? "",
          is_alt: ["1", "是", "True", "true"].includes(String(r.is_alt)) ? 1 : 0,
          alt_group: r.alt_group ?? "",
          mpq: Math.trunc(Number(r.mpq || 1)), loss_rate: Number(r.loss_rate || 0),
        };
        const cols = Object.keys(data);
        if (ex.rows[0]) {
          const sets = cols.map((c, k) => `${c}=$${k + 1}`).join(",");
          await query(`UPDATE bom_item SET ${sets} WHERE id=$${cols.length + 1}`,
            [...cols.map(c => data[c]), ex.rows[0].id]);
        } else {
          const ph = cols.map((_, k) => `$${k + 1}`).join(",");
          await query(`INSERT INTO bom_item (${cols.join(",")}) VALUES (${ph})`,
            cols.map(c => data[c]));
        }
        okN++;
      } catch (ex2) {
        failRows.push({ row: i + 1, msg: ex2.message });
      }
    }
    for (const h of heads) {
      const [pc, ver, cust] = h.split("|");
      const hh = await query("SELECT id FROM bom_header WHERE product_code=$1 AND version=$2", [pc, ver]);
      if (!hh.rows[0]) {
        await query(
          `INSERT INTO bom_header (product_code, version, cust_code, eff_date, status, src_file)
           VALUES ($1,$2,$3,$4,'有效','前台导入')`, [pc, ver, cust, todayStr()]);
      }
      const pp = await query("SELECT id FROM md_product WHERE product_code=$1", [pc]);
      if (!pp.rows[0]) {
        await query(
          `INSERT INTO md_product (product_code, product_name, product_model, cust_code, unit, status, product_type, remark, created_at)
           VALUES ($1,$1,$1,$2,'PCS',1,'FG','由 BOM 自动创建',$3)`, [pc, cust, nowStr()]);
      }
    }
    await audit(req.mesrjUser.login_name, "BOM", "导入", "bom_item",
      `成功 ${okN} 行，失败 ${failRows.length} 行`, req.ip);
    return ok(res, { ok: okN, fail: failRows },
      `导入完成：成功 ${okN} 行，失败 ${failRows.length} 行`);
  });

  // 上传 .xlsx 直接导入（服务端解析；源 /bom/upload，openpyxl → SheetJS）
  router.post("/bom/upload", requireMesrjPerm("bom.import"),
    express.raw({ type: () => true, limit: "20mb" }), async (req, res) => {
      const ctype = req.headers["content-type"] || "";
      if (!/multipart|octet-stream/.test(ctype)) return fail(res, "请以文件上传（multipart）提交");
      const XLSX = await import("xlsx");
      let rows2d;
      try {
        const wb = XLSX.read(req.body, { type: "buffer", raw: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows2d = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      } catch (ex) {
        return fail(res, `读取 Excel 失败：${ex.message}`);
      }
      const HDRS = ["产品料号", "产品型号", "客户", "BOM版本", "分段", "物料料号", "物料名称",
        "物料型号", "单位", "单位用量", "最小包装单位", "位号", "是否替代料", "替代组"];
      let hdrI = -1;
      for (let i = 0; i < rows2d.length; i++) {
        const row = rows2d[i] || [];
        if (row.some(c => c !== null && String(c).trim() === "产品料号")) { hdrI = i; break; }
      }
      if (hdrI < 0) return fail(res, "找不到表头行（必须含「产品料号」列）");
      const hdr = (rows2d[hdrI] || []).map(c => c === null ? "" : String(c).trim());
      const col = n => hdr.indexOf(n);
      const idx = Object.fromEntries(HDRS.map(n => [n, col(n)]));
      const g = (row, n) => {
        const i = idx[n];
        if (i < 0 || i >= row.length || row[i] === null) return "";
        return String(row[i]).trim();
      };
      const out = [];
      for (const row of rows2d.slice(hdrI + 1)) {
        if (!row || !row.length) continue;
        if (!g(row, "产品料号") || !g(row, "物料料号")) continue;
        out.push({
          product_code: g(row, "产品料号"), version: g(row, "BOM版本") || "V1.0",
          cust_code: g(row, "客户"), segment: g(row, "分段"),
          material_code: g(row, "物料料号"), material_name: g(row, "物料名称"),
          spec: g(row, "物料型号"), unit: g(row, "单位") || "PCS",
          qty_per: g(row, "单位用量"), mpq: g(row, "最小包装单位") || 1,
          pos_ref: g(row, "位号"), is_alt: g(row, "是否替代料"), alt_group: g(row, "替代组"),
        });
      }
      if (!out.length) return fail(res, "没有解析到有效数据行");
      return ok(res, { rows: out, count: out.length }, `已解析 ${out.length} 行，确认后点「确认导入」`);
    });

  // 段用量统计（对账用）
  router.get("/bom/segment-summary", async (req, res) => {
    const pc = (req.query.product_code || "").toString().trim();
    const where = pc ? "WHERE product_code=$1" : "";
    const args = pc ? [pc] : [];
    const rows = (await query(
      `SELECT product_code, segment, COUNT(*)::int AS cnt,
              SUM(CASE WHEN is_alt=1 THEN 1 ELSE 0 END)::int AS alt_cnt
       FROM bom_item ${where} GROUP BY product_code, segment ORDER BY product_code, segment`,
      args)).rows;
    return ok(res, rows);
  });

  // 层级 BOM 树（成品 → 半成品 → 原料；源 _tree_node）
  router.get("/bom/tree", async (req, res) => {
    const pc = (req.query.product_code || "").toString().trim();
    if (!pc) return fail(res, "缺产品料号");
    const latestVer = async code =>
      (await query("SELECT version FROM bom_header WHERE product_code=$1 ORDER BY version DESC LIMIT 1",
        [code])).rows[0]?.version ?? "";
    const product = async code =>
      (await query("SELECT * FROM md_product WHERE product_code=$1", [code])).rows[0] ?? {};
    const buildNode = async (code, version, depth, seen) => {
      const p = await product(code);
      const ver = version || await latestVer(code);
      const node = {
        code, name: p.product_name || code, model: p.product_model || "",
        type: p.product_type || (depth === 0 ? "FG" : "SFG"),
        version: ver, level: depth, children: [], material_groups: [],
        count: 0, is_cycle: false,
      };
      if (!ver) return node;
      if (seen.has(code) || depth > 6) { node.is_cycle = true; return node; }
      const items = (await query(
        `SELECT * FROM bom_item WHERE product_code=$1 AND version=$2
         ORDER BY CASE COALESCE(item_type,'RM') WHEN 'SFG' THEN 0 ELSE 1 END, segment, material_code`,
        [code, ver])).rows;
      node.count = items.length;
      const groups = new Map();
      const children = [];
      for (const it of items) {
        if ((it.item_type || "RM") === "SFG") {
          const child = await buildNode(it.material_code, "", depth + 1, new Set([...seen, code]));
          child.qty_per = it.qty_per;
          child.via_segment = it.segment;
          child.via_wo = it.wo_type;
          child.row_id = it.id;
          children.push(child);
        } else {
          const k = it.segment || "未分段";
          let grp = groups.get(k);
          if (!grp) { grp = { segment: k, wo_type: it.wo_type || "", items: [], count: 0 }; groups.set(k, grp); }
          grp.items.push({
            material_code: it.material_code, material_name: it.material_name,
            spec: it.spec, qty_per: it.qty_per, unit: it.unit, pos_ref: it.pos_ref,
          });
          grp.count++;
        }
      }
      children.sort((a, b) => {
        const ia = SFG_ORDER.indexOf(a.via_wo || ""), ib = SFG_ORDER.indexOf(b.via_wo || "");
        return ((ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)) || ((a.row_id || 0) - (b.row_id || 0));
      });
      node.children = children;
      node.material_groups = [...groups.values()];
      return node;
    };
    const root = await buildNode(pc, (req.query.version || "").toString().trim(), 0, new Set());
    const acc = { sfg: 0, rm: 0, levels: 1 };
    const walk = n => {
      acc.sfg += n.type === "SFG" ? 1 : 0;
      acc.rm += (n.material_groups || []).reduce((a, g) => a + g.count, 0);
      acc.levels = Math.max(acc.levels, (n.level || 0) + 1);
      for (const c of n.children || []) walk(c);
    };
    walk(root);
    return ok(res, { root, summary: acc });
  });

  // 半成品归集建议（只算不写；源 /bom/sfg-suggest）
  router.get("/bom/sfg-suggest", async (req, res) => {
    const pc = (req.query.product_code || "").toString().trim();
    const ver = (req.query.version || "").toString().trim() || await latestBomVersion(pc);
    if (!pc || !ver) return fail(res, "缺产品料号或 BOM 版本");
    const p = (await query("SELECT * FROM md_product WHERE product_code=$1", [pc])).rows[0] ?? {};
    const model = p.product_model || p.product_name || pc;
    const items = (await query(
      "SELECT * FROM bom_item WHERE product_code=$1 AND version=$2", [pc, ver])).rows;
    const groups = new Map(), haveSfg = {};
    for (const it of items) {
      if ((it.item_type || "RM") === "SFG") { haveSfg[it.material_code] = it; continue; }
      const grp = SEG_TO_SFG[it.segment || ""];
      if (!grp) continue;
      let g = groups.get(grp);
      if (!g) {
        g = { group: grp, segments: [], count: 0, qty: 0,
              suggest_code: `${pc}-${grp}`, suggest_name: `${model}-${grp}半成品` };
        groups.set(grp, g);
      }
      if (!g.segments.includes(it.segment)) g.segments.push(it.segment);
      g.count++;
      g.qty += Number(it.qty_per || 0);
    }
    const rows = [];
    for (const grp of SFG_ORDER) {
      if (!groups.has(grp)) continue;
      const g = groups.get(grp);
      const exist = (await query(
        "SELECT product_code FROM md_product WHERE product_type='SFG' AND product_code LIKE $1 ORDER BY id LIMIT 1",
        [`%${grp}%`])).rows[0];
      g.existing = exist?.product_code ?? "";
      const already = Object.values(haveSfg).filter(c => (c.wo_type || "") === grp);
      g.in_bom = already[0]?.material_code ?? "";
      rows.push(g);
    }
    return ok(res, {
      product_code: pc, version: ver, model, rows,
      untouched: items
        .filter(it => (it.item_type || "RM") === "RM" && !SEG_TO_SFG[it.segment || ""])
        .map(it => ({ segment: it.segment, material_code: it.material_code, material_name: it.material_name })),
    });
  });

  // 半成品归集执行（把平铺原料按段归到半成品下；源 /bom/sfg-apply）
  router.post("/bom/sfg-apply", requireMesrjPerm("bom.edit"), async (req, res) => {
    const d = req.body || {};
    const pc = (d.product_code || "").trim();
    const ver = (d.version || "").trim();
    const groups = Array.isArray(d.groups) ? d.groups : [];
    if (!pc || !ver || !groups.length) return fail(res, "缺产品料号、版本或分组");
    const product = async code =>
      (await query("SELECT * FROM md_product WHERE product_code=$1", [code])).rows[0] ?? null;
    const pSelf = await product(pc);
    if (pSelf?.product_type === "SFG") return fail(res, "半成品不能再做归集");
    const done = [], errs = [];
    for (const gj of groups) {
      const grp = (gj.group || "").trim();
      const code = (gj.sfg_code || "").trim();
      const name = (gj.sfg_name || "").trim() || code;
      const segs = Object.entries(SEG_TO_SFG).filter(([, v]) => v === grp).map(([k]) => k);
      if (!grp || !code || !segs.length) { errs.push({ group: grp, msg: "半成品料号为空" }); continue; }
      const old = await product(code);
      if (old && (old.product_type || "FG") !== "SFG") {
        errs.push({ group: grp, msg: `料号 ${code} 不是半成品，不能当半成品用` });
        continue;
      }
      const ph = segs.map((_, i) => `$${i + 3}`).join(",");
      const rows = (await query(
        `SELECT * FROM bom_item WHERE product_code=$1 AND version=$2
         AND COALESCE(item_type,'RM')='RM' AND segment IN (${ph})`, [pc, ver, ...segs])).rows;
      if (!rows.length) { errs.push({ group: grp, msg: "该工序段没有待归集的原料" }); continue; }
      if (!old) {
        await query(
          `INSERT INTO md_product
           (product_code, product_name, product_model, cust_code, unit, status, product_type, remark, created_at)
           VALUES ($1,$2,$3,'','PCS',1,'SFG',$4,$5)`,
          [code, name, gj.sfg_model || name, `由 ${pc} 的 BOM 归集生成`, nowStr()]);
      }
      const hh = await query("SELECT id FROM bom_header WHERE product_code=$1 AND version=$2", [code, ver]);
      if (!hh.rows[0]) {
        await query(
          `INSERT INTO bom_header (product_code, version, cust_code, eff_date, status, src_file, remark)
           VALUES ($1,$2,'',$3,'有效',$4,$5)`,
          [code, ver, todayStr(), `由 ${pc} ${ver} 归集`, `由 ${pc} 的 BOM 归集`]);
      }
      for (const it of rows) {
        const ex = await query(
          `SELECT id FROM bom_item WHERE product_code=$1 AND version=$2 AND material_code=$3 AND COALESCE(pos_ref,'')=$4`,
          [code, ver, it.material_code, it.pos_ref || ""]);
        const data = {
          material_code: it.material_code, material_name: it.material_name, spec: it.spec,
          unit: it.unit, qty_per: it.qty_per, segment: it.segment, wo_type: it.wo_type,
          pos_ref: it.pos_ref, is_alt: it.is_alt, alt_group: it.alt_group,
          mpq: it.mpq, loss_rate: it.loss_rate, remark: it.remark,
          product_code: code, version: ver, item_type: "RM",
        };
        const cols = Object.keys(data);
        if (ex.rows[0]) {
          const sets = cols.map((c, k) => `${c}=$${k + 1}`).join(",");
          await query(`UPDATE bom_item SET ${sets} WHERE id=$${cols.length + 1}`,
            [...cols.map(c => data[c]), ex.rows[0].id]);
        } else {
          const ph2 = cols.map((_, k) => `$${k + 1}`).join(",");
          await query(`INSERT INTO bom_item (${cols.join(",")}) VALUES (${ph2})`, cols.map(c => data[c]));
        }
        await query("DELETE FROM bom_item WHERE id=$1", [it.id]);
      }
      await query(
        `INSERT INTO bom_item
         (product_code, version, material_code, material_name, spec, unit, qty_per, segment, wo_type,
          pos_ref, is_alt, alt_group, mpq, loss_rate, item_type)
         VALUES ($1,$2,$3,$4,'','PCS',1,$5,$6,'',0,'',1,0,'SFG')`,
        [pc, ver, code, name, SFG_MAIN_SEG[grp] ?? "", grp]);
      done.push({ group: grp, sfg_code: code, moved: rows.length });
      await audit(req.mesrjUser.login_name, "BOM", "归集半成品", pc,
        `${grp} → ${code}（移入 ${rows.length} 行原料）`, req.ip);
    }
    let msg = `已归集 ${done.length} 个半成品`;
    if (errs.length) msg += `；${errs.length} 组失败`;
    return ok(res, { done, errors: errs }, msg);
  });

  // ═══ W4 plan 域（源 api/plan.py）════════════════════════════════════════

  // 排产看板：排产明细 + 产线汇总
  router.get("/plan/board", async (req, res) => {
    const d1 = (req.query.d1 || todayStr()).toString().trim();
    const d2 = (req.query.d2 || todayStr()).toString().trim();
    const line = (req.query.line_code || "").toString().trim();
    const where = ["s.plan_date BETWEEN $1 AND $2"];
    const args = [d1, d2];
    if (line) { where.push(`s.line_code=$${args.length + 1}`); args.push(line); }
    const rows = (await query(
      `SELECT s.*, m.wo_type, m.product_code, m.plan_qty AS mo_qty,
              m.out_qty, m.status AS mo_status, m.po_no
       FROM pln_schedule s LEFT JOIN ord_mo m ON m.mo_no = s.mo_no
       WHERE ${where.join(" AND ")} ORDER BY s.plan_date, s.line_code, s.seq_no`, args)).rows;
    const lines = (await query(
      `SELECT line_code, line_name, tact_time, plan_hours FROM md_line
       WHERE status=1 ORDER BY line_code`)).rows;
    const stat = {};
    for (const r of rows) {
      const k = r.line_code || "未指定";
      const s = stat[k] ??= { plan_qty: 0, cnt: 0 };
      s.plan_qty += Number(r.plan_qty || 0);
      s.cnt++;
    }
    return ok(res, { rows, lines, stat, d1, d2 });
  });

  // 未排产/已排产工单（排产时选择）
  router.get("/plan/pending", async (req, res) => {
    const rows = (await query(
      `SELECT m.mo_no, m.wo_type, m.process_code, m.product_code, m.plan_qty, m.line_code,
              m.plan_start, m.plan_end, m.status, m.po_no,
              COALESCE(p.product_model, '') AS product_model
       FROM ord_mo m
       LEFT JOIN md_product p ON p.product_code = COALESCE(NULLIF(m.fg_code, ''), m.product_code)
       WHERE m.status IN ('待排产','已排产') ORDER BY m.plan_end, m.mo_no`)).rows;
    return ok(res, rows);
  });

  // 把工单排到某线某日
  router.post("/plan/add", requireMesrjPerm("plan.edit"), async (req, res) => {
    const d = req.body || {};
    const moNo = (d.mo_no || "").toString().trim();
    const line = (d.line_code || "").toString().trim();
    const date = (d.plan_date || "").toString().trim();
    if (!moNo || !line || !date) return fail(res, "工单、产线、计划日期都要填");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    if (["已完工", "已关闭", "作废"].includes(mo.status)) {
      return fail(res, `该工单状态为「${mo.status}」，不能再排产`);
    }
    const qty = Number(d.plan_qty || mo.plan_qty || 0);
    if (qty <= 0) return fail(res, "计划数量必须大于 0");
    const mx = await query(
      "SELECT MAX(seq_no) AS m FROM pln_schedule WHERE plan_date=$1 AND line_code=$2", [date, line]);
    await query(
      `INSERT INTO pln_schedule
       (plan_date, shift_code, line_code, mo_no, product_code, plan_qty, seq_no, status, remark, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'计划中',$8,$9)`,
      [date, d.shift_code || "DAY", line, moNo, mo.fg_code || mo.product_code || "", qty,
       Number(mx.rows[0]?.m ?? 0) + 1, d.remark ?? "", req.mesrjUser.login_name]);
    if (mo.status === "待排产") {
      await query(
        `UPDATE ord_mo SET status='已排产', line_code=$2, plan_start=$3, updated_at=$4 WHERE id=$1`,
        [mo.id, line, date, nowStr()]);
    }
    await audit(req.mesrjUser.login_name, "计划", "排产", moNo, `${date} / ${line} / ${qty}`, req.ip);
    return ok(res, null, "已排产");
  });

  // 排产计划状态流转
  router.post("/plan/:sid/status", requireMesrjPerm("plan.edit"), async (req, res) => {
    const st = (req.body?.status || "").toString().trim();
    if (!["计划中", "执行中", "已完成", "已取消"].includes(st)) return fail(res, "状态不合法");
    const sid = Number(req.params.sid);
    if (!sid) return fail(res, "缺 id");
    await query("UPDATE pln_schedule SET status=$1 WHERE id=$2", [st, sid]);
    return ok(res, null, "已更新");
  });

  // 产能预估（节拍法）
  router.get("/plan/capacity/suggest", async (req, res) => {
    const line = (req.query.line_code || "").toString().trim();
    const date = (req.query.plan_date || todayStr()).toString().trim();
    const ln = (await query("SELECT * FROM md_line WHERE line_code=$1", [line])).rows[0];
    if (!ln) return fail(res, "产线不存在", 404);
    const hours = Number(ln.plan_hours || 8);
    const cal = (await query(
      "SELECT is_workday FROM md_calendar WHERE cal_date=$1 AND line_code=$2", [date, line])).rows[0];
    if (cal && !Number(cal.is_workday)) {
      return ok(res, { capacity: 0, hours: 0, tact: ln.tact_time, note: "休息日或停工" });
    }
    const tact = Number(ln.tact_time || 0);
    const cap = tact > 0 ? Math.trunc(hours * 3600 / tact) : 0;
    const used = await query(
      `SELECT COALESCE(SUM(plan_qty),0) AS n FROM pln_schedule
       WHERE plan_date=$1 AND line_code=$2 AND status<>'已取消'`, [date, line]);
    const usedN = Number(used.rows[0]?.n ?? 0);
    return ok(res, { capacity: cap, used: usedN, free: Math.max(0, cap - usedN), hours, tact });
  });

  // 产能标准（UPH）列表 + 下拉项
  router.get("/plan/capmaster/list", async (req, res) => {
    const where = ["enabled=1"];
    const args = [];
    for (const k of ["line_code", "product_code", "process"]) {
      const v = (req.query[k] || "").toString().trim();
      if (v) { where.push(`${k}=$${args.length + 1}`); args.push(v); }
    }
    const kw = (req.query.keyword || "").toString().trim();
    if (kw) {
      args.push(`%${kw}%`);
      const n = args.length;
      where.push(`(product_code ILIKE $${n} OR line_code ILIKE $${n} OR process ILIKE $${n})`);
    }
    const rows = (await query(
      `SELECT * FROM cfg_capacity WHERE ${where.join(" AND ")}
       ORDER BY line_code, product_code, process`, args)).rows;
    const opts = {
      lines: (await query("SELECT DISTINCT line_code FROM cfg_capacity ORDER BY line_code")).rows
        .map(r => r.line_code),
      products: (await query("SELECT DISTINCT product_code FROM cfg_capacity ORDER BY product_code")).rows
        .map(r => r.product_code),
      processes: (await query(
        "SELECT process_code FROM cfg_process WHERE enabled=1 ORDER BY sort_no, process_code")).rows
        .map(r => r.process_code),
    };
    if (!opts.processes.length) {
      opts.processes = (await query("SELECT DISTINCT process FROM cfg_capacity ORDER BY process")).rows
        .map(r => r.process);
    }
    return ok(res, { rows, opts });
  });

  // 产能标准保存（upsert）
  router.post("/plan/capmaster/save", requireMesrjPerm("plan.edit"), async (req, res) => {
    const d = req.body || {};
    const line = (d.line_code || "").toString().trim();
    const prod = (d.product_code || "").toString().trim();
    const proc = (d.process || "").toString().trim();
    if (!(line && prod && proc)) return fail(res, "产线、产品、工序都要填");
    const uph = Number(d.uph || 0);
    const ppl = Math.trunc(Number(d.std_headcount || 0));
    const now = nowStr();
    await query(
      `INSERT INTO cfg_capacity
       (line_code, product_code, process, uph, std_headcount, enabled, remark, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$7)
       ON CONFLICT (line_code, product_code, process) DO UPDATE SET
         uph=EXCLUDED.uph, std_headcount=EXCLUDED.std_headcount,
         enabled=1, remark=EXCLUDED.remark, updated_at=EXCLUDED.updated_at`,
      [line, prod, proc, uph, ppl, d.remark || "", now]);
    await audit(req.mesrjUser.login_name, "计划", "改产能", `${line}/${prod}/${proc}`,
      `UPH=${uph} 人数=${ppl}`, req.ip);
    return ok(res, null, "已保存");
  });

  // 产能标准删除
  router.post("/plan/capmaster/delete", requireMesrjPerm("plan.edit"), async (req, res) => {
    const rid = Number(req.body?.id || 0);
    if (!rid) return fail(res, "缺 id");
    await query("DELETE FROM cfg_capacity WHERE id=$1", [rid]);
    await audit(req.mesrjUser.login_name, "计划", "删产能", String(rid), "", req.ip);
    return ok(res, null, "已删除");
  });

  // 产线负载（计划量 vs UPH 产能）
  router.get("/plan/load", async (req, res) => {
    const d1 = (req.query.d1 || todayStr()).toString().trim();
    const d2 = (req.query.d2 || d1).toString().trim();
    const line = (req.query.line_code || "").toString().trim();
    const hours = {
      DAY: Number(await getParam("plan.hours_day", "10") || 10),
      NIGHT: Number(await getParam("plan.hours_night", "10") || 10),
    };
    const where = ["p.plan_date BETWEEN $1 AND $2", "p.status<>'已取消'",
      "COALESCE(p.process,'')<>''", "COALESCE(p.product_code,'')<>''"];
    const args = [d1, d2];
    if (line) { where.push(`p.line_code=$${args.length + 1}`); args.push(line); }
    const rows = (await query(
      `SELECT p.plan_date, p.shift_code, p.product_code, p.process,
              SUM(p.plan_qty) AS qty, COUNT(*)::int AS cnt
       FROM pln_schedule p WHERE ${where.join(" AND ")}
       GROUP BY p.plan_date, p.shift_code, p.product_code, p.process
       ORDER BY p.plan_date, p.shift_code, p.product_code, p.process`, args)).rows;
    const capCache = {};
    const capOf = async (prod, proc) => {
      proc = (proc || "").trim();
      const k = `${prod}|${proc}`;
      if (k in capCache) return capCache[k];
      const exact = await query(
        `SELECT MAX(uph) AS u FROM cfg_capacity WHERE enabled=1 AND product_code=$1 AND process=$2`,
        [prod, proc]);
      let uph = Number(exact.rows[0]?.u ?? 0);
      if (!uph) {
        if (proc === "SMT") {
          const r2 = await query(
            `SELECT uph FROM cfg_capacity WHERE enabled=1 AND product_code=$1 AND process LIKE 'SMT%'`,
            [prod]);
          const vals = r2.rows.map(x => Number(x.uph)).filter(Boolean);
          uph = vals.length ? Math.min(...vals) : 0;
        } else if (proc.startsWith("插件")) {
          const r2 = await query(
            `SELECT MAX(uph) AS u FROM cfg_capacity WHERE enabled=1 AND product_code=$1 AND process='插件'`,
            [prod]);
          uph = Number(r2.rows[0]?.u ?? 0);
        }
      }
      capCache[k] = uph;
      return uph;
    };
    const out = [];
    for (const r of rows) {
      const h = hours[r.shift_code] ?? 10;
      const uph = await capOf(r.product_code, r.process);
      const cap = Math.round(uph * h);
      const qty = Number(r.qty || 0);
      out.push({
        plan_date: r.plan_date, shift_code: r.shift_code,
        shift_name: r.shift_code === "NIGHT" ? "夜班" : "白班",
        product_code: r.product_code, process: r.process,
        qty, uph, hours: h, cap,
        load: cap ? Math.round(qty * 1000 / cap) / 10 : null,
        cnt: r.cnt,
      });
    }
    // 日汇总：瓶颈段取 max（各段负载）
    const days = new Map();
    for (const r of out) {
      const d = days.get(r.plan_date) ?? { plan_date: r.plan_date, qty: 0, cap: 0, bottleneck: "", load: null };
      d.qty += r.qty;
      d.cap += r.cap;
      if (r.load !== null && (d.load === null || r.load > d.load)) {
        d.load = r.load;
        d.bottleneck = `${r.product_code} / ${r.process}`;
      }
      days.set(r.plan_date, d);
    }
    const dayList = [...days.values()].sort((a, b) => a.plan_date.localeCompare(b.plan_date));
    const loads = out.map(x => x.load).filter(x => x !== null);
    return ok(res, {
      rows: out, days: dayList, hours,
      summary: {
        qty: out.reduce((a, x) => a + x.qty, 0),
        cap: out.reduce((a, x) => a + x.cap, 0),
        load: loads.length ? Math.round(loads.reduce((a, b) => a + b, 0) / loads.length * 10) / 10 : null,
        peak: loads.length ? Math.max(...loads) : 0,
        over: loads.filter(x => x > 100).length,
        no_capacity: out.filter(x => !x.uph).length,
      },
    });
  });

  // 完工时间预估（ETA）
  router.get("/plan/mo/eta", async (req, res) => {
    const mo = (req.query.mo_no || "").toString().trim();
    const mos = mo.split(",").map(x => x.trim()).filter(Boolean);
    const data = await etaCompute(mos.length ? mos : null);
    const rows = [];
    for (const [k, v0] of Object.entries(data)) {
      const v = { mo_no: k, ...v0 };
      const d = v.done_at;
      delete v.done_at;
      v.doneAt = d ? `${fmtTs(d).slice(0, 16)}` : "";
      rows.push(v);
    }
    rows.sort((a, b) => (a.doneAt || "9999").localeCompare(b.doneAt || "9999"));
    return ok(res, { rows, now: nowStr() });
  });

  // ═══ W4 order 域（源 api/order.py）══════════════════════════════════════

  // 开单（一 PO 一张总工单）
  router.post("/order/mo/create", requireMesrjPerm("mo.create"), async (req, res) => {
    const d = req.body || {};
    const pool = !!(d.pool || d.is_pool);
    let productCode = (d.product_code || "").toString().trim();
    const typeCode = String(d.type_code || "1").trim();
    let planQty = Math.trunc(Number(d.plan_qty || 0));
    let planEnd = (d.plan_end || "").toString().trim();
    const planStart = (d.plan_start || "").toString().trim();
    const remark = (d.remark || "").toString().trim();
    const srcMoNo = (d.src_mo_no || "").toString().trim();

    let poNo = "", poLine = "1", custCode = "", po = null;
    if (d.po_id) {
      po = (await query("SELECT * FROM ord_po WHERE id=$1", [d.po_id])).rows[0];
      if (!po) return fail(res, "找不到该客户 PO");
    } else if ((d.po_no || "").toString().trim()) {
      poNo = d.po_no.trim();
      po = (await query(
        "SELECT * FROM ord_po WHERE po_no=$1 ORDER BY po_line LIMIT 1", [poNo])).rows[0];
    }
    if (po) {
      if (productCode && po.product_code && po.product_code !== productCode) {
        return fail(res, `客户 PO ${po.po_no}（${po.po_line}）的产品是 ${po.product_code}，与本单产品 ${productCode} 不一致`);
      }
      if (["已关闭", "已完工"].includes(po.status || "")) {
        return fail(res, `客户 PO ${po.po_no} 已经（${po.status}），不能再开单`);
      }
      poNo = po.po_no; poLine = po.po_line; custCode = po.cust_code || "";
      productCode = productCode || po.product_code;
      planQty = planQty || Number(po.order_qty || 0);
      planEnd = planEnd || po.delivery_date || "";
    }
    if (!productCode) return fail(res, "必选产品（产品料号）");
    const prod = await query("SELECT id FROM md_product WHERE product_code=$1", [productCode]);
    if (!prod.rows[0]) return fail(res, `找不到产品料号：${productCode}`);
    if (planQty < 0 || (planQty <= 0 && !pool)) return fail(res, "计划数量必须大于 0");
    if (pool) {
      const ex = await poolMoOf(productCode);
      if (ex) {
        return ok(res, { created: [], exists: [ex.mo_no], seq_no: 0, pool: true, mo_no: ex.mo_no },
          `产品 ${productCode} 已有常驻工单 ${ex.mo_no}（${ex.status}）——同一产品只允许一张常驻工单，直接排产即可`);
      }
    }
    if (!["1", "2", "3"].includes(typeCode)) {
      return fail(res, "工单类型不合法（1 正单 / 2 备品 / 3 返单）");
    }
    if (planStart && planEnd && planEnd < planStart) {
      return fail(res, "计划完工日期不能早于计划开始日期");
    }
    if (typeCode === "3" && srcMoNo) {
      const src = await query("SELECT id FROM ord_mo WHERE mo_no=$1", [srcMoNo]);
      if (!src.rows[0]) return fail(res, `返单引用的原工单不存在：${srcMoNo}`);
    }
    if (!poNo && typeCode === "1" && !pool) {
      return fail(res, "正单必须挂客户 PO 号（没有 PO 则备品单，否则追溯回一台都查不到）");
    }
    const { seq, created, exists } = await createMoAll({
      productCode, planQty, typeCode, batches: d.batches ?? null,
      poNo, poLine, custCode, planStart, planEnd, remark, srcMoNo,
      createdBy: req.mesrjUser.login_name, syncPlan: !!d.sync_plan,
      segLines: d.line_map || {}, routeMap: d.route_map || {},
      variant: (d.variant || "").toString().trim(), isPool: pool,
    });
    for (const e of exists || []) {
      if (typeof e === "object" && e?.error) return fail(res, e.error);
    }
    if (po && created.length) {
      await query("UPDATE ord_po SET status='已排产' WHERE id=$1", [po.id]);
    }
    await audit(req.mesrjUser.login_name, "工单", "开单", poNo,
      `${productCode} 计划${planQty}，开 ${created.length} 张`, req.ip);
    const mos = created.map(c => c.mo_no);
    let msg = mos.length ? `已开 ${created.length} 张工单：${mos.join("、")}` : "未开新单";
    if (exists.length) msg += `；${exists.length} 张已存在（跳过）`;
    return ok(res, { seq_no: seq, created, exists, mo_nos: mos, msg }, msg);
  });

  // 开单前预览（占号情况）
  router.get("/order/mo/create/preview", async (req, res) => {
    let pc = (req.query.product_code || "").toString().trim();
    let poNo = (req.query.po_no || "").toString().trim();
    if (req.query.po_id) {
      const po = (await query("SELECT * FROM ord_po WHERE id=$1", [req.query.po_id])).rows[0];
      if (po) { pc = po.product_code; poNo = po.po_no; }
    }
    let tc = (req.query.type_code || "1").toString().trim();
    if (!["1", "2", "3"].includes(tc)) tc = "1";
    return ok(res, await previewCreate(pc, tc, poNo, Number(req.query.batches || 1)));
  });

  // ── 旧「一单多段」接口：已停用（源 _legacy_blocked）──
  const legacyBlocked = (_req, res) =>
    fail(res, "已改为一 PO 一张单模式，旧分单接口已停用。请用「计划排产」里的开单（/api/order/mo/create）——一张单内部已包含各分段计划。");
  router.post("/order/mo/split", legacyBlocked);
  router.post("/order/mo/create-batch", legacyBlocked);

  // 旧预览接口（按 PO 看分段号，页面兼容保留）
  router.get("/order/mo/preview", async (req, res) => {
    const poId = req.query.po_id;
    const po = (await query("SELECT * FROM ord_po WHERE id=$1", [poId])).rows[0];
    if (!po) return fail(res, "找不到该 PO");
    const typeCode = (req.query.type_code || "1").toString().trim();
    const r = await previewCreate(po.product_code, typeCode, po.po_no, 1);
    r.po_no = po.po_no;
    r.product_code = po.product_code;
    return ok(res, r);
  });

  // 多段预览（兼容保留）
  router.get("/order/mo/preview-batch", async (req, res) => {
    const productCode = (req.query.product_code || "").toString().trim();
    let typeCode = (req.query.type_code || "1").toString().trim();
    const poNo = (req.query.po_no || "").toString().trim();
    const procs = (req.query.processes || "01,02,03,04").toString().split(",")
      .map(p => p.trim()).filter(p => p in PROC_NAME);
    if (!["1", "2", "3"].includes(typeCode)) typeCode = "1";
    return ok(res, await previewMoNos(productCode, typeCode, poNo, procs.length ? procs : ["01", "02", "03", "04"]));
  });

  // 工单状态流转
  const MO_FLOW = {
    "待排产": ["待排产", "作废"], "已排产": ["生产中", "待排产", "作废"],
    "生产中": ["已完工", "作废"], "已完工": ["已关闭"], "已关闭": [], "作废": [],
  };
  router.post("/order/mo/:id/status", requireMesrjPerm("mo.edit"), async (req, res) => {
    const to = (req.body?.status || "").toString().trim();
    const mo = (await query("SELECT * FROM ord_mo WHERE id=$1", [req.params.id])).rows[0];
    if (!mo) return fail(res, "工单不存在", 404);
    if (!(MO_FLOW[mo.status] ?? []).includes(to)) {
      return fail(res, `不能从「${mo.status}」直接变为「${to}」`);
    }
    await query("UPDATE ord_mo SET status=$1, updated_at=$2 WHERE id=$3",
      [to, nowStr(), mo.id]);
    await audit(req.mesrjUser.login_name, "工单", "改状态", mo.mo_no, `${mo.status} -> ${to}`, req.ip);
    return ok(res, null, `已变为「${to}」`);
  });

  // 开工（PDA/扫描台：待排产/已排产/待下发 → 生产中，记 actual_start）
  router.post("/order/mo/:moNo/start", requireMesrjPerm("prod.pass"), async (req, res) => {
    const moNo = req.params.moNo;
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, "工单不存在", 404);
    const cur = (mo.status || "").trim();
    if (cur === "生产中") {
      return ok(res, { mo_no: moNo, status: cur, changed: 0 }, "该工单已经在生产中");
    }
    if (["已完工", "已关闭"].includes(cur)) {
      return fail(res, `工单已${cur}，不能开工`);
    }
    const force = !!req.body?.force;
    if (!force) {
      const busy = await lineBusyMo(moNo);
      if (busy) {
        return ok(res, {
          need_confirm: true, busy_mo: busy.mo_no, busy_product: busy.product_code || "",
          line_code: busy.line_code,
          msg: `${busy.line_code} 正在生产 ${busy.mo_no}（产品 ${busy.product_code || ""}），确认要切换产线生产吗？`,
        }, "该产线已有生产中的工单");
      }
    }
    const upd = { status: "生产中", updated_at: nowStr() };
    let actualStart = mo.actual_start || "";
    if (!(mo.actual_start || "")) {
      upd.actual_start = nowStr();
      actualStart = upd.actual_start;
    }
    await query("UPDATE ord_mo SET status=$1, updated_at=$2, actual_start=$3 WHERE mo_no=$4",
      [upd.status, upd.updated_at, mo.actual_start || nowStr(), moNo]);
    await audit(req.mesrjUser.login_name, "工单", "开工", moNo, `${cur} -> 生产中`, req.ip);
    return ok(res, { mo_no: moNo, status: "生产中", changed: 1, actual_start: actualStart },
      `${moNo} 已开工`);
  });

  // PDA 开工选择清单（含拼板信息；源 /order/mo/options）
  router.get("/order/mo/options", async (req, res) => {
    const rs = await query(`
      SELECT m.mo_no, m.product_code, m.fg_code, m.line_code, m.plan_qty,
             m.status, m.actual_start, m.process_code,
             COALESCE(p.product_model, '') AS product_model,
             COALESCE(p.product_name, '')  AS product_name,
             COALESCE(l.model, '')         AS panel_model,
             COALESCE(l.total, 0)          AS panel_total,
             (SELECT COUNT(DISTINCT x.sn) FROM prd_pass x
               WHERE x.mo_no = m.mo_no AND x.result = 'OK'
                 AND x.station_code LIKE '%SMT-AOI%') AS done_qty
      FROM ord_mo m
      LEFT JOIN md_product p ON p.product_code = m.fg_code
      LEFT JOIN cfg_panel_layout l
             ON l.enabled = 1 AND l.product_code = m.fg_code
            AND l.id = (SELECT MAX(id) FROM cfg_panel_layout
                        WHERE enabled = 1 AND product_code = m.fg_code)
      WHERE m.status IN ('待排产','已排产','待下发','生产中')
      ORDER BY CASE WHEN m.status = '生产中' THEN 0 ELSE 1 END,
               COALESCE(NULLIF(m.actual_start,''), m.created_at) DESC,
               m.mo_no DESC
      LIMIT 200`);
    return ok(res, { rows: rs.rows });
  });

  // 生成领料单（分段总工单 → 按段拆 N 张）
  router.post("/order/issue/generate", requireMesrjPerm("issue.create"), async (req, res) => {
    const d = req.body || {};
    const r = await createIssueForMo((d.mo_no || "").toString().trim(),
      req.mesrjUser.login_name, !!d.force, d.qty ?? null);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.data, r.msg);
  });

  // 领料单打印（xlsx 下载；模板布局按源 issue_doc.py 重建）
  router.get("/order/issue/:issueNo/doc", async (req, res) => {
    try {
      const [buf, fname] = await buildIssueDoc(req.params.issueNo);
      res.setHeader("Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition",
        `attachment; filename="${encodeURIComponent(fname)}"`);
      return res.send(buf);
    } catch (ex) {
      return fail(res, ex.message);
    }
  });

  // 换料/改料（替代料换算；源 /order/issue/item/substitute）
  router.post("/order/issue/item/substitute", requireMesrjPerm("issue.create"), async (req, res) => {
    const d = req.body || {};
    const itemId = Number(d.item_id || 0);
    const target = (d.material_code || "").toString().trim();
    const reason = (d.reason || "").toString().trim();
    if (!itemId || !target) return fail(res, "缺明细行或目标料号");
    const it = (await query("SELECT * FROM ord_issue_item WHERE id=$1", [itemId])).rows[0];
    if (!it) return fail(res, "领料明细不存在", 404);
    const iv = (await query("SELECT * FROM ord_issue WHERE issue_no=$1", [it.issue_no])).rows[0];
    if (!iv) return fail(res, "领料单不存在", 404);
    if (iv.status === "已发料") {
      return fail(res, "已确认的领料单，不能再改料号（要改先撤回/作废）");
    }
    if (iv.status === "作废") return fail(res, "领料单已作废");
    const mainCode = it.main_code || it.material_code;
    const alts = (it.alt_list || "").split("，").filter(Boolean);
    if (target !== mainCode && !alts.includes(target)) {
      return fail(res, `料号 ${target} 不在该行的替代料清单里`);
    }
    // 取目标料号的单位用量（替代料用量可能不同）
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [iv.mo_no])).rows[0];
    const ver = mo ? await latestBomVersion(mo.product_code) : "";
    let qtyPer = Number(it.qty_per || 0);
    if (target !== mainCode && ver && mo) {
      const row = (await query(
        `SELECT qty_per FROM bom_item WHERE product_code=$1 AND version=$2 AND material_code=$3 LIMIT 1`,
        [mo.product_code, ver, target])).rows[0];
      if (row && row.qty_per) qtyPer = Number(row.qty_per);
    }
    const need = mo ? qtyPer * Number(mo.plan_qty || 0) : Number(it.need_qty || 0);
    const mpq = Math.trunc(Number(it.mpq || 1));
    const issueQty = ["KG", "L", "M", "G"].includes(it.unit)
      ? Math.round(need * 1e4) / 1e4
      : (mpq ? Math.ceil(need / mpq) * mpq : Math.round(need));
    await query(
      `UPDATE ord_issue_item SET material_code=$1, is_substitute=$2, qty_per=$3,
       need_qty=$4, issue_qty=$5 WHERE id=$6`,
      [target, target === mainCode ? 0 : 1, Math.round(qtyPer * 1e6) / 1e6,
       Math.round(need * 1e4) / 1e4, issueQty, itemId]);
    await audit(req.mesrjUser.login_name, "领料",
      target !== mainCode ? "改用替代料" : "换回主料",
      it.issue_no, `${it.material_code} → ${target}（${reason || "未填原因"}）`, req.ip);
    return ok(res, { material_code: target, need_qty: Math.round(need * 1e4) / 1e4, issue_qty: issueQty },
      `已改为： ${target}`);
  });

  // 确认发料
  router.post("/order/issue/:issueNo/confirm", requireMesrjPerm("issue.confirm"), async (req, res) => {
    const issueNo = req.params.issueNo;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const iv = (await query("SELECT * FROM ord_issue WHERE issue_no=$1", [issueNo])).rows[0];
    if (!iv) return fail(res, "领料单不存在", 404);
    if (iv.status === "已发料") return fail(res, "该领料单已确认发料");
    for (const it of items) {
      if (it?.id) {
        await query("UPDATE ord_issue_item SET issue_qty=$1 WHERE id=$2 AND issue_no=$3",
          [it.issue_qty ?? 0, it.id, issueNo]);
      }
    }
    await query(
      "UPDATE ord_issue SET status='已发料', issue_by=$2, issue_time=$3 WHERE issue_no=$1",
      [issueNo, req.mesrjUser.emp_name, nowStr()]);
    await audit(req.mesrjUser.login_name, "领料", "确认发料", issueNo, "", req.ip);
    return ok(res, null, "已确认发料");
  });

  // 领料单详情（明细带越南码 + 工单头；段列缺失时按 BOM 回填）
  router.get("/order/issue/:issueNo/detail", async (req, res) => {
    const issueNo = req.params.issueNo;
    const iv = (await query("SELECT * FROM ord_issue WHERE issue_no=$1", [issueNo])).rows[0];
    if (!iv) return fail(res, "领料单不存在", 404);
    const mo = (await query(
      `SELECT mo_no, wo_type, product_code, fg_code, output_codes, process_code,
              plan_qty, line_code, status FROM ord_mo WHERE mo_no=$1`, [iv.mo_no])).rows[0];
    if (mo) await backfillIssueSegments(issueNo, mo);
    const items = await vnAttach(
      (await query("SELECT * FROM ord_issue_item WHERE issue_no=$1 ORDER BY line_seq", [issueNo])).rows);
    return ok(res, { ...iv, items, mo });
  });

  // 领料单列表（分页）
  router.get("/order/issue/list", async (req, res) => {
    const [page, size] = cleanPageArgs(req.query);
    const kw = (req.query.keyword || "").toString().trim();
    const where = ["1=1"], args = [];
    if (kw) {
      args.push(`%${kw}%`);
      const n = args.length;
      where.push(`(issue_no ILIKE $${n} OR mo_no ILIKE $${n})`);
    }
    const st = (req.query.f_status || "").toString().trim();
    if (st) { args.push(st); where.push(`status=$${args.length}`); }
    const w = where.join(" AND ");
    return ok(res, await paged(
      `SELECT COUNT(*)::int AS n FROM ord_issue WHERE ${w}`,
      `SELECT * FROM ord_issue WHERE ${w} ORDER BY id DESC`, args, page, size));
  });

  // 补料单
  router.post("/order/replenish", requireMesrjPerm("issue.create"), async (req, res) => {
    const d = req.body || {};
    const moNo = (d.mo_no || "").toString().trim();
    if (!moNo) return fail(res, "必须挂一张已存在的工单（在工单上补料，不要凭空开）");
    const mo = await query("SELECT id FROM ord_mo WHERE mo_no=$1", [moNo]);
    if (!mo.rows[0]) return fail(res, "必须挂一张已存在的工单（在工单上补料，不要凭空开）");
    const prefix = `BL${todayStr().replace(/-/g, "").slice(2)}`;
    const mx = await query(
      "SELECT COUNT(*)::int AS n FROM ord_replenish WHERE rep_no LIKE $1", [`${prefix}%`]);
    const repNo = `${prefix}${String(Number(mx.rows[0]?.n ?? 0) + 1).padStart(3, "0")}`;
    await query(
      `INSERT INTO ord_replenish (rep_no, mo_no, material_code, qty, reason, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'待发',$6)`,
      [repNo, moNo, d.material_code ?? "", Number(d.qty || 0), d.reason ?? "补料",
       req.mesrjUser.login_name]);
    return ok(res, { rep_no: repNo }, `补料单 ${repNo} 已提交`);
  });

  // ═══ 通用 CRUD（源 _crud.register；固定路径已全部注册完，通配放最后）═══════

  const mdCrud = Router();
  registerCrud(mdCrud, MD_RES, "md.view", "md.edit");
  router.use("/md", mdCrud);

  const sysCrud = Router();
  registerCrud(sysCrud, SYS_RES, "sys.user.view", "sys.user.edit");
  router.use("/sys", sysCrud);

  // W4：bom / order / plan 通用 CRUD（源 _crud.register(prefix="/bom"|"/order"|"/plan")）
  const bomCrud = Router();
  registerCrud(bomCrud, BOM_RES, "bom.view", "bom.edit");
  router.use("/bom", bomCrud);

  const ordCrud = Router();
  registerCrud(ordCrud, ORD_RES, "mo.view", "mo.edit");
  router.use("/order", ordCrud);

  const planCrud = Router();
  registerCrud(planCrud, PLAN_RES, "plan.view", "plan.edit");
  router.use("/plan", planCrud);

  return router;
}

export { ok, fail, getParam, setParam, audit, hashPwd, verifyPwd, currentUser, hasPerm, requireMesrjPerm, tableColumns, Res, cleanRow, safeOrder, cleanPageArgs, paged, registerCrud, MD_RES, SYS_RES, BOM_RES, ORD_RES, PLAN_RES };
