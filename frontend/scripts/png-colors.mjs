// PNG color-presence probe for Section 03 screenshots.
// Decodes a PNG (8-bit RGB/RGBA, non-interlaced) and counts pixels close to
// named targets so layout/render can be verified without an image viewer.
import fs from "node:fs";
import zlib from "node:zlib";

const file = process.argv[2];
const buf = fs.readFileSync(file);

let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString("ascii", pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === "IHDR") {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    interlace = data[12];
  } else if (type === "IDAT") idat.push(data);
  else if (type === "IEND") break;
  pos += 12 + len;
}
if (interlace !== 0 || bitDepth !== 8) throw new Error("unsupported png");
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
const stride = width * channels;
const raw = zlib.inflateSync(Buffer.concat(idat));
const px = Buffer.alloc(width * height * 4);
const scan = Buffer.alloc(stride);
const prev = Buffer.alloc(stride);
let p = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[p++];
  raw.copy(scan, 0, p, p + stride);
  p += stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= channels ? scan[x - channels] : 0;
    const b = prev[x];
    const c = x >= channels ? prev[x - channels] : 0;
    let v = scan[x];
    if (filter === 1) v = (v + a) & 0xff;
    else if (filter === 2) v = (v + b) & 0xff;
    else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
    else if (filter === 4) {
      const q = a + b - c;
      const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = (v + pr) & 0xff;
    }
    scan[x] = v;
    const ch = x % channels;
    const o = (y * width + (x / channels | 0)) * 4;
    if (ch === 0) { px[o] = v; px[o + 3] = 255; }
    else if (ch === 1) px[o + 1] = v;
    else if (ch === 2) px[o + 2] = v;
    else if (ch === 3) px[o + 3] = v;
  }
  prev.copy(scan);
}

const targets = {
  Severity_EXTREME: [217, 48, 60],
  Severity_VERY_HIGH: [229, 83, 60],
  Severity_HIGH: [238, 129, 49],
  Severity_MODERATE: [240, 180, 41],
  Severity_LOW: [78, 168, 255],
  Accent_Cyan: [83, 200, 229],
  Ocean_Deep: [6, 21, 37],
  Panel_Dark: [7, 22, 40],
  Ink_NearWhite: [245, 245, 240],
  Matching: [220, 232, 242],
};
const tol = 22;

function near(r, g, b, t) {
  return Math.abs(r - t[0]) <= tol && Math.abs(g - t[1]) <= tol && Math.abs(b - t[2]) <= tol;
}

const counts = {};
const grid = [];
const cell = 48; // sample grid in virtual px, stride across image
let sampled = 0;
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const o = (y * width + x) * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    let best = "Other";
    for (const [name, tgt] of Object.entries(targets)) {
      if (near(r, g, b, tgt)) { best = name; break; }
    }
    counts[best] = (counts[best] ?? 0) + 1;
  }
}

let gridLine = "";
for (let y = 0; y < height; y += cell) {
  for (let x = 0; x < width; x += cell) {
    const o = (y * width + x) * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2];
    let best = ".";
    for (const [name, tgt] of Object.entries(targets)) {
      if (near(r, g, b, tgt)) { best = name[0]; break; }
    }
    gridLine += best;
    sampled++;
  }
  gridLine += "\n";
}

console.log(`image ${width}x${height}`);
const total = width * height;
for (const k of Object.keys(targets)) {
  const c = counts[k] ?? 0;
  console.log(`  ${k}: ${c} px (${(c / total * 100).toFixed(2)}%)`);
}
console.log("other:", counts.Other, "(" + ((counts.Other ?? 0) / total * 100).toFixed(2) + "%)");
console.log("\ncoarse grid (48px cells, one char per cell, top->bottom):");
console.log(gridLine.slice(0, gridLine.length - 1).split("\n").slice(0, Math.floor(height / cell)));