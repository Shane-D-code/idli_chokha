"""Orchestrator-compatible trajectory adapter (distilled LT3P forecaster).

The orchestrator loads modules as ``ModelAdapter(raw_model, metadata)`` from
the registry. This adapter wraps the deployment-package forecaster
(`best_cyclone_model_lt3p_distilled.pth` + `scalers.pkl`) so that the
pipeline's TRAJECTORY module uses the new distilled track model. The adapter
loads its artifacts immediately in ``__init__`` (the orchestrator does not
call ``.load()``), so the returned instance is ready to predict.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from src.core.schema import ModelMetadata
from src.models.adapters.trajectory_adapter import (
    TrajectoryModelAdapter,
    DEFAULT_CHECKPOINT,
    DEFAULT_SCALERS,
)
from src.models.base import ModelInfo


class ModelAdapter(TrajectoryModelAdapter):
    """Orchestrator-compatible wrapper, constructed as ``(raw_model, metadata)``.

    The raw model artifact loaded by the registry is the checkpoint state-dict,
    which the deployment package loads itself; it is therefore ignored here.
    """

    def __init__(self, raw_model: Any = None, metadata: Optional[ModelMetadata] = None):
        checkpoint_path = (
            metadata.checkpoint_path if metadata and metadata.checkpoint_path
            else DEFAULT_CHECKPOINT
        )
        scaler_path = DEFAULT_SCALERS
        if metadata and metadata.configuration:
            scaler_path = metadata.configuration.get("scaler_path", DEFAULT_SCALERS)

        version = metadata.version if metadata else "lt3p"
        model_info = ModelInfo(
            name=metadata.name if metadata else "trajectory",
            version=version,
            model_type="trajectory",
            loaded_at=datetime.utcnow(),
            metadata=metadata,
            framework="pytorch",
        )

        super().__init__(model_info)
        self.load(checkpoint_path, scaler_path=scaler_path)


def create_traj_adapter(checkpoint_path: str = DEFAULT_CHECKPOINT,
                        scaler_path: str = DEFAULT_SCALERS) -> ModelAdapter:
    """Factory that builds and loads an orchestrator-compatible trajectory adapter."""
    return ModelAdapter(raw_model=None, metadata=ModelMetadata(
        name="trajectory",
        version="lt3p",
        model_type="trajectory",
        training_dataset="deployment package (LT3P distilled student)",
        feature_version="v2",
        training_period=("", ""),
        validation_metrics={},
        test_metrics={},
        preprocessing_version="v2",
        checkpoint_path=checkpoint_path,
        configuration={"scaler_path": scaler_path},
        timestamp=datetime.utcnow(),
    ))