/**
 * CycloneLegend — compact track legend for the cyclone map overlay.
 */

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
          <span>Uncertainty</span>
        </div>
      )}
      <div className="cv-legend-row">
        <span className="cv-legend-swatch movement" aria-hidden="true" />
        <span>Movement</span>
      </div>
      <div className="cv-legend-divider" />
      <div className="cv-legend-row cv-legend-texture">
        <span className="cv-legend-swatch texture" aria-hidden="true" />
        <span>Atmospheric Field</span>
      </div>
    </div>
  );
}
