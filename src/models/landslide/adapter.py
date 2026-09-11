"""Landslide Model Adapter - STATIC_SUSCEPTIBILITY / UNAVAILABLE.

The stage17_hazard_maps module generates static PNG hazard maps from
rainfall images + terrain. No trained ML model exists for dynamic
cyclone-triggered landslide prediction.
"""

from __future__ import annotations

import warnings
from datetime import datetime
from pathlib import Path
from typing import Optional, Any

import numpy as np

from src.core.schema import (
    CycloneState,
    LandslidePrediction,
    RainfallPrediction,
    RiskLevel,
)
from src.models.base import (
    BaseModel,
    LandslideModel,
    ModelInfo,
    ModelMetadata,
)


class LandslideModelAdapter(LandslideModel):
    """Adapter for landslide - no ML model exists.

    Status: STATIC_SUSCEPTIBILITY - only static hazard map generation
    from rainfall + terrain exists. No dynamic event prediction model.
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
                framework="none",
            )
            super().__init__(model_info)
        else:
            model_info = ModelInfo(
                name="landslide",
                version="unavailable",
                model_type="landslide",
                loaded_at=datetime.utcnow(),
                framework="none",
            )
            super().__init__(model_info)
        self._is_loaded = False

    def load(self, checkpoint_path: str, **kwargs) -> None:
        """No model artifact to load."""
        warnings.warn(
            "No landslide ML model artifact exists. "
            "stage17_hazard_maps only generates static PNG maps. "
            "Returning STATIC_SUSCEPTIBILITY status."
        )
        self._is_loaded = True

    def validate_input(self, input_data) -> bool:
        """Validate inputs - requires rainfall prediction."""
        if not isinstance(input_data, tuple) and len(input_data) < 1:
            return False
        return input_data[0] is not None

    def predict(self, rainfall_prediction: RainfallPrediction,
                cyclone_state: Optional[CycloneState] = None) -> LandslidePrediction:
        """Return STATIC_SUSCEPTIBILITY status - no dynamic prediction model."""
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        from src.core.schema import LandslideGrid
        empty_grid = LandslideGrid(
            probability_grid=np.array([[]]),
            susceptibility_grid=np.array([[]]),
            risk_level_grid=np.array([[]]),
            lats=np.array([]),
            lons=np.array([]),
        )

        return LandslidePrediction(
            probability_grid=empty_grid,
            high_risk_regions=[],
            confidence=0.0,
            model_version=self.model_info.version,
            timestamp=datetime.utcnow(),
            status="STATIC_SUSCEPTIBILITY",
            reason="No dynamic landslide ML model exists in repository. "
                        "stage17_hazard_maps only generates static hazard PNG maps "
                        "from rainfall images + terrain. No cyclone-triggered "
                        "landslide forecasting capability.",
        )

    def explain(self, input_data, prediction: LandslidePrediction) -> dict:
        return {
            "method": "static_hazard_mapping",
            "model_type": "none (static visualization only)",
            "note": "stage17_hazard_maps generates PNG hazard maps from rainfall + terrain. "
                    "No trained ML model, no probabilistic output, no inference pipeline. "
                    "Not a dynamic cyclone landslide forecasting model.",
            "status": "STATIC_SUSCEPTIBILITY",
        }


class ModelAdapter(LandslideModelAdapter):
    """Alias for orchestrator compatibility - accepts (raw_model, metadata)."""
    pass


def create_landslide_adapter(
    checkpoint_path: str = "",
    model_version: str = "unavailable"
) -> LandslideModelAdapter:
    """Factory function to create landslide adapter (always unavailable)."""
    model_info = ModelInfo(
        name="landslide",
        version=model_version,
        model_type="landslide",
        loaded_at=datetime.utcnow(),
        framework="none",
    )

    adapter = LandslideModelAdapter(model_info)
    adapter.load(checkpoint_path)
    return adapter