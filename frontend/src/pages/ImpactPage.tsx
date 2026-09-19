import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useApp } from "@/state/AppContext";
import { useCommandCenterData } from "@/hooks/useCommandCenterData";
import { useModuleStatuses } from "@/hooks/useModuleStatuses";
import { useScrollToHash } from "@/hooks/useScrollToHash";
import { PageHead } from "@/components/overview/PageHead";
import { ModuleGate } from "@/components/overview/ModuleGate";
import { CmSev, severityLabel } from "@/components/overview/CmSev";
import { CycloneMap, type HazardLayerData } from "@/components/map/CycloneMap";
import { formatIST } from "@/utils/format";
import { moduleStatusColor, severityColor } from "@/lib/moduleStatus";
import { toofanService } from "@/services/toofanService";
import { TRACK_PLACES } from "@/utils/trackPlaces";
import type { CycloneState, HazardSeverity, LandslideReport, ModelInfo, ModelOperationalStatus } from "@/types";

// ─────────────────────────────────────────────────────────────
// Honest helpers — the console ONLY renders what the backend
// actually supplies. No NOT_AVAILABLE is ever promoted to LOW,
// no ERROR is ever demoted to 0, and no demo value leaks into LIVE.
// ─────────────────────────────────────────────────────────────

function isOk(status?: string | null): boolean {
  if (!status) return false;
  return (
    status !== "NOT_AVAILABLE" &&
    status !== "ERROR" &&
    status !== "MODEL_MISSING" &&
    status !== "RUNTIME_REQUIRED" &&
    status !== "UNAVAILABLE"
  );
}

const SEV_ORDER: Record<HazardSeverity, number> = { NONE: 0, LOW: 1, MODERATE: 2, HIGH: 3, VERY_HIGH: 4, EXTREME: 5 };

function worstRisk(list: (HazardSeverity | undefined | null)[]): HazardSeverity | undefined {
  return list.reduce<HazardSeverity | undefined>((w, s) => {
    if (s && s !== "NONE" && (!w || SEV_ORDER[s] > SEV_ORDER[w])) return s;
    return w;
  }, undefined);
}

function fmtNum(n: number | undefined | null, suffix = ""): string {
  return n != null ? `${Math.round(n)}${suffix}` : "—";
}

/** Geocode a district / place name to a real lat/lon from the place registry. */
function placeCoords(name: string): { lat: number; lon: number } | null {
  const n = name.trim().toLowerCase();
  const hit = TRACK_PLACES.find((p) => p.name.toLowerCase() === n || n.includes(p.name.toLowerCase()));
  return hit ? { lat: hit.lat, lon: hit.lon } : null;
}

type HazardPolyLevel = "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH" | "EXTREME";

function polyLevel(risk?: HazardSeverity | null): HazardPolyLevel {
  return risk && risk !== "NONE" ? (risk as HazardPolyLevel) : "MODERATE";
}

/** District markers (rainfall ranking / flood cells) — plotted only for names
 *  that exist in the coordinate registry, at the model-reported risk. */
function districtLayer(
  id: string,
  name: string,
  list: { district: string; risk: HazardSeverity }[]
): HazardLayerData | null {
  const points: NonNullable<HazardLayerData["points"]> = [];
  for (const d of list) {
    const c = placeCoords(d.district);
    if (c) points.push({ lat: c.lat, lon: c.lon, level: d.risk, name: d.district, label: d.district });
  }
  return points.length ? { id, name, points } : null;
}

/** Radial exposure bands around the storm — band radius comes straight from
 *  the model-reported radiusKm (wind zones or rainfall peak-window rings). */
function ringsLayer(
  id: string,
  name: string,
  cyclone: CycloneState | null,
  bands: { radiusKm?: number | null; risk?: HazardSeverity | null; name?: string }[]
): HazardLayerData | null {
  if (!cyclone || !bands?.length) return null;
  const lat = cyclone.latitude;
  const lon = cyclone.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cosLat = Math.max(0.3, Math.cos((lat * Math.PI) / 180));
  const polygons: NonNullable<HazardLayerData["polygons"]> = [];
  for (const b of bands) {
    if (b.radiusKm == null || b.radiusKm <= 0) continue;
    const radiusDeg = b.radiusKm / 111;
    const k = radiusDeg / cosLat;
    const n = 48;
    const ring: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      ring.push([lon + Math.cos(a) * k, lat + Math.sin(a) * radiusDeg]);
    }
    ring.push([ring[0][0], ring[0][1]]);
    polygons.push({ coordinates: [ring], level: polyLevel(b.risk), name: b.name ?? `${b.radiusKm} km` });
  }
  return polygons.length ? { id, name, polygons } : null;
}

/** Landslide susceptibility regions carry real reference coordinates. */
function landslideLayer(ls: LandslideReport | null): HazardLayerData | null {
  const regions = ls?.staticSusceptibility?.regions ?? [];
  const points: NonNullable<HazardLayerData["points"]> = [];
  for (const r of regions) {
    if (r.lat == null || r.lon == null || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    points.push({ lat: r.lat, lon: r.lon, level: r.level, name: r.name, label: r.name });
  }
  return points.length ? { id: "landslide", name: "Landslide", points } : null;
}

/** A single hazard-module card with honest gating. */
function HazardCard({
  title,
  status,
  reason,
  model,
  timestamp,
  risk,
  fallback,
  children,
}: {
  title: string;
  status?: ModelOperationalStatus | null;
  reason?: string | null;
  model?: string | null;
  timestamp?: string | null;
  risk?: HazardSeverity | null;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const ok = isOk(status);
  return (
    <div className="cm-card">
      <div className="cm-card__head">
        <span className="cm-card__title">{title}</span>
        <div className="cm-pillrow">
          {risk ? <CmSev severity={risk} /> : null}
          <span className={`cm-pill ${ok ? "cm-pill--muted" : "cm-pill--bad"}`}>{status?.replace(/_/g, " ") ?? "—"}</span>
        </div>
      </div>
      {ok ? (
        children
      ) : fallback ? (
        fallback
      ) : (
        <ModuleGate label={title} status={status} reason={reason}>
          <div className="cm-notavail">No {title.toLowerCase()} output for this cycle.</div>
        </ModuleGate>
      )}
      <div className="cm-card__foot">
        {model ? <span>MODEL {model}</span> : null}
        <span>TIME {timestamp ? formatIST(timestamp) : "NOT REPORTED"}</span>
      </div>
    </div>
  );
}

const LAYER_META = [
  { key: "rainfall", label: "RAINFALL", id: "rainfall" },
  { key: "flood", label: "FLOOD", id: "flood" },
  { key: "landslide", label: "LANDSLIDE", id: "landslide" },
  { key: "wind", label: "WIND", id: "wind" },
] as const;

type LayerKey = (typeof LAYER_META)[number]["key"];

export default function ImpactPage() {
  useScrollToHash();
  const { mode } = useApp();
  const data = useCommandCenterData();
  const statuses = useModuleStatuses();
  const [registry, setRegistry] = useState<ModelInfo[]>([]);
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({ rainfall: true, flood: true, landslide: true, wind: true });

  useEffect(() => {
    document.title = "Impact — TOOFAN";
    toofanService
      .getModels()
      .then((models) => setRegistry(Array.isArray(models) ? models : []))
      .catch(() => undefined);
    return () => {
      document.title = "TOOFAN";
    };
  }, []);

  const { cyclone, trajectory, rainfall, wind, flood, landslide, risk, hazards, system } = data;

  // ── Per-module health ──
  const rainOk = isOk(rainfall?.status?.status);
  const windOk = isOk(wind?.status?.status);
  const floodOk = isOk(flood?.status?.status);
  const lsOk = isOk(landslide?.modelStatus?.status) && Boolean(landslide?.staticSusceptibility?.available);

  const hazardById = new Map(hazards.map((h) => [h.id, h]));

  // ── Rainfall ──
  const acc = rainfall?.accumulations ?? [];
  let peakRegion: { radiusKm: number; expectedMm?: number } | null = null;
  for (const a of acc) for (const r of a.regions) if ((r.expectedMm ?? -1) > (peakRegion?.expectedMm ?? -1)) peakRegion = { radiusKm: r.radiusKm, expectedMm: r.expectedMm };
  const peakWindow = acc.find((a) => a.regions.some((r) => r.expectedMm === peakRegion?.expectedMm && r.radiusKm === peakRegion?.radiusKm));
  const peakRegions = peakWindow?.regions ?? [];
  const peakMm = peakRegion?.expectedMm;
  const rainRisk = worstRisk([
    ...acc.flatMap((a) => a.regions.map((r) => r.risk)),
    ...(rainfall?.districtRanking?.map((d) => d.risk) ?? []),
  ]);
  const rainTop = rainfall?.districtRanking?.slice(0, 5) ?? [];

  // ── Wind ──
  const windZones = wind?.zones ?? [];
  const maxWindZone = windZones.reduce<{ name: string; maxKt?: number } | null>(
    (w, z) => (!w || (z.maxKt ?? -1) > (w.maxKt ?? -1)) ? z : w,
    null
  );

  // ── Flood ──
  const floodDists = flood?.districts ?? [];
  const maxFloodProb = floodDists.reduce<number | undefined>((m, d) =>
    d.floodProbability != null && (m == null || d.floodProbability > m) ? d.floodProbability : m, undefined);
  const floodRisk = flood?.overallRisk ?? worstRisk(floodDists.map((d) => d.risk));

  // ── Landslide ──
  const lsRegions = landslide?.staticSusceptibility?.regions ?? [];
  const lsRisk = worstRisk(lsRegions.map((r) => r.level));
  const lsClass = landslide?.staticSusceptibility?.classification;
  const lsDriver = lsClass === "DYNAMIC" ? "CYCLONE-RAINFALL TRIGGERED" : lsClass === "STATIC" ? "STATIC TERRAIN" : "NOT REPORTED";

  // ── Unified risk ──
  const severity = risk?.available ? risk.severity : undefined;
  const components = ["rainfall", "wind", "flood", "landslide"].map((id) => ({
    id,
    label: id.toUpperCase(),
    risk: hazardById.get(id)?.risk,
    status: hazardById.get(id)?.status,
    score: hazardById.get(id)?.score,
  }));
  const warnings = components.filter((c) => c.risk && SEV_ORDER[c.risk] >= SEV_ORDER.HIGH);

  const districts = new Map<string, HazardSeverity>();
  (floodDists).forEach((d) => districts.set(`${d.district} (${d.state})`, d.risk));
  (rainfall?.districtRanking ?? []).forEach((d) => {
    const key = `${d.district} (${d.state})`;
    const existing = districts.get(key);
    if (!existing || SEV_ORDER[d.risk] > SEV_ORDER[existing]) districts.set(key, d.risk);
  });
  const affectedRegion = Array.from(districts.entries()).slice(0, 8);

  // ── Track slice for the map ──
  const trackOk = trajectory?.status?.status != null && trajectory.status.status !== "NOT_AVAILABLE" && trajectory.status.status !== "ERROR";
  const trackPoints = trackOk ? trajectory?.points ?? [] : [];

  // ── Spatial layer availability (backend decides; toggles follow) ──
  const rainSpatial = rainOk && (peakRegions.length > 0 || (rainfall?.districtRanking?.length ?? 0) > 0);
  const floodSpatial = floodOk && floodDists.length > 0;
  const lsSpatial = lsOk && lsRegions.length > 0;
  const windSpatial = windOk && windZones.length > 0;
  const hasSpatial = rainSpatial || floodSpatial || lsSpatial || windSpatial;

  const hazardLayers = useMemo<HazardLayerData[]>(() => {
    const layers: HazardLayerData[] = [];
    if (visible.rainfall && rainSpatial) {
      const rings = ringsLayer("rainfall", "Rainfall", cyclone, peakRegions.map((r) => ({ radiusKm: r.radiusKm, risk: r.risk, name: `${r.radiusKm} km` })));
      if (rings) layers.push(rings);
      const pts = districtLayer("rainfall", "Rainfall", rainfall?.districtRanking ?? []);
      if (pts) layers.push(pts);
    }
    if (visible.flood && floodSpatial) {
      const flood = districtLayer("flood", "Flood", floodDists);
      if (flood) layers.push(flood);
    }
    if (visible.landslide && lsSpatial) {
      const ls = landslideLayer(landslide);
      if (ls) layers.push(ls);
    }
    if (visible.wind && windSpatial) {
      const wf = ringsLayer("wind", "Wind Field", cyclone, windZones.map((z) => ({ radiusKm: z.radiusKm, risk: z.risk, name: z.name })));
      if (wf) layers.push(wf);
    }
    return layers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, cyclone, rainfall, floodDists, landslide, windZones, peakRegions, rainSpatial, floodSpatial, lsSpatial, windSpatial]);

  // ── Registry provenance join ──
  const regById = new Map(registry.map((r) => [r.id, r]));
  const prov = {
    rainfall: regById.get("rainfall"),
    wind: regById.get("wind"),
    flood: regById.get("flood"),
    landslide: regById.get("landslide"),
  };

  // ── TOP pipeline strip ──
  const pipeline = [
    { key: "rainfall", label: "RAIN", to: "/impact#rainfall" },
    { key: "wind", label: "WIND", to: "/impact#wind" },
    { key: "flood", label: "FLOOD", to: "/impact#flood" },
    { key: "landslide", label: "LANDSLIDE", to: "/impact#landslide" },
    { key: "hazard_engine", label: "HAZARD ENGINE", to: "/impact#hazard-engine" },
  ] as const;

  return (
    <div className="cm-page">
      <div className="cm-wrap">
        <PageHead
          index="03 / IMPACT"
          kicker="Protect what can be protected"
          title="Multi-Hazard Impact"
          sub="Rainfall, wind, flood and landslide exposure for the active cyclone, folded into one unified hazard verdict with an affected-region map and explicit warnings."
          meta={
            <div className="cm-pillrow">
              <span className={`cm-pill ${risk?.available ? "cm-pill--ok" : "cm-pill--bad"}`}>
                <span className="cm-dot" style={{ ["--cm-dot" as string]: risk?.available ? "#46d17e" : "#e5604f" }} />
                {risk?.available ? "HAZARD ENGINE OPERATIONAL" : "HAZARD ENGINE OFFLINE"}
              </span>
              <span className="cm-pill cm-pill--muted">MODE {mode === "demo" ? "SIMULATED" : "LIVE"}</span>
            </div>
          }
        />

        {/* ═══ TOP · MULTI-HAZARD IMPACT OUTLOOK ═══ */}
        <section className="cm-section cm-anchor" id="outlook">
          <div className="cm-section__head">
            <ShieldAlert size={14} className="text-cyan-400" />
            <span className="cm-section__title">Multi-Hazard Impact Outlook</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">IMPACT STACK</span>
          </div>

          <div className="cm-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <div className="cm-tile">
              <div className="cm-tile__kicker">
                <span className="cm-label">Storm</span>
              </div>
              <div className="cm-tile__value">{cyclone?.name ?? cyclone?.id ?? "NONE"}</div>
              <div className="cm-tile__sub">{cyclone?.category ?? "CATEGORY —"}</div>
            </div>
            <div className="cm-tile">
              <div className="cm-tile__kicker">
                <span className="cm-label">Basin</span>
              </div>
              <div className="cm-tile__value">{cyclone?.basin ?? "—"}</div>
              <div className="cm-tile__sub">{cyclone?.latitude != null ? `${Math.abs(cyclone.latitude).toFixed(1)}° ${Math.abs(cyclone.longitude).toFixed(1)}°` : ""}</div>
            </div>
            <div className="cm-tile">
              <div className="cm-tile__kicker">
                <span className="cm-label">Forecast Horizon</span>
              </div>
              <div className="cm-tile__value">
                {trajectory?.forecastHorizonHours != null ? `${trajectory.forecastHorizonHours}` : "—"}
                <span className="unit">H</span>
              </div>
              <div className="cm-tile__sub">{trajectory?.predictionSteps != null ? `${trajectory.predictionSteps} STEPS` : "NO TRACK SLICE"}</div>
            </div>
            <div className="cm-tile" style={{ gridRow: "span 2" }}>
              <div className="cm-tile__kicker">
                <span className="cm-label">Overall Hazard Severity</span>
              </div>
              <div className="cm-tile__value">
                {severity ? (
                  <span style={{ color: severityColor(severity), fontSize: "1.5rem", letterSpacing: "0.02em" }}>{severityLabel(severity)}</span>
                ) : (
                  <span className="cm-notavail">NOT_AVAILABLE</span>
                )}
              </div>
              <div className="cm-tile__sub">
                {risk?.score != null ? `CONFIDENCE SCORE ${risk.score}/100` : risk?.engineName ?? "NO ASSESSMENT RUN"}
              </div>
            </div>
          </div>

          <div className="cm-card" style={{ marginTop: 12 }}>
            <div className="cm-card__head">
              <span className="cm-card__title">Pipeline Status</span>
              <span className="cm-pill cm-pill--muted">HAZARD MODULES</span>
            </div>
            <div className="cm-flow__lane">
              {pipeline.map((p) => {
                const st = statuses[p.key];
                return (
                  <Link key={p.key} to={p.to} className="cm-layerchip cm-chip-link">
                    <span className="cm-dot" style={{ ["--cm-dot" as string]: moduleStatusColor(st?.status) }} />
                    {p.label}
                    <span className="cm-muted-2 cm-mono" style={{ fontSize: "0.52rem" }}>{st?.status?.replace(/_/g, " ") ?? "—"}</span>
                  </Link>
                );
              })}
              <span className="cm-layerchip cm-chip-link" role="status">
                <span className="cm-dot" style={{ ["--cm-dot" as string]: severity ? severityColor(severity) : "#54687d" }} />
                UNIFIED RISK
                <span className="cm-mono" style={{ fontSize: "0.52rem" }}>{severity ? severityLabel(severity) : "NOT_AVAILABLE"}</span>
              </span>
            </div>
          </div>
        </section>

        {/* ═══ HAZARD GRID · RAIN / WIND / FLOOD / LANDSLIDE ═══ */}
        <section className="cm-section">
          <div className="cm-section__head">
            <span className="cm-section__title">Hazard Modules</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">48H EXPOSURE</span>
          </div>

          <div className="cm-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))" }}>
            {/* ── RAINFALL ── */}
            <HazardCard
              title="Rainfall"
              status={rainfall?.status?.status}
              reason={rainfall?.status?.message}
              model={rainfall?.modelName ?? prov.rainfall?.name}
              timestamp={rainfall?.status?.timestamp}
              risk={rainRisk}
            >
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Rainfall Amount</span>
                  <span className="cm-kv__v">{fmtNum(peakMm, " mm")}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Forecast Window</span>
                  <span className="cm-kv__v">{peakWindow?.label ?? (acc.length ? acc[acc.length - 1].window : "—")}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Peak Exposure</span>
                  <span className="cm-kv__v">
                    {peakRegion ? `± ${peakRegion.radiusKm} km @ ${fmtNum(peakMm, " mm")}` : "—"}
                  </span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Risk</span>
                  <span className="cm-kv__v">{rainRisk ? <CmSev severity={rainRisk} /> : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Spatial Map</span>
                  <span className="cm-kv__v">{rainSpatial ? "ACTIVE ON RISK MAP" : "NOT AVAILABLE"}</span>
                </div>
              </div>
              {rainTop.length ? (
                <div className="cm-table-wrap">
                  <table className="cm-table">
                    <thead>
                      <tr>
                        <th>District</th>
                        <th>State</th>
                        <th className="cm-nowrap">Expected</th>
                        <th>Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rainTop.map((d) => (
                        <tr key={`${d.district}-${d.state}`}>
                          <td style={{ fontFamily: "var(--sans)", fontWeight: 700, color: "#e9f1f8" }}>{d.district}</td>
                          <td className="cm-muted-2">{d.state}</td>
                          <td className="cm-table__num">{d.expectedMm != null ? `${Math.round(d.expectedMm)} mm` : "—"}</td>
                          <td><CmSev severity={d.risk} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="cm-notavail">No district ranking supplied by the rainfall model.</div>
              )}
              {rainfall?.isBaseline && rainfall.baselineNotice ? (
                <div className="cm-pill cm-pill--warn" style={{ marginTop: 10 }}>{rainfall.baselineNotice}</div>
              ) : null}
            </HazardCard>

            {/* ── WIND ── */}
            <HazardCard
              title="Wind"
              status={wind?.status?.status}
              reason={wind?.status?.message ?? wind?.message}
              model={wind?.modelName ?? prov.wind?.name}
              timestamp={wind?.status?.timestamp}
              risk={worstRisk(windZones.map((z) => z.risk))}
              fallback={
                <div className="cm-gate">
                  <span className="cm-gate__title">WIND FIELD</span>
                  <span className="cm-gate__status">PROVIDER REQUIRED</span>
                  <span className="cm-gate__reason">
                    Reason: <b>{wind?.message ?? wind?.status?.message ?? "U10/V10 production provider unavailable — no wind map is fabricated."}</b>
                  </span>
                </div>
              }
            >
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Wind Speed</span>
                  <span className="cm-kv__v">{fmtNum(maxWindZone?.maxKt, " kt")}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Direction</span>
                  <span className="cm-kv__v">NOT REPORTED</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Spatial Wind Field</span>
                  <span className="cm-kv__v">{windSpatial ? "ACTIVE ON RISK MAP (ring geometry from zone radii)" : "NOT AVAILABLE"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Risk Thresholds</span>
                  <span className="cm-kv__v">{worstRisk(windZones.map((z) => z.risk)) ? "ZONE-BASED BANDS" : "—"}</span>
                </div>
              </div>
              {windZones.length ? (
                <div className="cm-table-wrap">
                  <table className="cm-table">
                    <thead>
                      <tr>
                        <th>Zone</th>
                        <th>Radius</th>
                        <th className="cm-nowrap">Max Wind</th>
                        <th>Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {windZones.map((z) => (
                        <tr key={z.name}>
                          <td style={{ fontFamily: "var(--sans)", fontWeight: 700, color: "#e9f1f8" }}>{z.name}</td>
                          <td>{z.radiusKm != null ? `± ${z.radiusKm} km` : "—"}</td>
                          <td className="cm-table__num">{z.maxKt != null ? `${z.maxKt} kt` : "—"}</td>
                          <td>{z.risk ? <CmSev severity={z.risk} /> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="cm-notavail">No wind-field zones supplied.</div>
              )}
            </HazardCard>

            {/* ── FLOOD ── */}
            <HazardCard
              title="Flood"
              status={flood?.status?.status}
              reason={flood?.status?.message}
              model={flood?.modelName ?? prov.flood?.name}
              timestamp={flood?.predictionTimestamp ?? flood?.status?.timestamp}
              risk={floodRisk}
            >
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Flood Probability</span>
                  <span className="cm-kv__v">{maxFloodProb != null ? `${(maxFloodProb * 100).toFixed(0)}%` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Flood Risk</span>
                  <span className="cm-kv__v">{floodRisk ? <CmSev severity={floodRisk} /> : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Affected Regions</span>
                  <span className="cm-kv__v">{floodDists.length ? `${floodDists.length} DISTRICTS` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Spatial Flood Grid</span>
                  <span className="cm-kv__v">{floodSpatial ? `${floodDists.length} DISTRICT CELLS ON RISK MAP` : "NOT AVAILABLE"}</span>
                </div>
              </div>
              {floodDists.length ? (
                <div className="cm-table-wrap">
                  <table className="cm-table">
                    <thead>
                      <tr>
                        <th>District</th>
                        <th>State</th>
                        <th className="cm-nowrap">Flood Probability</th>
                        <th>Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {floodDists.map((d) => (
                        <tr key={`${d.district}-${d.state}`}>
                          <td style={{ fontFamily: "var(--sans)", fontWeight: 700, color: "#e9f1f8" }}>{d.district}</td>
                          <td className="cm-muted-2">{d.state}</td>
                          <td className="cm-table__num">{d.floodProbability != null ? `${(d.floodProbability * 100).toFixed(0)}%` : "—"}</td>
                          <td><CmSev severity={d.risk} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="cm-notavail">No flood districts supplied by the flood classifier.</div>
              )}
            </HazardCard>

            {/* ── LANDSLIDE ── */}
            <HazardCard
              title="Landslide"
              status={landslide?.modelStatus?.status}
              reason={landslide?.modelStatus?.message ?? landslide?.staticSusceptibility?.description}
              model={prov.landslide?.name}
              timestamp={landslide?.modelStatus?.timestamp}
              risk={lsRisk}
            >
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Susceptibility</span>
                  <span className="cm-kv__v">{lsClass?.replace(/_/g, " ") ?? "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Affected Regions</span>
                  <span className="cm-kv__v">{lsRegions.length ? `${lsRegions.length} REGIONS` : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Rainfall Driver</span>
                  <span className="cm-kv__v">{lsDriver}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Risk</span>
                  <span className="cm-kv__v">{lsRisk ? <CmSev severity={lsRisk} /> : "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Map</span>
                  <span className="cm-kv__v">{lsSpatial ? `${lsRegions.filter((r) => r.lat != null).length} GEOREFERENCED POINTS ON RISK MAP` : "NOT AVAILABLE"}</span>
                </div>
              </div>
              {lsRegions.length ? (
                <div className="cm-table-wrap">
                  <table className="cm-table">
                    <thead>
                      <tr>
                        <th>Region</th>
                        <th>Level</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lsRegions.map((r, i) => (
                        <tr key={`${r.name}-${i}`}>
                          <td style={{ fontFamily: "var(--sans)", fontWeight: 700, color: "#e9f1f8" }}>{r.name}</td>
                          <td><CmSev severity={r.level} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="cm-notavail">No susceptibility regions supplied.</div>
              )}
            </HazardCard>
          </div>
        </section>

        {/* ═══ UNIFIED HAZARD ENGINE ═══ */}
        <section className="cm-section cm-anchor" id="hazard-engine">
          <div className="cm-section__head">
            <ShieldAlert size={14} className="text-cyan-400" />
            <span className="cm-section__title">Unified Hazard Engine</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">FINAL VERDICT</span>
          </div>

          <div className="cm-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {/* Overall severity — the major verdict */}
            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">Overall Hazard Severity</span>
                <span className={`cm-pill ${risk?.available ? "cm-pill--ok" : "cm-pill--bad"}`}>
                  {risk?.available ? "ENGINE OPERATIONAL" : "ENGINE OFFLINE"}
                </span>
              </div>
              <div className="cm-tile__value" style={{ fontSize: "2rem", lineHeight: 1.1, margin: "6px 0 10px" }}>
                {severity ? (
                  <span style={{ color: severityColor(severity) }}>{severityLabel(severity)}</span>
                ) : (
                  <span className="cm-notavail" style={{ fontSize: "1rem" }}>NOT_AVAILABLE</span>
                )}
              </div>
              <div className="cm-kv">
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Confidence Score</span>
                  <span className="cm-kv__v">{risk?.score != null ? `${risk.score}/100` : "NOT REPORTED"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Engine</span>
                  <span className="cm-kv__v">{risk?.engineName ?? "—"}</span>
                </div>
                <div className="cm-kv__row">
                  <span className="cm-kv__k">Verdict Basis</span>
                  <span className="cm-kv__v">
                    {risk?.available
                      ? "COMPOSITE OF ALL OPERATIONAL COMPONENTS"
                      : risk?.reason ?? "NO ASSESSMENT RUN — NO SEVERITY ASSIGNED"}
                  </span>
                </div>
              </div>
            </div>

            {/* Component risks */}
            <div className="cm-card">
              <div className="cm-card__head">
                <span className="cm-card__title">Component Risks</span>
                <span className="cm-pill cm-pill--muted">MODULE VERDICTS</span>
              </div>
              <div className="cm-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                {components.map((c) => (
                  <div key={c.id} className="cm-tile">
                    <div className="cm-tile__kicker">
                      <span className="cm-label">{c.label}</span>
                    </div>
                    <div className="cm-tile__value">{c.risk ? <CmSev severity={c.risk} /> : <span className="cm-notavail" style={{ fontSize: "0.8rem" }}>NOT_AVAILABLE</span>}</div>
                    <div className="cm-tile__sub">
                      {c.status ?? "—"}
                      {c.score != null ? ` · ${c.score} PTS` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="cm-card" style={{ marginTop: 12 }}>
            <div className="cm-card__head">
              <span className="cm-card__title">Assessment Context</span>
              <span className="cm-pill cm-pill--muted">REGIONAL LOOK</span>
            </div>
            <div className="cm-kv">
              <div className="cm-kv__row">
                <span className="cm-kv__k">Affected Region</span>
                <span className="cm-kv__v">
                  {affectedRegion.length ? affectedRegion.map(([name, sev]) => (
                    <span key={name} className="cm-pill cm-pill--muted" style={{ marginRight: 6 }}>
                      {name} <CmSev severity={sev} />
                    </span>
                  )) : <span className="cm-notavail">No districts reported for this cycle.</span>}
                </span>
              </div>
              <div className="cm-kv__row">
                <span className="cm-kv__k">Uncertainty</span>
                <span className="cm-kv__v" style={{ color: "#7e97ae" }}>
                  {risk?.reason ?? "Composite score from all operational components; absent components are excluded, never imputed."}
                </span>
              </div>
              <div className="cm-kv__row">
                <span className="cm-kv__k">Provenance</span>
                <span className="cm-kv__v">{mode === "demo" ? "SIMULATED HAZARD ITEMS" : "BACKEND HAZARD ITEMS"}</span>
              </div>
              <div className="cm-kv__row">
                <span className="cm-kv__k">Last Updated</span>
                <span className="cm-kv__v">{system?.lastUpdated ? formatIST(system.lastUpdated) : "NOT REPORTED"}</span>
              </div>
            </div>
            <div className="cm-card__foot" style={{ marginTop: 14 }}>
              <span className="cm-label" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={12} /> WARNINGS
              </span>
              {warnings.length > 0 ? (
                warnings.map((w) => (
                  <span key={w.id} className="cm-pill cm-pill--bad">
                    {w.label} {w.risk?.replace(/_/g, " ")}
                  </span>
                ))
              ) : (
                <span className="cm-pill cm-pill--muted">NONE ACTIVE</span>
              )}
              <span className="cm-muted-2">REF {risk?.available ? "ENGINE OUTPUT" : "OFFLINE"}</span>
            </div>
          </div>
        </section>

        {/* ═══ RISK MAP ═══ */}
        <section className="cm-section cm-anchor" id="risk-map">
          <div className="cm-section__head">
            <span className="cm-section__title">Risk Map</span>
            <span className="cm-section__rule" />
            <span className="cm-pill cm-pill--muted">SPATIAL HAZARD</span>
          </div>

          {hasSpatial ? (
            <div className="cm-card cm-card--flush">
              <div className="cm-maphead">
                <div className="cm-layers">
                  {LAYER_META.filter((lm) => {
                    if (lm.key === "rainfall") return rainSpatial;
                    if (lm.key === "flood") return floodSpatial;
                    if (lm.key === "landslide") return lsSpatial;
                    return windSpatial;
                  }).map((lm) => {
                    const on = visible[lm.key];
                    return (
                      <button
                        key={lm.key}
                        type="button"
                        className={`cm-chip-btn ${on ? "is-active" : ""}`}
                        onClick={() => setVisible((v) => ({ ...v, [lm.key]: !v[lm.key] }))}
                        title={`${on ? "Hide" : "Show"} ${lm.label} layer`}
                      >
                        <span className="cm-dot" style={{ ["--cm-dot" as string]: on ? (lm.id === "wind" ? "#35cfe3" : "#46d17e") : "#54687d" }} />
                        {lm.label}
                      </button>
                    );
                  })}
                </div>
                <span className="cm-muted-2 cm-mono" style={{ fontSize: "0.56rem" }}>
                  TOGGLES FOLLOW BACKEND DATA
                </span>
              </div>
              <div style={{ height: 460, display: "flex", flexDirection: "column" }}>
                <CycloneMap
                  forecast={trackPoints}
                  current={
                    cyclone
                      ? { lat: cyclone.latitude, lon: cyclone.longitude, name: cyclone.name ?? cyclone.id, windKt: cyclone.windKt }
                      : undefined
                  }
                  hazardLayers={hazardLayers}
                  height={460}
                  simplified={false}
                  isDemo={mode === "demo"}
                  recenterMode="cyclone"
                  focusPadding={40}
                />
              </div>
              <div className="cm-mapfoot">
                <span className="cm-muted-2 cm-mono" style={{ fontSize: "0.52rem" }}>
                  {hazardLayers.length} ACTIVE LAYER{hazardLayers.length === 1 ? "" : "S"} · GEOMETRY ONLY FROM MODEL-REPORTED RADII & REGISTRY COORDINATES
                </span>
                {trackPoints.length ? <span className="cm-muted-2 cm-mono" style={{ fontSize: "0.52rem" }}>TRACK NOW → +{trajectory?.forecastHorizonHours ?? 24}H</span> : null}
              </div>
            </div>
          ) : (
            <ModuleGate label="RISK MAP" status="NOT_AVAILABLE" reason="No spatial hazard data supplied by the backend for this cycle.">
              <div className="cm-notavail">No hazard layer is enabled — nothing is plotted.</div>
            </ModuleGate>
          )}

          {affectedRegion.length ? (
            <div className="cm-card" style={{ marginTop: 12 }}>
              <div className="cm-card__head">
                <span className="cm-card__title">Affected Region</span>
                <span className="cm-pill cm-pill--muted">WORST CASE PER DISTRICT</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {affectedRegion.map(([name, sev]) => (
                  <span key={name} className="cm-pill cm-pill--muted">
                    {name} <CmSev severity={sev} />
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}