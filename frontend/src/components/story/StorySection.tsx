// StorySection — the scroll-driven storm narrative.
//
// Currently renders Chapter 01 only. Chapters 02–05 are specified but not yet
// built (awaiting review); their data is not in the fixture, so they are NOT
// stubbed — building them against invented numbers is explicitly forbidden.

import { Chapter01 } from "./Chapter01";
import type { StormAnalysis } from "@/types/stories";

export interface StorySectionProps {
  analysis: StormAnalysis;
  onActive?: (index: number) => void;
}

export function StorySection({ analysis, onActive }: StorySectionProps) {
  return (
    <div className="story" id="story-section">
      <div className="story-inner">
        <Chapter01 analysis={analysis} onActive={onActive} />
      </div>
    </div>
  );
}