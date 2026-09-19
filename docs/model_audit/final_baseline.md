# TOOFAN — Final Baseline Freeze and Improvement Readiness Audit

**Phase 12 · 2026-09-12 · branch `main` · HEAD `c6a8db9` (Phases 0–11 applied, uncommitted)**

> This is the authoritative pre-improvement snapshot of the TOOFAN repository.
> Every future ML/model change is to be measured against this document and
> against the numbers frozen here. Nothing below was retrained, tuned, or
> re-derived beyond reproduction of values that were already in the repo.

---

## 1. Executive summary

TOOFAN is a North-Indian-Ocean tropical cyclone analysis and forecasting suite
with 9 scientific branches, a pipeline orchestrator, a hazard engine, an API
layer, and a React dashboard.

At Phase 12 the repository is **test-clean (206/206)**, the frontend builds and
typechecks, and the audited scientific statuses now survive from the adapters
through the orchestrator to serialized output and the UI (Phases 10–11). The
repository is **ready to begin scientifically controlled ML improvement work**.
It is **NOT production-ready**: of 9 branches, only a small number run with real
artifacts today (genesis, trajectory, RI-IMD, recurvature); none is fully
scientifically validated; several branches have no reproducible training data or
artifact at all.

### Headline statuses (runtime, verified 2026-09-12)

| Branch | Runtime status (real adapter, real state) |
|---|---|
| Genesis | Prediction produced (real LightGBM pipeline) — prototype, inputs highly imputed |
| Trajectory | `LIMITED/UNVERIFIED` — real point forecasts; uncertainty saturated ~209.9 km |
| Intensity | `UNAVAILABLE` — no trained artifact or dataset in repo |
| RI | `AVAILABLE` IMD-only — real XGB branch; confidence fixed heuristic 0.55 |
| Recurvature | FAILED on minimal state (real model refuses incomplete input); real prediction when track history supplied |
| Rainfall | `AVAILABLE_BASELINE` — same-time classifier, not a forecast |
| Wind | `BASELINE` in standard DAG; grid-fed **real inference verified** via `predict_grids` (isolated subprocess; no U10/V10 provider in repo) |
| Flood | `DATA_UNAVAILABLE` — static spatial classifier needs grids/hydro preprocessing |
| Landslide | `STATIC_SUSCEPTIBILITY` — no ML artifact |
| Hazard engine | SUCCESS — returns honest `None` severity when nothing assessed |

---

## 2. Current architecture

```
  Data sources (IMD best-track, IBTrACS, ERA5, MERG-IR, IMERG, EMSR357, CMEMS)
        ↓
  DataIngestionLayer  →  Harmonizer  →  CycloneStateBuilder
        ↓
  PipelineOrchestrator (DAG on 10 modules)
        ↓
  Genesis · Trajectory · Intensity · RI · Recurvature
        ↓
  Rainfall · Wind · Flood · Landslide
        ↓
  HazardEngine (multi-hazard aggregation)
        ↓
  UnifiedForecastState  →  API (JSON)  →  React dashboard
```

- Python 3.13 (macOS arm64), pydantic v2 schema layer, PyTorch + XGBoost +
  LightGBM + scikit-learn + TensorFlow (broken) runtimes.
- `src/core/runtime.py::configure_runtime()` MUST run before any ML import:
  sets `OMP_NUM_THREADS=1` and pre-loads a single canonical `libomp` so PyTorch,
  XGBoost and LightGBM share one OpenMP runtime (avoids the native SIGSEGV/SIGABRT).
- Adapters live in `src/models/` (genesis, rainfall, wind, flood, landslide,
  adapters/* for trajectory/ri/intensity/recurvature).
- Frontend consumes API JSON through `frontend/src/services/toofanService.ts`;
  `dataMode` seam (`demo`/`live`) separates the frontend mock dataset
  (`frontend/src/data/mock/MOCK.ts`) from real API responses — mock data never
  enters backend inference.
- Config in `configs/pipeline.yaml`; model registry `models/registry/`.

---

## 3. Model status matrix (final, Phase 0–11 evidence only)

Legend: ✅ verified/present · ◐ partial · 🔶 recorded-but-not-reproduced · ❌ absent/broken.

| Branch | Scientific task | Data | Artifact | Evaluation | Inference | Status | Main limitation |
|---|---|---|---|---|---|---|---|
| **Genesis** | P(cyclone genesis within 24h), binary | 🔶 300 samples (150/150), 191 NIO storms, 2015–2024 — external claim; data/training-script/metrics NOT in repo | ✅ LightGBM (production) + XGB/RF ensemble (3 joblib artifacts, tracked, load) | 🔶 CV/test metrics not in repo — not reproduced | ✅ runs, produces probability (threshold 0.24; confidence = margin heuristic, uncalibrated) | **PROTOTYPE** (loads+runs) | Synthetic/imputed SST, SST-anomaly, TCHP, OHC700; scientific validation unreproducible; runtime relies heavily on placeholder environmental inputs |
| **Trajectory** | 24h forecast positions (+2…+24h, 12 horizons) | ✅ IBTrACS NIO (`wind/ibtracs.NI.list.v04r01.csv`, 62,850 rows, tracked) | ✅ `best_cyclone_model_lt3p_distilled.pth` + `scalers.pkl` (tracked, load, real inference) | 🔶 median 24h error ~50–80 km — historical, not re-verified | ✅ real point forecasts; **`LIMITED/UNVERIFIED`** | **LIMITED/UNVERIFIED** | Uncertainty head SATURATED ~209.9 km, constant, NOT calibrated, NOT lead-time-growing; point skill not re-verified; synthetic/constructed runtime input history remains |
| **Intensity** | 24h MSW (kt) regression (+ IMD category) | ❌ dataset absent (`clean_model_data.csv` 486 obs/30 storms claimed historically; IMD `.xlsx` path missing) | ❌ artifact absent (`cyclone intensity/models/final_xgb_regressor.joblib`) | 🔶 MAE 14.55 / RMSE 19.66 / R² 0.037 / exact 45.3% / within-1 84.0% — HISTORICAL | `UNAVAILABLE` (no artifact) | **UNAVAILABLE** | No trained artifact, no dataset; reproducible retrain recipe exists (`cyclone intensity/retrain.py`); no uncertainty (point regressor) |
| **RI** | P(Rapid Intensification at 24h), binary | ✅ IMD RI base (2 CKs; 5,009/291/179 BoB), multimodal table 3,211 rows; 🔶 ERA5 848 obs features CSV; ⚠️ satellite 25 rows/23 storms/8 RI; TCIR dataset absent | ✅ IMD XGB (real, tracked, runnable) · ✅ ERA5 XGB (89-feat, loads) · ✅ satellite CNN `.pt` (loads state dict; fold-0 scaler ABSENT, Kelvin↔[0,1] mismatch) · ❌ fusion meta-model ABSENT | 🔶 IMD-only PR-AUC 0.594 > IMD+ERA5 0.341 (20-storm set) — historical; 🔶 sat OOF PR-AUC 0.516 (9 obs); 🔶 TCIR PR-AUC 0.092 — all UNVERIFIED | ✅ IMD-only branch; `calibrated_probability` = alias of `imd_probability` (NO isotonic calibration applied) | **LIMITED (IMD-only)** | ERA5 runtime reconstruction not wired; satellite inference not runnable in-repo; no fusion meta-model exists; confidence fixed heuristic 0.55 |
| **Recurvature** | P(heading change ≥ 45° within 24h), binary | ⚠️ IBTrACS NIO; split 276/60/60 storms (10,069/1,982/2,085 rows) — training CSVs GITIGNORED/absent | ⚠️ `xgb_recurve_model.json` (GITIGNORED, present locally); ✅ `scaler.joblib` (tracked) | ✅ **REPRODUCED in-repo**: ROC-AUC 0.7218, PR-AUC 0.5218, F1 0.4941, Brier 0.2052 (from `test_predictions.csv`, 2,085 rows) | ✅ real XGB predictions with track history; refuses incomplete state → orchestrator FAILED | **AVAILABLE (trained, real) — NOT reproducible from fresh checkout** | Calibration weak; DIST2LAND/dir_change inputs are placeholders when history absent; limited inference without history/env; artifact + eval outputs untracked |
| **Rainfall** | Same-time heavy/light classification (≥ 10 mm/hr), per-cell | ✅ FANI 2019 IMERG (336,000 rows × 4 cols; 12 half-hour × 28,000 cells) | ✅ `rainfall_classifier_12.pkl` (bare RF, 25 feats, tracked, loads) + `rainfall_regressor_12.pkl` (RF, 25 feats; now shipped at `rain/model/`) | ✅ **REPRODUCED**: P 0.9197 / R 0.9785 / F1 0.9482 / MAE 0.0785 (temporal holdout = last 4/12 snapshots, 112,000 rows) | `AVAILABLE_BASELINE` — same-time; no future product (grids None, conf 0.0) | **BASELINE ONLY** | NOT a future rainfall forecast; cross-split autocorrelation leakage (optimistic); training-count discrepancy (56k rows unaccounted); FANI-only |
| **Wind** | U10/V10 wind-field grid (Keras ConvLSTM2D enc-dec), horizon undocumented | ⚠️ IBTrACS 4 cyclones + case PNGs; no gridded U10/V10 source in repo | ✅ `wind/model/wind_model_best.keras` (tracked); **loads after TF-health probe**; registered `wind_vbaseline`; orchestrator discovers it | ❌ no metrics | ✅ grid-fed **real inference verified** (`predict_grids`, isolated subprocess); `BASELINE` in standard DAG (no U10/V10 provider) | **PARTIAL** (CASE STUDY Yaas 2021 — model/adapter/registry/inference VERIFIED) | no input geometry; no scaler object (norm txt only); single case study; horizon undocumented; no production input provider |
| **Flood** | Static per-cell flood-extent classification, FANI 2019 | ✅ 374 cells × 97 timestamps; 28 feats (16 rainfall current+past + 12 static hydrology); ❌ label leak: per-cell constants post-event back-propagated; 2 label schemes disagree (70 vs 3 flooded) | ✅ `flood_xgboost_improved.pkl` (raw XGB, 28 feats, tracked, loads) — **supersedes** `flood_xgboost_spatial_holdout.pkl` | ✅ **REPRODUCED**: temporal-validation ROC-AUC 0.9946 / PR-AUC 0.9749 / P 0.9552 / R 0.9143 / F1 0.9343 (`flood/metadata/flood_model_metadata.json`, ≈ last-25%-timestamps); spatial-holdout ROC-AUC 0.9649 / PR-AUC 0.8480 | `DATA_UNAVAILABLE` (needs grids/hydro preprocessing); errors on minimal state → FAILED | **STATIC SPATIAL CLASSIFIER — SINGLE EVENT** | NOT a flood forecast; whole-event label leakage documented; runtime preprocessing not wired; deployment inference class available at `flood/inference.py` |
| **Landslide** | Static susceptibility hazard maps | ⚠️ rainfall rasters + terrain; NO labeled landslide inventory | ❌ no ML artifact (adapter `checkpoint_path=""`) | ❌ none possible | `STATIC_SUSCEPTIBILITY` | **STATIC ONLY** | No model, no inference, no validation |

---

## 4. Verified / reproduced metrics

Metrics actually re-derived from the current repository (code data + artifacts).

| Model | Dataset | Sample count | Split | Metric | Value | Baseline/limitations |
|---|---|---|---|---|---|---|
| Recurvature XGB | `recurvature/test_predictions.csv` (from IBTrACS NIO) | 2,085 test rows | storm-wise 276/60/60 storms | ROC-AUC | **0.7218** | Reproduces `model_metadata.json` exactly; matches `plots/roc_pr_curves.png` legends |
| | | | | PR-AUC | **0.5218** | positive rate 0.2719 |
| | | | | F1 (thr 0.5) | **0.4941** | P 0.4237 / R 0.5926 |
| | | | | Brier | **0.2052** | uncalibrated |
| | | | | Accuracy | **0.6700** | |
| Rainfall RF | `rain/results/model12_results.csv` (FANI IMERG) | 112,000 test rows | temporal holdout (last 4/12 half-hourly snapshots) | Precision | **0.9197** | Same-storm, same-day; autoregressive features cross the 30-min split boundary (optimistic); reproduces `rainfall_model_12_metadata.json` |
| | | | | Recall | **0.9785** | |
| | | | | F1 | **0.9482** | |
| | | | | MAE | **0.0785** | |
| Native runtime | `tests/integration/test_native_model_compatibility.py` | 8 tests | — | trajectory+recurvature+RI coexist under `configure_runtime()` | **8/8 pass** | 10/10 consecutive runs stable (Phase 2 record) |
| Adapter fidelity | `tests/test_genesis.py` | — | — | genesis adapter == direct pipeline | **1e-12 identical** | no double imputation/transform |

---

## 5. Historical / unverified metrics

Explicitly marked. **Not reproduced from the current repository.** Do not combine
with Section 4. Do not use as a baseline without re-establishing it.

> `UNVERIFIED / HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT REPOSITORY`

| Model | Claimed metric | Where claimed | Reason not reproducible |
|---|---|---|---|
| Trajectory | median 24h error ~50–80 km | historical storm evaluation | no eval script/results for distilled artifact in repo |
| Intensity | 5-fold storm CV: MAE 14.55 kt, RMSE 19.66 kt, R² 0.037; exact 45.3% / within-1 84.0% | upstream intensity docs | artifact + dataset + results absent from repo |
| RI (IMD-only) | PR-AUC 0.594 > IMD+ERA5 0.341 (20 storms / 25 RI common test set) | RI report docs | strict common set construction not in repo |
| RI (satellite CNN) | OOF PR-AUC 0.516 (9 obs) | `cyclone_backup/README.md` §9d | OOF CSV absent; inference blockers (fold-0 scaler, unit mismatch) |
| RI (TCIR CNN) | PR-AUC 0.0917 / ROC 0.5782 (N=928 / 19 storms / 69 RI); dataset 2,840/64/189 | `cyclone_backup/README.md`, `SIH_FINAL_RI_REPORT.md` | TCIR dataset + results absent; artifact normalisation stats pathologically inf/nan |
| Flood | ROC-AUC 0.9635 / PR-AUC 0.8480 (rain+hydro, spatial holdout) | `flood/metadata/flood_model_metadata.json` | superseded 1st-gen claim; improved model's spatial-holdout ROC-AUC reproducible (0.9649), temporal-validation ROC-AUC 0.9946 reproduced (≈ last-25% timestamps); exact 94-cell holdout split still not in repo |
| Flood | near-100% "temporal validation" | `flood_xgboost_temporal_validation_predictions.csv` | file uses training-period timestamps + all cells + per-cell-constant labels — not a valid holdout |
| Genesis | 300-sample balanced dataset (150/150, 191 storms, 2015–2024) + any CV/test metrics | external source report | training data, script, metrics not in repo |
| Rainfall | two-stage regressor half of the "rainfall model" | upstream metadata | regressor artifact now SHIPS at `rain/model/rainfall_regressor_12.pkl` (gitignored, present locally; load + contract verified — full metric reproduction requires the absent feature-builder script) |
| Wind | (none claimed) | — | no numeric metrics anywhere for wind |

---

## 6. Known scientific limitations (frozen)

### Trajectory
- Real LT3P-distilled Transformer artifact; point forecast runs.
- Uncertainty head SATURATED at ~209.9 km (log-variance clamped +5): constant,
  NOT calibrated, NOT demonstrated to grow with lead time.
- Point-forecast skill is NOT currently re-verified against a baseline
  (persistence not computed).
- Synthetic/constructed runtime input history remains (12-point input path).

### Intensity
- No real trained artifact currently present; dataset absent.
- Historical ≈14.55 kt MAE is UNVERIFIED.
- A reproducible retraining recipe exists (`cyclone intensity/retrain.py`).
- No uncertainty (point-forecast regressor). Confidence, if the artifact were
  ever added, would be a documented 0.8/0.5 feature-completeness heuristic
  (flagged, see §8).

### RI
- IMD-only branch is the only reproducible, runtime branch.
- ERA5 runtime feature reconstruction unavailable (89-feature mismatch vs state).
- Satellite branch unavailable/unverified (fold-0 scaler absent, unit mismatch).
- Fusion meta-model absent — `fusion_probability` cannot be produced.

### Recurvature
- Real IBTrACS-based XGBoost model.
- ROC-AUC ≈0.722 / PR-AUC ≈0.522 are reproduced locally (in-repo) but the
  artifact and eval outputs are not in git.
- Calibration weak (Brier 0.2052, uncalibrated).
- Limited inference when history/features unavailable (placeholders).

### Genesis
- Real artifacts exist and run.
- Dataset/training provenance absent; scientific validation unreproducible.
- Runtime relies heavily on imputed/placeholder environmental inputs
  (synthetic SST/SST-anomaly/TCHP/OHC700).
- Prototype/unverified.

### Satellite (RI-adjacent)
- MERG-IR crops exist (26) but tiny sample size; 16/26 granules in repo.
- Satellite CNN artifact exists but inference preprocessing/scaler incomplete.
- TCIR results unreproducible (dataset absent; norm stats pathological).
- No demonstrated multi-source satellite fusion anywhere.

### Rainfall
- Same-time classification, NOT a future rainfall forecast.

### Wind
- Case-study (Yaas) wind field model; model load / adapter / registry discovery / grid-fed inference now **VERIFIED** (`predict_grids` runs `model.predict` in an isolated subprocess; TF-before-pandas import order inside the worker avoids the macOS arm64 pandas-after-TF predict deadlock). No gridded U10/V10 provider ships in the repo, no valid operational pipeline, horizon still undocumented.

### Flood
- Static/single-event spatial classifier; NOT a future flood forecast.
- Event-label leakage limitation documented (whole-event label leak).

### Landslide
- Static hazard/susceptibility maps only; no ML artifact.

---

## 7. Integration status

Verified by running each real adapter on a real `CycloneState` and by the
Phase 11 end-to-end propagation tests.

| Integration element | Status |
|---|---|
| Adapter statuses → orchestrator execution results | ✅ Phase 11 (`unavailable_statuses` set downgrades UNAVAILABLE-class outputs; LIMITED/UNVERIFIED/BASELINE kept as real SUCCESS) |
| Status survival through JSON serialization | ✅ Phase 11 tests |
| Status survival into frontend UI | ✅ Phase 11 (RiskPage, DashboardPage, ModelsPage, IntensityPage, FloodPage, HazardsPage, RecurvaturePage, CycloneMap, TrackPage) |
| Full DAG with real adapters + real data ingestion | ❌ NOT runnable end-to-end: `create_orchestrator(configs/pipeline.yaml)` fails to build a working `state_builder` (abstract `ERA5Loader`, missing IMD `.xlsx`) |
| DAG execution order + dependency gating | ✅ tested (orchestrator tests, Phase 11 full-DAG propagation) |
| Hazard engine | ✅ SUCCESS; honest `None` severity when nothing assessed |
| Recurvature in DAG | ⚠️ real adapter refuses incomplete state → orchestrator FAILED (honest, but blocks downstream) |

---

## 8. Fabricated-path audit (step 8 — search for hidden fabrication)

Search completed across `src/`. **No hard-coded predictions, no randomized
fallback predictions, no silent missing→zero conversions, no backend mock data.**
`missing→0` conversions reviewed: only legitimate physical zero/empty outputs on
UNAVAILABLE paths (`confidence=0.0`, empty grids) with a status field.

Documented (not hidden) heuristics — reported confidence values that are NOT
calibrated model outputs. These are the remaining "questionable" values, all
explicitly labeled in code:

| Location | Value | Nature |
|---|---|---|
| `src/models/adapters/ri_adapter.py:266` | `confidence = 0.55` (IMD branch ran) | Fixed heuristic; `calibrated_probability` is an alias for `imd_probability` — no applied calibration |
| `src/models/adapters/intensity_adapter.py:234` | `confidence = 0.8 if has_era5 else 0.5` | Feature-completeness heuristic; DEAD CODE today (artifact missing); documented "NOT a calibrated confidence" |
| `src/models/adapters/recurvature_adapter.py:247` | `conf = 0.95 − placeholder penalties` (min 0.25/max 1.0) | Penalized heuristic reflecting placeholder inputs; documented |
| `src/models/adapters/trajectory_adapter.py:198-216` | cross-horizon consistency cosine similarity; `0.5` fallback for <2 points | Deterministic motion-consistency heuristic (not calibration); documented |
| `src/models/genesis/adapter.py:602` | `confidence = clip(0.5 + |prob−0.24|, 0.5, 0.95)` | Margin heuristic; documented as "not a calibration" |

These are recorded in the baseline so future work can either remove them or
replace them with calibrated uncertainty. **Not modified in Phase 12** (no
model-behavior changes permitted outside the TrackPage fix).

Also flagged: `src/core/ingestion.py` contains abstract loaders (`ERA5Loader`
without `load`) — part of the end-to-end ingestion gap (see §7/§9); genesis
inputs imputed with median; recurvature `DIST2LAND`/`dir_change_3h/9h` are
placeholders when no track history is supplied.

---

## 9. Artifact readiness (step 9 — reproducibility)

Full inventory performed (paths, formats, sizes, git status). Summary:

| Branch | Artifact | Format | On disk | In git | Reproducible from fresh checkout? |
|---|---|---|---|---|---|
| Genesis | 3 approved joblib pipelines (LightGBM/XGB/RF) + imputer | joblib | ✅ | ✅ tracked | ✅ yes (retrain data absent, but artifact ships) |
| Trajectory | `best_cyclone_model_lt3p_distilled.pth` + `scalers.pkl` | PyTorch | ✅ | ✅ tracked | ✅ yes |
| Intensity | `final_xgb_regressor.joblib` | joblib | ❌ absent | ❌ | ❌ requires retrain w/ real dataset |
| RI-IMD | `imd_final_xgboost.json` (+ ERA5/combined XGB, sat `.pt`, TCIR bundle) | XGB JSON / PyTorch / Keras | ✅ all present | ✅ tracked | ✅ artifacts ship; satellite inference blocked by ABSENT `cyclone_backup/results/cnn_tabular_scaler.json` |
| Recurvature | `xgb_recurve_model.json` | XGB JSON | ✅ | ❌ **GITIGNORED** (`.gitignore:14`) | ❌ NOT reproducible; training CSVs gitignored/absent; in-repo eval CSV untracked |
| Rainfall | `rainfall_classifier_12.pkl` (+ `rainfall_regressor_12.pkl`) | joblib (RF) | ✅ | ✅ classifier tracked; regressor gitignored but ships locally | ✅ yes (metrics verticality reproducible from result CSVs) |
| Wind | `wind_model_best.keras` | Keras | ✅ | ✅ tracked | ✅ file ships; loads after TF-health probe; grid-fed inference verified (isolated worker) |
| Flood | `flood_xgboost_improved.pkl` | joblib (XGB) | ✅ | ✅ tracked | ✅ file ships; temporal metrics REPRODUCIBLE (see §4); exact spatial-holdout split absent |
| Landslide | none | — | — | — | n/a |

### Git-tracking facts
- All trained artifacts are tracked EXCEPT `recurvature/xgb_recurve_model.json`
  (`.gitignore:14`), `feature_importance.json` (`.gitignore:13`),
  `recurvature/results.csv` (`.gitignore:12`), and `recurvature/data/*.csv`
  (`.gitignore:31`, only `.gitkeep` present).
- `.gitignore` also ignores `*.h5`, `*.nc`, `*.npy`, `*.zip`, `data/*.csv`,
  `rain/model/rainfall_regressor_12.pkl` — but the tracked `.nc`/`.npy`/`.zip`
  files already in the index ARE reproducible from a fresh clone.
- Locally generated, untracked, NON-reproducible: `recurvature/test_predictions.csv`,
  `recurvature/model_metadata.json`, `frontend/dist/assets/index-*.js`
  (build artifact), `frontend/tsconfig.tsbuildinfo`, `metadata_clean.csv.bak`.
- Working-tree modified `M` tracked files (uncommitted Phase 0–11 changes):
  `recurvature/scaler.joblib`, `cyclone_backup/satellite_cnn_recovered/metadata_clean.csv`,
  docs, READMEs, all frontend source touched across Phases.

### Required for fresh-checkout reproducibility
1. **Archive the recurvature model externally** (or un-ignore and commit) + its
   training CSVs; otherwise retrain from a rebuilt IBTrACS dataset.
2. **Retrain intensity** from the real IMD/ERA5 dataset via
   `cyclone intensity/retrain.py`.
3. **Recover the satellite fold-0 scaler** (`results/cnn_tabular_scaler.json`)
   to make `satellite_cnn.pt` inferable.
4. **Provide a documented input geometry (and a legitimate gridded U10/V10
   provider)** for wind — TF runtime + grid-fed inference themselves now work.

Per Phase 12 rules, large artifacts were NOT committed just to make the report
look complete; the gaps above are documented instead.

---

## 10. Ranked improvement opportunities (roadmap — NOT implemented)

Ranking by scientific value × feasibility × data availability × objective
evaluability. This is the input to the next (improvement) phase.

| # | Target | Required data | Target model/piece | Baseline to beat | Evaluation | Expected difficulty | Current blocker |
|---|---|---|---|---|---|---|---|
| 1 | **Trajectory — real history + proper uncertainty** | IBTrACS (present) + operational real-time track history | rebuilt uncertainty head / recalibrated sigma; real history path | persistence; current saturated ~209.9 km band | ADE, FDE, per-horizon error; calibration metrics (reliability/CRPS) | Medium | synthetic/constructed runtime input history; no re-verified point baseline |
| 2 | **Recurvature — improve/calibrate the existing model** | IBTrACS (present; training CSVs rebuildable) | existing XGBoost + isotonic calibration + optional feature additions | ROC-AUC 0.7218 / PR-AUC 0.5218 / Brier 0.2052 | ROC-AUC, PR-AUC, F1, Brier, calibration curve | Low–medium | artifact gitignored (archival), placeholder inputs |
| 3 | **Intensity — real IMD/ERA5 dataset + genuine 24h model** | IMD best-track 1982–2026 (`IMD_best_track.xlsx` MISSING) + ERA5 (CDS) | retrain `retrain.py` recipe with verified split | persistence; climatology (R² currently ~0.04 historical baseline) | MAE, RMSE, R², per-lead | Medium | dataset/credentials; artifact absent |
| 4 | **RI — reconstruct ERA5 + satellite + genuine fusion** | ERA5 features (partial present), MERG-IR (16/26 granules; external NOMADS for rest), satellite scaler recovery | ERA5 feature reconstruction; fix fold-0 scaler; train fusion meta-model | IMD-only (PR-AUC 0.594 historical) | PR-AUC, recall, precision, Brier/calibration | Medium–high | ERA5 runtime wiring; satellite scaler; TCIR dataset absent |
| 5 | **Genesis — real environmental dataset + verified labels** | real (non-synthetic) SST/SST-anomaly/TCHP/OHC700 fields + genesis labels | re-train/validate LightGBM production path on verified data | median-imputed prototype (baseline TBD) | PR-AUC, ROC-AUC, recall, FPR, calibration, prevalence baseline | High | training data/provenance absent; external source needed |
| 6 | **Satellite — expand tiny dataset + fix preprocessing** | more MERG-IR granules + labels (external; ~10 granules missing from repo) | fix `normalize_patch` units; rebuild scaler; retrain CNN; reproduce OOF | UNVERIFIED (currently none reproducible) | PR-AUC, ROC-AUC | High | dataset size (26 crops), external downloads, TF env for Keras path |
| 7 | **Hazard branches → genuine future predictions where data permits** | multi-event IMERG (rainfall), gridded ERA5 (wind), dynamic lead labels + label-scheme fix (flood), landslide inventory (landslide) | redefine tasks with lead-time targets; proper temporal splits; real dynamic inference | current same-time/static baselines | branch-appropriate (define per task, see §11) | High | rainfall/wind/flood data breadth; wind TF env; flood label leak must be removed |

---

## 11. Objective improvement criteria

**Rules:** no invented targets like "90% accuracy"; always compare against the
appropriate baseline; hold out by storm; report uncertainty calibration when a
new uncertainty is built.

| Branch | Comparing against | Metrics |
|---|---|---|
| Trajectory | persistence; appropriate kinematic baseline | ADE, FDE, per-horizon error; calibration (reliability, CRPS) if uncertainty is rebuilt |
| Intensity | persistence; climatological baseline | MAE, RMSE, R² (where appropriate), per-lead performance |
| RI | IMD-only vs ERA5 vs satellite vs fusion | PR-AUC, recall, precision, Brier/calibration |
| Recurvature | current reproduced baseline (0.722/0.522) and uncalibrated Brier | ROC-AUC, PR-AUC, F1, calibration, baseline comparison |
| Genesis | prevalence baseline (5.6% BoB) and median-imputed prototype | PR-AUC, ROC-AUC, recall, false-positive rate, calibration, prevalence baseline |
| Rainfall (future task) | persistence of current rainfall; same-time baseline | to be defined only after the future-cast task is specified |
| Wind | persistence of wind field | to be defined (requires documented horizon + input provider; grid-fed inference itself runs) |
| Flood | static spatial baseline; dynamic task must fix label leak first | to be defined after task redefinition |
| Landslide | none yet (no model) | task definition required first |

---

## 12. Known blockers

1. **Full end-to-end pipeline not runnable with real ingest**: `create_orchestrator`
   needs a working `state_builder`; `DataIngestionLayer` has abstract loaders
   (`ERA5Loader`) and referenced data files are missing (`IMD_best_track.xlsx`,
   `dem.tif`, soil/landcover/hydro paths). DAG is exercised via controlled
   adapters in tests only.
2. **Recurvature reproducibility**: model + training data not in git.
3. **Intensity**: artifact + dataset absent; ECMWF CDS credentials needed for ERA5.
4. **Satellite**: fold-0 scaler absent; Kelvin↔[0,1] unit mismatch; MERG-IR
   download needs external NOMADS; TCIR dataset absent; TF environment broken.
5. **Wind**: no input geometry documented; no gridded U10/V10 provider in repo;
   grid-fed inference itself runs (isolated TF worker).
6. **Flood labels**: whole-event label leak + disagreeing label schemes (70 vs 3)
   must be resolved before a dynamic flood product.
7. **Genesis data**: no training dataset in repo; synthetic env features.
8. **TensorFlow ecosystem**: in-process `model.predict()` can deadlock if pandas
   was imported first (macOS arm64) — wind inference is therefore executed in an
   isolated subprocess that imports TF before numpy/pandas and never imports
   pandas.

---

## 13. Exact verification results (2026-09-12, this run)

| Check | Command | Result |
|---|---|---|
| Backend tests | `python3 -m pytest tests/ -q` | **206 passed / 0 failed** (752 warnings) |
| Test count (collect) | `pytest --collect-only` | 206 collected |
| Frontend typecheck | `npx tsc --noEmit` (frontend/) | **Clean** (0 errors) |
| Frontend build | `npx vite build` | **Success** (index-1We64_Qb.js 1,173 kB · gzip 324 kB) |
| Ruff `src/` | `python3 -m ruff check src/` | 235 errors — ALL pre-existing Phase 0–9 debt (UP007 98, F401 67, I001 27, W292 23, E402 3, W293 3, F841 6, F402 3, UP015 2, UP038 1, UP037 1, F821 1); NONE in Phase 10–12 edited ranges |
| Ruff `tests/` | `ruff check tests/` | included in combined 280; pre-existing only |
| Live adapter statuses | real adapters × real `CycloneState` | table in §1/§7 |
| Reproduced recurvature metrics | `sklearn` on `test_predictions.csv` | §4, exact match to metadata |
| TrackPage fix | `npx tsc --noEmit` + build | clean (message surfaced from `PredictionStatus.message`) |
| `model_health_check.json` | `python3 -m json.tool` | **Valid JSON**; digest matches §5 §7 |

---

## 14. Date / version / commit information

| Item | Value |
|---|---|
| Audit date | 2026-09-12 |
| Branch | `main` |
| Latest commit | `c6a8db9` — "Add full project: backend, frontend, models, tests, and pipeline code" |
| Prior commits | `a6df99a`, `c84d9c4`, `adda960`, `87c21bf` (project history) |
| Working tree | 63 changed/untracked paths = the accumulated Phase 0–11 repairs (documented in `REPAIR_LOG.md`); Phase 12 adds the TrackPage surface fix + this report + health-check update |
| Python | 3.13 (macOS arm64); pydantic 2.13; sklearn 1.8.0; xgboost 2.1.3; lightgbm; torch 2.13.0; numpy; pandas |
| Node | Vite 5.4.21, React 18 + TypeScript |
| Runtime guard | `src/core/runtime.py::configure_runtime()` (OMP_NUM_THREADS=1 + libomp preload) |

---

## Final verdict

> **Is TOOFAN now ready to enter an ML improvement phase? — YES.**

Reasoning:
- ✅ repository is test-clean (206/206), frontend typechecks and builds;
- ✅ statuses are honest and survive adapter → orchestrator → serialization → UI;
- ✅ fabricated outputs removed (Phases 10–11) and remaining uncalibrated
  confidence heuristics are documented (not hidden);
- ✅ major scientific limitations are recorded above and were not softened;
- ✅ verified metrics are separated from historical/unverified claims;
- ✅ data blockers are known and tabulated.

This does **NOT** mean the models are production-ready. It means the project is
ready to begin scientifically controlled improvement work, starting with the
priorities in §10, measured against the frozen baselines in §4.