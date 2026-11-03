import fs from 'node:fs';
import zlib from 'node:zlib';

const p = process.argv[2];
const buf = fs.readFileSync(p);
let off = 8;
let w = 0, h = 0, depth = 0, ctype = 0;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') {
    w = data.readUInt32BE(0); h = data.readUInt32BE(4);
    depth = data[8]; ctype = data[9];
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  off += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : 1;
const bpp = ch * (depth / 8);
const stride = w * bpp;
const out = Buffer.alloc(h * stride);
let pos = 0;
for (let y = 0; y < h; y++) {
  const ft = raw[pos++];
  const line = raw.subarray(pos, pos + stride); pos += stride;
  const cur = out.subarray(y * stride, (y + 1) * stride);
  const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= bpp ? prev[x - bpp] : 0;
    let v = line[x];
    if (ft === 1) v += a;
    else if (ft === 2) v += b;
    else if (ft === 3) v += (a + b) >> 1;
    else if (ft === 4) {
      const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
    }
    cur[x] = v & 0xff;
  }
}

function px(x, y) {
  const i = y * stride + x * bpp;
  return [out[i], out[i + 1], out[i + 2]];
}

console.log(`size ${w}x${h} ctype=${ctype} depth=${depth}`);
for (const y of [5, h >> 1, h - 40, h - 25, h - 20, h - 15, h - 10, h - 5, h - 1]) {
  const a = px(40, y), b = px(Math.floor(w * 0.5), y), c = px(w - 30, y);
  console.log(`y=${String(y).padStart(4)} sidebar=${a} mid=${b} right=${c}`);
}
