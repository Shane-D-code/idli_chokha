import RotatingEarth, { type GlobeOverlay } from '../ui/wireframe-dotted-globe'
import { FolderObject } from '../ui/primitives'
import { ArtifactFrame, Tag } from '../ui/editorial'
import { useCyclone, useForecastTrack, useObserved } from '../../hooks'
import { getCycloneAbbr, getIntensityColor, intensityColorOf } from '../../lib/ua'
import { formatLatLon } from '../../lib/geo'

/**
 * The hero centerpiece — the Earth rendered as a single artifact frame.
 * A wireframe dotted globe with drag-to-rotate and scroll-to-zoom; small
 * objects orbit it. Pure demo imagery — never presented as real satellite.
 */
export function CycloneVisualization() {
  const cyclone = useCyclone()
  const observed = useObserved()
  const track = useForecastTrack()

  const overlay: GlobeOverlay = {
    current: cyclone.position,
    currentColor: getIntensityColor(cyclone.windKt),
    observed: observed.map((p) => p.position),
    forecast: track.map((p) => p.position),
    forecastColors: track.map((p) => intensityColorOf(p.windKt)),
  }

  return (
    <ArtifactFrame>
      {/* open label row — part of the frame, not a card */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <p className="typed text-ink-500">Earth · Wireframe</p>
        <Tag className="text-haze-700">Interactive</Tag>
      </div>

      {/* the globe — objects orbit it */}
      <div className="relative p-3 sm:p-4">
        <div className="relative mx-auto w-full max-w-[620px]">
          <RotatingEarth width={600} height={600} overlay={overlay} />
          {/* live cyclone readout — real coordinates projected onto the globe */}
          <div className="absolute left-1/2 top-2 z-10 hidden -translate-x-1/2 flex-col items-center gap-1 text-center sm:flex">
            <span className="font-mono text-[0.55rem] tracking-[0.2em] text-ink-400">CURRENT</span>
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[0.6rem] font-semibold tracking-wider text-white"
              style={{ backgroundColor: getIntensityColor(cyclone.windKt) }}
            >
              {getCycloneAbbr(cyclone.windKt)} · {cyclone.windKt} kt · {cyclone.pressureHpa} hPa
            </span>
            <span className="font-mono text-[0.55rem] text-ink-500">{formatLatLon(cyclone.position)}</span>
          </div>
          <FolderObject
            label="Forecast"
            href="#forecast"
            tint="#E6F2F8"
            className="absolute -top-3 right-8 z-10 hidden rotate-1 lg:inline-flex"
          />
        </div>
      </div>

      {/* open toolbar strip — controls float over the frame */}
      <div className="flex items-center justify-between border-t border-ink-200/70 bg-cloud/40 px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[0.58rem] text-ink-500">
          <span className="h-1.5 w-1.5 rounded-full bg-safe-500" />
          LIVE ROTATION
        </div>
        <span className="hidden font-mono text-[0.56rem] text-ink-400 sm:inline">Drag to rotate · scroll to zoom</span>
      </div>
    </ArtifactFrame>
  )
}