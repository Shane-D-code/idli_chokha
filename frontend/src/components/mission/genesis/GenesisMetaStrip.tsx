import type { DisplayStatus } from "./genesisModel";

interface GenesisMetaStripProps {
  members: string;
  threshold: number | null;
  status: DisplayStatus;
  scientificStatus: string | null;
  reason?: string | null;
  source: string;
}

/** Single-line technical provenance strip under the instrument row. */
export function GenesisMetaStrip({ members, threshold, status, scientificStatus, source, reason }: GenesisMetaStripProps) {
  return (
    <div className="m-g-meta" role="group" aria-label="Genesis model metadata">
      <div className="m-g-meta__item">
        <span className="m-g-meta__k">MODEL</span>
        <span className="m-g-meta__v">GENESIS ENSEMBLE</span>
      </div>
      <div className="m-g-meta__item">
        <span className="m-g-meta__k">MEMBERS</span>
        <span className="m-g-meta__v">{members}</span>
      </div>
      <div className="m-g-meta__item">
        <span className="m-g-meta__k">THRESHOLD</span>
        <span className="m-g-meta__v">{threshold ?? "—"}</span>
      </div>
      <div className="m-g-meta__item">
        <span className="m-g-meta__k">STATUS</span>
        <span className="m-g-meta__v">
          {scientificStatus != null ? `${scientificStatus.toUpperCase()} · ` : ""}
          {status}
        </span>
      </div>
      <div className="m-g-meta__item">
        <span className="m-g-meta__k">SOURCE</span>
        <span className="m-g-meta__v">{source}</span>
      </div>
      {status === "UNAVAILABLE" && (
        <div className="m-g-meta__item">
          <span className="m-g-meta__k">REASON</span>
          <span className="m-g-meta__v">{reason ?? "Model unavailable"}</span>
        </div>
      )}
    </div>
  );
}