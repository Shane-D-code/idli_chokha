import type { ReactNode } from 'react'
import type { DataStatus, RiskLevel } from '../../types/common'

/* ============================================================
   TOOFAN scrapbook primitives
   A small set of reusable "physical object" atoms — paper cards,
   pinned notes, sheets, folders, stamps, archive labels. Every
   section composes these rather than reinventing its own card.
   ============================================================ */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="eyebrow">
      <span className="h-px w-7 bg-brand-400/60" aria-hidden />
      {children}
    </div>
  )
}

/* Editorial section header — numbered archive index + serif title */
export function SectionHeader(props: {
  index: string
  eyebrow: string
  title: string
  subtitle?: string
  align?: 'left' | 'center'
}) {
  const { index, eyebrow, title, subtitle, align = 'left' } = props
  const alignCls = align === 'center' ? 'text-center items-center' : 'text-left items-start'
  return (
    <div className={`flex flex-col gap-3 ${alignCls}`}>
      <div className="flex items-center gap-3">
        <span className="font-mono text-[0.78rem] font-semibold tracking-[0.3em] text-brand-600">{index}</span>
        <span className="h-px w-10 bg-ink-200" aria-hidden />
        <span className="typed text-ink-500">{eyebrow}</span>
      </div>
      <h2 className="display text-balance text-4xl font-normal leading-[1] tracking-tight text-ink-900 sm:text-5xl lg:text-6xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="max-w-2xl text-[0.98rem] leading-relaxed text-ink-500">{subtitle}</p>
      ) : null}
    </div>
  )
}

/* A numbered floating sheet — the basic paper object */
export function PaperCard({
  children,
  className = '',
  tilt = '',
}: {
  children: ReactNode
  className?: string
  tilt?: 'pin-1' | 'pin-2' | 'pin-3' | ''
}) {
  return (
    <div className={`paper-float rounded-2xl ${tilt} ${className}`}>{children}</div>
  )
}

/* A small pinned "note" — like a sticky annotation */
export function WeatherNote({
  heading,
  children,
  accent = 'bg-brand-500',
  tilt = '',
  className = '',
}: {
  heading: string
  children: ReactNode
  accent?: string
  tilt?: string
  className?: string
}) {
  return (
    <div className={`paper rounded-xl ${tilt} ${className}`}>
      <div className={`h-1 w-full rounded-t-xl ${accent}`} aria-hidden />
      <div className="px-4 py-3">
        <p className="typed text-[0.56rem] text-ink-400">{heading}</p>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  )
}

/* A scientific data sheet — ruled table object */
export function DataSheet({
  title,
  rows,
  footer,
  className = '',
}: {
  title: string
  rows: { label: string; value: string; mono?: boolean; accent?: boolean }[]
  footer?: string
  className?: string
}) {
  return (
    <div className={`paper rounded-2xl ${className}`}>
      <div className="border-b border-ink-100 px-4 py-2.5">
        <p className="typed text-[0.58rem] text-brand-600">{title}</p>
      </div>
      <dl className="px-4 py-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 border-b border-dashed border-ink-100 py-1.5 last:border-0">
            <dt className="typed text-[0.54rem] text-ink-400">{r.label}</dt>
            <dd className={`font-mono text-[0.76rem] ${r.mono ? 'font-semibold' : ''} ${r.accent ? 'font-semibold text-brand-600' : 'text-ink-800'}`}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      {footer ? <p className="border-t border-ink-100 px-4 py-2 font-mono text-[0.54rem] text-ink-400">{footer}</p> : null}
    </div>
  )
}

/* An archive "folder" object — decorative navigation to a section */
export function FolderObject({
  label,
  href,
  tint = '#E6F2F8',
  className = '',
}: {
  label: string
  href?: string
  tint?: string
  className?: string
}) {
  return (
    <a
      href={href ?? `#${label.toLowerCase()}`}
      className={`hover-lift group inline-flex items-center gap-2.5 rounded-tl-lg rounded-tr-lg rounded-br-lg border border-ink-200 px-3.5 py-2.5 font-mono text-[0.66rem] font-bold uppercase tracking-[0.16em] text-ink-700 shadow-soft ${className}`}
      style={{ background: `linear-gradient(180deg, ${tint}, ${tint}cc)` }}
    >
      <span className="inline-block h-4 w-4 rounded-sm border border-ink-300 bg-cloud" aria-hidden />
      {label}
    </a>
  )
}

/* A stamp — small labelled metric with underline, like a rubber stamp */
export function MetricStamp({
  label,
  value,
  unit,
  className = '',
}: {
  label: string
  value: string
  unit?: string
  className?: string
}) {
  return (
    <div className={`inline-flex flex-col ${className}`}>
      <span className="typed text-[0.52rem] text-ink-400">{label}</span>
      <span className="mt-0.5 font-mono text-2xl font-bold tracking-tight text-ink-900">
        {value}
        {unit ? <span className="ml-1 text-[0.7rem] font-normal text-ink-400">{unit}</span> : null}
      </span>
      <span className="mt-1 h-px w-full bg-ink-200" aria-hidden />
    </div>
  )
}

/* Archive label — a tiny stamp used for captions / place names */
export function ArchiveLabel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <span className={`typed inline-flex items-center gap-1.5 text-[0.56rem] text-ink-400 ${className}`}>{children}</span>
}

/* Photo-frame — an image/canvas presented like a printed photograph */
export function PhotoFrame({
  children,
  captionTop,
  captionBottom,
  className = '',
}: {
  children: ReactNode
  captionTop?: ReactNode
  captionBottom?: ReactNode
  className?: string
}) {
  return (
    <figure className={`paper-float overflow-hidden rounded-xl ${className}`}>
      {captionTop ? (
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">{captionTop}</div>
      ) : null}
      <div className="bg-cloud">{children}</div>
      {captionBottom ? (
        <figcaption className="border-t border-ink-100 px-4 py-2">{captionBottom}</figcaption>
      ) : null}
    </figure>
  )
}

/* A scientific "field annotation" — thin connecting label */
export function ScientificAnnotation({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="h-px flex-1 bg-ink-200" aria-hidden />
      <span className="font-serif italic text-[0.82rem] text-ink-500">{children}</span>
      <span className="h-px flex-1 bg-ink-200" aria-hidden />
    </div>
  )
}

/* ---------------- Shared badges ---------------- */

const RISK_STYLES: Record<RiskLevel, string> = {
  low: 'bg-safe-100 text-safe-600 border-safe-500/25',
  moderate: 'bg-warn-100 text-haze-700 border-warn-500/30',
  high: 'bg-severe-100 text-severe-600 border-severe-500/30',
  severe: 'bg-severe-500 text-white border-severe-600/40',
}

const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'LOW',
  moderate: 'MODERATE',
  high: 'HIGH',
  severe: 'SEVERE',
}

export function RiskBadge({ level, className = '' }: { level: RiskLevel; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[0.66rem] font-semibold uppercase tracking-wider ${RISK_STYLES[level]} ${className}`}>
      {RISK_LABEL[level]}
    </span>
  )
}

export function StatusBadge({ status }: { status: DataStatus }) {
  const map: Record<DataStatus, { label: string; cls: string; dot: string }> = {
    live: { label: 'LIVE', cls: 'bg-safe-100 text-safe-600 border-safe-500/30', dot: 'bg-safe-500' },
    demo: { label: 'SIMULATED', cls: 'bg-brand-100 text-brand-700 border-brand-500/30', dot: 'bg-brand-500' },
    simulated: { label: 'SIMULATED', cls: 'bg-warn-100 text-haze-700 border-warn-500/30', dot: 'bg-warn-500' },
    degraded: { label: 'DEGRADED', cls: 'bg-warn-100 text-haze-700 border-warn-500/30', dot: 'bg-warn-500' },
    unavailable: { label: 'NOT AVAILABLE', cls: 'bg-ink-100 text-ink-500 border-ink-300/40', dot: 'bg-ink-300' },
    not_connected: { label: 'NOT CONNECTED', cls: 'bg-ink-100 text-ink-500 border-ink-300/40', dot: 'bg-ink-300' },
  }
  const s = map[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[0.64rem] font-semibold uppercase tracking-wider ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${status === 'live' ? 'animate-pulse' : ''}`} />
      {s.label}
    </span>
  )
}

/* Scientific gauge dial — heavier ring, arc ticks, needle stop */
export function Ring(props: {
  value: number
  max?: number
  size?: number
  stroke?: number
  color?: string
  trackColor?: string
  label?: string
}) {
  const { value, max = 100, size = 96, stroke = 8, color = '#2F92B8', trackColor = '#E8E3DA', label } = props
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, value / max))
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)' }}
        />
        {/* dial ticks */}
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i / 12) * Math.PI * 2
          const x1 = size / 2 + Math.cos(a) * (r - stroke / 2)
          const y1 = size / 2 + Math.sin(a) * (r - stroke / 2)
          const x2 = size / 2 + Math.cos(a) * (r - stroke)
          const y2 = size / 2 + Math.sin(a) * (r - stroke)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#CFC9C0" strokeWidth={0.8} />
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {label ? <span className="typed text-[0.48rem] text-ink-400">{label}</span> : null}
      </div>
    </div>
  )
}

/* Simulated "sticker" dot */
export function StickerDot({ color = '#2F92B8', className = '' }: { color?: string; className?: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${className}`} style={{ background: color }} />
}