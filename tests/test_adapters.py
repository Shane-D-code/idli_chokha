"""Integration tests for model adapters."""

import numpy as np
import pytest
import warnings
from datetime import datetime, timezone

from src.core.schema import (
    CycloneState, Basin, TrackPrediction, RecurvaturePrediction, RIPrediction,
    RiskLevel, SatelliteImages,
)
from src.models.adapters.trajectory_adapter import create_trajectory_adapter
from src.models.adapters.recurvature_adapter import create_recurvature_adapter
from src.models.adapters.ri_adapter import create_ri_adapter


class TestTrajectoryAdapter:
    """Test trajectory model adapter."""

    @pytest.fixture
    def adapter(self):
        """Create and load trajectory adapter using the deployed LT3P artifact."""
        adapter = create_trajectory_adapter('best_cyclone_model_lt3p_distilled.pth')
        return adapter

    @pytest.fixture
    def cyclone_state(self):
        """Create a test CycloneState."""
        return CycloneState(
            storm_id='2024-001',
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.0,
            longitude=85.0,
            max_wind_kt=65.0,
            central_pressure_hpa=980.0,
            heading_deg=280.0,
            translation_speed_kt=10.0,
        )

    def test_adapter_loads(self, adapter):
        """Test that adapter loads successfully."""
        assert adapter._is_loaded
        assert adapter.model_info.name == "cyclone_track_distilled"
        assert adapter.model_info.framework == "pytorch"

    def test_validate_input(self, adapter, cyclone_state):
        """Test input validation."""
        assert adapter.validate_input(cyclone_state)

        # Test invalid input
        invalid_state = CycloneState(
            storm_id='2024-001',
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.0,
            longitude=85.0,
            # Missing required fields
        )
        assert not adapter.validate_input(invalid_state)

    def test_predict(self, adapter, cyclone_state):
        """Test the trajectory point-forecast and its actual uncertainty contract.

        The deployed LT3P model's learned uncertainty head saturates near its
        output clamp (~209.9 km) for essentially all horizons and never grows
        with lead time; the model was not trained (in any in-repo record) to
        guarantee monotonic uncertainty. So the test validates what the adapter
        genuinely guarantees: 12 finite, positive per-horizon sigmas at
        +2/4/.../24h, bounded below by the growing 10 + 2.5h floor and above by
        the 250 km cap. It does NOT assert monotonic growth.
        """
        result = adapter.predict(cyclone_state)

        assert isinstance(result, TrackPrediction)
        assert len(result.forecast_times) == 12  # 12 horizons: 2-24h
        assert len(result.latitudes) == 12
        assert len(result.longitudes) == 12
        assert len(result.uncertainty_km) == 12
        assert 0.0 <= result.confidence <= 1.0
        assert result.model_version == "lt3p"

        # Horizons are 2, 4, ..., 24 h after the fix
        deltas_h = [int((t - cyclone_state.timestamp).total_seconds() // 3600)
                    for t in result.forecast_times]
        assert deltas_h == list(range(2, 25, 2))

        for i, sigma in enumerate(result.uncertainty_km):
            assert np.isfinite(sigma)
            assert sigma > 0.0
            assert sigma >= 10.0 + 2.5 * deltas_h[i]
            assert sigma <= 250.0

        # sigma is associated with the correct forecast horizon
        assert len(result.position_error_estimates_km) == 12
        assert result.position_error_estimates_km == result.uncertainty_km

    def test_predict_is_deterministic(self, adapter, cyclone_state):
        """Repeated predictions are identical (model runs in eval mode)."""
        a = adapter.predict(cyclone_state)
        b = adapter.predict(cyclone_state)

        assert a.uncertainty_km == b.uncertainty_km
        assert a.latitudes == b.latitudes
        assert a.longitudes == b.longitudes
        assert a.forecast_times == b.forecast_times

    def test_predict_with_uncertainty(self, adapter, cyclone_state):
        """Uncertainty metadata is explicit that the cone is LIMITED/UNVERIFIED
        (not calibrated, not horizon-growing)."""
        prediction, uncertainty = adapter.predict_with_uncertainty(cyclone_state)

        assert isinstance(prediction, TrackPrediction)
        assert "aleatoric_km" in uncertainty
        assert len(uncertainty["aleatoric_km"]) == 12
        assert uncertainty["aleatoric_km"] == prediction.uncertainty_km
        assert uncertainty.get("status") == "LIMITED/UNVERIFIED"
        assert uncertainty.get("epistemic_scale") is None
        assert any("saturat" in note for note in uncertainty.get("notes", []))

    def test_explain(self, adapter, cyclone_state):
        """Test explanation generation."""
        result = adapter.predict(cyclone_state)
        explanation = adapter.explain(cyclone_state, result)

        assert "method" in explanation
        assert "model_type" in explanation


class TestRecurvatureAdapter:
    """Test recurvature model adapter."""

    @pytest.fixture
    def adapter(self):
        """Create and load recurvature adapter."""
        adapter = create_recurvature_adapter('recurvature/xgb_recurve_model.json')
        return adapter

    @pytest.fixture
    def cyclone_state(self):
        """Create a test CycloneState."""
        return CycloneState(
            storm_id='2024-001',
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.0,
            longitude=85.0,
            max_wind_kt=65.0,
            central_pressure_hpa=980.0,
            heading_deg=280.0,
            translation_speed_kt=10.0,
        )

    def test_adapter_loads(self, adapter):
        """Test that adapter loads successfully."""
        assert adapter._is_loaded
        assert adapter.model_info.name == "recurvature_xgb"
        assert adapter.model_info.framework == "xgboost"

    def test_validate_input(self, adapter, cyclone_state):
        """Test input validation."""
        assert adapter.validate_input(cyclone_state)

    def test_predict(self, adapter, cyclone_state):
        """Test prediction."""
        result = adapter.predict(cyclone_state)

        assert isinstance(result, RecurvaturePrediction)
        assert 0.0 <= result.probability <= 1.0
        assert result.risk_level is not None
        assert 0.0 <= result.confidence <= 1.0
        assert result.model_version == "v1"

    def test_explain(self, adapter, cyclone_state):
        """Test explanation generation."""
        result = adapter.predict(cyclone_state)
        explanation = adapter.explain(cyclone_state, result)

        assert "method" in explanation
        assert "model_type" in explanation


class TestRIAdapter:
    """Test RI model adapter."""

    @pytest.fixture
    def adapter(self):
        """Create and load RI adapter."""
        adapter = create_ri_adapter('RI/models')
        return adapter

    @pytest.fixture
    def cyclone_state(self):
        """Create a test CycloneState with IMD features."""
        return CycloneState(
            storm_id='2024-001',
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.0,
            longitude=85.0,
            max_wind_kt=65.0,
            central_pressure_hpa=980.0,
            heading_deg=280.0,
            translation_speed_kt=10.0,
            wind_change_6h=5.0,
            wind_change_12h=8.0,
            wind_change_24h=12.0,
            pressure_change_6h=-3.0,
            pressure_change_12h=-5.0,
            pressure_change_24h=-8.0,
        )

    def test_adapter_loads(self, adapter):
        """Test that adapter loads successfully."""
        assert adapter._is_loaded
        assert adapter.model_info.name == "ri_multimodal"
        assert adapter._imd_branch is not None
        assert adapter._era5_branch is not None
        assert adapter._imd_era5_branch is not None

    def test_validate_input(self, adapter, cyclone_state):
        """Test input validation."""
        assert adapter.validate_input(cyclone_state)

        # Test invalid input
        invalid_state = CycloneState(
            storm_id='2024-001',
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.0,
            longitude=85.0,
            # Missing required fields
        )
        assert not adapter.validate_input(invalid_state)

    def test_predict(self, adapter, cyclone_state):
        """Test prediction."""
        result = adapter.predict(cyclone_state)

        assert isinstance(result, RIPrediction)
        assert 0.0 <= result.probability_24h <= 1.0
        assert result.risk_level is not None
        assert 0.0 <= result.confidence <= 1.0
        assert result.model_version == "v1"
        assert result.imd_probability is not None
        assert 0.0 <= result.imd_probability <= 1.0

    def test_explain(self, adapter, cyclone_state):
        """Test explanation generation."""
        result = adapter.predict(cyclone_state)
        explanation = adapter.explain(cyclone_state, result)

        assert "method" in explanation
        assert "model_type" in explanation
        assert "mode" in explanation
        assert explanation["mode"] == "IMD_ONLY"
        assert explanation["branch_predictions"]["era5"] is None
        assert explanation["branch_predictions"]["satellite"] is None
        assert explanation["branch_predictions"]["fusion"] is None

    def test_imd_only_mode(self, adapter, cyclone_state):
        """Runtime uses IMD branch only; mode must reflect this."""
        result = adapter.predict(cyclone_state)
        assert adapter._mode == "IMD_ONLY"
        assert result.imd_probability is not None
        assert 0.0 <= result.imd_probability <= 1.0

    def test_era5_probability_not_fabricated(self, adapter, cyclone_state):
        """ERA5 branch artifact exists but its 89-runtime-feature builder
        cannot reconstruct the features from CycloneState; the adapter must
        not emit a fabricated ERA5 probability."""
        cyclone_state.environmental_features.sst = 29.0
        result = adapter.predict(cyclone_state)
        assert result.era5_probability is None
        assert adapter._mode == "IMD_ONLY"

    def test_satellite_not_fabricated(self, adapter, cyclone_state):
        """Satellite CNN is not usable at runtime; no fabricated probability."""
        cyclone_state.satellite_images = SatelliteImages(
            ir_image=np.zeros((128, 128), dtype=np.float32),
            ir_mask=np.ones((128, 128), dtype=np.float32),
        )
        result = adapter.predict(cyclone_state)
        assert result.satellite_probability is None
        assert result.fusion_probability is None

    def test_no_fusion_averaging(self, adapter, cyclone_state):
        """Fusion meta-model artifact does not exist; adapter must not average
        branch probabilities. The calibrated probability must equal the IMD
        probability (the only available branch)."""
        result = adapter.predict(cyclone_state)
        assert result.fusion_probability is None
        assert result.calibrated_probability == result.imd_probability
        assert result.probability_24h == result.imd_probability

    def test_unavailable_mode_without_imd_artifact(self):
        """When IMD artifact is absent, mode is UNAVAILABLE and output is honest."""
        adapter = create_ri_adapter('RI/models/does_not_exist')
        state = CycloneState(
            storm_id='2024-001',
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.0,
            longitude=85.0,
            max_wind_kt=65.0,
            central_pressure_hpa=980.0,
        )
        result = adapter.predict(state)
        assert adapter._mode == "UNAVAILABLE"
        assert result.probability_24h == 0.0
        assert result.risk_level == RiskLevel.NONE
        assert result.imd_probability is None
        assert result.era5_probability is None
        assert result.satellite_probability is None
        assert result.fusion_probability is None

    def test_era5_branch_uses_verified_best_iteration(self, adapter):
        """RI Improvement 3: the branch wrapper must honour the artifact's
        verified ``best_iteration`` (41 trees for the frozen ERA5 model), not
        average all 91 built trees. Hard-coded verification of the artifact."""
        import xgboost as xgb

        branch = adapter._era5_branch
        assert branch is not None
        assert branch.best_iteration == 40
        names = branch.feature_names
        assert len(names) == 89

        X = np.zeros((2, len(names)), dtype=np.float32)
        p = branch.predict_proba(X)

        booster = xgb.Booster()
        booster.load_model("RI/models/era5_final_xgboost.json")
        p_41 = booster.predict(xgb.DMatrix(X, feature_names=names),
                               iteration_range=(0, 41))
        p_all = booster.predict(xgb.DMatrix(X, feature_names=names))
        assert np.allclose(p, p_41, rtol=1e-6, atol=1e-7)
        assert not np.allclose(p, p_all)  # proves the range was actually used

    def test_imd_era5_branch_uses_verified_best_iteration(self, adapter):
        """The combined branch also carries its verified iteration metadata."""
        branch = adapter._imd_era5_branch
        assert branch is not None
        assert branch.best_iteration is not None
        assert isinstance(branch.best_iteration, int) and branch.best_iteration > 0


if __name__ == '__main__':
    pytest.main([__file__, '-v'])