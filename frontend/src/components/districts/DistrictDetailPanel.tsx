import { SearchX, Navigation, Clock3, TrendingUp, TrendingDown, MoveRight, ArrowUpRight } from 'lucide-react'
import { useSelectedDistrict, useCyclone } from '../../hooks/index'
import { appActions } from '../../state/store'
import { RiskBadge } from '../ui/primitives'
import { distanceText } from './districtFormatters'
import { compassLabel } from '../../lib/geo'
import { Rule } from '../ui/editorial'

export function DistrictDetailPanel() {
  const d = useSelectedDistrict()
  const c = useCyclone()

  if (!d) {
    return (
      <div className="flex min-h-[420px] flex-col items-start justify-center border-l border-ink-200 pl-8 lg:sticky lg:top-24">
        <span className="flex h-10 w-10 items-center justify-center border border-ink-200 text-ink-300">
          <SearchX className="h-5 w-5" />
        </span>
        <p className="mt-4 font-serif text-xl italic text-ink-700">Select a district to see its impact picture.</p>
        <p className="mt-2 max-w-xs font-mono text-[0.64rem] leading-relaxed text-ink-400">
          Search, quick-select, or click any district on the map to open its detail here.
        </p>
      </div>
    )
  }

  const trendIcon =
    d.approachTrend === 'Approaching' ? <TrendingUp className="h-3.5 w-3.5" /> : d.approachTrend === 'Receding' ? <TrendingDown className="h-3.5 w-3.5" /> : <MoveRight className="h-3.5 w-3.5" />;

  return (
    <div className="flex flex-col gap-5 lg:sticky lg:top-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="typed text-[0.56rem] text-brand-600">District Impact</p>
          <h3 className="display mt-1 text-2xl font-normal tracking-tight text-ink-900">{d.name}</h3>
          <p className="font-mono text-[0.6rem] uppercase tracking-widest text-ink-400">{d.state}</p>
        </div>
        <RiskBadge level={d.riskLevel} />
      </div>

      {/* metrics: open ruled grid */}
      <div className="grid grid-cols-2 divide-x divide-ink-100 border-y border-ink-100">
        <div className="px-4 py-3">
          <div className="typed flex items-center gap-1.5 text-[0.48rem] text-ink-400">
            <Navigation className="h-3 w-3" />
            Distance to centre
          </div>
          <div className="mt-1 font-mono text-[0.9rem] font-bold text-ink-900">{distanceText(d.distanceKm)}</div>
        </div>
        <div className="px-4 py-3">
          <div className="typed flex items-center gap-1.5 text-[0.48rem] text-ink-400">
            <Navigation className="h-3 w-3" />
            Nearest approach
          </div>
          <div className="mt-1 font-mono text-[0.9rem] font-bold text-ink-900">{distanceText(d.closestApproachKm)}</div>
        </div>
        <div className="border-t border-ink-100 px-4 py-3">
          <div className="typed flex items-center gap-1.5 text-[0.48rem] text-ink-400">
            <Clock3 className="h-3 w-3" />
            Approach time
          </div>
          <div className="mt-1 font-mono text-[0.9rem] font-bold text-ink-900">{d.approachTime ?? 'No approach'}</div>
        </div>
        <div className="border-t border-ink-100 px-4 py-3">
          <div className="typed flex items-center gap-1.5 text-[0.48rem] text-ink-400">
            <MoveRight className="h-3 w-3" />
            Storm movement
          </div>
          <div className="mt-1 font-mono text-[0.9rem] font-bold text-ink-900">
            {c.movement} · {compassLabel(c.bearingDeg)}
          </div>
        </div>
      </div>

      {/* trend: open row */}
      <div className="flex items-center gap-2 border-y border-ink-100 py-3">
        <span className={d.approachTrend === 'Approaching' ? 'text-haze-700' : 'text-ink-500'}>{trendIcon}</span>
        <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-wider text-ink-800">
          System {d.approachTrend}
        </span>
        <span className="ml-auto flex items-center gap-1 text-right font-mono text-[0.58rem] text-ink-400">
          {c.name} · +{c.uncertaintyKm} km <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>

      {/* what it means */}
      <div>
        <div className="typed text-[0.54rem] text-ink-400">What it means</div>
        <p className="mt-1.5 text-[0.85rem] leading-relaxed text-ink-600">{d.situation}</p>
      </div>

      <Rule />

      {/* safety & monitoring */}
      <div>
        <div className="typed text-[0.54rem] text-ink-400">Safety & monitoring</div>
        <ul className="mt-1.5 space-y-1.5">
          {d.safetyAndMonitoring.map((s, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[0.82rem] leading-snug text-ink-600">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-500" />
              {s}
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={() => appActions.selectDistrict(null)}
        className="self-start border-b border-ink-300 pb-0.5 font-mono text-[0.64rem] font-semibold uppercase tracking-wider text-ink-500 transition hover:border-brand-500 hover:text-brand-600"
      >
        Clear selection
      </button>
    </div>
  )
}