import { useCallback, useEffect, useRef } from "react";

/**
 * Minimal globe handle the story drives. Both the dashboard globe
 * (OpsGlobeHandle) and the mission hero globe (MissionGlobeHandle) satisfy
 * this structurally.
 */
export interface StoryGlobeHandle {
  focus(lat: number, lon: number, distance?: number, animate?: boolean): void;
  setPaused(paused: boolean): void;
}

/** Per-chapter camera views — lat/lon/distance (globe altitude) to ease to. */
const CHAPTER_VIEWS: { lat: number; lon: number; distance: number }[] = [
  { lat: 16, lon: 87, distance: 1.9 },   // chapter 1: genesis region (Bay of Bengal)
  { lat: 15, lon: 86, distance: 1.7 },   // chapter 2: close-up on intensifying storm
  { lat: 14, lon: 85, distance: 2.2 },   // chapter 3: full cone view
  { lat: 13, lon: 82, distance: 2.0 },   // chapter 4: landfall coast
  { lat: 12, lon: 80, distance: 2.0 },   // chapter 5: affected area
];

const STORY_ID = "story-section";
const HERO_ID = "ops-hero";

/**
 * Wires the active chapter index to the globe's camera (easing to a
 * per-chapter view) and pauses the globe render loop when the story has fully
 * scrolled over the sticky hero canvas. Aura/resume state is measured from
 * geometry — the story's top edge vs the hero's top edge — throttled to the
 * frame budget. Works for both page layouts: the command center (sticky hero
 * under an app header) and the mission landing (full-bleed sticky hero).
 */
export function useStoryGlobe(globeRef: React.RefObject<StoryGlobeHandle | null>) {
  const pausedRef = useRef(false);

  const onActive = useCallback(
    (index: number) => {
      const view = CHAPTER_VIEWS[index];
      if (view) {
        globeRef.current?.focus(view.lat, view.lon, view.distance);
      }
    },
    [globeRef],
  );

  useEffect(() => {
    let raf = 0;
    let boot: ReturnType<typeof setInterval> | undefined;

    const check = () => {
      raf = 0;
      const sentinel = document.getElementById("story-top-sentinel");
      const hero = document.getElementById(HERO_ID);
      const storySection = document.getElementById(STORY_ID);
      if (!sentinel || !hero || !storySection) return;
      const storyTop = storySection.getBoundingClientRect().top;
      const heroTop = hero.getBoundingClientRect().top;
      // The globe is fully hidden behind the opaque story panel once the
      // story's top edge (the curved boundary) has scrolled past the top of
      // the sticky hero. Only then do we stop the render loop — while the
      // globe still peeks above the curve it keeps animating.
      const covered = storyTop <= heroTop;
      if (covered !== pausedRef.current) {
        pausedRef.current = covered;
        globeRef.current?.setPaused(covered);
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };

    check();
    // The fallback hero (mission landing) mounts after async data lands, so
    // the elements above may not exist yet. Keep probing until they do, then
    // re-check once so the pause state is correct without waiting for a scroll.
    boot = setInterval(() => {
      const ready =
        document.getElementById("story-top-sentinel") &&
        document.getElementById(HERO_ID) &&
        document.getElementById(STORY_ID);
      if (ready) {
        clearInterval(boot);
        boot = undefined;
        check();
      }
    }, 150);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (boot) clearInterval(boot);
    };
  }, [globeRef]);

  return { onActive };
}