import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DemoBanner } from "@/components/common/DemoBanner";
import { LoadingState } from "@/components/common/StateBox";
import { toofanService } from "@/services/toofanService";
import { SectionLabel, StatusLabel, ThinDivider, DataRow } from "@/components/design";
import { RiskPill } from "@/components/common/RiskPill";
import type { HazardItem, HazardSeverity, OverallRisk } from "@/types";

interface RegionImpact {
  name: string;
  level: HazardSeverity;
  pct: number;
}

// Hazard → route mapping for clickable matrix rows / cards.
const HAZARD_ROUTE: Record<string, string> = {
  trajectory: "/track",
  intensity: "/intensity",
  ri: "/intensity",
  recurvature: "/recurvature",
  rainfall: "/rainfall",
  wind: "/wind",
  flood: "/flood",
  landslide: "/landslide",
  genesis: "/hazards",
};

const REGION_WEIGHT: Record<HazardSeverity, number> = {
  LOW: 22,
  MODERATE: 41,
  HIGH: 62,
  VERY_HIGH: 78,
  EXTREME: 92,
};

export default function RiskPage() {
  const [risk, setRisk] = useState<OverallRisk | null>(null);
  const [hazards, setHazards] = useState<HazardItem[]>([]);
  const [regions, setRegions] = useState<RegionImpact[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // Load each dataset independently so a single transient failure
      // never blanks the whole risk assessment.
      const [r, h, ls] = await Promise.all([
        toofanService.getOverallRisk().catch(() => null),
        toofanService.getHazards().catch(() => null),
        toofanService.getLandslide().catch(() => null),
      ]);
      setRisk(r);
      if (Array.isArray(h)) setHazards(h as unknown as HazardItem[]);

      // Regional impact — sourced from the dynamic landslide susceptibility
      // assessment (real districts/regions), ranked HIGH → LOW.
      const regionsData: RegionImpact[] = (ls?.staticSusceptibility?.regions ?? [])
        .map((rg) => ({
          name: rg.name,
          level: rg.level,
          pct: REGION_WEIGHT[rg.level] ?? 0,
        }))
        .slice(0, 6)
        .sort((a, b) => b.pct - a.pct);
      setRegions(regionsData);
      setLoading(false);
    })();
  }, []);

  const contributions = useMemo(
    () =>
      hazards
        .filter((h) => h.score !== undefined)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [hazards]
  );
  const sumScore = contributions.reduce((s, h) => s + (h.score ?? 0), 0);
  const maxScore = contributions.reduce((m, h) => Math.max(m, h.score ?? 0), 1);

  const reporting = hazards.filter((h) => h.status === "AVAILABLE" || h.status === "LIVE").length;
  const composite = risk?.available ? risk : null;

  if (loading) return <div className="page"><LoadingState rows={4} /></div>;

  return (
    <div className="page risk-page">
      {/* ═══ HEADER ═══ */}
      <div className="page-head risk-head">
        <div className="page-kicker">Analysis</div>
        <h1 className="page-title">Risk</h1>
        <p className="page-sub">
          Meteorological threat assessment — current multi-hazard threat, model availability, and regional exposure.
        </p>
        <div className="row" style={{ marginTop: "var(--sp-2)" }}>
          <DemoBanner />
        </div>
      </div>
      <div style={{ margin: "var(--sp-1) 0 var(--section-gap)" }}>
        <ThinDivider solid />
      </div>

      {/* ═══ OVERALL RISK SUMMARY ═══ */}
      <div className="risk-summary" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel heavy risk-overall">
          <div className="panel-head"><span className="panel-title">Overall Risk</span></div>
          <div className="panel-body">
            {composite ? (
              <>
                <div style={{ fontFamily: "var(--mono)", fontWeight: 800, fontSize: "clamp(40px, 4vw, 64px)", lineHeight: 1 }}>
                  {composite.score}<span className="muted-3" style={{ fontSize: "0.45em" }}> / 100</span>
                </div>
                {composite.severity ? (
                  <div style={{ marginTop: "var(--sp-1)" }}>
                    <RiskPill severity={composite.severity} />
                  </div>
                ) : null}
                <p className="small muted" style={{ marginTop: "var(--sp-2)", maxWidth: 420 }}>
                  {composite.reason}
                </p>
              </>
            ) : (
              <>
                <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: "var(--text-title)", textTransform: "uppercase" }}>
                  Composite Risk
                </div>
                <div className="sev bad" style={{ fontSize: "var(--text-section)", marginTop: "var(--sp-1)" }}>
                  UNAVAILABLE
                </div>
                <p className="small muted" style={{ marginTop: "var(--sp-2)", maxWidth: 420 }}>
                  {risk?.reason ?? "HazardRiskEngine is not currently operational. Individual hazard modules are shown separately."}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="panel risk-score">
          <div className="panel-head"><span className="panel-title">Composite Score</span></div>
          <div className="panel-body">
            <RiskScale score={composite?.score} severity={composite?.severity} />
            {composite ? (
              <DataRow label="Engine" value={composite?.engineName ?? "—"} />
            ) : (
              <DataRow label="Engine" value={risk?.engineName ?? "HazardRiskEngine"} />
            )}
            <DataRow label="State" value={composite ? "OPERATIONAL" : "UNAVAILABLE"} />
          </div>
        </div>

        <div className="panel risk-status">
          <div className="panel-head"><span className="panel-title">Status</span></div>
          <div className="panel-body">
            {composite?.severity ? <RiskPill severity={composite.severity} /> : <span className="sev bad">UNAVAILABLE</span>}
            <ThinDivider faint />
            <DataRow label="Hazards Reporting" value={`${reporting} / ${hazards.length}`} />
            <DataRow label="Composite Confidence" value={confidenceLabel(composite)} />
            <DataRow label="Last Updated" value={lastUpdatedLabel(hazards)} />
          </div>
        </div>
      </div>

      {/* ═══ RISK CONTRIBUTION + HAZARD MATRIX (60/40) ═══ */}
      <div className="risk-main" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Risk Contribution</span>
            {sumScore > 0 ? <span className="small muted-3">{sumScore} combined</span> : null}
          </div>
          <div className="panel-body stack-sm">
            {contributions.length === 0 ? (
              <p className="small muted">No per-hazard scores reported by the backend.</p>
            ) : (
              contributions.map((h) => (
                <ContributionBar key={h.id} h={h} maxScore={maxScore} />
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">Hazard Matrix</span>
            <span className="small muted-3">{hazards.length} hazards</span>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <div className="risk-table-wrap">
              <table className="data-table risk-table">
                <thead>
                  <tr>
                    <th>Hazard</th>
                    <th>Status</th>
                    <th>Risk</th>
                    <th>Model</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {hazards.map((h) => (
                    <tr
                      key={h.id}
                      className="risk-row clickable"
                      onClick={() => navigate(HAZARD_ROUTE[h.id] ?? "/hazards")}
                      title={`Open ${h.label} page`}
                    >
                      <td className="risk-row-name">{h.label}</td>
                      <td><StatusLabel status={h.status} /></td>
                      <td>{h.risk ? <RiskPill severity={h.risk} /> : <span className="muted">—</span>}</td>
                      <td className="risk-row-model">{h.model ?? "—"}</td>
                      <td className="risk-row-data">{h.data ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ REGIONAL IMPACT + PRIMARY CONTRIBUTORS ═══ */}
      <div className="risk-sub" style={{ marginBottom: "var(--section-gap)" }}>
        <div className="panel">
          <div className="panel-head"><span className="panel-title">Regional Impact</span></div>
          <div className="panel-body stack-sm">
            {regions.length === 0 ? (
              <p className="small muted">No regional assessment currently available.</p>
            ) : (
              regions.map((rg) => <RegionRow key={rg.name} rg={rg} />)
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><span className="panel-title">Primary Contributors</span></div>
          <div className="panel-body stack-sm">
            {contributions.length === 0 ? (
              <p className="small muted">No contributors reported.</p>
            ) : (
              contributions.map((h, i) => (
                <ContributorRow key={h.id} rank={i + 1} h={h} first={i === 0} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ═══ HAZARD STATUS (3 × 3 grid) ═══ */}
      <SectionLabel label="Hazard Status" strong />
      <div className="risk-cards" style={{ marginTop: "var(--sp-2)", marginBottom: "var(--section-gap)" }}>
        {hazards.map((h) => (
          <HazardCard key={h.id} h={h} onClick={() => navigate(HAZARD_ROUTE[h.id] ?? "/hazards")} />
        ))}
      </div>

      {/* ═══ DATA & MODEL CONFIDENCE ═══ */}
      <div className="panel">
        <div className="panel-head"><span className="panel-title">Data &amp; Model Confidence</span></div>
        <div className="panel-body">
          <div className="metric-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <Stat label="Model Coverage" value={`${reporting} / ${hazards.length} reporting`} />
            <Stat label="Data Quality" value={dataQualityLabel(hazards)} />
            <Stat label="Composite Confidence" value={confidenceLabel(composite)} />
            <Stat label="HazardRiskEngine" value={composite ? "OPERATIONAL" : "UNAVAILABLE"} />
            <Stat label="Last Updated" value={lastUpdatedLabel(hazards)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────── */

function RiskScale({ score, severity }: { score?: number; severity?: HazardSeverity }) {
  const markers: HazardSeverity[] = ["LOW", "MODERATE", "HIGH", "EXTREME"];
  const pos = score !== undefined ? Math.max(0, Math.min(100, score)) : null;
  return (
    <div>
      <div style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--line-soft)", margin: "10px 0 4px" }}>
        {pos !== null ? (
          <div
            style={{
              position: "absolute",
              left: `${pos}%`,
              top: -3,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "var(--ink)",
              border: "1px solid var(--surface)",
              transform: "translateX(-50%)",
            }}
          />
        ) : null}
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        {markers.map((m) => (
          <span key={m} className="small muted-3" style={{ fontSize: "var(--text-micro)" }}>{m}</span>
        ))}
      </div>
      {pos !== null && score !== undefined ? (
        <div className="lbl" style={{ marginTop: 8 }}>Score {score} / 100</div>
      ) : (
        <div className="lbl" style={{ marginTop: 8 }}>No composite score</div>
      )}
      {severity ? <div style={{ marginTop: 4 }}><RiskPill severity={severity} /></div> : null}
    </div>
  );
}

function ContributionBar({ h, maxScore }: { h: HazardItem; maxScore: number }) {
  const pct = Math.max(3, ((h.score ?? 0) / maxScore) * 100);
  return (
    <div className="data-row" style={{ alignItems: "center" }}>
      <span className="k" style={{ textTransform: "none", letterSpacing: 0, fontSize: "var(--text-small)", flexShrink: 0, minWidth: 120 }}>
        {h.label}
      </span>
      <span style={{ position: "relative", flex: 1, height: 8, borderRadius: 4, background: "var(--line-soft)" }}>
        <span
          style={{
            display: "block",
            height: 8,
            borderRadius: 4,
            background: barColor(h.risk),
            width: `${pct}%`,
          }}
        />
      </span>
      <span className="v" style={{ fontSize: "var(--text-small)", minWidth: 28 }}>{h.score}</span>
    </div>
  );
}

function RegionRow({ rg }: { rg: RegionImpact }) {
  return (
    <div className="data-row" style={{ alignItems: "center" }}>
      <span className="k" style={{ textTransform: "none", letterSpacing: 0, fontSize: "var(--text-small)" }}>{rg.name}</span>
      <span className="row gap-8" style={{ flexShrink: 0, gap: "var(--sp-2)" }}>
        <RiskPill severity={rg.level} />
        <span className="mono" style={{ fontSize: "var(--text-small)", fontWeight: 700 }}>{rg.pct}%</span>
      </span>
    </div>
  );
}

function ContributorRow({ rank, h, first }: { rank: number; h: HazardItem; first: boolean }) {
  return (
    <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "baseline" }}>
      <span className="mono muted-3" style={{ fontSize: "var(--text-micro)", minWidth: 22 }}>{String(rank).padStart(2, "0")}</span>
      <div>
        <div style={{ fontWeight: 800 }}>{h.label}</div>
        <div className="small muted" style={{ marginTop: 2 }}>
          {first ? "Strongest current contributor" : `${h.risk ?? "Contributing"} · ${h.model ?? "—"}`}
        </div>
      </div>
    </div>
  );
}

function HazardCard({ h, onClick }: { h: HazardItem; onClick: () => void }) {
  return (
    <button
      type="button"
      className="risk-card"
      onClick={onClick}
      title={`Open ${h.label} page`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
        <div className="risk-card-name">{h.label}</div>
        <span className="small muted-3" style={{ fontSize: "var(--text-micro)" }}>{h.data ?? "—"}</span>
      </div>
      <div className="risk-card-status"><StatusLabel status={h.status} /></div>
      <div className="risk-card-risk">
        <RiskPill severity={h.risk} />
      </div>
      <div className="risk-card-meta">
        {h.score !== undefined ? <span>{h.score} / 100</span> : <span>—</span>}
      </div>
      <div className="small muted risk-card-model">{h.model ?? "—"}</div>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-block">
      <span className="lbl">{label}</span>
      <span className="val sm" style={{ fontSize: "var(--text-title)", fontWeight: 900, fontFamily: "var(--display)" }}>{value}</span>
    </div>
  );
}

/* ──────────────────────────────────────────────── */

function barColor(sev: HazardSeverity | undefined): string {
  switch (sev) {
    case "HIGH": case "VERY_HIGH": case "EXTREME": return "var(--sev-high)";
    case "MODERATE": return "var(--sev-moderate)";
    default: return "var(--sev-low)";
  }
}

function confidenceLabel(composite: OverallRisk | null): string {
  // OverallRisk does not carry a confidence figure, so a live composite never
  // claims a fabricated confidence such as "MODERATE". Show "—" (not reported)
  // when operational and "UNAVAILABLE" when the engine is not producing output.
  return composite ? "—" : "UNAVAILABLE";
}

function dataQualityLabel(hazards: HazardItem[]): string {
  if (hazards.length === 0) return "—";
  const bad = hazards.filter((h) => h.status === "MODEL_MISSING" || h.status === "UNAVAILABLE").length;
  if (bad === hazards.length) return "POOR";
  if (bad > 0) return "FAIR";
  return "GOOD";
}

function lastUpdatedLabel(hazards: HazardItem[]): string {
  const ts = hazards
    .map((h) => h.lastUpdate)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}