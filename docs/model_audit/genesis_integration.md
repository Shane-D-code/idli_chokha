# Genesis Integration Audit — TOOFAN

Generated: 2026-09-02

This document records how the three approved Genesis models were integrated into
the TOOFAN pipeline, the exact artifacts used, the model/feature/preprocessing
contract, and the verification performed. It is an honest integration record:
nothing was retrained, no model weights were modified, and prohibited models were
excluded.

**Prohibited-and-excluded (present in repo but NOT used):** CatBoost and
ExtraTrees `_OPTIMIZED` artifacts, `tc_genesis_BEST_MODEL_300.joblib`, and the
non-`OPTIMIZED` variants.

---

## 1. Executive Summary

| Item | Value |
|------|-------|
| **Production model** | **LightGBM** (`LGBMClassifier`) |
| **Secondary path** | Calibrated soft-voting ensemble: LightGBM 0.40 / XGBoost 0.35 / RandomForest 0.25 |
| **Approved models (strict)** | LightGBM, XGBoost, RandomForest — only |
| **Collective threshold** | **0.24** (not re-optimized at inference) |
| **Target** | `genesis_24h` (binary) |
| **Retraining** | **NOT performed** |
| **Weight modification** | **None** (single runtime `n_jobs=1` applied for native-thread compat — does not alter learned parameters, statistics, or predictions) |
| **Calibration** | No calibration artifact exists → raw weighted probabilities retained (`calibrated=False`) |
| **Scientific status** | **PROTOTYPE** (see Section 7) |

---

## 2. Artifacts and Hashes

| Role | Path | Framework | SHA-256 (first 16) |
|------|------|-----------|--------------------|
| Production (`lightgbm`) | `genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib` | LightGBM | `d3a2a19c7787c252` |
| Ensemble member (`xgboost`) | `genisis models/tc_genesis_xgboost_300_OPTIMIZED.joblib` | XGBoost | `f3cd06a608df7053` |
| Ensemble member (`randomforest`) | `genisis models/tc_genesis_randomforest_300_OPTIMIZED.joblib` | RandomForest | `9120c83c73edf894` |
| Schema reference (standalone imputer) | `genisis models/tc_genesis_300_imputer.joblib` | sklearn | — (not used for prediction) |

**Note:** the artifacts reside in a directory that contains a literal space:
`genisis models/`.

---

## 3. Model Format / Preprocessing Contract

Each `_OPTIMIZED` artifact is a `sklearn.pipeline.Pipeline` of the form:

```
Pipeline(steps=[
    ('imputer', SimpleImputer(strategy='median', 34 features)),
    ('model',   <approved classifier>),
])
```

- Preprocessing (median imputation) is **embedded** in each pipeline.
- The adapter calls each pipeline directly **without** double-imputing or
  double-transforming.
- Per-level fields not present in the TOOFAN schema (`w/q/z` per level) are
  left `NaN` and imputed medians are applied exactly as during training.

### 3.1 LightGBM hyperparameters (documented, unchanged)

`boosting_type=gbdt`, `learning_rate=0.02`, `n_estimators=200`, `max_depth=5`,
`num_leaves=23`, `random_state=42`, `class_weight=balanced`,
`colsample_bytree=1.0`, `subsample=0.7`, `min_child_samples=20`.

---

## 4. Feature Schema (34 features, order-sensitive)

```
tchp_kj_cm2_x, ohc700_kj_cm2_x,
u850, v850, r850, t850, w850, q850, z850,
u700, v700, r700, t700, w700, q700, z700,
u500, v500, r500, t500, w500, q500, z500,
u200, v200, r200, t200, w200, q200, z200,
sst,
sst_anomaly,
tchp_kj_cm2_y, ohc700_kj_cm2_y
```

- 34 columns, exact order fed to the embedded imputer/model.
- Source mapping in `GenesisModelAdapter._build_feature_frame` pulls from
  `CycloneState.environmental_features` and `ocean_features`.

---

## 5. Threshold and Decision Rule

- **Threshold:** `0.24` (`DEFAULT_GENESIS_THRESHOLD`), configurable.
- **No acceptance/optimization tuning** is performed at inference.
- Decision: `probability >= 0.24 → predicted_class=1 (genesis, risk=HIGH)`;
  else `0 (risk=LOW)`.
- `risk_level` maps the binary gateway; we do not claim a finer risk scale.

---

## 6. Ensemble Definition

Soft-voting on **class-1 probabilities** (not hard labels):

```
ensemble_prob = 0.40*P_lgbm + 0.35*P_xgb + 0.25*P_rf
```

- Requires **all three** components present. If any is missing → ensemble mode
  is `UNAVAILABLE`; **no** two-model substitute ensemble is built.
- If an ensemble prediction is requested while unavailable → honest
  `RuntimeError` (no silent fallback to production).

---

## 7. Dataset / Scientific Caveat (PROTOTYPE)

- 300 samples / 150 genesis / 150 non-genesis.
- 191 North Indian Ocean storms; 2015–2024.
- Source notes report **synthetic SST/SST-anomaly** and **synthetic
  TCHP/OHC700** features.
- Storm-aware CV metrics were **lower** than held-out test metrics → treat the
  reported test performance with caution.
- The integration **must not** be represented as production-validated. The
  `explanation` field in every `GenesisPrediction` records this caveat.

---

## 8. Honest Failure Behaviour (no substitution)

| Scenario | Behaviour |
|----------|-----------|
| LightGBM artifact missing | `production_available=False`; production predict → `RuntimeError` |
| XGBoost / RF missing | `ensemble_available=False`; ensemble predict → `RuntimeError` |

No model substitution is ever performed; a missing artifact is surfaced in the
`availability_report()` and logged.

---

## 9. Model / Factory Registration

Registered names in `src.models.base.ModelFactory` (all map to
`GenesisModelAdapter`; mode selected at creation/predict):

- `genesis`
- `genesis_lightgbm` (production)
- `genesis_soft_voting_ensemble` (ensemble)

`ModelAdapter` alias also enabled for orchestrator compatibility.

---

## 10. Provenance Attributes

Each component exposes:
- `model_type`, `model_name`
- `artifact_filename`, `artifact_path`, `artifact_hash_sha256`
- `framework`, `target`, `n_features`, `dataset`, `load_time_utc`,
  `scientific_status="prototype"`
- estimator class, `classes_`, and selected hyperparameters
- `feature_names`

Ensemble provenance additionally records weights and per-member artifact hashes.

---

## 11. Verification Performed

### 11.1 Fidelity

Adapter predictions match direct loading of each pipeline to **1e-12** for all
three models (LightGBM, XGBoost, RandomForest).

### 11.2 Ensemble arithmetic

Weighted sum matches manual `0.40*P_lgbm + 0.35*P_xgb + 0.25*P_rf`.

### 11.3 Missing-artifact honesty

With RandomForest removed, production stays `AVAILABLE` and ensemble becomes
`UNAVAILABLE` (verified).

### 11.4 Prohibited-model rejection

Artifacts wrapping CatBoost / ExtraTrees are refused by the `_GenesisComponent`
`ValueError` guard (verified).

### 11.5 Test suite

- `tests/test_genesis.py`: **44/44 pass** (sections A–Q + fidelity).
- Full suite `tests/` (via `python -m pytest`): **143/143 pass**.
- Stable across 6 consecutive full-suite runs (see Section 12).

---

## 12. Runtime / Native Compatibility

### 12.1 Three-way OpenMP conflict (fixed)

Adding LightGBM to the existing PyTorch (trajectory) + XGBoost (recurvature)
process caused an intermittent native SIGSEGV inside
`lightgbm/basic.py __inner_predict_np2d` when running the full suite — a
race between multiple OpenMP runtimes.

### 12.2 Fix

- `src/core/runtime.py::configure_runtime()` now **pre-loads a single canonical
  `libomp`** (located via `_find_libomp()`, e.g. Homebrew
  `/opt/homebrew/opt/libomp/lib/libomp.dylib`) using `ctypes.CDLL` **before** any
  ML framework imports, so PyTorch, XGBoost and LightGBM share one OpenMP runtime.
- `OMP_NUM_THREADS=1` remains set.
- The guard that raises if ML frameworks are already imported now exempts
  `sklearn` (imported by pytest infrastructure before conftest; it does not
  initialize the conflicting OpenMP worker pools).
- `tests/conftest.py` runs `configure_runtime()` at pytest session start so the
  pre-load happens before any test module imports an ML framework.
- Embedded estimators are additionally constrained to `n_jobs=1` at load as a
  runtime-only thread setting (bit-identical predictions; no weights changed).

### 12.3 Verification

`python -m pytest tests/ -q` → **143 passed**; stable over 6 consecutive runs.

---

## 13. Configuration

`configs/pipeline.yaml` (genesis section):

```yaml
genesis:
  enabled: true
  mode: production            # 'production' (LightGBM) or 'ensemble'
  production_model: lightgbm
  artifacts:
    lightgbm: genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib
    xgboost: genisis models/tc_genesis_xgboost_300_OPTIMIZED.joblib
    randomforest: genisis models/tc_genesis_randomforest_300_OPTIMIZED.joblib
  ensemble_weights:           # soft-voting on probabilities
    lightgbm: 0.40
    xgboost: 0.35
    randomforest: 0.25
  threshold: 0.24
  target: genesis_24h
  n_features: 34
```

Dependency: `lightgbm>=4.0.0` added to `requirements.txt` and `pyproject.toml`.

---

## 14. Known Limitations

- **PROTOTYPE** — synthetic oceanic features; not operationally validated.
- No calibration artifact → `calibrated_probability=None`, `calibrated=False`.
- Threshold (0.24) is fixed from documentation; not re-optimized at inference.
- Ensemble requires all three artifacts and never degrades to a partial ensemble.
- Native compat fix depends on a Homebrew/system `libomp` being discoverable on
  macOS arm64 (best-effort; falls back gracefully if absent).

---

## 15. Declaration

- **GENESIS PRODUCTION MODEL:** LightGBM.
- **ENSEMBLE:** LightGBM 0.40 / XGBoost 0.35 / RandomForest 0.25 (soft voting).
- **THRESHOLD:** 0.24.
- **CATBOOST / EXTRATREES:** NOT USED.
- **RETRAINING:** NOT PERFORMED.
- **MODEL WEIGHTS:** UNCHANGED.