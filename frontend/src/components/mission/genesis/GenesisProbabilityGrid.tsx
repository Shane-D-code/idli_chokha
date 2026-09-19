import type { GenesisHorizons, ProbabilityBand } from "./genesisModel";
import { horizonsFrom, probabilityBand } from "./genesisModel";
import type { GenesisSubModel } from "@/types";
import { GenesisProbabilityCard } from "./GenesisProbabilityCard";

interface GenesisProbabilityGridProps {
  subModels: GenesisSubModel[];
  threshold: number | null;
}

function computeHorizons(subModels: GenesisSubModel[]): GenesisHorizons {
  return horizonsFrom(subModels);
}

function computeBands(h: GenesisHorizons): Record<string, ProbabilityBand | null> {
  return {
    h24: probabilityBand(h.h24),
    h48: probabilityBand(h.h48),
    h72: probabilityBand(h.h72),
  };
}

export function GenesisProbabilityGrid({ subModels, threshold }: GenesisProbabilityGridProps) {
  const h = computeHorizons(subModels);
  const b = computeBands(h);

  return (
    <div className="m-g-probrow" role="group" aria-label="Ensemble genesis probability by forecast horizon">
      <GenesisProbabilityCard
        horizonLabel="24-hour"
        hours="24H"
        value={h.h24}
        threshold={threshold}
        status={b.h24}
      />
      <GenesisProbabilityCard
        horizonLabel="48-hour"
        hours="48H"
        value={h.h48}
        threshold={threshold}
        status={b.h48}
      />
      <GenesisProbabilityCard
        horizonLabel="72-hour"
        hours="72H"
        value={h.h72}
        threshold={threshold}
        status={b.h72}
      />
    </div>
  );
}