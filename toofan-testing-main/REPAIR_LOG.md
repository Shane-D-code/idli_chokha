# TOOFAN Repair Log

Every change is recorded here with its rationale and test results. Rules followed:
never fabricate data or results, never hard-code outputs to pass tests, missing
artifacts are stated, and nothing is relabeled as "forecasting" that is not.

## Phase 0 — XGBoost Compatibility

### Problem

`tests/test_adapters.py` (RI adapter) errored 4x with
`TypeError: \`_estimator_type\` undefined. Please use appropriate mixin to
define estimator type.` raised inside `XGBClassifier.load_model`.
The recurvature tests failed separately because the model artifact is missing
(Phase 2), not because of the loader.

### Root cause

Installed pair is `xgboost 2.1.3` + `sklearn 1.8.0`. xgboost 2.1.3 still reads
the attribute `_estimator_type` when (de)serializing/Predicting through its
scikit-learn wrapper (`XGBClassifier`), but sklearn 1.8 removed
`_estimator_type` from `ClassifierMixin` in favour of `__sklearn_tags__`.
Verified independently: a bare

```python
xgb.XGBClassifier().load_model(json)
# and  xgb.XGBClassifier().save_model(json)
```

both raise `TypeError: _estimator_type undefined` on this environment, and
`predict_proba` on a legacy-loaded `XGBClassifier` additionally fails with
`AttributeError: 'XGBClassifier' object has no attribute 'n_classes_'`.
The low-level `xgb.Booster` API is unaffected.

### Files changed

- `src/models/adapters/ri_adapter.py` — `RIBranchModel` rewritten to use
  `xgb.Booster().load_model()` + `xgb.DMatrix(..., feature_names=...)` +
  `Booster.predict()`.
- `src/models/adapters/recurvature_adapter.py` — same Booster-based loading and
  prediction; `_get_feature_importance()` adapted to the Booster API
  (`get_score(importance_type='weight')`, the same default semantics that
  `feature_importances_` used).

### Exact fix

`ri_adapter.py` (`RIBranchModel`):

```python
self.model = xgb.Booster()
self.model.load_model(str(model_path))
self.feature_names = feature_names or self._saved_feature_names()

def _saved_feature_names(self):
    return list(self.model.feature_names or [])   # authoritative names/order

def predict_proba(self, X):
    return self.model.predict(xgb.DMatrix(X, feature_names=self.feature_names))
```

`recurvature_adapter.py`:

```python
self._model = xgb.Booster()
self._model.load_model(str(path))
...
dmatrix = xgb.DMatrix(X_scaled, feature_names=self._feature_cols)
prob = float(self._model.predict(dmatrix)[0])
```

`Booster.predict` applies the model's own objective, so for the legacy
`binary:logistic` models the returned value is exactly what
`XGBClassifier.predict_proba(...)` returned before (no semantic change).

The compatibility shim `XGBClassifier._estimator_type = "classifier"` was
**intentionally NOT added** to `recurvature/train_recurvature_model.py`
because that script only calls `fit`/`predict_proba`, which were verified to
work without the shim on this environment. It WILL be required in
`recurvature/src/train.py` before Phase 2 retraining, because there the model
is saved via `XGBClassifier.save_model()`.

### Tests before

- `pytest tests/test_adapters.py -k "ri or recurvature"`: **3 failed, 1 passed,
  4 errors** (RI = 4 errors from the XGB wrapper; recurvature = 3 failures from
  the missing artifact).
- `pytest tests/integration/test_native_model_compatibility.py`: **6 failed,
  2 passed**.
- Full suite: **124 passed, 10 failed, 9 errors** (143 total).

### Tests after

- Same adapter subset: **3 failed, 5 passed** (5 deselected). All 4 RI tests now
  PASS. The 3 remaining failures are recurvature `RuntimeError: Model not
  loaded` — the artifact `recurvature/xgb_recurve_model.json` does not exist;
  that is Phase 2 (retrain from real IBTrACS data), not a loader bug.
- Same native-compat file: **6 failed, 2 passed** — unchanged, all 6 are
  pre-existing Phase 1/2 blockers: 5× `FileNotFoundError` for the stale
  trajectory path `cyclone_path/checkpoints/v12_best_model.pt` (Phase 1) and
  1× `RuntimeError: Model not loaded` (recurvature artifact, Phase 2).
- Full suite: **128 passed, 10 failed, 5 errors** (143 total). The 4 previous RI
  errors became passes; no new failures/errors were introduced.

### Actual RI inference verification

Loaded the real legacy artifacts and ran the exact RI test fixture
(`tests/test_adapters.py` `TestRIAdapter.cyclone_state`):

- Booster loads for all three branches; objective is `binary:logistic` for all;
  saved feature-name counts are 12 (IMD), 89 (ERA5), 101 (IMD+ERA5).
- IMD feature order built by the adapter equals the order stored in the model
  (`True`), and the adapter's hardcoded 12-name list equals the saved list.
- Prediction executes: `probability_24h = 0.211017` (risk `LOW`), mode
  `IMD_ONLY` — the ERA5/combined branches are honestly not exercised because the
  fixture supplies no ERA5/SST data; no ERA5 features are fabricated.
- Output is a scalar in `[0, 1]`.

### Remaining failures (expected, out of Phase 0 scope)

- Trajectory adapter: 5 errors — tests point to `cyclone_path/checkpoints/
  v12_best_model.pt`, but the real artifact is the repo-root distilled LT3P
  checkpoint. → Phase 1.
- Recurvature: 3+1 failures — model artifact missing (`recurvature/
  xgb_recurve_model.json`). → Phase 2 (retrain from `wind/ibtracs.NI.list.
  v04r01.csv`).
- Other pre-existing failures (orchestrator dependency-graph, native
  model-compat path issues, etc.). → Phases 4/1.

## Phase 1 — Fix stale trajectory model path in tests

### Root cause

The trajectory adapter tests pointed at a checkpoint that does not exist in this
repo: `cyclone_path/checkpoints/v12_best_model.pt`. The real, deployed artifact
is the repository-root distilled LT3P forecaster:
`best_cyclone_model_lt3p_distilled.pth` + `scalers.pkl` (wrapped via
`cyclone_path_deployment_package`). The tests could never load the model, so all
five trajectory tests errored on the fixture with `FileNotFoundError:
checkpoint not found: cyclone_path/checkpoints/v12_best_model.pt`.

### Files changed

- `tests/test_adapters.py`
  - fixture: `create_trajectory_adapter('cyclone_path/checkpoints/v12_best_model.pt')`
    → `create_trajectory_adapter('best_cyclone_model_lt3p_distilled.pth')`.
  - `test_adapter_loads`: expected `model_info.name` corrected from the
    non-existent `"cyclone_trajectory_v12"` to the factory's actual
    `"cyclone_track_distilled"` (the V12-prefixed name is not produced anywhere).
  - `test_predict`: expected `model_version` corrected `"v12"` → `"lt3p"`.
- `tests/integration/test_native_model_compatibility.py`
  - 5 occurrences of the stale path → `best_cyclone_model_lt3p_distilled.pth`.
  - `test_trajectory_and_recurvature_coexist`: `model_version == "v12"` →
    `"lt3p"`.

No production code was changed. The real model artifact was not renamed, copied,
or duplicated to satisfy the tests.

### Artifact used

`best_cyclone_model_lt3p_distilled.pth` (3,912,349 B) + `scalers.pkl` (2,593 B),
both at repository root — exactly what the deployment tries to load by default.
Note: loading `scalers.pkl` raises a sklearn `InconsistentVersionWarning` (scaler
was pickled with sklearn 1.6.1, loading on 1.8.0); it still unpickles and
inference works, but this is recorded for the Phase 7 doc/health audit.

### Model version detected

`lt3p` (adapter default; `model_info.version = "lt3p"`, `model_info.name =
"cyclone_track_distilled"`).

### Tests before (after Phase 0)

| Test | Before | After |
| --- | --: | --: |
| Trajectory adapter (`-k trajectory`) | 5 errors (stale path) | 4 passed, 1 failed |
| Native compatibility | 6 failed / 2 passed | 5 failed / 3 passed |
| Full suite | 128 passed / 10 failed / 5 errors | **133 passed / 10 failed / 0 errors** |

### Remaining failures/errors after Phase 1

- 5 native-compat + 3 recurvature-adapter failures → `RuntimeError: Model not
  loaded` (recurvature artifact `recurvature/xgb_recurve_model.json` is missing).
  → Phase 2.
- `test_orchestrator.py::test_dependency_graph_structure` → → Phase 4.
- `tests/test_adapters.py::TestTrajectoryAdapter::test_predict` — now runs the
  REAL model and fails the "uncertainty grows with lead time" assertion because
  the deployed model's per-horizon uncertainty is NOT monotonic:
  `uncertainty_km = [209.9, 189.1, 202.8, 209.9, 209.9, ...]`. The learned
  uncertainty head saturates (~210 km) above the `10 + 2.5h` floor in
  `trajectory_adapter._infer`, so the floor never binds and the two early dips
  pass through. This is a genuine model-output property (not a path bug); the
  assertion was previously never exercised because the fixture errored. This is
  a Phase 5 (trajectory uncertainty honesty) item — the assertion was NOT
  weakened and inference was NOT modified in Phase 1.

### Recorded for Phase 7 (not changed in Phase 1)

Obsolete `cyclone_path/checkpoints/v12_best_model.pt` references also appear in
documentation/frontend, separate from the test/path issue:
`README.md` (lines 23, 72, 79, 82, 124), `docs/model_inventory.md` (20, 179, 594),
`docs/model_audit/model_health_check.md` (65, 147),
`docs/model_audit/model_health_check.json` (118),
`docs/debug/native_crash_environment.md` (45),
`docs/debug/native_crash_root_cause.md` (12, 37, 283, 295, 307),
`docs/model_audit/landslide_model_audit.md` (46),
`frontend/src/data/mock/MOCK.ts` (92, 497, 509). → Phase 7.

## Phase 2 — Recurvature Model Rebuild

### Root cause

The production artifact `recurvature/xgb_recurve_model.json` did not exist, so
the recurvature adapter could never load a model and 8 tests failed with
`RuntimeError: Model not loaded`. The repo ships real training code and the real
IBTrACS North-Indian-Ocean dataset, but the trained model file was never
committed. Note: `.gitignore:14` (`xgb_recurve_model.json`) excludes built model
artifacts from version control, so the artifact must be regenerated by running
the training script on any fresh checkout — committing the built model is
against repo policy.

### Real dataset used

`wind/ibtracs.NI.list.v04r01.csv` (IBTrACS, North Indian basin, full archive).

After `load_clean` (SEASON ≥ 1980, TRACK_TYPE == main, ≥ 12 fix points per
storm, non-null lat/lon/STORM_DIR/STORM_SPEED):

| Quantity | Value |
| --- | ---: |
| Raw rows (season ≥ 1980, main track) | 17,798 |
| Cleaned rows | 17,304 |
| Unique storms | 396 |
| Seasons | 1980–2025 |
| Fix cadence | 3 h (median dt) |
| Label-non-null (usable) rows | 14,136 |
| Positive labels (recurving) | 3,923 (27.7%) |
| Negative labels | 10,213 |
| Rows discarded (no +24 h fix available) | 3,168 (= 8 × 396; last 8 fixes of each storm) |

### Exact target definition (recurvature label)

From `recurvature/src/features.py`:

- `future_dir = STORM_DIR.shift(-8)` → the storm's heading **8 fix steps (~24 h)
  later**.
- `heading_swing = min_circular_abs(future_dir − current_dir)` in (−180, 180].
- `recurve_label = 1` if `heading_swing ≥ 45°`, else 0; NaN where no future fix
  exists (dropped).

So "recurvature within 24 h" = **the storm's heading 24 h from now points at
least 45° away (smallest circular difference) from its heading now.** The label
intentionally uses a future fix — that is the target, not a feature.

### Exact feature list + provenance (all 12, order FEATURE_COLS)

| # | Feature | Source | Observed/derived | Uses history? | Uses future? | Synthetic? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `lat` | IBTrACS USA_LAT→LAT | observed (current) | no | no | no |
| 2 | `lon` | USA_LON→LON | observed (current) | no | no | no |
| 3 | `wind` | USA_WIND→WMO_WIND, per-storm interpolate+ffill+bfill | observed, imputed | within-storm imputation | only for missing-value fill *(see caveat)* | no |
| 4 | `pres` | USA_PRES→WMO_PRES, same | observed, imputed | within-storm imputation | only for missing-value fill *(see caveat)* | no |
| 5 | `STORM_SPEED` | IBTrACS | observed (current) | no | no | no |
| 6 | `dir_sin` | sin(deg2rad(STORM_DIR)) | derived (current heading) | no | no | no |
| 7 | `dir_cos` | cos(deg2rad(STORM_DIR)) | derived (current heading) | no | no | no |
| 8 | `month_sin` | ISO_TIME month | derived (seasonality) | no | no | no |
| 9 | `month_cos` | ISO_TIME month | derived (seasonality) | no | no | no |
| 10 | `DIST2LAND` | IBTrACS DIST2LAND column | observed (0–1560 km, median 238) | no | no | no |
| 11 | `dir_change_3h` | `STORM_DIR.diff(1)` (prev fix) | derived (history) | **yes (t−3h)** | no | no |
| 12 | `dir_change_9h` | `STORM_DIR − shift(3)` | derived (history) | **yes (t−9h)** | no | no |

### `dir_change_3h` / `dir_change_9h` — honest calculation

Both ARE computed from real historical IBTrACS track fixes at training time
(diff/shift within `SID`). Missing values occur only on the first 1–3 fixes of a
storm (no earlier heading) — 396 / 1,188 rows — and are filled with 0 in
`make_tabular` (flagged in this log, not hidden). They are NOT available at
adapter inference time from a lone `CycloneState`, so the adapter marks them
`placeholder_zero` (or `forecast_estimate` if a trajectory forecast is passed)
and penalises confidence accordingly (see STEP 8 below).

### Leakage audit — PASS (with noted imputation caveat)

- Storm-wise split only: `storm_split` partitions **SIDs** (stratified on
  per-storm positive/negative) → train 276 / val 60 / test 60 storms; no storm
  appears in more than one split.
- `StandardScaler` fitted on `X_tr` only; val/test transformed with that fit.
- Label never enters the feature matrix; `dir_change_*` use only past headings;
  `DIST2LAND` is contemporaneous (IBTrACS-provided, position-dependent).
- Training config/metrics never tuned against the test split.
- **Caveat (non-target, imputation-only):** missing `wind`/`pres` are filled
  with per-storm linear interpolation + ffill + bfill, so for the ~13% (wind) /
  42% (pres) of rows that needed any fill, the imputed value may use values from
  before *and after* the fix. That is standard contemporaneous imputation and
  does not feed the future heading into any feature. Quantified: pure
  future-only backfill affected 254 wind / 1,297 pres rows of 17,798 raw.

### Model configuration (preserved training methodology)

`xgb.XGBClassifier(n_estimators=400, max_depth=4, learning_rate=0.05,
subsample=0.8, colsample_bytree=0.8, scale_pos_weight=2.64 (from train-class
imbalance), eval_metric=logloss, random_state=42, early_stopping_rounds=30)`,
trained on scaled features, early stopping on val. `best_iteration = 144`.
Seed 42.

### Metrics (test split: 2,085 samples / 60 storms / 567 pos / 1,518 neg)

| Metric | ML model | Baselines |
| --- | ---: | --- |
| Accuracy | 0.670 | majority-class 0.728 |
| Precision | 0.424 | n/a (majority predicts 0) |
| Recall | 0.593 | 0.0 |
| F1 | 0.494 | 0.0 |
| ROC-AUC | 0.722 | 0.5 (chance) |
| PR-AUC | 0.522 | 0.272 (prevalence) |
| Brier | 0.205 | 0.272 (majority); 0.198 (constant-prevalence) |

Confusion matrix ([[TN FN],[FP TP]]) = [[1061 457],[231 336]] at threshold 0.5.

**Does the ML model improve over baseline?** Yes for discrimination (ROC-AUC
0.72 vs 0.5, PR-AUC 0.52 vs 0.27) — the model genuinely ranks recurving fixes
above non-recurving ones. But it is **not well calibrated**: Brier (0.205) is
worse than a constant-prevalence predictor (0.198), and at a 0.5 threshold raw
accuracy trails the majority class. Verdict: useful ranking signal, weak
calibration; treat outputs as uncalibrated probabilities.

### Artifact path

- `recurvature/xgb_recurve_model.json` — XGBoost model (Booster JSON,
  `binary:logistic`, 12 real feature names stored on the booster).
- `recurvature/scaler.joblib` — fresh `StandardScaler` fitted on train (replaces
  an old scaler pickled with sklearn 1.9.0).
- `recurvature/model_metadata.json` — label def, feature names, split/sample
  counts, config, best_iteration, metrics.
- `recurvature/test_predictions.csv` — SID/NAME/ISO_TIME/prob/label for every
  test sample.
- `recurvature/results.csv`, `recurvature/feature_importance.json`.

### Changes to `recurvature/src/train.py` (methodology-preserving, minimal)

- Added the xgboost/sklearn compat shim (`_estimator_type = "classifier"`,
  only if missing) — required here because this entry point calls
  `XGBClassifier.save_model()`. Verified this is the only place it is required.
- Set `model.get_booster().feature_names = FEATURE_COLS` before saving so the
  artifact is self-describing and runtime adapters validate column alignment.
- Added additive outputs (scaler, metadata, test predictions); no change to
  dataset, labels, features, model architecture, hyperparameters, or evaluation.

### Adapter verification — PASS (limited mode)

Historical test case (real IBTrACS fix, SID `1987150N13095`, 1987-05-31 12:00Z,
wind 25 kt, pres 990 hPa): adapter loaded the new artifact, feature order
validated against stored names, prediction executed → probability **0.375**
(risk MODERATE). Direct Booster run on the same row's REAL features → 0.378
(agreement here because placeholders coincide for this state).

### Tests before → after

| Test | Before (Ph.1) | After (Ph.2) |
| --- | ---: | ---: |
| Recurvature adapter | 3 failed / 1 passed | **4 passed** |
| Native model compatibility | 5 failed / 3 passed | **8 passed** |
| Full suite | 133 passed / 10 failed / 0 errors | **141 passed / 2 failed / 0 errors** |

Remaining 2 failures are out of Phase 2 scope: trajectory `test_predict`
(non-monotonic uncertainty, Phase 5) and orchestrator dependency-graph
(Phase 4).

### STEP 8 — placeholder features (explicit, not hidden)

At inference time a lone `CycloneState` cannot supply:
- `DIST2LAND` — adapter uses a coarse 200/300/500 km estimate
  (`_estimate_dist_to_land`), NOT the real IBTrACS value;
- `dir_change_3h` / `dir_change_9h` — set to 0 (or `dir_change_3h` derived from
  the trajectory forecast when one is passed).

Handling added:
- `_feature_sources` dict records the provenance of every input for that call.
- `_confidence_from_sources()` penalises placeholder inputs (confidence 0.95 −
  0.35 per placeholder_zero − 0.35 for coarse DIST2LAND, floor 0.25); previously
  confidence was a fixed 0.7.
- `explain()` now returns `feature_sources` and an explicit `limitations` list
  stating the runtime prediction is LIMITED when real history/DIST2LAND are not
  supplied. No fabricated values are presented as observations.

### Remaining limitations (Phase 2)

- Runtime predictions without real track history are LIMIITED (placeholder
  inputs) — clearly flagged via confidence + `explain()`.
- Model calibration is weak (Brier worse than constant-prevalence baseline);
  probabilities should be calibrated (isotonic) before operational use → later.
- `wind`/`pres` imputation uses both-side interpolation (minor, non-target).
- The `dist_change`/`DIST2LAND` adapter estimates are placeholders, not the
  trained feature distribution.
- Training Feature importance file is per-`get_score` (weight).

## Phase 3 — RI Integration Audit

### STEP 1 — Branch artifact audit (imperative table)

| Branch | Artifact in repo | Runtime load | Runtime feature builder | Runtime predict prob | Prior research verdict |
|---|---|---|---:|---|---|
| **IMD** | `cyclone_backup/models/imd_final_xgboost.json` (121 849 B, 12 features) | YES (xgb.Booster) | YES (12 IMD trend features from `CycloneState`) | YES — live verified `0.7524` (EXTREME for intense case) | Best single branch (PR-AUC 0.594 strict common; only proven defensible model) |
| **ERA5** | `era5_final_xgboost.json` (131 253 B, 89 features) | YES (Booster loads) | NO — `CycloneState.get_era5_environmental_dict()` returns 17 fields; 89 derived reanalysis features cannot be reconstructed at runtime | NO (would fail feature mismatch) | No proven additive value (dPR-AUC −0.25 vs IMD; CI [−0.474, +0.039]) |
| **IMD+ERA5 combined** | `imd_era5_final_xgboost.json` (77 947 B, 101 features) | YES (Booster loads) | NO — same mismatch (101 vs 17) | NO | No proven additive value (same report) |
| **Satellite CNN** | `satellite_cnn.pt` (1.26 MB) + 3 `.keras` variants | Attempted lazy load — requires Colab RICNNFusion weights + fold scaler under `results/` (missing) | Partial — IR image OK, tabular OK, scaler missing | NO (scaler absent) | Not shown to add value (PR-AUC 0.516 vs 0.944 IMD; N=9/7 storms; all probs >0.74; badly calibrated) |
| **Fusion meta-model** | **Does not exist** | n/a | n/a | n/a — adapter previously used a simple average fallback, which is not a trained model | Late fusion 0.40 < IMD 0.428; three-way NOT EVALUABLE (disjoint ERA5/TCIR coverage) |

### STEP 2 — Architecture changes

1. Only `IMD_ONLY` mode at runtime; `ERA5`/`combined`/`satellite` branches are
   loaded as Boosters (for existence/honesty) but never called.
2. `FULL_MULTIMODAL`, `IMD_ERA5`, `SATELLITE_ONLY` modes removed from runtime
   (unreachable).
3. `fusion_probability` always `None` — no fabricated averaged probability.
4. Confidence based on IMD branch alone (0.55 when present; 0.0 when absent).

### STEP 3 — Output semantics

Mode field now reflects what is actually running:
- `IMD_ONLY` — IMD Booster running, ERA5/satellite/fusion unavailable.
- `UNAVAILABLE` — IMD branch not loaded.

All branch probabilities that cannot be honestly computed are returned as `None`.
Explanation string includes explicit reasons why each unavailable branch is not
used.

### STEP 4 — Mode-gating implementation

The new `_determine_mode` returns only `IMD_ONLY` or `UNAVAILABLE`. The new
`predict` calls only `self._imd_branch.predict_proba` (real features from
`CycloneState`); all other branches are never invoked.

### STEP 5 — Tests added

| Test | Purpose |
|---|---|
| `test_imd_only_mode` | Verifies runtime mode is `IMD_ONLY` |
| `test_era5_probability_not_fabricated` | ERA5 env features provided + branch artifact loaded → ERA5 probability remains `None` |
| `test_satellite_not_fabricated` | IR image provided → satellite/fusion probabilities remain `None` |
| `test_no_fusion_averaging` | `fusion_probability` is `None`; `calibrated_probability == imd_probability` |
| `test_unavailable_mode_without_imd_artifact` | Missing IMD path → mode `UNAVAILABLE`, output honest `0.0` / `NONE` / all `None` |
| `test_explain` | Updated to verify branch predictions dict has `None` for all non-IMD entries |

No existing tests were weakened or deleted. All existing tests continue to pass.

### STEP 6 — Live verification

Loaded `cyclone_backup/models` with IMD+ERA5+combined branches (Boosters) all
present; satellite branch not used; mode = `IMD_ONLY`. Example output:

- `probability_24h = 0.7524`, `risk = EXTREME` (for the intense 1998-008 deepening case with strong IMD trends).
- `imd_probability = 0.7524`; `era5_probability = None`; `satellite_probability = None`; `fusion_probability = None`; `calibrated_probability = 0.7524`.
- `explanation` text includes "ERA5 UNUSED: runtime cannot reconstruct its 89 features...", "Satellite UNUSED: requires Colab CNN artifacts + fold scaler; no proven skill (N=9)", "Fusion UNUSED: no trained fusion meta-model artifact exists".

### STEP 7 — Reproducibility status

- **IMD branch:** REPRODUCIBLE — artifact present, adapter verified, adapter tests pass.
- **ERA5/satellite/fusion:** NOT RUNNABLE FROM CURRENT REPOSITORY — feature builders
  (`run_pipeline.py`/`run_final_multimodal.py` steps), scaler, Colab CNN, and
  fusion meta-model are missing; `cyclone_backup/results/` directory is absent (all
  comparison/ablation JSON/predictions live there per the report).
- Overall RI reproducibility status: **PARTIALLY REPRODUCIBLE** (IMD branch only;
  ERA5/satellite/fusion models exist as artifacts but cannot execute at runtime).

### STEP 8 — Tests run

```
tests/test_adapters.py::TestRIAdapter         9 passed
tests/integration/test_native_model_compatibility.py  3 passed  (+5 existing)
Full suite                                      146 passed / 2 failed / 0 errors
```

The 2 remaining failures are pre-existing and out of Phase 3 scope:
- `test_adapters.py::TestTrajectoryAdapter::test_predict` — non-monotonic
  uncertainty (Phase 5).
- `test_orchestrator.py::test_dependency_graph_structure` — orchestrator registers
  modules only if model loads (Phase 4).

### Remaining RI limitations

- IMD model is the only branch that runs; ERA5/satellite/fusion are honestly
  unavailable at runtime and their metrics live only in historical report text.
- Prior RI experiment results (model comparison, ablation, TCIR, satellite OOF
  metrics) are NOT reproducible from the current repo — `results/` dir absent.
  The canonical report (`SIH_FINAL_RI_REPORT.md`) is historical and reflects
  those experiments accurately, but rerunning the experiments is not possible
  without the missing `results/` artifacts.
- `imd_final_xgboost.json` reproduces exactly the IMD branch probability
  for the same inputs (no fabricated features).

## Phase 4 — Orchestrator DAG

### STEP 1 — Root cause

`PipelineOrchestrator._initialize_modules()` registered a graph node only when
`_load_module_model()` returned a model. Any module whose artifact failed to
load (missing artifact, broken adapter, version mismatch) silently vanished
from the DAG, and `execute()` skipped nodes that were not in the graph. The net
effect: the orchestrator executed **fewer modules than the pipeline declares**,
and `test_mock_execution_full` previously passed while executing **zero**
modules (all mock loads "failed" → empty graph → trivial empty result).

### STEP 2 — Architecture changes

`src/pipeline/orchestrator.py`:

1. Every module in `DEFAULT_DEPENDENCIES` (10 modules) is now registered
   unconditionally in `_initialize_modules()`.
2. `ModuleSpec.model` is now `BaseModel | None` (was `BaseModel`).
3. `ExecutionResult` gains `status` (`"SUCCESS"` / `"FAILED"` / `"UNAVAILABLE"`)
   and `reason`; `success` is `True` only for `status == "SUCCESS"`.
4. `execute()` raises `RuntimeError` only for a non-optional module whose
   status is `"FAILED"` (a real execution error). `UNAVAILABLE` never crashes.
5. `_execute_module()` returns an explicit `UNAVAILABLE` result (output `None`,
   reason set) when:
   - the module's model is `None` (except the model-less `HAZARD_ENGINE`), or
   - a required upstream output is missing, via the edge map
     `{RAINFALL: [TRAJECTORY, INTENSITY], WIND: [TRAJECTORY, INTENSITY],
     FLOOD: [RAINFALL, WIND], LANDSLIDE: [RAINFALL]}`.
   `RECURVATURE` is intentionally NOT blocked on a `None` track (its adapter
   genuinely supports it — Phase 2). `RI` remains an artifact-availability
   module like the rest.
6. `_build_unified_state()` guards `spec.model is None` before reading
   `model_info.version`; `get_execution_summary()` reports `modules_unavailable`
   separately from `modules_failed`.

`src/pipeline/hazard_engine.py`:

7. `_track_spread_km()` no longer imports the (removed) `_hav_km_np` helper
   from `src.core.schema`; the haversine estimate is computed inline. This was a
   latent defect that only surfaced once all modules started executing.

### STEP 3 — DAG before / after

| | Before Phase 4 | After Phase 4 |
|---|---|---|
| Modules registered | Only those whose model loaded | All 10 `DEFAULT_DEPENDENCIES` modules |
| Model missing | Node removed, module silently skipped | Node kept; runtime `UNAVAILABLE` status + reason |
| `test_mock_execution_full` | Passed with **empty** graph (nothing ran) | Executes all modules; asserts all results `SUCCESS` and all outputs set |
| Downstream of unavailable module | Skipped (node absent) | Explicit `UNAVAILABLE` with `dependency unavailable: <name>` reason |

### STEP 4 — Tests

`tests/test_orchestrator.py` — 6 new tests (+1 hard assertion added to
`test_mock_execution_full` guarding against silent node skipping):
`test_all_declared_modules_registered`, `test_dag_structure_matches_default
_dependencies`, `test_missing_artifacts_do_not_remove_dag_nodes`,
`test_execution_order_full_graph`, `test_unavailable_modules_report_explicit
_status`, `test_downstream_unavailable_when_dependency_missing`.
`MockModel.predict` is now variadic (`*args, **kwargs`), reflecting that module
predict interfaces legitimately take different numbers of arguments.

### STEP 5 — Results

| Suite | Before | After |
|---|---|---|
| `tests/test_orchestrator.py` | 8 passed / 1 failed | 15 passed / 0 failed |
| Full suite | 146 passed / 2 failed / 0 errors | **153 passed / 1 failed / 0 errors** |

The single remaining failure is `test_adapters.py::TestTrajectoryAdapter::test_predict`
(non-monotonic trajectory uncertainty) — Phase 5 scope, intentionally not
touched. Ruff violations in the changed files match the pre-existing profile
(no new issues introduced).

## Phase 5 — Trajectory Uncertainty

### Original failure

`tests/test_adapters.py::TestTrajectoryAdapter::test_predict` asserted
`uncertainty_km` is non-decreasing with lead time. The deployed LT3P-distilled
model emits approximately `[209.9, 189.1, 202.8, 209.9, 209.9, ...]`, failing
the monotonicity assertion. Phase 1 showed this is a real model-output
property, not a path bug.

### Uncertainty calculation (exact transformation)

1. `cyclone_path_deployment_package/model.py` — `CycloneForecaster` produces,
   per horizon, a 2-d `uncertainty` output from a dedicated head
   (`nn.Linear(hidden_dim//2, 2)`), **clamped to `[-5, 5]`** in `forward()`.
   The raw head values are not clipped anywhere else.
2. `cyclone_path_deployment_package/inference.py` — the two channels are named
   `log_std_east` / `log_std_north`.
3. `src/models/adapters/trajectory_adapter.py::_infer`:
   - `se = exp(clip(log_std_east, -10, 10))`, `sn = exp(clip(log_std_north, -10, 10))`
   - `sigma = hypot(se, sn)`
   - `aleatoric_km = min(250, max(10 + 2.5*h, sigma))`
4. `predict()` maps each sigma to the matching forecast hour (2..24 h step 2).

So the model outputs **per-axis log-standard-deviation** (units km, exp →
km), the adapter combines the two axes by euclidean norm, applies a growing
lower floor `10 + 2.5*h` and a 250 km cap. (The training loss that produced the
head is not in the repo — the deployment package is inference-only — so
whether the head was optimized as log-σ vs log-σ² cannot be confirmed from the
artifacts; either way it saturates.)

### Actual model behavior (STEP 3 — several historical cases)

Measured with the real checkpoint on 8 synthetic NIO climate cases plus 3
historically-informed storm fixes (Hudhud 2014, Mocha 2023, Fani 2019; and the
test case). The head output is pinned at the **upper clamp `log_std = +5.0`
→ `std = 148.41 km`/axis → `hypot = 209.87 km`** for virtually every horizon
and every case; occasional horizons sit a few tenths below 5 (e.g. the test
case's `189.1` at +4h, `202.8` at +6h come from `log_std_north ≈ 4.76/4.93`).
Results:

| Case | log_std (east/north) | reported sigma_km |
|---|---|---|
| test 2024 (15N/85E) | 5.0 everywhere except north 4.76/4.93 at +4/+6h | 209.9, 189.1, 202.8, 209.9×9 |
| VSCS 15N/86E | east 5.0; north 4.21–4.51 at +4..+10h | up to 209.9 rev. to 111.5–163.6 |
| slow recurver 18N/89E | 5.0 everywhere | 209.9 ×12 |
| north-mover 13N/83E | 5.0 everywhere | 209.9 ×12 |
| fast/deep 12N/91E | 5.0 everywhere | 209.9 ×12 |
| south-mover 20N/87E | east 5.0; north 4.61–4.74 | dips to ~179–188 |
| Arabian Sea 19N/62E | 5.0 everywhere | 209.9 ×12 |
| BoB 16N/84E | 5.0 everywhere | 209.9 ×12 |
| Hudhud 2014 | 5.0 everywhere | 209.9 ×12 |
| Mocha 2023 | 5.0 everywhere | 209.9 ×12 |
| Fani 2019 | 5.0 everywhere | 209.9 ×12 |

Saturation is at the **model's output clamp ceiling**, not the adapter's 250 km
cap and not the 10 + 2.5h floor (max 70 km) — the floor never binds. The head
is nearly constant and effectively uninformative as a function of horizon.
Determinism check: repeated `predict()` returns identical sigma/lat/lon (eval
mode).

### Is monotonicity a scientific requirement? (STEP 2)

- No training code, loss, or architecture spec for the LT3P-distilled student
  exists in the repo (deployment package is inference-only). There is NO
  documented training contract that guarantees, or even targets, uncertainty
  that increases with forecast horizon.
- The only in-repo "grows with lead time" claims trace to documentation of the
  **different, absent** V12 model (`cyclone_path/...` does not exist in the
  repo): `README.md` (sigma_km "grows with lead time"; its own example shows a
  constant `0.006738` through +6h), `docs/model_inventory.md`, and
  `docs/model_audit/model_health_check.{md,json}` (V12 entry; E2E trace row
  "uncertainty [15-70 km]" matches the floor, not the deployed model's output).

**Conclusion: CASE B — monotonicity was an assumption baked only into the
test, with no basis in the deployed model's design.** The constant ~210 km
output is however also NOT a valid "calibrated" or "growing" uncertainty: it is
a saturated, near-constant bound.

### Root cause

- The distilled student's uncertainty head has saturated at its `[-5,5]`
  clamp ceiling (`log_std = +5.0`) for essentially all inputs. The pipeline
  then reports `hypot(east,north) ≈ 209.9 km` for every horizon because the
  `10 + 2.5h` floor (≤70 km) is far below it.
- Not a conversion bug: `exp(logσ)` → hypot is a standard parametric
  transformation, and the perturbation is a learned/clamped property, not a
  units or normalization error.

### Verdict (STEP 5)

**Outcome 2 — DEGENERATE/UNINFORMATIVE (VERDICT: DEGENERATE; status =
LIMITED/UNVERIFIED).**
- Point forecast: works (displacements decoded per horizon; historical and
  synthetic cases produce plausible tracks).
- Uncertainty: the head output is a broad constant bound (~209.9 km), not
  horizon-dependent, not calibrated to observed track error.
- Retraining: **NOT REQUIRED in this phase.** The recommendation to retrain /
  rebuild the uncertainty head with a proper horizon-aware loss is recorded
  for later; no in-repo evidence justifies modifying weights now.

### Changes made (STEP 7)

`src/models/adapters/trajectory_adapter.py` (runtime honesty — numbers
unchanged):
- `_infer()` docstring: the floor is a lower bound; in practice the head
  saturates ~209.9 km above it, so sigma is not horizon-calibrated (removed the
  unverifiable "matching empirical track error growth" phrase).
- `predict_with_uncertainty()`: `epistemic_scale` changed from fabricated
  `[1.0]*n` to `None`; adds `status: "LIMITED/UNVERIFIED"` and `notes`
  documenting the saturated, non-calibrated, non-growing nature and that
  epistemic uncertainty is not quantified.
- `explain()`: adds `uncertainty_status`/`uncertainty_note` with the same
  honest caveats.

`tests/test_adapters.py::TestTrajectoryAdapter`:
- `test_predict` no longer asserts monotonicity. It now validates the genuine
  contract: 12 horizons at +2..+24h, finite/positive sigma, bounded below by
  `10 + 2.5h` and above by 250 km, sigma associated with the correct horizon,
  `position_error_estimates_km == uncertainty_km`.
- `test_predict_is_deterministic` (new): repeated predictions identical.
- `test_predict_with_uncertainty` rewritten: asserts aleatoric matches the
  prediction, `status == "LIMITED/UNVERIFIED"`, `epistemic_scale is None`, and
  notes mention the saturation.
- No values hard-coded; no `sorted()`; no artificial monotonic post-processing.

No changes to model weights, checkpoint, or the deployment package.

### Tests before / after (STEP 8)

| Suite | Before | After |
|---|---|---|
| Trajectory adapter (`-k trajectory`) | 4 passed / 1 failed | 6 passed / 0 failed |
| Adapters + schema + native-compat + orchestrator | — | 62 passed / 0 failed |
| Full suite | 153 passed / 1 failed / 0 errors | **155 passed / 0 failed / 0 errors** |

Ruff: `trajectory_adapter.py` (2) and `test_adapters.py` (3) still at
pre-existing baseline; no new issues.

### Remaining trajectory limitations

- **Point forecast**: functional, but azimuth/motion confidence is a kinematic
  consistency heuristic; track skill vs. the absent V12 baseline is not
  re-verified in this repo.
- **Uncertainty**: LIMITED/UNVERIFIED — constant ~209.9 km saturated bound;
  NOT calibrated, NOT horizon-growing. The `10 + 2.5h` floor (≤70 km) never
  binds in practice.
- **Fabricated/synthetic history** (STEP 6, unchanged): `_build_history_observations`
  reconstructs a linear 12-point 2-hourly history by back-propagating
  the current fix along heading/speed/intensity trends. This is not real
  atmospheric or best-track data; it is a synthetic stand-in and remains a
  later task (real-history integration).
- **Recorded for Phase 7 (docs, NOT changed now)**: correct the "uncertainty
  grows with lead time" / "PRODUCTION-READY ... calibrated outputs" claims and
  stale `cyclone_path/checkpoints/v12_best_model.pt` artifact references in
  `README.md`, `docs/model_inventory.md`, `docs/model_audit/model_health_check.
  {md,json}`, and soften `frontend` "Uncertainty Cone" labeling.
## Phase 6 — Intensity Model Audit

### Context

`docs/model_inventory.md` claimed the 24h intensity XGBoost model was
"TRAINED / VALIDATED — 5-fold storm-wise CV: MAE 14.55 kt, RMSE 19.66 kt,
R² 0.037; Classification: Exact 45.3%, Within-1 84.0%", and
`src/models/adapters/intensity_adapter.py` **hard-coded**
`uncertainty_kt = 14.55  # From 5-fold storm-wise CV` as the per-prediction
uncertainty. Both needed an honesty audit.

### STEP 1 — Current reality (established)

- `cyclone intensity/` contains a self-contained package (`README.md`,
  `main.py`, `src/{utils,preprocessing,regression,classification,evaluation}.py`,
  `notebook/cyclone_intensity_prediction_part2.py`).
- `cyclone intensity/{models,data,results}/` **do not exist** in this repo.
  No trained artifact, no modeling dataset, no evaluation results anywhere
  (`grep -rln "msw_target_24h"` matches only code/docs).
- `main.py` requires `data/processed/clean_model_data.csv`; it is **not**
  reproducible from the repo: `preprocessing.build_cyclone_history_dataset`
  builds the IMD lag features only — the 17 ERA5 columns and the final CSV
  writer exist only in the legacy Colab script (needs Copernicus CDS creds).
- Therefore the 14.55 kt MAE (and related metrics) is a **HISTORICAL CLAIM —
  NOT REPRODUCED FROM CURRENT REPOSITORY**.

### STEP 2/3 — Scientific-method audit of the training code (usable when data returns)

- Target is genuine 24h forecast: `msw_target_24h` = best-track MSW matched at
  t+24h ± 2h (nearest fix).
- Features are strictly as-of or past: 6/12/24h lag/change values matched from
  the row time with ≤1.5h tolerance — **no lookahead**.
- Validation is **storm-wise `GroupKFold(storm_id)`** — no random row splits,
  no same-storm train/val leakage. Deterministic `random_state=42`.

**Outcome B** (training code exists, but data + artifact + results are
missing). The pipeline cannot currently run or be verified; the fix is a
deterministic retraining recipe, not a code-method overhaul.

### STEP 7 — Changes made

1. **Schema** (`src/core/schema.py`): `IntensityPrediction` gains
   `status: str = "AVAILABLE"` and `reason: Optional[str] = None`
   (mirrors `LandslidePrediction`).
2. **Honest adapter** (`intensity_adapter.py`):
   - **Removed** the fabricated/hard-coded `uncertainty_kt = 14.55`;
     `uncertainty_kt` is now `None` (point-forecast regressor; no calibrated
     per-prediction uncertainty).
   - `predict()` with a **missing artifact** returns an explicit
     `IntensityPrediction(status="UNAVAILABLE", ...)` (all values None)
     instead of raising.
   - `predict()` with an artifact returns real model output flagged
     `status="UNVERIFIED"` plus a `reason` listing every degradation:
     `lat_change_6h`/`lon_change_6h` always 0.0 (not in `CycloneState`),
     missing wind-change/translation features filled 0.0, all-ERA5-absent →
     filled 0.0.
   - **Unit fix**: ERA5 temperature features converted Kelvin→°C
     (`EnvironmentalFeatures` stores K; training `era5_t*` are °C).
   - `_build_features` now returns a named `DataFrame` with the exact 30-column
     order (matches how the pipeline was fitted; removes a sklearn
     feature-names warning).
   - `predict_with_uncertainty`/`explain` surface `status`/`reason` and the
     absence of calibrated confidence.
3. **Reproducibility** (`cyclone intensity/retrain.py`, new): deterministic
   retraining entry point. Validates the expected schema (30 features +
   `storm_id` + `msw_target_24h`), runs storm-wise GroupKFold CV, fits and
   saves `models/final_xgb_regressor.joblib` (exactly the path the inference
   adapter loads), writes `models/training_report.json` for that run. If the
   dataset is absent it prints the documented real-data recipe and **refuses
   to fabricate/substitute data** (exit 1). Deferred imports keep the
   recipe/validation path runnable without plotting deps.
4. **Tests** (`tests/test_intensity_adapter.py`, 12 new): missing-artifact →
   unloaded adapter + explicit `UNAVAILABLE` prediction (no raise, no values);
   loaded adapter → real finite prediction, `uncertainty_kt is None` (never
   the legacy 14.55), `status == "UNVERIFIED"`, degradations documented;
   30-column feature order/values; Kelvin→°C; ERA5-absent path; importance
   shape.

### STEP 7d — Docs updated (claims labeled, not deleted)

- `docs/model_inventory.md`: intensity status → **UNAVAILABLE / UNVERIFIED**;
  metrics labeled **HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT
  REPOSITORY**; artifact/dataset marked **ABSENT**; `retrain.py` entry point.
- `docs/model_audit/model_health_check.md`: intensity row → "No artifact →
  adapter reports `UNAVAILABLE`; retrain via `cyclone intensity/retrain.py`".
- `docs/model_audit/model_health_check.json`: added
  `historical_metric_claims` + `reproduction_recipe` fields.
- `cyclone intensity/README.md`: added a Reproducibility Status banner; the
  "Key Results" numbers stay but are now explicitly labeled historical and
  non-reproducible; documented `retrain.py`.

### Tests before / after

| Suite | Before | After |
|---|---|---|
| Intensity adapter (new file) | n/a | 12 passed / 0 failed |
| `test_schema.py` / `test_orchestrator.py` | unchanged | pass |
| Full suite | 155 passed / 0 failed / 0 errors | **167 passed / 0 failed / 0 errors** |

Ruff: `intensity_adapter.py` and `test_intensity_adapter.py` clean; no new
issue categories introduced (`schema.py` additions consistent with the
file's existing `Optional[...]` style).

### Status (final)

- Intensity branch verdict: **Outcome B** → status **UNAVAILABLE / UNVERIFIED**.
- Claimed metrics (MAE 14.55 / RMSE 19.66 / R² 0.037 / acc 45.3% / within-1
  84.0%): **HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT REPOSITORY**.
- No fabricated artifact, dataset, prediction, or uncertainty was added. The
  repository can reproduce the branch **only** once the real
  `clean_model_data.csv` is supplied and `retrain.py` is run.

### Remaining limitations

- No real dataset in repo → nothing to retrain on; `retrain.py` prints the
  deterministic recipe and waits for real data.
- Even the legacy claimed model was weak (R² ≈ 0.037); a persistence or
  climatology baseline is not reported alongside it, so its operational value
  versus trivial forecasts is unknown.
- ERA5 reprocessing lives in the legacy Colab notebook; no scripted
  ERA5→`clean_model_data.csv` merge exists yet (future work when a CDS account
  is available).

---

## Phase 7 — Documentation + Frontend Truthfulness Audit

### Context

Phases 0–6 established honest per-branch verdicts in code and in
`REPAIR_LOG.md`, but several user-facing and developer-facing documents plus
the frontend still repeated the OLD (pre-audit) claims: trajectory "production
ready" with per-horizon calibrated `sigma_km` that "grows with lead time";
artifact path `cyclone_path/checkpoints/v12_best_model.pt` (does not exist);
intensity "operational"; RI "multimodal/calibrated" including fusion; and an
"Uncertainty Cone" UI label. All of that contradicted Phase 5/6 findings.

Constraint discipline respected: **no retraining, no synthetic data, no
fabricated metrics/confidence, no dashboard rebuild, no weakening of tests,
no change to scientific results.** Only documentation strings, mock labels,
and UI wording were changed.

### STEP 1 — Audit findings (stale claims found)

| # | Location | Stale claim | Reality (Phases 0–6) |
|---|----------|-------------|------------------------|
| 1 | `README.md` (root, whole file) | Legacy "cyclone_project" V12 CLI layout; `sigma_km` "grows with lead time" + "calibrated" | Actual repo layout; uncertainty is a saturated ~209.9 km bound, NOT calibrated/growing |
| 2 | `docs/model_inventory.md` §1 | Trajectory "PRODUCTION-READY", "calibrated outputs", "uncertainty grows with lead time", artifact `cyclone_path/checkpoints/v12_best_model.pt`, "median 24h error ~50–80 km" | LIMITED/UNVERIFIED; real artifact is the repo-root distilled LT3P; metric is a HISTORICAL CLAIM |
| 3 | `docs/model_inventory.md` §2/§10/§19.1/§19.5 | RI "multimodal (IMD+ERA5+Satellite)" + "calibrated"; fusion listed as available | IMD-only deployable; `calibrated_probability` is an alias for `imd_probability`; no fusion meta-model; ERA5 not wired; satellite not fitted |
| 4 | `docs/model_inventory.md` §13 | "Track has `sigma_km`; RI has calibration" | Track sigma saturated/uncalibrated; RI calibration is an alias |
| 5 | `docs/model_audit/model_health_check.md` | trajectory row "12 horizons, uncertainty [15-70 km]"; artifact v12 path; "VALIDATED (storm-wise CV)" + `cyclone_path/v12_common.py` evidence; test suite "143/143"; typo "NOT SCIENTIFICALLY VALIDIALIZED" | ~209.9 km saturation; distilled artifact; limited historical validation; 167/167 |
| 6 | `docs/model_audit/model_health_check.json` | trajectory `artifact_path`/`sha256`/size = v12; `original_vs_adapter_fidelity` cites `v12_common.load_v12`; uncertainty type unqualified; `scientific_validation: VALIDATED` | Corrected to the deployed distilled artifact + saturation qualifier + limited validation |
| 7 | `docs/model_audit/landslide_model_audit.md` | artifact inventory lists v12 checkpoint path | Corrected to distilled artifact + legacy-path note |
| 8 | `frontend/src/data/mock/MOCK.ts` | `modelVersion: "v12_best_model.pt"`; intensity status AVAILABLE/operational; RI ERA5/satellite/fusion branches AVAILABLE + `fusionProbability`; demo hazard cards claim LIVE + GOOD confidence; model-health table lists intensity AVAILABLE and v12 artifact | Corrected to honest statuses; `fusion` shows "—"; ALL demo values explicitly labeled SIMULATED |
| 9 | `frontend/src/pages/{TrackPage,DashboardPage}.tsx` | "Uncertainty Cone" layer labels | "Uncertainty Band (uncalibrated)" |
| 10 | `frontend/src/components/{map,recurvature,pipeline}` | legend "Uncertainty", map tooltip `±X km`, "TRAJECTORY V12" node | "Uncertainty band (uncalibrated bound)", tooltip "(uncalibrated band, demo)", "TRAJECTORY (V12 DISTILLED)" |
| 11 | `frontend/src/types/index.ts` | `ModelOperationalStatus` union missing statuses the backend actually emits | Added `LIMITED`, `AVAILABLE_BASELINE`, `DATA_UNAVAILABLE`, `STATIC_SUSCEPTIBILITY`, `NOT_IMPLEMENTED`; tone maps in StatusLabel/StatusBadge/ModelPipeline extended |

### STEP 2 — Per-branch statuses (authoritative, used everywhere)

Trajectory = **LIMITED/UNVERIFIED** (real point forecasts; ~209.9 km saturated
uncalibrated bound). RI-IMD = **AVAILABLE** (alias calibration). RI-ERA5 =
**UNAVAILABLE** (features not wired). RI-Satellite = **UNREPRODUCIBLE**.
RI-Fusion = **NOT IMPLEMENTED**. Intensity = **UNAVAILABLE** (retrain recipe
exists). Recurvature = **AVAILABLE/LIMITED** (fixed confidence 0.55). Genesis =
**PROTOTYPE** (synthetic features, `calibrated=False`). Rainfall/Wind = **BASELINE
(same-time / case study)**. Flood = **DATA_UNAVAILABLE**. Landslide =
**STATIC_SUSCEPTIBILITY**. No model is production-ready.

### STEP 3–6 — Files changed

- `README.md` — full rewrite: real repo orientation, honest status table,
  trajectory limitations (incl. contradiction of the older calibrated/growing
  `sigma_km` claim), per-module pointer section, doc map. Legacy V12 CLI usage
  now lives behind `cyclone_path_deployment_package/README.md`.
- `cyclone_path_deployment_package/README.md` — added audit **Limitations**
  section (uncalibrated saturated sigma, historical metrics not reproduced).
- `docs/model_inventory.md` — trajectory module path/artifact/status/metrics;
  RI outputs (`calibrated_probability` alias note), artifacts + status; §10
  artifact table with per-branch verdicts; §13 uncertainty row; §19.1 adapter
  row; §19.5 classification (Trajectory → LIMITED/UNVERIFIED, RI → LIMITED
  IMD-ONLY). Intensity section (already honest) untouched.
- `docs/model_audit/model_health_check.md` — test-suite counts 143→167;
  trajectory section artifact path, uncertainty saturation, scientific
  validation qualifier; §3.2 artifact table corrected to distilled checkpoint
  (+ legacy note); DAG trace trajectory row (`~209.9 km constant bound`); fixed
  "VALIDIALIZED" typo; bottom line qualified.
- `docs/model_audit/model_health_check.json` — trajectory `artifact_path`,
  `sha256` (real `b9cfc710…`), `size_bytes` (3,912,349), uncertainty type with
  saturation note, `original_vs_adapter_fidelity`, `scientific_validation`.
- `docs/model_audit/landslide_model_audit.md` — artifact inventory trajectory
  row corrected.
- Frontend (`no rebuild`): `types/index.ts` union + tone maps;
  `data/mock/MOCK.ts` (trajectory version/status, intensity UNAVAILABLE, RI
  branch statuses + `fusionProbability: undefined`, hazard-card statuses,
  rain/wind/flood/landslide honest labels, model-health table, genesis artifact
  paths `genisis models/...`, performance metric provenance labels);
  `pages/{TrackPage,DashboardPage}.tsx`, `map/CycloneLegend.tsx`,
  `map/CycloneMap.tsx`, `recurvature/RecurvatureMap.tsx`,
  `pipeline/ModelPipeline.tsx`.

### STEP 7–8 — Terminology + metric provenance

- No "susceptibility/classification as forecast" language remains in
  `README.md`/`docs/`/frontend (audit greps; remaining hits are the honest
  negations added here).
- Every frontend performance metric now carries
  **"HISTORICAL CLAIM — not reproduced in-repo"** provenance; intensity metrics
  already labeled in Phase 6.

### STEP 9–10 — Verification

- Post-edit repo-wide greps: `production-ready` (only negations/honest table),
  `grows with lead` (only "does NOT grow"), `v12_best_model.pt` (only repair-log
  history + debug incident logs + explicit "does not exist" notes).
- Full pytest suite: **167 passed / 0 failed / 0 errors** (unchanged from
  Phase 6, no tests weakened or removed).
- Ruff: `src/models/adapters/intensity_adapter.py` +
  `cyclone intensity/retrain.py` clean (auto-fixed one trailing-newline W292
  that had slipped past Phase 6); broader repo has pre-existing lint debt that
  is out of scope for Phase 7 (would require unrelated behavioral changes).
- Frontend build/typecheck NOT run (`node_modules/` absent; "no dashboard
  rebuild" constraint). New `ModelOperationalStatus` values were manually
  cross-checked against every component switch (all have safe default
  branches).

### Status (final)

- Every user-facing and developer-facing claim now matches the verified
  scientific state from Phases 0–6.
- No artifact, metric, confidence, or prediction was fabricated; no test was
  weakened; no backend/adapter behavior changed.
- Remaining known gaps (unchanged): legacy `docs/debug/*` logs reference the
  historical v12 path (they are dated incident records, not live claims);
  frontend cannot be typechecked without installing `node_modules`.

---

# PHASE 8 — GENESIS SCIENTIFIC AUDIT (2026-09-12)

## Object
Determine the scientific truth of the Genesis branch of the TOOFAN pipeline:
is it a genuine model, a functional-but-unvalidated implementation, or a
synthetic/provenance-unclear prototype? Audit only — no retraining, no
synthetic replacement data.

## Verdict (final)

**GENESIS = PROTOTYPE — real, loadable artifacts with an honest adapter, but
scientifically UNVERIFIED and NOT REPRODUCIBLE from this repository.**

- The three production artifacts (LightGBM / XGBoost / RandomForest) exist,
  load, and predict deterministically (verify, below).
- The **training data (300 samples / 191 NIO storms / 2015–2024), the training
  script, and every reported metric are NOT in this repository.** These claims
  trace to an external "source report" cited by the adapter and the integration
  audit. They are therefore **HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT
  REPOSITORY** (no legitimate source-report data was fabricated, and the repo
  cannot regenerate them).
- The model's own lower bound on scientific validity: 12 of 34 features
  (`w/q/z` per level) are always NaN → median-imputed at inference, and in real
  pipeline operation `_load_ocean_features` supplies only `sst`, so the oceanic
  features run on imputed placeholders. The model is only fully exercised when
  a caller builds a complete `CycloneState`.

## Findings

### F1. Artifact inventory (16 files in `genisis models/`, 15 models + 1 imputer)
- All 15 model artifacts are fitted 2-class (0/1) 34-feature classifiers.
- `tc_genesis_BEST_MODEL_300.joblib`, `xgboost_optimized_300.joblib` and
  `tc_genesis_xgboost_300_OPTIMIZED.joblib` are byte-identical
  (all SHA-256 `f3cd06a608df7053...`) → "BEST_MODEL" is the approved XGBoost.
- `randomforest_optimized_300.joblib` == `tc_genesis_randomforest_300_OPTIMIZED`
  (`9120c83c73edf894...`); `extratrees_optimized_300.joblib` ==
  `tc_genesis_extratrees_300_OPTIMIZED` (`43c8bffa4e9339c1...`).
- `lightgbm_optimized_300.joblib` (196,894 B) differs from the approved
  `tc_genesis_lightgbm_300_OPTIMIZED.joblib` (197,150 B) → two different
  LightGBM pickles exist; the pipeline uses the `tc_genesis_...` one.
- `tc_genesis_300_imputer.joblib` (1,287 B) is not used at inference (each
  `_OPTIMIZED` artifact embeds its own SimpleImputer).

### F2. Honesty bug — "calibrated soft-voting ensemble" (fixed)
No calibration artifact exists, yet three places called the ensemble
"calibrated": the adapter docstring (adapter.py:9), the ensemble provenance
string (adapter.py:604), and the integration audit §1. **Fixed** to
"soft-voting ensemble (uncalibrated)" in the code, the provenance dict, the
integration audit, the tests' docstring, plus a regression test
(`test_ensemble_provenance_is_uncalibrated`) asserting
`provenance["ensemble"] == "soft-voting ensemble (uncalibrated)"`,
`calibrated is False`, `calibrated_probability is None`.

### F3. Functional bug — `_x`/`_y` TCHP/OHC700 duplication (fixed)
`_build_feature_frame` fed `tchp_kj_cm2_y`/`ohc700_kj_cm2_y` the *same value*
as `tchp_kj_cm2_x`/`ohc700_kj_cm2_x`. The `_x`/`_y` suffixes come from a
training-time pandas merge with two distinct columns; the second value cannot
be reconstructed from `CycloneState`. Duplicating `_x` into `_y` fabricates an
equality the model never saw and warps output. Measured effect (tchp=90,
ohc=75, NIO state): XGBoost 0.4713→0.4851 (+0.014), RandomForest
0.4833→0.5000 (+0.017), ensemble 0.4639→0.4729; LightGBM unchanged (0.4453,
nil TCHP/OHC importance). **Fixed**: `_y` slots now left NaN → median-imputed,
consistent with the code's own "never fabricate values" principle for the other
12 unavailable features. Regression test `test_y_tchp_ohc_never_duplicated_from_x`.

### F4. Verification performed (no code change)
- **Determinism**: repeated production/ensemble predictions are bit-identical.
- **Guards**: CatBoost/ExtraTrees artifacts are refused even when requested as
  an approved type; missing-artifact honesty (production/ensemble `UNAVAILABLE`)
  confirmed; class-1 index handling correct (`classes_ == [0,1]`).
- **Fidelity**: adapter == direct pipeline loading for all three models
  (test tolerance 1e-9; corrected the audit doc that claimed 1e-12).

## Files changed (Phase 8)
- `src/models/genesis/adapter.py` — uncalibrated-ensemble labels (docstring +
  provenance); `_y` feature duplication fix; runtime `explanation` now flags
  source-report-only provenance ("HISTORICAL CLAIM — not reproducible from
  current repo"); ruff clean.
- `tests/test_genesis.py` — 2 new regression tests; corrected docstring; ruff
  clean (auto-fixed pre-existing F401/I001/UP007 in the touched files).
- `docs/model_audit/genesis_integration.md` — §1 uncalibrated ensemble; §4
  feature-provenance table; §7 reproducibility caveat; §11.1 1e-9; §11.5
  counts; §14 limitations.
- `docs/model_inventory.md` — §16 dataset row corrected to "150 genesis /
  150 non-genesis (class-balanced)" (removes the contradictory "150-150
  train-test split"), adds "training data/script/metrics NOT in repo"; test
  counts 169/169 and Genesis 46/46.
- `docs/model_audit/model_health_check.md` (+`.json`) — Genesis rows qualified
  as source-report claims + repo-absence; test count 169/169.
- `README.md` — Genesis status/description note uncalibrated ensemble +
  training data/code not in repo.
- `frontend/src/data/mock/MOCK.ts` — Genesis messages corrected to PROTOTYPE /
  uncalibrated (no "operational" over-claim).

## Verification
- Full pytest: **169 passed / 0 failed** (was 167 + 2 new regression tests).
- Ruff: `src/models/genesis/adapter.py`, `tests/test_genesis.py` clean.
- Frontend build/typecheck NOT run (`node_modules/` absent; unchanged
  constraint).

---

# PHASE 9 — SATELLITE / MULTI-SOURCE SCIENTIFIC AUDIT (2026-09-12)

## Object
Determine scientific truth of the satellite / multi-source branches of the
TOOFAN repo: does the repository demonstrate a reproducible AI/ML system using
multi-source satellite data for tropical-cyclone identification, classification,
or prediction? Audit only — no retraining, no fabricated data, no synthetic
replacement imagery, no invented metrics.

## Verdict (final)

**NO — the repo does NOT currently demonstrate such a system.**
- Exactly ONE satellite imagery product is present as data: MERG-IR (NCEP/CPC
  4 km). 26 recovered 128×128 crops (23 storms / 9 RI / 17 non-RI) are on disk;
  16/26 source granules are in `cyclone_backup/Cnnfiles/`.
- A real trained CNN artifact exists (`satellite_cnn.pt`, 308,705 params) that
  loads cleanly, but **inference is NOT runnable in-repo**: the fold-0 scaler
  (`results/cnn_tabular_scaler.json`) is absent and stored crops are `[0,1]`
  normalised while `normalize_patch` expects Kelvin → direct inference would
  produce a constant −1 K input channel.
- The published satellite OOF skill (PR-AUC 0.516, Δ −0.428) and TCIR metrics
  (PR-AUC 0.0917 / ROC 0.5782 / N=928 / 19 storms / 69 RI) and the TCIR dataset
  claim (2,840 rows / 64 storms / 189 RI) are **UNVERIFIED / HISTORICAL CLAIM —
  NOT REPRODUCED** (backing CSVs and datasets absent).
- TCIR normalisation stats are pathological (channel-4 mean `inf`, std `nan`);
  the Keras artifact cannot run in the current environment (TensorFlow import
  fails) and no TCIR dataset exists.
- **No multi-source fusion is demonstrated**: `src/fusion.py` needs absent result
  CSVs, there is no fusion meta-model artifact, and `fusion_probability` is never
  produced. "Multiple satellite products/artifacts exist" ≠ "satellite fusion".
- The RI adapter in `src/models/adapters/ri_adapter.py` is **IMD-only at runtime**
  (already honest: `satellite_probability`/`fusion_probability` = None;
  `RISatelliteBranch` defined but never instantiated, and it requires the absent
  fold-0 scaler anyway).
- Therefore all "multimodal / multi-source" descriptions of the RI pipeline are
  **design aspirations**, not implemented capability. Terminology rule applied:
  image classification with a future-defined RI_24h label is *identification*,
  not a deployed/calibrated forecast.

## Key numbers verified in Phase 9
- Recovered crops: 26 files, QC 26/26, shape (128,128,1) float32, `[0,1]` range;
  23 storms, 9 RI / 17 non-RI; `delta_minutes` 0–60 (mean ≈ 7) ≤ 120 tolerance.
- Multimodal table: `has_satellite=1` for 25 rows / 23 storms / 8 RI / 17 non-RI.
- Source granules on disk: 16/26 (`.nc4` in `cyclone_backup/Cnnfiles/`);
  satellite download manifest = 60 requested.
- IMD BoB RI training base (corrected): **5,009 rows / 291 storms / 179 RI
  (5.6% BoB)** — previously mis-documented as 3,211 obs / 259 storms.
- `results/` directories: absent repo-wide (no OOF/eval CSVs exist).

## Fixes applied (Phase 9)
- `cyclone_backup/satellite_cnn_recovered/metadata_clean.csv` — fixed 26 broken
  `image_path` values (stale `/Users/apple/cyclone/...` → repo-relative
  `cyclone_backup/satellite_cnn_recovered/images/...`); 26/26 resolve; original
  kept at `metadata_clean.csv.bak`.
- `docs/model_inventory.md` — §1 model/inputs/status rows qualified as
  designed-vs-implemented; §1 dataset row + §9.3 TCIR row + §10 RI Satellite/TCIR
  rows: satellite/TCIR numbers retagged `UNVERIFIED / HISTORICAL CLAIM`; §9.3 IMD
  training base corrected to 5,009/291/179; §19.1 RI row corrected from
  "Multimodal (IMD, ERA5, Satellite)" → "IMD-only at runtime"; satellite CNN row
  "not fitted" → "fitted, loads, inference not runnable in-repo".
- `docs/model_audit/model_health_check.md` — §4.4 architecture qualified as
  designed (IMD-only runtime); §4.4.4 documents the two inference blockers
  (absent fold-0 scaler; `[0,1]`↔Kelvin mismatch) + HISTORICAL CLAIM.
- `docs/model_audit/satellite_multisource_audit.md` — NEW Phase 9 evidence table
  (12 component rows), provenance, label/leakage/temporal audit, multi-source
  reality check, and the concrete list of what a real system would require.
- `frontend/src/data/mock/MOCK.ts` — "satellite CNN is not fitted" → "artifact
  exists but is NOT runnable/validated in-repo (fold-0 scaler missing;
  storage↔preprocess unit mismatch)".
- `cyclone_backup/tc_ri_cnn/README.md` — fixed "425 storms / 5.47%" → current
  "5,009 rows / 291 storms / 179 RI / 5.6% BoB" (storm count no longer conflated
  with RI prevalence).
- `cyclone_backup/README.md`, `cyclone_backup/SIH_FINAL_RI_REPORT.md` — prominent
  Phase 9 reproducibility notes added: satellite/TCIR/fusion metrics labelled
  `UNVERIFIED / HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT REPOSITORY`.
- `tests/test_satellite_metadata.py` — NEW: 12 tests pinning the metadata fix
  (path resolution, RI distribution 9/17, 23 storms, delta ≤ 120 m, 16/26 source
  granule coverage, crop dtype/shape/range, required columns).

## Deliberately NOT done
- No retraining of any CNN; no attempt to "prove" satellite skill (would need
  absent eval data); no TCIR dataset reconstruction; no fusion meta-model
  construction; Phase 10 not started.

## Verification
- Full pytest: **181 passed / 0 failed** (169 + 12 new satellite metadata tests).
- Ruff: `tests/test_satellite_metadata.py` clean. No active-`src/` Python changed.
- Frontend build/typecheck NOT run (`node_modules/` absent; unchanged constraint).

---

# Phase 10 — Hazard Branch Audit (Rainfall / Wind / Flood / Landslide)

2026-09-12 · **Type**: READ-ONLY forensic audit + one demonstrated bugfix
(wind load hard-abort) + correctness label updates. **No retraining, no
synthetic data, no predicted/derived/uncertainty metrics added.**

## Branches audited
- **Rainfall (`rain/`)** — actually a **same-time heavy/light binary classifier**
  (FANI 2019 IMERG), **not a forecast**. Test results = last 4 of 12 half-hourly
  snapshots (04:00–05:30; 112,000 rows) = temporal but same-day/same-event split;
  lag/rolling features create cross-split autocorrelation leakage. Metrics in
  `rainfall_model_12_metadata.json` **reproduce exactly** from
  `rain/results/model12_results.csv`. Metadata `training_samples: 168000` vs
  implied 224,000 (4-of-12 holdout → 8 train snapshots) — **discrepancy, 56,000
  rows unaccounted**. Adapter returns `AVAILABLE_BASELINE`, never fabricates grids.
- **Wind (`wind/`) — DEMONSTRATED BUG FIXED**. `.keras` model is a Yaas 2021
  single case study; `import tensorflow` **hard-aborts the interpreter** (SIGABRT,
  libc++ mutex) on this machine (probe rc -6). `create_wind_adapter()` used to
  crash the whole process. Fixed: `_tensorflow_import_health()` probes TF in a
  subprocess (importlib find_spec → subprocess, 120 s timeout, cached);
  `load()` raises catchable `RuntimeError`; `predict()` returns explicit
  `UNAVAILABLE` (empty `wind_fields`, `confidence=0.0`) — **no fabrication, no
  crash**. **Not runnable in this environment and no inference pipeline exists.**
- **Flood (`flood/`)** — actually a **static spatial flood-extent classifier**
  (single event FANI 2019): raw XGBClassifier, 28 features (16 rainfall
  current+lag, 12 static hydrology; **no future-rainfall leak**), labels
  **constant per cell across 97 timestamps** (post-event extent back-propagated
  = whole-event label leak). Two label files disagree (70 vs 3 flooded cells).
  "temporal validation" file (11,220 rows, 30 timestamps of 2019-05-03) is
  **inside the event window — not a temporal holdout**. Metrics (ROC-AUC
  0.8025/0.9635) = repo-recorded historical claims, not re-run. Runtime
  `DATA_UNAVAILABLE`; adapter tolerates missing rainfall.
- **Landslide (`stage17_hazard_maps/`)** — **no ML artifact exists**. Only static
  PNG hazard-map scripts. Adapter `STATIC_SUSCEPTIBILITY`. Frontend previously
  referenced nonexistent `models/landslide_model.pkl`.

## Key numbers verified (Phase 10)
- Rainfall: 336,000 rows × 4 cols data; 12 half-hourly snapshots × 28,000 cells
  (+1 anomalous bare-date `2019-04-30` row); 112,000 test rows / 4 timestamps;
  RF `n_features_in_==25`, classes `[0,1]`; heavy threshold `10.0` mm/hr;
  metrics `prec 0.9197 / rec 0.9785 / f1 0.9482 / mae 0.0785` (reproduced).
- Wind: `U10 1.7262/4.4726`, `V10 3.1894/4.5187`; no scaler object; no metrics;
  TF probe rc `-6`.
- Flood: 374 cells; spatial split 280/94; 97 timestamps; labels constant per
  cell; XGB `n_features_in_==28`; feature list contains **no** `*lead*`/`*future*`
  rainfall columns.

## Fixes applied (Phase 10)
- `src/models/wind/adapter.py` — TF import-health probe (subprocess, cached),
  `RuntimeError`-raising `load()`, explicit `UNAVAILABLE` prediction
  (empty fields / `confidence=0.0`), `create_wind_adapter()` degrades gracefully
  with a warning; `explain()` reports runtime status. (Pre-existing lint issues
  in this file fixed; ruff clean.)
- `tests/test_hazard_contracts.py` — +3 tests: wind no-crash/no-fabrication;
  flood no-future-rainfall-feature leak; rainfall results = final 4 of 12
  snapshots.
- `docs/model_audit/hazard_branches_audit.md` — NEW Phase 10 forensic report
  (per-branch 15-point + combined evidence table + reclassification).
- `docs/model_audit/model_health_check.md` / `.json` — wind `model_loads True`
  → **False** (TF SIGABRT in current env) + runtime note; prediction
  `UNAVAILABLE` semantics.
- `docs/model_inventory.md`, `README.md` — wind "not loadable / TF crash /
  no pipeline" runtime note (README status ⚠️ → ❌).
- Frontend label corrections (no rebuild): `HazardsPage.tsx` kicker
  "Forecast"→"Hazard" + flood Validation Note (raw XGBClassifier,
  `DATA_UNAVAILABLE`, "NOT a flood forecast") + "WIND FORECAST"→"WIND FIELD";
  `DashboardPage.tsx` flood `available:false`; `LiveMonitorPage.tsx` wind
  `UNAVAILABLE` / flood `DATA_UNAVAILABLE`; `ReportsPage.tsx` WIND
  `AVAILABLE_BASELINE`→`BASELINE` + TF note.
- `frontend/src/data/mock/MOCK.ts` — wind entry → `UNAVAILABLE`/

  `RUNTIME_REQUIRED` with TF-crash message; flood → raw XGBClassifier /
  "static spatial extent" / `DATA_UNAVAILABLE`; landslide artifact
  `models/landslide_model.pkl` → **`""`**, framework "none (static hazard
  maps)", `inputFeatures 0`; rainfall `inputFeatures 12`→`25`.

## Deliberately NOT done
- No retraining; no generated metrics/predictions/uncertainty; no flood holdout
  re-run (reproduction artifacts absent); no wind pipeline authoring; no
  orchestrator registration of hazard branches; no frontend rebuild; Phase 11
  dashboard work **not started**.

## Verification
- Full pytest: **196 passed / 0 failed** (193 baseline + 3 new Phase 10 tests).
- Ruff: `src/models/wind/adapter.py` + `tests/test_hazard_contracts.py` clean.
- Frontend build/typecheck NOT run (`node_modules/` absent; changes are label/
  union-validated strings only).

## Phase 11 — End-to-End Pipeline + Frontend Integration Audit

### Goal
Prove the audited scientific statuses survive unchanged from
`CycloneState` → Orchestrator → Adapters → Hazard Engine → API serialization →
Frontend. Fix only demonstrated integration bugs; never convert UNAVAILABLE to
values, and never present unavailable branches as operational.

### Findings (backend)
- `TrackPrediction` had no `status` field: the validated status
  ("LIMITED/UNVERIFIED") was being dropped in serialization, so clients could
  only see deterministic/uncalibrated track output with no qualifier.
- `UnifiedForecastState` lacked an `unassessed_hazards` field and the
  `assessed_hazards` docstring misdescribed it as "all" modules (it stores the
  actually-scored subset).
- Orchestrator `_execute_module` trusted any adapter output that raised no
  exception; a module returning an empty/UNAVAILABLE prediction was recorded as
  SUCCESS, so the DAG status list never marked it unavailable.
- Hazard engine: with zero components, `overall_severity` fell back to
  `RiskLevel.NONE`, which is indistinguishable from a scored "no risk" and
  serialized clients could not tell "assessed, nothing found" from "never ran".
- Trajectory adapter previously returned a growing uncertainty comparable with
  lead time; the learned uncertainty head saturates at its output clamp
  (~209.9 km) and the observed current position carries no predictive band.

### Fixes applied (backend)
- `src/core/schema.py` — `TrackPrediction` + `status + explanation`
  (defaults `"AVAILABLE"` / `""`); `UnifiedForecastState` + `unassessed_hazards`;
  corrected `assessed_hazards` docstring.
- `src/models/adapters/trajectory_adapter.py` — `predict()` returns
  `status="LIMITED/UNVERIFIED"` with explanation of the saturating uncertainty
  head instead of horizon-growing values.
- `src/pipeline/orchestrator.py` — `_execute_module` now inspects
  `getattr(output, "status", None)`; statuses
  `{UNAVAILABLE, DATA_UNAVAILABLE, RUNTIME_REQUIRED, NOT_IMPLEMENTED,
  MODEL_MISSING}` downgrade the module to `ExecutionResult(success=False,
  status="UNAVAILABLE", reason="adapter reports status=...")` and
  `module_status` reflects it. `LIMITED`/`UNVERIFIED`/`BASELINE` are real
  outputs and are NOT downgraded. `_compute_overall_hazard` fallback now returns
  `None` (not `RiskLevel.NONE`) when no risk level is available.
- `src/pipeline/hazard_engine.py` — `compute()` sets `overall_severity=None`,
  `overall_confidence=0.0` for an empty `components` list; a severity of `None`
  is now unambiguous ("not assessed").

### Findings (frontend, all verified against current files)
1. `DashboardPage.tsx` — Overall Risk block was hardcoded
   `"NOT AVAILABLE"` regardless of data; now consumes
   `risk?.available/severity/score/reason` and renders the real severity.
2. `ModelsPage.tsx` — status summary counted only some classes; now covers
   Operational/Limited/Baseline/Static/Unavailable/Blocked/Not Integrated/
   Missing.
3. `IntensityPage.tsx` — intensity chart + table rendered from a static mock
   even when the intensity module is UNAVAILABLE; now gated on `intensityUsable`
   and `ModelRow` only shows probability/risk for availability-class models
   (status note still shown for unavailable). `forecastPoints` made
   `undefined`-safe for the typecheck.
4. `FloodPage.tsx` — `DATA_UNAVAILABLE` flood module still rendered an
   `overallRisk` "MODERATE" pill; now gated on availability-class status.
5. `HazardsPage.tsx` — same flood overall-risk pill bug; fixed. Wind zone rows
   hardcoded `z.risk ?? "MODERATE"` (a claim of MODERATE when no risk given) →
   `severity={z.risk}` (RiskPill renders "—").
6. `RiskPage.tsx` — `confidenceLabel()` returned hardcoded `"MODERATE"` even
   though `OverallRisk` carries no confidence field; honest fallback "—" when
   operational, "UNAVAILABLE" when not. Regional exposure weight fallback
   `?? 20` (fabricated number for unknown levels) → `?? 0`.
7. `RecurvaturePage.tsx` — `?? "AVAILABLE"` default → `?? "UNAVAILABLE"`.
8. `CycloneMap.tsx` — rotated-wind popup hardcoded "(uncalibrated band, demo)"
   regardless of data mode → conditional on `isDemo`. Cone builder `?? 20`
   fabricated a ±10 km default corridor → band pinches where uncertainty is
   missing.
9. `RecurvatureMap.tsx` — `buildCone` same `?? 20` fabricated corridor → removed.
10. `MOCK.ts` — mock trajectory uncertainty grew 8→272 km with lead time,
    contradicting the ~209.9 km saturation → constant 210 km for forecast points,
    `undefined` (no band) for the observed position. UNAVAILABLE RI models
    carried fabricated `probability`/`risk` values → removed, replaced with
    `statusNote`. `ensembleWeights` referencing unavailable branches removed.
    Rainfall accumulation labels "Next 6 hours" implied a future forecast for a
    same-time classifier → relabeled "Simulated · 0-6h" etc. (mock is demo).

### New tests
- `tests/test_pipeline_integration_phase11.py` (10 tests): TrackPrediction
  status/explanation; serialization survival across `model_dump(mode="json")`;
  real LT3P adapter LIMITED status; orchestrator downgrade of UNAVAILABLE
  adapter output; LIMITED kept as SUCCESS; module-status propagation into
  `UnifiedForecastState`; hazard engine `None` severity (no components and
  UNAVAILABLE-only components); real RiskLevel when assessed; and a full-DAG
  propagation test asserting each module's status + the serialized JSON payload
  preserve the audited statuses.

### Verification
- Full pytest: **206 passed / 0 failed** (196 pre-Phase-11 + 10 new).
- Frontend: `npx tsc --noEmit` clean; `vite build` succeeds.
- Ruff: uncommitted working tree of the 4 edited backend files went from a
  baseline of 176 pre-existing errors at HEAD to 51 (all remaining are
  pre-existing/out of edited ranges); no new lint issues introduced by Phase 11
  edits. Whole `src/` retains 235 pre-existing ruff findings from prior phases.
- Mock policy honored: `MOCK.ts` values that contradicted the audit were
  corrected/labeled but the demo dataset itself was retained.

### Deliberately NOT done
- No model retraining/tuning, no new artifacts, no dashboard redesign, no test
  weakening, no fabrication of predictions/confidence/uncertainty (anywhere,
  including demo UI fallbacks).

## Phase 12 — Final Baseline Freeze and Improvement Readiness Audit

### Goal
Freeze a scientifically honest, evidence-based pre-improvement snapshot so that
all future ML work can be measured against it. NO retraining, NO tuning, NO new
models/datasets, NO metric fabrication, NO status upgrades. This is the final
audit phase.

### Baseline verification (exact, 2026-09-12)
- Full pytest: **206 passed / 0 failed** (206 collected; 196 pre-Phase-12 + 10
  Phase-11 integration tests + hazard-contract/satellite/intensity suites).
- Frontend: `npx tsc --noEmit` clean; `npx vite build` succeeds
  (`index-1We64_Qb.js`, gzip 324 kB).
- Ruff `src/`: 235 pre-existing findings (UP007 98, F401 67, I001 27, W292 23,
  E402 3, W293 3, F841 6, F402 3, UP015 2, UP038 1, UP037 1, F821 1) — all debt
  from Phases 0–9; none in Phase 10–12 edited ranges. Combined `src/`+`tests/`:
  280 (pre-existing only).
- Runtime integration re-verified by driving every real adapter with a real
  `CycloneState`: genesis (real prediction), trajectory `LIMITED/UNVERIFIED`,
  intensity `UNAVAILABLE`, RI `AVAILABLE` (IMD-only), rainfall
  `AVAILABLE_BASELINE`, wind `UNAVAILABLE` (TF probe), landslide
  `STATIC_SUSCEPTIBILITY`; recurvature and flood honestly refuse a minimal state
  (orchestrator marks them FAILED), full end-to-end ingestion remains blocked by
  the incomplete `DataIngestionLayer` (abstract loaders, missing IMD `.xlsx`).

### Fix (only one, scoped)
- `frontend/src/pages/TrackPage.tsx` — the trajectory status
  `LIMITED/UNVERIFIED` was shown as a bare label with the *why* (saturated
  ~209.9 km uncertainty, uncalibrated) hidden. The panel now renders
  `status.message` under the status row (no redesign, no uncertainty/value
  changes).

### New evidence frozen
- **Recurvature metrics REPRODUCED** from `recurvature/test_predictions.csv`
  (2,085 rows) and matching `model_metadata.json` exactly: ROC-AUC 0.7218,
  PR-AUC 0.5218, F1 0.4941, P 0.4237, R 0.5926, Brier 0.2052, ACC 0.6700
  (storm-wise 276/60/60; positive rate 0.2719).
- **Rainfall metrics REPRODUCED** from `rain/results/model12_results.csv` +
  metadata: P 0.9197 / R 0.9785 / F1 0.9482 / MAE 0.0785 (temporal holdout,
  last 4/12 FANI snapshots).
- All other previously documented metrics confirmed as
  `UNVERIFIED / HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT REPOSITORY`
  (trajectory ~50–80 km; intensity 14.55/19.66/R²0.037; RI 0.594/0.516/0.092;
  flood 0.8025/0.9635; genesis 300-sample claim; TCIR dataset claim).
- Artifact reproducibility inventory: everything tracked except
  `recurvature/xgb_recurve_model.json` (**gitignored**) + recurvature training
  CSVs (gitignored/absent) + intensity artifact (absent) + satellite fold-0
  scaler (absent). Documented; no large artifacts force-committed.

### Model-status summary (frozen)
Genesis PROTOTYPE · Trajectory LIMITED/UNVERIFIED · Intensity UNAVAILABLE ·
RI LIMITED (IMD-only) · Recurvature AVAILABLE (trained, uncalibrated, NOT
git-reproducible) · Rainfall BASELINE ONLY (same-time) · Wind BASELINE/CASE
STUDY (non-runnable) · Flood STATIC SPATIAL CLASSIFIER (single event) ·
Landslide STATIC SUSCEPTIBILITY.

### Major scientific limitations frozen
Trajectory (saturated/uncalibrated uncertainty, synthetic runtime history);
Intensity (no artifact/dataset); RI (ERA5 not wired, satellite not runnable,
no fusion); Recurvature (calibration weak, placeholder inputs); Genesis
(synthetic env inputs, provenance absent); Satellite (tiny dataset, scaler
missing, TCIR unreproducible, no fusion); Rainfall (same-time, not forecast);
Wind (TF crash, no pipeline); Flood (label leak, no temporal generalization);
Landslide (no model).

### Data blockers
IMD best-track `.xlsx` missing + CDS credentials (intensity); MERG-IR granules
external NOMADS + fold-0 scaler (satellite); TCIR dataset absent; wind needs
gridded ERA5 U10/V10 + working TF; flood label-scheme leak to remove before any
dynamic product; genesis training data not in repo; recurvature training CSVs
not in repo.

### Improvement priorities (ranked, NOT implemented)
1. Trajectory — real history + proper uncertainty (IBTrACS present).
2. Recurvature — improve + calibrate existing model (data rebuildable;
   objective baselines already frozen).
3. Intensity — real IMD/ERA5 dataset + genuine 24h model.
4. RI — reconstruct ERA5 + satellite + genuine fusion.
5. Genesis — real environmental dataset + verified labels.
6. Satellite — expand tiny dataset + fix preprocessing.
7. Hazard branches — genuine future predictions where data permits.

### Deliverables
- `docs/model_audit/final_baseline.md` — full 14-section baseline report
  (architecture, status matrix, verified vs unverified metrics, limitations,
  integration status, data/artifact readiness, roadmap, evaluation criteria,
  blockers, exact verification results, version info) + final verdict.
- `docs/model_audit/model_health_check.json` — updated to FINAL_BASELINE_FREEZE:
  206/206 tests, corrected dag_execution statuses, corrected status breakdown
  (PARTIAL 4 / UNAVAILABLE 1 / BASELINE_ONLY 2 / DATA_UNAVAILABLE 1 /
  STATIC_ONLY 1), recurvature reproducibility note, summary note. Valid JSON.
- `frontend/src/pages/TrackPage.tsx` — status message surfaced.

### Audit-phase completion statement
The audit phase is COMPLETE. The repository is test-clean, statuses are
honest end-to-end, fabricated outputs have been removed, scientific limitations
and data blockers are documented, and baseline metrics are cleanly separated
from historical claims. TOOFAN is ready to begin controlled ML improvement work
measured against this document. Models are NOT production-ready and this
document does not claim otherwise.
