import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
  textValue?: boolean;
}

export function MetricCard({ label, value, sub, textValue }: Props) {
  return (
    <div className="metric-block">
      <span className="lbl">{label}</span>
      <span className={`val ${textValue ? "sm" : ""}`} style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: textValue ? "var(--text-metric-sm)" : undefined, lineHeight: 1.05, marginTop: 3 }}>
        {value ?? "—"}
      </span>
      {sub ? (
        <span className="sub" style={{ color: "var(--ink-4)", fontSize: "var(--text-micro)", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.12em" }}>
          {sub}
        </span>
      ) : null}
    </div>
  );
}
