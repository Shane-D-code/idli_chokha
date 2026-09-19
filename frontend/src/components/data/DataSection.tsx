import { Database } from 'lucide-react'
import { useSources } from '../../hooks/index'
import { section } from '../layout/SectionShell'
import { SectionHeader } from '../ui/primitives'

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
          <span className="col-span-7">Detail</span>
        </div>
        <div>
          {sources.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-1 items-baseline gap-x-4 gap-y-1 border-b border-ink-100 px-1 py-3.5 transition last:border-b-0 hover:bg-sky/50 lg:grid-cols-12"
            >
              <span className="col-span-2 text-[0.92rem] font-bold text-ink-900">{s.name}</span>
              <span className="col-span-3 text-[0.8rem] font-medium text-ink-700">{s.provides}</span>
              <span className="col-span-7 font-mono text-[0.6rem] leading-relaxed text-ink-400">{s.detail}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}