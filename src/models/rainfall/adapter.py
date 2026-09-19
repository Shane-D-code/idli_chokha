"""Rainfall Model Adapter for Random Forest classifier (BASELINE).

Wraps the existing rainfall Random Forest model. Note: this model
appears to be an analysis-time/same-time classifier on FANI 2019 case study,
not a future rainfall forecasting model.
"""

from __future__ import annotations

import warnings
import joblib
import numpy as np
from datetime import datetime
from pathlib import Path
from typing import Optional, Any

import pandas as pd

from src.core.schema import (
    CycloneState,
    RainfallPrediction,
    RainfallGrid,
    TrackPrediction,
    IntensityPrediction,
    RiskLevel,
)
from src.models.base import (
    BaseModel,
    RainfallModel,
    ModelInfo,
    ModelMetadata,
)


class RainfallModelAdapter(RainfallModel):
    """Adapter for the rainfall Random Forest model.

    Status: AVAILABLE_BASELINE - this is a same-time classifier,
    not a future forecasting model. It classifies current rainfall
    intensity categories from IMERG data.
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
                framework="sklearn",
            )
            super().__init__(model_info)
        else:
            model_info = ModelInfo(
                name="rainfall_rf",
                version="baseline",
                model_type="rainfall",
                loaded_at=datetime.utcnow(),
                framework="sklearn",
            )
            super().__init__(model_info)
        self._pipeline = None
        self._feature_columns = None
        self._is_loaded = False
        self._regressor = None
        self._regressor_path = None

    def load(self, checkpoint_path: str, **kwargs) -> None:
        """Load the rainfall classifier from its checkpoint.

        The two-stage rainfall model (see ``rain/metadata/rainfall_model_12_metadata.json``)
        also has a RandomForest regressor stage, loaded lazily via the
        :attr:`regressor` property when ``regressor_path`` is supplied in
        ``kwargs``. The classifier artifact is identical across the historical
        ``rain/model/`` copy and the Toofan deployment folders.
        """
        path = Path(checkpoint_path)
        if not path.exists():
            raise FileNotFoundError(f"Rainfall model artifact not found: {checkpoint_path}")

        self._pipeline = joblib.load(path)
        self._feature_columns = []
        self._regressor = None
        self._regressor_path = kwargs.get("regressor_path")
        self._is_loaded = True

    @property
    def regressor(self):
        """Return the second-stage RandomForest regressor (lazy-loaded).

        Returns ``None`` when the regressor artifact is not configured/present.
        """
        if self._regressor_path and self._regressor is None:
            reg_path = Path(self._regressor_path)
            if not reg_path.exists():
                warnings.warn(f"Rainfall regressor artifact not found: {self._regressor_path}")
                self._regressor_path = None
                return None
            self._regressor = joblib.load(reg_path)
        return self._regressor

    def validate_input(self, input_data: CycloneState) -> bool:
        """Validate input - this model requires IMERG rainfall grids."""
        if not isinstance(input_data, CycloneState):
            return False

        # This model requires satellite rainfall data
        # which is not part of standard CycloneState
        warnings.warn(
            "Rainfall model requires IMERG rainfall grids (not in CycloneState). "
            "Returning BASELINE status - model cannot run with standard inputs."
        )
        return False  # Cannot run with standard CycloneState

    def _build_features(self, cyclone_state: CycloneState,
                         track_prediction: Optional[TrackPrediction] = None,
                         intensity_prediction: Optional[IntensityPrediction] = None) -> np.ndarray:
        """Build feature vector - not applicable for this model."""
        return np.array([[]], dtype=np.float32)

    def predict(self, cyclone_state: CycloneState,
                track_prediction: Optional[TrackPrediction] = None,
                intensity_prediction: Optional[IntensityPrediction] = None) -> RainfallPrediction:
        """Return BASELINE status - model cannot run with standard inputs."""
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        return RainfallPrediction(
            rainfall_3h=None,
            rainfall_6h=None,
            rainfall_12h=None,
            rainfall_24h=None,
            confidence=0.0,
            model_version=self.model_info.version,
            timestamp=datetime.utcnow(),
            status="AVAILABLE_BASELINE",
            explanation="Model is a FANI 2019 case study same-time classifier requiring IMERG grids. "
                        "Not a future rainfall forecasting model. Cannot run with standard CycloneState inputs.",
        )

    def explain(self, input_data: CycloneState, prediction: RainfallPrediction) -> dict:
        return {
            "method": "random_forest_classifier",
            "model_type": "RandomForest (sklearn)",
            "note": "Same-time analysis classifier on FANI 2019 case study. "
                    "Requires IMERG rainfall grids. Not a forecast model.",
            "status": "AVAILABLE_BASELINE",
        }


class ModelAdapter(RainfallModelAdapter):
    """Alias for orchestrator compatibility - accepts (raw_model, metadata)."""
    pass


def create_rainfall_adapter(
    checkpoint_path: str = "rain/model/rainfall_classifier_12.pkl",
    model_version: str = "baseline",
    regressor_path: str = "rain/model/rainfall_regressor_12.pkl",
) -> RainfallModelAdapter:
    """Factory function to create rainfall adapter (two-stage model).

    Loads the Rainfall classifier and, when the regressor artifact is present,
    lazily exposes the second-stage regressor via ``adapter.regressor``.
    """
    model_info = ModelInfo(
        name="rainfall_two_stage",
        version=model_version,
        model_type="rainfall",
        loaded_at=datetime.utcnow(),
        framework="sklearn",
    )

    adapter = RainfallModelAdapter(model_info)

    path = Path(checkpoint_path)
    if not path.exists():
        warnings.warn(
            f"Rainfall model artifact not found at {checkpoint_path}. "
            f"Model will be unavailable."
        )
        return adapter

    adapter.load(checkpoint_path, regressor_path=regressor_path)
    return adapter