import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react'
import { useEnvironment } from '../../hooks/index'
import { section } from '../layout/SectionShell'
import { SectionHeader } from '../ui/primitives'
import { EnvironmentCharts } from './EnvironmentCharts'
import type { Favourability } from '../../types/common'
import type { EnvironmentMetric } from '../../types/environment'

const FAV: Record<Favourability, { color: string; label: string; icon: typeof CheckCircle2 }> = {
  favourable: { color: '#2f8f58', label: 'Favourable', icon: CheckCircle2 },
  moderate: { color: '#d98f1f', label: 'Moderate', icon: MinusCircle },
  unfavourable: { color: '#d63a3a', label: 'Unfavourable', icon: XCircle },
}

export function Environment() {
  const env = useEnvironment()
  const groups: { key: 'ocean' | 'atmosphere' | 'moisture' | 'pressure'; label: string }[] = [
    { key: 'ocean', label: 'Ocean' },
    { key: 'atmosphere', label: 'Atmosphere' },
    { key: 'moisture', label: 'Moisture' },
    { key: 'pressure', label: 'Pressure' },
  ]

  return (
    <section id="environment" className={`${section} scroll-mt-24 bg-parcel/40`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeader
          index="06"
          eyebrow="Read the Atmosphere"
          title="The Storm Environment"
          subtitle="Warm sea, low shear and plenty of moisture set the stage. These fields drive the intensity outlook."
        />
        <div className="lg:pb-2" />
      </div>

      {/* ---- open metric grid: 4 groups, large values, hairline separators ---- */}
      <div className="mt-10 grid grid-cols-1 overflow-hidden sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-ink-100">
        {groups.map((g) => (
          <div key={g.key} className="border-b border-ink-100 last:border-b-0 lg:px-6 lg:py-2 lg:first:pl-0 lg:last:border-b-0">
            <p className="typed text-[0.56rem] text-brand-600">{g.label}</p>
            <div className="mt-3 flex flex-col gap-3">
              {env[g.key].length === 0 ? (
                <p className="font-mono text-[0.6rem] text-ink-400">NOT AVAILABLE IN THIS RUN</p>
              ) : (
                env[g.key].map((m) => <MetricRow key={m.id} m={m} />)
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <EnvironmentCharts />
      </div>
    </section>
  )
}

function MetricRow({ m }: { m: EnvironmentMetric }) {
  const f = FAV[m.favourability]
  const Icon = f.icon
  return (
    <div className="flex items-end justify-between gap-2 border-b border-dashed border-ink-100 pb-3 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 shrink-0" style={{ color: f.color }} />
          <span className="truncate text-[0.82rem] font-medium text-ink-800">{m.variable}</span>
        </div>
        <div className="truncate font-mono text-[0.52rem] text-ink-400">{m.note}</div>
      </div>
      <div className="shrink-0 text-right">
        <span className="font-mono text-[1.05rem] font-bold tracking-tight text-ink-900">{m.value}</span>
        <span className="ml-1 font-mono text-[0.55rem] font-normal text-ink-400">{m.unit}</span>
      </div>
    </div>
  )
}