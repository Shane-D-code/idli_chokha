"""Integration tests for model adapters."""

import pytest
import warnings
from datetime import datetime, timezone

from src.core.schema import (
    CycloneState, Basin, TrackPrediction, RecurvaturePrediction, RIPrediction,
)
from src.models.adapters.trajectory_adapter import create_trajectory_adapter
from src.models.adapters.recurvature_adapter import create_recurvature_adapter
from src.models.adapters.ri_adapter import create_ri_adapter


class TestTrajectoryAdapter:
    """Test trajectory model adapter."""

    @pytest.fixture
    def adapter(self):
        """Create and load trajectory adapter."""
        adapter = create_trajectory_adapter('cyclone_path/checkpoints/v12_best_model.pt')
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
        assert adapter.model_info.name == "cyclone_trajectory_v12"
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
        """Test prediction."""
        result = adapter.predict(cyclone_state)

        assert isinstance(result, TrackPrediction)
        assert len(result.forecast_times) == 12  # 12 horizons: 2-24h
        assert len(result.latitudes) == 12
        assert len(result.longitudes) == 12
        assert len(result.uncertainty_km) == 12
        assert 0.0 <= result.confidence <= 1.0
        assert result.model_version == "v12"

        # Check uncertainty grows with lead time
        for i in range(1, len(result.uncertainty_km)):
            assert result.uncertainty_km[i] >= result.uncertainty_km[i-1]

    def test_predict_with_uncertainty(self, adapter, cyclone_state):
        """Test prediction with uncertainty."""
        prediction, uncertainty = adapter.predict_with_uncertainty(cyclone_state)

        assert isinstance(prediction, TrackPrediction)
        assert "aleatoric_km" in uncertainty
        assert "epistemic_scale" in uncertainty
        assert len(uncertainty["aleatoric_km"]) == 12
        assert len(uncertainty["epistemic_scale"]) == 12

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
        adapter = create_ri_adapter('cyclone_backup/models')
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


if __name__ == '__main__':
    pytest.main([__file__, '-v'])