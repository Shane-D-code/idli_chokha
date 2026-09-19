import type { ReactNode } from 'react'
import { useInView } from '../../hooks/useScrollSpy'

interface RevealProps {
  children: ReactNode
  className?: string
  delay?: number
  as?: 'div' | 'section' | 'article'
}

/** Scroll-reveal wrapper. Respects prefers-reduced-motion. */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} className={`reveal ${inView ? 'reveal-visible' : ''} ${className ?? ''}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}