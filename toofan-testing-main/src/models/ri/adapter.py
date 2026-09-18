"""Orchestrator-compatible RI adapter.

The orchestrator loads modules as ``ModelAdapter(raw_model, metadata)`` from
the registry. This adapter wraps the runtime RI adapter
(:mod:`src.models.adapters.ri_adapter`) so the pipeline's RI module runs the
validated IMD XGBoost branch (see that module's docstring for the honest
IMD_ONLY / UNAVAILABLE contract). The registry checkpoint path points at the
validated ``RI/models/imd_ri_model.json`` artifact; the branch directory is its
parent. The raw model artifact loaded by the registry is superfluous here — the
adapter loads its own branch models in ``ModelAdapter.__init__``.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from src.core.schema import ModelMetadata
from src.models.adapters.ri_adapter import RIModelAdapter
from src.models.base import ModelInfo

DEFAULT_CHECKPOINT = "RI/models"


def _checkpoint_dir(checkpoint_path: str | None) -> str:
    """Return the branch directory implied by a registry checkpoint path."""
    if not checkpoint_path:
        return DEFAULT_CHECKPOINT
    p = Path(checkpoint_path)
    return str(p.parent) if p.exists() and not p.is_dir() else str(p)


class ModelAdapter(RIModelAdapter):
    """Orchestrator-compatible wrapper, constructed as ``(raw_model, metadata)``.

    ``metadata.checkpoint_path`` (typically ``RI/models/imd_ri_model.json``) is
    used to locate the model branch directory; ``MetaData``/``None`` fall back
    to ``RI/models``. The IMD+ERA5 fusion artifact path is taken from
    ``metadata.configuration["fusion_checkpoint"]`` when present, else the
    canonical fusion checkpoint in :mod:`src.models.ri.fusion`.
    """

    def __init__(self, raw_model: Any = None, metadata: ModelMetadata | None = None):
        checkpoint_path = (
            metadata.checkpoint_path if metadata and metadata.checkpoint_path
            else DEFAULT_CHECKPOINT
        )
        fusion_checkpoint = None
        if metadata and metadata.configuration:
            fusion_checkpoint = metadata.configuration.get("fusion_checkpoint")

        version = metadata.version if metadata else "v1"
        model_info = ModelInfo(
            name=metadata.name if metadata and metadata.name else "ri",
            version=version,
            model_type="ri",
            loaded_at=datetime.utcnow(),
            metadata=metadata,
            framework="xgboost",
        )

        super().__init__(model_info)
        self.load(_checkpoint_dir(checkpoint_path),
                  fusion_checkpoint=fusion_checkpoint)


def create_ri_adapter(checkpoint_path: str = DEFAULT_CHECKPOINT,
                      model_version: str = "v1") -> ModelAdapter:
    """Factory that builds and loads an orchestrator-compatible RI adapter."""
    return ModelAdapter(raw_model=None, metadata=ModelMetadata(
        name="ri",
        version=model_version,
        model_type="ri",
        training_dataset="IMD BoB best-track (RI MVP, IMD branch)",
        feature_version="v1",
        training_period=("", ""),
        validation_metrics={},
        test_metrics={},
        preprocessing_version="v1",
        checkpoint_path=_checkpoint_dir(checkpoint_path),
        timestamp=datetime.utcnow(),
    ))
