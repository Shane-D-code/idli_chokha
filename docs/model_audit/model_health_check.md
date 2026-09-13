# TOOFAN Model Health Check Report

**Audit Date:** 2026-09-02 (updated 2026-09-12 per Phase 0–6 findings)
**Audit Type:** FULL — READ-ONLY INSPECTION
**Scope:** All model artifacts, adapters, orchestrator, scientific validation
**Test Suite:** 169/169 PASSED (2026-09-12)

---

## 1. Executive Summary

| Category | Status |
|----------|--------|
| Models audited | 9 (Genesis, Trajectory, Intensity, RI, Recurvature, Rainfall, Wind, Flood, Landslide) |
| Artifact exists | 8/9 (Intensity artifact missing) |
| Adapter loads | 8/9 (Intensity adapter cannot load without artifact) |
| Prediction executes | 5/9 (Genesis, Trajectory, Recurvature, RI-IMD, Landslide-static) |
| Production ready | 0/9 (no model meets full production criteria) |
| Scientifically validated | 1/9, limited (Trajectory has storm-wise CV evidence, **historical** — point-forecast skill not re-verified in-repo; uncertainty NOT validated) |
| Tests passing | 169/169 |

**Bottom line:** Genesis and Trajectory are the only technically functional models with real inference capability. Trajectory point forecasts run, but its uncertainty head is **saturated (~209.9 km), NOT calibrated, and does NOT grow with lead time** — treat `sigma_km` as an unvalidated bound, not a calibrated spread. Intensity has no trained artifact. RI has a partial IMD-only branch working. Rainfall, Wind, Flood, and Landslide are baselines/stubs that cannot produce real predictions in the pipeline. No model is production-ready.

---

## 2. Complete Model Status Table

| # | Model | Artifact Exists | Adapter Loads | Predicts | Output Valid | Adapter Works | Orchestrator Integration | Scientific Status | Overall Status |
|---|-------|----------------|---------------|----------|-------------|--------------|--------------------------|-------------------|----------------|
| 1 | Genesis LightGBM (production) | PASS | PASS | PASS | PASS | PASS | PASS | NOT SCIENTIFICALLY VALIDATED | PARTIAL |
| 2 | Genesis XGBoost | PASS | PASS | PASS | PASS | PASS | PASS | NOT SCIENTIFICALLY VALIDATED | PARTIAL |
| 3 | Genesis RandomForest | PASS | PASS | PASS | PASS | PASS | PASS | NOT SCIENTIFICALLY VALIDATED | PARTIAL |
| 4 | Genesis Ensemble (0.40/0.35/0.25) | PASS | PASS | PASS | PASS | PASS | PASS | NOT SCIENTIFICALLY VALIDATED | PARTIAL |
| 5 | Trajectory V12 (distilled) | PASS | PASS | PASS | PASS | PASS | PASS | LIMITED (storm-wise CV historical; uncertainty NOT validated) | PARTIAL — LIMITED/UNVERIFIED |
| 6 | Intensity | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | NOT SCIENTIFICALLY VALIDATED | UNAVAILABLE |
| 7 | RI — IMD branch | PASS | PASS | PASS | PASS | PASS | PARTIAL | BASELINE ONLY | PARTIAL |
| 8 | RI — ERA5 branch | PASS | PASS | FAIL | FAIL | FAIL | FAIL | BASELINE ONLY | FAIL |
| 9 | RI — Satellite CNN | PASS | PARTIAL | NOT VERIFIED | NOT VERIFIED | PARTIAL | FAIL | BASELINE ONLY | PARTIAL |
| 10 | RI — Fusion | N/A | N/A | FAIL | FAIL | FAIL | FAIL | NOT VERIFIED | FAIL |
| 11 | Recurvature | PASS | PASS | PASS | PASS | PASS | PASS | BASELINE ONLY | PARTIAL |
| 12 | Rainfall | PASS | PASS | STATIC ONLY | STATIC ONLY | PARTIAL | PASS | BASELINE ONLY | BASELINE ONLY |
| 13 | Wind | PASS | PASS | STATIC ONLY | STATIC ONLY | PARTIAL | PASS | BASELINE ONLY | BASELINE ONLY |
| 14 | Flood | PASS | PASS | DATA UNAVAILABLE | DATA UNAVAILABLE | PARTIAL | PASS | BASELINE ONLY | DATA UNAVAILABLE |
| 15 | Landslide | N/A (no ML) | PASS | STATIC ONLY | STATIC ONLY | PASS | PASS | STATIC SUSCEPTIBILITY | STATIC ONLY |

---

## 3. Artifact Inventory

### 3.1 Genesis Models

| Artifact | Path | SHA-256 | Size |
|----------|------|---------|------|
| LightGBM (production) | `genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib` | `d3a2a19c7787c252d7be824cc19824623e1e21464a990be0766b1e7e30a1cf00` | 197,150 B |
| XGBoost | `genisis models/tc_genesis_xgboost_300_OPTIMIZED.joblib` | `f3cd06a608df7053903651c0293f5da1d79133e73ee12913027ad77e2ab203a9` | 565,988 B |
| RandomForest | `genisis models/tc_genesis_randomforest_300_OPTIMIZED.joblib` | `9120c83c73edf89409eb038e69335fef8383059694ba84372b8f8699be516445` | 1,419,122 B |
| Imputer | `genisis models/tc_genesis_300_imputer.joblib` | `7663252645a7d4a4d9547f7704e7304918c8dc24d805845f3f58cb4e5dba7d67` | 1,287 B |

**Note:** The `genisis models/` directory also contains CatBoost, ExtraTrees, and duplicate artifacts. These are NOT loaded by the adapter — only the three OPTIMIZED artifacts above participate.

### 3.2 Trajectory

| Artifact | Path | SHA-256 | Size |
|----------|------|---------|------|
| Deployed distilled checkpoint | `best_cyclone_model_lt3p_distilled.pth` (repo root) | `b9cfc710aa55881dabc4149ebbdd6ac57f814bb93a5118c22b9e41209d57765b` (2026-09-12) | 3,912,349 B |

> Note: the legacy `cyclone_path/checkpoints/v12_best_model.pt` (SHA `cac2aafc…`, 2,040,886 B) does **not** exist in this repository; the deployed artifact is the distilled LT3P checkpoint above, loaded via `cyclone_path_deployment_package/`.

### 3.3 Intensity

| Artifact | Path | Status |
|----------|------|--------|
| XGBRegressor pipeline | `cyclone intensity/models/final_xgb_regressor.joblib` | **MISSING** — directory does not exist |

### 3.4 Rapid Intensification

| Artifact | Path | SHA-256 | Size |
|----------|------|---------|------|
| IMD branch | `cyclone_backup/models/imd_final_xgboost.json` | `707ae7488fbc721c3cd4052954a03c0f797aaaf07fdba07678b377a31f1c1fd2` | 121,841 B |
| ERA5 branch | `cyclone_backup/models/era5_final_xgboost.json` | `3f5690acefac08251de8b0dc684154fe8fdd9894af8c7020249602545a9c9159` | 131,253 B |
| IMD+ERA5 branch | `cyclone_backup/models/imd_era5_final_xgboost.json` | `f59ebd03047221914ff2222363ab6bf2a086a9dea891807e97c352f006cbe617` | 77,947 B |
| Satellite CNN | `cyclone_backup/models/satellite_cnn.pt` | `b844a797886cc07b0a07c442cf1d627661285f41522447cb5c92f0502633b1b2` | 1,263,260 B |

### 3.5 Recurvature

| Artifact | Path | SHA-256 | Size |
|----------|------|---------|------|
| XGBClassifier | `recurvature/xgb_recurve_model.json` | `220cdf56058254c9bc72110ca431253f7f2665bbc8fbf0f4a24269938ce87469` | 305,837 B |
| Scaler | `recurvature/scaler.joblib` | `7fceeb3731b969cfdbb8a18d7cc6c888fb7676e4ff325c4cac6bb9b3d60cb787` | 871 B |

### 3.6 Rainfall

| Artifact | Path | SHA-256 | Size |
|----------|------|---------|------|
| RandomForest classifier | `rain/model/rainfall_classifier_12.pkl` | `12197e9b5be6b354ca259653e65dd81d0344bacb8f3dd229167a10d3928bf6b0` | 16,177,945 B |

### 3.7 Wind

| Artifact | Path | SHA-256 | Size |
|----------|------|---------|------|
| Keras model | `wind/model/wind_model_best.keras` | `53779bf2c5619b59f7bd08d4093ca70e1419aabc3d24437a59ffd2fd47655132` | 5,203,712 B |

### 3.8 Flood

| Artifact | Path | SHA-256 | Size |
|----------|------|---------|------|
| XGBoost pipeline | `flood/model/flood_xgboost_spatial_holdout.pkl` | `97294b60cdba57d1035aa106454633ad34129ee1c598fd550487d85896f32fd2` | 510,284 B |

### 3.9 Landslide

No ML artifact exists. Static hazard map generation only (stage17_hazard_maps).

---

## 4. Detailed Model Reports

### 4.1 Genesis

**Artifact path:** `genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib` (and _xgboost_, _randomforest_)
**Architecture:** sklearn Pipeline (SimpleImputer + Classifier)
**Framework:** scikit-learn 1.6.1 (loaded under 1.9.0 with compatibility repair)
**Input features:** 34 (see GENESIS_FEATURES in `src/models/genesis/adapter.py:93`)
**Preprocessing:** Embedded SimpleImputer (median), no double-imputation
**Missing values:** Handled by embedded imputer; adapter maps absent CycloneState fields to NaN. `w/q/z` per level and the `tchp_kj_cm2_y`/`ohc700_kj_cm2_y` slots are always NaN (median-imputed) — `_y` is never auto-duplicated from `_x` (Phase 8 fix).
**Target:** `genesis_24h` (binary: genesis within 24h)
**Threshold:** 0.24 (verified in adapter and pipeline.yaml)
**Production model:** LightGBM (LGBMClassifier)
**Ensemble:** 0.40*LightGBM + 0.35*XGBoost + 0.25*RandomForest (verified: calculated matches output)
**Model loads:** YES (all three components)
**Prediction executes:** YES
**Output valid:** YES (probability 0.339, class 1, risk HIGH for test input)
**Adapter loads:** YES
**ModelFactory registration:** YES (genesis, genesis_lightgbm, genesis_soft_voting_ensemble)
**Orchestrator integration:** YES (first node in DAG)
**Native runtime compatibility:** YES (n_jobs=1, nthread=1 set at load)
**Scientific validation:** NOT SCIENTIFICALLY VALIDATED — per external source report: 300 samples / 191 NIO storms / 2015-2024, synthetic SST/TCHP features, storm-aware CV lower than held-out test. Training data, script, and metrics are **NOT in this repository** (HISTORICAL CLAIM — not reproducible from current repo).
**Leakage:** Synthetic features (SST, TCHP, OHC700) are flagged in adapter docstring. Storm-aware splitting per source report (not reproducible in-repo).
**Generalization:** NOT VERIFIED — no out-of-sample temporal validation documented
**Status:** PARTIAL — technically functional, not production-ready

**Special rules verified:**
- Only LightGBM, XGBoost, RandomForest loaded (CatBoost/ExtraTrees rejected): PASS
- Ensemble weights 0.40/0.35/0.25: PASS (calculated matches actual)
- Genesis threshold 0.24: PASS
- 34-feature input schema: PASS

### 4.2 Trajectory (V12-distilled)

**Artifact path:** `best_cyclone_model_lt3p_distilled.pth` (repo root) + `scalers.pkl` (repo root) — deployed via `cyclone_path_deployment_package/`. The legacy `cyclone_path/checkpoints/v12_best_model.pt` path does not exist in this repository.
**Architecture:** CycloneTransformerV11 (Transformer encoder + multi-horizon decoder)
**Framework:** PyTorch
**Model config:** d_model=128, nhead=4, num_layers=3, dim_feedforward=256
**Input features:** 27 (13 base + 14 motion features)
  - Base: lat, lon, wind, mslp, rmw, sst, shear, speed_kmh, bearing_sin/cos, month_sin/cos, dt_hours
  - Motion: u_kmh, v_kmh, speed_3h/6h/12h_kmh, u/v_3h/6h/12h_kmh, accel_kmh2, turn_sin/cos
**Preprocessing:** Normalization via training stats (per-feature mean/std), SST climatology proxy, Willoughby RMW
**Missing values:** Forward-fill for wind/pressure, climatology for SST, default RMW
**Target:** Displacement (km) at 12 horizons
**Prediction horizons:** 12 — +2h, +4h, +6h, +8h, +10h, +12h, +14h, +16h, +18h, +20h, +22h, +24h (VERIFIED)
**Uncertainty:** Structural — log-variance + per-horizon scale, but at inference the head is **saturated at ~209.9 km** (`log_std` clamped at +5): the *same constant bound* at every horizon. **NOT calibrated and does NOT grow with lead time.**
**Model loads:** YES
**Prediction executes:** YES
**Output valid:** YES (12 lat/lon/uncertainty forecasts produced)
**Adapter loads:** YES
**Orchestrator integration:** YES
**Native runtime compatibility:** YES
**Scientific validation:** Historical storm-wise CV evidence (from the external V12 training); **NOT re-verified against the distilled artifact in this repository** — point-forecast skill is unverified in-repo; the uncertainty head is saturated (Phase 5 finding)
**Status:** PARTIAL — LIMITED/UNVERIFIED: real point-forecast inference works; uncertainty is an ~209.9 km constant bound (uncalibrated)

**Special rules verified:**
- 12 prediction horizons +2h through +24h: PASS
- Uncertainty output: PASS

### 4.3 Intensity

**Artifact path:** `cyclone intensity/models/final_xgb_regressor.joblib`
**Status:** UNAVAILABLE — artifact file does not exist. The `cyclone intensity/models/` directory does not exist. Training code exists in `cyclone intensity/main.py` and `cyclone intensity/src/regression.py` but has not been run (or output was not persisted).

**Adapter:** Code exists in `src/models/adapters/intensity_adapter.py`, expects 30 features (13 cyclone dynamics + 17 ERA5 environmental). Adapter cannot load because artifact is missing.

**Prediction horizon:** 24h MSW (per adapter docstring)
**Storm-wise validation:** Referenced in training code (5-fold GroupKFold) but no trained model exists to validate against

**Status:** UNAVAILABLE

### 4.4 Rapid Intensification

**Architecture:** Designed multimodal — XGBoost tabular branches + PyTorch satellite CNN + late fusion. **At runtime only the IMD branch executes**; ERA5/satellite/fusion are not wired (Phase 9 audit).

#### 4.4.1 IMD Branch
- **Artifact:** `cyclone_backup/models/imd_final_xgboost.json`
- **Framework:** XGBoost (XGBClassifier)
- **Features:** 12 — latitude, longitude, max_wind_kt, central_pressure_hpa, pressure_drop_hpa, wind_6h_change, wind_minus_6h_kt, delta_v_minus_6h_kt, wind_minus_12h_kt, delta_v_minus_12h_kt, wind_minus_24h_kt, delta_v_minus_24h_kt
- **Loads:** YES
- **Predicts:** YES (P(RI=0.433) for test input)
- **Status:** PARTIAL

#### 4.4.2 ERA5 Branch
- **Artifact:** `cyclone_backup/models/era5_final_xgboost.json`
- **Framework:** XGBoost (XGBClassifier)
- **Features:** 89 (full ERA5 temporal + derived features)
- **Loads:** YES
- **Predicts:** FAIL — feature shape mismatch (expected 89, got 17 from CycloneState). CycloneState only provides 17 ERA5 features; the model was trained on 89 derived features including temporal deltas.
- **Status:** FAIL

#### 4.4.3 IMD+ERA5 Branch
- **Artifact:** `cyclone_backup/models/imd_era5_final_xgboost.json`
- **Features:** 101 (12 IMD + 89 ERA5)
- **Loads:** YES
- **Predicts:** FAIL — same feature mismatch as ERA5 branch
- **Status:** FAIL

#### 4.4.4 Satellite CNN Branch
- **Artifact:** `cyclone_backup/models/satellite_cnn.pt` (state_dict only)
- **Architecture:** RICNNFusion (IR CNN + 11-feature tabular MLP)
- **Tabular features:** 11 (CN_TAB_FEATURES from `cyclone_backup/src/satellite_cnn.py:68`)
- **Loads:** State dict loads cleanly (308,705 params) but full model requires `RICNNFusion` class + scaler from `cyclone_backup/src/satellite_cnn.py`
- **Predicts:** NOT VERIFIED — two reproducible blockers: (a) fold-0 scaler `results/cnn_tabular_scaler.json` is **absent** from the repo (no `results/` dir); (b) stored crops are global-normalised `[0,1]`, but `normalize_patch` expects Kelvin `[180,310]` → direct inference on stored crops yields a constant −1 K channel. Published OOF PR-AUC 0.516 is an UNVERIFIED/HISTORICAL CLAIM (no OOF CSV in repo).
- **Runtime wiring:** NOT wired — `RISatelliteBranch` in `src/models/adapters/ri_adapter.py` is never instantiated; `satellite_probability` = None (honest).
- **Status:** PARTIAL (artifact) / UNAVAILABLE (inference)

#### 4.4.5 Fusion
- **No trained fusion model exists.** Adapter uses simple average of available branch probabilities.
- **Status:** FAIL — no real fusion capability

**Special rules verified:**
- Each branch tested independently: YES
- Fusion capability: NOT VERIFIED — temporal alignment and ERA5 feature construction incomplete

### 4.5 Recurvature

**Artifact path:** `recurvature/xgb_recurve_model.json`
**Architecture:** XGBClassifier (loaded as `xgb.XGBClassifier` with `predict_proba`)
**Framework:** XGBoost
**Scaler:** StandardScaler (`recurvature/scaler.joblib`)
**Features:** 12 — lat, lon, wind, pres, STORM_SPEED, dir_sin, dir_cos, month_sin, month_cos, DIST2LAND, dir_change_3h, dir_change_9h
**Target:** Binary recurvature within 24h (turn > 45 degrees)
**Model loads:** YES (XGBClassifier, not Booster)
**Prediction executes:** YES
**Output valid:** YES (P(recurve)=0.396, risk MODERATE)
**Adapter loads:** YES
**Orchestrator integration:** YES
**Scientific validation:** BASELINE ONLY — training script exists but no published evaluation metrics
**Leakage:** PLACEHOLDER features — DIST2LAND is a rough estimate, dir_change_3h/9h default to 0.0
**Status:** PARTIAL — technically functional, relies on placeholder features

**Special rules verified:**
- Loaded as XGBClassifier (not Booster-only): PASS
- predict_proba available: PASS

### 4.6 Rainfall

**Artifact path:** `rain/model/rainfall_classifier_12.pkl`
**Architecture:** **bare** sklearn RandomForestClassifier (25 features; NOT a Pipeline; no scaler)
**Framework:** scikit-learn (pickled under sklearn 1.6.1, loads with InconsistentVersionWarning)
**Model loads:** YES
**Prediction:** Returns `AVAILABLE_BASELINE` — same-time classifier on FANI 2019 case study
**Adapter:** `validate_input()` returns False (requires IMERG grids not in CycloneState)
**Output:** Null rainfall grids, `confidence=0.0`, `status="AVAILABLE_BASELINE"` — **schema fixed in Phase 10** so the `status`/`explanation` fields are no longer silently dropped by pydantic
**Split:** Temporal holdout (last 4 of 12 half-hourly FANI snapshots = 112,000 test rows) — the earlier "spatial holdout" label was incorrect; corrected in Phase 10
**Metrics:** `rain/metadata/rainfall_model_12_metadata.json` values **reproduce** from `results/model12_results.csv` (verified to 4+ decimals) — FANI-only, same-day, autoregressive lag features cross the 30-min train/test boundary (optimistic)

**Classification:** SAME-TIME / CURRENT — NOT a future forecasting model
**Status:** BASELINE ONLY

**Special rules verified:**
- Same-time vs future forecast: VERIFIED — same-time classifier, NOT future forecasting
- Two-stage "classifier + regressor" claim in metadata.json: **regressor artifact ABSENT from repo** — only the classifier exists

### 4.7 Wind

**Artifact path:** `wind/model/wind_model_best.keras`
**Architecture:** Keras ConvLSTM2D encoder–decoder: input (6, 81, 57, 2) U10/V10 grids → output (81, 57, 2) "future_wind" (U10/V10, m/s); horizon/alignment **undocumented** (no training script)
**Framework:** TensorFlow/Keras
**Model loads:** **NO on this environment** (verified Phase 10) — `import tensorflow` hard-aborts the interpreter (SIGABRT, libc++ mutex failure); the load path now probes TF import health in a subprocess and reports an explicit `UNAVAILABLE` status instead of crashing
**Prediction:** Returns `BASELINE` (model loaded) or explicit `UNAVAILABLE` (TF runtime unusable) — Yaas 2021 single case study (model never executed; `status`/`explanation` schema fields added in Phase 10)
**Adapter:** `validate_input()` returns False (requires gridded fields not in CycloneState)
**Training pipeline:** NOT DOCUMENTED in repository; no scaler object (only `wind_normalization.txt`); no numeric metrics

**Classification:** CASE-STUDY / BASELINE — Yaas 2021 only, not generalized
**Status:** BASELINE ONLY / UNAVAILABLE (orchestrator: UNAVAILABLE — not registered)

**Special rules verified:**
- Generalized vs case-study: VERIFIED — CASE-STUDY (Yaas 2021 only)
- Runtime-safety: VERIFIED (Phase 10) — `create_wind_adapter()` no longer crashes the process; no fabricated wind output (empty `wind_fields`, `confidence=0.0`)

### 4.8 Flood

**Artifact path:** `flood/model/flood_xgboost_spatial_holdout.pkl`
**Architecture:** **raw** XGBClassifier (28 features — 16 IMERG rainfall + 12 static hydrology; NOT a Pipeline; no scaler)
**Framework:** XGBoost
**Model loads:** YES
**Prediction:** Returns `DATA_UNAVAILABLE` — requires rainfall grids + full geographic preprocessing
**Adapter:** Requires rainfall prediction with actual grids + full geographic feature engineering (not available)
**Validation:** Spatial holdout on FANI 2019 claimed, but the claimed metrics (ROC-AUC 0.9635 / PR-AUC 0.814) are **UNVERIFIED / HISTORICAL CLAIM — NOT REPRODUCED**: the exact 94-cell holdout split is not in the repo. The "temporal validation" file uses training-period timestamps + all 374 cells with per-cell-constant labels (~100% accuracy) — not a valid temporal holdout.
**Label leak:** labels are per-cell constant across all timestamps (post-event EMSR357 map propagated to pre-storm times); features use only current + past rainfall (verified — no future-rainfall leak).

**Status:** DATA UNAVAILABLE

**Special rules verified:**
- Required rainfall grids and geospatial preprocessing: NOT AVAILABLE — returns DATA_UNAVAILABLE as required
- Classification: STATIC spatial flood-extent classifier / case study — **not a flood forecast, not a validated susceptibility model**
- Demo outputs produced with zero-filled features (fabricated inputs outside repo code) — not reproducible from the artifact alone

### 4.9 Landslide

**Artifact:** None — no ML model exists
**Adapter:** Returns `STATIC_SUSCEPTIBILITY` status
**Underlying capability:** `stage17_hazard_maps` generates static PNG hazard maps from rainfall + terrain
**Dynamic prediction:** NOT AVAILABLE — no cyclone-triggered landslide forecasting model

**Classification:** STATIC SUSCEPTIBILITY — NOT dynamic event prediction
**Status:** STATIC ONLY

**Special rules verified:**
- Static susceptibility vs dynamic event prediction: VERIFIED — STATIC SUSCEPTIBILITY only

---

## 5. Orchestrator & Pipeline

### 5.1 Dependency Graph (DAG)

```
Genesis
├── Trajectory
│   ├── Recurvature
│   ├── Rainfall (+ Intensity)
│   └── Wind (+ Intensity)
├── Intensity
├── RI
├── Flood (+ Rainfall + Wind)
├── Landslide (+ Rainfall)
└── HazardRiskEngine (all above)
```

**Execution order (topological sort):** genesis → trajectory → intensity → ri → recurvature → rainfall → wind → landslide → flood → hazard_engine

**DAG validation:** NO CYCLES, NO MISSING DEPENDENCIES

### 5.2 Orchestrator Loading

- `PipelineOrchestrator`: LOADS
- `DependencyGraph`: LOADS
- `create_orchestrator()`: AVAILABLE
- Module dispatch: Correct per-module argument passing verified in code

### 5.3 ModelFactory

- `ModelFactory._registry`: Currently empty at module level (registration happens via adapter import side effects)
- Registration confirmed for: `genesis`, `genesis_lightgbm`, `genesis_soft_voting_ensemble`
- Other model types: Not explicitly registered (use direct adapter imports)

### 5.4 Native Runtime Compatibility

- `src/core/runtime.py`: Sets `OMP_NUM_THREADS=1`, pre-loads `libomp.dylib`
- Genesis adapters: `n_jobs=1`, `nthread=1` enforced at load time
- PyTorch + XGBoost coexistence: Tested in `tests/integration/test_native_model_compatibility.py`
- **Status:** PASS — native runtime compatibility verified

---

## 6. Scientific Validation Summary

| Model | Evidence Type | Dataset | Validation Method | Status |
|-------|--------------|---------|-------------------|--------|
| Genesis | None published | 300 samples / 191 storms / 2015-2024 | Storm-aware CV (lower than held-out) | NOT SCIENTIFICALLY VALIDATED |
| Trajectory V12 | Storm-wise CV diagnostics | IBTrACS NIO | Per-horizon error statistics | VALIDATED (CV only) |
| Intensity | None (no artifact) | N/A | N/A | UNAVAILABLE |
| RI (IMD) | Training code with storm-grouped CV | IBTrACS NIO | PR-AUC, ROC-AUC, Brier | BASELINE ONLY |
| RI (ERA5) | Training code with storm-grouped CV | IBTrACS NIO + ERA5 | PR-AUC, ROC-AUC, Brier | BASELINE ONLY |
| RI (Satellite) | Training code with GroupShuffleSplit | MERG-IR + IBTrACS | Storm-safe OOF | BASELINE ONLY |
| Recurvature | Training script | IBTrACS | Accuracy, F1, ROC-AUC | BASELINE ONLY |
| Rainfall | None documented | FANI 2019 only | Temporal holdout (last 4 snapshots) | BASELINE ONLY |
| Wind | None documented | Yaas 2021 only | None | BASELINE ONLY |
| Flood | Spatial holdout (metrics unverified) | FANI 2019 only | Spatial holdout (split absent; UNVERIFIED) | BASELINE ONLY |
| Landslide | None (no ML) | N/A | N/A | STATIC ONLY |

---

## 7. Known Limitations

1. **Genesis:** Synthetic SST/SST-anomaly and TCHP/OHC700 features; 300-sample prototype; no temporal holdout validation
2. **Trajectory:** Single-timestep inference uses climatology proxies (no historical track in standard pipeline); full historical track mode requires IBTrACS-format CSV
3. **Intensity:** No trained artifact — model cannot be loaded or used
4. **RI:** ERA5 branch expects 89 features but CycloneState provides only 17; satellite CNN requires IR image patch not in CycloneState; no trained fusion model; simple averaging used as fallback
5. **Recurvature:** DIST2LAND is a rough placeholder (200-500 km estimates); dir_change_3h/9h default to 0.0 without historical track
6. **Rainfall:** Same-time classifier only, cannot forecast future rainfall
7. **Wind:** Undocumented architecture, single case study (Yaas 2021), no inference pipeline
8. **Flood:** Requires full geographic preprocessing pipeline (terrain, hydrology, land cover, soil) not available in standard inputs
9. **Landslide:** No ML model — only static hazard maps
10. **Intensity artifact missing:** `cyclone intensity/models/final_xgb_regressor.joblib` does not exist
11. **ModelFactory registration:** Only Genesis types explicitly registered; other adapters loaded via direct import

---

## 8. Production Readiness Assessment

| Model | Technical Functionality | Scientific Validation | Data Pipeline | Production Ready? |
|-------|------------------------|----------------------|---------------|-------------------|
| Genesis | YES | NOT VALIDATED | PARTIAL (synthetic features) | NO |
| Trajectory | YES | VALIDATED (CV) | YES (IBTrACS) | NO (needs external validation) |
| Intensity | NO (no artifact) | NO | NO | NO |
| RI | PARTIAL (IMD only) | BASELINE ONLY | PARTIAL (ERA5 gap) | NO |
| Recurvature | YES | BASELINE ONLY | PARTIAL (placeholder) | NO |
| Rainfall | NO (same-time) | BASELINE ONLY | NO | NO |
| Wind | NO (case-study) | BASELINE ONLY | NO | NO |
| Flood | NO (data unavailable) | BASELINE ONLY | NO | NO |
| Landslide | NO (no ML) | STATIC ONLY | N/A | NO |

**No model is production ready.**

---

## 9. End-to-End DAG Result

### Test Conditions
- Test CycloneState: lat=13.5, lon=87.5, wind=45kt, pres=990hPa, ERA5 env, ocean features
- All adapters loaded with real artifacts

### Execution Trace

| Step | Module | Status | Notes |
|------|--------|--------|-------|
| 1 | Genesis | PASS | probability=0.339, class=1 |
| 2 | Trajectory | PASS | 12 horizons; uncertainty = **saturated ~209.9 km constant bound (NOT calibrated, NOT horizon-growing)** |
| 3 | Intensity | FAIL | No artifact → adapter reports `UNAVAILABLE`; retrain via `cyclone intensity/retrain.py` (deterministic recipe, real data required) |
| 4 | RI | PARTIAL | IMD branch works (0.433); ERA5 branch fails (feature mismatch) |
| 5 | Recurvature | PASS | probability=0.396, risk=MODERATE |
| 6 | Rainfall | STATIC | Returns AVAILABLE_BASELINE |
| 7 | Wind | STATIC | Returns BASELINE |
| 8 | Landslide | STATIC | Returns STATIC_SUSCEPTIBILITY |
| 9 | Flood | DATA UNAVAILABLE | Returns DATA_UNAVAILABLE |
| 10 | HazardRiskEngine | PARTIAL | Computes from available outputs only |

**DAG completes** but with 1 failure (intensity), 1 partial (RI), 3 static/baseline outputs (rainfall, wind, landslide), and 1 data-unavailable (flood). Only Genesis, Trajectory (point forecasts; uncertainty bound saturated ~209.9 km, uncalibrated), and Recurvature produce real predictions in the pipeline.

---

## 10. Recommendations

1. **Train and persist intensity model:** Run `cyclone intensity/main.py` to generate `final_xgb_regressor.joblib`
2. **Fix RI ERA5 feature alignment:** Either reduce ERA5 model to 17 features or expand CycloneState to include all 89 features
3. **Implement RI satellite branch full pipeline:** Add IR image extraction/preprocessing to CycloneStateBuilder
4. **Train RI fusion model:** Replace simple averaging with trained meta-classifier
5. **Improve Genesis validation:** Add temporal holdout validation (e.g., 2023-2024 test set)
6. **Build real rainfall forecasting model:** Replace same-time classifier with future rainfall prediction
7. **Document and generalize wind model:** Add training script, expand beyond Yaas case study
8. **Build flood preprocessing pipeline:** Integrate DEM/hydrology/land cover feature engineering
9. **Build dynamic landslide model:** Train ML model on cyclone-triggered landslide events
