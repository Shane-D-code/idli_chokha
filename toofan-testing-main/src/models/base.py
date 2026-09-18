"""Base model interface for TOOFAN.

All models must implement this interface for consistent orchestration.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Optional
from dataclasses import dataclass

import numpy as np

from src.core.schema import (
    CycloneState, GenesisPrediction, TrackPrediction, RainfallPrediction,
    WindFieldPrediction, FloodPrediction, RIPrediction, IntensityPrediction,
    RecurvaturePrediction, LandslidePrediction, ModelMetadata
)


@dataclass
class ModelInfo:
    """Information about a loaded model."""
    name: str
    version: str
    model_type: str
    loaded_at: datetime
    metadata: Optional[ModelMetadata] = None
    framework: str = "unknown"  # xgboost, pytorch, tensorflow, sklearn, etc.


class BaseModel(ABC):
    """Abstract base class for all TOOFAN models."""

    def __init__(self, model_info: ModelInfo):
        self.model_info = model_info
        self._is_loaded = False

    @property
    def name(self) -> str:
        return self.model_info.name

    @property
    def version(self) -> str:
        return self.model_info.version

    @property
    def model_type(self) -> str:
        return self.model_info.model_type

    @abstractmethod
    def load(self, checkpoint_path: str, **kwargs) -> None:
        """Load model from checkpoint."""
        pass

    @abstractmethod
    def validate_input(self, input_data: Any) -> bool:
        """Validate input data before prediction."""
        pass

    @abstractmethod
    def predict(self, input_data: Any) -> Any:
        """Make prediction."""
        pass

    def predict_with_uncertainty(self, input_data: Any) -> tuple[Any, dict]:
        """Make prediction with uncertainty estimates.
        
        Returns (prediction, uncertainty_dict).
        Default implementation returns prediction with empty uncertainty.
        Override for models that support uncertainty.
        """
        prediction = self.predict(input_data)
        return prediction, {}

    @abstractmethod
    def explain(self, input_data: Any, prediction: Any) -> dict:
        """Generate explanation for prediction."""
        pass

    def metadata(self) -> ModelInfo:
        """Return model metadata."""
        return self.model_info

    def unload(self) -> None:
        """Unload model to free memory."""
        self._is_loaded = False


class CycloneModelBase(BaseModel):
    """Base class for models that consume CycloneState."""

    def validate_input(self, input_data: Any) -> bool:
        """Validate that input is a CycloneState."""
        from src.core.schema import CycloneState
        return isinstance(input_data, CycloneState)

    @abstractmethod
    def predict(self, cyclone_state: CycloneState) -> Any:
        pass


class GridModelBase(BaseModel):
    """Base class for models that produce grid outputs."""

    def validate_input(self, input_data: Any) -> bool:
        """Validate input has required grid data."""
        return hasattr(input_data, 'lats') and hasattr(input_data, 'lons')


class TabularModelBase(BaseModel):
    """Base class for tabular models (XGBoost, etc.)."""

    def __init__(self, model_info: ModelInfo, feature_names: list[str]):
        super().__init__(model_info)
        self.feature_names = feature_names

    def validate_input(self, input_data: Any) -> bool:
        """Validate input has required features."""
        if isinstance(input_data, dict):
            return all(f in input_data for f in self.feature_names)
        elif isinstance(input_data, np.ndarray):
            return input_data.shape[1] == len(self.feature_names)
        elif hasattr(input_data, 'columns'):  # DataFrame
            return all(f in input_data.columns for f in self.feature_names)
        return False

    def prepare_features(self, input_data: Any) -> np.ndarray:
        """Extract and order features for model input."""
        if isinstance(input_data, dict):
            return np.array([[input_data.get(f, 0.0) for f in self.feature_names]], dtype=np.float32)
        elif isinstance(input_data, np.ndarray):
            return input_data.astype(np.float32)
        elif hasattr(input_data, 'columns'):
            return input_data[self.feature_names].values.astype(np.float32)
        else:
            raise ValueError(f"Unsupported input type: {type(input_data)}")


class GenericModelAdapter(BaseModel):
    """Generic adapter for models that don't have a specific adapter."""

    def __init__(self, raw_model: Any, metadata: Optional[ModelMetadata] = None):
        model_info = ModelInfo(
            name=metadata.name if metadata else "unknown",
            version=metadata.version if metadata else "unknown",
            model_type=metadata.model_type if metadata else "unknown",
            loaded_at=datetime.utcnow(),
            metadata=metadata
        )
        super().__init__(model_info)
        self.raw_model = raw_model

    def load(self, checkpoint_path: str, **kwargs) -> None:
        # Already loaded
        self._is_loaded = True

    def validate_input(self, input_data: Any) -> bool:
        return True  # Can't validate generically

    def predict(self, input_data: Any) -> Any:
        """Generic predict - tries common interfaces."""
        if hasattr(self.raw_model, 'predict'):
            return self.raw_model.predict(input_data)
        elif hasattr(self.raw_model, 'predict_proba'):
            return self.raw_model.predict_proba(input_data)
        elif hasattr(self.raw_model, '__call__'):
            return self.raw_model(input_data)
        else:
            raise NotImplementedError("Model has no recognized predict method")

    def explain(self, input_data: Any, prediction: Any) -> dict:
        return {"method": "generic", "note": "No specific explainability implemented"}


class EnsembleModel(BaseModel):
    """Base class for ensemble models (multiple sub-models)."""

    def __init__(self, model_info: ModelInfo, sub_models: dict[str, BaseModel]):
        super().__init__(model_info)
        self.sub_models = sub_models

    def load(self, checkpoint_path: str, **kwargs) -> None:
        for name, model in self.sub_models.items():
            sub_path = kwargs.get(f'{name}_path')
            if sub_path:
                model.load(sub_path)
        self._is_loaded = True

    def validate_input(self, input_data: Any) -> bool:
        # All sub-models must validate
        return all(model.validate_input(input_data) for model in self.sub_models.values())

    def predict(self, input_data: Any) -> dict[str, Any]:
        """Return predictions from all sub-models."""
        return {name: model.predict(input_data) for name, model in self.sub_models.items()}

    def predict_with_uncertainty(self, input_data: Any) -> tuple[dict, dict]:
        predictions = {}
        uncertainties = {}
        for name, model in self.sub_models.items():
            pred, unc = model.predict_with_uncertainty(input_data)
            predictions[name] = pred
            uncertainties[name] = unc
        return predictions, uncertainties

    def explain(self, input_data: Any, prediction: Any) -> dict:
        explanations = {}
        for name, model in self.sub_models.items():
            pred = prediction.get(name) if isinstance(prediction, dict) else prediction
            explanations[name] = model.explain(input_data, pred)
        return explanations


# ============================================================================
# MODEL TYPE-SPECIFIC INTERFACES
# ============================================================================

class GenesisModel(CycloneModelBase):
    """Interface for genesis probability models."""

    @abstractmethod
    def predict(self, cyclone_state: CycloneState) -> GenesisPrediction:
        pass


class TrajectoryModel(CycloneModelBase):
    """Interface for trajectory/track models."""

    @abstractmethod
    def predict(self, cyclone_state: CycloneState) -> TrackPrediction:
        pass


class RainfallModel(BaseModel):
    """Interface for rainfall models."""

    @abstractmethod
    def predict(self, cyclone_state: CycloneState,
                track_prediction: Optional[TrackPrediction] = None,
                intensity_prediction: Optional[IntensityPrediction] = None) -> RainfallPrediction:
        pass


class WindModel(BaseModel):
    """Interface for wind field models."""

    @abstractmethod
    def predict(self, cyclone_state: CycloneState,
                track_prediction: Optional[TrackPrediction] = None,
                intensity_prediction: Optional[IntensityPrediction] = None) -> WindFieldPrediction:
        pass


class FloodModel(BaseModel):
    """Interface for flood models."""

    @abstractmethod
    def predict(self, rainfall_prediction: RainfallPrediction,
                wind_prediction: Optional[WindFieldPrediction] = None,
                cyclone_state: Optional[CycloneState] = None) -> FloodPrediction:
        pass


class RIModel(CycloneModelBase):
    """Interface for rapid intensification models."""

    @abstractmethod
    def predict(self, cyclone_state: CycloneState) -> RIPrediction:
        pass


class IntensityModel(CycloneModelBase):
    """Interface for intensity models."""

    @abstractmethod
    def predict(self, cyclone_state: CycloneState) -> IntensityPrediction:
        pass


class RecurvatureModel(BaseModel):
    """Interface for recurvature models."""

    @abstractmethod
    def predict(self, cyclone_state: CycloneState,
                track_prediction: Optional[TrackPrediction] = None) -> RecurvaturePrediction:
        pass


class LandslideModel(BaseModel):
    """Interface for landslide models."""

    @abstractmethod
    def predict(self, rainfall_prediction: RainfallPrediction,
                cyclone_state: Optional[CycloneState] = None) -> LandslidePrediction:
        pass


# ============================================================================
# MODEL FACTORY
# ============================================================================

class ModelFactory:
    """Factory for creating model instances."""

    _registry: dict[str, type] = {}

    @classmethod
    def register(cls, model_type: str, model_class: type):
        """Register a model class for a type."""
        cls._registry[model_type] = model_class

    @classmethod
    def create(cls, model_type: str, model_info: ModelInfo, **kwargs) -> BaseModel:
        """Create a model instance."""
        if model_type not in cls._registry:
            raise ValueError(f"Unknown model type: {model_type}. "
                           f"Available: {list(cls._registry.keys())}")
        return cls._registry[model_type](model_info, **kwargs)

    @classmethod
    def available_types(cls) -> list[str]:
        return list(cls._registry.keys())