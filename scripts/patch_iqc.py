import io
p = r'apps/web/src/wms/WmsIqcFlowPages.tsx'
s = io.open(p, encoding='utf-8').read()

# 1) Add the delete handler before importIqcGuidance
anchor = '  const importIqcGuidance = async (file?: File) => {'
handler = '''  const deletePreIqcRow = async (lot: string) => {
    if (!window.confirm(`\u5220\u9664\u6279\u6b21 ${lot} \u7684\u6536\u6599\u7ed1\u5b9a\uff1f\u8be5\u6279\u7684\u7bb1\u7ed1\u5b9a/\u6d41\u6c34\u5c06\u4e00\u5e76\u5220\u9664\u3002`)) return;
    try {
      await apiClient.delete(`/wms/receiving/pre-iqc/${encodeURIComponent(lot)}`);
      setMessage(`\u5df2\u5220\u9664\u6279\u6b21 ${lot} \u7684\u6536\u6599\u7ed1\u5b9a`);
      const refreshed: any = await apiClient.get("/wms/receiving/pre-iqc");
      setPreIqcRows(refreshed.items ?? []);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
'''
assert anchor in s, "anchor not found"
s = s.replace(anchor, handler + anchor, 1)

# 2) Add the action header column
old_head = '<th>IQC \u72b6\u6001</th></tr></thead><tbody>{preIqcRows.length === 0 ? <tr><td colSpan={10}>\u6682\u65e0\u5f85\u68c0\u6750\u6599</td></tr>'
new_head = '<th>IQC \u72b6\u6001</th><th>\u64cd\u4f5c</th></tr></thead><tbody>{preIqcRows.length === 0 ? <tr><td colSpan={11}>\u6682\u65e0\u5f85\u68c0\u6750\u6599</td></tr>'
assert old_head in s, "head not found"
s = s.replace(old_head, new_head, 1)

# 3) Add the delete button cell at the end of each row
old_cell = '>{iqc.toUpperCase()}</span>}</td></tr>; })}</tbody></table></div>)}</section>}'
new_cell = '>{iqc.toUpperCase()}</span>}</td><td><button type="button" className="btn btn-secondary" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => void deletePreIqcRow(String(row.lot))}>\u5220\u9664</button></td></tr>; })}</tbody></table></div>)}</section>}'
assert old_cell in s, "cell not found"
s = s.replace(old_cell, new_cell, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print("patched OK")
