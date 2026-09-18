"""Intensity Model Adapter for XGBoost intensity prediction.

Wraps the existing cyclone intensity XGBoost model to conform to the
standardized IntensityPrediction schema.

Scientific honesty contract
---------------------------
- The adapter NEVER fabricates predictions or uncertainty values.
- `uncertainty_kt` is set to ``None`` unless a calibrated per-prediction
  uncertainty source exists. The previously hard-coded ``14.55`` kt value
  (a historical cross-validation MAE claim that is NOT reproducible from this
  repository — no dataset, results, or trained artifact are present) has been
  removed.
- When the trained artifact is missing, ``predict()`` returns an
  ``IntensityPrediction`` with an explicit ``status="UNAVAILABLE"`` instead of
  raising, and the orchestrator reports the intensity module as UNAVAILABLE.
- When the artifact IS present, predictions are real model outputs but carry
  ``status="UNVERIFIED"`` together with an explicit ``reason`` documenting
  every degraded or uncalibrated input (see below).
"""

from __future__ import annotations

import warnings
from datetime import datetime
from pathlib import Path

import joblib
import pandas as pd

from src.core.schema import (
    CycloneCategory,
    CycloneState,
    EnvironmentalFeatures,
    IntensityPrediction,
)
from src.models.base import (
    IntensityModel,
    ModelInfo,
)

_ARTIFACT_MISSING_REASON = (
    "model artifact not available at the configured checkpoint path; "
    "no trained intensity model can be loaded. Retrain (see "
    "'cyclone intensity/retrain.py') before intensity forecasts can be issued."
)


class IntensityModelAdapter(IntensityModel):
    """Adapter for the cyclone intensity XGBoost model.

    Loads the trained XGBoost pipeline (with imputer), applies the exact
    feature engineering from training, and returns standardized
    IntensityPrediction outputs.
    """

    def __init__(self, model_info: ModelInfo):
        super().__init__(model_info)
        self._pipeline = None
        self._feature_columns = None
        self._is_loaded = False

    def load(self, checkpoint_path: str, **kwargs) -> None:
        """Load the intensity model from checkpoint.

        Args:
            checkpoint_path: Path to the joblib file containing the fitted pipeline.
        """
        path = Path(checkpoint_path)
        if not path.exists():
            raise FileNotFoundError(f"Intensity model artifact not found: {checkpoint_path}")

        self._pipeline = joblib.load(path)

        # Feature columns from the training (must match exactly)
        self._feature_columns = [
            'msw_kt', 'pressure_hpa', 'lat', 'lon',
            'msw_change_6h', 'msw_change_12h', 'msw_change_24h',
            'pressure_change_6h', 'pressure_change_12h', 'pressure_change_24h',
            'lat_change_6h', 'lon_change_6h', 'movement_speed_kt',
            'era5_sst', 'era5_t850', 'era5_t700', 'era5_t500', 'era5_t200',
            'era5_r850', 'era5_r700', 'era5_r500', 'era5_r200',
            'era5_u850', 'era5_u700', 'era5_u500', 'era5_u200',
            'era5_v850', 'era5_v700', 'era5_v500', 'era5_v200',
        ]

        self._is_loaded = True

    def validate_input(self, input_data: CycloneState) -> bool:
        """Validate that input is a CycloneState with required fields."""
        if not isinstance(input_data, CycloneState):
            return False

        # Check required fields for intensity prediction
        required = ["max_wind_kt", "central_pressure_hpa", "latitude", "longitude"]
        for field in required:
            if getattr(input_data, field) is None:
                warnings.warn(f"Missing required field for intensity: {field}")
                return False

        return True

    def _build_features(self, cyclone_state: CycloneState) -> pd.DataFrame:
        """Build feature vector matching the training feature engineering.

        The model expects 30 features in a specific order:
        13 cyclone state/dynamics + 17 ERA5 environmental.

        Note on honest defaults: ``lat_change_6h`` / ``lon_change_6h`` are not
        carried by ``CycloneState`` and are set to 0.0 (a degraded value), and
        ERA5 temperature features are converted from Kelvin (the
        ``EnvironmentalFeatures`` convention) to Celsius (the training
        convention, ``era5_t*``). Any feature filled with a default is recorded
        in the prediction ``reason`` so the caller knows the input was degraded.
        """
        env = cyclone_state.environmental_features or EnvironmentalFeatures()

        features = {}

        # Cyclone current state & dynamics (13)
        features['msw_kt'] = cyclone_state.max_wind_kt or 0.0
        features['pressure_hpa'] = cyclone_state.central_pressure_hpa or 1000.0
        features['lat'] = cyclone_state.latitude
        features['lon'] = cyclone_state.longitude
        features['msw_change_6h'] = cyclone_state.wind_change_6h or 0.0
        features['msw_change_12h'] = cyclone_state.wind_change_12h or 0.0
        features['msw_change_24h'] = cyclone_state.wind_change_24h or 0.0
        features['pressure_change_6h'] = cyclone_state.pressure_change_6h or 0.0
        features['pressure_change_12h'] = cyclone_state.pressure_change_12h or 0.0
        features['pressure_change_24h'] = cyclone_state.pressure_change_24h or 0.0
        features['lat_change_6h'] = 0.0  # NOT in CycloneState -> degraded feature
        features['lon_change_6h'] = 0.0  # NOT in CycloneState -> degraded feature
        features['movement_speed_kt'] = cyclone_state.translation_speed_kt or 0.0

        # ERA5 environmental features (17)
        # Temperature is stored in Kelvin in EnvironmentalFeatures but the
        # training features era5_t* are in Celsius.
        def _kelvin_to_celsius(value: float | None) -> float:
            if value is None:
                return 0.0
            return float(value - 273.15)

        features['era5_sst'] = env.sst or 0.0
        features['era5_t850'] = _kelvin_to_celsius(env.t_850)
        features['era5_t700'] = _kelvin_to_celsius(env.t_700)
        features['era5_t500'] = _kelvin_to_celsius(env.t_500)
        features['era5_t200'] = _kelvin_to_celsius(env.t_200)
        features['era5_r850'] = env.r_850 or 0.0
        features['era5_r700'] = env.r_700 or 0.0
        features['era5_r500'] = env.r_500 or 0.0
        features['era5_r200'] = env.r_200 or 0.0
        features['era5_u850'] = env.u_850 or 0.0
        features['era5_u700'] = env.u_700 or 0.0
        features['era5_u500'] = env.u_500 or 0.0
        features['era5_u200'] = env.u_200 or 0.0
        features['era5_v850'] = env.v_850 or 0.0
        features['era5_v700'] = env.v_700 or 0.0
        features['era5_v500'] = env.v_500 or 0.0
        features['era5_v200'] = env.v_200 or 0.0

        # Build array in exactly the training feature order (column names
        # included so sklearn pipelines fitted on DataFrames are matched).
        return pd.DataFrame([features], columns=self._feature_columns)

    def _feature_degradations(self, cyclone_state: CycloneState) -> list[str]:
        """Return the list of feature-fill degradations for this input."""
        degradations = []
        if cyclone_state.wind_change_6h is None or cyclone_state.wind_change_12h is None \
                or cyclone_state.wind_change_24h is None:
            degradations.append("missing wind-change features filled with 0.0")
        if cyclone_state.translation_speed_kt is None:
            degradations.append("missing translation_speed_kt filled with 0.0")
        # lat_change_6h / lon_change_6h are never available on CycloneState.
        degradations.append("lat_change_6h/lon_change_6h always 0.0 (not in CycloneState)")
        env = cyclone_state.environmental_features or EnvironmentalFeatures()
        era5_present = any([
            env.sst is not None, env.t_850 is not None, env.r_850 is not None,
            env.u_850 is not None, env.v_850 is not None,
        ])
        if not era5_present:
            degradations.append("all 17 ERA5 environmental features filled with 0.0 (not provided)")
        return degradations

    def predict(self, cyclone_state: CycloneState) -> IntensityPrediction:
        """Predict cyclone intensity at 24h.

        Args:
            cyclone_state: Current cyclone state with intensity, position, ERA5 env.

        Returns:
            IntensityPrediction with predicted MSW and category. When the model
            artifact has not been loaded the returned prediction carries
            ``status="UNAVAILABLE"`` and no predicted values.
        """
        if not self._is_loaded:
            return IntensityPrediction(
                predicted_msw_24h=None,
                predicted_category_24h=None,
                uncertainty_kt=None,
                confidence=0.0,
                model_version=self.model_info.version,
                timestamp=datetime.utcnow(),
                status="UNAVAILABLE",
                reason=_ARTIFACT_MISSING_REASON,
            )

        if not self.validate_input(cyclone_state):
            raise ValueError("Invalid input for intensity prediction")

        # Build features
        X = self._build_features(cyclone_state)

        # Predict
        predicted_msw = float(self._pipeline.predict(X)[0])

        # Convert to IMD category
        predicted_category = self._msw_to_category(predicted_msw)

        # No calibrated per-prediction uncertainty is available: the model is a
        # point-forecast regressor. The historical CV-MAE claim (14.55 kt) is
        # NOT reproducible from this repository and is NOT used as a per-input
        # uncertainty value.
        uncertainty_kt = None

        # Feature-completeness heuristic (documented, NOT a calibrated
        # confidence): ERA5-present inputs are treated as more complete.
        env = cyclone_state.environmental_features
        has_era5 = any([
            env is not None and any([
                env.sst is not None, env.t_850 is not None, env.r_850 is not None,
                env.u_850 is not None, env.v_850 is not None,
            ])
        ])
        confidence = 0.8 if has_era5 else 0.5

        degradations = self._feature_degradations(cyclone_state)
        reason = (
            "model predictions are real but UNVERIFIED: historical metrics "
            "(e.g. reported MAE 14.55 kt) and the training data/artifact are "
            "not reproduced from this repository; per-prediction uncertainty "
            "is not calibrated (uncertainty_kt=None); degraded inputs: "
            + "; ".join(degradations) + "."
        )

        return IntensityPrediction(
            predicted_msw_24h=predicted_msw,
            predicted_category_24h=predicted_category,
            uncertainty_kt=uncertainty_kt,
            confidence=confidence,
            model_version=self.model_info.version,
            timestamp=datetime.utcnow(),
            feature_importance=self._get_feature_importance(),
            status="UNVERIFIED",
            reason=reason,
        )

    def predict_with_uncertainty(self, cyclone_state: CycloneState) -> tuple[IntensityPrediction, dict]:
        """Predict with uncertainty estimates."""
        prediction = self.predict(cyclone_state)

        uncertainty = {
            "aleatoric_kt": prediction.uncertainty_kt,
            "epistemic_kt": None,  # Would need ensemble or bootstrap
            "horizon_h": 24,
            "status": prediction.status,
            "reason": prediction.reason,
        }

        return prediction, uncertainty

    def explain(self, input_data: CycloneState, prediction: IntensityPrediction) -> dict:
        """Generate explanation for intensity prediction."""
        return {
            "method": "feature_importance",
            "model_type": "XGBoost",
            "top_features": self._get_feature_importance(),
            "note": (
                "Feature importances come from the fitted model only; SHAP "
                "would require the training data. Input degradations and the "
                "UNVERIFIED/limited status are visible via prediction.status "
                "and prediction.reason."
            ),
        }

    def _msw_to_category(self, msw: float) -> CycloneCategory:
        """Convert MSW to IMD category."""
        if msw < 28.0:
            return CycloneCategory.D
        elif msw <= 33.0:
            return CycloneCategory.DD
        elif msw <= 47.0:
            return CycloneCategory.CS
        elif msw <= 63.0:
            return CycloneCategory.SCS
        elif msw <= 89.0:
            return CycloneCategory.VSCS
        elif msw <= 119.0:
            return CycloneCategory.ESCS
        else:
            return CycloneCategory.SUCS

    def _get_feature_importance(self) -> dict[str, float]:
        """Extract feature importances from the fitted model."""
        if self._pipeline is None:
            return {}

        model = self._pipeline.named_steps.get('model')
        if model is None or not hasattr(model, 'feature_importances_'):
            return {}

        importances = model.feature_importances_
        return dict(zip(self._feature_columns, importances.tolist()))


def create_intensity_adapter(
    checkpoint_path: str = "cyclone intensity/models/final_xgb_regressor.joblib",
    model_version: str = "v1"
) -> IntensityModelAdapter:
    """Factory function to create and load an intensity adapter.

    Args:
        checkpoint_path: Path to the joblib model artifact.
        model_version: Version string for the model.

    Returns:
        Loaded IntensityModelAdapter instance (if the artifact exists) or an
        UNLOADED adapter whose ``predict()`` reports ``status="UNAVAILABLE"``.
    """
    model_info = ModelInfo(
        name="cyclone_intensity_xgb",
        version=model_version,
        model_type="intensity",
        loaded_at=datetime.utcnow(),
        framework="xgboost",
    )

    adapter = IntensityModelAdapter(model_info)

    # Check if artifact exists before loading
    path = Path(checkpoint_path)
    if not path.exists():
        warnings.warn(
            f"Intensity model artifact not found at {checkpoint_path}. "
            f"Model will be unavailable. Retrain using "
            f"'cyclone intensity/retrain.py' first."
        )
        return adapter  # Return unloaded adapter (predict -> status UNAVAILABLE)

    adapter.load(checkpoint_path)
    return adapter


class ModelAdapter(IntensityModelAdapter):
    """Alias for orchestrator compatibility."""
    pass
