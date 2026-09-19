import type { ReactNode } from 'react'
import { Reveal } from '../ui/Reveal'
import { SectionHeader } from '../ui/primitives'

/** Standard vertical rhythm + horizontal padding for every page section. */
export const section = 'mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24'

export function SectionShell(props: {
  id: string
  index: string
  eyebrow: string
  title: string
  subtitle?: string
  children: ReactNode
}) {
  const { id, index, eyebrow, title, subtitle, children } = props
  return (
    <section id={id} className={`${section} scroll-mt-24`}>
      <Reveal>
        <SectionHeader index={index} eyebrow={eyebrow} title={title} subtitle={subtitle} />
      </Reveal>
      <div className="mt-10">{children}</div>
    </section>
  )
}