import { useEffect, useState } from "react";
import { Activity, Box, Crosshair, Gauge, Layers, Satellite, Thermometer } from "lucide-react";
import { useApp } from "@/state/AppContext";
import { useCommandCenterData } from "@/hooks/useCommandCenterData";
import { useModuleStatuses } from "@/hooks/useModuleStatuses";
import { PageHead } from "@/components/overview/PageHead";
import { ModuleGate } from "@/components/overview/ModuleGate";
import { CmSev } from "@/components/overview/CmSev";
import { PipelineStatusStrip } from "@/components/layout/PipelineStatusStrip";
import { mockEnvironmentDrivers } from "@/data/mock/missionMock";
import { formatIST } from "@/utils/format";
import { moduleStatusColor } from "@/lib/moduleStatus";
import { toofanService } from "@/services/toofanService";
import {
  bandTone,
  genesisMeta,
  genesisProvenance,
  genesisReason,
  horizonsFrom,
  pct,
  probabilityBand,
  thresholdState,
  type ProbabilityHorizon,
} from "@/components/mission/genesis/genesisModel";
import type { GenesisReport, GenesisSubModel, ModelInfo, ModelOperationalStatus } from "@/types";

const HORIZONS: { key: ProbabilityHorizon; horizon: number; label: string }[] = [
  { key: "probability24h", horizon: 24, label: "NEXT 24 HOURS" },
  { key: "probability48h", horizon: 48, label: "NEXT 48 HOURS" },
  { key: "probability72h", horizon: 72, label: "NEXT 72 HOURS" },
];

const DRIVER_IDS = ["sst", "sst-anomaly", "tchp", "ohc700", "shear", "rh", "vorticity"];

/** Only a model that the backend / model registry reports as operational
 *  is ever presented as ACTIVE. Absent signals are never assumed. */
function isOperational(s?: ModelOperationalStatus | null): boolean {
  return !!s && (s === "AVAILABLE" || s === "LIVE" || s === "BASELINE");
}

function driverChip(status?: string) {
  const tone =
    status === "FAVORABLE" ? "cm-pill--ok"
    : status === "MODERATE" ? "cm-pill--warn"
    : status === "UNFAVORABLE" ? "cm-pill--bad"
    : "cm-pill--muted";
  return <span className={`cm-pill ${tone}`}>{status ?? "—"}</span>;
}

function clampPct(v: number | null | undefined): number {
  if (v == null) return 0;
  return Math.max(0, Math.min(100, v * 100));
}

function HorizonCard({
  genesis,
  horizon,
  label,
  ok,
  reason,
  sub,
}: {
  genesis: GenesisReport | null;
  horizon: ProbabilityHorizon;
  label: string;
  ok: boolean;
  reason: string | undefined;
  sub: GenesisSubModel[];
}) {
  const horizons = horizonsFrom(sub);
  const H_KEY: Record<ProbabilityHorizon, "h24" | "h48" | "h72"> = {
    probability24h: "h24",
    probability48h: "h48",
    probability72h: "h72",
  };
  const prob = horizons[H_KEY[horizon]];
  const band = probabilityBand(prob);
  const tone = bandTone(band);
  const chrono = genesis?.status?.timestamp;
  const meta = genesis ? genesisMeta(genesis) : { threshold: null, calibrated: false, scientificStatus: null };
  const state = thresholdState(prob, meta.threshold ?? undefined);
  const members = sub.length > 0 ? sub.map((m) => m.name).join(" / ") : undefined;
  const h = HORIZONS.find((x) => x.key === horizon)?.horizon ?? "—";

  return (
    <div className="cm-card cm-horizon">
      <div className="cm-card__head">
        <span className="cm-card__title">{label}</span>
        <span className="cm-pill cm-pill--muted">+{h}H</span>
      </div>

      <div className={`cm-horizon__bar cm-hz--${tone}`} style={{ marginTop: 4 }}>
        <span style={{ width: prob != null ? `${Math.max(2, prob * 100)}%` : "0%" }} />
      </div>

      <div className="cm-tile__value">
        {ok && prob != null ? (
          <>
            {pct(prob)}
            <span className="unit">%</span>
          </>
        ) : (
          <span className="cm-notavail" style={{ fontSize: "1rem" }}>NOT_AVAILABLE</span>
        )}
      </div>

      <div className="cm-kv">
        <div className="cm-kv__row">
          <span className="cm-kv__k">Risk</span>
          <span className="cm-kv__v">
            {prob != null ? <CmSev severity={band ?? undefined} /> : <span className="cm-muted-2">—</span>}
          </span>
        </div>
        <div className="cm-kv__row">
          <span className="cm-kv__k">Threshold</span>
          <span className="cm-kv__v">{meta.threshold != null ? `≥ ${(meta.threshold * 100).toFixed(0)}%` : "—"}</span>
        </div>
        <div className="cm-kv__row">
          <span className="cm-kv__k">Relation</span>
          <span className="cm-kv__v">
            {prob != null && state !== "NONE" ? (
              <span className={`cm-pill ${state === "ABOVE" ? "cm-pill--warn" : "cm-pill--ok"}`}>
                {state === "ABOVE" ? "≥ THRESHOLD" : "BELOW THRESHOLD"}
              </span>
            ) : (
              "—"
            )}
          </span>
        </div>
        <div className="cm-kv__row">
          <span className="cm-kv__k">Timestamp</span>
          <span className="cm-kv__v">{chrono ? formatIST(chrono) : "—"}</span>
        </div>
      </div>

      {members ? (
        <span className="cm-kv__k" style={{ color: "#54687d" }}>
          ENSEMBLE {members}
        </span>
      ) : null}

      {!ok && reason ? (
        <span className="cm-gate__reason" style={{ paddingTop: 2 }}>
          Reason: <b>{reason}</b>
        </span>
      ) : null}
    </div>
  );
}

export default function GenesisPage() {
  const { mode } = useApp();
  const data = useCommandCenterData();
  const statuses = useModuleStatuses();
  const [registry, setRegistry] = useState<ModelInfo[]>([]);
  const { genesis, cyclone, dataSources } = data;

  useEffect(() => {
    document.title = "Genesis Prediction — TOOFAN";
    toofanService
      .getModels()
      .then((models) => setRegistry(Array.isArray(models) ? models : []))
      .catch(() => undefined);
    return () => {
      document.title = "TOOFAN";
    };
  }, []);

  const ok =
    genesis?.status?.status != null &&
    genesis.status.status !== "NOT_AVAILABLE" &&
    genesis.status.status !== "ERROR";

  const provenance = genesis ? genesisProvenance(genesis, mode) : "UNAVAILABLE";
  const meta = genesis ? genesisMeta(genesis) : { threshold: null, calibrated: false, scientificStatus: null };
  const sub = genesis?.subModels ?? [];
  const hs = genesis ? horizonsFrom(sub) : null;

  const regById = new Map(registry.map((r) => [r.id, r]));
  const regEnsemble = regById.get("genesis-ensemble");

  // ── Satellite observation ──
  const satellite = dataSources.find(
    (s) => s.id.toLowerCase().includes("satellite") || s.name.toLowerCase().includes("satell")
  );
  const satAvailable = satellite ? satellite.status === "CONNECTED" || satellite.status === "AVAILABLE" : false;
  const satReason = satellite
    ? `Source not connected — satellite provider reported ${satellite.status.replace(/_/g, " ")}.`
    : "Source not connected — satellite provider not configured.";

  // ── Environmental drivers ──
  const live = mode === "live";
  const drivers = live
    ? []
    : mockEnvironmentDrivers.filter((d) => DRIVER_IDS.includes(d.id)).map((d) => ({ id: d.id, label: d.label, value: d.value, unit: d.unit, threshold: d.threshold, status: d.status }));
  const envReason = live
    ? "Environmental driver feed not exposed by the assessment API — drivers are computed internally by the backend pipeline."
    : undefined;

  const latRow = cyclone && cyclone.latitude !== 0
    ? { id: "lat", label: "Latitude", value: `${Math.abs(cyclone.latitude).toFixed(3)}${cyclone.latitude >= 0 ? "N" : "S"}`, unit: undefined, threshold: "CURRENT CYCLONE", status: "FAVORABLE" as const }
    : null;
  const lonRow = cyclone && cyclone.longitude !== 0
    ? { id: "lon", label: "Longitude", value: `${Math.abs(cyclone.longitude).toFixed(3)}${cyclone.longitude >= 0 ? "E" : "W"}`, unit: undefined, threshold: "CURRENT CYCLONE", status: undefined }
    : null;

  const rowById = new Map<string, { id: string; label: string; value: string | number; unit?: string; threshold?: string; status?: string }>();
  for (const d of drivers) rowById.set(d.id, d);
  if (latRow) rowById.set(latRow.id, latRow);
  if (lonRow) rowById.set(lonRow.id, lonRow);

  const GROUPS: { label: string; ids: string[] }[] = [
    { label: "THERMODYNAMIC", ids: ["sst", "sst-anomaly", "tchp", "ohc700", "rh"] },
    { label: "DYNAMIC", ids: ["shear", "vorticity"] },
    { label: "GEOGRAPHIC", ids: ["lat", "lon"] },
  ];

  const onlineCount = Object.values(statuses).filter((s) => isOperational(s.status)).length;

  return (
    <div className="cm-page">
      <div className="cm-wrap">
        <PageHead
          index="01 / GENESIS"
          kicker="See the signs early"
          title="Genesis Prediction"
          sub="Probability that a tropical disturbance develops into a cyclone within 24/48/72 hours — computed from the ensemble, alongside the environmental drivers the models were trained on."
          meta={
            <div className="cm-pillrow">
              <span className={`cm-pill ${ok ? "cm-pill--ok" : "cm-pill--bad"}`}>
                <span className="cm-dot" style={{ ["--cm-dot" as string]: ok ? "#46d17e" : "#e5604f" }} />
                {ok ? "MODEL OPERATIONAL" : "MODEL NOT AVAILABLE"}
              </span>
              <span className="cm-pill cm-pill--muted">PROVENANCE {provenance}</span>
              {genesis?.status?.timestamp ? (
                <span className="cm-pill cm-pill--muted">OBSERVATION {formatIST(genesis.status.timestamp)}</span>
              ) : null}
            </div>
          }
        />

        {/* ═══ 1 · DEVELOPMENT PROBABILITY ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Crosshair size={13} className="text-cyan-400" />
            <span className="cm-section__title">Genesis Probability</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">ENSEMBLE SOFT-VOTE 0.40 / 0.35 / 0.25</span>
          </div>
          <div className="cm-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {HORIZONS.map((h) => (
              <HorizonCard
                key={h.key}
                genesis={genesis}
                horizon={h.key}
                label={h.label}
                ok={ok}
                reason={genesis ? genesisReason(genesis) ?? undefined : undefined}
                sub={sub}
              />
            ))}
          </div>
          {!ok ? (
            <ModuleGate
              label="GENESIS MODEL"
              status={genesis?.status?.status}
              reason={genesis ? genesisReason(genesis) : undefined}
            >
              <div className="cm-notavail">Genesis ensemble unavailable.</div>
            </ModuleGate>
          ) : null}
        </section>

        {/* ═══ 2 · ENVIRONMENTAL DRIVERS ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Thermometer size={13} className="text-cyan-400" />
            <span className="cm-section__title">Environmental Drivers</span>
            <span className="cm-section__rule" />
            <span className={`cm-pill ${live ? "cm-pill--muted" : "cm-pill--warn"}`}>
              {live ? "LIVE — DRIVER FEED ABSENT" : "SIMULATED VALUES"}
            </span>
          </div>

          {live ? (
            <ModuleGate label="ENVIRONMENTAL DRIVERS" status="NOT_AVAILABLE" reason={envReason}>
              <div className="cm-notavail">Drivers unavailable.</div>
            </ModuleGate>
          ) : (
            <div className="cm-card">
              <div className="cm-table-wrap">
                <table className="cm-table">
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Value</th>
                      <th>Signal</th>
                      <th className="cm-nowrap">Interpretation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GROUPS.map((g) => [
                      <tr className="cm-table__group" key={`g-${g.label}`}>
                        <td colSpan={4}>{g.label}</td>
                      </tr>,
                      ...g.ids
                        .map((id) => rowById.get(id))
                        .filter((r): r is NonNullable<typeof r> => r != null)
                        .map((r) => (
                          <tr key={r.id}>
                            <td style={{ fontFamily: "var(--sans)", fontWeight: 700, color: "#e9f1f8" }}>{r.label}</td>
                            <td className="cm-nowrap">
                              <span className="cm-num">{r.value}</span>
                              {r.unit ? <span className="cm-muted-2"> {r.unit}</span> : null}
                            </td>
                            <td>{driverChip(r.status)}</td>
                            <td>
                              <span className="cm-muted-2">{r.threshold ?? "—"}</span>
                            </td>
                          </tr>
                        )),
                    ])}
                  </tbody>
                </table>
              </div>
              <div className="cm-card__foot">
                <span>PROVENANCE SIMULATED — DEMO ONBOARDING DATA</span>
                <span>THRESHOLDS FOLLOW NIO CLIMATOLOGY</span>
              </div>
            </div>
          )}
        </section>

        {/* ═══ 3 · SATELLITE OBSERVATION ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Satellite size={13} className="text-cyan-400" />
            <span className="cm-section__title">Satellite Observation</span>
            <span className="cm-section__rule" />
            <span className={`cm-pill ${satAvailable ? "cm-pill--ok" : "cm-pill--bad"}`}>
              <span className="cm-dot" style={{ ["--cm-dot" as string]: satAvailable ? "#46d17e" : "#e5604f" }} />
              {satAvailable ? "AVAILABLE" : "NOT_AVAILABLE"}
            </span>
          </div>
          <div className="cm-card">
            {!satAvailable ? (
              <div className="cm-gate">
                <span className="cm-gate__title">SATELLITE OBSERVATION</span>
                <span className="cm-gate__status">NOT_AVAILABLE</span>
                <span className="cm-gate__reason">
                  Reason: <b>{satReason}</b>
                </span>
              </div>
            ) : (
              <>
                <div className="cm-pillrow">
                  <span className="cm-pill cm-pill--muted">
                    {mode === "live" ? "LIVE PROVIDER" : "SIMULATED PROVIDER"}
                  </span>
                  {satellite ? (
                    <span className="cm-pill cm-pill--muted">SOURCE {satellite.id.toUpperCase()}</span>
                  ) : null}
                  {satellite?.coverage ? (
                    <span className="cm-pill cm-pill--muted">COVERAGE {satellite.coverage.toUpperCase()}</span>
                  ) : null}
                  {satellite?.lastUpdate ? (
                    <span className="cm-pill cm-pill--muted">LAST {formatIST(satellite.lastUpdate)}</span>
                  ) : null}
                </div>
                <p className="cm-sub" style={{ marginTop: 10, marginBottom: 0 }}>
                  Imagery ingest is healthy. Guidance is produced from the latest satellite pass.
                </p>
              </>
            )}
          </div>
        </section>

        {/* ═══ 4 · MODEL ENSEMBLE ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Layers size={13} className="text-cyan-400" />
            <span className="cm-section__title">Model Ensemble</span>
            <span className="cm-section__rule" />
            <span className={`cm-pill ${meta.calibrated ? "cm-pill--ok" : "cm-pill--warn"}`}>
              {meta.calibrated ? "CALIBRATED SOFT-VOTE" : "UNCALIBRATED SOFT-VOTE"}
            </span>
          </div>

          <div className="cm-card">
            <div className="cm-card__head">
              <span className="cm-card__title">GENESIS ENSEMBLE</span>
              <span className="cm-pill cm-pill--muted">
                {sub.length} MEMBERS · WEIGHTS {sub.map((m) => (m.weight != null ? m.weight.toFixed(2) : "—")).join(" / ")}
              </span>
            </div>

            {sub.length ? (
              <div className="cm-ens">
                {sub.map((m) => {
                  const reg = regById.get(m.modelId);
                  const regOperational = isOperational(m.status) && (!reg || isOperational(reg.status));
                  const memberTone = bandTone(probabilityBand(m.probability24h));
                  const hzColor = memberTone === "high" ? "#ff7a3c" : memberTone === "moderate" ? "#f0b429" : "#46d17e";
                  return (
                    <div className="cm-ens-member" key={m.modelId}>
                      <div className="cm-ens__head">
                        <span className="cm-dot" style={{ ["--cm-dot" as string]: moduleStatusColor(m.status) }} />
                        <span className="cm-ens__name">{m.name}</span>
                        <span className={`cm-pill ${m.role === "PRIMARY" ? "cm-pill--accent" : "cm-pill--muted"} cm-ens__role`}>
                          {m.role}
                        </span>
                      </div>
                      <span className="cm-ens__meta">
                        {reg ? `${reg.framework} · WEIGHT ${m.weight?.toFixed(2) ?? "—"}` : `FRAMEWORK — · WEIGHT ${m.weight?.toFixed(2) ?? "—"}`}
                      </span>
                      <span className="cm-ens__meta">
                        CHECKPOINT {reg?.artifact ?? "—"}
                      </span>
                      <div className="cm-pillrow">
                        <span className={`cm-pill ${regOperational ? "cm-pill--ok" : "cm-pill--warn"}`}>
                          <span className="cm-dot" style={{ ["--cm-dot" as string]: regOperational ? "#46d17e" : "#f0b429" }} />
                          {regOperational ? "ACTIVE" : String(m.status ?? "NOT_AVAILABLE").replace(/_/g, " ")}
                        </span>
                        {reg ? (
                          <span className="cm-pill cm-pill--muted">
                            {reg.status.replace(/_/g, " ")}
                          </span>
                        ) : (
                          <span className="cm-pill cm-pill--bad">UNLISTED</span>
                        )}
                      </div>
                      {([
                        { k: "probability24h", label: "24H" },
                        { k: "probability48h", label: "48H" },
                        { k: "probability72h", label: "72H" },
                      ] as const).map((hz) => {
                        const v = m[hz.k];
                        return (
                          <div className="cm-ens__hz" key={hz.k}>
                            <span className="cm-ens__hz-label">{hz.label}</span>
<div className="cm-ens__bar" style={{ ["--cm-hz" as string]: hzColor }}>
  <span style={{ width: `${clampPct(v)}%` }} />
</div>
                            <span className="cm-ens__hz-val">{pct(v)}%</span>
                          </div>
                        );
                      })}
                      {m.message ? <span className="cm-muted-2" style={{ fontSize: "0.62rem" }}>{m.message}</span> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="cm-notavail">No ensemble members reported by the backend.</div>
            )}

            <div className="cm-card__foot">
              <span>ENSEMBLE PROBABILITY = Σ WEIGHT × MEMBER PROBABILITY</span>
              {meta.calibrated ? <span>CALIBRATION ARTIFACT APPLIED</span> : <span>PROTOTYPE — UNCALIBRATED</span>}
            </div>
          </div>
        </section>

        {/* ═══ 5 · THRESHOLD ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Gauge size={13} className="text-cyan-400" />
            <span className="cm-section__title">Decision Threshold</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">BINARY GENESIS CLASS</span>
          </div>

          <div className="cm-prov-grid">
            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">DECISION RULE</span>
              </div>
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Threshold</span>
                  <span className="cm-kv__v">{meta.threshold != null ? `${(meta.threshold * 100).toFixed(0)}%` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Calibration</span>
                  <span className="cm-kv__v">{meta.calibrated ? "APPLIED" : meta.calibrated === false ? "NOT APPLIED" : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Scientific Status</span>
                  <span className="cm-kv__v">{meta.scientificStatus ?? "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Model Status</span>
                  <span className="cm-kv__v">{genesis?.status?.status?.replace(/_/g, " ") ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">ENSEMBLE VS THRESHOLD</span>
              </div>
              {(
                [
                  { label: "24H", v: hs?.h24 },
                  { label: "48H", v: hs?.h48 },
                  { label: "72H", v: hs?.h72 },
                ] as const
              ).map((row) => (
                <div className="cm-plot-row" key={row.label}>
                  <span className="cm-plot__label">{row.label}</span>
                  <div
                    className="cm-plot"
                    style={{ ["--cm-hz" as string]: bandTone(probabilityBand(row.v)) === "high" ? "#ff7a3c" : bandTone(probabilityBand(row.v)) === "moderate" ? "#f0b429" : "#46d17e" }}
                  >
                    <span className="cm-plot__fill" style={{ width: `${clampPct(row.v)}%` }} />
                    {meta.threshold != null ? (
                      <span className="cm-plot__mark" style={{ left: `${clampPct(meta.threshold)}%` }} title={`Threshold ${(meta.threshold * 100).toFixed(0)}%`} />
                    ) : null}
                  </div>
                  <span className="cm-plot__val">{pct(row.v)}%</span>
                </div>
              ))}
              <div className="cm-kv" style={{ marginTop: 12 }}>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Rule</span>
                  <span className="cm-kv__v">{meta.threshold != null ? `GENESIS IF P ≥ ${(meta.threshold * 100).toFixed(0)}%` : "NOT DEFINED"}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ 6 · PROVENANCE ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Box size={13} className="text-cyan-400" />
            <span className="cm-section__title">Provenance</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">PROVENANCE {provenance}</span>
          </div>

          <div className="cm-prov-grid">
            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">MODEL ARTIFACT</span>
              </div>
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Model</span>
                  <span className="cm-kv__v">GENESIS ENSEMBLE</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Framework</span>
                  <span className="cm-kv__v">{regEnsemble?.framework ?? "ENSEMBLE"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Checkpoint</span>
                  <span className="cm-kv__v">
                    {sub.map((m) => regById.get(m.modelId)?.artifact).filter(Boolean).join(" · ") || "—"}
                  </span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Output</span>
                  <span className="cm-kv__v">{regEnsemble?.output ?? "Genesis probability (weighted)"}</span>
                </div>
              </div>
            </div>

            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">TIMING & STATUS</span>
              </div>
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Observation Time</span>
                  <span className="cm-kv__v">{genesis?.status?.timestamp ? formatIST(genesis.status.timestamp) : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Inference Time</span>
                  <span className="cm-kv__v">
                    {regEnsemble?.lastInference ? formatIST(regEnsemble.lastInference) : genesis?.status?.timestamp ? formatIST(genesis.status.timestamp) : "—"}
                  </span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Status</span>
                  <span className="cm-kv__v">{genesis?.status?.status?.replace(/_/g, " ") ?? "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Scientific Status</span>
                  <span className="cm-kv__v">{meta.scientificStatus ?? "—"}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="cm-card" style={{ marginTop: 12 }}>
            <div className="cm-card__head">
              <span className="cm-card__title">DATA SOURCE</span>
            </div>
            {(() => {
              const providers = dataSources.filter((s) => ["era5", "sst", "ohc", "tchp", "satellite", "geospatial"].includes(s.id));
              return providers.length ? (
                <div className="cm-pillrow">
                  {providers.map((p) => (
                    <span className="cm-pill cm-pill--muted" key={p.id}>
                      <span className="cm-dot" style={{ ["--cm-dot" as string]: moduleStatusColor(p.status) }} />
                      {p.name.toUpperCase()} · {p.status.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="cm-notavail">No data sources reported for the genesis module.</div>
              );
            })()}
          </div>
        </section>

        {/* ═══ 7 · PIPELINE STATUS ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <Activity size={13} className="text-cyan-400" />
            <span className="cm-section__title">Pipeline Status</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">
              ONLINE {onlineCount}/{Object.keys(statuses).length}
            </span>
          </div>

          <div className="cm-card">
            <PipelineStatusStrip />
            <div className="cm-kv" style={{ marginTop: 12 }}>
              <div className="cm-kv__row">
                <span className="cm-kv__k">Genesis Module</span>
                <span className="cm-kv__v" style={{ color: moduleStatusColor(statuses.genesis?.status) }}>
                  {statuses.genesis?.status?.replace(/_/g, " ") ?? "NOT_AVAILABLE"}
                </span>
              </div>
              <div className="cm-kv__row">
                <span className="cm-kv__k">Engine</span>
                <span className="cm-kv__v">{statuses.genesis?.active ? "RUNNING" : "IDLE"}</span>
              </div>
              <div className="cm-kv__row">
                <span className="cm-kv__k">Reason</span>
                <span className="cm-kv__v">{statuses.genesis?.reason ?? "—"}</span>
              </div>
            </div>
            <div className="cm-card__foot">
              <span>{mode === "live" ? "SIGNALS FROM BACKEND EVENTS" : "DEMO STATUS"}</span>
              <span>LAST OBSERVATION {genesis?.status?.timestamp ? formatIST(genesis.status.timestamp) : "—"}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}