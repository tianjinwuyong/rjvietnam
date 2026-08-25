import { useState, useEffect, useCallback } from 'react';
import { maintenanceApi } from '../api/maintenance';

// ═══ 设备BOM树形结构 ═══
// 父子部件关联 / 展开折叠 / 健康状态指示 / 搜索过滤

interface BomNode {
  id: string;
  asset_code: string;
  name_zh: string;
  category_name?: string;
  status: string;
  criticality?: string;
  health_score?: number;
  grade?: string;
  children?: BomNode[];
  parent_id?: string;
}

const STATUS_DOT: Record<string, string> = {
  active: '#22c55e', online: '#22c55e', idle: '#eab308', offline: '#6b7280',
  maintenance: '#3b82f6', fault: '#ef4444', repair: '#f97316', scrapped: '#374151',
};
const GRADE_COLOR: Record<string, string> = {
  A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444',
};

export default function EquipmentBom() {
  const [tree, setTree] = useState<BomNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<BomNode | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('tree');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await maintenanceApi.getHealth();
      if (res.success) {
        // Build tree from flat data using parent_id or line grouping
        const data = res.data || [];
        // Group by line as top-level, equipment as children
        const byLine: Record<string, BomNode[]> = {};
        data.forEach((eq: any) => {
          const line = eq.line_code || '未分配';
          if (!byLine[line]) byLine[line] = [];
          byLine[line].push({
            id: eq.id, asset_code: eq.asset_code, name_zh: eq.name_zh,
            category_name: eq.category_name, status: eq.status,
            criticality: eq.criticality, health_score: eq.health_score, grade: eq.grade,
          });
        });
        const treeData: BomNode[] = Object.entries(byLine).map(([line, equips]) => ({
          id: `line-${line}`, asset_code: line, name_zh: `${line} 产线`,
          status: equips.some(e => e.status === 'fault') ? 'fault' : 'active',
          children: equips.sort((a, b) => (a.asset_code || '').localeCompare(b.asset_code || '')),
        }));
        setTree(treeData);
        // Auto-expand first level
        setExpanded(new Set(treeData.map(t => t.id)));
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const all = new Set<string>();
    const walk = (nodes: BomNode[]) => {
      nodes.forEach(n => { all.add(n.id); if (n.children) walk(n.children); });
    };
    walk(tree);
    setExpanded(all);
  };

  const collapseAll = () => setExpanded(new Set());

  // Filter by search
  const filterTree = (nodes: BomNode[], term: string): BomNode[] => {
    if (!term) return nodes;
    const lower = term.toLowerCase();
    return nodes.filter(n => {
      const match = n.asset_code?.toLowerCase().includes(lower) ||
                    n.name_zh?.toLowerCase().includes(lower) ||
                    n.category_name?.toLowerCase().includes(lower);
      const childMatch = n.children?.some(c =>
        c.asset_code?.toLowerCase().includes(lower) || c.name_zh?.toLowerCase().includes(lower));
      return match || childMatch;
    }).map(n => ({
      ...n,
      children: n.children ? filterTree(n.children, term) : undefined,
    }));
  };

  const filtered = filterTree(tree, search);

  // Stats
  const allNodes: BomNode[] = [];
  const flatten = (nodes: BomNode[]) => {
    nodes.forEach(n => {
      if (n.children) flatten(n.children);
      else allNodes.push(n);
    });
  };
  flatten(tree);
  const faultCount = allNodes.filter(n => n.status === 'fault' || n.status === 'repair').length;
  const avgHealth = allNodes.length ? Math.round(allNodes.reduce((s, n) => s + (n.health_score || 0), 0) / allNodes.length) : 0;

  // Render tree node
  const renderNode = (node: BomNode, depth: number): React.ReactNode => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded.has(node.id);
    const isLeaf = !hasChildren;
    const dotColor = STATUS_DOT[node.status] || '#6b7280';
    const gradeColor = node.grade ? GRADE_COLOR[node.grade] : undefined;

    return (
      <div key={node.id}>
        <div
          onClick={() => {
            if (hasChildren) toggleExpand(node.id);
            if (isLeaf) setSelected(node);
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            paddingLeft: 12 + depth * 24, cursor: 'pointer', borderRadius: 8,
            background: selected?.id === node.id ? 'rgba(59,130,246,0.1)' : 'transparent',
            transition: 'background 0.15s', marginBottom: 2,
          }}
          onMouseEnter={e => { if (selected?.id !== node.id) (e.currentTarget as HTMLElement).style.background = 'rgba(148,163,184,0.06)'; }}
          onMouseLeave={e => { if (selected?.id !== node.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {/* Expand/collapse icon */}
          {hasChildren ? (
            <span style={{ fontSize: 12, color: '#94a3b8', width: 16, textAlign: 'center', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
          ) : (
            <span style={{ width: 16, textAlign: 'center', fontSize: 10, color: '#475569' }}>•</span>
          )}

          {/* Status dot */}
          <span style={{
            width: 10, height: 10, borderRadius: '50%', background: dotColor, flexShrink: 0,
            boxShadow: (node.status === 'fault' || node.status === 'repair') ? `0 0 8px ${dotColor}` : 'none',
            animation: (node.status === 'fault') ? 'bomPulse 1.5s infinite' : 'none',
          }} />

          {/* Name */}
          <span style={{ fontSize: 13, fontWeight: isLeaf ? 400 : 700, color: isLeaf ? '#e2e8f0' : '#93c5fd', flex: 1 }}>
            {node.asset_code}
            {node.name_zh && <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 8 }}>{node.name_zh}</span>}
          </span>

          {/* Badges */}
          {isLeaf && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {node.criticality === 'A' && (
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}>关键</span>
              )}
              {node.grade && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 3, fontWeight: 700,
                  background: `${gradeColor}22`, color: gradeColor,
                }}>{node.grade} | {node.health_score}</span>
              )}
            </div>
          )}

          {/* Children count */}
          {hasChildren && (
            <span style={{ fontSize: 11, color: '#64748b' }}>{node.children!.length}台</span>
          )}
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div style={{ borderLeft: '1px solid rgba(148,163,184,0.1)', marginLeft: 20 + depth * 24 }}>
            {node.children!.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8' }}>加载BOM树...</div>;

  return (
    <div style={{ padding: 24, fontFamily: "'Segoe UI',system-ui,sans-serif", background: '#0f172a', minHeight: '100vh', color: '#e2e8f0' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, background: 'linear-gradient(90deg,#3b82f6,#8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>🌳 设备BOM树</h2>
          <span style={{ fontSize: 12, color: '#64748b' }}>{allNodes.length}台设备 | 平均健康度 {avgHealth} | 故障 {faultCount}台</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={expandAll} style={btnStyle}>展开全部</button>
          <button onClick={collapseAll} style={btnStyle}>折叠全部</button>
          <button onClick={() => setViewMode(v => v === 'tree' ? 'flat' : 'tree')} style={btnStyle}>
            {viewMode === 'tree' ? '📋 平铺' : '🌳 树形'}
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索设备编号/名称/类别..."
          style={{
            width: '100%', padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(148,163,184,0.2)',
            background: 'rgba(30,41,59,0.6)', color: '#e2e8f0', fontSize: 14, boxSizing: 'border-box', outline: 'none',
          }} />
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        {/* Tree */}
        <div style={{ flex: 1, background: 'rgba(30,41,59,0.4)', borderRadius: 12, padding: 16, maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }}>
          {viewMode === 'tree' ? (
            filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>无匹配设备</div>
            ) : (
              filtered.map(node => renderNode(node, 0))
            )
          ) : (
            /* Flat view */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {allNodes.filter(n => !search || n.asset_code?.toLowerCase().includes(search.toLowerCase()) || n.name_zh?.toLowerCase().includes(search.toLowerCase()))
                .map(n => (
                  <div key={n.id} onClick={() => setSelected(n)} style={{
                    padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                    background: selected?.id === n.id ? 'rgba(59,130,246,0.15)' : 'rgba(15,23,42,0.6)',
                    border: `1px solid ${selected?.id === n.id ? 'rgba(59,130,246,0.3)' : 'rgba(148,163,184,0.1)'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[n.status] || '#6b7280' }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>{n.asset_code}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{n.name_zh}</div>
                    {n.grade && (
                      <div style={{ marginTop: 6, fontSize: 11, color: GRADE_COLOR[n.grade], fontWeight: 600 }}>
                        {n.grade}级 | 健康度 {n.health_score}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ width: 320, background: 'rgba(30,41,59,0.6)', borderRadius: 12, padding: 20, border: '1px solid rgba(148,163,184,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>{selected.asset_code}</span>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>{selected.name_zh} | {selected.category_name || '-'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `3px solid ${selected.grade ? GRADE_COLOR[selected.grade] : '#64748b'}`,
                fontSize: 24, fontWeight: 800, color: selected.grade ? GRADE_COLOR[selected.grade] : '#64748b',
              }}>{selected.health_score || '-'}</div>
              <div>
                <div style={{ fontSize: 14, color: '#e2e8f0' }}>{selected.grade || '-'}级</div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>关键度 {selected.criticality || '-'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[selected.status] || '#6b7280' }} />
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{selected.status}</span>
                </div>
              </div>
            </div>
            <div style={{ padding: 14, background: 'rgba(15,23,42,0.6)', borderRadius: 10, fontSize: 12, color: '#94a3b8' }}>
              点击左侧树形结构中的设备节点查看详情。故障设备以红色脉冲指示。
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes bomPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.2)',
  background: 'rgba(30,41,59,0.6)', color: '#e2e8f0', fontSize: 12, cursor: 'pointer',
};
