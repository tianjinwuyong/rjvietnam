import io
p = r'apps/web/src/wms/WmsIqcFlowPages.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) Add deleteAll handler next to deletePreIqcRow
anchor = '  const deletePreIqcRow = async (lot: string) => {'
handler = '''  const deleteAllPreIqc = async () => {
    if (!window.confirm("\u5168\u90e8\u5220\u9664\uff1f\u5c06\u6e05\u7a7a\u6240\u6709\u5f85\u68c0\u6536\u6599\u7ed1\u5b9a\uff08\u7bb1\u7ed1\u5b9a + \u7269\u6599\u6279 + \u6d41\u6c34\uff09\u3002")) return;
    try {
      const r: any = await apiClient.delete("/wms/receiving/pre-iqc");
      const d = r?.deleted || r?.data?.deleted || {};
      setMessage(`\u5df2\u5168\u90e8\u5220\u9664\uff1a${d.lots ?? 0} \u6279 / ${d.boxes ?? 0} \u7bb1`);
      setIqcDecisions({});
      setPreIqcRows([]);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
'''
assert anchor in s, "anchor not found"
s = s.replace(anchor, handler + anchor, 1)

# 2) Add the delete-all button next to 提交到WMS
old_btn = '<button type="button" className="btn btn-primary" onClick={() => void submitPreIqcDecisions()}>\u63d0\u4ea4\u5230WMS</button></div>'
new_btn = '<div style={{ display: "flex", gap: 8 }}><button type="button" className="btn btn-secondary" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => void deleteAllPreIqc()}>\u5168\u90e8\u5220\u9664</button><button type="button" className="btn btn-primary" onClick={() => void submitPreIqcDecisions()}>\u63d0\u4ea4\u5230WMS</button></div></div>'
assert old_btn in s, "button not found"
s = s.replace(old_btn, new_btn, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print("patched OK")
