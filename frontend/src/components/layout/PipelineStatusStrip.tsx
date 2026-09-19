import { PIPELINE_MODULES, moduleStatusColor } from "@/lib/moduleStatus";
import { useModuleStatuses } from "@/hooks/useModuleStatuses";
import { cn } from "@/lib/utils";

/**
 * Persistent compact pipeline status. Renders the live availability of every
 * TOOFAN pipeline stage (GENESIS → TRACK → INTENSITY → RI → RECURVATURE →
 * RAIN → WIND → FLOOD → LANDSLIDE → HAZARD ENGINE) from the actual backend
 * sensors: WebSocket events, the latest assessment snapshot, or the hazard
 * registry. No status is assumed — absent signals render NOT_AVAILABLE.
 */
export function PipelineStatusStrip({ className }: { className?: string }) {
  const statuses = useModuleStatuses();

  return (
    <div
      className={cn("cm-strip", className)}
      role="status"
      aria-label="Pipeline status"
    >
      <span className="cm-strip__label">Pipeline</span>
      {PIPELINE_MODULES.map((mod) => {
        const entry = statuses[mod.id];
        const color = moduleStatusColor(entry?.status);
        return (
          <span
            key={mod.id}
            className="cm-strip__item"
            title={entry?.reason ? `${mod.label} — ${entry.reason}` : mod.label}
          >
            <span className="cm-dot" style={{ ["--cm-dot" as string]: color }} />
            {mod.short}
            <span style={{ color }}>{entry?.active ? "RUNNING" : entry?.status ?? "NOT_AVAILABLE"}</span>
          </span>
        );
      })}
    </div>
  );
}

export default PipelineStatusStrip;