"""Flood Model Adapter for XGBoost spatial holdout model (BASELINE / CASE STUDY).

Wraps the existing flood XGBoost model trained on FANI 2019.
Single event, spatial holdout validation, no temporal generalization.
"""

from __future__ import annotations

import warnings
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from src.core.schema import (
    CycloneState,
    FloodPrediction,
    RainfallPrediction,
    WindFieldPrediction,
)
from src.models.base import (
    FloodModel,
    ModelInfo,
    ModelMetadata,
)


class FloodModelAdapter(FloodModel):
    """Adapter for the flood XGBoost model.

    Status: BASELINE / CASE STUDY - single event (FANI 2019),
    spatial holdout validation, no temporal generalization demonstrated.
    Requires rainfall prediction + wind field + cyclone state.
    """

    def __init__(self, model_info: ModelInfo = None, raw_model: Any = None, metadata: ModelMetadata = None):
        # Support both direct ModelInfo and (raw_model, metadata) constructor
        if model_info is not None:
            super().__init__(model_info)
        elif metadata is not None:
            model_info = ModelInfo(
                name=metadata.name,
                version=metadata.version,
                model_type=metadata.model_type,
                loaded_at=datetime.utcnow(),
                metadata=metadata,
                framework="xgboost",
            )
            super().__init__(model_info)
        else:
            model_info = ModelInfo(
                name="flood_xgb",
                version="baseline",
                model_type="flood",
                loaded_at=datetime.utcnow(),
                framework="xgboost",
            )
            super().__init__(model_info)
        self._pipeline = None
        self._feature_names = None
        self._is_loaded = False

    def load(self, checkpoint_path: str, **kwargs) -> None:
        """Load the flood model from checkpoint."""
        path = Path(checkpoint_path)
        if not path.exists():
            raise FileNotFoundError(f"Flood model artifact not found: {checkpoint_path}")

        self._pipeline = joblib.load(path)

        # Extract feature names if available (XGBoost feature names)
        if hasattr(self._pipeline, 'feature_names_in_'):
            self._feature_names = list(self._pipeline.feature_names_in_)
        elif hasattr(self._pipeline, 'named_steps'):
            # Check if it's a pipeline with a model step
            model_step = self._pipeline.named_steps.get('model')
            if model_step and hasattr(model_step, 'feature_names_in_'):
                self._feature_names = list(model_step.feature_names_in_)

        self._is_loaded = True

    def validate_input(self, input_data) -> bool:
        """Validate inputs - requires rainfall prediction at minimum."""
        if not isinstance(input_data, tuple) and len(input_data) < 2:
            return False
        rainfall_pred = input_data[0]
        return rainfall_pred is not None

    def _build_features(self, rainfall_prediction: RainfallPrediction,
                         wind_prediction: WindFieldPrediction | None,
                         cyclone_state: CycloneState | None) -> np.ndarray:
        """Build feature vector from upstream predictions.

        The FANI flood training grid includes:
        - Rainfall features (IMERG accumulations at various durations)
        - Terrain features (elevation, slope, drainage)
        - Hydrology features (distance to river, flow accumulation)
        - Land cover features
        - Soil features
        - Cyclone state features

        Without access to the full preprocessing pipeline and static
        geographic data, we cannot construct the full feature vector.
        """
        warnings.warn(
            "Flood model requires full geographic preprocessing pipeline "
            "(terrain, hydrology, land cover, soil) which is not available "
            "in standard CycloneState. Cannot construct complete feature vector."
        )
        return np.array([[]], dtype=np.float32)

    def predict(self, rainfall_prediction: RainfallPrediction,
                wind_prediction: WindFieldPrediction | None = None,
                cyclone_state: CycloneState | None = None) -> FloodPrediction:
        """Return BASELINE status - requires full geographic preprocessing."""
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        # Check if rainfall prediction has actual grids (not BASELINE)
        has_rainfall_grids = rainfall_prediction is not None and any([
            rainfall_prediction.rainfall_3h is not None,
            rainfall_prediction.rainfall_6h is not None,
            rainfall_prediction.rainfall_12h is not None,
            rainfall_prediction.rainfall_24h is not None,
        ])

        if not has_rainfall_grids:
            return FloodPrediction(
                probability_grid=np.array([[]]),
                risk_grid=np.array([[]]),
                affected_area_km2=0.0,
                high_risk_regions=[],
                lats=np.array([]),
                lons=np.array([]),
                confidence=0.0,
                model_version=self.model_info.version,
                timestamp=datetime.utcnow(),
                status="DATA_UNAVAILABLE",
                reason="Flood model requires rainfall forecast grids and full geographic "
                        "preprocessing (terrain, hydrology, land cover, soil). "
                        "Single FANI 2019 case study with spatial holdout. "
                        "No temporal generalization demonstrated.",
            )

        return FloodPrediction(
            probability_grid=np.array([[]]),
            risk_grid=np.array([[]]),
            affected_area_km2=0.0,
            high_risk_regions=[],
            lats=np.array([]),
            lons=np.array([]),
            confidence=0.0,
            model_version=self.model_info.version,
            timestamp=datetime.utcnow(),
            status="INPUT_UNSUPPORTED",
            reason="Flood model requires full geographic feature engineering pipeline "
                        "not available in standard TOOFAN inputs.",
        )

    def explain(self, input_data, prediction: FloodPrediction) -> dict:
        return {
            "method": "xgboost_spatial_holdout",
            "model_type": "XGBoost",
            "note": "FANI 2019 case study. Spatial holdout validation only. "
                    "Requires full geographic preprocessing pipeline. "
                    "Not validated for temporal generalization.",
            "status": "BASELINE",
        }


class ModelAdapter(FloodModelAdapter):
    """Alias for orchestrator compatibility - accepts (raw_model, metadata)."""
    pass


def create_flood_adapter(
    checkpoint_path: str = "flood/model/flood_xgboost_improved.pkl",
    model_version: str = "improved"
) -> FloodModelAdapter:
    """Factory function to create flood adapter.

    Uses the Toofan Flood "improved" XGBoost artifact (`flood_xgboost_improved.pkl`),
    which carries reproducible spatial-holdout and temporal-validation metrics
    (see ``flood/metadata/flood_model_metadata.json``). The historical
    `flood_xgboost_spatial_holdout.pkl` artifact is superseded.
    """
    model_info = ModelInfo(
        name="flood_xgb",
        version=model_version,
        model_type="flood",
        loaded_at=datetime.utcnow(),
        framework="xgboost",
    )

    adapter = FloodModelAdapter(model_info)

    path = Path(checkpoint_path)
    if not path.exists():
        warnings.warn(
            f"Flood model artifact not found at {checkpoint_path}. "
            f"Model will be unavailable."
        )
        return adapter

    adapter.load(checkpoint_path)
    return adapter
