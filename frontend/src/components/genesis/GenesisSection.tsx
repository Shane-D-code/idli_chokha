import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react'
import { useGenesis, useCyclone } from '../../hooks/index'
import { Ring, SectionHeader } from '../ui/primitives'
import { Reveal } from '../ui/Reveal'
import { section } from '../layout/SectionShell'
import { Rule } from '../ui/editorial'
import { useApp } from '../../state/store'
import { formatDate } from '../../lib/format'
import { SatelliteViewer } from './SatelliteViewer'
import type { Favourability } from '../../types/common'
import type { GenesisHorizon } from '../../types/genesis'

const FAV_ICON: Record<Favourability, typeof CheckCircle2> = {
  favourable: CheckCircle2,
  moderate: MinusCircle,
  unfavourable: XCircle,
}
const FAV_COLOR: Record<Favourability, string> = {
  favourable: '#2f8f58',
  moderate: '#d98f1f',
  unfavourable: '#d63a3a',
}
const FAV_LABEL: Record<Favourability, string> = {
  favourable: 'FAVOURABLE',
  moderate: 'MODERATE',
  unfavourable: 'UNFAVOURABLE',
}

export function GenesisSection() {
  const genesis = useGenesis()
  const c = useCyclone()
  const demoMode = useApp((s) => s.demoMode)

  return (
    <section id="genesis" className={`${section} scroll-mt-24`}>
      <Reveal>
        <SectionHeader
          index="02"
          eyebrow="Origin Story"
          title="Genesis + Satellite"
          subtitle={
            demoMode
              ? 'A cyclone starts long before it is a cyclone — a drifting disturbance, a warm sea, a column of rising air. These pages trace AMPHAN from its first spark of organization and show you the sky as the satellite reads it.'
              : `A cyclone starts long before it is a cyclone. These pages trace ${c.name} (${formatDate(genesis.validAt)}) through the real pipeline — genesis probability, observed intensification and the sky as this deployment reads it.`
          }
        />
      </Reveal>

      {/* ---- genesis windows: open grid, gauge is the object ---- */}
      <Reveal>
        <div className="mt-10 flex items-baseline justify-between">
          <p className="typed text-ink-500">GENESIS WINDOWS</p>
          <span className="font-mono text-[0.56rem] text-ink-300">When does Toofan alert?</span>
        </div>
      </Reveal>
      <div className="mt-2 grid grid-cols-1 divide-y divide-ink-100 border-y border-ink-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {genesis.predictions.map((p) => (
          <PredictionWindow key={p.horizonHours} hours={p.horizonHours} probability={p.probability} threshold={p.threshold} category={p.category} />
        ))}
      </div>

      {genesis.model || genesis.risk ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-ink-100 pb-3 font-mono text-[0.58rem] text-ink-500">
          {genesis.model ? (
            <span>
              MODEL <span className="font-bold text-ink-800">{genesis.model}</span>
            </span>
          ) : null}
          <span>
            CALIBRATION{' '}
            <span className={genesis.calibrated ? 'font-bold text-safe-600' : 'font-bold text-haze-700'}>
              {genesis.calibrated ? 'CALIBRATED' : 'UNCALIBRATED'}
            </span>
          </span>
          {genesis.risk ? (
            <span>
              RISK <span className="font-bold text-ink-800">{genesis.risk}</span>
            </span>
          ) : null}
          {genesis.threshold != null ? (
            <span>
              THRESHOLD <span className="font-bold text-ink-800">{genesis.threshold}%</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <Rule className="mt-14" />

      <div className="mt-8 grid gap-x-12 gap-y-10 lg:grid-cols-2">
        {/* ---- environmental conditions: ruled data sheet ---- */}
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="typed text-ink-500">Environmental Conditions</p>
            <span className="font-mono text-[0.56rem] text-ink-400">
              VALID {new Date(genesis.validAt).toISOString().slice(0, 16).replace('T', ' ')}Z
            </span>
          </div>
          <div className="mt-2">
            <div className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-4 border-y border-ink-200 py-2">
              <span className="typed text-ink-400">Variable</span>
              <span className="typed text-ink-400">Value</span>
              <span className="typed text-ink-400">Status</span>
            </div>
            {genesis.conditions.map((c) => {
              const Icon = FAV_ICON[c.favourability]
              return (
                <div key={c.id} className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-4 border-b border-ink-100 py-2.5">
                  <div>
                    <span className="text-[0.86rem] font-medium text-ink-800">{c.variable}</span>
                    <span className="ml-2 hidden font-mono text-[0.58rem] text-ink-400 sm:inline">{c.note}</span>
                  </div>
                  <div className="font-mono text-[0.92rem] font-semibold text-ink-900">
                    {c.value}
                    <span className="ml-1 text-[0.6rem] font-normal text-ink-400">{c.unit}</span>
                  </div>
                  <span className="flex items-center gap-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-wider" style={{ color: FAV_COLOR[c.favourability] }}>
                    <Icon className="h-3.5 w-3.5" />
                    {FAV_LABEL[c.favourability]}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ---- satellite observation: full meteorological viewer ---- */}
        <div>
          <SatelliteViewer />
        </div>
      </div>
    </section>
  )
}

function PredictionWindow({
  hours,
  probability,
  threshold,
  category,
}: {
  hours: GenesisHorizon
  probability: number
  threshold: number
  category: 'LOW' | 'MODERATE' | 'HIGH'
}) {
  const colourMap = { LOW: '#c9a15c', MODERATE: '#d98f1f', HIGH: '#d63a3a' }
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <span className="font-mono text-[0.6rem] font-bold uppercase tracking-[0.2em] text-ink-400">GENESIS · {hours}H</span>
      <div className="flex items-center gap-5">
        <Ring value={probability} size={88} stroke={7} color={colourMap[category]} />
        <div className="flex flex-col gap-1">
          <div className="font-mono text-4xl font-bold leading-none tracking-tight text-ink-900">
            {probability.toFixed(1)}
            <span className="ml-1 text-base text-ink-400">%</span>
          </div>
          <span className="font-mono text-[0.62rem] font-bold uppercase tracking-wider" style={{ color: colourMap[category] }}>
            {category}
          </span>
          <span className="font-mono text-[0.56rem] text-ink-400">Threshold {threshold}%</span>
        </div>
      </div>
      <p className="text-[0.8rem] leading-snug text-ink-500">
        {probability >= threshold ? `Development likely within ${hours}h.` : `Conditions not yet sufficient within ${hours}h.`}
      </p>
    </div>
  )
}