import React, { Component, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; errorMessage: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }
  static getDerivedStateFromError(error: unknown) {
    const details = String(error instanceof Error ? error.message + (error.stack ? "\n" + error.stack : "") : JSON.stringify(error, null, 2));
    console.error("[ErrorBoundary] Caught:", error, "details:", details);
    return { hasError: true, errorMessage: details };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] componentDidCatch error:", error, "info:", info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, textAlign: "center", color: "#c62828" }}>
          <h2>加载错误 (3D组件崩溃)</h2>
          <p>某些3D组件在此环境无法运行，应用其余部分正常。</p>
          <details style={{ marginTop: 16, textAlign: "left", color: "#333", background: "#f5f5f5", padding: 8, borderRadius: 4 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>错误详情（仅供调试）</summary>
            <pre style={{ fontSize: 12, overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {this.state.errorMessage || "未知错误"}
            </pre>
          </details>
          <button onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div style={{ padding: 32, textAlign: "center" }}>正在加载系统…</div>}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </React.StrictMode>,
);

// PWA Service Worker registration (disabled in development — causes stale cache issues)
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js')
//       .then((reg) => console.log('SW registered:', reg.scope))
//       .catch((err) => console.log('SW registration failed:', err));
//   });
// }
