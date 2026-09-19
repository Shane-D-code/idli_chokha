import { useCallback, useEffect, useState } from "react";
import { toofanService } from "@/services/toofanService";
import type { PipelineRunRequest, PipelineRunResult, PipelineEvent } from "@/types/backend";

export function RunAssessment() {
  const [stormId, setStormId] = useState<string>("");
  const [basin, setBasin] = useState<string>("NI");
  const [referenceTime, setReferenceTime] = useState<string>(new Date().toISOString());
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [result, setResult] = useState<PipelineRunResult | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [ws]);

  const onMessage = useCallback((ev: PipelineEvent) => {
    setEvents((e) => [...e, ev].slice(-200));
    if (ev.stage === "pipeline_completed" || ev.stage === "pipeline_degraded" || ev.stage === "pipeline_failed") {
      // finalised — fetch assessment to populate UI
      const runId = ev.run_id ?? ev.data?.run_id;
      if (runId) {
        toofanService.getAssessment(runId).catch(() => {});
      }
    }
  }, []);

  async function handleRun(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!stormId) return alert("Please enter a storm_id (e.g. BOB-xx-YYYY).");
    setRunning(true);
    setEvents([]);
    try {
      const req: PipelineRunRequest = {
        storm_id: stormId,
        basin: basin as any,
        reference_time: referenceTime,
      };
      const res = await toofanService.runPipeline(req);
      setResult(res);
      // connect to websocket for live events
      const socket = toofanService.connectAssessmentWebSocket(res.request_id, {
        onOpen: () => {},
        onClose: () => {},
        onError: () => {},
        onMessage: onMessage,
      });
      setWs(socket);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err);
      alert((err as Error)?.message ?? "Run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="run-assessment panel" style={{ marginBottom: "1rem" }}>
      <div className="panel-head">
        <span className="panel-title">Run Assessment</span>
      </div>
      <form className="panel-body" onSubmit={handleRun}>
        <div className="grid gap-2 grid-cols-3">
          <input className="input" placeholder="storm_id" value={stormId} onChange={(e) => setStormId(e.target.value)} />
          <select className="input" value={basin} onChange={(e) => setBasin(e.target.value)}>
            <option value="NI">North Indian (NI)</option>
            <option value="BOB">Bay of Bengal (BOB)</option>
            <option value="AS">Arabian Sea (AS)</option>
          </select>
          <input className="input" value={referenceTime} onChange={(e) => setReferenceTime(e.target.value)} />
        </div>
        <div style={{ marginTop: 8 }}>
          <button className={`btn ${running ? "disabled" : "solid"}`} type="submit">{running ? "Running…" : "Run Assessment"}</button>
        </div>
      </form>

      {result ? (
        <div className="panel mt-3">
          <div className="small muted">Run ID</div>
          <div className="cc-mono-sm">{result.run_id}</div>
          <div className="small muted" style={{ marginTop: 6 }}>Pipeline status</div>
          <div>{result.pipeline_status}</div>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="panel mt-3">
          <div className="panel-head"><span className="panel-title">Live Events</span></div>
          <div className="panel-body" style={{ maxHeight: 160, overflow: "auto" }}>
            {events.map((ev, i) => (
              <div key={i} className="small muted" style={{ marginBottom: 6 }}>
                <b>{ev.stage ?? ev.pipeline_status ?? ev.status}</b>: {ev.message ?? JSON.stringify(ev.data ?? {})}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default RunAssessment;
