import type { ModelOperationalStatus } from "@/types";

export function statusTone(status: ModelOperationalStatus): string {
  switch (status) {
    case "AVAILABLE":
    case "LIVE":
      return "badge-ok";
    case "BASELINE":
    case "DEGRADED":
    case "DATA_REQUIRED":
      return "badge-warn";
    case "MODEL_MISSING":
    case "NOT_INTEGRATED":
    case "RUNTIME_REQUIRED":
    case "UNAVAILABLE":
      return "badge-bad";
    default:
      return "badge-muted";
  }
}

export function statusLabel(status: ModelOperationalStatus): string {
  return status.replace(/_/g, " ");
}

export function StatusBadge({ status }: { status: ModelOperationalStatus }) {
  return (
    <span className="status-badge" role="status" style={{ color: "var(--ink-2)" }}>
      <span className={`dot ${statusTone(status)}`} aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0 }} />
      {statusLabel(status)}
    </span>
  );
}
