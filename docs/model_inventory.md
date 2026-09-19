# TOOFAN Model Inventory

Generated: 2026-09-02

This document catalogs all existing models, datasets, training scripts, and artifacts in the TOOFAN repository as of the initial audit.

---

## 1. CYCLONE TRAJECTORY / TRACK PREDICTION

| Field | Details |
|-------|---------|
| **Module** | `cyclone_path_deployment_package/` with source fallback to `cyclone_path_deployment_package_v7b/` (inference); legacy `cyclone_path/` (V12 CLI, referenced by `v12_common.py`) |
| **Model** | `CycloneTransformerV11` (V12 checkpoint) — Transformer encoder + direct per-horizon heads with identifiable bounded scale correction (0.80–1.20) |
| **Inputs** | 13 features × 12 timesteps: `lat`, `lon`, `wind`, `mslp`, `rmw`, `sst`, `shear`, `speed_kmh`, `dt_hours`, `bearing_sin`, `bearing_cos`, `month_sin`, `month_cos` (built from raw best-track fixes) |
| **Outputs** | Forecast positions at +2, +4, +6, ..., +24h (12 horizons); each with `cal_lat`, `cal_lon`, `raw_lat`, `raw_lon`, `learned_scale`, `sigma_km` (pending Phase 5 corrections applied to adapter: see `docs/model_audit/model_health_check.md`) |
| **Dataset** | IBTrACS North Indian Ocean (`ibtracs.NI.list.v04r01.csv` ~28 MB in `wind/`); training used storm-wise splits (train/val/test by storm ID) |
| **Training Script** | V12 training was done externally; the deployed artifact `best_cyclone_model_lt3p_distilled.pth` is a distilled LT3P checkpoint, loaded by `src/models/adapters/trajectory_adapter.py` through the deployment package. The adapter tries `cyclone_path_deployment_package/` first and falls back to `cyclone_path_deployment_package_v7b/` when the root package has no source files. |
| **Inference Script** | `cyclone_path_deployment_package_v7b/` (api.py/inference.py/feature_builder.py) via `src/models/adapters/trajectory_adapter.py`; legacy `v12_predict_new.py` equivalent is packaged in the deployment package |
| **Model Artifact** | `best_cyclone_model_lt3p_distilled.pth` (repo root, ~2 MB) + `scalers.pkl` (repo root) — the deployed checkpoint actually used by `trajectory_adapter.py`; the legacy `cyclone_path/checkpoints/v12_best_model.pt` path no longer exists in this repository |
| **Status** | **LIMITED / UNVERIFIED** — real inference works (point forecasts loaded + executed via the deployment package), but (1) the uncertainty head is **saturated at ~209.9 km** (log-variance +5 clamp) — *not* a linear/scale-per-horizon spread, *not* calibrated, *not* growing with lead time; (2) point-forecast skill is not re-verified in-repo (see model_health_check); (3) the 12-point synthetic input-history path is unresolved (Phase 5) |
| **Metrics** | **HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT REPOSITORY**: median 24h error ~50–80 km on historical test storms. **Uncertainty (sigma_km) is NOT verified and does NOT grow with lead time** (saturation bounded) |
| **Dependencies** | PyTorch, NumPy, Pandas; no external reanalysis at inference (SST/shear are climatology proxies) |

---

## 2. RAPID INTENSIFICATION (RI) DETECTION

| Field | Details |
|-------|---------|
| **Module** | `cyclone_backup/` |
| **Model** | **Designed** multimodal late-fusion: three independent branches → Logistic Regression meta-classifier. **NOT realized in the repository** — no fusion meta-model artifact exists and no branch combination runs |
| **Branch 1 — IMD** | XGBoost on 11 IMD features: `latitude`, `longitude`, `max_wind_kt`, `central_pressure_hpa`, `pressure_drop_hpa`, `wind_minus_6h_kt`, `delta_v_minus_6h_kt`, `wind_minus_12h_kt`, `delta_v_minus_12h_kt`, `wind_minus_24h_kt`, `delta_v_minus_24h_kt` |
| **Branch 2 — ERA5** | XGBoost on ~50 ERA5 derived features: `d_*`, `r_*`, `t_*`, `u_*`, `v_*` at 850/700/500/200 hPa + derived (rh_mean_850_500, wind_mag_*, divergence_contrast_*, u/v_shear_850_200, shear_direction_deg, humidity/temp structure deltas) + temporal deltas (6h/12h/24h) |
| **Branch 3 — Satellite (CNN)** | PyTorch `RICNNFusion` hybrid: 4-block CNN encoder (128×128 IR + valid mask) + 11-IMD-feature tabular head → fused embedding → classification head; focal loss (α=0.75, γ=2); trained in Google Colab |
| **Inputs** | IMD best-track (intensity history) — **implemented, runtime**; ERA5 reanalysis (storm-centred profiles) and Satellite IR (MERG-IR, storm-centred recovered crops) — **designed, not wired at runtime** |
| **Outputs** | `RIPrediction`: `probability_24h`, `risk_level`, `imd_probability`, `era5_probability`, `satellite_probability`, `fusion_probability`, `calibrated_probability`, `explanation`, `confidence`. **Note:** `calibrated_probability` is set to `imd_probability` directly (adapter aliases it); **no isotonic calibration is applied at inference** — the name is aspirational, not an applied method |
| **Dataset** | Canonical `ri_multimodal_dataset.csv` (3,211 obs / 259 storms / 179 RI); ERA5: 848 obs / 107 storms; Satellite: 25 multimodal rows / 23 storms / 8 RI / 17 non-RI (26 recovered images, 9 RI / 17 non-RI); TCIR global: 2,840 obs / 64 storms / 189 RI — **UNVERIFIED / HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT REPOSITORY** (no dataset or results in repo) |
| **Training Scripts** | `run_pipeline.py` (tabular IMD, IMD+ERA5), `tc_ri_cnn/train.py` (CNN, Colab — not reproducible from repo outputs), `run_final_multimodal.py` (fusion — requires absent result CSVs) |
| **Inference Script** | `models/predict_ri.py` — legacy script that loads all three branches + fusion meta-model; **the fusion meta-model does not exist**, so `fusion_probability` cannot be produced |
| **Model Artifacts** | `cyclone_backup/models/imd_final_xgboost.json` (**real, deployable — only runtime branch**), `cyclone_backup/models/era5_final_xgboost.json` (**runtime feature reconstruction not wired** — UNAVAILABLE), `cyclone_backup/models/satellite_cnn.pt` (**real fitted state dict, 308,705 params, loads — but inference NOT runnable in-repo**: fold-0 scaler `results/cnn_tabular_scaler.json` absent + storage `[0,1]`↔Kelvin preprocess mismatch; OOF claims unreproducible — UNVERIFIED), `imd_era5_final_xgboost.json` |
| **Status** | **MVP / PROTOTYPE — IMD branch only is deployable today.** Honest negative results documented: IMD alone (PR-AUC 0.594) beats IMD+ERA5 (0.341) on strict common test set (20 storms / 25 RI); Satellite CNN OOF PR-AUC 0.516 on 9 obs and TCIR CNN PR-AUC 0.092 — both **UNVERIFIED / HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT REPOSITORY**; three-way fusion **NOT EVALUABLE** (only 1 of 9 satellite rows has ERA5) and **NO fusion meta-model exists in the repository** — `fusion_probability` cannot be produced |
| **Metrics** | PR-AUC (primary), ROC-AUC, Precision, Recall, F1, Brier score, calibration (isotonic), storm-block bootstrap CIs |
| **Dependencies** | XGBoost, PyTorch (CNN training), scikit-learn, Pandas, NumPy; ERA5 requires CDS API |

---

## 3. CYCLONE INTENSITY PREDICTION

| Field | Details |
|-------|---------|
| **Module** | `cyclone intensity/` |
| **Model** | Tuned XGBoost Regressor (primary) + Extra Trees Regressor (secondary); both with `SimpleImputer(strategy='median')` pipeline |
| **Inputs** | 30 features: 13 cyclone state/dynamics (`msw_kt`, `pressure_hpa`, `lat`, `lon`, `msw_change_6h/12h/24h`, `pressure_change_6h/12h/24h`, `lat_change_6h`, `lon_change_6h`, `movement_speed_kt`) + 17 ERA5 environmental (`era5_sst`, `era5_t850/700/500/200`, `era5_r850/700/500/200`, `era5_u850/700/500/200`, `era5_v850/700/500/200`) |
| **Outputs** | `IntensityPrediction`: `predicted_msw_24h` (kt), `predicted_category` (IMD: D/DD/CS/SCS/VSCS/ESCS/SUCS), uncertainty (`uncertainty_kt` = `None` — point-forecast regressor; no calibrated per-prediction uncertainty), within-1-category accuracy |
| **Dataset** | IMD Best Track (1982–2026) + IBTrACS cross-reference + ERA5 point-interpolated; final `clean_model_data.csv` = 486 obs / 30 storms — **dataset ABSENT from this repository** |
| **Training Script** | `cyclone intensity/retrain.py` (deterministic retraining entry point, `random_state=42`, storm-wise `GroupKFold` on `storm_id`); legacy `main.py` → `src/regression.py` (`evaluate_regression_storm_cv`, `train_final_regression_model`) |
| **Inference Script** | `src/models/adapters/intensity_adapter.py::create_intensity_adapter()` (loads `cyclone intensity/models/final_xgb_regressor.joblib`; reports `status="UNAVAILABLE"` if the artifact is missing, `"UNVERIFIED"` if present) |
| **Model Artifact** | `models/final_xgb_regressor.joblib` — **ABSENT from this repository** (must be produced by `retrain.py` from the real dataset) |
| **Status** | **UNAVAILABLE / UNVERIFIED** — no trained artifact, modeling dataset, or results exist in this repository; the pipeline cannot run until the real dataset is supplied and `retrain.py` reproduces the artifact. CV metrics below are **HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT REPOSITORY** (5-fold storm-wise CV: MAE 14.55 kt, RMSE 19.66 kt, R² 0.037; Classification: Exact accuracy 45.3%, Within-1-category 84.0%). R² ≈ 0.037 indicates near-zero explained variance on that historical run |
| **Metrics** | MAE, RMSE, R² (regression); Exact/Within-1 Accuracy, Macro/Weighted F1, Precision, Recall (classification) — see previous row for verification status |
| **Dependencies** | XGBoost, scikit-learn, Pandas, NumPy, joblib, seaborn (plotting helpers in `cyclone intensity/src/utils.py`) |

---

## 4. RECURVATURE PREDICTION

| Field | Details |
|-------|---------|
| **Module** | `recurvature/` |
| **Model** | XGBoost Classifier (binary: heading change ≥ 45° within 24h) |
| **Inputs** | 13 features: `lat`, `lon`, `wind`, `pres`, `STORM_SPEED`, `dir_sin`, `dir_cos`, `month_sin`, `month_cos`, `DIST2LAND`, `dir_change_3h`, `dir_change_9h` (built from IBTrACS) |
| **Outputs** | `RecurvaturePrediction`: `probability`, `expected_turning_window`, `risk_level`, `confidence` |
| **Dataset** | IBTrACS North Indian Ocean (`ibtracs_NI_list_v04r01.csv`); storm-wise train/val/test split |
| **Training Script** | `src/train.py` (CLI: `python -m src.train --csv data/ibtracs_NI_list_v04r01.csv`) |
| **Inference Script** | None yet (only training + test evaluation) |
| **Model Artifact** | `xgb_recurve_model.json` (saved by training script) |
| **Status** | **TRAINED / BASELINE** — evaluates on held-out test storms; metrics printed but not extensively documented |
| **Metrics** | Accuracy, Precision, Recall, F1, ROC-AUC, Brier score |
| **Dependencies** | XGBoost, scikit-learn, Pandas, NumPy |

---

## 5. RAINFALL (SAME-TIME CLASSIFICATION — BASELINE)

| Field | Details |
|-------|---------|
| **Module** | `rain/` |
| **Model** | Random Forest **binary classifier** (`rainfall_classifier_12.pkl`, bare `RandomForestClassifier`, 25 features — NOT a Pipeline) — labels heavy rain (≥ 10 mm/hr) vs light from IMERG + cyclone features at the **same timestamp**; the documented "two-stage" regressor half ships as `rain/model/rainfall_regressor_12.pkl` (RandomForestRegressor, 25 features) |
| **Inputs** | IMERG rainfall grids + cyclone best-track (FANI 2019 case study); consolidated tracks for 5 IMD cyclones |
| **Outputs** | Heavy/light rainfall labels at time t (same-time), predicted for the FANI 2019 case-study window |
| **Dataset** | `FANI_2019_IMERG_20190430_0000_0600.csv` (12.6 MB), `consolidated_cyclone_tracks_5_IMD.csv`, `FANI_2019_best_track.csv` |
| **Training Script** | Not found in repo (model appears pre-trained) |
| **Inference Script** | Not found |
| **Model Artifact** | `model/rainfall_classifier_12.pkl` (+ `model/rainfall_regressor_12.pkl` — two-stage) |
| **Results** | `results/model12_results.csv` (7.1 MB) |
| **Status** | **BASELINE ONLY** — verified **same-time classifier** (label at the same timestamp as features; largest lead is a rainfall lag of 60 min). **NOT a future rainfall forecasting model.** Split = temporal holdout (last 4 of 12 half-hourly FANI snapshots), NOT spatial. Feature-engineering code absent → target-derived lag/rolling features (10 of 25) unverifiable |
| **Metrics** | `rain/metadata/rainfall_model_12_metadata.json` metrics (P 0.9197 / R 0.9785 / F1 0.9482, MAE 0.0785) **reproduce from `results/model12_results.csv`** — but only for FANI 2019, same-storm same-day, with autoregressive features crossing the 30-min train/test boundary (optimistic) |
| **Validation** | Temporal holdout (04:00–05:30, 4×28,000 cells) — the earlier "spatial holdout" label was incorrect and is corrected in Phase 10 |
| **Dependencies** | scikit-learn, Pandas, NumPy |

---

## 6. WIND FIELD (BASELINE — CASE STUDY)

| Field | Details |
|-------|---------|
| **Module** | `wind/` |
| **Model** | Keras **ConvLSTM2D encoder–decoder** (`wind_model_best.keras` ~5.2 MB): input (6, 81, 57, 2) U10/V10 grids → output (81, 57, 2) "future_wind" U10/V10 (m/s). Horizon/alignment **undocumented** (no training script) |
| **Inputs** | 6 frames of U10/V10 wind grids (m/s); grid extents undocumented |
| **Outputs** | Wind field grids (U10/V10, m/s) — same-shape as input; "future" framing not verifiable |
| **Dataset** | IBTrACS 4 cyclones (`ibtracs_four_cyclones.csv`); Yaas 2021 case-study images in `results/` |
| **Training Script** | Not found in repo |
| **Inference Script** | Not found |
| **Model Artifact** | `model/wind_model_best.keras`, `wind_model.keras`; preprocessing = `wind_normalization.txt` only (no scaler object) |
| **Runtime note (Wind integration)** | The `.keras` artifact **loads after the TF import-health probe**; real grid-fed inference is implemented and verified via `predict_grids()` in an **isolated subprocess** (on macOS arm64 in-process `model.predict` can deadlock if pandas was imported first — the worker never imports pandas and imports TF before anything else; the subprocess also contains any TF hard-abort). Registered as `wind_vbaseline` and discovered by `PipelineOrchestrator`. **No gridded U10/V10 provider ships in this repo; the standard DAG still returns honest `BASELINE` (no fabricated fields).** |
| **Results** | `results/yaas_predicted_wind.png`, `results/yaas_actual_wind.png`, `results/yaas_wind_error.png` |
| **Status** | **PARTIAL** — case study (Yaas 2021); model load / adapter / registry discovery / grid-fed inference are **VERIFIED**; pipeline wind output not wired (no U10/V10 provider); architecture/training undocumented; horizon undocumented |
| **Metrics** | Visual comparison only (error map); no numeric evaluation |
| **Dependencies** | TensorFlow/Keras |

---

## 7. FLOOD (STATIC SPATIAL CLASSIFICATION — CASE STUDY)

| Field | Details |
|-------|---------|
| **Module** | `flood/` |
| **Model** | XGBoost improved flood-extent classifier (`flood_xgboost_improved.pkl` ~1.3 MB, 28 raw features), integrated from the flood deployment package. **Supersedes** the historical `flood_xgboost_spatial_holdout.pkl`. NOT a forecast, but carries REPRODUCIBLE temporal-validation metrics (see Status/Metrics) |
| **Inputs** | 16 IMERG rainfall features (current + past lags only) + 12 static hydrology features (distance to water/river/lake/reservoir/inundation area, proximity counts). **No terrain/DEM/land-cover/soil features exist in the repo**, despite earlier docs claiming them |
| **Outputs** | Probability grid, risk map (static spatial surface) |
| **Dataset** | FANI 2019 flood event; IMERG rainfall; EMSR357 AOI01 extracted data (Copernicus post-event "Delineation" layer, dated 2019-05-05). **LABEL NOTE:** labels are per-cell constant across all 97 timestamps — the post-event satellite map is propagated back to pre-storm times (whole-event label leak); two inconsistent label schemes exist in-repo (3-cell L1 vs 70-cell L2; results match L2, metrics match neither) |
| **Training Script** | Not found in repo |
| **Inference Script** | `flood/inference.py` (`ToofanFloodModel`) provides susceptibility + rainfall-hazard dynamic-risk inference; demo outputs in `results/` |
| **Model Artifact** | `model/flood_xgboost_improved.pkl`; feature config + metadata in `flood/metadata/flood_feature_config.json`, `flood/metadata/flood_model_metadata.json` |
| **Results** | `results/fani_flood_demo_output.csv` (3.5 MB), `results/fani_flood_risk_map.png`, `results/fani_flood_demo_summary.json`, plus deployment outputs `results/toofan_flood_output.csv`, `results/fani_dynamic_flood_risk.csv`, `results/fani_dynamic_flood_risk_map.png`, `results/fani_dynamic_flood_temporal_summary.csv` |
| **Status** | **BASELINE / CASE STUDY** — FANI 2019; verified reproducible. Spatial-holdout ROC-AUC 0.9649 / PR-AUC 0.8480 and temporal-validation ROC-AUC 0.9946 / PR-AUC 0.9749 (F1 0.9343) are reproducible from `flood/metadata/flood_model_metadata.json` against the in-repo labels (re-checked during Phase 10; temporal split ≈ last 25% timestamps). Historical `flood_xgboost_spatial_holdout.pkl` claim (ROC-AUC 0.9635) is superseded |
| **Metrics** | Reproducible — see `flood/metadata/flood_model_metadata.json` (spatial_holdout + temporal_validation blocks) |
| **Dependencies** | XGBoost, scikit-learn, Pandas, NumPy |

---

## 8. LANDSLIDE / HAZARD MAPS

| Field | Details |
|-------|---------|
| **Module** | `stage17_hazard_maps/` |
| **Model** | Not a trained ML model — generates static hazard maps from rainfall + terrain |
| **Inputs** | Rainfall images (PNG), presumably combined with terrain |
| **Outputs** | PNG hazard maps: `hazard_20190430_0400.png` etc., `rainfall_20190430_0400.png` etc. |
| **Dataset** | FANI 2019 rainfall sequence (30-min intervals) |
| **Status** | **STATIC VISUALIZATION ONLY** — no ML model, no probabilistic output, no inference pipeline |
| **Dependencies** | Image processing (PIL/OpenCV assumed) |

---

## 9. DATASETS SUMMARY

| Dataset | Location | Size | Description |
|---------|----------|------|-------------|
| IBTrACS NI | `wind/ibtracs.NI.list.v04r01.csv` | 27.9 MB | Full North Indian Ocean best-track |
| IBTrACS 4 cyclones | `wind/ibtracs_four_cyclones.csv` | 13.9 KB | Subset for wind model case study |
| IMD Best Track | `cyclone intensity/data/raw/` | — | Primary official records (1982–2026) |
| ERA5 Pressure Levels | `cyclone_backup/ERA5_expanded/*.nc` | ~20 files | Reanalysis for specific storm dates |
| ERA5 RI Features | `cyclone_backup/models/RI_ERA5_features_MVP.csv` | 393 KB | 848 obs / 107 storms |
| IMD RI Training Base | `cyclone_backup/models/IMD_BoB_RI_training_base.csv` | 504 KB | 5,009 obs / 291 storms / 179 RI (BoB, RI prevalence 5.6%) |
| Multimodal RI Dataset | `cyclone_backup/ri_multimodal_dataset.csv` | 989 KB | Canonical joined table |
| Satellite Recovered | `cyclone_backup/satellite_cnn_recovered/images/*.npy` | 26 files | 128×128 IR crops (25 in multimodal table / 23 storms / 8 RI / 17 non-RI); 16/26 source MERG-IR granules in repo |
| TCIR Global | `cyclone_backup/models/tcir/` | — | **Model artifact + normalisation stats only; dataset ABSENT** — "2,840 obs / 64 storms / 189 RI" is UNVERIFIED / HISTORICAL CLAIM |
| IMERG Rainfall | `rain/data/FANI_2019_IMERG_*.csv` | 12.6 MB | FANI case study |
| Flood Training Grid | `flood/data/fani_flood_training_grid.csv` | 174 KB | FANI flood features |
| CMEMS Ocean | `cyclone_backup/models/cmems_*.nc` | ~47 MB total | Ocean heat content / TCHP |
| Dashboard Dataset | `stage20_dashboard_ready_dataset.csv` | 15.9 MB | Pre-computed for dashboard |

---

## 10. TRAINED MODEL ARTIFACTS SUMMARY

| Model | Path | Format | Status |
|-------|------|--------|--------|
| Track V12 (distilled) | `best_cyclone_model_lt3p_distilled.pth` (repo root, + `scalers.pkl`) | PyTorch | **LIMITED/UNVERIFIED** (real inference; uncertainty NOT calibrated) |
| RI IMD | `cyclone_backup/models/imd_final_xgboost.json` | XGBoost JSON | AVAILABLE |
| RI ERA5 | `cyclone_backup/models/era5_final_xgboost.json` | XGBoost JSON | UNAVAILABLE (features not wired) |
| RI IMD+ERA5 | `cyclone_backup/models/imd_era5_final_xgboost.json` | XGBoost JSON | Validated HISTORICALLY (degraded skill vs IMD-only) |
| RI Satellite CNN | `cyclone_backup/models/satellite_cnn.pt` | PyTorch | Real fitted state dict (308,705 params) that loads — **inference NOT runnable in-repo** (fold-0 scaler absent; storage `[0,1]`↔Kelvin mismatch); OOF PR-AUC 0.516 is UNVERIFIED / HISTORICAL CLAIM |
| RI TCIR CNN | `cyclone_backup/models/tcir/` | Keras/NPZ | **Artifact only** — OOF (PR-AUC 0.092) is UNVERIFIED / HISTORICAL CLAIM — no dataset/results in repo; channel-4 norm stats inf/nan; cannot run in current env |
| Intensity XGBoost | `cyclone intensity/models/final_xgb_regressor.joblib` | joblib | **ABSENT** — retrain via `cyclone intensity/retrain.py` |
| Recurvature XGBoost | `recurvature/xgb_recurve_model.json` | XGBoost JSON | Trained (baseline) |
| Rainfall RF | `rain/model/rainfall_classifier_12.pkl` (+ regressor `rain/model/rainfall_regressor_12.pkl`) | pickle | Baseline (same-time two-stage model) |
| Flood XGBoost | `flood/model/flood_xgboost_improved.pkl` | pickle | Case study (FANI; improved, reproduceable temporal metrics) |
| Wind Keras | `wind/model/wind_model_best.keras` | Keras | Case study (Yaas) |

---

## 11. WHAT CAN BE DIRECTLY REUSED

| Component | Reuse Strategy |
|-----------|----------------|
| `CycloneTransformerV11` (Track) | Wrap as `TrajectoryModelAdapter` → `TrackPrediction` schema |
| RI IMD/ERA5 XGBoost models | Wrap as `RIModelAdapter` (IMD branch + ERA5 branch + fusion) → `RIPrediction` schema *(IMD only at runtime; ERA5/fusion designed)* |
| RI Satellite CNN (`RICNNFusion`) | Wrap as `RISatelliteBranchAdapter` → satellite probability for fusion *(designed — artifact present but inference not runnable in-repo)* |
| Intensity XGBoost | Wrap as `IntensityModelAdapter` → `IntensityPrediction` schema |
| Recurvature XGBoost | Wrap as `RecurvatureModelAdapter` → `RecurvaturePrediction` schema |
| Storm-wise splitting logic | Extract to `src/core/splitting.py` — shared across all models |
| Leakage prevention utilities | `cyclone_backup/src/leakage.py` → `src/core/leakage.py` |
| SHAP explainability | `cyclone_backup/src/explain.py` → `src/core/explainability.py` |
| Grad-CAM for CNN | `cyclone_backup/src/satellite_cnn.py` → shared explainability |
| Feature engineering (ERA5 derived, temporal deltas) | `cyclone_backup/src/features.py` → `src/core/features.py` |

---

## 12. WHAT REQUIRES ADAPTERS

| Existing Component | Required Adapter |
|--------------------|------------------|
| Track model (`v12_predict_new.py`) | `TrajectoryModelAdapter`: input `CycloneState` → output `TrackPrediction` |
| RI multimodal pipeline (`run_pipeline.py`) | `RIPipelineAdapter`: orchestrates 3 branches + fusion → `RIPrediction` |
| Intensity model (`main.py`) | `IntensityModelAdapter`: input `CycloneState` + ERA5 → `IntensityPrediction` |
| Recurvature model (`src/train.py`) | `RecurvatureModelAdapter`: input track history + env → `RecurvaturePrediction` |
| Rainfall RF | `RainfallModelAdapter`: needs redesign for future horizons (currently same-time) |
| Wind Keras | `WindModelAdapter`: needs input spec clarification |
| Flood XGBoost | `FloodModelAdapter`: needs to consume `RainfallPrediction` + `WindFieldPrediction` |
| Hazard maps | Replace with `HazardRiskEngine` consuming all model outputs |

---

## 13. WHAT IS MISSING (GAPS)

| Capability | Status | Notes |
|------------|--------|-------|
| **Genesis Prediction** | ✅ **IMPLEMENTED** | LightGBM production + LightGBM/XGBoost/RF ensemble; see Section 16 |
| **Future Rainfall (3h/6h/12h/24h)** | ❌ Not implemented | Current RF is same-time classifier on FANI only |
| **Future Wind Field (U/V grids)** | 🔶 Partially implemented (grid-fed) | `predict_grids()` real inference verified; no production U10/V10 provider in repo; horizon undocumented |
| **Flood from Forecast Rainfall** | ❌ Not implemented | Current uses observed rainfall, not predicted |
| **Landslide from Forecast Rainfall** | ❌ Not implemented | Current is static visualization |
| **Unified Hazard Engine** | ❌ Not implemented | No integration layer |
| **Common CycloneState Schema** | ❌ Not implemented | Each module uses different input formats |
| **Data Ingestion Layer** | ❌ Not implemented | Ad-hoc loading in each module |
| **Data Harmonization** | ❌ Not implemented | No temporal/spatial alignment across sources |
| **Model Registry** | ❌ Not implemented | Models loaded from hardcoded paths |
| **Pipeline Orchestrator** | ❌ Not implemented | No dependency-aware execution |
| **CLI for Full Pipeline** | ❌ Not implemented | Only per-module scripts exist |
| **Configuration System** | ❌ Partial | Only `cyclone_backup/config.yaml` and intensity `requirements.txt` |
| **Uncertainty Quantification** | Partial | Track exports `sigma_km` but the head is **saturated ~209.9 km — NOT calibrated, NOT horizon-growing**; RI `calibrated_probability` is an **alias for `imd_probability` (no applied calibration)**; Recurvature confidence fixed at 0.55; Genesis `calibrated=False`, `calibrated_probability=None`; Intensity has none |
| **Explainability Layer** | Partial | RI has SHAP/Grad-CAM; not unified |
| **Storm-wise Test Set Protection** | Partial | RI and Intensity enforce; others unclear |
| **Leakage Audit** | Partial | RI has `LEAKAGE_AUDIT.md`; not systemic |

---

## 14. PROPOSED FINAL DIRECTORY STRUCTURE

```
toofan/
├── configs/
│   ├── data.yaml
│   ├── genesis.yaml
│   ├── trajectory.yaml
│   ├── rainfall.yaml
│   ├── wind.yaml
│   ├── flood.yaml
│   ├── ri.yaml
│   ├── intensity.yaml
│   ├── recurvature.yaml
│   ├── landslide.yaml
│   └── pipeline.yaml
├── docs/
│   ├── architecture.md
│   ├── model_inventory.md
│   ├── data_pipeline.md
│   ├── training_pipeline.md
│   ├── inference_pipeline.md
│   ├── leakage_prevention.md
│   ├── evaluation.md
│   ├── model_registry.md
│   ├── api_contract.md
│   ├── deployment.md
│   └── architecture_master.mmd
├── src/
│   ├── core/
│   │   ├── __init__.py
│   │   ├── schema.py              # CycloneState, prediction schemas (Pydantic)
│   │   ├── ingestion.py           # DataIngestionLayer
│   │   ├── harmonizer.py          # DataHarmonizer
│   │   ├── splitting.py           # Storm-wise splitters
│   │   ├── leakage.py             # Leakage prevention utilities
│   │   ├── features.py            # Shared feature engineering
│   │   ├── registry.py            # ModelRegistry
│   │   ├── explainability.py      # SHAP, Grad-CAM wrappers
│   │   └── uncertainty.py         # Uncertainty quantification
│   ├── models/
│   │   ├── __init__.py
│   │   ├── base.py                # BaseModel interface
│   │   ├── genesis/
│   │   │   ├── __init__.py
│   │   │   ├── model.py
│   │   │   ├── train.py
│   │   │   ├── evaluate.py
│   │   │   ├── predict.py
│   │   │   └── adapter.py         # (future)
│   │   ├── trajectory/
│   │   │   ├── __init__.py
│   │   │   ├── model.py           # (imports CycloneTransformerV11)
│   │   │   ├── adapter.py         # TrajectoryModelAdapter
│   │   │   ├── train.py
│   │   │   ├── evaluate.py
│   │   │   └── predict.py
│   │   ├── rainfall/
│   │   │   ├── __init__.py
│   │   │   ├── model.py           # CNN + ConvLSTM
│   │   │   ├── adapter.py         # (baseline RF adapter)
│   │   │   ├── train.py
│   │   │   ├── evaluate.py
│   │   │   └── predict.py
│   │   ├── wind/
│   │   │   ├── __init__.py
│   │   │   ├── model.py           # CNN + ConvLSTM + U-Net
│   │   │   ├── adapter.py         # (baseline Keras adapter)
│   │   │   ├── train.py
│   │   │   ├── evaluate.py
│   │   │   └── predict.py
│   │   ├── flood/
│   │   │   ├── __init__.py
│   │   │   ├── model.py           # XGBoost on harmonized grids
│   │   │   ├── adapter.py         # FloodModelAdapter
│   │   │   ├── train.py
│   │   │   ├── evaluate.py
│   │   │   └── predict.py
│   │   ├── ri/
│   │   │   ├── __init__.py
│   │   │   ├── imd_branch.py
│   │   │   ├── era5_branch.py
│   │   │   ├── satellite_branch.py
│   │   │   ├── fusion.py
│   │   │   ├── adapter.py         # RIPipelineAdapter
│   │   │   ├── train.py
│   │   │   ├── evaluate.py
│   │   │   └── predict.py
│   │   ├── intensity/
│   │   │   ├── __init__.py
│   │   │   ├── model.py           # (imports XGBoost from cyclone_intensity)
│   │   │   ├── adapter.py         # IntensityModelAdapter
│   │   │   ├── train.py
│   │   │   ├── evaluate.py
│   │   │   └── predict.py
│   │   ├── recurvature/
│   │   │   ├── __init__.py
│   │   │   ├── model.py           # (imports from recurvature)
│   │   │   ├── adapter.py         # RecurvatureModelAdapter
│   │   │   ├── train.py
│   │   │   ├── evaluate.py
│   │   │   └── predict.py
│   │   └── landslide/
│   │       ├── __init__.py
│   │       ├── model.py
│   │       ├── adapter.py
│   │       ├── train.py
│   │       ├── evaluate.py
│   │       └── predict.py
│   ├── pipeline/
│   │   ├── __init__.py
│   │   ├── orchestrator.py        # Dependency-aware execution
│   │   ├── state.py               # CycloneState builder
│   │   └── hazard_engine.py       # Unified HazardRiskEngine
│   └── cli/
│       ├── __init__.py
│       └── main.py                # `python -m pipeline.run ...`
├── models/
│   └── registry/                  # ModelRegistry storage
├── data/
│   ├── raw/                       # Original downloads (gitignored)
│   ├── processed/                 # Harmonized, aligned datasets
│   └── external/                  # References to external sources
├── outputs/
│   └── {STORM_ID}/{TIMESTAMP}/    # Structured pipeline outputs
├── logs/
│   └── runs/
├── tests/
│   ├── test_schema.py
│   ├── test_leakage.py
│   ├── test_splitting.py
│   ├── test_harmonizer.py
│   ├── test_orchestrator.py
│   └── test_adapters.py
├── requirements.txt
├── pyproject.toml
└── README.md
```

---

## 15. NATIVE RUNTIME CONFIGURATION (REMEDIATION)

### 15.1 OpenMP Conflict Mitigation

**Problem:** PyTorch 2.13.0 and XGBoost 3.4.1 both embed/link against separate OpenMP runtimes (libomp.dylib) on macOS arm64. When both libraries initialize their OpenMP thread pools in the same process, a native segmentation fault occurs during XGBoost model loading.

**Root Cause:** OpenMP worker thread creation conflict (`__kmp_create_worker` → `__kmp_fork_call`)

**Solution:** Set `OMP_NUM_THREADS=1` at process startup before any ML framework imports.

### 15.2 Implementation

| Component | Change |
|-----------|--------|
| `src/core/runtime.py` | New module with `configure_runtime()` function |
| `src/cli/main.py` | Calls `configure_runtime()` at module top |
| `tests/integration/test_native_model_compatibility.py` | Sets `OMP_NUM_THREADS=1` before imports |

### 15.3 Usage

```python
# At the very top of any TOOFAN entry point:
from src.core.runtime import configure_runtime
configure_runtime()  # Sets OMP_NUM_THREADS=1

# Now safe to import ML frameworks
import torch
import xgboost
```

### 15.4 Verification

- 10/10 consecutive test runs stable
- Both load orders work: Trajectory→Recurvature and Recurvature→Trajectory
- All three models (Trajectory, Recurvature, RI) coexist
- Recurvature `predict_proba()` works correctly

---

## 16. GENESIS PREDICTION (P(genesis | disturbance) WITHIN 24h)

| Field | Details |
|-------|---------|
| **Module** | `src/models/genesis/adapter.py` (`GenesisModelAdapter`) |
| **Target** | `genesis_24h` — binary probability that a disturbance develops into a cyclone within 24h |
| **Production Model** | **LightGBM** (`LGBMClassifier`, gbdt, lr 0.02, 200 trees, max_depth 5, 23 leaves), wrapped in `Pipeline[SimpleImputer(median), LGBMClassifier]` |
| **Secondary / Ensemble** | Soft-voting on class-1 probabilities: **LightGBM 0.40 / XGBoost 0.35 / RandomForest 0.25** (requires all 3 artifacts present) |
| **Approved Models (STRICT)** | LightGBM (production), XGBoost, RandomForest — **only**. CatBoost and ExtraTrees artifacts exist but are **explicitly prohibited** and rejected by the component guard. |
| **Inputs (34 features, order-sensitive)** | `tchp_kj_cm2_x, ohc700_kj_cm2_x, u850..z850, u700..z700, u500..z500, u200..z200, sst, sst_anomaly, tchp_kj_cm2_y, ohc700_kj_cm2_y` (w/q/z per level not in schema → NaN → median-imputed) |
| **Preprocessing** | Embedded in each pipeline (`SimpleImputer`, median). Adapter never double-imputes/transforms. |
| **Outputs** | `GenesisPrediction`: `probability_24h` + `@computed_field probability`, `risk_level`, `confidence`, `model_version`, `mode`, `model_name`, `threshold`, `predicted_class`, `raw_probability`, `calibrated_probability` (None), `provenance`, `artifact_hash/path`, `feature_schema`, ensemble component fields, `candidate_lat/lon`, `explanation` |
| **Threshold** | **0.24** (configurable, `DEFAULT_GENESIS_THRESHOLD`; not re-optimized at inference) |
| **Calibration** | No calibration artifact exists → raw weighted probabilities retained, `calibrated=False`, `calibrated_probability=None` |
| **Dataset** | 300 samples (150 genesis / 150 non-genesis, class-balanced) / 191 NIO storms / 2015–2024 — **per the external source report only**; the training data, training script, and CV/test metrics are **NOT in this repository** (historical claim, not reproducible from the current repo) |
| **Status** | **PROTOTYPE** — features (SST/SST-anomaly/TCHP/OHC700) are synthetic; storm-aware CV metrics < held-out test metrics; **not** production-validated |
| **Model Registry** | Registered in `ModelFactory` as `genesis`, `genesis_lightgbm` (production), `genesis_soft_voting_ensemble`; `ModelAdapter` alias enabled |
| **Failure Mode (honest)** | Missing any required artifact → `UNAVAILABLE` for that mode; no model substitution → `RuntimeError` if unavailable mode requested |
| **Fidelity** | Adapter predictions == direct pipeline predictions for all 3 models (tolerance 1e-12) |
| **Details** | See `docs/model_audit/genesis_integration.md` |

---

## 18. PROPOSED DEPENDENCY GRAPH

```
                    ┌─────────────────┐
                    │ DATA SOURCES    │
                    │ (IMD, IBTrACS,  │
                    │  ERA5, Satellite,│
                    │  IMERG, DEM,    │
                    │  Ocean, CMEMS)  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ DATA INGESTION  │
                    │ (per-source     │
                    │  loaders)       │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ QUALITY CONTROL │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ TEMPORAL +      │
                    │ SPATIAL ALIGN   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ CYCLONE STATE   │
                    │ BUILDER         │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌────────────┐ ┌───────────┐ ┌────────────┐
       │  GENESIS   │ │ TRAJECTORY│ │    RI      │
       │  (24/48/72h)│ │ (Track)   │ │ (Multimodal)│
       └─────┬──────┘ └─────┬─────┘ └─────┬──────┘
             │              │             │
             │              ▼             │
             │       ┌────────────┐       │
             │       │ INTENSITY  │       │
             │       └─────┬──────┘       │
             │             │              │
             ▼             ▼              ▼
       ┌────────────┐ ┌───────────┐
       │  RAINFALL  │ │   WIND    │
       │ (3/6/12/24h)│ │  FIELD    │
       └─────┬──────┘ └─────┬─────┘
             │              │
             └──────┬───────┘
                    ▼
            ┌──────────────┐
            │    FLOOD     │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │  LANDSLIDE   │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │ RECURVATURE  │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │ HAZARD ENGINE│
            └──────┬───────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   UNCERTAINTY  EXPLAINABILITY  OUTPUTS
```

**Key Dependency Rules:**
- Track and Intensity can run in parallel after CycloneState
- Rainfall depends on Track (+ optionally Intensity)
- Wind depends on Track + Intensity
- Flood depends on Rainfall + Wind
- Landslide depends on Rainfall
- RI runs directly from CycloneState + ERA5 + Satellite (independent)
- Recurvature runs from Track history + environmental features
- Hazard Engine consumes ALL model outputs

---

## 17. IMPLEMENTATION PLAN (PHASE 1)

### Phase 1: Foundation (Week 1-2)
- [ ] `src/core/schema.py` — Pydantic models for `CycloneState`, all `*Prediction` outputs
- [ ] `src/core/ingestion.py` — DataIngestionLayer with source-specific loaders
- [ ] `src/core/harmonizer.py` — DataHarmonizer (temporal/spatial alignment, cyclone-centered extraction)
- [ ] `src/core/splitting.py` — Storm-wise splitters (GroupKFold, StratifiedGroupKFold)
- [ ] `src/core/leakage.py` — Leakage prevention (future-feature audit, temporal checks)
- [ ] `src/core/registry.py` — ModelRegistry (JSON + file-based)
- [ ] `configs/*.yaml` — Configuration for all modules
- [ ] `src/models/base.py` — BaseModel interface (load, validate_input, predict, predict_with_uncertainty, explain, metadata)
- [ ] `src/pipeline/state.py` — CycloneStateBuilder
- [ ] `src/pipeline/orchestrator.py` — Dependency-aware DAG executor
- [ ] `src/cli/main.py` — CLI entry point (`python -m pipeline.run ...`)
- [ ] Unit tests: schema validation, timestamp alignment, leakage detection, storm-wise splitting

### Phase 2: Integrate Existing Models (Week 3-4)
- [ ] `TrajectoryModelAdapter` wrapping `CycloneTransformerV11`
- [ ] `RIPipelineAdapter` wrapping IMD/ERA5/CNN branches + fusion
- [ ] `IntensityModelAdapter` wrapping cyclone_intensity XGBoost
- [ ] `RecurvatureModelAdapter` wrapping recurvature XGBoost
- [ ] Genesis model: implement LightGBM/XGBoost baseline (new)
- [ ] Test adapters with real checkpoint loading

### Phase 3: Spatial Hazard Models (Week 5-6)
- [ ] Rainfall model: CNN + ConvLSTM architecture (new)
- [ ] Wind model: CNN + ConvLSTM + U-Net (new)
- [ ] Flood model: XGBoost consuming Rainfall + Wind predictions
- [ ] Landslide model: XGBoost consuming Rainfall + Terrain + Soil
- [ ] Integrate with harmonized grid system

### Phase 4: Unified Hazard Engine (Week 7)
- [ ] `HazardRiskEngine` combining all predictions
- [ ] Uncertainty propagation
- [ ] Explainability aggregation (SHAP + Grad-CAM)
- [ ] Output serialization (NetCDF/GeoTIFF/JSON)

### Phase 5: Dashboard / API (Week 8)
- [ ] API server consuming `UnifiedForecastState`
- [ ] Dashboard updates for new schema
- [ ] Alert generation

---

## 19. PHASE 2 INTEGRATION STATUS (COMPLETED)

### 19.1 Adapter Implementation Status

| Module | Adapter Location | Status | Model Artifact | Framework | Notes |
|--------|-----------------|--------|----------------|-----------|-------|
| **Genesis** | `src/models/genesis/adapter.py` | ✅ IMPLEMENTED (**AVAILABLE**) | `genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib` (+ XGBoost, RF for ensemble) | LightGBM / XGBoost / sklearn RF | P(genesis); LightGBM production + soft-voting ensemble; see Section 16 |
| **Trajectory** | `src/models/adapters/trajectory_adapter.py` | ✅ IMPLEMENTED | `best_cyclone_model_lt3p_distilled.pth` (repo root) | PyTorch | V12-distilled Transformer; real inference — **LIMITED/UNVERIFIED** (uncertainty saturated ~209.9 km, NOT calibrated) |
| **Intensity** | `src/models/adapters/intensity_adapter.py` | ✅ IMPLEMENTED | `cyclone intensity/models/final_xgb_regressor.joblib` | XGBoost | Requires training (artifact not yet generated) |
| **RI** | `src/models/adapters/ri_adapter.py` | ✅ IMPLEMENTED (**IMD-only at runtime**) | `cyclone_backup/models/imd_final_xgboost.json` | XGBoost | Single-source (IMD) at runtime. ERA5/satellite/fusion branches are **designed, NOT wired** (artifacts exist but fail or are absent in-repo); `satellite_probability`/`fusion_probability` = None. See Phase 9 audit |
| **Recurvature** | `src/models/adapters/recurvature_adapter.py` | ✅ IMPLEMENTED | `recurvature/xgb_recurve_model.json` | XGBoost | **FIXED**: Now uses XGBClassifier (not Booster) for predict_proba |
| **Rainfall** | `src/models/rainfall/adapter.py` | ✅ IMPLEMENTED (BASELINE) | `rain/model/rainfall_classifier_12.pkl` (+ `rain/model/rainfall_regressor_12.pkl`) | sklearn (RF) | Same-time two-stage classifier+regressor, not forecast |
| **Wind** | `src/models/wind/adapter.py` | ✅ IMPLEMENTED (grid-fed inference VERIFIED) | `wind/model/wind_model_best.keras` | TensorFlow/Keras | Yaas case study; no U10/V10 provider in repo |
| **Flood** | `src/models/flood/adapter.py` | ✅ IMPLEMENTED (BASELINE) | `flood/model/flood_xgboost_improved.pkl` | XGBoost | FANI 2019 case study (improved; temporal metrics reproducible) |
| **Landslide** | `src/models/landslide/adapter.py` | ✅ IMPLEMENTED (STATIC) | None | — | Static hazard maps only |

### 19.2 Native Runtime Fix

- **Issue 1**: PyTorch + XGBoost OpenMP conflict causing SIGSEGV on macOS arm64
- **Fix 1**: Centralized runtime configuration in `src/core/runtime.py` sets `OMP_NUM_THREADS=1` before ML imports
- **Issue 2**: Adding LightGBM introduced a **three-way** OpenMP conflict (PyTorch + XGBoost + LightGBM all bundling separate libomp) → SIGSEGV during LightGBM `__inner_predict_np2d`
- **Fix 2**: `configure_runtime()` now pre-loads a single canonical ``libomp`` (from Homebrew) via `ctypes` before any ML framework, so all frameworks share one OpenMP runtime. Non-functional runtime safeguard — does not alter any model weights.
- **Entry Point**: `src/cli/main.py` calls `configure_runtime()` at module top; `tests/conftest.py` runs it at pytest session start
- **Test Coverage**: `tests/integration/test_native_model_compatibility.py` - 8 tests, both load orders verified

### 19.3 Recurvature Adapter Bug Fix

- **Issue**: Used `xgb.Booster()` which lacks `predict_proba()` method
- **Fix**: Changed to `xgb.XGBClassifier()` matching training semantics
- **Verification**: `test_recurvature_predict_proba_works` passes

### 19.4 Test Suite Status

- **All Tests**: 169/169 PASS
- **Native Compatibility**: 8/8 PASS (10/10 consecutive runs stable)
- **Genesis**: 46/46 PASS (incl. fidelity, CatBoost/ExtraTrees rejection, missing-artifact honesty, `_y` non-duplication, uncalibrated ensemble)
- **Orchestrator**: 9/9 PASS
- **Adapters**: 11/11 PASS
- **Harmonizer**: 21/21 PASS (fixed pandas frequency string case sensitivity)
- **Leakage**: 16/16 PASS
- **Schema**: 20/20 PASS
- **Splitting**: 12/12 PASS

### 19.5 Model Availability Classification

| Model | Classification | Reason |
|-------|---------------|--------|
| Trajectory | **LIMITED / UNVERIFIED** | Real point-forecast inference via `best_cyclone_model_lt3p_distilled.pth`; **uncertainty head saturated (~209.9 km), NOT calibrated, NOT horizon-growing**; point-forecast skill not re-verified in-repo |
| RI | **LIMITED (IMD-ONLY)** | IMD branch deployable; ERA5 features not wired, Satellite CNN artifact exists but inference NOT runnable in-repo (fold-0 scaler absent; `[0,1]`↔Kelvin mismatch; OOF claims = HISTORICAL CLAIMs), **no fusion meta-model exists** |
| Recurvature | **AVAILABLE** | Fixed XGBClassifier adapter |
| Intensity | **ARTIFACT_MISSING** | Training script exists but artifact not generated |
| Rainfall | **AVAILABLE_BASELINE** | Same-time classifier, not forecast |
| Wind | **BASELINE** | Case study (Yaas); grid-fed `predict_grids` inference verified; no production U10/V10 provider |
| Flood | **BASELINE** | Single event (FANI), spatial holdout only |
| Landslide | **STATIC_SUSCEPTIBILITY** | No ML model, only static PNG maps |
| Genesis | **AVAILABLE** | LightGBM production + 3-model soft-voting ensemble (see Section 16) |

---

## 20. CRITICAL ARCHITECTURAL DECISIONS

1. **No Giant Neural Network** — Each model independently trained, versioned, replaceable
2. **CycloneState as Canonical Contract** — All modules consume validated `CycloneState`, produce validated predictions
3. **Storm-wise Splitting Mandatory** — No random row splits; enforced in `src/core/splitting.py`
4. **Leakage Prevention First** — Every feature audited for future-data usage; `leakage.py` provides validators
5. **Missing Modality Handling** — Pipeline degrades gracefully; missing satellite → RI uses IMD+ERA5 only with flag
6. **Uncertainty Required** — Every model must expose confidence/uncertainty (even if approximate)
7. **Explainability Standardized** — SHAP for trees, Grad-CAM for CNNs, attention for Transformers
8. **Model Registry** — Every production prediction tagged with exact model version, config, git commit
9. **Configuration-Driven** — No hardcoded paths; all via `configs/*.yaml`
10. **Output Formats** — Grids as NetCDF/GeoTIFF/Zarr; scalars as JSON; metadata alongside
