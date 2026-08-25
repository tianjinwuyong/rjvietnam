import { Billboard } from "@react-three/drei";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import * as THREE from "three";

export const warehouseAreaQrValue = (areaCode: string) => `WMS-AREA:${areaCode.trim().toUpperCase()}`;

export function WarehouseQrTag({ value, position = [0, 0, 0], size = 0.42, onClick }: {
  value: string;
  position?: [number, number, number];
  size?: number;
  onClick?: () => void;
}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let disposed = false;
    let nextTexture: THREE.Texture | null = null;
    void QRCode.toDataURL(value, { width: 160, margin: 1, errorCorrectionLevel: "M" }).then(url => {
      if (disposed) return;
      nextTexture = new THREE.TextureLoader().load(url, loaded => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.needsUpdate = true;
        setTexture(loaded);
      });
    });
    return () => { disposed = true; nextTexture?.dispose(); };
  }, [value]);
  if (!texture) return null;
  return <Billboard position={position} follow lockX={false} lockY={false} lockZ={false}>
    <mesh onClick={onClick ? event => { event.stopPropagation(); onClick(); } : undefined}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={texture} color="#ffffff" toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  </Billboard>;
}

export function WarehouseQrImage({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, { width: 180, margin: 1, errorCorrectionLevel: "M" }).then(url => { if (active) setSrc(url); });
    return () => { active = false; };
  }, [value]);
  return <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 9, marginBottom: 8, border: "1px solid #dbe3ec", borderRadius: 8, background: "#f8fafc" }}>
    {src && <img src={src} width={74} height={74} alt={`${label} QR`} style={{ imageRendering: "pixelated", background: "white" }} />}
    <div style={{ minWidth: 0 }}><strong style={{ display: "block", fontSize: 12 }}>{label}</strong><code style={{ display: "block", marginTop: 5, fontSize: 10, overflowWrap: "anywhere" }}>{value}</code></div>
  </div>;
}
