import { Satellite, Wind, Layers, Activity, Sparkles, Target, TrendingUp, Waves, MapPinned, ArrowDown, Brain } from 'lucide-react'
import { section } from '../layout/SectionShell'
import { SectionHeader } from '../ui/primitives'
import { FeatureImportance } from './FeatureImportance'

const PIPELINE = [
  { label: 'Satellite', sub: 'INSAT · IR/WV/Vis', icon: Satellite },
  { label: 'Environmental', sub: 'ERA5 · ocean & wind', icon: Wind },
  { label: 'Feature Engineering', sub: 'derived predictors', icon: Layers },
  { label: 'Detection', sub: 'cyclone presence', icon: Activity },
  { label: 'Genesis', sub: 'formation probability', icon: Sparkles },
  { label: 'Track', sub: 'trajectory + cone', icon: Target },
  { label: 'Intensity', sub: 'wind · pressure', icon: TrendingUp },
  { label: 'Multi-Hazard', sub: 'rain · flood · surge', icon: Waves },
  { label: 'District Risk', sub: 'impact per district', icon: MapPinned },
]

const MODELS: { name: string; kind: string; detail: string }[] = [
  { name: 'GENESIS', kind: 'Ensemble of gradient-boosted trees + random forest', detail: 'Blends an overnight forecast ensemble with local ocean/wind diagnostics.' },
  { name: 'DETECTION', kind: 'Deep CNN over 5-channel satellite tiles', detail: 'Returns a binary presence probability per 4h scan.' },
  { name: 'INTENSITY', kind: 'Sequence model on TCHP + shear + structure', detail: 'Regresses MSLP and wind in 6-hourly steps.' },
  { name: 'TRACK', kind: 'Trajectory transformer with ensemble spread', detail: 'Trajectory V12 outputs position + cross-track uncertainty.' },
  { name: 'LANDSLIDE', kind: 'Slope · soil moisture · rainfall fusion', detail: 'Fuses GSI slope classes with 72h rainfall and soil moisture.' },
  { name: 'HAZARD FUSION', kind: 'Multi-hazard impact summariser', detail: 'Combines rainfall, flood, surge, wind into a single impact deck.' },
]

export function Explain() {
  return (
    <section id="explain" className={`${section} scroll-mt-24`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeader
          index="07"
          eyebrow="Why the Model Thinks This"
          title="Model Explanation"
          subtitle="A transparent pipeline turns raw observations into district-level guidance — each stage explainable and auditable."
        />
        <div className="flex items-center gap-2 pb-2 font-mono text-[0.6rem] uppercase tracking-wider text-ink-400">
          <Brain className="h-4 w-4 text-brand-500" />
          AI Explainability
        </div>
      </div>

      {/* ---- pipeline: continuous rail ---- */}
      <div className="no-scrollbar mt-10 overflow-x-auto">
        <div className="relative flex min-w-[760px] items-stretch">
          <div aria-hidden className="absolute left-8 right-8 top-[15px] h-px bg-ink-300" />
          <div aria-hidden className="absolute left-8 right-8 top-[15px] z-10" />
          {PIPELINE.map((s, i) => {
            const Icon = s.icon
            return (
              <div key={s.label} className="relative flex flex-1 flex-col items-center gap-2">
                <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full border border-ink-300 bg-cloud text-brand-600 shadow-soft">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="mt-1 text-center text-[0.62rem] font-bold text-ink-800">{s.label}</span>
                <span className="hidden text-center font-mono text-[0.5rem] leading-tight text-ink-400 lg:block">{s.sub}</span>
                {i < PIPELINE.length - 1 ? (
                  <ArrowDown className="absolute -right-[14px] top-[11px] z-10 h-3 w-3 rotate-[-90deg] text-ink-300" />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
      <p className="mt-4 font-mono text-[0.56rem] text-ink-400">
        Each stage stands in for the exact production component; fixture data drives the outputs you see on this page.
      </p>

      {/* ---- model registry: open rows ---- */}
      <div className="mt-10">
        <div className="flex items-baseline justify-between border-b border-ink-200 pb-2">
          <p className="typed text-[0.58rem] text-brand-600">Model Registry</p>
          <span className="font-mono text-[0.56rem] text-ink-300">{MODELS.length} MODELS</span>
        </div>
        <div>
          {MODELS.map((m) => (
            <div
              key={m.name}
              className="grid grid-cols-12 items-baseline gap-x-4 border-b border-ink-100 py-3.5 transition last:border-b-0"
            >
              <div className="col-span-12 sm:col-span-3">
                <span className="font-mono text-[0.8rem] font-bold tracking-wider text-brand-600">{m.name}</span>
              </div>
              <p className="col-span-12 text-[0.82rem] font-semibold text-ink-800 sm:col-span-4">{m.kind}</p>
              <p className="col-span-12 text-[0.75rem] leading-relaxed text-ink-500 sm:col-span-5">{m.detail}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ---- feature importance ---- */}
      <div className="mt-10">
        <FeatureImportance />
      </div>
    </section>
  )
}