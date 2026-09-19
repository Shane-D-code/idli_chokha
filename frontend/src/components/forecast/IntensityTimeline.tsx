import { useLifecycle } from '../../hooks/index'
import { getIntensityColor, getIntensityTint } from '../../lib/ua'
import { hoursLabel } from '../../lib/format'

/** Continuous open timeline — dots on a thin line, values above, NOW highlighted. */
export function IntensityTimeline() {
  const lifecycle = useLifecycle()

  if (lifecycle.length < 2) {
    return (
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="typed text-brand-600">Intensity Timeline</p>
          <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-haze-700">NOT AVAILABLE</span>
        </div>
        <p className="mt-3 border-l-2 border-warn-500/40 pl-3 text-[0.78rem] leading-relaxed text-ink-500">
          This run produces a position-only track — no 2-hourly intensity series was returned. Only the now-observed
          {lifecycle[0] && lifecycle[0].windKt !== undefined ? ` ${lifecycle[0].windKt} kt` : ' state'} is known.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="typed text-brand-600">Intensity Timeline · NOW → +24H</p>
        <span className="font-mono text-[0.56rem] text-ink-300">2-HOURLY</span>
      </div>
      <div className="relative mt-5">
        <div aria-hidden className="absolute left-3 right-3 top-[28px] h-px bg-ink-200" />
        <div className="no-scrollbar relative flex items-start gap-1.5 overflow-x-auto pb-2">
          {lifecycle.map((p, i) => {
            const color = getIntensityColor(p.windKt)
            const isNow = i === 0
            return (
              <div key={p.hours} className="relative flex min-w-[54px] flex-1 flex-col items-center">
                <span className="font-mono text-[0.74rem] font-bold" style={{ color }}>
                  {p.windKt} <span className="text-[0.5rem] font-normal text-ink-400">kt</span>
                </span>
                <span
                  className={`z-10 mt-1.5 h-3.5 w-3.5 rounded-full border-2 ${isNow ? 'ring-2 ring-offset-1' : ''}`}
                  style={
                    isNow
                      ? { background: color, borderColor: color, ['--tw-ring-color' as string]: `${color}55` }
                      : { background: getIntensityTint(p.windKt), borderColor: color }
                  }
                />
                <span className={`mt-1.5 font-mono text-[0.58rem] ${isNow ? 'font-bold text-ink-800' : 'text-ink-500'}`}>
                  {hoursLabel(p.hours)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}