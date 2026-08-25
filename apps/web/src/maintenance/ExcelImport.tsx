import { useState, useCallback } from 'react';
import { maintenanceApi } from '../api/maintenance';

// ═══ Excel批量导入 ═══
// 支持: 设备档案 / 备品备件 / 治具 / 易耗品

type ImportType = 'equipment' | 'spare_parts' | 'fixtures' | 'consumables';

const TYPE_CONFIG: Record<ImportType, { label: string; icon: string; color: string }> = {
  equipment:    { label: '设备档案', icon: '🔧', color: '#3b82f6' },
  spare_parts:  { label: '备品备件', icon: '📦', color: '#22c55e' },
  fixtures:     { label: '治具', icon: '🔩', color: '#8b5cf6' },
  consumables:  { label: '易耗品', icon: '🧪', color: '#f97316' },
};

export default function ExcelImport() {
  const [importType, setImportType] = useState<ImportType>('equipment');
  const [template, setTemplate] = useState<any>(null);
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);

  // Load template
  const loadTemplate = useCallback(async (type: ImportType) => {
    try {
      const res = await maintenanceApi.getImportTemplate(type);
      if (res.success) setTemplate(res.data);
    } catch (e) { console.error(e); }
  }, []);

  // Parse CSV/TSV text
  const parseCSV = (text: string) => {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(/[,\t]/).map(h => h.trim().replace(/\*$/, ''));
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(/[,\t]/).map(v => v.trim());
      const row: any = {};
      headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
      rows.push(row);
    }
    return rows;
  };

  const handleTextChange = (text: string) => {
    setCsvText(text);
    setParsedRows(parseCSV(text));
    setResult(null);
  };

  // File upload handler
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      handleTextChange(text);
    };
    reader.readAsText(file);
  };

  // Download template as CSV
  const downloadTemplate = () => {
    if (!template) return;
    const csv = [template.headers.join(','), template.example.join(',')].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = template.filename.replace('.xlsx', '.csv');
    a.click(); URL.revokeObjectURL(url);
  };

  // Submit import
  const doImport = async () => {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await maintenanceApi.bulkImport(importType, { rows: parsedRows });
      if (res.success) setResult(res.data);
    } catch (e: any) {
      setResult({ total: parsedRows.length, success: 0, failed: parsedRows.length, errors: [{ row: 0, error: e.message }] });
    }
    setImporting(false);
  };

  const tc = TYPE_CONFIG[importType];

  return (
    <div style={{ padding: 24, fontFamily: "'Segoe UI',system-ui,sans-serif", maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', marginBottom: 4 }}>📥 Excel批量导入</h2>
      <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>支持CSV/TSV格式粘贴或文件上传，*号为必填字段</p>

      {/* Type selector */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {(Object.keys(TYPE_CONFIG) as ImportType[]).map(t => (
          <button key={t} onClick={() => { setImportType(t); loadTemplate(t); setResult(null); }}
            style={{
              flex: 1, padding: '14px 16px', borderRadius: 10, border: `2px solid ${importType === t ? TYPE_CONFIG[t].color : '#e2e8f0'}`,
              background: importType === t ? `${TYPE_CONFIG[t].color}11` : '#fff',
              cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
            }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{TYPE_CONFIG[t].icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: importType === t ? TYPE_CONFIG[t].color : '#64748b' }}>{TYPE_CONFIG[t].label}</div>
          </button>
        ))}
      </div>

      {/* Template info */}
      {template && (
        <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>📋 导入模板 ({template.headers.length}列)</span>
            <button onClick={downloadTemplate} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', background: tc.color, color: '#fff',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>⬇️ 下载CSV模板</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {template.headers.map((h: string, i: number) => (
              <span key={i} style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 4,
                background: h.endsWith('*') ? 'rgba(239,68,68,0.1)' : '#e2e8f0',
                color: h.endsWith('*') ? '#ef4444' : '#475569', fontWeight: h.endsWith('*') ? 700 : 400,
              }}>{h}</span>
            ))}
          </div>
        </div>
      )}

      {/* Drop zone + text area */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        style={{
          border: `2px dashed ${dragOver ? tc.color : '#d1d5db'}`, borderRadius: 12, padding: 20,
          background: dragOver ? `${tc.color}08` : '#fff', marginBottom: 16, textAlign: 'center',
          transition: 'all 0.2s',
        }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
        <div style={{ fontSize: 14, color: '#64748b', marginBottom: 12 }}>拖拽CSV文件到此处，或</div>
        <label style={{
          display: 'inline-block', padding: '10px 20px', borderRadius: 8, background: tc.color, color: '#fff',
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          选择文件
          <input type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </label>
      </div>

      {/* Paste area */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 6 }}>或直接粘贴CSV/TSV数据（含表头）：</div>
        <textarea value={csvText} onChange={e => handleTextChange(e.target.value)}
          placeholder={`asset_code,name_zh,category_code,...\nSMT-NPM-001,NPM贴片机,SMT_PICK_PLACE,...`}
          rows={8} style={{
            width: '100%', padding: 14, borderRadius: 10, border: '1px solid #d1d5db',
            fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box',
          }} />
      </div>

      {/* Preview */}
      {parsedRows.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>预览 ({parsedRows.length}行)</span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>前5行</span>
          </div>
          <div style={{ overflow: 'auto', maxHeight: 250 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>#</th>
                  {Object.keys(parsedRows[0] || {}).map(k => (
                    <th key={k} style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#64748b', whiteSpace: 'nowrap' }}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 5).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '6px 12px', color: '#94a3b8' }}>{i + 1}</td>
                    {Object.values(row).map((v, j) => (
                      <td key={j} style={{ padding: '6px 12px', color: '#475569', whiteSpace: 'nowrap' }}>{String(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import button */}
      <button onClick={doImport} disabled={importing || parsedRows.length === 0}
        style={{
          width: '100%', padding: 16, borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700,
          background: importing || parsedRows.length === 0 ? '#94a3b8' : tc.color, color: '#fff',
          cursor: importing || parsedRows.length === 0 ? 'not-allowed' : 'pointer',
        }}>
        {importing ? '⏳ 导入中...' : `📥 导入 ${parsedRows.length} 条${tc.label}数据`}
      </button>

      {/* Result */}
      {result && (
        <div style={{
          marginTop: 16, padding: 20, borderRadius: 10,
          background: result.failed === 0 ? 'rgba(34,197,94,0.06)' : 'rgba(234,179,8,0.06)',
          border: `1px solid ${result.failed === 0 ? 'rgba(34,197,94,0.2)' : 'rgba(234,179,8,0.2)'}`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: result.failed === 0 ? '#22c55e' : '#eab308', marginBottom: 10 }}>
            {result.failed === 0 ? '✅ 全部导入成功' : '⚠️ 部分导入失败'}
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 14, color: '#475569' }}>
            <span>总计: <b>{result.total}</b></span>
            <span style={{ color: '#22c55e' }}>成功: <b>{result.success}</b></span>
            <span style={{ color: '#ef4444' }}>失败: <b>{result.failed}</b></span>
          </div>
          {result.errors?.length > 0 && (
            <div style={{ maxHeight: 200, overflow: 'auto' }}>
              {result.errors.map((e: any, i: number) => (
                <div key={i} style={{ fontSize: 12, color: '#ef4444', padding: '4px 0', borderBottom: '1px solid rgba(239,68,68,0.1)' }}>
                  行{e.row}: {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
