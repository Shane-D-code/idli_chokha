interface Props {
  label: string;
  value?: React.ReactNode;
  unit?: string;
  sub?: string;
  size?: "lg" | "sm";
}

export function MetricBlock({ label, value, unit, sub, size = "lg" }: Props) {
  return (
    <div className="metric-block">
      <span className="lbl">{label}</span>
      <span className={`val ${size === "sm" ? "sm" : ""}`}>
        {value ?? "—"}
        {unit ? <span className="unit"> {unit}</span> : null}
      </span>
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  );
}
