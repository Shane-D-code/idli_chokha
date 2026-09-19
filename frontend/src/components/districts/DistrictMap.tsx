import { useMemo } from 'react'
import { regionProjection } from '../map/projection'
import { multipolygonPath } from '../map/geometryPath'
import { PlacesLayer } from '../map/PlacesLayer'
import { regionDistricts } from '../../lib/geoData'
import { useDistricts } from '../../hooks/index'
import { appActions, useApp } from '../../state/store'
import type { RiskLevel } from '../../types/common'

const RISK_FILL: Record<RiskLevel, string> = {
  low: 'rgba(57,169,107,0.28)',
  moderate: 'rgba(242,169,59,0.42)',
  high: 'rgba(232,137,47,0.55)',
  severe: 'rgba(232,76,76,0.62)',
}

const ALIASES: Record<string, string> = {
  Baleshwar: 'balasore',
  'South 24 Parganas': 'south24',
  'North 24 Parganas': 'north24',
  Jagatsinghapur: 'jagatsinghpur',
  'North & Middle Andaman': 'nma',
  Nagappattinam: 'nagapattinam',
  'East Godavari': 'eastgodavari',
  'West Godavari': 'westgodavari',
  Visakhapatnam: 'visakhapatnam',
  Srikakulam: 'srikakulam',
  Vizianagaram: 'vizianagaram',
  Puri: 'puri',
  Ganjam: 'ganjam',
  Khordha: 'khordha',
  Cuttack: 'cuttack',
  'Purba Medinipur': 'purba-medinipur',
  Medinipur: 'purba-medinipur',
  Kolkata: 'kolkata',
  Gajapati: 'gajapati',
  Mayurbhanj: 'mayurbhanj',
  Kendujhar: 'keonjhar',
  Jajapur: 'jajapur',
  Kendrapara: 'kendrapara',
  Bhadrak: 'bhadrak',
  Balasore: 'balasore',
}

export function DistrictMap() {
  const proj = useMemo(() => regionProjection(1), [])
  const districts = useDistricts()
  const selectedId = useApp((s) => s.selectedDistrictId)

  const riskById = useMemo(() => {
    const map = new Map<string, { risk: RiskLevel; id: string }>()
    for (const d of districts.districts) map.set(d.name.toLowerCase(), { risk: d.riskLevel, id: d.id })
    return map
  }, [districts])

  return (
    <div className="relative overflow-hidden rounded-xl border border-ink-200 bg-mist shadow-soft">
      <svg viewBox={`0 0 ${proj.width} ${proj.height}`} className="block w-full" style={{ maxHeight: 420 }} preserveAspectRatio="xMidYMid meet">
        <rect x={-4} y={-4} width={proj.width + 8} height={proj.height + 8} fill="#f2f6f9" rx={8} />
        {regionDistricts.features.map((f, i) => {
          const name = f.properties.name
          const entry = riskById.get(name.toLowerCase()) ?? riskById.get(ALIASES[name]?.toLowerCase() ?? '')
          return (
            <path
              key={i}
              d={multipolygonPath(proj, f.geometry)}
              fill={entry ? RISK_FILL[entry.risk] : 'transparent'}
              stroke={entry ? '#ffffff' : '#a8a8a8'}
              strokeWidth={0.6}
              className={entry ? 'cursor-pointer transition-opacity hover:opacity-80' : ''}
              onClick={() => entry && appActions.selectDistrict(entry.id)}
            >
              {entry ? <title>{name}</title> : null}
            </path>
          )
        })}
        <PlacesLayer proj={proj} zoom={1.05} mode="map" />

        {/* selected highlight */}
        {selectedId
          ? (() => {
              const d = districts.districts.find((x) => x.id === selectedId)
              if (!d) return null
              const x = proj.xOf(d.position.lon)
              const y = proj.yOf(d.position.lat)
              return (
                <circle cx={x} cy={y} r={8} fill={RISK_FILL[d.riskLevel]} stroke="#102A43" strokeWidth={2} className="pointer-events-none" />
              )
            })()
          : null}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-100 px-4 py-2">
        {(['low', 'moderate', 'high', 'severe'] as const).map((l) => (
          <span key={l} className="flex items-center gap-1.5 font-mono text-[0.58rem] text-ink-400">
            <span className="h-2 w-2 rounded-sm" style={{ background: RISK_FILL[l] }} />
            {l.charAt(0).toUpperCase() + l.slice(1)}
          </span>
        ))}
        <span className="ml-auto font-mono text-[0.58rem] text-ink-300">CLICK A DISTRICT</span>
      </div>
    </div>
  )
}