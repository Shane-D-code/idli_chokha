import { useEffect, useRef, useState } from 'react'

/** IntersectionObserver-based scroll-reveal (respects prefers-reduced-motion). */
export function useInView<T extends HTMLElement>(threshold = 0.18): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true)
            obs.unobserve(e.target)
          }
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])

  return [ref, inView]
}

export function useClock(): { time: string; date: string } {
  const [now, setNow] = useState(() => utcParts())
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const id = window.setInterval(() => setNow(utcParts()), reduced ? 10000 : 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function utcParts() {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return {
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
  }
}

/** Scroll-spy: tracks which section id is currently in the viewport. */
export function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    const onScroll = () => {
      const probe = window.scrollY + window.innerHeight * 0.32
      let current: string | null = null
      let best = -1
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        const top = el.offsetTop
        if (top <= probe && top > best) {
          best = top
          current = id
        }
      }
      if (!current && ids.length) current = ids[0]
      setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [ids])
  return active
}