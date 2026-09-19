import { useGenesis } from '../../hooks/index'
import { Reveal } from '../ui/Reveal'
import { section } from '../layout/SectionShell'
import { Rule, OpenMetric } from '../ui/editorial'

/** Editorial pull-quote band — open typography framed by hairline rules. */
export function StatementStrip() {
  const g = useGenesis()
  const [p24, p48, p72] = g.predictions

  const stamps = [
    { label: 'GENESIS · 24H', value: `${p24?.probability.toFixed(1)}%`, note: p24?.category ?? '' },
    { label: 'GENESIS · 48H', value: `${p48?.probability.toFixed(1)}%`, note: p48?.category ?? '' },
    { label: 'GENESIS · 72H', value: `${p72?.probability.toFixed(1)}%`, note: p72?.category ?? '' },
  ]

  return (
    <section className={`${section} !py-8 lg:!py-12`}>
      <Reveal>
        <Rule />
        <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <p className="typed text-brand-600">TOOFAN Genesis Statement</p>
            <h3 className="mt-2 font-serif text-2xl italic leading-snug text-ink-900 sm:text-[1.8rem]">
              Nature writes in squalls; we translate.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-500">
              Years of meteorological records, experiments, and regional case studies shape how we read the North Indian
              Ocean. TOOFAN concentrates that knowledge into one live, always-on forecast — from the first spark of
              cloud organization to landfall impact.
            </p>
          </div>
          <div className="flex shrink-0 gap-8 lg:pl-10">
            {stamps.map((s) => (
              <OpenMetric key={s.label} label={s.label} value={s.value} note={s.note} className="min-w-[92px]" />
            ))}
          </div>
        </div>
        <Rule className="mt-6" />
      </Reveal>
    </section>
  )
}