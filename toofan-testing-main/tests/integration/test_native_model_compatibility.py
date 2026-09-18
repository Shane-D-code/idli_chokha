"""Regression test for PyTorch + XGBoost OpenMP native crash compatibility.

This test verifies that the TOOFAN runtime configuration (OMP_NUM_THREADS=1)
prevents the native segmentation fault that occurs when loading both
PyTorch and XGBoost models in the same process.

The test must configure runtime BEFORE importing ML frameworks.
"""

import os
import sys

# CRITICAL: Set OMP_NUM_THREADS BEFORE any ML framework imports
# This mimics what TOOFAN runtime configuration does at entry points
os.environ['OMP_NUM_THREADS'] = '1'

import pytest
from datetime import datetime, timezone

from src.core.schema import CycloneState, Basin
from src.models.adapters.trajectory_adapter import create_trajectory_adapter
from src.models.adapters.recurvature_adapter import create_recurvature_adapter
from src.models.adapters.ri_adapter import create_ri_adapter


class TestNativeModelCompatibility:
    """Test that PyTorch and XGBoost models can coexist without native crash."""

    @pytest.fixture
    def cyclone_state(self):
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

    @pytest.fixture
    def cyclone_state_with_history(self):
        """CycloneState with historical change fields for RI prediction."""
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

    def test_trajectory_and_recurvature_coexist(self, cyclone_state):
        """Trajectory (PyTorch) + Recurvature (XGBoost) must load and predict."""
        traj = create_trajectory_adapter('best_cyclone_model_lt3p_distilled.pth')
        rec = create_recurvature_adapter('recurvature/xgb_recurve_model.json')

        traj_result = traj.predict(cyclone_state)
        rec_result = rec.predict(cyclone_state)

        assert traj_result is not None
        assert rec_result is not None
        assert 0.0 <= rec_result.probability <= 1.0
        assert traj_result.model_version == "lt3p"
        assert rec_result.model_version == "v1"

    def test_recurvature_and_trajectory_load_order(self, cyclone_state):
        """Recurvature (XGBoost) first, then Trajectory (PyTorch) must work."""
        rec = create_recurvature_adapter('recurvature/xgb_recurve_model.json')
        traj = create_trajectory_adapter('best_cyclone_model_lt3p_distilled.pth')

        rec_result = rec.predict(cyclone_state)
        traj_result = traj.predict(cyclone_state)

        assert rec_result is not None
        assert traj_result is not None
        assert 0.0 <= rec_result.probability <= 1.0

    def test_trajectory_and_ri_coexist(self, cyclone_state_with_history):
        """Trajectory (PyTorch) + RI (XGBoost+PyTorch) must load and predict."""
        traj = create_trajectory_adapter('best_cyclone_model_lt3p_distilled.pth')
        ri = create_ri_adapter('RI/models')

        traj_result = traj.predict(cyclone_state_with_history)
        ri_result = ri.predict(cyclone_state_with_history)

        assert traj_result is not None
        assert ri_result is not None
        assert 0.0 <= ri_result.probability_24h <= 1.0
        # The validated IMD branch must actually be loaded (not UNAVAILABLE)
        assert ri_result.imd_probability is not None
        assert ri_result.status != "UNAVAILABLE"

    def test_all_three_models_coexist(self, cyclone_state_with_history):
        """Trajectory + Recurvature + RI all loaded simultaneously."""
        traj = create_trajectory_adapter('best_cyclone_model_lt3p_distilled.pth')
        rec = create_recurvature_adapter('recurvature/xgb_recurve_model.json')
        ri = create_ri_adapter('RI/models')

        # All should predict without crash
        traj_result = traj.predict(cyclone_state_with_history)
        rec_result = rec.predict(cyclone_state_with_history)
        ri_result = ri.predict(cyclone_state_with_history)

        assert traj_result is not None
        assert rec_result is not None
        assert ri_result is not None
        assert 0.0 <= rec_result.probability <= 1.0
        assert 0.0 <= ri_result.probability_24h <= 1.0
        assert ri_result.imd_probability is not None
        assert ri_result.status != "UNAVAILABLE"

    def test_recurvature_predict_proba_works(self, cyclone_state):
        """Verify recurvature adapter correctly uses XGBClassifier.predict_proba."""
        rec = create_recurvature_adapter('recurvature/xgb_recurve_model.json')

        result = rec.predict(cyclone_state)

        assert isinstance(result.probability, float)
        assert 0.0 <= result.probability <= 1.0
        assert result.risk_level is not None
        assert result.confidence > 0.0

    def test_multiple_predictions_stable(self, cyclone_state):
        """Repeated predictions should remain stable (no memory corruption)."""
        traj = create_trajectory_adapter('best_cyclone_model_lt3p_distilled.pth')
        rec = create_recurvature_adapter('recurvature/xgb_recurve_model.json')

        for _ in range(5):
            traj_result = traj.predict(cyclone_state)
            rec_result = rec.predict(cyclone_state)

            assert traj_result is not None
            assert rec_result is not None
            assert 0.0 <= rec_result.probability <= 1.0


class TestRuntimeConfiguration:
    """Test that runtime configuration works correctly."""

    def test_omp_threads_set(self):
        """Verify OMP_NUM_THREADS is set to 1."""
        assert os.environ.get('OMP_NUM_THREADS') == '1'

    def test_runtime_configurable(self):
        """Test that runtime configuration functions exist."""
        from src.core.runtime import configure_runtime, is_runtime_configured, RuntimeConfig

        # Functions should be callable
        assert callable(configure_runtime)
        assert callable(is_runtime_configured)
        assert hasattr(RuntimeConfig, 'configure')


if __name__ == '__main__':
    pytest.main([__file__, '-v'])