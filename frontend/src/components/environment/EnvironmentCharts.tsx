import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useEnvironment } from '../../hooks/index'

const CHARTS = [
  { key: 0, color: '#087ea4', label: 'Sea Surface Temperature', unit: '°C' },
  { key: 1, color: '#e8892f', label: 'Vertical Wind Shear', unit: 'kt' },
  { key: 2, color: '#b32020', label: 'Central Sea-Level Pressure', unit: 'hPa' },
  { key: 3, color: '#10afc4', label: 'Mid-Level Humidity', unit: '%' },
  { key: 4, color: '#39a96b', label: 'Ocean Heat Content', unit: 'kJ/cm²' },
]

export function EnvironmentCharts() {
  const env = useEnvironment()

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-200 pb-2">
        <p className="typed text-[0.58rem] text-brand-600">54-hour Environmental Trends</p>
        <span className="font-mono text-[0.56rem] text-ink-300">{env.charts.length ? 'TREND SERIES' : 'SNAPSHOT ONLY'}</span>
      </div>
      {env.charts.length === 0 ? (
        <p className="border-b border-ink-100 py-4 font-mono text-[0.62rem] text-ink-500">
          NO ENVIRONMENTAL TREND SERIES IN THIS RUN — ONLY THE CURRENT SNAPSHOT IS AVAILABLE.
        </p>
      ) : (
        <div className="grid grid-cols-1 divide-y divide-ink-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5">
        {env.charts.map((c, i) => {
          const def = CHARTS[i] ?? { color: '#087ea4', label: c.label, unit: c.unit }
          const data = c.series.map((p) => ({ label: shortDate(p.t), v: p.v }))
          return (
            <div key={c.label} className="flex min-w-0 flex-col py-4 sm:px-5 sm:first:pl-0 sm:last:pr-0">
              <div className="flex items-baseline justify-between gap-1">
                <span className="truncate font-mono text-[0.56rem] uppercase tracking-wider text-ink-500" title={c.label}>
                  {c.label}
                </span>
                <span className="font-mono text-[0.95rem] font-bold tracking-tight text-ink-900">
                  {c.value}
                  <span className="ml-0.5 text-[0.55rem] font-normal text-ink-400">{def.unit}</span>
                </span>
              </div>
              <div className="mt-2 h-[92px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`envFill${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={def.color} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={def.color} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 2" stroke="#ece5da" vertical={false} />
                    <XAxis dataKey="label" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip
                      content={({ active, payload, label }: any) =>
                        active && payload?.length ? (
                          <div className="rounded-md border border-ink-200 bg-cloud px-2.5 py-1.5 shadow-pop">
                            <div className="font-mono text-[0.6rem] text-ink-400">{label}</div>
                            <div className="font-mono text-[0.7rem] font-bold" style={{ color: def.color }}>
                              {payload[0].value} {def.unit}
                            </div>
                          </div>
                        ) : null
                      }
                    />
                    <Area type="monotone" dataKey="v" stroke={def.color} strokeWidth={1.8} fill={`url(#envFill${i})`} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 truncate font-mono text-[0.55rem] text-ink-400" title={c.trendLabel}>
                {c.trendLabel}
              </div>
            </div>
          )
        })}
        </div>
      )}
    </div>
  )
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate().toString().padStart(2, '0')}/${d.getUTCHours().toString().padStart(2, '0')}h`
}