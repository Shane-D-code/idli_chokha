import { useHazards, useHazardRegions } from '../../hooks/index'
import { appActions, useApp } from '../../state/store'
import { section } from '../layout/SectionShell'
import { SectionHeader } from '../ui/primitives'
import { StatusBadge } from '../ui/primitives'
import type { HazardLayer } from '../../types/hazard'
import { HazardMap } from './HazardMap'
import { HazardModules, StormSurgeStrip } from './HazardModules'
import { Rule } from '../ui/editorial'

export function HazardsSection() {
  const hazards = useHazards()
  const regions = useHazardRegions()
  const layer = useApp((s) => s.hazardLayer)

  return (
    <section id="hazards" className={`${section} scroll-mt-24 bg-parcel/40`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeader
          index="04"
          eyebrow="Understand the Impact"
          title="Multi-Hazard Forecast"
          subtitle="TOOFAN fuses rainfall, flood, landslide, storm-surge and wind guidance into one integrated impact picture."
        />
        <div className="lg:pb-2">
          <StatusBadge status={hazards.status} />
        </div>
      </div>

      {/* ---- hazard selector: flat underline nav ---- */}
      <nav className="mt-10 flex gap-6 overflow-x-auto border-b border-ink-200">
        {hazards.hazards.map((h) => (
          <button
            key={h.type}
            onClick={() => appActions.setHazard(h.type as HazardLayer)}
            className={`whitespace-nowrap border-b-2 pb-3 font-mono text-[0.66rem] font-semibold uppercase tracking-wider transition ${
              layer === h.type ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-400 hover:text-ink-700'
            }`}
          >
            {h.label}
          </button>
        ))}
      </nav>

      {/* ---- hazard map: dominant artifact ---- */}
      <div className="mt-6">
        <HazardMap regions={regions.filter((r) => r.type === layer)} layer={layer} />
      </div>

      <Rule className="mt-10" />

      {/* ---- hazard modules: open columns ---- */}
      <div className="mt-8">
        <HazardModules />
      </div>

      <StormSurgeStrip />
    </section>
  )
}