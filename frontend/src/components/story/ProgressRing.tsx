import { useRef, useState, useEffect } from 'react';

interface ProgressRingProps {
  progress: number;
  color: string;
  size?: number;
  stroke?: number;
  label: string;
}

const TAU = Math.PI * 2;

/**
 * SVG progress ring — 56px, 6px stroke, rounded linecap, track at
 * rgba(255,255,255,0.10), arc in the passed colour, starting at 12 o'clock
 * going clockwise. Animate from 0 to value over 700ms with an ease-out curve
 * when the ring first enters the viewport, once only.
 */
export function ProgressRing({
  progress,
  color,
  size = 56,
  stroke = 6,
  label,
}: ProgressRingProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [animated, setAnimated] = useState(0);
  const [inView, setInView] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !fired.current) {
            fired.current = true;
            setInView(true);
          }
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setAnimated(progress);
      return;
    }
    const from = performance.now();
    const duration = 700;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - from) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setAnimated(progress * ease);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, progress]);

  const radius = (size - stroke) / 2;
  const circumference = radius * TAU;
  const fraction = Math.max(0, Math.min(1, animated));
  const offset = circumference * (1 - fraction);

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="story-ring"
      role="img"
      aria-label={label}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        style={{ stroke: 'var(--story-ring-track)' }}
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 700ms ease-out' }}
      />
    </svg>
  );
}