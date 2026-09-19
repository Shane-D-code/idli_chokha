"""Pipeline Orchestrator for TOOFAN.

Dependency-aware execution of the forecasting pipeline.
"""

from __future__ import annotations

import warnings
import time
from datetime import datetime
from typing import Any, Optional
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

import networkx as nx
import numpy as np

from src.core.schema import (
    CycloneState, Basin, GenesisPrediction, TrackPrediction, RainfallPrediction,
    WindFieldPrediction, FloodPrediction, RIPrediction, IntensityPrediction,
    RecurvaturePrediction, LandslidePrediction, UnifiedForecastState, RiskLevel
)
from src.models.base import (
    BaseModel, GenesisModel, TrajectoryModel, RainfallModel, WindModel,
    FloodModel, RIModel, IntensityModel, RecurvatureModel, LandslideModel
)
from src.pipeline.state import CycloneStateBuilder
from src.core.registry import ModelRegistry, get_registry


class ModuleName(str, Enum):
    """Pipeline module names."""
    GENESIS = "genesis"
    TRAJECTORY = "trajectory"
    INTENSITY = "intensity"
    RI = "ri"
    RAINFALL = "rainfall"
    WIND = "wind"
    FLOOD = "flood"
    LANDSLIDE = "landslide"
    RECURVATURE = "recurvature"
    HAZARD_ENGINE = "hazard_engine"


@dataclass
class ModuleSpec:
    """Specification for a pipeline module."""
    name: ModuleName
    model: BaseModel | None = None
    dependencies: list[ModuleName] = field(default_factory=list)
    optional: bool = False
    condition: Optional[str] = None  # Condition for execution


@dataclass
class ExecutionResult:
    """Result of module execution.

    ``status`` is one of ``"SUCCESS"``, ``"FAILED"`` (a real execution error) or
    ``"UNAVAILABLE"`` (the module cannot run: model artifact missing or a
    required dependency unavailable). ``success`` is True only for SUCCESS.
    """
    module: ModuleName
    success: bool
    output: Any = None
    error: Optional[str] = None
    execution_time: float = 0.0
    warnings: list[str] = field(default_factory=list)
    status: str = "SUCCESS"
    reason: str | None = None


class DependencyGraph:
    """Manages module dependencies and execution order."""

    def __init__(self):
        self.graph = nx.DiGraph()
        self.modules: dict[ModuleName, ModuleSpec] = {}

    def add_module(self, spec: ModuleSpec):
        """Add a module to the graph."""
        self.modules[spec.name] = spec
        self.graph.add_node(spec.name.value)
        for dep in spec.dependencies:
            self.graph.add_edge(dep.value, spec.name.value)

    def get_execution_order(self, modules: list[ModuleName]) -> list[ModuleName]:
        """Get topological order for given modules."""
        subgraph = self.graph.subgraph([m.value for m in modules])
        try:
            order = list(nx.topological_sort(subgraph))
            return [ModuleName(m) for m in order]
        except nx.NetworkXUnfeasible:
            raise ValueError("Circular dependency detected in module graph")

    def get_dependencies(self, module: ModuleName) -> list[ModuleName]:
        """Get direct dependencies of a module."""
        return [ModuleName(d) for d in self.graph.predecessors(module.value)]

    def get_dependents(self, module: ModuleName) -> list[ModuleName]:
        """Get modules that depend on this module."""
        return [ModuleName(d) for d in self.graph.successors(module.value)]

    def validate(self) -> list[str]:
        """Validate graph for cycles and missing dependencies."""
        errors = []

        # Check for cycles
        try:
            nx.find_cycle(self.graph)
            errors.append("Graph contains cycles")
        except nx.NetworkXNoCycle:
            pass

        # Check all dependencies exist
        for spec in self.modules.values():
            for dep in spec.dependencies:
                if dep not in self.modules:
                    errors.append(f"Module {spec.name} depends on missing module {dep}")

        return errors


class PipelineOrchestrator:
    """Orchestrates the TOOFAN forecasting pipeline."""

    # Default dependency graph
    DEFAULT_DEPENDENCIES = {
        ModuleName.GENESIS: [],
        ModuleName.TRAJECTORY: [ModuleName.GENESIS],
        ModuleName.INTENSITY: [ModuleName.GENESIS],
        ModuleName.RI: [ModuleName.GENESIS],
        ModuleName.RAINFALL: [ModuleName.TRAJECTORY, ModuleName.INTENSITY],
        ModuleName.WIND: [ModuleName.TRAJECTORY, ModuleName.INTENSITY],
        ModuleName.FLOOD: [ModuleName.RAINFALL, ModuleName.WIND],
        ModuleName.LANDSLIDE: [ModuleName.RAINFALL],
        ModuleName.RECURVATURE: [ModuleName.TRAJECTORY],
        ModuleName.HAZARD_ENGINE: [
            ModuleName.GENESIS, ModuleName.TRAJECTORY, ModuleName.INTENSITY,
            ModuleName.RI, ModuleName.RAINFALL, ModuleName.WIND,
            ModuleName.FLOOD, ModuleName.LANDSLIDE, ModuleName.RECURVATURE
        ],
    }

    def __init__(self, config: dict,
                 registry: Optional[ModelRegistry] = None,
                 state_builder: Optional[CycloneStateBuilder] = None):
        self.config = config
        self.registry = registry or get_registry()
        self.state_builder = state_builder
        self.dependency_graph = DependencyGraph()
        self.results: dict[ModuleName, ExecutionResult] = {}
        self.unified_state: Optional[UnifiedForecastState] = None

        # Initialize modules
        self._initialize_modules()

    def _initialize_modules(self):
        """Initialize all pipeline modules with their dependencies.

        Every module declared in ``DEFAULT_DEPENDENCIES`` is registered in the
        dependency graph regardless of whether its model artifact currently
        loads. A module whose model is unavailable keeps its graph node and
        reports an explicit ``UNAVAILABLE`` status at execution time; the model
        attribute on the spec is ``Optional``.
        """
        for module_name, deps in self.DEFAULT_DEPENDENCIES.items():
            model = self._load_module_model(module_name)
            spec = ModuleSpec(
                name=module_name,
                model=model,
                dependencies=deps,
                optional=module_name in [ModuleName.RI, ModuleName.RECURVATURE]
            )
            self.dependency_graph.add_module(spec)

    def _load_module_model(self, module_name: ModuleName) -> Optional[BaseModel]:
        """Load model for a module from registry."""
        try:
            # Get model config
            model_config = self.config.get('models', {}).get(module_name.value, {})
            model_name = model_config.get('name', module_name.value)
            model_version = model_config.get('version', 'latest')

            # Try to get from registry
            if model_version == 'latest':
                entry = self.registry.get_latest(model_name, module_name.value)
            else:
                entry = self.registry.get(model_name, model_version)

            if entry is None:
                warnings.warn(f"No registered model for {module_name.value} "
                            f"({model_name} v{model_version})")
                return None

            # Load model artifact
            raw_model = self._load_raw_artifact(entry)

            # Create appropriate adapter
            return self._create_adapter(module_name, raw_model, entry)

        except Exception as e:
            warnings.warn(f"Failed to load model for {module_name.value}: {e}")
            return None

    def _load_raw_artifact(self, entry) -> Any:
        """Load a registered artifact, deferring TF-native ``.keras`` files.

        TensorFlow hard-aborts when imported after other native libraries
        (pandas/xarray) in the same process on macOS arm64, so ``.keras``
        artifacts are never deserialized in the main process. The wind adapter
        adopts a lightweight placeholder so it stays ``_is_loaded`` (honest
        BASELINE with no gridded input) and isolates ALL real TF inference in
        subprocesses keyed to the artifact checkpoint path.
        """
        if entry is None:
            return None
        checkpoint_path = getattr(entry, 'checkpoint_path', None)
        if checkpoint_path and str(checkpoint_path).endswith('.keras'):
            from types import SimpleNamespace
            return SimpleNamespace(input_shape=None, predict=None)
        return self.registry.load_model(entry.name, entry.version)

    def _create_adapter(self, module_name: ModuleName, raw_model: Any,
                         entry) -> BaseModel:
        """Create adapter for a module."""
        # Import adapter dynamically
        try:
            adapter_module = f"src.models.{module_name.value}.adapter"
            module = __import__(adapter_module, fromlist=['ModelAdapter'])
            adapter_class = getattr(module, 'ModelAdapter')
        except (ImportError, AttributeError):
            # Use generic adapter
            from src.models.base import GenericModelAdapter
            adapter_class = GenericModelAdapter

        metadata = self.registry.get_metadata(entry.name, entry.version)
        return adapter_class(raw_model, metadata)

    def _ensure_state_builder(self):
        """Lazily build the CycloneStateBuilder when none was injected."""
        if self.state_builder is None:
            from src.core.ingestion import DataIngestionLayer
            from src.core.harmonizer import create_harmonizer
            ingestion = DataIngestionLayer(self.config.get('data', {}))
            harmonizer = create_harmonizer(self.config.get('harmonization', {}))
            self.state_builder = CycloneStateBuilder(ingestion, harmonizer)

    def _resolve_modules(self, modules: Optional[list[ModuleName]],
                         mode: str) -> list[ModuleName]:
        """Resolve which modules to execute for the given request."""
        if modules is not None:
            return list(modules)
        if mode == "genesis_only":
            return [ModuleName.GENESIS]
        elif mode == "track_only":
            return [ModuleName.GENESIS, ModuleName.TRAJECTORY]
        elif mode == "hazard_only":
            return [m for m in ModuleName if m != ModuleName.HAZARD_ENGINE]
        return list(ModuleName)

    def execute(self, storm_id: str, basin: str, reference_time: datetime,
                modules: Optional[list[ModuleName]] = None,
                mode: str = "full") -> UnifiedForecastState:
        """Execute the pipeline.

        Args:
            storm_id: Storm identifier
            basin: Basin code
            reference_time: Forecast initialization time
            modules: Specific modules to run (None = all)
            mode: Execution mode ('full', 'genesis_only', 'track_only', etc.)

        Returns:
            UnifiedForecastState with all predictions
        """
        # Build cyclone state
        self._ensure_state_builder()
        print(f"Building CycloneState for {storm_id} at {reference_time}...")
        cyclone_state = self.state_builder.build_from_storm_id(
            storm_id, Basin(basin), reference_time
        )

        # Determine modules to execute
        modules = self._resolve_modules(modules, mode)

        # Get execution order
        execution_order = self.dependency_graph.get_execution_order(modules)

        # Execute in order
        print(f"Executing modules: {[m.value for m in execution_order]}")
        self.results = {}
        module_outputs = {}

        for module_name in execution_order:
            if module_name not in self.dependency_graph.modules:
                continue

            spec = self.dependency_graph.modules[module_name]
            result = self._execute_module(spec, cyclone_state, module_outputs)
            self.results[module_name] = result
            module_outputs[module_name] = result.output

            if not result.success and not spec.optional and result.status == "FAILED":
                raise RuntimeError(f"Required module {module_name} failed: {result.error}")

        # Build unified state
        self.unified_state = self._build_unified_state(cyclone_state, module_outputs)
        return self.unified_state

    def execute_parallel(self, storm_id: str, basin: str,
                         reference_time: datetime,
                         modules: Optional[list[ModuleName]] = None,
                         mode: str = "full",
                         max_workers: int | None = None,
                         cyclone_state: Optional[CycloneState] = None) -> UnifiedForecastState:
        """Execute the pipeline with DAG-aware parallel module execution.

        Semantics match :meth:`execute` (same dependency rules, same
        UNAVAILABLE propagation, same unified-state / hazard-engine output),
        but independent branches of the dependency graph run concurrently in
        a bounded thread pool instead of one after another.

        A failed or unavailable module NEVER blocks unrelated branches: each
        wave waits only for the ancestors a module truly requires. Failures
        are recorded in ``self.results`` rather than raised, so the hazard
        engine can still assemble an honest partial assessment.
        """
        if cyclone_state is None:
            self._ensure_state_builder()
            print(f"Building CycloneState for {storm_id} at {reference_time}...")
            cyclone_state = self.state_builder.build_from_storm_id(
                storm_id, Basin(basin), reference_time
            )

        modules = self._resolve_modules(modules, mode)
        runtime_max_workers = self.config.get('execution', {}).get('max_workers')
        if max_workers is not None:
            workers = max_workers
        elif isinstance(runtime_max_workers, int) and runtime_max_workers > 0:
            workers = runtime_max_workers
        else:
            workers = 4
        workers = max(1, min(workers, 32))

        requested: set[str] = {m.value for m in modules}
        # Modules are graph nodes regardless of model availability, so every
        # module in the requested set belongs to the graph.
        targets: list[ModuleName] = [
            m for m in modules if m in self.dependency_graph.modules
        ]

        self.results = {}
        module_outputs: dict[ModuleName, Any] = {}
        completed: dict[ModuleName, ExecutionResult] = {}
        pending: set[ModuleName] = set(targets)

        def dependencies_of(m: ModuleName) -> list[ModuleName]:
            return self.dependency_graph.get_dependencies(m)

        while pending:
            wave = [
                m for m in pending
                if all(dep in completed for dep in dependencies_of(m))
            ]
            progress = False
            if wave:
                for m in list(wave):
                    deps = dependencies_of(m)
                    if m == ModuleName.HAZARD_ENGINE:
                        continue  # runs as soon as its deps have any status
                    missing_dep = next((d for d in deps if d.value not in requested), None)
                    if missing_dep is not None:
                        self._record_unavailable(
                            completed, m, f"dependency unavailable: {missing_dep.value} (not in requested module set)")
                        progress = True
                        continue
                    bad_dep = next((d for d in deps if completed[d].status != "SUCCESS"), None)
                    if bad_dep is not None:
                        if completed[bad_dep].status == "FAILED":
                            self._record_unavailable(completed, m, f"dependency failed: {bad_dep.value}")
                        else:
                            self._record_unavailable(completed, m, f"dependency unavailable: {bad_dep.value}")
                        progress = True
                        continue

            runnable = [m for m in wave if m not in completed]
            if not runnable:
                if not pending:
                    break
                if progress:
                    pending -= set(completed)
                    continue
                leftovers = {m.value: [d.value for d in dependencies_of(m)
                                       if d not in completed]
                             for m in pending}
                raise RuntimeError(
                    f"Parallel execution stalled; modules could not be scheduled: {leftovers}")

            with ThreadPoolExecutor(max_workers=min(workers, len(runnable))) as executor:
                futures = {
                    executor.submit(
                        self._execute_parallel_module,
                        self.dependency_graph.modules[m], cyclone_state, module_outputs,
                    ): m
                    for m in runnable
                }
                for future in as_completed(futures):
                    m = futures[future]
                    try:
                        res = future.result()
                    except Exception as e:
                        res = ExecutionResult(
                            module=m, success=False, error=str(e),
                            execution_time=0.0, status="FAILED",
                        )
                    completed[m] = res
                    if res.success and res.output is not None:
                        module_outputs[m] = res.output

            pending -= set(completed)

        self.results = completed
        self.unified_state = self._build_unified_state(cyclone_state, module_outputs)
        return self.unified_state

    @staticmethod
    def _record_unavailable(completed: dict, module: ModuleName, reason: str):
        """Record an immediate UNAVAILABLE result (no model run)."""
        completed[module] = ExecutionResult(
            module=module,
            success=False,
            output=None,
            status="UNAVAILABLE",
            reason=reason,
            execution_time=0.0,
        )

    def _execute_parallel_module(self, spec: ModuleSpec, cyclone_state: CycloneState,
                                 module_outputs: dict) -> ExecutionResult:
        """Worker for :meth:`execute_parallel` — gates only model availability."""
        start_time = time.time()
        if spec.model is None and spec.name != ModuleName.HAZARD_ENGINE:
            return ExecutionResult(
                module=spec.name,
                success=False,
                output=None,
                status="UNAVAILABLE",
                reason="model artifact unavailable (not loaded)",
                execution_time=time.time() - start_time,
            )
        return self._predict_module(spec, cyclone_state, module_outputs, start_time)

    def _execute_module(self, spec: ModuleSpec, cyclone_state: CycloneState,
                         module_outputs: dict) -> ExecutionResult:
        """Execute a single module."""
        import time
        start_time = time.time()

        try:
            # A module whose model artifact did not load (and that is not the
            # model-less hazard engine) reports an explicit UNAVAILABLE status
            # instead of vanishing from the graph or crashing the pipeline.
            if spec.model is None and spec.name != ModuleName.HAZARD_ENGINE:
                return ExecutionResult(
                    module=spec.name,
                    success=False,
                    output=None,
                    status="UNAVAILABLE",
                    reason="model artifact unavailable (not loaded)",
                    execution_time=time.time() - start_time,
                )

            # A module whose predict() requires upstream outputs must not run
            # (and must not be reported as successful) when those outputs are
            # unavailable. Uses the declared DEFAULT_DEPENDENCIES edges. NOTE:
            # the serial path intentionally does NOT gate genesis->trajectory
            # chaining here (parallel execute_parallel applies full dependency
            # gating); isolated modules report their own adapter status.
            required_upstream = {
                ModuleName.RAINFALL: [ModuleName.TRAJECTORY, ModuleName.INTENSITY],
                ModuleName.WIND: [ModuleName.TRAJECTORY, ModuleName.INTENSITY],
                ModuleName.FLOOD: [ModuleName.RAINFALL, ModuleName.WIND],
                ModuleName.LANDSLIDE: [ModuleName.RAINFALL],
            }.get(spec.name, [])
            for dep in required_upstream:
                dep_result = self.results.get(dep)
                if dep_result is None or dep_result.status != "SUCCESS":
                    if dep_result is not None and dep_result.status == "FAILED":
                        reason = f"dependency failed: {dep.value}"
                    else:
                        reason = f"dependency unavailable: {dep.value}"
                    return ExecutionResult(
                        module=spec.name,
                        success=False,
                        output=None,
                        status="UNAVAILABLE",
                        reason=reason,
                        execution_time=time.time() - start_time,
                    )

            return self._predict_module(spec, cyclone_state, module_outputs, start_time)

        except Exception as e:
            execution_time = time.time() - start_time
            return ExecutionResult(
                module=spec.name,
                success=False,
                error=str(e),
                execution_time=execution_time,
                status="FAILED",
            )

    def _predict_module(self, spec: ModuleSpec, cyclone_state: CycloneState,
                        module_outputs: dict,
                        start_time: float | None = None) -> ExecutionResult:
        """Run a module's model, dispatching on its real input contract.

        Shared by the serial and parallel execution paths. No dependency
        gating is performed here — callers must guarantee that every input the
        module requires is already present in ``module_outputs``.
        """
        if start_time is None:
            start_time = time.time()

        try:
            # Prepare inputs based on module type
            if spec.name == ModuleName.GENESIS:
                output = spec.model.predict(cyclone_state)

            elif spec.name == ModuleName.TRAJECTORY:
                output = spec.model.predict(cyclone_state)

            elif spec.name == ModuleName.INTENSITY:
                output = spec.model.predict(cyclone_state)

            elif spec.name == ModuleName.RI:
                output = spec.model.predict(cyclone_state)

            elif spec.name == ModuleName.RAINFALL:
                track = module_outputs.get(ModuleName.TRAJECTORY)
                intensity = module_outputs.get(ModuleName.INTENSITY)
                output = spec.model.predict(cyclone_state, track, intensity)

            elif spec.name == ModuleName.WIND:
                track = module_outputs.get(ModuleName.TRAJECTORY)
                intensity = module_outputs.get(ModuleName.INTENSITY)
                output = spec.model.predict(cyclone_state, track, intensity)

            elif spec.name == ModuleName.FLOOD:
                rainfall = module_outputs.get(ModuleName.RAINFALL)
                wind = module_outputs.get(ModuleName.WIND)
                if rainfall is None:
                    raise ValueError("Rainfall prediction required for flood model")
                output = spec.model.predict(rainfall, wind, cyclone_state)

            elif spec.name == ModuleName.LANDSLIDE:
                rainfall = module_outputs.get(ModuleName.RAINFALL)
                if rainfall is None:
                    raise ValueError("Rainfall prediction required for landslide model")
                output = spec.model.predict(rainfall, cyclone_state)

            elif spec.name == ModuleName.RECURVATURE:
                track = module_outputs.get(ModuleName.TRAJECTORY)
                output = spec.model.predict(cyclone_state, track)

            elif spec.name == ModuleName.HAZARD_ENGINE:
                output = self._run_hazard_engine(cyclone_state, module_outputs)

            else:
                raise ValueError(f"Unknown module: {spec.name}")

            execution_time = time.time() - start_time

            # An adapter may legitimately run and return a schema object whose
            # own status marks the prediction as unavailable (e.g. RI/intensity
            # report UNAVAILABLE when no decision-tree artifacts were
            # distributed). Such a module must NOT be reported as a SUCCESS —
            # otherwise the unavailable output flows downstream and the UI
            # renders fabricated values. LIMITED/UNVERIFIED/BASELINE outputs are
            # real outputs (the module ran) and are NOT downgraded here.
            unavailable_statuses = {
                "UNAVAILABLE",
                "DATA_UNAVAILABLE",
                "RUNTIME_REQUIRED",
                "NOT_IMPLEMENTED",
                "MODEL_MISSING",
            }
            output_status = getattr(output, "status", None)
            if output is not None and output_status in unavailable_statuses:
                return ExecutionResult(
                    module=spec.name,
                    success=False,
                    output=output,
                    reason=f"adapter reports status={output_status}",
                    status="UNAVAILABLE",
                    execution_time=execution_time,
                )

            return ExecutionResult(
                module=spec.name,
                success=True,
                output=output,
                execution_time=execution_time
            )

        except Exception as e:
            execution_time = time.time() - start_time
            return ExecutionResult(
                module=spec.name,
                success=False,
                error=str(e),
                execution_time=execution_time,
                status="FAILED",
            )

    def _run_hazard_engine(self, cyclone_state: CycloneState,
                            module_outputs: dict) -> UnifiedForecastState:
        """Run the unified hazard engine."""
        from src.pipeline.hazard_engine import HazardRiskEngine

        engine = HazardRiskEngine(self.config.get('hazard_engine', {}))
        return engine.compute(
            cyclone_state=cyclone_state,
            genesis=module_outputs.get(ModuleName.GENESIS),
            track=module_outputs.get(ModuleName.TRAJECTORY),
            intensity=module_outputs.get(ModuleName.INTENSITY),
            ri=module_outputs.get(ModuleName.RI),
            recurvature=module_outputs.get(ModuleName.RECURVATURE),
            wind=module_outputs.get(ModuleName.WIND),
            rainfall=module_outputs.get(ModuleName.RAINFALL),
            flood=module_outputs.get(ModuleName.FLOOD),
            landslide=module_outputs.get(ModuleName.LANDSLIDE)
        )

    def _build_unified_state(self, cyclone_state: CycloneState,
                              module_outputs: dict) -> UnifiedForecastState:
        """Build unified forecast state from module outputs.

        When the hazard engine ran, its computed overall severity, confidence,
        affected region, uncertainty summary and explanations are preserved
        (only model versions and per-module status metadata are merged in),
        keeping the engine's hazard combination logic authoritative instead of
        overwriting it with the orchestrator's own summary heuristics.
        """
        # Collect model versions
        model_versions = {}
        for module_name, result in self.results.items():
            if result.success and module_name in self.dependency_graph.modules:
                spec = self.dependency_graph.modules[module_name]
                if spec.model is not None:
                    model_versions[module_name.value] = spec.model.model_info.version

        # Per-module status/reasons, preserving availability for downstream layers
        module_status = {}
        module_reasons = {}
        for module_name, result in self.results.items():
            module_status[module_name.value] = result.status
            if result.status != "SUCCESS":
                module_reasons[module_name.value] = result.reason or result.error or result.status

        hazard_state = module_outputs.get(ModuleName.HAZARD_ENGINE)
        if isinstance(hazard_state, UnifiedForecastState):
            hazard_state.model_versions = model_versions
            hazard_state.module_status = module_status
            hazard_state.module_reasons = module_reasons
            return hazard_state

        # Determine overall hazard severity
        hazard_severity = self._compute_overall_hazard(module_outputs)

        return UnifiedForecastState(
            cyclone=cyclone_state,
            genesis=module_outputs.get(ModuleName.GENESIS),
            track=module_outputs.get(ModuleName.TRAJECTORY),
            intensity=module_outputs.get(ModuleName.INTENSITY),
            rapid_intensification=module_outputs.get(ModuleName.RI),
            recurvature=module_outputs.get(ModuleName.RECURVATURE),
            wind=module_outputs.get(ModuleName.WIND),
            rainfall=module_outputs.get(ModuleName.RAINFALL),
            flood=module_outputs.get(ModuleName.FLOOD),
            landslide=module_outputs.get(ModuleName.LANDSLIDE),
            model_versions=model_versions,
            module_status=module_status,
            module_reasons=module_reasons,
            overall_hazard_severity=hazard_severity,
            confidence=self._compute_overall_confidence(module_outputs)
        )

    def _compute_overall_hazard(self, module_outputs: dict) -> RiskLevel | None:
        """Compute overall hazard severity from all predictions.

        Returns ``None`` (not assessed) — NOT ``RiskLevel.NONE`` — when no
        module carried a usable risk level, so the UI cannot misread the
        composite as an assessed low-risk result.
        """
        risk_levels = []

        for module_name, output in module_outputs.items():
            if output is None:
                continue

            if hasattr(output, 'risk_level'):
                risk_levels.append(output.risk_level)
            elif isinstance(output, dict) and 'risk_level' in output:
                risk_levels.append(output['risk_level'])

        if not risk_levels:
            return None

        # Return maximum risk level
        risk_order = {
            RiskLevel.NONE: 0, RiskLevel.LOW: 1, RiskLevel.MODERATE: 2,
            RiskLevel.HIGH: 3, RiskLevel.EXTREME: 4
        }
        return max(risk_levels, key=lambda r: risk_order.get(r, 0))

    def _compute_overall_confidence(self, module_outputs: dict) -> float:
        """Compute overall confidence from all predictions."""
        confidences = []

        for output in module_outputs.values():
            if output is None:
                continue
            if hasattr(output, 'confidence'):
                confidences.append(output.confidence)

        return float(np.mean(confidences)) if confidences else 0.0

    def get_execution_summary(self) -> dict:
        """Get summary of pipeline execution."""
        return {
            'modules_executed': [m.value for m, r in self.results.items() if r.success],
            'modules_failed': [m.value for m, r in self.results.items() if not r.success and r.status == "FAILED"],
            'modules_unavailable': [m.value for m, r in self.results.items() if r.status == "UNAVAILABLE"],
            'execution_times': {m.value: r.execution_time for m, r in self.results.items()},
            'total_time': sum(r.execution_time for r in self.results.values()),
            'unified_state_available': self.unified_state is not None
        }


def create_orchestrator(config: dict) -> PipelineOrchestrator:
    """Create orchestrator from config.

    Native ML framework loading (torch, xgboost, tensorflow) must be preceded
    by ``configure_runtime()`` (single shared libomp) or the process can SIGSEGV
    on macOS arm64; this factory guarantees that ordering regardless of caller.
    """
    from src.core.runtime import configure_runtime
    configure_runtime()  # idempotent; raises if an ML framework already loaded
    registry = get_registry(config.get('registry_dir', 'models/registry'))

    state_builder = None
    if 'data' in config:
        from src.core.ingestion import DataIngestionLayer
        from src.core.harmonizer import create_harmonizer
        ingestion = DataIngestionLayer(config['data'])
        harmonizer = create_harmonizer(config.get('harmonization', {}))
        from src.pipeline.state import CycloneStateBuilder
        state_builder = CycloneStateBuilder(ingestion, harmonizer)

    return PipelineOrchestrator(config, registry, state_builder)