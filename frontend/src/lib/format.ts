import { ktToKmh } from './ua'

/** Deterministic display formatting helpers. */

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export function formatFullUtc(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function formatTimeShort(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Never rendered as animation frame; used for UTC clock. */
export function utcNow(): { time: string; date: string } {
  const d = new Date()
  return {
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
  }
}

export function hoursLabel(h: number): string {
  if (h === 0) return 'NOW'
  return `+${h}H`
}

export function windKtText(kt: number): string {
  return `${kt} kt`
}

export function windKmhText(kt: number): string {
  return `${Math.round(ktToKmh(kt))} km/h`
}

export function pct(x: number, digits = 1): string {
  return `${x.toFixed(digits)}%`
}

export function kmText(km: number): string {
  return `${Math.round(km)} km`
}

/** Human friendly distance; e.g. "647.6 km". */
export function distanceText(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(2)}k km`
  return `${km.toFixed(1)} km`
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}