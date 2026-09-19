import { useEffect, useRef } from "react";
import { useMissionData } from "@/hooks/useMissionData";
import { HeroSection } from "@/components/mission/HeroSection";
import { Reveal } from "@/components/mission/Reveal";
import { MissionSkeleton } from "@/components/mission/Shared";
import type { MissionGlobeHandle } from "@/components/mission/globe/ReactGlobeHero";
import { GenesisSection } from "@/components/mission/genesis/GenesisSection";
import { TrackForecastTheatre } from "@/components/mission/sections/TrackForecastTheatre";
import { SectionImpact } from "@/components/mission/sections/SectionImpact";

export function HomeMission() {
  const { bundle, loading, error, mode, refreshing, refresh } = useMissionData();
  const globeRef = useRef<MissionGlobeHandle | null>(null);

  useEffect(() => {
    document.title = "TOOFAN — Tropical Cyclone Intelligence";
  }, []);

  return (
    <div className="m-mission">
      {loading && !bundle && (
        <div className="m-loading">
          <MissionSkeleton rows={6} height={120} />
        </div>
      )}

      {error && !bundle && (
        <div className="m-loading m-loading--error">
          <h2>MISSION FEED UNAVAILABLE</h2>
          <p>{error}</p>
        </div>
      )}

      {bundle && (
        <>
          <div id="ops-hero" className="cc-hero-sticky cc-hero-sticky--top0">
            <HeroSection bundle={bundle} mode={mode} refreshing={refreshing} onRefresh={() => void refresh()} globeRef={globeRef} />
          </div>

          <main className="m-main">
            {/* ═══ 01 · GENESIS — first intelligence board below the hero ═══ */}
            <GenesisSection bundle={bundle} />

            {/* ═══ 02 · TRACK & INTENSITY FORECAST — second intelligence board ═══ */}
            <Reveal>
              <TrackForecastTheatre bundle={bundle} />
            </Reveal>

            {/* ═══ 03 · FORECAST IMPACT & HAZARD OUTLOOK — downstream consequences ═══ */}
            <Reveal>
              <SectionImpact bundle={bundle} />
            </Reveal>
          </main>
          <footer className="m-footer">
            <div className="m-footer__inner">
              <span className="m-brand-mark" aria-hidden="true">◈</span>
              <span className="mono muted">TOOFAN — TROPICAL CYCLONE INTELLIGENCE · NORTH INDIAN OCEAN</span>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}