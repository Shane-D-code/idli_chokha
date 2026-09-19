import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useHazards } from '../../hooks/index'
import { MetricRow, Annotation } from '../ui/editorial'

export function HazardModules() {
  const h = useHazards()
  const rain = h.rainfall.map((b) => ({ name: b.window, mm: b.mm, mean: b.meanMmPerH }))
  const barColor = (mm: number) => (mm >= 200 ? '#19799f' : mm >= 100 ? '#2f92b8' : '#9ccfe2')
  const peak = h.rainfall.length ? Math.max(...h.rainfall.map((r) => r.mm)) : null
  const peakWin = peak !== null ? h.rainfall.find((r) => r.mm === peak)?.window : null
  const floodUp = h.flood.status !== 'unavailable'
  const slideUp = h.landslide.status !== 'unavailable'

  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-3">
      {/* Rainfall — open column with chart */}
      <div className="flex flex-col border-l border-ink-100 pl-8">
        <p className="typed text-brand-600">Rainfall · Expected Accumulation</p>
        {rain.length ? (
          <div className="mt-3 h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rain} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ece5da" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }} stroke="#a8a198" />
                <YAxis unit=" mm" tick={{ fontSize: 10 }} stroke="#a8a198" />
                <Tooltip
                  cursor={{ fill: 'rgba(47,146,184,0.06)' }}
                  content={({ active, payload, label }: any) =>
                    active && payload?.length ? (
                      <div className="rounded-md border border-ink-200 bg-cloud px-2.5 py-1.5 shadow-pop">
                        <div className="font-mono text-[0.6rem] text-ink-400">{label}</div>
                        {payload.map((entry: any, i: number) => (
                          <div key={i} className="font-mono text-[0.7rem] font-bold" style={{ color: entry.color }}>
                            {entry.value} mm ({entry.name})
                          </div>
                        ))}
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="mm" name="Accumulation (mm)" radius={[6, 6, 0, 0]}>
                  {rain.map((r) => (
                    <Cell key={r.name} fill={barColor(r.mm)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-3 border-l-2 border-ink-200 pl-3 font-mono text-[0.66rem] text-ink-500">
            NOT AVAILABLE IN THIS RUN — RAINFALL DEPENDS ON THE INTENSITY MODULE.
          </p>
        )}
        <Annotation className="mt-1">
          {h.rainfall.length
            ? `${h.rainfall.length} forecast windows · peak ${peak} mm in ${peakWin}`
            : 'Rainfall branch unavailable in this run.'}
        </Annotation>
      </div>

      {/* Flood — open metric rows */}
      <div className="flex flex-col border-l border-ink-100 pl-8">
        <p className="typed text-brand-600">Flood</p>
        {floodUp ? (
          <>
            <dl className="mt-2">
              <MetricRow label="Affected region" value={h.flood.affectedRegion} />
              <MetricRow label="Expected accumulation" value={`${h.flood.expectedAccumulationMm} mm`} />
              <MetricRow label="River / coastal risk" value={h.flood.riverCoastalRisk.toUpperCase()} />
            </dl>
            <div className="mt-3">
              <span className="typed text-[0.5rem] text-ink-400">Affected districts</span>
              <p className="mt-1 font-mono text-[0.72rem] text-ink-600">{h.flood.affectedDistricts.join(' · ')}</p>
            </div>
          </>
        ) : (
          <p className="mt-3 border-l-2 border-ink-200 pl-3 font-mono text-[0.66rem] text-ink-500">
            NOT AVAILABLE IN THIS RUN — FLOOD DEPENDS ON RAINFALL.
          </p>
        )}
      </div>

      {/* Landslide — open metric rows */}
      <div className="flex flex-col border-l border-ink-100 pl-8">
        <p className="typed text-brand-600">Landslide</p>
        {slideUp ? (
          <>
            <dl className="mt-2">
              <MetricRow label="Soil moisture" value={`${h.landslide.soilMoisturePct}%`} />
              <MetricRow label="Rainfall contribution" value={h.landslide.rainfallContribution} />
              <MetricRow label="Slope exposure" value={h.landslide.slopeExposure} />
            </dl>
            <div className="mt-3">
              <span className="typed text-[0.5rem] text-ink-400">Affected districts</span>
              <p className="mt-1 font-mono text-[0.72rem] text-ink-600">{h.landslide.affectedDistricts.join(' · ')}</p>
            </div>
          </>
        ) : (
          <p className="mt-3 border-l-2 border-ink-200 pl-3 font-mono text-[0.66rem] text-ink-500">
            NOT AVAILABLE IN THIS RUN — LANDSLIDE DEPENDS ON RAINFALL.
          </p>
        )}
      </div>
    </div>
  )
}

export function StormSurgeStrip() {
  const h = useHazards()
  return (
    <div className="mt-8 border-t border-ink-200 pt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="typed text-brand-600">Storm Surge</p>
            <span className="font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-ink-600">{h.surge.riskLevel.toUpperCase()}</span>
          </div>
          <p className="mt-1 max-w-lg text-[0.85rem] leading-relaxed text-ink-600">
            {h.surge.available
              ? `Estimated surge ${h.surge.estimatedSurgeM} m along ${h.surge.affectedCoastline}`
              : 'Storm-surge guidance is not available for this run — DATA UNAVAILABLE.'}
          </p>
        </div>
        {h.surge.available ? (
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-5xl font-extrabold tracking-tight text-ink-900">{h.surge.estimatedSurgeM}</span>
            <span className="font-mono text-[0.65rem] text-ink-400">m · max</span>
          </div>
        ) : null}
      </div>
      <div className="mt-2 font-mono text-[0.68rem] text-ink-500">
        {h.surge.coastalExposure}
      </div>
    </div>
  )
}