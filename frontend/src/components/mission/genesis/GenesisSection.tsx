import { useInView } from "@/hooks/usePrefersReducedMotion";
import type { MissionBundle } from "@/types/mission";
import { GenesisHeader } from "./GenesisHeader";
import { GenesisProbabilityGrid } from "./GenesisProbabilityGrid";
import { EnvironmentalConditions } from "./EnvironmentalConditions";
import { SatelliteObservation } from "./SatelliteObservation";
import { GenesisMetaStrip } from "./GenesisMetaStrip";
import { genesisMeta, genesisProvenance } from "./genesisModel";

export function GenesisSection({ bundle }: { bundle: MissionBundle }) {
  const g = bundle.genesis;
  const meta = genesisMeta(g);
  const status = genesisProvenance(g, bundle.mode);
  const [boardRef, inView] = useInView<HTMLDivElement>(0.2);

  const simulated = bundle.environment.every((d) => d.provenance === "SIMULATED");
  const source = simulated ? "SIMULATED FEED" : "ERA5 / SATELLITE / MODEL";
  const members = g.subModels.map((m) => m.name).join(" · ");

  return (
    <div
      ref={boardRef as React.RefObject<HTMLDivElement>}
      className={`m-genesis-wrap ${inView ? "m-g-in" : ""}`}
    >
      <section id="genesis" className="m-section m-genesis" aria-labelledby="genesis-title">
        <GenesisHeader
          status={status}
          basin="BAY OF BENGAL"
          observationTime={bundle.generatedAt}
        />

        <div className="m-g-mainrow" role="group" aria-label="Genesis forecast instruments">
          <GenesisProbabilityGrid subModels={g.subModels} threshold={meta.threshold} />
          <EnvironmentalConditions drivers={bundle.environment} />
          <SatelliteObservation />
        </div>

        <GenesisMetaStrip
          members={members}
          threshold={meta.threshold}
          status={status}
          scientificStatus={meta.scientificStatus}
          reason={g?.status?.message ?? null}
          source={source}
        />
      </section>
    </div>
  );
}