# TOOFAN Model Registry

This inventory reflects the current repository, `models/registry/registry_index.json`, `models/registry/registry_contracts.json`, `configs/pipeline.yaml`, and adapter behavior. "Verified model" means an artifact exists and has been checked. "Verified inference" means the adapter can execute against its expected input contract. "Verified end-to-end pipeline" means real providers can supply the required production inputs through the DAG.

| Module | Canonical Artifact | Model Type | Adapter | Input Contract | Output Contract | Model Status | Pipeline Status | Dependencies |
|---|---|---|---|---|---|---|---|---|
| genesis | `genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib` with XGBoost/RF support and imputer | LightGBM/sklearn ensemble | `src/models/genesis/adapter.py` | 34 environmental/ocean/pressure-level features from `CycloneState` | `GenesisPrediction` probabilities, class, risk, confidence | VERIFIED MODEL | DEGRADED: provenance and external validation incomplete | none |
| trajectory | `best_cyclone_model_lt3p_distilled.pth`, `scalers.pkl`; deployment fallback to `cyclone_path_deployment_package_v7b/` | PyTorch transformer deployment package | `src/models/adapters/trajectory_adapter.py` | 12-step track/environment history | `TrackPrediction` at +2h to +24h | VERIFIED MODEL | DEGRADED: real point inference, uncertainty uncalibrated | genesis |
| intensity | `cyclone intensity/models/final_xgb_regressor.joblib` | XGBoost/sklearn regressor | `src/models/adapters/intensity_adapter.py` | 30 cyclone dynamics + ERA5 features | `IntensityPrediction` | NOT_AVAILABLE | NOT_AVAILABLE: artifact absent | genesis |
| ri | `RI/models/imd_ri_model.json`; fusion artifact also registered as `ri_fusion` | XGBoost IMD branch / XGBoost IMD+ERA5 fusion | `src/models/ri/adapter.py`, `src/models/adapters/ri_adapter.py` | IMD wind/pressure/history features; fusion uses 89 ERA5 features plus IMD features | `RIPrediction` | VERIFIED MODEL for IMD and fusion artifacts | DEGRADED: provider/runtime feature availability remains conditional | genesis |
| recurvature | `recurvature/xgb_recurve_model.json`, `recurvature/scaler.joblib` | XGBoost classifier | `src/models/adapters/recurvature_adapter.py` | Track heading/curvature features and history | `RecurvaturePrediction` | VERIFIED MODEL | DEGRADED: needs valid trajectory/history inputs | trajectory |
| rainfall | `rain/model/rainfall_classifier_12.pkl`, `rain/model/rainfall_regressor_12.pkl` | RandomForest classifier/regressor baseline | `src/models/rainfall/adapter.py` | FANI/IMERG same-time rainfall features plus upstream storm context | `RainfallPrediction` grids/status | VERIFIED MODEL | BASELINE: same-time case-study, not future rainfall forecast | trajectory, intensity |
| wind | `wind/model/wind_model_best.keras`, normalization in `wind/metadata/wind_normalization.txt` | Keras ConvLSTM2D encoder-decoder | `src/models/wind/adapter.py` | `(None, 6, 81, 57, 2)` U10/V10 grid sequence | `WindFieldPrediction` with wind fields | VERIFIED MODEL | NOT_AVAILABLE for real-world pipeline: no production U10/V10 provider; VERIFIED INFERENCE for grid-fed `predict_grids()` | trajectory, intensity |
| flood | `flood/model/flood_xgboost_improved.pkl`, feature config and metadata under `flood/metadata/` | XGBoost flood-extent classifier | `src/models/flood/adapter.py`, `flood/inference.py` | Rainfall grids plus wind/static hydrology features | `FloodPrediction` probability/risk grids | VERIFIED MODEL | DEGRADED/BASELINE: FANI case-study, terrain/provider gaps | rainfall, wind |
| landslide | none | Static susceptibility/rule output | `src/models/landslide/adapter.py` | Rainfall plus terrain/susceptibility context | `LandslidePrediction` | BASELINE, no ML artifact | BASELINE/NOT_AVAILABLE depending usable rainfall/terrain | rainfall |
| hazard_engine | no model artifact | Rule/weight aggregation | `src/pipeline/hazard_engine.py` | Usable outputs from hazard modules | `UnifiedForecastState` hazard summary | VERIFIED CODE | VERIFIED aggregation with empty/degraded handling | all modules |

## Wind Distinction

Wind has three separate statuses:

| Layer | Status |
|---|---|
| Model artifact | VERIFIED |
| Grid-fed inference through `predict_grids()` | VERIFIED |
| Real-world provider-backed pipeline | NOT_AVAILABLE, because no legitimate six-frame 81x57 U10/V10 provider ships in this repository |

The repository must not fabricate U10/V10 grids. `src/providers/gridded_wind.py` exists only to make the missing provider explicit.
