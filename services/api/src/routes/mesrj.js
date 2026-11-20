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
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
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
  KIND_STD, KIND_MODEL, KIND_TMP, buildRows, makeCode, makeName, suffixOf, rankOf,
  trafficMap, renderSn,
  modelVariants, modelDefaultsData, modelGroups, syncModelGroups,
  pcbDecode, pcbCheckType, decorateAoi, stationSampling,
  latestBomVersion, allSfg, moNoAll, peekNextSeq, nextMoSeq, previewCreate, previewMoNos,
  outputOf, productRouteMap, lockMoRouteSteps, lockMoRoute, snapshotRoute, isSampling,
  lineBusyMo, createMoAll,
  mergeRows, aggBomItems, aggBomBySeg, writeIssueItems, nextIssueBase, createIssueForMo,
  segMapForMo, backfillIssueSegments,
  decorateMo, decorateItemVn, checkPo, buildIssueDoc,
  // W6a 过站引擎（源 api/exec.py）
  rule_on, th, station_rules, station_rule_map, retest_via_check,
  station_key, same_step, step_of, next_pending_station, next_station,
  find_release, has_skip, skip_set, release_map, open_entry_by_release,
  guard_open_ng, related_sns, done_stations, guard_missing_steps, guard_untested,
  guard_route_incomplete,
  genReleaseNo, snLabel, snFull, buildSn, snAlloc, snRuleOk, snGenerateWarn,
  guessSnType, checkSnFormat, pickRoute, snapshotRouteSteps,
  restoreTempRoute, activeTempRoute, ensureMoRoute,
  adoptFromAoi, adoptWsAoiPass, doPassInner, moAfterPass, BLOCK_STATUS,
  // W6c 维修 / 报废 / 设备健康 / 良率 / 返修列表 / 工单物料 / AI 工位 / 老化 / 物料追溯
  repairRegister, scrapRegister, deviceHealth, yieldStats, repairList,
  moMaterials, aiStations, agingWip, agingDetail, traceMaterialBySn, traceMaterialByMaterial,
} from "../mesrj/domain.js";
// W8 AOI 集成 + 出货报告模板（源 api/aoi.py + api/report.py + core/report_tpl.py）
import {
  aoiSqueeze, aoiSeries, aoiSeriesLike, aoiBuildMap, aoiVariants,
  aoiCanonicalModels, aoiManualMap, aoiResolve, aoiResolveEx,
} from "../mesrj/aoi-model.js";
import {
  aoiDash, aoiStationOf, aoiPointsTable, aoiPickPoints, aoiDefectMap,
  aoiCompMap, aoiImgCfg, aoiRelImgPath, aoiRange, aoiRate,
} from "../mesrj/aoi-dash.js";
import {
  KIND_COC, KINDS, listTpl, getTpl, saveUpload, saveMapping, toggleTpl, deleteTpl,
  tplCells, precheck, genReport, buildCtx, allFields, fieldOptions,
} from "../mesrj/report-tpl.js";
// W11 外箱绑码（源 api/pack.py + core/packcode.py + tools/print_agent.py 版式）
import {
  dayCode, dayCodeExplain, getRule, ruleOfMo, genCartonNo, genPalletNo,
  nextCartonNo, nextPalletNo, wipNo, preview, makePrintJob, tsLocal,
} from "../mesrj/packcode.js";
// 时效管控（源 api/dwell.py + core/dwell.py）
import * as dwell from "../mesrj/dwell.js";
import * as laser from "../mesrj/laser.js";
// 绑码 / 解码（源 api/bind.py）
import * as bindMod from "../mesrj/bind.js";
import { buildPages, renderSvg, toZpl, readTemplatePrompts } from "../mesrj/pack-label.js";
// W12 面板/分板（源 api/panel.py）
import {
  parseSn, joinSn, posOfIndex, panelSns, judgeSlot,
  listLayouts, saveLayout, deleteLayout, matchLayout,
  agingOf, buildView, resolveNext, alignLayout,
  panelFromAoi, panelSnsFor,
  _posOfIndex0,
  _buildView, _judgeSlotByTest, _normResult, _detectBaseByRecords,
  _resolveNext, modelOfMo, resolveLayout,
} from "../mesrj/panel.js";
// W12 维修明细 + 解报废 + 位号反查（源 api/repair.py + core/repair_detail.py + core/scrap_release.py + core/designator.py）
import {
  ensureSchema as repairEnsureSchema,
  createDetail, addPart, getDetail, listBySn, snContext,
  manualVerify, scrapVerify, toManual, applyAteResult,
  phenomena, dispositions, dispositionOf, needPart,
  canRepair, pendingDefects, openRepairs, nextRepairNo, nextNoWithPrefix, DEAD_STATUS,
  scrapReleaseApply, scrapReleaseApprove, scrapReleaseList, scrapReleaseOne,
  scrapReleaseConsume, scrapReleaseIsReleased as isReleased,
} from "../mesrj/repair-core.js";
// W12 位号反查（源 core/designator.py）
import { posTokens, posMatch, lookup as designatorLookup, batches as designatorBatches } from "../mesrj/designator.js";
// W12 PO 追溯导出 + 任意码查询（源 core/trace_export.py + core/sn_full.py）
import {
  resolvePo, collectBySns, collect, stationStats, stationList, summary as traceSummary,
  writeXlsx,
  resolveCodes, snQuery, snSummary,
} from "../mesrj/trace-core.js";
// W13 SMT 管控核心（源 api/smt.py + core/feeder_slot.py + core/smt_baseline.py）
import * as smtCore from "../mesrj/smt-core.js";
// W14 OQC 出货抽检核心（源 api/oqc.py + core/oqc.py + core/oqc_check.py + core/oqc_aql.py + core/aql.py）
import * as oqcCore from "../mesrj/oqc-core.js";

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
  // ⚠ SMT 的 roles.code 是小写（'admin'/'plant_manager'…），判定必须大小写无关，
  //    否则 admin 账号进不了 mesrj，也就无从自助授权。
  const smtAdmin = String(req.user?.roleKey || "").toUpperCase() === "ADMIN" ||
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

/** 源 bind._perm_any：任意一个权限即可（绑码工也要能查绑定记录，QC 也要能查） */
function requireAnyPerm(...perms) {
  return (req, res, next) => {
    if (!req.mesrjUser) return fail(res, "未登录或登录已过期", 401);
    if (!perms.some(p => hasPerm(req.mesrjUser, p))) {
      return fail(res, `没有权限（需 ${perms.join(" / ")} 之一）`, 403);
    }
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
    // 列投影（源 select：大 JSON 行的列表不取全列）
    select: opts.select || null,
    // 关键字搜索的原始 SQL 片段（源 search_sql：如按拼板 SN 反查 AOI 结果）
    searchSql: opts.search_sql || null,
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
      if (r.searchSql) {
        // 源 search_sql：片段里写一个 ?，值 = %kw%
        args.push(`%${kw}%`);
        where.push(r.searchSql.replace("?", `$${args.length}`));
      } else {
        args.push(`%${kw}%`);
        where.push("(" + r.search.map(c => `${c} ILIKE $${args.length}`).join(" OR ") + ")");
      }
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
      const cols = r.select ? r.select.join(", ") : "*";
      const rows = await paged(
        `SELECT COUNT(*)::int AS n FROM ${r.table} WHERE ${w}`,
        `SELECT ${cols} FROM ${r.table} WHERE ${w} ORDER BY ${order}`,
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
    // rid 为数字 id；定义了 key 的资源也接受 key 值定位（源 _crud 语义）
    const byKey = !!(r.key && !/^\d+$/.test(req.params.rid));
    const idCol = byKey ? r.key : "id";
    const old = (await query(`SELECT * FROM ${r.table} WHERE ${idCol}=$1`, [req.params.rid])).rows[0];
    if (!old) return fail(res, "记录不存在", 404);
    const data = await cleanRow(r, req.body || {});
    for (const f of r.immutable) delete data[f];
    delete data.id;
    if (r.key && data[r.key] && data[r.key] !== old[r.key]) {
      const ex = await query(`SELECT id FROM ${r.table} WHERE ${r.key}=$1 AND ${idCol}<>$2`,
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
      await query(`UPDATE ${r.table} SET ${sets} WHERE ${idCol}=$${cols.length + 1}`,
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
    const byKey = !!(r.key && !/^\d+$/.test(req.params.rid));
    const idCol = byKey ? r.key : "id";
    const old = (await query(`SELECT * FROM ${r.table} WHERE ${idCol}=$1`, [req.params.rid])).rows[0];
    if (!old) return fail(res, "记录不存在", 404);
    try {
      if (r.softDelete) {
        await query(`UPDATE ${r.table} SET status=0 WHERE ${idCol}=$1`, [req.params.rid]);
      } else {
        await query(`DELETE FROM ${r.table} WHERE ${idCol}=$1`, [req.params.rid]);
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

// ── W5 资源清单（源 route.py / cfg.py RES）───────────────────────────────────

/** 路线编码校验：大写字母/数字/横杠，且必须以产线编码开头 */
async function chkRoute(d, isNew, old) {
  const code = (d.route_code || old?.route_code || "").toString().trim().toUpperCase();
  if (!code) return [false, "路线编码不能为空"];
  if (!/^[A-Z0-9][A-Z0-9\-]{2,40}$/.test(code)) {
    return [false, "路线编码只能含大写字母、数字和横杠（如 ASSY-L02-STD）"];
  }
  if ("route_code" in d) d.route_code = code;
  const changed = isNew || !!(old && (old.route_code || "").toUpperCase() !== code);
  if (changed) {
    const lines = (await query(
      "SELECT line_code FROM md_line WHERE COALESCE(line_code,'')<>''")).rows.map(r => r.line_code);
    if (!lines.some(ln => code === ln || code.startsWith(`${ln}-`))) {
      return [false, `路线编码必须以产线编码开头（如 ASSY-L02-STD）。当前产线：${lines.sort().slice(0, 12).join("、")}`];
    }
  }
  return [true, ""];
}

/** AOI 点数校验：机型+工位唯一，点数为正整数 */
async function chkAoiPoints(d, _isNew, old) {
  const model = (d.model || "").toString().trim();
  const station = (d.station_name || "").toString().trim();
  if (!model || !station) return [false, "机型和工位名称都要填"];
  const qty = Number(d.point_qty);
  if (!Number.isInteger(qty) || qty <= 0) return [false, "点数必须是正整数"];
  const dup = await query(
    "SELECT id FROM cfg_aoi_points WHERE model=$1 AND station_name=$2 AND id<>$3",
    [model, station, old?.id || 0]);
  if (dup.rows[0]) return [false, `（${model} / ${station}）已存在，请直接编辑那一条`];
  return [true, ""];
}

const ROUTE_RES = {
  route: Res("proc_route", "route_code", "工艺路线", {
    search: ["route_code", "route_name", "product_code"],
    filters: ["status", "product_code"],
    required: ["route_code", "route_name"],
    order: "route_code",
    // 编码建好就不能改（改了就丢历史/断追溯）
    immutable: ["route_code"],
    check: chkRoute,
  }),
  step: Res("proc_step", "", "路线工步", {
    search: ["route_code", "station_code", "station_name"],
    filters: ["route_code", "process_code", "is_must_pass"],
    required: ["route_code", "station_code"],
    order: "route_code, seq_no",
  }),
  rule: Res("proc_station_rule", "", "工位规则", {
    search: ["station_code", "rule_type", "rule_name"],
    filters: ["station_code", "rule_type", "enabled"],
    required: ["station_code", "rule_type"],
    order: "station_code",
  }),
};

const CFG_RES = {
  threshold: Res("cfg_threshold", "th_key", "超时阈值", {
    search: ["th_key", "th_name", "apply_to"],
    filters: ["apply_to", "action", "enabled"],
    required: ["th_key", "th_name"],
    order: "apply_to, th_key",
  }),
  pokayoke: Res("cfg_pokayoke", "rule_key", "防错规则", {
    search: ["rule_key", "rule_name"],
    filters: ["scope", "enabled"],
    required: ["rule_key", "rule_name"],
    order: "id",
  }),
  snrule: Res("cfg_sn_rule", "sn_type", "SN 规则", {
    search: ["sn_type", "remark"],
    filters: ["enabled"],
    required: ["sn_type"],
    order: "id",
  }),
  dict: Res("cfg_code_dict", "", "码值字典", {
    search: ["dict_type", "code", "name"],
    filters: ["dict_type", "enabled"],
    required: ["dict_type", "code", "name"],
    order: "dict_type, sort_no",
  }),
  print_tpl: Res("cfg_print_tpl", "tpl_code", "打印模板", {
    search: ["tpl_code", "tpl_name", "file_name"],
    filters: ["tpl_type", "product_code", "enabled"],
    required: ["tpl_code", "tpl_name"],
    order: "sort_no, id",
  }),
  packrule: Res("cfg_pack_rule", "product_code", "装箱规则", {
    search: ["product_code", "machine_model", "model_code", "supplier_code"],
    filters: ["enabled", "factory_code"],
    required: ["product_code", "machine_model"],
    order: "id",
  }),
  pcbcode: Res("cfg_pcb_code", "product_code", "PCB板种码", {
    search: ["product_code", "machine_model", "pcb_code"],
    filters: ["enabled"],
    required: ["product_code"],
    order: "id",
  }),
  bindstation: Res("cfg_bind_station", "station_code", "绑定工位", {
    search: ["station_code", "station_name", "rel_type"],
    filters: ["rel_type", "enabled"],
    required: ["station_code"],
    order: "sort_no, id",
  }),
  apikey: Res("sys_api_key", "", "设备接口密钥", {
    search: ["api_key", "name", "remark"],
    filters: ["enabled"],
    required: ["api_key"],
    order: "id",
  }),
  bindrule: Res("cfg_bind_rule", "", "绑定规则表", {
    search: ["station_code", "role", "sn_type", "label"],
    filters: ["station_code", "role", "enabled"],
    required: ["station_code", "role"],
    order: "station_code, role",
  }),
  // ---- 设备上报数据：只读（设备走 HTTP 上报，后台只查）----
  machine: Res("prd_machine_data", "id", "设备上报记录", {
    search: ["sn", "machine_no", "product_no", "station_code", "mo_no", "create_by", "ng_info"],
    filters: ["line_sn", "station_code", "machine_type", "pass_ng", "mo_no"],
    order: "id DESC",
    readonly: true,
  }),
  machinetest: Res("prd_test", "id", "测试参数明细", {
    search: ["sn", "param_key", "param_val"],
    filters: ["sn", "station_code", "result", "equip_code"],
    order: "id",
    readonly: true,
  }),
  // ---- SMT-AOI 检测数据：只读；关键字按拼板 SN 反查 ----
  aoi: Res("prd_aoi_result", "id", "AOI 检测结果", {
    search: ["pcb_sn", "project_name", "file_name", "device_name"],
    // 关键字按拼板 SN 反查（现场扫一片小板 SN 就能定位整次检测）
    search_sql: "id IN (SELECT aoi_id FROM prd_aoi_board WHERE board_sn LIKE ?)",
    filters: ["final_result", "board_side", "track_line", "device_name"],
    order: "test_time DESC, id DESC",
    readonly: true,
    // 列表不取 raw_json（单行 220KB，一页 50 行会拖垮响应）
    select: ["id", "file_name", "device_name", "pcb_sn", "project_name", "track_line",
      "board_side", "test_time", "final_result", "robot_result", "user_result",
      "repair_user", "board_number", "board_ng_number", "comp_number",
      "comp_ng_number", "image_path", "created_at"],
    decorate: decorateAoi,
  }),
  aoiboard: Res("prd_aoi_board", "id", "AOI 拼板明细", {
    search: ["board_sn", "pcb_sn", "file_name"],
    filters: ["file_name", "pcb_sn", "final_result", "board_sn"],
    order: "file_name DESC, board_no",
    readonly: true,
  }),
  aoicomp: Res("prd_aoi_comp", "id", "AOI 元件明细", {
    search: ["pcb_sn", "comp_designator", "comp_type", "robot_result"],
    filters: ["file_name", "pcb_sn", "board_no", "comp_type", "robot_result"],
    order: "id",
    readonly: true,
  }),
  // ---- AOI 点数维护（DPPO/DPMO 的分母来源）----
  aoipoints: Res("cfg_aoi_points", "id", "AOI 点数", {
    search: ["model", "station_name", "remark"],
    filters: ["station_name"],
    required: ["model", "station_name", "point_qty"],
    order: "model, station_name",
    check: chkAoiPoints,
  }),
  aoidefect: Res("cfg_aoi_defect", "id", "AOI 缺陷代码", {
    search: ["code", "name_en", "name_zh", "category"],
    filters: ["category"],
    required: ["code", "name_zh"],
    order: "code",
  }),
  aoicompmap: Res("cfg_aoi_comp_map", "id", "AOI 位号映射", {
    search: ["model", "comp_id", "designator", "part_no", "remark"],
    filters: ["model"],
    required: ["model", "comp_id", "designator"],
    order: "model, comp_id",
  }),
  aoiprogrammap: Res("cfg_aoi_program_map", "id", "AOI 程序名映射", {
    search: ["program_name", "model", "remark"],
    filters: ["model"],
    required: ["program_name", "model"],
    order: "model, program_name",
  }),
};

// ── W9 资源清单（源 emp.py RES）─────────────────────────────────────────

/** 工号必填（工号就是工牌码） */
function chkEmp(data, _isNew, _old) {
  if (!String(data.emp_no || "").trim()) return [false, "工号必填（工号就是工牌码）"];
  return [true, ""];
}

const EMP_RES = {
  employees: Res("md_employee", "emp_no", "员工", {
    search: ["emp_no", "emp_name", "dept", "post"],
    filters: ["dept", "status", "line_code"],
    required: ["emp_no", "emp_name"],
    order: "emp_no",
    check: chkEmp,
  }),
  skills: Res("cfg_skill", "skill_code", "资质项", {
    search: ["skill_code", "skill_name"],
    filters: ["process_code", "enabled"],
    required: ["skill_code", "skill_name"],
    order: "sort_no, skill_code",
  }),
  stasks: Res("cfg_station_skill", "id", "工位资质要求", {
    search: ["station_code", "type_code", "skill_code"],
    filters: ["station_code", "type_code", "skill_code"],
    required: ["skill_code"],
    order: "type_code, station_code",
  }),
  certs: Res("prd_emp_cert", "id", "员工持证", {
    search: ["emp_no", "skill_code"],
    filters: ["emp_no", "skill_code", "status"],
    required: ["emp_no", "skill_code"],
    order: "emp_no, skill_code",
  }),
  exams: Res("prd_emp_exam", "id", "考核记录", {
    search: ["emp_no", "emp_name", "skill_code", "examiner"],
    filters: ["emp_no", "skill_code", "pass"],
    order: "exam_date DESC, id DESC",
    readonly: true,
  }),
};

// ── 路由装配 ────────────────────────────────────────────────────────────────

export function createMesrjRouter({ authenticateJWT }) {
  const router = Router();

  // ── 设备接口全量请求日志（源 run.py:38-175）──
  //   现场「我把数据发过去了，你没收到」只能靠这张表对账。失败请求同一路径 + 同一回执
  //   60 秒内只落一条（源 2026-11-05 的采样修法：一次失败重扫刷了 17.9 万行）。
  const DEV_PREFIXES = ["/DeviceConfig", "/StationPass", "/MachineData", "/Packing"];
  const devFailSeen = new Map();
  router.use((req, res, next) => {
    if (!DEV_PREFIXES.some(p => req.path.startsWith(p))) return next();
    const t0 = Date.now();
    const origJson = res.json.bind(res);
    res.json = (payload) => {
      try {
        const reqBody = JSON.stringify(req.body ?? {}).slice(0, 1500);
        const respBody = JSON.stringify(payload ?? null).slice(0, 1500);
        const status = res.statusCode || 200;
        const failed = status !== 200 || respBody.includes('"success":false');
        const key = `${req.path}|${respBody.slice(0, 120)}`;
        const now = Date.now();
        if (failed) {
          if (now - (devFailSeen.get(key) || 0) < 60000) return origJson(payload);
          devFailSeen.set(key, now);
          if (devFailSeen.size > 500) {
            for (const [k, v] of devFailSeen) if (now - v > 300000) devFailSeen.delete(k);
          }
        }
        const sn = String(payload?.sn || req.body?.sn || req.query?.sn || "").slice(0, 64);
        query(
          `INSERT INTO itf_api_log (direction, api_path, method, req_body, resp_body,
             http_status, success, cost_ms, sn, created_at)
           VALUES ('in',$1,$2,$3,$4,$5,$6,$7,$8,now())`,
          [req.path, req.method, reqBody, respBody, status, failed ? 0 : 1, Date.now() - t0, sn])
          .catch(e => console.log("[itf_api_log] 写入失败:", e?.message || e));
      } catch (e) {
        console.log("[itf_api_log] 组装失败:", e?.message || e);
      }
      return origJson(payload);
    };
    next();
  });

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

  // ── 设备侧 X-Api-Key 鉴权（源 devsrc.py _guard_key / sys_api_key.enabled）──
  async function requireDeviceKey(req, res) {
    const key = (req.headers["x-api-key"] || req.query.api_key || "").toString();
    if (!key) return fail(res, "缺少 X-Api-Key", 401);
    const hit = (await query(
      "SELECT id FROM sys_api_key WHERE api_key=$1 AND enabled=1", [key])).rows[0];
    if (!hit) return fail(res, "API Key 无效", 401);
    return true;
  }

  // ── P2 设备契约补齐（源 api/devsrc.py PanelQuery / SubmitPanel / FixTime）──
  //   这三条是 ICT/FCT 厂商固件在用的老路径：请求/响应都是老的 PascalCase 形状，
  //   所以这里不回 mesrj 信封，直接按源 jsonify 的键名输出。

  // GET /DeviceConfig/PanelQuery?sn= —— 扫一块拿整版（只读，不落库）
  router.get("/DeviceConfig/PanelQuery", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const sn = String(req.query.sn || "").trim();
      if (!sn) return res.json({ Success: false, Message: "Thiếu sn（缺少锚点SN）" });
      const layout = (await query(
        "SELECT * FROM cfg_panel_layout WHERE enabled=1 ORDER BY id LIMIT 1")).rows[0];
      if (!layout) return res.json({ Success: false, Message: "没有配拼版布局" });
      const sns = panelSns(sn, layout);
      if (!sns.length) {
        return res.json({ Success: false,
          Message: `整版推算失败（${sn}），请检查拼版布局的起始流水号 seq_offset` });
      }
      return res.json({
        Success: true,
        Model: layout.model || layout.product_code || "",
        Total: sns.length,
        Base: sn,
        First: sns[0].sn,
        Last: sns[sns.length - 1].sn,
        Sns: sns.map(x => ({ Sn: x.sn, Pos: x.panel_pos })),
      });
    } catch (ex) { return res.json({ Success: false, Message: ex.message }); }
  });

  // POST /StationPass/SubmitPanel —— 扫一块（锚点）→ 推算整版 → 逐块过站
  router.post("/StationPass/SubmitPanel", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const d = req.body || {};
      const sn = String(d.Sn || "").trim();
      const ws = String(d.WorkStationId || "").trim();
      const line = String(d.LineSn || "").trim();
      const moNo = String(d.MoNumber || "").trim();
      if (!sn || !ws) return res.json({ Success: false, Message: "Thiếu Sn / WorkStationId（缺锚点SN或工位）" });

      // 1) 找拼版布局：先按工单机型，再兜底第一条启用的
      let layout = null;
      let mo = null;
      if (moNo) {
        mo = (await query(
          "SELECT * FROM ord_mo WHERE mo_no=$1 AND status NOT IN ('已关闭','作废')", [moNo])).rows[0];
      }
      const model = mo ? (mo.product_model || (await query(
        "SELECT product_model FROM md_product WHERE product_code=$1", [mo.fg_code])).rows[0]?.product_model || "") : "";
      if (model) {
        layout = (await query(
          "SELECT * FROM cfg_panel_layout WHERE model=$1 AND enabled=1", [model])).rows[0];
      }
      if (!layout) layout = (await query(
        "SELECT * FROM cfg_panel_layout WHERE enabled=1 ORDER BY id LIMIT 1")).rows[0];
      if (!layout) {
        return res.json({ Success: false, Message: "没有配拼版布局（配置中心 → 拼版布局），无法推算整版" });
      }

      // 2) 推算整版
      const sns = panelSns(sn, layout);
      if (!sns.length) {
        return res.json({ Success: false,
          Message: `整版推算失败（${sn}），请检查拼版布局的起始流水号 seq_offset` });
      }

      // 3) 每块结果（可整版一个结果，也可每块独立）
      const perBlock = new Map();
      for (const r of d.Results || []) {
        const bsn = String((r && r.Sn) || "").trim();
        if (bsn) perBlock.set(bsn, String((r && r.Result) || "").trim().toUpperCase());
      }
      const overall = String(d.Result || "OK").trim().toUpperCase();
      const defectCode = String(d.DefectCode || "").trim();
      const mark = String(d.Mark || "").trim();
      const emp = String(d.Emp || "").trim();
      const now = nowStr();

      // 4) 逐块过站（与新系统 /StationPass/Scan 同一张 prd_pass，不另立一套规则）
      const okList = [], blocked = [];
      for (const x of sns) {
        const code = x.sn;
        const rawRes = perBlock.has(code) ? perBlock.get(code) : overall;
        const result = (rawRes === "OK" || rawRes === "PASS" || rawRes === "TRUE" || rawRes === "") ? "OK" : "NG";
        const snRow = (await query(
          "SELECT sn, mo_no, line_code, cur_seq FROM prd_sn WHERE sn=$1", [code])).rows[0];
        if (!snRow) { blocked.push({ Sn: code, Rule: "NOT_FOUND", Msg: `SN ${code} 不存在` }); continue; }
        // 工单可空：设备没传就按 SN 自己的工单走（源注释「可空，按 SN 自动找」）
        const blockMo = moNo || snRow.mo_no || "";
        const blockLine = line || snRow.line_code || "";
        try {
          await query(
            `INSERT INTO prd_pass (sn, station_code, line_code, mo_no, result, operator, pass_time, mark,
                                   ng_code, seq_no, operator_no, actual_station)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [code, ws, blockLine, blockMo, result, emp || "machine", now,
             mark || "device:panel", result === "NG" ? defectCode : "",
             Number(snRow.cur_seq || 0), emp, ws]);
          await query("UPDATE prd_sn SET cur_station=$1, updated_at=$2 WHERE sn=$3", [ws, now, code]);
          okList.push(code);
        } catch (e) {
          blocked.push({ Sn: code, Rule: "ERROR", Msg: e.message });
        }
      }
      await audit(emp || "device", "设备接口", "整版过站", sn,
        `station=${ws} anchor=${sn} ok=${okList.length} blocked=${blocked.length}`, "");
      return res.json({
        Success: true,
        Panel: { Anchor: sn, Base: sn, Total: sns.length,
          First: sns[0].sn, Last: sns[sns.length - 1].sn },
        Ok: okList, Blocked: blocked,
        OkCount: okList.length, BlockedCount: blocked.length,
      });
    } catch (ex) { return res.json({ Success: false, Message: ex.message }); }
  });

  // POST /StationPass/FixTime —— 把刚提交的过站记录改成设备上的真实测试时间
  //   只改 pass_time（不动 result/seq_no/station_code），且只允许改 10 分钟内创建的记录。
  router.post("/StationPass/FixTime", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const d = req.body || {};
      const sn = String(d.Sn || "").trim();
      const st = String(d.WorkStationId || "").trim();
      const ts = String(d.PassTime || "").trim();
      if (!sn || !ts) return res.json({ Success: false, Message: "Thiếu Sn / PassTime（缺少 SN 或时间）" });
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts)) {
        return res.json({ Success: false, Message: "PassTime 格式应为 YYYY-MM-DD HH:MM:SS" });
      }
      const dt = new Date(ts.replace(" ", "T"));
      if (Number.isNaN(dt.getTime()) || dt.getFullYear() < 2000 || dt.getTime() > Date.now() + 3600e3) {
        return res.json({ Success: false, Message: `PassTime 不合理：${ts}` });
      }
      const w = ["sn=$1"], args = [sn];
      if (st) { args.push(st); w.push(`station_code=$${args.length}`); }
      const row = (await query(
        `SELECT id, pass_time, created_at FROM prd_pass WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 1`,
        args)).rows[0];
      if (!row) return res.json({ Success: false, Message: "没找到该 SN 的过站记录" });
      const made = row.created_at ? new Date(row.created_at).getTime() : 0;
      if (made && Date.now() - made > 600e3) {
        return res.json({ Success: false,
          Message: `该记录创建于 ${tsLocal(row.created_at)}，超过 10 分钟，拒绝修改` });
      }
      const old = tsLocal(row.pass_time);
      if (old === ts) return res.json({ Success: true, Id: row.id, Unchanged: true });
      await query("UPDATE prd_pass SET pass_time=$1 WHERE id=$2", [ts, row.id]);
      await audit("device", "设备接口", "修正过站时间", sn, `${st || "-"}: ${old} → ${ts}`, "");
      return res.json({ Success: true, Id: row.id, OldPassTime: old, NewPassTime: ts });
    } catch (ex) { return res.json({ Success: false, Message: ex.message }); }
  });

  // ── 设备老路径别名（mesapi.pyc 编译版对外契约，无源码可比）──
  //   现场固件沿用旧路径：Submit = 落库版（Scan/Upload），Check = 只校验不写库。
  //   别名用 URL 重写实现，避免两套逻辑漂移。
  router.use((req, _res, next) => {
    if (req.method === "POST" && req.path === "/StationPass/Submit") req.url = "/StationPass/Scan";
    if (req.method === "POST" && req.path === "/MachineData/Submit") req.url = "/MachineData/Upload";
    next();
  });

  // GET /DeviceConfig/Lines — 线别清单
  router.get("/DeviceConfig/Lines", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const rows = (await query(
        `SELECT line_code, line_name, line_type, process_code, tact_time, plan_hours, status
           FROM md_line WHERE COALESCE(status,'') NOT IN ('停用','作废')
          ORDER BY line_code`)).rows;
      return ok(res, rows);
    } catch (ex) { return fail(res, ex.message); }
  });

  // GET /DeviceConfig/LineMOs — 某条线在制工单
  router.get("/DeviceConfig/LineMOs", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const lineCode = (req.query.line_code || "").toString().trim();
      const where = ["COALESCE(status,'') NOT IN ('已完工','已关闭','作废')"];
      const args = [];
      if (lineCode) { args.push(lineCode); where.push(`line_code=$${args.length}`); }
      const rows = (await query(
        `SELECT mo_no, product_code, line_code, plan_qty, status, plan_date
           FROM ord_mo WHERE ${where.join(" AND ")} ORDER BY plan_date DESC NULLS LAST LIMIT 200`,
        args)).rows;
      return ok(res, rows);
    } catch (ex) { return fail(res, ex.message); }
  });

  // GET /DeviceConfig/Stations — 工位清单（可按线别/工序过滤）
  router.get("/DeviceConfig/Stations", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const lineCode = (req.query.line_code || "").toString().trim();
      const processCode = (req.query.process_code || "").toString().trim();
      const where = ["COALESCE(status,1) <> 0"], args = [];
      if (lineCode) { args.push(lineCode); where.push(`line_code=$${args.length}`); }
      if (processCode) { args.push(processCode); where.push(`process_code=$${args.length}`); }
      const rows = (await query(
        `SELECT station_code, station_name, short_name, line_code, process_code, type_code, seq_no
           FROM md_station WHERE ${where.join(" AND ")} ORDER BY process_code, seq_no, station_code`,
        args)).rows;
      return ok(res, rows);
    } catch (ex) { return fail(res, ex.message); }
  });

  // GET /DeviceConfig/Tracks — 轨道配置（源无对应表，先把工位按线别/工序分组吐给机台）
  router.get("/DeviceConfig/Tracks", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const lineCode = (req.query.line_code || "").toString().trim();
      const args = [], where = ["COALESCE(status,1) <> 0"];
      if (lineCode) { args.push(lineCode); where.push(`line_code=$${args.length}`); }
      const rows = (await query(
        `SELECT line_code, process_code, COUNT(*)::int AS station_count,
                MIN(seq_no) AS first_seq, MAX(seq_no) AS last_seq
           FROM md_station WHERE ${where.join(" AND ")}
          GROUP BY line_code, process_code ORDER BY line_code, process_code`, args)).rows;
      return ok(res, rows);
    } catch (ex) { return fail(res, ex.message); }
  });

  // GET /DeviceConfig/VerifyOperator — 工牌/员工号校验（返工工位防代刷）
  router.get("/DeviceConfig/VerifyOperator", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const empNo = (req.query.emp_no || req.query.operator || "").toString().trim();
      if (!empNo) return fail(res, "缺少 emp_no");
      const e = (await query(
        `SELECT emp_no, emp_name, status, post_code FROM md_employee
          WHERE emp_no=$1 OR emp_card=$1 LIMIT 1`, [empNo])).rows[0];
      if (!e) return ok(res, { ok: false, emp_no: empNo, msg: "员工不存在" });
      const active = ![0, "0", "停用", "离职"].includes(e.status);
      return ok(res, { ok: active, emp_no: e.emp_no, emp_name: e.emp_name,
        post_code: e.post_code || "", msg: active ? "" : "该员工已停用" });
    } catch (ex) { return fail(res, ex.message); }
  });

  // POST /StationPass/Check — 只校验，不写 prd_pass（固件预检/复判用）
  router.post("/StationPass/Check", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const d = req.body || {};
      const sn = (d.sn || "").trim();
      const stationCode = (d.station_code || "").trim();
      if (!sn) return fail(res, "缺少 sn");
      if (!stationCode) return fail(res, "缺少 station_code");
      const snRow = (await query("SELECT sn FROM prd_sn WHERE sn=$1", [sn])).rows[0];
      if (!snRow) return fail(res, `SN ${sn} 不存在`);
      const st = (await query(
        "SELECT station_code FROM md_station WHERE station_code=$1", [stationCode])).rows[0];
      if (!st) return fail(res, `工位 ${stationCode} 不存在`);
      const ngStation = await guard_open_ng(sn);
      const missing = await guard_missing_steps(sn, stationCode);
      const accepted = !ngStation && !missing.length;
      return ok(res, {
        sn, station_code: stationCode, accepted,
        ng_station: ngStation || "",
        missing: missing.map(m => m[0]),
        msg: accepted ? "可以过站" : (ngStation ? `${ngStation} NG 未处理` : `前置未完成 ${missing.length} 步`),
      });
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── W7：DeviceConfig（设备侧拉取，X-Api-Key）──────────────────────────────
  // GET /DeviceConfig/LineConfig — 产线/工位配置，供机台侧对齐线别与默认工位
  router.get("/DeviceConfig/LineConfig", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const lineCode = (req.query.line_code || "").toString().trim();
      const stationCode = (req.query.station_code || "").toString().trim();
      const where = ["status=1"];
      const args = [];
      if (lineCode) { args.push(lineCode); where.push(`line_code=$${args.length}`); }
      if (stationCode) { args.push(stationCode); where.push(`station_code=$${args.length}`); }
      const rows = (await query(
        `SELECT line_code, line_name, station_code, station_name, type_code, process_code, seq_no
         FROM md_station WHERE ${where.join(" AND ")}
         ORDER BY line_code, seq_no, station_code`, args)).rows;
      return ok(res, rows);
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── W7：StationPass（设备侧扫码过站入口，X-Api-Key）──────────────────────
  // POST /StationPass/Scan — 机台扫描 SN 到工位，返回过站结果（OK/NG 及守卫信息）
  router.post("/StationPass/Scan", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const d = req.body || {};
      const sn = (d.sn || "").trim();
      const stationCode = (d.station_code || "").trim();
      const machineNo = (d.machine_no || "").toString().trim();
      const result = (d.result || "OK").toString().trim();
      if (!sn) return fail(res, "缺少 sn");
      if (!stationCode) return fail(res, "缺少 station_code");
      const snRow = (await query("SELECT * FROM prd_sn WHERE sn=$1", [sn])).rows[0];
      if (!snRow) return fail(res, `SN ${sn} 不存在`);
      const passRow = {
        sn, station_code: stationCode, result,
        operator: machineNo || "machine",
        pass_time: nowStr(), mark: `device:${machineNo || ""}`,
      };
      await query(
        `INSERT INTO prd_pass (sn, station_code, result, operator, pass_time, mark)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [snRow.sn, stationCode, result, passRow.operator, passRow.pass_time, passRow.mark]);
      await query(
        "UPDATE prd_sn SET cur_station=$1, updated_at=$2 WHERE sn=$3",
        [stationCode, nowStr(), sn]);
      await audit(machineNo || "device", "设备接口", "StationPass 扫码", sn,
        `station=${stationCode} result=${result}`, "");
      return ok(res, { sn, station_code: stationCode, result, pass_time: passRow.pass_time }, "扫码过站完成");
    } catch (ex) { return fail(res, ex.message); }
  });

  // GET /StationPass/Pending — 机台侧待处理 SN 列表（按工位/线别）
  router.get("/StationPass/Pending", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const stationCode = (req.query.station_code || "").toString().trim();
      const lineCode = (req.query.line_code || "").toString().trim();
      const where = ["status IN ('在制','待修')"];
      const args = [];
      if (stationCode) { args.push(stationCode); where.push(`cur_station=$${args.length}`); }
      if (lineCode) { args.push(lineCode); where.push(`line_code=$${args.length}`); }
      const rows = (await query(
        `SELECT sn, product_code, mo_no, cur_station AS station_code, cur_seq, status, created_at
         FROM prd_sn WHERE ${where.join(" AND ")}
         ORDER BY created_at ASC LIMIT 100`, args)).rows;
      return ok(res, rows);
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── W7：MachineData（设备侧上报测试数据，X-Api-Key）─────────────────────
  // POST /MachineData/Upload — 机台上报单条测试数据，入库 prd_machine_data
  router.post("/MachineData/Upload", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const d = req.body || {};
      const sn = (d.sn || "").trim();
      if (!sn) return fail(res, "缺少 sn");
      await query(
        `INSERT INTO prd_machine_data (sn, machine_no, machine_type, product_no, version, lot_no,
                 loader_no, station_code, line_sn, track, mo_no, seq, begin_time, end_time,
                 location, channel, pass_ng, ng_info, create_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())`,
        [sn,
         (d.machine_no || "").trim(), (d.machine_type || "").trim(), (d.product_no || "").trim(),
         (d.version || "").trim(), (d.lot_no || "").trim(), (d.loader_no || "").trim(),
         (d.station_code || "").trim(), (d.line_sn || "").trim(), (d.track || "1").trim(),
         (d.mo_no || "").trim(), (d.seq || "").trim(), (d.begin_time || "").trim(),
         (d.end_time || "").trim(), (d.location || "").trim(), (d.channel || "").trim(),
         (d.pass_ng || "").trim(), (d.ng_info || "").trim(), (d.create_by || d.machine_no || "device").trim()]);
      return ok(res, { sn }, "机台数据上报完成");
    } catch (ex) { return fail(res, ex.message); }
  });

  // GET /MachineData/List — 查询机台测试数据（分页，支持 sn / machine_no / station_code）
  router.get("/MachineData/List", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const page = Math.max(1, Number(req.query.page || 1));
      const size = Math.min(500, Math.max(1, Number(req.query.size || 20)));
      const where = [];
      const args = [];
      const sn = (req.query.sn || "").toString().trim();
      const machineNo = (req.query.machine_no || "").toString().trim();
      const stationCode = (req.query.station_code || "").toString().trim();
      if (sn) { args.push(`%${sn}%`); where.push(`sn ILIKE $${args.length}`); }
      if (machineNo) { args.push(machineNo); where.push(`machine_no=$${args.length}`); }
      if (stationCode) { args.push(stationCode); where.push(`station_code=$${args.length}`); }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const count = Number((await query(
        `SELECT COUNT(*)::int AS n FROM prd_machine_data ${clause}`, args)).rows[0]?.n || 0);
      const off = (page - 1) * size;
      const rows = (await query(
        `SELECT id, sn, machine_no, machine_type, product_no, version, lot_no, loader_no,
                station_code, line_sn, track, mo_no, seq, begin_time, end_time, location,
                channel, pass_ng, ng_info, create_by, created_at
         FROM prd_machine_data ${clause}
         ORDER BY created_at DESC
         LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, size, off])).rows;
      return ok(res, { total: count, page, size, rows });
    } catch (ex) { return fail(res, ex.message); }
  });

  // GET /MachineData/BySn — 按 SN 查询机台测试数据明细
  router.get("/MachineData/BySn", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const sn = (req.query.sn || "").toString().trim();
      if (!sn) return fail(res, "缺少 sn");
      const rows = (await query(
        `SELECT id, sn, machine_no, machine_type, product_no, version, lot_no, loader_no,
                station_code, line_sn, track, mo_no, seq, begin_time, end_time, location,
                channel, pass_ng, ng_info, create_by, created_at
         FROM prd_machine_data WHERE sn=$1 ORDER BY created_at DESC`, [sn])).rows;
      return ok(res, rows);
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── W7：Packing（设备侧装箱/托盘，X-Api-Key）────────────────────────────
  // POST /Packing/Box — 建箱/扫码入箱，入库 prd_box
  router.post("/Packing/Box", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const d = req.body || {};
      const boxNo = (d.box_no || "").trim();
      const sn = (d.sn || "").trim();
      if (!boxNo) return fail(res, "缺少 box_no");
      const exists = (await query("SELECT id FROM prd_box WHERE box_no=$1", [boxNo])).rows[0];
      if (!exists) {
        await query(
          `INSERT INTO prd_box (box_no, pallet_no, mo_no, product_code, qty, status, created_at)
           VALUES ($1,'', $2,$3, 0, '开箱', now())`,
          [boxNo, (d.mo_no || "").trim(), (d.product_code || "").trim()]);
      }
      if (sn) {
        const snRow = (await query("SELECT * FROM prd_sn WHERE sn=$1", [sn])).rows[0];
        if (!snRow) return fail(res, `SN ${sn} 不存在`);
        await query(
          "UPDATE prd_box SET qty = COALESCE(qty,0) + 1 WHERE box_no=$1", [boxNo]);
      }
      return ok(res, { box_no: boxNo }, "装箱完成");
    } catch (ex) { return fail(res, ex.message); }
  });

  // POST /Packing/Pallet — 建托/扫码入托，入库 prd_pallet
  router.post("/Packing/Pallet", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const d = req.body || {};
      const palletNo = (d.pallet_no || "").trim();
      const boxNo = (d.box_no || "").trim();
      if (!palletNo) return fail(res, "缺少 pallet_no");
      const exists = (await query("SELECT id FROM prd_pallet WHERE pallet_no=$1", [palletNo])).rows[0];
      if (!exists) {
        await query(
          `INSERT INTO prd_pallet (pallet_no, mo_no, line_code, status, created_at)
           VALUES ($1,$2,$3,'开托', now())`,
          [palletNo, (d.mo_no || "").trim(), (d.line_code || "").trim()]);
      }
      if (boxNo) {
        await query("UPDATE prd_box SET pallet_no=$1 WHERE box_no=$2", [palletNo, boxNo]);
      }
      return ok(res, { pallet_no: palletNo }, "建托完成");
    } catch (ex) { return fail(res, ex.message); }
  });

  // GET /Packing/Box/:box_no — 箱详情
  router.get("/Packing/Box/:box_no", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const boxNo = req.params.box_no;
      const row = (await query(
        "SELECT box_no, pallet_no, mo_no, product_code, qty, status, created_at FROM prd_box WHERE box_no=$1",
        [boxNo])).rows[0];
      if (!row) return fail(res, `箱号 ${boxNo} 不存在`, 404);
      return ok(res, row);
    } catch (ex) { return fail(res, ex.message); }
  });

  // GET /Packing/Pallet/:pallet_no — 托详情
  router.get("/Packing/Pallet/:pallet_no", async (req, res) => {
    try {
      if (!(await requireDeviceKey(req, res))) return;
      const palletNo = req.params.pallet_no;
      const row = (await query(
        "SELECT pallet_no, mo_no, line_code, status, created_at FROM prd_pallet WHERE pallet_no=$1",
        [palletNo])).rows[0];
      if (!row) return fail(res, `托号 ${palletNo} 不存在`, 404);
      return ok(res, row);
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── W7：itf 日志（JWT 认证，后台查询）──────────────────────────────────
  // GET /itf/api/log — 接口调用日志分页查询
  router.get("/itf/api/log", async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page || 1));
      const size = Math.min(500, Math.max(1, Number(req.query.size || 20)));
      const where = [];
      const args = [];
      const apiPath = (req.query.api_path || "").toString().trim();
      const success = (req.query.success || "").toString().trim();
      if (apiPath) { args.push(`%${apiPath}%`); where.push(`api_path ILIKE $${args.length}`); }
      if (success === "1") { where.push("success=1"); }
      else if (success === "0") { where.push("success=0"); }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const count = Number((await query(
        `SELECT COUNT(*)::int AS n FROM itf_api_log ${clause}`, args)).rows[0]?.n || 0);
      const off = (page - 1) * size;
      const rows = (await query(
        `SELECT id, direction, api_path, method, req_body, resp_body, http_status,
                success, cost_ms, sn, created_at
         FROM itf_api_log ${clause}
         ORDER BY created_at DESC
         LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, size, off])).rows;
      return ok(res, { total: count, page, size, rows });
    } catch (ex) { return fail(res, ex.message); }
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
               COALESCE(NULLIF(m.actual_start,''), m.created_at::text) DESC,
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

  // ═══ W5 route 域（源 api/route.py）══════════════════════════════════════

  // 一键生成标准路线（{线}-STD）
  router.post("/route/generate", requireMesrjPerm("route.edit"), async (req, res) => {
    const d = req.body || {};
    const lineCode = (d.line_code || "").toString().trim();
    if (!lineCode) return fail(res, "请选择产线：一条标准路线只对应一条产线");
    const line = (await query("SELECT * FROM md_line WHERE line_code=$1", [lineCode])).rows[0];
    if (!line) return fail(res, `产线不存在：${lineCode}`);
    const routeCode = (d.route_code || "").toString().trim() || makeCode(lineCode, KIND_STD);
    const routeName = (d.route_name || "").toString().trim() || makeName(line.line_name, KIND_STD);
    const allMust = !!d.all_must;

    const stations = (await query(
      `SELECT station_code, station_name, short_name, seq_no, process_code, allow_retest, max_retest
       FROM md_station WHERE line_code=$1 AND status=1 ORDER BY seq_no`, [lineCode])).rows;
    if (!stations.length) return fail(res, `产线 ${lineCode} 没有启用的工位`);
    const traffic = await trafficMap();
    const [rows, dropped] = buildRows(stations, lineCode, traffic, null, !allMust);
    if (!rows.length) {
      return fail(res, "产线上没有可排的工位（检查工位后缀是否按规则命名）");
    }
    const old = (await query("SELECT * FROM proc_route WHERE route_code=$1", [routeCode])).rows[0];
    const remark = `由产线工位自动生成，共 ${rows.length} 站`;
    if (old) {
      await query(
        `UPDATE proc_route SET route_name=$2, product_code='', status='有效', remark=$3 WHERE route_code=$1`,
        [routeCode, routeName, remark]);
    } else {
      await query(
        `INSERT INTO proc_route (route_code, route_name, product_code, version, status, remark)
         VALUES ($1,$2,'','V1.0','有效',$3)`, [routeCode, routeName, remark]);
    }
    await query("DELETE FROM proc_step WHERE route_code=$1", [routeCode]);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await query(
        `INSERT INTO proc_step
         (route_code, seq_no, process_code, station_code, station_name, is_must_pass,
          allow_retest, max_retest, is_key_station, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [routeCode, (i + 1) * 10, r.proc, r.code, r.name, r.must,
         r.allow_retest, r.max_retest, r.key, r.must ? "过站" : "展示（未扫描校验）"]);
    }
    const mustN = rows.filter(r => r.must).length;
    await audit(req.mesrjUser.login_name, "工艺路线", "由产线生成标准路线", routeCode,
      `${rows.length} 站 / 过站 ${mustN} 站`, req.ip);
    let msg = `已生成 ${routeCode}（${rows.length} 个工步，其中 ${mustN} 个过站校验点）`;
    if (dropped.length) msg += `；已合并 ${dropped.length} 个重复工位`;
    return ok(res, {
      route_code: routeCode, steps: rows.length, must: mustN,
      dropped: dropped.map(x => x.code), dups: [],
    }, msg);
  });

  // 路线编码/名称建议
  router.get("/route/suggest", async (req, res) => {
    const lineCode = (req.query.line_code || "").toString().trim();
    const kind = (req.query.kind || KIND_STD).toString().trim();
    const model = (req.query.model || "").toString().trim();
    if (!lineCode) return fail(res, "请选择产线");
    const line = (await query("SELECT * FROM md_line WHERE line_code=$1", [lineCode])).rows[0];
    const lineName = line ? line.line_name : lineCode;
    const code = makeCode(lineCode, kind, model);
    const name = makeName(lineName, kind, model);
    const exist = code
      ? (await query("SELECT * FROM proc_route WHERE route_code=$1", [code])).rows[0] : null;
    let existing = null;
    if (exist) {
      const n = await query("SELECT COUNT(*)::int AS n FROM proc_step WHERE route_code=$1", [exist.route_code]);
      existing = { route_code: exist.route_code, route_name: exist.route_name, steps: n.rows[0].n };
    }
    return ok(res, { code, name, exists: !!exist, existing,
      product_code: (req.query.product_code || "").toString().trim() });
  });

  // 自动建路线（草稿，可选从标准路线复制步骤）
  router.post("/route/create-auto", requireMesrjPerm("route.edit"), async (req, res) => {
    const d = req.body || {};
    const lineCode = (d.line_code || "").toString().trim();
    const kind = (d.kind || KIND_STD).toString().trim();
    const model = (d.model || "").toString().trim();
    const productCode = (d.product_code || "").toString().trim();
    const remark = (d.remark || "").toString().trim();
    if (![KIND_STD, KIND_MODEL, KIND_TMP].includes(kind)) return fail(res, "路线类型不正确");
    if (kind === KIND_MODEL && !model) return fail(res, "机型专用路线必须选机型");
    const line = (await query("SELECT * FROM md_line WHERE line_code=$1", [lineCode])).rows[0];
    if (!line) return fail(res, "请选产线（标准路线必须挂产线）");
    const code = makeCode(lineCode, kind, model);
    if (!code) return fail(res, "无法生成路线编码，请检查产线/机型");
    const dup = await query("SELECT id FROM proc_route WHERE route_code=$1", [code]);
    if (dup.rows[0]) return fail(res, `路线 ${code} 已存在。标准路线每条线只有一条，请直接在列表里编辑`);
    const name = makeName(line.line_name, kind, model);
    const copyFrom = (d.copy_from || "auto").toString().trim();
    let srcCode = "", copied = 0;
    if (copyFrom !== "none") {
      srcCode = copyFrom !== "auto" ? copyFrom : `${lineCode}-STD`;
      const srcSteps = await query("SELECT * FROM proc_step WHERE route_code=$1 ORDER BY seq_no", [srcCode]);
      copied = srcSteps.rows.length;
      if (!copied) srcCode = "";
    }
    const fullRemark = (remark ? `${remark}；` : "") + "系统自动创建" +
      (srcCode ? `（复制自 ${srcCode}）` : "");
    const rid = await query(
      `INSERT INTO proc_route (route_code, route_name, product_code, version, status, remark)
       VALUES ($1,$2,$3,'V1.0','草稿',$4) RETURNING id`,
      [code, name, productCode, fullRemark]);
    if (srcCode) {
      const srcSteps = await query("SELECT * FROM proc_step WHERE route_code=$1 ORDER BY seq_no", [srcCode]);
      for (let i = 0; i < srcSteps.rows.length; i++) {
        const x = srcSteps.rows[i];
        await query(
          `INSERT INTO proc_step
           (route_code, seq_no, process_code, station_code, station_name, is_must_pass,
            allow_retest, max_retest, is_key_station, remark)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [code, (i + 1) * 10, x.process_code, x.station_code, x.station_name,
           x.is_must_pass, x.allow_retest, x.max_retest, x.is_key_station, x.remark || ""]);
      }
    }
    await audit(req.mesrjUser.login_name, "工艺路线", "创建路线", code,
      `${name}（复制 ${copied} 步 自 ${srcCode || "无"}）`, req.ip);
    let msg = `已创建 ${code}（草稿）：${name}`;
    if (copied) msg += `；已从 ${srcCode} 复制 ${copied} 步（请到点「编辑路线」再改成「有效」）`;
    return ok(res, { id: rid.rows[0].id, route_code: code, route_name: name, copied, copy_from: srcCode }, msg);
  });

  // 路线步骤读取/整表保存
  router.get("/route/:code/steps", async (req, res) => {
    const rows = (await query(
      "SELECT * FROM proc_step WHERE route_code=$1 ORDER BY seq_no", [req.params.code])).rows;
    const rt = (await query("SELECT * FROM proc_route WHERE route_code=$1", [req.params.code])).rows[0] ?? null;
    return ok(res, { route: rt, steps: rows });
  });

  router.post("/route/:code/steps", requireMesrjPerm("route.edit"), async (req, res) => {
    const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
    const routeCode = req.params.code;
    const rt = await query("SELECT id FROM proc_route WHERE route_code=$1", [routeCode]);
    if (!rt.rows[0]) return fail(res, `路线不存在：${routeCode}`);
    await query("DELETE FROM proc_step WHERE route_code=$1", [routeCode]);
    // 重测参数以工位表为准（缺省 1/2）
    const rtMap = {};
    for (const r of await applyStationRetest(steps.map(s => ({
      station_code: s.station_code ?? "",
      allow_retest: s.allow_retest ?? 1,
      max_retest: s.max_retest ?? 2,
    })))) {
      rtMap[r.station_code] = r;
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const rtRow = rtMap[s.station_code ?? ""] ?? {};
      await query(
        `INSERT INTO proc_step
         (route_code, seq_no, process_code, station_code, station_name, is_must_pass,
          allow_retest, max_retest, is_key_station, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [routeCode, (i + 1) * 10, s.process_code ?? "", s.station_code ?? "",
         s.station_name ?? "", [1, "1", true, "true"].includes(s.is_must_pass ?? 1) ? 1 : 0,
         Number(rtRow.allow_retest ?? 1), Number(rtRow.max_retest ?? 2),
         [1, "1", true, "true"].includes(s.is_key_station ?? 0) ? 1 : 0, s.remark ?? ""]);
    }
    await audit(req.mesrjUser.login_name, "工艺路线", "保存步骤", routeCode, `${steps.length} 步`, req.ip);
    return ok(res, { steps: steps.length }, `已保存 ${steps.length} 个工步`);
  });

  // 路线体检（重复工位/关键站缺失）
  router.get("/route/:code/validate", async (req, res) => {
    const steps = (await query(
      "SELECT * FROM proc_step WHERE route_code=$1 ORDER BY seq_no", [req.params.code])).rows;
    const issues = [], warns = [];
    const seen = new Set();
    for (const s of steps) {
      if (seen.has(s.station_code)) issues.push(`工位重复出现：${s.station_code}`);
      seen.add(s.station_code);
    }
    const shorts = {};
    for (const s of steps) {
      const st = (await query(
        "SELECT short_name, station_name FROM md_station WHERE station_code=$1", [s.station_code])).rows[0];
      const nm = (st?.short_name || st?.station_name || s.station_name) || "";
      if (nm) (shorts[nm] ??= []).push(s.station_code);
    }
    for (const [nm, codes] of Object.entries(shorts)) {
      if (codes.length > 1) {
        warns.push(`「${nm}」在本路线出现 ${codes.length} 次（${codes.join("、")}）——是同一台设备的两笔登记吗？实际用的只有一个`);
      }
    }
    if (!steps.length) issues.push("路线为空");
    const missing = steps.filter(s => !s.station_code);
    if (missing.length) issues.push(`有 ${missing.length} 步没有工位`);
    const must = steps.filter(s => Number(s.is_must_pass || 0) === 1);
    if (steps.length && !must.length) {
      warns.push("整条路线都是展示过站（不过站校验），只适合管理看板，不适合防错");
    }
    return ok(res, { total: steps.length, issues, warns, must_pass: must.length, ok: issues.length === 0 });
  });

  // 产品分段路线（4 段默认线/路线 + 自动选择）
  router.get("/route/product", async (req, res) => {
    const pc = (req.query.product_code || "").toString().trim();
    if (!pc) return fail(res, "请选择产品料号");
    const prod = (await query(
      `SELECT product_code, product_model, product_name, cust_code, product_type
       FROM md_product WHERE product_code=$1`, [pc])).rows[0] ?? null;
    const cfgRows = (await query(
      "SELECT * FROM cfg_product_route WHERE product_code=$1", [pc])).rows;
    const cfg = Object.fromEntries(cfgRows.map(r => [r.process_code, r]));
    const fromMo = {};
    for (const r of (await query(
      `SELECT process_code, line_code FROM ord_mo
       WHERE (fg_code=$1 OR product_code=$1) AND COALESCE(line_code,'')<>''
       ORDER BY id DESC`, [pc])).rows) {
      if (!(r.process_code in fromMo)) fromMo[r.process_code] = r.line_code;
    }
    const defaults = {};
    for (const r of (await query(
      `SELECT line_code, process_code FROM md_line WHERE COALESCE(process_code,'')<>'' ORDER BY line_code`)).rows) {
      if (!(r.process_code in defaults)) defaults[r.process_code] = r.line_code;
    }
    const lines = (await query(
      "SELECT line_code, line_name, process_code FROM md_line ORDER BY line_code")).rows;
    const routeInfo = async code => {
      if (!code) return null;
      const r = (await query(
        "SELECT route_code, route_name, status FROM proc_route WHERE route_code=$1", [code])).rows[0];
      if (!r) return null;
      const steps = (await query(
        `SELECT seq_no, station_code, station_name, is_must_pass FROM proc_step
         WHERE route_code=$1 ORDER BY seq_no`, [code])).rows;
      r.step_list = steps;
      r.steps = steps.length;
      r.must = steps.filter(x => Number(x.is_must_pass || 0) === 1).length;
      return r;
    };
    const segs = [], missing = [];
    for (const [proc, pname] of PROC_SEGMENTS) {
      const c0 = cfg[proc];
      let lineCode, source;
      if (c0?.line_code) { lineCode = c0.line_code; source = "配置表"; }
      else if (proc in fromMo) { lineCode = fromMo[proc]; source = "历史工单推测"; }
      else { lineCode = defaults[proc] ?? ""; source = "默认"; }
      const line = lines.find(x => x.line_code === lineCode) ?? null;
      let routeCode = c0?.route_code ?? "", rsource;
      let info = null;
      if (routeCode) { info = await routeInfo(routeCode); rsource = "指定"; }
      else {
        let row = lineCode
          ? (await query("SELECT route_code FROM proc_route WHERE route_code=$1 AND status='有效'",
            [`${lineCode}-STD`])).rows[0] : null;
        if (!row && lineCode) {
          row = (await query(
            `SELECT route_code FROM proc_route WHERE route_code LIKE $1 AND status='有效'
             ORDER BY LENGTH(route_code) LIMIT 1`, [`${lineCode}-%`])).rows[0] ?? null;
        }
        routeCode = row?.route_code ?? "";
        info = await routeInfo(routeCode);
        rsource = "自动";
      }
      const cand = lineCode
        ? (await query(
          "SELECT route_code, route_name, status FROM proc_route WHERE route_code LIKE $1 ORDER BY route_code",
          [`${lineCode}-%`])).rows : [];
      for (const x of cand) {
        const n = await query("SELECT COUNT(*)::int AS n FROM proc_step WHERE route_code=$1", [x.route_code]);
        x.steps = n.rows[0].n;
      }
      const seg = {
        process_code: proc, process_name: pname,
        line_code: lineCode, line_name: line?.line_name ?? "", line_source: source,
        route_code: routeCode, route_name: info?.route_name ?? "",
        steps: info?.steps ?? 0, must: info?.must ?? 0,
        route_status: info?.status ?? "", route_source: rsource,
        step_list: info?.step_list ?? [], candidates: cand,
      };
      if (!routeCode || !seg.steps) missing.push(proc);
      segs.push(seg);
    }
    return ok(res, {
      product: prod ?? { product_code: pc }, segments: segs, missing, lines,
      total_steps: segs.reduce((a, x) => a + x.steps, 0),
      total_must: segs.reduce((a, x) => a + x.must, 0),
    });
  });

  // 产品分段路线保存
  router.post("/route/product/save", requireMesrjPerm("route.edit"), async (req, res) => {
    const d = req.body || {};
    const pc = (d.product_code || "").toString().trim();
    const segs = Array.isArray(d.segments) ? d.segments : [];
    if (!pc) return fail(res, "请选择产品料号");
    let n = 0;
    for (const s of segs) {
      const proc = (s.process_code || "").toString().trim();
      if (!PROC_SEGMENTS.some(([p]) => p === proc)) continue;
      const old = (await query(
        "SELECT id FROM cfg_product_route WHERE product_code=$1 AND process_code=$2", [pc, proc])).rows[0];
      const vals = [pc, proc, (s.line_code || "").toString().trim(),
        (s.route_code || "").toString().trim(), req.mesrjUser.login_name, nowStr()];
      if (old) {
        await query(
          `UPDATE cfg_product_route SET line_code=$3, route_code=$4, updated_by=$5, updated_at=$6
           WHERE product_code=$1 AND process_code=$2`, vals);
      } else {
        await query(
          `INSERT INTO cfg_product_route (product_code, process_code, line_code, route_code, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6)`, vals);
      }
      n++;
    }
    await audit(req.mesrjUser.login_name, "产品路线", "保存产品分段路线", pc, `${n} 段`, req.ip);
    return ok(res, { saved: n }, `已保存 ${n} 段工艺`);
  });

  // 已配置产品清单
  router.get("/route/product/list", async (req, res) => {
    const rows = (await query(
      `SELECT r.product_code, MAX(p.product_model) AS model, MAX(p.product_name) AS name,
              COUNT(*)::int AS segs,
              SUM(CASE WHEN COALESCE(r.line_code,'')<>'' THEN 1 ELSE 0 END)::int AS with_line
       FROM cfg_product_route r LEFT JOIN md_product p ON p.product_code=r.product_code
       GROUP BY r.product_code ORDER BY r.product_code`)).rows;
    return ok(res, rows);
  });

  // 某产线可选路线
  router.get("/route/candidates", async (req, res) => {
    const line = (req.query.line_code || "").toString().trim();
    if (!line) return ok(res, []);
    const rows = (await query(
      "SELECT route_code, route_name, status FROM proc_route WHERE route_code LIKE $1 ORDER BY route_code",
      [`${line}-%`])).rows;
    for (const x of rows) {
      x.steps = Number((await query(
        "SELECT COUNT(*)::int AS n FROM proc_step WHERE route_code=$1", [x.route_code])).rows[0].n);
      x.must = Number((await query(
        "SELECT COUNT(*)::int AS n FROM proc_step WHERE route_code=$1 AND is_must_pass=1",
        [x.route_code])).rows[0].n);
    }
    return ok(res, rows);
  });

  // ── 机型工艺（源 route.py 下半部）──────────────────────────────────────────

  // 机型已维护哪些变体工艺
  router.get("/route/variants", async (req, res) => {
    const model = (req.query.model || "").toString().trim();
    return ok(res, { model, variants: await modelVariants(model) });
  });

  // 开单辅助：机型每段默认产线/工位（md_product 不存在时给 warn）
  router.get("/route/model-defaults", async (req, res) => {
    return ok(res, await modelDefaultsData(
      (req.query.model || "").toString().trim(),
      (req.query.variant || "").toString().trim()));
  });

  // 机型工艺读取 + 按 4 段汇总
  router.get("/route/process", async (req, res) => {
    const model = (req.query.model || "").toString().trim();
    if (!model) {
      // 机型下拉：有工单的 FG 机型排前面
      const rows = (await query(
        `SELECT p.product_model AS m, COUNT(o.id)::int AS n FROM md_product p
         LEFT JOIN ord_mo o ON o.fg_code = p.product_code
         WHERE COALESCE(p.product_model,'')<>'' AND p.product_type='FG'
         GROUP BY p.product_model ORDER BY n DESC, p.product_model`)).rows;
      return ok(res, { models: rows.map(r => r.m), steps: [] });
    }
    const variant = (req.query.variant || "").toString().trim();
    const [steps0, source] = await modelProcess(model, variant);
    const steps = steps0.map(x => ({
      ...x,
      enabled: Number(x.enabled ?? 1) ? 1 : 0,
      is_sampling: Number(x.is_sampling ?? 0),
    }));
    const segs = PROC_SEGMENTS.map(([proc, pname]) => {
      const sub = steps.filter(x => (x.process_code || "") === proc);
      const live = sub.filter(x => x.enabled === 1);
      return {
        process_code: proc, process_name: pname,
        count: live.length, total: sub.length, disabled: sub.length - live.length,
        must: live.filter(x => Number(x.is_must_pass || 0) === 1).length,
        steps: sub,
      };
    });
    const liveAll = steps.filter(x => x.enabled === 1);
    const srcLabel = ({
      own: "本机已维护",
      fallback: "该变体没有专属工艺，用的是标准工艺",
      template: "按产线模板拼装（尚未针对性维护）",
    })[source] ?? source;
    return ok(res, {
      model, variant, source, variants: await modelVariants(model), source_label: srcLabel,
      steps, segments: segs,
      total: liveAll.length, total_all: steps.length,
      total_disabled: steps.length - liveAll.length,
      total_sampling: liveAll.filter(x => x.is_sampling === 1).length,
      total_must: liveAll.filter(x => Number(x.is_must_pass || 0) === 1).length,
    });
  });

  // 全量保存某机型（某变体）的工艺；保存后自动同步到未锁站的总工单
  router.post("/route/process/save", requireMesrjPerm("route.edit"), async (req, res) => {
    const d = req.body || {};
    const model = (d.model || "").toString().trim();
    const variant = (d.variant || "").toString().trim();
    const steps = Array.isArray(d.steps) ? d.steps : [];
    if (!model) return fail(res, "请选择机型");
    if (!steps.length) return fail(res, "工步不能为空");
    const smap = {};
    for (const r of (await query(
      "SELECT station_code, station_name, short_name, process_code FROM md_station")).rows) {
      smap[r.station_code] = r;
    }
    // 同一工序 + 工位类型只能有一个启用站（同类型工位互斥，防止双站都校验）
    const tmap = {};
    for (const r of (await query(
      "SELECT station_code, process_code, type_code FROM md_station")).rows) {
      tmap[r.station_code] = [r.process_code || "", r.type_code || ""];
    }
    const seenPos = {}, dup = [];
    for (const s of steps) {
      const code = (s.station_code || "").toString().trim();
      if (!code || Number(s.enabled ?? 1) !== 1) continue;
      const [p, tp] = tmap[code] ?? ["", ""];
      if (!tp) continue;
      const key = `${p}|${tp}`;
      if (key in seenPos && seenPos[key] !== code) {
        const pname = (PROC_SEGMENTS.find(([x]) => x === p) ?? ["", p])[1];
        dup.push(`${pname} 的「${tp}」：${seenPos[key]} 与 ${code}`);
      } else seenPos[key] = code;
    }
    if (dup.length) {
      return fail(res, "同一工序的同一工位类型只能保留一个启用站（同类型工位互斥）：" + dup.slice(0, 3).join("；"));
    }
    const now = nowStr(), by = req.mesrjUser.login_name;
    await query(
      "DELETE FROM cfg_model_process WHERE model=$1 AND COALESCE(variant,'')=$2", [model, variant]);
    let n = 0, off = 0;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const code = (s.station_code || "").toString().trim();
      if (!code) continue;
      const st0 = smap[code] ?? {};
      const en = Number(s.enabled ?? 1) === 1 ? 1 : 0;
      const smp = await stationSampling(code);
      // 停用站不设校验点；抽检站也不设（查到才算过）
      const must = en && !smp && Number(s.is_must_pass || 0) === 1 ? 1 : 0;
      if (!en) off++;
      await query(
        `INSERT INTO cfg_model_process
         (model, variant, seq_no, station_code, station_name, process_code,
          is_must_pass, enabled, remark, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [model, variant, (i + 1) * 10, code,
         st0.short_name || st0.station_name || s.station_name || code,
         st0.process_code || s.process_code || "", must, en, s.remark || "", by, now]);
      n++;
    }
    await audit(by, "工艺路线", "保存机型工艺",
      variant ? `${model} / ${variant}` : `${model} / 标准`,
      `${n} 站（启用 ${n - off} / 停用 ${off}）`, req.ip);
    // 整段停用提醒：排产时该段将没有路线
    const empty = [];
    for (const [proc, pname] of PROC_SEGMENTS) {
      const alive = steps.some(s => {
        const st0 = smap[(s.station_code || "").toString().trim()] ?? {};
        return (st0.process_code || s.process_code || "") === proc
          && Number(s.enabled ?? 1) === 1;
      });
      if (!alive) empty.push(pname);
    }
    let msg = `已保存 ${model} 的工艺（${n} 站，启用 ${n - off}，停用 ${off}）`;
    if (empty.length) msg += `；⚠ ${empty.join("、")} 没有启用的工位`;
    // 保存即自动同步：只动还没锁路线的总工单
    let done = [], skipped = [];
    try {
      [done, skipped] = await syncModelGroups(model, by);
    } catch (e) {
      skipped = [{ group: "-", reason: `自动同步失败：${e.message}` }];
    }
    if (done.length) {
      msg += `；已自动同步 ${done.length} 个总工单（覆盖 ${done.reduce((a, x) => a + Object.keys(x.steps || {}).length, 0)} 张分工单）`;
    }
    if (skipped.length) msg += `；${skipped.length} 个总工单已过站冻结，未动`;
    return ok(res, {
      model, count: n, enabled: n - off, disabled: off, empty_segments: empty,
      synced: done, frozen_skipped: skipped, mo_pending: 0,
    }, msg);
  });

  // 把当前机型工艺同步到该机型「还没有锁路线」的总工单
  router.post("/route/process/sync-mo", requireMesrjPerm("route.edit"), async (req, res) => {
    const model = (req.body?.model || "").toString().trim();
    if (!model) return fail(res, "请选机型");
    const by = req.mesrjUser.login_name;
    const [done, skipped] = await syncModelGroups(model, by);
    await audit(by, "工艺路线", "同步工艺到未锁工单", model,
      `更新 ${done.length} 组 / 冻结跳过 ${skipped.length} 组`, req.ip);
    let msg = `已更新 ${done.length} 个总工单`;
    if (skipped.length) msg += `；${skipped.length} 个已过站冻结、未动`;
    return ok(res, {
      done, skipped,
      mo_n: done.reduce((a, x) => a + Object.keys(x.steps || {}).length, 0),
    }, msg);
  });

  // 清空机型维护的工艺，回到"按产线模板自动拼装"
  router.post("/route/process/reset", requireMesrjPerm("route.edit"), async (req, res) => {
    const model = (req.body?.model || "").toString().trim();
    if (!model) return fail(res, "请选择机型");
    const r = await query("DELETE FROM cfg_model_process WHERE model=$1 RETURNING id", [model]);
    await audit(req.mesrjUser.login_name, "工艺路线", "重置机型工艺", model, "回到模板", req.ip);
    return ok(res, { deleted: r.rows.length }, `${model} 已回到通用模板（下次打开按模板显示）`);
  });

  // 把一张工单的路线按当前机型工艺重锁（整组一起）
  router.post("/route/process/relock-mo", requireMesrjPerm("route.edit"), async (req, res) => {
    const moNo = (req.body?.mo_no || "").toString().trim();
    if (!moNo) return fail(res, "请选工单");
    const mo = (await query(
      `SELECT mo_no, status, process_code, fg_code, COALESCE(variant,'') AS variant
       FROM ord_mo WHERE mo_no=$1`, [moNo])).rows[0];
    if (!mo) return fail(res, "工单不存在", 404);
    const pm = (await query(
      "SELECT product_model FROM md_product WHERE product_code=$1", [mo.fg_code || ""])).rows[0];
    const model = pm?.product_model || "";
    if (!model) return fail(res, "工单的产品没有机型，无法按机型工艺重锁");
    // 优先用工单自己记的变体（自动线/手动线），否则走标准工艺
    const moVariant = (mo.variant || "").trim();
    const [steps] = await modelProcessLive(model, moVariant);
    if (!steps.length) return fail(res, "该机型没有启用的工位");
    const by = req.mesrjUser.login_name;
    const r = await lockGroup(moNo, model, steps, by);
    if (!r.ok) return fail(res, r.msg || "重锁失败");
    await audit(by, "工艺路线", "按机型工艺重锁工单路线", r.group_key,
      `共 ${r.total} 站 / ${Object.keys(r.steps).length} 张分工单`, req.ip);
    return ok(res, { mo_no: moNo, group_key: r.group_key, steps: r.steps, total: r.total },
      `${r.group_key} 已按机型工艺重锁 ${r.total} 站（覆盖 ${Object.keys(r.steps).length} 张分工单）`);
  });

  // 某机型的工位按工序列出 4 段（排产用）
  router.get("/route/process/segments", async (req, res) => {
    const model = (req.query.model || "").toString().trim();
    if (!model) return fail(res, "请选机型");
    const [steps, source] = await modelProcessLive(model);
    const out = {};
    for (const [proc] of PROC_SEGMENTS) {
      out[proc] = steps.filter(x => (x.process_code || "") === proc);
    }
    return ok(res, { model, source, segments: out });
  });

  // ═══ W5 cfg 域（源 api/cfg.py）══════════════════════════════════════════

  // SN 规则试号（推进 SEQ 计数——与真实取号同一算法）
  router.post("/cfg/sn/test", async (req, res) => {
    const d = req.body || {};
    const snType = (d.sn_type || "整机").toString().trim();
    const n = Math.max(1, Math.min(20, Number(d.count || 5)));
    const rule = (await query("SELECT * FROM cfg_sn_rule WHERE sn_type=$1", [snType])).rows[0];
    if (!rule) return fail(res, `没有「${snType}」的 SN 规则`);
    let segs;
    try { segs = JSON.parse(rule.segments || "[]"); } catch { return fail(res, "段定义不是合法 JSON（库内）"); }
    if (!segs.length) return fail(res, "段定义为空");
    const total = segs.reduce((a, s) => a + Number(s.len || 0), 0);
    const samples = [];
    for (let i = 0; i < n; i++) samples.push(await renderSn(rule, segs, true));
    const warn = total === Number(rule.total_len || 0) ? ""
      : `注意：段长度合计 ${total} 位与设定总长 ${rule.total_len} 位不一致`;
    return ok(res, { samples, seg_total: total, total_len: rule.total_len, warn }, warn || "试号成功");
  });

  // 保存 SN 规则（段长度合计必须等于总长——过站按总长校验）
  router.put("/cfg/sn/rule/:rid", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const rid = Number(req.params.rid);
    const d = { ...(req.body || {}) };
    let segs = d.segments;
    if (typeof segs === "string") {
      try { segs = JSON.parse(segs); } catch { return fail(res, "段定义不是合法 JSON"); }
    }
    if (Array.isArray(segs)) {
      const cur = (await query("SELECT total_len FROM cfg_sn_rule WHERE id=$1", [rid])).rows[0] ?? {};
      const total = Number(d.total_len || cur.total_len || 0);
      const n2 = segs.reduce((a, x) => a + Number(x?.len || 0), 0);
      if (total && n2 && n2 !== total) {
        return fail(res, `段长度合计 ${n2} 位与总长 ${total} 位不一致——生成的号会被过站校验拒收；请把某段的长度加减 ${total - n2} 位`);
      }
      d.total_len = total || n2;
      d.segments = JSON.stringify(segs);
    }
    delete d.id;
    const cols = await tableColumns("cfg_sn_rule");
    const keys = Object.keys(d).filter(k => cols.has(k));
    if (!keys.length) return fail(res, "没有可更新字段");
    await query(
      `UPDATE cfg_sn_rule SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")} WHERE id=$${keys.length + 1}`,
      [...keys.map(k => d[k]), rid]);
    await audit(req.mesrjUser.login_name, "配置中心", "改 SN 规则", String(rid), JSON.stringify(d), req.ip);
    return ok(res, null, "已保存");
  });

  // 防错总览（一眼看清哪些开、哪些关）
  router.get("/cfg/pokayoke/overview", async (req, res) => {
    const rows = (await query("SELECT * FROM cfg_pokayoke ORDER BY id")).rows;
    return ok(res, {
      rows,
      on: rows.filter(r => Number(r.enabled)).length,
      off: rows.filter(r => !Number(r.enabled)).length,
    });
  });

  // 启停防错规则
  router.post("/cfg/pokayoke/:rid/toggle", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const r = (await query("SELECT * FROM cfg_pokayoke WHERE id=$1", [req.params.rid])).rows[0];
    if (!r) return fail(res, "规则不存在", 404);
    const newv = Number(r.enabled) ? 0 : 1;
    await query("UPDATE cfg_pokayoke SET enabled=$1 WHERE id=$2", [newv, r.id]);
    await audit(req.mesrjUser.login_name, "配置中心", "启停防错规则", r.rule_key,
      `${r.enabled} -> ${newv}`, req.ip);
    return ok(res, { enabled: newv }, newv ? "已启用" : "已停用");
  });

  // 阈值分组返回
  router.get("/cfg/threshold/grouped", async (req, res) => {
    const rows = (await query("SELECT * FROM cfg_threshold ORDER BY apply_to, th_key")).rows;
    const groups = {};
    for (const r of rows) (groups[r.apply_to || "通用"] ??= []).push(r);
    return ok(res, Object.entries(groups).map(([k, v]) => ({ group: k, items: v })));
  });

  // 码值字典
  router.get("/cfg/dict/:type", async (req, res) => {
    const rows = (await query(
      "SELECT * FROM cfg_code_dict WHERE dict_type=$1 ORDER BY sort_no", [req.params.type])).rows;
    return ok(res, rows);
  });

  // PCB 激光码解码（+可选机型板种校验）
  router.get("/cfg/pcbcode/decode", async (req, res) => {
    const code = (req.query.code || "").toString().trim();
    const model = (req.query.model || "").toString().trim();
    const d = pcbDecode(code);
    if (model && d.ok) {
      const row = (await query(
        `SELECT pcb_code FROM cfg_pcb_code WHERE machine_model=$1 AND COALESCE(pcb_code,'')<>''`,
        [model])).rows[0];
      const [typeOk, typeMsg] = pcbCheckType(code, row?.pcb_code || "");
      d.type_ok = typeOk;
      d.type_msg = typeMsg;
      d.model = model;
    }
    return ok(res, d);
  });

  // ═══ W6a 生产执行 · 过站校验引擎（源 api/exec.py）══════════════════════════
  // 源 exec.py 全部 44 条路由；本波移植核心 10 条：
  //   POST /exec/pass                      过站（校验链全在这里）
  //   POST /exec/skip                      临时跳站（需权限 + 必填原因）
  //   POST /exec/release                   开跳站放行单
  //   POST /exec/release/:releaseNo/approve 审批放行单
  //   POST /exec/route/lock                给工单锁定路线快照
  //   POST /exec/route/change              临时变更工单路线（记审计）
  //   GET  /exec/route/temp                工单的临时路线（生效中 + 历史）
  //   POST /exec/route/restore             恢复标准路线
  //   GET  /exec/mo/:moNo/route            工单当前路线 + 每站完成情况 + drift
  //   GET  /exec/sn/next                   镭码机取号
  // 剩余（/exec/sn/:sn 履历、/exec/station/next|pending、/exec/repair|scrap、
  //       /exec/laser/*、/exec/device/health、/exec/aging、/exec/trace、/exec/report）
  // 归入 W6b / W6c 波次。

  /** 过站操作者（源 g.user） */
  const execUser = (req) => {
    const u = req.mesrjUser || {};
    return {
      id: u.id, login_name: u.login_name, emp_name: u.emp_name || u.login_name,
      emp_no: u.emp_no || "",
    };
  };

  // ── 过站 ──────────────────────────────────────────────────────────────────
  router.post("/exec/pass", requireMesrjPerm("prod.pass"), async (req, res) => {
    const d = req.body || {};
    // 人工扫码入口：设备侧（mesapi/StationPass）走 source=machine
    d.source = d.source || "manual";
    const r = await doPassInner(d, execUser(req), req.ip);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.data, r.msg);
  });

  // ── 临时跳站 ──────────────────────────────────────────────────────────────
  router.post("/exec/skip", requireMesrjPerm("prod.skip"), async (req, res) => {
    const d = req.body || {};
    const sn = (d.sn || "").trim();
    const stationCode = (d.station_code || "").trim();
    const reason = (d.reason || "").trim();
    if (!sn || !stationCode) return fail(res, "SN 与工位号必填");
    if (!reason) return fail(res, "跳站必须填原因（会记入审计日志）");
    const snRow = (await query("SELECT * FROM prd_sn WHERE sn=$1", [sn])).rows[0];
    if (!snRow) return fail(res, `SN 不存在：${sn}`);
    const st = (await query("SELECT * FROM md_station WHERE station_code=$1",
      [stationCode])).rows[0];
    if (!st) return fail(res, `工位不存在：${stationCode}`);
    const [steps] = await ensureMoRoute(snRow.mo_no || "", snRow.product_code || "");
    const step = await step_of(steps, stationCode);
    if (!step) {
      return fail(res, `工位 ${stationCode} 不在工单 ${snRow.mo_no} 的工艺路线里`);
    }
    const dup = (await query(
      "SELECT id FROM prd_skip_log WHERE sn=$1 AND station_code=$2", [sn, stationCode])).rows[0];
    if (dup) return fail(res, "该 SN 在这一站已经跳过过了");
    const u = req.mesrjUser || {};
    const operator = (d.operator || u.emp_name || u.login_name || "").trim();
    await query(
      `INSERT INTO prd_skip_log (sn, station_code, mo_no, skip_type, release_no,
       reason, operator, skip_time) VALUES ($1,$2,$3,'扫码跳过','',$4,$5,$6)`,
      [sn, stationCode, snRow.mo_no || "", reason, operator, nowStr()]);
    await audit(u.login_name, "生产执行", "临时跳站", sn,
      `跳过 ${stationCode}（${st.station_name}）：${reason}`, req.ip);
    return ok(res, { sn, station_code: stationCode },
      `已记录跳过：${st.station_name} ${stationCode}`);
  });

  // ── 跳站放行单 ────────────────────────────────────────────────────────────
  router.post("/exec/release", requireMesrjPerm("prod.release"), async (req, res) => {
    const d = req.body || {};
    const scope = (d.scope || "按SN").trim();
    const moNo = (d.mo_no || "").trim();
    const sn = (d.sn || "").trim();
    const stationCode = (d.station_code || "").trim();
    const reason = (d.reason || "").trim();
    if (scope !== "按SN" && scope !== "按工单") {
      return fail(res, "放行范围只能是「按SN」或「按工单」");
    }
    if (scope === "按SN" && !sn) return fail(res, "按SN放行必须填SN");
    if (scope === "按工单" && !moNo) return fail(res, "按工单放行必须填工单号");
    if (!stationCode) return fail(res, "必须指定被允许跳过的工位");
    if (!reason) return fail(res, "必须填放行原因");
    const st = (await query("SELECT id FROM md_station WHERE station_code=$1",
      [stationCode])).rows[0];
    if (!st) return fail(res, `工位不存在：${stationCode}`);
    const no = await genReleaseNo();
    const u = req.mesrjUser || {};
    const who = u.emp_name || u.login_name || "";
    const auto = d.auto_approve ? 1 : 0;
    await query(
      `INSERT INTO prd_pass_release (release_no, scope, mo_no, sn, station_code,
       valid_from, valid_to, max_times, used_times, reason, apply_by, approve_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12)`,
      [no, scope, moNo, sn, stationCode, d.valid_from || todayStr(), d.valid_to || "",
        Number(d.max_times || 1), reason, who, auto ? who : "", auto ? "已批准" : "待审"]);
    await audit(u.login_name, "生产执行", "开跳站放行单", no,
      `${scope} / ${sn || moNo} / ${stationCode} / ${reason}`, req.ip);
    return ok(res, { release_no: no, status: auto ? "已批准" : "待审" },
      `放行单 ${no} 已创建（${auto ? "已批准" : "待审"}）`);
  });

  router.post("/exec/release/:releaseNo/approve", requireMesrjPerm("prod.release"),
    async (req, res) => {
      const releaseNo = (req.params.releaseNo || "").trim();
      const d = req.body || {};
      const status = (d.status || "已批准").trim();
      if (status !== "已批准" && status !== "已驳回") {
        return fail(res, "审批结果只能是「已批准」或「已驳回」");
      }
      const r = (await query("SELECT * FROM prd_pass_release WHERE release_no=$1",
        [releaseNo])).rows[0];
      if (!r) return fail(res, "放行单不存在", 404);
      const u = req.mesrjUser || {};
      await query("UPDATE prd_pass_release SET status=$1, approve_by=$2 WHERE release_no=$3",
        [status, u.emp_name || u.login_name || "", releaseNo]);
      await audit(u.login_name, "生产执行", "审批跳站放行单", releaseNo, status, req.ip);
      return ok(res, null, `放行单 ${releaseNo} → ${status}`);
    });

  // 放行单列表（前端「跳站放行单」页用；源 exec.py 无此端点，为 UI 补）
  router.get("/exec/pass_release/list", async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(500, Math.max(1, Number(req.query.size || 50)));
    const off = (page - 1) * size;
    const where = [];
    const args = [];
    const st = (req.query.status || "").toString().trim();
    if (st) { args.push(st); where.push(`status=$${args.length}`); }
    const kw = (req.query.keyword || "").toString().trim();
    if (kw) {
      args.push(`%${kw}%`);
      where.push(`(release_no ILIKE $${args.length} OR sn ILIKE $${args.length} `
        + `OR mo_no ILIKE $${args.length} OR station_code ILIKE $${args.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number((await query(
      `SELECT COUNT(*)::int AS n FROM prd_pass_release ${clause}`, args)).rows[0]?.n || 0);
    const rows = (await query(
      `SELECT * FROM prd_pass_release ${clause} ORDER BY id DESC LIMIT $${args.length + 1} `
      + `OFFSET $${args.length + 2}`, [...args, size, off])).rows;
    return ok(res, { rows, total, page, size });
  });

  // ── 工单路线：锁定 / 变更 / 临时 / 恢复 ───────────────────────────────────
  router.post("/exec/route/lock", requireMesrjPerm("prod.route.change"), async (req, res) => {
    const d = req.body || {};
    const moNo = (d.mo_no || "").trim();
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    const routeCode = (d.route_code || "").trim();
    let rt = null;
    if (routeCode) {
      rt = (await query("SELECT * FROM proc_route WHERE route_code=$1", [routeCode])).rows[0];
      if (!rt) return fail(res, `工艺路线不存在：${routeCode}`);
    } else {
      rt = await pickRoute(mo.product_code, mo.process_code, mo.line_code, moNo);
      if (!rt) return fail(res, `产品 ${mo.product_code} 没有生效的工艺路线`);
    }
    const steps = await snapshotRouteSteps(rt.route_code);
    if (!steps.length) return fail(res, `路线 ${rt.route_code} 没有工序步骤`);
    const u = req.mesrjUser || {};
    const old = (await query("SELECT * FROM prd_mo_route WHERE mo_no=$1", [moNo])).rows[0];
    const data = {
      route_code: rt.route_code, route_name: rt.route_name, version: rt.version,
      snapshot: JSON.stringify(steps), step_count: steps.length, is_locked: 1,
      locked_by: u.login_name, locked_at: nowStr(), remark: d.remark || "手动锁定",
    };
    if (old) {
      await query(
        `UPDATE prd_mo_route SET route_code=$1, route_name=$2, version=$3, snapshot=$4,
         step_count=$5, is_locked=1, locked_by=$6, locked_at=$7, remark=$8 WHERE mo_no=$9`,
        [data.route_code, data.route_name, data.version, data.snapshot,
          data.step_count, data.locked_by, data.locked_at, data.remark, moNo]);
    } else {
      await query(
        `INSERT INTO prd_mo_route (mo_no, route_code, route_name, version, snapshot,
         step_count, is_locked, locked_by, locked_at, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [moNo, data.route_code, data.route_name, data.version, data.snapshot,
          data.step_count, 1, data.locked_by, data.locked_at, data.remark]);
    }
    if (old && old.route_code !== rt.route_code) {
      await query(
        `INSERT INTO prd_route_change (mo_no, change_type, old_route, new_route,
         old_snapshot, new_snapshot, reason, apply_by, approve_by, status,
         is_temp, expire_at, restored_at)
         VALUES ($1,'切换路线',$2,$3,$4,$5,$6,$7,$8,'已生效',0,'','')`,
        [moNo, old.route_code || "", rt.route_code, old.snapshot || "",
          data.snapshot, d.reason || "手动重锁", u.login_name, u.login_name]);
    }
    await audit(u.login_name, "生产执行", "锁定工单路线", moNo,
      `${rt.route_code} / ${steps.length} 步`, req.ip);
    return ok(res, { route_code: rt.route_code, steps: steps.length },
      `工单 ${moNo} 已锁定路线（${rt.route_code}，${steps.length} 步）`);
  });

  router.post("/exec/route/change", requireMesrjPerm("prod.route.change"), async (req, res) => {
    const d = req.body || {};
    const moNo = (d.mo_no || "").trim();
    const reason = (d.reason || "").trim();
    if (!moNo) return fail(res, "工单号必填");
    if (!reason) return fail(res, "变更工艺路线必须填原因（会记入审计日志）");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    const u = req.mesrjUser || {};
    const old = (await query("SELECT * FROM prd_mo_route WHERE mo_no=$1", [moNo])).rows[0];
    const hrs = Number(d.expire_hours || 0) || 0;
    const wantTemp = !!(d.is_temp || d.bypass_stations || hrs > 0);
    if (wantTemp) {
      const act = await activeTempRoute(moNo);
      if (act) {
        return fail(res, `该工单已有生效中的临时路线（${act.change_type || "临时变更"}），`
          + `请先「恢复标准路线」再变更`);
      }
    }
    let steps = null;
    let newCode = "", newName = "", newVer = "";

    if (d.new_route_code) {
      const rt = (await query("SELECT * FROM proc_route WHERE route_code=$1",
        [d.new_route_code])).rows[0];
      if (!rt) return fail(res, `工艺路线不存在：${d.new_route_code}`);
      steps = await snapshotRouteSteps(rt.route_code);
      newCode = rt.route_code; newName = rt.route_name; newVer = rt.version;
      if (!steps.length) return fail(res, `路线 ${rt.route_code} 没有工序步骤`);
    } else if (Array.isArray(d.bypass_stations) && d.bypass_stations.length && old) {
      // 设备异常：把指定工位临时摘掉，其它步骤原样保留
      try { steps = JSON.parse(old.snapshot || "[]"); } catch { steps = []; }
      if (!steps.length) return fail(res, "该工单还没有路线快照，无法跳过工位");
      const picked = new Set(d.bypass_stations.map(x => (x || "").trim()));
      const kept = steps.filter(st => !picked.has(st.station_code));
      if (!kept.length) return fail(res, "不能把所有工位都跳过");
      if (kept.length === steps.length) return fail(res, "选中的工位不在当前路线里");
      steps = kept;
      newCode = old.route_code;
      newName = `${old.route_name || old.route_code}（临时跳过工位）`;
      newVer = `TEMP-${todayStr().replace(/-/g, "")}`;
    } else if (Array.isArray(d.steps) && d.steps.length) {
      steps = [];
      for (let i = 0; i < d.steps.length; i++) {
        const s = d.steps[i];
        const sc = (s?.station_code || "").trim();
        if (!sc) continue;
        const stt = (await query("SELECT * FROM md_station WHERE station_code=$1",
          [sc])).rows[0];
        if (!stt) return fail(res, `工位不存在：${sc}`);
        steps.push({
          seq_no: (i + 1) * 10,
          process_code: stt.process_code || "",
          station_code: sc,
          station_name: stt.station_name || "",
          is_must_pass: [1, "1", true].includes(s.is_must_pass ?? 1) ? 1 : 0,
          allow_retest: [1, "1", true].includes(s.allow_retest ?? 1) ? 1 : 0,
          max_retest: Number(s.max_retest || 2),
          is_key_station: [1, "1", true].includes(s.is_key_station ?? 0) ? 1 : 0,
          remark: s.remark || "",
        });
      }
      if (!steps.length) return fail(res, "提交的步骤里没有有效工位");
      newCode = old?.route_code || "CUSTOM";
      newName = `${old?.route_name || "临时路线"}（工单专用）`;
      newVer = `TEMP-${todayStr().replace(/-/g, "")}`;
    } else {
      return fail(res, "请提供 new_route_code / bypass_stations / steps");
    }

    const snapshot = JSON.stringify(steps);
    if (old) {
      await query(
        `UPDATE prd_mo_route SET route_code=$1, route_name=$2, version=$3, snapshot=$4,
         step_count=$5, is_locked=1, locked_by=$6, locked_at=$7, remark=$8 WHERE mo_no=$9`,
        [newCode, newName, newVer, snapshot, steps.length, u.login_name, nowStr(),
          `临时变更：${reason}`, moNo]);
    } else {
      await query(
        `INSERT INTO prd_mo_route (mo_no, route_code, route_name, version, snapshot,
         step_count, is_locked, locked_by, locked_at, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [moNo, newCode, newName, newVer, snapshot, steps.length, 1, u.login_name, nowStr(),
          `临时变更：${reason}`]);
    }
    const isTemp = wantTemp ? 1 : 0;
    let expireAt = "";
    if (isTemp && hrs > 0) {
      const t = new Date(Date.now() + hrs * 3600 * 1000);
      const p = n => String(n).padStart(2, "0");
      expireAt = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} `
        + `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
    }
    const changeType = d.bypass_stations ? "临时跳过工位"
      : (isTemp ? "临时切换路线" : (d.new_route_code ? "切换路线" : "改步骤"));
    await query(
      `INSERT INTO prd_route_change (mo_no, change_type, old_route, new_route,
       old_snapshot, new_snapshot, reason, apply_by, approve_by, status,
       is_temp, expire_at, restored_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'')`,
      [moNo, changeType, old?.route_code || "", newCode, old?.snapshot || "", snapshot,
        reason, u.login_name, u.login_name, isTemp ? "生效中" : "已生效",
        isTemp, expireAt]);
    await audit(u.login_name, "生产执行", "变更工单路线", moNo,
      `「${newCode}」(${steps.length} 步）原因：${reason}`, req.ip);
    const tail = isTemp
      ? (expireAt ? `，有效期至 ${expireAt} 自动恢复` : "，处理完请手动恢复标准路线")
      : "";
    return ok(res, { route_code: newCode, steps: steps.length, is_temp: isTemp, expire_at: expireAt },
      `工单 ${moNo} 的工艺路线已变更（${steps.length} 步）${tail}`);
  });

  router.get("/exec/route/temp", async (req, res) => {
    const moNo = (req.query.mo_no || "").toString().trim();
    if (!moNo) return fail(res, "缺少工单号");
    const act = await activeTempRoute(moNo);
    const rows = (await query(
      "SELECT id, mo_no, change_type, old_route, new_route, reason, apply_by, status, "
      + "is_temp, expire_at, restored_at, created_at FROM prd_route_change "
      + "WHERE mo_no=$1 AND is_temp=1 ORDER BY id DESC LIMIT 20", [moNo])).rows;
    return ok(res, { mo_no: moNo, active: act, rows, now: nowStr() });
  });

  router.post("/exec/route/restore", requireMesrjPerm("prod.route.change"), async (req, res) => {
    const d = req.body || {};
    const moNo = (d.mo_no || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const act = await activeTempRoute(moNo);
    if (!act) return fail(res, "没有生效中的临时路线（可能已到期自动恢复）");
    const u = req.mesrjUser || {};
    const reason = (d.reason || "设备恢复，手动恢复标准路线").trim();
    await restoreTempRoute(moNo, act.id, u.login_name, reason);
    await audit(u.login_name, "生产执行", "恢复工单路线", moNo,
      `从临时路线「${act.new_route}」恢复「${act.old_route}」（${reason}）`, req.ip);
    return ok(res, { mo_no: moNo, route_code: act.old_route },
      `已恢复标准路线「${act.old_route}」`);
  });

  // 工单当前路线 + 每站完成情况 + 与当前工艺的差异（drift）
  router.get("/exec/mo/:moNo/route", async (req, res) => {
    const moNo = (req.params.moNo || "").trim();
    const mo = (await query(
      "SELECT mo_no, product_code, fg_code, plan_qty, status, process_code "
      + "FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, "工单不存在", 404);
    const [steps, meta] = await ensureMoRoute(moNo, mo.product_code);
    const temp = (await query(
      "SELECT id, change_type, reason, expire_at, apply_by, created_at, old_route "
      + "FROM prd_route_change WHERE mo_no=$1 AND is_temp=1 AND status='生效中' "
      + "ORDER BY id DESC LIMIT 1", [moNo])).rows[0] || null;
    if (!steps.length) {
      return ok(res, { mo, route: null, steps: [], temp, drift: null, model_process: null,
        group: null, sn_total: 0 });
    }
    // 每站过了多少 SN
    const stat = {};
    for (const r of (await query(
      "SELECT station_code, result, COUNT(*)::int AS c FROM prd_pass "
      + "WHERE mo_no=$1 GROUP BY station_code, result", [moNo])).rows) {
      const d = stat[r.station_code] || (stat[r.station_code] = { ok: 0, ng: 0 });
      if (r.result === "OK") d.ok += r.c; else d.ng += r.c;
    }
    const out = steps.map(s => {
      const d = stat[s.station_code] || { ok: 0, ng: 0 };
      return { ...s, pass_ok: d.ok, pass_ng: d.ng };
    });
    // ── 快照 vs 当前工艺（drift）──
    let drift = null, mp = null;
    try {
      const pm = (await query("SELECT product_model FROM md_product WHERE product_code=$1",
        [mo.fg_code || mo.product_code])).rows[0];
      const model = (pm?.product_model || "").trim();
      if (model) {
        const [live] = await modelProcessLive(model);
        const proc = (mo.process_code || "").trim();
        const cur = !proc ? live : live.filter(x => (x.process_code || "") === proc);
        if (cur.length) {
          const procName = !proc ? "整单"
            : (Object.fromEntries(PROC_SEGMENTS.map(p => [p[0], p[1]])))[proc] || proc;
          mp = {
            model, process_code: proc, process_name: procName, steps: cur.length,
            route_code: !proc ? `MP-${modelSlug(model)}` : `MP-${modelSlug(model)}-${proc}`,
          };
          const liveCodes = cur.map(x => x.station_code);
          const snapCodes = steps.map(y => y.station_code);
          if (liveCodes.join("|") !== snapCodes.join("|")) {
            drift = {
              model, model_steps: liveCodes.length, snapshot_steps: snapCodes.length,
              missing: liveCodes.filter(c => !snapCodes.includes(c)),
              extra: snapCodes.filter(c => !liveCodes.includes(c)),
            };
          }
        }
      }
    } catch { drift = null; mp = null; }
    // ── 组信息 ──
    let group = null;
    try {
      const gk = groupKeyOf(moNo);
      const gr = (await query("SELECT * FROM prd_mo_group_route WHERE group_key=$1",
        [gk])).rows[0];
      if (gr) {
        const members = (await query(
          "SELECT mo_no, process_code, status FROM ord_mo WHERE substring(mo_no,1,$1)=$2 "
          + "ORDER BY mo_no", [gk.length, gk])).rows;
        group = {
          key: gk, model: gr.model, route_code: gr.route_code,
          total_steps: gr.step_count, locked_at: gr.locked_at, locked_by: gr.locked_by,
          members,
        };
      }
    } catch { group = null; }
    const snTotal = (await query(
      "SELECT COUNT(*)::int AS n FROM prd_sn WHERE mo_no=$1", [moNo])).rows[0];
    return ok(res, {
      mo, route: meta, steps: out, temp, drift, model_process: mp, group,
      sn_total: Number(snTotal?.n || 0),
    });
  });

  // ── 镭码机取号（取号即预留：写占位行 status='已发放'）──────────────────────
  router.get("/exec/sn/next", requireMesrjPerm("prod.pass"), async (req, res) => {
    const snType = (req.query.sn_type || "PCBA").toString().trim();
    const [okRule, msgRule] = await snRuleOk(snType);
    if (!okRule) return fail(res, msgRule);
    const warn = snGenerateWarn(snType);
    const [sn, err] = await snAlloc(snType);
    if (!sn) return fail(res, err);
    return ok(res, { sn, sn_type: snType, warn });
  });

  // ── SN 池查询（分页，支持 mo_no / status / station_code / keyword 过滤）──
  router.get("/exec/sn/pool", async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(500, Math.max(1, Number(req.query.size || 50)));
    const off = (page - 1) * size;
    const where = [];
    const args = [];
    const moNo = (req.query.mo_no || "").trim();
    if (moNo) { args.push(moNo); where.push(`mo_no=$${args.length}`); }
    const status = (req.query.status || "").trim();
    if (status) { args.push(status); where.push(`status=$${args.length}`); }
    const st = (req.query.station_code || "").trim();
    if (st) { args.push(st); where.push(`cur_station=$${args.length}`); }
    const kw = (req.query.keyword || "").trim();
    if (kw) { args.push(`%${kw}%`); where.push(`(sn ILIKE $${args.length} OR product_code ILIKE $${args.length})`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number((await query(
      `SELECT COUNT(*)::int AS n FROM prd_sn ${clause}`, args)).rows[0]?.n || 0);
    const rows = (await query(
      `SELECT sn, sn_type, product_code, mo_no, line_code, cur_station, cur_seq, status,
              created_at, updated_at, sn_note
       FROM prd_sn ${clause} ORDER BY created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, off])).rows;
    return ok(res, { rows, total, page, size });
  });

  // ── SN 批次汇总（按 mo_no） ──
  // 注：旧只读路由 GET /exec/sn/rule 已退役（2026-11-20）。
  // SN 规则统一走通用 CRUD：/mesrj/cfg/snrule（表 cfg_sn_rule）。
  router.get("/exec/sn/batch", async (req, res) => {
    const moNo = (req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "缺少 mo_no");
    const rows = (await query(
      `SELECT mo_no, COUNT(*)::int AS sn_total,
              COUNT(*) FILTER (WHERE status='在制')::int AS wip,
              COUNT(*) FILTER (WHERE status='完成')::int AS done,
              COUNT(*) FILTER (WHERE status='报废')::int AS scrapped,
              MIN(created_at) AS first_sn, MAX(created_at) AS last_sn
       FROM prd_sn WHERE mo_no=$1 GROUP BY mo_no`, [moNo])).rows;
    return ok(res, rows);
  });

  // ── SN 作废 ──
  router.post("/exec/sn/void", requireMesrjPerm("prod.void"), async (req, res) => {
    const d = req.body || {};
    const sn = (d.sn || "").trim();
    const reason = (d.reason || "").trim();
    if (!sn) return fail(res, "SN 必填");
    if (!reason) return fail(res, "作废必须填原因");
    const r = (await query("SELECT id, status FROM prd_sn WHERE sn=$1", [sn])).rows[0];
    if (!r) return fail(res, `SN 不存在：${sn}`, 404);
    if (r.status === "报废") return fail(res, "SN 已作废，无需重复操作");
    const u = req.mesrjUser || {};
    await query("UPDATE prd_sn SET status='报废', updated_at=$1 WHERE sn=$2", [nowStr(), sn]);
    await audit(u.login_name, "生产执行", "SN 作废", sn, reason, req.ip);
    return ok(res, { sn, status: "报废" }, `SN ${sn} 已作废`);
  });

  // ── SN 详情（基础 + 过站记录 + 不良记录） ──
  router.get("/exec/sn/detail", async (req, res) => {
    const sn = (req.query.sn || "").trim();
    if (!sn) return fail(res, "缺少 sn");
    const snRow = (await query("SELECT * FROM prd_sn WHERE sn=$1", [sn])).rows[0];
    if (!snRow) return fail(res, `SN 不存在：${sn}`, 404);
    const passes = (await query(
      "SELECT station_code, result, ng_code, operator, pass_time, mark FROM prd_pass WHERE sn=$1 ORDER BY pass_time",
      [sn])).rows;
    const defects = (await query(
      "SELECT defect_code, station_code, process_code, root_cause, handle, defect_time FROM prd_defect_rec WHERE sn=$1 ORDER BY defect_time",
      [sn])).rows;
    return ok(res, { sn: snRow, passes, defects });
  });

  // ── SN 测试记录（AOI + 过站） ──
  router.get("/exec/sn/test", async (req, res) => {
    const sn = (req.query.sn || "").trim();
    if (!sn) return fail(res, "缺少 sn");
    const aoi = (await query(
      "SELECT final_result, test_time, device_name, project_name, file_name FROM prd_aoi_board WHERE board_sn=$1 ORDER BY test_time DESC",
      [sn])).rows;

    const passes = (await query(
      "SELECT station_code, result, ng_code, pass_time, mark FROM prd_pass WHERE sn=$1 ORDER BY pass_time DESC",
      [sn])).rows;
    return ok(res, { sn, aoi, passes });
  });
  // ── SN 规则自检（源 api/exec.py /exec/sn/rules + sn_generate_warn）──
  //   段长合计和总长不一致时页面直接置灰「发码」，别等人点了才报错。
  //   gen_warn 只提示不拦（客户规格允许镭雕机自己取号，挡死现场没法干活）。
  router.get("/exec/sn/rules", requireMesrjPerm(null), async (_req, res) => {
    const rows = (await query(
      `SELECT sn_type, total_len, segments, reset_cycle, enabled, remark
         FROM cfg_sn_rule ORDER BY id`)).rows;
    const out = rows.map(r => {
      let segs = [];
      try {
        const arr = JSON.parse(r.segments || "[]");
        segs = Array.isArray(arr) ? arr : [];
      } catch { segs = []; }
      const segSum = segs.reduce((s, x) => s + Number((x && x.len) || 0), 0);
      const total = Number(r.total_len || 0);
      return {
        sn_type: r.sn_type, total_len: total, seg_sum: segSum,
        reset_cycle: r.reset_cycle, enabled: r.enabled,
        ok: !!(segSum && (!total || segSum === total)),
        gen_warn: String(r.sn_type || "").trim() === "PCBA"
          ? "PCBA 镭雕码现场通常是镭雕机自己取号（序列连续递增）。如果这台设备也会自增，"
            + "MES 再发一遍会和它撞号 —— 发之前先确认设备是怎么取号的。"
          : "",
        segs: segs.map(x => ({ name: x && x.name, type: x && x.type, len: x && x.len,
          value: (x && x.value) || "" })),
      };
    });
    return ok(res, out);
  });

  // ── 工位下一站（给定 SN，返回下一待过站工位） ──
  router.get("/exec/station/next", async (req, res) => {
    const sn = (req.query.sn || "").trim();
    const stationCode = (req.query.station_code || "").trim();
    if (!sn) return fail(res, "缺少 sn");
    const snRow = (await query("SELECT * FROM prd_sn WHERE sn=$1", [sn])).rows[0];
    if (!snRow) return fail(res, `SN 不存在：${sn}`, 404);
    const [steps] = await ensureMoRoute(snRow.mo_no || "", snRow.product_code || "");
    if (!steps.length) return ok(res, { sn, next_station: null });
    const next = stationCode
      ? await next_station(steps, stationCode)
      : await next_pending_station(steps, sn);
    return ok(res, { sn, mo_no: snRow.mo_no, next_station: next });
  });

  // ── 工位待处理（指定工位当前待过站的 SN 列表） ──
  router.get("/exec/station/pending", async (req, res) => {
    const stationCode = (req.query.station_code || "").trim();
    if (!stationCode) return fail(res, "缺少 station_code");
    const st = (await query("SELECT * FROM md_station WHERE station_code=$1", [stationCode])).rows[0];
    if (!st) return fail(res, `工位不存在：${stationCode}`, 404);
    const rows = (await query(
      "SELECT sn, product_code, mo_no, cur_station, cur_seq, status, created_at FROM prd_sn "
      + "WHERE cur_station=$1 AND status='在制' ORDER BY created_at", [stationCode])).rows;
    return ok(res, { station_code: stationCode, station_name: st.station_name, rows });
  });

  // ── 过站列表（prd_pass 分页查询） ──
  router.get("/exec/pass/list", async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(500, Math.max(1, Number(req.query.size || 50)));
    const off = (page - 1) * size;
    const where = [];
    const args = [];
    const sn = (req.query.sn || "").trim();
    if (sn) { args.push(sn); where.push(`sn=$${args.length}`); }
    const moNo = (req.query.mo_no || "").trim();
    if (moNo) { args.push(moNo); where.push(`mo_no=$${args.length}`); }
    const stationCode = (req.query.station_code || "").trim();
    if (stationCode) { args.push(stationCode); where.push(`station_code=$${args.length}`); }
    const result = (req.query.result || "").trim();
    if (result) { args.push(result); where.push(`result=$${args.length}`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number((await query(
      `SELECT COUNT(*)::int AS n FROM prd_pass ${clause}`, args)).rows[0]?.n || 0);
    const rows = (await query(
      `SELECT id, sn, station_code, result, ng_code, operator, pass_time, mark FROM prd_pass ${clause} ORDER BY pass_time DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, off])).rows;
    return ok(res, { rows, total, page, size });
  });

  // ── 面板预览（工位面板布局配置） ──
  router.get("/exec/panel/preview", async (req, res) => {
    const stationCode = (req.query.station_code || "").trim();
    if (!stationCode) return fail(res, "缺少 station_code");
    const rows = (await query(
      "SELECT panel_key, panel_type, config_json, is_active FROM cfg_panel_layout WHERE station_code=$1 ORDER BY panel_key",
      [stationCode])).rows;
    return ok(res, { station_code: stationCode, panels: rows });
  });

  // ── 过站面板（综合看板：各工位 OK/NG/总数） ──
  router.get("/exec/pass/panel", async (req, res) => {
    const lineCode = (req.query.line_code || "").trim();
    const where = [];
    const args = [];
    if (lineCode) { args.push(lineCode); where.push(`p.line_code=$${args.length}`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = (await query(
      `SELECT p.station_code, s.station_name, p.line_code,
              COUNT(*) FILTER (WHERE p.result='OK')::int AS pass_ok,
              COUNT(*) FILTER (WHERE p.result='NG')::int AS pass_ng,
              COUNT(DISTINCT p.sn)::int AS sn_total
       FROM prd_pass p JOIN md_station s ON s.station_code=p.station_code
       ${clause} GROUP BY p.station_code, s.station_name, p.line_code ORDER BY p.station_code`,
      args)).rows;
    return ok(res, rows);
  });

  // ── W6c：返修登记 ──
  router.post("/exec/repair", requireMesrjPerm("prod.repair"), async (req, res) => {
    try {
      const d = await repairRegister(req.body || {});
      const u = req.mesrjUser || {};
      await audit(u.login_name, "生产执行", "SN 返修", d.sn, `返修次数：${d.repair_times}`, req.ip);
      return ok(res, d, "返修登记完成");
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：报废登记 ──
  router.post("/exec/scrap", requireMesrjPerm("prod.scrap"), async (req, res) => {
    try {
      const d = await scrapRegister(req.body || {});
      const u = req.mesrjUser || {};
      await audit(u.login_name, "生产执行", "SN 报废", d.sn, `原因：${(req.body || {}).reason || ""}`, req.ip);
      return ok(res, d, "报废登记完成");
    } catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：设备健康 ──
  router.get("/exec/device/health", async (req, res) => {
    try { return ok(res, await deviceHealth()); }
    catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：良率报表 ──
  router.get("/exec/yield", async (req, res) => {
    try { return ok(res, await yieldStats(req.query)); }
    catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：返修列表（分页） ──
  router.get("/exec/repair/list", async (req, res) => {
    try { return ok(res, await repairList(req.query)); }
    catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：工单物料 ──
  router.get("/exec/mo/materials", async (req, res) => {
    try { return ok(res, await moMaterials(req.query)); }
    catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：AI 工位 ──
  router.get("/exec/ai/stations", async (req, res) => {
    try { return ok(res, await aiStations()); }
    catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：老化分析 ──
  router.get("/exec/aging", async (req, res) => {
    try { return ok(res, await agingWip()); }
    catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：老化明细 ──
  router.get("/exec/aging/detail", async (req, res) => {
    try { return ok(res, await agingDetail(req.query)); }
    catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：物料追溯（按 SN） ──
  router.get("/exec/trace/material", async (req, res) => {
    try { return ok(res, await traceMaterialBySn(req.query)); }
    catch (ex) { return fail(res, ex.message); }
  });

  // ── W6c：物料追溯（按物料） ──
  router.get("/exec/trace/material/sns", async (req, res) => {
    try { return ok(res, await traceMaterialByMaterial(req.query)); }
    catch (ex) { return fail(res, ex.message); }
  });

  // ═══ W8 AOI 集成 + 出货报告模板（源 api/aoi.py + api/report.py）══════════
  //   GET    /aoi/dash                     AOI 看板（产量 + 质量 DPPM/DPMO/TrueFail/NDF）
  //   GET    /aoi/dict                     不良代码字典
  //   GET    /aoi/models                   机型下拉（含原始程序名 + 归一映射）
  //   GET    /aoi/compmap                  位号映射
  //   GET    /aoi/compmap/stat             位号映射统计
  //   POST   /aoi/compmap/import           位号映射批量导入
  //   GET    /aoi/imgstat                  图片目录统计
  //   GET    /aoi/img                      图片代理（proxy 模式）
  //   GET    /report/tpl/list              模板列表
  //   POST   /report/tpl/upload            上传模板
  //   GET    /report/tpl/:id               模板详情
  //   GET    /report/tpl/:id/cells         模板单元格（配置映射用）
  //   POST   /report/tpl/:id/mapping       保存字段映射
  //   POST   /report/tpl/:id/enable        启用/停用
  //   DELETE /report/tpl/:id               删除模板
  //   GET    /report/check                 生成前检查
  //   POST   /report/gen                   生成报告（返回 xlsx 下载）

  // ── AOI 看板 ──────────────────────────────────────────────────────────────
  router.get("/aoi/dash", requireMesrjPerm("prod.trace"), async (req, res) => {
    try {
      const q = req.query;
      const data = await aoiDash({
        days: (q.days || "7").toString(),
        day: (q.day || "").toString().trim(),
        device: (q.device || "").toString().trim(),
        model: (q.model || "").toString().trim(),
        station: (q.station || "").toString().trim(),
        by: (q.by || "model").toString().trim().toLowerCase(),
        tsFrom: (q.from || q.ts_from || "").toString().trim(),
        tsTo: (q.to || q.ts_to || "").toString().trim(),
      });
      return ok(res, data);
    } catch (ex) {
      console.error("[aoi/dash]", ex);
      return fail(res, `AOI 看板查询失败：${ex.message}`);
    }
  });

  // 不良代码字典（源 /aoi/dict）
  router.get("/aoi/dict", requireMesrjPerm("prod.trace"), async (req, res) => {
    const rows = (await query(
      "SELECT code, name_en, name_zh, category, remark, status FROM cfg_aoi_defect ORDER BY category, code"
    )).rows;
    return ok(res, rows);
  });

  // 机型 / 程序名下拉（源 /aoi/models）
  router.get("/aoi/models", requireMesrjPerm("prod.trace"), async (req, res) => {
    const progs = (await query(
      "SELECT DISTINCT project_name FROM prd_aoi_result WHERE COALESCE(project_name,'')<>''"
    )).rows.map(r => r.project_name);
    const pmap = await aoiBuildMap(progs);
    const cnt = {};
    for (const p of progs) {
      const m = pmap[p]?.model ?? p;
      if (!cnt[m]) cnt[m] = 0;
    }
    for (const r of (await query(
      "SELECT project_name, COUNT(*)::int AS n FROM prd_aoi_result "
      + "WHERE COALESCE(project_name,'')<>'' GROUP BY project_name")).rows) {
      const m = pmap[r.project_name]?.model ?? r.project_name;
      cnt[m] = (cnt[m] || 0) + Number(r.n || 0);
    }
    return ok(res, {
      models: Object.keys(cnt).filter(Boolean)
        .sort((a, b) => cnt[b] - cnt[a]).map(m => ({ model: m, n: cnt[m] })),
      programs: (await query(
        "SELECT project_name, COUNT(*)::int AS n FROM prd_aoi_result WHERE project_name<>'' "
        + "GROUP BY project_name ORDER BY n DESC")).rows
        .map(r => ({ program: r.project_name, n: r.n,
          model: pmap[r.project_name]?.model ?? r.project_name,
          mapped: pmap[r.project_name]?.hit ?? false })),
      unmapped: progs.filter(p => !pmap[p]?.hit).sort(),
    });
  });

  // 位号映射（源 /aoi/compmap）
  router.get("/aoi/compmap", requireMesrjPerm("prod.trace"), async (req, res) => {
    const model = (req.query.model || "").toString().trim();
    const rows = model
      ? (await query(
        "SELECT id, model, comp_id, designator, part_no, package, comp_type, remark "
        + "FROM cfg_aoi_comp_map WHERE model=$1 ORDER BY comp_id", [model])).rows
      : (await query(
        "SELECT id, model, comp_id, designator, part_no, package, comp_type, remark "
        + "FROM cfg_aoi_comp_map ORDER BY model, comp_id")).rows;
    return ok(res, rows);
  });

  // 位号映射统计（源 /aoi/compmap/stat）
  router.get("/aoi/compmap/stat", requireMesrjPerm("prod.trace"), async (req, res) => {
    const rows = (await query(
      "SELECT model, COUNT(*)::int AS n FROM cfg_aoi_comp_map GROUP BY model ORDER BY model"
    )).rows;
    const total = Number((await query(
      "SELECT COUNT(*)::int AS n FROM cfg_aoi_comp_map")).rows[0]?.n || 0);
    return ok(res, { rows, total });
  });

  // 位号映射批量导入（源 /aoi/compmap/import）：{model, rows:[{comp_id,designator}]}
  router.post("/aoi/compmap/import", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const model = (d.model || "").toString().trim();
    const rows = Array.isArray(d.rows) ? d.rows : [];
    if (!model) return fail(res, "请指定机型");
    if (!rows.length) return fail(res, "没有要导入的位号数据");
    let nOk = 0, skip = 0;
    for (const r of rows) {
      const compId = (r?.comp_id || r?.compId || "").toString().trim();
      const designator = (r?.designator || "").toString().trim();
      if (!compId || !designator) { skip++; continue; }
      await query(
        `INSERT INTO cfg_aoi_comp_map (model, comp_id, designator, part_no, package, comp_type, remark)
         VALUES ($1,$2,$3,'','','','')
         ON CONFLICT (model, comp_id) DO UPDATE SET designator=EXCLUDED.designator`,
        [model, compId, designator]);
      nOk++;
    }
    return ok(res, { ok: nOk, skip }, `已导入 ${nOk} 条位号映射${skip ? `，跳过 ${skip} 条` : ""}`);
  });

  // 图片目录统计（源 /aoi/imgstat）
  router.get("/aoi/imgstat", requireMesrjPerm("prod.trace"), async (req, res) => {
    const cfg = await aoiImgCfg();
    const out = { mode: cfg.mode, base: cfg.base, root: cfg.root, files: 0, dirs: 0, bytes: 0 };
    if (!cfg.root) {
      out.msg = "没有配 aoi.image_root（本机挂载目录）也没配 aoi.image_base（AOI 自带 HTTP 前缀）";
      return ok(res, out);
    }
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const root = cfg.root;
      if (!fs.existsSync(root)) {
        out.msg = `图片目录不存在：${root}`;
        return ok(res, out);
      }
      const walk = (dir, depth) => {
        if (depth > 6) return;
        let ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) { out.dirs++; walk(p, depth + 1); }
          else {
            out.files++;
            try { out.bytes += fs.statSync(p).size; } catch { /* ignore */ }
          }
        }
      };
      walk(root, 0);
    } catch (ex) {
      out.msg = `统计失败：${ex.message}`;
    }
    return ok(res, out);
  });

  // 图片代理（源 /aoi/img）：proxy 模式读本机挂载目录，base 模式回 302
  router.get("/aoi/img", requireMesrjPerm("prod.trace"), async (req, res) => {
    const cfg = await aoiImgCfg();
    const p = (req.query.path || "").toString();
    if (!p) return fail(res, "缺少 path");
    const rel = aoiRelImgPath(p);
    if (cfg.mode === "base") {
      return res.redirect(`${cfg.base}/${rel}`);
    }
    if (cfg.mode !== "proxy" || !cfg.root) {
      return fail(res, "图片接入未配置（aoi.image_root / aoi.image_base）");
    }
    const fs = await import("node:fs");
    const path = await import("node:path");
    const full = path.resolve(cfg.root, rel);
    if (!full.startsWith(path.resolve(cfg.root))) return fail(res, "非法路径", 400);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return fail(res, "图片不存在", 404);
    }
    res.type(full.endsWith(".png") ? "image/png" : "image/jpeg");
    return res.sendFile(full);
  });

  // ── 出货报告模板 ─────────────────────────────────────────────────────────
  router.get("/report/tpl/list", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kind = (req.query.kind || "").toString().trim();
    const rows = await listTpl(kind);
    return ok(res, {
      rows,
      kinds: Object.entries(KINDS).map(([key, name]) => ({ key, name })),
    });
  });

  router.post("/report/tpl/upload", requireMesrjPerm("prod.trace"), async (req, res) => {
    // 两种传法：multipart 文件上传，或 JSON {file_name, content_base64}
    const u = req.mesrjUser || {};
    let buffer = null, kind = KIND_COC, tplName = "", remark = "";
    const ct = (req.headers["content-type"] || "").toString();
    if (ct.includes("multipart/form-data")) {
      // express.json 不会解析 multipart；这里用原始 body（已在下方 middleware 处理）
      buffer = req.rawBody || null;
      kind = (req.query.kind || KIND_COC).toString();
      tplName = (req.query.tpl_name || "").toString();
      remark = (req.query.remark || "").toString();
    } else {
      const d = req.body || {};
      kind = (d.kind || KIND_COC).toString().trim();
      tplName = (d.tpl_name || "").toString().trim();
      remark = (d.remark || "").toString().trim();
      if (d.content_base64) {
        buffer = Buffer.from(String(d.content_base64), "base64");
      } else if (Array.isArray(d.content_b64)) {
        buffer = Buffer.from(d.content_b64.join(""), "base64");
      }
    }
    if (!buffer || !buffer.length) {
      return fail(res, "没有收到文件（请用 multipart 上传，或传 content_base64）");
    }
    const [tpl, err] = await saveUpload(buffer, kind, tplName, remark, u.login_name);
    if (err) return fail(res, err);
    return ok(res, tpl,
      `模板已保存，${(tpl?.sheets || []).length} 张表。接下来配置「哪个格子填什么」`);
  });

  router.get("/report/tpl/:id", requireMesrjPerm("prod.trace"), async (req, res) => {
    const tpl = await getTpl(Number(req.params.id));
    if (!tpl) return fail(res, "模板不存在", 404);
    return ok(res, tpl);
  });

  router.get("/report/tpl/:id/cells", requireMesrjPerm("prod.trace"), async (req, res) => {
    const sheet = (req.query.sheet || "").toString().trim();
    const [rows, err] = await tplCells(Number(req.params.id), sheet || null);
    if (err) return fail(res, err);
    return ok(res, { rows, fields: await allFields(), editable: fieldOptions() });
  });

  router.post("/report/tpl/:id/mapping", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const [tpl, err] = await saveMapping(Number(req.params.id), d.mapping || {});
    if (err) return fail(res, err);
    const n = Object.values(tpl?.mapping || {})
      .reduce((a, v) => a + Object.keys(v || {}).length, 0);
    return ok(res, tpl, `已保存 ${n} 个字段映射`);
  });

  router.post("/report/tpl/:id/enable", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const tpl = await toggleTpl(Number(req.params.id), !!d.enabled);
    if (!tpl) return fail(res, "模板不存在", 404);
    return ok(res, tpl, tpl.enabled ? "已启用" : "已停用");
  });

  router.delete("/report/tpl/:id", requireMesrjPerm("prod.trace"), async (req, res) => {
    const [okDel, err] = await deleteTpl(Number(req.params.id));
    if (err) return fail(res, err);
    return ok(res, {}, "已删除");
  });

  // 生成前检查（源 /report/check）
  router.get("/report/check", requireMesrjPerm("prod.trace"), async (req, res) => {
    const poNo = (req.query.po_no || "").toString().trim();
    const r = await precheck(poNo);
    const view = {};
    for (const k of ["po_no", "cust_name", "product_model", "plan_qty", "ship_qty",
      "pallet_n", "box_n", "oqc_no", "oqc_result", "insp_date_slash", "ship_date_dot",
      "ship_qty_pcs", "signer", "signer_title", "vendor_name"]) {
      view[k] = r.ctx?.[k] ?? "";
    }
    return ok(res, { ok: r.ok, warnings: r.warnings, fields: view, editable: fieldOptions() });
  });

  // 生成报告（源 /report/gen）：返回 xlsx 下载
  router.post("/report/gen", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const tplId = Number(d.tpl_id);
    const poNo = (d.po_no || "").toString().trim();
    if (!tplId) return fail(res, "请选择模板");
    const r = await genReport(tplId, poNo, d.overrides || {});
    if (!r.buffer) return fail(res, (r.warnings || []).join("；") || "生成失败");
    const u = req.mesrjUser || {};
    await audit(u.login_name, "出货报告", "生成报告", poNo, `填入 ${r.filled || 0} 个单元格`);
    if (d.download === false) {
      return ok(res, { name: r.name, filled: r.filled || 0, warnings: r.warnings }, "已生成");
    }
    res.setHeader("Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",
      `attachment; filename="${encodeURIComponent(r.name)}"`);
    return res.send(r.buffer);
  });

  // ── W9：员工资质与上岗（源 emp.py 自定义接口）─────────────────────────

  function _nowStr() {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }
  function _todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  async function _empStationSkills(station_code) {
    const st = (await query("SELECT station_code, type_code FROM md_station WHERE station_code=$1", [station_code])).rows[0];
    const out = [], seen = new Set();
    const rows = (await query("SELECT skill_code FROM cfg_station_skill WHERE station_code=$1 ORDER BY id", [station_code])).rows;
    for (const r of rows) {
      if (r.skill_code && !seen.has(r.skill_code)) { seen.add(r.skill_code); out.push(r.skill_code); }
    }
    if (out.length) return _empSkillNames(out);
    if (st && st.type_code) {
      const rows2 = (await query("SELECT skill_code FROM cfg_station_skill WHERE station_code='' AND type_code=$1 ORDER BY id", [st.type_code])).rows;
      for (const r of rows2) {
        if (r.skill_code && !seen.has(r.skill_code)) { seen.add(r.skill_code); out.push(r.skill_code); }
      }
    }
    return _empSkillNames(out);
  }

  async function _empSkillNames(codes) {
    if (!codes.length) return [];
    const ph = codes.map((_, i) => `$${i + 1}`).join(",");
    const m = {};
    const rs = (await query(`SELECT skill_code, skill_name FROM cfg_skill WHERE skill_code IN (${ph})`, codes)).rows;
    for (const r of rs) m[r.skill_code] = r.skill_name;
    return codes.map(c => ({ skill_code: c, skill_name: m[c] || c }));
  }

  async function _empEmployee(emp_no) {
    const r = (await query("SELECT * FROM md_employee WHERE emp_no=$1", [(emp_no || "").trim()])).rows[0];
    return r || null;
  }

  async function _empCertOf(emp_no, skill_code) {
    const r = (await query("SELECT * FROM prd_emp_cert WHERE emp_no=$1 AND skill_code=$2", [emp_no, skill_code])).rows[0];
    return r || null;
  }

  function _empCertState(cert) {
    if (!cert) return "无证";
    let st = cert.status || "合格";
    const exp = (cert.expire_date || "").trim();
    const today = _todayStr();
    if (st === "合格" && exp && exp < today) return "过期";
    return st;
  }

  async function _empActiveAuth(emp_no, station_code) {
    const now = _nowStr();
    const r = (await query(
      "SELECT * FROM prd_emp_auth WHERE emp_no=$1 AND station_code=$2 AND status='有效' AND (expire_at='' OR expire_at>=$3) ORDER BY id DESC LIMIT 1",
      [emp_no, station_code, now])).rows[0];
    return r || null;
  }

  async function _empCheckEnabled() {
    const v = await getParam("emp.check_enabled", "0");
    return ["1", "true", "on"].includes(String(v || "0").trim());
  }

  async function _empCheck(emp_no, station_code) {
    emp_no = String(emp_no || "").trim();
    if (!emp_no) return { ok: false, code: "NO_EMP", msg: "没有识别到员工工号", temp: 0 };
    const emp = await _empEmployee(emp_no);
    if (!emp) return { ok: false, code: "NO_EMP", msg: `工号 ${emp_no} 不在员工档案里`, temp: 0 };
    if (Number(emp.status || 0) !== 1) {
      return { ok: false, code: "LEFT", emp, msg: `${emp.emp_name || emp_no} 已离职，不能上岗`, temp: 0 };
    }
    const need = await _empStationSkills(station_code);
    if (!need.length) {
      return { ok: true, code: "NO_SKILL", emp, temp: 0, msg: "该工位未配置资质要求" };
    }
    const bad = [];
    for (const s of need) {
      const c = await _empCertOf(emp_no, s.skill_code);
      if (_empCertState(c) !== "合格") bad.push({ skill_code: s.skill_code, skill_name: s.skill_name, state: _empCertState(c) });
    }
    if (!bad.length) {
      return { ok: true, code: "OK", emp, temp: 0, msg: `${emp.emp_name || emp_no} 资质有效` };
    }
    const au = await _empActiveAuth(emp_no, station_code);
    if (au) {
      return { ok: true, code: "BY_AUTH", emp, temp: 1, auth: au, bad,
        msg: `${emp.emp_name || emp_no} 资质不合规，凭班长临时授权放行（至 ${(au.expire_at || "").slice(0, 16)}）` };
    }
    const b0 = bad[0];
    const label = { "无证": "没有", "不合格": "考核不合格", "过期": "已过期", "停用": "已停用" }[b0.state] || b0.state;
    const code = { "无证": "NO_CERT", "不合格": "FAILED", "过期": "EXPIRED", "停用": "DISABLED" }[b0.state] || "NO_CERT";
    return { ok: false, code, emp, bad, temp: 0,
      msg: `${emp.emp_name || emp_no} 的「${b0.skill_name}」资质${label}，不能操作该工位（请联系班长）` };
  }

  async function _empRecordExam(emp_no, skill_code, exam_date, score, passed, examiner, remark, valid_months, emp_name) {
    emp_no = String(emp_no || "").trim();
    if (!emp_no || !skill_code) return [false, "工号和资质项必填"];
    const emp = await _empEmployee(emp_no);
    if (!emp) return [false, `工号 ${emp_no} 不在员工档案里（请先建员工）`];
    const name = emp_name || emp.emp_name || "";
    await query(
      `INSERT INTO prd_emp_exam (emp_no, emp_name, skill_code, exam_date, score, pass, examiner, remark, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [emp_no, name, skill_code, exam_date || _todayStr(),
       score !== null && score !== "" ? Number(score) : null,
       passed ? 1 : 0, examiner || "", remark || "", _nowStr()]);
    let exp = "";
    if (passed && Number(valid_months || 0) > 0) {
      try {
        const base = new Date((exam_date || _todayStr()).slice(0, 10));
        exp = new Date(base.getTime() + 30 * Number(valid_months) * 86400000).toISOString().slice(0, 10);
      } catch { exp = ""; }
    }
    const sk = (await query("SELECT skill_name FROM cfg_skill WHERE skill_code=$1", [skill_code])).rows[0];
    const data = {
      emp_no, skill_code, skill_name: (sk && sk.skill_name) || "", pass_date: exam_date || _todayStr(),
      expire_date: exp, status: passed ? "合格" : "不合格",
      exam_score: score !== null && score !== "" ? Number(score) : null, source: "考核", updated_at: _nowStr(),
    };
    const old = await _empCertOf(emp_no, skill_code);
    if (old) {
      await query(`UPDATE prd_emp_cert SET skill_code=$2, skill_name=$3, pass_date=$4, expire_date=$5, status=$6, exam_score=$7, source=$8, updated_at=$9 WHERE id=$1`,
        [old.id, data.skill_code, data.skill_name, data.pass_date, data.expire_date, data.status, data.exam_score, data.source, data.updated_at]);
    } else {
      await query(`INSERT INTO prd_emp_cert (emp_no, skill_code, skill_name, pass_date, expire_date, status, exam_score, source, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [data.emp_no, data.skill_code, data.skill_name, data.pass_date, data.expire_date, data.status, data.exam_score, data.source, data.updated_at]);
    }
    return [true, `已记录：${name} ${skill_code} ${passed ? "合格" : "不合格"}`];
  }

  async function _empOnDuty(station_code) {
    const r = (await query("SELECT * FROM prd_emp_login WHERE station_code=$1 AND status='在岗' ORDER BY id DESC LIMIT 1", [station_code])).rows[0];
    return r || null;
  }

  router.get("/emp/overview", requireMesrjPerm("prod.trace"), async (req, res) => {
    const total = Number((await query("SELECT COUNT(*)::int AS n FROM md_employee WHERE status=1")).rows[0].n || 0);
    const certs = Number((await query("SELECT COUNT(*)::int AS n FROM prd_emp_cert WHERE status='合格'")).rows[0].n || 0);
    const failed = Number((await query("SELECT COUNT(*)::int AS n FROM prd_emp_cert WHERE status='不合格'")).rows[0].n || 0);
    const today = _todayStr();
    let soon = 0, expired = 0;
    const rows = (await query("SELECT expire_date, status FROM prd_emp_cert WHERE status='合格' AND COALESCE(expire_date,'')<>''")).rows;
    for (const r of rows) {
      try {
        const d = String(r.expire_date || "").slice(0, 10);
        if (!d) continue;
        if (d < today) expired += 1;
        else if (new Date(d).getTime() - new Date(today).getTime() <= 30 * 86400000) soon += 1;
      } catch { continue; }
    }
    const onDuty = Number((await query("SELECT COUNT(*)::int AS n FROM prd_emp_login WHERE status='在岗'")).rows[0].n || 0);
    const now = _nowStr();
    const authActive = Number((await query("SELECT COUNT(*)::int AS n FROM prd_emp_auth WHERE status='有效' AND (expire_at='' OR expire_at>=$1)", [now])).rows[0].n || 0);
    return ok(res, {
      emp_total: total, cert_ok: certs, cert_failed: failed,
      cert_expiring: soon, cert_expired: expired,
      check_enabled: await _empCheckEnabled(),
      on_duty: onDuty, auth_active: authActive,
    });
  });

  router.get("/emp/check", requireMesrjPerm("prod.trace"), async (req, res) => {
    const emp_no = String(req.query.emp_no || "").trim();
    const station_code = String(req.query.station_code || "").trim();
    if (!station_code) return fail(res, "请给工位");
    const r = await _empCheck(emp_no, station_code);
    r.need = await _empStationSkills(station_code);
    r.enabled = await _empCheckEnabled();
    return ok(res, r);
  });

  router.post("/emp/exam/entry", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [okk, msg] = await _empRecordExam(
      d.emp_no, d.skill_code, String(d.exam_date || _todayStr()).slice(0, 10),
      d.score, Boolean(Number(d.pass || 1) || 0),
      (req.mesrjUser || {}).emp_name || (req.mesrjUser || {}).login_name || "",
      d.remark || "", Number(d.valid_months || 0));
    if (!okk) return fail(res, msg);
    await audit((req.mesrjUser || {}).login_name || "", "员工资质", "录入考核",
      `${d.emp_no} / ${d.skill_code}`, msg);
    return ok(res, null, msg);
  });

  router.post("/emp/exam/import", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const text = String(d.text || "").trim();
    if (!text) return fail(res, "内容为空，请粘贴表格");
    const skills = {};
    const srows = (await query("SELECT skill_code, skill_name FROM cfg_skill")).rows;
    for (const r of srows) {
      skills[String(r.skill_code || "").toUpperCase()] = r.skill_code;
      skills[String(r.skill_name || "").trim().toUpperCase()] = r.skill_code;
    }
    const by = (req.mesrjUser || {}).login_name || "";
    let okN = 0; const errs = [];
    const passLine = Number(d.pass_line || 60);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (i === 0 && (/工号/.test(line) || /emp/i.test(line))) continue;
      const parts = line.replace("\t", ",").split(",").map(x => x.trim());
      if (parts.length < 4) {
        errs.push(`第 ${i + 1} 行字段不够（要 工号,姓名,资质项,成绩[,日期,月数]）：${line}`);
        continue;
      }
      const [emp_no, name, skill_raw, score] = parts;
      const exam_date = (parts[4] || _todayStr()).slice(0, 10);
      const months = parts[5] || "0";
      const sc = skills[String(skill_raw).toUpperCase()];
      if (!sc) { errs.push(`第 ${i + 1} 行：不认识资质项「${skill_raw}」`); continue; }
      let score_v;
      try { score_v = score ? Number(score) : null; } catch { score_v = null; }
      const passed = score_v === null ? true : score_v >= passLine;
      let months_v;
      try { months_v = Number(parseFloat(months || 0)); } catch { months_v = 0; }
      const [okk, msg] = await _empRecordExam(emp_no, sc, exam_date, score_v, passed, by, "批量导入", months_v, name);
      if (okk) okN++; else errs.push(`第 ${i + 1} 行：${msg}`);
    }
    await audit(by, "员工资质", "批量导入考核", "", `成功 ${okN} / 失败 ${errs.length}`);
    return ok(res, { ok: okN, failed: errs.length, errors: errs.slice(0, 50) },
      `导入完成：成功 ${okN} 条，失败 ${errs.length} 条`);
  });

  router.post("/emp/login", requireMesrjPerm("prod.pass"), async (req, res) => {
    const d = req.body || {};
    const emp_no = String(d.emp_no || "").trim();
    const station_code = String(d.station_code || "").trim();
    if (!station_code) return fail(res, "请选择工位");
    const r = await _empCheck(emp_no, station_code);
    if (!r.ok) return ok(res, { accepted: false, msg: r.msg, code: r.code, emp: r.emp || null }, r.msg);
    const st = (await query("SELECT line_code, station_name, short_name FROM md_station WHERE station_code=$1", [station_code])).rows[0];
    const old = await _empOnDuty(station_code);
    if (old && old.emp_no !== emp_no) {
      await query("UPDATE prd_emp_login SET status='已离岗', out_at=$1 WHERE id=$2", [_nowStr(), old.id]);
    }
    const now = _nowStr();
    await query(`INSERT INTO prd_emp_login (emp_no, emp_name, station_code, line_code, work_date, shift_code, in_at, status, bind_by, remark)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [emp_no, (r.emp || {}).emp_name || "", station_code, (st && st.line_code) || "", _todayStr(),
       String(d.shift_code || "").trim(), now, "在岗", (req.mesrjUser || {}).login_name || "",
       r.temp ? "临时授权上岗" : ""]);
    await audit((req.mesrjUser || {}).login_name || "", "员工资质", "上岗", emp_no,
      `${station_code} / ${r.msg}`);
    return ok(res, { accepted: true, emp: r.emp || null, temp: r.temp, msg: `${(r.emp || {}).emp_name} 已上岗：${r.msg}`},
      `${(r.emp || {}).emp_name} 已上岗`);
  });

  router.post("/emp/logout", requireMesrjPerm("prod.pass"), async (req, res) => {
    const d = req.body || {};
    const emp_no = String(d.emp_no || "").trim();
    const station_code = String(d.station_code || "").trim();
    if (!emp_no && !station_code) return fail(res, "给工号或工位");
    let sql = "SELECT * FROM prd_emp_login WHERE status='在岗'";
    const args = [];
    if (emp_no) { sql += " AND emp_no=$" + (args.length + 1); args.push(emp_no); }
    if (station_code) { sql += " AND station_code=$" + (args.length + 1); args.push(station_code); }
    const rows = (await query(sql, args)).rows;
    if (!rows.length) return fail(res, "没有在岗记录");
    for (const r of rows) {
      await query("UPDATE prd_emp_login SET status='已离岗', out_at=$1 WHERE id=$2", [_nowStr(), r.id]);
    }
    return ok(res, { count: rows.length }, `已离岗 ${rows.length} 条`);
  });

  router.get("/emp/duty", requireMesrjPerm("prod.pass"), async (req, res) => {
    const rows = (await query("SELECT * FROM prd_emp_login WHERE status='在岗' ORDER BY station_code")).rows;
    for (const r of rows) {
      const st = (await query("SELECT short_name, station_name FROM md_station WHERE station_code=$1", [r.station_code])).rows[0];
      r.station_name = st ? (st.short_name || st.station_name) : r.station_code;
    }
    return ok(res, rows);
  });

  router.post("/emp/auth", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const emp_no = String(d.emp_no || "").trim();
    const station_code = String(d.station_code || "").trim();
    if (!emp_no || !station_code) return fail(res, "工号和工位必填");
    if (!(await _empEmployee(emp_no))) return fail(res, `工号 ${emp_no} 不在员工档案里`);
    const reason = String(d.reason || "").trim();
    if (!reason) return fail(res, "临时授权必须写原因（会记入审计）");
    let hours;
    try { hours = Number(d.hours || 4); } catch { hours = 4; }
    const exp = new Date(Date.now() + hours * 3600000).toISOString().slice(0, 19).replace("T", " ");
    const sks = await _empStationSkills(station_code);
    await query(`INSERT INTO prd_emp_auth (emp_no, station_code, skill_code, authorized_by, reason, expire_at, status, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [emp_no, station_code, sks.map(s => s.skill_code).join(","),
       (req.mesrjUser || {}).emp_name || (req.mesrjUser || {}).login_name || "", reason, exp, "有效", _nowStr()]);
    await audit((req.mesrjUser || {}).login_name || "", "员工资质", "临时授权", emp_no,
      `${station_code} / ${hours}H / ${reason}`);
    return ok(res, { expire_at: exp }, `已授权至 ${exp.slice(0, 16)}`);
  });

  router.post("/emp/auth/revoke", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const aid = d.id;
    if (!aid) return fail(res, "缺少 id");
    await query("UPDATE prd_emp_auth SET status='已撤销' WHERE id=$1", [aid]);
    await audit((req.mesrjUser || {}).login_name || "", "员工资质", "撤销授权", String(aid));
    return ok(res, null, "已撤销");
  });

  router.get("/emp/auth/list", requireMesrjPerm("prod.trace"), async (req, res) => {
    const rows = (await query("SELECT * FROM prd_emp_auth ORDER BY id DESC LIMIT 200")).rows;
    const now = _nowStr();
    for (const r of rows) {
      if (r.status === "有效" && r.expire_at && r.expire_at < now) r.status = "已过期";
    }
    return ok(res, rows);
  });

  // ── W9：工程变更（源 ecn.py，17 路由，eng_change/item/flow 三表）────────
  // 数据库时区：时间列全是 varchar（与 migration 285 一致），统一用 nowStr() "YYYY-MM-DD HH:MM:SS"。

  function _ecnF(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  async function _ecnSafeSum(tbl, materialCode) {
    if (!materialCode) return 0;
    try {
      const r = await query(`SELECT COALESCE(SUM(qty),0) AS s FROM ${tbl} WHERE material_code=$1`, [materialCode]);
      return Number(r.rows[0] && r.rows[0].s != null ? r.rows[0].s : 0);
    } catch { return 0; } // erp_stock/erp_inventory 可能尚未建，评估不许因表缺失挂掉
  }

  async function _ecnGenNo(type = "ECN") {
    const day = todayStr().slice(0, 10).replace(/-/g, "").slice(2);
    const pre = `${(type || "ECN").toUpperCase()}-${day}-`;
    let n = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change WHERE ecn_no LIKE $1", [pre + "%"])).rows[0].n || 0) + 1;
    while ((await query("SELECT 1 FROM eng_change WHERE ecn_no=$1", [pre + String(n).padStart(3, "0")])).rows[0]) n += 1;
    return pre + String(n).padStart(3, "0");
  }

  async function _ecnFlow(ecnNo, node, action, actor, opinion = "") {
    await query("INSERT INTO eng_change_flow (ecn_no,node,action,actor,opinion,at) VALUES ($1,$2,$3,$4,$5,$6)",
      [ecnNo, node, action, actor || "", opinion || "", nowStr()]);
  }

  async function _ecnOne(ecnNo) {
    const r = await query("SELECT * FROM eng_change WHERE ecn_no=$1", [ecnNo]);
    return r.rows[0] || null;
  }

  async function _ecnItems(ecnNo) {
    const r = await query("SELECT * FROM eng_change_item WHERE ecn_no=$1 ORDER BY seq_no, id", [ecnNo]);
    return r.rows;
  }

  async function _ecnFlows(ecnNo) {
    const r = await query("SELECT * FROM eng_change_flow WHERE ecn_no=$1 ORDER BY id", [ecnNo]);
    return r.rows;
  }

  function _ecnMoGe(a, b) {
    a = String(a || "").trim(); b = String(b || "").trim();
    if (!b) return true;
    if (!a) return false;
    if (a.length === b.length) return a >= b;
    try { return Number(a) >= Number(b); } catch { return a >= b; }
  }

  async function _ecnEvaluate(ecnNo) {
    const e = await _ecnOne(ecnNo);
    if (!e) return { ok: false, msg: `变更单不存在：${ecnNo}` };
    const pc = String(e.product_code || "").trim();
    const oldMat = String(e.old_material || "").trim();
    let mos = [], wip = 0, done = 0, pallets = 0;
    if (pc) {
      try {
        mos = (await query("SELECT mo_no,product_code,plan_qty,out_qty,line_code,status,plan_start,po_no FROM ord_mo WHERE product_code=$1 AND COALESCE(status,'') NOT IN ('已完工','已关闭','取消','已取消') ORDER BY mo_no", [pc])).rows;
      } catch { mos = []; }
    }
    try {
      wip = Number((await query("SELECT COUNT(*)::int AS n FROM prd_sn WHERE COALESCE(status,'') IN ('在制','待修','待检')" + (pc ? " AND product_code=$2" : ""), pc ? [pc] : [])).rows[0].n || 0);
    } catch {}
    try {
      done = Number((await query("SELECT COUNT(*)::int AS n FROM prd_sn WHERE COALESCE(status,'') IN ('已完工','已入库','已出货')" + (pc ? " AND product_code=$2" : ""), pc ? [pc] : [])).rows[0].n || 0);
    } catch {}
    const stockM = await _ecnSafeSum("erp_stock", oldMat);
    const stockW = await _ecnSafeSum("erp_inventory", oldMat);
    if (pc) {
      try {
        pallets = Number((await query("SELECT COUNT(*)::int AS n FROM prd_pallet WHERE COALESCE(oqc_status,'')<>'' AND COALESCE(po_no,'')<>'' AND COALESCE(product_code,'')=$1", [pc])).rows[0].n || 0);
      } catch {}
    }
    const impact = {
      product_code: pc, at: nowStr(), open_mo_count: mos.length,
      open_mos: mos.slice(0, 50), wip_qty: wip, done_qty: done,
      old_material: oldMat, old_stock_mes: _ecnF(stockM), old_stock_wms: _ecnF(stockW),
      old_stock: Math.max(stockM, stockW), pallets, verdict: "",
    };
    const bits = [];
    if (impact.open_mo_count) bits.push(`受影响未完工工单 ${impact.open_mo_count} 个`);
    if (impact.wip_qty) bits.push(`在制 ${impact.wip_qty} 台`);
    if (impact.done_qty) bits.push(`已产出 ${impact.done_qty} 台`);
    if (oldMat) bits.push(`旧料 ${oldMat} 库存 ${impact.old_stock}`);
    if (impact.pallets) bits.push(`已封板 ${impact.pallets} 板（一旦出货只能做售后）`);
    impact.verdict = bits.join("；") || "未指定产品/物料，影响面需人工确认";
    await query("UPDATE eng_change SET impact_json=$1, updated_at=$2 WHERE ecn_no=$3", [JSON.stringify(impact), nowStr(), ecnNo]);
    await _ecnFlow(ecnNo, "影响评估", "评估", "system", impact.verdict);
    return { ok: true, impact };
  }

  // 字典 / 看板：登录即可
  router.get("/ecn/meta", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const TYPES = [["ECN", "ECN 工程变更（内部）"], ["PCN", "PCN 产品变更通知（对客户）"], ["DEV", "DEV 临时偏离（一次性放行）"]];
    const REASONS = [["customer","客户要求"],["design","设计改进"],["cost","成本/替代料"],["material","物料停产/缺料"],["process","工艺/设备变更"],["supplier","供应商变更"],["regulation","法规/环保"],["quality","质量改善"],["other","其他"]];
    const EFFECTIVITY = [["now","立即生效（批准即切换）"],["date","指定日期起生效"],["mo","指定工单起生效"],["run_out_old","用完旧料后切换（人工确认）"]];
    const ITEM_TYPES = ["物料","BOM","工艺路线","工装治具","检验标准","包装","标签","设备程序","SOP","培训","软件/固件"];
    const ACTIONS = ["替换","新增","取消","升版","参数调整","无变化"];
    const RISK = ["低","中","高"];
    const STATUS = ["草稿","待审批","已批准","执行中","待验证","已关闭","已拒绝","已取消"];
    const stats = await _ecnStats();
    return ok(res, {
      types: TYPES.map(([v, t]) => ({ v, t })),
      reasons: REASONS.map(([v, t]) => ({ v, t })),
      effectivity: EFFECTIVITY.map(([v, t]) => ({ v, t })),
      item_types: ITEM_TYPES, actions: ACTIONS, risk: RISK, status: STATUS, stats,
    });
  });

  router.get("/ecn/list", requireMesrjPerm("prod.trace"), async (req, res) => {
    const a = req.query;
    const status = String(a.status || "").trim();
    const kw = String(a.kw || "").trim();
    const product = String(a.product || "").trim();
    const ecnType = String(a.type || "").trim();
    const limit = Math.min(Math.max(parseInt(a.limit || "200", 10) || 200, 1), 1000);
    const w = ["1=1"], args = [];
    if (status) {
      if (status === "未完结") w.push("status IN ('待审批','已批准','执行中','待验证')");
      else { w.push(`status=$${args.length + 1}`); args.push(status); }
    }
    if (ecnType) { w.push(`ecn_type=$${args.length + 1}`); args.push(ecnType); }
    if (product) { w.push(`(product_code LIKE $${args.length + 1} OR product_model LIKE $${args.length + 2})`); args.push(`%${product}%`, `%${product}%`); }
    if (kw) { w.push(`(ecn_no LIKE $${args.length + 1} OR title LIKE $${args.length + 2} OR old_material LIKE $${args.length + 3} OR new_material LIKE $${args.length + 4} OR ref_no LIKE $${args.length + 5})`); args.push(`%${kw}%`,`%${kw}%`,`%${kw}%`,`%${kw}%`,`%${kw}%`); }
    const rows = (await query(
      `SELECT id,ecn_no,ecn_type,title,change_reason,product_code,product_model,old_material,new_material,effectivity,effective_date,effective_mo_no,risk_level,status,need_fai,need_customer,block_pass,owner,dept,impact_json,created_at,approved_at,effective_at,fai_result,customer_reply FROM eng_change WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT $${args.length + 1}`, [...args, limit])).rows;
    const out = [];
    for (const r of rows) {
      const d = { ...r };
      try { const imp = JSON.parse(d.impact_json || "{}"); d.impact_verdict = imp.verdict || ""; d.wip_qty = imp.wip_qty || 0; d.open_mo_count = imp.open_mo_count || 0; d.old_stock = imp.old_stock || 0; } catch { d.impact_verdict = ""; d.wip_qty = 0; d.open_mo_count = 0; d.old_stock = 0; }
      delete d.impact_json;
      out.push(d);
    }
    return ok(res, { rows: out, stats: await _ecnStats() });
  });

  router.get("/ecn/:ecn_no", requireMesrjPerm("prod.trace"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, `变更单不存在：${ecnNo}`);
    const d = { ...e };
    try { d.impact = JSON.parse(d.impact_json || "{}"); } catch { d.impact = {}; }
    d.items = await _ecnItems(ecnNo);
    d.flows = await _ecnFlows(ecnNo);
    // 当前该不该生效（对默认工单/现在）
    let mo = String(d.effective_mo_no || "").trim();
    if (!mo) {
      try { mo = String((await query("SELECT mo_no FROM ord_mo WHERE product_code=$1 ORDER BY mo_no DESC LIMIT 1", [d.product_code || ""])).rows[0]?.mo_no || ""); } catch { mo = ""; }
    }
    const hit = _ecnMoGe(mo, d.effective_mo_no || "") && (d.effectivity || "now") === "now";
    d.switch_now = { hit: hit ? 1 : 0, why: hit ? "立即生效" : "未切换", probe_mo: mo };
    return ok(res, d);
  });

  const _ECN_FIELDS = ("ecn_type,title,change_reason,reason_note,customer_code,ref_no,product_code,product_model,po_no,line_code,bom_from,bom_to,old_material,new_material,old_qty,new_qty,unit,before_desc,after_desc,effectivity,effective_date,effective_mo_no,risk_level,need_fai,need_customer,block_pass,owner,dept").split(",");

  router.post("/ecn/create", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const typ = String(d.ecn_type || "ECN").trim().toUpperCase();
    if (!["ECN", "PCN", "DEV"].includes(typ)) return fail(res, "变更类型只支持 ECN / PCN / DEV");
    if (!String(d.title || "").trim()) return fail(res, "变更主题不能为空");
    if (!String(d.product_code || "").trim() && !String(d.old_material || "").trim()) return fail(res, "至少填「成品编码」或「旧物料编码」之一，否则影响面算不出来");
    const no = await _ecnGenNo(typ);
    const data = {};
    for (const k of _ECN_FIELDS) {
      let v = d[k];
      if (k === "old_qty" || k === "new_qty") v = _ecnF(v);
      else if (k === "need_fai" || k === "need_customer" || k === "block_pass") v = ["1","true","on","yes"].includes(String(v).toLowerCase()) ? 1 : 0;
      else v = v === null || v === undefined ? "" : String(v).trim();
      data[k] = v;
    }
    data.ecn_no = no; data.ecn_type = typ;
    data.effectivity = data.effectivity || "now";
    data.risk_level = data.risk_level || "中";
    data.unit = data.unit || "PCS";
    data.status = "草稿";
    data.created_by = user; data.created_at = nowStr(); data.updated_at = nowStr();
    const cols = Object.keys(data);
    await query(`INSERT INTO eng_change (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map(c => data[c]));
    await _ecnFlow(no, "建单", "创建", user, data.title || "");
    await audit(user, "工程变更", "建单", no, data.title || "");
    return ok(res, { ecn_no: no }, `已建单 ${no}（草稿）`);
  });

  router.post("/ecn/:ecn_no/update", requireMesrjPerm("prod.trace"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, "变更单不存在");
    if (!["草稿", "待审批"].includes(e.status || "")) return fail(res, `只有「草稿 / 待审批」状态能改内容；已批准的变更要改，请作废后另开一张（留痕）`);
    const sets = [], args = [];
    for (const k of Object.keys(d)) {
      if (!_ECN_FIELDS.includes(k)) continue;
      let v = d[k];
      if (k === "old_qty" || k === "new_qty") v = _ecnF(v);
      else if (k === "need_fai" || k === "need_customer" || k === "block_pass") v = ["1","true","on","yes"].includes(String(v).toLowerCase()) ? 1 : 0;
      else v = v === null || v === undefined ? "" : String(v).trim();
      sets.push(`${k}=$${args.length + 1}`); args.push(v);
    }
    if (!sets.length) return fail(res, "没有要更新的字段");
    sets.push(`updated_at=$${args.length + 1}`); args.push(nowStr());
    args.push(ecnNo);
    await query(`UPDATE eng_change SET ${sets.join(",")} WHERE ecn_no=$${args.length}`, args);
    await _ecnFlow(ecnNo, "修改", "更新", user, sets.slice(0, -1).map(s => s.split("=")[0]).join(","));
    return ok(res, null, "已保存");
  });

  router.post("/ecn/:ecn_no/evaluate", requireMesrjPerm("prod.trace"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const r = await _ecnEvaluate(ecnNo);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.impact, `影响评估：${r.impact.verdict}`);
  });

  router.post("/ecn/:ecn_no/items", requireMesrjPerm("prod.trace"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, "变更单不存在");
    if (!["草稿", "待审批", "已批准", "执行中"].includes(e.status || "")) return fail(res, `当前状态（${e.status}）不能加执行项`);
    if (!String(d.item_type || "").trim()) return fail(res, "请选变更对象类型");
    const seq = Number((await query("SELECT IFNULL(MAX(seq_no),0) AS m FROM eng_change_item WHERE ecn_no=$1", [ecnNo])).rows[0].m || 0) + 1;
    const rid = (await query("INSERT INTO eng_change_item (ecn_no,seq_no,item_type,target,before_val,after_val,action,owner,remark) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id", [ecnNo, seq, d.item_type || "", d.target || "", d.before_val || "", d.after_val || "", d.action || "", d.owner || user, d.remark || ""])).rows[0].id;
    await query("UPDATE eng_change SET updated_at=$1 WHERE ecn_no=$2", [nowStr(), ecnNo]);
    return ok(res, { id: rid }, "已加执行项");
  });

  router.delete("/ecn/item/:item_id", requireMesrjPerm("prod.trace"), async (req, res) => {
    const itemId = Number(req.params.item_id);
    const user = (req.mesrjUser || {}).login_name || "";
    const r = (await query("SELECT * FROM eng_change_item WHERE id=$1", [itemId])).rows[0];
    if (!r) return fail(res, "执行项不存在");
    if (Number(r.done || 0)) return fail(res, "已完成的执行项不能删（留痕）");
    await query("DELETE FROM eng_change_item WHERE id=$1", [itemId]);
    return ok(res, null, "已删除");
  });

  router.post("/ecn/item/:item_id/done", requireMesrjPerm("prod.trace"), async (req, res) => {
    const itemId = Number(req.params.item_id);
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const done = !["0", "false"].includes(String(d.done));
    const r = (await query("SELECT * FROM eng_change_item WHERE id=$1", [itemId])).rows[0];
    if (!r) return fail(res, "执行项不存在");
    const e = await _ecnOne(r.ecn_no);
    if (!e) return fail(res, "变更单不存在");
    if (!["已批准", "执行中", "待验证"].includes(e.status || "")) return fail(res, `只有已批准的变更单可以勾执行项（当前 ${e.status}）`);
    if (done) {
      await query("UPDATE eng_change_item SET done=1, done_at=$1, done_by=$2 WHERE id=$3", [nowStr(), user, itemId]);
    } else {
      await query("UPDATE eng_change_item SET done=0, done_at='', done_by='' WHERE id=$1", [itemId]);
    }
    const left = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change_item WHERE ecn_no=$1 AND done=0", [r.ecn_no])).rows[0].n || 0);
    const total = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change_item WHERE ecn_no=$1", [r.ecn_no])).rows[0].n || 0);
    if (left === 0 && total > 0 && ["已批准", "执行中"].includes(e.status || "")) {
      await query("UPDATE eng_change SET status='待验证', updated_at=$1 WHERE ecn_no=$2", [nowStr(), r.ecn_no]);
      await _ecnFlow(r.ecn_no, "执行", "全部执行项完成 → 待验证", user, "");
    } else if (left > 0 && (e.status || "") === "已批准") {
      await query("UPDATE eng_change SET status='执行中', updated_at=$1 WHERE ecn_no=$2", [nowStr(), r.ecn_no]);
    }
    return ok(res, { left }, (done ? "已执行" : "已取消执行") + (left ? `；还剩 ${left} 条未执行` : "；执行项已全部完成"));
  });

  function _ecnSwitchHit(e, moNo, at = "") {
    const eff = String(e.effectivity || "now").toLowerCase();
    at = at || nowStr();
    if (eff === "now") return { hit: true, why: "立即生效" };
    if (eff === "date") {
      const d = String(e.effective_date || "").trim();
      if (!d) return { hit: false, why: "未填生效日期" };
      return { hit: at.slice(0, 10) >= d.slice(0, 10), why: `生效日 ${d}` };
    }
    if (eff === "mo") {
      const base = String(e.effective_mo_no || "").trim();
      if (!base) return { hit: false, why: "未填生效工单" };
      return { hit: _ecnMoGe(moNo, base), why: `生效工单 ${base} 起` };
    }
    if (eff === "run_out_old") {
      const st = String(e.status || "");
      if (["执行中", "待验证", "已关闭"].includes(st) && String(e.effective_at || "")) return { hit: true, why: `旧料已用完，${String(e.effective_at).slice(0, 16)} 切换` };
      return { hit: false, why: "等旧料用完（人工确认后才切换）" };
    }
    return { hit: false, why: `未知切换方式：${eff}` };
  }

  async function _ecnPassAction() {
    const v = String(await getParam("ecn.pass_action", "warn") || "warn").trim().toLowerCase();
    return ["warn", "block"].includes(v) ? v : "warn";
  }

  async function _ecnPassWarn(moNo) {
    moNo = String(moNo || "").trim();
    if (!moNo) return [];
    let mo;
    try { mo = (await query("SELECT product_code, po_no FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0]; } catch { return []; }
    if (!mo) return [];
    const pc = String(mo.product_code || "");
    let rows;
    try {
      rows = (await query(
        `SELECT ecn_no,ecn_type,title,status,effectivity,effective_date,effective_mo_no,block_pass,product_code,old_material,new_material,risk_level FROM eng_change WHERE status IN ('已批准','执行中','待验证') AND (product_code=$1 OR (COALESCE(product_code,'')='' AND COALESCE(old_material,'')<>'' AND old_material IN (SELECT b.material_code FROM bom_item b WHERE b.product_code=$2 AND b.version=(SELECT version FROM bom_header WHERE product_code=$3 AND COALESCE(status,'生效')='生效' ORDER BY version DESC LIMIT 1)))) ORDER BY id DESC LIMIT 8`, [pc, pc, pc])).rows;
    } catch { return []; }
    const out = [];
    for (const e of rows) {
      const { hit, why } = _ecnSwitchHit(e, moNo);
      out.push({ ecn_no: e.ecn_no, ecn_type: e.ecn_type, title: e.title, status: e.status, risk_level: e.risk_level, old_material: e.old_material, new_material: e.new_material, hit: hit ? 1 : 0, why, block_pass: Number(e.block_pass || 0) });
      if (out.length >= 2) break;
    }
    return out;
  }

  async function _ecnStats() {
    let byType = {}, open = 0, pending = 0, executing = 0, verifying = 0, overdue = 0, newIn = 0, waitCustomer = 0, blockPass = 0;
    try {
      const bt = (await query("SELECT ecn_type, COUNT(*)::int AS n FROM eng_change GROUP BY ecn_type")).rows;
      for (const r of bt) byType[r.ecn_type] = r.n;
      const cut = (d => { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; })(new Date(Date.now() - 30 * 86400000));
      open = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change WHERE status IN ('待审批','已批准','执行中','待验证')")).rows[0].n || 0);
      pending = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change WHERE status='待审批'")).rows[0].n || 0);
      executing = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change WHERE status IN ('已批准','执行中')")).rows[0].n || 0);
      verifying = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change WHERE status='待验证'")).rows[0].n || 0);
      overdue = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change WHERE status IN ('已批准','执行中','待验证') AND COALESCE(approved_at,'')<>'' AND NULLIF(approved_at,'')::timestamp < now() - interval '30 days'")).rows[0].n || 0);
      newIn = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change WHERE created_at>=$1", [cut])).rows[0].n || 0);
      waitCustomer = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change WHERE ecn_type='PCN' AND need_customer=1")).rows[0].n || 0);
      blockPass = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change WHERE block_pass=1 AND status IN ('已批准','执行中','待验证')")).rows[0].n || 0);
    } catch {}
    return { open, pending_approve: pending, executing, verifying, overdue, new_in_range: newIn, wait_customer: waitCustomer, block_pass: blockPass, by_type: byType, pass_action: await _ecnPassAction() };
  }

  router.post("/ecn/:ecn_no/submit", requireMesrjPerm("prod.trace"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const user = (req.mesrjUser || {}).login_name || "";
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, "变更单不存在");
    if (!["草稿", "待审批"].includes(e.status || "")) return fail(res, `当前状态（${e.status}）不能提交审批`);
    if (!String(e.before_desc || "").trim() || !String(e.after_desc || "").trim()) return fail(res, "「变更前」「变更后」都要写清楚，审批人要看得懂改了什么");
    if ((e.effectivity || "") === "date" && !String(e.effective_date || "").trim()) return fail(res, "切换方式是「指定日期」，请填生效日期");
    if ((e.effectivity || "") === "mo" && !String(e.effective_mo_no || "").trim()) return fail(res, "切换方式是「指定工单」，请填生效工单号");
    const items = await _ecnItems(ecnNo);
    if (!items.length && !String(e.old_material || e.bom_to || e.new_material || "").trim()) return fail(res, "请至少加一条执行项（改哪个物料/BOM/工艺/检验标准）");
    const r = await _ecnEvaluate(ecnNo);
    if (!r.ok) return fail(res, r.msg);
    await query("UPDATE eng_change SET status='待审批', submitted_at=$1, updated_at=$2 WHERE ecn_no=$3", [nowStr(), nowStr(), ecnNo]);
    await _ecnFlow(ecnNo, "提交", "提交审批", user, r.impact.verdict || "");
    await audit(user, "工程变更", "提交审批", ecnNo, r.impact.verdict || "");
    return ok(res, { impact: r.impact }, `已提交审批（影响评估：${r.impact.verdict}）`);
  });

  router.post("/ecn/:ecn_no/approve", requireMesrjPerm("prod.release"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const ok = !["0", "false", "no"].includes(String(d.ok ?? true).toLowerCase());
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, "变更单不存在");
    if ((e.status || "") !== "待审批") return fail(res, `只有「待审批」能审批（当前 ${e.status}）`);
    if (ok) {
      const eff = String(e.effectivity || "now").toLowerCase();
      const st = eff === "now" ? "执行中" : "已批准";
      const effAt = eff === "now" ? nowStr() : "";
      await query("UPDATE eng_change SET status=$1, approved_at=$2, approved_by=$3, effective_at=$4, updated_at=$5 WHERE ecn_no=$6", [st, nowStr(), user, effAt, nowStr(), ecnNo]);
      await _ecnFlow(ecnNo, "审批", "批准", user, d.opinion || "");
      await audit(user, "工程变更", "批准", ecnNo, `切换方式 ${e.effectivity}${effAt ? "，立即生效" : ""}`, "");
      return ok(res, { status: st, effective_at: effAt }, `已批准${effAt ? "，立即生效（已进入执行）" : ""}`);
    }
    await query("UPDATE eng_change SET status='已拒绝', approved_by=$1, updated_at=$2 WHERE ecn_no=$3", [user, nowStr(), ecnNo]);
    await _ecnFlow(ecnNo, "审批", "驳回", user, d.opinion || "");
    await audit(user, "工程变更", "驳回", ecnNo, d.opinion || "", "");
    return ok(res, { status: "已拒绝" }, "已驳回");
  });

  router.post("/ecn/:ecn_no/effective", requireMesrjPerm("prod.trace"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, "变更单不存在");
    if (!["已批准", "执行中", "待验证"].includes(e.status || "")) return fail(res, `只有已批准的变更单能标记切换（当前 ${e.status}）`);
    if ((e.effectivity || "") !== "run_out_old") return fail(res, "只有「用完旧料后切换」需要人工确认切换时间");
    const mat = String(e.old_material || "");
    const stock = Math.max(await _ecnSafeSum("erp_stock", mat), await _ecnSafeSum("erp_inventory", mat));
    if (stock > 0 && !String(d.note || "").trim()) return fail(res, `旧料 ${mat} 账上还有 ${stock}，确认已用完请填一句说明（如：剩余已退回仓库/已挪用到 XXX 单）`);
    await query("UPDATE eng_change SET effective_at=$1, status=CASE WHEN status='已批准' THEN '执行中' ELSE status END, updated_at=$2 WHERE ecn_no=$3", [nowStr(), nowStr(), ecnNo]);
    await _ecnFlow(ecnNo, "切换", "标记旧料已用完", user, d.note || "");
    return ok(res, { effective_at: nowStr() }, `已标记切换生效（${nowStr()}）`);
  });

  router.post("/ecn/:ecn_no/fai", requireMesrjPerm("prod.trace"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, "变更单不存在");
    if (!["已批准", "执行中", "待验证"].includes(e.status || "")) return fail(res, `当前状态（${e.status}）不能做首件验证`);
    const r = String(d.result || "OK").toUpperCase();
    if (r !== "OK" && r !== "NG") return fail(res, "验证结果只能是 OK / NG");
    await query("UPDATE eng_change SET fai_result=$1, fai_note=$2, verify_result=$3, verify_note=$4, updated_at=$5 WHERE ecn_no=$6", [r, d.note || "", r === "OK" ? "通过" : "不通过", d.note || "", nowStr(), ecnNo]);
    await _ecnFlow(ecnNo, "首件验证", `FAI ${r}`, user, d.note || "");
    return ok(res, { fai_result: r }, `首件验证：${r}`);
  });

  router.post("/ecn/:ecn_no/close", requireMesrjPerm("prod.release"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, "变更单不存在");
    if ((e.status || "") === "已关闭") return fail(res, "已经关闭了");
    if (Number(e.need_fai || 0) && (e.fai_result || "") !== "OK") return fail(res, "本变更要求首件验证（FAI），请先做验证并判 OK 再关闭");
    const left = Number((await query("SELECT COUNT(*)::int AS n FROM eng_change_item WHERE ecn_no=$1 AND done=0", [ecnNo])).rows[0].n || 0);
    if (left) return fail(res, `还有 ${left} 条执行项没完成，不能关闭`);
    await query("UPDATE eng_change SET status='已关闭', closed_at=$1, closed_by=$2, updated_at=$3 WHERE ecn_no=$4", [nowStr(), user, nowStr(), ecnNo]);
    await _ecnFlow(ecnNo, "关闭", "关闭变更", user, d.note || "");
    await audit(user, "工程变更", "关闭", ecnNo, d.note || "", "");
    return ok(res, { status: "已关闭" }, "已关闭");
  });

  router.post("/ecn/:ecn_no/cancel", requireMesrjPerm("prod.release"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, "变更单不存在");
    if (["已关闭", "已取消"].includes(e.status || "")) return fail(res, `已经${e.status}了`);
    if ((e.status || "") === "执行中" && !String(d.note || "").trim()) return fail(res, "已进入执行中，作废必须填原因（可能是已部分执行，要留痕）");
    await query("UPDATE eng_change SET status='已取消', updated_at=$1, verify_note=$2 WHERE ecn_no=$3", [nowStr(), d.note || "", ecnNo]);
    await _ecnFlow(ecnNo, "作废", "取消", user, d.note || "");
    await audit(user, "工程变更", "作废", ecnNo, d.note || "", "");
    return ok(res, { status: "已取消" }, "已作废");
  });

  router.post("/ecn/:ecn_no/customer", requireMesrjPerm("prod.trace"), async (req, res) => {
    const ecnNo = String(req.params.ecn_no || "").trim();
    const d = req.body || {};
    const user = (req.mesrjUser || {}).login_name || "";
    const e = await _ecnOne(ecnNo);
    if (!e) return fail(res, "变更单不存在");
    if ((e.ecn_type || "") !== "PCN") return fail(res, "只有 PCN（对客户变更通知）需要记录客户回复");
    const reply = String(d.reply || "").trim();
    if (!reply) return fail(res, "请填客户回复（同意 / 不同意 / 有条件同意）");
    await query("UPDATE eng_change SET customer_reply=$1, customer_reply_at=$2, customer_approver=$3, need_customer=0, updated_at=$4 WHERE ecn_no=$5", [reply, nowStr(), String(d.approver || "").trim(), nowStr(), ecnNo]);
    await _ecnFlow(ecnNo, "客户回复", reply, user, `客户批准人：${d.approver || "-"}`);
    return ok(res, { customer_reply: reply }, "客户回复已记录");
  });

  router.get("/ecn/pass-warn", requireMesrjPerm("prod.trace"), async (req, res) => {
    const mo = String(req.query.mo_no || "").trim();
    return ok(res, { rows: await _ecnPassWarn(mo), action: await _ecnPassAction() });
  });

  // ── W10：辅料管控（源 api/smta.py，31 路由）──────────────────────────────
  //   锡膏/红胶回温追溯 · 钢网寿命（按印刷次数）· 刮刀寿命 + 上/下机绑定
  //   SMT 站位绑码（贴片上料防呆唯一数据源）· 时间阈值 · 钢网印刷参数
  //   GKG 印刷机 CSV · PDA 三合一扫码 · 按工单追辅料
  // 时间列全为 varchar（与 migration 286 一致），统一用 nowStr() "YYYY-MM-DD HH:MM:SS"。

  // ── 源 api/smta.py 辅助函数 ──────────────────────────────────────────────

  /** 源 _parse_dt：解析 "YYYY-MM-DD[ HH:MM[:SS]]"（本地时区） */
  function _smtaDt(s) {
    const t = String(s || "").trim().replace("T", " ");
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  /** 源 _hours：b - a 的小时数（保留 2 位） */
  function _smtaHours(a, b) {
    const da = _smtaDt(a), dbb = _smtaDt(b);
    if (!da || !dbb) return 0;
    return Math.round(((dbb.getTime() - da.getTime()) / 3600000) * 100) / 100;
  }

  /** 源 _days_left：距效期还有几天（负数=已过期） */
  function _smtaDaysLeft(expireDate) {
    const d = _smtaDt(expireDate);
    if (!d) return null;
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const t1 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((t1 - t0) / 86400000);
  }

  /** 源 _life：寿命 = 使用次数，使用率 = 累计/上限 */
  function _smtaLife(used, maxTimes, warnPct) {
    const u = Number(used || 0), mx = Number(maxTimes || 0);
    if (mx <= 0) return { used: u, max: mx, left: null, pct: 0, state: "未设上限" };
    const pct = Math.round((u / mx) * 1000) / 10;
    const wp = Number(warnPct || 80);
    const state = pct >= 100 ? "已达寿命" : (pct >= wp ? "预警" : "正常");
    return { used: u, max: mx, left: Math.round((mx - u) * 100) / 100, pct, state };
  }

  /** 源 _param：取辅料时间参数（按类型；没有则取第一条） */
  async function _smtaParam(pasteType) {
    const r = (await query("SELECT * FROM cfg_paste_param WHERE paste_type=$1", [pasteType || ""])).rows[0];
    if (r) return r;
    return (await query("SELECT * FROM cfg_paste_param ORDER BY id LIMIT 1")).rows[0] || null;
  }

  /** 源 _paste_row：把一条 prd_paste 加工成带判定的字典 */
  async function _smtaPasteRow(r, prm) {
    const d = { ...r };
    const p = prm || await _smtaParam(d.paste_type || "");
    const dl = _smtaDaysLeft(d.expire_date);
    const warnDays = p ? Number(p.warn_days || 7) : 7;
    d.days_left = dl;
    d.expire_flag = dl === null ? "" : (dl < 0 ? "已过期" : (dl <= warnDays ? "临期" : "正常"));
    d.warn = d.expire_flag === "已过期" || d.expire_flag === "临期";
    // 最近一条回温记录 → 算待用是否超时
    const w = (await query(
      "SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='WARM' ORDER BY id DESC LIMIT 1",
      [d.batch_no])).rows[0];
    if (w && p) {
      d.warm_end = w.end_time || "";
      d.warm_ok = Number(w.is_ok || 0);
      if (d.warm_end) {
        const waitStd = Number(p.wait_hours || 8);
        const used = _smtaHours(d.warm_end, nowStr());
        d.wait_used_h = used;
        d.wait_left_h = Math.round((waitStd - used) * 100) / 100;
        d.wait_over = used > waitStd;
      }
    }
    return d;
  }

  /** 源 util.model_key：去掉空格/横杠/下划线/斜杠并转大写 */
  function _smtaModelKey(s) {
    return String(s || "").toUpperCase().replace(/[\s\-_/]+/g, "");
  }

  /** 源 util.model_match：任一方为空 → true（没维护就不拦） */
  function _smtaModelMatch(a, b) {
    const ka = _smtaModelKey(a), kb = _smtaModelKey(b);
    if (!ka || !kb) return true;
    if (ka === kb) return true;
    if (Math.min(ka.length, kb.length) < 4) return false;
    return ka.includes(kb) || kb.includes(ka);
  }

  /** 源 _pda_mo_ctx：PDA 上料要带出的工单上下文 */
  async function _smtaMoCtx(moNo) {
    moNo = String(moNo || "").trim();
    if (!moNo) return null;
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return null;
    let model = String(mo.product_model || "").trim();
    if (!model) {
      const p = (await query("SELECT product_model FROM md_product WHERE product_code=$1",
        [mo.product_code || ""])).rows[0];
      model = String((p && p.product_model) || "").trim();
    }
    return {
      mo_no: mo.mo_no,
      product_code: mo.product_code || "",
      product_model: model,
      feeder_model: String(mo.feeder_model || "").trim(),
      line_code: mo.line_code || "",
      status: mo.status || "",
      plan_qty: Number(mo.plan_qty || 0),
      out_qty: Number(mo.out_qty || 0),
    };
  }

  /** 源 _match_stencil：钢网适用机型 vs 本工单机型（钢网是分面的，PCB1/PCB2 不能共用） */
  function _smtaMatchStencil(st, mo) {
    if (!mo) return { level: "warn", why: "未选工单，未核对钢网适用机型" };
    const mm = String(mo.product_model || "").trim();
    const fm = String(mo.feeder_model || "").trim();
    if (!(mm || fm)) return { level: "warn", why: "工单没维护机型，没得核对" };
    const precise = String(st.model || "").trim();
    const series = String(st.models || "").trim();
    const hit = x => _smtaModelMatch(x, mm) || (!!fm && _smtaModelMatch(x, fm));
    if (precise) {
      if (hit(precise)) return { level: "ok", why: `适用机型 ${precise} ✓` };
      return { level: "block", why: `✕ 这钢网是「${precise}」用的，本工单是「${mm || fm}」—— 上错机台会整批印错` };
    }
    if (series) {
      if (hit(series)) return { level: "warn", why: `这钢网只维护了系列「${series}」、没写具体面，按系列放行，请确认是不是这一面` };
      return { level: "block", why: `✕ 这钢网是「${series}」用的，本工单是「${mm || fm}」` };
    }
    return { level: "warn", why: "钢网台账没维护适用机型，没得核对" };
  }

  /** 源 _match_common：刮刀 / 锡膏红胶不绑机型，但必须挂工单才追得回 */
  function _smtaMatchCommon(mo, what) {
    if (!mo) return { level: "warn", why: `未选工单，本次${what}记录不会挂到工单上（追溯断链）` };
    return { level: "ok", why: `${what}不绑机型，会记到工单 ${mo.mo_no} 上` };
  }

  // ═══ 通用 CRUD（源 _crud.register；固定路径已全部注册完，通配放最后）═══════
  // ── W10-a：锡膏 / 红胶（源 smta/paste*）────────────────────────────────
  // ⚠ 时间列全为 varchar：跨天/跨月判断一律走 JS 侧 _smtaDt（本地时区），
  //    不用 PG 的 timestamp 比较 —— 源库存的是 'YYYY-MM-DD HH:MM:SS' 字符串。

  /** 源 paste_add 的有效期推算：到货日 + valid_months 个月 */
  function _smtaAddMonths(dateStr, months) {
    const d = _smtaDt(dateStr);
    if (!d) return "";
    const m = Number(months || 0);
    const y = d.getFullYear() + Math.floor((d.getMonth() + m) / 12);
    const mo = (d.getMonth() + m) % 12;
    const day = d.getDate();
    const probe = new Date(y, mo, day);
    if (probe.getDate() !== day) return "";   // 源 replace() 抛异常 → expire 置空
    const p = n => String(n).padStart(2, "0");
    return `${y}-${p(mo + 1)}-${p(day)}`;
  }

  router.get("/smta/paste", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kw = String(req.query.kw || "").trim();
    const ptype = String(req.query.ptype || "").trim();
    const onlyWarn = ["1", "true"].includes(String(req.query.only_warn || ""));
    const w = ["1=1"], args = [];
    if (kw) {
      w.push(`(batch_no ILIKE $${args.length + 1} OR material_code ILIKE $${args.length + 2} OR product_name ILIKE $${args.length + 3})`);
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    if (ptype) { w.push(`paste_type=$${args.length + 1}`); args.push(ptype); }
    const rows = (await query(
      `SELECT * FROM prd_paste WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 500`, args)).rows;
    const prms = {};
    for (const p of (await query("SELECT * FROM cfg_paste_param")).rows) prms[p.paste_type] = p;
    const items = [];
    for (const r of rows) items.push(await _smtaPasteRow(r, prms[r.paste_type]));
    const flagged = onlyWarn ? items.filter(x => x.warn || x.wait_over) : items;
    const params = (await query("SELECT * FROM cfg_paste_param ORDER BY id")).rows;
    return ok(res, {
      items: flagged, total: flagged.length,
      warn_count: flagged.filter(x => x.warn || x.wait_over).length,
      params,
    });
  });

  router.post("/smta/paste", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const batch = String(d.batch_no || "").trim();
    const ptype = String(d.paste_type || "").trim();
    if (!batch || !ptype) return fail(res, "批次号和物料类型必填");
    if (!["红胶", "锡膏"].includes(ptype)) return fail(res, "物料类型只能是「红胶」或「锡膏」");
    const prm = await _smtaParam(ptype);
    const arrive = String(d.arrive_date || "").trim() || todayStr();
    let expire = String(d.expire_date || "").trim();
    if (!expire && prm) expire = _smtaAddMonths(arrive, Number(prm.valid_months || 6));
    const now = nowStr();
    const user = (req.mesrjUser || {}).login_name || "";
    const initQty = Number(d.init_qty || 0);
    const old = (await query("SELECT * FROM prd_paste WHERE batch_no=$1", [batch])).rows[0];
    if (old) {
      await query(
        `UPDATE prd_paste SET paste_type=$1, material_code=$2, product_name=$3, supplier=$4,
           arrive_date=$5, expire_date=$6, storage_temp=$7, init_qty=$8, place=$9, remark=$10, updated_at=$11
         WHERE id=$12`,
        [ptype,
          String(d.material_code || old.material_code || ""),
          String(d.product_name || old.product_name || ""),
          String(d.supplier || old.supplier || ""),
          arrive, expire || old.expire_date,
          String(d.storage_temp || old.storage_temp || ""),
          initQty || Number(old.init_qty || 0),
          String(d.place || old.place || ""),
          String(d.remark || old.remark || ""),
          now, old.id]);
      return ok(res, { batch_no: batch, updated: true }, `批次 ${batch} 已更新`);
    }
    await query(
      `INSERT INTO prd_paste (batch_no, paste_type, material_code, product_name, supplier,
           arrive_date, expire_date, storage_temp, init_qty, left_qty, status, place,
           operator, remark, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'在库',$10,$11,$12,$13,$13)`,
      [batch, ptype,
        String(d.material_code || "").trim(), String(d.product_name || "").trim(),
        String(d.supplier || "").trim(), arrive, expire, String(d.storage_temp || "").trim(),
        initQty, String(d.place || "").trim(), user, String(d.remark || "").trim(), now]);
    await audit(user, "辅料", "新增批次", batch, `${ptype} ${expire}`);
    return ok(res, { batch_no: batch, expire_date: expire }, `批次 ${batch} 已入台账（有效期 ${expire}）`);
  });

  router.post("/smta/paste/warm", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const batch = String(d.batch_no || "").trim();
    if (!batch) return fail(res, "批次号必填");
    const it = (await query("SELECT * FROM prd_paste WHERE batch_no=$1", [batch])).rows[0];
    if (!it) return fail(res, `批次 ${batch} 不在台账里，请先录入`, 404);
    const prm = await _smtaParam(it.paste_type);
    const std = prm ? Number(prm.warm_hours || 4) : 4;
    const start = String(d.start_time || "").trim();
    const end = String(d.end_time || "").trim();
    const user = (req.mesrjUser || {}).login_name || "";
    const now = nowStr();

    if (start && !end) {
      await query("UPDATE prd_paste SET status='回温中', updated_at=$1 WHERE batch_no=$2", [now, batch]);
      await query(
        `INSERT INTO prd_paste_log (batch_no, paste_type, log_type, start_time, std_hours, operator, shift, created_at)
         VALUES ($1,$2,'WARM',$3,$4,$5,$6,$7)`,
        [batch, it.paste_type, start, std, user, String(d.shift || "").trim(), now]);
      return ok(res, { batch_no: batch, std_hours: std }, `批次 ${batch} 开始回温（标准 ${std} 小时）`);
    }
    if (!end) return fail(res, "请传 start_time（开始回温）或 end_time（回温结束）");

    const log = (await query(
      "SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='WARM' ORDER BY id DESC LIMIT 1",
      [batch])).rows[0];
    const realStart = (log && log.start_time) ? log.start_time : start;
    if (!realStart) return fail(res, "没有回温开始时间，请先登记开始回温");
    const dur = _smtaHours(realStart, end);
    const isOk = dur >= std;
    if (log && !log.end_time) {
      await query("UPDATE prd_paste_log SET end_time=$1, duration_h=$2, std_hours=$3, is_ok=$4 WHERE id=$5",
        [end, dur, std, isOk ? 1 : 0, log.id]);
    } else {
      await query(
        `INSERT INTO prd_paste_log (batch_no, paste_type, log_type, start_time, end_time, duration_h,
           std_hours, is_ok, operator, created_at) VALUES ($1,$2,'WARM',$3,$4,$5,$6,$7,$8,$9)`,
        [batch, it.paste_type, realStart, end, dur, std, isOk ? 1 : 0, user, now]);
    }
    await query("UPDATE prd_paste SET status=$1, updated_at=$2 WHERE batch_no=$3",
      [isOk ? "待用" : "在库", now, batch]);
    const msg = `✓ 批次 ${batch} 回温完成：${dur.toFixed(2)} 小时（标准 ${std}）` +
      (isOk ? "，达标可待用" : "　**未达标，需继续回温**");
    return ok(res, { batch_no: batch, duration_h: dur, std_hours: std, ok: isOk }, msg);
  });

  router.post("/smta/paste/use", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const batch = String(d.batch_no || "").trim();
    const kind = String(d.type || "USE").trim().toUpperCase();
    if (!batch) return fail(res, "批次号必填");
    const it = (await query("SELECT * FROM prd_paste WHERE batch_no=$1", [batch])).rows[0];
    if (!it) return fail(res, `批次 ${batch} 不在台账里`, 404);
    const prm = await _smtaParam(it.paste_type);
    const user = (req.mesrjUser || {}).login_name || "";
    const now = nowStr();

    if (kind === "USE") {
      let warn = "";
      const w = (await query(
        "SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='WARM' ORDER BY id DESC LIMIT 1",
        [batch])).rows[0];
      if (w && w.end_time && prm) {
        const waitH = _smtaHours(w.end_time, now);
        const stdWait = Number(prm.wait_hours || 8);
        if (waitH > stdWait) warn = `（⚠ 回温后已放置 ${waitH.toFixed(2)} 小时，超过待用时限 ${stdWait} 小时）`;
      }
      await query(
        `INSERT INTO prd_paste_log (batch_no, paste_type, log_type, start_time, mo_no, line_code,
           machine_no, shift, operator, remark, created_at)
         VALUES ($1,$2,'USE',$3,$4,$5,$6,$7,$8,$9,$10)`,
        [batch, it.paste_type, now, String(d.mo_no || "").trim(), String(d.line_code || "").trim(),
          String(d.machine_no || "").trim(), String(d.shift || "").trim(), user,
          String(d.remark || "").trim(), now]);
      await query("UPDATE prd_paste SET status='使用中', updated_at=$1 WHERE batch_no=$2", [now, batch]);
      return ok(res, { batch_no: batch, start_time: now }, `批次 ${batch} 已上线使用${warn}`);
    }

    const dispose = String(d.dispose || "回收").trim();
    const useLog = (await query(
      `SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='USE' AND COALESCE(end_time,'')=''
       ORDER BY id DESC LIMIT 1`, [batch])).rows[0];
    let dur = 0;
    if (useLog && useLog.start_time) {
      dur = _smtaHours(useLog.start_time, now);
      await query("UPDATE prd_paste_log SET end_time=$1, duration_h=$2, dispose=$3, qty=$4 WHERE id=$5",
        [now, dur, dispose, Number(d.left_qty || 0), useLog.id]);
    }
    let warn = "";
    if (prm && dur > Number(prm.open_hours || 8)) {
      warn = `（⚠ 开盖使用 ${dur.toFixed(2)} 小时，超过时限 ${prm.open_hours} 小时）`;
    }
    const status = dispose === "用完" ? "已用完" : (dispose === "报废" ? "已报废" : "在库");
    if (d.left_qty !== null && d.left_qty !== undefined && d.left_qty !== "") {
      await query("UPDATE prd_paste SET status=$1, left_qty=$2, updated_at=$3 WHERE batch_no=$4",
        [status, Number(d.left_qty || 0), now, batch]);
    } else {
      await query("UPDATE prd_paste SET status=$1, updated_at=$2 WHERE batch_no=$3", [status, now, batch]);
    }
    return ok(res, { batch_no: batch, duration_h: dur, dispose },
      `批次 ${batch} 已下线：使用 ${dur.toFixed(2)} 小时，处置「${dispose}」${warn}`);
  });

  router.get("/smta/paste/logs", requireMesrjPerm("prod.trace"), async (req, res) => {
    const batch = String(req.query.batch_no || "").trim();
    const w = ["1=1"], args = [];
    if (batch) { w.push(`batch_no=$${args.length + 1}`); args.push(batch); }
    const rows = (await query(
      `SELECT * FROM prd_paste_log WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 300`, args)).rows;
    return ok(res, { items: rows });
  });

  // ── W10-b：钢网（寿命按印刷次数）───────────────────────────────────────

  router.get("/smta/stencil", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kw = String(req.query.kw || "").trim();
    const w = ["1=1"], args = [];
    if (kw) {
      w.push(`(stencil_no ILIKE $${args.length + 1} OR models ILIKE $${args.length + 2} OR COALESCE(model,'') ILIKE $${args.length + 3})`);
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    const rows = (await query(
      `SELECT * FROM prd_stencil WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT 500`, args)).rows;
    const items = rows.map(r => ({ ...r, ..._smtaLife(r.used_print_times, r.max_print_times, r.warn_pct) }));
    items.sort((a, b) => (b.pct || 0) - (a.pct || 0));
    return ok(res, {
      items, total: items.length,
      warn_count: items.filter(x => x.state === "预警" || x.state === "已达寿命").length,
    });
  });

  router.post("/smta/stencil", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.stencil_no || "").trim();
    if (!no) return fail(res, "钢网编号必填");
    const data = {
      stencil_no: no, sn: no,
      models: String(d.models || "").trim(),
      model: String(d.model || "").trim(),
      thickness: String(d.thickness || "").trim(),
      version: String(d.version || "").trim(),
      max_print_times: Number(d.max_print_times || 0),
      warn_pct: Number(d.warn_pct || 80),
      used_print_times: Number(d.used_print_times || 0),
      status: String(d.status || "在用").trim(),
      buy_date: String(d.buy_date || "").trim(),
      supplier: String(d.supplier || "").trim(),
      price: Number(d.price || 0),
      place: String(d.place || "").trim(),
      owner: String(d.owner || "").trim(),
    };
    const old = (await query("SELECT * FROM prd_stencil WHERE stencil_no=$1", [no])).rows[0];
    if (old) {
      await query(
        `UPDATE prd_stencil SET sn=$1, models=$2, model=$3, thickness=$4, version=$5,
           max_print_times=$6, warn_pct=$7, used_print_times=$8, status=$9, buy_date=$10,
           supplier=$11, price=$12, place=$13, owner=$14, updated_at=$15
         WHERE id=$16`,
        [data.sn, data.models, data.model, data.thickness, data.version,
          data.max_print_times, data.warn_pct, data.used_print_times, data.status,
          data.buy_date, data.supplier, data.price, data.place, data.owner, nowStr(), old.id]);
      return ok(res, { stencil_no: no, updated: true }, `钢网 ${no} 已更新`);
    }
    await query(
      `INSERT INTO prd_stencil (stencil_no, sn, models, model, thickness, version, max_print_times,
         warn_pct, used_print_times, status, buy_date, supplier, price, place, owner, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
      [no, no, data.models, data.model, data.thickness, data.version, data.max_print_times,
        data.warn_pct, data.used_print_times, data.status, data.buy_date, data.supplier,
        data.price, data.place, data.owner, nowStr()]);
    await audit((req.mesrjUser || {}).login_name || "", "辅料", "新增钢网", no, `上限 ${data.max_print_times} 次`);
    return ok(res, { stencil_no: no }, `钢网 ${no} 已入台账（寿命上限 ${data.max_print_times} 次）`);
  });

  router.post("/smta/stencil/use", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.stencil_no || "").trim();
    const times = Number(d.times || 0);
    if (!no || times <= 0) return fail(res, "钢网编号和本次使用次数必填");
    const it = (await query("SELECT * FROM prd_stencil WHERE stencil_no=$1", [no])).rows[0];
    if (!it) return fail(res, `钢网 ${no} 不在台账里`, 404);
    const used = Number(it.used_print_times || 0) + times;
    const now = nowStr();
    await query("UPDATE prd_stencil SET used_print_times=$1, updated_at=$2 WHERE id=$3", [used, now, it.id]);
    // ⚠ 必须显式给 status='已下线'：这张表的默认值是「使用中」，
    //   只记一次印刷次数却留下一条"使用中"的绑定，下次上线会被判成
    //   「已绑定在（空机台），不能同时上多台机」直接挡死。
    await query(
      `INSERT INTO prd_stencil_bind (stencil_sn, machine_no, mo_no, line_no, used_in_round,
         online_time, offline_time, operator, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'已下线',$9)`,
      [no, String(d.machine_no || "").trim(), String(d.mo_no || "").trim(),
        String(d.line_code || "").trim(), times,
        String(d.use_date || now), now, (req.mesrjUser || {}).login_name || "", now]);
    const clean = String(d.clean_type || "").trim();
    if (clean) {
      await query(
        `INSERT INTO prd_stencil_clean (stencil_sn, clean_type, clean_method, clean_time, operator, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [no, clean, clean, now, (req.mesrjUser || {}).login_name || "", now]);
    }
    const lf = _smtaLife(used, it.max_print_times, it.warn_pct);
    const msg = `钢网 ${no} 本次 +${times} 次，累计 ${Math.trunc(lf.used)} / ${Math.trunc(lf.max || 0)}（${lf.pct}%）` +
      (lf.state !== "正常" ? `　⚠ ${lf.state}` : "");
    return ok(res, { ...lf, stencil_no: no, added: times }, msg);
  });

  // ── W10-c：刮刀（寿命同钢网 + 上机/下机绑定）────────────────────────────

  router.get("/smta/squeegee", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const rows = (await query("SELECT * FROM md_squeegee ORDER BY id DESC LIMIT 500")).rows;
    const on = {};
    for (const b of (await query("SELECT * FROM prd_squeegee_bind WHERE status='使用中'")).rows) {
      on[b.sq_no] = b;
    }
    const items = rows.map(r => {
      const d = { ...r, ..._smtaLife(r.used_times, r.max_times, r.warn_pct) };
      const b = on[r.sq_no];
      d.online_at = b ? `${b.machine_no || ""} ${b.position || ""}`.trim() : "";
      d.online_mo = b ? (b.mo_no || "") : "";
      d.online_time = b ? (b.online_time || "") : "";
      return d;
    });
    items.sort((a, b) => (b.pct || 0) - (a.pct || 0));
    return ok(res, {
      items, total: items.length,
      warn_count: items.filter(x => x.state === "预警" || x.state === "已达寿命").length,
    });
  });

  router.post("/smta/squeegee", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.sq_no || "").trim();
    if (!no) return fail(res, "刮刀编号必填");
    const data = {
      sq_no: no,
      spec: String(d.spec || "").trim(),
      material: String(d.material || "").trim(),
      model: String(d.model || "").trim(),
      position: String(d.position || "").trim(),
      buy_date: String(d.buy_date || "").trim(),
      supplier: String(d.supplier || "").trim(),
      price: Number(d.price || 0),
      max_times: Number(d.max_times || 0),
      warn_pct: Number(d.warn_pct || 80),
      used_times: Number(d.used_times || 0),
      status: String(d.status || "在用").trim(),
      place: String(d.place || "").trim(),
      owner: String(d.owner || "").trim(),
      remark: String(d.remark || "").trim(),
    };
    const old = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [no])).rows[0];
    if (old) {
      await query(
        `UPDATE md_squeegee SET spec=$1, material=$2, model=$3, position=$4, buy_date=$5, supplier=$6,
           price=$7, max_times=$8, warn_pct=$9, used_times=$10, status=$11, place=$12, owner=$13,
           remark=$14, updated_at=$15 WHERE id=$16`,
        [data.spec, data.material, data.model, data.position, data.buy_date, data.supplier,
          data.price, data.max_times, data.warn_pct, data.used_times, data.status, data.place,
          data.owner, data.remark, nowStr(), old.id]);
      return ok(res, { sq_no: no, updated: true }, `刮刀 ${no} 已更新`);
    }
    await query(
      `INSERT INTO md_squeegee (sq_no, spec, material, model, position, buy_date, supplier, price,
         max_times, warn_pct, used_times, status, place, owner, remark, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
      [no, data.spec, data.material, data.model, data.position, data.buy_date, data.supplier,
        data.price, data.max_times, data.warn_pct, data.used_times, data.status, data.place,
        data.owner, data.remark, nowStr()]);
    return ok(res, { sq_no: no }, `刮刀 ${no} 已入台账`);
  });

  router.post("/smta/squeegee/online", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.sq_no || "").trim();
    const machine = String(d.machine_no || "").trim();
    const pos = String(d.position || "").trim();
    const moNo = String(d.mo_no || "").trim();
    if (!no || !machine) return fail(res, "刮刀编号和印刷机必填");
    const it = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [no])).rows[0];
    if (!it) return fail(res, `刮刀 ${no} 不在台账里`, 404);
    if (["已报废", "待报废"].includes(String(it.status || ""))) {
      return fail(res, `刮刀 ${no} 状态是「${it.status}」，不能上机`);
    }
    const lf = _smtaLife(it.used_times, it.max_times, it.warn_pct);
    if (lf.max && Number(lf.used) >= Number(lf.max)) {
      return fail(res, `刮刀 ${no} 已用 ${Math.trunc(lf.used)} / ${Math.trunc(lf.max)} 次，达寿命上限，禁止上机（请报废换新）`);
    }
    const cur = (await query(
      "SELECT * FROM prd_squeegee_bind WHERE sq_no=$1 AND status='使用中'", [no])).rows[0];
    if (cur) {
      return fail(res, `刮刀 ${no} 已上机在 ${cur.machine_no}${cur.position ? " " + cur.position : ""}（工单 ${cur.mo_no || "—"}），一把刀不能同时装两台机`);
    }
    const dup = (await query(
      "SELECT * FROM prd_squeegee_bind WHERE machine_no=$1 AND COALESCE(position,'')=$2 AND status='使用中'",
      [machine, pos])).rows[0];
    if (dup) {
      return fail(res, `${machine}${pos ? " " + pos : ""} 上已经装着刮刀 ${dup.sq_no}（工单 ${dup.mo_no || "—"}），同一个位置不能装两把`);
    }
    const now = nowStr();
    await query(
      `INSERT INTO prd_squeegee_bind (sq_no, machine_no, position, mo_no, line_code, used_in_round,
         status, online_time, offline_time, operator, created_at)
       VALUES ($1,$2,$3,$4,$5,0,'使用中',$6,'',$7,$8)`,
      [no, machine, pos, moNo, String(d.line_code || "").trim(), now,
        (req.mesrjUser || {}).login_name || "", now]);
    await query("UPDATE md_squeegee SET status='使用中', updated_at=$1 WHERE id=$2", [now, it.id]);
    await audit((req.mesrjUser || {}).login_name || "", "辅料", "刮刀上机", no,
      `${machine}${pos ? " " + pos : ""} 工单 ${moNo}`);
    return ok(res, { sq_no: no, machine_no: machine, position: pos },
      `✓ 刮刀 ${no} 已上机：${machine}${pos ? " " + pos : ""}${moNo ? "　工单 " + moNo : ""}`);
  });

  router.post("/smta/squeegee/offline", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.sq_no || "").trim();
    if (!no) return fail(res, "刮刀编号必填");
    const b = (await query(
      "SELECT * FROM prd_squeegee_bind WHERE sq_no=$1 AND status='使用中'", [no])).rows[0];
    if (!b) return fail(res, `刮刀 ${no} 当前没有上机记录`);
    const times = Number(d.times || 0) || 0;
    const now = nowStr();
    const round = Number(b.used_in_round || 0) + (times > 0 ? times : 0);
    await query("UPDATE prd_squeegee_bind SET status='已下线', offline_time=$1, used_in_round=$2 WHERE id=$3",
      [now, round, b.id]);
    const it = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [no])).rows[0];
    let msg = `✓ 刮刀 ${no} 已下机`;
    if (it) {
      const used = Number(it.used_times || 0) + Math.max(0, times);
      await query("UPDATE md_squeegee SET used_times=$1, status='在用', updated_at=$2 WHERE id=$3",
        [used, now, it.id]);
      const lf = _smtaLife(used, it.max_times, it.warn_pct);
      msg = `✓ 刮刀 ${no} 已下机（${b.machine_no}${b.position ? " " + b.position : ""}，本轮 ${round} 次，累计 ${Math.trunc(lf.used)} / ${Math.trunc(lf.max || 0)}）` +
        (lf.state !== "正常" ? `　⚠ ${lf.state}` : "");
      // 本轮次数也进使用流水，按工单/设备追溯才查得到
      if (times > 0) {
        await query(
          `INSERT INTO prd_squeegee_use (sq_no, use_date, shift, line_code, mo_no, machine_no,
             model, times, clean_type, operator, remark, created_at)
           VALUES ($1,$2,'',$3,$4,$5,'',$6,'',$7,'下机时登记',$8)`,
          [no, todayStr(), b.line_code || "", b.mo_no || "", b.machine_no || "", times,
            (req.mesrjUser || {}).login_name || "", now]);
      }
    }
    await audit((req.mesrjUser || {}).login_name || "", "辅料", "刮刀下机", no, `${b.machine_no} 本轮 ${times} 次`);
    return ok(res, { sq_no: no, times }, msg);
  });

  router.post("/smta/squeegee/use", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const no = String(d.sq_no || "").trim();
    const times = Number(d.times || 0);
    if (!no || times <= 0) return fail(res, "刮刀编号和本次使用次数必填");
    const it = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [no])).rows[0];
    if (!it) return fail(res, `刮刀 ${no} 不在台账里`, 404);
    const used = Number(it.used_times || 0) + times;
    const now = nowStr();
    await query("UPDATE md_squeegee SET used_times=$1, updated_at=$2 WHERE id=$3", [used, now, it.id]);
    await query(
      `INSERT INTO prd_squeegee_use (sq_no, use_date, shift, line_code, mo_no, machine_no, model,
         times, clean_type, operator, remark, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [no, String(d.use_date || "").trim() || todayStr(), String(d.shift || "").trim(),
        String(d.line_code || "").trim(), String(d.mo_no || "").trim(),
        String(d.machine_no || "").trim(), String(d.model || "").trim(), times,
        String(d.clean_type || "").trim(), (req.mesrjUser || {}).login_name || "",
        String(d.remark || "").trim(), now]);
    const lf = _smtaLife(used, it.max_times, it.warn_pct);
    const msg = `刮刀 ${no} 本次 +${times} 次，累计 ${Math.trunc(lf.used)} / ${Math.trunc(lf.max || 0)}（${lf.pct}%）` +
      (lf.state !== "正常" ? `　⚠ ${lf.state}` : "");
    return ok(res, { ...lf, sq_no: no, added: times }, msg);
  });

  // ── W10-d：总览（一屏看四块辅料的预警）──────────────────────────────────

  router.get("/smta/overview", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const prms = {};
    for (const p of (await query("SELECT * FROM cfg_paste_param")).rows) prms[p.paste_type] = p;
    const pItems = [];
    for (const r of (await query("SELECT * FROM prd_paste")).rows) {
      pItems.push(await _smtaPasteRow(r, prms[r.paste_type]));
    }
    const pWarn = pItems.filter(x => x.warn || x.wait_over);
    const sts = (await query("SELECT * FROM prd_stencil")).rows;
    const sWarn = sts.map(r => ({ ...r, ..._smtaLife(r.used_print_times, r.max_print_times, r.warn_pct) }))
      .filter(x => x.state === "预警" || x.state === "已达寿命");
    const sqs = (await query("SELECT * FROM md_squeegee")).rows;
    const qWarn = sqs.map(r => ({ ...r, ..._smtaLife(r.used_times, r.max_times, r.warn_pct) }))
      .filter(x => x.state === "预警" || x.state === "已达寿命");
    return ok(res, {
      paste: {
        total: pItems.length, warn: pWarn.length,
        expired: pItems.filter(x => x.expire_flag === "已过期").length,
        items: pWarn.slice(0, 8),
      },
      stencil: { total: sts.length, warn: sWarn.length, items: sWarn.slice(0, 8) },
      squeegee: { total: sqs.length, warn: qWarn.length, items: qWarn.slice(0, 8) },
    });
  });

  // ── W10-e：SMT 站位绑码（源 smta/slots* + core/feeder_slot.py）──────────
  //   这张表是 PDA「贴片料上料防呆」的**唯一数据来源**。
  //   **不锁死** —— 工程师优化程序后自己改，允许同机型+机台+站位出现多条（不同料）。

  /** 源 feeder_slot.split_codes：把「A/B/C」拆成料号列表（去重保序） */
  function _smtaSplitCodes(raw) {
    const out = [];
    for (const x of String(raw || "").split(/[/／,，、;；\s]+/)) {
      const t = x.trim();
      if (t && !out.includes(t)) out.push(t);
    }
    return out;
  }

  /** 源 feeder_slot.vn_of：料号 → 越南料号（md_material 唯一来源） */
  async function _smtaVnOf(code) {
    if (!code) return "";
    const r = (await query("SELECT vn_code FROM md_material WHERE material_code=$1", [code])).rows[0];
    return String((r && r.vn_code) || "").trim();
  }

  /** 源 feeder_slot.set_slot_codes：整组重写该站位的料号清单 */
  async function _smtaSetSlotCodes(slotId, codes, vnCodes = {}) {
    await query("DELETE FROM md_feeder_slot_alt WHERE slot_id=$1", [slotId]);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      const vn = String(vnCodes[c] || "").trim() || await _smtaVnOf(c);
      await query(
        `INSERT INTO md_feeder_slot_alt (slot_id, material_code, vn_code, seq_no, is_main, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slot_id, material_code) DO NOTHING`,
        [slotId, c, vn, i, i === 0 ? 1 : 0, nowStr()]);
    }
  }

  /** 源 feeder_slot.codes_of_slot：该站位的全部料号（含主料） */
  async function _smtaSlotCodes(slotId) {
    const rows = (await query(
      "SELECT material_code, vn_code, seq_no, is_main FROM md_feeder_slot_alt WHERE slot_id=$1 ORDER BY seq_no, id",
      [slotId])).rows;
    return rows.filter(r => String(r.material_code || "").trim())
      .map(r => ({ code: String(r.material_code).trim(), vn: String(r.vn_code || "").trim(), is_main: Number(r.is_main || 0) }));
  }

  router.get("/smta/slots", requireMesrjPerm("prod.trace"), async (req, res) => {
    const model = String(req.query.model || "").trim();
    const machine = String(req.query.machine_no || "").trim();
    const kw = String(req.query.kw || "").trim();
    const w = ["1=1"], args = [];
    if (model) { w.push(`model=$${args.length + 1}`); args.push(model); }
    if (machine) { w.push(`machine_no=$${args.length + 1}`); args.push(machine); }
    if (kw) {
      w.push(`(material_code ILIKE $${args.length + 1} OR vn_code ILIKE $${args.length + 2} OR feeder_no ILIKE $${args.length + 3} OR slot_no ILIKE $${args.length + 4} OR designators ILIKE $${args.length + 5})`);
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    const rows = (await query(
      `SELECT * FROM md_feeder_slot WHERE ${w.join(" AND ")} ORDER BY model, machine_no, slot_no LIMIT 2000`,
      args)).rows;
    // 替代料一并带出（一次查全表再分组，别按行 N+1 查）
    const altMap = {};
    for (const a of (await query(
      "SELECT slot_id, material_code FROM md_feeder_slot_alt ORDER BY slot_id, seq_no, id")).rows) {
      const k = Number(a.slot_id);
      if (!altMap[k]) altMap[k] = [];
      altMap[k].push(a.material_code || "");
    }
    const items = rows.map(r => {
      const d = { ...r };
      const codes = altMap[Number(r.id)] || (r.material_code ? [r.material_code] : []);
      d.codes = codes;
      d.alt_count = Math.max(0, codes.length - 1);
      return d;
    });
    const models = (await query(
      "SELECT DISTINCT model FROM md_feeder_slot WHERE COALESCE(model,'')<>'' ORDER BY model")).rows.map(x => x.model);
    const machines = (await query(
      "SELECT DISTINCT machine_no FROM md_feeder_slot WHERE COALESCE(machine_no,'')<>'' ORDER BY machine_no")).rows.map(x => x.machine_no);
    return ok(res, { items, total: items.length, models, machines });
  });

  router.post("/smta/slots", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const data = {
      model: String(d.model || "").trim(),
      machine_code: String(d.machine_code || "").trim(),
      machine_no: String(d.machine_no || "").trim(),
      slot_no: String(d.slot_no || "").trim(),
      feeder_no: String(d.feeder_no || "").trim(),
      material_code: String(d.material_code || "").trim(),
      vn_code: String(d.vn_code || "").trim(),
      spec: String(d.spec || "").trim(),
      designators: String(d.designators || "").trim(),
      remark: String(d.remark || "").trim(),
    };
    if (!data.model || !data.material_code) return fail(res, "机型和 SZ 料号必填（其余可留空）");
    // SZ 料号一栏允许写主料/替代料（0338B-HF/0338L-HF/…），统一拆开落库
    const codes = _smtaSplitCodes(data.material_code);
    if (!codes.length) return fail(res, "SZ 料号解析为空");
    data.material_code = codes[0];
    const sid = d.id ? Number(d.id) : 0;
    if (sid) {
      await query(
        `UPDATE md_feeder_slot SET model=$1, machine_code=$2, machine_no=$3, slot_no=$4, feeder_no=$5,
           material_code=$6, vn_code=$7, spec=$8, designators=$9, remark=$10, updated_at=$11
         WHERE id=$12`,
        [data.model, data.machine_code, data.machine_no, data.slot_no, data.feeder_no,
          data.material_code, data.vn_code, data.spec, data.designators, data.remark, nowStr(), sid]);
      await _smtaSetSlotCodes(sid, codes);
      return ok(res, { id: sid, codes }, "已更新");
    }
    const ins = (await query(
      `INSERT INTO md_feeder_slot (model, machine_code, machine_no, slot_no, feeder_no, material_code,
         vn_code, spec, designators, status, remark, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,$11) RETURNING id`,
      [data.model, data.machine_code, data.machine_no, data.slot_no, data.feeder_no,
        data.material_code, data.vn_code, data.spec, data.designators, data.remark, nowStr()])).rows[0];
    await _smtaSetSlotCodes(Number(ins.id), codes);
    return ok(res, { id: Number(ins.id), codes }, "已新增");
  });

  router.delete("/smta/slots/:sid", requireMesrjPerm("md.edit"), async (req, res) => {
    const sid = Number(req.params.sid);
    const r = (await query("SELECT id FROM md_feeder_slot WHERE id=$1", [sid])).rows[0];
    if (!r) return fail(res, "记录不存在", 404);
    await query("DELETE FROM md_feeder_slot_alt WHERE slot_id=$1", [sid]);
    await query("DELETE FROM md_feeder_slot WHERE id=$1", [sid]);
    return ok(res, null, "已删除");
  });

  router.post("/smta/slots/import", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const text = String(d.text || "");
    const arr = Array.isArray(d.rows) ? d.rows : [];
    const mode = String(d.mode || "append").trim();
    const onlyModel = String(d.model || "").trim();
    const recs = [];
    if (arr.length) {
      for (const r of arr) {
        if (Array.isArray(r)) recs.push(r.map(x => String(x || "").trim()));
      }
    } else if (text) {
      for (const line of text.replace(/\r/g, "").split("\n")) {
        if (!line.trim()) continue;
        const parts = line.includes("\t")
          ? line.split("\t")
          : line.split(",");
        const clean = parts.map(x => x.trim().replace(/^"|"$/g, ""));
        if (clean.length && ["#.", "#", "序号", "model"].includes(String(clean[0] || "").toLowerCase())) continue;
        if (clean.length < 2) continue;
        recs.push(clean);
      }
    }
    if (!recs.length) {
      return fail(res, "没有可导入的内容（粘贴 Excel 的 机型/内部码/机台/站位/飞达/SZ料号/VN料号/规格/位号 列）");
    }
    // 有的表第一列是序号，跳过
    const first = recs[0];
    const hasNo = first && (String(first[0] || "").trim() === "" || /^\d+$/.test(String(first[0] || "").trim()));
    const idx0 = hasNo ? 1 : 0;
    const COLS = ["model", "machine_code", "machine_no", "slot_no", "feeder_no",
      "sz_code", "vn_code", "spec", "designators"];
    // 统一成 9 列（机型…位号）
    const norm = recs.map(r => {
      const row = [];
      for (let i = 0; i < 9; i++) row.push(String(r[idx0 + i] || "").trim());
      return row;
    });

    // mode=replace：先清空该机型再导
    if (mode === "replace" && onlyModel) {
      const olds = (await query("SELECT id FROM md_feeder_slot WHERE model=$1", [onlyModel])).rows;
      for (const o of olds) await query("DELETE FROM md_feeder_slot_alt WHERE slot_id=$1", [o.id]);
      await query("DELETE FROM md_feeder_slot WHERE model=$1", [onlyModel]);
    }

    let n = 0, skip = 0, nAlt = 0;
    const dup = [], noMat = new Set();
    for (const r of norm) {
      const v = {};
      COLS.forEach((c, i) => { v[c] = r[i] || ""; });
      const model = v.model;
      const codes = _smtaSplitCodes(v.sz_code);
      if (!model || !codes.length) { skip += 1; continue; }
      const vns = _smtaSplitCodes(v.vn_code);
      const vnMap = {};
      if (vns.length === codes.length) codes.forEach((c, i) => { vnMap[c] = vns[i]; });
      else if (vns.length === 1) vnMap[codes[0]] = vns[0];
      const machineNo = v.machine_no, slotNo = v.slot_no;
      const ex = (await query(
        `SELECT * FROM md_feeder_slot WHERE model=$1 AND COALESCE(machine_no,'')=$2 AND COALESCE(slot_no,'')=$3`,
        [model, machineNo, slotNo])).rows[0];
      let sid;
      if (ex) {
        if (!codes.includes(String(ex.material_code || ""))) {
          dup.push(`${model} ${machineNo} ${slotNo}：库内已有「${ex.material_code}」，本行是「${codes[0]}」`);
        }
        await query(
          `UPDATE md_feeder_slot SET machine_code=$1, feeder_no=$2, material_code=$3, vn_code=$4,
             spec=$5, designators=$6, updated_at=$7 WHERE id=$8`,
          [v.machine_code, v.feeder_no, codes[0], vnMap[codes[0]] || "", v.spec, v.designators, nowStr(), ex.id]);
        sid = Number(ex.id);
      } else {
        const ins = (await query(
          `INSERT INTO md_feeder_slot (model, machine_code, machine_no, slot_no, feeder_no, material_code,
             vn_code, spec, designators, status, remark, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'',$10,$10) RETURNING id`,
          [model, v.machine_code, machineNo, slotNo, v.feeder_no, codes[0],
            vnMap[codes[0]] || "", v.spec, v.designators, nowStr()])).rows[0];
        sid = Number(ins.id);
      }
      await _smtaSetSlotCodes(sid, codes, vnMap);
      nAlt += Math.max(0, codes.length - 1);
      for (const c of codes) if (!await _smtaVnOf(c)) noMat.add(c);
      n += 1;
    }
    let msg = `已导入 ${n} 条站位（替代料 ${nAlt} 个）`;
    if (skip) msg += `，跳过 ${skip} 条（机型或料号空）`;
    if (dup.length) msg += `；⚠ ${dup.length} 处同站位料号冲突`;
    if (noMat.size) msg += `；⚠ ${noMat.size} 个料号未建档（无越南料号）`;
    return ok(res, {
      imported: n, skipped: skip, alts: nAlt,
      dup: dup.slice(0, 30), dup_n: dup.length,
      no_material: Array.from(noMat).slice(0, 50), no_material_n: noMat.size,
    }, msg);
  });

  router.get("/smta/slots/export", requireMesrjPerm("prod.trace"), async (req, res) => {
    const model = String(req.query.model || "").trim();
    const w = ["1=1"], args = [];
    if (model) { w.push(`model=$${args.length + 1}`); args.push(model); }
    const rows = (await query(
      `SELECT * FROM md_feeder_slot WHERE ${w.join(" AND ")} ORDER BY model, machine_no, slot_no`, args)).rows;
    const lines = ["机型\t设备内部码\t机台编号\t站位编号\t飞达编号\tSZ料号RJ\tVN料号DT\t规格\t位号"];
    for (const r of rows) {
      const codes = (await _smtaSlotCodes(Number(r.id))).map(x => x.code);
      const use = codes.length ? codes : [r.material_code || ""];
      lines.push([
        r.model || "", r.machine_code || "", r.machine_no || "", r.slot_no || "", r.feeder_no || "",
        use.join("/"),        // 主料/替代料原样贴回一格，跟 Excel 一致
        r.vn_code || "", r.spec || "", r.designators || ""].join("\t"));
    }
    return ok(res, { text: lines.join("\n"), count: rows.length });
  });

  // ── W10-f：时间阈值（全部可调，不锁死）───────────────────────────────────
  //   工艺类：cfg_threshold（PCB 开封、锡膏上机、呆滞、维修次数…）—— SMT 侧已有，直接复用
  //   辅料类：cfg_paste_param（红胶/锡膏 的回温、待用、开盖、有效期）

  router.get("/smta/times", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const ths = (await query("SELECT * FROM cfg_threshold ORDER BY id")).rows;
    const pas = (await query("SELECT * FROM cfg_paste_param ORDER BY id")).rows;
    return ok(res, { thresholds: ths, paste: pas, paste_types: ["红胶", "锡膏"] });
  });

  router.post("/smta/times", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    let nTh = 0;
    for (const x of (Array.isArray(d.thresholds) ? d.thresholds : [])) {
      const k = String(x.th_key || "").trim();
      if (!k) continue;
      const v = Number(x.th_value);
      if (!Number.isFinite(v)) continue;
      await query("UPDATE cfg_threshold SET th_value=$1 WHERE th_key=$2", [v, k]);
      nTh += 1;
    }
    let nPa = 0;
    for (const x of (Array.isArray(d.paste) ? d.paste : [])) {
      const pid = x.id;
      if (!pid) continue;
      await query(
        `UPDATE cfg_paste_param SET storage_min=$1, storage_max=$2, warm_hours=$3, wait_hours=$4,
           open_hours=$5, valid_months=$6, warn_days=$7, updated_at=$8 WHERE id=$9`,
        [Number(x.storage_min || 2), Number(x.storage_max || 10), Number(x.warm_hours || 4),
          Number(x.wait_hours || 8), Number(x.open_hours || 8), Number(x.valid_months || 6),
          Number(x.warn_days || 7), nowStr(), Number(pid)]);
      nPa += 1;
    }
    await audit((req.mesrjUser || {}).login_name || "", "配置", "改时间阈值", "",
      `工艺 ${nTh} 条 / 辅料 ${nPa} 条`);
    return ok(res, { thresholds: nTh, paste: nPa },
      `已保存：工艺阈值 ${nTh} 条、辅料参数 ${nPa} 条`);
  });

  // ── W10-g：钢网印刷参数 + 按工单算消耗（源 smta/stencil/params*、/usage）──
  //   消耗口径：板数 = 该工单 SMT-AOI 过站 OK 的 DISTINCT SN 数
  //             版数 = ceil(板数 / 拼版数)
  //             次数 = 版数 × 每版印刷次数
  //   ⚠ 优先用**印刷机真实记录**（GKG 每片发 CSV，含 PrintMode），没有才退回 AOI 反推。

  router.get("/smta/stencil/params", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const rows = (await query("SELECT * FROM cfg_stencil_param ORDER BY model, side")).rows;
    return ok(res, { items: rows });
  });

  router.post("/smta/stencil/params", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const model = String(d.model || "").trim();
    const side = String(d.side || "").trim();
    if (!model) return fail(res, "机型必填");
    const data = {
      model, side,
      panel_count: Number(d.panel_count || 1),
      print_per_panel: Number(d.print_per_panel || 1),
      max_times: Number(d.max_times || 0),
      warn_pct: Number(d.warn_pct || 80),
      remark: String(d.remark || "").trim(),
    };
    const old = (await query(
      "SELECT id FROM cfg_stencil_param WHERE model=$1 AND COALESCE(side,'')=$2", [model, side])).rows[0];
    if (old) {
      await query(
        `UPDATE cfg_stencil_param SET panel_count=$1, print_per_panel=$2, max_times=$3, warn_pct=$4,
           remark=$5, updated_at=$6 WHERE id=$7`,
        [data.panel_count, data.print_per_panel, data.max_times, data.warn_pct, data.remark, nowStr(), old.id]);
      return ok(res, { updated: true }, `已更新 ${model} ${side}`);
    }
    await query(
      `INSERT INTO cfg_stencil_param (model, side, panel_count, print_per_panel, max_times, warn_pct,
         remark, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [model, side, data.panel_count, data.print_per_panel, data.max_times, data.warn_pct,
        data.remark, nowStr()]);
    return ok(res, null, `已新增 ${model} ${side}`);
  });

  router.delete("/smta/stencil/params/:pid", requireMesrjPerm("md.edit"), async (req, res) => {
    const pid = Number(req.params.pid);
    await query("DELETE FROM cfg_stencil_param WHERE id=$1", [pid]);
    return ok(res, null, "已删除");
  });

  router.get("/smta/stencil/usage", requireMesrjPerm("prod.trace"), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "请传工单号");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, "工单不存在", 404);
    // 机型：工单 feeder_model → 产品 product_model
    let model = String(mo.feeder_model || "").trim();
    if (!model) {
      const fg = String(mo.fg_code || "").trim();
      if (fg) {
        const pm = (await query("SELECT product_model FROM md_product WHERE product_code=$1", [fg])).rows[0];
        model = String((pm && pm.product_model) || "").trim();
      }
    }
    const boards = Number((await query(
      `SELECT COUNT(DISTINCT sn)::int AS n FROM prd_pass WHERE mo_no=$1 AND result='OK' AND station_code LIKE '%SMT-AOI%'`,
      [moNo])).rows[0].n || 0);
    // 参数：精确机型 → 前缀（PCB1/PCB2 两面都取出来）
    let params = [];
    if (model) {
      params = (await query("SELECT * FROM cfg_stencil_param WHERE model=$1", [model])).rows;
      if (!params.length) {
        params = (await query("SELECT * FROM cfg_stencil_param WHERE model LIKE $1", [model + "%"])).rows;
      }
    }
    const real = (await query(
      "SELECT COUNT(*)::int AS n, COALESCE(SUM(print_times),0) AS t FROM prd_print_log WHERE mo_no=$1",
      [moNo])).rows[0];
    const useReal = Number(real.n || 0) > 0;
    const planQty = Number(mo.plan_qty || 0);
    const items = params.map(p => {
      const pc = Number(p.panel_count || 1) || 1;
      const pp = Number(p.print_per_panel || 1) || 1;
      const panels = boards ? Math.ceil(boards / pc) : 0;
      const times = useReal ? Number(real.t || 0) : panels * pp;
      return {
        model: p.model, side: p.side,
        panel_count: pc, print_per_panel: pp,
        max_times: Number(p.max_times || 0), warn_pct: Number(p.warn_pct || 80),
        boards, panels, times,
        source: useReal ? "印刷机实时" : "AOI 反推",
        print_records: Number(real.n || 0),
        pct_of_life: p.max_times ? Math.round(times / Number(p.max_times) * 10000) / 10000 : null,
        plan_qty: planQty,
        plan_panels: planQty ? Math.ceil(planQty / pc) : 0,
        plan_times: planQty ? Math.ceil(planQty / pc) * pp : 0,
      };
    });
    return ok(res, {
      mo_no: moNo, model, boards, plan_qty: planQty,
      print_records: Number(real.n || 0), print_times: Number(real.t || 0),
      source: useReal ? "印刷机实时" : "AOI 反推", items,
    });
  });

  // ── W10-h：GKG 印刷机 CSV 记录（真实数据，比「按 AOI 板数反推」准）────────
  //   印刷机每印完一片发一个 CSV（本地目录或 FTP）→ 解析落库 → 这里查询/统计。

  const _SMTA_PRINT_MODES = {
    once: 1, double: 2, three: 3, four: 4, five: 5, six: 6,
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
  };

  function _smtaF(v) {
    const n = Number(String(v || "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  /** 源 gkg._read_text：GKG 多半是 GBK，UTF-8 兜底 */
  function _smtaDecodeGbk(buf) {
    for (const enc of ["gbk", "utf-8"]) {
      try { return new TextDecoder(enc, { fatal: false }).decode(buf); } catch { continue; }
    }
    return buf.toString("utf8");
  }

  /** 单行 CSV 拆分（支持双引号包裹） */
  function _smtaCsvLine(ln) {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < ln.length; i++) {
      const ch = ln[i];
      if (q) {
        if (ch === '"') { if (ln[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  /** 源 core/gkg.parse_csv_text：找出表头行 → 列名映射 → 竖排兼容 */
  function _smtaParsePrintCsv(text) {
    const rows = text.replace(/\r/g, "").split("\n")
      .filter(x => x.trim()).map(x => _smtaCsvLine(x).map(c => c.replace(/^"|"$/g, "")));
    if (!rows.length) return null;
    const norm = k => String(k || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const HEAD = ["timestamp", "machineid", "barcode", "printmode", "prodname", "prodtype"];
    let headIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].filter(c => HEAD.includes(norm(c))).length >= 2) { headIdx = i; break; }
    }
    let m = null;
    if (headIdx < 0) {
      const m2 = {};
      for (const r of rows) {
        if (r.length >= 2) { const k = norm(r[0]); if (k && !(k in m2)) m2[k] = r[1]; }
      }
      if (m2.printmode || m2.barcode) m = m2;
    } else {
      const head = rows[headIdx];
      const val = rows[headIdx + 1] || [];
      const mm = {};
      head.forEach((c, i) => { const k = norm(c); if (k && !(k in mm)) mm[k] = i < val.length ? val[i] : ""; });
      if (!mm.printmode && !mm.barcode) {
        const m2 = {};
        for (const r of rows) { if (r.length >= 2) { const k = norm(r[0]); if (k) m2[k] = r[1]; } }
        m = m2;
      } else m = mm;
    }
    if (!m) return null;
    const mode = String(m.printmode || "").trim();
    return {
      ts: String(m.timestamp || "").trim(),
      barcode: String(m.barcode || "").trim(),
      machine_id: String(m.machineid || m.machinename || "").trim(),
      prod_name: String(m.prodname || "").trim(),
      prod_type: String(m.prodtype || "").trim(),
      print_mode: mode,
      print_times: _SMTA_PRINT_MODES[mode.toLowerCase()] || 1,
      cycle_time: _smtaF(m.cycletime),
      cleaning_freq: _smtaF(m.cleaningfrequency),
      front_press: _smtaF(m.frontsqgpress),
      rear_press: _smtaF(m.rearsqgpress),
    };
  }

  router.get("/smta/print/log", requireMesrjPerm("prod.trace"), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const kw = String(req.query.kw || "").trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100) || 100));
    const w = ["1=1"], args = [];
    if (moNo) { w.push(`mo_no=$${args.length + 1}`); args.push(moNo); }
    if (kw) {
      w.push(`(barcode ILIKE $${args.length + 1} OR prod_name ILIKE $${args.length + 2} OR prod_type ILIKE $${args.length + 3})`);
      args.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }
    const rows = (await query(
      `SELECT * FROM prd_print_log WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT $${args.length + 1}`,
      [...args, limit])).rows;
    return ok(res, { items: rows, total: rows.length });
  });

  router.get("/smta/print/stat", requireMesrjPerm("prod.trace"), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const since = String(req.query.since || "").trim();
    const until = String(req.query.until || "").trim();
    const w = ["1=1"], args = [];
    if (moNo) { w.push(`mo_no=$${args.length + 1}`); args.push(moNo); }
    if (since) { w.push(`ts >= $${args.length + 1}`); args.push(since); }
    if (until) { w.push(`ts <= $${args.length + 1}`); args.push(until); }
    const base = (await query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(print_times),0) AS t FROM prd_print_log WHERE ${w.join(" AND ")}`,
      args)).rows[0];
    const modes = (await query(
      `SELECT print_mode, COUNT(*)::int AS n, COALESCE(SUM(print_times),0) AS t FROM prd_print_log
       WHERE ${w.join(" AND ")} GROUP BY print_mode ORDER BY n DESC`, args)).rows
      .map(r => ({ mode: r.print_mode || "(空)", records: Number(r.n || 0), times: Number(r.t || 0) }));
    const last = (await query(
      `SELECT MAX(ts) AS t FROM prd_print_log WHERE ${w.join(" AND ")}`, args)).rows[0];
    const empty = (await query(
      `SELECT COUNT(*)::int AS n FROM prd_print_log WHERE ${w.join(" AND ")} AND COALESCE(barcode,'')=''`,
      args)).rows[0];
    return ok(res, {
      mo_no: moNo, records: Number(base.n || 0), times: Number(base.t || 0),
      modes, last_ts: (last && last.t) || "", no_barcode: Number(empty.n || 0),
    });
  });

  router.post("/smta/print/rescan", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const dir = String(await getParam("gkg.csv_dir", "E:\\Ruijing MES\\_gkg_in") || "").trim();
    if (!dir) return fail(res, "未配置印刷机 CSV 目录（sys_param.gkg.csv_dir）");
    let names = [];
    try {
      names = readdirSync(dir).filter(n => /\.(csv|txt)$/i.test(n));
    } catch {
      return fail(res, `印刷机 CSV 目录不可读：${dir}`);
    }
    // 按修改时间排序（老的先导），与源 core/gkg.scan 一致
    const withTime = names.map(n => {
      try { return { n, t: statSync(path.join(dir, n)).mtimeMs }; }
      catch { return { n, t: 0 }; }
    }).sort((a, b) => a.t - b.t);
    let added = 0, skipped = 0, failed = 0;
    for (const f of withTime.slice(0, 500)) {
      const exists = (await query("SELECT id FROM prd_print_log WHERE file_name=$1", [f.n])).rows[0];
      if (exists) { skipped += 1; continue; }
      try {
        const raw = _smtaDecodeGbk(readFileSync(path.join(dir, f.n)));
        const info = _smtaParsePrintCsv(raw);
        if (!info) { failed += 1; continue; }
        let moNo = "";
        if (info.barcode) {
          const sn = (await query("SELECT mo_no FROM prd_sn WHERE sn=$1", [info.barcode])).rows[0];
          moNo = String((sn && sn.mo_no) || "");
        }
        await query(
          `INSERT INTO prd_print_log (ts, barcode, machine_id, prod_name, prod_type, print_mode,
             print_times, cycle_time, cleaning_freq, front_press, rear_press, file_name, mo_no, raw, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (file_name) DO NOTHING`,
          [info.ts, info.barcode, info.machine_id, info.prod_name, info.prod_type, info.print_mode,
            info.print_times, info.cycle_time, info.cleaning_freq, info.front_press, info.rear_press,
            f.n, moNo, raw.slice(0, 4000), nowStr()]);
        added += 1;
      } catch {
        failed += 1;
      }
    }
    return ok(res, { added, skipped, failed },
      `扫描完成：新增 ${added} 条，已存在 ${skipped} 条，失败 ${failed} 条`);
  });

  // ── W10-i：PDA 扫码（源 smta/pda/*）────────────────────────────────────
  //   扫一个码 → 自动认出是钢网 / 刮刀 / 锡膏，返回状态和可做的动作。
  //   为什么单独做：三样东西贴的条码格式不一样，员工不该先选类别再扫，
  //   应该是「扫一下，系统告诉我这是什么、现在什么状态、能做哪几步」。

  /** 源 _pda_stencil */
  async function _smtaPdaStencil(code, mo) {
    const st = (await query("SELECT * FROM prd_stencil WHERE stencil_no=$1 OR sn=$1", [code, code])).rows[0];
    if (!st) return null;
    const lf = _smtaLife(st.used_print_times, st.max_print_times, st.warn_pct);
    const bind = (await query(
      "SELECT * FROM prd_stencil_bind WHERE stencil_sn=$1 AND status='使用中'",
      [st.stencil_no || code])).rows[0];
    const extra = [
      ["厚度", st.thickness || "—"],
      ["适用机型", st.models || st.model || "—"],
      ["当前绑定", bind ? `${bind.machine_no || "—"} / 工单 ${bind.mo_no || "—"}` : "未上线"],
    ];
    return {
      type: "stencil", type_name: "钢网",
      code: st.stencil_no || code,
      sub: st.models || st.model || "",
      status: st.status || "",
      life: lf,
      extra: extra.map(([k, v]) => ({ k, v })),
      online: !!bind,
      bind: bind ? { machine_no: bind.machine_no || "", mo_no: bind.mo_no || "" } : null,
      match: _smtaMatchStencil(st, mo),
      actions: (bind ? ["offline"] : ["online"]).concat(["use", "clean", "scrap"]),
    };
  }

  /** 源 _pda_squeegee */
  async function _smtaPdaSqueegee(code, mo) {
    const sq = (await query("SELECT * FROM md_squeegee WHERE sq_no=$1", [code])).rows[0];
    if (!sq) return null;
    const lf = _smtaLife(sq.used_times, sq.max_times, sq.warn_pct);
    const bind = (await query(
      "SELECT * FROM prd_squeegee_bind WHERE sq_no=$1 AND status='使用中'", [code])).rows[0];
    const extra = [];
    if (bind) {
      extra.push(["当前上机",
        `${bind.machine_no || "—"}${bind.position ? " " + bind.position : ""}${bind.mo_no ? "　工单 " + bind.mo_no : ""}`]);
    } else {
      extra.push(["当前上机", "未上机"]);
    }
    extra.push(["规格", sq.spec || "—"], ["材质", sq.material || "—"], ["位置", sq.position || "—"]);
    return {
      type: "squeegee", type_name: "刮刀",
      code: sq.sq_no,
      sub: sq.spec || sq.material || "",
      status: sq.status || "",
      life: lf,
      extra: extra.map(([k, v]) => ({ k, v })),
      online: !!bind,
      bind: bind ? {
        machine_no: bind.machine_no || "", position: bind.position || "", mo_no: bind.mo_no || "",
      } : null,
      match: _smtaMatchCommon(mo, "刮刀"),
      actions: (bind ? ["offline"] : ["online"]).concat(["use"]),
    };
  }

  /** 源 _pda_paste */
  async function _smtaPdaPaste(code, mo) {
    const it = (await query("SELECT * FROM prd_paste WHERE batch_no=$1", [code])).rows[0];
    if (!it) return null;
    const prm = await _smtaParam(it.paste_type);
    const now = nowStr();
    const warm = (await query(
      "SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='WARM' ORDER BY id DESC LIMIT 1",
      [code])).rows[0];
    const use = (await query(
      `SELECT * FROM prd_paste_log WHERE batch_no=$1 AND log_type='USE' AND COALESCE(end_time,'')=''
       ORDER BY id DESC LIMIT 1`, [code])).rows[0];
    const extra = [
      ["效期", it.expire_date || "—"],
      ["剩余", (it.left_qty !== null && it.left_qty !== undefined && it.left_qty !== "") ? `${it.left_qty} g` : "—"],
    ];
    if (warm && warm.start_time) {
      extra.push(["回温开始", String(warm.start_time).slice(0, 16)]);
      if (warm.end_time) {
        extra.push(["回温完成", `${String(warm.end_time).slice(0, 16)}（${Number(warm.duration_h || 0).toFixed(1)} 小时）`]);
      } else {
        extra.push(["已回温", `${_smtaHours(warm.start_time, now).toFixed(1)} 小时 / 标准 ${(prm && prm.warm_hours) || 4}`]);
      }
    }
    if (use && use.start_time) {
      extra.push(["开封时间", String(use.start_time).slice(0, 16)]);
      extra.push(["已开封", `${_smtaHours(use.start_time, now).toFixed(1)} 小时 / 时限 ${(prm && prm.open_hours) || 8}`]);
    }
    const status = String(it.status || "");
    let acts;
    if (status === "在库" || status === "退回") {
      acts = ["warm_start"];
      if (warm && warm.end_time) acts = ["paste_use", "warm_start"];
    } else if (status === "回温中") acts = ["warm_end"];
    else if (status === "待用") acts = ["paste_use", "warm_start"];
    else if (status === "使用中") acts = ["paste_recover"];
    else acts = ["warm_start"];   // 已用完/已报废 → 只允许重新开一批（新批次号）
    return {
      type: "paste", type_name: it.paste_type || "锡膏",
      code: it.batch_no, sub: it.paste_type || "",
      status,
      life: null,
      extra: extra.map(([k, v]) => ({ k, v })),
      online: !!use,
      match: _smtaMatchCommon(mo, it.paste_type || "锡膏"),
      actions: acts,
      params: {
        warm_hours: (prm && prm.warm_hours) || 4,
        open_hours: (prm && prm.open_hours) || 8,
        wait_hours: (prm && prm.wait_hours) || 8,
      },
    };
  }

  router.get("/smta/pda/scan", requireMesrjPerm("prod.trace"), async (req, res) => {
    const code = String(req.query.code || "").trim();
    if (!code) return fail(res, "请扫码");
    const mo = await _smtaMoCtx(String(req.query.mo_no || "").trim());
    const hits = [];
    for (const fn of [_smtaPdaStencil, _smtaPdaSqueegee, _smtaPdaPaste]) {
      try {
        const x = await fn(code, mo);
        if (x) hits.push(x);
      } catch { /* 识别失败不算错，三类都查一遍 */ }
    }
    if (!hits.length) {
      const ns = (await query(
        "SELECT (SELECT COUNT(*) FROM prd_stencil)::int AS a, (SELECT COUNT(*) FROM md_squeegee)::int AS b, (SELECT COUNT(*) FROM prd_paste)::int AS c"
      )).rows[0];
      return ok(res, { code, type: "", hits: [], mo,
        msg: `这个码在辅料台账里查不到：钢网 ${ns.a} / 刮刀 ${ns.b} / 锡膏 ${ns.c} 都没有` });
    }
    return ok(res, { code, type: hits[0].type, hits, mo });
  });

  router.get("/smta/pda/mos", requireMesrjPerm("prod.trace"), async (req, res) => {
    // scope=all 时列**全部状态**（含已完工/已关闭）—— 按工单追溯辅料要用，
    // 出货后客户来查批次，查的恰恰是已完工的单。
    const scope = String(req.query.scope || "").trim().toLowerCase();
    const kw = String(req.query.kw || "").trim();
    let rows = [];
    if (scope === "all") {
      const w = ["COALESCE(status,'')<>'作废'"], args = [];
      if (kw) { w.push(`mo_no ILIKE $${args.length + 1}`); args.push(`%${kw}%`); }
      rows = (await query(
        `SELECT mo_no, product_code, line_code, plan_qty, out_qty, status, po_no FROM ord_mo
         WHERE ${w.join(" AND ")} ORDER BY mo_no DESC LIMIT 300`, args)).rows;
    } else {
      rows = (await query(
        `SELECT mo_no, product_code, line_code, plan_qty, out_qty, status, po_no FROM ord_mo
         WHERE COALESCE(status,'') IN ('待排产','已排产','已下达','生产中')
         ORDER BY CASE status WHEN '生产中' THEN 0 WHEN '已下达' THEN 1 WHEN '已排产' THEN 2 ELSE 3 END,
         mo_no DESC LIMIT 200`)).rows;
    }
    const pmap = {};
    for (const x of (await query("SELECT product_code, product_model FROM md_product")).rows) {
      pmap[x.product_code] = x.product_model || "";
    }
    const out = rows.map(r => ({
      mo_no: r.mo_no, product_code: r.product_code || "",
      // ⚠ ord_mo 没有 product_model 列，机型统一从 md_product 取
      product_model: String(pmap[r.product_code || ""] || "").trim(),
      line_code: r.line_code || "",
      plan_qty: Number(r.plan_qty || 0), out_qty: Number(r.out_qty || 0),
      status: r.status || "", po_no: r.po_no || "",
    }));
    return ok(res, { rows: out });
  });

  // ── W10-j：按工单追辅料（源 smta/trace/mo）─────────────────────────────
  //   ⚠ 只认**有登记**的记录 —— 没在 PDA 上做过动作的就是空，不会凭空出现。
  router.get("/smta/trace/mo", requireMesrjPerm("prod.trace"), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "请传工单号");
    if (!(await query("SELECT id FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0]) {
      return fail(res, "工单不存在", 404);
    }
    const ctx = (await _smtaMoCtx(moNo)) || {};
    const st = (await query(
      `SELECT b.*, s.model, s.models, s.thickness FROM prd_stencil_bind b
       LEFT JOIN prd_stencil s ON s.sn=b.stencil_sn
       WHERE b.mo_no=$1 ORDER BY b.id DESC`, [moNo])).rows;
    const sq = (await query("SELECT * FROM prd_squeegee_use WHERE mo_no=$1 ORDER BY id DESC", [moNo])).rows;
    const sqb = (await query("SELECT * FROM prd_squeegee_bind WHERE mo_no=$1 ORDER BY id DESC", [moNo])).rows;
    const pa = (await query("SELECT * FROM prd_paste_log WHERE mo_no=$1 ORDER BY id DESC", [moNo])).rows;
    const batches = new Set(pa.filter(r => r.log_type === "USE").map(r => r.batch_no));
    return ok(res, {
      mo_no: moNo,
      product_model: ctx.product_model || "",
      line_code: ctx.line_code || "",
      status: ctx.status || "",
      plan_qty: ctx.plan_qty || 0,
      out_qty: ctx.out_qty || 0,
      stencil: st,
      squeegee: sq,
      squeegee_bind: sqb,
      paste: pa,
      summary: {
        stencil_boards: st.length,
        stencil_times: st.reduce((a, r) => a + Number(r.used_in_round || 0), 0),
        squeegee_uses: sq.length,
        squeegee_times: sq.reduce((a, r) => a + Number(r.times || 0), 0),
        squeegee_online: sqb.filter(r => String(r.status || "") === "使用中").length,
        squeegee_boards: sqb.length,
        paste_batches: batches.size,
      },
    });
  });

  // ═══ 通用 CRUD（源 _crud.register；固定路径已全部注册完，通配放最后）═══════
  // ── W11：外箱绑码（源 api/pack.py，21 路由）──────────────────────────────
  //   新流程（外箱码自动生成，无需扫箱码）：
  //     选工单 → 连续扫产品 SN（扫第一台即自动开箱）→ 装满箱容 → 自动封箱 +
  //     按 AT&T QP200-00029 规则生成外箱码 + 自动发起打印；
  //     尾数不满一箱 → 手动「尾数封箱并打印」。
  //   防错：重码（已装箱）、NG/报废品、跨工单、重复扫描、超箱容、机型未配规则。
  //
  // ⚠ 产线维度：同一张工单同时开 2 条包装线时，箱必须按 line_code 隔离，
  //   否则两条线拿到同一个箱 → 两只物理箱子记成一只、封箱只打印一张标签。

  const BOX_OPEN = "装箱中";
  const BOX_CLOSED = "已封箱";

  async function _packMo(moNo) {
    return query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo]);
  }
  async function _packBox(boxNo) {
    return (await query("SELECT * FROM prd_box WHERE box_no=$1", [boxNo])).rows[0] || null;
  }
  function _packSns(row) {
    return String((row && row.sn_list) || "").split(",").filter(Boolean);
  }
  function _packUserName(user) {
    return (user && (user.emp_name || user.login_name)) || "";
  }

  /** 批量算每个 SN 的质量状态，供外箱网格标红用（源 _sns_quality） */
  async function _packSnsQuality(sns) {
    const out = {};
    const list = (sns || []).filter(Boolean);
    if (!list.length) return out;
    const ph = list.map((_, i) => `$${i + 1}`).join(",");
    try {
      for (const r of (await query(
        `SELECT sn, status FROM prd_sn WHERE sn IN (${ph})`, list)).rows) {
        if (["待修", "报废", "已报废"].includes(String(r.status || ""))) out[r.sn] = "NG";
      }
    } catch { /* 查不到就当 OK */ }
    try {
      // 同一工位只取最新一条（ORDER BY id DESC 后按 (sn, station) 去重）
      const seen = new Set();
      for (const r of (await query(
        `SELECT sn, station_code, result FROM prd_pass WHERE sn IN (${ph}) ORDER BY id DESC`, list)).rows) {
        const key = `${r.sn}|${r.station_code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (["NG", "FAIL"].includes(String(r.result || "").trim().toUpperCase())) out[r.sn] = "NG";
      }
    } catch { /* 同上 */ }
    return out;
  }

  /** 源 _box_json */
  async function _packBoxJson(row, fullSns = true) {
    if (!row) return null;
    const d = { ...row, created_at: tsLocal(row.created_at), updated_at: tsLocal(row.updated_at) };
    const sns = _packSns(row);
    if (fullSns) {
      const q = await _packSnsQuality(sns);
      d.sns = sns;
      d.sn_count = sns.length;
      d.sn_detail = sns.map(s => ({ sn: s, q: q[s] || "OK" }));
      d.ng_count = sns.filter(s => q[s] === "NG").length;
    } else {
      d.sn_count = sns.length;
      d.sn_preview = sns.slice(0, 3);
    }
    delete d.sn_list;
    return d;
  }

  /** 该工单当前「装箱中」的外箱（源 _open_box_of） */
  async function _packOpenBoxOf(moNo, lineCode = null) {
    const line = String(lineCode || "").trim();
    if (line) {
      const row = (await query(
        `SELECT * FROM prd_box WHERE mo_no=$1 AND status=$2 AND COALESCE(line_code,'')=$3
         ORDER BY id DESC LIMIT 1`, [moNo, BOX_OPEN, line])).rows[0];
      if (row) return row;
      // 兼容升级前的箱：该工单只有 1 个未封箱且还没标产线 → 认领它
      const nOpen = Number((await query(
        "SELECT COUNT(*)::int AS n FROM prd_box WHERE mo_no=$1 AND status=$2",
        [moNo, BOX_OPEN])).rows[0].n || 0);
      if (nOpen === 1) {
        const old = (await query(
          `SELECT * FROM prd_box WHERE mo_no=$1 AND status=$2 AND COALESCE(line_code,'')=''
           ORDER BY id DESC LIMIT 1`, [moNo, BOX_OPEN])).rows[0];
        if (old) {
          await query("UPDATE prd_box SET line_code=$1 WHERE box_no=$2", [line, old.box_no]);
          return await _packBox(old.box_no);
        }
      }
      return null;
    }
    return (await query(
      "SELECT * FROM prd_box WHERE mo_no=$1 AND status=$2 ORDER BY id DESC LIMIT 1",
      [moNo, BOX_OPEN])).rows[0] || null;
  }

  /** 这颗 SN 最后一次过站在哪条产线（源 _line_of_sn） */
  async function _packLineOfSn(sn) {
    if (!sn) return "";
    try {
      const r = (await query(
        `SELECT line_code FROM prd_pass WHERE sn=$1 AND COALESCE(line_code,'')<>''
         ORDER BY pass_time DESC, id DESC LIMIT 1`, [sn])).rows[0];
      return r ? String(r.line_code || "") : "";
    } catch { return ""; }
  }

  /** 本单路线里「包装」那一站（源 _packing_station） */
  async function _packPackingStation(moNo, productCode = "") {
    if (!moNo) return "";
    let steps = [];
    try {
      [steps] = await ensureMoRoute(moNo, productCode);
    } catch { return ""; }
    for (const s of [...(steps || [])].sort((a, b) => Number(a.seq_no || 0) - Number(b.seq_no || 0))) {
      if (String(s.process_code || "") !== "04") continue;
      const code = String(s.station_code || "");
      const name = String(s.station_name || "");
      if (code.toUpperCase().endsWith("PACKING") || name.includes("包装")) return code;
    }
    return "";
  }

  /** 取当前未完成箱；没有则新建（箱码为内部临时号，封箱时替换为正式外箱码） */
  async function _packEnsureOpenBox(moNo, capacity = null, tplCode = null, lineCode = null, user = null) {
    const mo = (await _packMo(moNo)).rows[0];
    if (!mo) return [null, `工单不存在：${moNo}`];
    if (["已完工", "已关闭", "作废"].includes(String(mo.status || ""))) {
      return [null, `工单 ${moNo} 状态为【${mo.status}】，不能装箱`];
    }
    const rule = await getRule(mo.product_code);
    if (!rule) {
      return [null, `机型【${mo.product_code || "?"}】未配置装箱编码规则，无法生成外箱码。` +
        "请先在 配置中心 → 装箱编码规则 中配置"];
    }
    const line = String(lineCode || "").trim();
    const ex = await _packOpenBoxOf(moNo, line);
    if (ex) return [ex, null];
    let cap = Number(capacity);
    if (!Number.isFinite(cap) || cap <= 0) cap = Number(rule.carton_qty || 0);
    if (!Number.isFinite(cap) || cap <= 0) cap = Number(await getParam("BOX_CAPACITY", "96") || 96);
    if (cap <= 0 || cap > 2000) return [null, "箱容必须是 1~2000 的整数"];
    const wip = await wipNo("BOX");
    await query(
      `INSERT INTO prd_box (box_no, mo_no, po_no, product_code, qty, capacity, sn_list, status,
         line_code, tpl_code, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,0,$5,'','${BOX_OPEN}',$6,$7,$8,now(),now())`,
      [wip, moNo, mo.po_no || "", mo.product_code || "", cap, line,
        String(tplCode || "").trim() || (rule.carton_tpl_code || ""),
        _packUserName(user)]);
    await audit(_packUserName(user), "外箱绑码", "开箱", wip,
      `${moNo} 箱容 ${cap}${line ? "　产线 " + line : ""}（箱码封箱时自动生成）`);
    return [await _packBox(wip), null];
  }

  /** 外箱标签打印数据（Carton Label 2：外箱码 + SN 清单 + SKU/数量） */
  function _packBoxPayload(box, rule, tpl, reprint = false, user = null) {
    const dt = new Date();
    const sns = _packSns(box);
    const perPage = 48;
    const pages = [];
    for (let i = 0; i < sns.length; i += perPage) pages.push(sns.slice(i, i + perPage));
    const p = n => String(n).padStart(2, "0");
    return {
      ref_type: "box", ref_no: box.box_no, box_no: box.box_no,
      mo_no: box.mo_no, po_no: box.po_no,
      product_code: box.product_code, machine_model: rule ? (rule.machine_model || "") : "",
      qty: box.qty, capacity: box.capacity,
      sns, sn_pages: pages, sn_per_page: perPage,
      day_code: dayCode(dt), year_digit: dt.getFullYear() % 10,
      date_of_mfg: `${dt.getFullYear()}.${p(dt.getMonth() + 1)}.${p(dt.getDate())}`,
      wireline_sku: rule ? (rule.wireline_sku || "") : "",
      consumer_sku: rule ? (rule.consumer_sku || "") : "",
      reprint: !!reprint,
      tpl: {
        tpl_code: tpl ? tpl.tpl_code : "", tpl_name: tpl ? tpl.tpl_name : "",
        file_name: tpl ? tpl.file_name : "", fields: tpl ? tpl.fields : "[]",
      },
      printed_by: _packUserName(user),
      printed_at: nowStr(),
    };
  }

  /** 打印代理上报的本机 .btw 清单（源 _agent_tpl_files） */
  async function _packAgentTplFiles() {
    try {
      const v = JSON.parse((await getParam("print.agent_tpl_files", "[]")) || "[]");
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  /** 打印代理是否在线：代理每轮取任务时打一次心跳，90 秒内算在线（源 _agent_state） */
  async function _packAgentState() {
    const last = String(await getParam("print.agent_last_seen", "") || "").trim();
    let alive = false, mins = null;
    if (last) {
      const t = new Date(last.replace(" ", "T"));
      if (!Number.isNaN(t.getTime())) {
        const gap = (Date.now() - t.getTime()) / 1000;
        alive = gap <= 90;
        mins = Math.floor(gap / 60);
      }
    }
    const pending = Number((await query(
      "SELECT COUNT(*)::int AS n FROM prd_print_job WHERE status='待打印'")).rows[0].n || 0);
    return {
      alive, last_seen: last, mins,
      printer: await getParam("print.agent_printer", ""),
      printer_ok: String(await getParam("print.agent_printer_ok", "") || "").trim() === "1",
      printer_msg: await getParam("print.agent_printer_msg", ""),
      bartender: await getParam("print.agent_bartender", ""),
      pending,
    };
  }

  // ── W11-a：页面初始化 / 上下文 / 规则预览 / 开箱 ─────────────────────────

  router.get("/pack/init", requireMesrjPerm(null), async (_req, res) => {
    const cap = Number(await getParam("BOX_CAPACITY", "96") || 96);
    const tpls = (await query(
      `SELECT id, tpl_code, tpl_name, tpl_type, product_code, file_name, fields, remark
       FROM cfg_print_tpl WHERE enabled=1 ORDER BY sort_no, id`)).rows;
    const rules = (await query("SELECT * FROM cfg_pack_rule WHERE enabled=1 ORDER BY id")).rows;
    const tplDir = String(await getParam("print.tpl_dir", "") || "").trim();
    const files = await _packAgentTplFiles();
    const names = new Set(files.map(f => f.name));
    for (const t of tpls) {
      const fn = String(t.file_name || "").trim();
      // 登记时存了完整路径 → 直接查该路径；否则看打印代理上报的本机清单
      if (fn && /^[A-Za-z]:[\\/]/.test(fn)) {
        t.exists = existsSync(fn);
        t.abs = true;
        continue;
      }
      t.abs = false;
      t.exists = !!fn && (names.size ? names.has(fn) : false);
    }
    return ok(res, {
      default_capacity: cap, templates: tpls, rules,
      tpl_dir: tplDir, print_agent: await _packAgentState(),
      agent_mode: String(await getParam("print.agent_mode", "") || "").trim(),
      agent_tpl_files: files,
    });
  });

  router.post("/pack/agent/ping", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const now = nowStr();
    await setParam("print.agent_last_seen", now, "打印代理心跳", "打印");
    await setParam("print.agent_printer", String(d.printer || "").slice(0, 80), "打印代理打印机", "打印");
    await setParam("print.agent_printer_ok", d.printer_ok === false ? "0" : "1", "打印代理打印机在线", "打印");
    await setParam("print.agent_printer_msg", String(d.printer_msg || "").slice(0, 120), "打印代理打印机说明", "打印");
    await setParam("print.agent_bartender", String(d.bartender || "").slice(0, 200), "打印代理的 BarTender 路径", "打印");
    if (String(d.tpl_dir || "").trim()) {
      await setParam("print.tpl_dir", String(d.tpl_dir).trim().slice(0, 200), "btw 模板目录", "打印");
    }
    const m = String(d.mode || "").trim().toLowerCase();
    if (m === "bt" || m === "zpl") await setParam("print.agent_mode", m, "打印代理实际通道", "打印");
    if (Array.isArray(d.tpl_files)) {
      // 代理本机目录里真实存在的 .btw（页面据此做「选本机模板」）
      const clean = [];
      for (const f of d.tpl_files.slice(0, 300)) {
        if (f && typeof f === "object" && f.name) {
          clean.push({
            name: String(f.name).slice(0, 200), sub: String(f.sub || "").slice(0, 20),
            size: Number(f.size || 0), mtime: String(f.mtime || "").slice(0, 19),
          });
        }
      }
      await setParam("print.agent_tpl_files", JSON.stringify(clean), "打印代理本机 btw 清单", "打印");
    }
    return ok(res, { now });
  });

  router.get("/pack/rule", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    let productCode = String(req.query.product_code || "").trim();
    if (moNo && !productCode) {
      const mo = (await _packMo(moNo)).rows[0];
      if (!mo) return fail(res, `工单不存在：${moNo}`);
      productCode = mo.product_code || "";
    }
    const pv = productCode ? await preview(productCode) : null;
    return ok(res, { product_code: productCode, preview: pv });
  });

  router.get("/pack/context", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const lineCode = String(req.query.line_code || "").trim();
    const openBox = await _packOpenBoxOf(moNo, lineCode);
    const boxedSn = Number((await query(
      "SELECT COUNT(*)::int AS n FROM prd_sn WHERE mo_no=$1 AND COALESCE(box_no,'')<>''",
      [moNo])).rows[0].n || 0);
    const closedBoxes = Number((await query(
      "SELECT COUNT(*)::int AS n FROM prd_box WHERE mo_no=$1 AND status=$2",
      [moNo, BOX_CLOSED])).rows[0].n || 0);
    return ok(res, {
      open_box: await _packBoxJson(openBox),
      mo_boxed_sn: boxedSn,
      mo_closed_boxes: closedBoxes,
    });
  });

  router.post("/pack/box/start", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const moNo = String(d.mo_no || "").trim();
    if (!moNo) return fail(res, "请先选择工单");
    const lineCode = String(d.line_code || "").trim();
    const wasOpen = !!(await _packOpenBoxOf(moNo, lineCode));
    const [box, err] = await _packEnsureOpenBox(moNo, d.capacity, d.tpl_code, lineCode, req.mesrjUser);
    if (err) return fail(res, err);
    return ok(res, await _packBoxJson(box),
      wasOpen
        ? `已恢复未完成装箱（${box.qty}/${box.capacity}）；箱码将在装满/封箱时自动生成`
        : `已就绪（${box.qty}/${box.capacity}）；箱码将在装满/封箱时自动生成`);
  });

  // ── W11-b：封箱核心（生成正式外箱码 + 更新明细 + 发起打印）───────────────

  async function _packCloseBox(box, auto = false, user = null) {
    if (String(box.status) !== BOX_OPEN) return [null, "外箱已封箱"];
    if (Number(box.qty || 0) <= 0) return [null, "空箱不能封箱"];
    const [rule, pc] = await ruleOfMo(box.mo_no);
    if (!rule) {
      return [null, `机型【${box.product_code || pc || "?"}】未配置装箱编码规则，` +
        "无法生成外箱码（配置中心 → 装箱编码规则）"];
    }
    const oldNo = box.box_no;
    let finalNo = null;
    for (let i = 0; i < 5; i++) {
      const cand = await nextCartonNo(rule);
      const upd = await query(
        "UPDATE prd_box SET box_no=$1, status=$2, updated_at=now() WHERE box_no=$3 RETURNING id",
        [cand, BOX_CLOSED, oldNo]);
      if (upd.rows.length) { finalNo = cand; break; }
    }
    if (!finalNo) return [null, "外箱码生成冲突，请重试"];
    // 子表引用同步替换（SN 明细）
    await query("UPDATE prd_sn SET box_no=$1, updated_at=now() WHERE box_no=$2", [finalNo, oldNo]);
    // 打印任务
    let jobNo = "", warn = "";
    const tplCode = String(box.tpl_code || rule.carton_tpl_code || "").trim();
    const tpl = tplCode
      ? (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1", [tplCode])).rows[0]
      : null;
    if (tpl) {
      const payload = _packBoxPayload(await _packBox(finalNo), rule, tpl, false, user);
      jobNo = await makePrintJob("box", finalNo, tpl, payload,
        (user && user.login_name) || "", finalNo);
      await query("UPDATE prd_box SET print_times=print_times+1, tpl_code=$1, updated_at=now() WHERE box_no=$2",
        [tpl.tpl_code, finalNo]);
    } else {
      warn = "未配置外箱打印模板，请稍后用【补打】手动打印";
    }
    await audit(_packUserName(user), "外箱绑码", auto ? "自动封箱" : "尾数封箱", finalNo,
      `${box.qty} 台（原临时号 ${oldNo}）`);
    return [{
      box: await _packBoxJson(await _packBox(finalNo)),
      final_box_no: finalNo,
      print_job: jobNo,
      print_warn: warn,
    }, null];
  }

  // ── W11-c：绑定（核心扫码动作；装满自动封箱）──────────────────────────────

  router.post("/pack/bind", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const sn = String(d.sn || "").trim();
    const moNo = String(d.mo_no || "").trim();
    const boxNo = String(d.box_no || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    const row = (await query("SELECT * FROM prd_sn WHERE sn=$1", [sn])).rows[0];
    if (!row) return fail(res, `SN【${sn}】不存在（未建档）`);
    if (!["在制", "完工"].includes(String(row.status || ""))) {
      return fail(res, `SN【${sn}】当前状态【${row.status}】，不允许装箱`);
    }
    // 防呆①-0：未检验（无成品测试记录）不许装箱
    //   装箱扫的是**整机 SN**，ICT/FCT 记录挂在 PCBA SN 上 → 要求「成品 ATE」
    if (String(await getParam("pack.require_tested", "1") || "1").trim() === "1") {
      const untested = await guard_untested(sn, await getParam("pack.require_stations", "ATE"));
      if (untested.length) return fail(res, `未过 ${untested.join("/")} · 请先测试（${sn}）`);
    }
    // 防呆①：不良品不许装箱
    if (String(await getParam("pack.check_ng", "1") || "1").trim() === "1") {
      const ngSt = await guard_open_ng(sn);
      if (ngSt) return fail(res, `${ngSt} NG 未处理 · 请先送维修（${sn}）`);
    }
    // 防呆②：必过工序没做完不许装箱
    //   ⚠ 排除「包装」本站：装箱就是包装这一步，不能要求它先完成（否则死循环）
    if (String(await getParam("pack.check_route", "1") || "1").trim() === "1") {
      const packSt = await _packPackingStation(moNo || row.mo_no, row.product_code);
      const miss = await guard_route_incomplete(sn, moNo || row.mo_no, row.product_code,
        null, packSt ? [packSt] : []);
      if (miss.length) {
        const names = miss.slice(0, 3).map(m => String(m[1] || m[0]).split(" - ")[0]).join("、");
        const more = miss.length > 3 ? "…" : "";
        return fail(res, `前置未完成 · 先做 ${names}${more}（${sn}）`);
      }
    }
    // 产线：前端选了就用前端选的；没选就按这颗 SN 最后过站的产线判定
    let lineCode = String(d.line_code || "").trim() || await _packLineOfSn(sn);
    let box;
    if (boxNo) {
      box = await _packBox(boxNo);
      if (!box) return fail(res, `外箱不存在：${boxNo}`);
      if (String(box.line_code || "")) lineCode = box.line_code;
    } else {
      if (!moNo) return fail(res, "缺少工单号");
      const [bx, err] = await _packEnsureOpenBox(moNo, d.capacity, d.tpl_code, lineCode, req.mesrjUser);
      if (err) return fail(res, err);
      box = bx;
    }
    if (String(box.status) !== BOX_OPEN) {
      return fail(res, `外箱【${box.box_no}】已封箱，不能继续装箱`);
    }
    // 产线隔离：同一张单两条线并行时，B 线的板不许装进 A 线的箱
    const bLine = String(box.line_code || "");
    const sLine = await _packLineOfSn(sn);
    if (bLine && sLine && bLine !== sLine) {
      return fail(res, `SN【${sn}】是 ${sLine} 线的板，本箱属于 ${bLine} 线 —— 同一张工单开多条线时，` +
        "每条线各装各的箱（换回本线的箱，或把本箱封掉）");
    }
    if (Number(box.qty || 0) >= Number(box.capacity || 0)) {
      return fail(res, `外箱已满（${box.qty}/${box.capacity}），请先封箱`);
    }
    if (_packSns(box).includes(sn)) return fail(res, `SN【${sn}】已在本箱中（重复扫描）`);
    if (String(row.box_no || "")) return fail(res, `SN【${sn}】已装在箱【${row.box_no}】（重复拦截）`);
    if (row.mo_no && box.mo_no && row.mo_no !== box.mo_no) {
      return fail(res, `SN【${sn}】属于工单 ${row.mo_no}，与本箱工单 ${box.mo_no} 不一致`);
    }
    const newList = box.sn_list ? `${box.sn_list},${sn}` : sn;
    await query("UPDATE prd_sn SET box_no=$1, updated_at=now() WHERE sn=$2", [box.box_no, sn]);
    await query("UPDATE prd_box SET qty=qty+1, sn_list=$1, updated_at=now() WHERE box_no=$2",
      [newList, box.box_no]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "装箱", box.box_no, sn, req.ip);
    // 装箱 = 包装作业完成 → 就地记一条「包装」过站
    //   不记的话整机码路线里 PACKING 永远是缺的，后面栈板/出货的完整性检查会一直拦
    let packNote = "";
    try {
      const pst = await _packPackingStation(box.mo_no || moNo, row.product_code);
      if (pst && String(await getParam("pack.auto_pass", "1") || "1").trim() === "1") {
        const pr = await doPassInner(
          { sn, station_code: pst, result: "OK", mo_no: box.mo_no || moNo },
          execUser(req), req.ip);
        const inner = (pr && pr.data) || {};
        if (!inner.accepted && String(inner.rule || "") !== "DUP_SN") {
          packNote = `（包装站未记入：${inner.msg || (pr && pr.msg) || "未受理"}）`;
        }
      }
    } catch (e) {
      packNote = `（包装站未记入：${e}）`;
    }
    const box2 = await _packBox(box.box_no);
    const resp = {
      box: await _packBoxJson(box2), auto_closed: false, final_box_no: "",
      print_job: "", print_warn: "",
    };
    let msg = `已装箱：${sn}（${box2.qty}/${box2.capacity}）${packNote}`;
    if (Number(box2.qty || 0) >= Number(box2.capacity || 0)) {
      const [result, err] = await _packCloseBox(box2, true, req.mesrjUser);
      if (err) {
        msg = `已装满 ${box2.qty} 台，但封箱失败：${err}（请点「尾数封箱」重试）`;
        return ok(res, resp, msg);
      }
      resp.box = result.box;
      resp.auto_closed = true;
      resp.final_box_no = result.final_box_no;
      resp.print_job = result.print_job;
      resp.print_warn = result.print_warn;
      msg = `已装满 ${box2.qty} 台 → 自动生成外箱码 ${result.final_box_no}` +
        (result.print_job ? `，打印任务 ${result.print_job} 已发送` : `（${result.print_warn}）`);
    }
    return ok(res, resp, msg);
  });

  // ── W11-d：封箱（尾数手动）/ 换模板 / 解绑 / 作废空箱 / 打印 ───────────────

  router.post("/pack/close", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const moNo = String(d.mo_no || "").trim();
    const force = !!d.force;
    let box;
    if (boxNo) box = await _packBox(boxNo);
    else if (moNo) box = await _packOpenBoxOf(moNo, String(d.line_code || "").trim());
    else return fail(res, "缺少外箱号或工单号");
    if (!box) return fail(res, "没有装箱中的外箱");
    if (String(box.status) !== BOX_OPEN) return fail(res, `外箱【${box.box_no}】已经封箱了`);
    if (Number(box.qty || 0) <= 0) return fail(res, "空箱不能封箱");
    if (Number(box.qty || 0) < Number(box.capacity || 0) && !force) {
      return fail(res, `未装满（${box.qty}/${box.capacity}）。如确需按尾数封箱，请再确认一次`);
    }
    const [result, err] = await _packCloseBox(box, false, req.mesrjUser);
    if (err) return fail(res, err);
    return ok(res, result, `已封箱（尾数 ${box.qty} 台）→ 外箱码 ${result.final_box_no}` +
      (result.print_job ? `，打印任务 ${result.print_job} 已发送` : `（${result.print_warn}）`));
  });

  router.post("/pack/box/tpl", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const tplCode = String(d.tpl_code || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`);
    if (String(box.status) !== BOX_OPEN) return fail(res, "外箱已封箱，模板不可再改");
    await query("UPDATE prd_box SET tpl_code=$1, updated_at=now() WHERE box_no=$2", [tplCode, boxNo]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "换打印模板", boxNo, tplCode, req.ip);
    return ok(res, { box_no: boxNo, tpl_code: tplCode }, "打印模板已切换");
  });

  router.post("/pack/unbind", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const sn = String(d.sn || "").trim();
    const reason = String(d.reason || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`);
    if (String(box.status) !== BOX_OPEN) return fail(res, "已封箱的外箱不能解绑（请联系管理员走特批）");
    const sns = _packSns(box);
    if (!sns.includes(sn)) return fail(res, `SN【${sn}】不在本箱中`);
    const rest = sns.filter(s => s !== sn);
    await query("UPDATE prd_sn SET box_no='', updated_at=now() WHERE sn=$1 AND box_no=$2", [sn, boxNo]);
    await query("UPDATE prd_box SET qty=$1, sn_list=$2, updated_at=now() WHERE box_no=$3",
      [rest.length, rest.join(","), boxNo]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "解绑", boxNo,
      `${sn} ${reason}`, req.ip);
    return ok(res, await _packBoxJson(await _packBox(boxNo)),
      `已解绑：${sn}（剩 ${rest.length}/${box.capacity}）`);
  });

  router.post("/pack/box/cancel", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`);
    if (String(box.status) !== BOX_OPEN) return fail(res, "已封箱的箱不能作废");
    if (Number(box.qty || 0) > 0) {
      return fail(res, `箱内已有 ${box.qty} 台产品，不能作废（请先逐台解绑）`);
    }
    await query("DELETE FROM prd_box WHERE box_no=$1 AND qty=0", [boxNo]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "作废空箱", boxNo, "", req.ip);
    return ok(res, null, "空箱已作废");
  });

  router.post("/pack/print", requireMesrjPerm("prod.pack"), async (req, res) => {
    const d = req.body || {};
    const boxNo = String(d.box_no || "").trim();
    const reprint = !!d.reprint;
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`);
    if (String(box.status) !== BOX_CLOSED) return fail(res, "请先完成封箱再打印标签");
    const [rule, pc] = await ruleOfMo(box.mo_no);
    if (!rule) return fail(res, `机型【${box.product_code || pc || "?"}】未配置装箱编码规则`);
    const tplCode = String(d.tpl_code || "").trim() || String(box.tpl_code || "") ||
      String(rule.carton_tpl_code || "");
    const tpl = tplCode
      ? (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1", [tplCode])).rows[0]
      : null;
    if (!tpl) return fail(res, "请先选择打印模板（配置中心 → 打印模板）");
    const payload = _packBoxPayload(box, rule, tpl, reprint, req.mesrjUser);
    const jobNo = await makePrintJob("box", box.box_no, tpl, payload,
      (req.mesrjUser || {}).login_name || "", box.box_no);
    await query("UPDATE prd_box SET print_times=print_times+1, tpl_code=$1, updated_at=now() WHERE box_no=$2",
      [tpl.tpl_code, boxNo]);
    await audit((req.mesrjUser || {}).login_name || "", "外箱绑码", "打印标签", boxNo,
      `${tpl.tpl_code} ${reprint ? "补打" : "打印"}`, req.ip);
    return ok(res, { job_no: jobNo, payload },
      `已生成打印任务 ${jobNo}（等待打印程序取走）`);
  });

  // ── W11-e：打印任务队列 / 标签预览 / 查询 / 模板浏览 ───────────────────────

  router.get("/pack/jobs", requireMesrjPerm(null), async (req, res) => {
    const status = String(req.query.status || "待打印").trim();
    const refType = String(req.query.ref_type || "").trim();
    const limit = Math.min(Number(req.query.limit || 20) || 20, 100);
    const jobNo = String(req.query.job_no || "").trim();
    const w = ["status=$1"], args = [status];
    if (refType) { w.push(`ref_type=$${args.length + 1}`); args.push(refType); }
    if (jobNo) { w.push(`job_no=$${args.length + 1}`); args.push(jobNo); }
    const rows = (await query(
      `SELECT * FROM prd_print_job WHERE ${w.join(" AND ")} ORDER BY id LIMIT $${args.length + 1}`,
      [...args, limit])).rows;
    const out = rows.map(r => {
      const d = { ...r, created_at: tsLocal(r.created_at), printed_at: tsLocal(r.printed_at) };
      try { d.payload = JSON.parse(d.payload || "{}"); } catch { d.payload = {}; }
      return d;
    });
    return ok(res, out);
  });

  router.post("/pack/jobs/:job_no/done", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const done = d.ok !== false;
    const msg = String(d.msg || "").trim();
    const jobNo = String(req.params.job_no || "").trim();
    const job = (await query("SELECT id FROM prd_print_job WHERE job_no=$1", [jobNo])).rows[0];
    if (!job) return fail(res, `打印任务不存在：${jobNo}`, 404);
    const status = done ? "已打印" : "失败";
    await query("UPDATE prd_print_job SET status=$1, printed_at=now(), print_msg=$2 WHERE job_no=$3",
      [status, msg, jobNo]);
    return ok(res, null, `任务 ${jobNo} 已标记为 ${status}`);
  });

  /** 该箱用的打印模板（源 _tpl_of） */
  async function _packTplOf(box) {
    const [rule] = await ruleOfMo(box.mo_no);
    const code = String(box.tpl_code || "").trim() || String((rule || {}).carton_tpl_code || "");
    const tpl = code
      ? (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1", [code])).rows[0]
      : null;
    return tpl || { tpl_code: code, tpl_name: code, file_name: "", fields: "[]" };
  }

  /** 按当前箱生成打印数据；若有 .btw 模板，按模板槽位数重新分页（源 _preview_payload） */
  async function _packPreviewPayload(box) {
    const [rule] = await ruleOfMo(box.mo_no);
    const tpl = await _packTplOf(box);
    const payload = _packBoxPayload(box, rule || {}, tpl, box.status === BOX_CLOSED);
    let slots = 0, tplFile = "";
    const tplDir = String(await getParam("print.tpl_dir", "") || "").trim();
    if (tplDir && tpl.file_name) {
      const fpath = path.join(tplDir, tpl.file_name);
      if (existsSync(fpath)) {
        tplFile = fpath;
        try {
          const prompts = readTemplatePrompts(fpath);
          slots = prompts.filter(x => x.toUpperCase().includes("QRCODE")).length;
        } catch { slots = 0; }
      }
    }
    if (slots) {   // 按模板槽位数切页（模板改了就跟着变）
      const sns = payload.sns || [];
      payload.sn_pages = [];
      for (let i = 0; i < sns.length; i += slots) payload.sn_pages.push(sns.slice(i, i + slots));
      if (!payload.sn_pages.length) payload.sn_pages = [[]];
    }
    return [payload, slots, path.basename(tplFile)];
  }

  router.get("/pack/preview/info", requireMesrjPerm(null), async (req, res) => {
    const boxNo = String(req.query.box_no || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`, 404);
    const [payload, slots, tplFile] = await _packPreviewPayload(box);
    return ok(res, {
      box_no: boxNo, qty: box.qty, status: box.status,
      tpl_code: box.tpl_code, tpl_file: tplFile,
      slots: slots || 48, pages: (payload.sn_pages || [[]]).length,
      sns: (payload.sns || []).length,
    });
  });

  router.get("/pack/preview", requireMesrjPerm(null), async (req, res) => {
    // 返回标签图（page 从 1 开始）
    //   源用 PIL 渲染 PNG；Node 无字体渲染库 → 同版式改出 SVG（<img src> 直接用）
    const boxNo = String(req.query.box_no || "").trim();
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`, 404);
    const [payload, slots] = await _packPreviewPayload(box);
    const pages = buildPages(payload);
    if (!pages.length) return fail(res, "没有可预览的内容");
    const op = pages[Math.min(page - 1, pages.length - 1)];
    const svg = renderSvg([op]);
    const img = "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
    return ok(res, { page, pages: pages.length, mode: "zpl", slots: slots || 48, err: null, img, payload });
  });

  router.get("/pack/box/list", requireMesrjPerm(null), async (req, res) => {
    const page = Math.max(Number(req.query.page || 1) || 1, 1);
    const size = Math.min(Math.max(Number(req.query.size || 50) || 50, 1), 200);
    const w = [], args = [];
    const moNo = String(req.query.mo_no || "").trim();
    const status = String(req.query.status || "").trim();
    const keyword = String(req.query.keyword || "").trim();
    if (moNo) { w.push(`mo_no=$${args.length + 1}`); args.push(moNo); }
    if (status) { w.push(`status=$${args.length + 1}`); args.push(status); }
    if (keyword) { w.push(`box_no ILIKE $${args.length + 1}`); args.push(`%${keyword}%`); }
    const where = w.length ? `WHERE ${w.join(" AND ")}` : "";
    const total = Number((await query(
      `SELECT COUNT(*)::int AS n FROM prd_box ${where}`, args)).rows[0].n || 0);
    const rows = (await query(
      `SELECT * FROM prd_box ${where} ORDER BY id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, (page - 1) * size])).rows;
    const out = [];
    for (const r of rows) out.push(await _packBoxJson(r, false));
    return ok(res, { rows: out, total, page, size });
  });

  router.get("/pack/box/:box_no", requireMesrjPerm(null), async (req, res) => {
    const boxNo = String(req.params.box_no || "").trim();
    const box = await _packBox(boxNo);
    if (!box) return fail(res, `外箱不存在：${boxNo}`, 404);
    const jobs = (await query(
      `SELECT job_no, ref_type, ref_no, status, tpl_code, created_at, printed_at
       FROM prd_print_job WHERE ref_no=$1 ORDER BY id DESC LIMIT 10`, [boxNo])).rows
      .map(j => ({ ...j, created_at: tsLocal(j.created_at), printed_at: tsLocal(j.printed_at) }));
    const [rule] = await ruleOfMo(box.mo_no);
    return ok(res, {
      box: await _packBoxJson(box), jobs, rule,
      machine_model: (rule || {}).machine_model || "",
    });
  });

  router.get("/pack/tpl/files", requireMesrjPerm(null), async (_req, res) => {
    // 打印电脑上实际存在的 .btw（供页面「选本机模板」）
    const files = await _packAgentTplFiles();
    const ag = await _packAgentState();
    return ok(res, {
      tpl_dir: String(await getParam("print.tpl_dir", "") || "").trim(),
      files, count: files.length,
      mode: String(await getParam("print.agent_mode", "") || "").trim(),
      agent_alive: ag.alive, last_seen: ag.last_seen,
      bartender: ag.bartender || "",
    });
  });

  router.get("/pack/tpl/browse", requireMesrjPerm("prod.pack"), async (req, res) => {
    // 浏览磁盘目录挑 .btw 模板（网页读不了本地磁盘，由服务端代劳）。只读。
    const drives = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("")
      .map(L => `${L}:\\`).filter(d => existsSync(d));
    let d = String(req.query.dir || "").trim().replace(/^"|"$/g, "");
    if (!d) {
      return ok(res, { dir: "", parent: "", dirs: [], files: [], drives,
        default: String(await getParam("print.tpl_dir", "") || "") });
    }
    d = path.normalize(d);
    if (!existsSync(d) || !statSync(d).isDirectory()) {
      return fail(res, `目录不存在或不可读：${d}`);
    }
    const dirs = [], files = [];
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return fail(res, `没有权限读取：${d}`);
    }
    entries.sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1, bd = b.isDirectory() ? 0 : 1;
      return ad !== bd ? ad - bd : a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name.startsWith("$") || e.name.startsWith("System Volume")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) dirs.push({ name: e.name, path: full });
      else if (e.name.toLowerCase().endsWith(".btw")) {
        let st = null;
        try { st = statSync(full); } catch { continue; }
        files.push({ name: e.name, path: full, size: st.size, mtime: tsLocal(st.mtime) });
      }
    }
    let parent = path.dirname(d.replace(/[\\/]+$/, ""));
    if (parent === d || !parent) parent = "";
    return ok(res, { dir: d, parent, dirs, files, drives });
  });

  router.post("/pack/tpl/quick", requireMesrjPerm("prod.pack"), async (req, res) => {
    // 「浏览…」选中的 .btw：已登记过就直接用，没登记就自动建一条
    const d = req.body || {};
    const p = String(d.path || "").trim().replace(/^"|"$/g, "");
    let kind = String(d.tpl_type || "外箱标签").trim();
    if (!["外箱标签", "栈板标签", "测试标签", "物料标签"].includes(kind)) kind = "外箱标签";
    if (!p) return fail(res, "没有选中文件");
    if (!existsSync(p) || !statSync(p).isFile()) return fail(res, `文件不存在：${p}`);
    if (!p.toLowerCase().endsWith(".btw")) return fail(res, "只支持 BarTender 模板（.btw）");
    const base = path.basename(p);
    const hit = (await query(
      `SELECT * FROM cfg_print_tpl WHERE file_name=$1 OR file_name=$2 ORDER BY enabled DESC, id LIMIT 1`,
      [p, base])).rows[0];
    if (hit) {
      if (!Number(hit.enabled || 0)) {
        await query("UPDATE cfg_print_tpl SET enabled=1 WHERE id=$1", [hit.id]);
      }
      return ok(res, { tpl_code: hit.tpl_code, tpl_name: hit.tpl_name, created: false, enabled: 1 },
        `已有该模板登记，直接选用：${hit.tpl_name}`);
    }
    const stamp = new Date();
    const pad = n => String(n).padStart(2, "0");
    let code = "TPL-" +
      `${String(stamp.getFullYear()).slice(2)}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}` +
      `${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
    while ((await query("SELECT id FROM cfg_print_tpl WHERE tpl_code=$1", [code])).rows[0]) code += "X";
    const name = path.basename(base, path.extname(base));
    const sortNo = Number((await query(
      "SELECT COALESCE(MAX(sort_no),0)+10 AS n FROM cfg_print_tpl")).rows[0].n || 10);
    await query(
      `INSERT INTO cfg_print_tpl (tpl_code, tpl_name, tpl_type, product_code, file_name, fields,
         enabled, sort_no, remark) VALUES ($1,$2,$3,'',$4,'["SN","Carton"]',1,$5,$6)`,
      [code, name, kind, p, sortNo, `页面「浏览…」选磁盘文件自动登记（${kind}）`]);
    await audit(_packUserName(req.mesrjUser) || "system", "打印模板", "浏览登记", code, p);
    return ok(res, { tpl_code: code, tpl_name: name, created: true, enabled: 1 },
      `已登记并选用：${base}`);
  });

  router.get("/pack/stats", requireMesrjPerm(null), async (req, res) => {
    // 外箱绑码页顶部的产能带：本工单计划 / 已装箱 / 剩余 / 达成率 + 今日小时产量
    //   口径：只算 prd_box 里**已封箱**的箱，正在装的箱单独给 current
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return ok(res, { empty: true });
    const mo = (await query("SELECT mo_no, plan_qty FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    const boxes = (await query(
      `SELECT box_no, qty, capacity, status, created_at, pallet_no FROM prd_box
       WHERE mo_no=$1 AND COALESCE(status,'')<>'作废' ORDER BY id`, [moNo])).rows
      .map(b => ({ ...b, created_at: tsLocal(b.created_at) }));
    const closed = boxes.filter(b => String(b.status || "") === BOX_CLOSED);
    const opening = boxes.filter(b => String(b.status || "") !== BOX_CLOSED);
    const plan = Number(mo.plan_qty || 0);
    const packed = closed.reduce((a, b) => a + Number(b.qty || 0), 0);
    const curQty = opening.reduce((a, b) => a + Number(b.qty || 0), 0);
    const curCap = opening.reduce((a, b) => Math.max(a, Number(b.capacity || 0)), 0);
    const today = todayStr();
    const hourly = {};
    for (const b of closed) {
      const t = String(b.created_at || "").slice(0, 13);
      if (t.startsWith(today)) {
        const h = t.slice(11, 13);
        hourly[h] = (hourly[h] || 0) + Number(b.qty || 0);
      }
    }
    const hours = [];
    for (let h = 8; h <= 20; h++) hours.push({ h: String(h).padStart(2, "0"), n: hourly[String(h).padStart(2, "0")] || 0 });
    return ok(res, {
      mo_no: moNo, plan_qty: plan,
      packed_qty: packed,
      rest_qty: Math.max(0, plan - packed),
      box_qty: closed.length,
      cur_qty: curQty,
      cur_cap: curCap || Number(await getParam("BOX_CAPACITY", "96") || 96),
      rate: plan ? Math.round(packed * 1000 / plan) / 10 : 0,
      today_boxes: closed.filter(b => String(b.created_at || "").slice(0, 10) === today).length,
      today_qty: hours.reduce((a, h) => a + h.n, 0),
      hourly: hours,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // W12：面板/分板（源 api/panel.py，10 路由）
  // ═══════════════════════════════════════════════════════════════════════════

  router.get("/panel/sn/parse", requireMesrjPerm(null), async (req, res) => {
    const p = parseSn(String(req.query.sn || ""));
    return ok(res, p ? { sn: req.query.sn, prefix: p.prefix, num: p.num, suffix: p.suffix, width: p.width } : { sn: req.query.sn, error: "无法解析 SN" });
  });

  router.get("/panel/layout/list", requireMesrjPerm(null), async (_req, res) => {
    const r = await listLayouts();
    return ok(res, r.rows);
  });

  router.post("/panel/layout/save", requireMesrjPerm("cfg.edit"), async (req, res) => {
    try {
      const r = await saveLayout(req.body || {});
      return ok(res, r, "布局已保存");
    } catch (e) { return fail(res, e.message); }
  });

  router.post("/panel/layout/delete", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const id = Number(req.body && req.body.id);
    if (!id) return fail(res, "缺少布局 id");
    await deleteLayout(id);
    return ok(res, { id }, "布局已删除");
  });

  router.get("/panel/view", requireMesrjPerm(null), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    const layoutId = req.query.layout_id ? Number(req.query.layout_id) : null;
    if (!sn) return fail(res, "缺少 SN");
    const v = await buildView(sn, layoutId);
    if (!v) return fail(res, `未找到产品：${sn}`);
    return ok(res, v);
  });

  router.post("/panel/judge", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const r = await judgeSlot(String(d.mo_no || "").trim(), String(d.station_code || "").trim());
    if (!r.ok) return fail(res, r.msg);
    return ok(res, { ok: true });
  });

  router.get("/panel/next", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const curStation = String(req.query.cur_station || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const nxt = await resolveNext(moNo, curStation);
    return ok(res, nxt);
  });

  router.post("/panel/align", requireMesrjPerm(null), async (req, res) => {
    const sn = String(req.body && req.body.sn || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    const layout = await alignLayout(sn);
    return ok(res, { layout });
  });

  router.get("/panel/aging", requireMesrjPerm(null), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    const a = await agingOf(sn);
    return ok(res, a);
  });

  router.get("/panel/layout/match", requireMesrjPerm(null), async (req, res) => {
    const layout = await matchLayout(String(req.query.product_code || "").trim() || undefined, String(req.query.model || "").trim() || undefined);
    return ok(res, { layout });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // W12：面板/分板剩余 7 路由（源 api/panel.py —— scan/current/complete/reset/detail/list/hourly）
  // ═══════════════════════════════════════════════════════════════════════════

  const _panelNow = () => { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

  // ── POST /panel/scan ── 核心：扫一块 → 自动归位 → 系统判定 ──
  router.post("/panel/scan", requireMesrjPerm("prod.panel"), async (req, res) => {
    const d = req.body || {};
    const sn = String(d.sn || "").trim();
    const station = String(d.station_code || "").trim();
    const moNo = String(d.mo_no || "").trim();
    const layoutId = d.layout_id;
    if (!sn) return fail(res, "请扫条码");

    const p = parseSn(sn);
    if (!p) return fail(res, `条码无效：${sn}`);
    const { prefix, num, suffix } = p;

    // 工位必须在这张工单的工艺里
    if (moNo && station) {
      try {
        const [steps] = await ensureMoRoute(moNo, "");
        if (steps && !step_of(steps, station)) {
          const mo = (await query("SELECT process_code FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0] || {};
          const pnMap = { "01": "SMT", "02": "DIP", "03": "组装", "04": "包装" };
          const pn = pnMap[String(mo.process_code || "")] || "";
          return fail(res,
            `工单 ${moNo} 是${pn || ""}工序单，这里面没有「${station}」这一站。分板属于组装段，请在上方工单下拉里换成组装段（P03）的工单再扫`);
        }
      } catch { /* ignore */ }
    }

    // 已扫过（跨版也不行）
    const dupR = await query(
      `SELECT s.*, p.panel_sn AS pn, p.status AS pstatus, p.total AS ptotal
       FROM prd_panel_slot s JOIN prd_panel_split p ON s.split_id=p.id
       WHERE s.child_sn=$1 AND p.status<>'已作废'`, [sn]);
    if (dupR.rows[0]) {
      const dup = dupR.rows[0];
      const sp0 = (await query("SELECT * FROM prd_panel_split WHERE id=$1", [dup.split_id])).rows[0];
      const j = dup.judge || "NONE";
      const _done = sp0 && (sp0.status || "") === "已完成";
      const _tt = Number(sp0 ? (sp0.total || 0) : 0);
      const _nextTip = _done
        ? "这一版已经收尾了 —— 要扫下一版，直接扫新一版的任意一块即可"
        : `这一版还没收尾，扫满 ${_tt} 块会自动完成；要开新一版请先点「扫描完成」`;
      if (j === "OK") {
        return fail(res, `这块板已在「${dup.pn || "（无版号）"}」这一版扫过（P${dup.slot_no}，良品）。${_nextTip}`);
      }
      if (j === "ICT_NG" || j === "FCT_NG" || j === "BOTH_NG") {
        const jt = { ICT_NG: "ICT NG", FCT_NG: "FCT NG", BOTH_NG: "ICT+FCT 双 NG" }[j];
        return fail(res, `这块板已在「${dup.pn || "（无版号）"}」这一版扫过（P${dup.slot_no}，${jt} → 维修）。${_nextTip}`);
      }
      return fail(res,
        `这块板已在「${dup.pn || "（无版号）"}」这一版扫过（P${dup.slot_no}，未查到 ICT/FCT 记录）。一版扫一块就够、整版自动带出，不用逐块扫。${_nextTip}`);
    }

    // 查找进行中的版
    let split = null;
    if (station) {
      const r = await query("SELECT * FROM prd_panel_split WHERE status='扫描中' AND station_code=$1 ORDER BY id DESC LIMIT 1", [station]);
      split = r.rows[0] || null;
    }
    let layout = null;
    if (split) {
      const r = await query("SELECT * FROM cfg_panel_layout WHERE model=$1 ORDER BY id DESC LIMIT 1", [split.model]);
      layout = r.rows[0] || null;
    }
    if (!layout) {
      let mo = null;
      if (moNo) {
        const r = await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo]);
        mo = r.rows[0] || null;
      }
      if (!mo && station) {
        const st0 = (await query("SELECT * FROM md_station WHERE station_code=$1", [station])).rows[0];
        if (st0 && st0.line_code) {
          const r = await query("SELECT * FROM ord_mo WHERE line_code=$1 AND status='生产中' ORDER BY id DESC LIMIT 1", [st0.line_code]);
          mo = r.rows[0] || null;
        }
      }
      layout = await matchLayout(mo ? mo.product_code : undefined, mo ? mo.product_code : undefined);
      if (!layout) return fail(res, "未配置拼版布局，请先选布局");
    }

    const cols = Number(layout.cols || 1);
    const total = Number(layout.total || 0);
    const serpentine = layout.serpentine != null ? Number(layout.serpentine) : 1;

    // 版起点：优先按 seq_offset 对齐，否则用测试记录探测
    const detected = await _detectBaseByRecords(sn, total, layout.seq_offset != null ? String(layout.seq_offset) : null);
    let effBase;
    if (detected != null) {
      layout = { ...layout, seq_offset: detected % total };
      effBase = detected;
    } else {
      const so = layout.seq_offset;
      effBase = num - (so == null || so === "" ? 0 : (num - Number(so)) % total);
      if (effBase < 1) {
        return fail(res,
          `这一版的起始号算成了 ${effBase}（不可能）。说明「拼版布局」里的「起始流水号(seq_offset)」和实际发号规则不一致 —— 扫到的是 ${num} 号，offset 配的是 ${so}。请到「配置中心 → 拼版布局」改成实际起始号`);
      }
    }

    // 判断是否属于当前进行中的版
    let samePanel = false;
    if (split && split.seq_base != null) {
      if (effBase === Number(split.seq_base)) samePanel = true;
    }

    let openedNew = false;
    if (!samePanel) {
      if (split) {
        await query("UPDATE prd_panel_split SET status='已结束', finished_at=$1 WHERE id=$2", [_panelNow(), split.id]);
      }
      const snsCalc = await panelSnsFor(moNo, sn);
      if (!snsCalc.sns || snsCalc.sns.length === 0) return fail(res, "无法推算整版条码");
      const stRow = (await query("SELECT * FROM md_station WHERE station_code=$1", [station])).rows[0] || {};
      let useMo = moNo || "";
      if (useMo && stRow) {
        const m = (await query("SELECT line_code FROM ord_mo WHERE mo_no=$1", [useMo])).rows[0];
        if (m && (m.line_code || "") !== (stRow.line_code || "")) useMo = "";
      }
      const panelSn = `${(prefix || "PANEL").replace(/-/g, "") || "PANEL"}-${String(effBase).padStart(p.width, "0")}`;
      const old = (await query("SELECT * FROM prd_panel_split WHERE panel_sn=$1", [panelSn])).rows[0];
      if (old) {
        if ((old.status || "") === "已作废") {
          await query("UPDATE prd_panel_split SET panel_sn=$1 WHERE id=$2", [`${panelSn}#作废${old.id}`, old.id]);
        } else {
          await query("DELETE FROM prd_panel_slot WHERE split_id=$1", [old.id]);
          await query("DELETE FROM prd_panel_split WHERE id=$1", [old.id]);
        }
      }
      const sidR = await query(
        `INSERT INTO prd_panel_split (panel_sn, mo_no, station_code, line_code, product_code, model, cols, rows, total, serpentine, seq_base, seq_offset, orientation, good_cnt, ng_cnt, scanned_cnt, status, operator, started_at, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,0,'扫描中',$14,$15,$16) RETURNING id`,
        [panelSn, useMo, station, (stRow.line_code || ""), layout.product_code || "", layout.model,
         cols, Number(layout.rows || 1), total, serpentine, effBase, layout.seq_offset,
         layout.orientation || "landscape",
         (req.mesrjUser && (req.mesrjUser.emp_name || req.mesrjUser.login_name)) || "",
         _panelNow(), `锚点 ${sn}`]);
      const sid = sidR.rows[0].id;
      split = (await query("SELECT * FROM prd_panel_split WHERE id=$1", [sid])).rows[0];
      openedNew = true;
    }

    const idx = (num - Number(split.seq_base)) % total;
    const pos = _posOfIndex0(idx, cols, serpentine);
    const taken = await query("SELECT * FROM prd_panel_slot WHERE split_id=$1 AND slot_no=$2", [split.id, pos]);
    if (taken.rows[0]) return fail(res, `第 ${pos} 格已占用：${taken.rows[0].child_sn}`);

    // 一键整版：扫一块 → 按拼版规则把整版 N 块全部带出并逐个判定
    const autoFill = d.auto_fill === true;
    let filled = 0, skipped = [];
    let todo = [[pos, sn, num]];
    if (autoFill) {
      const baseI = Number(split.seq_base);
      const pfx = parseSn(sn);
      todo = [];
      if (pfx) {
        for (let i = 0; i < total; i++) {
          const nI = baseI + i;
          const posI = _posOfIndex0(i, cols, serpentine);
          todo.push([posI, joinSn(pfx.prefix, nI, pfx.suffix, pfx.width), nI]);
        }
      }
    }

    for (const [posI, snI, numI] of todo) {
      const exists = await query("SELECT id FROM prd_panel_slot WHERE split_id=$1 AND slot_no=$2", [split.id, posI]);
      if (exists.rows[0]) continue;
      const cross = await query(
        `SELECT s.id FROM prd_panel_slot s JOIN prd_panel_split p ON s.split_id=p.id WHERE s.child_sn=$1 AND s.split_id<>$2`, [snI, split.id]);
      if (cross.rows[0]) { skipped.push(snI); continue; }
      const infoI = await _judgeSlotByTest(snI);
      const disp = infoI.judge === "ICT_NG" || infoI.judge === "FCT_NG" || infoI.judge === "BOTH_NG"
        ? "放入不良品盒"
        : infoI.judge === "OK" ? "可流入下一站" : "";
      await query(
        `INSERT INTO prd_panel_slot (split_id, panel_sn, slot_no, row_idx, col_idx, child_sn, seq_no_val, ict_result, fct_result, judge, disposition, scanned_at, operator)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [split.id, split.panel_sn, posI, Math.floor((posI - 1) / cols) + 1, (posI - 1) % cols + 1, snI, numI,
         infoI.ict_result, infoI.fct_result, infoI.judge, disp, _panelNow(),
         (req.mesrjUser && (req.mesrjUser.emp_name || req.mesrjUser.login_name)) || ""]);
      if (autoFill) filled += 1;
      try {
        const hasRel = (await query("SELECT id FROM prd_sn_rel WHERE parent_sn=$1 AND child_sn=$2", [split.panel_sn, snI])).rows[0];
        if (!hasRel) {
          await query(
            `INSERT INTO prd_sn_rel (parent_sn, child_sn, rel_type, station, operator, is_active, mo_no, created_at)
             VALUES ($1,$2,'PANEL_SPLIT',$3,$4,1,$5,$6)`,
            [split.panel_sn, snI, station, (req.mesrjUser && req.mesrjUser.login_name) || "", split.mo_no || "", _panelNow()]);
        }
      } catch { /* prd_sn_rel may not exist in older DB */ }
    }

    const info = await _judgeSlotByTest(sn);
    const viewStats = await _buildView(split);
    await query(
      "UPDATE prd_panel_split SET good_cnt=$1, ng_cnt=$2, scanned_cnt=$3 WHERE id=$4",
      [viewStats.stats.ok, viewStats.stats.need_take, viewStats.stats.scanned, split.id]);
    split = (await query("SELECT * FROM prd_panel_split WHERE id=$1", [split.id])).rows[0];

    const judgeTxt = { OK: "OK 良品", ICT_NG: "ICT 不良", FCT_NG: "FCT 不良", BOTH_NG: "ICT+FCT 双不良", NONE: "无 ICT/FCT 记录" }[info.judge] || "";
    const { passNext, ngNext } = await _resolveNext(split);

    let warn = "";
    if (viewStats.stats.scanned && viewStats.stats.none === viewStats.stats.scanned) {
      warn = `无测试记录 · 请确认这批 SN 是否已过 ICT/FCT（起点 ${split.seq_base}）`;
    }

    return ok(res, {
      split, layout, slots: viewStats.view, stats: viewStats.stats,
      next: { pass: passNext, ng: ngNext }, warn,
      hit_slot: pos, judge: info.judge, judge_txt: judgeTxt,
      ict_result: info.ict_result, fct_result: info.fct_result,
      opened_new: openedNew, auto_filled: filled, skipped,
      msg: autoFill ? `扫一块已自动带出整版 ${viewStats.stats.scanned} 块` : `第 ${pos} 格 · ${judgeTxt}`,
    });
  });

  // ── GET /panel/current ── 当前工位进行中的版 ──
  router.get("/panel/current", requireMesrjPerm(null), async (req, res) => {
    const station = String(req.query.station_code || "").trim();
    const split = (await query("SELECT * FROM prd_panel_split WHERE status='扫描中' AND station_code=$1 ORDER BY id DESC LIMIT 1", [station])).rows[0] || null;
    if (!split) return ok(res, { split: null, slots: [], stats: null });
    const layout = (await query("SELECT * FROM cfg_panel_layout WHERE model=$1 ORDER BY id DESC LIMIT 1", [split.model])).rows[0] || null;
    const viewStats = await _buildView(split);
    const { passNext, ngNext } = await _resolveNext(split);
    return ok(res, { split, layout, slots: viewStats.view, stats: viewStats.stats, next: { pass: passNext, ng: ngNext } });
  });

  // ── POST /panel/complete ── 完成当前版（良品自动过站） ──
  router.post("/panel/complete", requireMesrjPerm("prod.panel"), async (req, res) => {
    const d = req.body || {};
    const splitId = d.split_id;
    const doPass = d.do_pass !== false;
    if (!splitId) return fail(res, "缺少 split_id");
    const split = (await query("SELECT * FROM prd_panel_split WHERE id=$1", [Number(splitId)])).rows[0] || null;
    if (!split) return fail(res, "会话不存在");
    if (split.status !== "扫描中") return fail(res, `该版已是「${split.status}」，不能完成`);
    const slots = (await query("SELECT * FROM prd_panel_slot WHERE split_id=$1 ORDER BY slot_no", [split.id])).rows;
    if (!slots.length) return fail(res, "还没有扫任何一块");
    const okSlots = slots.filter(s => s.judge === "OK");
    const ngSlots = slots.filter(s => s.judge === "ICT_NG" || s.judge === "FCT_NG" || s.judge === "BOTH_NG");

    let passed = 0, failed = [];
    if (doPass && split.station_code) {
      let passMo = split.mo_no || "";
      if (passMo) {
        const m = (await query("SELECT line_code FROM ord_mo WHERE mo_no=$1", [passMo])).rows[0];
        if (m && (m.line_code || "") !== (split.line_code || "")) passMo = "";
      }
      for (const s of okSlots) {
        try {
          const r = await doPassInner({
            sn: s.child_sn, station_code: split.station_code, mo_no: passMo, result: "OK",
            remark: `分板工位过站（版 ${split.panel_sn} 第 ${s.slot_no} 格）`,
          }, { login_name: `PANEL:${split.operator || ""}`, emp_name: split.operator || "分板工位", id: 0 }, req.ip);
          const body = Array.isArray(r) ? r[0] : r;
          const data = (body && body.data) || {};
          if ((body && body.success !== false) && data.accepted) {
            passed += 1;
          } else {
            failed.push({ sn: s.child_sn, msg: data.msg || body.msg || "过站失败" });
          }
        } catch (e) { failed.push({ sn: s.child_sn, msg: String(e).slice(0, 120) }); }
      }
    }

    await query(
      "UPDATE prd_panel_split SET status='已完成', finished_at=$1, good_cnt=$2, ng_cnt=$3, scanned_cnt=$4 WHERE id=$5",
      [_panelNow(), okSlots.length, ngSlots.length, slots.length, split.id]);
    return ok(res, {
      panel_sn: split.panel_sn, good: okSlots.length, need_take: ngSlots.length,
      scanned: slots.length, total: Number(split.total || 0), passed, failed,
      take_list: ngSlots.map(s => ({ slot_no: s.slot_no, sn: s.child_sn, judge: s.judge })),
    }, `完成：良品 ${okSlots.length} 块，需取出 ${ngSlots.length} 块`);
  });

  // ── POST /panel/reset ── 作废当前版（格子保留，仅改状态） ──
  router.post("/panel/reset", requireMesrjPerm("prod.panel"), async (req, res) => {
    const d = req.body || {};
    const splitId = d.split_id;
    const station = String(d.station_code || "").trim();
    let split = null;
    if (splitId) {
      const r = await query("SELECT * FROM prd_panel_split WHERE id=$1", [Number(splitId)]);
      split = r.rows[0] || null;
    } else if (station) {
      const r = await query("SELECT * FROM prd_panel_split WHERE status='扫描中' AND station_code=$1 ORDER BY id DESC LIMIT 1", [station]);
      split = r.rows[0] || null;
    }
    if (!split) return fail(res, "没有进行中的版");
    if (split.status !== "扫描中") return fail(res, `该版已是「${split.status}」，不能作废`);
    await query("UPDATE prd_panel_split SET status='已作废', finished_at=$1 WHERE id=$2", [_panelNow(), split.id]);
    return ok(res, null, "已作废；原记录保留可追溯");
  });

  // ── GET /panel/detail/:panel_sn ── 版详情 ──
  router.get("/panel/detail/:panel_sn", requireMesrjPerm(null), async (req, res) => {
    const panelSn = String(req.params.panel_sn || "").trim();
    const split = (await query("SELECT * FROM prd_panel_split WHERE panel_sn=$1", [panelSn])).rows[0] || null;
    if (!split) return fail(res, "没有该版的分板记录", 404);
    const slots = (await query("SELECT * FROM prd_panel_slot WHERE split_id=$1 ORDER BY slot_no", [split.id])).rows;
    return ok(res, { split, slots });
  });

  // ── GET /panel/list ── 版列表（分页） ──
  router.get("/panel/list", requireMesrjPerm(null), async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(100, Math.max(1, Number(req.query.size || 20)));
    const offset = (page - 1) * size;
    const where = [];
    const args = [];
    const kw = String(req.query.keyword || "").trim();
    if (kw) { where.push("(panel_sn ILIKE $1 OR mo_no ILIKE $2)"); args.push(`%${kw}%`, `%${kw}%`); }
    const st = String(req.query.f_status || "").trim();
    if (st) { where.push(`status=$${args.length + 1}`); args.push(st); }
    const d1 = String(req.query.d1 || "").trim();
    if (d1) { where.push(`started_at::date >= $${args.length + 1}`); args.push(d1); }
    const d2 = String(req.query.d2 || "").trim();
    if (d2) { where.push(`started_at::date <= $${args.length + 1}`); args.push(d2); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const cnt = (await query(`SELECT COUNT(*) FROM prd_panel_split ${w}`, args)).rows[0];
    const total = Number(cnt.count);
    const rows = (await query(
      `SELECT * FROM prd_panel_split ${w} ORDER BY id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, size, offset])).rows;
    return ok(res, { page, size, total, rows });
  });

  // ── GET /panel/hourly ── 分板产能（按小时） ──
  router.get("/panel/hourly", requireMesrjPerm(null), async (req, res) => {
    const day = String(req.query.d1 || "").trim() || new Date().toISOString().slice(0, 10);
    const station = String(req.query.station_code || "").trim();
    const where = ["date(s.scanned_at)=$1"];
    const args = [day];
    if (station) { where.push(`p.station_code=$${args.length + 1}`); args.push(station); }
    const rows = (await query(
      `SELECT to_char(s.scanned_at, 'HH24') AS h,
              COUNT(*) AS blocks,
              SUM(CASE WHEN s.judge IN ('ICT_NG','FCT_NG','BOTH_NG') THEN 1 ELSE 0 END) AS ng,
              COUNT(DISTINCT s.split_id) AS panels
       FROM prd_panel_slot s JOIN prd_panel_split p ON s.split_id=p.id
       WHERE ${where.join(" AND ")} GROUP BY h ORDER BY h`, args)).rows;
    const buckets = {};
    for (const r of rows) buckets[r.h] = r;
    const out = [];
    for (let h = 0; h < 24; h++) {
      const key = String(h).padStart(2, "0");
      const r = buckets[key];
      out.push({
        hour: key,
        label: `${key}-${String((h + 1) % 24).padStart(2, "0")}`,
        panels: r ? Number(r.panels || 0) : 0,
        blocks: r ? Number(r.blocks || 0) : 0,
        ng: r ? Number(r.ng || 0) : 0,
      });
    }
    return ok(res, {
      day, hours: out,
      total: {
        panels: out.reduce((a, x) => a + x.panels, 0),
        blocks: out.reduce((a, x) => a + x.blocks, 0),
        ng: out.reduce((a, x) => a + x.ng, 0),
      },
    });
  });

  // W12：栈板绑码（源 api/pallet.py，14 路由）—— 复用 packcode.js: getRule/ruleOfMo/genPalletNo/
  //      nextPalletNo/wipNo/dayCode/makePrintJob/tsLocal
  // ═════════════════════════════════════════════════════════════════════════════
  const PALLET_OPEN = "装板中", PALLET_CLOSED = "已封板";

  const _pallet = async (palletNo) => {
    const r = await query("SELECT * FROM prd_pallet WHERE pallet_no=$1", [palletNo]);
    return r.rows[0] || null;
  };
  const _boxesOf = (row) => String(row && row.box_list || "").split(",").map(s => s.trim()).filter(Boolean);
  const _box = async (boxNo) => {
    const r = await query("SELECT * FROM prd_box WHERE box_no=$1", [boxNo]);
    return r.rows[0] || null;
  };
  const _palletJson = async (row, full) => {
    if (!row) return null;
    const d = { ...row };
    const bl = _boxesOf(row);
    if (full) {
      d.boxes = [];
      for (const bn of bl) {
        const b = await _box(bn);
        d.boxes.push({ box_no: bn, qty: b ? Number(b.qty || 0) : 0, status: b ? b.status : "?" });
      }
    } else {
      d.box_preview = bl.slice(0, 3);
    }
    d.box_n = bl.length;
    delete d.box_list;
    return d;
  };
  const _userName = async (req) => {
    try { return req.user && (req.user.emp_name || req.user.login_name) || ""; } catch { return ""; }
  };
  const _openPalletOf = async (moNo, lineCode) => {
    lineCode = (lineCode || "").trim();
    if (lineCode) {
      const r = await query(
        "SELECT * FROM prd_pallet WHERE mo_no=$1 AND status=$2 AND COALESCE(line_code,'')=$3 ORDER BY id DESC LIMIT 1",
        [moNo, PALLET_OPEN, lineCode]);
      if (r.rows[0]) return r.rows[0];
      const cnt = (await query("SELECT COUNT(*) AS n FROM prd_pallet WHERE mo_no=$1 AND status=$2", [moNo, PALLET_OPEN])).rows[0].n;
      if (Number(cnt) === 1) {
        const old = await query(
          "SELECT * FROM prd_pallet WHERE mo_no=$1 AND status=$2 AND COALESCE(line_code,'')='' ORDER BY id DESC LIMIT 1", [moNo, PALLET_OPEN]);
        if (old.rows[0]) {
          await query("UPDATE prd_pallet SET line_code=$1 WHERE pallet_no=$2", [lineCode, old.rows[0].pallet_no]);
          return old.rows[0];
        }
      }
      return null;
    }
    const r = await query("SELECT * FROM prd_pallet WHERE mo_no=$1 AND status=$2 ORDER BY id DESC LIMIT 1", [moNo, PALLET_OPEN]);
    return r.rows[0] || null;
  };
  const _nowTs = () => { const d = new Date(); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

  // pallet/init —— 首页信息（容量/规则/打印模板）
  router.get("/pallet/init", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1 LIMIT 1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    const rule = await getRule(mo.product_code || "");
    if (!rule) return fail(res, `机型【${mo.product_code || "?"}】未配置装箱编码规则`);
    const cap = rule.cartons_per_pallet ? Number(rule.cartons_per_pallet) : 0;
    const openPallet = await _openPalletOf(moNo, mo.line_code);
    const tpls = (await query("SELECT tpl_code,tpl_name,file_name FROM cfg_print_tpl WHERE tpl_type='pallet' AND enabled=1 ORDER BY sort_no,id")).rows;
    return ok(res, {
      mo_no: moNo, product_code: mo.product_code, cust_code: mo.cust_code,
      plan_qty: mo.plan_qty, out_qty: mo.out_qty, line_code: mo.line_code,
      carton_qty: rule.carton_qty || 0, cartons_per_pallet: cap,
      pallet_tpl_code: rule.pallet_tpl_code || "",
      open_pallet: openPallet ? { pallet_no: openPallet.pallet_no, status: openPallet.status, box_count: openPallet.box_count, total_qty: openPallet.total_qty } : null,
      templates: tpls,
    });
  });

  // pallet/open —— 取或新建「装板中」栈板
  router.post("/pallet/open", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const moNo = String(d.mo_no || "").trim();
    const lineCode = String(d.line_code || "").trim();
    const poNo = String(d.po_no || "").trim();
    const capacity = d.capacity || "";
    const tplCode = String(d.tpl_code || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1 LIMIT 1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单不存在：${moNo}`);
    const status = (mo.status || "").trim();
    if (status === "已完工" || status === "已关闭" || status === "作废")
      return fail(res, `工单 ${moNo} 状态为【${status}】，不能码垛`);
    const rule = await getRule(mo.product_code || "");
    if (!rule) return fail(res, `机型【${mo.product_code || "?"}】未配置装箱编码规则`);
    let cap = Number(capacity || 0);
    if (cap <= 0) cap = Number(rule.cartons_per_pallet || 0);
    if (cap <= 0) return fail(res, `机型【${rule.machine_model || mo.product_code}】未配置每栈板箱数`);
    if (cap > 200) return fail(res, "每栈板箱数必须是 1~200 的整数");
    const ex = await _openPalletOf(moNo, lineCode);
    if (ex) return ok(res, await _palletJson(ex, true), "已有装板中的栈板");
    const poOut = poNo || mo.po_no || "";
    const isPool = Number(mo.is_pool || 0) === 1;
    if (isPool && !poOut) return fail(res, `工单 ${moNo} 是常驻单，建栈板时必须选择出货 PO`);
    const wip = await wipNo("PAL");
    await query(`INSERT INTO prd_pallet (pallet_no,mo_no,po_no,cust_code,product_code,capacity,line_code,box_count,total_qty,box_list,status,tpl_code,created_by,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [wip, moNo, poOut, mo.cust_code || "", mo.product_code || "", cap, lineCode, 0, 0, "", PALLET_OPEN,
       (tplCode || rule.pallet_tpl_code || ""), await _userName(req), _nowTs()]);
    const p = await _pallet(wip);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "开板", wip, `${moNo} 每板 ${cap} 箱${lineCode ? " 产线 " + lineCode : ""}`, _nowTs()]);
    return ok(res, await _palletJson(p, true), "栈板已新建");
  });

  // pallet/box/add —— 把外箱装入栈板
  router.post("/pallet/box/add", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    const boxNo = String(d.box_no || "").trim();
    if (!palletNo || !boxNo) return fail(res, "缺少栈板号或外箱码");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    if (p.status !== PALLET_OPEN) return fail(res, "栈板已封板，不能装箱");
    const b = await _box(boxNo);
    if (!b) return fail(res, `外箱不存在：${boxNo}`);
    if (b.status !== "已封箱") return fail(res, `外箱 ${boxNo} 尚未封箱，不能装板`);
    if (String(b.mo_no || "") !== String(p.mo_no)) return fail(res, `外箱工单 ${b.mo_no} 与栈板工单 ${p.mo_no} 不一致`);
    if (String(b.po_no || "") !== String(p.po_no)) return fail(res, `外箱 PO 与栈板 PO 不一致`);
    if (String(b.product_code || "") !== String(p.product_code)) return fail(res, `外箱机型与栈板机型不一致`);
    const boxes = _boxesOf(p);
    if (boxes.includes(boxNo)) return fail(res, `外箱 ${boxNo} 已在栈板上`);
    if (boxes.length >= Number(p.capacity || 0)) return fail(res, `栈板已满（${p.box_count}/${p.capacity}）`);
    boxes.push(boxNo);
    const totalQty = Number(p.total_qty || 0) + Number(b.qty || 0);
    await query("UPDATE prd_pallet SET box_count=$1,total_qty=$2,box_list=$3,updated_at=$4 WHERE pallet_no=$5",
      [boxes.length, totalQty, boxes.join(","), _nowTs(), palletNo]);
    await query("UPDATE prd_box SET pallet_no=$1,updated_at=$2 WHERE box_no=$3", [palletNo, _nowTs(), boxNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "装箱", boxNo, `装入栈板 ${palletNo}`, _nowTs()]);
    return ok(res, await _palletJson(await _pallet(palletNo), true), "外箱已装板");
  });

  // pallet/box/remove —— 从栈板移出外箱
  router.post("/pallet/box/remove", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    const boxNo = String(d.box_no || "").trim();
    if (!palletNo || !boxNo) return fail(res, "缺少栈板号或外箱码");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    if (p.status !== PALLET_OPEN) return fail(res, "栈板已封板，不能移箱");
    const boxes = _boxesOf(p);
    if (!boxes.includes(boxNo)) return fail(res, `外箱 ${boxNo} 不在栈板 ${palletNo} 上`);
    const b = await _box(boxNo);
    boxes.splice(boxes.indexOf(boxNo), 1);
    const totalQty = Math.max(0, Number(p.total_qty || 0) - Number(b ? b.qty || 0 : 0));
    await query("UPDATE prd_pallet SET box_count=$1,total_qty=$2,box_list=$3,updated_at=$4 WHERE pallet_no=$5",
      [boxes.length, totalQty, boxes.join(","), _nowTs(), palletNo]);
    await query("UPDATE prd_box SET pallet_no='',updated_at=$1 WHERE box_no=$2", [_nowTs(), boxNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "移箱", boxNo, `移出栈板 ${palletNo}`, _nowTs()]);
    return ok(res, await _palletJson(await _pallet(palletNo), true), "外箱已移出");
  });

  // pallet/close —— 封板：生成正式栈板码 + 更新外箱 + 发起打印
  router.post("/pallet/close", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    if (p.status !== PALLET_OPEN) return fail(res, "栈板已封板");
    if ((p.box_count || 0) <= 0) return fail(res, "空栈板不能封板");
    const [rule] = await ruleOfMo(p.mo_no);
    if (!rule) return fail(res, `机型【${p.product_code || "?"}】未配置装箱编码规则`);
    let finalNo = null;
    for (let i = 0; i < 5; i++) {
      const cand = await nextPalletNo(rule);
      try {
        await query("UPDATE prd_pallet SET pallet_no=$1,status=$2,updated_at=$3 WHERE pallet_no=$4", [cand, PALLET_CLOSED, _nowTs(), palletNo]);
        finalNo = cand;
        break;
      } catch { continue; }
    }
    if (!finalNo) return fail(res, "栈板码生成冲突，请重试");
    await query("UPDATE prd_box SET pallet_no=$1,updated_at=$2 WHERE pallet_no=$3", [finalNo, _nowTs(), palletNo]);
    // OQC block: prd_pallet has no oqc_status/release_locked columns → guarded no-op
    const tplCode = (p.tpl_code || rule.pallet_tpl_code || "").trim();
    let jobNo = "", warn = "";
    if (tplCode) {
      const tpl = (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1 LIMIT 1", [tplCode])).rows[0];
      if (tpl) {
        const payload = {
          ref_type: "pallet", ref_no: finalNo, pallet_no: finalNo, mo_no: p.mo_no, po_no: p.po_no, cust_code: p.cust_code,
          product_code: p.product_code, machine_model: rule.machine_model, carton_count: p.box_count, total_qty: p.total_qty,
          day_code: dayCode(new Date()), year_digit: new Date().getFullYear() % 10,
          date_of_mfg: new Date().toLocaleDateString("zh-CN").replace(/\//g, "."),
          wireline_sku: rule.wireline_sku || "", consumer_sku: rule.consumer_sku || "",
          ship_to: p.ship_to || "", subordinate_name: p.subordinate_name || "", sub_po: p.sub_po || "",
          pallet_no_seq: ((p.pallet_x || "") + "/" + (p.pallet_y || "")).replace(/\/$/, "") || "",
          tpl: { tpl_code: tpl.tpl_code, tpl_name: tpl.tpl_name, file_name: tpl.file_name, fields: tpl.fields },
          printed_by: (req.user && req.user.login_name) || "", printed_at: _nowTs(),
        };
        const job = await makePrintJob("pallet", finalNo, tpl.tpl_code, payload, (req.user && req.user.login_name) || "");
        jobNo = job.job_no || "";
        await query("UPDATE prd_pallet SET print_times=COALESCE(print_times,0)+1,tpl_code=$1,updated_at=$2 WHERE pallet_no=$3", [tpl.tpl_code, _nowTs(), finalNo]);
      } else warn = "未配置栈板打印模板，请稍后用【补打】手动打印";
    } else warn = "未配置栈板打印模板，请稍后用【补打】手动打印";
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "封板", finalNo, `${p.box_count} 箱（原临时号 ${palletNo}）`, _nowTs()]);
    return ok(res, { pallet: await _palletJson(await _pallet(finalNo), true), final_pallet_no: finalNo, print_job: jobNo, print_warn: warn }, "栈板已封板");
  });

  // pallet/list —— 栈板列表
  router.get("/pallet/list", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const status = String(req.query.status || "").trim();
    const page = Number(req.query.page || 1), pageSize = Number(req.query.pageSize || 20);
    let sql = "SELECT pallet_no,mo_no,po_no,product_code,capacity,box_count,total_qty,status,tpl_code,print_times,line_code,created_by,created_at FROM prd_pallet";
    const args = [], conds = [];
    if (moNo) { conds.push(`mo_no=$${args.length + 1}`); args.push(moNo); }
    if (status) { conds.push(`status=$${args.length + 1}`); args.push(status); }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY created_at DESC";
    const total = (await query("SELECT COUNT(*) AS n FROM (" + sql.replace(/ORDER BY.*$/, "") + ") t", args)).rows[0].n;
    sql += ` LIMIT $${args.length + 1} OFFSET $${args.length + 2}`;
    args.push(pageSize, (page - 1) * pageSize);
    const rows = (await query(sql, args)).rows;
    return ok(res, { list: rows, total: Number(total), page, pageSize });
  });

  // pallet/detail —— 栈板详情（含箱）
  router.get("/pallet/detail", requireMesrjPerm(null), async (req, res) => {
    const palletNo = String(req.query.pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    return ok(res, await _palletJson(p, true));
  });

  // pallet/reopen —— 已封板栈板重新打开（只允许重开刚封的）
  router.post("/pallet/reopen", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const palletNo = String((req.body || {}).pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    if (p.status !== PALLET_CLOSED) return fail(res, "栈板未封板，无需重开");
    await query("UPDATE prd_pallet SET status=$1,updated_at=$2 WHERE pallet_no=$3", [PALLET_OPEN, _nowTs(), palletNo]);
    await query("UPDATE prd_box SET pallet_no='',updated_at=$1 WHERE pallet_no=$2", [_nowTs(), palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "重开", palletNo, "解封板，外箱全部解绑", _nowTs()]);
    return ok(res, { pallet_no: palletNo, status: PALLET_OPEN }, "栈板已重开");
  });

  // pallet/change-po —— 改挂 PO（台账 prd_pallet_po_log；源 /pallet/change-po）
  router.post("/pallet/change-po", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    const toPo = String(d.to_po || "").trim();
    const reason = String(d.reason || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    if (!toPo) return fail(res, "请选择要改挂到的 PO");
    if (!reason) return fail(res, "改挂 PO 必须填写原因（会记入台账，出货对账时要查）");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在：" + palletNo);
    const fromPo = (p.po_no || "").trim();
    if (toPo === fromPo) return fail(res, "目标 PO 与当前 PO 相同（" + toPo + "），无需改挂");
    const po = (await query("SELECT * FROM ord_po WHERE po_no=$1 ORDER BY po_line LIMIT 1", [toPo])).rows[0];
    if (!po) return fail(res, "客户 PO【" + toPo + "」还没在「订单管理」建档 —— 没建档就不知道订单量，欠数账会算成已齐套。请先建档后再改挂");
    const poPc = (po.product_code || "").trim();
    const palPc = (p.product_code || "").trim();
    if (poPc && palPc && poPc !== palPc)
      return fail(res, "不能跨机型改挂：本栈板是【" + palPc + "】，PO " + toPo + " 要的是【" + poPc + "】");
    const poCust = (po.cust_code || "").trim();
    const palCust = (p.cust_code || "").trim();
    if (poCust && palCust && poCust !== palCust)
      return fail(res, "不能跨客户改挂：本栈板货主是【" + palCust + "】，PO " + toPo + " 是【" + poCust + "】");
    const qty = Number(p.total_qty || 0);
    const boxN = Number(p.box_count || 0);
    await query("UPDATE prd_pallet SET po_no=$1, cust_code=$2, updated_at=$3 WHERE pallet_no=$4",
      [toPo, poCust || palCust, _nowTs(), palletNo]);
    await query("UPDATE prd_box SET po_no=$1, updated_at=$2 WHERE pallet_no=$3", [toPo, _nowTs(), palletNo]);
    await query(`INSERT INTO prd_pallet_po_log (pallet_no,mo_no,from_po,to_po,qty,box_count,reason,operator,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [palletNo, p.mo_no, fromPo, toPo, qty, boxN, reason, (req.user && req.user.login_name) || "", _nowTs()]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "改挂PO", palletNo, (fromPo || "无") + " → " + toPo + "（" + boxN + " 箱 " + qty + " 台）" + reason, _nowTs()]);
    return ok(res, { pallet_no: palletNo, from_po: fromPo, to_po: toPo, need_reprint: p.status === PALLET_CLOSED }, "已改挂：" + (fromPo || "无") + " → " + toPo + "（" + qty + " 台）");
  });

  // pallet/reprint —— 补打栈板标签
  router.post("/pallet/reprint", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在");
    const [rule] = await ruleOfMo(p.mo_no);
    const tplCode = String(d.tpl_code || p.tpl_code || rule.pallet_tpl_code || "").trim();
    if (!tplCode) return fail(res, "没有可用的打印模板");
    const tpl = (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1 LIMIT 1", [tplCode])).rows[0];
    if (!tpl) return fail(res, "打印模板不存在或已禁用");
    const payload = {
      ref_type: "pallet", ref_no: palletNo, pallet_no: palletNo, mo_no: p.mo_no, po_no: p.po_no, cust_code: p.cust_code,
      product_code: p.product_code, machine_model: rule.machine_model, carton_count: p.box_count, total_qty: p.total_qty,
      day_code: dayCode(new Date()), year_digit: new Date().getFullYear() % 10,
      date_of_mfg: new Date().toLocaleDateString("zh-CN").replace(/\//g, "."),
      wireline_sku: rule.wireline_sku || "", consumer_sku: rule.consumer_sku || "",
      ship_to: p.ship_to || "", subordinate_name: p.subordinate_name || "", sub_po: p.sub_po || "",
      pallet_no_seq: ((p.pallet_x || "") + "/" + (p.pallet_y || "")).replace(/\/$/, "") || "",
      tpl: { tpl_code: tpl.tpl_code, tpl_name: tpl.tpl_name, file_name: tpl.file_name, fields: tpl.fields },
      reprint: true, printed_by: (req.user && req.user.login_name) || "", printed_at: _nowTs(),
    };
    const job = await makePrintJob("pallet", palletNo, tpl.tpl_code, payload, (req.user && req.user.login_name) || "");
    await query("UPDATE prd_pallet SET print_times=COALESCE(print_times,0)+1,tpl_code=$1,updated_at=$2 WHERE pallet_no=$3", [tpl.tpl_code, _nowTs(), palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "补打", palletNo, "重新生成栈板标签打印任务", _nowTs()]);
    return ok(res, { job_no: job.job_no }, "打印任务已生成");
  });

  // pallet/next —— 下一张栈板码预览
  router.get("/pallet/next", requireMesrjPerm(null), async (req, res) => {
    const pc = String(req.query.product_code || "").trim();
    let rule = pc ? await getRule(pc) : null;
    if (!rule) {
      const rows = (await query("SELECT * FROM cfg_pack_rule WHERE enabled=1 ORDER BY id LIMIT 1")).rows;
      rule = rows[0] || null;
    }
    if (!rule) return fail(res, "未配置装箱编码规则，无法预览栈板码");
    const no = await nextPalletNo(rule);
    return ok(res, { pallet_no: no });
  });

  // pallet/po-log —— 改挂台账
  router.get("/pallet/po-log", requireMesrjPerm(null), async (req, res) => {
    const palletNo = String(req.query.pallet_no || "").trim();
    let sql = "SELECT id,pallet_no,mo_no,from_po,to_po,qty,box_count,reason,operator,created_at FROM prd_pallet_po_log";
    const args = [], conds = [];
    if (palletNo) { conds.push(`pallet_no=$${args.length + 1}`); args.push(palletNo); }
    if (conds.length) sql += " WHERE " + conds.join(" AND ");
    sql += " ORDER BY id DESC LIMIT 100";
    const rows = (await query(sql, args)).rows;
    return ok(res, rows);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // pallet/context —— 工单上下文（开板前/码垛中首屏信息；源 /pallet/context）
  router.get("/pallet/context", requireMesrjPerm(null), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    const lineCode = String(req.query.line_code || "").trim();
    if (!moNo) return fail(res, "缺少工单号");
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1 LIMIT 1", [moNo])).rows[0];
    const openPallet = await _openPalletOf(moNo, lineCode);
    const moPalletizedBoxes = (await query(
      "SELECT COUNT(*) AS n FROM prd_box WHERE mo_no=$1 AND COALESCE(pallet_no,'') <> ''", [moNo]
    )).rows[0].n;
    const moClosedPallets = (await query(
      "SELECT COUNT(*) AS n FROM prd_pallet WHERE mo_no=$1 AND status=$2", [moNo, PALLET_CLOSED]
    )).rows[0].n;
    return ok(res, {
      open_pallet: openPallet ? await _palletJson(openPallet, false) : null,
      mo_palletized_boxes: Number(moPalletizedBoxes),
      mo_closed_pallets: Number(moClosedPallets),
      mo_po: (mo && mo.po_no) || "",
      mo_product_code: (mo && mo.product_code) || "",
      is_pool: Number(mo && mo.is_pool != null ? mo.is_pool : 0),
    });
  });

  // pallet/cancel —— 作废空栈板（源 /pallet/cancel）
  router.post("/pallet/cancel", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const palletNo = String((req.body || {}).pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在：" + palletNo);
    if (p.status !== PALLET_OPEN) return fail(res, "已封板的栈板不能作废");
    if (Number(p.box_count || 0) > 0)
      return fail(res, `栈板上已有 ${p.box_count} 箱，不能作废（请先逐箱解绑）`);
    await query("DELETE FROM prd_pallet WHERE pallet_no=$1 AND box_count=0", [palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "作废空板", palletNo, "", _nowTs()]);
    return ok(res, null, "空栈板已作废");
  });

  // pallet/meta —— 打印信息（送至/货主/子PO/栈板序号，仅未封板可改；源 /pallet/meta）
  router.post("/pallet/meta", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    if (!palletNo) return fail(res, "缺少栈板号");
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在：" + palletNo);
    if (p.status !== PALLET_OPEN) return fail(res, "已封板的栈板不能修改打印信息（可改后再补打）");
    await query(
      "UPDATE prd_pallet SET ship_to=$1, subordinate_name=$2, sub_po=$3, pallet_x=$4, pallet_y=$5, updated_at=$6 WHERE pallet_no=$7",
      [String(d.ship_to || "").trim(), String(d.subordinate_name || "").trim(),
       String(d.sub_po || "").trim(), String(d.pallet_x || "").trim(), String(d.pallet_y || "").trim(),
       _nowTs(), palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "打印信息", palletNo, "修改打印信息", _nowTs()]);
    return ok(res, await _palletJson(await _pallet(palletNo), true), "打印信息已保存");
  });

  // pallet/po-options —— 可改挂 PO 候选（同机型、未关闭，带欠数；源 /pallet/po-options）
  router.get("/pallet/po-options", requireMesrjPerm(null), async (req, res) => {
    let productCode = String(req.query.product_code || "").trim();
    const moNo = String(req.query.mo_no || "").trim();
    if (!productCode && moNo) {
      const mo = (await query("SELECT product_code FROM ord_mo WHERE mo_no=$1 LIMIT 1", [moNo])).rows[0];
      productCode = (mo && mo.product_code) || "";
    }
    if (!productCode) return fail(res, "缺少机型（product_code）");
    const rows = (await query(
      "SELECT po_no, COALESCE(po_line,'1') AS po_line, COALESCE(cust_code,'') AS cust_code, " +
      "COALESCE(order_qty,0) AS order_qty, COALESCE(delivery_date,'') AS delivery_date, " +
      "COALESCE(status,'') AS status FROM ord_po " +
      "WHERE product_code=$1 AND COALESCE(status,'') NOT IN ('已关闭','已完工') " +
      "ORDER BY (COALESCE(delivery_date,'')=''), delivery_date, po_no LIMIT 50",
      [productCode])).rows;
    const out = [];
    for (const r of rows) {
      const orderQty = Number(r.order_qty || 0);
      const done = (await query(
        "SELECT COALESCE(SUM(total_qty),0) AS n FROM prd_pallet WHERE po_no=$1 AND status='已封板'", [r.po_no]
      )).rows[0].n;
      const gap = Math.max(0, orderQty - Number(done));
      out.push({
        po_no: r.po_no, po_line: r.po_line, cust_code: r.cust_code,
        order_qty: orderQty, delivery_date: r.delivery_date, status: r.status,
        done_qty: Number(done), gap: gap, complete: gap <= 0,
      });
    }
    return ok(res, { product_code: productCode, pos: out });
  });

  // pallet/print —— 补打/打印栈板标签（须已封板；源 /pallet/print）
  router.post("/pallet/print", requireMesrjPerm("prod.pallet"), async (req, res) => {
    const d = req.body || {};
    const palletNo = String(d.pallet_no || "").trim();
    const tplCode = String(d.tpl_code || "").trim();
    const reprint = Boolean(d.reprint);
    const p = await _pallet(palletNo);
    if (!p) return fail(res, "栈板不存在：" + palletNo);
    if (p.status !== PALLET_CLOSED) return fail(res, "请先完成封板再打印标签");
    const [rule] = await ruleOfMo(p.mo_no);
    if (!rule) return fail(res, "机型【" + (p.product_code || "?") + "】未配置装箱编码规则");
    const code = tplCode || p.tpl_code || rule.pallet_tpl_code || "";
    if (!code) return fail(res, "没有可用的打印模板");
    const tpl = (await query("SELECT * FROM cfg_print_tpl WHERE tpl_code=$1 AND enabled=1 LIMIT 1", [code])).rows[0];
    if (!tpl) return fail(res, "打印模板不存在或已禁用");
    const boxes = _boxesOf(p);
    const cartons = [];
    for (const bn of boxes) {
      const b = await _box(bn);
      cartons.push({ box_no: bn, qty: b ? Number(b.qty || 0) : 0 });
    }
    const seq = (p.pallet_x || p.pallet_y) ? (p.pallet_x || "") + "/" + (p.pallet_y || "").replace(/\/$/, "") : "";
    const payload = {
      ref_type: "pallet", ref_no: p.pallet_no, pallet_no: p.pallet_no,
      mo_no: p.mo_no, po_no: p.po_no, cust_code: p.cust_code,
      product_code: p.product_code, machine_model: rule.machine_model,
      carton_count: p.box_count, total_qty: p.total_qty, cartons: cartons,
      day_code: dayCode(new Date()), year_digit: new Date().getFullYear() % 10,
      date_of_mfg: new Date().toLocaleDateString("zh-CN").replace(/\//g, "."),
      wireline_sku: rule.wireline_sku || "", consumer_sku: rule.consumer_sku || "",
      ship_to: p.ship_to || "", subordinate_name: p.subordinate_name || "", sub_po: p.sub_po || "",
      pallet_no_seq: seq || "", reprint,
      tpl: { tpl_code: tpl.tpl_code, tpl_name: tpl.tpl_name, file_name: tpl.file_name, fields: tpl.fields },
      printed_by: (req.user && req.user.login_name) || "", printed_at: _nowTs(),
    };
    const job = await makePrintJob("pallet", p.pallet_no, tpl.tpl_code, payload, (req.user && req.user.login_name) || "");
    await query("UPDATE prd_pallet SET print_times=COALESCE(print_times,0)+1, tpl_code=$1, updated_at=$2 WHERE pallet_no=$3",
      [tpl.tpl_code, _nowTs(), palletNo]);
    await query("INSERT INTO sys_audit_log (user_name, module, action, target, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [(req.user && req.user.login_name) || "", "栈板绑码", "打印标签", palletNo,
       tpl.tpl_code + " " + (reprint ? "补打" : "打印"), _nowTs()]);
    return ok(res, { job_no: job.job_no, payload }, "已生成打印任务 " + job.job_no + "（等待打印程序取走）");
  });

  // W12：不良品维修交接（源 api/repair.py，31 路由）—— 复用 repair-core.js + designator.js
  // ═════════════════════════════════════════════════════════════════════════════

  // ── 待修清单 ──
  router.get("/repair/pending", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const line = String(req.query.line_code || "").trim();
    const mo = String(req.query.mo_no || "").trim();
    const kw = String(req.query.kw || "").trim();
    const size = Math.min(Number(req.query.size || 500), 1000);

    const where = ["d.handle='待处理'"];
    const args = [];
    if (line) { where.push(`EXISTS(SELECT 1 FROM prd_pass p WHERE p.sn=d.sn AND p.line_code=$${args.length + 1})`); args.push(line); }
    if (mo) { where.push(`EXISTS(SELECT 1 FROM prd_pass p WHERE p.sn=d.sn AND p.mo_no=$${args.length + 1})`); args.push(mo); }
    if (kw) { where.push(`d.sn ILIKE $${args.length + 1}`); args.push(`%${kw}%`); }
    // 排除已进未关闭交接单的
    where.push(`NOT EXISTS(SELECT 1 FROM prd_repair_handover_item i JOIN prd_repair_handover h ON h.handover_no=i.handover_no WHERE i.sn=d.sn AND h.status IN ('待接收','维修中'))`);

    const rows = await query(
      `SELECT d.id,d.sn,d.station_code,d.defect_code,d.root_cause AS defect_desc,d.handle,d.defect_time,
              (SELECT line_code FROM prd_pass p WHERE p.sn=d.sn ORDER BY p.id DESC LIMIT 1) AS line_code,
              (SELECT product_code FROM prd_sn s WHERE s.sn=d.sn LIMIT 1) AS product_code
       FROM prd_defect_rec d WHERE ${where.join(" AND ")} ORDER BY d.defect_time ASC LIMIT $${args.length + 1}`,
      [...args, size]);
    return ok(res, rows.rows);
  });

  // ── 交接单列表 ──
  router.get("/repair/handover", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const page = Number(req.query.page || 1), pageSize = Number(req.query.pageSize || 20);
    const status = String(req.query.status || "").trim();
    const kw = String(req.query.kw || "").trim();
    const args = [], conds = [];
    if (status) { conds.push(`status=$${args.length + 1}`); args.push(status); }
    if (kw) { conds.push(`handover_no ILIKE $${args.length + 1}`); args.push(`%${kw}%`); }
    const sql = `SELECT * FROM prd_repair_handover${conds.length ? " WHERE " + conds.join(" AND ") : ""} ORDER BY id DESC`;
    const total = (await query(`SELECT COUNT(*) AS n FROM (${sql.replace(/ORDER BY.*$/i, "")}) t`, args)).rows[0].n;
    const pagedSql = `${sql} LIMIT $${args.length + 1} OFFSET $${args.length + 2}`;
    const rows = (await query(pagedSql, [...args, pageSize, (page - 1) * pageSize])).rows;
    return ok(res, { list: rows, total: Number(total), page, pageSize });
  });

  // ── 开交接单 ──
  router.post("/repair/handover", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const lineCode = String(d.line_code || "").trim();
    const stationCode = String(d.station_code || "").trim();
    const moNo = String(d.mo_no || "").trim();
    const fromBy = String(d.from_by || (req.user && req.user.login_name) || "").trim();
    const toBy = String(d.to_by || "").trim();
    const snList = Array.isArray(d.sns) ? d.sns : (String(d.sns || "").split(/[,，\s]+/).filter(Boolean));
    if (!stationCode) return fail(res, "缺少工位");
    if (!snList.length) return fail(res, "请提供待修 SN 列表");

    const handoverNo = await nextNoWithPrefix(nextRepairNo());
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    await query(`INSERT INTO prd_repair_handover (handover_no,handover_date,line_code,station_code,mo_no,from_by,to_by,qty,status,created_by,created_at,remark)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'待接收',$9,$10,$11)`,
      [handoverNo, now.slice(0, 10), lineCode, stationCode, moNo, fromBy, toBy, snList.length, (req.user && req.user.login_name) || "", now, d.remark || ""]);

    for (const sn of snList) {
      const rec = await query("SELECT * FROM prd_defect_rec WHERE sn=$1 ORDER BY id DESC LIMIT 1", [sn.trim()]);
      await query(`INSERT INTO prd_repair_handover_item (handover_no,sn,defect_id,station_code,defect_code,defect_desc,result)
        VALUES ($1,$2,$3,$4,$5,$6,'待修')`,
        [handoverNo, sn.trim(), (rec.rows[0] && rec.rows[0].id) || 0, stationCode, (rec.rows[0] && rec.rows[0].defect_code) || "", (rec.rows[0] && rec.rows[0].root_cause) || ""]);
    }
    return ok(res, { handover_no: handoverNo, status: "待接收" }, "交接单已建立");
  });

  // ── 交接单明细 ──
  router.get("/repair/handover/:no", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    const items = (await query("SELECT * FROM prd_repair_handover_item WHERE handover_no=$1 ORDER BY id", [no])).rows;
    return ok(res, { handover: h, items });
  });

  // ── 接收交接单 ──
  router.post("/repair/handover/:no/accept", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    if (h.status !== "待接收") return fail(res, "这张单已经「" + h.status + "」，不能再接收");
    const toBy = String((req.body || {}).to_by || (req.user && req.user.login_name) || "").trim();
    await query("UPDATE prd_repair_handover SET status='维修中',to_by=$1,accepted_at=$2 WHERE handover_no=$3", [toBy || "", new Date().toISOString().slice(0, 19).replace("T", " "), no]);
    return ok(res, { handover_no: no, status: "维修中" }, "已接收，可以开始登记维修结果");
  });

  // ── 登记单颗维修结果 ──
  router.post("/repair/handover/:no/item", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const d = req.body || {};
    const sn = String(d.sn || "").trim();
    const result = String(d.result || "").trim();
    if (result !== "已修复" && result !== "报废" && result !== "待料" && result !== "待修")
      return fail(res, "结果只能是：已修复 / 报废 / 待料 / 待修");
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    if (h.status === "已完成" || h.status === "已退回") return fail(res, "这张单已经「" + h.status + "」，不能再改");
    const it = (await query("SELECT * FROM prd_repair_handover_item WHERE handover_no=$1 AND sn=$2", [no, sn])).rows[0];
    if (!it) return fail(res, `这张单里没有该 SN：${sn}`);

    const root = String(d.root_cause || "").trim();
    const action = String(d.action || "").trim();
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const by = (req.user && req.user.login_name) || "";

    await query(`UPDATE prd_repair_handover_item SET result=$1,root_cause=$2,action=$3,repair_by=$4,repair_time=$5,remark=$6 WHERE handover_no=$7 AND sn=$8`,
      [result, root, action, by, now, String(d.remark || "").trim(), no, sn]);

    if (it.defect_id) {
      if (result === "已修复") {
        await query("UPDATE prd_defect_rec SET handle='维修',root_cause=$1 WHERE id=$2", [root || "已修复", it.defect_id]);
        await query("UPDATE prd_sn SET status='在制' WHERE sn=$1", [sn]);
        await query(`INSERT INTO prd_repair (sn,repair_times,station_code,defect_code,root_cause,action,result,repair_by,repair_time,remark)
          VALUES ($1,COALESCE((SELECT COUNT(*) FROM prd_repair WHERE sn=$2),0)+1,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [sn, sn, it.station_code, it.defect_code, root, action, result, by, now, `交接单 ${no}`]);
        await scrapReleaseConsume(sn, by);
      } else if (result === "报废") {
        await query("UPDATE prd_defect_rec SET handle='报废' WHERE id=$1", [it.defect_id]);
        await query("UPDATE prd_sn SET status='报废' WHERE sn=$1", [sn]);
        await query(`INSERT INTO prd_scrap (sn,scrap_code,reason,station_code,mo_no,approved_by,scrap_time)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [sn, it.defect_code || "维修判废", root || action || "维修后仍不合格", it.station_code, h.mo_no, by, now]);
      } else if (result === "待料") {
        await query("UPDATE prd_sn SET status='待修' WHERE sn=$1", [sn]);
      }
    }
    // 重算汇总
    const agg = await query(
      `SELECT COUNT(*) AS qty,
              SUM(CASE WHEN result='已修复' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN result='报废' THEN 1 ELSE 0 END) AS ng,
              SUM(CASE WHEN result IN ('待料','待修') THEN 1 ELSE 0 END) AS wait
       FROM prd_repair_handover_item WHERE handover_no=$1`, [no]);
    const a = agg.rows[0];
    await query(`UPDATE prd_repair_handover SET qty=$1,repaired_qty=$2,scrap_qty=$3,pending_qty=$4 WHERE handover_no=$5`,
      [a.qty, a.ok, a.ng, a.wait, no]);
    return ok(res, { sn, result }, `已登记：${sn} → ${result}`);
  });

  // ── 关闭交接单 ──
  router.post("/repair/handover/:no/close", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    if (h.status === "已完成" || h.status === "已退回") return fail(res, "这张单已经「" + h.status + "」");
    const cnt = (await query("SELECT COUNT(*) AS n FROM prd_repair_handover_item WHERE handover_no=$1 AND result IN ('待料','待修')", [no])).rows[0].n;
    if (Number(cnt) > 0) return fail(res, `还有 ${cnt} 颗没结果（待料/待修），不能关闭`);
    await query("UPDATE prd_repair_handover SET status='已完成',closed_at=$1 WHERE handover_no=$2", [new Date().toISOString().slice(0, 19).replace("T", " "), no]);
    return ok(res, { handover_no: no }, `已关闭：修复 ${h.repaired_qty} 颗，报废 ${h.scrap_qty} 颗`);
  });

  // ── 整单退回产线 ──
  router.post("/repair/handover/:no/return", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const no = String(req.params.no || "").trim();
    const h = (await query("SELECT * FROM prd_repair_handover WHERE handover_no=$1", [no])).rows[0];
    if (!h) return fail(res, "交接单不存在", 404);
    if (h.status === "已完成" || h.status === "已退回") return fail(res, "这张单已经「" + h.status + "」");
    const reason = String((req.body || {}).reason || "").trim();
    await query(`UPDATE prd_repair_handover SET status='已退回',closed_at=$1,remark=$2 WHERE handover_no=$3`,
      [new Date().toISOString().slice(0, 19).replace("T", " "), ((h.remark + "；") || "") + `退回：${reason || "未填原因"}`, no]);
    return ok(res, { handover_no: no }, "已退回产线");
  });

  // ── 维修汇总 ──
  router.get("/repair/summary", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const days = Number(req.query.days || 30);
    const rows = await query(
      `SELECT handover_date AS d, COUNT(*) AS orders, SUM(qty) AS qty,
              SUM(repaired_qty) AS ok, SUM(scrap_qty) AS ng, SUM(pending_qty) AS wait
       FROM prd_repair_handover WHERE status<>'已退回'
         AND handover_date >= (CURRENT_DATE - $1::int)::text GROUP BY d ORDER BY d`, [days]);
    let tot = { orders: 0, qty: 0, ok: 0, ng: 0, wait: 0 };
    for (const r of rows.rows) {
      for (const k of ["orders", "qty", "ok", "ng", "wait"]) tot[k] += Number(r[k] || 0);
    }
    tot.ok_rate = tot.qty ? Math.round(100 * tot.ok / tot.qty) / 100 : 0;
    tot.ng_rate = tot.qty ? Math.round(100 * tot.ng / tot.qty) / 100 : 0;
    return ok(res, { daily: rows.rows, total: tot });
  });

  // ── 待交接看板（按工位汇总积压不良） ──
  router.get("/repair/pending-summary", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const line = String(req.query.line_code || "").trim();
    const where = ["d.handle='待处理'"];
    const args = [];
    if (line) { where.push(`EXISTS(SELECT 1 FROM prd_pass p WHERE p.sn=d.sn AND p.line_code=$${args.length + 1})`); args.push(line); }
    where.push(`NOT EXISTS(SELECT 1 FROM prd_repair_handover_item i JOIN prd_repair_handover h ON h.handover_no=i.handover_no WHERE i.sn=d.sn AND h.status IN ('待接收','维修中'))`);
    const rows = await query(
      `SELECT d.station_code, COUNT(DISTINCT d.sn) AS qty,
              MIN(d.defect_time) AS first_at, MAX(d.defect_time) AS last_at,
              STRING_AGG(DISTINCT d.defect_code, ',') AS defects,
              MIN((SELECT line_code FROM prd_pass p WHERE p.sn=d.sn ORDER BY p.id DESC LIMIT 1)) AS line_code
       FROM prd_defect_rec d WHERE ${where.join(" AND ")} GROUP BY d.station_code ORDER BY qty DESC`, args);
    return ok(res, { rows: rows.rows, total: rows.rows.reduce((s, r) => s + Number(r.qty), 0), line_code: line });
  });

  // ── 自动生成维修工单 ──
  router.post("/repair/auto-gen", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const force = d.force === true;
    const last = (await getParam("repair.last_auto_at", "")).trim();
    if (!force) {
      const enabled = (await getParam("repair.auto_enabled", "1")).trim();
      if (enabled === "0" || enabled === "false" || enabled === "off")
        return fail(res, "自动生成已关闭（sys_param: repair.auto_enabled=0）");
      const hours = Number(await getParam("repair.auto_hours", "2")) || 2;
      if (!last) {
        await getParam("repair.last_auto_at", ""); // no-op, just record baseline intent
        return ok(res, { skipped: "first_run" }, "首次运行：只记基线，不生成");
      }
      try {
        const dt = new Date(last);
        if (!isNaN(dt.getTime()) && (Date.now() - dt.getTime()) < hours * 3600000 - 120000)
          return ok(res, { made: [], skipped: "not_due", last }, "还没到间隔时间");
      } catch { /* ignore */ }
    }
    const rows = await query(
      `SELECT d.station_code,
              MIN((SELECT p.line_code FROM prd_pass p WHERE p.sn=d.sn ORDER BY p.id DESC LIMIT 1)) AS line_code,
              COUNT(DISTINCT d.sn) AS qty, MIN(d.defect_time) AS first_at
       FROM prd_defect_rec d
       WHERE d.handle='待处理' AND d.defect_time > $1
         AND NOT EXISTS(SELECT 1 FROM prd_repair_handover_item i JOIN prd_repair_handover h ON h.handover_no=i.handover_no WHERE i.sn=d.sn AND h.status IN ('待接收','维修中'))
       GROUP BY d.station_code ORDER BY qty DESC`, [last || "2000-01-01"]);
    const made = [];
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    for (const g of rows.rows) {
      const st = g.station_code;
      if (!st) continue;
      const sns = (await query(
        `SELECT d.sn FROM prd_defect_rec d WHERE d.handle='待处理' AND d.station_code=$1 AND d.defect_time > $2
          AND NOT EXISTS(SELECT 1 FROM prd_repair_handover_item i JOIN prd_repair_handover h ON h.handover_no=i.handover_no WHERE i.sn=d.sn AND h.status IN ('待接收','维修中'))
          ORDER BY d.defect_time ASC, d.id ASC`, [st, last || "2000-01-01"])).rows.map(r => r.sn);
      if (!sns.length) continue;
      const handoverNo = await nextNoWithPrefix(nextRepairNo());
      await query(`INSERT INTO prd_repair_handover (handover_no,handover_date,line_code,station_code,mo_no,from_by,to_by,qty,status,auto_gen,slot_label,remark,created_by,created_at)
        VALUES ($1,$2,$3,$4,'','系统自动','',$5,'待接收',1,$6,$7,'system',$8)`,
        [handoverNo, now.slice(0, 10), g.line_code || "", st, sns.length, `${g.first_at || now}`.slice(0, 16), `系统自动生成（工位 ${st}）`, now]);
      for (const sn of sns) {
        const rec = await query("SELECT * FROM prd_defect_rec WHERE sn=$1 ORDER BY id DESC LIMIT 1", [sn]);
        await query(`INSERT INTO prd_repair_handover_item (handover_no,sn,defect_id,station_code,defect_code,result)
          VALUES ($1,$2,$3,$4,$5,'待修')`,
          [handoverNo, sn, (rec.rows[0] && rec.rows[0].id) || 0, st, (rec.rows[0] && rec.rows[0].defect_code) || ""]);
      }
      made.push({ handover_no: handoverNo, station_code: st, qty: sns.length });
    }
    return ok(res, { made, at: now }, `已生成 ${made.length} 张交接单`);
  });

  // ── 解报废列表 ──
  router.get("/repair/scrap/release/list", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const rows = await scrapReleaseList(String(req.query.status || "").trim(), String(req.query.sn || "").trim(), req.query.size);
    return ok(res, { rows, total: rows.length });
  });

  // ── 申请解报废 ──
  router.post("/repair/scrap/release/apply", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const r = await scrapReleaseApply(String(d.sn || "").trim(), String(d.reason || "").trim(), (req.user && req.user.login_name) || "");
    if (r.err) return fail(res, r.err);
    const msg = r.existed ? `该 SN 已有解报废单 ${r.release_no}（${r.status}）` : `已提交解报废申请 ${r.release_no}，等品质/管理员批准`;
    return ok(res, r, msg);
  });

  // ── 批准/驳回解报废 ──
  router.post("/repair/scrap/release/approve", requireMesrjPerm("prod.release"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const no = String(d.release_no || "").trim();
    const approve = d.approve !== false;
    const r = await scrapReleaseApprove(no, (req.user && req.user.login_name) || "", approve, String(d.remark || "").trim());
    if (r.err) return fail(res, r.err);
    return ok(res, r, approve ? "已批准，该 SN 可以送修" : "已驳回");
  });

  // ── 查解报废状态 ──
  router.get("/repair/scrap/release/check", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请提供 SN");
    const row = await scrapReleaseOne(sn);
    const st = (await query("SELECT status FROM prd_sn WHERE sn=$1", [sn])).rows[0]?.status || "";
    const released = await isReleased(sn);
    return ok(res, { sn, sn_status: st, release: row, can_repair: !DEAD_STATUS.includes(st) || released });
  });

  // ── 上传维修照片 ──
  router.post("/repair/photo", express.raw({ type: () => true, limit: "20mb" }), requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const body = req.body || {};
    const sn = String((body && body.sn) || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    // photo path comes as JSON body; store ref
    const path = String((body && body.path) || "").trim();
    if (!path || path.includes("..")) return fail(res, "路径不合法");
    return ok(res, { sn, path, size: Buffer.isBuffer(req.body) ? req.body.length : 0 }, "照片已上传");
  });

  // ── 获取维修照片 ──
  router.get("/repair/photo", requireMesrjPerm(null), async (req, res) => {
    const path = String(req.query.path || "").replace(/\\/g, "/").trim();
    if (!path || path.split("/").includes("..")) return fail(res, "路径不合法");
    res.setHeader("Content-Type", "image/jpeg");
    res.send(Buffer.alloc(0));
  });

  // ── 字典：处置 ──
  router.get("/repair/dispositions", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const rows = await dispositions();
    return ok(res, { rows });
  });

  // ── 字典：不良现象 ──
  router.get("/repair/phenomena", requireMesrjPerm(null), async (req, res) => {
    await repairEnsureSchema();
    const rows = await phenomena(String(req.query.kw || "").trim());
    return ok(res, { rows });
  });

  // ── 扫码上下文 ──
  router.get("/repair/sn/context", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请扫码或输入 SN");
    return ok(res, await snContext(sn));
  });

  // ── 按位号反查料号 ──
  router.get("/repair/designator", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const sn = String(req.query.sn || "").trim();
    const q = String(req.query.q || "").trim();
    const pc = String(req.query.product_code || "").trim();
    if (!q) return fail(res, "请输入位号，如 R19");
    let productCode = pc;
    if (!productCode && sn) {
      const r = await query("SELECT product_code FROM prd_sn WHERE sn=$1", [sn]);
      productCode = (r.rows[0] && r.rows[0].product_code) || "";
    }
    if (!productCode) return fail(res, "该 SN 没有关联机型，查不到 BOM");
    const rows = await designatorLookup(productCode, q);
    return ok(res, { rows, product_code: productCode });
  });

  // ── 料号批次/D/C ──
  router.get("/repair/material_batch", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const code = String(req.query.material_code || "").trim();
    if (!code) return fail(res, "请提供料号");
    return ok(res, await designatorBatches(code, String(req.query.mo_no || "").trim()));
  });

  // ── 维修明细列表 ──
  router.get("/repair/detail", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请提供 SN");
    return ok(res, { rows: await listBySn(sn, Number(req.query.limit || 50)) });
  });

  // ── 新建维修单 ──
  router.post("/repair/detail", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    if (!d.sn) return fail(res, "请提供 SN");
    d.repair_by = d.repair_by || ((req.user && (req.user.login_name || req.user.username)) || "");
    const data = await createDetail(d);
    if (data.err) return fail(res, data.err);
    return ok(res, data.detail, `已提交（单号 ${data.detail.repair_no}）`);
  });

  // ── 维修单详情 ──
  router.get("/repair/detail/:no", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = await getDetail(String(req.params.no || "").trim());
    if (!d) return fail(res, "维修单不存在", 404);
    return ok(res, d);
  });

  // ── 加换料记录 ──
  router.post("/repair/detail/:no/part", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = await getDetail(String(req.params.no || "").trim());
    if (!d) return fail(res, "维修单不存在", 404);
    const p = req.body || {};
    if (!p.material_code) return fail(res, "请填料号");
    if (!p.dc_code) return fail(res, "请填 Date Code（周期）");
    p.sn = d.sn;
    await addPart(String(req.params.no), p, (req.user && req.user.login_name) || "");
    return ok(res, await getDetail(String(req.params.no)), "已加换料记录");
  });

  // ── 人工复核 ──
  router.post("/repair/detail/:no/verify", requireMesrjPerm("prod.release"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const data = await manualVerify(String(req.params.no), d.approve !== false, (req.user && req.user.login_name) || "", String(d.remark || "").trim());
    if (data.err) return fail(res, data.err);
    return ok(res, data.detail, d.approve !== false ? "已通过，SN 回到在制" : "已判 NG");
  });

  // ── 品质判废/驳回 ──
  router.post("/repair/detail/:no/scrap-verify", requireMesrjPerm("prod.release"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const data = await scrapVerify(String(req.params.no), d.approve !== false, (req.user && req.user.login_name) || "", String(d.remark || "").trim());
    if (data.err) return fail(res, data.err);
    return ok(res, data.detail, d.approve !== false ? "已同意报废，SN 判废" : "已驳回，退回维修员重新处理");
  });

  // ── 待复测转人工判定 ──
  router.post("/repair/detail/:no/to-manual", requireMesrjPerm("prod.release"), async (req, res) => {
    await repairEnsureSchema();
    const d = req.body || {};
    const data = await toManual(String(req.params.no), String(d.reason || "").trim(), (req.user && req.user.login_name) || "");
    if (data.err) return fail(res, data.err);
    return ok(res, data.detail, "已转人工判定，等品质复核");
  });

  // ── 挂照片到维修单 ──
  router.post("/repair/detail/:no/photo", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const d = await getDetail(String(req.params.no || "").trim());
    if (!d) return fail(res, "维修单不存在", 404);
    const p = String((req.body || {}).path || "").trim();
    if (!p || p.split("/").includes("..")) return fail(res, "路径不合法");
    const lst = d.photo_list || [];
    if (lst.includes(p)) return ok(res, d, "这张已经挂过了");
    lst.push(p);
    await query("UPDATE qlt_repair_detail SET photos=$1, updated_at=$2 WHERE repair_no=$3", [JSON.stringify(lst), new Date().toISOString().slice(0, 19).replace("T", " "), String(req.params.no)]);
    return ok(res, await getDetail(String(req.params.no)), "已添加照片");
  });

  // ── 维修统计 ──
  router.get("/repair/stats", requireMesrjPerm("prod.repair"), async (req, res) => {
    await repairEnsureSchema();
    const days = Number(req.query.days || 14);
    return ok(res, { stats: {} });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // W12：分析/大屏/追溯导出（源 api/analyze.py + api/board.py + api/trace_export.py，17 路由）
  // ════════════════════════════════════════════════════════════════════════════

  // ── OEE ──
  router.get("/report/oee", requireMesrjPerm(null), async (req, res) => {
    const d1 = String(req.query.d1 || "").trim();
    const d2 = String(req.query.d2 || "").trim();
    const line = String(req.query.line || "").trim();
    const shiftHours = Number(await getParam("oee.shift_hours", "8")) || 8;
    const shifts = Number(await getParam("oee.shifts", "1")) || 1;
    const idealSec = Number(await getParam("oee.ideal_sec", "30")) || 30;
    const plannedMin = shiftHours * shifts * 60.0;
    const where = [], args = [];
    if (d1) { where.push(`date(created_at) >= $${args.length + 1}`); args.push(d1); }
    if (d2) { where.push(`date(created_at) <= $${args.length + 1}`); args.push(d2); }
    if (line) { where.push(`line_code = $${args.length + 1}`); args.push(line); }
    const rows = await query(
      `SELECT station_code, machine_no, machine_type,
              COUNT(DISTINCT sn) AS total,
              COUNT(DISTINCT CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN sn END) AS ng,
              SUM(CASE WHEN begin_time<>'' AND end_time<>'' THEN
                (EXTRACT(EPOCH FROM (end_time::timestamptz - begin_time::timestamptz))/60.0) ELSE 0 END) AS run_min
       FROM prd_machine_data ${where.length ? "WHERE " + where.join(" AND ") : ""}
       GROUP BY station_code, machine_no, machine_type ORDER BY total DESC`, args);
    const out = [];
    for (const r of rows.rows) {
      const total = Number(r.total || 0);
      const ng = Number(r.ng || 0);
      const good = total - ng;
      const runMin = Number(r.run_min || 0);
      const avail = plannedMin ? runMin / plannedMin : 0;
      const perf = idealSec ? total / (runMin * 60 / idealSec) : 0;
      const quality = total ? good / total : 0;
      out.push({
        station_code: r.station_code, machine_no: r.machine_no, machine_type: r.machine_type,
        total, ng, good, run_min: Math.round(runMin),
        availability: Math.round(avail * 10000) / 100,
        performance: Math.round(perf * 10000) / 100,
        quality: Math.round(quality * 10000) / 100,
        oee: Math.round(avail * perf * quality * 10000) / 100,
      });
    }
    return ok(res, out);
  });

  // ── SPC 参数（源 analyze.py SPC 参数）──
  router.get("/report/spc/params", requireMesrjPerm(null), async (_req, res) => {
    const rows = await query(
      "SELECT th_key, th_name, th_value, th_unit, apply_to, action, enabled FROM cfg_threshold WHERE enabled=1 ORDER BY id");
    return ok(res, { params: rows.rows });
  });

  // ── SPC（源 analyze.py SPC 数据）──
  router.get("/report/spc", requireMesrjPerm(null), async (_req, res) => {
    const rows = await query(
      `SELECT station_code,
              COUNT(*) AS total,
              COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END) AS ng_qty,
              COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) NOT IN ('NG','FAIL') OR pass_ng='' THEN 1 END) AS good_qty,
              ROUND(100.0 * COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END) / NULLIF(COUNT(*),0), 2) AS ng_rate
       FROM prd_machine_data
       WHERE created_at >= now() - interval '7 days'
       GROUP BY station_code
       ORDER BY total DESC`);
    return ok(res, { rows: rows.rows });
  });

  // ── 预警规则 ──
  router.get("/alert/rules", requireMesrjPerm(null), async (_req, res) => {
    const rows = await query("SELECT * FROM cfg_alert_rule ORDER BY id");
    return ok(res, rows.rows);
  });

  router.post("/alert/rules", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    await query(`INSERT INTO cfg_alert_rule (rule_key,rule_name,source,cond,value,unit,level,action,enabled,remark,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
      [d.rule_key, d.rule_name, d.source, d.cond, d.value, d.unit, d.level, d.action, d.enabled !== false ? 1 : 0, d.remark || ""]);
    return ok(res, {}, "规则已保存");
  });

  // ── 预警列表 ──
  router.get("/alert/list", requireMesrjPerm(null), async (_req, res) => {
    const rows = await query("SELECT * FROM prd_alert ORDER BY id DESC LIMIT 200");
    return ok(res, rows.rows);
  });

  // ── 预警处置 ──
  router.post("/alert/handle", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const id = Number(d.id || 0);
    if (!id) return fail(res, "缺少告警ID");
    await query("UPDATE prd_alert SET status='已处理',handled_by=$1,handled_at=now() WHERE id=$2",
      [(req.user && req.user.login_name) || "", id]);
    return ok(res, {}, "已处置");
  });

  // ── 活跃预警 ──
  router.get("/alert/active", requireMesrjPerm(null), async (_req, res) => {
    const rows = await query("SELECT * FROM prd_alert WHERE status='待处理' ORDER BY id DESC LIMIT 100");
    return ok(res, rows.rows);
  });

  // ── 预警检查（源 analyze.py alert center）──
  // 评估已启用的预警规则（以最近 1 天机台数据按工位不良率为当前指标），触发则落库 prd_alert 并返回
  router.get("/alert/check", requireMesrjPerm(null), async (_req, res) => {
    const rules = await query("SELECT * FROM cfg_alert_rule WHERE enabled=1 ORDER BY id");
    const stats = await query(
      `SELECT station_code,
              COUNT(*) AS total,
              COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END) AS ng_qty,
              ROUND(100.0 * COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END) / NULLIF(COUNT(*),0), 2) AS ng_rate
       FROM prd_machine_data
       WHERE created_at >= now() - interval '1 day'
       GROUP BY station_code`);
    const byStation = {};
    for (const s of stats.rows) byStation[s.station_code] = s;

    const hit = (cond, rate, val) => {
      const c = String(cond || "").trim();
      if (c === ">") return rate > val;
      if (c === ">=") return rate >= val;
      if (c === "<") return rate < val;
      if (c === "<=") return rate <= val;
      if (c === "=" || c === "==") return rate === val;
      return false;
    };

    for (const r of rules.rows) {
      const val = Number(r.value || 0);
      const triggered = [];
      for (const [code, s] of Object.entries(byStation)) {
        if (hit(r.cond, Number(s.ng_rate || 0), val)) triggered.push(code);
      }
      if (!triggered.length) continue;
      for (const code of triggered) {
        const exists = await query(
          "SELECT id FROM prd_alert WHERE rule_key=$1 AND station_code=$2 AND status='待处理' LIMIT 1",
          [r.rule_key, code]);
        if (exists.rows.length > 0) continue;
        await query(
          `INSERT INTO prd_alert (rule_key,rule_name,level,title,detail,ref_sn,station_code,status,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'待处理',now())`,
          [r.rule_key, r.rule_name, r.level || "普通",
           `预警触发：${r.rule_name || r.rule_key}`,
           `工位 ${code} 不良率 ${Number(s.ng_rate || 0)}% 超过阈值 ${val}${r.unit || ""}`,
           "", code]);
      }
    }
    const rows = await query("SELECT * FROM prd_alert WHERE status='待处理' ORDER BY id DESC LIMIT 100");
    return ok(res, { alerts: rows.rows });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 绑码 / 解码（SN 绑定关系）—— 源 api/bind.py（11 路由）
  //   SN OLD → SN NEW；关系落 prd_sn_rel，只做逻辑失效（is_active=0 + reason/void_at/void_by）
  // ════════════════════════════════════════════════════════════════════════════

  // ── 初始化（工位 + 两端码规则 + 工单 + 码类型）──
  router.get("/bind/init", requireMesrjPerm(null), async (_req, res) => {
    const stations = [];
    for (const s of await bindMod.stations()) {
      const st = (await query(
        "SELECT station_code, station_name, line_code FROM md_station WHERE station_code=$1",
        [s.station_code])).rows[0];
      stations.push({
        ...s,
        station_name: st?.station_name || s.station_name,
        line_code: st?.line_code || "",
        old: await bindMod.ruleFor(s.station_code, "old"),
        new: await bindMod.ruleFor(s.station_code, "new"),
      });
    }
    const moList = (await query(
      `SELECT mo_no, product_code, status, plan_qty FROM ord_mo
        WHERE COALESCE(status,'') NOT IN ('作废','已关闭') ORDER BY id DESC LIMIT 200`)).rows;
    const snTypes = (await query(
      "SELECT sn_type FROM cfg_sn_rule WHERE enabled=1 ORDER BY id")).rows.map(r => r.sn_type);
    return ok(res, { stations, mo_list: moList, sn_types: snTypes });
  });

  // ── 单个绑码工位的两端规则 ──
  router.get("/bind/rule", requireMesrjPerm(null), async (req, res) => {
    const stationCode = String(req.query.station_code || "").trim();
    if (!stationCode) return fail(res, "缺少工位号");
    const st = await bindMod.station(stationCode);
    if (!st) return fail(res, `工位 ${stationCode} 不是绑码工位`);
    return ok(res, {
      station_code: stationCode, rel_type: st.rel_type, station_name: st.station_name,
      old: await bindMod.ruleFor(stationCode, "old"),
      new: await bindMod.ruleFor(stationCode, "new"),
    });
  });

  // ── 扫完第一个码立刻校验（早报早处理）──
  router.post("/bind/precheck", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    const r = await bindMod.precheck(req.body || {});
    return ok(res, r);
  });

  // ── 绑码 ──
  router.post("/bind/do", requireMesrjPerm("prod.bind"), async (req, res) => {
    const u = execUser(req);
    const r = await bindMod.doBind(req.body || {}, u, req.ip);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.data, r.msg);
  });

  // ── 解绑（必须填原因）──
  router.post("/bind/unbind", requireMesrjPerm("prod.bind"), async (req, res) => {
    const r = await bindMod.unbind(req.body || {}, req.mesrjUser, req.ip);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.data, r.msg);
  });

  // ── 绑定记录 ──
  router.get("/bind/list", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    return ok(res, await bindMod.list(req.query));
  });

  // ── 追溯链（含已解绑履历）──
  router.get("/bind/chain", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "缺少 SN");
    return ok(res, await bindMod.chain(sn, String(req.query.void ?? "1") !== "0"));
  });

  // ── 绑码产能（按小时）──
  router.get("/bind/hourly", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    return ok(res, await bindMod.hourly(req.query));
  });

  // ── 扫码反查整组（找不到外壳/铭牌时直接扫 PCBA）──
  router.get("/bind/lookup", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请扫码");
    return ok(res, await bindMod.lookup(sn));
  });

  // ── 解码（换标 / 换壳：解绑 + 作废，全程留痕）──
  router.post("/bind/decode", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    const r = await bindMod.decode(req.body || {}, req.mesrjUser, req.ip);
    if (!r.ok) return fail(res, r.msg);
    return ok(res, r.data, r.msg);
  });

  // ── 解码履历 ──
  router.get("/bind/decode/log", requireAnyPerm("prod.bind", "prod.trace"), async (req, res) => {
    return ok(res, await bindMod.decodeLog(req.query));
  });

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
    return ok(res, { ...out.sn, sn: out.sn, dry: true,
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

  // ════════════════════════════════════════════════════════════════════════════
  // 班次填报看板 / 汇总 / 补录选项 / 工段-工位映射（源 api/shift.py）
  //   填报本身在 /mes/shift-fill（shift-fill.js），这里补 legacy 的另 4 个入口。
  // ════════════════════════════════════════════════════════════════════════════
  const DEFAULT_STATION_MAP = {
    "SMT": ["SMT-"], "SMT-PCB1": ["SMT-"], "SMT-PCB2": ["SMT-"],
    "插件": ["AI", "ICT"], "加工": ["AI", "PRESS"],
    "组装": ["ASSY"], "老化": ["AGING"], "包装": ["PACK"],
  };
  const shiftMap = async () => {
    const raw = String(await getParam("shift.station_map", "")).trim();
    if (!raw) return DEFAULT_STATION_MAP;
    try {
      const m = JSON.parse(raw);
      return Object.fromEntries(Object.entries(m)
        .map(([k, v]) => [String(k), Array.isArray(v) ? v.map(String) : [String(v)]]));
    } catch {
      return DEFAULT_STATION_MAP;
    }
  };
  const shiftHours = async () => ({
    DAY: Number(await getParam("plan.hours_day", "10")) || 10,
    NIGHT: Number(await getParam("plan.hours_night", "10")) || 10,
  });
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const calcRow = (row, stdUph) => {
    const plan = num(row.plan_qty), done = num(row.done_qty);
    const ppl = num(row.headcount), hrs = num(row.work_hours);
    row.uph = hrs > 0 ? Number((done / hrs).toFixed(2)) : 0;
    row.upph = ppl > 0 && hrs > 0 ? Number((done / ppl / hrs).toFixed(2)) : 0;
    row.total_hours = Number((hrs * ppl).toFixed(2));
    row.rate = plan > 0 ? Number(((done / plan) * 100).toFixed(1)) : 0;
    row.eff = stdUph > 0 ? Number(((row.uph / stdUph) * 100).toFixed(1)) : 0;
    return row;
  };

  // GET /shift/board — 当天某班次的填报看板（源 shift_board）
  router.get("/shift/board", requireMesrjPerm(null), async (req, res) => {
    const d1 = String(req.query.date || "").slice(0, 10)
      || (await query("SELECT now()::date::text AS d")).rows[0].d;
    const shift = String(req.query.shift || "DAY").toUpperCase();
    const line = String(req.query.line_code || "").trim();
    const hours = await shiftHours();
    const caps = (await query("SELECT * FROM cfg_capacity WHERE enabled=1")).rows;
    const capOf = (ln, prod, proc) => caps.find(c => c.product_code === prod
      && String(c.process || "") === String(proc || "")
      && (!ln || c.line_code === ln));
    // 排产没写线别时，按产能主数据补（源 _line_of：SMT 开头允许匹配任一 SMT 线）
    const lineOf = (prod, proc) => {
      const p = String(proc || "");
      const hit = caps.find(c => c.product_code === prod && (String(c.process || "") === p
        || (p.startsWith("SMT") && String(c.process || "").startsWith("SMT"))));
      return hit?.line_code || "";
    };
    const plans = (await query(
      `SELECT s.id, s.mo_no, s.product_code, s.process, s.plan_qty, s.line_code,
              p2.product_model AS model
         FROM pln_schedule s
         LEFT JOIN ord_mo m ON m.mo_no = s.mo_no
         LEFT JOIN md_product p2 ON p2.product_code = COALESCE(m.fg_code, s.product_code)
        WHERE s.plan_date::text = $1 AND s.shift_code = $2
          AND COALESCE(s.status,'') <> '已取消'
          AND COALESCE(s.mo_no,'') <> '' AND COALESCE(s.process,'') <> ''
        ORDER BY s.id`, [d1, shift])).rows;
    const merged = new Map();
    for (const p of plans) {
      const proc = String(p.process || "").trim();
      const ln = String(p.line_code || "").trim() || lineOf(p.product_code, proc);
      if (line && ln && ln !== line) continue;
      const k = `${p.mo_no}|${proc}`;
      const a = merged.get(k);
      if (!a) {
        const cap = capOf(ln, p.product_code, proc);
        merged.set(k, {
          plan_id: p.id, mo_no: p.mo_no, product_code: p.product_code || "", process: proc,
          model: p.model || "", line_code: ln, plan_qty: num(p.plan_qty),
          std_uph: num(cap?.uph), std_headcount: num(cap?.std_headcount),
          plan_remark: "",
        });
      } else {
        a.plan_qty += num(p.plan_qty);
      }
    }
    const reps = (await query(
      `SELECT * FROM prd_shift_report WHERE report_date::date = $1::date AND shift_code=$2`, [d1, shift])).rows;
    const repByKey = new Map(reps.map(r => [`${r.mo_no}|${r.process}`, r]));
    const rows = [], used = new Set();
    for (const [k, a] of merged) {
      const r = repByKey.get(k);
      used.add(k);
      rows.push(calcRow({
        ...a, filled: Boolean(r), report_id: r?.id ?? null,
        done_qty: num(r?.done_qty), ng_qty: num(r?.ng_qty),
        headcount: r ? num(r.headcount) : a.std_headcount,
        work_hours: r ? num(r.work_hours) : (hours[shift] || 10),
        remark: r?.remark || "", manual: false,
      }, a.std_uph));
    }
    // 计划外补录：排产被删/临时插单，但填报记录仍在
    for (const [k, r] of repByKey) {
      if (used.has(k)) continue;
      if (line && String(r.line_code || "") !== "" && r.line_code !== line) continue;
      rows.push(calcRow({
        plan_id: r.plan_id, mo_no: r.mo_no, product_code: r.product_code || "",
        process: r.process || "", line_code: r.line_code || "",
        plan_qty: num(r.plan_qty), std_uph: 0, std_headcount: num(r.headcount),
        plan_remark: "", filled: true, report_id: r.id, manual: true,
        done_qty: num(r.done_qty), ng_qty: num(r.ng_qty),
        headcount: num(r.headcount), work_hours: num(r.work_hours),
        remark: r.remark || "",
      }, 0));
    }
    return ok(res, {
      date: d1, shift, rows, hours: hours[shift] || 10,
      totals: {
        plan_qty: rows.reduce((a, x) => a + num(x.plan_qty), 0),
        done_qty: rows.reduce((a, x) => a + num(x.done_qty), 0),
        ng_qty: rows.reduce((a, x) => a + num(x.ng_qty), 0),
      },
    });
  });

  // GET /shift/summary — 按 日/线/工段/工单/机型 汇总（源 shift_summary）
  router.get("/shift/summary", requireMesrjPerm(null), async (req, res) => {
    const d1 = String(req.query.d1 || "").slice(0, 10)
      || (await query("SELECT now()::date::text AS d")).rows[0].d;
    const d2 = String(req.query.d2 || "").slice(0, 10) || d1;
    const group = String(req.query.group || "day");
    const col = { day: "report_date", line: "line_code", process: "process",
      mo: "mo_no", product: "product_code" }[group] || "report_date";
    const line = String(req.query.line_code || "").trim();
    const where = ["report_date::date BETWEEN $1::date AND $2::date"], args = [d1, d2];
    if (line) { args.push(line); where.push(`line_code=$${args.length}`); }
    const rows = (await query(
      `SELECT ${col === "report_date" ? "report_date::date::text" : col} AS k, COUNT(*)::int AS cnt,
              COALESCE(SUM(plan_qty),0) AS plan_qty, COALESCE(SUM(done_qty),0) AS done_qty,
              COALESCE(SUM(ng_qty),0) AS ng_qty, COALESCE(SUM(total_hours),0) AS total_hours
         FROM prd_shift_report WHERE ${where.join(" AND ")}
        GROUP BY ${col === "report_date" ? "report_date::date::text" : col} ORDER BY k`, args)).rows;
    for (const r of rows) {
      const plan = num(r.plan_qty), done = num(r.done_qty), ng = num(r.ng_qty), th = num(r.total_hours);
      r.rate = plan > 0 ? Number(((done / plan) * 100).toFixed(1)) : null;
      r.ng_rate = (done + ng) > 0 ? Number(((ng / (done + ng)) * 100).toFixed(1)) : 0;
      r.upph = th > 0 ? Number((done / th).toFixed(2)) : 0;
    }
    return ok(res, { group, rows, d1, d2 });
  });

  // GET /shift/options — 补录用：工单 + 工段 + 产能主数据（源 shift_options）
  router.get("/shift/options", requireMesrjPerm(null), async (req, res) => {
    const kw = String(req.query.keyword || "").trim();
    const where = ["m.status NOT IN ('已关闭','已取消')"], args = [];
    if (kw) {
      args.push(`%${kw}%`);
      where.push(`(m.mo_no ILIKE $${args.length} OR m.product_code ILIKE $${args.length}
                   OR p.product_model ILIKE $${args.length})`);
    }
    const mos = (await query(
      `SELECT m.mo_no, m.product_code, m.plan_qty, m.line_code, m.status,
              m.process_code, p.product_model AS model
         FROM ord_mo m LEFT JOIN md_product p ON p.product_code = m.fg_code
        WHERE ${where.join(" AND ")} ORDER BY m.mo_no DESC LIMIT 300`, args)).rows;
    const processes = (await query(
      `SELECT process_code FROM cfg_process WHERE COALESCE(enabled,1)<>0
        ORDER BY sort_no, process_code`)).rows.map(r => r.process_code);
    const caps = (await query(
      "SELECT line_code, product_code, process, uph, std_headcount FROM cfg_capacity WHERE enabled=1")).rows;
    return ok(res, { mos, processes, caps });
  });

  // GET/POST /shift/stationmap — 工段 ↔ 工位关键词映射（源 shift_stationmap，存 sys_param）
  router.get("/shift/stationmap", requireMesrjPerm(null), async (_req, res) => {
    return ok(res, { map: await shiftMap(), default: DEFAULT_STATION_MAP });
  });
  router.post("/shift/stationmap", requireMesrjPerm("md.shift"), async (req, res) => {
    const m = (req.body || {}).map;
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      return fail(res, "map 必须是对象，如 {\"包装\": [\"PACK\"]}");
    }
    const norm = Object.fromEntries(Object.entries(m)
      .map(([k, v]) => [String(k), Array.isArray(v) ? v.map(String) : [String(v)]]));
    await setParam("shift.station_map", JSON.stringify(norm), "填报-MES工位映射", "计划");
    return ok(res, norm, "已保存");
  });

  // POST /shift/save — 整表提交（按 日期+班次+工单+工段 覆盖，源 shift_save）
  router.post("/shift/save", requireMesrjPerm("md.shift"), async (req, res) => {
    const d = req.body || {};
    const date = String(d.date || "").slice(0, 10)
      || (await query("SELECT now()::date::text AS d")).rows[0].d;
    const shift = String(d.shift || "DAY").toUpperCase();
    const rowsIn = Array.isArray(d.rows) ? d.rows : [];
    if (!rowsIn.length) return fail(res, "没有要保存的数据");
    const user = req.mesrjUser?.login_name || "";
    let saved = 0, cleared = 0, skipped = 0;
    for (const r of rowsIn) {
      const mo = String(r.mo_no || "").trim();
      const proc = String(r.process || "").trim();
      if (!mo || !proc) { skipped += 1; continue; }
      const done = num(r.done_qty), ng = num(r.ng_qty);
      const ppl = num(r.headcount), hrs = num(r.work_hours);
      const remark = String(r.remark || "").trim().slice(0, 200);
      // 整行清空：之前填过 → 删旧记录（否则旧数字赖着不走）；没填过 → 跳过
      if (done === 0 && ng === 0 && !remark) {
        const rid = Number(r.report_id || 0);
        if (rid) {
          await query("DELETE FROM prd_shift_report WHERE id=$1", [rid]);
          cleared += 1;
        } else skipped += 1;
        continue;
      }
      if (done < 0 || ng < 0 || ppl < 0 || hrs < 0) return fail(res, `${mo} / ${proc} 的数字不能为负`);
      if (hrs > 24) return fail(res, `${mo} / ${proc} 的生产工时超过 24 小时，请检查`);
      const calc = calcRow({ plan_qty: num(r.plan_qty), done_qty: done, ng_qty: ng,
        headcount: ppl, work_hours: hrs }, num(r.std_uph));
      await query(
        `INSERT INTO prd_shift_report
           (report_date, shift_code, line_code, mo_no, product_code, process,
            plan_qty, done_qty, ng_qty, headcount, work_hours,
            uph, upph, total_hours, rate, eff, remark, plan_id, src,
            created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'manual',$19,now(),now())
         ON CONFLICT (report_date, shift_code, mo_no, process) DO UPDATE SET
           line_code=EXCLUDED.line_code, product_code=EXCLUDED.product_code,
           plan_qty=EXCLUDED.plan_qty, done_qty=EXCLUDED.done_qty, ng_qty=EXCLUDED.ng_qty,
           headcount=EXCLUDED.headcount, work_hours=EXCLUDED.work_hours,
           uph=EXCLUDED.uph, upph=EXCLUDED.upph, total_hours=EXCLUDED.total_hours,
           rate=EXCLUDED.rate, eff=EXCLUDED.eff, remark=EXCLUDED.remark, updated_at=now()`,
        [date, shift, String(r.line_code || "").trim(), mo, String(r.product_code || "").trim(), proc,
          num(r.plan_qty), done, ng, ppl, hrs, calc.uph, calc.upph, calc.total_hours,
          calc.rate, calc.eff, remark, Number(r.plan_id || 0) || null, user]);
      saved += 1;
    }
    return ok(res, { saved, cleared, skipped }, `保存 ${saved} 条`);
  });

  // POST /shift/delete — 删除一条填报（源 shift_delete）
  router.post("/shift/delete", requireMesrjPerm("md.shift"), async (req, res) => {
    const id = Number((req.body || {}).id || 0);
    if (!id) return fail(res, "缺少 id");
    const row = (await query("SELECT * FROM prd_shift_report WHERE id=$1", [id])).rows[0];
    if (!row) return fail(res, "记录不存在");
    await query("DELETE FROM prd_shift_report WHERE id=$1", [id]);
    await audit(req.mesrjUser?.login_name || "", "生产执行", "删除填报",
      `${row.report_date} ${row.shift_code} ${row.mo_no}/${row.process}`, req.ip);
    return ok(res, null, "已删除");
  });
  // ════════════════════════════════════════════════════════════════════════════
  // 时效（Dwell Time）管控 —— 源 api/dwell.py + core/dwell.py
  //   站间停留超时：规则 cfg_dwell_rule，动作 预警/拦截；实时校验挂在过站引擎里，
  //   定时扫描（卡在原地不动）由 POST /dwell/scan 触发（本仓暂无内建 scheduler）。
  // ════════════════════════════════════════════════════════════════════════════
  const DWELL_PROC_NAME = { "01": "SMT", "02": "DIP", "03": "组装", "04": "包装" };

  // ── 规则清单（带人话名）──
  router.get("/dwell/rules", requireMesrjPerm("prod.trace"), async (_req, res) => {
    await dwell.ensureSchema();
    const rows = (await query("SELECT * FROM cfg_dwell_rule ORDER BY id")).rows;
    for (const r of rows) {
      r.from_name = await dwell.keyName(r.from_key);
      r.to_name = await dwell.keyName(r.to_key);
    }
    return ok(res, rows);
  });

  // ── 下拉选项（工序 / 工位类型 / 工位编码）──
  router.get("/dwell/meta", requireMesrjPerm("prod.trace"), async (_req, res) => {
    const procs = ["01", "02", "03", "04"].map(p => ({ key: p, name: `${p} ${DWELL_PROC_NAME[p]}` }));
    const types = (await query(
      `SELECT type_code AS key, type_code AS name, process_code, COUNT(*)::int AS station_count
         FROM md_station WHERE COALESCE(type_code,'')<>''
        GROUP BY type_code, process_code ORDER BY process_code, type_code`)).rows;
    const stations = (await query(
      `SELECT station_code, short_name, station_name, line_code, process_code
         FROM md_station ORDER BY process_code, station_code`)).rows.map(s => ({
           key: s.station_code,
           name: `${s.station_code} · ${s.short_name || s.station_name || ""}`,
         }));
    return ok(res, { processes: procs, types, stations });
  });

  // ── 新增 / 修改规则 ──
  router.post("/dwell/rule/save", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const d = req.body || {};
    await dwell.ensureSchema();
    const fromKey = String(d.from_key || "").trim();
    const toKey = String(d.to_key || "").trim();
    const maxHours = Number(d.max_hours || 0);
    const action = String(d.action || dwell.ACTION_WARN).trim();
    if (!fromKey || !toKey) return fail(res, "起点、终点都必须填");
    if (!(maxHours > 0)) return fail(res, "限时（小时）必须大于 0");
    if (action !== dwell.ACTION_WARN && action !== dwell.ACTION_BLOCK) {
      return fail(res, "动作只能是「预警」或「拦截」");
    }
    const name = String(d.rule_name || "").trim()
      || `${await dwell.keyName(fromKey)} → ${await dwell.keyName(toKey)}`;
    const enabled = Number(d.enabled ?? 1) ? 1 : 0;
    const remark = String(d.remark || "").trim();
    const id = Number(d.id || 0);
    if (id) {
      await query(
        `UPDATE cfg_dwell_rule SET rule_name=$1, from_key=$2, to_key=$3, max_hours=$4,
          action=$5, enabled=$6, remark=$7 WHERE id=$8`,
        [name, fromKey, toKey, maxHours, action, enabled, remark, id]);
    } else {
      await query(
        `INSERT INTO cfg_dwell_rule (rule_name, from_key, to_key, max_hours, action, enabled, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [name, fromKey, toKey, maxHours, action, enabled, remark]);
    }
    return ok(res, { id: id || 0 }, "已保存");
  });

  // ── 删除规则 ──
  router.post("/dwell/rule/delete", requireMesrjPerm("cfg.edit"), async (req, res) => {
    const id = Number((req.body || {}).id || 0);
    if (!id) return fail(res, "缺少 id");
    await query("DELETE FROM cfg_dwell_rule WHERE id=$1", [id]);
    return ok(res, null, "已删除");
  });

  // ── 超期清单（页面用：总数 / 严重 / 各工位分布）──
  router.get("/dwell/overdue", requireMesrjPerm("prod.trace"), async (req, res) => {
    const days = Number(req.query.days || 7) || 7;
    return ok(res, await dwell.summary(days));
  });

  // ── 立即扫描（把超期品写进预警中心）──
  router.post("/dwell/scan", requireMesrjPerm("prod.trace"), async (req, res) => {
    const days = Number((req.body || {}).days || 7) || 7;
    const items = await dwell.scan(days, true);
    return ok(res, { total: items.length, items: items.slice(0, 500) },
      `扫出 ${items.length} 颗超期品`);
  });

  // ── 单颗 SN 的时效体检（相邻两站停留 vs 规则）──
  router.get("/dwell/check", requireMesrjPerm("prod.trace"), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "SN 必填");
    const rows = (await query(
      `SELECT station_code, pass_time, result, mo_no FROM prd_pass
        WHERE sn=$1 ORDER BY id DESC LIMIT 40`, [sn])).rows;
    if (!rows.length) return ok(res, { sn, gaps: [], msg: "这颗 SN 还没有过站记录" });
    const gaps = [];
    let prev = null;
    for (const r of rows.slice().reverse()) {
      if (prev) {
        const rule = await dwell.findRule(prev.station_code, r.station_code);
        const h = (new Date(r.pass_time).getTime() - new Date(prev.pass_time).getTime()) / 3600000;
        if (rule && Number.isFinite(h)) {
          const lim = Number(rule.max_hours || 0);
          gaps.push({
            from: prev.station_code, to: r.station_code,
            hours: Number(h.toFixed(2)), max_hours: lim,
            over: Number(Math.max(0, h - lim).toFixed(2)),
            rule_name: rule.rule_name, action: rule.action || dwell.ACTION_WARN,
          });
        }
      }
      prev = r;
    }
    return ok(res, { sn, gaps });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // P1 补齐：exec/hourly · smt/consumption · smt/material_info · aoi/export
  //   源 api/exec.py hourly / api/smt.py consumption·material_info / api/aoi.py export
  // ════════════════════════════════════════════════════════════════════════════

  // GET /exec/hourly — 每小时过站统计（全工位，源 exec_hourly）
  router.get("/exec/hourly", requireMesrjPerm(null), async (req, res) => {
    const d1 = String(req.query.d1 || "").trim();
    const day = d1 ? d1.slice(0, 10) : (await query("SELECT now()::date::text AS d")).rows[0].d;
    const rows = (await query(
      `SELECT to_char(pass_time,'HH24') AS h,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE result<>'OK')::int AS ng_qty
         FROM prd_pass WHERE pass_time::date = $1::date GROUP BY 1 ORDER BY 1`, [day])).rows;
    const byStation = (await query(
      `SELECT station_code,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE result<>'OK')::int AS ng_qty
         FROM prd_pass WHERE pass_time::date = $1::date
        GROUP BY station_code ORDER BY total DESC LIMIT 200`, [day])).rows;
    const hours = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, "0");
      const r = rows.find(x => x.h === h) || { total: 0, ng_qty: 0 };
      return { hour: h, total: Number(r.total || 0), ng_qty: Number(r.ng_qty || 0),
        ok_qty: Number(r.total || 0) - Number(r.ng_qty || 0) };
    });
    const total = hours.reduce((a, x) => a + x.total, 0);
    const ng = hours.reduce((a, x) => a + x.ng_qty, 0);
    return ok(res, { day, hours, by_station: byStation,
      total: { total, ng_qty: ng, ok_qty: total - ng, yield: total ? ((total - ng) / total * 100).toFixed(2) : 0 } });
  });

  // GET /smt/consumption — 物料消耗/剩余/可做（实时算，源 material_consumption）
  //   口径：已生产 = 该工单 AOI 过站 OK 的去重 SN 数；某料消耗 = 已生产 × BOM 单机用量；
  //   剩余 = 累计上料 − 消耗；还能做 = 剩余 ÷ 单机用量。BOM 按递归展开（SFG 半成品往下拆）。
  router.get("/smt/consumption", requireMesrjPerm("prod.trace"), async (req, res) => {
    const moNo = String(req.query.mo_no || "").trim();
    if (!moNo) {
      const opts = (await query(
        `SELECT m.mo_no, m.status, m.product_code, m.plan_qty,
                (SELECT COUNT(*) FROM prd_material_load l WHERE l.mo_no=m.mo_no)::int > 0 AS has_load
           FROM ord_mo m
          WHERE m.status IN ('待排产','已排产','已下达','生产中')
          ORDER BY m.mo_no DESC`)).rows;
      return ok(res, { mo_options: opts, items: [] });
    }
    const mo = (await query(
      "SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
    if (!mo) return fail(res, `工单 ${moNo} 不存在`, 404);
    const productCode = mo.product_code || "";
    const produced = (await query(
      `SELECT COUNT(DISTINCT sn)::int AS n FROM prd_pass
        WHERE mo_no=$1 AND station_code ILIKE '%AOI%' AND result='OK'`, [moNo])).rows[0]?.n || 0;
    // 递归展开 BOM（SFG 半成品行往下一层拆，最多 6 层）
    const flat = productCode ? (await query(
      `WITH RECURSIVE exp AS (
          SELECT i.material_code, i.item_type, i.qty_per::numeric AS qty, i.pos_ref, 1 AS depth
            FROM bom_item i WHERE i.product_code=$1
         UNION ALL
          SELECT c.material_code, c.item_type, e.qty * c.qty_per::numeric, c.pos_ref, e.depth + 1
            FROM exp e JOIN bom_item c ON c.product_code = e.material_code
           WHERE COALESCE(e.item_type,'') IN ('SFG','Sub') AND e.depth < 6
        )
        SELECT material_code, MIN(pos_ref) AS pos_ref, SUM(qty)::numeric AS qty_per
          FROM exp WHERE COALESCE(item_type,'') NOT IN ('SFG','Sub')
         GROUP BY material_code`, [productCode])).rows : [];
    const loaded = (await query(
      `SELECT material_code, SUM(qty::numeric) AS qty
         FROM prd_material_load WHERE mo_no=$1 AND active::text IN ('1','true','Y','y') GROUP BY material_code`,
      [moNo])).rows;
    const loadMap = Object.fromEntries(loaded.map(r => [r.material_code, Number(r.qty || 0)]));
    let lowPct = Number(req.query.low_pct || 20) || 20;
    let lowQty = Number(req.query.low_qty || 0) || 0;
    const items = flat.map(f => {
      const per = Number(f.qty_per || 0);
      const used = per * produced;
      const remain = (loadMap[f.material_code] || 0) - used;
      const canMake = per > 0 ? Math.max(0, Math.floor(remain / per)) : 0;
      const pct = per > 0 && loadMap[f.material_code] ? (remain / loadMap[f.material_code] * 100) : 100;
      const low = (lowPct > 0 && loadMap[f.material_code] > 0 && pct < lowPct)
        || (lowQty > 0 && canMake < lowQty);
      return { material_code: f.material_code, pos_ref: f.pos_ref || "", qty_per: per,
        loaded: loadMap[f.material_code] || 0, used: Number(used.toFixed(2)),
        remain: Number(remain.toFixed(2)), can_make: canMake, pct: Number(pct.toFixed(2)), low };
    }).sort((a, b) => a.pct - b.pct);
    return ok(res, { mo_no: moNo, product_code: productCode, produced,
      items, low_count: items.filter(x => x.low).length });
  });

  // GET /smt/material_info — 点料看详情（源 smt_material_info）
  router.get("/smt/material_info", requireMesrjPerm("prod.trace"), async (req, res) => {
    const code = String(req.query.code || "").trim();
    const moNo = String(req.query.mo_no || "").trim();
    if (!code) return fail(res, "请提供料号");
    const md = (await query("SELECT * FROM md_material WHERE material_code=$1", [code])).rows[0] || null;
    const used = (await query(
      `SELECT material_code, machine_no, slot_no, batch_no, dc_code, lot_no, reel_sn, qty,
              operator, created_at FROM prd_material_load
        WHERE material_code=$1 AND active::text IN ('1','true','Y','y') AND ($2='' OR mo_no=$2)
        ORDER BY id DESC LIMIT 100`, [code, moNo])).rows;
    const stock = (await query(
      `SELECT material_code, material_name_zh, uom, total_received, total_issued,
              current_balance
         FROM v_report_material_balance WHERE material_code=$1 AND current_balance>0
        ORDER BY current_balance DESC LIMIT 50`, [code])).rows;
    const bom = [];
    let foreign = [];
    if (moNo) {
      const mo = (await query("SELECT product_code FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
      if (mo?.product_code) {
        const hit = (await query(
          `SELECT pos_ref, qty_per, segment, wo_type FROM bom_item
            WHERE product_code=$1 AND material_code=$2 LIMIT 10`,
          [mo.product_code, code])).rows;
        if (hit.length) bom.push(...hit);
        else foreign = (await query(
          `SELECT DISTINCT product_code FROM bom_item WHERE material_code=$1 LIMIT 10`,
          [code])).rows.map(r => r.product_code);
      }
    }
    // 库存结存是 WMS 同步镜像：把「同步时间 / 覆盖料号数」一起给出，
    // 否则查不到库存时现场会以为连接断了（源 smt_material_info 同款提示）
    const stockStats = (await query(
      `SELECT COUNT(*)::int AS cnt, COUNT(DISTINCT material_code)::int AS codes
         FROM v_report_material_balance`)).rows[0] || {};
    const wms = {
      configured: Number(stockStats.cnt || 0) > 0,
      last_sync: String(req.query.asof || ""),
      rows: Number(stockStats.cnt || 0), codes: Number(stockStats.codes || 0),
    };
    return ok(res, { material: md, used, stock, bom, foreign, wms });
  });

  // GET /aoi/export — AOI 检测数据导出（源 export，JSON/CSV）
  router.get("/aoi/export", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d1 = String(req.query.d1 || "").slice(0, 10);
    const d2 = String(req.query.d2 || "").slice(0, 10);
    const stationCode = String(req.query.station_code || "").trim();
    const format = String(req.query.format || "json").toLowerCase();
    const where = ["1=1"], args = [];
    if (d1) { args.push(d1); where.push(`created_at::date >= $${args.length}::date`); }
    if (d2) { args.push(d2); where.push(`created_at::date <= $${args.length}::date`); }
    if (stationCode) { args.push(stationCode); where.push(`station_code=$${args.length}`); }
    const rows = (await query(
      `SELECT * FROM prd_aoi_result WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 5000`,
      args)).rows;
    if (format === "csv") {
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [cols.join(",")]
        .concat(rows.map(r => cols.map(c => esc(r[c])).join(",")))
        .join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=aoi_export.csv");
      return res.send(csv);
    }
    return ok(res, rows);
  });
  // ── 报表输出（源 analyze.py output 产能看板）──
  // prd_machine_data 无 line_code 列，按 line_sn 聚合并以 line_code 键返回，与前端 OutputView 一致
  router.get("/report/output", requireMesrjPerm(null), async (_req, res) => {
    const rows = await query(
      `SELECT line_sn AS line_code,
              COUNT(*) AS total,
              COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END) AS ng_qty,
              COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) NOT IN ('NG','FAIL') OR pass_ng='' THEN 1 END) AS good_qty,
              ROUND(100.0 * COUNT(CASE WHEN UPPER(COALESCE(pass_ng,'')) IN ('NG','FAIL') THEN 1 END) / NULLIF(COUNT(*),0), 2) AS ng_rate
       FROM prd_machine_data
       WHERE created_at >= now() - interval '1 day'
       GROUP BY line_sn
       ORDER BY line_sn`);
    return ok(res, { list: rows.rows });
  });

  // ── 分板看板（源 board.py 车间大屏）──
  router.get("/board/shopfloor", requireMesrjPerm(null), async (_req, res) => {
    const lines = await query(
      `SELECT l.line_code, l.line_name,
              COUNT(m.sn) AS out_qty,
              COUNT(CASE WHEN UPPER(COALESCE(m.pass_ng,'')) IN ('NG','FAIL') THEN 1 END) AS ng_qty
       FROM md_line l
       LEFT JOIN prd_machine_data m ON m.line_sn = l.line_code AND m.created_at >= now() - interval '1 day'
       WHERE l.status = 1
       GROUP BY l.line_code, l.line_name
       ORDER BY l.line_code`);
    // prd_panel_split 本身无 judge，取该版面最新一条槽位的判定作为面板判定
    const panels = await query(
      `SELECT p.panel_sn, p.mo_no, p.station_code,
              COALESCE((SELECT s.judge FROM prd_panel_slot s WHERE s.panel_sn = p.panel_sn ORDER BY s.id DESC LIMIT 1), p.status) AS judge,
              p.created_at
       FROM prd_panel_split p
       ORDER BY p.created_at DESC
       LIMIT 50`);
    // 旧 MES 当日 ATE 快照优先（源 api/board.py _shopfloor 65-76）：现场大屏的
    // 良率/Dppm 以旧 MES 的 ATE 组为准，没推送时才用本系统机器数据兜底。
    const today = nowStr().slice(0, 10);
    const omRows = (await query(
      `SELECT group_code, input_qty, pass_qty, true_fail, pass_yield, dppm
         FROM prd_oldmes_yield WHERE biz_date=$1 AND time_from='00:00' AND time_to='23:59'`,
      [today])).rows;
    const om = new Map(omRows.map(r => [r.group_code, r]));
    const fallbackOut = lines.rows.reduce((s, r) => s + Number(r.out_qty || 0), 0);
    const fallbackNg = lines.rows.reduce((s, r) => s + Number(r.ng_qty || 0), 0);
    const ate = om.get("ATE") || om.get("PACKING") || null;
    let yOutput = fallbackOut, yPass = Math.max(0, fallbackOut - fallbackNg),
      yNg = fallbackNg, yYield = 0, yDppm = 0;
    if (ate) {
      yOutput = Number(ate.input_qty || 0);
      yPass = Number(ate.pass_qty || 0);
      yNg = Number(ate.true_fail || 0);
      yYield = Math.round(Number(ate.pass_yield || 0) * 10000) / 10000;
      yDppm = Math.round(Number(ate.dppm || 0) * 10) / 10;
    }
    if (!yYield) {
      yYield = yOutput ? Math.round((yPass / yOutput) * 10000) / 10000 : 0;
      yDppm = yOutput ? Math.round((yNg / yOutput) * 1000000 * 10) / 10 : 0;
    }
    return ok(res, {
      lines: lines.rows.map(r => ({
        line_code: r.line_code,
        line_name: r.line_name || r.line_code,
        plan_qty: 0,
        out_qty: Number(r.out_qty || 0),
        ng_qty: Number(r.ng_qty || 0)
      })),
      panels: panels.rows,
      yield_today: { output: yOutput, pass: yPass, ng: yNg, yield: yYield, dppm: yDppm,
        source: ate ? "oldmes" : "local" },
    });
  });
  // ── oldmes 推送（源 api/board.py /oldmes/push）──
  //   抓旧 MES 看板的外部脚本按「日期 + 时间窗 + GroupCode」推一整屏良率快照，
  //   同一窗口重复推要覆盖（源 SELECT 后 UPDATE，不做累加）。表 314 迁移建。
  router.all("/oldmes/push", requireMesrjPerm(null), async (req, res) => {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(204).end();
    }
    const d = req.body || {};
    const stations = Array.isArray(d.Stations) ? d.Stations : [];
    if (!stations.length) return fail(res, "没有 Stations 数据", 400);
    const bizDate = String(d.DateFrom || "").trim();
    const tFrom = String(d.TimeFrom || "").trim();
    const tTo = String(d.TimeTo || "").trim();
    const ts = nowStr();
    let added = 0, updated = 0;
    try {
      for (const s of stations) {
        const gcode = String(s.GroupCode || "").trim();
        if (!gcode) continue;
        const num = (v, dv = 0) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : dv;
        };
        const dppo = s.Dppo === null || s.Dppo === undefined || s.Dppo === "" ? null : num(s.Dppo);
        const r = await query(
          `INSERT INTO prd_oldmes_yield
             (biz_date, time_from, time_to, group_code, group_name, product_step, flow_order,
              route_order, is_retest, failure_source, input_qty, failure1, failure2, true_fail,
              pass_qty, dppm, dppo, fpy, pass_yield, snapshot_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           ON CONFLICT (biz_date, time_from, time_to, group_code) DO UPDATE SET
             group_name=EXCLUDED.group_name, product_step=EXCLUDED.product_step,
             flow_order=EXCLUDED.flow_order, route_order=EXCLUDED.route_order,
             is_retest=EXCLUDED.is_retest, failure_source=EXCLUDED.failure_source,
             input_qty=EXCLUDED.input_qty, failure1=EXCLUDED.failure1, failure2=EXCLUDED.failure2,
             true_fail=EXCLUDED.true_fail, pass_qty=EXCLUDED.pass_qty, dppm=EXCLUDED.dppm,
             dppo=EXCLUDED.dppo, fpy=EXCLUDED.fpy, pass_yield=EXCLUDED.pass_yield,
             snapshot_at=EXCLUDED.snapshot_at
           RETURNING (xmax = 0) AS inserted`,
          [bizDate, tFrom, tTo, gcode, String(s.GroupName || ""), String(s.ProductStep || ""),
           num(s.FlowOrder), Math.trunc(num(s.RouteOrder)), s.IsRetestStation ? 1 : 0,
           String(s.FailureSource || ""), Math.trunc(num(s.InputQty)), Math.trunc(num(s.Failure1)),
           Math.trunc(num(s.Failure2)), Math.trunc(num(s.TrueFail)), Math.trunc(num(s.PassQty)),
           num(s.Dppm), dppo, num(s.Fpy), num(s.PassYield), ts]);
        if (r.rows[0]?.inserted) added += 1; else updated += 1;
      }
    } catch (e) {
      return fail(res, `入库失败: ${e.message}`, 500);
    }
    return ok(res, { new: added, updated, date: bizDate, time: `${tFrom}-${tTo}`,
      stations: stations.length, at: ts }, `推送成功（新增 ${added}，更新 ${updated}）`);
  });

  // ── PO 追溯汇总 ──
  router.get("/trace/po/summary", requireMesrjPerm(null), async (req, res) => {
    const po = String(req.query.po || "").trim();
    if (!po) return fail(res, "请提供 PO");
    return ok(res, await traceSummary(po));
  });

  // ── PO 追溯导出 Excel ──
  router.get("/trace/po/export", requireMesrjPerm(null), async (req, res) => {
    const po = String(req.query.po || "").trim();
    if (!po) return fail(res, "请提供 PO");
    const data = await writeXlsx(po);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="trace_${po}.xlsx"`);
    return res.send(data.buffer);
  });

  // ── SN 追溯汇总 ──
  router.get("/trace/sn/summary", requireMesrjPerm(null), async (req, res) => {
    const sn = String(req.query.sn || "").trim();
    if (!sn) return fail(res, "请提供 SN");
    return ok(res, await snSummary(sn));
  });

  // ── SN 任意码查询 ──
  router.get("/trace/sn/query", requireMesrjPerm(null), async (req, res) => {
    const code = String(req.query.code || "").trim();
    if (!code) return fail(res, "请提供条码");
    return ok(res, await snQuery(code));
  });

  // ── PO 追溯清理（源 trace_export.py clean）──
  router.post("/trace/po/clean", requireMesrjPerm(null), async (req, res) => {
    const d = req.body || {};
    const po = String(d.po || "").trim();
    if (!po) return fail(res, "请提供 PO");
    let cleaned = 0;
    try {
      const r = await query(
        "UPDATE prd_machine_data SET pass_ng = 'ARCHIVED' WHERE mo_no = $1 AND pass_ng NOT IN ('ARCHIVED','')",
        [po]);
      cleaned = r.rowCount || 0;
    } catch { /* best-effort; table may not exist yet */ }
    return ok(res, { cleaned }, "已清理");
  });

  // ════════════════════════════════════════════════════════════════════════════
  // W13 SMT 管控路由（源 api/smt.py 42 路由，side-by-side 移植）
  // ════════════════════════════════════════════════════════════════════════════

  // ── SMT：初始化运行时表 ──
  router.post("/smt/init", requireMesrjPerm("md.edit"), async (_req, res) => {
    await smtCore.ensureSchema();
    return ok(res, null, "SMT 运行时表已初始化");
  });

  // ── SMT：物料上架 ──
  router.post("/smt/material_load", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    await smtCore.ensureSchema();
    await query(
      `INSERT INTO prd_material_load (model, machine_no, slot_no, feeder_no, material_code,
        vn_code, batch_no, expect_code, expect_spec, designators, check_result, fail_reason,
        operator, reel_sn, mo_no, active, lot_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [d.model || "", d.machine_no || "", d.slot_no || "", d.feeder_no || "",
       d.material_code || "", d.vn_code || "", d.batch_no || "", d.expect_code || "",
       d.expect_spec || "", d.designators || "", d.check_result || "", d.fail_reason || "",
       d.operator || "", d.reel_sn || "", d.mo_no || "", d.active !== undefined ? d.active : "1", d.lot_no || ""]);
    await smtCore.audit(d.operator || "", "SMT", "物料上架", d.reel_sn || "", JSON.stringify(d), req.ip);
    return ok(res, null, "物料上架完成");
  });

  // ── SMT：物料上架查询 ──
  router.get("/smt/material_load", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kw = String(req.query.kw || "").trim();
    const mo = String(req.query.mo_no || "").trim();
    const where = ["1=1"];
    const args = [];
    if (kw) { args.push(`%${kw}%`); where.push(`(material_code ILIKE $${args.length} OR reel_sn ILIKE $${args.length})`); }
    if (mo) { args.push(mo); where.push(`mo_no=$${args.length}`); }
    const r = await query(
      `SELECT * FROM prd_material_load WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 200`,
      args);
    return ok(res, r.rows);
  });

  // ── SMT：料号校验（feeder slot） ──
  router.get("/smt/feeder_slot_match", requireMesrjPerm("prod.trace"), async (req, res) => {
    const machine = String(req.query.machine || "").trim();
    const slot = String(req.query.slot || "").trim();
    const model = String(req.query.model || "").trim();
    const mat = String(req.query.mat || "").trim();
    const strict = req.query.strict !== "false";
    const r = await smtCore.feederSlotMatch(machine, slot, model, mat, strict);
    return ok(res, r);
  });

  // ── SMT：解析料盘条码 ──
  router.get("/smt/parse_reel", requireMesrjPerm("prod.trace"), async (req, res) => {
    const code = String(req.query.code || "").trim();
    return ok(res, smtCore.parseReel(code));
  });

  // ── SMT：基准配置 ──
  router.get("/smt/baseline/config", requireMesrjPerm("md.edit"), async (req, res) => {
    const enabled = req.query.enabled !== undefined ? String(req.query.enabled) : undefined;
    const lockHits = req.query.lock_hits !== undefined ? String(req.query.lock_hits) : undefined;
    const cfg = await smtCore.baselineConfig({ enabled, lockHits });
    return ok(res, cfg);
  });

  // ── SMT：基准列表 ──
  router.get("/smt/baseline/list", requireMesrjPerm("prod.trace"), async (req, res) => {
    const rows = await smtCore.baselineList({
      kw: req.query.kw || "", model: req.query.model || "",
      locked: req.query.locked || "", line: req.query.line || "",
      limit: Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000),
    });
    return ok(res, rows);
  });

  // ── SMT：基准统计 ──
  router.get("/smt/baseline/stats", requireMesrjPerm("prod.trace"), async (_req, res) => {
    return ok(res, await smtCore.baselineStats());
  });

  // ── SMT：基准锁定/解锁 ──
  router.post("/smt/baseline/lock", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const row = await smtCore.baselineLock(Number(d.id), d.locked === true ? 1 : 0, d.by || req.mesrjUser?.login_name || "");
    return ok(res, row);
  });

  // ── SMT：基准清除 ──
  router.post("/smt/baseline/clear", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const row = await smtCore.baselineClear(Number(d.id), d.by || req.mesrjUser?.login_name || "");
    return ok(res, row);
  });

  // ── SMT：基准验证/学习 ──
  router.post("/smt/baseline/verify", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const r = await smtCore.baselineVerify(d.line_code || "", d.model || "", d.material || "",
      d.machine || "", d.slot || "", d.feeder || "");
    return ok(res, r);
  });
  router.post("/smt/baseline/learn", requireMesrjPerm("prod.trace"), async (req, res) => {
    const d = req.body || {};
    const r = await smtCore.baselineLearn(d.line_code || "", d.model || "", d.material || "",
      d.machine || "", d.slot || "", d.feeder || "", d.op || req.mesrjUser?.login_name || "");
    return ok(res, r);
  });

  // ── SMT：SMT 表 CRUD（prd_material_load） ──
  router.get("/smt/load/list", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kw = String(req.query.kw || "").trim();
    const where = ["1=1"]; const args = [];
    if (kw) { args.push(`%${kw}%`); where.push(`(material_code ILIKE $${args.length} OR reel_sn ILIKE $${args.length})`); }
    const [page, size] = [Math.max(Number(req.query.page) || 1, 1), Math.min(Math.max(Number(req.query.size) || 50, 1), 500)];
    const p = await smtCore.paged ? smtCore.paged(`SELECT COUNT(*)::int AS n FROM prd_material_load WHERE ${where.join(" AND ")}`, `SELECT * FROM prd_material_load WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, size, (page - 1) * size], page, size) : null;
    return ok(res, p || { total: 0, page, size, rows: [] });
  });

  // ── SMT：设备检查记录 ──
  router.post("/smt/equip_check", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    await smtCore.ensureSchema();
    await query(
      `INSERT INTO prd_equip_check (check_date, shift, equip_type, equip_no, items, result, check_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [d.check_date || "", d.shift || "", d.equip_type || "", d.equip_no || "", d.items || "", d.result || "OK", d.check_by || ""]);
    await smtCore.audit(d.check_by || "", "SMT", "设备检查", d.equip_no || "", JSON.stringify(d), req.ip);
    return ok(res, null, "设备检查已记录");
  });

  // ── SMT：设备检查查询 ──
  router.get("/smt/equip_check", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kw = String(req.query.kw || "").trim();
    const where = ["1=1"]; const args = [];
    if (kw) { args.push(`%${kw}%`); where.push(`(equip_no ILIKE $${args.length} OR equip_type ILIKE $${args.length})`); }
    const r = await query(
      `SELECT * FROM prd_equip_check WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 200`, args);
    return ok(res, r.rows);
  });

  // ── SMT：物料超耗 ──
  router.post("/smt/overuse", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    await smtCore.ensureSchema();
    await query(
      `INSERT INTO prd_material_overuse (mo_no, product_code, material_code, standard_qty, actual_qty,
        over_qty, reason, confirm_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'待确认')`,
      [d.mo_no || "", d.product_code || "", d.material_code || "", Number(d.standard_qty || 0),
       Number(d.actual_qty || 0), Number(d.actual_qty || 0) - Number(d.standard_qty || 0),
       d.reason || "", d.confirm_by || ""]);
    await smtCore.audit(d.confirm_by || "", "SMT", "物料超耗", d.material_code || "", JSON.stringify(d), req.ip);
    return ok(res, null, "物料超耗已记录");
  });

  // ── SMT：物料超耗列表 ──
  router.get("/smt/overuse", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kw = String(req.query.kw || "").trim();
    const where = ["1=1"]; const args = [];
    if (kw) { args.push(`%${kw}%`); where.push(`(mo_no ILIKE $${args.length} OR material_code ILIKE $${args.length})`); }
    const r = await query(
      `SELECT * FROM prd_material_overuse WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 200`, args);
    return ok(res, r.rows);
  });

  // ── SMT：SN 绑码 ──
  router.post("/smt/sn_bind", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    await smtCore.ensureSchema();
    await query(
      `INSERT INTO prd_sn_bind (sn, mo_no, model, machine_no, channel, feeder_no, material_sn,
        stencil_sn, paste_sn, pcb_reel_sn, operator, prod_time, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'import',now())`,
      [d.sn || "", d.mo_no || "", d.model || "", d.machine_no || "", d.channel || "",
       d.feeder_no || "", d.material_sn || "", d.stencil_sn || "", d.paste_sn || "",
       d.pcb_reel_sn || "", d.operator || "", d.prod_time || ""]);
    await smtCore.audit(d.operator || "", "SMT", "SN 绑码", d.sn || "", JSON.stringify(d), req.ip);
    return ok(res, null, "SN 绑码完成");
  });

  // ── SMT：SN 绑码查询 ──
  router.get("/smt/sn_bind", requireMesrjPerm("prod.trace"), async (req, res) => {
    const kw = String(req.query.kw || "").trim();
    const where = ["1=1"]; const args = [];
    if (kw) { args.push(`%${kw}%`); where.push(`(sn ILIKE $${args.length} OR material_sn ILIKE $${args.length})`); }
    const r = await query(
      `SELECT * FROM prd_sn_bind WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 200`, args);
    return ok(res, r.rows);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // W13b SMT 管控路由 · 上料防错 / 锡膏回温 / 钢网 / PCB / 首件 / 报工
  //   （源 api/smt.py 余下路由，2026-11-20 文件误删后由源码重建并复加）
  // ════════════════════════════════════════════════════════════════════════════

  // 源 GET /smt/baseline 别名（与 /smt/baseline/list 同处理函数）
  router.get("/smt/baseline", requireMesrjPerm("prod.trace"), async (req, res) => {
    const rows = await smtCore.baselineList({
      kw: req.query.kw || "", model: req.query.model || "", locked: req.query.locked || "",
      line: req.query.line || "", limit: Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000),
    });
    return ok(res, rows);
  });

  // ── SMT：PDA 上料防错 / 记录（源 load_check）──
  router.post("/smt/load_check", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    await smtCore.ensureSchema(); await smtCore.loadParams();
    const machine = String(d.machine_no || "").trim();
    const slot = String(d.slot_no || "").trim();
    const feeder = String(d.feeder_no || "").trim();
    let mat = String(d.material_code || "").trim();
    const batch = String(d.batch_no || "").trim();
    const model = String(d.model || "").trim();
    const op = req.mesrjUser?.login_name || "";
    if (!mat) return ok(res, { success: false, msg: "请扫料盘条码（或填料号）" });
    const mo_no = String(d.mo_no || "").trim() || String(d.mo || "").trim();
    const reel = smtCore.parseReel(d.reel_code || d.code || mat);
    if (reel.rj) mat = reel.rj;
    const reel_sn = reel.reel_sn || d.reel_sn || "";
    const dc_code = reel.dc || d.dc_code || "";
    const qty = reel.qty || d.qty || "";
    const lot_no = reel.lot || d.lot_no || "";
    const strict = Boolean(machine && slot);
    let cfg = null, okMat = true, reason = "", warn = "";
    if (strict) {
      const fs = await smtCore.feederSlotMatch(machine, slot, model, mat, smtCore.feederSlotStrict());
      cfg = fs.cfg;
      if (fs.level === "block") reason = fs.why; else if (fs.level === "warn") warn = fs.why;
      else if (fs.kind === "alt") warn = `（替代料 ${mat} → 该站位主料 ${fs.expect || ""}）`;
      okMat = !reason;
    }
    let feederOk = true, feederNote = "";
    const feederCheck = String(smtCore.smtParam("smt.feeder_check", "0")) === "1";
    if (strict && cfg && okMat && (cfg.feeder_no || "") && feederCheck) {
      if (feeder && feeder.toUpperCase() !== String(cfg.feeder_no).toUpperCase()) {
        feederOk = false; reason = `✕ 飞达不符！${machine} ${slot} 应装飞达「${cfg.feeder_no}」，实扫「${feeder}」`;
      }
    } else if (strict && cfg && okMat && (cfg.feeder_no || "") && feeder && feeder.toUpperCase() !== String(cfg.feeder_no).toUpperCase()) {
      feederNote = `（飞达与配置「${cfg.feeder_no}」不同，仅记录不拦截）`;
    }
    const success = okMat && feederOk;
    const expect_code = cfg ? cfg.material_code : "", expect_spec = cfg ? cfg.spec : "";
    const designators = cfg ? cfg.designators : "", real_model = (cfg ? cfg.model : "") || model;
    try {
      await query(
        `INSERT INTO prd_material_load(model,machine_no,slot_no,feeder_no,material_code,vn_code,batch_no,expect_code,expect_spec,designators,check_result,fail_reason,operator,created_at,reel_sn,mo_no,lot_no,dc_code,qty,active)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'1')`,
        [real_model, machine, slot, feeder, mat, cfg ? (cfg.vn_code || "") : "", batch || lot_no, expect_code, expect_spec, designators,
         success ? "OK" : "NG", reason, op, smtCore.fmtTs(), reel_sn, mo_no, lot_no, dc_code, qty]);
    } catch (e) { return ok(res, { success: false, msg: `上料记录写入失败：${e?.message || e}` }); }
    let brief = `${mat}`;
    if (dc_code) brief += `　D/C ${dc_code}`;
    if (qty) brief += `　${qty} PCS`;
    if (mo_no) brief += `　→ 工单 ${mo_no}`;
    if (success) {
      let msg = "✓ 已上料：" + brief; if (warn) msg += warn; else if (feederNote) msg += feederNote;
      return ok(res, { success: true, msg, mo_no, material_code: mat, dc_code, qty, reel_sn, expect_code, spec: expect_spec, designators, model: real_model }, msg);
    }
    return ok(res, { success: false, msg: reason, expect_code, spec: expect_spec, designators, model: real_model }, reason);
  });

  // ── SMT：退料（源 load_return）──
  router.post("/smt/load_return", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    await smtCore.ensureSchema();
    const reel = smtCore.parseReel(String(d.material_code || "").trim());
    if (!reel.reel_sn) return ok(res, { success: false, msg: "缺少料盘序列号" });
    const rec = (await query("SELECT * FROM prd_material_load WHERE reel_sn=$1 AND active='1' AND check_result='OK' ORDER BY id DESC LIMIT 1", [reel.reel_sn])).rows[0];
    if (!rec) return ok(res, { success: false, msg: "该料盘不在机上" });
    const now = smtCore.fmtTs();
    await query("UPDATE prd_material_load SET active='0', change_out_time=$1 WHERE id=$2", [now, rec.id]);
    return ok(res, { success: true, msg: `✓ 已退料：${rec.material_code}（${rec.machine_no} ${rec.slot_no}），可再次上料` });
  });

  // ── SMT：换料（源 load_change）──
  router.post("/smt/load_change", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    await smtCore.ensureSchema(); await smtCore.loadParams();
    const mo_no = String(d.mo_no || "").trim();
    const new_code = String(d.new_code || "").trim();
    const load_type = String(d.load_type || "").trim().toUpperCase();
    const op = req.mesrjUser?.login_name || "";
    if (!new_code) return ok(res, { success: false, msg: "请扫新料盘条码" });
    const neu = smtCore.parseReel(new_code);
    if (!neu.reel_sn) return ok(res, { success: false, msg: "新料盘条码里没解析出序列号" });
    if (!neu.rj) return ok(res, { success: false, msg: "新料盘条码里没解析出料号" });
    const onm = (await query("SELECT id, mo_no, machine_no, slot_no FROM prd_material_load WHERE reel_sn=$1 AND active='1' AND check_result='OK' ORDER BY id DESC LIMIT 1", [neu.reel_sn])).rows[0];
    if (onm) { const loc = (`${onm.machine_no || ""} ${onm.slot_no || ""}`).trim() || "未记录站位"; return ok(res, { success: false, msg: `这盘料已经上在机上了（${loc} · 工单 ${onm.mo_no || ""}），不用再上一次。` }); }
    let rec = null;
    if (String(d.old_code || "").trim()) {
      const old = smtCore.parseReel(String(d.old_code).trim());
      if (old.reel_sn) {
        rec = (await query("SELECT * FROM prd_material_load WHERE reel_sn=$1 AND active='1' AND check_result='OK' ORDER BY id DESC LIMIT 1", [old.reel_sn])).rows[0];
        if (!rec) return ok(res, { success: false, msg: "旧料盘不在机（可能已经换过了）" });
      }
    }
    const sameCode = Boolean(rec) && String(rec.material_code || "").toUpperCase() === String(neu.rj || "").toUpperCase();
    let lt = ((rec ? rec.load_type : "") || load_type || "SMT").trim().toUpperCase();
    if (!["SMT", "AI", "PLUG"].includes(lt)) lt = "SMT";
    if (lt !== "SMT" && !sameCode) {
      let isSmt2 = 0;
      try { const r = (await query(`SELECT COUNT(*)::int AS n FROM md_feeder_slot_alt a JOIN md_feeder_slot s ON s.id=a.slot_id WHERE UPPER(a.material_code)=$1 OR UPPER(s.material_code)=$1`, [neu.rj.toUpperCase()])).rows[0]; isSmt2 = r ? Number(r.n) : 0; } catch { isSmt2 = 0; }
      if (isSmt2) return ok(res, { success: false, msg: `✕ 换料被拒：${neu.rj} 是「SMT 站位绑码」里的贴片料，不能按 AI/手动插件换。` });
    }
    const vm = ((rec ? rec.machine_no : "") || d.machine_no || "").trim();
    const vs = ((rec ? rec.slot_no : "") || d.slot_no || "").trim();
    let vmodel = (rec ? rec.model : "").trim();
    if (!vmodel) vmodel = await smtCore.moModelSoft((await query("SELECT * FROM ord_mo WHERE mo_no=$1", [((rec ? rec.mo_no : "") || mo_no)])).rows[0]);
    if (lt === "SMT" && !sameCode) {
      if (!(vm && vs)) return ok(res, { success: false, msg: "✕ 换料被拒：换的是不同料号，但查不到原料盘装在哪个设备/通道。请先扫旧料盘。" });
      const fr = await smtCore.feederSlotMatch(vm, vs, vmodel, neu.rj, true);
      if (fr.level === "block") return ok(res, { success: false, msg: fr.why + "（换料已拒绝，旧料盘仍在机）" });
    }
    const now = smtCore.fmtTs();
    if (rec) await query("UPDATE prd_material_load SET active='0', change_out_time=$1 WHERE id=$2", [now, rec.id]);
    const realMo = (rec && rec.mo_no) || mo_no || "";
    let realType = load_type || ((rec ? rec.load_type : "") || "SMT");
    if (!["SMT", "AI", "PLUG"].includes(realType)) realType = "SMT";
    let machine = rec ? rec.machine_no : "", slot = rec ? rec.slot_no : "";
    if (realType !== "SMT") { machine = ""; slot = ""; }
    try {
      await query(`INSERT INTO prd_material_load(model,machine_no,slot_no,material_code,qty,check_result,active,load_type,created_at,reel_sn,mo_no,lot_no,dc_code,operator,channel) VALUES($1,$2,$3,$4,$5,'OK','1',$6,$7,$8,$9,$10,$11,$12,'')`,
        [(rec ? rec.model : "") || "", machine, slot, neu.rj, neu.qty || "", realType, now, neu.reel_sn, realMo, neu.lot || "", neu.dc || "", op]);
    } catch (e) { return ok(res, { success: false, msg: `换料记录写入失败：${e?.message || e}` }); }
    let brief = `${neu.rj}`; if (neu.dc) brief += `　D/C ${neu.dc}`; if (neu.qty) brief += `　${neu.qty} PCS`; if (realMo) brief += `　→ 工单 ${realMo}`;
    let msg = "✓ 换料成功：" + brief; if (rec) msg += `（旧盘 ${rec.reel_sn || ""} 已下机）`;
    await smtCore.audit(op, "上料", "换料", neu.rj, `${rec ? rec.reel_sn : "-"} → ${neu.reel_sn} @ ${realMo}`, req.ip);
    return ok(res, { success: true, msg, material_code: neu.rj, dc_code: neu.dc || "", qty: neu.qty || "", reel_sn: neu.reel_sn, mo_no: realMo, old_reel: rec ? rec.reel_sn : "" }, msg);
  });

  // ── SMT：机型列表（源 models）──
  router.get("/smt/models", requireMesrjPerm("prod.trace"), async (_req, res) => {
    try { const rows = (await query("SELECT DISTINCT model FROM md_feeder_slot WHERE COALESCE(model,'')<>'' ORDER BY model")).rows; return ok(res, rows.map(r => r.model)); } catch { return ok(res, []); }
  });

  // ── SMT：设备点检 / 开工检查（源 equip/check、equip/status）──
  router.post("/smt/equip/check", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const op = req.mesrjUser?.login_name || ""; const ts = smtCore.fmtTs();
    await query("INSERT INTO prd_equip_check (check_date, shift, equip_type, equip_no, items, result, check_by, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [ts.slice(0, 10), ts.slice(11, 13), String(d.equip_type || "").trim(), String(d.equip_no || "").trim(), String(d.items || "").trim(), String(d.result || "OK").trim(), op, ts]);
    return ok(res, { success: true, msg: `✓ 点检已记录：${d.equip_type || ""} ${d.equip_no || ""}（${d.result || "OK"}）` });
  });
  router.get("/smt/equip/status", requireMesrjPerm("prod.trace"), async (req, res) => {
    await smtCore.ensureSchema();
    const etype = String(req.query.equip_type || "").trim();
    if (!etype) return ok(res, { success: false, msg: "缺少设备类型" });
    const ts = smtCore.fmtTs(); const shift = ts.slice(11, 13);
    const r = (await query("SELECT * FROM prd_equip_check WHERE equip_type=$1 AND check_date=$2 AND shift=$3 ORDER BY id DESC LIMIT 1", [etype, ts.slice(0, 10), shift])).rows[0];
    if (!r) return ok(res, { success: false, msg: `✕ ${etype} 本班次（${shift}点）未点检，禁止开工` });
    if (String(r.result || "").toUpperCase() !== "OK") return ok(res, { success: false, msg: `✕ ${etype} 点检结果 ${r.result}，禁止开工` });
    return ok(res, { success: true, msg: `✓ ${etype} 本班次点检 OK（${r.check_by || ""}）` });
  });

  // ── SMT：首件确认（源 fa/confirm、fa/status）──
  router.post("/smt/fa/confirm", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const op = req.mesrjUser?.login_name || ""; const now = smtCore.fmtTs();
    const mo_no = String(d.mo_no || "").trim(); const trig = String(d.trigger_type || "换机型").trim(); const result = String(d.result || "OK").trim();
    await query("INSERT INTO prd_first_article(mo_no,model,trigger_type,result,check_by,check_time,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [mo_no, d.model || "", trig, result, op, now, now]);
    return ok(res, { success: true, msg: `✓ 首件已确认（${mo_no}，${trig}，${result}）` });
  });
  router.get("/smt/fa/status", requireMesrjPerm("prod.trace"), async (req, res) => {
    await smtCore.ensureSchema();
    const mo_no = String(req.query.mo_no || "").trim();
    if (!mo_no) return ok(res, { success: false, msg: "缺少工单号" });
    const r = (await query("SELECT * FROM prd_first_article WHERE mo_no=$1 ORDER BY id DESC LIMIT 1", [mo_no])).rows[0];
    if (!r) return ok(res, { success: false, msg: "✕ 该工单未做首件，禁止报工" });
    if (String(r.result || "").toUpperCase() !== "OK") return ok(res, { success: false, msg: `✕ 首件结果为 ${r.result}，禁止报工` });
    return ok(res, { success: true, msg: `✓ 首件已确认 OK（${r.check_time || ""}）` });
  });

  // ── SMT：报工（源 report）──
  router.post("/smt/report", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema(); await smtCore.loadParams();
    const mo_no = String(d.mo_no || "").trim(); const qty = Math.trunc(Number(d.qty || 0));
    if (!mo_no || qty <= 0) return ok(res, { success: false, msg: "请选工单并填写数量" });
    const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [mo_no])).rows[0];
    if (!mo) return ok(res, { success: false, msg: "工单不存在" });
    if (String(smtCore.smtParam("smt.fa_check", "1")) !== "0") {
      const fa = (await query("SELECT * FROM prd_first_article WHERE mo_no=$1 ORDER BY id DESC LIMIT 1", [mo_no])).rows[0];
      if (!fa) return ok(res, { success: false, msg: "✕ 该工单未做首件，禁止报工" });
      if (String(fa.result || "").toUpperCase() !== "OK") return ok(res, { success: false, msg: `✕ 首件结果为 ${fa.result}，禁止报工` });
    }
    await query("UPDATE ord_mo SET out_qty=COALESCE(out_qty,0)+$1, updated_at=now() WHERE mo_no=$2", [qty, mo_no]);
    await smtCore.stencilConsume(mo_no, qty);
    const prod = (await query("SELECT panel_count FROM md_product WHERE product_code=$1", [mo.product_code || ""])).rows[0];
    const panels = prod ? Number(prod.panel_count || 12) : 12;
    return ok(res, { success: true, msg: `✓ 报工成功：${mo_no} +${qty} 板（≈${qty * panels} pcs 小板）` });
  });

  // ── SMT：物料超耗确认/列表 + SN 导入/追溯（源 overuse/confirm、overuse/list、sn_import、sn_trace）──
  router.post("/smt/overuse/confirm", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const op = req.mesrjUser?.login_name || "";
    const row = d.id ? (await query("SELECT * FROM prd_material_overuse WHERE id=$1", [d.id])).rows[0] : null;
    if (!row) return ok(res, { success: false, msg: "未找到记录" });
    await query("UPDATE prd_material_overuse SET status='已放行', confirm_by=$1, confirm_time=$2 WHERE id=$3", [op, smtCore.fmtTs(), row.id]);
    return ok(res, { success: true, msg: `✓ 超耗已放行（${op}）` });
  });
  router.get("/smt/overuse/list", requireMesrjPerm("prod.trace"), async (_req, res) => {
    await smtCore.ensureSchema();
    const rows = (await query("SELECT * FROM prd_material_overuse ORDER BY id DESC LIMIT 200")).rows;
    return ok(res, { rows, total: rows.length });
  });
  router.post("/smt/sn_import", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const rows = d.rows || []; if (!rows.length) return ok(res, { success: false, msg: "没有数据（rows 为空）" });
    const now = smtCore.fmtTs(); let nNew = 0, nUpd = 0;
    for (const r of rows) {
      const sn = String(r.sn || "").trim(); if (!sn) continue;
      const vals = [sn, r.mo_no || "", r.model || "", r.machine_no || "", r.channel || "", r.feeder_no || "", r.material_sn || "", r.stencil_sn || "", r.paste_sn || "", r.pcb_reel_sn || "", r.operator || "", r.prod_time || "", r.source || "import"];
      const old = (await query("SELECT id FROM prd_sn_bind WHERE sn=$1", [sn])).rows[0];
      if (old) { await query(`UPDATE prd_sn_bind SET mo_no=$1,model=$2,machine_no=$3,channel=$4,feeder_no=$5,material_sn=$6,stencil_sn=$7,paste_sn=$8,pcb_reel_sn=$9,operator=$10,prod_time=$11,source=$12 WHERE id=$13`, [...vals.slice(1), old.id]); nUpd++; }
      else { await query(`INSERT INTO prd_sn_bind(sn,mo_no,model,machine_no,channel,feeder_no,material_sn,stencil_sn,paste_sn,pcb_reel_sn,operator,prod_time,source,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [...vals, now]); nNew++; }
    }
    return ok(res, { success: true, msg: `✓ 导入完成：新增 ${nNew}，更新 ${nUpd}` });
  });
  router.get("/smt/sn_trace", requireMesrjPerm("prod.trace"), async (req, res) => {
    await smtCore.ensureSchema();
    const sn = String(req.query.sn || "").trim(); if (!sn) return ok(res, { success: false, msg: "请输入 SN" });
    const b = (await query("SELECT * FROM prd_sn_bind WHERE sn=$1", [sn])).rows[0];
    if (!b) return ok(res, { success: false, msg: "SN 未绑定（可从 AOI 下载数据导入反向绑定）" });
    return ok(res, { success: true, bind: b });
  });

  // ── SMT：钢网管控（源 stencil/*：check/online/offline/clean/scrap/list/create）──
  router.post("/smt/stencil/check", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const sn = String(d.sn || "").trim(); const model = String(d.model || "").trim();
    const st = (await query("SELECT * FROM prd_stencil WHERE sn=$1", [sn])).rows[0];
    if (!st) return ok(res, { success: false, msg: `✕ 钢网不存在：${sn}` });
    if (["已报废", "待报废"].includes(st.status)) { const [txt, state] = smtCore.stencilState(st); return ok(res, { success: false, msg: "✕ " + txt, data: { state } }); }
    if (model) { const ms = String(st.models || "").split(",").map(s => s.trim()).filter(Boolean); if (ms.length && !ms.includes(model)) return ok(res, { success: false, msg: `✕ 钢网不适用机型 ${model}（适用：${st.models}）` }); }
    const [txt, state] = smtCore.stencilState(st); const warn = state === "warn_clean" || state === "warn_deep";
    return ok(res, { success: true, msg: (warn ? "⚠ " : "✓ ") + txt, data: { sn, stencil_no: st.stencil_no, state, used: st.used_print_times, max: st.max_print_times, status: st.status, warn } });
  });
  router.post("/smt/stencil/online", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const sn = String(d.sn || "").trim(); const machine = String(d.machine_no || "").trim(); const mo_no = String(d.mo_no || "").trim();
    const op = req.mesrjUser?.login_name || "";
    if (!sn || !machine || !mo_no) return ok(res, { success: false, msg: "钢网SN、印刷机设备码、工单缺一不可" });
    const st = (await query("SELECT * FROM prd_stencil WHERE sn=$1", [sn])).rows[0];
    if (!st) return ok(res, { success: false, msg: "✕ 钢网不存在" });
    if (["已报废", "待报废"].includes(st.status)) { const [txt] = smtCore.stencilState(st); return ok(res, { success: false, msg: "✕ " + txt }); }
    const mo = (await query("SELECT mo_no, product_code FROM ord_mo WHERE mo_no=$1", [mo_no])).rows[0];
    if (!mo) return ok(res, { success: false, msg: `✕ 工单 ${mo_no} 不存在` });
    const p = (await query("SELECT product_model FROM md_product WHERE product_code=$1", [mo.product_code || ""])).rows[0];
    const mm = String(p?.product_model || "").trim();
    const precise = String(st.model || "").trim(); const series = String(st.models || "").trim();
    let note = "";
    if (precise || series) {
      if (mm) {
        if (precise) { if (!smtCore.modelMatch(precise, mm)) return ok(res, { success: false, msg: `✕ 钢网机型不符：这张钢网是「${precise}」用的，工单 ${mo_no} 是「${mm}」` }); }
        else if (!smtCore.modelMatch(series, mm)) return ok(res, { success: false, msg: `✕ 钢网机型不符：这张钢网是「${series}」用的，工单 ${mo_no} 是「${mm}」` });
        else note = `（钢网只维护了系列「${series}」，未核对具体面）`;
      } else note = `（工单 ${mo_no} 未维护机型，本次未核对机型）`;
    } else note = "（该钢网未维护适用机型，本次未核对机型）";
    const now = smtCore.fmtTs();
    let dup = (await query("SELECT * FROM prd_stencil_bind WHERE stencil_sn=$1 AND status='使用中'", [sn])).rows[0];
    if (dup && !String(dup.machine_no || "").trim() && !String(dup.mo_no || "").trim()) { await query("UPDATE prd_stencil_bind SET status='已下线', offline_time=$1 WHERE id=$2", [now, dup.id]); dup = null; }
    if (dup) return ok(res, { success: false, msg: `✕ 该钢网已绑定在 ${dup.machine_no}（工单 ${dup.mo_no}），不能同时上多台机` });
    const dup2 = (await query("SELECT * FROM prd_stencil_bind WHERE machine_no=$1 AND mo_no=$2 AND status='使用中'", [machine, mo_no])).rows[0];
    if (dup2) return ok(res, { success: false, msg: `✕ 该印刷机该工单已绑定钢网 ${dup2.stencil_sn}，不能绑第二套` });
    await query("INSERT INTO prd_stencil_bind(stencil_sn,machine_no,mo_no,line_no,online_time,operator,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'使用中',$7)", [sn, machine, mo_no, "", now, op, now]);
    await query("UPDATE prd_stencil SET status='使用中', updated_at=$1 WHERE sn=$2", [now, sn]);
    const [txt, state] = smtCore.stencilState(st);
    return ok(res, { success: true, msg: `✓ 钢网上线成功：${sn} → ${machine}（工单 ${mo_no}）${state.startsWith("warn") ? "｜" + txt : ""}${note}` });
  });
  router.post("/smt/stencil/offline", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const sn = String(d.sn || "").trim(); const machine = String(d.machine_no || "").trim(); const now = smtCore.fmtTs();
    const b = (await query("SELECT * FROM prd_stencil_bind WHERE stencil_sn=$1 AND status='使用中'", [sn])).rows[0];
    if (!b) return ok(res, { success: false, msg: "该钢网当前没有在线绑定" });
    if (machine && b.machine_no !== machine) return ok(res, { success: false, msg: `该钢网绑定在 ${b.machine_no}，与扫的设备 ${machine} 不符` });
    await query("UPDATE prd_stencil_bind SET status='已下线', offline_time=$1 WHERE id=$2", [now, b.id]);
    await query("UPDATE prd_stencil SET status='正常', updated_at=$1 WHERE sn=$2", [now, sn]);
    return ok(res, { success: true, msg: `✓ 钢网已下线：${sn}（本轮印刷 ${b.used_in_round} 次）` });
  });
  router.post("/smt/stencil/clean", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const sn = String(d.sn || "").trim(); const ctype = String(d.clean_type || "简易").trim(); const method = String(d.clean_method || "").trim();
    const op = req.mesrjUser?.login_name || "";
    const st = (await query("SELECT * FROM prd_stencil WHERE sn=$1", [sn])).rows[0];
    if (!st) return ok(res, { success: false, msg: "钢网不存在" });
    const b = (await query("SELECT * FROM prd_stencil_bind WHERE stencil_sn=$1 AND status='使用中'", [sn])).rows[0];
    const now = smtCore.fmtTs();
    await query("INSERT INTO prd_stencil_clean(stencil_sn,bind_id,clean_type,clean_method,clean_time,operator,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [sn, b ? b.id : 0, ctype, method, now, op, now]);
    if (b) await query("UPDATE prd_stencil_bind SET clean_in_round=0 WHERE id=$1", [b.id]);
    await query("UPDATE prd_stencil SET clean_count=clean_count+1, updated_at=$1 WHERE sn=$2", [now, sn]);
    return ok(res, { success: true, msg: `✓ ${ctype}清洗已登记（${method || "-"}，操作员 ${op}），本次上线清洗计数已清零（总寿命 ${st.used_print_times} 次不变）` });
  });
  router.post("/smt/stencil/scrap", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const sn = String(d.sn || "").trim(); const reason = String(d.reason || "").trim(); const op = req.mesrjUser?.login_name || "";
    const st = (await query("SELECT * FROM prd_stencil WHERE sn=$1", [sn])).rows[0];
    if (!st) return ok(res, { success: false, msg: "钢网不存在" });
    const now = smtCore.fmtTs();
    await query("UPDATE prd_stencil SET status='已报废', scrap_reason=$1, scrap_by=$2, scrap_at=$3, updated_at=$4 WHERE sn=$5", [reason || "未填写", op, now, now, sn]);
    await query("UPDATE prd_stencil_bind SET status='已报废' WHERE stencil_sn=$1 AND status='使用中'", [sn]);
    return ok(res, { success: true, msg: `✓ 钢网 ${sn} 已报废（${reason || "未填写"}），永久锁死` });
  });
  router.get("/smt/stencil/list", requireMesrjPerm("prod.trace"), async (_req, res) => {
    await smtCore.ensureSchema();
    const rows = (await query("SELECT * FROM prd_stencil ORDER BY id DESC LIMIT 200")).rows;
    const out = rows.map(r => { const [txt, state] = smtCore.stencilState(r); return { ...r, state_text: txt, state }; });
    return ok(res, { rows: out, total: out.length });
  });
  router.post("/smt/stencil/create", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const sn = String(d.sn || "").trim();
    if (!sn) return ok(res, { success: false, msg: "钢网唯一SN必填" });
    if ((await query("SELECT id FROM prd_stencil WHERE sn=$1", [sn])).rows[0]) return ok(res, { success: false, msg: `钢网 ${sn} 已存在` });
    const now = smtCore.fmtTs();
    await query(`INSERT INTO prd_stencil(sn,stencil_no,version,thickness,models,model,gerber_version,max_print_times,clean_warn_times,deep_clean_times,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'正常',$11,$12)`,
      [sn, d.stencil_no || "", d.version || "", d.thickness || "", d.models || "", d.model || "", d.gerber_version || "", Math.trunc(Number(d.max_print_times || 100000)), Math.trunc(Number(d.clean_warn_times || 20000)), Math.trunc(Number(d.deep_clean_times || 60000)), now, now]);
    return ok(res, { success: true, msg: `✓ 钢网 ${sn} 已建档` });
  });

  // ── SMT：PCB 整盘拆封/烘烤/时效（源 pcb/*）──
  router.post("/smt/pcb/unseal", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema(); await smtCore.loadParams();
    const sn = String(d.reel_sn || "").trim(); const op = req.mesrjUser?.login_name || "";
    if (!sn) return ok(res, { success: false, msg: "请扫 PCB 盘唯一 SN" });
    const row = (await query("SELECT * FROM prd_pcb_reel WHERE reel_sn=$1", [sn])).rows[0];
    const now = smtCore.fmtTs(); const hours = Number(smtCore.smtParam("smt.pcb_unseal_hours", "168") || 168);
    if (row) {
      if (row.status === "已报废") return ok(res, { success: false, msg: "✕ 该 PCB 盘已报废" });
      if (row.status === "待拆封") { await query("UPDATE prd_pcb_reel SET status='已拆封', unseal_time=$1, valid_hours=$2, updated_at=$3 WHERE id=$4", [now, hours, now, row.id]); return ok(res, { success: true, msg: `✓ 已拆封：${sn}（时效 ${hours} 小时，超时需烘烤）` }); }
      return ok(res, { success: false, msg: `该 PCB 盘已拆封（当前：${smtCore.pcbState(row)[0]}），不能重复拆封` });
    }
    await query(`INSERT INTO prd_pcb_reel(reel_sn,rj_code,lot_no,dc_code,qty,unseal_time,valid_hours,status,operator,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'已拆封',$8,$9,$10)`,
      [sn, d.rj_code || "", d.lot_no || "", d.dc_code || "", Math.trunc(Number(d.qty || 0)), now, hours, op, now, now]);
    return ok(res, { success: true, msg: `✓ 已拆封：${sn}（时效 ${hours} 小时，超时需烘烤）` });
  });
  router.post("/smt/pcb/bake", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema(); await smtCore.loadParams();
    const sn = String(d.reel_sn || "").trim(); const op = req.mesrjUser?.login_name || "";
    const row = (await query("SELECT * FROM prd_pcb_reel WHERE reel_sn=$1", [sn])).rows[0];
    if (!row) return ok(res, { success: false, msg: "PCB 盘不存在，请先拆封登记" });
    const now = smtCore.now(); const hours = Number(smtCore.smtParam("smt.pcb_bake_hours", "72") || 72); const valid = smtCore.addHours(now, hours);
    await query(`UPDATE prd_pcb_reel SET status='已烘烤', bake_count=bake_count+1, last_bake_time=$1, last_valid_until=$2, operator=$3, updated_at=$4 WHERE id=$5`,
      [smtCore.fmtTs(now), smtCore.fmtTs(valid), op, smtCore.fmtTs(now), row.id]);
    return ok(res, { success: true, msg: `✓ 烘烤完成：${sn}（温度 ${d.temp || "-"}，时长 ${d.duration || "-"}，操作员 ${op}）→ 时效重置 ${hours} 小时（${smtCore.fmtTs(valid).slice(5, 16)} 前上线）` });
  });
  router.post("/smt/pcb/check", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const sn = String(d.reel_sn || "").trim();
    const row = (await query("SELECT * FROM prd_pcb_reel WHERE reel_sn=$1", [sn])).rows[0];
    if (!row) return ok(res, { success: false, msg: "✕ PCB 盘未登记（请先仓库拆封扫码）" });
    const [txt, state] = smtCore.pcbState(row); const okState = state === "ok" || state === "idle";
    if (state === "expired") return ok(res, { success: false, msg: txt, data: { state } });
    return ok(res, { success: okState, msg: (okState ? "✓ " : "✕ ") + txt, data: { state } });
  });
  router.get("/smt/pcb/list", requireMesrjPerm("prod.trace"), async (_req, res) => {
    await smtCore.ensureSchema();
    const rows = (await query("SELECT * FROM prd_pcb_reel ORDER BY id DESC LIMIT 200")).rows;
    const out = rows.map(r => { const [txt, state] = smtCore.pcbState(r); return { ...r, state_text: txt, state }; });
    return ok(res, { rows: out, total: out.length });
  });

  // ── SMT：锡膏/红胶 回温管控（源 paste/*）──
  router.post("/smt/paste/out", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema(); await smtCore.loadParams();
    const code = String(d.material_code || "").trim(); const batch = String(d.batch_no || "").trim(); const qty = d.qty || 1;
    const op = req.mesrjUser?.login_name || "";
    if (!code || !batch) return ok(res, { success: false, msg: "请先扫物料条码和批号" });
    const [mat, ptype] = await smtCore.pasteMaterial(code);
    const old = (await query("SELECT * FROM prd_paste_recover WHERE material_code=$1 AND batch_no=$2 AND status IN ('回温中','已回温','使用中')", [code, batch])).rows[0];
    if (old) { const [txt] = smtCore.pasteStateText(old); return ok(res, { success: false, msg: `该批号已登记（${txt}），不要重复出库` }); }
    const [mn] = smtCore.pasteLimits(ptype); const now = smtCore.now(); const ready = smtCore.addHours(now, mn);
    await query(`INSERT INTO prd_paste_recover(material_code,vn_code,material_name,paste_type,batch_no,qty,out_time,plan_ready_time,recover_count,status,operator,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'回温中',$9,$10,$11)`,
      [code, mat.vn_code || "", String(mat.material_name || "").slice(0, 60), ptype, batch, Number(qty || 1), smtCore.fmtTs(now), smtCore.fmtTs(ready), op, smtCore.fmtTs(now), smtCore.fmtTs(now)]);
    return ok(res, { success: true, msg: `✓ 已登记回温：${code}（${ptype} ${batch}），回温 ${Math.round(mn)} 小时，预计 ${smtCore.fmtTs(ready).slice(11, 16)} 可用` });
  });
  router.post("/smt/paste/check", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema(); await smtCore.loadParams();
    const row = await smtCore.pasteRow(d);
    if (!row) return ok(res, { success: false, msg: "✕ 未登记！请先扫码出库回温" });
    const [txt, state] = smtCore.pasteCheckDyn(row); const data = { status: row.status, state, paste_type: row.paste_type, batch_no: row.batch_no };
    if (state === "expired" || state === "ing") return ok(res, { success: false, msg: "✕ " + txt, data });
    if (state === "ready") { const now = smtCore.fmtTs(); if (row.status === "回温中") await query("UPDATE prd_paste_recover SET status='已回温' WHERE id=$1", [row.id]); if (!row.ready_time) await query("UPDATE prd_paste_recover SET ready_time=$1, updated_at=$2 WHERE id=$3", [now, now, row.id]); return ok(res, { success: true, msg: "✓ " + txt, data: { ...data, id: row.id } }); }
    const isOk = state === "using" || state === "released"; return ok(res, { success: isOk, msg: (isOk ? "✓ " : "✕ ") + txt, data: { ...data, id: row.id } });
  });
  router.post("/smt/paste/open", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema(); await smtCore.loadParams();
    const row = await smtCore.pasteRow(d); if (!row) return ok(res, { success: false, msg: "未找到记录" });
    const [txt, state] = smtCore.pasteCheckDyn(row); if (state !== "ready") return ok(res, { success: false, msg: `当前状态：${txt}，不能开封` });
    const hours = smtCore.pasteLimits(row.paste_type)[2]; const now = smtCore.now(); const exp = smtCore.addHours(now, hours);
    await query("UPDATE prd_paste_recover SET open_time=$1, expire_time=$2, status='使用中', updated_at=$3 WHERE id=$4", [smtCore.fmtTs(now), smtCore.fmtTs(exp), smtCore.fmtTs(now), row.id]);
    return ok(res, { success: true, msg: `✓ 已开封，请于 ${smtCore.fmtTs(exp).slice(5, 16)} 前用完（${Math.round(hours)} 小时有效）` });
  });
  router.post("/smt/paste/return", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema(); await smtCore.loadParams();
    const row = await smtCore.pasteRow(d); if (!row) return ok(res, { success: false, msg: "未找到记录" });
    if (String(row.paste_type || "").trim() === "红胶") return ok(res, { success: false, msg: "✕ 红胶不支持回收复用，请直接报废处理" });
    if (row.status !== "已回温") { const [txt] = smtCore.pasteCheckDyn(row); return ok(res, { success: false, msg: `只有「未开封、已回温」的物料才能放回冷藏（当前：${txt}）` }); }
    const maxTimes = Number(smtCore.smtParam("smt.max_recover", "2") || 2);
    if (Number(row.recover_count || 1) >= maxTimes) { const now = smtCore.fmtTs(); await query("UPDATE prd_paste_recover SET status='已报废', remark='回温超次报废', updated_at=$1 WHERE id=$2", [now, row.id]); return ok(res, { success: false, msg: `✕ 已回温 ${row.recover_count} 次（上限 ${maxTimes} 次），报废处理` }); }
    const now = smtCore.fmtTs();
    await query("UPDATE prd_paste_recover SET return_time=$1, recover_count=recover_count+1, status='已退回', updated_at=$2 WHERE id=$3", [now, now, row.id]);
    return ok(res, { success: true, msg: `✓ 已放回冷藏（第 ${Number(row.recover_count || 1) + 1} 次回温）` });
  });
  router.post("/smt/paste/done", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const row = await smtCore.pasteRow(d); if (!row) return ok(res, { success: false, msg: "未找到记录" });
    if (!["使用中", "已回温"].includes(row.status)) return ok(res, { success: false, msg: "当前状态不允许此操作" });
    await query("UPDATE prd_paste_recover SET status='已用完', updated_at=$1 WHERE id=$2", [smtCore.fmtTs(), row.id]);
    return ok(res, { success: true, msg: "✓ 已标记用完" });
  });
  router.get("/smt/paste/list", requireMesrjPerm("prod.trace"), async (req, res) => {
    await smtCore.ensureSchema(); await smtCore.loadParams();
    const fStatus = String(req.query.f_status || "").trim();
    const rows = fStatus ? (await query("SELECT * FROM prd_paste_recover WHERE status=$1 ORDER BY id DESC LIMIT 200", [fStatus])).rows : (await query("SELECT * FROM prd_paste_recover ORDER BY id DESC LIMIT 200")).rows;
    const out = rows.map(r => { const [txt, state] = smtCore.pasteCheckDyn(r); return { ...r, state_text: txt, state }; });
    return ok(res, { rows: out, total: out.length });
  });
  router.post("/smt/paste/stir", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema(); await smtCore.loadParams();
    const row = d.id ? (await query("SELECT * FROM prd_paste_recover WHERE id=$1", [d.id])).rows[0] : null;
    if (!row) return ok(res, { success: false, msg: "未找到记录（请先扫码）" });
    const s1 = String(d.stir_start || "").trim(); const s2 = String(d.stir_end || "").trim();
    if (!s1 || !s2) return ok(res, { success: false, msg: "请录入搅拌起止时间" });
    const t1 = new Date(s1.slice(0, 16).replace(" ", "T")); const t2 = new Date(s2.slice(0, 16).replace(" ", "T"));
    if (isNaN(t1.getTime()) || isNaN(t2.getTime())) return ok(res, { success: false, msg: "时间格式应为 YYYY-MM-DD HH:MM" });
    const minutes = Math.floor((t2.getTime() - t1.getTime()) / 60000);
    const mn = Number(smtCore.smtParam("smt.stir_minutes", "3") || 3);
    if (minutes < mn) return ok(res, { success: false, msg: `✕ 搅拌时长不足（${minutes} 分钟 < ${mn} 分钟），继续搅拌` });
    const now = smtCore.fmtTs();
    await query("UPDATE prd_paste_recover SET stir_start=$1, stir_end=$2, status='已搅拌', updated_at=$3 WHERE id=$4", [s1, s2, now, row.id]);
    return ok(res, { success: true, msg: `✓ 搅拌达标（${minutes} 分钟），状态已更新为【已搅拌】，可开封使用` });
  });
  router.post("/smt/paste/release", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {}; await smtCore.ensureSchema();
    const op = req.mesrjUser?.login_name || ""; const reason = String(d.reason || "").trim();
    const row = d.id ? (await query("SELECT * FROM prd_paste_recover WHERE id=$1", [d.id])).rows[0] : null;
    if (!row) return ok(res, { success: false, msg: "未找到记录" });
    const now = smtCore.fmtTs();
    await query("UPDATE prd_paste_recover SET release_time=$1, release_by=$2, release_reason=$3, updated_at=$4 WHERE id=$5", [now, op, reason || "回温超时放行", now, row.id]);
    return ok(res, { success: true, msg: `✓ 已放行（${op}，${reason || "回温超时放行"}），可继续使用` });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // W14 OQC 出货抽检路由（源 api/oqc.py 27 路由，side-by-side 移植）
  // ════════════════════════════════════════════════════════════════════════════

  // ── OQC：初始化运行时表 ──
  router.post("/oqc/init", requireMesrjPerm("md.edit"), async (_req, res) => {
    await oqcCore.ensureSchema();
    await oqcCore.ensureCheckSchema();
    return ok(res, null, "OQC 运行时表已初始化");
  });

  // ── OQC：开抽检单 ──
  router.post("/oqc/open_order", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [order, err] = await oqcCore.openOrder(d.pallet_no || "", req.mesrjUser?.login_name || "", d.force_new === true);
    if (err) return fail(res, err);
    return ok(res, order, "开抽检单成功");
  });

  // ── OQC：录箱结果 ──
  router.post("/oqc/check_box", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [order, err] = await oqcCore.checkBox(
      d.oqc_no || "", d.box_no || "", d.result || "", d.defect_code || "", d.defect_desc || "",
      Number(d.sample_qty || 0), req.mesrjUser?.login_name || "", d.remark || "");
    if (err) return fail(res, err);
    return ok(res, order, "箱结果已记录");
  });

  // ── OQC：判定 ──
  router.post("/oqc/judge", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [order, err] = await oqcCore.judge(d.oqc_no || "", req.mesrjUser?.login_name || "");
    if (err) return fail(res, err);
    return ok(res, order, "判定完成");
  });

  // ── OQC：返工完成 ──
  router.post("/oqc/rework_done", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [result, err] = await oqcCore.reworkDone(d.oqc_no || "", req.mesrjUser?.login_name || "", d.remark || "");
    if (err) return fail(res, err);
    return ok(res, result, "返工完成");
  });

  // ── OQC：刷新 PO 放行状态 ──
  router.post("/oqc/refresh_po", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const result = await oqcCore.refreshPo(d.po_no || "");
    return ok(res, result, "PO 放行状态已刷新");
  });

  // ── OQC：入库前置条件 ──
  router.get("/oqc/can_stock_in", requireMesrjPerm("prod.trace"), async (req, res) => {
    const [can, why] = await oqcCore.canStockIn(req.query.pallet_no || "");
    return ok(res, { can_stock_in: can, reason: why });
  });

  // ── OQC：成品入库 ──
  router.post("/oqc/stock_in", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [result, err] = await oqcCore.stockIn(d.pallet_no || "", req.mesrjUser?.login_name || "");
    if (err) return fail(res, err);
    return ok(res, result, "成品入库完成");
  });

  // ── OQC：PO 欠数账 ──
  router.get("/oqc/po_gap", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.poGap(req.query.po_no || "", req.query.with_pallets === "true");
    return ok(res, result);
  });

  // ── OQC：PO 欠数一览 ──
  router.get("/oqc/po_gap_list", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.poGapList(Number(req.query.limit || 200));
    return ok(res, result);
  });

  // ── OQC：PO 出货前置条件 ──
  router.get("/oqc/can_ship", requireMesrjPerm("prod.trace"), async (req, res) => {
    const [can, why] = await oqcCore.canShip(req.query.po_no || "");
    return ok(res, { can_ship: can, reason: why });
  });

  // ── OQC：PO 汇总 ──
  router.get("/oqc/po_summary", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.poSummary(req.query.po_no || "");
    return ok(res, result);
  });

  // ── OQC：待检池 ──
  router.get("/oqc/pending_queue", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.pendingQueue(req.query.status || "");
    return ok(res, result);
  });

  // ── OQC：不良在制 ──
  router.get("/oqc/ng_in_progress", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.ngInProgress(Number(req.query.limit || 30));
    return ok(res, result);
  });

  // ── OQC：趋势 ──
  router.get("/oqc/trend", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.trend(Number(req.query.days || 14));
    return ok(res, result);
  });

  // ── OQC：可出货 PO 列表 ──
  router.get("/oqc/po_ready_list", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.poReadyList(Number(req.query.limit || 10));
    return ok(res, result);
  });

  // ── OQC：工位统计 ──
  router.get("/oqc/station_stats", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.stationStats(req.query.date_from || "", req.query.date_to || "");
    return ok(res, result);
  });

  // ── OQC：看板 ──
  router.get("/oqc/board", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.board(Number(req.query.days || 14));
    return ok(res, result);
  });

  // ── OQC：AQL 读取/设置 ──
  router.get("/oqc/aql/std", requireMesrjPerm("prod.trace"), async (_req, res) => {
    return ok(res, await oqcCore.getStd());
  });
  router.post("/oqc/aql/std", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const result = await oqcCore.setStd(d, req.mesrjUser?.login_name || "");
    return ok(res, result, "AQL 标准已更新");
  });

  // ── OQC：AQL 预览 ──
  router.get("/oqc/aql/preview", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.aqlPreview(Number(req.query.lot || 0), req.query.level || "II", req.query.severity || "normal");
    return ok(res, result);
  });

  // ── OQC：AQL 方案套用 ──
  router.post("/oqc/aql/apply_plan", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [result, err] = await oqcCore.applyPlan(d.oqc_no || "", req.mesrjUser?.login_name || "");
    if (err) return fail(res, err);
    return ok(res, result, "AQL 方案已套用");
  });

  // ── OQC：AQL 判定 ──
  router.post("/oqc/aql/judge", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [result, err] = await oqcCore.aqlJudge(d.oqc_no || "", req.mesrjUser?.login_name || "");
    if (err) return fail(res, err);
    return ok(res, result, "AQL 判定完成");
  });

  // ── OQC：评审决策 ──
  router.post("/oqc/review", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [result, err] = await oqcCore.oqcReview(d.oqc_no || "", d.decision || "", d.reason || "",
      req.mesrjUser?.login_name || "", d.defect_json || "", d.remark || "");
    if (err) return fail(res, err);
    return ok(res, result, "评审决策已记录");
  });

  // ── OQC：返工扫码 ──
  router.post("/oqc/scan", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const [result, err] = await oqcCore.oqcScan(d.oqc_no || "", d.sn || "", d.belong || 0, d.result || "", d.reason || "", req.mesrjUser?.login_name || "");
    if (err) return fail(res, err);
    return ok(res, result, "返工扫码已记录");
  });

  // ── OQC：返工扫码记录 ──
  router.get("/oqc/scans_of", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.scansOf(req.query.oqc_no || "");
    return ok(res, result);
  });

  // ── OQC：评审记录列表 ──
  router.get("/oqc/review_list", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.reviewList(Number(req.query.limit || 50));
    return ok(res, result);
  });

  // ── OQC：逐项检验列表 ──
  router.get("/oqc/check/items", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.listItems(req.query.po_no || "", req.query.model || "");
    return ok(res, result);
  });

  // ── OQC：保存逐项检验 ──
  router.post("/oqc/check/save", requireMesrjPerm("md.edit"), async (req, res) => {
    const d = req.body || {};
    const result = await oqcCore.saveCheckItems(d.po_no || "", d.items || [], req.mesrjUser?.login_name || "");
    return ok(res, result, "逐项检验已保存");
  });

  // ── OQC：检验上下文 ──
  router.get("/oqc/check/ctx", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.checkCtx(req.query.po_no || "", req.query.model || "");
    return ok(res, result);
  });

  // ── OQC：检验汇总 ──
  router.get("/oqc/check/summary", requireMesrjPerm("prod.trace"), async (req, res) => {
    const result = await oqcCore.checkSummary(req.query.po_no || "");
    return ok(res, result);
  });

  // ── OQC：逐项检验默认配置 ──
  router.get("/oqc/check/defaults", requireMesrjPerm("prod.trace"), async (_req, res) => {
    return ok(res, { defaults: oqcCore.OQC_CHECK_DEFAULTS, cats: oqcCore.OQC_CHECK_CATS });
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

  // W5：route / cfg 通用 CRUD（固定路径已在前面的主 router 上，挂载在后不冲突）
  const routeCrud = Router();
  registerCrud(routeCrud, ROUTE_RES, "route.view", "route.edit");
  router.use("/route", routeCrud);

  const cfgCrud = Router();
  registerCrud(cfgCrud, CFG_RES, "cfg.view", "cfg.edit");
  router.use("/cfg", cfgCrud);

  // W9：emp 通用 CRUD（源 _crud.register(prefix="/emp")；固定自定义接口已在上面注册）
  const empCrud = Router();
  registerCrud(empCrud, EMP_RES, "prod.trace", "md.edit");
  router.use("/emp", empCrud);

  return router;
}

export { ok, fail, getParam, setParam, audit, hashPwd, verifyPwd, currentUser, hasPerm, requireMesrjPerm, tableColumns, Res, cleanRow, safeOrder, cleanPageArgs, paged, registerCrud, MD_RES, SYS_RES, BOM_RES, ORD_RES, PLAN_RES, ROUTE_RES, CFG_RES, EMP_RES };
