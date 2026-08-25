import { createCanvas, Image } from "canvas";
import QRCode from "qrcode";

export async function generateEmployeeQrPng({ employeeId, employeeNo, nameZh, nameVi, gender, phone, position, hireDate, birthDate, qrContent, expiresAt }) {
  const lines = [
    `EMP NO   | ${employeeNo}`,
    `NAME     | ${nameZh}`,
    `VIỆT NAM | ${nameVi}`,
    `GENDER   | ${gender}`,
    `PHONE    | ${phone}`,
    `POSITION | ${position}`,
    `HIRE DATE| ${hireDate}`,
    `DOB      | ${birthDate}`,
    `EXPIRES  | ${expiresAt ? String(expiresAt).slice(0, 10) : "—"}`,
    "─".repeat(28),
    "SCAN TO VERIFY",
  ];

  const labelWidth = 260;
  const lineHeight = 22;
  const padding = 16;
  const headerH = 48;
  const qrSize = 300;
  const labelH = lines.length * lineHeight + padding * 2;
  const extraH = 60; // footer space
  const totalH = headerH + Math.max(labelH, qrSize) + extraH;
  const totalW = padding * 2 + qrSize + 16 + labelWidth;

  const canvas = createCanvas(totalW, totalH);
  const ctx = canvas.getContext("2d");

  // Background white
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalW, totalH);

  // Header bar
  ctx.fillStyle = "#3730a3";
  ctx.fillRect(0, 0, totalW, headerH);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("VIETNAM SMT FACTORY", padding, 30);
  ctx.font = "12px sans-serif";
  ctx.fillText("Employee QR Code  |  1-Year Valid", padding, headerH - 10);

  // QR code (left)
  const qrX = padding;
  const qrY = headerH + padding;
  const qrDataUrl = await QRCode.toDataURL(qrContent, {
    errorCorrectionLevel: "M",
    type: "image/png",
    width: qrSize,
    margin: 2,
    color: { dark: "#1a1a2e", light: "#ffffff" },
  });
  const qrImg = await loadImg(qrDataUrl);
  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

  // Label panel (right of QR)
  const lx = qrX + qrSize + 16;
  const ly = qrY;
  const lw = labelWidth;

  ctx.fillStyle = "#f5f3ff";
  ctx.strokeStyle = "#c7d2fe";
  ctx.lineWidth = 1;
  roundRect(ctx, lx, ly, lw, labelH, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#3730a3";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText("EMPLOYEE INFO", lx + padding, ly + 24);

  ctx.strokeStyle = "#c7d2fe";
  ctx.beginPath();
  ctx.moveTo(lx + padding, ly + 32);
  ctx.lineTo(lx + lw - padding, ly + 32);
  ctx.stroke();

  ctx.fillStyle = "#374151";
  ctx.font = "12px monospace";
  lines.forEach((line, i) => {
    const isField = line.includes("|");
    ctx.fillStyle = isField ? "#1f2937" : "#6b7280";
    ctx.font = isField ? "bold 12px monospace" : "11px monospace";
    const [field, ...vals] = line.split("|");
    ctx.fillText(field.trim() + "  " + (vals.join("|").trim() ?? ""), lx + padding, ly + 48 + i * lineHeight);
  });

  // Footer
  const fy = headerH + padding + qrSize + 12;
  ctx.fillStyle = "#9ca3af";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Employee ID: ${employeeId}  |  Scan to verify attendance  |  Valid 365 days`, totalW / 2, fy);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
