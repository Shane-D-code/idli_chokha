import { useState } from "react";
import type { Ref } from "react";
import { ChevronDown, Check } from "lucide-react";
import { HeroNav } from "./HeroNav";
import { ReactGlobeHero, type MissionGlobeHandle } from "./globe/ReactGlobeHero";
import type { MissionBundle } from "@/types/mission";

interface Props {
  bundle?: MissionBundle;
  mode?: "demo" | "live";
  refreshing?: boolean;
  onRefresh?: () => void;
  globeRef?: Ref<MissionGlobeHandle>;
}

export interface HeroLayers {
  satellite: boolean;
  wind: boolean;
  rainfall: boolean;
  cone: boolean;
  track: boolean;
  cities: boolean;
}

type LayerKey = keyof HeroLayers;

const CHECKLIST_ITEMS: { key: LayerKey; label: string }[] = [
  { key: "satellite", label: "Satellite (IR)" },
  { key: "wind", label: "Wind Field" },
  { key: "rainfall", label: "Rainfall" },
  { key: "cone", label: "Forecast Cone" },
  { key: "track", label: "Past Track" },
  { key: "cities", label: "City Labels" },
];

export function HeroSection({ bundle, globeRef }: Props) {
  const [layers, setLayers] = useState<HeroLayers>({
    satellite: true,
    wind: true,
    rainfall: false,
    cone: true,
    track: true,
    cities: false,
  });

  const toggleLayer = (key: LayerKey) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    } else {
      window.scrollTo({ top: 700, behavior: "smooth" });
    }
  };

  // Honest headline numbers derived from the bundle — never fabricated.
  const activeSystems = bundle?.cyclone ? 1 : 0;
  const developing = bundle?.genesisAboveThreshold ? 1 : 0;
  const peakWindKt = bundle?.cyclone?.windKt;
  const intensityLabel = peakWindKt != null ? `${peakWindKt} kt` : "—";

  return (
    <section id="top" className="m-hero-surface relative w-full h-screen min-h-[700px] flex flex-col text-white overflow-hidden select-none">
      {/* 1. Top Nav Bar (height ~64px, transparent/dark, bottom border #1b4058) */}
      <HeroNav onNavClick={scrollToSection} />

      {/* Hero content area: large realistic Earth on the right 65%, text overlay on the left 35% */}
      <div className="relative flex-1 w-full overflow-hidden">
        {/* Realistic Earth render, centered slightly (cropped by right/bottom of viewport) */}
        <div className="absolute right-[10%] top-[-4%] bottom-[-2%] w-[72%] lg:right-0 lg:w-[64%] pointer-events-auto z-0">
          <ReactGlobeHero ref={globeRef} layers={layers} bundle={bundle} />
        </div>

        {/* 4. Left text overlay (vertically centered, ~35% width, z-index above globe) */}
        <div className="relative z-20 h-full max-w-[1560px] mx-auto px-6 sm:px-10 lg:px-12 flex items-center pointer-events-none">
          <div className="w-full lg:w-[38%] max-w-[500px] flex flex-col py-6 pointer-events-auto">
            {/* Heading: white, extra-bold, uppercase, 3 lines, ~40px, tight line-height */}
            <h1 className="text-white font-extrabold text-[34px] sm:text-[40px] xl:text-[42px] leading-[1.06] tracking-tight uppercase mb-3.5">
              TROPICAL<br />
              CYCLONE<br />
              INTELLIGENCE
            </h1>

            {/* Small cyan tracked-out row with arrow separators, 13px, bold */}
            <div className="text-[#35cfe3] font-bold text-[13px] tracking-[0.24em] uppercase mb-4 flex items-center gap-2">
              <span>OBSERVE</span>
              <span className="text-[#35cfe3]/80 font-normal">→</span>
              <span>PREDICT</span>
              <span className="text-[#35cfe3]/80 font-normal">→</span>
              <span>PROTECT</span>
            </div>

            {/* Paragraph, gray-300, 14px, ~4 lines */}
            <p className="text-slate-300 text-[14px] leading-relaxed max-w-[420px] mb-7">
              AI-powered early warning system for cyclone genesis, track, intensity and multi-hazard impact in the North Indian Ocean.
            </p>

            {/* Button row (gap-3) */}
            <div className="flex items-center gap-3 mb-9">
              {/* Cyan filled pill button, black bold text, down-arrow icon */}
              <button
                type="button"
                onClick={() => scrollToSection("genesis")}
                className="bg-[#35cfe3] hover:bg-[#53e6f2] text-black font-bold text-[13px] px-5 py-2.5 rounded-full transition-all flex items-center gap-1.5 shadow-lg shadow-cyan-500/20 active:scale-95 cursor-pointer"
              >
                <span>Explore Live System</span>
                <span className="text-black font-bold text-sm leading-none">↓</span>
              </button>

              {/* Outlined button (border #1b4058, transparent bg, white text), play-triangle icon */}
              <button
                type="button"
                onClick={() => scrollToSection("genesis")}
                className="border border-[#1b4058] hover:border-slate-400 bg-transparent text-white font-semibold text-[13px] px-4 py-2.5 rounded-full transition-all flex items-center gap-2 hover:bg-white/5 active:scale-95 cursor-pointer"
              >
                <span className="text-[11px] leading-none">▶</span>
                <span>Watch Demo</span>
              </button>
            </div>

            {/* Stat row: 3 items separated by thin vertical divider lines, each as number (bold, large, ~26px) stacked directly above its label (gray, 11px, uppercase) */}
            <div className="flex items-center gap-7 pt-3 border-t border-[#1b4058]/70 max-w-[390px]">
              <div className="flex flex-col">
                <span className="text-[#35cfe3] font-bold text-[26px] leading-none">{activeSystems}</span>
                <span className="text-slate-400 text-[11px] font-medium tracking-wider uppercase mt-1.5">
                  Active System
                </span>
              </div>
              <div className="w-px h-8 bg-[#1b4058]" />
              <div className="flex flex-col">
                <span className="text-white font-bold text-[26px] leading-none">{developing}</span>
                <span className="text-slate-400 text-[11px] font-medium tracking-wider uppercase mt-1.5">
                  Developing
                </span>
              </div>
              <div className="w-px h-8 bg-[#1b4058]" />
              <div className="flex flex-col">
                <span className="text-[#ff6b35] font-bold text-[26px] leading-none">{intensityLabel}</span>
                <span className="text-slate-400 text-[11px] font-medium tracking-wider uppercase mt-1.5">
                  Peak Wind (model)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 5. Right-side floating control panel (top-right, overlapping the globe, ~220px wide, dark card #0a2435, 1px solid #1b4058, rounded-lg, small padding) */}
        <div className="absolute top-6 right-6 z-30 flex flex-col pointer-events-auto select-none">
          <div className="w-[220px] bg-[#0a2435] border border-[#1b4058] rounded-lg p-3 shadow-2xl backdrop-blur-md">
            <div className="flex flex-col gap-2">
              {CHECKLIST_ITEMS.map((item) => {
                const isChecked = layers[item.key];
                return (
                  <label
                    key={item.key}
                    onClick={() => toggleLayer(item.key)}
                    className="flex items-center gap-2.5 text-[13px] cursor-pointer select-none group"
                  >
                    <span
                      className={`w-4 h-4 rounded flex items-center justify-center transition-colors shrink-0 ${
                        isChecked
                          ? "bg-[#35cfe3] text-black"
                          : "border border-slate-600 group-hover:border-slate-400 bg-transparent"
                      }`}
                    >
                      {isChecked && <Check size={11} strokeWidth={3.5} className="text-black" />}
                    </span>
                    <span
                      className={
                        isChecked
                          ? "text-slate-200 font-medium"
                          : "text-slate-400 group-hover:text-slate-300"
                      }
                    >
                      {item.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* 7. Bottom center hint: small gray text: "Scroll to explore", small down-chevron icon beneath it, subtle bounce animation */}
        <div
          onClick={() => scrollToSection("genesis")}
          className="absolute bottom-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 cursor-pointer select-none z-30 group"
        >
          <span className="text-slate-400 text-[11px] tracking-widest uppercase font-medium group-hover:text-slate-200 transition-colors">
            Scroll to explore
          </span>
          <ChevronDown
            size={15}
            className="text-slate-400 animate-bounce group-hover:text-slate-200 transition-colors"
          />
        </div>
      </div>
    </section>
  );
}