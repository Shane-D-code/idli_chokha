import { ProvenanceBadge } from "./ProvenanceBadge";
import type { DisplayStatus } from "./genesisModel";

interface GenesisHeaderProps {
  status: DisplayStatus;
  basin: string;
  observationTime: string;
}

export function GenesisHeader({ status, basin, observationTime }: GenesisHeaderProps) {
  return (
    <header className="m-genesis__head">
      <div className="m-genesis__index" aria-hidden="true">
        <span className="m-genesis__num">01</span>
        <span className="m-genesis__rule" />
      </div>
      <div className="m-genesis__titlewrap">
        <div className="m-genesis__kicker">SEE THE SIGNS</div>
        <h2 id="genesis-title" className="m-genesis__title">Genesis Prediction</h2>
        <p className="m-genesis__sub">
          AI analyses environmental conditions, satellite observations and disturbance evolution
          to estimate tropical cyclone genesis.
        </p>
      </div>
      <div className="m-genesis__meta">
        <ProvenanceBadge status={status} />
        <span className="mono muted m-genesis__meta-line">BASIN · {basin}</span>
        <span className="mono muted m-genesis__meta-line">OBSERVATION · {observationTime}</span>
      </div>
    </header>
  );
}