import type { DisplayStatus } from "./genesisModel";

const TONES: Record<DisplayStatus, string> = {
  LIVE: "live",
  SIMULATED: "demo",
  HISTORICAL: "hist",
  UNAVAILABLE: "unavail",
  UNCALIBRATED: "uncal",
};

/** Quiet dot + label provenance marker. UNCALIBRATED maps to the amber
 *  scientific-limitation tone so prototype output is never mistaken for
 *  an operational forecast. */
export function ProvenanceBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={`m-badge m-badge--${TONES[status]}`}>
      <i className="m-badge__dot" />
      {status}
    </span>
  );
}