import type { HazardSeverity } from "@/types";

export function riskLabel(sev: HazardSeverity | undefined): string {
  if (!sev) return "—";
  return sev.replace(/_/g, " ");
}

export function RiskPill({ severity }: { severity: HazardSeverity | undefined }) {
  if (!severity) return <span className="sev muted-3">—</span>;
  return (
    <span className={`sev ${severity}`} role="status" aria-label={`Risk level ${riskLabel(severity)}`}>
      {riskLabel(severity)}
    </span>
  );
}
