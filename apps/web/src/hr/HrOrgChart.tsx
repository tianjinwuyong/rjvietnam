import { useState, useEffect, useMemo } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { hrApi } from "../api";
import type { OrgChartNode, Department, Employee } from "../api";
import { DepartmentModal } from "./DepartmentModal";
// HrOrgChart3D removed — react-three-fiber incompatible with React 19 in this setup
import type { TranslationKey } from "../i18n";

const DEPT_COLORS: Record<string, string> = {
  management: "#7c3aed",
  production: "#2563eb",
  quality: "#16a34a",
  engineering: "#ea580c",
  warehouse: "#ca8a04",
  hr: "#db2777",
  finance: "#0891b2",
  admin: "#64748b",
  planning: "#7c3aed",
  general: "#64748b",
};

function DeptNode({
  node,
  onToggle,
  expanded,
  onEdit,
  onDelete,
}: {
  node: OrgChartNode;
  onToggle: (id: number) => void;
  expanded: Set<number>;
  onEdit: (node: OrgChartNode) => void;
  onDelete: (node: OrgChartNode) => void;
}) {
  const color = DEPT_COLORS[node.dept_type] ?? DEPT_COLORS.general;

  return (
    <div className="org-node-wrapper">
      <div
        className="org-node"
        style={{ borderTop: `3px solid ${color}` }}
        onClick={() => onToggle(node.id)}
      >
        <div className="org-node-actions" style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 4 }}>
          <button
            className="btn-ghost btn-sm"
            onClick={(e) => { e.stopPropagation(); onEdit(node); }}
            title={t("buttons.edit", "en-US")}
          >
            ✎
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={(e) => { e.stopPropagation(); onDelete(node); }}
            title={t("buttons.delete", "en-US")}
            style={{ color: "var(--danger)" }}
          >
            ✕
          </button>
        </div>
        <div className="org-node-badge" style={{ background: color }}>
          {node.memberCount}
        </div>
        <div className="org-node-name">{node.name_zh}</div>
        <div className="org-node-sub">{node.name_en}</div>
        {node.managerNameZh && (
          <div className="org-node-manager">
            <span style={{ color: "var(--muted)", fontSize: 11 }}>{node.managerTitleZh ?? "负责人"}: </span>
            {node.managerNameZh}
          </div>
        )}
        <div className="org-node-type" style={{ color }}>{node.dept_type}</div>
      </div>
    </div>
  );
}

function buildTree(nodes: OrgChartNode[]): Map<number, OrgChartNode[]> {
  const map = new Map<number, OrgChartNode[]>();
  nodes.forEach((n) => {
    const key = n.parent_id ?? 0;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  });
  return map;
}

export function HrOrgChart({ locale }: { locale: Locale }) {
  const [nodes, setNodes] = useState<OrgChartNode[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<OrgChartNode | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "diagram">("tree");

  useEffect(() => {
    Promise.all([
      hrApi.getOrgChart(),
      hrApi.getDepartments(),
      hrApi.getEmployees(),
    ]).then(([orgRes, deptRes, empRes]) => {
      setNodes(orgRes.data?.items ?? []);
      setDepartments(deptRes.items);
      setEmployees(empRes.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const rootNodes = tree.get(0) ?? [];

  const highlighted = useMemo(() => {
    if (!search) return new Set<string>();
    const q = search.toLowerCase();
    return new Set(
      nodes
        .filter(
          (n) =>
            n.name_zh.includes(search) ||
            n.name_en.toLowerCase().includes(q) ||
            (n.managerNameZh ?? "").toLowerCase().includes(q)
        )
        .map((n) => String(n.id))
    );
  }, [nodes, search]);

  const handleEdit = (node: OrgChartNode) => {
    setEditTarget(node);
    setModalOpen(true);
  };

  const handleDelete = async (node: OrgChartNode) => {
    if (!confirm(`Delete department "${node.name_zh}"?`)) return;
    try {
      await hrApi.deleteDepartment(node.id);
      setNodes((prev) => prev.filter((n) => n.id !== node.id));
    } catch (err: any) {
      alert(err.message ?? "Failed to delete");
    }
  };

  const handleAdd = () => {
    setEditTarget(null);
    setModalOpen(true);
  };

  const handleSaved = (dept: Department) => {
    if (editTarget) {
      // Update existing node
      setNodes((prev) =>
        prev.map((n) =>
          n.id === editTarget.id
            ? {
                ...n,
                name_zh: dept.name_zh,
                name_en: dept.name_en,
                name_vi: dept.name_vi,
                dept_type: dept.deptType,
              }
            : n
        )
      );
    } else {
      // Add new node
      const newNode: OrgChartNode = {
        id: dept.id,
        code: dept.code,
        name_zh: dept.name_zh,
        name_en: dept.name_en,
        name_vi: dept.name_vi,
        parent_id: dept.parentId ?? null,
        dept_type: dept.deptType,
        status: dept.status,
        managerId: dept.managerId ?? null,
        managerNameZh: dept.managerNameZh,
        managerTitleZh: dept.managerTitleZh,
        memberCount: 0,
        level: 1,
      };
      setNodes((prev) => [...prev, newNode]);
    }
    // Refresh departments
    hrApi.getDepartments().then((res) => setDepartments(res.items));
  };

  if (loading) {
    return <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}...</div>;
  }

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("nav.orgChart", locale)}</h2>
            <p>{t("page.hr", locale)}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="toolbar" style={{ padding: 0 }}>
              <button
                type="button"
                className={`action-button ${viewMode === "tree" ? "active" : ""}`}
                onClick={() => setViewMode("tree")}
              >
                {t("hr.orgChart.view.tree" as TranslationKey, locale)}
              </button>
              <button
                type="button"
                className={`action-button ${viewMode === "diagram" ? "active" : ""}`}
                onClick={() => setViewMode("diagram")}
              >
                {t("hr.orgChart.view.diagram" as TranslationKey, locale)}
              </button>
            </div>
            {viewMode === "tree" && (
              <input
                type="text"
                placeholder={t("ui.searchInput", locale)}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ fontSize: 12, padding: "4px 10px", minWidth: 200 }}
              />
            )}
            <button className="btn-primary" onClick={handleAdd}>
              + {t("buttons.create", locale)}
            </button>
          </div>
        </div>
      </div>

      {viewMode === "diagram" ? (
        <section className="surface-panel" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          <p>3D 组织图（已禁用）</p>
        </section>
      ) : (
      <section className="surface-panel">
        {nodes.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
            {t("common.noData", locale)}
          </div>
        ) : (
          <div className="org-tree">
            {rootNodes.map((node) => (
              <OrgNode
                key={node.id}
                node={node}
                tree={tree}
                expanded={expanded}
                onToggle={(id) => {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
                onEdit={handleEdit}
                onDelete={handleDelete}
                highlighted={highlighted}
                locale={locale}
              />
            ))}
          </div>
        )}
      </section>
      )}

      {modalOpen && (
        <DepartmentModal
          locale={locale}
          department={editTarget ? departments.find((d) => d.id === editTarget.id) ?? null : null}
          departments={departments}
          employees={employees}
          onClose={() => setModalOpen(false)}
          onSaved={handleSaved}
          onDelete={editTarget ? (dept) => { setModalOpen(false); handleDelete(editTarget); } : undefined}
        />
      )}
    </div>
  );
}

function OrgNode({
  node,
  tree,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  highlighted,
  locale,
}: {
  node: OrgChartNode;
  tree: Map<number, OrgChartNode[]>;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onEdit: (node: OrgChartNode) => void;
  onDelete: (node: OrgChartNode) => void;
  highlighted: Set<string>;
  locale: Locale;
}) {
  const children = tree.get(node.id) ?? [];
  const color = DEPT_COLORS[node.dept_type] ?? DEPT_COLORS.general;
  const isHighlighted = highlighted.has(String(node.id));

  return (
    <div className="org-node-row">
      <div className="org-node-wrapper">
        <div
          className={`org-node ${isHighlighted ? "org-node-highlighted" : ""}`}
          style={{ borderTop: `3px solid ${color}` }}
          onClick={() => children.length > 0 ? onToggle(node.id) : undefined}
          title={node.name_zh}
        >
          <div className="org-node-actions" style={{ position: "absolute", top: 4, right: 4, display: "flex", gap: 4, zIndex: 10 }}>
            <button
              className="btn-ghost btn-sm"
              onClick={(e) => { e.stopPropagation(); onEdit(node); }}
              title={t("buttons.edit", locale)}
            >
              ✎
            </button>
            <button
              className="btn-ghost btn-sm"
              onClick={(e) => { e.stopPropagation(); onDelete(node); }}
              title={t("buttons.delete", locale)}
              style={{ color: "var(--danger)" }}
            >
              ✕
            </button>
          </div>
          {children.length > 0 && (
            <div className="org-node-toggle">{expanded.has(node.id) ? "▼" : "▶"}</div>
          )}
          <div className="org-node-badge" style={{ background: color }}>
            {node.memberCount}
          </div>
          <div className="org-node-name">{node.name_zh}</div>
          <div className="org-node-sub">{node.name_en}</div>
          {node.managerNameZh && (
            <div className="org-node-manager">
              <span style={{ color: "var(--muted)", fontSize: 11 }}>{node.managerTitleZh ?? ""} </span>
              {node.managerNameZh}
            </div>
          )}
          <div className="org-node-type" style={{ color }}>{node.dept_type}</div>
        </div>
      </div>

      {children.length > 0 && expanded.has(node.id) && (
        <div className="org-children">
          {children.map((child) => (
            <OrgNode
              key={child.id}
              node={child}
              tree={tree}
              expanded={expanded}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
              highlighted={highlighted}
              locale={locale}
            />
          ))}
        </div>
      )}
    </div>
  );
}
