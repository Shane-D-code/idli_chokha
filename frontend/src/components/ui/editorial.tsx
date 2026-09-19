import type { ReactNode } from 'react'

/* ============================================================
   TOOFAN open-editorial primitives
   Typography-driven layout atoms. By default these render NO
   background, border, radius or shadow — separation comes from
   type scale, whitespace and hairline rules. Surfaces are opt-in
   (ArtifactFrame for maps/images, FloatingNote for annotations).
   ============================================================ */

/* Thin editorial horizontal rule */
export function Rule({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`hairline h-px ${className}`} />
}

/* Large open metric — small mono label over a big value */
export function OpenMetric({
  label,
  value,
  unit,
  note,
  className = '',
}: {
  label: string
  value: ReactNode
  unit?: string
  note?: string
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="typed text-ink-400">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-bold leading-none tracking-tight text-ink-900">{value}</span>
        {unit ? <span className="font-mono text-sm text-ink-400">{unit}</span> : null}
      </div>
      {note ? <span className="font-mono text-[0.58rem] text-ink-400">{note}</span> : null}
    </div>
  )
}

/* Hairline data row — label : value (note), no container */
export function MetricRow({
  label,
  value,
  note,
  className = '',
}: {
  label: string
  value: ReactNode
  note?: string
  className?: string
}) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-b border-ink-100 py-1.5 last:border-0 ${className}`}>
      <span className="typed text-ink-400">{label}</span>
      <span className="text-right">
        <span className="font-mono text-[0.82rem] font-semibold text-ink-800">{value}</span>
        {note ? <span className="ml-1.5 font-mono text-[0.54rem] text-ink-400">{note}</span> : null}
      </span>
    </div>
  )
}

/* Open data table — typed header row + hairlined rows, zero surfaces */
export function DataTable({
  columns,
  rows,
  className = '',
}: {
  columns: { key: string; label: string; width?: string }[]
  rows: { key: string; cells: Record<string, ReactNode> }[]
  className?: string
}) {
  return (
    <div className={className}>
      <div className="grid items-center border-y border-ink-200">
        {columns.map((c) => (
          <div key={c.key} className="typed py-2 text-ink-400" style={c.width ? { gridColumn: c.width } : undefined}>
            {c.label}
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid items-center border-b border-ink-100">
          {columns.map((c) => (
            <div key={c.key} style={c.width ? { gridColumn: c.width } : undefined}>
              {r.cells[c.key]}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/* "Artifact" frame — the one legitimate surface for maps, globe and images */
export function ArtifactFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`relative overflow-hidden rounded-xl border border-ink-200 bg-mist ${className}`}>{children}</div>
}

/* Floating annotation / popup — the small card allowed on top of artifacts */
export function FloatingNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`absolute z-20 rounded-lg border border-ink-200 bg-cloud/95 px-3 py-2 shadow-pop backdrop-blur ${className}`}>
      {children}
    </div>
  )
}

/* Mono metadata caption */
export function Annotation({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`font-mono text-[0.6rem] leading-relaxed text-ink-400 ${className}`}>{children}</p>
}

/* Tiny status dot */
export function StatusDot({ color = '#19799F', className = '' }: { color?: string; className?: string }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} style={{ background: color }} />
}

/* Open tag — a plain status label that reads as text, not a pill */
export function Tag({
  children,
  color = 'inherit',
  className = '',
}: {
  children: ReactNode
  color?: string
  className?: string
}) {
  return (
    <span className={`font-mono text-[0.6rem] font-semibold uppercase tracking-wider ${className}`} style={{ color }}>
      {children}
    </span>
  )
}