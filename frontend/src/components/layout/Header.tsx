import { Diamond, Loader2, Play, Waves } from 'lucide-react'
import { useClock, useScrollSpy } from '../../hooks/useScrollSpy'
import { appActions, useApp } from '../../state/store'

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'genesis', label: 'Genesis' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'hazards', label: 'Hazards' },
  { id: 'districts', label: 'Districts' },
  { id: 'environment', label: 'Environment' },
  { id: 'explain', label: 'Model' },
  { id: 'data', label: 'Data' },
]

/** Floating desktop-style toolbar — cream sheet, editorial labels. */
export function Header() {
  const active = useScrollSpy(NAV.map((n) => n.id))
  const clock = useClock()
  const backendOnline = useApp((s) => s.backendOnline)
  const pipeline = useApp((s) => s.pipeline)
  const running = pipeline.running

  return (
    <header className="fixed inset-x-0 top-3 z-50 px-3 sm:px-6">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 rounded-2xl border border-ink-200/70 bg-cloud/85 px-4 shadow-float backdrop-blur-md lg:px-5">
        <a href="#overview" className="group flex items-center gap-3">
          <span className="flex h-9 w-9 rotate-45 items-center justify-center rounded-[10px] border border-ink-200 bg-cloud shadow-soft">
            <span className="-rotate-45 flex items-center justify-center">
              <Diamond className="h-4 w-4 text-brand-500" />
            </span>
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-serif text-[1.35rem] font-normal tracking-tight text-ink-900">TOOFAN</span>
            <span className="mt-0.5 font-mono text-[0.5rem] font-semibold uppercase tracking-[0.28em] text-brand-600">
              Cyclone Intelligence
            </span>
          </span>
        </a>

        <nav className="no-scrollbar hidden items-center gap-1 overflow-x-auto lg:flex">
          {NAV.map((n) => (
            <a
              key={n.id}
              href={`#${n.id}`}
              className={`relative whitespace-nowrap px-3 py-1.5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] transition ${
                active === n.id ? 'text-brand-600' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {n.label}
              <span
                aria-hidden
                className={`absolute inset-x-3 bottom-0.5 h-0.5 rounded-full bg-brand-500 transition-opacity ${active === n.id ? 'opacity-100' : 'opacity-0'}`}
              />
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void appActions.runPipeline()}
            disabled={running || !backendOnline}
            title={backendOnline ? 'Run the FANI (2019) archive storm through the live pipeline' : 'Backend not connected on :8000 — start `uvicorn backend.app.main:app`'}
            className="flex items-center gap-1.5 rounded-full border border-ink-200 bg-cloud px-2.5 py-1 font-mono text-[0.6rem] font-bold uppercase tracking-widest text-ink-600 shadow-soft transition hover:border-brand-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {running ? 'Running' : 'Run pipeline'}
          </button>
          <span className="hidden items-center gap-1.5 rounded-full border border-ink-200 bg-cloud px-2.5 py-1 font-mono text-[0.6rem] text-ink-500 md:flex">
            <Waves className="h-3 w-3 text-brand-400" />
            <span suppressHydrationWarning>{clock.time} UTC</span>
          </span>
          <span className="hidden items-center rounded-lg border border-ink-200 bg-cloud px-2.5 py-1 font-serif text-[0.8rem] italic text-ink-400 lg:flex">
            № 02 · archive
          </span>
        </div>
      </div>
    </header>
  )
}