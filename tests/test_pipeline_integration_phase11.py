"""Phase 11 end-to-end integration tests.

Pins the audited status-propagation contracts end-to-end:

TRACK
  - ``TrackPrediction`` carries ``status``/``explanation`` (previously dropped)
  - the real trajectory adapter reports LIMITTED/UNVERIFIED uncertainty in the
    prediction itself, not only via the separate uncertainty dict
  - the status survives the CLI's ``model_dump(mode='json')`` serialization

ORCHESTRATOR
  - an adapter that runs and returns an object with an UNAVAILABLE-class
    status is downgraded to ``ExecutionResult(success=False, status="UNAVAILABLE")``
    instead of being silently reported as SUCCESS
  - LIMITED/UNVERIFIED/BASELINE-class outputs (the module genuinely ran) are
    NOT downgraded

HAZARD ENGINE
  - with zero assessed components the composite severity is ``None`` (not
    assessed), NOT ``RiskLevel.NONE`` (assessed-and-low)
  - with usable components the composite severity is a real RiskLevel
"""

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from src.core.schema import (
    Basin,
    CycloneState,
    GenesisPrediction,
    IntensityPrediction,
    RainfallPrediction,
    RecurvaturePrediction,
    RIPrediction,
    RiskLevel,
    TrackPrediction,
    UnifiedForecastState,
    WindFieldPrediction,
    FloodPrediction,
    LandslidePrediction,
    LandslideGrid,
    CycloneCategory,
)
from src.models.base import BaseModel, ModelInfo
from src.models.adapters.trajectory_adapter import create_trajectory_adapter
from src.pipeline.hazard_engine import HazardRiskEngine
from src.pipeline.orchestrator import ModuleName, PipelineOrchestrator
from src.pipeline.orchestrator import create_orchestrator

from unittest.mock import Mock, patch

NOW = datetime.now(timezone.utc)


def _cyclone_state(**overrides) -> CycloneState:
    defaults = dict(
        storm_id="2024-001",
        basin=Basin.BAY_OF_BENGAL,
        timestamp=NOW,
        latitude=15.0,
        longitude=85.0,
        max_wind_kt=65.0,
        central_pressure_hpa=980.0,
        heading_deg=280.0,
        translation_speed_kt=10.0,
    )
    defaults.update(overrides)
    return CycloneState(**defaults)


# --------------------------------------------------------------------------
# TRACK: status/explanation carried on the schema
# --------------------------------------------------------------------------


class TestTrackPredictionStatus:

    def test_track_prediction_schema_carries_status_and_explanation(self):
        track = TrackPrediction(
            forecast_times=[NOW + timedelta(hours=6)],
            latitudes=[15.5],
            longitudes=[85.5],
            position_error_estimates_km=[209.9],
            uncertainty_km=[209.9],
            confidence=0.8,
            model_version="lt3p",
            status="LIMITED/UNVERIFIED",
            explanation="uncertainty head saturates at ~209.9 km",
        )
        assert track.status == "LIMITED/UNVERIFIED"
        assert "saturates" in track.explanation

    def test_track_prediction_status_survives_json_serialization(self):
        track = TrackPrediction(
            forecast_times=[NOW],
            latitudes=[15.5],
            longitudes=[85.5],
            position_error_estimates_km=[25.0],
            uncertainty_km=[20.0],
            confidence=0.8,
            model_version="lt3p",
            status="LIMITED/UNVERIFIED",
            explanation="saturated ~209.9 km band; not calibrated",
        )
        # The CLI persists UnifiedForecastState via model_dump(mode='json').
        state = UnifiedForecastState(
            cyclone=_cyclone_state(),
            track=track,
            confidence=0.8,
        )
        dumped = state.model_dump(mode="json")
        assert dumped["track"]["status"] == "LIMITED/UNVERIFIED"
        assert "saturated" in dumped["track"]["explanation"]

    def test_real_trajectory_adapter_populates_limited_status(self):
        adapter = create_trajectory_adapter("best_cyclone_model_lt3p_distilled.pth")
        track = adapter.predict(_cyclone_state())
        assert track.status == "LIMITED/UNVERIFIED"
        assert "saturat" in track.explanation.lower()


# --------------------------------------------------------------------------
# ORCHESTRATOR: adapter UNAVAILABLE output is never reported as SUCCESS
# --------------------------------------------------------------------------


class _StubModel(BaseModel):
    """Model that returns a fixed pre-built prediction object."""

    def __init__(self, model_type: str, prediction):
        info = ModelInfo(
            name=f"stub_{model_type}",
            version="v1.0",
            model_type=model_type,
            loaded_at=NOW,
        )
        super().__init__(info)
        self._prediction = prediction
        self._is_loaded = True

    def load(self, checkpoint_path: str, **kwargs):
        pass

    def predict(self, *args, **kwargs):
        return self._prediction

    def validate_input(self, input_data) -> bool:
        return True

    def explain(self, input_data, prediction) -> dict:
        return {}


def _orchestrator_with_models(model_map) -> PipelineOrchestrator:
    config = {
        "data": {},
        "harmonization": {},
        "models": {m: {"name": m, "version": "v1"} for m in model_map},
        "hazard_engine": {},
        "registry_dir": "models/registry",
    }
    mock_registry = Mock()
    mock_registry.get_latest.return_value = None
    with patch("src.pipeline.orchestrator.get_registry", return_value=mock_registry):
        with patch("src.pipeline.orchestrator.CycloneStateBuilder"):
            orchestrator = PipelineOrchestrator(config, mock_registry)
    orchestrator.state_builder = Mock()
    orchestrator.state_builder.build_from_storm_id.return_value = _cyclone_state()
    for name, model in model_map.items():
        orchestrator.dependency_graph.modules[name].model = model
    return orchestrator


class TestOrchestratorStatusPropagation:

    def test_adapter_unavailable_status_downgrades_execution_result(self):
        """An RI adapter returning status='UNAVAILABLE' must NOT be reported as
        a SUCCESS module (the UI would otherwise render fabricated values)."""
        ri_unavailable = RIPrediction(
            probability_24h=0.0,
            risk_level=RiskLevel.NONE,
            confidence=0.0,
            model_version="v1.0",
            status="UNAVAILABLE",
        )
        orchestrator = _orchestrator_with_models({
            ModuleName.RI: _StubModel("ri", ri_unavailable),
        })

        orchestrator.execute(
            storm_id="2024-001",
            basin="BOB",
            reference_time=NOW,
            mode="full",
        )

        result = orchestrator.results[ModuleName.RI]
        assert not result.success
        assert result.status == "UNAVAILABLE"
        assert "adapter reports status=UNAVAILABLE" in result.reason

    def test_limited_status_kept_as_success(self):
        """LIMITED/UNVERIFIED means the module genuinely ran — it must NOT be
        downgraded to UNAVAILABLE."""
        track = TrackPrediction(
            forecast_times=[NOW + timedelta(hours=6)],
            latitudes=[15.5],
            longitudes=[85.5],
            position_error_estimates_km=[209.9],
            uncertainty_km=[209.9],
            confidence=0.8,
            model_version="lt3p",
            status="LIMITED/UNVERIFIED",
            explanation="saturated ~209.9 km band",
        )
        orchestrator = _orchestrator_with_models({
            ModuleName.TRAJECTORY: _StubModel("trajectory", track),
        })

        orchestrator.execute(
            storm_id="2024-001",
            basin="BOB",
            reference_time=NOW,
            mode="full",
        )

        result = orchestrator.results[ModuleName.TRAJECTORY]
        assert result.success
        assert result.status == "SUCCESS"
        assert result.output.status == "LIMITED/UNVERIFIED"

    def test_unavailable_adapter_propagates_to_unified_state(self):
        """Module status metadata reaches UnifiedForecastState so the frontend
        API can reflect reality."""
        ri_unavailable = RIPrediction(
            probability_24h=0.0,
            risk_level=RiskLevel.NONE,
            confidence=0.0,
            model_version="v1.0",
            status="UNAVAILABLE",
        )
        genesis_ok = GenesisPrediction(
            probability_24h=0.5,
            probability_48h=0.4,
            probability_72h=0.3,
            risk_level=RiskLevel.MODERATE,
            confidence=0.8,
            model_version="v1.0",
        )
        orchestrator = _orchestrator_with_models({
            ModuleName.GENESIS: _StubModel("genesis", genesis_ok),
            ModuleName.RI: _StubModel("ri", ri_unavailable),
        })

        state = orchestrator.execute(
            storm_id="2024-001",
            basin="BOB",
            reference_time=NOW,
            mode="full",
        )

        assert isinstance(state, UnifiedForecastState)
        assert state.module_status["genesis"] == "SUCCESS"
        assert state.module_status["ri"] == "UNAVAILABLE"
        assert state.module_status["hazard_engine"] == "SUCCESS"
        assert "adapter reports status=UNAVAILABLE" in state.module_reasons["ri"]


# --------------------------------------------------------------------------
# HAZARD ENGINE: None (not assessed) vs RiskLevel.NONE (assessed-and-low)
# --------------------------------------------------------------------------


class TestHazardEngineSeverity:

    def test_no_assessed_components_returns_none_severity(self):
        engine = HazardRiskEngine({})
        state = engine.compute(cyclone_state=_cyclone_state())
        assert state.assessed_hazards == []
        assert state.overall_hazard_severity is None

    def test_unavailable_only_components_returns_none_severity(self):
        """UNAVAILABLE/static placeholders remain unassessed, so the composite
        must not claim a low-risk NONE level."""
        engine = HazardRiskEngine({})
        ri_unavailable = RIPrediction(
            probability_24h=0.0,
            risk_level=RiskLevel.NONE,
            confidence=0.0,
            model_version="v1.0",
            status="UNAVAILABLE",
        )
        intensity_unavailable = IntensityPrediction(
            predicted_msw_24h=0.0,
            predicted_category_24h=CycloneCategory.D,
            uncertainty_kt=0.0,
            confidence=0.0,
            model_version="v1.0",
            status="UNAVAILABLE",
        )
        state = engine.compute(
            cyclone_state=_cyclone_state(),
            ri=ri_unavailable,
            intensity=intensity_unavailable,
        )
        assert state.assessed_hazards == []
        assert set(state.unassessed_hazards) == {"ri", "intensity"}
        assert state.overall_hazard_severity is None

    def test_assessed_components_return_real_risk_level(self):
        engine = HazardRiskEngine({})
        intensity_ok = IntensityPrediction(
            predicted_msw_24h=95.0,
            predicted_category_24h=CycloneCategory.VSCS,
            uncertainty_kt=10.0,
            confidence=0.8,
            model_version="v1.0",
            status="AVAILABLE",
        )
        state = engine.compute(
            cyclone_state=_cyclone_state(),
            intensity=intensity_ok,
        )
        assert state.assessed_hazards == ["intensity"]
        assert state.overall_hazard_severity is not None
        assert state.overall_hazard_severity in RiskLevel


# --------------------------------------------------------------------------
# FULL DAG: status composition across the whole pipeline
# --------------------------------------------------------------------------


class TestFullDagStatusPropagation:

    def test_full_dag_unavailable_ri_and_intensity_stay_present(self):
        """Run the full graph where RI and intensity are UNAVAILABLE at the
        adapter level; rainfall/wind/flood/landslide must become UNAVAILABLE
        via the intensity dependency, while the model-less hazard engine still
        assembles a valid unified state with no fabricated severity."""
        models = {
            ModuleName.GENESIS: _StubModel("genesis", GenesisPrediction(
                probability_24h=0.5, probability_48h=0.4, probability_72h=0.3,
                risk_level=RiskLevel.MODERATE, confidence=0.8, model_version="v1.0",
            )),
            ModuleName.TRAJECTORY: _StubModel("trajectory", TrackPrediction(
                forecast_times=[NOW + timedelta(hours=6)],
                latitudes=[15.5], longitudes=[85.5],
                position_error_estimates_km=[209.9], uncertainty_km=[209.9],
                confidence=0.8, model_version="lt3p",
                status="LIMITED/UNVERIFIED", explanation="saturated band",
            )),
            ModuleName.INTENSITY: _StubModel("intensity", IntensityPrediction(
                predicted_msw_24h=0.0, predicted_category_24h=CycloneCategory.D,
                uncertainty_kt=0.0, confidence=0.0, model_version="v1.0",
                status="UNAVAILABLE",
            )),
            ModuleName.RI: _StubModel("ri", RIPrediction(
                probability_24h=0.0, risk_level=RiskLevel.NONE, confidence=0.0,
                model_version="v1.0", status="UNAVAILABLE",
            )),
            ModuleName.RECURVATURE: _StubModel("recurvature", RecurvaturePrediction(
                probability=0.2, risk_level=RiskLevel.LOW, confidence=0.7,
                model_version="v1.0",
            )),
        }
        orchestrator = _orchestrator_with_models(models)

        state = orchestrator.execute(
            storm_id="2024-001",
            basin="BOB",
            reference_time=NOW,
            mode="full",
        )

        results = orchestrator.results
        assert results[ModuleName.GENESIS].status == "SUCCESS"
        assert results[ModuleName.TRAJECTORY].status == "SUCCESS"
        assert results[ModuleName.INTENSITY].status == "UNAVAILABLE"
        assert results[ModuleName.RI].status == "UNAVAILABLE"
        assert results[ModuleName.RECURVATURE].status == "SUCCESS"

        # rainfall/wind depend on intensity -> UNAVAILABLE
        assert results[ModuleName.RAINFALL].status == "UNAVAILABLE"
        assert results[ModuleName.WIND].status == "UNAVAILABLE"
        # flood/landslide depend on rainfall -> UNAVAILABLE
        assert results[ModuleName.FLOOD].status == "UNAVAILABLE"
        assert results[ModuleName.LANDSLIDE].status == "UNAVAILABLE"

        # The model-less hazard engine always assembles the unified state
        assert results[ModuleName.HAZARD_ENGINE].status == "SUCCESS"
        assert isinstance(state, UnifiedForecastState)
        assert state.overall_hazard_severity is None  # nothing assessed

        # JSON serialization preserves the per-module status map
        dumped = state.model_dump(mode="json")
        assert dumped["module_status"]["intensity"] == "UNAVAILABLE"
        assert dumped["module_status"]["ri"] == "UNAVAILABLE"
        assert dumped["track"]["status"] == "LIMITED/UNVERIFIED"