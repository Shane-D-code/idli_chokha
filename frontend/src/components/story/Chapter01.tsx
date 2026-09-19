// Chapter 01 — Genesis Prediction
// All displayed values resolve from the StormAnalysis data; no numeric
// literal appears in JSX text or JSX attribute strings.

import { ChapterSection } from "./ChapterSection";
import { MetricCard } from "./MetricCard";
import { ConditionRow } from "./ConditionRow";
import { DataPanel } from "./DataPanel";
import { ImageryCard } from "./ImageryCard";
import { CtaPill } from "./CtaPill";
import { favourabilityFill, favourabilityTone } from "./conditions";
import type { StormAnalysis } from "@/types/stories";

/** Friendly label for each environment factor. */
const ENV_LABELS: Record<string, string> = {
  sst: "SST",
  vorticity: "Vorticity",
  moisture: "Moisture",
  shear: "Shear",
  tchp: "TCHP",
  ohc: "OHC",
};

/** Horizon suffix for display, e.g. "+24 h". */
function horizonLabel(hours: number): string {
  return `+${hours} h`;
}

/** Percent text derived from a 0..1 fraction. */
function pct(frac: number): string {
  return `${Math.round(frac * 100)}%`;
}

function signedDelta(t: number): string {
  return `${t > 0 ? "+" : ""}${t}`;
}

export interface Chapter01Props {
  analysis: StormAnalysis;
  onActive?: (index: number) => void;
}

export function Chapter01({ analysis, onActive }: Chapter01Props) {
  const genesis = analysis.genesisProbability;
  const env = analysis.environment;
  const imagery = analysis.imagery[0];
  const genesis72h = genesis.find((g) => g.horizonHours === 72);

  return (
    <ChapterSection
      index={1}
      kicker="See the signs"
      title="Genesis prediction"
      onActive={onActive}
      simulated={analysis.simulated}
      body={
        genesis72h ? (
          <>
            The model currently places genesis probability at{" "}
            <em>
              {pct(genesis72h.probability)} within {horizonLabel(genesis72h.horizonHours)}
            </em>
            , driven by sea-surface temperatures above the threshold, a deep
            mid-level moisture column, and weak vertical wind shear in the
            genesis box.
          </>
        ) : (
          <em>Genesis probability data is not yet available for this forecast horizon.</em>
        )
      }
      cards={genesis.map((gp) => {
        const color = favourabilityTone(gp.probability);
        return (
          <MetricCard
            key={gp.horizonHours}
            label={`Genesis ${horizonLabel(gp.horizonHours)}`}
            sublabel="model ensemble"
            value={pct(gp.probability)}
            color={color}
            ring={{ progress: gp.probability, color }}
            ringLabel={`Genesis probability at ${horizonLabel(gp.horizonHours)}: ${Math.round(gp.probability * 100)} percent`}
          />
        );
      })}
      cta={<CtaPill onClick={() => undefined}>Track the system</CtaPill>}
      data={
        <DataPanel title="Environmental conditions" scope="model fields across the genesis box">
          {env.map((f) => {
            const tone = favourabilityTone(f.favourability);
            const fill = favourabilityFill(f.favourability);
            return (
              <ConditionRow
                key={f.key}
                label={ENV_LABELS[f.key] ?? f.key}
                fill={fill}
                value={`${f.rawValue} ${f.unit}`}
                delta={f.delta24h}
                deltaText={f.delta24h != null ? signedDelta(f.delta24h) : undefined}
                tone={tone}
                rowLabel={`${ENV_LABELS[f.key] ?? f.key}: ${f.rawValue} ${f.unit}, favourability ${Math.round(f.favourability * 100)} percent`}
              />
            );
          })}
        </DataPanel>
      }
      visual={
        imagery ? (
          <ImageryCard
            sensor={imagery.sensor}
            channel={imagery.channel}
            capturedAt={imagery.capturedAt}
            src={imagery.url || undefined}
            alt={`${imagery.channel} frame of the genesis region`}
            synthetic={imagery.synthetic}
          />
        ) : (
          <ImageryCard
            sensor="—"
            channel="—"
            capturedAt="—"
            src={undefined}
            alt="No satellite imagery available"
            synthetic={analysis.simulated}
          />
        )
      }
    />
  );
}