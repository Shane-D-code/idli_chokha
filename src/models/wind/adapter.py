"""Wind Field Model Adapter for Keras model (BASELINE / CASE STUDY).

Wraps the existing wind field Keras model. This is a single case study
(Yaas 2021) with no documented training pipeline or inference script.

The underlying artifact is a ``.keras`` model that requires the TensorFlow
runtime. TensorFlow import can hard-abort the interpreter (SIGABRT / libc++
error) on broken environments before any Python-level exception is raised, so
the load path first probes TensorFlow import health in a subprocess and only
imports it in-process when the probe succeeds. If the runtime is unusable the
adapter exposes an explicit ``UNAVAILABLE`` status instead of crashing.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import warnings
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

from src.core.schema import (
    CycloneState,
    IntensityPrediction,
    TrackPrediction,
    WindFieldPrediction,
)
from src.models.base import (
    ModelInfo,
    ModelMetadata,
    WindModel,
)

_TF_HEALTH_CACHE: tuple[bool, str] | None = None


def _tensorflow_import_health() -> tuple[bool, str]:
    """Return (healthy, reason) for importing TensorFlow in THIS process.

    A crash while importing TensorFlow (e.g. a broken ``libc++`` mutex on some
    macOS builds) is a hard interpreter abort (SIGABRT) that cannot be caught
    by ``try/except``. We therefore probe the import in a child process and
    only import TensorFlow in-process when that probe succeeds.
    """
    global _TF_HEALTH_CACHE
    if _TF_HEALTH_CACHE is not None:
        return _TF_HEALTH_CACHE

    if importlib.util.find_spec("tensorflow") is None:
        _TF_HEALTH_CACHE = (False, "tensorflow is not installed in this environment")
        return _TF_HEALTH_CACHE

    try:
        result = subprocess.run(
            [sys.executable, "-c", "import tensorflow"],
            capture_output=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        _TF_HEALTH_CACHE = (False, "tensorflow import timed out (>120s)")
        return _TF_HEALTH_CACHE

    if result.returncode != 0:
        stderr = (result.stderr or b"")[-160:].decode(errors="replace")
        _TF_HEALTH_CACHE = (
            False,
            f"tensorflow import crashes the interpreter (probe rc={result.returncode}: {stderr!r})",
        )
        return _TF_HEALTH_CACHE

    _TF_HEALTH_CACHE = (True, "")
    return _TF_HEALTH_CACHE


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
        self._runtime_error: str | None = None

    def load(self, checkpoint_path: str, **kwargs) -> None:
        """Load the wind model from Keras checkpoint.

        TensorFlow is only imported in-process after a subprocess import-health
        probe succeeds; a hard-abort import is reported as a RuntimeError so the
        caller can degrade to an explicit UNAVAILABLE status instead of
        terminating the interpreter.
        """
        path = Path(checkpoint_path)
        if not path.exists():
            raise FileNotFoundError(f"Wind model artifact not found: {checkpoint_path}")

        healthy, reason = _tensorflow_import_health()
        if not healthy:
            self._runtime_error = (
                f"Keras wind model cannot be loaded: {reason}. "
                f"No wind field predictions are produced."
            )
            raise RuntimeError(self._runtime_error)

        try:
            import tensorflow as tf
            self._model = tf.keras.models.load_model(str(path))
            self._input_shape = self._model.input_shape
            self._is_loaded = True
        except Exception as e:
            self._runtime_error = f"Failed to load Keras wind model: {e}"
            raise RuntimeError(self._runtime_error)

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
                             track_prediction: TrackPrediction | None = None,
                             intensity_prediction: IntensityPrediction | None = None) -> np.ndarray:
        """Build input tensor - not applicable without documented preprocessing."""
        return np.array([])

    def predict(self, cyclone_state: CycloneState,
                track_prediction: TrackPrediction | None = None,
                intensity_prediction: IntensityPrediction | None = None) -> WindFieldPrediction:
        """Return explicit UNAVAILABLE/BASELINE status — no fabricated fields."""
        if self._runtime_error is not None:
            return WindFieldPrediction(
                wind_fields=[],
                confidence=0.0,
                model_version=self.model_info.version,
                timestamp=datetime.utcnow(),
                status="UNAVAILABLE",
                explanation=self._runtime_error,
            )

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
        note = (
            "Yaas 2021 case study only. No training script, no inference pipeline, "
            "input preprocessing undocumented. Not suitable for operational use."
        )
        if self._runtime_error is not None:
            note = f"{note} Runtime status: {self._runtime_error}"
        return {
            "method": "keras_cnn",
            "model_type": "Keras CNN",
            "note": note,
            "status": prediction.status,
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

    try:
        adapter.load(checkpoint_path)
    except (FileNotFoundError, RuntimeError) as e:
        warnings.warn(
            f"Wind model could not be loaded: {e}. "
            f"Model will report an explicit UNAVAILABLE status."
        )
    return adapter
