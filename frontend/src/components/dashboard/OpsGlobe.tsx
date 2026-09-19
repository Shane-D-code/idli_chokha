import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  GlobeScene,
  type GlobeDisturbanceData,
  type GlobeStormData,
  type GlobeTrackPoint,
} from "@/components/mission/globe/GlobeScene";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { TrajectoryForecast } from "@/types";

export interface OpsGlobeProps {
  storm: GlobeStormData;
  trajectory: TrajectoryForecast | null;
  disturbances: GlobeDisturbanceData[];
}

export interface OpsGlobeHandle {
  focus(lat: number, lon: number, distance?: number, animate?: boolean): void;
  setPaused(paused: boolean): void;
}

function toTrackPoints(traj: TrajectoryForecast | null): GlobeTrackPoint[] {
  if (!traj?.points) return [];
  return traj.points.map((p) => ({
    lat: p.latitude,
    lon: p.longitude,
    horizonHours: p.horizonHours,
    uncertaintyKm: p.uncertaintyKm,
    isForecast: p.isForecast,
    windKt: p.windKt,
    timestamp: p.timestamp,
  }));
}

/**
 * Dashboard hero globe — centered on the Bay of Bengal with the ops
 * (cyan) variant: spiral cyclone markers, invest rings, dotted forecast
 * track and glowing cyan atmosphere. Exposes focus() and setPaused() so the
 * story chapters can ease the camera to per-chapter views and the render
 * loop can suspend when the canvas is covered.
 */
export const OpsGlobe = forwardRef<OpsGlobeHandle, OpsGlobeProps>(
  function OpsGlobe({ storm, trajectory, disturbances }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<GlobeScene | null>(null);
    const reducedMotion = usePrefersReducedMotion();

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      let scene: GlobeScene | null = null;
      try {
        scene = new GlobeScene({
          container: el,
          reducedMotion,
          variant: "ops",
          accent: "#35cfe3",
          focus: { lat: 17, lon: 87, distance: 1.9 },
          onSelect: () => undefined,
        });
        sceneRef.current = scene;
      } catch (e) {
        console.error("WebGL globe unavailable:", e);
      }
      return () => {
        sceneRef.current = null;
        scene?.dispose();
      };
    }, [reducedMotion]);

    useEffect(() => {
      sceneRef.current?.setStorm(storm);
    }, [storm]);

    useEffect(() => {
      sceneRef.current?.setTrack(toTrackPoints(trajectory));
    }, [trajectory]);

    useEffect(() => {
      sceneRef.current?.setDisturbances(disturbances);
    }, [disturbances]);

    useImperativeHandle(ref, () => ({
      focus(lat, lon, distance, animate = true) {
        const scene = sceneRef.current;
        if (!scene) return;
        if (reducedMotion) {
          // Jump, never fly, under prefers-reduced-motion.
          scene.focus(lat, lon, distance, false);
          return;
        }
        // ~1.2s cubic ease; never snap.
        scene.focus(lat, lon, distance, animate, 1200);
      },
      setPaused(paused) {
        sceneRef.current?.setPaused(paused);
      },
    }), [reducedMotion]);

    return <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />;
  },
);