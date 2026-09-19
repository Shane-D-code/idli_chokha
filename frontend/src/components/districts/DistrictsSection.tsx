import { Search } from 'lucide-react'
import { useState } from 'react'
import { appActions, useApp } from '../../state/store'
import { useLocations, useDistricts, useSelectedDistrict } from '../../hooks/index'
import { section } from '../layout/SectionShell'
import { SectionHeader } from '../ui/primitives'
import { distanceText } from './districtFormatters'
import { DistrictMap } from './DistrictMap'
import { DistrictDetailPanel } from './DistrictDetailPanel'

export function DistrictsSection() {
  const locations = useLocations()
  const quickIds = useApp((s) => s.data.sign.quickSelectIds)
  const districts = useDistricts()
  const selected = useSelectedDistrict()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const q = query.trim().toLowerCase()
  const matches = q
    ? locations
        .filter((l) => l.name.toLowerCase().includes(q) || (l.state ?? '').toLowerCase().includes(q))
        .slice(0, 7)
    : []

  return (
    <section id="districts" className={`${section} scroll-mt-24`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeader
          index="05"
          eyebrow="Who Is Affected"
          title="District-Level Risk"
          subtitle="Choose a district or search any location to see expected approach distance, timing and what it means for you."
        />
        <span className="font-mono text-[0.6rem] uppercase tracking-widest text-ink-300 lg:pb-2">
          District risk model
        </span>
      </div>

      {/* ---- open search + quick select ---- */}
      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-ink-200 pb-3">
            <div className="relative order-1 min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => window.setTimeout(() => setOpen(false), 160)}
                placeholder="Search district, city, town or port…"
                className="w-full border-b border-transparent bg-transparent py-2 pl-7 text-[0.9rem] text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-brand-500/60"
              />
              {open && matches.length ? (
                <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-ink-200 bg-cloud p-1 shadow-pop">
                  {matches.map((l) => (
                    <button
                      key={l.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        appActions.selectDistrict(l.id)
                        setQuery('')
                        setOpen(false)
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded px-3 py-1.5 text-left hover:bg-sky"
                    >
                      <span className="text-[0.85rem] font-medium text-ink-800">{l.name}</span>
                      <span className="font-mono text-[0.58rem] text-ink-400">{l.state}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="typed order-2 text-[0.52rem] text-ink-400">Quick select</span>
            <div className="order-3 flex flex-wrap gap-3">
              {quickIds.map((id) => {
                const l = locations.find((x) => x.id === id)
                if (!l) return null
                return (
                  <button
                    key={id}
                    onClick={() => appActions.selectDistrict(id)}
                    className={`border-b pb-0.5 font-mono text-[0.64rem] font-semibold transition ${
                      selected?.id === id ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-500 hover:text-brand-600'
                    }`}
                  >
                    {l.name}
                  </button>
                )
              })}
            </div>
          </div>

          <DistrictMap />
        </div>

        <DistrictDetailPanel />
      </div>

      {/* ---- ranked list: open table ---- */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between border-b border-ink-200 pb-2">
          <p className="typed text-[0.58rem] text-brand-600">District Risk Scorecard</p>
          <span className="font-mono text-[0.56rem] text-ink-300">{districts.districts.length} locations</span>
        </div>
        <div className="hidden grid-cols-[2.2fr_1fr_1fr_1fr_0.6fr] gap-x-4 border-b border-ink-100 px-1 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-ink-400 md:grid">
          <span>District</span>
          <span>State</span>
          <span>Distance</span>
          <span>Approach</span>
          <span className="text-right">Risk</span>
        </div>
        <div className="md:border-b md:border-ink-100">
          {districts.districts.slice(0, 18).map((d) => (
            <button
              key={d.id}
              onClick={() => appActions.selectDistrict(d.id)}
              className={`grid w-full grid-cols-[2.2fr_1fr_1fr_1fr_0.6fr] items-baseline gap-x-4 border-b border-ink-100 px-1 py-2.5 text-left transition last:border-0 hover:bg-sky ${
                selected?.id === d.id ? 'bg-brand-50' : ''
              }`}
            >
              <span className="truncate text-[0.85rem] font-semibold text-ink-800">{d.name}</span>
              <span className="truncate font-mono text-[0.7rem] text-ink-500">{d.state}</span>
              <span className="font-mono text-[0.7rem] text-ink-500">{distanceText(d.distanceKm)}</span>
              <span className="font-mono text-[0.7rem] text-ink-500">{d.approachTime ?? '—'}</span>
              <span className="text-right font-mono text-[0.66rem] font-semibold uppercase" style={{ color: riskColor(d.riskLevel) }}>
                {d.riskLevel}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function riskColor(level: 'low' | 'moderate' | 'high' | 'severe'): string {
  switch (level) {
    case 'low':
      return '#39a96b'
    case 'moderate':
      return '#c47a16'
    case 'high':
      return '#e8892f'
    case 'severe':
      return '#e84c4c'
  }
}