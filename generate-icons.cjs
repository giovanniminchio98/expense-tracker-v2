// Generates the app icons (no external deps) in the futuristic theme:
// a dark nebula background, a faint neuron network, and a centered € mark.
// Renders at 2x and downsamples for anti-aliasing. Run: node generate-icons.cjs
const zlib = require("zlib");
const fs = require("fs");

// ---- tiny PNG encoder (RGBA, 8-bit) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- drawing helpers (work on a Float buffer at supersample resolution) ----
function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
const PALETTE = [[138,180,255],[177,140,255],[255,154,209],[127,224,192],[255,210,127],[127,212,255]];

function render(size) {
  const S = size * 2;            // supersample
  const px = new Float32Array(S * S * 3);

  // --- background: diagonal gradient + colored blooms ---
  const A = [12, 16, 44], B = [5, 6, 16];
  const blooms = [
    { x: 0.20, y: 0.22, c: [99, 102, 241], s: 0.85, r: 0.7 },
    { x: 0.84, y: 0.30, c: [34, 211, 238], s: 0.7,  r: 0.6 },
    { x: 0.62, y: 0.84, c: [236, 72, 153], s: 0.7,  r: 0.65 },
    { x: 0.30, y: 0.78, c: [16, 185, 129], s: 0.5,  r: 0.55 },
  ];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const nx = x / S, ny = y / S, t = (nx + ny) / 2;
      let r = A[0] + (B[0] - A[0]) * t;
      let g = A[1] + (B[1] - A[1]) * t;
      let b = A[2] + (B[2] - A[2]) * t;
      for (const bl of blooms) {
        const d = Math.hypot(nx - bl.x, ny - bl.y);
        const f = Math.max(0, 1 - d / bl.r);
        const k = f * f * bl.s;
        r += bl.c[0] * k * 0.5; g += bl.c[1] * k * 0.5; b += bl.c[2] * k * 0.5;
      }
      const i = (y * S + x) * 3;
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }

  const blend = (cx, cy, rad, col, alpha) => {
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(S - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(S - 1, Math.ceil(cy + rad));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > rad) continue;
      const a = alpha * Math.min(1, (rad - d) / Math.max(1, rad * 0.4));
      const i = (y * S + x) * 3;
      px[i] = px[i] * (1 - a) + col[0] * a;
      px[i + 1] = px[i + 1] * (1 - a) + col[1] * a;
      px[i + 2] = px[i + 2] * (1 - a) + col[2] * a;
    }
  };
  const line = (x0, y0, x1, y1, col, alpha, thk) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= steps; s++) {
      const tt = s / steps;
      blend(x0 + (x1 - x0) * tt, y0 + (y1 - y0) * tt, thk, col, alpha);
    }
  };

  // --- faint neuron network ---
  const nodes = [
    [0.10,0.16],[0.28,0.08],[0.50,0.05],[0.86,0.16],[0.93,0.36],
    [0.06,0.42],[0.12,0.70],[0.24,0.90],[0.55,0.95],[0.82,0.86],[0.95,0.64]
  ].map(([nx, ny], idx) => ({ x: nx * S, y: ny * S, c: PALETTE[idx % PALETTE.length] }));
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (d < 0.42 * S) line(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y, nodes[i].c, 0.16, S * 0.004);
    }
  for (const n of nodes) blend(n.x, n.y, S * 0.012, n.c, 0.7);

  // --- € mark (centered) ---
  const cx = S / 2, cy = S / 2;
  const outerR = 0.30 * S, innerR = 0.205 * S;
  const openAng = 0.62;                 // right opening of the "C"
  const barHalf = 0.052 * S;
  const barXL = cx - outerR * 1.02, barXR = cx + 0.16 * outerR;
  const glyph = [248, 250, 255];
  for (let y = Math.floor(cy - outerR - barHalf); y <= Math.ceil(cy + outerR + barHalf); y++) {
    for (let x = Math.floor(cx - outerR * 1.05); x <= Math.ceil(cx + outerR + 2); x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      let on = false;
      // C ring (open on the right)
      if (d >= innerR && d <= outerR) {
        const ang = Math.atan2(dy, dx);
        if (Math.abs(ang) > openAng) on = true;
      }
      // two horizontal bars
      const bY1 = cy - 0.23 * outerR, bY2 = cy + 0.23 * outerR;
      if (x >= barXL && x <= barXR && (Math.abs(dy - (bY1 - cy)) <= barHalf || Math.abs(dy - (bY2 - cy)) <= barHalf)) on = true;
      if (on) {
        const i = (y * S + x) * 3;
        px[i] = glyph[0]; px[i + 1] = glyph[1]; px[i + 2] = glyph[2];
      }
    }
  }

  // --- downsample 2x -> RGBA ---
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = ((y * 2 + dy) * S + (x * 2 + dx)) * 3;
      r += px[i]; g += px[i + 1]; b += px[i + 2];
    }
    const o = (y * size + x) * 4;
    out[o] = clamp(r / 4); out[o + 1] = clamp(g / 4); out[o + 2] = clamp(b / 4); out[o + 3] = 255;
  }
  return encodePNG(size, size, out);
}

for (const [name, size] of [["icon-512.png", 512], ["icon-192.png", 192], ["apple-touch-icon.png", 180]]) {
  fs.writeFileSync(name, render(size));
  console.log("wrote", name);
}
