"""Trajectory Model Adapter for the distilled LT3P forecaster.

Wraps the self-contained `cyclone_path_deployment_package` (a.k.a.
`best_cyclone_model_lt3p_distilled.pth` + `scalers.pkl`) to conform to the
standardized TrackPrediction schema.

The deployment model consumes exactly 12 consecutive observations at 2-hourly
intervals (lat, lon, wind, pressure) and predicts the future track for the
2..24 h horizons. This adapter reconstructs that 12-point history from the
single CycloneState it receives, runs the model through the deployment
package's `CycloneInference`, and maps the result to TrackPrediction.
"""

from __future__ import annotations

import math
import sys
import warnings
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import torch

from src.core.schema import CycloneState, TrackPrediction
from src.models.base import TrajectoryModel, ModelInfo


REPO_ROOT = Path(__file__).resolve().parents[3]
DEPLOYMENT_DIR = REPO_ROOT / "cyclone_path_deployment_package"
DEFAULT_CHECKPOINT = "best_cyclone_model_lt3p_distilled.pth"
DEFAULT_SCALERS = "scalers.pkl"


def _resolve_artifact(path: str, kind: str) -> str:
    """Resolve an artifact path relative to cwd or the repo root."""
    p = Path(path)
    if p.is_file():
        return str(p)
    root_p = REPO_ROOT / path
    if root_p.is_file():
        return str(root_p)
    raise FileNotFoundError(
        f"{kind} not found: {path} (tried cwd and {REPO_ROOT})"
    )


def _load_deployment_inference():
    """Import CycloneInference from the self-contained deployment package.

    `inference.py` (and its siblings) use top-level ``from config import ...``
    style imports, so the package directory is placed on ``sys.path`` only for
    the duration of the import. Once loaded, the modules remain cached in
    ``sys.modules`` and the path entry is removed again.
    """
    pkg_dir = str(DEPLOYMENT_DIR)
    inserted = pkg_dir not in sys.path
    if inserted:
        sys.path.insert(0, pkg_dir)
    try:
        from inference import CycloneInference
    finally:
        if inserted:
            try:
                sys.path.remove(pkg_dir)
            except ValueError:
                pass
    return CycloneInference


class TrajectoryModelAdapter(TrajectoryModel):
    """Adapter for the distilled LT3P trajectory forecaster.

    Loads the checkpoint + scalers from the deployment package and returns
    standardized TrackPrediction outputs.
    """

    def __init__(self, model_info: ModelInfo):
        super().__init__(model_info)
        self._inference = None
        self._horizons = None
        self._history_length = None
        self._device = None

    def load(self, checkpoint_path: str, **kwargs) -> None:
        """Load the trajectory model from checkpoint.

        Args:
            checkpoint_path: Path to the ``.pth`` checkpoint file.
            scaler_path (kwarg): Path to the ``.pkl`` scaler bundle.
            device (kwarg): 'cuda' or 'cpu'.
        """
        self._device = torch.device(
            kwargs.get("device", "cuda" if torch.cuda.is_available() else "cpu")
        )
        scaler_path = kwargs.get("scaler_path", DEFAULT_SCALERS)

        ckpt_resolved = _resolve_artifact(checkpoint_path, "checkpoint")
        scaler_resolved = _resolve_artifact(scaler_path, "scalers")

        CycloneInference = _load_deployment_inference()
        self._inference = CycloneInference(
            checkpoint_path=ckpt_resolved,
            scaler_path=scaler_resolved,
            device=self._device,
        )

        from config import FORECAST_HOURS, HISTORY_LENGTH

        self._horizons = list(FORECAST_HOURS)
        self._history_length = HISTORY_LENGTH
        self._is_loaded = True

    def validate_input(self, input_data: CycloneState) -> bool:
        """Validate that input is a CycloneState with required fields."""
        if not isinstance(input_data, CycloneState):
            return False

        # Fields used to reconstruct the 12-point history / model inputs
        required = ["latitude", "longitude", "max_wind_kt",
                    "central_pressure_hpa", "timestamp"]
        for field in required:
            if getattr(input_data, field) is None:
                warnings.warn(f"Missing required field for trajectory: {field}")
                return False

        return True

    def _build_history_observations(self, cyclone_state: CycloneState) -> list[dict]:
        """Reconstruct 12 consecutive 2-hourly observations from a CycloneState.

        The deployment model is trained on a fixed 12-point, 2-hourly history.
        Starting from the current fix, positions are back-propagated along the
        current heading/translation speed and intensity trends
        (wind_change_6h / pressure_change_6h) are used to backfill wind/pressure.
        """
        t0 = cyclone_state.timestamp
        bearing = cyclone_state.heading_deg or 0.0
        speed_kmh = (cyclone_state.translation_speed_kt or 0.0) * 1.852
        dist_2h = speed_kmh * 2.0

        bearing_rad = math.radians(bearing)
        cos_lat = max(math.cos(math.radians(cyclone_state.latitude)), 0.1)

        wind0 = cyclone_state.max_wind_kt or 45.0
        pres0 = cyclone_state.central_pressure_hpa or 992.0
        wind_rate = (cyclone_state.wind_change_6h or 0.0) / 6.0
        pres_rate = (cyclone_state.pressure_change_6h or 0.0) / 6.0

        observations = []
        for k in range(self._history_length or 12):
            back_steps = (self._history_length - 1 - k) if self._history_length else (11 - k)
            hours_back = back_steps * 2.0
            dist_back = back_steps * dist_2h

            lat = cyclone_state.latitude - (dist_back * math.cos(bearing_rad)) / 111.32
            lon = cyclone_state.longitude - (dist_back * math.sin(bearing_rad)) / (111.32 * cos_lat)

            wind = max(1.0, min(250.0, wind0 - wind_rate * hours_back))
            pres = max(850.0, min(1050.0, pres0 - pres_rate * hours_back))

            observations.append({
                "timestamp": (t0 - timedelta(hours=hours_back)).isoformat(),
                "latitude": lat,
                "longitude": lon,
                "wind": round(wind, 2),
                "pressure": round(pres, 2),
            })

        return observations

    def _infer(self, cyclone_state: CycloneState):
        """Run deployment inference.

        Returns the raw result dict, per-horizon sigma-km estimates, and the
        per-horizon displacement vectors. A growing lead-time floor
        (10 + 2.5*h km) is applied as a lower bound. In practice the learned
        uncertainty head saturates at its output clamp (log_std ~ +5 → ~209.9 km
        per horizon) for virtually all inputs, well above the floor, so the
        reported sigma is dominated by the saturated head and does not encode
        track-error growth.
        """
        observations = self._build_history_observations(cyclone_state)
        result = self._inference.predict(observations)

        aleatoric_km = []
        displacement = []
        for h, item in zip(result["forecast_hours"], result["forecast"]):
            floor = 10.0 + 2.5 * h
            se = float(np.exp(np.clip(item["log_std_east"], -10.0, 10.0)))
            sn = float(np.exp(np.clip(item["log_std_north"], -10.0, 10.0)))
            sigma = float(np.hypot(se, sn))
            aleatoric_km.append(min(250.0, max(floor, sigma)))
            displacement.append(np.array([item["east_km"], item["north_km"]]))

        return result, aleatoric_km, displacement

    def _consistency_confidence(self, displacement: list[np.ndarray]) -> float:
        """Confidence from cross-horizon consistency of the forecast motion."""
        if len(displacement) < 2:
            return 0.5

        mean_dir = np.mean(displacement, axis=0)
        mean_norm = float(np.linalg.norm(mean_dir))
        if mean_norm < 1e-6:
            return 0.5

        sims = [
            float(np.dot(d, mean_dir) / (np.linalg.norm(d) * mean_norm))
            for d in displacement
            if np.linalg.norm(d) > 1e-6
        ]
        if not sims:
            return 0.5

        return max(0.0, min(1.0, float(np.mean(sims))))

    def predict(self, cyclone_state: CycloneState) -> TrackPrediction:
        """Predict cyclone trajectory.

        Args:
            cyclone_state: Current cyclone state with position, intensity, motion.

        Returns:
            TrackPrediction with forecast positions and uncertainties.
        """
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        if not self.validate_input(cyclone_state):
            raise ValueError("Invalid input for trajectory prediction")

        result, aleatoric_km, displacement = self._infer(cyclone_state)

        forecast_times = []
        latitudes = []
        longitudes = []
        uncertainty_km = []

        for item, sigma in zip(result["forecast"], aleatoric_km):
            forecast_times.append(cyclone_state.timestamp + timedelta(hours=item["hour"]))
            latitudes.append(item["latitude"])
            longitudes.append(item["longitude"])
            uncertainty_km.append(sigma)

        confidence = self._consistency_confidence(displacement)

        return TrackPrediction(
            forecast_times=forecast_times,
            latitudes=latitudes,
            longitudes=longitudes,
            position_error_estimates_km=uncertainty_km,
            uncertainty_km=uncertainty_km,
            confidence=confidence,
            model_version=self.model_info.version,
            timestamp=datetime.utcnow(),
            status="LIMITED/UNVERIFIED",
            explanation=(
                "Forecast track is produced by the runnable model, but the "
                "uncertainty band is not calibrated: the learned uncertainty "
                "head saturates at its output clamp (~209.9 km) across "
                "horizons, so per-horizon sigma_km is a broad constant bound "
                "that does NOT grow with lead time. Epistemic uncertainty is "
                "not quantified."
            ),
        )

    def predict_with_uncertainty(self, cyclone_state: CycloneState) -> tuple[TrackPrediction, dict]:
        """Predict with uncertainty estimates.

        The returned dict does not claim calibrated or horizon-dependent
        uncertainty. The learned uncertainty head is observed to saturate at
        its output clamp (~209.9 km) for all horizons, so ``aleatoric_km`` is a
        broad constant bound (status ``LIMITED/UNVERIFIED``) and epistemic
        uncertainty is NOT quantified.
        """
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        if not self.validate_input(cyclone_state):
            raise ValueError("Invalid input for trajectory prediction")

        result, aleatoric_km, _ = self._infer(cyclone_state)

        uncertainty = {
            "aleatoric_km": aleatoric_km,
            "epistemic_scale": None,
            "horizons_h": self._horizons or result["forecast_hours"],
            "status": "LIMITED/UNVERIFIED",
            "notes": [
                "learned uncertainty head saturates at its output clamp "
                "(~209.9 km) across horizons; per-horizon sigma is a broad "
                "constant bound, NOT calibrated to observed track error, and "
                "does NOT grow with lead time",
                "epistemic (model/parameter) uncertainty not quantified",
            ],
        }

        prediction = self.predict(cyclone_state)
        return prediction, uncertainty

    def explain(self, input_data: CycloneState, prediction: TrackPrediction) -> dict:
        """Generate explanation for trajectory prediction."""
        return {
            "method": "transformer_decoder_displacements",
            "model_type": "LT3P distilled student",
            "horizons_h": self._horizons,
            "note": "Displacement (east/north km) decoded per horizon from fused "
                    "track + physics-history Transformer.",
            "uncertainty_status": "LIMITED/UNVERIFIED",
            "uncertainty_note": "Learned uncertainty head output saturates at "
                    "its clamp (~209.9 km) across horizons; reported sigma_km is "
                    "a broad constant bound, not calibrated to observed track "
                    "error and not growing with lead time. Epistemic "
                    "uncertainty not quantified.",
        }


def create_trajectory_adapter(checkpoint_path: str = DEFAULT_CHECKPOINT,
                               model_version: str = "lt3p",
                               device: str = None,
                               scaler_path: str = DEFAULT_SCALERS) -> TrajectoryModelAdapter:
    """Factory function to create and load a trajectory adapter.

    Args:
        checkpoint_path: Path to the distilled ``.pth`` checkpoint.
        model_version: Version string for the model.
        device: Device to load model on ('cuda' or 'cpu').
        scaler_path: Path to the ``.pkl`` scaler bundle.

    Returns:
        Loaded TrajectoryModelAdapter instance.
    """
    model_info = ModelInfo(
        name="cyclone_track_distilled",
        version=model_version,
        model_type="trajectory",
        loaded_at=datetime.utcnow(),
        framework="pytorch",
    )

    adapter = TrajectoryModelAdapter(model_info)
    adapter.load(
        checkpoint_path,
        device=device or ("cuda" if torch.cuda.is_available() else "cpu"),
        scaler_path=scaler_path,
    )
    return adapter


class ModelAdapter(TrajectoryModelAdapter):
    """Alias for orchestrator compatibility."""
    pass