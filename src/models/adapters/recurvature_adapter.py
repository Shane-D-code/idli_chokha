"""Recurvature Model Adapter for XGBoost recurvature prediction.

Wraps the existing recurvature XGBoost model to conform to the
standardized RecurvaturePrediction schema.
"""

from __future__ import annotations

import warnings
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.preprocessing import StandardScaler

from src.core.schema import (
    CycloneState,
    RecurvaturePrediction,
    RiskLevel,
    TrackPrediction,
)
from src.models.base import (
    BaseModel,
    RecurvatureModel,
    ModelInfo,
    ModelMetadata,
)


class RecurvatureModelAdapter(RecurvatureModel):
    """Adapter for the recurvature XGBoost model.

    Loads the trained XGBoost model and scaler, applies the exact
    feature engineering from training, and returns standardized
    RecurvaturePrediction outputs.
    """

    def __init__(self, model_info: ModelInfo):
        super().__init__(model_info)
        self._model = None
        self._scaler = None
        self._feature_cols = None
        self._is_loaded = False

    def load(self, checkpoint_path: str, **kwargs) -> None:
        """Load the recurvature model from checkpoint.

        Args:
            checkpoint_path: Path to the XGBoost model JSON file.
        """
        path = Path(checkpoint_path)
        if not path.exists():
            raise FileNotFoundError(f"Recurvature model artifact not found: {checkpoint_path}")

        # Load XGBoost model via Booster.
        # XGBClassifier.load_model()/predict_proba() are broken under xgboost
        # 2.1.3 + sklearn 1.8 ('_estimator_type' removed from ClassifierMixin).
        # Booster.predict() applies the same binary:logistic objective.
        self._model = xgb.Booster()
        self._model.load_model(str(path))

        # Load scaler (if saved separately) - for now recreate from training
        # The scaler was fitted on training data; we need to save/load it
        scaler_path = path.parent / "scaler.joblib"
        if scaler_path.exists():
            self._scaler = joblib.load(scaler_path)
        else:
            warnings.warn("Scaler not found; creating new StandardScaler (will not match training)")
            self._scaler = StandardScaler()

        # Feature columns from training
        self._feature_cols = [
            "lat", "lon", "wind", "pres", "STORM_SPEED", "dir_sin", "dir_cos",
            "month_sin", "month_cos", "DIST2LAND", "dir_change_3h", "dir_change_9h",
        ]

        self._is_loaded = True

    def validate_input(self, input_data: CycloneState) -> bool:
        """Validate that input is a CycloneState with required fields."""
        if not isinstance(input_data, CycloneState):
            return False

        # Check required fields for recurvature prediction
        required = ["latitude", "longitude", "max_wind_kt", "central_pressure_hpa",
                    "heading_deg", "translation_speed_kt", "timestamp"]
        for field in required:
            if getattr(input_data, field) is None:
                warnings.warn(f"Missing required field for recurvature: {field}")
                return False

        return True

    def _build_features(self, cyclone_state: CycloneState,
                         track_prediction: Optional[TrackPrediction] = None) -> np.ndarray:
        """Build feature vector matching the training feature engineering.

        Features (12):
        - lat, lon: current position
        - wind: max wind (kt)
        - pres: central pressure (hPa)
        - STORM_SPEED: translation speed (kt)
        - dir_sin, dir_cos: heading direction
        - month_sin, month_cos: month cyclical
        - DIST2LAND: distance to land (km) - needs external data
        - dir_change_3h: heading change over 3h
        - dir_change_9h: heading change over 9h
        """
        features = {}

        features['lat'] = cyclone_state.latitude
        features['lon'] = cyclone_state.longitude
        features['wind'] = cyclone_state.max_wind_kt or 0.0
        features['pres'] = cyclone_state.central_pressure_hpa or 1000.0
        features['STORM_SPEED'] = cyclone_state.translation_speed_kt or 0.0

        heading = cyclone_state.heading_deg or 0.0
        features['dir_sin'] = np.sin(np.deg2rad(heading))
        features['dir_cos'] = np.cos(np.deg2rad(heading))

        month = cyclone_state.timestamp.month
        features['month_sin'] = np.sin(2 * np.pi * month / 12)
        features['month_cos'] = np.cos(2 * np.pi * month / 12)

        # DIST2LAND: distance to nearest land (placeholder - needs real data)
        features['DIST2LAND'] = self._estimate_dist_to_land(cyclone_state.latitude, cyclone_state.longitude)

        # Direction changes - need historical track
        features['dir_change_3h'] = 0.0  # Would need 3h ago heading
        features['dir_change_9h'] = 0.0  # Would need 9h ago heading

        # If we have track prediction, we can estimate future direction change
        if track_prediction and len(track_prediction.latitudes) >= 2:
            # Estimate heading from first forecast point
            lat1 = cyclone_state.latitude
            lon1 = cyclone_state.longitude
            lat2 = track_prediction.latitudes[0]
            lon2 = track_prediction.longitudes[0]
            future_heading = self._bearing_deg(lat1, lon1, lat2, lon2)
            current_heading = heading
            diff = (future_heading - current_heading + 180) % 360 - 180
            features['dir_change_3h'] = diff

        # Build array in correct order
        feature_array = np.array([[features[col] for col in self._feature_cols]], dtype=np.float32)
        return feature_array

    def _estimate_dist_to_land(self, lat: float, lon: float) -> float:
        """Estimate distance to land (placeholder).
        In production, this should use a real land mask / coastline dataset.
        """
        # Bay of Bengal / Arabian Sea rough estimates
        # This is a very rough approximation
        if 10 < lat < 22 and 80 < lon < 100:  # Bay of Bengal
            return 200.0  # km from coast
        elif 10 < lat < 25 and 50 < lon < 75:  # Arabian Sea
            return 300.0
        return 500.0

    def _bearing_deg(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate bearing from point 1 to point 2."""
        lat1, lon1, lat2, lon2 = map(np.deg2rad, (lat1, lon1, lat2, lon2))
        dlon = lon2 - lon1
        x = np.sin(dlon) * np.cos(lat2)
        y = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(dlon)
        brng = np.degrees(np.arctan2(x, y))
        return (brng + 360.0) % 360.0

    def predict(self, cyclone_state: CycloneState,
                track_prediction: Optional[TrackPrediction] = None) -> RecurvaturePrediction:
        """Predict recurvature probability within 24h.

        Args:
            cyclone_state: Current cyclone state.
            track_prediction: Optional track forecast for direction change estimation.

        Returns:
            RecurvaturePrediction with probability and risk level.
        """
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        if not self.validate_input(cyclone_state):
            raise ValueError("Invalid input for recurvature prediction")

        # Build features
        X = self._build_features(cyclone_state, track_prediction)

        # Record which input features are REAL observations/derivations vs
        # placeholders, so limitations are explicit and never hidden.
        self._feature_sources = {
            "lat": "real", "lon": "real", "wind": "real", "pres": "real",
            "STORM_SPEED": "real", "dir_sin": "real", "dir_cos": "real",
            "month_sin": "real", "month_cos": "real",
            "DIST2LAND": "coarse_estimate",
            "dir_change_3h": ("forecast_estimate"
                              if track_prediction is not None and len(track_prediction.latitudes) >= 2
                              else "placeholder_zero"),
            "dir_change_9h": "placeholder_zero",
        }
        confidence = self._confidence_from_sources()

        # Scale features
        X_scaled = self._scaler.transform(X)

        # Predict probability (Booster.predict returns P(RI=1) for binary:logistic)
        dmatrix = xgb.DMatrix(X_scaled, feature_names=self._feature_cols)
        prob = float(self._model.predict(dmatrix)[0])

        # Risk level
        risk_level = self._prob_to_risk_level(prob)

        # Expected turning window (based on training: within 24h)
        expected_window = "+0h to +24h" if prob > 0.5 else None

        return RecurvaturePrediction(
            probability=prob,
            expected_turning_window=expected_window,
            risk_level=risk_level,
            confidence=confidence,
            model_version=self.model_info.version,
            timestamp=datetime.utcnow(),
            feature_importance=self._get_feature_importance(),
        )

    def _confidence_from_sources(self) -> float:
        """Confidence penalised for placeholder-derived input features.

        The XGBoost model was trained on REAL IBTrACS values (DIST2LAND and
        real 3-hourly historical heading change). A CycloneState carries no
        track history, so unless a trajectory forecast is supplied (which only
        approximates dir_change_3h), those features are filled with
        placeholders. The returned confidence reflects that the observation
        inputs are incomplete; the output must not be treated as if the real
        features were observed.
        """
        penalties = {
            "placeholder_zero": 0.35,
            "coarse_estimate": 0.35,
            "forecast_estimate": 0.15,
        }
        conf = 0.95
        for source in self._feature_sources.values():
            conf -= penalties.get(source, 0.0)
        return max(0.25, min(1.0, conf))

    def _prob_to_risk_level(self, prob: float) -> RiskLevel:
        """Convert probability to risk level."""
        if prob < 0.1:
            return RiskLevel.NONE
        elif prob < 0.3:
            return RiskLevel.LOW
        elif prob < 0.5:
            return RiskLevel.MODERATE
        elif prob < 0.75:
            return RiskLevel.HIGH
        else:
            return RiskLevel.EXTREME

    def _get_feature_importance(self) -> dict[str, float]:
        """Extract feature importances from the loaded model.

        Uses the Booster's weight-based get_score(), which matches the
        default importance_type used previously by feature_importances_.
        """
        if self._model is None:
            return {}

        score = self._model.get_score()
        return {k: float(v) for k, v in score.items()}

    def explain(self, input_data: CycloneState, prediction: RecurvaturePrediction) -> dict:
        """Generate explanation for recurvature prediction."""
        limitations = [
            "DIST2LAND is a coarse 200/300/500 km estimate, NOT the real IBTrACS "
            "DIST2LAND value the model was trained on.",
            "dir_change_3h / dir_change_9h are not observable from a single "
            "CycloneState; without track history they default to 0 (the model was "
            "trained on real 3-hourly historical heading change). Under these "
            "conditions the prediction is treated as LIMITED.",
        ]
        return {
            "method": "feature_importance",
            "model_type": "XGBoost",
            "top_features": self._get_feature_importance(),
            "feature_sources": getattr(self, "_feature_sources", {}),
            "limitations": limitations,
            "note": "SHAP values can be computed for detailed explanations",
        }


def create_recurvature_adapter(
    checkpoint_path: str = "recurvature/xgb_recurve_model.json",
    model_version: str = "v1"
) -> RecurvatureModelAdapter:
    """Factory function to create and load a recurvature adapter.

    Args:
        checkpoint_path: Path to the XGBoost model JSON file.
        model_version: Version string for the model.

    Returns:
        Loaded RecurvatureModelAdapter instance.

    Raises:
        FileNotFoundError: If the model artifact doesn't exist.
    """
    model_info = ModelInfo(
        name="recurvature_xgb",
        version=model_version,
        model_type="recurvature",
        loaded_at=datetime.utcnow(),
        framework="xgboost",
    )

    adapter = RecurvatureModelAdapter(model_info)

    path = Path(checkpoint_path)
    if not path.exists():
        warnings.warn(
            f"Recurvature model artifact not found at {checkpoint_path}. "
            f"Train using 'python -m recurvature.src.train --csv ...' first."
        )
        return adapter

    adapter.load(checkpoint_path)

    # Save scaler for future use (fit on some data if needed)
    scaler_path = path.parent / "scaler.joblib"
    if not scaler_path.exists():
        # We can't fit the scaler without training data, but we can save a placeholder
        import joblib
        joblib.dump(adapter._scaler, scaler_path)

    return adapter


class ModelAdapter(RecurvatureModelAdapter):
    """Alias for orchestrator compatibility."""
    pass