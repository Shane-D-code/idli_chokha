import type { ReactNode } from 'react';
import { ProgressRing } from './ProgressRing';

interface MetricCardProps {
  label: string;
  sublabel?: string;
  value: ReactNode;
  unit?: string;
  ring?: { progress: number; color: string };
  ringLabel?: string;
  color: string;
}

/**
 * Rounded 12px card, surface background, hairline border, 16px padding.
 * Label 13px/600 white; sublabel 12px/400 muted in parentheses on its own
 * line; value 32px/700 in the ramp colour with tabular nums; optional ring.
 */
export function MetricCard({
  label,
  sublabel,
  value,
  unit,
  ring,
  ringLabel,
  color,
}: MetricCardProps) {
  return (
    <div className="story-metric-card">
      <div className="story-metric-card__content">
        <p className="story-metric-card__label">{label}</p>
        {sublabel && <p className="story-metric-card__sublabel">{sublabel}</p>}
        <div className="story-metric-card__value-row">
          <span className="story-metric-card__value" style={{ color }}>
            {value}
          </span>
          {unit && <span className="story-metric-card__unit">{unit}</span>}
        </div>
      </div>
      {ring && (
        <ProgressRing
          progress={ring.progress}
          color={ring.color}
          label={ringLabel ?? `${label}: ${ring.progress}`}
        />
      )}
    </div>
  );
}