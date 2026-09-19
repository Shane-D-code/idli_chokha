import { useMemo } from 'react'
import type { FeatureImportanceItem } from '../../types/common'

/** ILLUSTRATIVE feature importance — open horizontal bars, no card. */
export function FeatureImportance() {
  const items = useMemo<FeatureImportanceItem[]>(
    () => [
      { feature: 'Sea Surface Temperature', contribution: 0.94, description: 'Warm pool > 28°C across the Bay of Bengal' },
      { feature: 'Tropical Cyclone Heat Potential', contribution: 0.88, description: 'Deep ocean heat reservoir available for intensification' },
      { feature: 'Relative Vorticity', contribution: 0.79, description: 'Rotational spin in the low levels' },
      { feature: 'Mid-Level Humidity', contribution: 0.71, description: 'Moisture for deep convection' },
      { feature: 'Vertical Wind Shear', contribution: 0.64, description: 'Low shear allows organised structure' },
      { feature: 'Ocean Heat Content', contribution: 0.55, description: 'Supporting sustained deepening' },
    ],
    [],
  )

  const max = Math.max(...items.map((i) => i.contribution))

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-200 pb-2">
        <p className="typed text-[0.58rem] text-brand-600">Feature Importance</p>
        <span className="font-mono text-[0.56rem] font-semibold uppercase tracking-wider text-warn-600">Illustrative Feature Importance</span>
      </div>
      <div className="mt-6">
        {items.map((it) => (
          <div key={it.feature} className="border-b border-ink-100 py-2.5 last:border-b-0">
            <div className="grid items-baseline gap-x-6 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <div className="truncate text-[0.78rem] font-semibold text-ink-800" title={it.feature}>
                  {it.feature}
                </div>
                <div className="truncate font-mono text-[0.52rem] text-ink-400">{it.description}</div>
              </div>
              <div className="mt-1.5 flex items-center gap-3 lg:col-span-8 lg:mt-0">
                <div className="h-1.5 flex-1 bg-ink-100">
                  <div
                    className="h-full bg-gradient-to-r from-brand-500 to-brand-600"
                    style={{ width: `${(it.contribution / max) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-[0.62rem] font-bold text-ink-700">
                  {Math.round(it.contribution * 100)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}