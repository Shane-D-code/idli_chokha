import type { HazardSeverity } from "@/types";
import { severityFrame } from "@/lib/moduleStatus";
import { cn } from "@/lib/utils";

export function severityLabel(sev?: HazardSeverity | null): string {
  if (!sev) return "NOT AVAILABLE";
  return sev.replace(/_/g, " ");
}

/** Risk severity pill tuned for the dark command-center surface. */
export function CmSev({ severity, className }: { severity?: HazardSeverity | null; className?: string }) {
  const frame = severity ? severityFrame(severity) : "na";
  const cls =
    frame === "low" ? "cm-sev--LOW"
    : frame === "moderate" ? "cm-sev--MODERATE"
    : frame === "high" ? "cm-sev--HIGH"
    : "cm-sev--NA";
  return (
    <span className={cn("cm-sev", cls, className)} role="status">
      {severityLabel(severity)}
    </span>
  );
}

export default CmSev;