// Procedural semi-transparent cloud band (single-channel alpha noise).
// Cheap value-noise blobs mapped onto a small equirectangular canvas;
// the texture is tiled around the globe as a slowly rotating lambert layer.

const CW = 2048;
const CH = 1024;

let cached: HTMLCanvasElement | null = null;

export function getCloudTextureCanvas(): HTMLCanvasElement {
  if (cached) return cached;
  cached = build();
  return cached;
}

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, scale: number): number {
  const xi = Math.floor(x * scale);
  const yi = Math.floor(y * scale);
  const xf = x * scale - xi;
  const yf = y * scale - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 6;
  for (let i = 0; i < 5; i++) {
    v += amp * valueNoise(x, y, freq);
    amp *= 0.5;
    freq *= 2.1;
  }
  return v;
}

function build(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext("2d")!;

  const img = ctx.createImageData(CW, CH);
  const data = img.data;
  for (let y = 0; y < CH; y++) {
    const lat = 90 - (y / CH) * 180;
    const band = Math.exp(-Math.abs(lat) / 34); // cloudier near equator
    for (let x = 0; x < CW; x++) {
      const lon = -180 + (x / CW) * 360;
      const n = fbm((lon + 180) / 360, (lat + 90) / 180);
      let alpha = Math.max(0, n - 0.46) * 2.6 * band;
      alpha = Math.min(1, alpha);
      const idx = (y * CW + x) * 4;
      data[idx] = 235;
      data[idx + 1] = 242;
      data[idx + 2] = 250;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}