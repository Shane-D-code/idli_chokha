import { SectionShell } from '../layout/SectionShell'
import { ForecastMap } from './ForecastMap'
import { CycloneDetails } from './CycloneDetails'
import { ForecastSummary } from './ForecastSummary'
import { ForecastProvenance } from './ForecastProvenance'
import { IntensityTimeline } from './IntensityTimeline'
import { IntensityCharts } from './IntensityCharts'
import { Rule } from '../ui/editorial'
import { useApp } from '../../state/store'

export function ForecastSection() {
  const demoMode = useApp((s) => s.demoMode)
  return (
    <SectionShell
      id="forecast"
      index="03"
      eyebrow="Follow the Path"
      title="Track & Intensity"
      subtitle={
        demoMode
          ? 'The system is forecast to recurve and remain over the Bay of Bengal through +72H. Track, cone of uncertainty and intensity timeline are drawn from a single forecast bundle.'
          : 'Live pipeline: the track and cone of uncertainty are drawn from the LT3P trajectory model. Current observed state is shown; the intensity forecast is not available in this stage.'
      }
    >
      {/* ---- MAP — the primary artifact ---- */}
      <ForecastMap />
      <div className="mt-3">
        <ForecastProvenance />
      </div>

      <Rule className="mt-10" />

      {/* ---- CURRENT CONDITIONS + FORECAST SUMMARY ---- */}
      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <CycloneDetails />
        <ForecastSummary />
      </div>

      <Rule className="mt-10" />

      {/* ---- TIMELINE + CHARTS ---- */}
      <div className="mt-10 grid gap-x-12 gap-y-10">
        <IntensityTimeline />
        <IntensityCharts />
      </div>
    </SectionShell>
  )
}