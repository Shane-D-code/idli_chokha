import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "@/state/AppContext";
import type { ModelInfo } from "@/types";

/* ============================================================
   TOOFAN Model Pipeline — connected dependency graph.
   Renders a single vertical execution map (nodes + edges)
   downstream of Cyclone State through hazards to the Risk engine.
   Data is derived from the shared model registry (Models page
   truth). It is deliberately NOT a list of model cards.
   ============================================================ */

export type GraphTone = "ready" | "active" | "degraded" | "blocked" | "input";

interface GraphNode {
  id: string;
  label: string;
  abbrev?: string;
  x: number;
  y: number;
  group?: string[];
  route?: string;
  tone?: GraphTone;
  statusText: string;
  detail: { label: string; value: string }[];
  members?: { name: string; status: string }[];
}

interface GraphEdge {
  source: string;
  target: string;
  tone: "ok" | "active" | "blocked" | "wait";
}

const W = 760;
const H = 600;

// Stable grouped layout. Coordinates are hand-placed so the graph
// reads top→bottom as a dependency flow with horizontal branches.
const LAYOUT: Omit<GraphNode, "detail" | "statusText">[] = [
  { id: "cyclone_state", label: "CYCLONE STATE", abbrev: "STATE", x: 380, y: 46, tone: "input" },
  { id: "genesis", label: "GENESIS", x: 380, y: 126, group: ["genesis"] },
  { id: "trajectory", label: "TRAJECTORY V12", abbrev: "TRAJECTORY", x: 120, y: 226, route: "/track" },
  { id: "ri", label: "RI", x: 380, y: 226, route: "/intensity", group: ["ri"] },
  { id: "intensity", label: "INTENSITY", x: 640, y: 226, route: "/intensity" },
  { id: "recurvature", label: "RECURVATURE", x: 120, y: 322, route: "/recurvature" },
  { id: "hazard_input", label: "HAZARD INPUT", abbrev: "HAZARDS", x: 380, y: 322, tone: "input" },
  { id: "rainfall", label: "RAINFALL", x: 120, y: 422, route: "/rainfall" },
  { id: "wind", label: "WIND", x: 380, y: 422, route: "/wind" },
  { id: "flood", label: "FLOOD", x: 640, y: 422, route: "/flood" },
  { id: "risk", label: "RISK ENGINE", abbrev: "RISK", x: 380, y: 516, route: "/risk" },
];

const EDGES: GraphEdge[] = [
  { source: "cyclone_state", target: "genesis", tone: "ok" },
  { source: "genesis", target: "trajectory", tone: "ok" },
  { source: "genesis", target: "ri", tone: "ok" },
  { source: "genesis", target: "intensity", tone: "ok" },
  { source: "trajectory", target: "recurvature", tone: "ok" },
  { source: "trajectory", target: "hazard_input", tone: "ok" },
  { source: "ri", target: "hazard_input", tone: "ok" },
  { source: "intensity", target: "hazard_input", tone: "ok" },
  { source: "recurvature", target: "hazard_input", tone: "ok" },
  { source: "hazard_input", target: "rainfall", tone: "ok" },
  { source: "hazard_input", target: "wind", tone: "ok" },
  { source: "hazard_input", target: "flood", tone: "ok" },
  { source: "rainfall", target: "risk", tone: "ok" },
  { source: "wind", target: "risk", tone: "ok" },
  { source: "flood", target: "risk", tone: "ok" },
];

const GROUP_ORDER = ["ri", "genesis"];

// Classify a registry model into the four command-center tones.
function toneOf(status: string): GraphTone {
  switch (status) {
    case "AVAILABLE":
    case "LIVE":
      return "ready";
    case "BASELINE":
      return "degraded";
    case "DEGRADED":
    case "DATA_REQUIRED":
    case "RUNTIME_REQUIRED":
    case "NOT_INTEGRATED":
      return "degraded";
    case "UNAVAILABLE":
    case "MODEL_MISSING":
      return "blocked";
    default:
      return "blocked";
  }
}

function statusTextOf(status: string): string {
  return status.replace(/_/g, " ");
}

// Grouped nodes (genesis / ri) derive their tone + members from the
// real registry entries of that slug; leaf nodes from a single model.
export function ModelPipeline({ models }: { models: ModelInfo[] }) {
  const { mode } = useApp();
  const [selected, setSelected] = useState<string | null>(null);

  const bySlug = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    models.forEach((m) => {
      const list = map.get(m.slug) ?? [];
      list.push(m);
      map.set(m.slug, list);
    });
    return map;
  }, [models]);

  const nodes = useMemo<GraphNode[]>(() => {
    const resolve = (node: Omit<GraphNode, "detail" | "statusText">): GraphNode => {
      const members = node.group
        ? GROUP_ORDER.indexOf(node.id) >= 0
          ? bySlug.get(node.group[0]) ?? []
          : []
        : [];
      let tone: GraphTone = node.tone ?? "ready";
      let statusText = "READY";
      const detail: { label: string; value: string }[] = [];

      if (node.group && members.length > 0) {
        const readyMember = members.find((m) => toneOf(m.status) === "ready");
        const voted = readyMember ?? members.reduce((a, b) =>
          toneSeverity(toneOf(b.status)) > toneSeverity(toneOf(a.status)) ? b : a
        );
        tone = toneOf(voted.status);
        statusText = statusTextOf(voted.status);
        if (node.group[0] === "genesis") {
          detail.push({ label: "Models", value: "LightGBM · XGBoost · RandomForest" });
          detail.push({ label: "Ensemble", value: "Genesis Ensemble" });
        } else {
          detail.push({ label: "Members", value: members.map((m) => m.name.replace("RI — ", "")).join(" · ") });
        }
      } else if (!node.group) {
        const m = bySlug.get(node.id)?.find((x) => x.slug === node.id);
        if (m) {
          tone = toneOf(m.status);
          statusText = statusTextOf(m.status);
          detail.push({ label: "Status", value: statusTextOf(m.status) });
          detail.push({ label: "Model", value: m.framework || "—" });
          if (m.inputFeatures != null) detail.push({ label: "Inputs", value: `${m.inputFeatures} features` });
          if (m.output) detail.push({ label: "Output", value: m.output });
        }
      }

      return { ...node, tone, statusText, detail, members: members.map((m) => ({ name: m.name, status: m.status })) };
    };

    return LAYOUT.map(resolve);
  }, [bySlug]);

  const edges = useMemo<GraphEdge[]>(() => {
    const toneFrom = (a: GraphNode, b: GraphNode): GraphEdge["tone"] => {
      if (a.tone === "blocked") return "blocked";
      if (b.tone === "blocked") return "blocked";
      if (a.tone === "active" || b.tone === "active") return "active";
      if (a.tone === "degraded" || b.tone === "degraded") return "blocked";
      return "ok";
    };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return EDGES.map((e) => ({
      ...e,
      tone: toneFrom(byId.get(e.source)!, byId.get(e.target)!),
    }));
  }, [nodes]);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ready = nodes.filter((n) => n.tone === "ready").length;
  const active = nodes.filter((n) => n.tone === "active").length;
  const degraded = nodes.filter((n) => n.tone === "degraded").length;
  const blocked = nodes.filter((n) => n.tone === "blocked").length;
  const sel = selected ? byId.get(selected) : null;

  return (
    <div className="mpg">
      <div className="mpg-head">
        <div>
          <div className="mpg-title">MODEL PIPELINE</div>
          <div className="mpg-sub">
            {mode === "demo" ? "LIVE EXECUTION FLOW · DEMO" : "LIVE EXECUTION FLOW"}
          </div>
        </div>
        <div className="mpg-statusrow">
          <span className="mpg-count ok"><b>{active}</b> ACTIVE</span>
          <span className="mpg-count ready"><b>{ready}</b> READY</span>
          <span className="mpg-count warn"><b>{degraded}</b> DEGRADED</span>
          <span className="mpg-count bad"><b>{blocked}</b> BLOCKED</span>
        </div>
      </div>

      <div className="mpg-canvas">
        <svg viewBox={`0 0 ${W} ${H}`} className="mpg-svg" role="img" aria-label="Model execution dependency graph">
          {edges.map((e, i) => <EdgePath key={i} e={e} a={byId.get(e.source)!} b={byId.get(e.target)!} />)}
          {nodes.map((n) => (
            <NodeGroup
              key={n.id}
              n={n}
              selected={selected === n.id}
              onSelect={() => setSelected(selected === n.id ? null : n.id)}
            />
          ))}
        </svg>
        {sel && <DetailPanel n={sel} onClose={() => setSelected(null)} />}
      </div>

      <div className="mpg-legend">
        <span><i className="dot ready" />READY</span>
        <span><i className="dot active" />ACTIVE</span>
        <span><i className="dot degraded" />DEGRADED</span>
        <span><i className="dot blocked" />BLOCKED</span>
        <span className="mpg-legend-note">node = pipeline stage · line = dependency</span>
      </div>

      <Link to="/models" className="mpg-viewall">VIEW ALL MODELS →</Link>
    </div>
  );
}

function toneSeverity(t: GraphTone): number {
  return t === "blocked" ? 3 : t === "degraded" ? 2 : t === "active" ? 1 : 0;
}

function EdgePath({ e, a, b }: { e: GraphEdge; a: GraphNode; b: GraphNode }) {
  const d = `M ${a.x} ${a.y + 20} C ${a.x} ${(a.y + b.y) / 2}, ${b.x} ${(a.y + b.y) / 2}, ${b.x} ${b.y - 20}`;
  const cls = e.tone === "active" ? "active" : e.tone === "blocked" ? "blocked" : e.tone === "wait" ? "wait" : "ok";
  return <path className={`mpg-edge ${cls}`} d={d} fill="none" />;
}

const NODE_W = 150;
const NODE_H = 40;

function NodeGroup({ n, selected, onSelect }: { n: GraphNode; selected: boolean; onSelect: () => void }) {
  const rx = n.x - NODE_W / 2;
  const ry = n.y - NODE_H / 2;
  return (
    <g className="mpg-node" onClick={onSelect} role="button" aria-pressed={selected} tabIndex={0}>
      <rect
        x={rx}
        y={ry}
        width={NODE_W}
        height={NODE_H}
        rx={NODE_H / 2}
        className={`mpg-node-body ${n.tone} ${selected ? "sel" : ""}`}
      />
      <text x={n.x} y={n.y - 2} textAnchor="middle" className="mpg-node-label">{n.abbrev ?? n.label}</text>
      <text x={n.x} y={n.y + 15} textAnchor="middle" className={`mpg-node-status ${n.tone}`}>{n.statusText}</text>
      {n.tone === "active" && <circle cx={n.x} cy={n.y + 23} r="3" className="mpg-run-dot" />}
    </g>
  );
}

function DetailPanel({ n, onClose }: { n: GraphNode; onClose: () => void }) {
  return (
    <div className="mpg-pop" onClick={(e) => e.stopPropagation()}>
      <div className="mpg-pop-head">
        <span className="mpg-pop-name">{n.label}</span>
        <button className="mpg-pop-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="mpg-pop-cells">
        {n.detail.length > 0
          ? n.detail.map((d, i) => (
              <div key={i} className="mpg-pop-cell">
                <span className="mpg-pop-lbl">{d.label}</span>
                <span className="mpg-pop-val">{d.value}</span>
              </div>
            ))
          : null}
      </div>
      {n.members && n.members.length > 0 && (
        <div className="mpg-pop-members">
          {n.members.map((m, i) => (
            <span key={i} className="mpg-pop-member">
              <i className={`dot ${toneOf(m.status)}`} />{m.name}
            </span>
          ))}
        </div>
      )}
      {n.route && (
        <Link to={n.route} className="mpg-pop-goto" onClick={onClose}>OPEN MODEL →</Link>
      )}
    </div>
  );
}