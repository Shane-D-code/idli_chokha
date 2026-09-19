import { useMemo } from "react";
import type { MissionBundle } from "@/types/mission";
import type { PredictionStatus } from "@/types";
import { ProvenancePill, RiskPill, SectionHeader } from "../Shared";
import { sevRank, worstSeverity } from "@/utils/severity";

function availableStatus(s?: PredictionStatus): boolean {
  return s?.status === "AVAILABLE" || s?.status === "LIVE" || s?.status === "BASELINE";
}

export function SectionImpact({ bundle }: { bundle: MissionBundle }) {
  const rainfall = bundle.rainfall;
  const flood = bundle.flood;
  const landslide = bundle.landslide;
  const forecastHorizon = bundle.trajectory?.forecastHorizonHours;
  const modeLabel = bundle.mode === "demo" ? "SIMULATED" : bundle.provenance.hazards;

  // ── RAINFALL ──
  const rainAvailable = availableStatus(rainfall?.status);
  const rainWindows = rainfall?.accumulations ?? [];
  const peakRain = useMemo(() => {
    let peak = 0;
    for (const w of rainWindows) {
      for (const r of w.regions ?? []) {
        if (r.expectedMm != null && r.expectedMm > peak) peak = r.expectedMm;
      }
    }
    return peak > 0 ? peak : undefined;
  }, [rainWindows]);
  const rainTopDistrict = rainfall?.districtRanking?.[0];

  // ── FLOOD ──
  const floodAvailable = availableStatus(flood?.status);
  const floodDistricts = flood?.districts ?? [];
  const floodTop = floodDistricts[0];

  // ── LANDSLIDE ──
  const sus = landslide?.staticSusceptibility;
  const slideRegions = sus?.regions ?? [];
  const landslideAvailable =
    availableStatus(landslide?.modelStatus) && sus?.available === true && slideRegions.length > 0;
  const slideWorst = worstSeverity(slideRegions.map((r) => r.level));

  // ── DISTRICT IMPACT ──
  const districtRows = useMemo(() => {
    return [...bundle.districts].sort(
      (a, b) =>
        sevRank(worstSeverity((b.values ?? []).map((v) => v.risk))) -
        sevRank(worstSeverity((a.values ?? []).map((v) => v.risk))),
    );
  }, [bundle.districts]);
  const window = forecastHorizon != null ? `+${forecastHorizon}H` : "—";

  return (
    <section id="impact" className="m-section m-section--impact" aria-labelledby="impact-title">
      <SectionHeader
        index="03"
        kicker="ASSESS THE IMPACT"
        title="FORECAST IMPACT & HAZARD OUTLOOK"
        subtitle="Translating the forecast track and intensity into downstream hazard risk."
      />

      <div className="m-impact-grid">
        {/* ── RAINFALL ── */}
        <div className={`m-card m-impact-card ${rainAvailable ? "" : "m-impact-card--unavail"}`}>
          <div className="m-card__top">
            <span className="m-card__kicker">RAINFALL FORECAST</span>
            <ProvenancePill label={modeLabel} />
          </div>
          {rainAvailable && (rainWindows.length > 0 || rainTopDistrict) ? (
            <>
              <div className="m-impact-value">
                {peakRain != null ? `${peakRain}` : "—"}
                {peakRain != null ? <span className="m-impact-value__unit"> MM / 24H</span> : null}
              </div>
              <div className="m-impact-values">
                <div className="m-impact-row">
                  <span className="muted">FORECAST WINDOW</span>
                  <b>{rainWindows.map((w) => w.window).join(" · ") || "—"}</b>
                </div>
                <div className="m-impact-row">
                  <span className="muted">PEAK EXPOSURE</span>
                  <b>{rainTopDistrict ? `${rainTopDistrict.district}, ${rainTopDistrict.state}` : "—"}</b>
                </div>
                <div className="m-impact-row">
                  <span className="muted">MODEL</span>
                  <b className="mono">{rainfall.modelName || "—"}</b>
                </div>
              </div>
              <p className="m-panel__note">
                Accumulation windows and district ranking from the rainfall module.
                {rainfall.isBaseline ? " Baseline classifier — not a future accumulation forecast." : ""}
              </p>
            </>
          ) : (
            <UnavailableBlock reason="RAINFALL MODEL — UNAVAILABLE" />
          )}
        </div>

        {/* ── FLOOD ── */}
        <div className={`m-card m-impact-card ${floodAvailable && (floodTop || flood?.overallRisk) ? "" : "m-impact-card--unavail"}`}>
          <div className="m-card__top">
            <span className="m-card__kicker">FLOOD RISK</span>
            <ProvenancePill label={modeLabel} />
          </div>
          {floodAvailable && (floodTop || flood?.overallRisk) ? (
            <>
              <div className="m-impact-value">
                <span className="m-impact-value__row">
                  {flood?.overallRisk ? <RiskPill severity={flood.overallRisk} /> : <span className="m-risk m-risk--none">—</span>}
                </span>
              </div>
              <div className="m-impact-values">
                <div className="m-impact-row">
                  <span className="muted">DISTRICTS ASSESSED</span>
                  <b>{floodDistricts.length}</b>
                </div>
                <div className="m-impact-row">
                  <span className="muted">HIGHEST EXPOSURE</span>
                  <b>{floodTop ? `${floodTop.district}, ${floodTop.state}` : "—"}</b>
                </div>
                <div className="m-impact-row">
                  <span className="muted">MODEL</span>
                  <b className="mono">{flood.modelName || "—"}</b>
                </div>
              </div>
              <p className="m-panel__note">
                {flood.accepted ? "Flood risk accepted as reference output." : "Flood risk output pending validation."}
              </p>
            </>
          ) : (
            <UnavailableBlock reason="FLOOD MODEL — UNAVAILABLE" />
          )}
        </div>

        {/* ── LANDSLIDE ── */}
        <div className={`m-card m-impact-card ${landslideAvailable ? "" : "m-impact-card--unavail"}`}>
          <div className="m-card__top">
            <span className="m-card__kicker">LANDSLIDE RISK</span>
            <ProvenancePill label={modeLabel} />
          </div>
          {landslideAvailable ? (
            <>
              <div className="m-impact-value">
                <span className="m-impact-value__row">
                  {slideWorst ? <RiskPill severity={slideWorst} /> : <span className="m-risk m-risk--none">—</span>}
                </span>
              </div>
              <div className="m-impact-values">
                <div className="m-impact-row">
                  <span className="muted">REGIONS ASSESSED</span>
                  <b>{slideRegions.length}</b>
                </div>
                <div className="m-impact-row">
                  <span className="muted">SCENARIO</span>
                  <b>{slideRegions
                    .slice(0, 2)
                    .map((r) => r.name)
                    .join(" · ")}
                  </b>
                </div>
                <div className="m-impact-row">
                  <span className="muted">CLASSIFICATION</span>
                  <b className="mono">{sus?.classification ?? "—"}</b>
                </div>
              </div>
              <p className="m-panel__note">{sus?.description || "Susceptibility regions along the track corridor."}</p>
            </>
          ) : (
            <UnavailableBlock reason="LANDSLIDE MODEL — UNAVAILABLE" />
          )}
        </div>

        {/* ── STORM SURGE ── */}
        <div className="m-card m-impact-card m-impact-card--unavail">
          <div className="m-card__top">
            <span className="m-card__kicker">STORM SURGE</span>
            <span className="m-badge m-badge--unavail">
              <i className="m-badge__dot" /> UNAVAILABLE
            </span>
          </div>
          <div className="m-impact-unavail">
            <span className="m-impact-unavail__title">SURGE MODEL — UNAVAILABLE</span>
            <span className="m-impact-unavail__note">
              No storm surge model is present in this build. Coastal inundation is not estimated.
            </span>
          </div>
        </div>
      </div>

      {/* ── DISTRICT-LEVEL FORECAST IMPACT ── */}
      <div className="m-card m-impact-districts">
        <div className="m-card__top">
          <span className="m-card__kicker">DISTRICT-LEVEL FORECAST IMPACT</span>
          <span className="mono muted">{window} FORECAST WINDOW</span>
        </div>
        {districtRows.length > 0 ? (
          <div className="m-impact-table-wrap">
            <table className="m-impact-table">
              <thead>
                <tr>
                  <th>DISTRICT</th>
                  <th>HAZARD</th>
                  <th>RISK</th>
                  <th>FORECAST WINDOW</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {districtRows.map((d) => {
                  const sev = worstSeverity((d.values ?? []).map((v) => v.risk));
                  return (
                    <tr key={`${d.state}::${d.district}`}>
                      <td>
                        <b>{d.district}</b>
                        <span className="m-impact-table__state muted">{d.state}</span>
                      </td>
                      <td>{(d.values ?? []).map((v) => v.label).join(" · ") || "—"}</td>
                      <td>{sev ? <RiskPill severity={sev} /> : <span className="m-risk m-risk--none">—</span>}</td>
                      <td className="mono muted">{window}</td>
                      <td><span className="mono muted">{d.provenance ?? modeLabel}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="m-impact-unavail">
            <span className="m-impact-unavail__title">DISTRICT IMPACT — NO DATA</span>
            <span className="m-impact-unavail__note">
              No district-level risk output is present in the current feed.
            </span>
          </div>
        )}
        <p className="m-panel__note">
          District rows aggregate only real rainfall, flood and landslide module output. Marker coordinates are
          administrative reference points; risk values are labelled by provenance.
        </p>
      </div>
    </section>
  );
}

function UnavailableBlock({ reason }: { reason: string }) {
  return (
    <div className="m-impact-unavail">
      <span className="m-impact-unavail__title">{reason}</span>
      <span className="m-impact-unavail__note">No connected output in the current feed.</span>
    </div>
  );
}