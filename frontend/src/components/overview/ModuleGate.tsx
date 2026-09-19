import type { ReactNode } from "react";
import type { ModelOperationalStatus } from "@/types";

interface Props {
  /** Module identifier shown in the NOT_AVAILABLE frame (e.g. "INTENSITY MODEL"). */
  label: string;
  status?: ModelOperationalStatus | null;
  /** Reason reported by the backend when the signal is absent. */
  reason?: string | null;
  children: ReactNode;
}

/**
 * Honesty gate. Renders the live output when the module reports an
 * available signal; otherwise renders `LABEL NOT_AVAILABLE` with the
 * backend-provided reason — never a fabricated placeholder.
 *
 * `"DEGRADED"` and `"BASELINE"` are treated as real scientific results
 * (they come from a real run), so their values are passed through.
 */
export function ModuleGate({ label, status, reason, children }: Props) {
  const s = status ?? "NOT_AVAILABLE";
  const unavailable = s === "NOT_AVAILABLE" || s === "ERROR" || s === "MODEL_MISSING" || s === "RUNTIME_REQUIRED";
  if (!unavailable) return <>{children}</>;

  return (
    <div className="cm-gate" role="status">
      <span className="cm-gate__title">{label}</span>
      <span className="cm-gate__status">NOT_AVAILABLE</span>
      {reason ? (
        <span className="cm-gate__reason">
          Reason: <b>{reason}</b>
        </span>
      ) : null}
    </div>
  );
}

export default ModuleGate;