"""IMD + ERA5 Rapid Intensification (RI) fusion inference.

Production inference component for the fused 98-feature XGBoost RI model
(``imd_era5_fusion_xgboost_final.json``, 29 trees, random_state 42). The model
is a **locked scientific artifact** (see
``RI/era5_datasets/imd_era5_fusion_experiment/``) and is never retrained or
modified here.

Feature contract
----------------
The model consumes exactly 98 predictors in the booster's ``feature_names``
order:

* 89 ERA5 predictors: 38 static (20 raw t/r/u/v/d level fields, ``shear_850_200``
  and 17 derived) + 51 capped-lag temporal deltas (``delta_{6,12,24}h_*``).
* 9 IMD predictors appended last.

The 89-feature ERA5 contract is the validated
``RI/era5_ri_feature_spec_89.json``. The runtime ordering is validated against
``booster.feature_names`` on load and fails loudly on any mismatch.

Runtime input
-------------
The adapter accepts the same operational ``CycloneState`` used by TOOFAN:

* IMD predictors are derived from ``CycloneState`` intensity/trend fields.
* The 89 ERA5 predictors are built from ``CycloneState.environmental_features``
  (the 20 base level fields) plus an optional in-memory ``era5_history`` for
  the capped-lag temporal deltas.

ERA5 availability policy (honest, no fabrication)
--------------------------------------------------
* If the 20 base ERA5 level fields are absent, ERA5 is considered unavailable:
  the fusion model is NOT run and the caller documents an IMD-only fallback.
* If ERA5 base fields are present, the fusion model runs. Temporal delta
  features that cannot be computed (no prior in-storm ERA5 observation within
  the capped lag) are left as NaN and handled natively by XGBoost, matching the
  in-distribution missingness of the frozen training table. Missing values are
  never replaced with zeros or fabricated.

Future-leakage guards
---------------------
The runtime predictor vector contains only historical/current values. The three
guarded columns ``wind_24h_kt``, ``delta_v_24h_kt`` and ``RI_24h`` are never
constructed and the test suite asserts they are absent.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np
import xgboost as xgb

from src.core.schema import CycloneState, EnvironmentalFeatures

# ---------------------------------------------------------------------------
# Canonical model identity
# ---------------------------------------------------------------------------

MODEL_NAME = "imd_era5_fusion"
MODEL_VERSION = "seed42-final"
ERA5_FEATURE_COUNT = 89
IMD_FEATURE_COUNT = 9
FUSION_FEATURE_COUNT = 98
FUSION_TREE_COUNT = 29

DEFAULT_FUSION_CHECKPOINT = (
    "RI/era5_datasets/imd_era5_fusion_experiment/"
    "final_model_seed42/imd_era5_fusion_xgboost_final.json"
)

# ---------------------------------------------------------------------------
# 9 IMD predictors (exact trained-model order, final 9 positions)
# ---------------------------------------------------------------------------

IMD_FUSION_FEATURES: list[str] = [
    "max_wind_kt",
    "central_pressure_hpa",
    "pressure_drop_hpa",
    "wind_minus_6h_kt",
    "delta_v_minus_6h_kt",
    "wind_minus_12h_kt",
    "delta_v_minus_12h_kt",
    "wind_minus_24h_kt",
    "delta_v_minus_24h_kt",
]

# ---------------------------------------------------------------------------
# 89 ERA5 features (38 static + 51 capped-lag temporal deltas)
# ---------------------------------------------------------------------------

_LOW_LEVELS = [850, 700, 500, 200]
_RAW_LEVEL_PREFIXES = ["d", "r", "t", "u", "v"]

ERA5_RAW_LEVEL_FIELDS: list[str] = [
    f"{pref}_{level}"
    for pref in _RAW_LEVEL_PREFIXES
    for level in _LOW_LEVELS
]

# 17 derived base predictors in exact spec order (temporal delta subjects).
ERA5_DERIVED_FEATURES: list[str] = [
    "rh_mean_850_500",
    "wind_mag_850",
    "wind_mag_700",
    "wind_mag_500",
    "wind_mag_200",
    "divergence_contrast_200_850",
    "u_shear_850_200",
    "v_shear_850_200",
    "shear_direction_deg",
    "r_850_minus_500",
    "r_850_minus_700",
    "r_700_minus_500",
    "t_850_minus_500",
    "t_850_minus_700",
    "t_700_minus_500",
    "divergence_contrast_500_850",
    "divergence_contrast_200_500",
]

# shear_850_200 is a static (non-temporal) ERA5 predictor in the spec.
ERA5_STATIC_FEATURES: list[str] = (
    ERA5_RAW_LEVEL_FIELDS + ["shear_850_200"] + ERA5_DERIVED_FEATURES
)

_TEMPORAL_LAGS_H = [6, 12, 24]

ERA5_TEMPORAL_FEATURES: list[str] = [
    f"delta_{lag}h_{feat}"
    for lag in _TEMPORAL_LAGS_H
    for feat in ERA5_DERIVED_FEATURES
]

ERA5_FUSION_FEATURES: list[str] = ERA5_STATIC_FEATURES + ERA5_TEMPORAL_FEATURES

FUSION_FEATURES: list[str] = ERA5_FUSION_FEATURES + IMD_FUSION_FEATURES

# Columns that must never appear as runtime predictors (future leakage).
_LEAKAGE_COLUMNS = ["wind_24h_kt", "delta_v_24h_kt", "RI_24h"]


def _get(env: EnvironmentalFeatures, name: str) -> float:
    """Return a float value or NaN if the field is missing."""
    val = getattr(env, name, None)
    if val is None:
        return float("nan")
    try:
        out = float(val)
    except (TypeError, ValueError):
        return float("nan")
    return out


def build_era5_static_features(
    env: EnvironmentalFeatures,
) -> dict[str, float]:
    """Build the 38 static ERA5 predictors from ``EnvironmentalFeatures``.

    Raw level fields are copied through; the derived predictors reproduce the
    exact formulas of ``RI/src/features.py::add_era5_derived`` plus the spec's
    ``shear_850_200`` magnitude. Values are kept as NaN where a source field is
    absent (never zero-filled).
    """
    feat: dict[str, float] = {
        name: _get(env, name) for name in ERA5_RAW_LEVEL_FIELDS
    }

    r850, r700, r500 = feat["r_850"], feat["r_700"], feat["r_500"]
    feat["rh_mean_850_500"] = (r850 + r700 + r500) / 3.0

    for level in _LOW_LEVELS:
        u, v = feat[f"u_{level}"], feat[f"v_{level}"]
        feat[f"wind_mag_{level}"] = np.sqrt(u ** 2 + v ** 2)

    u_shear = feat["u_200"] - feat["u_850"]
    v_shear = feat["v_200"] - feat["v_850"]
    feat["u_shear_850_200"] = u_shear
    feat["v_shear_850_200"] = v_shear
    feat["shear_850_200"] = np.sqrt(u_shear ** 2 + v_shear ** 2)
    feat["shear_direction_deg"] = np.degrees(np.arctan2(v_shear, u_shear))

    feat["divergence_contrast_200_850"] = feat["d_200"] - feat["d_850"]
    feat["divergence_contrast_500_850"] = feat["d_500"] - feat["d_850"]
    feat["divergence_contrast_200_500"] = feat["d_200"] - feat["d_500"]

    feat["r_850_minus_500"] = feat["r_850"] - feat["r_500"]
    feat["r_850_minus_700"] = feat["r_850"] - feat["r_700"]
    feat["r_700_minus_500"] = feat["r_700"] - feat["r_500"]

    feat["t_850_minus_500"] = feat["t_850"] - feat["t_500"]
    feat["t_850_minus_700"] = feat["t_850"] - feat["t_700"]
    feat["t_700_minus_500"] = feat["t_700"] - feat["t_500"]

    return {name: feat[name] for name in ERA5_STATIC_FEATURES}


def build_era5_temporal_features(
    current: EnvironmentalFeatures,
    current_time: datetime,
    era5_history: Iterable[tuple[datetime, EnvironmentalFeatures]],
) -> dict[str, float]:
    """Build the 51 capped-lag temporal deltas from in-storm ERA5 history.

    Reproduces ``RI/src/features.py::add_temporal_features`` semantics exactly:
    each delta is the change of the derived predictor against the **immediately
    previous in-storm observation**, kept only when ``t - t_prev <= lag``.
    History entries must be (observation_time, EnvironmentalFeatures) tuples.

    When no prior observation satisfies the lag cap the delta is NaN (native
    XGBoost missing handling). Never uses future information.
    """
    current_static = build_era5_static_features(current)
    prev_values: dict[int, dict[str, float] | None] = {}
    for lag in _TEMPORAL_LAGS_H:
        prev_values[lag] = None

    ranked = sorted(
        ((ts, env) for ts, env in era5_history if ts < current_time),
        key=lambda kv: kv[0],
        reverse=True,
    )

    lag_table: dict[str, float] = {}
    for lag in _TEMPORAL_LAGS_H:
        prev = None
        if ranked:
            prev_ts, prev_env = ranked[0]
            if (current_time - prev_ts).total_seconds() / 3600.0 <= lag:
                prev = build_era5_static_features(prev_env)
        for name in ERA5_DERIVED_FEATURES:
            col = f"delta_{lag}h_{name}"
            if prev is None:
                lag_table[col] = float("nan")
            else:
                lag_table[col] = current_static[name] - prev[name]
    return lag_table


def build_imd_fusion_features(state: CycloneState) -> dict[str, float]:
    """Build the 9 IMD predictors with exact frozen semantics.

    Semantics (NOT interchangeable):

    * ``wind_minus_Lh_kt`` == wind at ``t - L`` == ``max_wind_kt - wind_change_Lh``
    * ``delta_v_minus_Lh_kt`` == ``wind(t) - wind(t-L)`` == ``wind_change_Lh``
    * ``pressure_drop_hpa`` == ``-pressure_change_6h`` (falling pressure > 0)

    Missing trend fields yield NaN (never zero), so XGBoost handles them.
    """
    def _nan_or(v, default=None):
        return float("nan") if v is None else float(v)

    max_wind = _nan_or(state.max_wind_kt)
    central_pressure = _nan_or(state.central_pressure_hpa)
    p6 = _nan_or(state.pressure_change_6h)

    imd = {name: float("nan") for name in IMD_FUSION_FEATURES}
    imd["max_wind_kt"] = max_wind
    imd["central_pressure_hpa"] = central_pressure

    if not np.isnan(max_wind) and not np.isnan(p6):
        imd["pressure_drop_hpa"] = -p6

    for lag, wchg_field in ((6, "wind_change_6h"), (12, "wind_change_12h"),
                            (24, "wind_change_24h")):
        wchg = getattr(state, wchg_field)
        if wchg is None or np.isnan(max_wind):
            continue
        wchg = float(wchg)
        imd[f"wind_minus_{lag}h_kt"] = max_wind - wchg
        imd[f"delta_v_minus_{lag}h_kt"] = wchg

    return imd


def has_era5_base_fields(state: CycloneState) -> bool:
    """True when the 20 base ERA5 level fields are all present.

    This is the documented gate for fusion availability: when the base fields
    are absent the ERA5 modality is unavailable and the fusion model must not
    be presented as having run.
    """
    env = state.environmental_features
    for name in ERA5_RAW_LEVEL_FIELDS:
        val = getattr(env, name, None)
        if val is None:
            return False
    return True


@dataclass
class FusionBuildResult:
    """Validated 98-feature vector plus provenance metadata."""

    vector: np.ndarray
    feature_names: list[str]
    era5_available: bool
    n_missing: int
    n_era5_available: int
    n_temporal_missing: int
    sources: list[str] = field(default_factory=lambda: ["IMD"])


def build_fusion_feature_vector(
    state: CycloneState,
    era5_history: Iterable[tuple[datetime, EnvironmentalFeatures]] | None = None,
) -> FusionBuildResult:
    """Assemble the exact 98-feature runtime vector in trained-model order.

    Raises:
        ValueError: if the input carries no IMD wind data (nothing to predict).
    """
    if state.max_wind_kt is None:
        raise ValueError(
            "CycloneState has no max_wind_kt; cannot build RI predictors."
        )

    imd = build_imd_fusion_features(state)
    sources = ["IMD"]

    if has_era5_base_fields(state):
        era5 = build_era5_static_features(state.environmental_features)
        era5.update(
            build_era5_temporal_features(
                state.environmental_features,
                state.timestamp,
                era5_history if era5_history is not None else [],
            )
        )
        sources.append("ERA5")
        era5_available = True
    else:
        era5 = {name: float("nan") for name in ERA5_FUSION_FEATURES}
        era5_available = False

    fused: dict[str, float] = {}
    fused.update(era5)
    fused.update(imd)

    vector = np.array([fused[name] for name in FUSION_FEATURES],
                      dtype=np.float32).reshape(1, -1)

    n_missing = int(np.isnan(vector).sum())
    n_era5_available = int(np.isfinite(
        vector[0, :ERA5_FEATURE_COUNT]
    ).sum())
    n_temporal_missing = int(np.isnan(
        vector[0, ERA5_FEATURE_COUNT - len(ERA5_TEMPORAL_FEATURES):ERA5_FEATURE_COUNT]
    ).sum())

    return FusionBuildResult(
        vector=vector,
        feature_names=list(FUSION_FEATURES),
        era5_available=era5_available,
        n_missing=n_missing,
        n_era5_available=n_era5_available,
        n_temporal_missing=n_temporal_missing,
        sources=sources,
    )


class IMDERA5FusionModel:
    """Loaded, validated IMD+ERA5 XGBoost fusion model.

    The model is loaded once and cached; validation fails loudly on any
    contract mismatch (feature count, ordering, tree count, load failure).
    """

    def __init__(self, checkpoint_path: str = DEFAULT_FUSION_CHECKPOINT):
        self.checkpoint_path = str(checkpoint_path)
        self._booster: xgb.Booster | None = None
        self.feature_names: list[str] = []
        self.num_trees: int = 0

    @classmethod
    def load(cls, checkpoint_path: str = DEFAULT_FUSION_CHECKPOINT) -> IMDERA5FusionModel:
        instance = cls(checkpoint_path)
        instance._load()
        return instance

    def _load(self) -> None:
        path = Path(self.checkpoint_path)
        if not path.exists():
            raise FileNotFoundError(
                f"IMD+ERA5 fusion model artifact not found: {path}"
            )
        booster = xgb.Booster()
        try:
            booster.load_model(str(path))
        except Exception as exc:  # pragma: no cover - noisy upstream failures
            raise RuntimeError(
                f"Failed to load IMD+ERA5 fusion model from {path}: {exc}"
            ) from exc

        names = list(booster.feature_names or [])
        if len(names) != FUSION_FEATURE_COUNT:
            raise RuntimeError(
                f"Fusion model has {len(names)} features; expected "
                f"{FUSION_FEATURE_COUNT}. Refusing to load mismatched artifact."
            )
        expected = list(FUSION_FEATURES)
        if names != expected:
            mismatches = [
                (i, a, b) for i, (a, b) in enumerate(zip(names, expected))
                if a != b
            ]
            raise RuntimeError(
                "Fusion model feature ordering/names do not match the runtime "
                f"contract. {len(mismatches)} mismatches, first: "
                f"{mismatches[:3]}."
            )

        num_trees = int(booster.num_boosted_rounds())
        if num_trees != FUSION_TREE_COUNT:
            raise RuntimeError(
                f"Fusion model has {num_trees} trees; expected "
                f"{FUSION_TREE_COUNT} (locked artifact)."
            )

        self._booster = booster
        self.feature_names = names
        self.num_trees = num_trees

    @property
    def is_loaded(self) -> bool:
        return self._booster is not None

    def predict_proba(self, vector: np.ndarray) -> np.ndarray:
        """Return P(RI=1) for a ``(1, 98)`` vector (binary:logistic output)."""
        if self._booster is None:
            raise RuntimeError("Fusion model not loaded. Call load() first.")
        if vector.ndim != 2 or vector.shape[1] != FUSION_FEATURE_COUNT:
            raise ValueError(
                f"Expected a (N, {FUSION_FEATURE_COUNT}) feature matrix; got "
                f"{vector.shape}."
            )
        dmatrix = xgb.DMatrix(vector, feature_names=self.feature_names)
        return self._booster.predict(dmatrix)  # all 29 finalized trees
