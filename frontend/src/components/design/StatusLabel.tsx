import type { ModelOperationalStatus } from "@/types";

function tone(status: ModelOperationalStatus): "ok" | "warn" | "bad" | "info" {
  switch (status) {
    case "AVAILABLE":
    case "LIVE":
      return "ok";
    case "BASELINE":
    case "AVAILABLE_BASELINE":
    case "LIMITED":
    case "DEGRADED":
    case "DATA_REQUIRED":
    case "STATIC_SUSCEPTIBILITY":
      return "warn";
    case "MODEL_MISSING":
    case "NOT_INTEGRATED":
    case "RUNTIME_REQUIRED":
    case "DATA_UNAVAILABLE":
    case "NOT_IMPLEMENTED":
    case "UNAVAILABLE":
      return "bad";
    default:
      return "info";
  }
}

export function StatusLabel({
  status,
  className = "",
}: {
  status: ModelOperationalStatus;
  className?: string;
}) {
  const t = tone(status);
  return (
    <span className={`status-label ${t} ${className}`}>
      <span className="dot" aria-hidden="true" />
      {status.replace(/_/g, " ")}
    </span>
  );
}
