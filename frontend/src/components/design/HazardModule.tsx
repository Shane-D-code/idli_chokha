import type { ModelOperationalStatus } from "@/types";
import { StatusLabel } from "./StatusLabel";

interface Props {
  label: string;
  status?: ModelOperationalStatus;
  detail?: React.ReactNode;
  value?: React.ReactNode;
}

export function HazardModule({ label, status, detail, value }: Props) {
  return (
    <div className="hazard-module">
      <div className="m-title">{label}</div>
      <div className="m-meta">
        {value !== undefined ? (
          <div style={{ fontFamily: "var(--display)", fontWeight: 900, fontSize: "1.3rem", lineHeight: 1.1 }}>
            {value ?? "—"}
          </div>
        ) : null}
        {status ? (
          <div style={{ marginTop: "6px" }}>
            <StatusLabel status={status} />
          </div>
        ) : null}
        {detail ? (
          <div className="small muted" style={{ marginTop: "6px" }}>
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}
