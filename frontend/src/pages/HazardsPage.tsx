import { useEffect, useMemo, useState } from "react";
import {
  CycloneMap,
  type HazardLayerData,
  type HazardPointInfo,
} from "@/components/map/CycloneMap";
import { MapErrorBoundary } from "@/components/map/MapErrorBoundary";
import { LayerControl, type LayerGroup } from "@/components/map/LayerControl";
import { LoadingState, EmptyState } from "@/components/common/StateBox";
import { RiskPill } from "@/components/common/RiskPill";
import { StatusBadge } from "@/components/mission/sections/TrackForecastComponents";
import { loadMissionBundle, fmtIST } from "@/services/missionService";
import { sevRank, worstSeverity } from "@/utils/severity";
import { intensityClassInfo } from "@/utils/intensity";
import type { MissionBundle, DistrictPoint } from "@/types/mission";
import type { HazardSeverity, RadialRain } from "@/types";

type ExposurePoint = { lat: number; lon: number; level: string; name?: string };

/**
 * Section 03 — FORECAST IMPACT & HAZARD OUTLOOK
 * Translates the frozen track/intensity forecast into downstream hazard risk.
 * Honest states only: real module output, or UNAVAILABLE — never invented values.
 */
export default function HazardsPage() {
  const [bundle, setBundle] = useState<MissionBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DistrictPoint | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>({
    observed: true,
    forecast: true,
    cone: true,
    points: true,
    rainfall: true,
    flood: true,
    landslide: true,
    districts: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await loadMissionBundle();
        if (!cancelled) setBundle(b);
      } catch (err) {
        console.error("HazardsPage: failed to load mission bundle", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const d = useMemo(() => deriveHazards(bundle), [bundle]);

  const simulated = bundle?.mode === "demo";
  const modeLabel = !bundle
    ? "UNAVAILABLE"
    : simulated
      ? "SIMULATED"
      : bundle.provenance.hazards;
  const statusLabel = simulated ? "SIMULATED" : (bundle?.provenance.hazards ?? "UNAVAILABLE");

  const cyc = bundle?.cyclone;
  const current = useMemo(
    () =>
      cyc?.latitude != null && cyc.longitude != null
        ? { lat: cyc.latitude, lon: cyc.longitude, name: cyc.name, windKt: cyc.windKt }
        : undefined,
    [cyc]
  );

  // ── Hazard layers for the impact map ──
  const hazardLayers = useMemo<HazardLayerData[]>(() => {
    if (!bundle || !d) return [];
    const layers: HazardLayerData[] = [];

    // Rainfall: concentric exposure bands derived from the real radiusKm
    // values of the peak accumulation window, centred on the storm.
    if (visible.rainfall && current && d.rainPeakWindow) {
      layers.push({
        id: "rainfall",
        name: "Rainfall",
        polygons: d.rainPeakWindow.regions
          .filter((r) => r.risk !== "NONE")
          .map((r) => ({
            coordinates: [ringPolygon(current.lat, current.lon, r.radiusKm)],
            level: (r.risk as any),
            name: `${r.radiusKm} km`,
          })),
      });
    }

    // Flood: district markers carrying flood model output.
    if (visible.flood && d.floodDistricts.length > 0) {
      layers.push({
        id: "flood",
        name: "Flood",
        points: d.floodDistricts.flatMap<ExposurePoint>((f) => {
          const c = d.coordIndex.get(`${f.state}::${f.district}`);
          return c ? [{ lat: c.lat, lon: c.lon, level: f.risk, name: f.district }] : [];
        }),
      });
    }

    // Landslide: susceptibility regions with their real reference coordinates.
    if (visible.landslide && d.slideRegions.length > 0) {
      layers.push({
        id: "landslide",
        name: "Landslide",
        points: d.slideRegions.map<ExposurePoint>((r) => ({
          lat: r.lat,
          lon: r.lon,
          level: r.level,
          name: r.name,
        })),
      });
    }

    // Districts: every exposed district, coloured by worst aggregated risk.
    if (visible.districts && d.allDistricts.length > 0) {
      const topKeys = new Set(d.topExposed.map((x) => x.key));
      layers.push({
        id: "districts",
        name: "Districts",
        points: d.allDistricts.flatMap<ExposurePoint>((p) => {
          const sev = worstSeverity((p.values ?? []).map((v) => v.risk));
          if (!sev) return [];
          return [
            {
              lat: p.lat,
              lon: p.lon,
              level: sev,
              name: p.district,
              label: topKeys.has(`${p.state}::${p.district}`) ? p.district : "",
            },
          ];
        }),
      });
    }
    return layers;
  }, [bundle, d, visible, current]);

  const hiddenLayers = useMemo<Array<"observed" | "forecast" | "cone" | "points">>(() => {
    const h: Array<"observed" | "forecast" | "cone" | "points"> = [];
    if (!visible.observed) h.push("observed");
    if (!visible.forecast) h.push("forecast");
    if (!visible.cone) h.push("cone");
    if (!visible.points) h.push("points");
    return h;
  }, [visible]);

  const groups: LayerGroup[] = useMemo(
    () => [
      {
        group: "Track",
        options: [
          { key: "observed", label: "Observed Path", available: true },
          { key: "forecast", label: "Model Forecast", available: true },
          { key: "cone", label: "Uncertainty Cone", available: true },
          { key: "points", label: "Horizon Points", available: true },
        ],
      },
      {
        group: "Exposure",
        options: [
          { key: "rainfall", label: "Rainfall Bands", available: d.rainAvailable && d.rainPeak != null },
          { key: "flood", label: "Flood Districts", available: d.floodAvailable && d.floodDistricts.length > 0 },
          { key: "landslide", label: "Landslide Regions", available: d.slideRegions.length > 0 },
          { key: "districts", label: "District Exposure", available: d.allDistricts.length > 0 },
        ],
      },
    ],
    [d]
  );

  const toggle = (key: string) => setVisible((v) => ({ ...v, [key]: !v[key] }));

  const handleHazardPoint = (info: HazardPointInfo) => {
    if (!info.name) return;
    const match = d.allDistricts.find((x) => x.district === info.name);
    setSelected(match ?? null);
  };

  // Close the district drawer on Escape.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  if (loading) {
    return (
      <div className="tf-page">
        <LoadingState rows={4} />
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="tf-page">
        <EmptyState big="IMPACT OUTLOOK UNAVAILABLE" message="No hazard feed could be loaded." />
      </div>
    );
  }

  const cat = cyc?.windKt != null ? intensityClassInfo(cyc.windKt) : null;

  return (
    <div className="tf-page">
      <header className="tf-header">
        <div className="tf-header__left">
          <div className="tf-header__index">
            <span className="tf-header__num">03</span>
            <span className="tf-header__rule" />
          </div>
          <div className="tf-header__text">
            <span className="tf-header__kicker">ASSESS THE IMPACT</span>
            <h1 className="tf-header__title">FORECAST IMPACT &amp; HAZARD OUTLOOK</h1>
            <p className="tf-header__sub">
              Translating the forecast track and intensity into downstream hazard risk.
            </p>
          </div>
        </div>
        <div className="tf-header__right">
          <StatusBadge status={statusLabel} />
        </div>
      </header>

      {/* ═══════════ IMPACT WORKSPACE · MAP PRIMARY ═══════════ */}
      <div className="hz-workspace">
        <div className="hz-map-wrap">
          <div className="tf-map-head">
            <div className="tf-map-head__left">
              <span className="tf-map-head__kicker">IMPACT MAP</span>
              <span className="tf-map-head__name">{cyc?.basin ?? "NORTH INDIAN OCEAN"}</span>
              <span className="tf-map-head__sep">&middot;</span>
              <span className="tf-map-head__name">{cyc?.name ?? "\u2014"}</span>
              <span className="tf-map-head__range">EXPOSURE &amp; HAZARD SEVERITY</span>
            </div>
            <div className="tf-map-head__right">
              <StatusBadge status={statusLabel} />
            </div>
          </div>

          <MapErrorBoundary title="IMPACT MAP UNAVAILABLE" height="100%">
            <CycloneMap
              current={current}
              forecast={d.points}
              historicalTrack={d.observed}
              hazardLayers={hazardLayers}
              onHazardPointSelected={handleHazardPoint}
              hiddenLayers={hiddenLayers}
              recenterMode="track"
              focusPadding={50}
              isDemo={simulated}
            />
          </MapErrorBoundary>

          <ImpactLegend />

          <div className="tf-layer-ctrl">
            <LayerControl groups={groups} visible={visible} onToggle={(k) => toggle(k)} />
          </div>
        </div>

        {/* ── Right intel: hazard summary + ranked exposure ── */}
        <aside className="hz-intel" aria-label="Impact summary">
          <div className="hz-intel__inner">
            <div className="hz-intel__section">
              <div className="hz-intel__label-row">
                <span className="tf-intel__label">CURRENT CYCLONE</span>
                <StatusBadge status={statusLabel} />
              </div>
              <div className="hz-intel__storm-line">
                <span className="hz-intel__storm-name">{cyc?.name ?? "\u2014"}</span>
                <span className="hz-intel__storm-wind" style={{ color: cat?.color ?? "var(--ink)" }}>
                  {cyc?.windKt != null ? `${cyc.windKt} kt` : "\u2014"}
                </span>
                {cat && (
                  <span
                    className="tf-intel__cat-badge"
                    style={{ color: cat.color, borderColor: `${cat.color}44` }}
                  >
                    {cat.shortLabel}
                  </span>
                )}
              </div>
              <div className="hz-intel__kv">
                <div className="hz-intel__kv-row">
                  <span className="tf-intel__kv-key">MSLP</span>
                  <span className="tf-intel__kv-val">
                    {cyc?.mslpHpa != null ? `${cyc.mslpHpa} hPa` : "\u2014"}
                  </span>
                </div>
                <div className="hz-intel__kv-row">
                  <span className="tf-intel__kv-key">MOVE</span>
                  <span className="tf-intel__kv-val">
                    {cyc?.movement?.direction ?? "\u2014"}
                    {cyc?.movement?.speedKph != null ? ` \u00B7 ${cyc.movement.speedKph} km/h` : ""}
                  </span>
                </div>
              </div>
            </div>

            <div className="hz-intel__section">
              <span className="tf-intel__label">HAZARD SUMMARY</span>
              <div className="hz-sum">
                <div className="hz-sum__row">
                  <span className="hz-sum__label">RAINFALL PEAK</span>
                  <span className="hz-sum__val">
                    {d.rainPeak != null ? `${d.rainPeak} mm` : "\u2014"}
                    {d.rainPeakWindow && <em className="hz-sum__sub">{d.rainPeakWindow.window}</em>}
                  </span>
                </div>
                <div className="hz-sum__row">
                  <span className="hz-sum__label">FLOOD OVERALL</span>
                  <span className="hz-sum__val">
                    {d.floodOverall ? (
                      <RiskPill severity={d.floodOverall} />
                    ) : (
                      <span className="muted-3">\u2014</span>
                    )}
                  </span>
                </div>
                <div className="hz-sum__row">
                  <span className="hz-sum__label">LANDSLIDE WORST</span>
                  <span className="hz-sum__val">
                    {d.slideWorst ? (
                      <RiskPill severity={d.slideWorst} />
                    ) : (
                      <span className="muted-3">\u2014</span>
                    )}
                  </span>
                </div>
                <div className="hz-sum__row hz-sum__row--unavail">
                  <span className="hz-sum__label">STORM SURGE</span>
                  <span className="hz-sum__unavail">MODEL UNAVAILABLE</span>
                </div>
              </div>
            </div>

            <div className="hz-intel__section">
              <div className="hz-intel__label-row">
                <span className="tf-intel__label">RANKED TOP EXPOSED AREAS</span>
                <span className="hz-intel__count muted mono">{d.districtRows.length}</span>
              </div>
              {d.topExposed.length > 0 ? (
                <div className="hz-top">
                  {d.topExposed.map((x, i) => (
                    <button
                      key={x.key}
                      className="hz-top-row"
                      onClick={() => setSelected(x.district)}
                      aria-label={`Open ${x.district.district} impact details`}
                    >
                      <span className="hz-top-rank">{String(i + 1).padStart(2, "0")}</span>
                      <span className="hz-top-name">
                        <b>{x.district.district}</b>
                        <span className="hz-top-state">{x.district.state}</span>
                      </span>
                      <RiskPill severity={x.severity} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="hz-top-empty muted-3 small">No district exposure data.</div>
              )}
            </div>

            <div className="hz-intel__section">
              <div className="hz-intel__label-row">
                <span className="tf-intel__label">ASSESSED GENERATION</span>
                <span className="hz-intel__count mono muted">{modeLabel}</span>
              </div>
              <p className="hz-intel__note">
                Marker coordinates are administrative reference points carried by the data layer.
                Every risk value is labelled by provenance — nothing here is fabricated.
              </p>
            </div>
          </div>
        </aside>
      </div>

      {/* ═══════════ HAZARD OUTLOOK · FULL MODULES ═══════════ */}
      <div className="hz-outlook-head">
        <span className="tf-lifecycle__title">HAZARD OUTLOOK — MODEL OUTPUT</span>
      </div>
      <div className="m-impact-grid">
        <RainfallCard bundle={bundle} d={d} modeLabel={modeLabel} />
        <FloodCard bundle={bundle} d={d} modeLabel={modeLabel} />
        <LandslideCard bundle={bundle} d={d} modeLabel={modeLabel} />
        <SurgeCard modeLabel={modeLabel} />
      </div>

      {/* ═══════════ SURFACE WIND FIELD ═══════════ */}
      <WindCard bundle={bundle} modeLabel={modeLabel} />

      {/* ═══════════ PROVENANCE ═══════════ */}
      <div className="tf-provenance">
        <div className="tf-prov__header">
          <span className="tf-prov__title">HAZARD PROVENANCE</span>
        </div>
        <div className="tf-prov__grid">
          <div className="tf-prov__item">
            <span className="tf-prov__label">MODE</span>
            <span className="tf-prov__value">{modeLabel}</span>
          </div>
          <div className="tf-prov__item">
            <span className="tf-prov__label">RAINFALL</span>
            <span className="tf-prov__value">{bundle.rainfall.modelName || "\u2014"}</span>
          </div>
          <div className="tf-prov__item">
            <span className="tf-prov__label">FLOOD</span>
            <span className="tf-prov__value">{bundle.flood.modelName || "\u2014"}</span>
          </div>
          <div className="tf-prov__item">
            <span className="tf-prov__label">LANDSLIDE</span>
            <span className="tf-prov__value">
              {bundle.landslide.staticSusceptibility?.classification ?? "\u2014"}
            </span>
          </div>
          <div className="tf-prov__item">
            <span className="tf-prov__label">WIND</span>
            <span className="tf-prov__value">{bundle.wind.modelName || "\u2014"}</span>
          </div>
          <div className="tf-prov__item">
            <span className="tf-prov__label">HORIZON</span>
            <span className="tf-prov__value">
              {bundle.trajectory.forecastHorizonHours != null
                ? `+${bundle.trajectory.forecastHorizonHours}H`
                : "\u2014"}
            </span>
          </div>
          <div className="tf-prov__item">
            <span className="tf-prov__label">VALID</span>
            <span className="tf-prov__value">{fmtIST(bundle.generatedAt)}</span>
          </div>
        </div>
      </div>

      {/* ═══════════ DISTRICT DETAIL DRAWER ═══════════ */}
      {selected ? (
        <DistrictDrawer district={selected} modeLabel={modeLabel} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Derived exposure model
// ──────────────────────────────────────────────────────────────────────────

interface DistrictRisk {
  key: string;
  district: DistrictPoint;
  severity: HazardSeverity;
}

interface HazardsDerived {
  points: MissionBundle["trajectory"]["points"];
  observed: {
    lat: number;
    lon: number;
    timestamp: string;
    windKt?: number;
    uncertaintyKm?: number;
    horizonHours?: number;
  }[];
  rainAvailable: boolean;
  rainPeak: number | undefined;
  rainPeakWindow: { window: string; regions: RadialRain[] } | undefined;
  floodAvailable: boolean;
  floodDistricts: NonNullable<MissionBundle["flood"]["districts"]>;
  floodOverall: HazardSeverity | undefined;
  slideRegions: { name: string; level: HazardSeverity; lat: number; lon: number }[];
  slideWorst: HazardSeverity | undefined;
  allDistricts: DistrictPoint[];
  districtRows: DistrictRisk[];
  topExposed: DistrictRisk[];
  coordIndex: Map<string, { lat: number; lon: number }>;
}

function deriveHazards(bundle: MissionBundle | null): HazardsDerived {
  const empty: HazardsDerived = {
    points: [],
    observed: [],
    rainAvailable: false,
    rainPeak: undefined,
    rainPeakWindow: undefined,
    floodAvailable: false,
    floodDistricts: [],
    floodOverall: undefined,
    slideRegions: [],
    slideWorst: undefined,
    allDistricts: [],
    districtRows: [],
    topExposed: [],
    coordIndex: new Map(),
  };
  if (!bundle) return empty;

  const points = bundle.trajectory.points ?? [];
  const observed = points
    .filter((p) => !p.isForecast)
    .map((p) => ({
      lat: p.latitude,
      lon: p.longitude,
      timestamp: p.timestamp,
      windKt: p.windKt,
      uncertaintyKm: p.uncertaintyKm,
      horizonHours: p.horizonHours,
    }));

  const statusOk = (s?: { status: string }): boolean =>
    s?.status === "AVAILABLE" || s?.status === "LIVE" || s?.status === "BASELINE";

  const windows = bundle.rainfall.accumulations ?? [];
  let rainPeak: number | undefined;
  let rainPeakWindow: { window: string; regions: RadialRain[] } | undefined;
  for (const w of windows) {
    for (const r of w.regions ?? []) {
      if (r.expectedMm != null && (rainPeak == null || r.expectedMm > rainPeak)) {
        rainPeak = r.expectedMm;
        rainPeakWindow = w;
      }
    }
  }

  const floodDistricts = bundle.flood.districts ?? [];
  const susRegions = bundle.landslide.staticSusceptibility?.regions ?? [];
  const slideRegions: { name: string; level: HazardSeverity; lat: number; lon: number }[] = [];
  susRegions.forEach((r) => {
    if (r.lat != null && r.lon != null) {
      slideRegions.push({ name: r.name, level: r.level, lat: r.lat, lon: r.lon });
    }
  });
  const slideWorst = worstSeverity(slideRegions.map((r) => r.level));

  const allDistricts = bundle.districts ?? [];
  const coordIndex = new Map<string, { lat: number; lon: number }>();
  allDistricts.forEach((p) =>
    coordIndex.set(`${p.state}::${p.district}`, { lat: p.lat, lon: p.lon })
  );

  const districtRows: DistrictRisk[] = allDistricts
    .map((p) => {
      const severity = worstSeverity((p.values ?? []).map((v) => v.risk));
      return severity ? { key: `${p.state}::${p.district}`, district: p, severity } : null;
    })
    .filter((x): x is DistrictRisk => x !== null)
    .sort((a, b) => sevRank(b.severity) - sevRank(a.severity));

  const topExposed = districtRows.slice(0, 6);

  return {
    points,
    observed,
    rainAvailable: statusOk(bundle.rainfall.status),
    rainPeak,
    rainPeakWindow,
    floodAvailable: statusOk(bundle.flood.status),
    floodDistricts,
    floodOverall: bundle.flood.overallRisk,
    slideRegions,
    slideWorst,
    allDistricts,
    districtRows,
    topExposed,
    coordIndex,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Severity legend overlay for the impact map
// ──────────────────────────────────────────────────────────────────────────

const SEV_CHIPS: { key: string; label: string; color: string }[] = [
  { key: "LOW", label: "LOW", color: "#4ea8ff" },
  { key: "MODERATE", label: "MOD", color: "#f0b429" },
  { key: "HIGH", label: "HIGH", color: "#ee8131" },
  { key: "VERY_HIGH", label: "VH", color: "#e5533c" },
  { key: "EXTREME", label: "EXT", color: "#d9303c" },
];

function ImpactLegend() {
  return (
    <div className="hz-legend" role="img" aria-label="Impact map legend">
      <span className="hz-legend__title">IMPACT SEVERITY</span>
      <div className="hz-legend__chips">
        {SEV_CHIPS.map((c) => (
          <span key={c.key} className="hz-legend__chip" style={{ background: c.color }} title={c.key}>
            {c.label}
          </span>
        ))}
      </div>
      <div className="hz-legend__row">
        <span className="hz-legend__ring" aria-hidden="true" />
        <span>Forecast rainfall bands</span>
      </div>
      <div className="hz-legend__row">
        <span className="hz-legend__dot" aria-hidden="true" />
        <span>District / region exposure</span>
      </div>
      <div className="hz-legend__row">
        <span className="hz-legend__line" aria-hidden="true" />
        <span>Track &amp; intensity corridor</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hazard outlook cards
// ──────────────────────────────────────────────────────────────────────────

function RainfallCard({
  bundle,
  d,
  modeLabel,
}: {
  bundle: MissionBundle;
  d: HazardsDerived;
  modeLabel: string;
}) {
  const avail = d.rainAvailable && d.rainPeak != null;
  const top = bundle.rainfall.districtRanking?.[0];
  return (
    <div className={`m-card m-impact-card ${avail ? "" : "m-impact-card--unavail"}`}>
      <div className="m-card__top">
        <span className="m-card__kicker">RAINFALL FORECAST</span>
        <span className="mono muted xsmall">
          {top ? `${top.district} \u00B7 ${top.expectedMm ?? "\u2014"} mm` : "PEAK EXPOSURE"}
        </span>
      </div>
      {avail ? (
        <>
          <div className="m-impact-value">
            {d.rainPeak}
            <span className="m-impact-value__unit">MM / 24H PEAK</span>
          </div>
          {d.rainPeakWindow ? (
            <div className="m-impact-values">
              <div className="m-impact-row">
                <span>PEAK WINDOW</span>
                <b>{d.rainPeakWindow.window}</b>
              </div>
              <div className="m-impact-row">
                <span>BANDS</span>
                <b>{d.rainPeakWindow.regions.map((r) => `${r.radiusKm} km`).join(" \u00B7 ")}</b>
              </div>
              <div className="m-impact-row">
                <span>MODEL</span>
                <b className="mono">{bundle.rainfall.modelName}</b>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <UnavailableBlock reason="RAINFALL MODEL \u2014 UNAVAILABLE" />
      )}
      <p className="m-panel__note">
        Bands are derived from real radiusKm values around the storm position. {modeLabel}.
      </p>
    </div>
  );
}

function FloodCard({
  bundle,
  d,
  modeLabel,
}: {
  bundle: MissionBundle;
  d: HazardsDerived;
  modeLabel: string;
}) {
  const avail = d.floodAvailable && d.floodDistricts.length > 0;
  const top = d.floodDistricts[0];
  return (
    <div className={`m-card m-impact-card ${avail ? "" : "m-impact-card--unavail"}`}>
      <div className="m-card__top">
        <span className="m-card__kicker">FLOOD RISK</span>
        <span className="mono muted xsmall">{modeLabel}</span>
      </div>
      {avail ? (
        <>
          <div className="m-impact-value">
            <span className="m-impact-value__row">
              {d.floodOverall ? (
                <RiskPill severity={d.floodOverall} />
              ) : (
                <span className="m-risk m-risk--none">\u2014</span>
              )}
            </span>
          </div>
          <div className="m-impact-values">
            <div className="m-impact-row">
              <span>DISTRICTS</span>
              <b>{d.floodDistricts.length}</b>
            </div>
            <div className="m-impact-row">
              <span>HIGHEST</span>
              <b>{top ? top.district : "\u2014"}</b>
            </div>
            <div className="m-impact-row">
              <span>MODEL</span>
              <b className="mono">{bundle.flood.modelName}</b>
            </div>
          </div>
        </>
      ) : (
        <UnavailableBlock reason="FLOOD MODEL \u2014 UNAVAILABLE" />
      )}
      <p className="m-panel__note">
        District exposure is placed at administrative reference points. {modeLabel}.
      </p>
    </div>
  );
}

function LandslideCard({
  bundle,
  d,
  modeLabel,
}: {
  bundle: MissionBundle;
  d: HazardsDerived;
  modeLabel: string;
}) {
  const sus = bundle.landslide.staticSusceptibility;
  const avail = d.slideRegions.length > 0;
  return (
    <div className={`m-card m-impact-card ${avail ? "" : "m-impact-card--unavail"}`}>
      <div className="m-card__top">
        <span className="m-card__kicker">LANDSLIDE RISK</span>
        <span className="mono muted xsmall">{modeLabel}</span>
      </div>
      {avail ? (
        <>
          <div className="m-impact-value">
            <span className="m-impact-value__row">
              {d.slideWorst ? (
                <RiskPill severity={d.slideWorst} />
              ) : (
                <span className="m-risk m-risk--none">\u2014</span>
              )}
            </span>
          </div>
          <div className="m-impact-values">
            <div className="m-impact-row">
              <span>REGIONS</span>
              <b>{d.slideRegions.length}</b>
            </div>
            <div className="m-impact-row">
              <span>SCENARIO</span>
              <b>{d.slideRegions.slice(0, 2).map((r) => r.name).join(" \u00B7 ")}</b>
            </div>
            <div className="m-impact-row">
              <span>CLASS</span>
              <b className="mono">{sus?.classification ?? "\u2014"}</b>
            </div>
          </div>
        </>
      ) : (
        <UnavailableBlock reason="LANDSLIDE MODEL \u2014 UNAVAILABLE" />
      )}
      <p className="m-panel__note">
        {sus?.description || "Susceptibility regions along the track corridor."}
      </p>
    </div>
  );
}

function SurgeCard({ modeLabel }: { modeLabel: string }) {
  return (
    <div className="m-card m-impact-card m-impact-card--unavail">
      <div className="m-card__top">
        <span className="m-card__kicker">STORM SURGE</span>
        <span className="mono muted xsmall">{modeLabel}</span>
      </div>
      <div className="m-impact-unavail">
        <span className="m-impact-unavail__title">SURGE MODEL \u2014 UNAVAILABLE</span>
        <span className="m-impact-unavail__note">
          No storm surge model is present in this build. Coastal inundation is not estimated.
        </span>
      </div>
    </div>
  );
}

// ── Surface wind field (real module output preserved) ──
function WindCard({ bundle, modeLabel }: { bundle: MissionBundle; modeLabel: string }) {
  const zones = bundle.wind.zones ?? [];
  const runtimeRequired = bundle.wind.status.status === "RUNTIME_REQUIRED";
  return (
    <div className="tf-card hz-wind">
      <div className="hz-wind__head">
        <span className="tf-card__label">SURFACE WIND FIELD</span>
        <span className="hz-wind__model mono muted">{bundle.wind.modelName}</span>
        <StatusBadge status={modeLabel} />
      </div>
      {zones.length > 0 ? (
        <div className="hz-wind__zones">
          {zones.map((z) => (
            <div key={z.name} className="hz-wind__zone">
              <span className="tf-card__row-label">{z.name}</span>
              <span className="hz-wind__zone-val mono">
                {z.maxKt != null ? `${z.maxKt} kt` : "\u2014"}
                {z.radiusKm != null ? ` \u00B7 r ${z.radiusKm} km` : ""}
              </span>
              <RiskPill severity={z.risk} />
            </div>
          ))}
        </div>
      ) : runtimeRequired ? (
        <EmptyState
          big="RUNTIME REQUIRED"
          message="TensorFlow is required to execute the wind model (.keras)."
        />
      ) : (
        <EmptyState
          big="WIND FORECAST UNAVAILABLE"
          message={bundle.wind.message ?? "No wind forecast data."}
        />
      )}
    </div>
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

// ──────────────────────────────────────────────────────────────────────────
// District detail drawer (slide-over, not page navigation)
// ──────────────────────────────────────────────────────────────────────────

function DistrictDrawer({
  district,
  modeLabel,
  onClose,
}: {
  district: DistrictPoint;
  modeLabel: string;
  onClose: () => void;
}) {
  const values = district.values ?? [];
  return (
    <>
      <div className="hz-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="hz-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${district.district} impact details`}
      >
        <div className="hz-drawer__head">
          <div>
            <div className="hz-drawer__kicker">DISTRICT IMPACT</div>
            <div className="hz-drawer__title">{district.district}</div>
            <div className="hz-drawer__state">{district.state}</div>
          </div>
          <button className="hz-drawer__close" onClick={onClose} aria-label="Close details">
            &times;
          </button>
        </div>
        <div className="hz-drawer__body">
          <div className="hz-drawer__coord mono">
            {Math.abs(district.lat).toFixed(2)}\u00b0{district.lat >= 0 ? "N" : "S"} &nbsp;
            {Math.abs(district.lon).toFixed(2)}\u00b0{district.lon >= 0 ? "E" : "W"}
          </div>
          <div className="hz-drawer__prov">
            <span className="hz-drawer__prov-label">PROVENANCE</span>
            <span className="hz-drawer__prov-val">{district.provenance ?? modeLabel}</span>
          </div>

          {values.length > 0 ? (
            <div className="hz-drawer__values">
              {values.map((v, i) => (
                <div key={`${v.label}-${i}`} className="hz-drawer__value">
                  <div className="hz-drawer__value-text">
                    <span className="hz-drawer__value-label">{v.label}</span>
                    <span className="hz-drawer__value-val mono">{v.value}</span>
                  </div>
                  <RiskPill severity={v.risk} />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">No break-down hazard values in the current feed.</p>
          )}

          <p className="hz-drawer__note">
            Reference marker placed from the administrative data layer. Risk values are labelled by
            provenance and never invented.
          </p>
        </div>
      </aside>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ──────────────────────────────────────────────────────────────────────────

/** Convert a real radiusKm figure into a closed lon/lat ring around a centre. */
function ringPolygon(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  segments = 64
): [number, number][] {
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.max(0.3, Math.cos((centerLat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    const dLat = (radiusKm / kmPerDegLat) * Math.sin(a);
    const dLon = (radiusKm / kmPerDegLon) * Math.cos(a);
    ring.push([centerLon + dLon, centerLat + dLat]);
  }
  return ring;
}