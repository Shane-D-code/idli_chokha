import usePipelineEvents from "@/hooks/usePipelineEvents";

const MODULE_ORDER = [
  "genesis",
  "trajectory",
  "recurvature",
  "intensity",
  "ri",
  "rainfall",
  "wind",
  "flood",
  "landslide",
  "hazard_engine",
];

function statusBadge(status?: string | null) {
  switch ((status ?? "").toUpperCase()) {
    case "AVAILABLE":
      return <span className="pill ok">AVAILABLE</span>;
    case "DEGRADED":
    case "BASELINE":
      return <span className="pill warn">DEGRADED</span>;
    case "NOT_AVAILABLE":
    case "ERROR":
      return <span className="pill bad">NOT_AVAILABLE</span>;
    default:
      return <span className="pill muted">UNKNOWN</span>;
  }
}

export default function PipelineProgress() {
  const { moduleActive, moduleStatus, moduleMeta } = usePipelineEvents();

  return (
    <div className="panel mt-4">
      <div className="panel-head">
        <span className="panel-title">Pipeline Progress</span>
      </div>
      <div className="panel-body">
        <div className="grid gap-2">
          {MODULE_ORDER.map((m) => (
            <div key={m} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div style={{ width: 12 }}>
                  {moduleActive[m] ? <span className="dot running" /> : moduleStatus[m] === "AVAILABLE" ? <span className="dot ok" /> : moduleStatus[m] === "DEGRADED" ? <span className="dot warn" /> : <span className="dot bad" />}
                </div>
                <div style={{ minWidth: 140, textTransform: "capitalize" }}>{m.replace(/_/g, " ")}</div>
                <div className="small muted">{moduleMeta?.[m]?.executionTimeMs ? `${Math.round(moduleMeta[m].executionTimeMs)} ms` : ""}</div>
              </div>
              <div>{statusBadge(moduleStatus[m])}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
