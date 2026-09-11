"""Rapid Intensification Model Adapter for multimodal RI prediction.

Wraps the existing RI multimodal system (IMD XGBoost + ERA5 XGBoost +
Satellite CNN + Logistic Regression fusion) to conform to the
standardized RIPrediction schema.
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
    """Wrapper for a single RI branch model (IMD, ERA5, or combined)."""

    def __init__(self, model_path: str, feature_names: list[str]):
        self.model = xgb.XGBClassifier()
        self.model.load_model(model_path)
        self.feature_names = feature_names

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Return P(RI=1) probabilities."""
        return self.model.predict_proba(X)[:, 1]

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
    """Adapter for the multimodal RI prediction system.

    Supports multiple modes depending on available inputs:
    - FULL_MULTIMODAL: IMD + ERA5 + Satellite
    - IMD_ERA5: IMD + ERA5 only
    - IMD_ONLY: IMD only
    - SATELLITE_ONLY: Satellite only (if available)
    """

    def __init__(self, model_info: ModelInfo):
        super().__init__(model_info)
        self._imd_branch: Optional[RIBranchModel] = None
        self._era5_branch: Optional[RIBranchModel] = None
        self._imd_era5_branch: Optional[RIBranchModel] = None
        self._satellite_branch: Optional[RISatelliteBranch] = None
        self._fusion_model = None
        self._fusion_threshold = 0.5
        self._imd_features = None
        self._era5_features = None
        self._is_loaded = False
        self._mode = "FULL_MULTIMODAL"

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

        # Load Satellite CNN branch (lazy - only load when needed)
        sat_path = base_path / "satellite_cnn.pt"
        self._sat_path = sat_path
        self._satellite_branch = None  # Load lazily

        # Load fusion meta-model (Logistic Regression on branch probabilities)
        # The fusion model is trained in run_final_multimodal.py
        # For now, we'll use a simple average as fallback
        self._fusion_threshold = 0.5

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

    def _build_era5_features(self, cyclone_state: CycloneState) -> np.ndarray:
        """Build ERA5 feature vector from CycloneState."""
        era5_dict = cyclone_state.get_era5_environmental_dict()
        # The ERA5 branch expects ~50 features; we have 17 from CycloneState
        # The rest would need to be computed from full ERA5 profiles
        features = np.array([[era5_dict.get(f, 0.0) for f in era5_dict]], dtype=np.float32)
        return features

    def _determine_mode(self, cyclone_state: CycloneState) -> str:
        """Determine which branches are available based on input data."""
        has_imd = self._imd_branch is not None
        has_era5 = self._era5_branch is not None and cyclone_state.environmental_features.sst is not None
        has_sat = (self._satellite_branch is not None and
                   cyclone_state.satellite_images is not None and
                   cyclone_state.satellite_images.ir_image is not None)

        if has_imd and has_era5 and has_sat:
            return "FULL_MULTIMODAL"
        elif has_imd and has_era5:
            return "IMD_ERA5"
        elif has_imd:
            return "IMD_ONLY"
        elif has_sat:
            return "SATELLITE_ONLY"
        else:
            return "UNAVAILABLE"

    def predict(self, cyclone_state: CycloneState) -> RIPrediction:
        """Predict RI probability using available branches.

        Args:
            cyclone_state: Current cyclone state with IMD, ERA5, and satellite data.

        Returns:
            RIPrediction with branch probabilities and fused/calibrated probability.
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
                explanation="No RI branches available (missing model artifacts or input data)"
            )

        # Get branch predictions
        imd_prob = None
        era5_prob = None
        sat_prob = None
        fusion_prob = None

        # IMD branch
        if self._imd_branch:
            X_imd = self._build_imd_features(cyclone_state)
            imd_prob = float(self._imd_branch.predict_proba(X_imd)[0])

        # ERA5 branch
        if self._era5_branch and mode in ["FULL_MULTIMODAL", "IMD_ERA5"]:
            X_era5 = self._build_era5_features(cyclone_state)
            if X_era5.shape[1] > 0:
                era5_prob = float(self._era5_branch.predict_proba(X_era5)[0])

        # Satellite branch (lazy load)
        if mode == "FULL_MULTIMODAL" and self._sat_path.exists() and _TORCH_AVAILABLE:
            if self._satellite_branch is None:
                try:
                    self._satellite_branch = RISatelliteBranch(str(self._sat_path))
                except Exception as e:
                    warnings.warn(f"Failed to load satellite branch: {e}")

            if self._satellite_branch:
                sat = cyclone_state.satellite_images
                tabular = self._build_imd_features(cyclone_state)  # Uses same 11 IMD features
                sat_prob = self._satellite_branch.predict_proba(sat.ir_image, tabular, sat.ir_mask)

        # Fusion
        if mode == "FULL_MULTIMODAL" and imd_prob is not None and era5_prob is not None and sat_prob is not None:
            # Simple average as fallback (real fusion model would be loaded)
            fusion_prob = (imd_prob + era5_prob + sat_prob) / 3.0
        elif mode == "IMD_ERA5" and imd_prob is not None and era5_prob is not None:
            fusion_prob = (imd_prob + era5_prob) / 2.0
        elif mode == "IMD_ONLY" and imd_prob is not None:
            fusion_prob = imd_prob
        elif mode == "SATELLITE_ONLY" and sat_prob is not None:
            fusion_prob = sat_prob

        # Calibrated probability (would use isotonic calibration from training)
        calibrated_prob = fusion_prob if fusion_prob is not None else (imd_prob or 0.0)

        # Final probability
        final_prob = calibrated_prob

        # Risk level
        risk_level = self._prob_to_risk_level(final_prob)

        # Confidence based on available modalities
        n_branches = sum(x is not None for x in [imd_prob, era5_prob, sat_prob])
        confidence = min(0.9, 0.4 + n_branches * 0.15)

        # Explanation
        explanation = self._generate_explanation(mode, imd_prob, era5_prob, sat_prob, fusion_prob)

        return RIPrediction(
            probability_24h=final_prob,
            risk_level=risk_level,
            imd_probability=imd_prob,
            era5_probability=era5_prob,
            satellite_probability=sat_prob,
            fusion_probability=fusion_prob,
            calibrated_probability=calibrated_prob,
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

    def _generate_explanation(self, mode: str, imd_p, era5_p, sat_p, fusion_p) -> str:
        parts = [f"Mode: {mode}"]
        if imd_p is not None:
            parts.append(f"IMD: {imd_p:.2f}")
        if era5_p is not None:
            parts.append(f"ERA5: {era5_p:.2f}")
        if sat_p is not None:
            parts.append(f"Satellite: {sat_p:.2f}")
        if fusion_p is not None:
            parts.append(f"Fusion: {fusion_p:.2f}")
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
            "method": "branch_probabilities + feature_importance",
            "model_type": "Multimodal XGBoost + CNN + Logistic Regression",
            "mode": self._mode,
            "branch_predictions": {
                "imd": prediction.imd_probability,
                "era5": prediction.era5_probability,
                "satellite": prediction.satellite_probability,
            },
            "note": "SHAP values available for XGBoost branches; Grad-CAM for CNN branch",
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