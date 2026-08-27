export function MsMoistureControlDiagram() {
  return (
    <section className="surface-panel" aria-labelledby="ms-moisture-flow-title" style={{ overflowX: "auto" }}>
      <div className="section-header" style={{ marginBottom: 8 }}>
        <div>
          <h3 id="ms-moisture-flow-title" style={{ margin: 0 }}>MS物料防潮控制流程</h3>
          <p style={{ margin: "4px 0 0", fontSize: 12 }}>收货 → QR绑定仓库 → IQC湿度判定 → 受控存储 → 发料前确认 → 产线使用</p>
        </div>
        <span className="badge badge-warning" style={{ whiteSpace: "nowrap" }}>湿度控制主流程</span>
      </div>
      <svg viewBox="0 0 1180 250" role="img" aria-labelledby="ms-moisture-svg-title ms-moisture-svg-desc" style={{ width: "100%", minWidth: 980, height: "auto", display: "block" }}>
        <title id="ms-moisture-svg-title">MS物料防潮控制流程图</title>
        <desc id="ms-moisture-svg-desc">MS物料从收货、QR绑定仓库到IQC湿度判定、受控存储、发料和产线使用的防潮控制流程，并显示不合格物料进入隔离和MRB评审。</desc>
        <defs>
          <marker id="ms-flow-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#64748b" /></marker>
          <marker id="ms-flow-accent-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="#d97706" /></marker>
        </defs>
        <rect width="1180" height="250" rx="8" fill="#f8fafc" />
        <path d="M160 104 H188" fill="none" stroke="#64748b" strokeWidth="2" markerEnd="url(#ms-flow-arrow)" />
        <path d="M348 104 H376" fill="none" stroke="#d97706" strokeWidth="2" markerEnd="url(#ms-flow-accent-arrow)" />
        <path d="M536 104 H564" fill="none" stroke="#d97706" strokeWidth="2" markerEnd="url(#ms-flow-accent-arrow)" />
        <path d="M724 104 H752" fill="none" stroke="#64748b" strokeWidth="2" markerEnd="url(#ms-flow-arrow)" />
        <path d="M912 104 H940" fill="none" stroke="#64748b" strokeWidth="2" markerEnd="url(#ms-flow-arrow)" />
        <path d="M644 136 V190 H760 V160" fill="none" stroke="#dc2626" strokeWidth="1.6" strokeDasharray="5 4" markerEnd="url(#ms-flow-arrow)" />
        <g fontFamily="'Microsoft YaHei','Noto Sans SC',sans-serif" textAnchor="middle">
          <g><rect x="32" y="72" width="128" height="64" rx="7" fill="#fff" stroke="#64748b" /><text x="96" y="101" fontSize="15" fontWeight="700" fill="#1e293b">收货来源</text><text x="96" y="121" fontSize="11" fill="#64748b">采购 / 退料 / 返工 / 外协</text></g>
          <g><rect x="188" y="72" width="160" height="64" rx="7" fill="#fff" stroke="#334155" /><text x="268" y="101" fontSize="15" fontWeight="700" fill="#1e293b">收货仓库待办</text><text x="268" y="121" fontSize="11" fill="#64748b">批次、包装、MSL标识</text></g>
          <g><rect x="376" y="72" width="160" height="64" rx="7" fill="#fffbeb" stroke="#d97706" strokeWidth="2" /><text x="456" y="101" fontSize="15" fontWeight="700" fill="#1e293b">QR绑定仓库</text><text x="456" y="121" fontSize="11" fill="#92400e">绑定仓位与批次</text></g>
          <g><rect x="564" y="72" width="160" height="64" rx="7" fill="#fff" stroke="#334155" /><text x="644" y="101" fontSize="15" fontWeight="700" fill="#1e293b">IQC湿度检验</text><text x="644" y="121" fontSize="11" fill="#64748b">包装 / 湿度指示卡 / MSL</text></g>
          <g><rect x="752" y="72" width="160" height="64" rx="7" fill="#fff" stroke="#334155" /><text x="832" y="101" fontSize="15" fontWeight="700" fill="#1e293b">受控仓储</text><text x="832" y="121" fontSize="11" fill="#64748b">干燥柜 / 湿度记录 / 期限</text></g>
          <g><rect x="940" y="72" width="160" height="64" rx="7" fill="#fff" stroke="#334155" /><text x="1020" y="101" fontSize="15" fontWeight="700" fill="#1e293b">发料前确认</text><text x="1020" y="121" fontSize="11" fill="#64748b">暴露时间 / 剩余Floor Life</text></g>
          <g><rect x="940" y="176" width="160" height="48" rx="7" fill="#fef2f2" stroke="#dc2626" /><text x="1020" y="197" fontSize="14" fontWeight="700" fill="#991b1b">隔离 → MRB评审</text><text x="1020" y="214" fontSize="10" fill="#b91c1c">不合格 / 超时 / 受潮</text></g>
        </g>
        <g fontFamily="'Microsoft YaHei','Noto Sans SC',sans-serif" fontSize="11" fill="#64748b"><text x="742" y="164">合格</text><text x="696" y="184" fill="#dc2626">不合格 / 超限</text></g>
      </svg>
    </section>
  );
}
