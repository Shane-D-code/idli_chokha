import { useMemo, useState, type Ref } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Tornado, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpsGlobe, type OpsGlobeHandle } from "./OpsGlobe";
import type { GlobeDisturbanceData, GlobeStormData } from "@/components/mission/globe/GlobeScene";
import type { CycloneState, GenesisReport, TrajectoryForecast } from "@/types";

export interface HeroAnalysisRow {
  label: string;
  value: string;
}

interface Props {
  cyclone: CycloneState | null;
  trajectory: TrajectoryForecast | null;
  genesis: GenesisReport | null;
  analysis?: HeroAnalysisRow[];
  globeRef?: Ref<OpsGlobeHandle>;
}

type TabKey = "live" | "forecast" | "analysis";

const TABS: { key: TabKey; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "forecast", label: "Forecast" },
  { key: "analysis", label: "Analysis" },
];

function KV({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-[6px]",
        !last && "border-b border-[#1b4058]/60"
      )}
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">{label}</span>
      <span className="text-right font-mono text-[13px] font-bold text-white">{value}</span>
    </div>
  );
}

export function OpsHero({ cyclone, trajectory, genesis, analysis, globeRef }: Props) {
  const [tab, setTab] = useState<TabKey>("live");

  const storm = useMemo<GlobeStormData>(() => {
    const c = cyclone;
    return {
      lat: c?.latitude ?? 14.82,
      lon: c?.longitude ?? 86.31,
      name: c?.name,
      id: c?.id,
      category: c?.category,
      windKt: c?.windKt,
      mslpHpa: c?.mslpHpa,
      basin: c?.basin,
      movement: c?.movement,
      probability24h: 1,
    };
  }, [cyclone]);

  const disturbances = useMemo<GlobeDisturbanceData[]>(
    () =>
      (genesis?.riskZones ?? []).map((z) => ({
        lat: z.lat,
        lon: z.lon,
        label: z.label ?? "DEVELOPING SYSTEM",
        probability24h: z.probability24h ?? 0,
        risk: z.risk,
      })),
    [genesis]
  );

  const c = cyclone;
  const windKph = c?.windKt != null ? Math.round(c.windKt * 1.852) : undefined;
  const position =
    c != null ? `${c.latitude.toFixed(2)}°N ${c.longitude.toFixed(2)}°E` : "—";
  const movement = c?.movement
    ? `${c.movement.direction ?? "—"}${c.movement.speedKph != null ? ` · ${c.movement.speedKph} km/h` : ""}`
    : "—";

  const activeSystems = disturbances.length + 1;
  const developing = disturbances.filter((d) => (d.probability24h ?? 0) >= 0.15).length;

  const forecastPoints = useMemo(
    () =>
      (trajectory?.points ?? []).filter((p) => p.isForecast && p.horizonHours % 6 === 0).slice(0, 5),
    [trajectory]
  );

  const stats: { value: number; label: string; color: string }[] = [
    { value: activeSystems, label: "Active Systems", color: "text-white" },
    { value: developing, label: "Developing", color: "text-orange-400" },
    { value: 0, label: "Landfall Risk", color: "text-green-500" },
  ];

  return (
    <section className="rounded-xl border border-[#1b4058] bg-[#0d3044] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="relative overflow-hidden rounded-[11px] bg-[#06131f]">
        {/* ── Two-column layout: LEFT 60% · RIGHT 40% ── */}
        <div className="grid gap-0 p-6 lg:h-[400px] lg:grid-cols-[3fr_2fr] lg:gap-6">
          {/* ── LEFT COLUMN ── */}
          <div className="relative z-30 flex flex-col">
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#35cfe3]">
              Tropical Cyclone Intelligence
            </p>
            <p className="mt-2 text-[12px] font-semibold uppercase tracking-[0.22em] text-gray-400">
              Observe <span className="text-slate-600">→</span> Predict{" "}
              <span className="text-slate-600">→</span> Protect
            </p>
            <h1 className="mt-3 line-clamp-2 max-w-[560px] text-[28px] font-extrabold leading-[1.05] tracking-tight text-white sm:text-[32px]">
              Predicting the Storm Before It Strikes.
            </h1>
            <p className="mt-2.5 line-clamp-2 max-w-[470px] text-[14px] leading-snug text-slate-400">
              Satellite imagery, reanalysis and ML forecast models fused into one live picture of the
              North Indian Ocean.
            </p>

            <Link
              to="/live"
              className="mt-4 inline-flex w-max items-center gap-2 rounded-full bg-[#26a3bd] px-5 py-2 text-[13px] font-bold text-black shadow-[0_0_18px_rgba(53,207,227,0.35)] transition-colors hover:bg-[#53e6f2]"
            >
              View Live Systems <ArrowRight size={15} strokeWidth={2.5} />
            </Link>

            {/* Stat row — vertical stacks, never inline */}
            <div className="mt-5 flex items-start gap-8">
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col items-start">
                  <span className={cn("text-[28px] font-black leading-none", s.color)}>{s.value}</span>
                  <span className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT COLUMN — floating cyclone stat card ── */}
          <div className="relative z-30 mt-2 flex lg:mt-0 lg:items-start lg:justify-end">
            <div className="w-full rounded-xl border border-[#1b4058] bg-[#0a2435] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)] lg:w-[320px]">
              {/* Header */}
              <div className="flex items-center gap-2.5 border-b border-[#1b4058] pb-2.5">
                <Tornado size={20} className="shrink-0 text-[#35cfe3]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-[16px] font-bold text-white">Cyclone VARUN</h2>
                    <span className="ops-badge shrink-0 bg-bad-matte/15 text-bad-matte-text">Cat 2</span>
                  </div>
                  <p className="truncate text-[12px] text-gray-400">Severe Cyclonic Storm</p>
                </div>
              </div>

              {/* Tabs */}
              <div role="tablist" className="flex gap-1 border-b border-[#1b4058] px-0.5 pt-1">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "relative rounded-t-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors",
                      tab === t.key
                        ? "text-[#35cfe3] after:absolute after:inset-x-1.5 after:bottom-[-1px] after:h-[2px] after:rounded-full after:bg-[#26a3bd]"
                        : "text-slate-500 hover:text-slate-300"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Key-value list */}
              <div className="py-1.5">
                {tab === "live" && (
                  <>
                    <KV label="Position" value={position} />
                    <KV label="Pressure" value={c?.mslpHpa != null ? `${c.mslpHpa} hPa` : "—"} />
                    <KV
                      label="Max Wind"
                      value={windKph != null ? `${windKph} km/h · ${c?.windKt} kt` : "—"}
                    />
                    <KV label="Movement" value={movement} />
                    <KV label="Last Updated" value={c?.timestamp ? c.timestamp.slice(11, 19) + " UTC" : "—"} last />
                  </>
                )}

                {tab === "forecast" && (
                  <>
                    {trajectory ? (
                      <>
                        <KV label="Model" value={trajectory.model ?? "—"} />
                        <KV label="Horizon" value={`${trajectory.forecastHorizonHours ?? "—"}h · ${trajectory.predictionSteps ?? "—"} steps`} />
                        {forecastPoints.map((p) => (
                          <KV
                            key={p.horizonHours}
                            label={`+${p.horizonHours}h`}
                            value={`${p.latitude.toFixed(2)}N ${p.longitude.toFixed(2)}E${p.windKt != null ? ` · ${p.windKt} kt` : ""}`}
                          />
                        ))}
                        <KV
                          label="Cone"
                          value={forecastPoints[forecastPoints.length - 1]?.uncertaintyKm != null ? `± ${forecastPoints[forecastPoints.length - 1].uncertaintyKm} km` : "—"}
                          last
                        />
                      </>
                      ) : (
                        <>
                          <p className="py-3 text-[12px] text-slate-500">Forecast track unavailable.</p>
                          {trajectory && (trajectory as any).status && (trajectory as any).status.message ? (
                            <p className="small muted">Reason: {(trajectory as any).status.message}</p>
                          ) : null}
                        </>
                      )}
                  </>
                )}

                {tab === "analysis" && (
                  <>
                    {(analysis ?? []).map((row, i) => (
                      <KV key={row.label} label={row.label} value={row.value || "—"} last={i === (analysis?.length ?? 1) - 1} />
                    ))}
                  </>
                )}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 pt-1.5">
                <Link
                  to="/track"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#26a3bd] text-[13px] font-bold text-black transition-colors hover:bg-[#53e6f2]"
                >
                  View Details
                </Link>
                <Link
                  to="/reports"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-500/50 text-[13px] font-bold text-red-400 transition-colors hover:bg-red-500/10"
                >
                  Generate Report
                </Link>
              </div>

              {/* Other active systems */}
              <div className="mt-3 border-t border-[#1b4058] pt-2.5">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">
                  Other Active Systems
                </p>
                {disturbances.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {disturbances.slice(0, 2).map((d) => {
                      const pct = Math.round((d.probability24h ?? 0) * 100);
                      const watch = (d.probability24h ?? 0) >= 0.15;
                      return (
                        <li
                          key={d.label + d.lat}
                          className="flex items-center justify-between gap-2 rounded-lg border border-[#1b4058] bg-[#0d3044] px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Zap size={15} className="shrink-0 text-blue-400" />
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-semibold text-slate-200">{d.label}</p>
                              <p className="font-mono text-[10px] text-slate-500">{pct}% probability</p>
                            </div>
                          </div>
<span
                            className={cn(
                              "ops-badge",
                              watch ? "bg-warn-matte/15 text-warn-matte-text" : "bg-ok-matte/15 text-ok-matte-text"
                            )}
                          >
                            {watch ? "Watch" : "Low"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[11.5px] text-slate-500">No developing systems monitored.</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Rotating 3D globe — behind the left column, cropped by the card edge ── */}
          <div className="ops-hero-globe relative z-0 -mt-8 h-[280px] rounded-xl lg:absolute lg:inset-y-0 lg:left-0 lg:right-[34%] lg:-mt-0 lg:h-auto lg:rounded-none">
            <OpsGlobe ref={globeRef} storm={storm} trajectory={trajectory} disturbances={disturbances} />
          </div>
        </div>
      </div>
    </section>
  );
}