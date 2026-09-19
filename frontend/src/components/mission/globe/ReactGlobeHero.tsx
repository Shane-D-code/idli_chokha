import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useMemo } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { getCloudTextureCanvas } from "./cloudTexture";
import {
  CYCLONE_GLOW_SIZE_FACTOR,
  ensureCycloneSpinStyle,
  getCycloneMarkerElement,
} from "./cycloneMarker";
import type { MissionBundle } from "@/types/mission";
import { intensityClassInfo, intensityRampColor } from "@/utils/intensity";

// ── Label card spacing ───────────────────────────────────────────────────
const CARD_MIN_GLOW_GAP = 24; // px kept between glow and card

// Cloud shell sits at this globe-radius fraction above the surface.
const CLOUD_RADIUS_FRACTION = 1.0015;

interface Props {
  layers: {
    satellite: boolean;
    wind: boolean;
    rainfall: boolean;
    cone: boolean;
    track: boolean;
    cities: boolean;
  };
  bundle?: MissionBundle;
}

/**
 * Handle the story section drives on the mission globe: ease the camera to a
 * per-chapter view and pause/resume the render loop while the canvas is
 * covered by the narrative panel.
 */
export interface MissionGlobeHandle {
  focus(lat: number, lon: number, distance?: number, animate?: boolean): void;
  setPaused(paused: boolean): void;
}

// ── Icon sizing (intensity-driven) ───────────────────────────────────────
// Superlinear curve: fully-organised systems (TC MOCHA ~115px) reach the
// visual weight of the adjacent label cards, while weak invests stay
// subordinate (~60-65px) instead of ballooning linearly with wind.
const ICON_BASE_SIZE = 54;
const ICON_SCALE_RANGE = 68;
const ICON_MAX_EXPECTED_KT = 100;
const ICON_SIZE_EXP = 1.45;

function iconDiameterFor(windKt: number): number {
  const kt = Math.max(0, Math.min(windKt ?? 0, ICON_MAX_EXPECTED_KT));
  const t = Math.pow(kt / ICON_MAX_EXPECTED_KT, ICON_SIZE_EXP);
  return Math.round(ICON_BASE_SIZE + t * ICON_SCALE_RANGE);
}

// ── Region labels (static water-body geography, not storm data) ─────────
const REGION_LABELS = [
  { lat: 16, lng: 65, text: "Arabian Sea" },
  { lat: 15, lng: 90, text: "Bay of Bengal" },
  { lat: 2, lng: 75, text: "Indian Ocean" },
];

type HtmlDatum =
  | { kind: "region"; lat: number; lng: number; text: string }
  | {
      kind: "cyclone";
      lat: number;
      lng: number;
      label: string;
      sub: string;
      accent: string;
      windKt: number;
      variant: "mocha" | "loose";
      organization?: number;
      spinMs: number;
    };

export const ReactGlobeHero = forwardRef<MissionGlobeHandle, Props>(function ReactGlobeHero(
  { layers, bundle },
  ref,
) {
  const globeEl = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const cloudMeshRef = useRef<THREE.Mesh | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const [dimensions, setDimensions] = useState({ width: 900, height: 700 });

  ensureCycloneSpinStyle();

  useImperativeHandle(ref, () => ({
    focus(lat, lon, distance = 1.55, animate = true) {
      const globe = globeEl.current;
      if (!globe) return;
      // A paused loop cannot animate the transition, so resume first; the
      // scroll geometry re-pauses it again while covered.
      globe.resumeAnimation();
      globe.pointOfView({ lat, lng: lon, altitude: distance }, reducedMotion || !animate ? 0 : 1200);
    },
    setPaused(paused) {
      const globe = globeEl.current;
      if (!globe) return;
      if (paused) globe.pauseAnimation();
      else globe.resumeAnimation();
    },
  }), [reducedMotion]);

  // Measure container dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      setDimensions({
        width: el.clientWidth || 900,
        height: el.clientHeight || 700,
      });
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── HTML markers (cyclone + region labels) ─────────────────────────────
  const htmlData = useMemo(() => {
    const out: HtmlDatum[] = [
      ...REGION_LABELS.map((r) => ({ kind: "region" as const, ...r })),
    ];

    const cyc = bundle?.cyclone;
    if (cyc) {
      const windKt = cyc.windKt ?? 0;
      const info = intensityClassInfo(windKt);
      const accent = intensityRampColor(windKt);
      const label = `TC ${[cyc.name, cyc.id].filter(Boolean).join(" · ")}`;
      const subBits = [
        info?.shortLabel ?? cyc.category ?? "CYCLONE",
        windKt ? `${windKt} KT` : null,
        cyc.mslpHpa ? `${cyc.mslpHpa} HPA` : null,
        bundle?.mode === "demo" ? "SIMULATED" : null,
      ].filter(Boolean) as string[];
      out.push({
        kind: "cyclone",
        lat: cyc.latitude,
        lng: cyc.longitude,
        label,
        sub: subBits.join(" · "),
        accent,
        windKt,
        variant: windKt >= 64 ? "mocha" : "loose",
        organization: Math.min(1, Math.max(0.4, windKt / 90)),
        spinMs: 38000,
      });
    }

    // Cyclone marker + region labels (track overlay is disabled for now).
    return out;
  }, [bundle, layers.track]);

  // Configure Globe camera, controls, and cloud layer
  useEffect(() => {
    const globe = globeEl.current;
    if (!globe) return;

    globe.pointOfView({ lat: 15, lng: 85, altitude: 1.55 }, 0);

    const controls = globe.controls();
    if (controls) {
      controls.autoRotate = false;
      controls.enableZoom = false;
    }

    const scene = globe.scene();
    const globeRadius = globe.getGlobeRadius();

    let cloudMesh: THREE.Mesh | null = null;
    let animId = 0;

    try {
      const cloudTexture = new THREE.CanvasTexture(getCloudTextureCanvas());
      const cloudGeo = new THREE.SphereGeometry(globeRadius * CLOUD_RADIUS_FRACTION, 75, 75);
      const cloudMat = new THREE.MeshStandardMaterial({
        map: cloudTexture,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      });

      cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
      cloudMesh.visible = layers.satellite;
      scene.add(cloudMesh);
      cloudMeshRef.current = cloudMesh;

      const rotateClouds = () => {
        if (cloudMesh) cloudMesh.rotation.y += 0.0006;
        animId = requestAnimationFrame(rotateClouds);
      };
      animId = requestAnimationFrame(rotateClouds);
    } catch (e) {
      console.warn("Could not load globe clouds:", e);
    }

    return () => {
      cancelAnimationFrame(animId);
      if (cloudMesh) {
        scene.remove(cloudMesh);
        cloudMesh.geometry.dispose();
        if (Array.isArray(cloudMesh.material)) {
          cloudMesh.material.forEach((m) => m.dispose());
        } else {
          cloudMesh.material.dispose();
        }
      }
      cloudMeshRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cloudMeshRef.current) cloudMeshRef.current.visible = layers.satellite;
  }, [layers.satellite]);

  // DEV-only frame sampler — three's renderer.frame() increments each render,
  // so the story's render-loop pause can be verified from the page: the value
  // freezes while pauseAnimation() holds the loop.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __missionGlobeFrames?: number };
    const sampler = setInterval(() => {
      w.__missionGlobeFrames = globeEl.current?.renderer().info.render.frame ?? w.__missionGlobeFrames ?? 0;
    }, 100);
    return () => clearInterval(sampler);
  }, []);

  const demo = bundle?.mode === "demo";

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <Globe
        ref={globeEl}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="https://unpkg.com/three-globe/example/img/night-sky.png"
        showAtmosphere={true}
        atmosphereColor="#5cc8ff"
        atmosphereAltitude={0.18}
        htmlElementsData={htmlData}
        htmlLat={(d: any) => d.lat}
        htmlLng={(d: any) => d.lng}
        htmlAltitude={(d: any) => {
          if (d.kind === "cyclone") return 0.012;
          return 0.005;
        }}
        htmlElement={(d: any) => buildHtmlElement(d)}
      />

      {/* ── Legend overlay: observed / forecast / cone + IMD intensity ─── */}
      <div className="absolute right-4 bottom-4 z-20 flex flex-col gap-2 select-none pointer-events-none">
        {demo && (
          <div className="self-end text-[10px] font-semibold tracking-[0.18em] uppercase text-amber-300/90 bg-[#0a2435]/85 border border-amber-400/25 rounded px-2 py-1">
            SIMULATED · DEMO DATA
          </div>
        )}
        <div className="bg-[#0a2435]/90 backdrop-blur-md border border-[#1b4058] rounded-lg px-3 py-2.5 w-[212px]">
          <div className="flex flex-col gap-1.5 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-0.5">
                <span className="w-2 h-2 rounded-full bg-[#7fd8f0]" />
                <span className="w-2 h-2 rounded-full bg-[#ffd84d]" />
                <span className="w-2 h-2 rounded-full bg-[#ffa52c]" />
                <span className="w-2 h-2 rounded-full bg-[#ff6b35]" />
                <span className="w-2 h-2 rounded-full bg-[#ef3b3b]" />
                <span className="w-2 h-2 rounded-full bg-[#c4267f]" />
              </span>
              <span className="text-[10px] text-slate-400 tracking-wide uppercase">Track · intensity ramp</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#7fd8f0]" />
              <span className="text-[10px] text-slate-400 tracking-wide uppercase">
                More intense
                <span className="block text-slate-500 normal-case tracking-normal font-normal mt-0.5">
                  {`cyan → yellow → orange → red → magenta`}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-5 h-[3px] rounded-full bg-[#94a3b8]/45" />
              <span className="text-[10px] text-slate-400 tracking-wide uppercase">Uncertainty cone</span>
            </div>
          </div>
          <div className="h-px bg-[#1b4058] mb-2" />
          <span className="text-[9px] text-slate-500 tracking-wide uppercase leading-snug">
            All systems share one broadcast intensity ramp, driven by IMD wind
          </span>
        </div>
      </div>
    </div>
  );
});

// ── HTML element builder (kept separate so the Globe JSX stays readable) ─
function buildHtmlElement(d: HtmlDatum): HTMLElement {
  if (d.kind === "region") {
    const el = document.createElement("div");
    el.style.color = "rgba(255, 255, 255, 0.35)";
    el.style.fontStyle = "italic";
    el.style.fontSize = "12px";
    el.style.fontWeight = "500";
    el.style.letterSpacing = "0.06em";
    el.style.textShadow = "0 1px 6px rgba(0,0,0,0.8)";
    el.style.userSelect = "none";
    el.style.pointerEvents = "none";
    el.style.whiteSpace = "nowrap";
    el.style.transform = "translate(-50%, -50%)";
    el.innerText = d.text;
    return el;
  }

  // cyclone marker — spiral icon (intensity glow) + label card
  const iconSize = iconDiameterFor(d.windKt);
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.pointerEvents = "none";
  wrapper.style.cursor = "pointer";
  wrapper.style.transform = "translate(-50%, -50%)";

  wrapper.appendChild(
    getCycloneMarkerElement(
      { variant: d.variant, glow: d.accent, organization: d.organization },
      { sizePx: iconSize, spinMs: d.spinMs },
    ),
  );

  // Label card sits fully clear of the icon + glow — a fixed gap below the glow.
  const card = document.createElement("div");
  card.style.position = "absolute";
  card.style.top = `${(CYCLONE_GLOW_SIZE_FACTOR / 2) * iconSize + CARD_MIN_GLOW_GAP}px`;
  card.style.left = "50%";
  card.style.transform = "translateX(-50%)";
  card.style.backgroundColor = "#0a2435";
  card.style.border = "1px solid #1b4058";
  card.style.borderRadius = "6px";
  card.style.padding = "5px 9px";
  card.style.boxShadow = "0 8px 24px rgba(0,0,0,0.8)";
  card.style.whiteSpace = "nowrap";
  card.style.textAlign = "center";
  card.style.backdropFilter = "blur(6px)";

  const title = document.createElement("div");
  title.style.color = "#ffffff";
  title.style.fontWeight = "700";
  title.style.fontSize = "12px";
  title.style.lineHeight = "1.2";
  title.innerText = d.label;

  const sub = document.createElement("div");
  sub.style.color = d.accent;
  sub.style.fontWeight = "600";
  sub.style.fontSize = "10px";
  sub.style.lineHeight = "1.2";
  sub.style.marginTop = "2px";
  sub.innerText = d.sub;

  card.appendChild(title);
  card.appendChild(sub);
  wrapper.appendChild(card);

  return wrapper;
}