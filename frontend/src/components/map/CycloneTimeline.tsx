/**
 * CycloneTimeline — compact timeline with play/pause, step, and rail scrub.
 *
 * Displays forecast points along a horizontal rail with filled progress,
 * play/pause button, and previous/next frame buttons.
 */

import { SkipBack, SkipForward, Play, Pause } from "lucide-react";

export interface TimelinePoint {
  horizonHours: number;
  timestamp?: string;
  latitude?: number;
  longitude?: number;
}

export interface CycloneTimelineProps {
  points: TimelinePoint[];
  currentIndex: number;
  playing: boolean;
  onIndexChange: (idx: number) => void;
  onPlayToggle: () => void;
  onStep: (direction: -1 | 1) => void;
  /** Label shown for the current frame position. */
  currentLabel?: string;
}

export function CycloneTimeline({
  points,
  currentIndex,
  playing,
  onIndexChange,
  onPlayToggle,
  onStep,
  currentLabel,
}: CycloneTimelineProps) {
  const pct = points.length > 1 ? (currentIndex / (points.length - 1)) * 100 : 0;

  return (
    <div className="cv-timeline">
      <div className="cv-timeline-rail">
        <div className="cv-timeline-track" />
        <div className="cv-timeline-track filled" style={{ width: `${pct}%` }} />
        {points.map((p, i) => (
          <button
            key={i}
            className={`cv-timeline-tick ${i === currentIndex ? "active" : ""} ${i < currentIndex ? "past" : ""}`}
            style={{ left: `${(i / Math.max(1, points.length - 1)) * 100}%` }}
            onClick={() => onIndexChange(i)}
            title={`${p.horizonHours > 0 ? `+${p.horizonHours}h` : "NOW"}`}
          >
            <span className="cv-tl-dot" />
            <span className="cv-tl-label">{p.horizonHours > 0 ? `+${p.horizonHours}h` : "NOW"}</span>
          </button>
        ))}
      </div>

      <div className="cv-timeline-controls">
        <button
          className="cv-tl-btn"
          onClick={() => onStep(-1)}
          disabled={currentIndex <= 0}
          aria-label="Previous forecast step"
        >
          <SkipBack size={14} />
        </button>

        <button
          className="cv-tl-btn play"
          onClick={onPlayToggle}
          aria-label={playing ? "Pause playback" : "Play forecast timeline"}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          <span>{playing ? "PAUSE" : "PLAY"}</span>
        </button>

        <button
          className="cv-tl-btn"
          onClick={() => onStep(1)}
          disabled={currentIndex >= points.length - 1}
          aria-label="Next forecast step"
        >
          <SkipForward size={14} />
        </button>

        {currentLabel && (
          <span className="cv-timeline-label">{currentLabel}</span>
        )}
      </div>
    </div>
  );
}
