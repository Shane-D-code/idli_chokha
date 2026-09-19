import { Diamond } from 'lucide-react'

export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-parcel">
      <div className="hairline h-px w-full" />
      <div className="pointer-events-none absolute inset-0 opacity-60 paper-grain" />
      <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-8 px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 rotate-45 items-center justify-center rounded-xl border border-ink-200 bg-cloud shadow-soft">
            <span className="-rotate-45 flex items-center justify-center">
              <Diamond className="h-5 w-5 text-brand-500" />
            </span>
          </span>
          <span className="font-serif text-4xl font-normal tracking-tight text-ink-900">TOOFAN</span>
        </div>

        <p className="max-w-sm text-center font-serif text-lg italic leading-snug text-ink-500">
          watching the atmosphere, before the wave arrives.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:gap-x-8">
          {['OBSERVE', 'PREDICT', 'FORECAST', 'PROTECT'].map((w, i) => (
            <div key={w} className="flex items-center gap-3 sm:gap-6">
              <span className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.3em] text-brand-600">{w}</span>
              {i < 3 ? <span className="text-ink-300" aria-hidden>·</span> : null}
            </div>
          ))}
        </div>

        <p className="max-w-xl text-center text-sm leading-relaxed text-ink-500">
          AI-powered tropical cyclone intelligence for the North Indian Ocean.
          All values shown are simulated data and are not real meteorological
          guidance.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-[0.6rem] uppercase tracking-wider text-ink-400">
          <span>INSAT · ERA5 · IMD · NWP · IMERG · IBTrACS</span>
          <span className="hidden text-ink-300 sm:inline">|</span>
          <span>SIMULATED MODE</span>
        </div>

        <div className="hairline h-px w-full opacity-60" />

        <p className="font-mono text-[0.6rem] text-ink-400">TOOFAN · OBSERVE → PREDICT → FORECAST → PROTECT</p>
      </div>
    </footer>
  )
}