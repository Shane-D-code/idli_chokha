"""Model Registry for TOOFAN.

Manages model versions, metadata, artifacts, and loading.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass, field, asdict

import joblib
import pandas as pd

from src.core.schema import ModelMetadata, CycloneState


@dataclass
class RegistryEntry:
    """Registry entry for a model version."""
    name: str
    version: str
    model_type: str  # genesis, trajectory, rainfall, wind, flood, ri, intensity, recurvature, landslide
    training_dataset: str
    feature_version: str
    training_period: tuple[str, str]
    validation_metrics: dict[str, float]
    test_metrics: dict[str, float]
    preprocessing_version: str
    checkpoint_path: str
    calibration_artifact: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    git_commit: Optional[str] = None
    configuration: dict = field(default_factory=dict)
    file_hash: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> 'RegistryEntry':
        return cls(**data)


class ModelRegistry:
    """Central model registry."""

    def __init__(self, registry_dir: str | Path = "models/registry"):
        self.registry_dir = Path(registry_dir)
        self.registry_dir.mkdir(parents=True, exist_ok=True)
        self._index_path = self.registry_dir / "registry_index.json"
        self._entries: dict[str, RegistryEntry] = {}
        self._load_index()

    def _load_index(self):
        """Load registry index from disk."""
        if self._index_path.exists():
            with open(self._index_path, 'r') as f:
                data = json.load(f)
                for key, entry_data in data.items():
                    self._entries[key] = RegistryEntry.from_dict(entry_data)

    def _save_index(self):
        """Save registry index to disk."""
        data = {key: entry.to_dict() for key, entry in self._entries.items()}
        with open(self._index_path, 'w') as f:
            json.dump(data, f, indent=2)

    def _compute_file_hash(self, path: str | Path) -> str:
        """Compute SHA256 hash of file."""
        path = Path(path)
        if not path.exists():
            return ""
        hasher = hashlib.sha256()
        with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                hasher.update(chunk)
        return hasher.hexdigest()

    def _get_git_commit(self) -> Optional[str]:
        """Get current git commit hash."""
        try:
            result = subprocess.run(
                ['git', 'rev-parse', 'HEAD'],
                capture_output=True, text=True, cwd=os.getcwd()
            )
            if result.returncode == 0:
                return result.stdout.strip()[:12]
        except Exception:
            pass
        return None

    def register(self, entry: RegistryEntry) -> str:
        """Register a model version."""
        # Compute file hash
        entry.file_hash = self._compute_file_hash(entry.checkpoint_path)

        # Get git commit if not provided
        if entry.git_commit is None:
            entry.git_commit = self._get_git_commit()

        # Create key
        key = f"{entry.name}_v{entry.version}"

        # Check for conflicts
        if key in self._entries:
            existing = self._entries[key]
            if existing.file_hash != entry.file_hash:
                raise ValueError(
                    f"Model {key} already registered with different artifact. "
                    f"Use a new version number."
                )

        self._entries[key] = entry
        self._save_index()
        return key

    def get(self, name: str, version: str) -> Optional[RegistryEntry]:
        """Get a specific model version."""
        key = f"{name}_v{version}"
        return self._entries.get(key)

    def get_latest(self, name: str, model_type: Optional[str] = None) -> Optional[RegistryEntry]:
        """Get latest version of a model."""
        candidates = [
            entry for key, entry in self._entries.items()
            if entry.name == name and (model_type is None or entry.model_type == model_type)
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda e: e.timestamp)

    def list_models(self, model_type: Optional[str] = None) -> list[RegistryEntry]:
        """List all registered models."""
        entries = list(self._entries.values())
        if model_type:
            entries = [e for e in entries if e.model_type == model_type]
        return sorted(entries, key=lambda e: e.timestamp, reverse=True)

    def delete(self, name: str, version: str) -> bool:
        """Delete a model version from registry (does not delete artifact)."""
        key = f"{name}_v{version}"
        if key in self._entries:
            del self._entries[key]
            self._save_index()
            return True
        return False

    def load_model(self, name: str, version: str) -> Any:
        """Load a model artifact based on its type and format."""
        entry = self.get(name, version)
        if entry is None:
            raise ValueError(f"Model {name}_v{version} not found in registry")

        path = Path(entry.checkpoint_path)
        if not path.exists():
            raise FileNotFoundError(f"Model artifact not found: {path}")

        # Load based on file extension
        if path.suffix in ('.pt', '.pth'):
            import torch
            return torch.load(path, map_location='cpu')
        elif path.suffix == '.json':
            import xgboost as xgb
            try:
                model = xgb.XGBClassifier()
                model.load_model(str(path))
                return model
            except (TypeError, AttributeError):
                # xgboost>=2.1.3 + sklearn>=1.8 removed `_estimator_type` from
                # ClassifierMixin, so XGBClassifier.load_model() can raise
                # "`_estimator_type` undefined". Fall back to the Booster,
                # which the self-loading model adapters use directly anyway.
                booster = xgb.Booster()
                booster.load_model(str(path))
                return booster
        elif path.suffix in ['.pkl', '.joblib']:
            return joblib.load(path)
        elif path.suffix == '.keras':
            import tensorflow as tf
            return tf.keras.models.load_model(str(path))
        else:
            raise ValueError(f"Unknown model format: {path.suffix}")

    def get_metadata(self, name: str, version: str) -> Optional[ModelMetadata]:
        """Get model metadata in schema format."""
        entry = self.get(name, version)
        if entry is None:
            return None

        return ModelMetadata(
            name=entry.name,
            version=entry.version,
            model_type=entry.model_type,
            training_dataset=entry.training_dataset,
            feature_version=entry.feature_version,
            training_period=entry.training_period,
            validation_metrics=entry.validation_metrics,
            test_metrics=entry.test_metrics,
            preprocessing_version=entry.preprocessing_version,
            checkpoint_path=entry.checkpoint_path,
            calibration_artifact=entry.calibration_artifact,
            timestamp=datetime.fromisoformat(entry.timestamp),
            git_commit=entry.git_commit,
            configuration=entry.configuration
        )


class ModelLoader:
    """High-level model loading with adapter support."""

    def __init__(self, registry: ModelRegistry):
        self.registry = registry

    def load_adapter(self, model_type: str, name: str, version: str) -> Any:
        """Load model and wrap in appropriate adapter."""
        from src.models.base import BaseModel

        # Load raw model
        raw_model = self.registry.load_model(name, version)

        # Import adapter dynamically
        adapter_module_path = f"src.models.{model_type}.adapter"
        try:
            module = __import__(adapter_module_path, fromlist=['ModelAdapter'])
            adapter_class = getattr(module, 'ModelAdapter')
        except (ImportError, AttributeError):
            # Fallback to generic adapter
            from src.models.base import GenericModelAdapter
            adapter_class = GenericModelAdapter

        return adapter_class(raw_model, self.registry.get_metadata(name, version))


def create_registry_entry(name: str, version: str, model_type: str,
                          checkpoint_path: str, **kwargs) -> RegistryEntry:
    """Helper to create a registry entry with defaults."""
    return RegistryEntry(
        name=name,
        version=version,
        model_type=model_type,
        checkpoint_path=checkpoint_path,
        **kwargs
    )


# Global registry instance
_global_registry: Optional[ModelRegistry] = None


def get_registry(registry_dir: str | Path = "models/registry") -> ModelRegistry:
    """Get or create global registry instance."""
    global _global_registry
    if _global_registry is None:
        _global_registry = ModelRegistry(registry_dir)
    return _global_registry


def register_model(entry: RegistryEntry, registry_dir: str | Path = "models/registry") -> str:
    """Register a model in the global registry."""
    registry = get_registry(registry_dir)
    return registry.register(entry)