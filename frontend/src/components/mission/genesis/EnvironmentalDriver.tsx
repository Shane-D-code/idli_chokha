import type { EnvironmentDriver } from "@/types/mission";

function tone(status: EnvironmentDriver["status"]): string {
  if (status === "FAVORABLE") return "m-g-drv--fav";
  if (status === "MODERATE") return "m-g-drv--marg";
  return "m-g-drv--sup";
}

export function EnvironmentalDriver({ d, shortLabel }: { d: EnvironmentDriver; shortLabel?: string }) {
  return (
    <div
      className="m-g-drv"
      role="listitem"
      title={`${d.label} — threshold ${d.threshold}`}
    >
      <span className="m-g-drv__name">{shortLabel ?? d.label}</span>
      <span className="m-g-drv__val mono">
        {d.value}
        {d.unit ? <span className="m-g-drv__unit"> {d.unit}</span> : null}
      </span>
      <span className={`m-g-drv__status ${tone(d.status)}`}>{d.status}</span>
    </div>
  );
}