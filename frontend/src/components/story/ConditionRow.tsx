import { useRef, useState, useEffect } from 'react';

interface ConditionRowProps {
  label: string;
  /** 0..1 fraction controlling both bar width and (optionally) straightforward scale reading. */
  fill: number;
  value: string;
  delta?: number;
  tone: string;
  deltaText?: string;
  rowLabel: string;
}

/**
 * Label left at fixed width, bar centre, value right. Bar: 8px tall, 4px
 * radius, track rgba(255,255,255,0.08), fill in the tone colour. Delta as a
 * small arrow and signed number in the tone colour.
 */
export function ConditionRow({
  label,
  fill,
  value,
  delta,
  tone,
  deltaText,
  rowLabel,
}: ConditionRowProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [animated, setAnimated] = useState(0);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !fired.current) {
            fired.current = true;
            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
              setAnimated(fill);
            } else {
              requestAnimationFrame(() => setAnimated(fill));
            }
          }
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [fill]);

  const deltaNode =
    delta != null ? (
      <span className="story-condition-row__delta" style={{ color: tone }}>
        {delta > 0 ? '▲' : '▼'} {deltaText ?? String(delta)}
      </span>
    ) : null;

  return (
    <div
      className="story-condition-row"
      role="group"
      aria-label={rowLabel}
      ref={ref}
    >
      <span className="story-condition-row__label">{label}</span>
      <div className="story-condition-row__bar-track" aria-hidden="true">
        <div
          className="story-condition-row__bar-fill"
          style={{ width: `${Math.max(0, Math.min(1, animated)) * 100}%`, background: tone }}
        />
      </div>
      <span className="story-condition-row__value">
        {value}
        {deltaNode}
      </span>
    </div>
  );
}