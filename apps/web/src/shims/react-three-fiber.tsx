import type { CSSProperties, ReactNode } from "react";

export function Canvas({ className, style }: { children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={className}
      style={{ ...style, display: "grid", placeItems: "center", background: "#0f172a", color: "#94a3b8" }}
    >
      3D显示已停用
    </div>
  );
}

export function useFrame() {}

export function useThree() {
  return {
    camera: null,
    gl: null,
    scene: null,
    size: { width: 0, height: 0 },
    raycaster: null,
    pointer: { x: 0, y: 0 },
  };
}
