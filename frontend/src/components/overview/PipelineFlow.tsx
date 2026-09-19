import { Link } from "react-router-dom";
import type { ModelOperationalStatus } from "@/types";
import { moduleStatusColor, moduleStatusFrame, PIPELINE_MODULES, type ModuleKey } from "@/lib/moduleStatus";
import { useModuleStatuses } from "@/hooks/useModuleStatuses";
import { cn } from "@/lib/utils";

interface NodeProps {
  name: string;
  status: ModelOperationalStatus | string;
  reason?: string;
  route?: string;
  anchor?: string;
  active?: boolean;
  tag?: string;
  result?: string;
  wide?: boolean;
}

function FlowNode({ name, status, reason, route, anchor, active, tag, result, wide }: NodeProps) {
  const frame = moduleStatusFrame(status);
  const color = moduleStatusColor(status);
  const frameClass =
    frame === "ok" ? "cm-flow__node--ok"
    : frame === "warn" ? "cm-flow__node--warn"
    : frame === "bad" ? "cm-flow__node--bad"
    : "cm-flow__node--muted";

  const body = (
    <>
      <span className="cm-flow__node__status">{name}</span>
      {tag ? <span className="cm-flow__node__tag">{tag}</span> : null}
      <span className="cm-flow__node__name" style={{ color }}>
        {active ? "RUNNING" : status}
      </span>
      {result ? <span className="cm-flow__node__result">{result}</span> : null}
      <span className={cn("cm-dot", wide && "top")} style={{ ["--cm-dot" as string]: color }} />
      {reason ? <span className="cm-notavail">{reason}</span> : null}
    </>
  );

  if (route) {
    return (
      <Link
        to={anchor ? `${route}#${anchor}` : route}
        className={cn("cm-flow__node", wide && "cm-flow__node--center", frameClass)}
        title={reason ? `${name} — ${reason}` : name}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={cn("cm-flow__node", wide && "cm-flow__node--center", frameClass)} title={reason}>
      {body}
    </div>
  );
}

function Arrow() {
  return <span className="cm-flow__sep">→</span>;
}

function DownArrow() {
  return <span className="cm-flow__down">↓</span>;
}

/**
 * The pipeline is arranged as the operator reads it: the data feed develops
 * into GENESIS, becomes a CYCLONE PATH, then fans out into the three parallel
 * forecast branches (INTENSITY | RI | RECURVATURE) and the three parallel
 * exposure branches (RAIN | WIND | LANDSLIDE) before converging through FLOOD
 * into the UNIFIED HAZARD ENGINE. Parallel branches share a row so they read
 * as parallel; every node reflects the real module availability, carries the
 * short result the overview computed from backend values, and links to the
 * page section that owns its output.
 */
export function PipelineFlow({
  dataStatus,
  dataReason,
  results,
}: {
  dataStatus?: ModelOperationalStatus;
  dataReason?: string;
  results?: Partial<Record<ModuleKey, string>>;
}) {
  const statuses = useModuleStatuses();
  const s = (key: ModuleKey) => statuses[key];

  const gen = s("genesis");
  const trk = s("trajectory");
  const intensity = s("intensity");
  const ri = s("ri");
  const rec = s("recurvature");
  const rain = s("rainfall");
  const wind = s("wind");
  const flood = s("flood");
  const ls = s("landslide");
  const he = s("hazard_engine");

  return (
    <div className="cm-flow">
      {/* 01 Develop — DATA → GENESIS */}
      <div className="cm-flow__lane">
        <span className="cm-flow__lane-label">01 Develop</span>
        <div className="cm-flow__lane-body">
          <FlowNode
            name="DATA"
            status={dataStatus ?? "AVAILABLE"}
            reason={dataReason}
            route="/data"
            tag="SOURCES"
          />
          <Arrow />
          <FlowNode
            name="GENESIS"
            status={gen.status}
            reason={gen.reason}
            active={gen.active}
            route="/genesis"
            tag="PROBABILITY"
            result={results?.genesis}
          />
        </div>
      </div>
      <DownArrow />

      {/* 02 Path — CYCLONE PATH */}
      <div className="cm-flow__lane">
        <span className="cm-flow__lane-label">02 Path</span>
        <div className="cm-flow__lane-body">
          <FlowNode
            wide
            name="CYCLONE PATH"
            status={trk.status}
            reason={trk.reason}
            active={trk.active}
            route="/forecast"
            anchor="track"
            tag="TRACK"
            result={results?.trajectory}
          />
        </div>
      </div>
      <DownArrow />

      {/* 03 Forecast — INTENSITY | RI | RECURVATURE */}
      <div className="cm-flow__lane">
        <span className="cm-flow__lane-label">03 Forecast</span>
        <div className="cm-flow__lane-body">
          <FlowNode name="INTENSITY" status={intensity.status} reason={intensity.reason} active={intensity.active} route="/forecast" anchor="intensity" result={results?.intensity} />
          <Arrow />
          <FlowNode name="RI" status={ri.status} reason={ri.reason} active={ri.active} route="/forecast" anchor="ri" result={results?.ri} />
          <Arrow />
          <FlowNode name="RECURVATURE" status={rec.status} reason={rec.reason} active={rec.active} route="/forecast" anchor="recurvature" result={results?.recurvature} />
        </div>
      </div>
      <DownArrow />

      {/* 04 Exposure — RAIN | WIND | LANDSLIDE */}
      <div className="cm-flow__lane">
        <span className="cm-flow__lane-label">04 Exposure</span>
        <div className="cm-flow__lane-body">
          <FlowNode name="RAIN" status={rain.status} reason={rain.reason} active={rain.active} route="/impact" anchor="rainfall" result={results?.rainfall} />
          <Arrow />
          <FlowNode name="WIND" status={wind.status} reason={wind.reason} active={wind.active} route="/impact" anchor="wind" result={results?.wind} />
          <Arrow />
          <FlowNode name="LANDSLIDE" status={ls.status} reason={ls.reason} active={ls.active} route="/impact" anchor="landslide" result={results?.landslide} />
        </div>
      </div>
      <DownArrow />

      {/* 05 River — FLOOD */}
      <div className="cm-flow__lane">
        <span className="cm-flow__lane-label">05 River</span>
        <div className="cm-flow__lane-body">
          <FlowNode
            wide
            name="FLOOD"
            status={flood.status}
            reason={flood.reason}
            active={flood.active}
            route="/impact"
            anchor="flood"
            tag="RIVERINE"
            result={results?.flood}
          />
        </div>
      </div>
      <DownArrow />

      {/* 06 Verdict — HAZARD ENGINE */}
      <div className="cm-flow__lane">
        <span className="cm-flow__lane-label">06 Verdict</span>
        <div className="cm-flow__lane-body">
          <FlowNode
            wide
            name="UNIFIED HAZARD ENGINE"
            status={he.status}
            reason={he.reason}
            active={he.active}
            route="/impact"
            anchor="hazard-engine"
            tag={PIPELINE_MODULES.find((m) => m.id === "hazard_engine")?.label ?? "HAZARD ENGINE"}
            result={results?.hazard_engine}
          />
        </div>
      </div>
    </div>
  );
}

export default PipelineFlow;