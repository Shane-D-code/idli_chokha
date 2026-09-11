/**
 * ToofanLogo — CSS-only animated spiral cyclone logo.
 *
 * Pure CSS animation (no JS intervals). Respects prefers-reduced-motion.
 * Color palette:
 *   Core:         #111827  (near-black / dark navy)
 *   Inner vortex: #F8F5EA  (warm white)
 *   Outer glow:   #BFEFF2  (pale cyan)
 *   Outline:      #0B2530  (dark navy — cyclone colour)
 */

export interface ToofanLogoProps {
  size?: number;
  className?: string;
}

export function ToofanLogo({ size = 40, className = "" }: ToofanLogoProps) {
  const cx = 24;
  const cy = 24;

  return (
    <div
      className={`toofan-logo ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" width={size} height={size}>
        <defs>
          <radialGradient id="tl-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#BFEFF2" stopOpacity="0.35" />
            <stop offset="70%" stopColor="#BFEFF2" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#BFEFF2" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="tl-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#111827" stopOpacity="1" />
            <stop offset="80%" stopColor="#111827" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#111827" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer halo — pale cyan ambient glow */}
        <circle cx={cx} cy={cy} r="23" fill="url(#tl-halo)" className="tl-halo" />

        {/* Thin outer outline — dark navy cyclone ring */}
        <circle
          cx={cx}
          cy={cy}
          r="20.5"
          fill="none"
          stroke="#0B2530"
          strokeWidth="0.6"
          opacity="0.6"
          className="tl-outline"
        />

        {/* Rotating spiral arms — warm white on dark */}
        <g className="tl-spiral">
          {/* Arm 1 */}
          <path
            d="M24,24 C24,18 28,14 33,12 C30,16 27,20 24,24"
            fill="#F8F5EA"
            opacity="0.85"
          />
          {/* Arm 2 */}
          <path
            d="M24,24 C30,24 34,20 36,15 C32,18 28,21 24,24"
            fill="#F8F5EA"
            opacity="0.70"
          />
          {/* Arm 3 */}
          <path
            d="M24,24 C24,30 20,34 15,36 C18,32 21,28 24,24"
            fill="#F8F5EA"
            opacity="0.55"
          />
          {/* Arm 4 */}
          <path
            d="M24,24 C18,24 14,20 12,15 C16,18 20,21 24,24"
            fill="#F8F5EA"
            opacity="0.45"
          />

          {/* Inner spiral detail — tighter curls */}
          <path
            d="M24,24 C24,21 26,19 29,18 C27,20 25,22 24,24"
            fill="#F8F5EA"
            opacity="0.9"
          />
          <path
            d="M24,24 C27,24 29,22 30,19 C28,21 26,23 24,24"
            fill="#F8F5EA"
            opacity="0.75"
          />
          <path
            d="M24,24 C24,27 22,29 19,30 C21,28 23,26 24,24"
            fill="#F8F5EA"
            opacity="0.60"
          />
          <path
            d="M24,24 C21,24 19,22 18,19 C20,21 22,23 24,24"
            fill="#F8F5EA"
            opacity="0.50"
          />

          {/* Outer cloud wisps — pale cyan tinted */}
          <path
            d="M24,24 C24,15 30,10 38,9 C33,13 28,18 24,24"
            fill="#BFEFF2"
            opacity="0.30"
          />
          <path
            d="M24,24 C33,24 38,19 39,11 C36,16 30,20 24,24"
            fill="#BFEFF2"
            opacity="0.22"
          />
          <path
            d="M24,24 C24,33 19,38 11,39 C16,36 20,30 24,24"
            fill="#BFEFF2"
            opacity="0.18"
          />
          <path
            d="M24,24 C15,24 10,19 9,11 C13,16 18,20 24,24"
            fill="#BFEFF2"
            opacity="0.15"
          />
        </g>

        {/* Core — near-black centre with subtle warm edge */}
        <circle cx={cx} cy={cy} r="4.5" fill="#111827" className="tl-core" />
        <circle
          cx={cx}
          cy={cy}
          r="4.5"
          fill="none"
          stroke="#F8F5EA"
          strokeWidth="0.5"
          opacity="0.25"
        />

        {/* Eye — tiny warm white dot at dead centre */}
        <circle cx={cx} cy={cy} r="1.2" fill="#F8F5EA" opacity="0.95" />
      </svg>
    </div>
  );
}
