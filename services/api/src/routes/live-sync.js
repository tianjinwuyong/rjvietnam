// ============================================================================
// Live-sync adapters — dynamic pull from the RUNNING WMS / OA (not the extract)
// ============================================================================
// Why this file exists: the grafts were cut from static extracts (WMS-20261019,
// OA-full-extracted, MES-ruijing). The sources keep running and changing on the
// tailnet (measured 2026-11-21):
//   WMS  http://100.107.212.49:18080  NestJS; login POST /api/system/login
//        {account,password} → {code:0,data:{token,menuPermissions[62]}};
//        lists {items,page,pageSize,total}; Bearer JWT.
//   OA   http://100.107.212.49:8090   login POST /api/auth/login
//        {username,password} → {code:0,data:{token,expires,user}};
//        lists {code,msg,data:{list,page,size,total}}; Bearer session token.
// This module is the ADAPTER layer: it speaks each source's native contract and
// lands data in staging (sync_stage.live_<app>__<task>, jsonb verbatim) — never
// into business tables. Canonical convergence stays with the one-WMS slice
// chain; menu drift is detected against live_menu_snapshot (migration 392).
//
// Conventions copied from mes-sync.js (same lane):
//   · sys_param config, no cache — edits take effect on the next tick
//   · process-level mutex per app; timers unref()'d, clamped 1–1440 min
//   · every call logged to itf_api_log (direction OUT) so the hub health view
//     (v_integration_app_health) picks it up via integration_app.api_path_prefix
//   · secrets never echoed: GET config returns hasPassword + masked account
//
// Mounting: registerLiveSyncRoutes(app, deps) from server.js right after
// registerHubRoutes — after the app-level auth wrapper, so JWT-guarded.
// ============================================================================
import { createHash } from "node:crypto";
import { convergeTask, CONVERGE_TASKS } from "./live-converge.js";

const APPS = {
  "wms-rjvn": {
    paramPrefix: "livewms",
    defaultBase: "http://100.107.212.49:18080",
    loginPath: "/api/system/login",
    accountParam: "account", // WMS login body field
    tasks: {
      menu: { path: null }, // menu comes from the login response itself
      inventory: { path: "/api/inventory/list", pageSize: 200 },
      picking: { path: "/api/workorder/picking/list", pageSize: 200 },
      iqc: { path: "/api/iqc/pending", pageSize: 200 },
      workorders: { path: "/api/workorder/list", pageSize: 200 },
    },
  },
  "oa-portal": {
    paramPrefix: "liveoa",
    defaultBase: "http://100.107.212.49:8090",
    loginPath: "/api/auth/login",
    accountParam: "username",
    tasks: {
      flows: { path: "/api/flows", pageSize: 0 }, // flat array in data
      instances: { path: "/api/instances?tab=flow", pageSize: 200 },
    },
  },
};

const PARAM_KEYS = Object.values(APPS).flatMap((a) => [
  `${a.paramPrefix}.base_url`, `${a.paramPrefix}.account`, `${a.paramPrefix}.password`,
  `${a.paramPrefix}.auto_sync`, `${a.paramPrefix}.interval_min`,
]);

export function registerLiveSyncRoutes(app, deps) {
  const { query, requirePermission, errorEnvelope, successEnvelope, listEnvelope } = deps;

  const adminOnly = requirePermission("wms.execute");
  const timers = {};
  const running = {}; // app → bool, process-level mutex
  const sessions = {}; // app → { token, expiresAt, menuPermissions }

  const text = (v) => String(v ?? "").trim();
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const errText = (e) => String(e?.message || e).slice(0, 300);
  const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

  async function loadConfig(code) {
    const a = APPS[code];
    const r = await query(`SELECT param_key, param_val FROM sys_param WHERE param_key = ANY($1::text[])`, [PARAM_KEYS]);
    const m = new Map(r.rows.map((x) => [x.param_key, x.param_val]));
    return {
      baseUrl: text(m.get(`${a.paramPrefix}.base_url`) || a.defaultBase).replace(/\/+$/, ""),
      account: text(m.get(`${a.paramPrefix}.account`)),
      password: text(m.get(`${a.paramPrefix}.password`)),
      autoSync: text(m.get(`${a.paramPrefix}.auto_sync`) ?? "false") === "true",
      intervalMinutes: Math.min(1440, Math.max(1, num(m.get(`${a.paramPrefix}.interval_min`) ?? 5, 5) || 5)),
    };
  }

  async function upsertParam(key, value, nameZh) {
    await query(
      `INSERT INTO sys_param (param_key, param_val, param_name, group_name, updated_at)
       VALUES ($1,$2,$3,'LIVE-SYNC',now())
       ON CONFLICT (param_key) DO UPDATE SET param_val = EXCLUDED.param_val, updated_at = now()`,
      [key, String(value), nameZh],
    );
  }

  // itf_api_log: direction OUT, api_path prefixed so the hub health view counts it.
  async function logCall(code, path, method, ok, httpStatus, msg, costMs) {
    try {
      await query(
        `INSERT INTO itf_api_log (direction, api_path, method, req_body, resp_body, http_status, success, cost_ms, sn)
         VALUES ('OUT',$1,$2,'',$3,$4,$5,$6,$7)`,
        [`/live-sync/${code}${path}`, method, String(msg || "").slice(0, 500), httpStatus, ok ? 1 : 0, costMs, code],
      );
    } catch { /* 日志失败不影响同步主流程 */ }
  }

  async function touchApp(code, ok, errMsg) {
    await query(
      `UPDATE integration_app SET last_seen_at = CASE WHEN $2 THEN now() ELSE last_seen_at END,
              last_error = $3, updated_at = now() WHERE code = $1`,
      [code, ok, ok ? "" : String(errMsg || "").slice(0, 500)],
    ).catch(() => undefined);
  }

  // ── source-native HTTP client ─────────────────────────────────────────────
  /**
   * @param {string} code
   * @param {{ baseUrl: string }} cfg
   * @param {string} path
   * @param {{ method?: string, body?: unknown, token?: string }} [opts]
   */
  async function call(code, cfg, path, opts = {}) {
    const { method = "GET", body, token } = opts;
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(cfg.baseUrl + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      await logCall(code, path, method, false, 0, errText(e), Date.now() - t0);
      throw new Error(`${code} 网络错误：${errText(e)}`);
    }
    const txt = await res.text();
    let j; try { j = JSON.parse(txt); } catch { j = null; }
    const ok = res.ok && j != null;
    await logCall(code, path, method, ok, res.status, ok ? "" : txt.slice(0, 200), Date.now() - t0);
    if (!res.ok) {
      const msg = j?.error?.message || j?.msg || j?.message || txt.slice(0, 150);
      const e = /** @type {{ http?: number } & Error} */ (new Error(`${code} ${res.status}: ${msg}`));
      e.http = res.status;
      throw e;
    }
    return j;
  }

  // Login once, reuse until expiry (OA gives expires; WMS JWT re-login on 401).
  async function ensureSession(code, cfg, force = false) {
    const s = sessions[code];
    if (!force && s && s.token && (!s.expiresAt || s.expiresAt > Date.now() + 60_000)) return s;
    if (!cfg.account || !cfg.password) throw new Error(`${code} 未配置账号/密码（livewms.* / liveoa.*）`);
    const a = APPS[code];
    const j = await call(code, cfg, a.loginPath, {
      method: "POST",
      body: { [a.accountParam]: cfg.account, password: cfg.password },
    });
    const data = j?.data || {};
    if (!data.token) throw new Error(`${code} 登录失败：${j?.msg || j?.message || "无 token"}`);
    sessions[code] = {
      token: data.token,
      expiresAt: data.expires ? Date.parse(data.expires) : null,
      menuPermissions: Array.isArray(data.menuPermissions) ? data.menuPermissions : null,
    };
    return sessions[code];
  }

  /**
   * @param {string} code
   * @param {{ baseUrl: string }} cfg
   * @param {string} path
   * @param {{ method?: string, body?: unknown, token?: string }} [opts]
   */
  async function authedCall(code, cfg, path, opts = {}) {
    const s = await ensureSession(code, cfg);
    try {
      return await call(code, cfg, path, { ...opts, token: s.token });
    } catch (e) {
      if (e.http === 401 || e.http === 403) {
        const s2 = await ensureSession(code, cfg, true);
        return await call(code, cfg, path, { ...opts, token: s2.token });
      }
      throw e;
    }
  }

  // ── staging landing: jsonb verbatim, never business tables ───────────────
  async function landRows(code, task, rows) {
    const table = `live_${code.replace(/-/g, "_")}__${task}`;
    await query(`CREATE SCHEMA IF NOT EXISTS sync_stage`);
    await query(
      `CREATE TABLE IF NOT EXISTS sync_stage."${table}" (
         source_id TEXT PRIMARY KEY,
         payload JSONB NOT NULL,
         fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    let created = 0, updated = 0;
    for (const row of rows) {
      const id = text(row?.id ?? row?.pickingNo ?? row?.lotNo ?? row?.instance_no ?? row?.code ?? digest(row));
      const r = await query(
        `INSERT INTO sync_stage."${table}" (source_id, payload, fetched_at)
         VALUES ($1,$2,now())
         ON CONFLICT (source_id) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [id, JSON.stringify(row)],
      );
      if (r.rows[0]?.inserted) created++; else updated++;
    }
    return { created, updated };
  }

  // WMS lists: {items,total} bare; some wrap in {code,data:{items,total}}.
  function extractList(j) {
    const d = j?.data ?? j;
    const items = Array.isArray(d) ? d : (d?.items || d?.list || []);
    return { items, total: num(d?.total, items.length) };
  }

  async function pullTask(code, cfg, task) {
    const a = APPS[code];
    const spec = a.tasks[task];
    if (!spec) throw new Error(`未知任务：${code}/${task}`);

    if (task === "menu") {
      const s = await ensureSession(code, cfg, true);
      const payload = code === "wms-rjvn"
        ? (s.menuPermissions || [])
        : (await authedCall(code, cfg, "/api/auth/profile"))?.data?.permissions || [];
      return await snapshotMenu(code, task === "menu" ? "menu" : "permissions", payload);
    }
    if (task === "flows") {
      const j = await authedCall(code, cfg, spec.path);
      const defs = j?.data || [];
      const snap = await snapshotMenu(code, "flow-defs", defs);
      const { created, updated } = await landRows(code, task, defs);
      return { pulled: defs.length, created, updated, ...snap };
    }

    // paged lists
    const pageSize = spec.pageSize || 200;
    let page = 1, pulled = 0, created = 0, updated = 0, total = Infinity;
    const all = [];
    while (pulled < total && page <= 500) {
      const sep = spec.path.includes("?") ? "&" : "?";
      const sizeParam = code === "oa-portal" ? "size" : "pageSize";
      const j = await authedCall(code, cfg, `${spec.path}${sep}page=${page}&${sizeParam}=${pageSize}`);
      const { items, total: t } = extractList(j);
      total = t;
      all.push(...items);
      pulled += items.length;
      if (!items.length) break;
      page++;
    }
    const r = await landRows(code, task, all);
    created = r.created; updated = r.updated;
    return { pulled, created, updated, total };
  }

  async function snapshotMenu(code, kind, payload) {
    const d = digest(payload);
    const prev = await query(
      `SELECT digest FROM live_menu_snapshot WHERE app=$1 AND kind=$2 ORDER BY fetched_at DESC LIMIT 1`,
      [code, kind],
    );
    const drifted = prev.rows.length > 0 && prev.rows[0].digest !== d;
    if (!prev.rows.length || drifted) {
      await query(
        `INSERT INTO live_menu_snapshot (app, kind, payload, item_count, digest) VALUES ($1,$2,$3,$4,$5)`,
        [code, kind, JSON.stringify(payload), Array.isArray(payload) ? payload.length : 0, d],
      );
    }
    return { drifted, snapshotWritten: !prev.rows.length || drifted };
  }

  async function runSync(code, tasks, trigger) {
    if (running[code]) return { skipped: true, reason: "already running" };
    running[code] = true;
    const started = new Date();
    const results = {};
    let status = "success", message = "";
    try {
      const cfg = await loadConfig(code);
      for (const task of tasks) {
        const logR = await query(
          `INSERT INTO live_sync_log (app, task, status, started_at) VALUES ($1,$2,'running',$3) RETURNING id`,
          [code, task, started],
        );
        const logId = logR.rows[0].id;
        try {
          const r = await pullTask(code, cfg, task);
          results[task] = r;
          // Second half of the pipeline: land staged rows into canonical
          // (live-converge.js). Pull failure never reaches here; a converge
          // failure degrades the round to partial but keeps the pulled data.
          if (CONVERGE_TASKS.has(task)) {
            try {
              r.converge = await convergeTask(query, code, task);
            } catch (e) {
              r.converge = { error: errText(e) };
              status = "partial";
              message += `converge:${task} ${errText(e)}; `;
            }
          }
          await query(
            `UPDATE live_sync_log SET status=$7, pulled=$2, created=$3, updated=$4, skipped=$5, message=$6, finished_at=now() WHERE id=$1`,
            [logId, num(r.pulled), num(r.created) + num(r.converge?.created), num(r.updated) + num(r.converge?.updated), num(r.skipped) + num(r.converge?.skipped), (r.drifted ? "MENU DRIFT DETECTED " : "") + (r.converge?.note || r.converge?.error || ""), r.converge?.error ? "partial" : "success"],
          );
        } catch (e) {
          results[task] = { error: errText(e) };
          status = "partial";
          message += `${task}: ${errText(e)}; `;
          await query(
            `UPDATE live_sync_log SET status='failed', message=$2, finished_at=now() WHERE id=$1`,
            [logId, errText(e)],
          );
        }
      }
      await touchApp(code, status === "success", message);
    } catch (e) {
      status = "failed"; message = errText(e);
      await touchApp(code, false, message);
    } finally {
      running[code] = false;
    }
    return { app: code, trigger, status, message: message || undefined, results };
  }

  // Two config PUTs in a row both call restartTimers, and the async
  // loadConfig() below resolves AFTER the second call's clear-all — without
  // the just-in-time clear here each app ended up with two intervals
  // (observed 2026-11-21: 14 log rows per round, every task pulled twice ~1s
  // apart). So: clear whatever is armed at assignment time, including when
  // this pass decides not to arm (a superseded pass may have armed already).
  function restartTimers() {
    Promise.all(Object.keys(APPS).map(async (code) => {
      const cfg = await loadConfig(code);
      if (timers[code]) { clearInterval(timers[code]); timers[code] = null; }
      if (cfg.autoSync && cfg.account && cfg.password) {
        timers[code] = setInterval(() => {
          runSync(code, Object.keys(APPS[code].tasks), "timer").catch((e) =>
            console.warn(`[live-sync] ${code} 定时同步失败：`, errText(e)));
        }, cfg.intervalMinutes * 60_000);
        if (typeof timers[code].unref === "function") timers[code].unref();
      }
    })).catch((e) => console.warn("[live-sync] 启动读配置失败：", errText(e)));
  }

  // ── routes (all after the auth wrapper; admin audience like hub.js) ──────
  app.get("/api/live-sync/status", adminOnly, async (req, res) => {
    try {
      const out = [];
      for (const code of Object.keys(APPS)) {
        const cfg = await loadConfig(code);
        const last = await query(
          `SELECT task, status, pulled, created, updated, message, started_at, finished_at
             FROM live_sync_log WHERE app=$1 ORDER BY started_at DESC LIMIT 1`, [code]);
        const menu = await query(
          `SELECT kind, item_count, fetched_at FROM live_menu_snapshot WHERE app=$1 ORDER BY fetched_at DESC LIMIT 1`, [code]);
        const drift = await query(
          `SELECT count(*)::int AS n FROM live_sync_log WHERE app=$1 AND message LIKE 'MENU DRIFT%' AND started_at > now() - interval '7 days'`, [code]);
        out.push({
          app: code,
          baseUrl: cfg.baseUrl,
          account: cfg.account,
          hasPassword: cfg.password.length > 0,
          autoSync: cfg.autoSync,
          intervalMinutes: cfg.intervalMinutes,
          running: !!running[code],
          sessionActive: !!(sessions[code]?.token),
          tasks: Object.keys(APPS[code].tasks),
          lastRun: last.rows[0] || null,
          lastMenuSnapshot: menu.rows[0] || null,
          menuDrifts7d: drift.rows[0].n,
        });
      }
      res.json(listEnvelope(out, out.length));
    } catch (e) { res.status(500).json(errorEnvelope("LIVE_SYNC_STATUS_FAILED", e.message)); }
  });

  app.put("/api/live-sync/config/:code", adminOnly, async (req, res) => {
    const code = req.params.code;
    const a = APPS[code];
    if (!a) return res.status(404).json(errorEnvelope("NOT_FOUND", `unknown app: ${code}`));
    try {
      const b = req.body || {};
      if (b.baseUrl !== undefined) await upsertParam(`${a.paramPrefix}.base_url`, text(b.baseUrl).replace(/\/+$/, ""), `${code} 基址`);
      if (b.account !== undefined) await upsertParam(`${a.paramPrefix}.account`, text(b.account), `${code} 账号`);
      // 空串 = 不修改（与 mes-sync 的密钥约定一致）
      if (b.password !== undefined && text(b.password) !== "") await upsertParam(`${a.paramPrefix}.password`, text(b.password), `${code} 密码`);
      if (b.autoSync !== undefined) await upsertParam(`${a.paramPrefix}.auto_sync`, b.autoSync ? "true" : "false", `${code} 自动同步`);
      if (b.intervalMinutes !== undefined) {
        const v = Math.min(1440, Math.max(1, num(b.intervalMinutes, 5) || 5));
        await upsertParam(`${a.paramPrefix}.interval_min`, v, `${code} 同步间隔(分)`);
      }
      sessions[code] = null; // config changed → re-login next call
      restartTimers();
      const cfg = await loadConfig(code);
      res.json(successEnvelope({ app: code, baseUrl: cfg.baseUrl, account: cfg.account, hasPassword: cfg.password.length > 0, autoSync: cfg.autoSync, intervalMinutes: cfg.intervalMinutes }));
    } catch (e) { res.status(500).json(errorEnvelope("LIVE_SYNC_CONFIG_FAILED", e.message)); }
  });

  app.post("/api/live-sync/run/:code", adminOnly, async (req, res) => {
    const code = req.params.code;
    if (!APPS[code]) return res.status(404).json(errorEnvelope("NOT_FOUND", `unknown app: ${code}`));
    const tasks = Array.isArray(req.body?.tasks) && req.body.tasks.length
      ? req.body.tasks.filter((t) => APPS[code].tasks[t])
      : Object.keys(APPS[code].tasks);
    if (!tasks.length) return res.status(400).json(errorEnvelope("VALIDATION", "no valid tasks"));
    try {
      const r = await runSync(code, tasks, "manual");
      if (r.skipped) return res.status(409).json(errorEnvelope("ALREADY_RUNNING", `${code} 同步进行中`));
      res.json(successEnvelope(r));
    } catch (e) { res.status(500).json(errorEnvelope("LIVE_SYNC_RUN_FAILED", e.message)); }
  });

  // Manual convergence pass: run the staging→canonical SQL against whatever
  // is already landed, without re-pulling. Same mutex as runSync so a timer
  // round and a manual pass cannot double-INSERT the RECEIVE transactions.
  app.post("/api/live-sync/converge/:code", adminOnly, async (req, res) => {
    const code = req.params.code;
    if (!APPS[code]) return res.status(404).json(errorEnvelope("NOT_FOUND", `unknown app: ${code}`));
    if (running[code]) return res.status(409).json(errorEnvelope("ALREADY_RUNNING", `${code} 同步进行中`));
    running[code] = true;
    try {
      const tasks = Object.keys(APPS[code].tasks).filter((t) => CONVERGE_TASKS.has(t));
      const results = {};
      for (const task of tasks) {
        try {
          results[task] = await convergeTask(query, code, task);
        } catch (e) {
          results[task] = { error: errText(e) };
        }
      }
      res.json(successEnvelope({ app: code, results }));
    } catch (e) {
      res.status(500).json(errorEnvelope("LIVE_SYNC_CONVERGE_FAILED", e.message));
    } finally {
      running[code] = false;
    }
  });

  app.get("/api/live-sync/logs/:code", adminOnly, async (req, res) => {
    const code = req.params.code;
    if (!APPS[code]) return res.status(404).json(errorEnvelope("NOT_FOUND", `unknown app: ${code}`));
    try {
      const limit = Math.min(200, Math.max(1, num(req.query.limit, 50) || 50));
      const { rows } = await query(
        `SELECT id, task, status, pulled, created, updated, skipped, failed, message, started_at, finished_at
           FROM live_sync_log WHERE app=$1 ORDER BY started_at DESC LIMIT $2`, [code, limit]);
      res.json(listEnvelope(rows, rows.length));
    } catch (e) { res.status(500).json(errorEnvelope("LIVE_SYNC_LOGS_FAILED", e.message)); }
  });

  // Menu drift: latest source snapshot vs the one before it, plus the local
  // menu-map anchor (docs/wms-menu-map) is a human doc — the machine anchor is
  // live_menu_snapshot. Consumers diff payload arrays to see added/removed.
  app.get("/api/live-sync/menu-drift/:code", adminOnly, async (req, res) => {
    const code = req.params.code;
    if (!APPS[code]) return res.status(404).json(errorEnvelope("NOT_FOUND", `unknown app: ${code}`));
    try {
      const { rows } = await query(
        `SELECT kind, payload, item_count, digest, fetched_at FROM live_menu_snapshot
          WHERE app=$1 ORDER BY fetched_at DESC LIMIT 2`, [code]);
      if (!rows.length) return res.json(successEnvelope({ app: code, snapshots: 0, drifted: false }));
      const [latest, prev] = rows;
      let added = [], removed = [];
      if (prev && prev.kind === latest.kind && Array.isArray(latest.payload) && Array.isArray(prev.payload)) {
        const key = (x) => (typeof x === "string" ? x : JSON.stringify(x?.code ?? x?.id ?? x));
        const nowSet = new Set(latest.payload.map(key));
        const oldSet = new Set(prev.payload.map(key));
        added = latest.payload.filter((x) => !oldSet.has(key(x)));
        removed = prev.payload.filter((x) => !nowSet.has(key(x)));
      }
      res.json(successEnvelope({
        app: code, snapshots: rows.length, drifted: !!prev && prev.digest !== latest.digest,
        latest: { kind: latest.kind, itemCount: latest.item_count, fetchedAt: latest.fetched_at },
        added, removed,
      }));
    } catch (e) { res.status(500).json(errorEnvelope("LIVE_SYNC_DRIFT_FAILED", e.message)); }
  });

  // Staging peek: what the adapter last landed (read-only window into sync_stage).
  app.get("/api/live-sync/staging/:code/:task", adminOnly, async (req, res) => {
    const { code, task } = req.params;
    if (!APPS[code] || !APPS[code].tasks[task]) return res.status(404).json(errorEnvelope("NOT_FOUND", "unknown app/task"));
    const table = `live_${code.replace(/-/g, "_")}__${task}`;
    try {
      const exists = await query(`SELECT to_regclass('sync_stage."${table}"') AS t`);
      if (!exists.rows[0].t) return res.json(listEnvelope([], 0));
      const limit = Math.min(500, Math.max(1, num(req.query.limit, 50) || 50));
      const { rows } = await query(
        `SELECT source_id, payload, fetched_at FROM sync_stage."${table}" ORDER BY fetched_at DESC LIMIT $1`, [limit]);
      const cnt = await query(`SELECT count(*)::int AS n FROM sync_stage."${table}"`);
      res.json(listEnvelope(rows, cnt.rows[0].n));
    } catch (e) { res.status(500).json(errorEnvelope("LIVE_SYNC_STAGING_FAILED", e.message)); }
  });

  // Startup: attach timers from stored config; failure only warns (mes-sync pattern).
  restartTimers();
}