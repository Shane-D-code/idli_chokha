import { Database } from 'lucide-react'
import { useSources, useSystemStatus } from '../../hooks/index'
import { section } from '../layout/SectionShell'
import { SectionHeader, StatusBadge } from '../ui/primitives'
import { Annotation, StatusDot } from '../ui/editorial'

export function DataSection() {
  const sources = useSources()
  return (
    <section id="data" className={`${section} scroll-mt-24 bg-parcel/40`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeader
          index="08"
          eyebrow="Data Foundation"
          title="Where the Signals Come From"
          subtitle="TOOFAN ingests satellite, reanalysis, NWP, rainfall and historical baselines to produce every forecast you see."
        />
        <div className="flex items-center gap-2 pb-2 font-mono text-[0.62rem] text-ink-400 lg:pb-2">
          <Database className="h-4 w-4 text-brand-500" />
          {sources.length} feeds
        </div>
      </div>

      {/* ---- sources: open editorial table ---- */}
      <div className="mt-10">
        <div className="hidden grid-cols-12 gap-x-4 border-b border-ink-200 px-1 pb-2 font-mono text-[0.58rem] uppercase tracking-wider text-ink-400 lg:grid">
          <span className="col-span-2">Source</span>
          <span className="col-span-3">Role</span>
          <span className="col-span-5">Detail</span>
          <span className="col-span-2 text-right">Status</span>
        </div>
        <div>
          {sources.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-1 items-baseline gap-x-4 gap-y-1 border-b border-ink-100 px-1 py-3.5 transition last:border-b-0 hover:bg-sky/50 lg:grid-cols-12"
            >
              <span className="col-span-2 text-[0.92rem] font-bold text-ink-900">{s.name}</span>
              <span className="col-span-3 text-[0.8rem] font-medium text-ink-700">{s.provides}</span>
              <span className="col-span-5 font-mono text-[0.6rem] leading-relaxed text-ink-400">{s.detail}</span>
              <span className="col-span-2 flex justify-start lg:justify-end">
                <StatusBadge status={s.status} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <SystemStatus />
      </div>
    </section>
  )
}

function SystemStatus() {
  const statuses = useSystemStatus()
  const api = statuses.find((s) => s.id === 'api')
  const apiUp = api && !['not_connected', 'unavailable'].includes(api.status)
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-200 pb-2">
        <p className="typed text-[0.58rem] text-brand-600">System Status</p>
        {api ? (
          <span className="flex items-center gap-1.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wider text-haze-700">
            <StatusDot color={api.status === 'live' ? '#2f8f58' : api.status === 'degraded' ? '#d89820' : '#a8a198'} />
            API · {apiUp ? api.status.toUpperCase() : 'Not connected'}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 divide-y divide-ink-100 sm:grid-cols-2 sm:divide-x md:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {statuses.map((s) => (
          <div key={s.id} className="flex flex-col gap-1.5 py-3 sm:px-4 sm:first:pl-0 lg:py-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.8rem] font-semibold text-ink-800">{s.label}</span>
              <StatusDot
                color={
                  s.status === 'live'
                    ? '#2f8f58'
                    : s.status === 'demo' || s.status === 'simulated' || s.status === 'degraded'
                      ? '#d89820'
                      : '#cec6b8'
                }
              />
            </div>
            <p className="font-mono text-[0.55rem] leading-relaxed text-ink-400">{s.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-ink-100 pt-2">
        <Annotation>
          {apiUp
            ? 'Badges reflect the latest live pipeline run. Press RUN PIPELINE in the header to refresh the assessment.'
            : 'Components render from deterministic simulated fixtures. Connect the Toofan API to switch every badge to LIVE at once.'}
        </Annotation>
      </div>
    </div>
  )
}