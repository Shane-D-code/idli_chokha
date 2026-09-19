import type { RegionProjection } from './projection'
import { graticuleLines, graticuleLabels } from './projection'
import { multipolygonPath } from './geometryPath'
import { regionLand, regionCountries, regionStates, regionDistricts } from '../../lib/geoData'

/**
 * Purely geographic base rendered under all map overlays: ocean, graticule,
 * land, countries, states and (optionally) districts. Kept canvas-free SVG so
 * it is crisp at every zoom.
 */
export function Geography({
  proj,
  showStates = true,
  showDistricts = false,
  districtFill,
}: {
  proj: RegionProjection
  showStates?: boolean
  showDistricts?: boolean
  districtFill?: (name: string) => string
}) {
  const grid = graticuleLines(proj)
  const labels = graticuleLabels(proj)

  return (
    <g>
      {/* Ocean base */}
      <rect x={-2} y={-2} width={proj.width + 4} height={proj.height + 4} fill="#eaf4fa" rx={10} />

      {/* Graticule */}
      {grid.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#c2dcec" strokeWidth={0.6} opacity={0.55} />
      ))}
      {labels.xs.map((t, i) => (
        <text key={`x${i}`} x={t.x} y={t.y} fontSize={9} fill="#8fb2c8" fontFamily="var(--font-mono)">
          {t.text}
        </text>
      ))}
      {labels.ys.map((t, i) => (
        <text key={`y${i}`} x={t.x} y={t.y} fontSize={9} fill="#8fb2c8" fontFamily="var(--font-mono)" textAnchor="end">
          {t.text}
        </text>
      ))}

      {/* Land + countries */}
      <path d={multipolygonPath(proj, regionLand)} fill="#e8f4ea" opacity={0.9} />
      {regionCountries.features.map((f, i) => {
        const name = f.properties.name
        const isIndia = name === 'India'
        return (
          <path
            key={`c${i}`}
            d={multipolygonPath(proj, f.geometry)}
            fill={isIndia ? '#f3e9d8' : '#e8f4ea'}
            stroke="#b9ccd9"
            strokeWidth={0.7}
          />
        )
      })}

      {/* Districts (coastal analysis layer) */}
      {showDistricts &&
        regionDistricts.features.map((f, i) => (
          <path
            key={`d${i}`}
            d={multipolygonPath(proj, f.geometry)}
            fill={districtFill ? districtFill(f.properties.name) : 'transparent'}
            stroke="#9d8b6a"
            strokeWidth={0.5}
            opacity={0.85}
          />
        ))}

      {/* States */}
      {showStates &&
        !showDistricts &&
        regionStates.features.map((f, i) => (
          <path
            key={`s${i}`}
            d={multipolygonPath(proj, f.geometry)}
            fill="transparent"
            stroke="#94b7cb"
            strokeWidth={0.6}
            opacity={0.9}
            strokeDasharray="2 2"
          />
        ))}
    </g>
  )
}