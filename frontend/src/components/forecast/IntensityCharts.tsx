import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceDot,
  ReferenceLine,
} from 'recharts'
import { useLifecycle, useObserved, useCyclone } from '../../hooks/index'
import { getIntensityColor } from '../../lib/ua'
import { formatDate, formatFullUtc } from '../../lib/format'

interface Pt {
  t: number
  label: string
  windKt: number | null
  pressureHpa: number | null
  observedWind: number | null
  observedPressure: number | null
}

function buildCombined(
  lifecycle: { validAt: string; windKt: number; pressureHpa: number; hours: number }[],
  observed: { validAt: string; windKt: number; pressureHpa: number }[],
): { pts: Pt[]; t0: number } {
  const t0 = new Date(observed[0].validAt).getTime()
  const toH = (iso: string) => (new Date(iso).getTime() - t0) / 3600_000
  const byT = new Map<number, Pt>()

  for (const o of observed) {
    const t = Math.round(toH(o.validAt))
    byT.set(t, { t, label: formatDate(o.validAt), windKt: null, pressureHpa: null, observedWind: o.windKt, observedPressure: o.pressureHpa })
  }
  const baseT = Math.round(toH(lifecycle[0].validAt))
  for (const l of lifecycle) {
    const t = baseT + l.hours
    const prev = byT.get(t) ?? { t, label: `+${l.hours}H`, windKt: null as number | null, pressureHpa: null as number | null, observedWind: null as number | null, observedPressure: null as number | null }
    byT.set(t, { ...prev, windKt: l.windKt, pressureHpa: l.pressureHpa, label: `+${l.hours}H` })
  }
  return { pts: [...byT.values()].sort((a, b) => a.t - b.t), t0 }
}

function hoursSince(t0: number, iso: string): number {
  return Math.round((new Date(iso).getTime() - t0) / 3600_000)
}

export function IntensityCharts() {
  const lifecycle = useLifecycle()
  const observed = useObserved()
  const cyclone = useCyclone()

  if (lifecycle.length < 2 || !observed.length) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-ink-200 bg-cloud/60 p-6">
        <p className="typed text-brand-600">Intensity Forecast</p>
        <p className="max-w-md text-[0.82rem] leading-relaxed text-ink-500">
          Not available from current pipeline — a position-only trajectory was returned and the intensity
          model artifact is unavailable in this stage.
        </p>
        <p className="text-[0.8rem] leading-relaxed text-ink-500">
          Observed state at {formatFullUtc(cyclone.validAt)}: {cyclone.windKt} kt · {cyclone.pressureHpa} hPa.
        </p>
        <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-haze-700">STATUS · NOT AVAILABLE</span>
      </div>
    )
  }

  const { pts, t0 } = buildCombined(lifecycle, observed)

  const peak = observed.reduce((a, b) => (b.windKt > a.windKt ? b : a), observed[0])
  const peakT = hoursSince(t0, peak.validAt)
  const currentT = hoursSince(t0, cyclone.validAt)

  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
      {/* Lifecycle & Intensity (observed history + forecast outlook) */}
      <figure className="flex min-w-0 flex-col">
        <figcaption className="flex items-baseline justify-between gap-3">
          <p className="typed text-brand-600">Cyclone Lifecycle & Intensity</p>
          <span className="font-mono text-[0.56rem] text-ink-300">OBSERVED → FORECAST</span>
        </figcaption>
        <div className="mt-3 h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pts} margin={{ top: 16, right: 12, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="windFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={getIntensityColor(cyclone.windKt)} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={getIntensityColor(cyclone.windKt)} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ece5da" />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmtT(t0)} stroke="#a8a198" tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }} />
              <YAxis yAxisId="wind" domain={[0, 130]} stroke="#a8a198" tick={{ fontSize: 10 }} unit=" kt" />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="wind" name="Observed Wind" type="monotone" dataKey="observedWind" stroke="#61788A" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls />
              <Area yAxisId="wind" name="Forecast Wind" type="monotone" dataKey="windKt" stroke={getIntensityColor(cyclone.windKt)} strokeWidth={2.4} fill="url(#windFill)" dot={{ r: 3 }} connectNulls />
              <ReferenceDot yAxisId="wind" x={peakT} y={peak.windKt} r={5} fill="#e8892f" stroke="#fff" strokeWidth={1.5} />
              <ReferenceLine yAxisId="wind" segment={[{ x: peakT, y: 0 }, { x: peakT, y: peak.windKt }]} stroke="#e8892f" strokeDasharray="3 3" />
              <ReferenceDot yAxisId="wind" x={currentT} y={cyclone.windKt} r={5} fill={getIntensityColor(cyclone.windKt)} stroke="#211C1A" strokeWidth={1.5} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.58rem] text-ink-400">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#e8892f]" /> Peak {peak.windKt} kt ({peak.pressureHpa} hPa) · {formatDate(peak.validAt)}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: getIntensityColor(cyclone.windKt) }} /> Current {cyclone.windKt} kt</span>
          <span className="text-ink-300">Landfall: not available</span>
        </div>
      </figure>

      {/* Intensity & Pressure dual axis */}
      <figure className="flex min-w-0 flex-col">
        <figcaption className="flex items-baseline justify-between gap-3">
          <p className="typed text-brand-600">Intensity & Pressure</p>
          <span className="font-mono text-[0.56rem] text-ink-300">DUAL AXIS · NOW → +24H</span>
        </figcaption>
        <div className="mt-3 h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pts.filter((p) => p.windKt != null)} margin={{ top: 16, right: 12, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="pressFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#b32020" stopOpacity={0.05} />
                  <stop offset="100%" stopColor="#b32020" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ece5da" />
              <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => `+${Math.round(t)}H`} stroke="#a8a198" tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }} />
              <YAxis yAxisId="wind" domain={[0, 130]} stroke="#19799f" tick={{ fontSize: 10 }} unit=" kt" />
              <YAxis yAxisId="press" orientation="right" domain={[960, 1010]} reversed stroke="#b32020" tick={{ fontSize: 10 }} unit=" hPa" />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area yAxisId="press" name="Pressure" type="monotone" dataKey="pressureHpa" stroke="#b32020" strokeWidth={2} fill="url(#pressFill)" />
              <Line yAxisId="wind" name="Wind" type="monotone" dataKey="windKt" stroke="#0d9db8" strokeWidth={2.4} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 font-mono text-[0.58rem] text-ink-400">
          Wind falls as central pressure recovers — deepening holds through +12H, then steady weakening through +24H.
        </p>
      </figure>
    </div>
  )
}

function fmtT(t0: number) {
  return (t: number): string => {
    const d = new Date(t0 + t * 3600_000)
    return `${d.getUTCDate().toString().padStart(2, '0')} ${d.getUTCHours().toString().padStart(2, '0')}h`
  }
}

function ChartTip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null
  const wind = payload.find((p: any) => p.dataKey === 'windKt' || p.dataKey === 'observedWind')
  const press = payload.find((p: any) => p.dataKey === 'pressureHpa' || p.dataKey === 'observedPressure')
  const label = payload[0]?.payload?.label ?? ''
  return (
    <div className="rounded-md border border-ink-200 bg-cloud px-3 py-2 shadow-pop">
      <div className="mb-1 font-mono text-[0.62rem] font-semibold text-ink-500">{label}</div>
      {wind ? <div className="font-mono text-[0.7rem] text-ink-800">Wind <span className="font-bold">{wind.value ?? '—'}</span> kt</div> : null}
      {press ? <div className="font-mono text-[0.7rem] text-ink-800">MSLP <span className="font-bold">{press.value ?? '—'}</span> hPa</div> : null}
    </div>
  )
}