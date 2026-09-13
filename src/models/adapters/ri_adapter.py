"""Rapid Intensification Model Adapter for RI prediction.

Wraps the RI prediction system and conforms to the standardized
RIPrediction schema.

Runtime execution uses the IMD XGBoost branch only. The ERA5 and
IMD+ERA5 model artifacts exist, but their feature builders operate on
~89/101 reanalysis features that cannot be reconstructed at runtime from
the 17 CycloneState environmental fields, and the satellite CNN requires
Colab-trained artifacts plus the fold scaler under ``results/`` (not
present). The trained fusion meta-model artifact does not exist either.

The prior research (``cyclone_backup/SIH_FINAL_RI_REPORT.md``) found no
proven additive skill from ERA5 (dPR-AUC -0.25 vs IMD) or satellite
(N=9) data. Modes are therefore limited to ``IMD_ONLY`` and
``UNAVAILABLE``; ERA5/satellite/fusion probabilities are never fabricated.

RI Improvement 3: branch inference now honours each artifact's verified
``best_iteration`` metadata (``iteration_range=(0, best_iteration + 1)``) so
predictions match the frozen evaluation contract instead of averaging all
built trees.
"""

from __future__ import annotations

import warnings
import json
from datetime import datetime
from pathlib import Path
from typing import Optional, Literal

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

try:
    import torch
    _TORCH_AVAILABLE = True
except ImportError:
    torch = None
    _TORCH_AVAILABLE = False

from src.core.schema import (
    CycloneState,
    RIPrediction,
    RiskLevel,
    SatelliteImages,
)
from src.models.base import (
    BaseModel,
    RIModel,
    ModelInfo,
    ModelMetadata,
)


class RIBranchModel:
    """Wrapper for a single RI branch model (IMD, ERA5, or combined).

    Inference honours the model's **verified best iteration** stored in the
    artifact metadata (``learner.attributes.best_iteration``) instead of
    evaluating all built trees. This matches how the frozen models were
    actually evaluated (e.g. the ERA5 model's documented metrics use
    ``iteration_range=(0, best_iteration + 1)``). If an artifact has no
    best-iteration metadata, full-tree inference is used with a warning.
    """

    def __init__(self, model_path: str, feature_names: list[str]):
        # XGBClassifier.load_model()/predict_proba() are broken under xgboost
        # 2.1.3 + sklearn 1.8 ('_estimator_type' was removed from
        # ClassifierMixin). Booster.load_model() + predict() apply the same
        # binary:logistic objective, so probabilities are unchanged.
        self.model = xgb.Booster()
        self.model.load_model(str(model_path))
        self.model_path = str(model_path)
        self.feature_names = feature_names or self._saved_feature_names()

        # Verified best iteration from artifact metadata (authoritative).
        self.best_iteration = self._saved_best_iteration()
        self.best_score = self._saved_best_score()

    def _saved_best_iteration(self) -> Optional[int]:
        """Read ``learner.attributes.best_iteration`` from the artifact JSON."""
        try:
            payload = json.loads(Path(self.model_path).read_text())
            raw = payload["learner"].get("attributes", {}).get("best_iteration")
            if raw is None:
                return None
            return int(raw)
        except Exception:  # not a JSON artifact / malformed -> no metadata
            return None

    def _saved_best_score(self) -> Optional[float]:
        try:
            payload = json.loads(Path(self.model_path).read_text())
            raw = payload["learner"].get("attributes", {}).get("best_score")
            return float(raw) if raw is not None else None
        except Exception:
            return None

    def _saved_feature_names(self) -> list[str]:
        """Feature names/order stored in the model itself (authoritative)."""
        return list(self.model.feature_names or [])

    def predict_proba(self, X: np.ndarray,
                      iteration_range: Optional[tuple[int, int]] = None) -> np.ndarray:
        """Return P(RI=1) probabilities from the Booster (logistic output).

        Args:
            X: feature matrix aligned to ``feature_names``.
            iteration_range: optional ``(start, end)`` tree range override. When
                omitted and the artifact exposes a verified best iteration, the
                verified range ``(0, best_iteration + 1)`` is used. No fallback
                to all trees when a verified best iteration exists.
        """
        dmatrix = xgb.DMatrix(X, feature_names=self.feature_names)
        if iteration_range is None:
            if self.best_iteration is not None:
                iteration_range = (0, self.best_iteration + 1)
            else:
                warnings.warn(
                    f"{self.model_path} has no verified best_iteration metadata; "
                    "using all built trees.",
                    stacklevel=2,
                )
                iteration_range = (0, self.model.num_boosted_rounds())
        return self.model.predict(dmatrix, iteration_range=iteration_range)

    def validate_input(self, X: np.ndarray) -> bool:
        return X.shape[1] == len(self.feature_names)


class RISatelliteBranch:
    """Wrapper for the satellite CNN branch."""

    def __init__(self, model_path: str, tabular_scaler_path: str = None):
        if not _TORCH_AVAILABLE:
            raise RuntimeError("PyTorch not available for satellite branch")

        from cyclone_backup.src.satellite_cnn import (
            RICNNFusion, CN_TAB_FEATURES, normalize_patch, _load_fold0_scaler
        )

        self.model = RICNNFusion(tabular_dim=len(CN_TAB_FEATURES))
        state_dict = torch.load(model_path, map_location="cpu")
        self.model.load_state_dict(state_dict)
        self.model.eval()

        self.tab_features = CN_TAB_FEATURES
        self.scaler = _load_fold0_scaler(Path(model_path).parent.parent / "results")

    def predict_proba(self, ir_image: np.ndarray, tabular: np.ndarray,
                       mask: np.ndarray = None) -> float:
        """Predict P(RI=1) for a single sample."""
        from cyclone_backup.src.satellite_cnn import _to_tensor, _tabular_vector

        # Normalize image
        sample = normalize_patch(ir_image, mask)[None]
        ir = torch.from_numpy(sample).float()

        # Normalize tabular
        tab = torch.from_numpy(self.scaler.transform(tabular)).float()

        with torch.no_grad():
            logit = self.model(ir, tab)
            return float(torch.sigmoid(logit).numpy().item())


class RIModelAdapter(RIModel):
    """Adapter for the RI prediction system.

    Only the IMD branch is runtime-callable. The other branch artifacts
    (ERA5, combined, satellite) and the fusion meta-model are not usable at
    runtime (see module docstring), so the honest mode is always IMD_ONLY
    unless the IMD artifact is missing (then UNAVAILABLE).
    """

    def __init__(self, model_info: ModelInfo):
        super().__init__(model_info)
        self._imd_branch: Optional[RIBranchModel] = None
        self._era5_branch: Optional[RIBranchModel] = None
        self._imd_era5_branch: Optional[RIBranchModel] = None
        self._satellite_branch: Optional[RISatelliteBranch] = None
        self._is_loaded = False
        self._mode = "IMD_ONLY"

    def load(self, checkpoint_path: str, **kwargs) -> None:
        """Load all RI branch models and fusion meta-model.

        Args:
            checkpoint_path: Base directory containing model artifacts.
        """
        base_path = Path(checkpoint_path)

        # Load IMD branch
        imd_path = base_path / "imd_final_xgboost.json"
        if imd_path.exists():
            # Feature names from the trained model
            self._imd_features = [
                'latitude', 'longitude', 'max_wind_kt', 'central_pressure_hpa',
                'pressure_drop_hpa', 'wind_6h_change', 'wind_minus_6h_kt',
                'delta_v_minus_6h_kt', 'wind_minus_12h_kt', 'delta_v_minus_12h_kt',
                'wind_minus_24h_kt', 'delta_v_minus_24h_kt',
            ]
            self._imd_branch = RIBranchModel(str(imd_path), self._imd_features)
        else:
            warnings.warn(f"IMD branch not found at {imd_path}")

        # Load ERA5 branch
        era5_path = base_path / "era5_final_xgboost.json"
        if era5_path.exists():
            # ERA5 features are ~50 derived features
            # We'll load them from the model's feature names
            self._era5_branch = RIBranchModel(str(era5_path), [])
        else:
            warnings.warn(f"ERA5 branch not found at {era5_path}")

        # Load IMD+ERA5 combined branch
        imd_era5_path = base_path / "imd_era5_final_xgboost.json"
        if imd_era5_path.exists():
            self._imd_era5_branch = RIBranchModel(str(imd_era5_path), [])
        else:
            warnings.warn(f"IMD+ERA5 branch not found at {imd_era5_path}")

        self._is_loaded = True

    def validate_input(self, input_data: CycloneState) -> bool:
        """Validate that input is a CycloneState with required fields."""
        if not isinstance(input_data, CycloneState):
            return False

        # At minimum need IMD features
        required = ["latitude", "longitude", "max_wind_kt", "central_pressure_hpa"]
        for field in required:
            if getattr(input_data, field) is None:
                warnings.warn(f"Missing required field for RI: {field}")
                return False

        return True

    def _build_imd_features(self, cyclone_state: CycloneState) -> np.ndarray:
        """Build IMD feature vector from CycloneState."""
        imd_dict = cyclone_state.get_imd_features_dict()
        # Map CycloneState fields to model feature names
        features = {}
        features['latitude'] = imd_dict.get('latitude', 0.0)
        features['longitude'] = imd_dict.get('longitude', 0.0)
        features['max_wind_kt'] = imd_dict.get('max_wind_kt', 0.0)
        features['central_pressure_hpa'] = imd_dict.get('central_pressure_hpa', 1000.0)
        features['pressure_drop_hpa'] = imd_dict.get('pressure_drop_hpa', 0.0)
        # wind_6h_change = -(pressure_change_6h) or wind_change_6h
        features['wind_6h_change'] = cyclone_state.wind_change_6h or 0.0
        features['wind_minus_6h_kt'] = imd_dict.get('wind_minus_6h_kt', 0.0)
        features['delta_v_minus_6h_kt'] = imd_dict.get('delta_v_minus_6h_kt', 0.0)
        features['wind_minus_12h_kt'] = imd_dict.get('wind_minus_12h_kt', 0.0)
        features['delta_v_minus_12h_kt'] = imd_dict.get('delta_v_minus_12h_kt', 0.0)
        features['wind_minus_24h_kt'] = imd_dict.get('wind_minus_24h_kt', 0.0)
        features['delta_v_minus_24h_kt'] = imd_dict.get('delta_v_minus_24h_kt', 0.0)

        feature_array = np.array([[features[f] for f in self._imd_features]], dtype=np.float32)
        return feature_array

    def _determine_mode(self, cyclone_state: CycloneState) -> str:
        """Report the mode that is actually executable at runtime.

        Only the IMD branch runs. The ERA5/combined/satellite branches and the
        fusion meta-model are not runtime-callable (feature builders and the
        fusion artifact do not exist, see module docstring), so the mode is
        ``IMD_ONLY`` whenever the IMD branch is loaded, else ``UNAVAILABLE``.
        """
        if self._imd_branch is not None:
            return "IMD_ONLY"
        return "UNAVAILABLE"

    def predict(self, cyclone_state: CycloneState) -> RIPrediction:
        """Predict RI probability from the IMD branch.

        The ERA5 and satellite branch artifacts exist but their feature
        builders and the fusion meta-model do not (see module docstring), so
        their probabilities are returned as ``None`` rather than fabricated.

        Args:
            cyclone_state: Current cyclone state with IMD features.

        Returns:
            RIPrediction with IMD probability; no ERA5/satellite/fusion fields.
        """
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        if not self.validate_input(cyclone_state):
            raise ValueError("Invalid input for RI prediction")

        # Determine available mode
        mode = self._determine_mode(cyclone_state)
        self._mode = mode

        if mode == "UNAVAILABLE":
            return RIPrediction(
                probability_24h=0.0,
                risk_level=RiskLevel.NONE,
                confidence=0.0,
                model_version=self.model_info.version,
                timestamp=datetime.utcnow(),
                status="UNAVAILABLE",
                explanation="No RI branches available (missing model artifacts or input data)"
            )

        # IMD branch (the only branch this adapter can honestly invoke)
        imd_prob = None
        if self._imd_branch:
            X_imd = self._build_imd_features(cyclone_state)
            imd_prob = float(self._imd_branch.predict_proba(X_imd)[0])

        final_prob = imd_prob if imd_prob is not None else 0.0

        # Risk level
        risk_level = self._prob_to_risk_level(final_prob)

        # Confidence: based on the IMD branch alone (no other branch runs)
        confidence = 0.55 if imd_prob is not None else 0.0

        # Explanation
        explanation = self._generate_explanation(imd_prob)

        return RIPrediction(
            probability_24h=final_prob,
            risk_level=risk_level,
            imd_probability=imd_prob,
            era5_probability=None,
            satellite_probability=None,
            fusion_probability=None,
            calibrated_probability=imd_prob,
            confidence=confidence,
            model_version=self.model_info.version,
            timestamp=datetime.utcnow(),
            explanation=explanation,
        )

    def _prob_to_risk_level(self, prob: float) -> RiskLevel:
        if prob < 0.1:
            return RiskLevel.NONE
        elif prob < 0.3:
            return RiskLevel.LOW
        elif prob < 0.5:
            return RiskLevel.MODERATE
        elif prob < 0.75:
            return RiskLevel.HIGH
        else:
            return RiskLevel.EXTREME

    def _generate_explanation(self, imd_p: float) -> str:
        parts = [f"Mode: {self._mode}"]
        if imd_p is not None:
            parts.append(f"IMD: {imd_p:.2f}")
        parts.append("ERA5 UNUSED: runtime cannot reconstruct its 89 features and it showed no proven additive skill (dPR-AUC -0.25 vs IMD)")
        parts.append("Satellite UNUSED: requires Colab CNN artifacts + fold scaler; no proven skill (N=9)")
        parts.append("Fusion UNUSED: no trained fusion meta-model artifact exists")
        return "; ".join(parts)

    def predict_with_uncertainty(self, cyclone_state: CycloneState) -> tuple[RIPrediction, dict]:
        """Predict with uncertainty estimates."""
        prediction = self.predict(cyclone_state)

        uncertainty = {
            "aleatoric": None,  # Would need calibration curves
            "epistemic": None,  # Would need ensemble
            "branch_agreement": None,
            "mode": self._mode,
        }

        return prediction, uncertainty

    def explain(self, input_data: CycloneState, prediction: RIPrediction) -> dict:
        """Generate explanation for RI prediction."""
        return {
            "method": "imd_branch_probability",
            "model_type": "XGBoost (IMD branch)",
            "mode": self._mode,
            "branch_predictions": {
                "imd": prediction.imd_probability,
                "era5": None,
                "satellite": None,
                "fusion": None,
            },
            "note": "Only the IMD branch runs; ERA5/satellite/fusion are unavailable at runtime (see _generate_explanation).",
        }


def create_ri_adapter(
    checkpoint_path: str = "cyclone_backup/models",
    model_version: str = "v1"
) -> RIModelAdapter:
    """Factory function to create and load an RI adapter.

    Args:
        checkpoint_path: Path to the directory containing RI model artifacts.
        model_version: Version string for the model.

    Returns:
        Loaded RIModelAdapter instance.
    """
    model_info = ModelInfo(
        name="ri_multimodal",
        version=model_version,
        model_type="ri",
        loaded_at=datetime.utcnow(),
        framework="xgboost+pytorch",
    )

    adapter = RIModelAdapter(model_info)
    adapter.load(checkpoint_path)
    return adapter


class ModelAdapter(RIModelAdapter):
    """Alias for orchestrator compatibility."""
    pass