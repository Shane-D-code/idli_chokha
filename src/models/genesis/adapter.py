"""Genesis Model Adapter - LightGBM / XGBoost / RandomForest.

Integrates the three approved trained Genesis artifacts into the TOOFAN
pipeline:

    PRIMARY / PRODUCTION:
        LightGBM

    SOFT-VOTING ENSEMBLE (UNCALIBRATED):
        LightGBM  = 0.40
        XGBoost   = 0.35
        RandomForest = 0.25
    (No calibration artifact exists; the ensemble is a weighted average of raw
    class-1 probabilities and is NOT claimed to be calibrated.)

Strict model restriction: ONLY LightGBM, XGBoost, RandomForest participate.
CatBoost, ExtraTrees, GradientBoosting, HistGradientBoosting, and any other
model are explicitly rejected. No retraining or weight modification occurs.

The artifacts are sklearn Pipeline objects that already embed their own
SimpleImputer preprocessing step. The adapter uses each pipeline directly
(no double-imputation, no double-transformation).

Scientific caveat: this is a PROTOTYPE model (300 samples / 191 storms /
2015-2024, with synthetic SST/SST-anomaly and TCHP/OHC700 noted in the source
report). Do not claim production validation without new evidence.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from src.core.schema import (
    CycloneState,
    GenesisPrediction,
    RiskLevel,
)
from src.models.base import (
    GenesisModel,
    ModelInfo,
    ModelMetadata,
)

logger = logging.getLogger(__name__)

# ============================================================================
# GENESIS MODEL CONFIGURATION
# ============================================================================

# Approved model set. Any attempt to load a model outside this set is refused.
APPROVED_MODEL_TYPES = {"lightgbm", "xgboost", "randomforest"}

# Artifacts used (documented optimized Genesis models)
ARTIFACTS = {
    "lightgbm": "genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib",
    "xgboost": "genisis models/tc_genesis_xgboost_300_OPTIMIZED.joblib",
    "randomforest": "genisis models/tc_genesis_randomforest_300_OPTIMIZED.joblib",
}

# Standalone imputer artifact (used only to verify feature schema / fallback path)
IMPUTER_ARTIFACT = "genisis models/tc_genesis_300_imputer.joblib"

# Default ensemble weights (soft voting on probabilities, NOT hard labels)
DEFAULT_ENSEMBLE_WEIGHTS = {
    "lightgbm": 0.40,
    "xgboost": 0.35,
    "randomforest": 0.25,
}

# Documented optimized genesis threshold (do not retrain/optimize at inference)
DEFAULT_GENESIS_THRESHOLD = 0.24

# Genesis target definitions
GENESIS_TARGET = "genesis_24h"
GENESIS_DATASET = "300 samples / 150 genesis / 150 non-genesis / 191 NIO storms / 2015-2024"
GENESIS_N_FEATURES = 34

# Framework labels for provenance
FRAMEWORKS = {
    "lightgbm": "LightGBM",
    "xgboost": "XGBoost",
    "randomforest": "RandomForest",
}

# Feature schema (exact feature names expected by the trained models)
GENESIS_FEATURES = [
    "tchp_kj_cm2_x", "ohc700_kj_cm2_x",
    "u850", "v850", "r850", "t850", "w850", "q850", "z850",
    "u700", "v700", "r700", "t700", "w700", "q700", "z700",
    "u500", "v500", "r500", "t500", "w500", "q500", "z500",
    "u200", "v200", "r200", "t200", "w200", "q200", "z200",
    "sst", "sst_anomaly",
    "tchp_kj_cm2_y", "ohc700_kj_cm2_y",
]


# ============================================================================
# PROVENANCE / HASHING HELPERS
# ============================================================================

def _sha256_file(path: str | Path) -> str:
    """Compute SHA-256 of an artifact file."""
    path = Path(path)
    if not path.exists():
        return ""
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _repair_legacy_imputer(pipeline) -> bool:
    """Repair sklearn SimpleImputer serialization from 1.6.x -> 1.9.x.

    The Genesis artifacts were fitted with scikit-learn 1.6.1. When unpickled
    under 1.9.x, the SimpleImputer lacks the private ``_fill_dtype`` attribute
    introduced by 1.7, causing transform() to fail with AttributeError.

    This only sets the missing dtype attribute using the already-persisted
    ``_fit_dtype`` (no model weights or statistics are modified), repairing a
    serialization compatibility issue so the trained artifact can be reused.

    Returns True if a repair was applied, False otherwise.
    """
    imputer = getattr(pipeline, "named_steps", {}).get("imputer")
    if imputer is None:
        return False
    if hasattr(imputer, "_fit_dtype") and not hasattr(imputer, "_fill_dtype"):
        imputer._fill_dtype = imputer._fit_dtype
        return True
    return False


def _extract_pipeline_info(pipeline, model_type: str) -> dict:
    """Extract model metadata from a loaded pipeline for provenance."""
    info = {
        "framework": FRAMEWORKS.get(model_type, model_type),
        "model_type": model_type,
        "n_features": getattr(pipeline, "n_features_in_", None),
    }
    model_step = getattr(pipeline, "named_steps", {}).get("model")
    if model_step is not None:
        info["estimator"] = type(model_step).__name__
        if hasattr(model_step, "classes_"):
            info["classes"] = model_step.classes_.tolist()
        if hasattr(model_step, "n_estimators"):
            info["n_estimators"] = model_step.n_estimators
        if hasattr(model_step, "get_params"):
            info["params"] = {
                k: str(v) for k, v in model_step.get_params().items()
                if k in ("learning_rate", "max_depth", "n_estimators",
                         "num_leaves", "objective", "random_state")
            }
    feature_names = getattr(pipeline, "feature_names_in_", None)
    if feature_names is not None:
        info["feature_names"] = list(feature_names)
    else:
        info["feature_names"] = GENESIS_FEATURES
    return info


def _build_provenance(model_type: str, artifact_path: str) -> dict:
    """Build full provenance record for a model."""
    path = Path(artifact_path)
    return {
        "model": model_type,
        "model_name": f"genesis_{model_type}",
        "artifact_filename": path.name,
        "artifact_path": str(path),
        "artifact_hash_sha256": _sha256_file(path),
        "framework": FRAMEWORKS.get(model_type, model_type),
        "target": GENESIS_TARGET,
        "n_features": GENESIS_N_FEATURES,
        "dataset": GENESIS_DATASET,
        "load_time_utc": datetime.utcnow().isoformat(),
        "scientific_status": "prototype",
    }


# ============================================================================
# COMPONENT WRAPPER
# ============================================================================

class _GenesisComponent:
    """A single approved genesis model (LightGBM / XGBoost / RandomForest)."""

    def __init__(self, model_type: str, artifact_path: str, threshold: float):
        if model_type not in APPROVED_MODEL_TYPES:
            raise ValueError(
                f"Model type '{model_type}' is not in the approved Genesis set "
                f"{sorted(APPROVED_MODEL_TYPES)}. "
                "CatBoost / ExtraTrees / other models are NOT permitted."
            )
        self.model_type = model_type
        self.artifact_path = str(artifact_path)
        self.threshold = threshold
        self.pipeline = None
        self.provenance = _build_provenance(model_type, self.artifact_path)
        self.available = False
        self.feature_names = GENESIS_FEATURES

    @property
    def artifact_hash(self) -> str:
        return self.provenance.get("artifact_hash_sha256", "")

    @property
    def framework(self) -> str:
        return self.provenance.get("framework", self.model_type)

    def load(self) -> bool:
        """Load the artifact into a pipeline.

        Returns True on success, False if the artifact is missing.
        """
        path = Path(self.artifact_path)
        if not path.exists():
            logger.warning(
                "Genesis %s artifact not found at %s (model AVAILABLE=False)",
                self.model_type, self.artifact_path,
            )
            self.pipeline = None
            self.available = False
            return False

        try:
            obj = joblib.load(path)
        except Exception as e:  # noqa: BLE001
            logger.warning("Genesis %s artifact failed to load: %s", self.model_type, e)
            self.pipeline = None
            self.available = False
            return False

        # Guard: the loaded artifact must be a Pipeline wrapping an approved estimator
        if not isinstance(obj, dict) and hasattr(obj, "named_steps"):
            self.pipeline = obj
        else:
            logger.warning(
                "Genesis %s artifact is not a pipeline wrapper (type=%s); refused.",
                self.model_type, type(obj).__name__,
            )
            self.pipeline = None
            self.available = False
            return False

        # Guard: embedded estimator must be the approved class
        est = self.pipeline.named_steps.get("model")
        if est is None:
            logger.warning("Genesis %s pipeline has no 'model' step; refused.", self.model_type)
            self.available = False
            return False
        est_name = type(est).__name__.lower()
        allowed = {
            "lightgbm": ("lgbmclassifier",),
            "xgboost": ("xgboostclassifier", "xgbclassifier"),
            "randomforest": ("randomforestclassifier",),
        }
        if not any(a in est_name for a in allowed.get(self.model_type, ())):
            logger.warning(
                "Genesis %s pipeline wraps an unexpected estimator '%s'; refused.",
                self.model_type, type(est).__name__,
            )
            self.pipeline = None
            self.available = False
            return False

        _repair_legacy_imputer(self.pipeline)

        # Native-runtime compatibility: constrain embedded estimators to a
        # single thread so LightGBM/XGBoost do not spawn their own OpenMP
        # thread pools that conflict with PyTorch (and each other) when
        # OMP_NUM_THREADS=1 is in effect. This is a RUNTIME setting only - it
        # never changes model weights, learned parameters, or predictions
        # (single-threaded prediction is bit-identical to multi-threaded).
        est = self.pipeline.named_steps.get("model")
        if est is not None and hasattr(est, "n_jobs"):
            try:
                if est.n_jobs != 1:
                    est.n_jobs = 1
            except Exception:  # noqa: BLE001
                pass
        if est is not None and hasattr(est, "nthread"):
            try:
                est.nthread = 1
            except Exception:  # noqa: BLE001
                pass

        try:
            n_feat = getattr(self.pipeline, "n_features_in_", None)
            if n_feat is not None and n_feat != GENESIS_N_FEATURES:
                logger.warning(
                    "Genesis %s has %s features (expected %s); refused.",
                    self.model_type, n_feat, GENESIS_N_FEATURES,
                )
                self.available = False
                return False
        except AttributeError:
            pass

        self.feature_names = GENESIS_FEATURES
        self.provenance.update(_extract_pipeline_info(self.pipeline, self.model_type))
        self.provenance["artifact_hash_sha256"] = self.artifact_hash
        self.available = True
        logger.info(
            "Genesis %s loaded (framework=%s, n_features=%s, sha256=%s...)",
            self.model_type, self.framework, GENESIS_N_FEATURES, self.artifact_hash[:12],
        )
        return True

    def predict_proba(self, X: pd.DataFrame) -> float | None:
        """Return probability of genesis (class 1) for a single sample.

        Returns None if the component is unavailable or the prediction fails.
        """
        if not self.available or self.pipeline is None:
            return None
        try:
            proba = self.pipeline.predict_proba(X)[0]
            # Ensure we return the probability of class 1 regardless of ordering
            classes = getattr(self.pipeline.named_steps.get("model"), "classes_", [0, 1])
            if len(classes) == 2 and int(classes[-1]) == 1:
                return float(proba[-1])
            return float(proba[1])
        except Exception as e:  # noqa: BLE001
            logger.warning("Genesis %s prediction failed: %s", self.model_type, e)
            return None

    def predictions_equal(self, X: pd.DataFrame, ref_proba: float, tol: float = 1e-9) -> bool:
        """Compare adapter prediction against a reference probability."""
        if not self.available:
            return False
        proba = self.predict_proba(X)
        if proba is None:
            return False
        return abs(proba - ref_proba) <= tol


# ============================================================================
# ADAPTER
# ============================================================================

class GenesisModelAdapter(GenesisModel):
    """Adapter for the three approved Genesis models.

    MODE A (production): LightGBM only.
    MODE B (ensemble): 0.40*LightGBM + 0.35*XGBoost + 0.25*RandomForest
    (soft voting on probabilities; no hard-label averaging).
    """

    def __init__(self, model_info: ModelInfo | None = None,
                 raw_model: Any = None,
                 metadata: ModelMetadata | None = None,
                 artifacts: dict | None = None,
                 threshold: float = DEFAULT_GENESIS_THRESHOLD,
                 ensemble_weights: dict | None = None,
                 mode: str = "production"):
        if model_info is None:
            model_info = ModelInfo(
                name="genesis",
                version="1.0.0",
                model_type="genesis",
                loaded_at=datetime.utcnow(),
                framework="lightgbm",
            )
        super().__init__(model_info)
        self._is_loaded = False
        self.threshold = float(threshold)
        self.ensemble_weights = dict(ensemble_weights or DEFAULT_ENSEMBLE_WEIGHTS)
        self.mode = mode if mode in ("production", "ensemble") else "production"

        self._artifacts = dict(artifacts) if artifacts else dict(ARTIFACTS)
        self.components: dict[str, _GenesisComponent] = {
            mt: _GenesisComponent(mt, self._artifacts[mt], self.threshold)
            for mt in ("lightgbm", "xgboost", "randomforest")
        }
        self._raw_model = raw_model

    # -- availability --------------------------------------------------------

    @property
    def production_model_is(self) -> str:
        """The production Genesis model is always LightGBM."""
        return "lightgbm"

    @property
    def production_available(self) -> bool:
        return self.components["lightgbm"].available

    @property
    def ensemble_available(self) -> bool:
        return all(c.available for c in self.components.values())

    def availability_report(self) -> dict:
        """Report availability of each component and combined modes."""
        comp = {
            mt: ("AVAILABLE" if c.available else "MISSING")
            for mt, c in self.components.items()
        }
        return {
            "lightgbm": comp["lightgbm"],
            "xgboost": comp["xgboost"],
            "randomforest": comp["randomforest"],
            "production": "AVAILABLE" if self.production_available else "UNAVAILABLE",
            "ensemble": "AVAILABLE" if self.ensemble_available else "UNAVAILABLE",
        }

    # -- lifecycle -----------------------------------------------------------

    def load(self, checkpoint_path: str = None, **kwargs) -> None:
        """Load all three approved Genesis artifacts.

        Missing artifacts do not raise; the component is marked unavailable
        and mode-level availability is derived from loaded components.
        """
        for mt, comp in self.components.items():
            comp.load()
        self._is_loaded = True
        status = self.availability_report()
        logger.info("Genesis adapter loaded. Availability: %s", status)
        if not self.production_available:
            logger.warning("Genesis PRODUCTION model (LightGBM) is UNAVAILABLE.")
        if not self.ensemble_available:
            logger.warning(
                "Genesis ENSEMBLE is UNAVAILABLE (all of LightGBM/XGBoost/"
                "RandomForest must be present). Individual availability: %s",
                {k: v for k, v in status.items() if k in ("lightgbm", "xgboost", "randomforest")},
            )

    def unload(self) -> None:
        for comp in self.components.values():
            comp.pipeline = None
            comp.available = False
        self._is_loaded = False

    # -- input ---------------------------------------------------------------

    def validate_input(self, input_data: Any) -> bool:
        return isinstance(input_data, CycloneState)

    def _build_feature_frame(self, cyclone_state: CycloneState) -> pd.DataFrame:
        """Extract the 34 genesis features from a CycloneState.

        The genesis models are environmental/oceanic reanalysis models. The
        required features are retrieved from the cyclone state's environmental
        and ocean feature groups. Missing values are left as NaN so that the
        embedded (trained) SimpleImputer performs median imputation identically
        to training. We never fabricate values for absent inputs.
        """
        env = cyclone_state.environmental_features
        ocean = cyclone_state.ocean_features

        # Provide a default zero dictionary so absent fields -> NaN (imputed)
        def g(obj, name):
            return getattr(obj, name, None)

        raw = {
            "tchp_kj_cm2_x": g(ocean, "tchp") if ocean else None,
            "ohc700_kj_cm2_x": g(ocean, "ocean_heat_content") if ocean else None,
            "u850": g(env, "u_850"),
            "v850": g(env, "v_850"),
            "r850": g(env, "r_850"),
            "t850": g(env, "t_850"),
            "w850": None,  # vertical velocity not in schema
            "q850": None,  # specific humidity not in schema
            "z850": None,  # geopotential not in schema
            "u700": g(env, "u_700"),
            "v700": g(env, "v_700"),
            "r700": g(env, "r_700"),
            "t700": g(env, "t_700"),
            "w700": None,
            "q700": None,
            "z700": None,
            "u500": g(env, "u_500"),
            "v500": g(env, "v_500"),
            "r500": g(env, "r_500"),
            "t500": g(env, "t_500"),
            "w500": None,
            "q500": None,
            "z500": None,
            "u200": g(env, "u_200"),
            "v200": g(env, "v_200"),
            "r200": g(env, "r_200"),
            "t200": g(env, "t_200"),
            "w200": None,
            "q200": None,
            "z200": None,
            "sst": g(env, "sst") if env.sst is not None else (g(ocean, "sst") if ocean else None),
            "sst_anomaly": g(env, "sst_anomaly") if env.sst_anomaly is not None else (g(ocean, "sst_anomaly") if ocean else None),
            # The "_y" TCHP/OHC700 columns were a second (distinct) value during
            # training (from a pandas merge that suffixed duplicated columns).
            # That second value cannot be reconstructed from CycloneState, so it
            # is left NaN -> median-imputed. We must NOT feed the "_x" value into
            # the "_y" slot: that fabricates an equality the model never saw and
            # measurably warps XGBoost/RandomForest probabilities.
            "tchp_kj_cm2_y": None,
            "ohc700_kj_cm2_y": None,
        }

        df = pd.DataFrame([raw], columns=GENESIS_FEATURES)
        return df

    # -- prediction ----------------------------------------------------------

    def _component_probs(self, X: pd.DataFrame) -> dict[str, float | None]:
        """Compute per-component genesis probabilities (class 1)."""
        return {
            mt: comp.predict_proba(X)
            for mt, comp in self.components.items()
        }

    def _ensemble_proba(self, probs: dict[str, float | None]) -> float | None:
        """Weighted soft-voting ensemble probability.

        ensemble = 0.40*lgbm + 0.35*xgb + 0.25*rf
        Requires ALL three components present; otherwise returns None.
        """
        if any(probs.get(mt) is None for mt in self.components):
            return None
        return float(
            self.ensemble_weights["lightgbm"] * probs["lightgbm"]
            + self.ensemble_weights["xgboost"] * probs["xgboost"]
            + self.ensemble_weights["randomforest"] * probs["randomforest"]
        )

    def _risk_level(self, prob: float) -> RiskLevel:
        """Map probability to a canonical risk level (binary gateway logic).

        Per the documented semantics, genesis is binary:
            probability >= threshold -> genesis (HIGH)
            probability <  threshold -> non-genesis (LOW)
        We don't claim a probability itself means a finer "risk" unless a
        documented mapping exists; downstream modules consume the binary class.
        """
        if prob >= self.threshold:
            return RiskLevel.HIGH
        return RiskLevel.LOW

    def predict(self, cyclone_state: CycloneState,
                mode: str | None = None) -> GenesisPrediction:
        """Generate a GenesisPrediction.

        Args:
            cyclone_state: Canonical cyclone state (candidate disturbance).
            mode: 'production' (LightGBM) or 'ensemble'. If None, uses the
                  adapter's configured mode.

        Raises:
            RuntimeError: If the requested inference mode is unavailable
                          (honest failure, no silent substitution).
        """
        if not self._is_loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        use_mode = mode or self.mode
        if use_mode not in ("production", "ensemble"):
            raise ValueError(f"Unknown genesis_mode: {use_mode}")

        if not isinstance(cyclone_state, CycloneState):
            raise ValueError("Genesis requires a CycloneState input.")

        X = self._build_feature_frame(cyclone_state)
        probs = self._component_probs(X)

        if use_mode == "production":
            if not self.production_available:
                raise RuntimeError(
                    "Genesis PRODUCTION model (LightGBM) is UNAVAILABLE. "
                    "Requested mode='production' cannot be satisfied; no "
                    "substitution was made."
                )
            prob = probs["lightgbm"]
            model_name = "genesis_lightgbm"
        else:  # ensemble
            if not self.ensemble_available:
                report = self.availability_report()
                raise RuntimeError(
                    "Genesis ENSEMBLE is UNAVAILABLE - all of LightGBM, "
                    "XGBoost and RandomForest must be present. Individual "
                    f"status: {report}. No partial (two-model) ensemble was built."
                )
            prob = self._ensemble_proba(probs)
            model_name = "genesis_soft_voting_ensemble"

        if prob is None:
            raise RuntimeError(f"Genesis {use_mode} inference returned no probability.")

        prob = float(prob)
        predicted_class = 1 if prob >= self.threshold else 0
        risk_level = self._risk_level(prob)

        # Confidence: high when deciding near a clearly meaningful margin;
        # lower near threshold. This is a simple heuristic (not a calibration).
        margin = abs(prob - self.threshold)
        confidence = float(np.clip(0.5 + margin, 0.5, 0.95))

        # Assemble provenance for the active model(s)
        if use_mode == "production":
            provenance = self.components["lightgbm"].provenance
            artifact_hash = self.components["lightgbm"].artifact_hash
            artifact_path = self.components["lightgbm"].artifact_path
        else:
            provenance = {
                "ensemble": "soft-voting ensemble (uncalibrated)",
                "weights": self.ensemble_weights,
                "members": {
                    mt: {
                        "artifact": c.artifact_path,
                        "hash_sha256": c.artifact_hash,
                        "framework": c.framework,
                    }
                    for mt, c in self.components.items()
                },
            }
            artifact_hash = ""
            artifact_path = ", ".join(c.artifact_path for c in self.components.values())

        feature_schema = {
            "n_features": GENESIS_N_FEATURES,
            "feature_names": GENESIS_FEATURES,
            "order": "exact model order",
            "imputation": "embedded pipeline SimpleImputer (median)",
        }

        # Logging for auditability
        if use_mode == "production":
            logger.info(
                "Genesis[%s] model=%s probability=%.4f threshold=%.2f "
                "prediction=%s model_version=%s artifact_hash=%s",
                use_mode, model_name, prob, self.threshold, predicted_class,
                self.model_info.version, artifact_hash[:16],
            )
        else:
            logger.info(
                "Genesis[%s] model=%s ensemble_probability=%.4f "
                "lightgbm=%.4f xgboost=%.4f randomforest=%.4f "
                "weights=%s threshold=%.2f prediction=%s model_version=%s",
                use_mode, model_name, prob,
                probs["lightgbm"], probs["xgboost"], probs["randomforest"],
                self.ensemble_weights, self.threshold, predicted_class,
                self.model_info.version,
            )

        return GenesisPrediction(
            probability_24h=prob,
            probability_48h=prob,
            probability_72h=prob,
            threshold=self.threshold,
            predicted_class=predicted_class,
            model_name=model_name,
            model_version=self.model_info.version,
            mode=use_mode,
            artifact_hash=artifact_hash,
            artifact_path=artifact_path,
            feature_schema=feature_schema,
            provenance=provenance,
            calibrated=False,
            raw_probability=prob,
            calibrated_probability=None,
            # Ensemble components
            lightgbm_probability=probs.get("lightgbm"),
            xgboost_probability=probs.get("xgboost"),
            randomforest_probability=probs.get("randomforest"),
            ensemble_probability=(self._ensemble_proba(probs)
                                  if use_mode == "ensemble" else None),
            ensemble_weights=(self.ensemble_weights
                              if use_mode == "ensemble" else {}),
            # Candidate location
            candidate_latitude=cyclone_state.latitude,
            candidate_longitude=cyclone_state.longitude,
            risk_level=risk_level,
            confidence=confidence,
            timestamp=datetime.utcnow(),
            explanation=(
                "PROTOTYPE Genesis model. Dataset: 300 samples / 191 NIO "
                "storms / 2015-2024 per the external source report; the "
                "training data, script, and CV/test metrics are NOT in this "
                "repository (HISTORICAL CLAIM - not reproducible from current "
                "repo). Report notes synthetic SST/SST-anomaly and TCHP/OHC700 "
                "features; storm-aware CV was lower than held-out test "
                "performance. Ensemble is uncalibrated. Not operationally "
                "validated."
            ),
        )

    def predict_production(self, cyclone_state: CycloneState) -> GenesisPrediction:
        """Production inference: LightGBM only."""
        return self.predict(cyclone_state, mode="production")

    def predict_ensemble(self, cyclone_state: CycloneState) -> GenesisPrediction:
        """Ensemble inference: soft-voting of the three approved models."""
        return self.predict(cyclone_state, mode="ensemble")

    # -- explainability ------------------------------------------------------

    def explain(self, input_data: CycloneState,
                prediction: GenesisPrediction) -> dict:
        """Generate an explanation for the prediction."""
        feats = {}
        if prediction.provenance:
            fn = prediction.provenance.get("feature_names")
            if fn:
                feats = {"n_features": len(fn), "feature_names": fn}
        return {
            "method": "feature_importance (model-native)",
            "model_type": prediction.model_name,
            "mode": prediction.mode,
            "feature_schema": feats,
            "note": "SHAP values can be computed against the loaded pipelines for detailed attribution.",
        }


# ============================================================================
# FACTORY
# ============================================================================

class ModelAdapter(GenesisModelAdapter):
    """Orchestrator-compatible wrapper, constructed as ``(raw_model, metadata)``.

    The pipeline orchestrator constructs every module adapter as
    ``adapters.ModelAdapter(raw_model, metadata)`` and never calls ``.load()``
    afterwards. The genesis artifacts are self-loading
    (LightGBM + XGBoost + RandomForest pipelines under ``genisis models/``),
    so the registry ``raw_model`` (the LightGBM pipeline) is ignored and the
    three approved artifacts are loaded here, mirroring the trajectory and RI
    orchestrator wrappers.
    """

    def __init__(self, raw_model: Any = None,
                 metadata: ModelMetadata | None = None):
        version = metadata.version if metadata and metadata.version else "1.0.0"
        model_info = ModelInfo(
            name=metadata.name if metadata and metadata.name else "genesis",
            version=version,
            model_type="genesis",
            loaded_at=datetime.utcnow(),
            metadata=metadata,
            framework="lightgbm",
        )
        super().__init__(model_info=model_info, mode="production")
        self.load()


def create_genesis_adapter(
    checkpoint_path: str = "genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib",
    model_version: str = "1.0.0",
    mode: str = "production",
    threshold: float = DEFAULT_GENESIS_THRESHOLD,
    artifacts: dict | None = None,
    ensemble_weights: dict | None = None,
) -> GenesisModelAdapter:
    """Factory to create and load a Genesis adapter.

    Loads the three approved Genesis artifacts. Missing artifacts are captured
    in the adapter's availability report (honest, no silent substitution).

    Returns:
        Loaded GenesisModelAdapter.
    """
    model_info = ModelInfo(
        name="genesis",
        version=model_version,
        model_type="genesis",
        loaded_at=datetime.utcnow(),
        framework="lightgbm",
    )

    adapter = GenesisModelAdapter(
        model_info=model_info,
        artifacts=artifacts,
        threshold=threshold,
        ensemble_weights=ensemble_weights,
        mode=mode,
    )
    adapter.load(checkpoint_path)
    return adapter


# ============================================================================
# MODEL FACTORY REGISTRATION
# ============================================================================

def _register_in_factory():
    """Register Genesis model types in the TOOFAN ModelFactory.

    The factory must support 'genesis_lightgbm' (production) and
    'genesis_soft_voting_ensemble' (ensemble). Both map to the same adapter
    class; the caller selects the mode via ModelFactory.create(..., mode=...).
    """
    from src.models.base import ModelFactory  # noqa: F401

    ModelFactory.register("genesis", GenesisModelAdapter)
    ModelFactory.register("genesis_lightgbm", GenesisModelAdapter)
    ModelFactory.register("genesis_soft_voting_ensemble", GenesisModelAdapter)


_register_in_factory()
