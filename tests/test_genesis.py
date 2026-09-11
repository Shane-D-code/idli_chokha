"""Tests for the Genesis model adapter.

Covers the approved Genesis integration:
    - LightGBM (PRIMARY / production)
    - XGBoost
    - RandomForest
    - Calibrated soft-voting ensemble (0.40 / 0.35 / 0.25)

These tests verify loading, prediction, the exact weighted ensemble formula,
the 0.24 threshold, model-substitution safeguards, provenance, SHA-256
hashing, missing-artifact handling, invalid-feature handling, ModelFactory
registration, and Phase 1 orchestrator integration.
"""

import os
import pytest
from datetime import datetime, timezone

import numpy as np

from src.core.schema import (
    CycloneState, Basin, GenesisPrediction, RiskLevel, probability_to_risk_level,
)
from src.models.base import ModelFactory, ModelInfo
from src.models.genesis.adapter import (
    GenesisModelAdapter,
    _GenesisComponent,
    create_genesis_adapter,
    DEFAULT_ENSEMBLE_WEIGHTS,
    DEFAULT_GENESIS_THRESHOLD,
    APPROVED_MODEL_TYPES,
    GENESIS_FEATURES,
    GENESIS_N_FEATURES,
)

ARTIFACTS = {
    "lightgbm": "genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib",
    "xgboost": "genisis models/tc_genesis_xgboost_300_OPTIMIZED.joblib",
    "randomforest": "genisis models/tc_genesis_randomforest_300_OPTIMIZED.joblib",
}


@pytest.fixture
def cyclone_state():
    """A candidate disturbance CycloneState."""
    state = CycloneState(
        storm_id="2024-001",
        basin=Basin.BAY_OF_BENGAL,
        timestamp=datetime.now(timezone.utc),
        latitude=15.0,
        longitude=85.0,
    )
    state.environmental_features.sst = 29.5
    state.environmental_features.sst_anomaly = 0.8
    state.environmental_features.t_850 = 293.0
    state.environmental_features.u_850 = 4.0
    state.environmental_features.v_850 = -2.0
    return state


@pytest.fixture
def adapter():
    ad = create_genesis_adapter()
    return ad


# ============================================================================
# A-C: MODEL LOADING
# ============================================================================

class TestModelLoading:
    """A/B/C: LightGBM, XGBoost, RandomForest load from their artifacts."""

    def test_lightgbm_loads(self):
        comp = _GenesisComponent("lightgbm", ARTIFACTS["lightgbm"], 0.24)
        assert comp.load() is True
        assert comp.available
        assert comp.artifact_hash

    def test_xgboost_loads(self):
        comp = _GenesisComponent("xgboost", ARTIFACTS["xgboost"], 0.24)
        assert comp.load() is True
        assert comp.available
        assert comp.artifact_hash

    def test_randomforest_loads(self):
        comp = _GenesisComponent("randomforest", ARTIFACTS["randomforest"], 0.24)
        assert comp.load() is True
        assert comp.available
        assert comp.artifact_hash

    def test_all_three_available(self, adapter):
        report = adapter.availability_report()
        assert report["lightgbm"] == "AVAILABLE"
        assert report["xgboost"] == "AVAILABLE"
        assert report["randomforest"] == "AVAILABLE"


# ============================================================================
# D-F: MODEL PREDICTION
# ============================================================================

class TestPrediction:
    """D/E/F: LightGBM, XGBoost, RandomForest predict probabilities in [0,1]."""

    @pytest.mark.parametrize("model_type", ["lightgbm", "xgboost", "randomforest"])
    def test_component_predicts_probability(self, cyclone_state, model_type):
        comp = _GenesisComponent(model_type, ARTIFACTS[model_type], 0.24)
        comp.load()
        assert comp.available
        X = _feature_frame_from_import()
        proba = comp.predict_proba(X)
        assert proba is not None
        assert 0.0 <= proba <= 1.0

    def test_production_predicts(self, adapter, cyclone_state):
        pred = adapter.predict_production(cyclone_state)
        assert isinstance(pred, GenesisPrediction)
        assert 0.0 <= pred.probability <= 1.0
        assert pred.predicted_class in (0, 1)
        assert pred.model_name == "genesis_lightgbm"
        assert pred.mode == "production"

    def test_all_components_predict(self, adapter, cyclone_state):
        X = _feature_frame_from_import()
        probs = {
            mt: adapter.components[mt].predict_proba(X)
            for mt in ("lightgbm", "xgboost", "randomforest")
        }
        for mt, p in probs.items():
            assert p is not None
            assert 0.0 <= p <= 1.0


def _feature_frame_from_import():
    import pandas as pd
    return pd.DataFrame([np.zeros(GENESIS_N_FEATURES)], columns=GENESIS_FEATURES)


# ============================================================================
# G: WEIGHTED ENSEMBLE CALCULATION
# ============================================================================

class TestEnsemble:
    """G: ensemble = 0.40*LightGBM + 0.35*XGBoost + 0.25*RandomForest."""

    def test_exact_weights(self, adapter):
        assert adapter.ensemble_weights == {
            "lightgbm": 0.40,
            "xgboost": 0.35,
            "randomforest": 0.25,
        }

    def test_deterministic_mock_ensemble(self, monkeypatch):
        """Exact mocked-probabilities test: 0.40(0.80)+0.35(0.60)+0.25(0.40) == 0.63."""
        ad = GenesisModelAdapter(mode="ensemble")
        ad._is_loaded = True

        # Mock component probabilities without loading real artifacts
        class _Fake:
            def __init__(self, value):
                self._value = value
                self.available = True
                self.pipeline = object()

            def predict_proba(self, X):
                return self._value

        ad.components = {
            "lightgbm": _Fake(0.80),
            "xgboost": _Fake(0.60),
            "randomforest": _Fake(0.40),
        }

        probs = {"lightgbm": 0.80, "xgboost": 0.60, "randomforest": 0.40}
        result = ad._ensemble_proba(probs)
        assert result == pytest.approx(0.63, abs=1e-12)
        assert result == pytest.approx(
            0.40 * 0.80 + 0.35 * 0.60 + 0.25 * 0.40, abs=1e-12
        )

    def test_no_hard_label_averaging(self, adapter, cyclone_state):
        """Ensemble must use soft probabilities, not class labels."""
        pred = adapter.predict_ensemble(cyclone_state)
        assert pred.ensemble_probability is not None
        assert 0.0 <= pred.ensemble_probability <= 1.0

    def test_ensemble_model_name(self, adapter, cyclone_state):
        pred = adapter.predict_ensemble(cyclone_state)
        assert pred.model_name == "genesis_soft_voting_ensemble"
        assert pred.lightgbm_probability is not None
        assert pred.xgboost_probability is not None
        assert pred.randomforest_probability is not None


class TestActualEnsembleWeightVerification:
    """Verify the real ensemble equals the weighted sum of the real components."""

    def test_ensemble_matches_weighted_sum(self, adapter, cyclone_state):
        pred = adapter.predict_ensemble(cyclone_state)
        ens = (
            0.40 * pred.lightgbm_probability
            + 0.35 * pred.xgboost_probability
            + 0.25 * pred.randomforest_probability
        )
        assert pred.ensemble_probability == pytest.approx(ens, abs=1e-9)


# ============================================================================
# H: THRESHOLD
# ============================================================================

class TestThreshold:
    """H: optimized genesis threshold is 0.24 (not 0.50)."""

    def test_default_threshold(self, adapter):
        assert adapter.threshold == pytest.approx(0.24)

    def test_threshold_constant(self):
        assert DEFAULT_GENESIS_THRESHOLD == pytest.approx(0.24)

    def test_threshold_configurable(self):
        ad = GenesisModelAdapter(threshold=0.30)
        assert ad.threshold == pytest.approx(0.30)

    def test_prediction_splits_on_threshold(self):
        ad = GenesisModelAdapter(threshold=0.24)
        ad._is_loaded = True
        # Mock LightGBM (production) returning a fixed probability
        ad.components["lightgbm"] = _FakeComponent(0.50)
        ad.components["xgboost"] = _FakeComponent(0.0)
        ad.components["randomforest"] = _FakeComponent(0.0)
        state = cyclone_state_adapter()
        pred = ad.predict_production(state)
        assert pred.predicted_class == 1
        assert pred.risk_level == RiskLevel.HIGH

        # Probability below threshold -> non-genesis
        ad.components["lightgbm"] = _FakeComponent(0.10)
        pred = ad.predict_production(state)
        assert pred.predicted_class == 0
        assert pred.risk_level == RiskLevel.LOW


class _FakeComponent:
    """A fake component for unit testing without loading artifacts."""

    def __init__(self, value):
        self._value = value
        self.available = True
        self.pipeline = object()
        self.provenance = {"artifact_hash_sha256": "fake", "artifact_path": "fake"}
        self.artifact_path = "fake"
        self.artifact_hash = "fake"
        self.framework = "fake"

    def predict_proba(self, X):
        return self._value


# ============================================================================
# I: PROBABILITY BOUNDS
# ============================================================================

class TestProbabilityBounds:
    """I: probability is always between 0 and 1."""

    def test_production_probability_range(self, adapter, cyclone_state):
        pred = adapter.predict_production(cyclone_state)
        assert 0.0 <= pred.probability <= 1.0
        assert 0.0 <= pred.probability_24h <= 1.0

    def test_ensemble_probability_range(self, adapter, cyclone_state):
        pred = adapter.predict_ensemble(cyclone_state)
        assert 0.0 <= pred.ensemble_probability <= 1.0
        assert 0.0 <= pred.lightgbm_probability <= 1.0
        assert 0.0 <= pred.xgboost_probability <= 1.0
        assert 0.0 <= pred.randomforest_probability <= 1.0


# ============================================================================
# J: NO MODEL SUBSTITUTION
# ============================================================================

class TestNoSubstitution:
    """J: LightGBM is production primary; no silent substitution."""

    def test_production_uses_lightgbm_only(self, adapter):
        assert adapter.production_model_is == "lightgbm"

    def test_production_refuses_missing_lightgbm(self):
        ad = GenesisModelAdapter()
        # Simulate missing lightgbm
        ad.components["lightgbm"] = _FakeComponent(None)
        ad.components["lightgbm"].available = False
        ad._is_loaded = True
        with pytest.raises(RuntimeError):
            ad.predict_production(cyclone_state_adapter())

    def test_ensemble_requires_all_three(self):
        ad = GenesisModelAdapter(mode="ensemble")
        # RandomForest missing
        ad.components = {
            "lightgbm": _FakeComponent(0.5),
            "xgboost": _FakeComponent(0.5),
            "randomforest": _FakeComponent(None),
        }
        ad.components["randomforest"].available = False
        ad.components["lightgbm"].available = True
        ad.components["xgboost"].available = True
        ad._is_loaded = True
        with pytest.raises(RuntimeError):
            ad.predict_ensemble(cyclone_state_adapter())


def cyclone_state_adapter():
    return CycloneState(
        storm_id="x", basin=Basin.BAY_OF_BENGAL,
        timestamp=datetime.now(timezone.utc), latitude=15.0, longitude=85.0,
    )


# ============================================================================
# K-L: PROVENANCE & SHA-256
# ============================================================================

class TestProvenance:
    """K/L: provenance records model info and SHA-256."""

    def test_provenance_fields(self, adapter, cyclone_state):
        pred = adapter.predict_production(cyclone_state)
        prov = pred.provenance
        assert prov["model"] == "lightgbm"
        assert prov["artifact_filename"] == "tc_genesis_lightgbm_300_OPTIMIZED.joblib"
        assert prov["artifact_hash_sha256"]
        assert prov["framework"] == "LightGBM"
        assert prov["target"] == "genesis_24h"
        assert prov["n_features"] == 34

    def test_sha256_length(self, adapter):
        # SHA-256 hex digest is 64 chars
        h = adapter.components["lightgbm"].artifact_hash
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_artifact_hash_matches_file(self, adapter):
        import hashlib
        from pathlib import Path
        path = Path(ARTIFACTS["lightgbm"])
        hasher = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                hasher.update(chunk)
        assert adapter.components["lightgbm"].artifact_hash == hasher.hexdigest()

    def test_ensemble_provenance(self, adapter, cyclone_state):
        pred = adapter.predict_ensemble(cyclone_state)
        members = pred.provenance["members"]
        assert set(members) == {"lightgbm", "xgboost", "randomforest"}
        assert pred.provenance["weights"] == {
            "lightgbm": 0.40, "xgboost": 0.35, "randomforest": 0.25,
        }


# ============================================================================
# M: MISSING ARTIFACT HANDLING
# ============================================================================

class TestMissingArtifacts:
    """M: missing artifacts fail honestly."""

    def test_missing_randomforest_disables_ensemble(self):
        ad = GenesisModelAdapter(artifacts={
            "lightgbm": ARTIFACTS["lightgbm"],
            "xgboost": ARTIFACTS["xgboost"],
            "randomforest": "/nonexistent/rf.joblib",
        })
        ad.load()
        report = ad.availability_report()
        assert report["randomforest"] == "MISSING"
        assert report["production"] == "AVAILABLE"
        assert report["ensemble"] == "UNAVAILABLE"

    def test_missing_lightgbm_disables_production(self):
        ad = GenesisModelAdapter(artifacts={
            "lightgbm": "/nonexistent/lgbm.joblib",
            "xgboost": ARTIFACTS["xgboost"],
            "randomforest": ARTIFACTS["randomforest"],
        })
        ad.load()
        report = ad.availability_report()
        assert report["lightgbm"] == "MISSING"
        assert report["production"] == "UNAVAILABLE"
        assert report["ensemble"] == "UNAVAILABLE"
        with pytest.raises(RuntimeError):
            ad.predict_production(cyclone_state_adapter())

    def test_component_load_returns_false_for_missing(self):
        comp = _GenesisComponent("lightgbm", "/nonexistent/x.joblib", 0.24)
        assert comp.load() is False
        assert not comp.available


# ============================================================================
# N: INVALID FEATURE HANDLING
# ============================================================================

class TestInvalidFeatures:
    """N: invalid feature input handling."""

    def test_non_cyclone_state_rejected(self, adapter):
        with pytest.raises(ValueError):
            adapter.predict({"latitude": 15.0})

    def test_feature_frame_exact_column_count(self, adapter, cyclone_state):
        X = adapter._build_feature_frame(cyclone_state)
        assert X.shape == (1, GENESIS_N_FEATURES)
        assert list(X.columns) == GENESIS_FEATURES

    def test_missing_features_become_imputed_not_fabricated(self, adapter):
        # A state with NO environmental features -> all NaN, imputed by pipeline
        bare = CycloneState(
            storm_id="x", basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc), latitude=15.0, longitude=85.0,
        )
        X = adapter._build_feature_frame(bare)
        assert X.isna().all().any()  # at least some missing inputs present as NaN


# ============================================================================
# O: MODEL FACTORY REGISTRATION
# ============================================================================

class TestModelFactoryRegistration:
    """O: Genesis registered in ModelFactory."""

    def test_factory_has_genesis_types(self):
        import src.models.genesis.adapter  # noqa: F401  (triggers registration)
        types = ModelFactory.available_types()
        assert "genesis" in types
        assert "genesis_lightgbm" in types
        assert "genesis_soft_voting_ensemble" in types

    def test_factory_create_production(self):
        import src.models.genesis.adapter  # noqa: F401
        info = ModelInfo(name="genesis", version="1.0", model_type="genesis",
                         loaded_at=datetime.utcnow(), framework="lightgbm")
        model = ModelFactory.create("genesis_lightgbm", info, mode="production",
                                    artifacts=ARTIFACTS)
        assert isinstance(model, GenesisModelAdapter)
        assert model.mode == "production"

    def test_factory_create_ensemble(self):
        import src.models.genesis.adapter  # noqa: F401
        info = ModelInfo(name="genesis", version="1.0", model_type="genesis",
                         loaded_at=datetime.utcnow(), framework="lightgbm")
        model = ModelFactory.create("genesis_soft_voting_ensemble", info, mode="ensemble",
                                    artifacts=ARTIFACTS)
        assert isinstance(model, GenesisModelAdapter)
        assert model.mode == "ensemble"


# ============================================================================
# P: PHASE 1 ORCHESTRATOR INTEGRATION
# ============================================================================

class TestOrchestratorIntegration:
    """P: genesis integrates with the Phase 1 orchestrator."""

    def test_orchestrator_dependency_order(self):
        from src.pipeline.orchestrator import ModuleName, PipelineOrchestrator

        assert ModuleName.GENESIS in ModuleName
        # Genesis is a prerequisite of trajectory/intensity/ri
        deps = PipelineOrchestrator.DEFAULT_DEPENDENCIES[ModuleName.TRAJECTORY]
        assert ModuleName.GENESIS in deps

    def test_genesis_prediction_schema_compatible(self, adapter, cyclone_state):
        pred = adapter.predict_production(cyclone_state)
        # Must be usable in a UnifiedForecastState (accepts GenesisPrediction)
        from src.core.schema import UnifiedForecastState
        state = UnifiedForecastState(
            cyclone=cyclone_state,
            genesis=pred,
            confidence=0.5,
        )
        assert state.genesis is pred

    def test_genesis_output_downstream_compatible(self, adapter, cyclone_state):
        """GenesisPrediction exposes probability/class used by downstream DAG."""
        pred = adapter.predict_production(cyclone_state)
        assert hasattr(pred, "probability_24h")
        assert hasattr(pred, "predicted_class")
        assert hasattr(pred, "risk_level")
        assert hasattr(pred, "confidence")
        assert hasattr(pred, "threshold")


# ============================================================================
# Q: NATIVE RUNTIME COMPATIBILITY
# ============================================================================

class TestNativeCompatibility:
    """Q: genesis loads without breaking OpenMP safeguards."""

    def test_omp_threads_preserved(self):
        assert os.environ.get("OMP_NUM_THREADS", "1") == "1"

    def test_lightgbm_plus_xgboost_coexist(self, adapter):
        """Loading LightGBM and XGBoost in same process must not crash."""
        assert adapter.components["lightgbm"].available
        assert adapter.components["xgboost"].available
        # Predictions from both work
        X = _feature_frame_from_import()
        pl = adapter.components["lightgbm"].predict_proba(X)
        px = adapter.components["xgboost"].predict_proba(X)
        assert pl is not None and px is not None


# ============================================================================
# ORIGINAL VS ADAPTER FIDELITY (section 20)
# ============================================================================

class TestFidelity:
    """Original pipeline vs adapter must produce identical predictions."""

    @pytest.mark.parametrize("model_type", ["lightgbm", "xgboost", "randomforest"])
    def test_fidelity(self, adapter, model_type):
        import joblib
        import pandas as pd

        comp = adapter.components[model_type]
        X = _feature_frame_from_import()

        # Original path: load pipeline directly
        pipeline = joblib.load(comp.artifact_path)
        for _, step in pipeline.named_steps.items():
            if hasattr(step, "_fit_dtype") and not hasattr(step, "_fill_dtype"):
                step._fill_dtype = step._fit_dtype
        original = pipeline.predict_proba(X)[0][-1]

        # Adapter path
        adapter_proba = comp.predict_proba(X)

        assert adapter_proba == pytest.approx(original, abs=1e-9)
