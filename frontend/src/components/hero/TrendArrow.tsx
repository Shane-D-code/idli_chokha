/** Small compass-style arrow showing the system's movement direction. */
export function TrendArrow({ bearingDeg, size = 80 }: { bearingDeg: number; size?: number }) {
  const ring = size
  const inner = Math.round(size * 0.8)
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-full border border-ink-200 bg-cloud/50"
      style={{ width: ring, height: ring }}
    >
      <div className="relative font-mono text-[0.55rem] font-semibold text-ink-400" style={{ transform: `rotate(${-bearingDeg}deg)` }}>
        <div className="flex items-center justify-center" style={{ width: inner, height: inner }}>
          <div className="relative" style={{ transform: `rotate(${bearingDeg}deg)` }}>
            <svg width={Math.round(size * 0.42)} height={Math.round(size * 0.42)} viewBox="0 0 24 24" fill="none" className="drop-shadow">
              <path d="M12 2 L16 13 L12 11 L8 13 Z" fill="#e84c4c" />
              <path d="M12 2 L12 13" stroke="#e84c4c" strokeWidth="1.4" />
            </svg>
            <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 font-mono text-[0.55rem] font-bold text-ink-300">N</span>
          </div>
        </div>
      </div>
    </div>
  )
}