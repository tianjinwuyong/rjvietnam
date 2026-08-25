import { useEffect, useState } from "react";
import QRCode from "qrcode";

export const warehouseAreaQrValue = (areaCode: string) => `WMS-AREA:${areaCode.trim().toUpperCase()}`;

/** 2D-only QR view. Keep this separate from the Three.js QR tag so WMS pages
 * do not pull the 3D runtime into the initial application bundle. */
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
