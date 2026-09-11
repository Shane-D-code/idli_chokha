"""Pipeline Orchestrator for TOOFAN.

Dependency-aware execution of the forecasting pipeline.
"""

from __future__ import annotations

import warnings
from datetime import datetime
from typing import Any, Optional
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict

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
    model: BaseModel
    dependencies: list[ModuleName] = field(default_factory=list)
    optional: bool = False
    condition: Optional[str] = None  # Condition for execution


@dataclass
class ExecutionResult:
    """Result of module execution."""
    module: ModuleName
    success: bool
    output: Any = None
    error: Optional[str] = None
    execution_time: float = 0.0
    warnings: list[str] = field(default_factory=list)


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
        """Initialize all pipeline modules with their dependencies."""
        for module_name, deps in self.DEFAULT_DEPENDENCIES.items():
            # Load model from registry
            model = self._load_module_model(module_name)
            if model is not None:
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
            raw_model = self.registry.load_model(entry.name, entry.version)

            # Create appropriate adapter
            return self._create_adapter(module_name, raw_model, entry)

        except Exception as e:
            warnings.warn(f"Failed to load model for {module_name.value}: {e}")
            return None

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
        if self.state_builder is None:
            from src.core.ingestion import DataIngestionLayer
            from src.core.harmonizer import create_harmonizer
            ingestion = DataIngestionLayer(self.config.get('data', {}))
            harmonizer = create_harmonizer(self.config.get('harmonization', {}))
            self.state_builder = CycloneStateBuilder(ingestion, harmonizer)

        print(f"Building CycloneState for {storm_id} at {reference_time}...")
        cyclone_state = self.state_builder.build_from_storm_id(
            storm_id, Basin(basin), reference_time
        )

        # Determine modules to execute
        if modules is None:
            if mode == "full":
                modules = list(ModuleName)
            elif mode == "genesis_only":
                modules = [ModuleName.GENESIS]
            elif mode == "track_only":
                modules = [ModuleName.GENESIS, ModuleName.TRAJECTORY]
            elif mode == "hazard_only":
                modules = [m for m in ModuleName if m != ModuleName.HAZARD_ENGINE]
            else:
                modules = list(ModuleName)

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

            if not result.success and not spec.optional:
                raise RuntimeError(f"Required module {module_name} failed: {result.error}")

        # Build unified state
        self.unified_state = self._build_unified_state(cyclone_state, module_outputs)
        return self.unified_state

    def _execute_module(self, spec: ModuleSpec, cyclone_state: CycloneState,
                         module_outputs: dict) -> ExecutionResult:
        """Execute a single module."""
        import time
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
                execution_time=execution_time
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
        """Build unified forecast state from module outputs."""
        # Collect model versions
        model_versions = {}
        for module_name, result in self.results.items():
            if result.success and module_name in self.dependency_graph.modules:
                spec = self.dependency_graph.modules[module_name]
                model_versions[module_name.value] = spec.model.model_info.version

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
            overall_hazard_severity=hazard_severity,
            confidence=self._compute_overall_confidence(module_outputs)
        )

    def _compute_overall_hazard(self, module_outputs: dict) -> RiskLevel:
        """Compute overall hazard severity from all predictions."""
        risk_levels = []

        for module_name, output in module_outputs.items():
            if output is None:
                continue

            if hasattr(output, 'risk_level'):
                risk_levels.append(output.risk_level)
            elif isinstance(output, dict) and 'risk_level' in output:
                risk_levels.append(output['risk_level'])

        if not risk_levels:
            return RiskLevel.NONE

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
            'modules_failed': [m.value for m, r in self.results.items() if not r.success],
            'execution_times': {m.value: r.execution_time for m, r in self.results.items()},
            'total_time': sum(r.execution_time for r in self.results.values()),
            'unified_state_available': self.unified_state is not None
        }


def create_orchestrator(config: dict) -> PipelineOrchestrator:
    """Create orchestrator from config."""
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