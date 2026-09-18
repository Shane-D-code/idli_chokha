import { useEffect, useState } from "react";
import { DemoBanner } from "@/components/common/DemoBanner";
import { LoadingState } from "@/components/common/StateBox";
import { toofanService } from "@/services/toofanService";
import { SectionLabel } from "@/components/design";
import type { HistoricalCyclone } from "@/types";
import { X } from "lucide-react";

export default function HistoricalPage() {
  const [events, setEvents] = useState<HistoricalCyclone[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<HistoricalCyclone | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setEvents(await toofanService.getHistorical());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="page"><LoadingState rows={4} /></div>;

  const filtered = events.filter((e) => {
    const s = search.toLowerCase();
    if (!s) return true;
    return (
      e.name.toLowerCase().includes(s) ||
      e.year.toString().includes(s) ||
      e.basin.toLowerCase().includes(s) ||
      (e.landfall && e.landfall.toLowerCase().includes(s))
    );
  });

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-kicker">Analysis</div>
        <h1 className="page-title">Historical Events</h1>
        <p className="page-sub">Search and explore past cyclone events and available model outputs.</p>
        <div className="row" style={{ marginTop: "var(--sp-3)" }}><DemoBanner /></div>
      </div>

      <div className="row" style={{ marginBottom: "var(--section-gap)", flexWrap: "wrap" }}>
        <input
          className="field-input"
          style={{ width: "clamp(240px, 30vw, 400px)" }}
          placeholder="Search — name, year, basin, landfall…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search historical cyclones"
        />
        <span className="small muted">{filtered.length} of {events.length} events</span>
      </div>

      <div className="panel">
        <div className="panel-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Cyclone</th>
                <th style={{ textAlign: "right" }}>Year</th>
                <th>Basin</th>
                <th style={{ textAlign: "right" }}>Peak Intensity</th>
                <th>Landfall</th>
                <th>Available Data</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev) => (
                <tr key={ev.id} onClick={() => setSelected(ev)} style={{ cursor: "pointer" }}>
                  <td style={{ fontWeight: 700 }}>{ev.name}</td>
                  <td style={{ textAlign: "right" }} className="mono">{ev.year}</td>
                  <td className="muted">{ev.basin}</td>
                  <td style={{ textAlign: "right" }} className="mono">{ev.peakIntensityKt ? `${ev.peakIntensityKt} kt` : "—"}</td>
                  <td className="muted small">{ev.landfall ?? "No landfall"}</td>
                  <td>
                    <div className="service-strip">
                      {ev.availableData.map((d) => (
                        <span key={d} className="service-tab">{d}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="drawer-overlay" onClick={() => setSelected(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Event: ${selected.name}`}>
            <div className="drawer-head">
              <div>
                <div className="page-kicker">Historical Event</div>
                <h3 className="drawer-title">{selected.name} ({selected.year})</h3>
              </div>
              <button className="drawer-close" onClick={() => setSelected(null)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="drawer-body">
              <div className="grid-2">
                <div className="hazard-module">
                  <div className="lbl">Basin</div>
                  <div className="mono small" style={{ marginTop: 4 }}>{selected.basin}</div>
                </div>
                <div className="hazard-module">
                  <div className="lbl">Peak Intensity</div>
                  <div className="mono small" style={{ marginTop: 4 }}>{selected.peakIntensityKt ? `${selected.peakIntensityKt} kt` : "—"}</div>
                  <div className="muted" style={{ fontSize: "var(--text-micro)", marginTop: 2 }}>{selected.category}</div>
                </div>
                <div className="hazard-module">
                  <div className="lbl">Landfall</div>
                  <div className="mono small" style={{ marginTop: 4 }}>{selected.landfall ?? "No landfall"}</div>
                </div>
              </div>

              <div className="panel" style={{ marginTop: "var(--sp-3)" }}>
                <SectionLabel label="Available Data" strong />
                {selected.availableData.length > 0 ? (
                  <div className="service-strip">
                    {selected.availableData.map((d) => (
                      <span key={d} className="service-tab">{d}</span>
                    ))}
                  </div>
                ) : (
                  <span className="small muted">No model data available.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
