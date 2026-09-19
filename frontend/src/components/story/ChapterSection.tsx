import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SimulatedDataBadge } from './SimulatedDataBadge';

interface ChapterSectionProps {
  index: number;
  kicker: string;
  title: string;
  body: ReactNode;
  /** Metric cards row rendered at the foot of the narrative column. */
  cards?: ReactNode;
  /** Optional CTA pill at the very foot of the narrative column. */
  cta?: ReactNode;
  /** Data panel column (4fr). */
  data: ReactNode;
  /** Visual/imagery column (3fr). */
  visual: ReactNode;
  onActive?: (index: number) => void;
  simulated: boolean;
}

/**
 * Owns the three-column chapter grid, the ghosted numeral, and an
 * IntersectionObserver that scopes the entrance animation to the first time
 * the chapter enters the viewport and reports the active chapter upward so
 * the globe camera can ease to the matching view.
 */
export function ChapterSection({
  index,
  kicker,
  title,
  body,
  cards,
  cta,
  data,
  visual,
  onActive,
  simulated = false,
}: ChapterSectionProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onActive?.(index);
            if (!fired.current) {
              fired.current = true;
              setVisible(true);
            }
          }
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [index, onActive]);

  const titleId = `story-chapter-${index}-title`;
  const paddedIndex = String(index).padStart(2, '0');

  return (
    <section
      ref={ref}
      id={titleId}
      aria-labelledby={titleId}
      className={cn('story-chapter', visible && 'story-chapter--visible')}
    >
      {simulated && <SimulatedDataBadge />}
      <div className="story-narrative">
        <div className="story-chapter-head">
          <span className="story-numeral" aria-hidden="true">
            {paddedIndex}
          </span>
          <p className="story-kicker">{kicker}</p>
        </div>
        <h2 className="story-title" id={titleId}>
          {title}
        </h2>
        <p className="story-body">{body}</p>
        {cards && <div className="story-cards-row">{cards}</div>}
        <div className="story-narrative__foot">{cta}</div>
      </div>
      <div className="story-data-cell">{data}</div>
      <div className="story-visual-cell">{visual}</div>
    </section>
  );
}