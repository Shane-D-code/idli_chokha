"""
Production inference for the distilled cyclone trajectory model.

Call:
    predict(observations)

Each observation:
    {
      "timestamp": "2026-08-01T00:00:00Z",
      "latitude": 15.2,
      "longitude": 85.4,
      "wind": 45.0,
      "pressure": 992.0
    }

Exactly 12 consecutive observations at 2-hour intervals are required.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Iterable

import joblib
import numpy as np
import torch

from config import FORECAST_HOURS, HISTORY_LENGTH, MODEL_KWARGS
from feature_builder import build_model_inputs, displacement_to_latlon
from model import CycloneForecaster


class CycloneInference:
    def __init__(
        self,
        checkpoint_path: str = "best_cyclone_model_lt3p_distilled.pth",
        scaler_path: str = "scalers.pkl",
        device: str | None = None,
    ):
        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )

        if not os.path.isfile(checkpoint_path):
            raise FileNotFoundError(
                f"Model checkpoint not found: {checkpoint_path}"
            )

        if not os.path.isfile(scaler_path):
            raise FileNotFoundError(
                f"Scaler file not found: {scaler_path}. "
                "Run export_scalers_cell.py in the original notebook first."
            )

        bundle = joblib.load(scaler_path)

        if not isinstance(bundle, dict):
            raise RuntimeError("Invalid scalers.pkl format.")

        self.track_scaler = bundle["track_scaler"]
        self.physics_scaler = bundle["physics_scaler"]

        self.model = CycloneForecaster(**MODEL_KWARGS).to(self.device)

        checkpoint = torch.load(
            checkpoint_path,
            map_location=self.device,
        )

        if isinstance(checkpoint, dict):
            if "model_state_dict" in checkpoint:
                state = checkpoint["model_state_dict"]
            elif "state_dict" in checkpoint:
                state = checkpoint["state_dict"]
            else:
                state = checkpoint
        else:
            state = checkpoint

        clean_state = {}
        for key, value in state.items():
            clean_state[key[7:] if key.startswith("module.") else key] = value

        self.model.load_state_dict(clean_state, strict=True)
        self.model.eval()

    @torch.inference_mode()
    def predict(self, observations: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
        track, physics, t0 = build_model_inputs(
            observations,
            self.track_scaler,
            self.physics_scaler,
        )

        track_t = torch.from_numpy(track).unsqueeze(0).to(self.device)
        physics_t = torch.from_numpy(physics).unsqueeze(0).to(self.device)

        out = self.model(track_t, physics_t)

        displacement = (
            out["displacement"][0].detach().cpu().numpy()
        )
        log_std = (
            out["uncertainty"][0].detach().cpu().numpy()
        )

        forecast = []

        for i, hour in enumerate(FORECAST_HOURS):
            east_km = float(displacement[i, 0])
            north_km = float(displacement[i, 1])

            lat, lon = displacement_to_latlon(
                float(t0[0]),
                float(t0[1]),
                east_km,
                north_km,
            )

            forecast.append({
                "hour": int(hour),
                "latitude": lat,
                "longitude": lon,
                "east_km": east_km,
                "north_km": north_km,
                "log_std_east": float(log_std[i, 0]),
                "log_std_north": float(log_std[i, 1]),
            })

        return {
            "status": "success",
            "history_length": HISTORY_LENGTH,
            "forecast_origin": {
                "latitude": float(t0[0]),
                "longitude": float(t0[1]),
            },
            "forecast_hours": FORECAST_HOURS,
            "forecast": forecast,
            "model": "LT3P-distilled student",
            "teacher_used_at_inference": False,
            "um_atmospheric_data_used_at_inference": False,
        }


_predictor = None


def predict(
    observations: Iterable[Dict[str, Any]],
    checkpoint_path: str = "best_cyclone_model_lt3p_distilled.pth",
    scaler_path: str = "scalers.pkl",
) -> Dict[str, Any]:
    global _predictor

    if _predictor is None:
        _predictor = CycloneInference(
            checkpoint_path=checkpoint_path,
            scaler_path=scaler_path,
        )

    return _predictor.predict(observations)
