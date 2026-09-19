import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CtaPillProps {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}

/**
 * Outlined pill, 1px border rgba(127,180,240,0.45), text in the link blue,
 * arrow glyph, 999px radius, subtle background lift on hover. Visible focus
 * ring.
 */
export function CtaPill({ children, onClick, href }: CtaPillProps) {
  const className = cn('story-cta');
  const arrow = (
    <span className="story-cta__arrow" aria-hidden="true">
      →
    </span>
  );

  if (href) {
    return (
      <a href={href} className={className}>
        {children}
        {arrow}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
      {arrow}
    </button>
  );
}