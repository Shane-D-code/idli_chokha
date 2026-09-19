/** Deterministic pseudo-random generators. NEVER use Math.random() for any
 *  scientific/demo output — it must be reproducible between renders. */

export type Rng = () => number

/** mulberry32 — tiny, fast, seedable PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 1D value noise with smooth interpolation. */
export function valueNoise1D(seed: number) {
  const rng = mulberry32(seed)
  const table: number[] = []
  for (let i = 0; i < 256; i++) table.push(rng())
  return (x: number): number => {
    const xi = Math.floor(x)
    const xf = x - xi
    const a = table[((xi % 256) + 256) % 256]
    const b = table[(((xi + 1) % 256) + 256) % 256]
    const s = xf * xf * (3 - 2 * xf)
    return a + (b - a) * s
  }
}

/** 2D bilinear value noise. */
export function valueNoise2D(seed: number) {
  const rng = mulberry32(seed)
  const table: number[] = []
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) table.push(rng())
  }
  const at = (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    return table[(((yi % 256) + 256) % 256) * 256 + (((xi % 256) + 256) % 256)]
  }
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return (x: number, y: number): number => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const xf = smooth(x - x0)
    const yf = smooth(y - y0)
    const a = at(x0, y0)
    const b = at(x0 + 1, y0)
    const c = at(x0, y0 + 1)
    const d = at(x0 + 1, y0 + 1)
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
  }
}

/** Fractal (fBm) 2D noise. */
export function fbm2D(seed: number, octaves = 4) {
  const base = valueNoise2D(seed)
  return (x: number, y: number): number => {
    let total = 0
    let amp = 1
    let freq = 1
    let max = 0
    for (let o = 0; o < octaves; o++) {
      total += base(x * freq, y * freq) * amp
      max += amp
      amp *= 0.5
      freq *= 2.1
    }
    return total / max
  }
}