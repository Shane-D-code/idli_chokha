import { ImageOff } from "lucide-react";

interface SatelliteObservationProps {
  imageUrl?: string;
  alt?: string;
  source?: string;
  observedAt?: string;
}

/** Compact satellite panel. When a real imagery feed is configured the
 *  actual image is shown (no placeholder art); otherwise the honest
 *  UNAVAILABLE state is kept visually balanced with the neighbouring
 *  panels via the shared instrument-row height. */
export function SatelliteObservation({ imageUrl, alt, source, observedAt }: SatelliteObservationProps) {
  return (
    <div className="m-g-panel m-g-panel--sat m-g-sat" role="region" aria-label="Satellite observation">
      <div className="m-g-panel__top">
        <span className="m-g-panel__kicker">SATELLITE OBSERVATION</span>
        <span className="m-g-sat__badge">{imageUrl ? "LIVE" : "NO FEED"}</span>
      </div>

      {imageUrl ? (
        <button
          type="button"
          className="m-g-sat__imgwrap"
          onClick={() => window.open(imageUrl, "_blank", "noopener,noreferrer")}
          aria-label="Open full satellite observation"
        >
          <img src={imageUrl} alt={alt ?? "Satellite imagery of the genesis region"} className="m-g-sat__img" />
          {observedAt && <span className="m-g-sat__time mono">{observedAt}</span>}
        </button>
      ) : (
        <div className="m-g-sat__empty">
          <ImageOff size={22} className="m-g-sat__icon" aria-hidden="true" />
          <span className="m-g-sat__msg">IMAGE FEED UNAVAILABLE</span>
          <span className="m-g-sat__note">Source not connected</span>
        </div>
      )}

      <div className="m-g-panel__foot mono muted">
        <span>{imageUrl ? (source ?? "INSAT-3D · IR") : "SOURCE NOT CONNECTED"}</span>
      </div>
    </div>
  );
}