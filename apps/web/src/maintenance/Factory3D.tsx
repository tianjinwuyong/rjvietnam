// Factory 3D is isolated in its own Vite process so Three.js uses one React instance.
import { useEffect, useRef, useState } from "react";

export default function Factory3D() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const factory3dUrl = `${window.location.protocol}//${window.location.hostname}:5179/`;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => setLoaded(true);
    iframe.addEventListener("load", onLoad);
    if (iframe.contentDocument?.readyState === "complete") setLoaded(true);
    return () => iframe.removeEventListener("load", onLoad);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh", background: "#0a0e1a" }}>
      {!loaded && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#64748b",
          fontSize: 14,
          zIndex: 1,
        }}>
          Loading 3D Factory...
        </div>
      )}
      <iframe
        ref={iframeRef}
        src={factory3dUrl}
        title="3D Factory Map"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.3s",
        }}
        allow="webgl"
      />
    </div>
  );
}
