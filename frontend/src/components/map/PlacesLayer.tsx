import { demoPlaces } from '../../data/demo/places'
import type { RegionProjection } from './projection'

/**
 * Zoom-dependent geographic labels: countries/capitals at low zoom, states and
 * major coastal cities at medium zoom, towns/ports at high zoom.
 */
export function PlacesLayer({ proj, zoom, mode }: { proj: RegionProjection; zoom: number; mode: 'map' | 'globe' }) {
  if (mode === 'globe') return null
  const visible = demoPlaces.filter((p) => zoom >= p.minZoom)
  return (
    <g pointerEvents="none">
      {visible.map((p) => {
        const x = proj.xOf(p.position.lon)
        const y = proj.yOf(p.position.lat)
        const isSea = p.kind === 'sea'
        const isCountry = p.kind === 'country'
        const major = isCountry || p.major
        const fontSize = major ? 12 : p.kind === 'state' || p.kind === 'city' ? 10.5 : 9.5
        return (
          <g key={p.id} opacity={isSea ? 0.82 : 0.95}>
            {isSea ? null : <circle cx={x} cy={y} r={major ? 2.2 : 1.4} fill={isCountry ? '#d8a24a' : '#61788a'} />}
            <text
              x={x}
              y={y + (isSea ? 0 : 4)}
              fontSize={fontSize}
              fontFamily="var(--font-sans)"
              fontWeight={major ? 700 : 500}
              fontStyle={isSea ? 'italic' : 'normal'}
              fill={isSea ? '#87a9bf' : '#29465b'}
              textAnchor="middle"
              style={{ paintOrder: 'stroke' }}
              stroke={isSea ? 'transparent' : 'rgba(245,250,253,0.92)'}
              strokeWidth={3.5}
            >
              {p.name}
            </text>
            {p.extra ? (
              <text x={x} y={y + 16} fontSize={8} fill="#61788a" textAnchor="middle" opacity={0.8}>
                {p.extra}
              </text>
            ) : null}
          </g>
        )
      })}
    </g>
  )
}