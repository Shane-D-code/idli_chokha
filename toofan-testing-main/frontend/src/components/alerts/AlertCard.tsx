import type { Alert } from "@/types";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).format(d) + " IST";
}

export function AlertCard({ alert }: { alert: Alert }) {
  return (
    <div className={`alert-card sev-${alert.severity}`} role="status">
      <div className="a-sev">{alert.severity}</div>
      <div style={{ flex: 1 }}>
        <div className="a-title">{alert.title}</div>
        {alert.message ? (
          <p className="small muted" style={{ marginTop: "4px" }}>{alert.message}</p>
        ) : null}
        <div className="a-meta">
          {fmtTime(alert.timestamp)}
          {alert.region ? ` · ${alert.region}` : ""} · {alert.source}
        </div>
      </div>
      {alert.latitude !== undefined && alert.longitude !== undefined ? (
        <div className="a-coord-badge" role="status" title="Updated position">
          <span className="a-coord-label">POSITION</span>
          <span className="a-coord-val">{alert.latitude.toFixed(2)}°N<br />{alert.longitude.toFixed(2)}°E</span>
        </div>
      ) : alert.percentage !== undefined ? (
        <div className="a-pct" role="status" title="Alert likelihood / confidence">
          <span className="a-pct-val">{alert.percentage}%</span>
        </div>
      ) : null}
    </div>
  );
}
