import { StatusLabel } from "@/components/design";
import type { HazardItem } from "@/types";

export function HazardGrid({ hazards }: { hazards: HazardItem[] }) {
  if (!hazards || hazards.length === 0) {
    return <div className="small muted">No hazard data available.</div>;
  }
  return (
    <div className="hazard-strip">
      {hazards.map((h) => (
        <div key={h.id} className="hazard-module">
          <div className="m-title" style={{ fontSize: "0.95rem" }}>{h.label}</div>
          <div className="m-meta">
            <StatusLabel status={h.status} />
            {h.model && h.model !== "—" ? (
              <div className="small muted" style={{ marginTop: 6 }}>{h.model}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
