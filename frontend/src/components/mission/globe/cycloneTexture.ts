// Canvas-generated globe sprites: a restrained satellite-style cyclone
// marker, secondary-disturbance markers, forecast-point dots, the storm
// label chip, "+N h" point labels, invest labels and city labels.
// Rendered once per payload and reused via SpriteMaterial.

const CYCLONE = 256;
let cycloneCanvas: HTMLCanvasElement | null = null;
const memo = new Map<string, HTMLCanvasElement>();

/** Satellite-style tropical cyclone — soft cloud disc, faint spiral, warm eye. */
export function getCycloneTextureCanvas(): HTMLCanvasElement {
  if (cycloneCanvas) return cycloneCanvas;
  const c = document.createElement("canvas");
  c.width = CYCLONE;
  c.height = CYCLONE;
  const ctx = c.getContext("2d")!;
  const cx = CYCLONE / 2;
  const cy = CYCLONE / 2;

  // soft overall cloud disc
  const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, CYCLONE / 2);
  disc.addColorStop(0, "rgba(240,246,250,0.96)");
  disc.addColorStop(0.38, "rgba(228,238,244,0.88)");
  disc.addColorStop(0.7, "rgba(180,208,220,0.5)");
  disc.addColorStop(0.9, "rgba(150,185,200,0.16)");
  disc.addColorStop(1, "rgba(150,185,200,0)");
  ctx.fillStyle = disc;
  ctx.fillRect(0, 0, CYCLONE, CYCLONE);

  // irregular puffy rim (satellite texture, not a perfect circle)
  const blobs = 12;
  for (let i = 0; i < blobs; i++) {
    const ang = (i / blobs) * Math.PI * 2 + 0.35;
    const r = CYCLONE * (0.31 + 0.04 * ((i * 7) % 3));
    const bx = cx + Math.cos(ang) * r;
    const by = cy + Math.sin(ang) * r;
    const blobR = CYCLONE * (0.1 + 0.033 * ((i * 5) % 3));
    const blob = ctx.createRadialGradient(bx, by, 0, bx, by, blobR);
    const alpha = 0.24 + 0.07 * (i % 3);
    blob.addColorStop(0, `rgba(236,242,246,${alpha})`);
    blob.addColorStop(1, "rgba(236,242,246,0)");
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(bx, by, blobR, 0, Math.PI * 2);
    ctx.fill();
  }

  // faint inward spiral banding
  const arms = 4;
  for (let a = 0; a < arms; a++) {
    const start = (a / arms) * Math.PI * 2 + a * 0.4;
    ctx.beginPath();
    ctx.lineCap = "round";
    for (let t = 0; t <= 1; t += 0.02) {
      const ang = start + t * 4.2;
      const r = CYCLONE * 0.2 + t * (CYCLONE * 0.34);
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(206,224,232,${0.2 + (a % 2) * 0.07})`;
    ctx.lineWidth = CYCLONE * 0.02;
    ctx.stroke();
  }

  // dense inner core wall
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, CYCLONE * 0.135);
  core.addColorStop(0, "rgba(248,251,253,0.97)");
  core.addColorStop(1, "rgba(214,232,240,0.68)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, CYCLONE * 0.135, 0, Math.PI * 2);
  ctx.fill();

  // warm central eye
  ctx.beginPath();
  ctx.arc(cx, cy, CYCLONE * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,242,226,0.9)";
  ctx.fill();

  cycloneCanvas = c;
  return c;
}

/** Small hollow ring for secondary disturbances / invests. */
export function getDisturbanceTextureCanvas(ringColor = "255,214,150", dotColor = "255,190,120"): HTMLCanvasElement {
  const key = `dist-${ringColor}-${dotColor}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const S = 96;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  const cx = S / 2;
  const cy = S / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.32, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${ringColor},0.55)`;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${dotColor},0.95)`;
  ctx.fill();
  memo.set(key, c);
  return c;
}

/** Small solid dot for forecast track points. */
export function getForecastMarkerTextureCanvas(color = "255,200,120", alpha = 1): HTMLCanvasElement {
  const key = `fp-${color}-${alpha}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const S = 48;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  const cx = S / 2;
  const cy = S / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${color},${alpha})`;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.34, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,236,205,0.9)";
  ctx.stroke();
  memo.set(key, c);
  return c;
}

/** Small white ring used on the current position / observed end. */
export function getCurrentMarkerTextureCanvas(): HTMLCanvasElement {
  const key = "cur";
  const hit = memo.get(key);
  if (hit) return hit;
  const S = 96;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  const cx = S / 2;
  const cy = S / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 4;
  ctx.stroke();
  memo.set(key, c);
  return c;
}

/** Two-line storm label chip: title line + amber meta line. */
export function getStormLabelTextureCanvas(title: string, meta: string, opts?: { borderColor?: string }): HTMLCanvasElement {
  const key = `storm-${title}|${meta}|${opts?.borderColor ?? ""}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const W = 560;
  const H = 132;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const pad = 22;
  const w = W - pad * 2;
  const h = H - pad * 2;

  ctx.fillStyle = "rgba(6, 11, 18, 0.82)";
  roundRect(ctx, pad + 6, pad + 6, w, h, 14);
  ctx.fill();

  ctx.beginPath();
  roundRect(ctx, pad, pad, w, h, 14);
  ctx.fillStyle = "rgba(10, 17, 28, 0.92)";
  ctx.fill();
  ctx.strokeStyle = opts?.borderColor ?? "rgba(148,170,200,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textBaseline = "top";
  ctx.fillStyle = "#eef3f7";
  ctx.font = "800 42px 'Inter Variable', system-ui, sans-serif";
  ctx.fillText(title, pad + 26, pad + 18);

  ctx.fillStyle = opts?.borderColor ? "#5cc8ff" : "#ffc47a";
  ctx.font = "600 24px 'JetBrains Mono Variable', ui-monospace, monospace";
  ctx.fillText(meta, pad + 26, pad + 78);

  memo.set(key, c);
  return c;
}

/** Small invest/brooding label chip. */
export function getInvestLabelTextureCanvas(text: string, opts?: { borderColor?: string }): HTMLCanvasElement {
  const key = `inv-${text}|${opts?.borderColor ?? ""}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const H = 64;
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = H;
  const ctx = c.getContext("2d")!;
  roundRect(ctx, 0, 0, c.width, c.height, 10);
  ctx.fillStyle = "rgba(10, 17, 28, 0.88)";
  ctx.fill();
  ctx.strokeStyle = opts?.borderColor ?? "rgba(232,178,90,0.45)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = opts?.borderColor ? "#bae6fd" : "#f4e3c4";
  ctx.font = "700 27px 'JetBrains Mono Variable', ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, c.width / 2, c.height / 2 + 1);
  memo.set(key, c);
  return c;
}

/** Small "+N h" forecast-point label. */
export function getPointLabelTextureCanvas(text: string, color = "#ffd9a0"): HTMLCanvasElement {
  const key = `pt-${text}-${color}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const H = 52;
  const c = document.createElement("canvas");
  c.width = 144;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(10, 17, 28, 0.78)";
  roundRect(ctx, 0, 0, c.width, c.height, 8);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = "700 26px 'JetBrains Mono Variable', ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2 + 1);
  memo.set(key, c);
  return c;
}

/** Ops-dashboard cyclone marker — spiral vortex icon with a gentle glow. */
export function getCycloneSpiralTextureCanvas(): HTMLCanvasElement {
  const key = "spiral-ops";
  const hit = memo.get(key);
  if (hit) return hit;
  const S = 160;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  const cx = S / 2;
  const cy = S / 2;

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, S / 2);
  glow.addColorStop(0, "rgba(34,211,238,0.30)");
  glow.addColorStop(0.55, "rgba(34,211,238,0.08)");
  glow.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  ctx.strokeStyle = "rgba(165,243,252,0.95)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  const arms = 3;
  for (let a = 0; a < arms; a++) {
    const start = (a / arms) * Math.PI * 2;
    ctx.beginPath();
    let first = true;
    for (let t = 0; t <= 1; t += 0.03) {
      const ang = start + t * 2.6;
      const r = S * (0.06 + t * 0.34);
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.075, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();

  memo.set(key, c);
  return c;
}

/** Ops-dashboard invest marker — thin cyan ring with a bright core. */
export function getOpsInvestTextureCanvas(): HTMLCanvasElement {
  const key = "invest-ops";
  const hit = memo.get(key);
  if (hit) return hit;
  const S = 96;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  const cx = S / 2;
  const cy = S / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.32, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(59,130,246,0.7)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(147,197,253,0.95)";
  ctx.fill();
  memo.set(key, c);
  return c;
}

/** Small uppercase city label with translucent backing. */
export function getCityLabelTextureCanvas(name: string): HTMLCanvasElement {
  const key = `city-${name}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const H = 56;
  const c = document.createElement("canvas");
  c.width = 440;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(6, 10, 18, 0.55)";
  roundRect(ctx, 0, 0, c.width, c.height, 9);
  ctx.fill();
  ctx.fillStyle = "rgba(214, 226, 235, 0.92)";
  ctx.font = "700 25px 'Inter Variable', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.toUpperCase(), c.width / 2, c.height / 2 + 1);
  memo.set(key, c);
  return c;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}