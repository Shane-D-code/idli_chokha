# Phase 10 — Hazard Branch Audit: Rainfall / Wind / Flood / Landslide

| | |
|---|---|
| **Audit date** | 2026-09-12 (Phase 10, hazard branches) |
| **Type** | READ-ONLY forensic audit + safe runtime fixes + label corrections. NO retraining, NO synthetic data, NO new metrics. |
| **Scope** | `rain/`, `wind/`, `flood/`, `stage17_hazard_maps/`, the four hazard adapters in `src/models/`, frontend hazard labels, and the hazard rows in `model_health_check`, `model_inventory`, `README`. |
| **Go-along report** | `tests/test_hazard_contracts.py`, `docs/model_audit/model_health_check.md` / `.json` |

Today's date: 2026-09-12.

## Method

1. Inventory of every code/data/artifact/result file under the four branches.
2. Forensic reading of artifacts (loading in-process where safe, subprocess probing
   where the runtime is broken), data files, metadata, results CSVs, and the
   four hazard adapters.
3. Classification of the branch's *actual* scientific task from what the repo
   contains (not from folder names or UI copy).
4. Demonstration of a safe, behavior-neutral fix where a demonstrated bug exists
   (wind load hard-abort) and label corrections where terminology misleads.
5. Contract tests added to pin the honest contracts for future phases.

No predictions, metrics, or uncertainty figures were fabricated for any branch.
Metrics quoted below are (a) existing numbers recorded in the repo's own
metadata files, reproduced where the source CSV allows, or (b) `HISTORICAL CLAIM`
where the evidence needed to reproduce them is absent.

---

## Branch 1 — Rainfall (`rain/`)

1. **Scientific task (actual)**: same-time heavy/light **binary classification** of
   per-cell IMERG rainfall for a single case study (FANI, 2019-04-30). It is a
   classifier, **not a rainfall forecast** (tested: adapter explanation says so).
2. **Target**: binary class `heavy` (per-cell `rainfall_mm_hr >= 10.0`); the
   regressor counterpart claimed in the two-stage metadata now **ships** at
   `rain/model/rainfall_regressor_12.pkl` (RandomForestRegressor, 25 features,
   integrated from the absorbed deployment package); full metric reproduction of
   the regression stage still requires the (absent) feature-builder script.
3. **Horizon / alignment**: **same-time** — inputs and target are the same
   half-hour timestamp; no future-predictive capability.
4. **Data source**: `rain/data/FANI_2019_IMERG_20190430_0000_0600.csv`
   (336,000 rows × 4 cols `[timestamp_utc, latitude, longitude, rainfall_mm_hr]`),
   12 half-hourly snapshots of 28,000 grid cells. The file also contains one
   anomalous bare-date row string `2019-04-30` (no time) — data hygiene issue.
5. **Features (25)**: current + past rainfall statistics and multi-scalar lags
   (`rainfall_lag_30min/60min`, rolling windows), per-cell spatial means/max/std.
   No future/lead rainfall columns.
6. **Leakage identified**:
   - *Autocorrelation across the split*: lag/rolling features computed from the
     *same day's* prior half-hours appear on test rows whose past-window rows are
     training rows → optimistic cross-split leakage.
   - *Training-count discrepancy*: metadata says `training_samples: 168000`
     (6 snapshots) + `testing_samples: 112000` (4 snapshots) = 280,000 rows,
     but 4-of-12 holdout implies 224,000 training rows (8 snapshots); 56,000
     rows (2 snapshots) are unaccounted.
7. **Split methodology actually present**: temporal (last 4 of the 12 half-hourly
   snapshots = `04:00–05:30`, verified: results CSV has exactly those 4 timestamps,
   112,000 rows). Same-day, same-event; no out-of-event validation.
8. **Artifact status**: `rain/model/rainfall_classifier_12.pkl` (bare
   `RandomForestClassifier`, 25 features, classes `[0,1]`) **loads**. Regressor:
   **absent**.
9. **Training / inference pipeline**: training script present; inference = adapter
   (`create_rainfall_adapter`) that **never fabricates** rainfall grids (all
   `rainfall_3h/6h/12h/24h` = `None`, `confidence=0.0`).
10. **Evaluation evidence**: metrics in
    `rain/metadata/rainfall_model_12_metadata.json`
    (`classification_precision 0.9197`, `classification_f1 0.9482`, `mae 0.0785`)
    **reproduce exactly** from `rain/results/model12_results.csv` (test added).
11. **Runtime adapter behavior**: `predict(None)` → `status=AVAILABLE_BASELINE`
    with explanation "same-time classifier ... NOT a future rainfall forecasting
    model". No crash, no fabricated output.
12. **Frontend / interface terminology**: rainfall rows in `ReportsPage`,
    `MOCK.ts`, and `RainfallPage` already say `BASELINE` / "same-time", "not a
    forecast" (no change needed beyond existing). Dashboard/LiveMonitor show
    `BASELINE` — correct.
13. **Honest scientific status**: **BASELINE ONLY — SAME-TIME CLASSIFIER (single
    case study, FANI 2019)**; not operational, not a forecast.
14. **Retraining required for a real rainfall-forecast product**: new future-cast
    task definition + lead-time labels, multi-event training set, proper temporal
    test split, and (optionally) the documented regressor.
15. **Key limitations before Phase 11**: no future skill; classifier-only; split
    leakage; training-count discrepancy to reconcile; bare-date anomaly row.

---

## Branch 2 — Wind (`wind/`)

1. **Scientific task (actual)**: single **case study** (Yaas 2021) — a Keras
   ConvLSTM2D encoder–decoder trained to map 6 prior U10/V10 frames to one
   output frame. No training script → horizon/alignment **undocumented**.
2. **Target**: `future_wind` U10/V10 grids (m/s) for one unspecified forecast step.
3. **Horizon**: **undocumented**; cannot be verified — output shape equals input
   shape `(81,57,2)`.
4. **Data source**: `wind/data/ibtracs_four_cyclones.csv` (IBTrACS text, 4 storms)
   and case-study PNGs in `wind/results/`; no gridded ERA5/U10 source saved.
5. **Features**: 6 frames of U10/V10 (181×57? grid bytes in `(6,81,57,2)`).
6. **Leakage**: unassessable — no training script, no dataset split, no scaler.
   Only `wind/metadata/wind_normalization.txt`
   (U10 mean/std `1.7262/4.4726`, V10 mean/std `3.1894/4.5187`).
7. **Split methodology present**: **none** (single case study).
8. **Artifact status**: `wind/model/wind_model_best.keras` exists (5.2 MB, SHA-256
   `53779bf2…5132`); **LOADABLE now — verified (Wind integration)**. The Phase 10
   subprocess import-health probe is retained: the adapter imports TF in-process
   only after the probe succeeds, otherwise it raises a catchable `RuntimeError`
   and reports explicit `UNAVAILABLE` instead of terminating the process.
9. **Training / inference pipeline**: training pipeline does NOT exist in the repo;
   a **real inference path is implemented and verified** — `predict_grids()` on
   caller-supplied U10/V10 grids (documented normalization → model → denormalized
   m/s fields, `status=AVAILABLE`). `model.predict` runs in an **isolated
   subprocess** (imports TF before numpy/pandas; on macOS arm64 pandas-before-TF
   deadlocks in-process predict) which also contains any TF hard-abort.
10. **Evaluation evidence**: **none** — no metrics anywhere for the wind model.
11. **Runtime adapter behavior**: `create_wind_adapter()` never crashes;
    `predict(None)` returns honest `BASELINE` (empty `wind_fields`,
    `confidence=0.0`) when loaded, or explicit `UNAVAILABLE` when the TF runtime
    is unusable; `predict_grids(grids)` runs real inference and rejects
    malformed shapes/NaN. `validate_input()` → False (needs gridded fields absent
    from `CycloneState`).
12. **Frontend / interface terminology**: **corrected** — `MOCK.ts` wind entry now
    `load/predict/adapter = UNAVAILABLE` with a TF-crash note; `mockWind` status →
    `RUNTIME_REQUIRED`; `ReportsPage` WIND → `BASELINE` with TF note;
    `LiveMonitorPage` wind → `UNAVAILABLE`; `HazardsPage` "WIND FORECAST
    UNAVAILABLE" → "WIND FIELD UNAVAILABLE"; `DashboardPage` unchanged (not in
    the flagged block).
13. **Honest scientific status**: **CASE STUDY ONLY** (Yaas 2021, undocumented
    horizon). Model load / adapter / registry discovery / grid-fed inference are
    **VERIFIED**; full pipeline output is NOT wired — **no gridded U10/V10
    provider ships in this repository** and the orchestrator wind step needs
    upstream trajectory+intensity.
14. **Retraining required for a real wind-forecast product**: rebuild from
    documented ERA5 inputs with a real training pipeline, scaler, lead-time
    definition, multi-event validation, and a runnable inference recipe.
15. **Key limitations before Phase 12**: no gridded U10/V10 input provider; no
    documented input grid geometry/orientation; no metrics; orchestrator wind
    step returns `BASELINE` in the standard DAG.

---

## Branch 3 — Flood (`flood/`)

1. **Scientific task (actual)**: **static spatial flood-extent classification**
   on a single event (FANI 2019): a raw XGBClassifier mapping per-cell rainfall +
   static hydrology to a per-cell flooded/not class. **Not a flood forecast**, not
   a validated dynamic susceptibility model.
2. **Target**: per-cell binary `flood_label` (flooded = EMSR357 post-event extent).
3. **Horizon**: **none** — labels and predictions are per-cell constants; the
   demo output is a static map, not a temporal prediction (tested).
4. **Data source**: `flood/data/imerg/fani_spatial_flood_labels.csv` — 374 cells,
   97 timestamps, labels constant per cell (post-event extent back-propagated
   over time). A second, simpler label file marks only 3 flooded cells — the two
   label schemes disagree.
5. **Features (28)**: 16 rainfall (current + past lags/rolling; verified **no
   future/lead rainfall columns**) + 12 static hydrology (distances to water,
   river, lake, inundation, waterbody/river counts).
6. **Leakage identified**:
   - *Whole-event label leak*: `flood_label` is constant per cell across all 97
     timestamps — post-event extent is used as the target at times before the
     event, and the same labels appear in both train and test cells' overlapping
     events.
   - *Spatial autocorrelation*: nearby cells share static hydrology; spatial
     holdout mitigates but does not eliminate residual spatial structure.
7. **Split methodology present**: documented as **spatial holdout** (280 train /
   94 test cells). The "temporal validation" predictions file
   (`flood_xgboost_temporal_validation_predictions.csv`, 11,220 rows, 30
   timestamps of 2019-05-03 09:30 → 2019-05-04 00:00) is **NOT a temporal
   holdout** — all timestamps are *inside the same event window*; no
   out-of-event generalization exists.
8. **Artifact status**: `flood/model/flood_xgboost_improved.pkl` (raw
   XGBClassifier, 28 features, classes `[0,1]`) **loads** (supersedes the
   historical `flood_xgboost_spatial_holdout.pkl`).
9. **Training / inference pipeline**: training script present for the spatial
   holdout; adapter inference returns `DATA_UNAVAILABLE` and tolerates a missing
   rainfall prediction (previously crashed; test pinned).
10. **Evaluation evidence**: metadata
    `flood/metadata/flood_spatial_holdout_metadata.json` records rainfall-only
    ROC-AUC `0.8025` and rainfall+hydrology ROC-AUC `0.9635`. These are
    **repo-recorded historical claims — not re-run in Phase 10** (the holdout
    construction artifacts needed for full reproduction are not recoverable from
    the current repo). No metric was claimed for the "temporal validation" file.
11. **Runtime adapter behavior**: `predict(None, ...)` → `status=DATA_UNAVAILABLE`,
    empty `probability_grid`, `confidence=0.0` (no fabricated surface).
12. **Frontend / interface terminology**: **corrected** — `HazardsPage` flood note
    now reads "static spatial flood-extent classification ... NOT a flood forecast"
    with `DATA_UNAVAILABLE`; `DashboardPage` flood `available: false`;
    `LiveMonitorPage` flood → `DATA_UNAVAILABLE`; `MOCK.ts` flood now "raw
    XGBClassifier — static spatial extent" / `DATA_UNAVAILABLE`.
13. **Honest scientific status**: **STATIC SPATIAL CLASSIFIER — SINGLE EVENT
    (BASELINE ONLY)**; runnable offline, `DATA_UNAVAILABLE` at runtime because the
    full geographic feature preprocessing is not wired to standard inputs.
14. **Retraining required for a real flood-forecast product**: dynamic lead-time
    targets, multi-event labels, temporal split validation, explicit separation
    of rainfall-forecast input from contemporaneous rainfall truth.
15. **Key limitations before Phase 11**: no temporal generalization; label-scheme
    disagreement (70 vs 3 flooded cells); two label files; untestable holdout
    claims; runtime requires rainfall grids + hydrology preprocessing.

---

## Branch 4 — Landslide (`stage17_hazard_maps/`)

1. **Scientific task (actual)**: **static hazard-map generation** — PNG maps
   produced by `run_all_stages()` from rainfall + terrain rasters. **No ML model,
   no dynamic inference** (verified in the Phase 9 landslide audit and keeps
   holding).
2. **Target**: static susceptibility zones per terrain cell (PNG only).
3. **Horizon**: none (static).
4. **Data source**: rainfall rasters + terrain (DEM/slope) inputs; no labeled
   landslide inventory in the repo.
5. **Features**: terrain + rainfall heuristics; **no fitted features** (no model).
6. **Leakage**: n/a (no model trained).
7. **Split methodology**: n/a.
8. **Artifact status**: **no artifact exists** — contrary to frontend text that
   used to reference `models/landslide_model.pkl`. Landslide adapter warns
   "No landslide ML model artifact exists."
9. **Training / inference pipeline**: none — only `run_all_stages()` map scripts.
10. **Evaluation evidence**: **none** (no metrics possible).
11. **Runtime adapter behavior**: `predict(None)` → `status=STATIC_SUSCEPTIBILITY`,
    "No dynamic landslide ML model", empty `probability_grid`, `confidence=0.0`.
12. **Frontend / interface terminology**: **corrected** — `MOCK.ts` landslide
    entry artifact `models/landslide_model.pkl` → **`""`**, framework → "none
    (static hazard maps)", `inputFeatures` → 0; `LandslidePage`/`ReportsPage`
    already say `STATIC_SUSCEPTIBILITY`.
13. **Honest scientific status**: **STATIC SUSCEPTIBILITY MAPS ONLY — not a model**
    (UI must never display it as an ML prediction).
14. **Retraining required for a real landslide-forecast product**: a label-rich
    landslide inventory, a learning task (static susceptibility or event-based),
    a real model artifact, spatial/temporal validation, and a runnable inference
    path.
15. **Key limitations before Phase 11**: no model, no inference, no validation,
    frontend previously referenced a nonexistent artifact.

---

## Combined evidence table

| Branch | Real data | Artifact loads | Training code | Evaluation | Inference runnable | Reproducible | Scientific task | Runtime status |
|---|---|---|---|---|---|---|---|---|
| Rainfall | 336k rows (FANI 2019 IMERG) | ✅ RF (25 feats) | ✅ script | ✅ metrics reproduce from CSV | partial (adapter, no grid) | ✅ | Same-time heavy/light **classifier** (not forecast) | `AVAILABLE_BASELINE` |
| Wind | no U10/V10 source in repo (IBTrACS text + PNGs, Yaas) | ✅ TF load (probe-guarded; inference in isolated worker) | ❌ none | ❌ none | ✅ grid-fed (`predict_grids`, isolated subprocess) | partial (registry-verified, synthetic grid tests) | Single **case study**, horizon undocumented | `AVAILABLE` (grid-fed) / `BASELINE` (no grids) |
| Flood | 374 cells × 97 ts (FANI) | ✅ XGB (28 feats) | ✅ script | 🔶 metadata claims only (ROC-AUC 0.80/0.96) | ❌ (needs preprocessing) | ◐ | Static spatial flood-extent **classification** | `DATA_UNAVAILABLE` |
| Landslide | terrain + rainfall rasters | ❌ no artifact | ❌ none | ❌ none | ❌ none | ❌ | **Static susceptibility** PNG maps | `STATIC_SUSCEPTIBILITY` |

Legend: ✅ yes / verified · ◐ partial · 🔶 recorded historical claim · ❌ no / absent.

## Reclassification summary (Phase 10)

| Branch | Prior UI framing | Corrected framing |
|---|---|---|
| Rainfall | (corrected earlier) | Same-time classifier — NOT a forecast; `BASELINE` |
| Wind | "AVAILABLE_BASELINE", "Wind Forecast" | Case study; runtime `UNAVAILABLE` (TF crash); "Wind Field" |
| Flood | "AVAILABLE", "XGBoost/sklearn Pipeline", "Wind/Flood AVAILABLE" | Static spatial classification; `DATA_UNAVAILABLE`; raw XGBClassifier |
| Landslide | artifact `models/landslide_model.pkl` | No ML artifact; static hazard maps only |

## Demo-vs-real frontend separation
All simulated maps (`mockRainfall`, `mockWind`, `mockFlood`, `mockLandslide`)
already carry explicit "SIMULATED for demo" disclaimers; Wind's now additionally
says the real module is "non-runnable". The data-provider seam is untouched;
no code paths were fabricated.

## Files changed in Phase 10
- `src/models/wind/adapter.py` — TF import-health probe (subprocess), catchable
  `RuntimeError` on load, explicit `UNAVAILABLE` prediction (no fabricated
  fields), factory degrades gracefully.
- `tests/test_hazard_contracts.py` — +3 tests: wind no-crash/no-fabrication;
  flood no-future-rainfall-feature leak; rainfall results = last 4 of 12
  half-hourly snapshots (temporal holdout).
- `docs/model_audit/model_health_check.md` / `.json` — wind `model_loads`
  → False (TF SIGABRT) + runtime note.
- `docs/model_inventory.md`, `README.md` — wind runtime note.
- Frontend labels: `HazardsPage.tsx` (kicker "Forecast"→"Hazard", flood note,
  "WIND FORECAST"→"WIND FIELD"), `DashboardPage.tsx` (flood `available:false`),
  `LiveMonitorPage.tsx` (wind/flood statuses), `ReportsPage.tsx` (WIND BASELINE).
- `frontend/src/data/mock/MOCK.ts` — wind `UNAVAILABLE`/`RUNTIME_REQUIRED`, flood
  "raw XGBClassifier"/`DATA_UNAVAILABLE`, landslide artifact `""` + "none (static
  hazard maps)", rainfall `inputFeatures 25`.
- This report + `REPAIR_LOG.md` Phase 10 entry.

## Verification
- `python3 -m pytest -q` → **196 passed / 0 failed** (193 baseline + 3 new; wind
  TF-probe contract passes).
- Ruff: `src/models/wind/adapter.py` and `tests/test_hazard_contracts.py` clean
  (pre-existing adapter lint issues fixed while touching the file).
- Frontend build/typecheck NOT run (`node_modules/` absent; label-only edits are
  string/union-validated against `ModelOperationalStatus`).