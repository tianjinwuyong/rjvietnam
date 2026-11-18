import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { oaApi, type OaDepartment, type OaUserOption } from "./oaApi";
import { t } from "./i18n";

/**
 * 组织架构（只读版）—— 部门树 + 人员列表 + 人员详情。
 * 数据源与原版一致：GET /api/departments（含 leader_name / user_count）、
 * GET /api/users?departmentId=&keyword=（手机号字段由后端按「部门经理及以上」鉴权）。
 * CRUD 与组织数据同步问题按拷问会决议暂缓（Q3/Q4）。
 */

interface DeptNode extends OaDepartment {
  children: DeptNode[];
}

function buildTree(list: OaDepartment[]): DeptNode[] {
  const map = new Map<string, DeptNode>();
  for (const d of list) map.set(String(d.id), { ...d, children: [] });
  const roots: DeptNode[] = [];
  for (const node of map.values()) {
    const parent = node.parent_id != null ? map.get(String(node.parent_id)) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: DeptNode[]) => {
    nodes.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || Number(a.id) - Number(b.id));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

function deptName(d: OaDepartment, locale: Locale): string {
  if (locale === "en-US" && d.name_en) return d.name_en;
  return d.name;
}

function fmtDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(locale === "vi-VN" ? "vi-VN" : locale === "en-US" ? "en-US" : "zh-CN");
  } catch {
    return value;
  }
}

export function OrgView({ locale }: { locale: Locale }) {
  const [depts, setDepts] = useState<DeptNode[] | null>(null);
  const [selectedDept, setSelectedDept] = useState<string>("");
  const [users, setUsers] = useState<OaUserOption[] | null>(null);
  const [keyword, setKeyword] = useState("");
  const [selectedUser, setSelectedUser] = useState<OaUserOption | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    oaApi.departments()
      .then(list => { if (!cancelled) setDepts(buildTree(list || [])); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const loadUsers = useCallback(async (departmentId: string, kw: string) => {
    setError("");
    try {
      const q: { keyword?: string; departmentId?: string } = {};
      if (departmentId) q.departmentId = departmentId;
      if (kw.trim()) q.keyword = kw.trim();
      setUsers(await oaApi.users(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void loadUsers(selectedDept, keyword); }, [selectedDept, loadUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalUsers = useMemo(() => {
    let n = 0;
    const walk = (nodes: DeptNode[] | null) => {
      for (const d of nodes || []) { n += d.user_count ?? 0; walk(d.children); }
    };
    walk(depts);
    return n;
  }, [depts]);

  if (error && !depts) return <div className="empty-state">{t("empty.loadFailed", locale)}: {error}</div>;
  if (!depts) return <div className="empty-state">{t("common.loading", locale)}</div>;

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* 部门树 */}
      <div className="surface-panel" style={{ flex: "0 0 260px", padding: "12px 14px", minWidth: 240 }}>
        <h4 style={{ margin: "0 0 8px" }}>{t("menu.org", locale)}</h4>
        <div
          onClick={() => { setSelectedDept(""); setSelectedUser(null); }}
          style={{
            fontSize: 13, padding: "5px 8px", cursor: "pointer", borderRadius: 6,
            background: selectedDept === "" ? "#ecfdf5" : "transparent",
            fontWeight: selectedDept === "" ? 700 : 400,
          }}
        >
          {t("common.all", locale)} · {t("orgExtra.userCount", locale, { n: totalUsers })}
        </div>
        <DeptTree nodes={depts} locale={locale} selected={selectedDept} depth={0}
          onSelect={id => { setSelectedDept(id); setSelectedUser(null); }} />
      </div>

      {/* 人员列表 + 详情 */}
      <div style={{ flex: "1 1 480px", minWidth: 420 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder={t("orgExtra.searchPlaceholder", locale)}
            style={{ flex: "0 1 260px", padding: "6px 10px" }}
            onKeyDown={e => { if (e.key === "Enter") void loadUsers(selectedDept, keyword); }}
          />
          <button onClick={() => void loadUsers(selectedDept, keyword)} style={{ cursor: "pointer" }}>{t("common.search", locale)}</button>
        </div>

        {error && <p style={{ color: "var(--danger, #b91c1c)", fontSize: 13 }}>{error}</p>}

        {!users ? <div className="empty-state">{t("common.loading", locale)}</div> : users.length === 0 ? (
          <div className="empty-state">{t("common.empty", locale)}</div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("common.name", locale)}</th>
                  <th style={{ width: 110 }}>{t("orgExtra.empNo", locale)}</th>
                  <th>{t("common.dept", locale)}</th>
                  <th>{t("common.type", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={String(u.id)} onClick={() => setSelectedUser(u)} style={{ cursor: "pointer", fontWeight: selectedUser?.id === u.id ? 700 : 400 }}>
                    <td>{u.real_name}{u.is_admin ? " ★" : ""}</td>
                    <td>{u.employee_no ?? "—"}</td>
                    <td>{u.dept_name ?? t("orgExtra.noDept", locale)}</td>
                    <td>{u.position ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedUser && (
          <div className="surface-panel" style={{ padding: "14px 16px", marginTop: 12 }}>
            <h4 style={{ margin: "0 0 10px" }}>{selectedUser.real_name}</h4>
            <div className="table-shell">
              <table>
                <tbody>
                  <tr><th style={{ width: 140, textAlign: "left" }}>{t("common.user", locale)}</th><td>{selectedUser.username}</td></tr>
                  <tr><th style={{ textAlign: "left" }}>{t("orgExtra.empNo", locale)}</th><td>{selectedUser.employee_no ?? "—"}</td></tr>
                  <tr><th style={{ textAlign: "left" }}>{t("common.dept", locale)}</th><td>{selectedUser.dept_name ?? t("orgExtra.noDept", locale)}</td></tr>
                  <tr><th style={{ textAlign: "left" }}>{t("common.type", locale)}</th><td>{selectedUser.position ?? "—"}</td></tr>
                  <tr><th style={{ textAlign: "left" }}>Email</th><td>{selectedUser.email ?? "—"}</td></tr>
                  <tr><th style={{ textAlign: "left" }}>{t("orgExtra.roleAdmin", locale)}</th><td>{selectedUser.is_admin ? t("common.yes", locale) : t("common.no", locale)}</td></tr>
                  <tr><th style={{ textAlign: "left" }}>{t("common.date", locale)}</th><td>{fmtDate(selectedUser.hire_date, locale)}</td></tr>
                  <tr><th style={{ textAlign: "left" }}>{t("flowDetail.time", locale)}</th><td>{fmtDate(selectedUser.last_login_at, locale)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeptTree({
  nodes, locale, selected, depth, onSelect,
}: {
  nodes: DeptNode[];
  locale: Locale;
  selected: string;
  depth: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      {nodes.map(n => (
        <div key={String(n.id)}>
          <div
            onClick={() => onSelect(String(n.id))}
            style={{
              fontSize: 13, padding: "5px 8px", cursor: "pointer", borderRadius: 6,
              paddingLeft: 8 + depth * 14,
              background: selected === String(n.id) ? "#ecfdf5" : "transparent",
              fontWeight: selected === String(n.id) ? 700 : 400,
              display: "flex", justifyContent: "space-between", gap: 8,
            }}
          >
            <span>{deptName(n, locale)}</span>
            <span style={{ color: "var(--text-muted, #64748b)", fontSize: 12 }}>{n.user_count ?? 0}</span>
          </div>
          {n.children.length > 0 && (
            <DeptTree nodes={n.children} locale={locale} selected={selected} depth={depth + 1} onSelect={onSelect} />
          )}
        </div>
      ))}
    </div>
  );
}
