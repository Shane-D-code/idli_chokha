import { Reveal } from '../ui/Reveal'
import { CycloneSystemPanel } from './CycloneSystemPanel'
import { CycloneVisualization } from './CycloneVisualization'
import { CycloneIntelligencePanel } from './CycloneIntelligencePanel'
import { HeroMetrics } from './HeroMetrics'
import { section } from '../layout/SectionShell'
import { useCyclone } from '../../hooks/index'
import { formatFullUtc } from '../../lib/format'

const CHAIN = ['OBSERVE', 'PREDICT', 'FORECAST', 'PROTECT']

export function HeroSection() {
  const c = useCyclone()

  return (
    <section id="overview" className={`${section} pt-28 lg:pt-32`}>
      {/* ---- masthead meta ---- */}
      <Reveal>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-ink-400">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            Tropical Cyclone Intelligence
          </span>
          <span>{c.basin}</span>
          <span className="hidden sm:inline">{formatFullUtc(c.validAt)}</span>
        </div>
      </Reveal>

      {/* ---- oversized editorial opening ---- */}
      <Reveal delay={40}>
        <div className="mt-5 max-w-5xl">
          <h1 className="display text-[clamp(3.6rem,11vw,8.5rem)] font-normal leading-[0.9] tracking-[-0.02em] text-ink-900">
            TOOFAN
          </h1>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <p className="max-w-md font-serif text-lg italic leading-snug text-ink-500 sm:text-2xl">
              watching the atmosphere,
              <br />
              before the wave arrives.
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.24em] text-brand-600">
              {CHAIN.map((w, i) => (
                <span key={w} className="flex items-center gap-3">
                  {w}
                  {i < CHAIN.length - 1 ? <span className="text-ink-300" aria-hidden>→</span> : null}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Reveal>

      {/* ---- open composition: globe + information surface + telemetry rail ---- */}
      <div className="mt-12 grid gap-8 lg:grid-cols-11 lg:items-start">
        <Reveal delay={80} className="lg:col-span-6 lg:order-1">
          <CycloneVisualization />
        </Reveal>

        <Reveal delay={160} className="lg:col-span-3 lg:order-2 lg:pt-2">
          <CycloneSystemPanel />
        </Reveal>

        <Reveal delay={240} className="lg:col-span-2 lg:order-3 lg:pt-2">
          <CycloneIntelligencePanel />
        </Reveal>
      </div>

      {/* ---- open archive metadata strip ---- */}
      <Reveal delay={200}>
        <div className="mt-14">
          <div className="mb-3 flex items-center gap-3">
            <span className="font-mono text-[0.6rem] font-semibold tracking-[0.3em] text-ink-400">FIELD ARCHIVE</span>
            <span className="h-px flex-1 bg-ink-200" aria-hidden />
            <span className="font-mono text-[0.56rem] text-ink-300">{formatFullUtc(c.validAt)}</span>
          </div>
          <HeroMetrics />
        </div>
      </Reveal>
    </section>
  )
}