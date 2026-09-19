"""Wind Field Model Adapter for Keras model (BASELINE / CASE STUDY).

Wraps the existing wind field Keras model. This is a single case study
(Yaas 2021) with no documented training pipeline or inference script.

The underlying artifact is a ``.keras`` model that requires the TensorFlow
runtime. TensorFlow import can hard-abort the interpreter (SIGABRT / libc++
error) on broken environments before any Python-level exception is raised, so
the load path first probes TensorFlow import health in a subprocess and only
imports it in-process when the probe succeeds. If the runtime is unusable the
adapter exposes an explicit ``UNAVAILABLE`` status instead of crashing.

Inference contract
------------------
The verified model maps ``(batch, 6, 81, 57, 2)`` U10/V10 grids (m/s) to a
``(batch, 81, 57, 2)`` future-wind field. A real inference path is available
through :meth:`WindModelAdapter.predict_grids`, which applies the documented
normalization (``wind/metadata/wind_normalization.txt``) before calling the
model and denormalizes the output back to m/s.

The grid-fed path NEVER fabricates inputs: it only executes when the caller
supplies actual U10/V10 grid data. When no grids are supplied, the adapter
keeps its honest ``BASELINE``/``UNAVAILABLE`` contract and produces no wind
fields, because no gridded U10/V10 provider ships in this repository.
"""

from __future__ import annotations

import importlib.util
import re
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
    WindFieldGrid,
    WindFieldPrediction,
)
from src.models.base import (
    ModelInfo,
    ModelMetadata,
    WindModel,
)

_TF_HEALTH_CACHE: tuple[bool, str] | None = None

_NORMALIZATION_PATH = Path("wind/metadata/wind_normalization.txt")
_INPUT_FRAMES = 6
_GRID_ROWS = 81
_GRID_COLS = 57
_CHANNELS = 2

_INFERENCE_TIMEOUT_S = 240

# Inference worker runs in an isolated subprocess. It imports TensorFlow
# BEFORE numpy and never imports pandas: on macOS arm64, loading pandas before
# TensorFlow makes TF's ``model.predict()`` deadlock (native-library load-order
# conflict). The subprocess also means a TensorFlow hard-abort (SIGABRT / broken
# libc++) can only kill the worker, never the main application.
_INFERENCE_WORKER = """\
import sys, io
import tensorflow as tf
import numpy as np

model_path = sys.argv[1]
x = np.load(io.BytesIO(sys.stdin.buffer.read()), allow_pickle=False)
model = tf.keras.models.load_model(model_path)
out = model.predict(x, verbose=0)
buf = io.BytesIO()
np.save(buf, np.asarray(out, dtype=np.float32))
sys.stdout.buffer.write(buf.getvalue())
sys.stdout.buffer.flush()
"""


def _parse_normalization(path: str | Path) -> dict[str, float] | None:
    """Parse the documented wind normalization parameters.

    Returns a dict with keys ``u_mean``, ``u_std``, ``v_mean``, ``v_std`` or
    ``None`` when the artifact is missing/unparseable. These are the ONLY
    normalization constants the model was verified with; we do not invent new
    ones.
    """
    p = Path(path)
    if not p.exists():
        return None
    try:
        text = p.read_text()
    except OSError:
        return None
    values: dict[str, float] = {}
    for m in re.finditer(r"(U10|V10)\s+(mean|std):\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)", text):
        values[f"{m.group(1).lower()}_{m.group(2)}"] = float(m.group(3))
    required = {"u10_mean", "u10_std", "v10_mean", "v10_std"}
    if not required.issubset(values):
        return None
    return {
        "u_mean": values["u10_mean"],
        "u_std": values["u10_std"],
        "v_mean": values["v10_mean"],
        "v_std": values["v10_std"],
    }


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

    Linear inference path: :meth:`predict_grids` (real U10/V10 grids in,
    real wind fields out, documented normalization applied). Without a real
    gridded input the adapter stays HONEST: ``BASELINE`` (model loaded) or
    ``UNAVAILABLE`` (TensorFlow runtime unusable), never fabricating fields.
    """

    def __init__(self, raw_model: Any = None, metadata: ModelMetadata = None, model_info: ModelInfo = None):
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
        self._normalization: dict[str, float] | None = None
        self._checkpoint_path: str | None = (
            str(metadata.checkpoint_path) if metadata and metadata.checkpoint_path else None
        )

        # Orchestrator path: ``ModelAdapter(raw_model, metadata)`` hands us the
        # already-loaded Keras model. Adopt it so the pipeline module is LIVE
        # (Model loaded) instead of reporting ``model=None / UNAVAILABLE``.
        if raw_model is not None:
            self._model = raw_model
            try:
                self._input_shape = self._model.input_shape
            except Exception:
                self._input_shape = None
            self._is_loaded = True
            self._normalization = _parse_normalization(_NORMALIZATION_PATH)

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

        self._checkpoint_path = str(path)

        try:
            import tensorflow as tf
            self._model = tf.keras.models.load_model(str(path))
            self._input_shape = self._model.input_shape
            self._is_loaded = True
            self._normalization = _parse_normalization(_NORMALIZATION_PATH)
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

    def _run_tf_inference(self, x: np.ndarray) -> np.ndarray:
        """Run ``model.predict`` in an isolated subprocess.

        TensorFlow prediction can deadlock when heavny native libraries (pandas/
        xarray) were imported earlier in the same process (macOS arm64). The
        worker process imports TensorFlow BEFORE anything else and never imports
        pandas, so prediction always runs in a clean load order. A worker
        crash (e.g. TF hard-abort) is surfaced as a ``RuntimeError`` instead of
        taking down the application.
        """
        if not self._checkpoint_path:
            raise RuntimeError("Wind model checkpoint path is unknown; cannot isolate inference.")

        try:
            import io
            payload = io.BytesIO()
            np.save(payload, x)
            result = subprocess.run(
                [sys.executable, "-c", _INFERENCE_WORKER, str(self._checkpoint_path)],
                input=payload.getvalue(),
                capture_output=True,
                timeout=_INFERENCE_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(
                f"Wind TF inference worker timed out after >{_INFERENCE_TIMEOUT_S}s."
            ) from None
        except OSError as e:
            raise RuntimeError(f"Could not start wind TF inference worker: {e}") from None

        if result.returncode != 0:
            stderr = (result.stderr or b"")[-400:].decode(errors="replace")
            raise RuntimeError(
                f"Wind TF inference worker failed (rc={result.returncode}): {stderr!r}"
            )

        try:
            return np.asarray(np.load(io.BytesIO(result.stdout), allow_pickle=False), dtype=np.float32)
        except Exception as e:
            raise RuntimeError(f"Wind TF inference worker produced unreadable output: {e}") from None

    def predict_grids(self, grids: np.ndarray,
                      forecast_time: datetime | None = None,
                      lats: np.ndarray | None = None,
                      lons: np.ndarray | None = None) -> WindFieldPrediction:
        """Run REAL inference on caller-supplied U10/V10 grid data.

        Args:
            grids: U10/V10 wind grids in m/s, shape ``(6, 81, 57, 2)`` or
                ``(batch, 6, 81, 57, 2)``. Channel 0 = U10, channel 1 = V10,
                frames ordered earliest -> latest. Values must be finite.
            forecast_time: time stamp for the produced field.
            lats: optional (81,) latitude grid; when omitted the output grid
                uses index-space coordinates (``np.arange``) because the
                model's geographic extent is undocumented.
            lons: optional (57,) longitude grid.

        The documented normalization (``wind/metadata/wind_normalization.txt``)
        is applied before the model call and the output is denormalized back to
        m/s. This path never fabricates inputs; it only executes when real
        grid data is passed in.

        Returns:
            A ``WindFieldPrediction`` carrying one ``WindFieldGrid`` per batch
            element, with ``status="AVAILABLE"``.
        """
        if self._runtime_error is not None:
            return WindFieldPrediction(
                wind_fields=[],
                confidence=0.0,
                model_version=self.model_info.version,
                timestamp=datetime.utcnow(),
                status="UNAVAILABLE",
                explanation=self._runtime_error,
            )
        if not self._is_loaded or self._model is None:
            raise RuntimeError("Model not loaded. Call load() first.")

        arr = np.asarray(grids, dtype=np.float32)
        if arr.ndim == 4:
            arr = arr[None, ...]  # (6, 81, 57, 2) -> (1, 6, 81, 57, 2)
        expected = (None, _INPUT_FRAMES, _GRID_ROWS, _GRID_COLS, _CHANNELS)
        if arr.ndim != 5 or arr.shape[1:] != expected[1:]:
            raise ValueError(
                f"Wind model expects grids of shape (batch, {_INPUT_FRAMES}, "
                f"{_GRID_ROWS}, {_GRID_COLS}, {_CHANNELS}) (U10, V10); got {arr.shape}. "
                "Channel 0 = U10, channel 1 = V10, frames ordered earliest -> latest."
            )
        if not np.all(np.isfinite(arr)):
            raise ValueError("Wind model input grids contain NaN/inf values.")

        norm = self._normalization
        if norm is None:
            raise RuntimeError(
                "Documented wind normalization parameters are unavailable "
                f"(expected {_NORMALIZATION_PATH}); refusing to run unnormalized inference."
            )

        # Standardize to the model's documented input distribution.
        x = arr.copy()
        x[..., 0] = (x[..., 0] - norm["u_mean"]) / norm["u_std"]
        x[..., 1] = (x[..., 1] - norm["v_mean"]) / norm["v_std"]

        out = self._run_tf_inference(x)

        # Denormalize back to physical m/s fields.
        denorm = out.copy()
        denorm[..., 0] = denorm[..., 0] * norm["u_std"] + norm["u_mean"]
        denorm[..., 1] = denorm[..., 1] * norm["v_std"] + norm["v_mean"]

        rows, cols = denorm.shape[1], denorm.shape[2]
        y_lats = (np.arange(rows, dtype=np.float64)
                  if lats is None else np.asarray(lats, dtype=np.float64))
        x_lons = (np.arange(cols, dtype=np.float64)
                  if lons is None else np.asarray(lons, dtype=np.float64))

        wind_fields: list[WindFieldGrid] = []
        for b in range(denorm.shape[0]):
            u = denorm[b, ..., 0]
            v = denorm[b, ..., 1]
            speed = np.sqrt(u * u + v * v)
            direction = np.mod(270.0 - np.degrees(np.arctan2(v, u)), 360.0)
            wind_fields.append(
                WindFieldGrid(
                    forecast_time=forecast_time or datetime.utcnow(),
                    u10=u,
                    v10=v,
                    speed=speed,
                    direction=direction,
                    lats=y_lats,
                    lons=x_lons,
                )
            )

        note = (
            "Real model inference on caller-supplied U10/V10 grids "
            "(documented normalization applied). No calibrated confidence is "
            "available (model carries no validation metrics)."
        )
        if lats is None or lons is None:
            note += " Grid coordinates are index-space (lats/lons not supplied); " \
                    "the model grid extent is undocumented."
        return WindFieldPrediction(
            wind_fields=wind_fields,
            confidence=0.0,
            model_version=self.model_info.version,
            timestamp=datetime.utcnow(),
            status="AVAILABLE",
            explanation=note,
        )

    def predict(self, cyclone_state: CycloneState,
                track_prediction: TrackPrediction | None = None,
                intensity_prediction: IntensityPrediction | None = None,
                grids: np.ndarray | None = None) -> WindFieldPrediction:
        """Return explicit UNAVAILABLE/BASELINE status — no fabricated fields
        — unless real gridded U10/V10 data is supplied via ``grids``, in which
        case real model inference runs.
        """
        if grids is not None:
            return self.predict_grids(grids, lats=None, lons=None)

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
                        "No real gridded U10/V10 input was supplied; call predict() with grids= "
                        "or predict_grids() with actual U10/V10 data to run real inference. "
                        "No fabricated fields are produced.",
        )

    def explain(self, input_data: CycloneState, prediction: WindFieldPrediction) -> dict:
        note = (
            "Yaas 2021 case study only. No training script and no validation "
            "metrics; real inference requires caller-supplied U10/V10 grids "
            "(predict_grids) with the documented normalization."
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

    adapter = WindModelAdapter(model_info=model_info)

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
