/**
 * CycloneLegend — compact track legend for the cyclone map overlay.
 *
 * Track colour is driven exclusively by IMD wind intensity (7 grades), so the
 * legend shows the full IMD scale. Observed track is a solid line, forecast a
 * dashed line; the uncertainty polygon is only drawn when the model provided
 * real sigma.
 */

import { INTENSITY_CLASS_LIST } from "@/utils/intensity";

export interface CycloneLegendProps {
  simplified?: boolean;
}

export function CycloneLegend({ simplified = false }: CycloneLegendProps) {
  return (
    <div className="cv-legend">
      <div className="cv-legend-title">LEGEND</div>
      <div className="cv-legend-row">
        <span className="cv-legend-swatch vortex" aria-hidden="true" />
        <span>Current Cyclone</span>
      </div>
      <div className="cv-legend-row">
        <span className="cv-legend-swatch observed" aria-hidden="true" />
        <span>Observed Track</span>
      </div>
      <div className="cv-legend-row">
        <span className="cv-legend-swatch forecast" aria-hidden="true" />
        <span>Forecast Track</span>
      </div>
      {!simplified && (
        <div className="cv-legend-row">
          <span className="cv-legend-swatch uncertainty" aria-hidden="true" />
          <span>Uncertainty (±km)</span>
        </div>
      )}
      <div className="cv-legend-row">
        <span className="cv-legend-swatch movement" aria-hidden="true" />
        <span>Movement</span>
      </div>
      <div className="cv-legend-divider" />
      <div className="cv-legend-title">IMD INTENSITY</div>
      <div className="cv-legend-scale" role="img" aria-label="IMD cyclone intensity scale">
        {INTENSITY_CLASS_LIST.map((c) => (
          <span
            key={c.key}
            className="cv-legend-chip"
            style={{ background: c.color }}
            title={`${c.label} · ${c.windRange}`}
          >
            {c.shortLabel}
          </span>
        ))}
      </div>
      <div className="cv-legend-row cv-legend-texture">
        <span className="cv-legend-swatch texture" aria-hidden="true" />
        <span>Atmospheric Field</span>
      </div>
    </div>
  );
}