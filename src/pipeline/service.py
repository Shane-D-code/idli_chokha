"""Pipeline lifecycle service.

``PipelineService`` is the single orchestration boundary for TOOFAN runs: it
takes a validated :class:`PipelineRunRequest`, resolves the provider snapshot
(real data sources, honest statuses), executes the DAG in parallel waves, and
returns a :class:`PipelineRunResult` envelope with a per-hazard status map
(AVAILABLE / DEGRADED / BASELINE / NOT_AVAILABLE / ERROR) and full provenance.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Callable, Optional

from src.core.schema import (
    CycloneState,
    HazardStatus,
    PipelineRunRequest,
    PipelineRunResult,
    ProviderSource,
    ProviderStatus,
    UnifiedForecastState,
)
from src.core.registry import ModelRegistry
from src.pipeline.orchestrator import ModuleName, PipelineOrchestrator

# Modules that are never themselves scored into the per-hazard status map.
_NON_HAZARD = {ModuleName.HAZARD_ENGINE}


class PipelineRunError(RuntimeError):
    """Raised for a fatal, non-recoverable run failure."""


class PipelineService:
    """Executes forecasting runs and composes honest result envelopes."""

    def __init__(self, config: dict,
                 orchestrator: Optional[PipelineOrchestrator] = None,
                 provider_layer=None,
                 registry: Optional[ModelRegistry] = None,
                 cache=None,
                 event_sink: Optional[Callable[[dict], None]] = None):
        if orchestrator is None:
            from src.core.runtime import configure_runtime
            configure_runtime()
        self.config = config
        self.orchestrator = orchestrator or PipelineOrchestrator(config, registry)
        self.provider_layer = provider_layer
        self.registry = registry or self.orchestrator.registry
        self.cache = cache
        self._event_sink = event_sink
        # In-memory run store keyed by request_id and run_id. Lightweight
        # abstraction: swap for Redis/PostgreSQL by replacing _store/_get_run.
        self._runs: dict[str, "PipelineRunResult"] = {}

    # -- run store -------------------------------------------------------------

    def _store_run(self, result: "PipelineRunResult"):
        """Keep the run retrievable by request_id and run_id."""
        self._runs[result.request_id] = result
        if result.run_id and result.run_id != result.request_id:
            self._runs[result.run_id] = result

    def get_run(self, request_id: str) -> Optional["PipelineRunResult"]:
        """Retrieve a previously executed run, if it is still retained."""
        return self._runs.get(request_id)

    # -- events ---------------------------------------------------------------

    def _emit(self, stage: str, run_id: str, message: str,
              status: str = "running", data: dict | None = None):
        if self._event_sink is None:
            return
        try:
            self._event_sink({
                "kind": "pipeline",
                "run_id": run_id,
                "stage": stage,
                "status": status,
                "message": message,
                "data": data or {},
                "timestamp": time.time(),
            })
        except Exception:  # pragma: no cover - event sinks must never break runs
            pass

    # -- public API -----------------------------------------------------------

    def run(self, request: PipelineRunRequest) -> PipelineRunResult:
        start = time.perf_counter()
        run_id = (request.request_id or uuid.uuid4().hex)[:32]
        self._emit("pipeline_started", run_id, f"run requested for {request.storm_id}")

        modules = self._resolve_modules(request.modules)
        provider_sources: list[ProviderSource] = []
        cyclone_state: CycloneState | None = None
        try:
            cyclone_state = self._build_cyclone_state(request)
        except Exception as e:
            result = self._failed_result(request, run_id, start, provider_sources,
                                         f"cyclone state assembly failed: {e}")
            self._emit("pipeline_failed", run_id, result.warnings[0], "failed")
            self._store_run(result)
            return result

        provider_sources = self._snapshot_providers(request, cyclone_state)

        try:
            self._emit("pipeline", run_id, "executing module DAG (parallel)")
            t0 = time.perf_counter()
            assessment = self.orchestrator.execute_parallel(
                storm_id=request.storm_id,
                basin=request.basin.value,
                reference_time=request.reference_time,
                modules=modules,
                mode=request.mode,
                max_workers=request.max_workers,
                cyclone_state=cyclone_state,
            )
            exec_ms = (time.perf_counter() - t0) * 1000.0
        except Exception as e:
            result = self._failed_result(request, run_id, start, provider_sources,
                                         f"pipeline execution failed: {e}")
            self._emit("pipeline_failed", run_id, result.warnings[0], "failed")
            self._store_run(result)
            return result

        per_hazard, reasons = self._compose_hazard_statuses()
        total_ms = (time.perf_counter() - start) * 1000.0
        self._emit_module_completion_events(run_id)
        pipeline_status = "pipeline_degraded" if any(
            s in (HazardStatus.NOT_AVAILABLE.value,
                  HazardStatus.DEGRADED.value,
                  HazardStatus.ERROR.value,
                  HazardStatus.BASELINE.value)
            for s in per_hazard.values()
        ) else "pipeline_completed"
        self._emit(pipeline_status, run_id, "run completed", "completed",
                   data={"run_id": run_id, "total_latency_ms": total_ms})

        result = PipelineRunResult(
            request_id=request.request_id or run_id,
            run_id=run_id,
            pipeline_status="COMPLETED",
            assessment=assessment,
            per_hazard_status=per_hazard,
            per_hazard_reasons=reasons,
            provider_sources=provider_sources,
            stage_latency_ms={
                "state_assembly_ms": 0.0,
                "module_execution_ms": exec_ms,
            },
            total_latency_ms=total_ms,
            warnings=[],
        )
        self._store_run(result)
        return result

    def _emit_module_completion_events(self, run_id: str):
        """Emit a completion event per module after the DAG settles.

        The orchestrator stores per-module ExecutionResults (SUCCESS /
        FAILED / UNAVAILABLE) with execution times; mirroring them here gives
        streaming clients the dependency-ordered branch progression without
        adding hooks inside the executor.
        """
        for module, result in self.orchestrator.results.items():
            if module.value == "hazard_engine":
                continue
            if module.value == "genesis":
                stage = "genesis_completed"
            elif module.value in ("trajectory",):
                stage = "cyclone_path_completed"
            else:
                stage = "hazard_branch_completed"
            self._emit(stage, run_id, f"{module.value}: {result.status}",
                       result.status.lower(),
                       data={
                           "module": module.value,
                           "status": result.status,
                           "reason": result.reason,
                           "execution_time_ms": result.execution_time * 1000.0,
                       })

    def list_models(self) -> list[dict]:
        """Registered models with runtime availability."""
        out = []
        for entry in self.registry.list_models():
            import os
            out.append({
                "name": entry.name,
                "version": entry.version,
                "model_type": entry.model_type,
                "checkpoint_path": entry.checkpoint_path,
                "file_hash": entry.file_hash,
                "git_commit": entry.git_commit,
                "artifact_present": bool(entry.checkpoint_path and os.path.exists(entry.checkpoint_path)),
                "registered_at": entry.timestamp,
            })
        return out

    def provider_availability(self) -> dict:
        if self.provider_layer is None:
            return {}
        return self.provider_layer.availabilities()

    # -- internals --------------------------------------------------------------

    def _build_cyclone_state(self, request: PipelineRunRequest) -> CycloneState:
        self._emit("state", request.request_id or "", "assembling cyclone state")
        if self.orchestrator.state_builder is None:
            self.orchestrator._ensure_state_builder()
        return self.orchestrator.state_builder.build_from_storm_id(
            request.storm_id, request.basin, request.reference_time
        )

    def _resolve_modules(self, modules: list[str] | None) -> list[ModuleName]:
        if not modules:
            return list(ModuleName)
        known = {m.value for m in ModuleName}
        resolved = []
        for name in modules:
            if name not in known:
                raise PipelineRunError(
                    f"unknown module {name!r}; known modules: {sorted(known)}")
            resolved.append(ModuleName(name))
        return resolved

    def _snapshot_providers(self, request: PipelineRunRequest,
                            cyclone_state: CycloneState) -> list["ProviderSource"]:
        """Fetch each configured provider once (cached) and record provenance."""
        if self.provider_layer is None:
            return []
        lat = cyclone_state.latitude
        lon = cyclone_state.longitude
        region = (lat - 2.0, lat + 2.0, lon - 2.0, lon + 2.0)
        state_query = {
            "storm_id": request.storm_id,
            "basin": request.basin,
            "reference_time": request.reference_time,
            "time": request.reference_time,
            "lat_range": (lat - 2.0, lat + 2.0),
            "lon_range": (lon - 2.0, lon + 2.0),
            "region": region,
            "lookback_hours": 72,
        }
        sources: list[ProviderSource] = []
        for provider in self.provider_layer.all():
            query = state_query.copy()
            # Providers only fetch what they genuinely consume.
            if provider.name == "gridded_wind":
                query = {"contract": "U10/V10 6-frame 81x57 grid"}
            result = provider.fetch(query, use_cache=True, cache=self.cache)
            sources.append(result.to_source())
        return sources

    @staticmethod
    def _status_of_module(module: ModuleName, result) -> tuple[str, str]:
        """Map an ExecutionResult + adapter status to a HazardStatus token."""
        status = getattr(result, "status", "UNAVAILABLE")
        if status == "FAILED":
            return (HazardStatus.ERROR.value,
                    result.error or result.reason or "module raised an exception")
        if status == "UNAVAILABLE":
            return (HazardStatus.NOT_AVAILABLE.value,
                    result.reason or "module unavailable")

        output = getattr(result, "output", None)
        out_status = str(getattr(output, "status", "") or "AVAILABLE").upper()
        if out_status in ("UNAVAILABLE", "DATA_UNAVAILABLE", "RUNTIME_REQUIRED",
                          "NOT_IMPLEMENTED", "MODEL_MISSING"):
            return (HazardStatus.NOT_AVAILABLE.value,
                    f"adapter reports {out_status}")
        if "BASELINE" in out_status:
            return (HazardStatus.BASELINE.value,
                    f"adapter reports {out_status}")
        if out_status in ("LIMITED", "UNVERIFIED", "DEGRADED", "LIMITED/UNVERIFIED"):
            return (HazardStatus.DEGRADED.value,
                    f"adapter reports {out_status}")
        return (HazardStatus.AVAILABLE.value, "")

    def _compose_hazard_statuses(self) -> tuple[dict[str, str], dict[str, str]]:
        statuses: dict[str, str] = {}
        reasons: dict[str, str] = {}
        for module, result in self.orchestrator.results.items():
            if module in _NON_HAZARD:
                continue
            token, reason = self._status_of_module(module, result)
            statuses[module.value] = token
            if reason:
                reasons[module.value] = reason
        return statuses, reasons

    def _failed_result(self, request, run_id, start, provider_sources,
                       message: str) -> PipelineRunResult:
        total_ms = (time.perf_counter() - start) * 1000.0
        self._emit("pipeline_failed", run_id, message, "failed")
        result = PipelineRunResult(
            request_id=request.request_id or run_id,
            run_id=run_id,
            pipeline_status="FAILED",
            assessment=None,
            per_hazard_status={},
            per_hazard_reasons={},
            provider_sources=provider_sources,
            total_latency_ms=total_ms,
            warnings=[message],
        )
        self._store_run(result)
        return result