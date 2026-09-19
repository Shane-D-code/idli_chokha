import type { EnvironmentDriver } from "@/types/mission";
import { EnvironmentalDriver } from "./EnvironmentalDriver";

interface EnvironmentalConditionsProps {
  drivers: EnvironmentDriver[];
}

/** Scientific short-labels so eight drivers fit a two-column panel
 *  without clipping. The full name stays available via tooltip. */
const SHORT_LABEL: Record<string, string> = {
  sst: "SST",
  "sst-anomaly": "SST ANOM",
  tchp: "TCHP",
  ohc700: "OHC",
  shear: "SHEAR",
  rh: "HUMIDITY",
  divergence: "DIVERGENCE",
  vorticity: "VORTICITY",
};

export function EnvironmentalConditions({ drivers }: EnvironmentalConditionsProps) {
  const favourable = drivers.filter((d) => d.status === "FAVORABLE").length;
  const moderate = drivers.filter((d) => d.status === "MODERATE").length;
  const unfavourable = drivers.length - favourable - moderate;
  const split = Math.ceil(drivers.length / 2);

  return (
    <div className="m-g-panel m-g-panel--env m-g-env" role="region" aria-label="Environmental conditions">
      <div className="m-g-panel__top">
        <span className="m-g-panel__kicker">ENVIRONMENTAL CONDITIONS</span>
      </div>

      <div className="m-g-env__summary mono">
        {drivers.length} DRIVERS · {favourable} FAVOURABLE · {moderate} MODERATE
        {unfavourable > 0 ? ` · ${unfavourable} UNFAVOURABLE` : ""}
      </div>

      <div className="m-g-env__cols">
        <div className="m-g-env__col" role="list" aria-label="Ocean and thermal drivers">
          {drivers.slice(0, split).map((d) => (
            <EnvironmentalDriver key={d.id} d={d} shortLabel={SHORT_LABEL[d.id]} />
          ))}
        </div>
        <div className="m-g-env__col" role="list" aria-label="Dynamic and moisture drivers">
          {drivers.slice(split).map((d) => (
            <EnvironmentalDriver key={d.id} d={d} shortLabel={SHORT_LABEL[d.id]} />
          ))}
        </div>
      </div>
    </div>
  );
}