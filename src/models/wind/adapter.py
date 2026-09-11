"""Wind Field Model Adapter for Keras model (BASELINE / CASE STUDY).

Wraps the existing wind field Keras model. This is a single case study
(Yaas 2021) with no documented training pipeline or inference script.
"""

from __future__ import annotations

import warnings
from datetime import datetime
from pathlib import Path
from typing import Optional, Any

import numpy as np

from src.core.schema import (
    CycloneState,
    WindFieldPrediction,
    WindFieldGrid,
    TrackPrediction,
    IntensityPrediction,
)
from src.models.base import (
    BaseModel,
    WindModel,
    ModelInfo,
    ModelMetadata,
)


class WindModelAdapter(WindModel):
    """Adapter for the wind field Keras model.

    Status: BASELINE / PROTOTYPE - single case study (Yaas),
    architecture/training not documented, no inference pipeline.
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
                framework="tensorflow",
            )
            super().__init__(model_info)
        else:
            model_info = ModelInfo(
                name="wind_keras",
                version="baseline",
                model_type="wind",
                loaded_at=datetime.utcnow(),
                framework="tensorflow",
            )
            super().__init__(model_info)
        self._model = None
        self._input_shape = None
        self._is_loaded = False

    def load(self, checkpoint_path: str, **kwargs) -> None:
        """Load the wind model from Keras checkpoint."""
        path = Path(checkpoint_path)
        if not path.exists():
            raise FileNotFoundError(f"Wind model artifact not found: {checkpoint_path}")

        try:
            import tensorflow as tf
            self._model = tf.keras.models.load_model(str(path))
            self._input_shape = self._model.input_shape
            self._is_loaded = True
        except Exception as e:
            raise RuntimeError(f"Failed to load Keras wind model: {e}")

    def validate_input(self, input_data: CycloneState) -> bool:
        """Validate input - wind model requires specific gridded inputs."""
        if not isinstance(input_data, CycloneState):
            return False

        warnings.warn(
            "Wind model requires specific gridded environmental fields "
            "(not in standard CycloneState). Model is a Yaas case study "
            "with undocumented input requirements."
        )
        return False  # Cannot run with standard CycloneState

    def _build_input_tensor(self, cyclone_state: CycloneState,
                             track_prediction: Optional[TrackPrediction] = None,
                             intensity_prediction: Optional[IntensityPrediction] = None) -> np.ndarray:
        """Build input tensor - not applicable without documented preprocessing."""
        return np.array([])

    def predict(self, cyclone_state: CycloneState,
                track_prediction: Optional[TrackPrediction] = None,
                intensity_prediction: Optional[IntensityPrediction] = None) -> WindFieldPrediction:
        """Return BASELINE status - model cannot run with standard inputs."""
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        return WindFieldPrediction(
            wind_fields=[],
            confidence=0.0,
            model_version=self.model_info.version,
            timestamp=datetime.utcnow(),
            status="BASELINE",
            explanation="Model is Yaas 2021 case study with undocumented architecture/preprocessing. "
                        "Requires specific gridded inputs not available in CycloneState. "
                        "No inference pipeline exists in repository.",
        )

    def explain(self, input_data: CycloneState, prediction: WindFieldPrediction) -> dict:
        return {
            "method": "keras_cnn",
            "model_type": "Keras CNN",
            "note": "Yaas 2021 case study only. No training script, no inference pipeline, "
                    "input preprocessing undocumented. Not suitable for operational use.",
            "status": "BASELINE",
        }


class ModelAdapter(WindModelAdapter):
    """Alias for orchestrator compatibility - accepts (raw_model, metadata)."""
    pass


def create_wind_adapter(
    checkpoint_path: str = "wind/model/wind_model_best.keras",
    model_version: str = "baseline"
) -> WindModelAdapter:
    """Factory function to create wind adapter."""
    model_info = ModelInfo(
        name="wind_keras",
        version=model_version,
        model_type="wind",
        loaded_at=datetime.utcnow(),
        framework="tensorflow",
    )

    adapter = WindModelAdapter(model_info)

    path = Path(checkpoint_path)
    if not path.exists():
        warnings.warn(
            f"Wind model artifact not found at {checkpoint_path}. "
            f"Model will be unavailable."
        )
        return adapter

    adapter.load(checkpoint_path)
    return adapter