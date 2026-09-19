import type { ReactNode } from 'react';

interface DataPanelProps {
  title: string;
  scope?: string;
  children: ReactNode;
}

/**
 * Title in 12px uppercase with 0.08em tracking; scope note directly beneath
 * in 12px muted parentheses; surface background; padding 20px; radius 14px.
 */
export function DataPanel({ title, scope, children }: DataPanelProps) {
  return (
    <div className="story-data-panel">
      <p className="story-data-panel__title">{title}</p>
      {scope && <p className="story-data-panel__scope">({scope})</p>}
      <div className="story-data-panel__body">{children}</div>
    </div>
  );
}