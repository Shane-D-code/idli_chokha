// TEMP-DIAG: decode a playwright PNG screenshot and print a coarse RGB grid
// + up to N named probe points, so screenshots can be verified by arithmetic.
import fs from "node:fs";
import zlib from "node:zlib";

const file = process.argv[2];
const buf = fs.readFileSync(file);
if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");

let pos = 8;
let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
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
  } else if (type === "IDAT") {
    idat.push(data);
  } else if (type === "IEND") {
    break;
  }
  pos += 12 + len;
}
if (bitDepth !== 8) throw new Error("bitdepth " + bitDepth);
if (interlace !== 0) throw new Error("interlaced unsupported");
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
if (!channels) throw new Error("colortype " + colorType + " unsupported");
const bpp = channels;

const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = width * channels;
const out = Buffer.alloc(width * height * 4);
const scan = Buffer.alloc(stride);
const prev = Buffer.alloc(stride);
let o = 0;
for (let y = 0; y < height; y++) {
  const filter = raw[o++];
  raw.copy(scan, 0, o, o + stride);
  o += stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? scan[x - bpp] : 0;
    const b = prev[x];
    const c = x >= bpp ? prev[x - bpp] : 0;
    let v = scan[x];
    if (filter === 1) v = (v + a) & 0xff;
    else if (filter === 2) v = (v + b) & 0xff;
    else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = (v + pr) & 0xff;
    }
    scan[x] = v;
    const ch = x % channels;
    const oo = y * width * 4 + (x - ch) * 4 / channels * 4;
    // we need per-pixel mapping; recompute per pixel below instead
  }
  prev.copy(scan);
}
// simpler: redo row unfilter into out
void out;

const raw2 = zlib.inflateSync(Buffer.concat(idat));
const scan2 = Buffer.alloc(stride);
const prev2 = Buffer.alloc(stride);
let p2 = 0;
for (let y = 0; y < height; y++) {
  const filter = raw2[p2++];
  raw2.copy(scan2, 0, p2, p2 + stride);
  p2 += stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? scan2[x - bpp] : 0;
    const b = prev2[x];
    const c = x >= bpp ? prev2[x - bpp] : 0;
    let v = scan2[x];
    if (filter === 1) v = (v + a) & 0xff;
    else if (filter === 2) v = (v + b) & 0xff;
    else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
    else if (filter === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = (v + pr) & 0xff;
    }
    scan2[x] = v;
    const px = (x / channels) >> 0;
    const oo = (y * width + px) * 4;
    const ch = x % channels;
    if (ch === 0) { out[oo] = v; out[oo + 1] = 0; out[oo + 2] = 0; }
    if (colorType === 6) {
      if (ch === 1) out[oo + 1] = v;
      else if (ch === 2) out[oo + 2] = v;
      else if (ch === 3) out[oo + 3] = v;
    } else if (colorType === 2) {
      if (ch === 1) out[oo + 1] = v;
      else if (ch === 2) out[oo + 2] = v;
      out[oo + 3] = 255;
    } else if (colorType === 4) {
      if (ch === 1) out[oo + 3] = v;
      out[oo + 1] = out[oo];
      out[oo + 2] = out[oo];
    } else if (colorType === 0) {
      out[oo + 1] = out[oo];
      out[oo + 2] = out[oo];
      out[oo + 3] = 255;
    }
  }
  prev2.copy(scan2);
}

function lum(i) { return (out[i] * 0.2126 + out[i + 1] * 0.7152 + out[i + 2] * 0.0722); }
function mean(x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
      const i = (y * width + x) * 4;
      r += out[i]; g += out[i + 1]; b += out[i + 2]; n++;
    }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

// coarse grid 60 cols
const cols = 60, rows = 34;
console.log(`PNG ${width}x${height} channel-coded (sRGB values)`);
for (let gy = 0; gy < rows; gy++) {
  let line = "";
  for (let gx = 0; gx < cols; gx++) {
    const c = mean(gx * width / cols, gy * height / rows, (gx + 1) * width / cols, (gy + 1) * height / rows);
    const L = (c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722);
    const ch = L > 200 ? "#" : L > 140 ? "+" : L > 90 ? "X" : L > 50 ? "*" : L > 20 ? "-" : L > 5 ? "." : " ";
    line += ch;
  }
  console.log(line);
}
for (const [label, x0, y0, x1, y1] of process.argv.slice(3).map((s) => s.split(",")).filter((a) => a.length === 5)) {
  const c = mean(+x0, +y0, +x1, +y1);
  console.log(`probe ${label}: mean rgb(${c.r},${c.g},${c.b})` + (c.b - c.r >= 25 ? " [BLUE-LEADING]" : c.r - c.b >= 20 ? " [RED-LEADING]" : ""));
}