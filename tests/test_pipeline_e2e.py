"""Deterministic end-to-end pipeline tests.

Builds the REAL production orchestrator from ``configs/pipeline.yaml``
(module graph, model registry, artifact loading) and executes it against an
injected deterministic ``CycloneState`` — no live ingestion or network, so
assertions are reproducible. Verifies:

* honest UNAVAILABLE propagation through the DAG (a missing genesis does not
  fake downstream results),
* serial ``execute`` and parallel ``execute_parallel`` semantic parity,
* concurrent wave execution of independent branches (bounded wall time),
* the hazard engine still assembles a unified state over a settled DAG.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
import yaml

from src.core.schema import (
    Basin,
    CycloneCategory,
    CycloneState,
    FloodPrediction,
    GenesisPrediction,
    IntensityPrediction,
    LandslideGrid,
    LandslidePrediction,
    RIPrediction,
    RainfallPrediction,
    RecurvaturePrediction,
    RiskLevel,
    TrackPrediction,
    WindFieldPrediction,
)
from src.models.base import BaseModel, ModelInfo
from src.pipeline.orchestrator import ModuleName, create_orchestrator

REPO_ROOT = Path(__file__).resolve().parent.parent

pytestmark = pytest.mark.skipif(
    not (REPO_ROOT / "configs/pipeline.yaml").exists(),
    reason="pipeline config required",
)

REF_TIME = datetime(2020, 5, 15, 6, 0, 0, tzinfo=timezone.utc)

FIXTURE_STATE = CycloneState(
    storm_id="2020-TEST-E2E",
    basin=Basin.NORTH_INDIAN,
    timestamp=REF_TIME,
    latitude=15.0,
    longitude=85.0,
    max_wind_kt=45.0,
    central_pressure_hpa=985.0,
)


class SleepPrediction(BaseModel):
    """A minimal model that delays predict() to exercise concurrency."""

    def __init__(self, model_type: str, prediction, delay_s: float = 0.0):
        info = ModelInfo(
            name=f"mock_{model_type}",
            version="v1.0",
            model_type=model_type,
            loaded_at=datetime.now(timezone.utc),
        )
        super().__init__(info)
        self._is_loaded = True
        self._prediction = prediction
        self._delay_s = delay_s

    def load(self, checkpoint_path: str, **kwargs):
        pass

    def validate_input(self, input_data) -> bool:
        return True

    def predict(self, *args, **kwargs):
        if self._delay_s:
            time.sleep(self._delay_s)
        return self._prediction

    def explain(self, input_data, prediction):
        return {"explanation": "mock"}


def _prediction_for(module: ModuleName, delay_s: float = 0.0):
    if module == ModuleName.GENESIS:
        obj = GenesisPrediction(
            probability_24h=0.5, probability_48h=0.4, probability_72h=0.3,
            risk_level=RiskLevel.MODERATE, confidence=0.8, model_version="v1.0",
        )
    elif module == ModuleName.TRAJECTORY:
        obj = TrackPrediction(
            forecast_times=[REF_TIME],
            latitudes=[15.5], longitudes=[85.5],
            position_error_estimates_km=[25.0], uncertainty_km=[20.0],
            confidence=0.8, model_version="v1.0",
        )
    elif module == ModuleName.INTENSITY:
        obj = IntensityPrediction(
            predicted_msw_24h=65.0, predicted_category_24h=CycloneCategory.VSCS,
            uncertainty_kt=10.0, confidence=0.8, model_version="v1.0",
        )
    elif module == ModuleName.RI:
        obj = RIPrediction(
            probability_24h=0.3, risk_level=RiskLevel.LOW,
            confidence=0.7, model_version="v1.0",
        )
    elif module == ModuleName.RECURVATURE:
        obj = RecurvaturePrediction(
            probability=0.2, risk_level=RiskLevel.LOW,
            confidence=0.7, model_version="v1.0",
        )
    elif module == ModuleName.RAINFALL:
        obj = RainfallPrediction(model_version="v1.0", confidence=0.7)
    elif module == ModuleName.WIND:
        obj = WindFieldPrediction(wind_fields=[], model_version="v1.0", confidence=0.7)
    elif module == ModuleName.FLOOD:
        obj = FloodPrediction(
            probability_grid=np.zeros((2, 2)),
            risk_grid=np.zeros((2, 2), dtype=int),
            affected_area_km2=0.0, high_risk_regions=[],
            lats=np.linspace(15, 16, 2), lons=np.linspace(85, 86, 2),
            confidence=0.7, model_version="v1.0",
        )
    elif module == ModuleName.LANDSLIDE:
        obj = LandslidePrediction(
            probability_grid=LandslideGrid(
                probability_grid=np.zeros((2, 2)),
                risk_level_grid=np.zeros((2, 2), dtype=int),
                lats=np.linspace(15, 16, 2), lons=np.linspace(85, 86, 2),
            ),
            high_risk_regions=[], confidence=0.7, model_version="v1.0",
        )
    else:  # pragma: no cover
        raise ValueError(f"no fixture prediction for {module.value}")
    return SleepPrediction(module.value, obj, delay_s)


def _mock_all_modules(orchestrator, delay_map=None, exclude=(ModuleName.HAZARD_ENGINE,)):
    """Override every (non-excluded) module model with a deterministic stub."""
    delay_map = delay_map or {}
    for module, spec in orchestrator.dependency_graph.modules.items():
        if module in exclude:
            continue
        spec.model = _prediction_for(module, delay_s=delay_map.get(module, 0.0))


@pytest.fixture(scope="module")
def orchestrator():
    config = yaml.safe_load((REPO_ROOT / "configs/pipeline.yaml").read_text())
    return create_orchestrator(config)


class TestHonestUnavailablePropagation:
    """With real registered artifacts but no genesis model, every downstream
    module must report an explicit UNAVAILABLE reason instead of fabricating."""

    def test_full_dag_reports_explicit_statuses(self, orchestrator):
        assert set(orchestrator.results) == set()
        result = orchestrator.execute_parallel(
            storm_id=FIXTURE_STATE.storm_id,
            basin=FIXTURE_STATE.basin.value,
            reference_time=REF_TIME,
            mode="full",
            max_workers=4,
            cyclone_state=FIXTURE_STATE,
        )

        # Every declared module has an explicit ExecutionResult (nothing
        # silently vanished from the graph).
        assert set(orchestrator.results) == set(ModuleName)

        # Genesis is unregistered -> UNAVAILABLE with an honest reason.
        genesis = orchestrator.results[ModuleName.GENESIS]
        assert genesis.status == "UNAVAILABLE"
        assert not genesis.success
        assert genesis.output is None
        assert genesis.reason is not None

        # Registered track/RI models exist but their genesis dependency is
        # unavailable -> UNAVAILABLE with a dependency reason (no fake output).
        trajectory = orchestrator.results[ModuleName.TRAJECTORY]
        assert trajectory.status == "UNAVAILABLE"
        assert "dependency unavailable: genesis" in trajectory.reason
        assert trajectory.output is None

        ri = orchestrator.results[ModuleName.RI]
        assert ri.status == "UNAVAILABLE"
        assert "dependency unavailable: genesis" in ri.reason

        # Wind requires trajectory + intensity upstream -> UNAVAILABLE.
        wind = orchestrator.results[ModuleName.WIND]
        assert wind.status == "UNAVAILABLE"
        assert wind.output is None

        # The model-less hazard engine always assembles the unified state.
        assert orchestrator.results[ModuleName.HAZARD_ENGINE].status == "SUCCESS"

        # Unified state merges per-module status/reasons.
        assert result.module_status["genesis"] == "UNAVAILABLE"
        assert result.module_status["trajectory"] == "UNAVAILABLE"
        assert result.module_status["hazard_engine"] == "SUCCESS"
        # No risk levels anywhere -> honest "not assessed", never RiskLevel.NONE.
        assert result.overall_hazard_severity is None
        assert result.genesis is None
        assert result.track is None

    def test_unified_state_links_fixture_cyclone(self, orchestrator):
        result = orchestrator.execute_parallel(
            storm_id=FIXTURE_STATE.storm_id,
            basin=FIXTURE_STATE.basin.value,
            reference_time=REF_TIME,
            mode="full",
            max_workers=4,
            cyclone_state=FIXTURE_STATE,
        )
        assert result.cyclone.storm_id == "2020-TEST-E2E"
        assert result.cyclone.latitude == 15.0
        assert result.cyclone.longitude == 85.0


class TestSerialParallelParity:
    """Both execution paths must produce identical per-module statuses given
    the same (valid) inputs. Uses deterministic stub models for every module —
    the real trajectory adapter rejects minimal synthetic states, so a clean
    parity comparison needs fully valid module inputs."""

    def test_parallel_matches_serial_for_full_dag(self, orchestrator):
        _mock_all_modules(orchestrator)

        with patch.object(
            orchestrator.state_builder, "build_from_storm_id",
            return_value=FIXTURE_STATE,
        ):
            orchestrator.execute(
                storm_id=FIXTURE_STATE.storm_id,
                basin=FIXTURE_STATE.basin.value,
                reference_time=REF_TIME,
                mode="full",
            )
        serial = {m.value: r.status for m, r in orchestrator.results.items()}

        orchestrator.execute_parallel(
            storm_id=FIXTURE_STATE.storm_id,
            basin=FIXTURE_STATE.basin.value,
            reference_time=REF_TIME,
            mode="full",
            max_workers=4,
            cyclone_state=FIXTURE_STATE,
        )
        parallel = {m.value: r.status for m, r in orchestrator.results.items()}

        assert serial == parallel
        assert serial == {m.value: "SUCCESS" for m in ModuleName}
        # The unified state produced by both paths carries real module outputs.
        assert orchestrator.unified_state.genesis is not None
        assert orchestrator.unified_state.track is not None

    def test_parallel_full_success_outputs(self, orchestrator):
        """With every module stubbed, all upstream outputs flow into the
        parallel DAG and the hazard engine builds a populated state."""
        _mock_all_modules(orchestrator)
        result = orchestrator.execute_parallel(
            storm_id=FIXTURE_STATE.storm_id,
            basin=FIXTURE_STATE.basin.value,
            reference_time=REF_TIME,
            mode="full",
            max_workers=4,
            cyclone_state=FIXTURE_STATE,
        )
        assert result.genesis is not None
        assert result.track is not None
        assert result.rainfall is not None
        assert result.wind is not None
        assert result.flood is not None
        assert result.landslide is not None
        # At least one module carried a risk level -> composite is assessed.
        assert result.overall_hazard_severity is not None


class TestParallelWaveConcurrency:
    """Independent branches of the second wave run concurrently."""

    def test_independent_branches_run_concurrently(self, orchestrator):
        deps = orchestrator.dependency_graph.get_dependencies
        # Genesis first; trajectory/intensity/ri run as soon as genesis resolves
        # (they depend only on genesis). Recurvature waits for trajectory.
        assert set(deps(ModuleName.TRAJECTORY)) == {ModuleName.GENESIS}
        assert set(deps(ModuleName.INTENSITY)) == {ModuleName.GENESIS}
        assert set(deps(ModuleName.RI)) == {ModuleName.GENESIS}
        assert set(deps(ModuleName.RECURVATURE)) == {ModuleName.TRAJECTORY}

        _mock_all_modules(
            orchestrator,
            delay_map={
                ModuleName.TRAJECTORY: 0.3,
                ModuleName.INTENSITY: 0.3,
                ModuleName.RI: 0.3,
            },
        )

        start = time.perf_counter()
        orchestrator.execute_parallel(
            storm_id=FIXTURE_STATE.storm_id,
            basin=FIXTURE_STATE.basin.value,
            reference_time=REF_TIME,
            modules=[ModuleName.GENESIS, ModuleName.TRAJECTORY,
                     ModuleName.INTENSITY, ModuleName.RI],
            mode="custom",
            max_workers=4,
            cyclone_state=FIXTURE_STATE,
        )
        elapsed = time.perf_counter() - start

        for module in [ModuleName.GENESIS, ModuleName.TRAJECTORY,
                       ModuleName.INTENSITY, ModuleName.RI]:
            assert orchestrator.results[module].status == "SUCCESS", module

        # Three 0.3s branches in parallel complete in well under the 0.9s a
        # serial run would need (thread scheduling noise kept well clear).
        assert elapsed < 0.8, f"parallel waves did not run concurrently: {elapsed:.2f}s"