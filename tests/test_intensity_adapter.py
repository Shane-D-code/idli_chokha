"""Tests for the intensity model adapter honest contract.

The adapter must never fabricate predictions, uncertainties, or confidence
values. When the model artifact is missing it must return an explicit
UNAVAILABLE status; when the artifact is present it must return real model
outputs flagged UNVERIFIED with the exact feature degradations used.
"""

from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from xgboost import XGBRegressor

from src.core.schema import (
    Basin,
    CycloneCategory,
    CycloneState,
    EnvironmentalFeatures,
    IntensityPrediction,
)
from src.models.adapters.intensity_adapter import (
    IntensityModelAdapter,
    create_intensity_adapter,
)

FEATURE_COLUMNS_30 = [
    'msw_kt', 'pressure_hpa', 'lat', 'lon',
    'msw_change_6h', 'msw_change_12h', 'msw_change_24h',
    'pressure_change_6h', 'pressure_change_12h', 'pressure_change_24h',
    'lat_change_6h', 'lon_change_6h', 'movement_speed_kt',
    'era5_sst', 'era5_t850', 'era5_t700', 'era5_t500', 'era5_t200',
    'era5_r850', 'era5_r700', 'era5_r500', 'era5_r200',
    'era5_u850', 'era5_u700', 'era5_u500', 'era5_u200',
    'era5_v850', 'era5_v700', 'era5_v500', 'era5_v200',
]

LEGACY_CLAIMED_UNCERTAINTY_KT = 14.55


def _make_state(**overrides):
    """Build a valid CycloneState for intensity prediction."""
    defaults = dict(
        storm_id='2024-001',
        basin=Basin.BAY_OF_BENGAL,
        timestamp=datetime.now(timezone.utc),
        latitude=15.0,
        longitude=85.0,
        max_wind_kt=65.0,
        central_pressure_hpa=980.0,
        heading_deg=280.0,
        translation_speed_kt=10.0,
        wind_change_6h=2.0,
        wind_change_12h=5.0,
        wind_change_24h=10.0,
        pressure_change_6h=-3.0,
        pressure_change_12h=-5.0,
        pressure_change_24h=-8.0,
    )
    defaults.update(overrides)
    return CycloneState(**defaults)


def _make_trained_pipeline(tmp_path: Path, n_rows: int = 40, seed: int = 42):
    """Fit and persist a small 30-feature pipeline, returning (path, model)."""
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n_rows, 30))
    y = 45.0 + 0.3 * X[:, 0] + rng.normal(size=n_rows)
    df = pd.DataFrame(X, columns=FEATURE_COLUMNS_30)
    df['msw_target_24h'] = y
    pipeline = Pipeline([
        ('imputer', SimpleImputer(strategy='median')),
        ('model', XGBRegressor(random_state=seed, n_estimators=10, max_depth=1)),
    ])
    pipeline.fit(df[FEATURE_COLUMNS_30], y)
    path = tmp_path / 'final_xgb_regressor.joblib'
    import joblib
    joblib.dump(pipeline, path)
    return path, pipeline


@pytest.fixture
def loaded_adapter(tmp_path):
    path, _ = _make_trained_pipeline(tmp_path)
    adapter = create_intensity_adapter(str(path), model_version="test-v1")
    return adapter


class TestIntensityAdapterHonestContract:
    """The adapter must not fabricate predictions or uncertainty."""

    def test_missing_artifact_returns_unloaded_adapter(self):
        adapter = create_intensity_adapter('/nonexistent/artifact.joblib')
        assert not adapter._is_loaded
        assert isinstance(adapter, IntensityModelAdapter)

    def test_predict_missing_artifact_returns_explicit_unavailable(self):
        adapter = create_intensity_adapter('/nonexistent/artifact.joblib')
        pred = adapter.predict(_make_state())
        assert isinstance(pred, IntensityPrediction)
        assert pred.status == "UNAVAILABLE"
        assert pred.predicted_msw_24h is None
        assert pred.predicted_category_24h is None
        assert pred.uncertainty_kt is None
        assert pred.reason and "artifact" in pred.reason.lower()

    def test_predict_with_uncertainty_missing_artifact(self):
        adapter = create_intensity_adapter('/nonexistent/artifact.joblib')
        pred, unc = adapter.predict_with_uncertainty(_make_state())
        assert pred.status == "UNAVAILABLE"
        assert unc["aleatoric_kt"] is None
        assert unc["epistemic_kt"] is None
        assert unc["horizon_h"] == 24
        assert unc["status"] == "UNAVAILABLE"

    def test_loaded_adapter_does_not_fabricate_uncertainty(self, loaded_adapter):
        pred = loaded_adapter.predict(_make_state())
        # The legacy hard-coded 14.55 kt "CV spread" must never reappear.
        assert pred.uncertainty_kt != LEGACY_CLAIMED_UNCERTAINTY_KT
        assert pred.uncertainty_kt is None

    def test_loaded_adapter_returns_real_prediction_flagged_unverified(self, loaded_adapter):
        pred = loaded_adapter.predict(_make_state())
        assert pred.status == "UNVERIFIED"
        assert pred.predicted_msw_24h is not None
        assert np.isfinite(pred.predicted_msw_24h)
        assert pred.predicted_msw_24h >= 0.0
        assert isinstance(pred.predicted_category_24h, CycloneCategory)
        assert 0.0 <= pred.confidence <= 1.0
        assert pred.model_version == "test-v1"
        assert pred.reason and "not reproduced" in pred.reason

    def test_reason_documents_known_degradations(self, loaded_adapter):
        pred = loaded_adapter.predict(_make_state())
        # lat/lon_change_6h are never present on CycloneState and the ERA5
        # features were not provided -> both degradations must be recorded.
        assert "lat_change_6h/lon_change_6h" in pred.reason
        assert "ERA5" in pred.reason or "era5" in pred.reason

    def test_loaded_adapter_does_not_raise_when_env_missing(self, loaded_adapter):
        # Realistic "no ERA5" case: default empty EnvironmentalFeatures.
        state = _make_state(environmental_features=EnvironmentalFeatures())
        pred = loaded_adapter.predict(state)
        assert pred.predicted_msw_24h is not None
        assert "ERA5" in pred.reason

    def test_predict_with_uncertainty_loaded(self, loaded_adapter):
        pred, unc = loaded_adapter.predict_with_uncertainty(_make_state())
        assert pred.status == "UNVERIFIED"
        assert unc["aleatoric_kt"] is None
        assert unc["epistemic_kt"] is None
        assert unc["horizon_h"] == 24
        assert unc["status"] == "UNVERIFIED"


class TestIntensityFeatureEngineering:
    """Feature vector must match the 30-column training order exactly."""

    def test_feature_build_shape_and_order(self, loaded_adapter):
        state = _make_state()
        X = loaded_adapter._build_features(state)
        assert X.shape == (1, 30)
        assert loaded_adapter._feature_columns == FEATURE_COLUMNS_30
        assert list(X.columns) == FEATURE_COLUMNS_30
        row = X.iloc[0]
        assert row['msw_kt'] == 65.0          # from max_wind_kt
        assert row['pressure_hpa'] == 980.0
        assert row['lat'] == 15.0
        assert row['lon'] == 85.0
        assert row['msw_change_12h'] == 5.0
        assert row['movement_speed_kt'] == 10.0  # from translation_speed_kt

    def test_lat_lon_change_forced_to_zero(self, loaded_adapter):
        X = loaded_adapter._build_features(_make_state())
        assert X.iloc[0]['lat_change_6h'] == 0.0
        assert X.iloc[0]['lon_change_6h'] == 0.0

    def test_era5_temperature_kelvin_to_celsius(self, loaded_adapter):
        env = EnvironmentalFeatures(t_850=300.15, t_700=290.0, sst=29.0)
        state = _make_state(environmental_features=env)
        X = loaded_adapter._build_features(state)
        row = X.iloc[0]
        assert row['era5_sst'] == pytest.approx(29.0)            # degC unchanged
        assert row['era5_t850'] == pytest.approx(300.15 - 273.15)
        assert row['era5_t700'] == pytest.approx(290.0 - 273.15)

    def test_loaded_adapter_exposes_feature_importance(self, loaded_adapter):
        imp = loaded_adapter._get_feature_importance()
        assert set(imp.keys()) == set(FEATURE_COLUMNS_30)
        assert len(imp) == 30
