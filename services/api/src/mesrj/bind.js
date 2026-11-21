/**
 * 绑码 / 解码（SN 绑定关系）—— 移植自源 api/bind.py（MES-ruijing）
 *
 * 现场工位 CODETRANSFER：SN OLD（旧码）→ SN NEW（新码）一进一出。
 * 配置在 cfg_bind_station（工位 + 关系类型 + 两端标签）与 cfg_bind_rule（位数/前缀/正则/建档策略）。
 * 关系落 prd_sn_rel（parent=旧码，child=新码），只做逻辑失效，永不物理删除。
 */
import { query, getParam } from "../db.js";
import {
  guard_untested, guard_open_ng, guard_missing_steps, doPassInner,
} from "./domain.js";

export const DEFAULT_STATIONS = [
  {
    station_code: "ASSY-L01-LINK", rel_type: "PCBA_Link", station_name: "绑码 PCBA_Link",
    old_label: "PCB 镭雕码", old_hint: "PCB 板上的激光码", old_sn_type: "PCBA",
    new_label: "底壳镭雕码", new_hint: "底壳上刻的码", new_sn_type: "外壳",
    auto_pass: 1, enabled: 1, sort_no: 10,
  },
  {
    station_code: "PACK-L01-CODE-LINK", rel_type: "CODE-LINK", station_name: "绑码 CODE-LINK",
    old_label: "底壳镭雕码", new_hint: "成品铭牌上的 SN", old_hint: "底壳上刻的码",
    old_sn_type: "外壳", new_label: "铭牌成品码", new_sn_type: "铭牌",
    auto_pass: 1, enabled: 1, sort_no: 20,
  },
];

let _ensured = false;

/** 解码所需列/表（源 _ensure_decode，幂等；迁移 311 已建时这里只兜底） */
export async function ensureSchema() {
  if (_ensured) return;
  await query(`ALTER TABLE prd_sn_rel ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT ''`);
  await query(`ALTER TABLE prd_sn_rel ADD COLUMN IF NOT EXISTS void_at TIMESTAMPTZ`);
  await query(`ALTER TABLE prd_sn_rel ADD COLUMN IF NOT EXISTS void_by TEXT NOT NULL DEFAULT ''`);
  await query(`CREATE TABLE IF NOT EXISTS mesrj_decode_log (
    id BIGSERIAL PRIMARY KEY, action TEXT NOT NULL DEFAULT '', sn TEXT NOT NULL DEFAULT '',
    rel_id INTEGER NOT NULL DEFAULT 0, parent_sn TEXT NOT NULL DEFAULT '',
    child_sn TEXT NOT NULL DEFAULT '', rel_type TEXT NOT NULL DEFAULT '',
    void_sn TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '', operator TEXT NOT NULL DEFAULT '',
    station TEXT NOT NULL DEFAULT '', mo_no TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await query(`CREATE INDEX IF NOT EXISTS mesrj_ix_decode_log_sn ON mesrj_decode_log(sn, created_at)`);
  _ensured = true;
}

/** 绑码工位清单（表优先，缺省用内置） */
export async function stations(enabledOnly = true) {
  let rows = [];
  try {
    rows = (await query(
      `SELECT * FROM cfg_bind_station ${enabledOnly ? "WHERE enabled=1" : ""} ORDER BY sort_no, id`)).rows;
  } catch { rows = []; }
  if (rows.length) return rows;
  return DEFAULT_STATIONS.filter(s => !enabledOnly || Number(s.enabled) === 1);
}

export async function station(code) {
  const list = await stations(false);
  return list.find(s => s.station_code === code) || null;
}

/** role: 'old' | 'new'；表里没配就用工位标签兜底 */
export async function ruleFor(stationCode, role) {
  const st = (await station(stationCode)) || {};
  const row = (await query(
    `SELECT * FROM cfg_bind_rule WHERE station_code=$1 AND role=$2 AND enabled=1
      ORDER BY id DESC LIMIT 1`, [stationCode, role])).rows[0];
  const fallback = {
    station_code: stationCode, role,
    sn_type: st[role === "old" ? "old_sn_type" : "new_sn_type"] || "",
    label: st[role === "old" ? "old_label" : "new_label"] || "",
    hint: st[role === "old" ? "old_hint" : "new_hint"] || "",
    check_len: 0, prefix: "", regex: "", require_exist: 1, auto_create: 0, enabled: 1,
  };
  if (!row) return fallback;
  return {
    ...row,
    label: row.label || fallback.label,
    sn_type: row.sn_type || fallback.sn_type,
    hint: row.hint || fallback.hint,
  };
}

/** 码格式校验：位数 / 前缀 / 正则 */
export function checkCode(rule, code) {
  const c = String(code || "").trim();
  if (!c) return [false, "码不能为空"];
  const n = Number(rule?.check_len || 0);
  if (n > 0 && c.length !== n) return [false, `位数不符：要求 ${n} 位，实扫 ${c.length} 位`];
  const pre = String(rule?.prefix || "").trim();
  if (pre && !c.toUpperCase().startsWith(pre.toUpperCase())) {
    return [false, `前缀不符：要求以「${pre}」开头`];
  }
  const rx = String(rule?.regex || "").trim();
  if (rx) {
    try {
      if (!new RegExp(rx).test(c)) return [false, `格式不符：不匹配规则「${rx}」`];
    } catch {
      return [false, `绑码规则正则写错了：${rx}`];
    }
  }
  return [true, ""];
}

const snRow = async (code) =>
  (await query("SELECT * FROM prd_sn WHERE sn=$1", [code])).rows[0];

async function activeRel(code, relType) {
  return (await query(
    `SELECT * FROM prd_sn_rel WHERE rel_type=$1 AND is_active=1
      AND (parent_sn=$2 OR child_sn=$2) ORDER BY id DESC LIMIT 1`, [relType, code])).rows[0];
}

async function stationShort(code) {
  const st = (await query(
    "SELECT short_name, station_name FROM md_station WHERE station_code=$1", [code])).rows[0];
  return st?.short_name || st?.station_name || code;
}

/** 铭牌有效期检查（阈值 NAMEPLATE_MONTHS；action=拦截 才真拦） */
export async function nameplateAgeCheck(snIn) {
  const sn = String(snIn || "").trim().toUpperCase();
  if (sn.length !== 14 || !sn.startsWith("NV")) return [true, "", {}];
  const yy = Number(sn.slice(5, 7));
  const ww = Number(sn.slice(7, 9));
  if (!(ww >= 1 && ww <= 53)) return [true, "", {}];
  // ISO 周 → 该周周一
  const jan4 = new Date(Date.UTC(2000 + yy, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000
    + (ww - 1) * 7 * 86400000);
  if (!Number.isFinite(monday.getTime())) return [true, "", {}];
  const th = (await query(
    "SELECT * FROM cfg_threshold WHERE th_key='NAMEPLATE_MONTHS' AND enabled=1 LIMIT 1")).rows[0];
  if (!th) return [true, "", {}];
  const limit = Number(th.th_value || 0);
  const now = new Date();
  const age = (now.getUTCFullYear() - monday.getUTCFullYear()) * 12
    + (now.getUTCMonth() - monday.getUTCMonth());
  const info = {
    prod_year: 2000 + yy, prod_week: ww,
    prod_date: monday.toISOString().slice(0, 10), age_months: age, limit,
  };
  if (age <= limit) return [true, "", info];
  const msg = `铭牌超期：该 SN 生产于 ${2000 + yy} 年第 ${ww} 周（${info.prod_date}），`
    + `距今已 ${age} 个月，超过管控周期 ${limit} 个月`;
  return [th.action !== "拦截", msg, info];
}


/** SN 是否属于「新码」一侧（命中新码规则、且不命中旧码规则） */
export async function isNewSide(stationCode, roleOld, roleNew, code) {
  const [okNew] = checkCode(roleNew, code);
  const [okOld] = checkCode(roleOld, code);
  return Boolean(okNew && !okOld);
}

/** 扫完第一个码立刻校验（源 bind_precheck） */
export async function precheck(d) {
  const sn = String(d.sn || "").trim();
  const stationCode = String(d.station_code || "").trim();
  if (!sn) return { state: "EMPTY", accepted: false, msg: "请扫条码", sn: "" };
  await ensureSchema();
  const st = (await station(stationCode)) || {};
  const relType = st.rel_type || "PCBA_Link";
  const ro = await ruleFor(stationCode, "old");
  const rn = await ruleFor(stationCode, "new");
  const row = await snRow(sn);
  if (!row) {
    if (await isNewSide(stationCode, ro, rn, sn)) {
      return { state: "NEW", accepted: true, sn, msg: `新码 · ${rn.label || "新码"}，绑定时自动建档` };
    }
    if (String(await getParam("bind.require_tested", "1")) !== "0" && String(await getParam("bind.require_tested", "1")) !== "false") {
      const need = await getParam("bind.require_stations", "ICT,FCT");
      const un = await guard_untested(sn, need);
      if (un.length) {
        return { state: "UNTESTED", accepted: false, sn, msg: `新码未建档，且未过 ${un.join("/")} · 请先测试再绑` };
      }
    }
    return { state: "NEW", accepted: true, sn, msg: "新码 · 未建档（绑定时自动建档）" };
  }
  const old = await activeRel(sn, relType);
  if (old) {
    const other = old.parent_sn === sn ? old.child_sn : old.parent_sn;
    return { state: "BOUND", accepted: false, sn, msg: `已绑过 ${other}（${old.station || ""}）` };
  }
  if (["报废", "已报废"].includes(row.status)) {
    return { state: "SCRAP", accepted: false, sn, msg: "已报废 · 不能绑码" };
  }
  if (row.status === "待修") {
    return { state: "REPAIR", accepted: false, sn, msg: "待修中 · 请先修好" };
  }
  const wholeMachine = await isNewSide(stationCode, ro, rn, sn) || ["铭牌", "外壳"].includes(row.sn_type);
  if (String(await getParam("bind.require_tested", "1")) !== "0" && String(await getParam("bind.require_tested", "1")) !== "false" && !wholeMachine) {
    const need = await getParam("bind.require_stations", "ICT,FCT");
    const un = await guard_untested(sn, need);
    if (un.length) return { state: "UNTESTED", accepted: false, sn, msg: `未过 ${un.join("/")} · 请先测试` };
  }
  if (String(await getParam("bind.check_ng", "1")) !== "0" && String(await getParam("bind.check_ng", "1")) !== "false") {
    const ng = await guard_open_ng(sn);
    if (ng) return { state: "NG", accepted: false, sn, msg: `${ng} NG 未处理 · 请先送维修` };
  }
  if (String(await getParam("bind.check_route", "1")) !== "0" && String(await getParam("bind.check_route", "1")) !== "false") {
    const hasPass = (await query("SELECT 1 FROM prd_pass WHERE sn=$1 LIMIT 1", [sn])).rows.length > 0;
    if (!wholeMachine && hasPass) {
      const miss = await guard_missing_steps(sn, stationCode);
      if (miss.length) {
        const names = miss.slice(0, 3).map(m => String(m[1] || m[0]).split(" - ")[0]).join("、");
        return { state: "ROUTE", accepted: false, sn, msg: `前置未完成 · 先做 ${names}${miss.length > 3 ? "…" : ""}` };
      }
    }
  }
  return { state: "OK", accepted: true, sn, msg: "OK · 可以绑码" };
}

/** 未建档码自动建档（源 _create_sn） */
export async function createSn(sn, snType, moNo) {
  const mo = (await query("SELECT * FROM ord_mo WHERE mo_no=$1", [moNo])).rows[0];
  if (!mo) return null;
  await query(
    `INSERT INTO prd_sn (sn, sn_type, product_code, mo_no, line_code, cur_station,
      cur_seq, status, repair_times) VALUES ($1,$2,$3,$4,'','',0,'在制',0)`,
    [sn, snType || "", mo.product_code || "", moNo]);
  return snRow(sn);
}

export const DECODE_REASONS = ["外观不良", "功能不良", "客户改单", "标签破损", "拆壳换壳", "其他"];

/** 标签绑定类关系类型（拼版拆分 PANEL_SPLIT 不算） */
async function bindRelTypes() {
  const rows = (await query(
    "SELECT DISTINCT rel_type FROM cfg_bind_station WHERE rel_type<>''")).rows;
  const types = new Set(rows.map(r => r.rel_type));
  return types.size ? types : new Set(["PCBA_Link", "CODE-LINK"]);
}

/** 一颗码的整个绑定组（BFS 只走绑定类关系） */
async function groupOf(code, relTypes) {
  const types = Array.from(relTypes || await bindRelTypes());
  const rels = {};
  const seen = new Set([code]);
  const queue = [code];
  while (queue.length) {
    const cur = queue.shift();
    const rows = (await query(
      `SELECT * FROM prd_sn_rel WHERE (parent_sn=$1 OR child_sn=$2)
        AND is_active=1 AND rel_type = ANY($3)`, [cur, cur, types])).rows;
    for (const r of rows) {
      rels[r.id] = r;
      for (const nxt of [r.parent_sn, r.child_sn]) {
        if (nxt && !seen.has(nxt)) { seen.add(nxt); queue.push(nxt); }
      }
    }
  }
  return [seen, Object.values(rels)];
}

const blocked = (rule, msg, extra = {}) => ({
  ok: true, msg,
  data: { accepted: false, blocked: true, rule, msg, ...extra },
});

/** 绑码（源 bind.do_bind）：SN OLD + SN NEW 一次绑定 */
export async function doBind(d, user, ip) {
  await ensureSchema();
  const stationCode = String(d.station_code || "").trim();
  const oldSn = String(d.old_sn || d.parent_sn || "").trim();
  const newSn = String(d.new_sn || d.child_sn || "").trim();
  let moNo = String(d.mo_no || "").trim();
  const operator = String(d.operator || user?.emp_name || user?.login_name || "").trim();

  const st = await station(stationCode);
  if (!st) {
    const names = (await stations()).map(s => s.station_code).join("、");
    return { ok: false, msg: `工位 ${stationCode || "空"} 不是绑码工位（当前：${names || "无"}）` };
  }
  const relType = st.rel_type || stationCode;
  const ro = await ruleFor(stationCode, "old");
  const rn = await ruleFor(stationCode, "new");
  if (!oldSn) return { ok: false, msg: `请先扫 ${ro.label || "旧码"}（SN OLD）` };
  if (!newSn) return { ok: false, msg: `请再扫 ${rn.label || "新码"}（SN NEW）` };
  if (oldSn === newSn) return blocked("SAME_CODE", "SN OLD 与 SN NEW 相同，不能自绑定", { old_sn: oldSn, new_sn: newSn });

  let [ok, msg] = checkCode(ro, oldSn);
  if (!ok) return blocked("FMT_OLD", `${ro.label || "旧码"}：${msg}`, { old_sn: oldSn, new_sn: newSn });
  const [npOk, npMsg, npInfo] = await nameplateAgeCheck(newSn);
  if (!npOk) return blocked("NAMEPLATE_EXPIRED", npMsg, { old_sn: oldSn, new_sn: newSn, detail: npInfo });
  const nameplateWarn = npMsg && npInfo ? npMsg : "";
  [ok, msg] = checkCode(rn, newSn);
  if (!ok) return blocked("FMT_NEW", `${rn.label || "新码"}：${msg}`, { old_sn: oldSn, new_sn: newSn });

  let oRow = await snRow(oldSn);
  const autoCreate = Number(d.auto_create || 0) === 1;
  if (!oRow) {
    if (!autoCreate && !Number(ro.auto_create || 0)) {
      return blocked("OLD_NOT_EXIST", `SN OLD【${oldSn}】未建档（未在本系统过站），不能绑码`, { old_sn: oldSn, new_sn: newSn });
    }
    if (!moNo) return blocked("NEED_MO", "SN OLD 未建档，自动建档需要工单号", { old_sn: oldSn, new_sn: newSn });
    oRow = await createSn(oldSn, ro.sn_type, moNo);
    if (!oRow) return blocked("OLD_CREATE_FAIL", `SN OLD 自动建档失败，请检查工单 ${moNo}`, { old_sn: oldSn, new_sn: newSn });
  }

  let nRow = await snRow(newSn);
  if (!nRow) {
    if (!autoCreate && !Number(rn.auto_create || 0)) {
      return blocked("NEW_NOT_EXIST", `SN NEW【${newSn}】未建档（未在本系统过站），不能绑码`, { old_sn: oldSn, new_sn: newSn });
    }
    if (!moNo) moNo = oRow.mo_no || "";
    if (!moNo) return blocked("NEED_MO", "SN NEW 未建档，自动建档需要工单号", { old_sn: oldSn, new_sn: newSn });
    nRow = await createSn(newSn, rn.sn_type, moNo);
    if (!nRow) return blocked("NEW_CREATE_FAIL", `SN NEW 自动建档失败，请检查工单 ${moNo}`, { old_sn: oldSn, new_sn: newSn });
  }

  for (const [code, label] of [[oldSn, ro.label || "旧码"], [newSn, rn.label || "新码"]]) {
    const rel = await activeRel(code, relType);
    if (rel) {
      const other = rel.parent_sn === code ? rel.child_sn : rel.parent_sn;
      return blocked("DUPLICATE", `${label}【${code}】已绑过【${other}】（${rel.station || ""}），不能重复绑定`,
        { old_sn: oldSn, new_sn: newSn, bound_with: other });
    }
  }

  const sameSet = (x, y) => String(x || "").length >= 9 && String(y || "").length >= 9
    && String(x).slice(0, 9) === String(y).slice(0, 9);
  const checkMo = String(await getParam("bind.check_mo", "0")).trim() === "1";
  const oMo = oRow.mo_no || "";
  const nMo = nRow.mo_no || "";
  if (checkMo) {
    if (moNo) {
      if (oMo && oMo !== moNo && !sameSet(oMo, moNo)) {
        return blocked("MO_DIFF", `SN OLD 属于工单 ${oMo}，与当前工单 ${moNo} 不是同一套`, { old_sn: oldSn, new_sn: newSn });
      }
      if (nMo && nMo !== moNo && !sameSet(nMo, moNo)) {
        return blocked("MO_DIFF", `SN NEW 属于工单 ${nMo}，与当前工单 ${moNo} 不是同一套`, { old_sn: oldSn, new_sn: newSn });
      }
    } else if (oMo && nMo && oMo !== nMo && !sameSet(oMo, nMo)) {
      return blocked("MO_DIFF", `两端工单不在同一套：SN OLD ${oMo} / SN NEW ${nMo}`, { old_sn: oldSn, new_sn: newSn });
    }
  }
  moNo = moNo || oMo || nMo;

  for (const [row, label] of [[oRow, ro.label || "旧码"], [nRow, rn.label || "新码"]]) {
    if (["报废", "已报废"].includes(row.status)) {
      return blocked("SCRAP", `${label}【${row.sn}】已报废，不能绑码`, { old_sn: oldSn, new_sn: newSn });
    }
    if (row.status === "待修") {
      return blocked("REPAIR", `${label}【${row.sn}】处于待修状态，请先维修合格再绑码`, { old_sn: oldSn, new_sn: newSn });
    }
  }

  // 换标重绑：老 PCBA 有过作废铭牌履历 → 不按「新投产」查前置
  let isRelabel = false;
  if (relType === "PCBA_Link" && nRow.sn_type === "铭牌") {
    isRelabel = Boolean((await query(
      `SELECT 1 FROM mesrj_decode_log WHERE action='作废' AND parent_sn=$1 LIMIT 1`, [oldSn])).rows[0]);
  }

  if (String(await getParam("bind.require_tested", "1")) !== "0") {
    const un = await guard_untested(oldSn, await getParam("bind.require_stations", "ICT,FCT"));
    if (un.length) {
      return blocked("UNTESTED", `未过 ${un.join("/")} · 请先测试（${oldSn}）`,
        { old_sn: oldSn, new_sn: newSn, missing_test: un });
    }
  }
  if (String(await getParam("bind.check_ng", "1")) !== "0") {
    for (const [row, label] of [[oRow, ro.label || "旧码"], [nRow, rn.label || "新码"]]) {
      const ngSt = await guard_open_ng(row.sn);
      if (ngSt) {
        return blocked("NG_OPEN", `${ngSt} NG 未处理 · 请先送维修（${row.sn}）`,
          { old_sn: oldSn, new_sn: newSn, ng_station: ngSt });
      }
    }
  }
  if (String(await getParam("bind.check_route", "1")) !== "0" && !isRelabel) {
    for (const [row, label] of [[oRow, ro.label || "旧码"], [nRow, rn.label || "新码"]]) {
      const hasPass = (await query("SELECT 1 FROM prd_pass WHERE sn=$1 LIMIT 1", [row.sn])).rows.length > 0;
      if (!hasPass) continue;
      const miss = await guard_missing_steps(row.sn, stationCode);
      if (miss.length) {
        const names = miss.slice(0, 3).map(m => String(m[1] || m[0]).split(" - ")[0]).join("、");
        return blocked("ROUTE_SKIP", `前置未完成 · 先做 ${names}${miss.length > 3 ? "…" : ""}（${row.sn}）`,
          { old_sn: oldSn, new_sn: newSn, missing: miss.map(m => m[0]) });
      }
    }
  }

  await query(
    `INSERT INTO prd_sn_rel (parent_sn, child_sn, rel_type, mo_no, station, operator, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,1)`, [oldSn, newSn, relType, moNo || "", stationCode, operator]);

  // 换标继承：只给铭牌；拆壳换外壳不继承
  let inheritFrom = "";
  if (relType === "PCBA_Link" && nRow.sn_type === "铭牌") {
    const prev = (await query(
      `SELECT void_sn FROM mesrj_decode_log WHERE action='作废' AND void_sn<>'' AND void_sn<>$1
        AND (parent_sn=$2 OR sn=$2) ORDER BY id DESC LIMIT 1`, [newSn, oldSn])).rows[0];
    if (prev?.void_sn) {
      const dup = (await query(
        `SELECT 1 FROM prd_sn_rel WHERE rel_type='RELABEL' AND parent_sn=$1 AND child_sn=$2`,
        [prev.void_sn, newSn])).rows[0];
      if (!dup) {
        await query(
          `INSERT INTO prd_sn_rel (parent_sn, child_sn, rel_type, mo_no, station, operator, is_active)
           VALUES ($1,$2,'RELABEL',$3,$4,$5,1)`, [prev.void_sn, newSn, moNo || "", stationCode, operator]);
      }
      inheritFrom = prev.void_sn;
    }
  }
  if (!nRow.mo_no && oRow.mo_no) {
    await query(`UPDATE prd_sn SET mo_no=$1, product_code=$2, updated_at=now() WHERE sn=$3`,
      [oRow.mo_no, nRow.product_code || oRow.product_code || "", newSn]);
  }

  // 自动过站（工位配置 auto_pass；换标重绑不补过站）
  let passed = "未开启（绑码工位未配置「绑码后自动过站」）";
  if (Number(st.auto_pass || 0) === 1) {
    if (isRelabel) {
      passed = `换标重绑：不重复过站（已继承 ${inheritFrom || "原铭牌"} 的过站履历）`;
    } else {
      const notes = [];
      let allOk = true;
      for (const code of [oldSn, newSn]) {
        try {
          const r = await doPassInner({ sn: code, station_code: stationCode, mo_no: "", result: "OK", operator }, user, ip);
          const dd = r?.data || {};
          if (!r?.ok || !dd.accepted) {
            allOk = false;
            notes.push(`${code}：${r?.msg || dd.msg || "被拦截"}`);
          }
        } catch (e) {
          allOk = false;
          notes.push(`${code}：${e?.message || e}`);
        }
      }
      passed = allOk ? "已自动过站" : notes.join("；");
    }
  }

  const rel = (await query(
    `SELECT * FROM prd_sn_rel WHERE parent_sn=$1 AND child_sn=$2 AND rel_type=$3 AND is_active=1
      ORDER BY id DESC LIMIT 1`, [oldSn, newSn, relType])).rows[0] || {};
  const doneMsg = `绑码成功：${oldSn} ↔ ${newSn}`
    + (inheritFrom ? `；已继承旧铭牌 ${inheritFrom} 的过站履历` : "")
    + (nameplateWarn ? `；⚠ ${nameplateWarn}` : "");
  return {
    ok: true, msg: doneMsg,
    data: {
      accepted: true, blocked: false, rel_type: relType, station_code: stationCode,
      old_sn: oldSn, new_sn: newSn, parent_sn: oldSn, child_sn: newSn,
      mo_no: moNo, operator, old_label: ro.label, new_label: rn.label,
      passed, relabel: isRelabel, relabel_from: inheritFrom,
      nameplate_warn: nameplateWarn, rel,
    },
  };
}

/** 解绑（源 unbind）：只失效，不删除 */
export async function unbind(d, user, ip) {
  await ensureSchema();
  const reason = String(d.reason || "").trim();
  let row = null;
  if (d.id) row = (await query("SELECT * FROM prd_sn_rel WHERE id=$1", [Number(d.id)])).rows[0];
  if (!row) {
    row = (await query(
      `SELECT * FROM prd_sn_rel WHERE rel_type=$1 AND is_active=1
        AND parent_sn=$2 AND child_sn=$3 ORDER BY id DESC LIMIT 1`,
      [String(d.rel_type || "").trim(), String(d.old_sn || d.parent_sn || "").trim(),
        String(d.new_sn || d.child_sn || "").trim()])).rows[0];
  }
  if (!row) return { ok: false, msg: "找不到这条绑定记录" };
  if (Number(row.is_active) !== 1) return { ok: false, msg: "该绑定已解除" };
  if (!reason) return { ok: false, msg: "解绑必须填原因" };
  await query(
    `UPDATE prd_sn_rel SET is_active=0, reason=$1, void_at=now(), void_by=$2 WHERE id=$3`,
    [reason, user?.login_name || "", row.id]);
  return { ok: true, msg: `已解绑：${row.parent_sn} ↔ ${row.child_sn}`, data: { id: row.id } };
}

/** 绑定记录列表（分页） */
export async function list(q) {
  const where = ["1=1"], args = [];
  for (const k of ["station", "rel_type", "mo_no", "operator"]) {
    const v = String(q[k] || "").trim();
    if (v) { args.push(v); where.push(`${k}=$${args.length}`); }
  }
  if (String(q.is_active || "").trim() !== "") {
    args.push(Number(q.is_active)); where.push(`is_active=$${args.length}`);
  }
  const kw = String(q.keyword || "").trim();
  if (kw) {
    args.push(`%${kw}%`);
    where.push(`(parent_sn ILIKE $${args.length} OR child_sn ILIKE $${args.length})`);
  }
  const page = Math.max(Number(q.page || 1), 1);
  const size = Math.min(Number(q.size || 30), 200);
  const w = where.join(" AND ");
  const rows = (await query(
    `SELECT * FROM prd_sn_rel WHERE ${w} ORDER BY id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
    args)).rows;
  const total = (await query(`SELECT COUNT(*)::int AS n FROM prd_sn_rel WHERE ${w}`, args)).rows[0]?.n || 0;
  return { rows, total, page, size };
}
/** 追溯链（源 chain）：绑定关系 BFS + 已解绑履历 */
export async function chain(snIn, withVoid = true) {
  const sn = String(snIn || "").trim();
  if (!sn) return null;
  const seen = new Set(), links = [], relSeen = new Set();
  const queue = [sn];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    seen.add(cur);
    const rows = (await query(
      `SELECT * FROM prd_sn_rel WHERE (parent_sn=$1 OR child_sn=$2) AND is_active=1`,
      [cur, cur])).rows;
    for (const r of rows) {
      if (relSeen.has(r.id)) continue;
      relSeen.add(r.id);
      links.push({ from: r.parent_sn, to: r.child_sn, rel_type: r.rel_type, station: r.station,
        operator: r.operator, created_at: r.created_at });
      const other = r.parent_sn === cur ? r.child_sn : r.parent_sn;
      if (!seen.has(other)) queue.push(other);
    }
  }
  const nodes = [];
  for (const code of seen) {
    const r = await snRow(code);
    let typ = r?.sn_type || "", stat = r ? (r.status || "") : "未建档";
    if (!r) {
      const isPanel = (await query(
        `SELECT 1 FROM prd_sn_rel WHERE rel_type='PANEL_SPLIT' AND parent_sn=$1 LIMIT 1`, [code])).rows[0];
      if (isPanel) { typ = "拼版母码"; stat = "虚拟码"; }
    }
    nodes.push({ sn: code, sn_type: typ, mo_no: r?.mo_no || "", status: stat,
      box_no: r?.box_no || "", pallet_no: r?.pallet_no || "" });
  }
  const rank = t => (["铭牌", "外壳"].includes(t) ? 0 : t === "PCBA" ? 1 : 2);
  nodes.sort((a, b) => rank(a.sn_type) - rank(b.sn_type) || a.sn.localeCompare(b.sn));
  let voidLinks = [];
  if (withVoid && seen.size) {
    const codes = Array.from(seen);
    voidLinks = (await query(
      `SELECT * FROM prd_sn_rel WHERE (parent_sn = ANY($1) OR child_sn = ANY($1))
        AND COALESCE(is_active,1)=0 ORDER BY id DESC LIMIT 50`, [codes])).rows.map(r => ({
          id: r.id, from: r.parent_sn, to: r.child_sn, rel_type: r.rel_type || "",
          station: r.station || "", operator: r.operator || "", created_at: r.created_at,
          reason: r.reason || "", void_at: r.void_at || "", void_by: r.void_by || "",
        }));
  }
  return { sn, info: await snRow(sn) || null, nodes, links, void_links: voidLinks };
}

/** 绑码产能（按小时）：今天每小时绑了多少对、多少条被拦 */
export async function hourly(q) {
  const day = String(q.d1 || "").trim() || (await query("SELECT now()::date::text AS d")).rows[0].d;
  const station = String(q.station_code || "").trim();
  const where = ["created_at::date = $1::date", "is_active=1", "rel_type<>'PANEL_SPLIT'"];
  const args = [day];
  if (station) { args.push(station); where.push(`station=$${args.length}`); }
  const rows = (await query(
    `SELECT to_char(created_at,'HH24') AS h, COUNT(*)::int AS n FROM prd_sn_rel
      WHERE ${where.join(" AND ")} GROUP BY 1`, args)).rows;
  const buckets = Object.fromEntries(rows.map(r => [r.h, Number(r.n || 0)]));
  const blk = {};
  const a2 = [day];
  let bq = `SELECT to_char(created_at,'HH24') AS h, COUNT(*)::int AS n FROM sys_audit_log
             WHERE created_at::date = $1::date AND (action LIKE '%拦截%' OR action LIKE '%blocked%')`;
  if (station) { a2.push(`%${station}%`); bq += ` AND target LIKE $${a2.length}`; }
  for (const r of (await query(bq + " GROUP BY 1", a2)).rows) blk[r.h] = Number(r.n || 0);
  const out = Array.from({ length: 24 }, (_, h) => {
    const k = String(h).padStart(2, "0");
    return { hour: k, n: buckets[k] || 0, blocked: blk[k] || 0 };
  });
  return { day, hours: out,
    total: { n: out.reduce((a, x) => a + x.n, 0), blocked: out.reduce((a, x) => a + x.blocked, 0) } };
}

/** 扫码反查整组绑定（源 decode_lookup） */
export async function lookup(snIn) {
  await ensureSchema();
  const sn = String(snIn || "").trim();
  if (!sn) return null;
  const [codes, rels] = await groupOf(sn);
  const card = async code => {
    const r = await snRow(code);
    return r
      ? { sn: code, sn_type: r.sn_type || "", status: r.status || "", mo_no: r.mo_no || "",
          box_no: r.box_no || "", pallet_no: r.pallet_no || "", product_code: r.product_code || "", in_system: true }
      : { sn: code, sn_type: "", status: "未建档", mo_no: "", box_no: "", pallet_no: "",
          product_code: "", in_system: false };
  };
  const nodes = [];
  for (const c of Array.from(codes).sort()) nodes.push(await card(c));
  const relsOut = [];
  for (const r of rels) {
    relsOut.push({ id: r.id, rel_type: r.rel_type || "", parent_sn: r.parent_sn,
      child_sn: r.child_sn, station: r.station || "", operator: r.operator || "",
      created_at: r.created_at || "", mo_no: r.mo_no || "",
      parent_type: (await card(r.parent_sn)).sn_type, child_type: (await card(r.child_sn)).sn_type,
      label: `${r.parent_sn} → ${r.child_sn}` });
  }
  let hist = [];
  if (codes.size) {
    const types = Array.from(await bindRelTypes());
    hist = (await query(
      `SELECT * FROM prd_sn_rel WHERE (parent_sn = ANY($1) OR child_sn = ANY($1))
        AND COALESCE(is_active,1)=0 AND rel_type = ANY($2) ORDER BY id DESC LIMIT 50`,
      [Array.from(codes), types])).rows.map(r => ({
        id: r.id, rel_type: r.rel_type || "", parent_sn: r.parent_sn, child_sn: r.child_sn,
        station: r.station || "", operator: r.operator || "", created_at: r.created_at || "",
        reason: r.reason || "", void_at: r.void_at || "", void_by: r.void_by || "",
      }));
  }
  let resumeOld = "", resumeHint = "";
  if (!relsOut.length) {
    const last = (await query(
      `SELECT * FROM mesrj_decode_log WHERE action='作废' AND void_sn=$1 ORDER BY id DESC LIMIT 1`, [sn])).rows[0];
    let keep = "";
    if (last) {
      keep = String(last.parent_sn || "").trim() || String(last.sn || "").trim();
      if (keep === sn) keep = "";
    }
    if (keep) {
      resumeOld = keep;
      resumeHint = `${sn} 已于 ${last.created_at || ""} 作废（原因：${last.reason || "未填"}），原 PCBA 是 ${keep}`;
    } else if ((await card(sn)).sn_type === "PCBA") {
      resumeOld = sn; resumeHint = `${sn} 当前没有绑定铭牌`;
    }
  }
  const panel = (await query(
    `SELECT parent_sn FROM prd_sn_rel WHERE rel_type='PANEL_SPLIT' AND child_sn=$1
      AND COALESCE(is_active,1)=1 LIMIT 1`, [sn])).rows[0];
  const panelHint = panel
    ? `同拼版 ${panel.parent_sn}（拼版关系不参与解码）` : "";
  return { sn, codes: nodes, rels: relsOut, history: hist, reasons: DECODE_REASONS,
    found: codes.size > 0, bind_types: Array.from(await bindRelTypes()),
    panel_hint: panelHint, resume_old: resumeOld, resume_hint: resumeHint };
}
/** 解码：解绑指定关系 + 作废指定码，全程留痕（源 bind.decode） */
export async function decode(d, user, ip) {
  await ensureSchema();
  const sn = String(d.sn || "").trim();
  const relIds = (Array.isArray(d.rel_ids) ? d.rel_ids : []).map(Number).filter(Number.isFinite);
  const voidCodes = (Array.isArray(d.void_codes) ? d.void_codes : []).map(x => String(x).trim()).filter(Boolean);
  const reason = String(d.reason || "").trim();
  const remark = String(d.remark || "").trim();
  const stationCode = String(d.station || "").trim();
  const operator = user?.login_name || "";
  if (!sn) return { ok: false, msg: "请先扫码" };
  const [codes, rels] = await groupOf(sn);
  if (!rels.length) return { ok: false, msg: `SN【${sn}】当前没有生效的绑定关系，无需解码` };
  const targets = rels.filter(r => !relIds.length || relIds.includes(Number(r.id)));
  if (!targets.length) return { ok: false, msg: "没有选中要解绑的关系" };

  // 已装箱/上栈板的先拆箱再解码，否则箱内清单和实物对不上
  for (const code of new Set([...codes, ...voidCodes])) {
    const r = await snRow(code);
    if (r?.box_no || r?.pallet_no) {
      return { ok: false, msg: `SN【${code}】已装在箱【${r.box_no || "-"}】/栈板【${r.pallet_no || "-"}】，请先取消装箱再解码` };
    }
  }

  let moNo = "";
  const doneRel = [], doneVoid = [];
  for (const r of targets) {
    moNo = moNo || r.mo_no || "";
    await query(
      `UPDATE prd_sn_rel SET is_active=0, reason=$1, void_at=now(), void_by=$2 WHERE id=$3`,
      [reason, operator, r.id]);
    await query(
      `INSERT INTO mesrj_decode_log (action, sn, rel_id, parent_sn, child_sn, rel_type, void_sn,
        reason, remark, operator, station, mo_no)
       VALUES ('解绑',$1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10)`,
      [sn, r.id, r.parent_sn, r.child_sn, r.rel_type || "", reason, remark, operator, stationCode, moNo]);
    doneRel.push({ id: r.id, parent_sn: r.parent_sn, child_sn: r.child_sn });
  }
  let pcbaOf = "";
  for (const c of codes) {
    if ((await snRow(c))?.sn_type === "PCBA") { pcbaOf = c; break; }
  }
  for (const code of Array.from(new Set(voidCodes))) {
    const row = await snRow(code);
    if (!row || ["报废", "已报废"].includes(row.status)) continue;
    await query("UPDATE prd_sn SET status='报废', updated_at=now() WHERE sn=$1", [code]);
    await query(
      `INSERT INTO mesrj_decode_log (action, sn, rel_id, parent_sn, child_sn, rel_type, void_sn,
        reason, remark, operator, station, mo_no)
       VALUES ('作废',$1,0,$2,'','',  $3,$4,$5,$6,$7,$8)`,
      [sn, pcbaOf, code, reason, remark, operator, stationCode, moNo || row.mo_no || ""]);
    doneVoid.push(code);
  }
  const msg = `已解码：解绑 ${doneRel.length} 条`
    + (doneVoid.length ? `，作废 ${doneVoid.length} 个码（${doneVoid.join("、")}）` : "（未作废任何码）");
  return { ok: true, msg, data: { rels: doneRel, voided: doneVoid, reason } };
}

/** 解码履历（源 decode_log） */
export async function decodeLog(q) {
  await ensureSchema();
  const where = ["1=1"], args = [];
  const kw = String(q.keyword || "").trim();
  if (kw) {
    args.push(`%${kw}%`);
    where.push(`(sn ILIKE $${args.length} OR parent_sn ILIKE $${args.length} OR child_sn ILIKE $${args.length} OR void_sn ILIKE $${args.length})`);
  }
  const action = String(q.action || "").trim();
  if (action) { args.push(action); where.push(`action=$${args.length}`); }
  const d1 = String(q.from || "").trim(), d2 = String(q.to || "").trim();
  if (d1) { args.push(d1.slice(0, 10)); where.push(`created_at::date >= $${args.length}::date`); }
  if (d2) { args.push(d2.slice(0, 10)); where.push(`created_at::date <= $${args.length}::date`); }
  const page = Math.max(Number(q.page || 1), 1);
  const size = Math.min(Math.max(Number(q.size || 30), 10), 200);
  const w = where.join(" AND ");
  const total = (await query(`SELECT COUNT(*)::int AS n FROM mesrj_decode_log WHERE ${w}`, args)).rows[0]?.n || 0;
  const rows = (await query(
    `SELECT * FROM mesrj_decode_log WHERE ${w} ORDER BY id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`,
    args)).rows;
  return { rows, total, page, size };
}
export default {
  ensureSchema, stations, station, ruleFor, checkCode, nameplateAgeCheck, precheck, createSn,
  isNewSide, bindRelTypes, groupOf, DECODE_REASONS, doBind, unbind, list, chain, hourly,
  lookup, decode, decodeLog,
  guard_untested, guard_open_ng, guard_missing_steps, doPassInner, snRow, activeRel, stationShort,
};
