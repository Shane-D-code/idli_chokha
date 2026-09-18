# RI Improvement 3 — ERA5 RI Model Training + Evaluation

> Audit date: 2026-09-13 · Branch: `main` · Scope: **first legitimate ERA5-trained
> RI model on the rebuilt dataset.**
> The path prefix in this record is `RI/…` (the former `cyclone_backup/…`
> directory was renamed to `RI/`; this is the same repository content).

---

## Completion report

```
STATUS:               trained_and_evaluated
TRAINING PERFORMED:   YES
DATASET:              RI/era5_datasets/era5_ri_rebuilt.csv
ROWS:                 870
STORMS:               126
RI POSITIVES:         82
RI NEGATIVES:         788
TRAIN/VAL/TEST:       train 82 storms / 587 rows | val 19 storms / 106 rows | test 25 storms / 177 rows
89-FEATURE CONTRACT:  True (exact order vs era5_final_xgboost.json; no forbidden columns)
DELTA SEMANTICS:      preserved — within-storm change vs previous observation, kept only if gap ≤ lag
ADAPTER ITERATION FIX: True — RIBranchModel predicts with iteration_range=(0, verified_best_iteration + 1)
MODEL:                RI/models/era5_ri_model.json
BEST ITERATION:       59
ROC-AUC:              0.5871
PR-AUC:               0.1627
PREVALENCE:           0.14124
PRECISION:            0.17308
RECALL:               0.36
F1:                   0.23377
ACCURACY:             0.66667
BRIER:                0.157886
FROZEN ERA5 COMPARISON: same-test frozen (41 trees) ROC 0.7818 / PR-AUC 0.5411 — CONFOUNDED (likely storm overlap); documented reference ROC 0.7047 / PR-AUC 0.2969 (different test population)
CONSTANT BASELINE:    ROC 0.5 / PR-AUC 0.1412 (train prevalence)
CALIBRATED:           NO
ARTIFACTS:            RI/models/era5_ri_model.json, era5_ri_training_metadata.json,
                      era5_ri_feature_schema.json, era5_ri_test_predictions.csv, era5_ri_storm_split.csv
TESTS:                42 ERA5 tests (12 rebuild + 30 training) + 208 root tests all pass
REPRODUCIBLE:         python3 train_era5_ri.py --data era5_datasets/era5_ri_rebuilt.csv --seed 42
NEXT STEP:            IMD vs ERA5 comparison; IMD+ERA5 fusion; calibration; satellite branch
```

---

## A. Objective

Train and rigorously evaluate a clean ERA5-only RI baseline on the rebuilt
dataset (`RI/era5_datasets/era5_ri_rebuilt.csv`, RI Improvement 2), so it can
be honestly compared with the IMD-only baseline and an IMD+ERA5 fusion in the
next phase. The goal is a trustworthy baseline, **not** metric maximisation:
no arbitrary tuning, no test-set optimisation, no fabricated data or numbers.

Three parts:

1. Resolve and document the temporal-delta semantics before training.
2. Ensure the frozen ERA5 adapter evaluates at its verified best iteration.
3. Train an XGBoost `binary:logistic` model on the exact 89-feature contract
   with a storm-wise seed-42 split and evaluate once on held-out test storms.

---

## B. Temporal-delta decision

### What the existing semantics are

`RI/src/features.py::add_temporal_features` computes, per storm and observation
at time `t`:

```
delta_{lag}h_feat(t) = feat(t) - feat(t_prev)      if t - t_prev <= lag hours
                       NaN                          otherwise
```

where `t_prev` is the **previous within-storm observation** (`shift(1)`), not
the observation at *exactly* `t - lag`. Consequences:

* the *same* previous row feeds all three lags, so `delta_6h`, `delta_12h` and
  `delta_24h` are equal whenever the previous gap is ≤ 6 h (documented "window
  overlap" behaviour);
* a 24 h gap yields NaN for the 6 h and 12 h lags but a value for the 24 h lag;
* the first observation of a storm has no history → NaN for all lags.

### Decision

**Preserve the existing semantics exactly.** No feature name or ordering
change; the 51 temporal features are unchanged. The 89-feature contract is
unchanged from RI Improvement 2 / the frozen `era5_final_xgboost.json`.

This is a **known methodological limitation**: the deltas are "change vs the
previous available within-storm observation, capped at the requested lag", not
guaranteed fixed-lag `t - 6h / t - 12h / t - 24h` deltas. A future experiment
may compare against true fixed-lag deltas, but that is **not** part of this
run.

### Tests pinned to this decision

* `RI/tests/test_era5_training.py::TestDeltaSemantics` — asserts the metadata
  documents the semantics and that a synthetic table reproduces the exact
  previous-observation / capped-lag behaviour (including the window-overlap
  equality and the 24 h-gap NaN/valid split).
* `RI/tests/test_era5_rebuild.py::test_temporal_delta_semantics` — the
  original RI Improvement 2 pin.

---

## C. Adapter iteration-range fix

RI Improvement 1 identified that the frozen ERA5 booster was evaluated with
`iteration_range=(0, best_iteration + 1)` (41 trees) but the adapter previously
called prediction over **all 91 built trees**.

**Status: fixed and regression-tested.** The working-tree
`src/models/adapters/ri_adapter.py::RIBranchModel`:

* loads the artifact with `xgb.Booster().load_model()` (workaround for the
  `XGBClassifier` `_estimator_type` break under xgboost 2.1.3 / sklearn 1.8);
* reads the verified best iteration from `learner.attributes.best_iteration`
  of the artifact JSON;
* `predict_proba()` uses `iteration_range=(0, best_iteration + 1)` whenever a
  verified best iteration exists — **no fallback to all trees**;
* if an artifact genuinely has no best-iteration metadata, it emits a
  `UserWarning` and uses all built trees (explicit, never silent).

No threshold manipulation, no hard-coded probabilities, no fabricated values,
no change to the 89-feature order.

The adapter remains **IMD-only** at runtime (ERA5 feature build at runtime is
not possible from `CycloneState`); this fix makes its branch inference
honour the frozen evaluation contract and prepares it for later ERA5
integration without claiming ERA5 is production-enabled yet.

Verification (`RI/tests/test_era5_training.py::TestFrozenAdapterIteration` and
the root `tests/test_adapters.py::TestRIAdapter`):

* `era5_final_xgboost.json` → `best_iteration == 40`, predicts at
  `(0, 41)`, and the prediction **differs** from a full-tree prediction (this
  proves the verified range is actually applied);
* a plain booster without best-iteration metadata falls back to all trees
  *with a warning* (`TestAdapterIterationFallback`).

---

## D. Dataset

| Field | Value |
|---|---|
| Path | `RI/era5_datasets/era5_ri_rebuilt.csv` |
| Rows | 870 |
| Storms | 126 |
| RI positives | 82 (9.43 %) |
| RI negatives | 788 |
| Date range | 1982-05-01 03:00 → 2025-11-25 03:00 (UTC) |
| Provenance | 848 `carried_historical` (raw NC absent, reported, not fabricated) · 22 `extracted_from_raw` (real bilinear extraction from the 20 CDS-format NetCDFs in `RI/ERA5_expanded/`) |
| Alignment | `era5_delta_minutes == 0` for 870/870; 0 rows with `era5_datetime` after the observation time |
| Spatial extraction | bilinear storm-centre interpolation on the 0.25° CDS grid; surrounding cells recorded in `bilinear_cells` |
| Target | `RI_24h` — Δwind ≥ 30 kt over the next 24 h; censored end-of-storm rows excluded (never treated as RI = 0) |

The rebuilt dataset is identical in features to the canonical MVP table for the
848 historical rows (0 mismatches, max abs diff 2.8e-14 float noise) and adds
22 genuinely-extracted rows.

---

## E. Feature contract

* Exactly the **89 recovered predictors** of `RI/era5_ri_feature_spec_89.json`,
  in frozen order (asserted against `era5_final_xgboost.json`'s stored feature
  names).
* Composition: 21 base ERA5 (d/r/t/u/v at 850/700/500/200 + `shear_850_200`),
  17 derived physics, 51 temporal deltas (`delta_{6,12,24}h_` over the 17
  derived features).
* **Excluded** from predictors: `storm_id`, `datetime_utc`, `latitude`,
  `longitude`, `RI_24h`, `era5_datetime`, `era5_delta_minutes`,
  `era5_source_file`, `era5_grid_resolution`, `spatial_method`,
  `provenance_status`, `bilinear_cells`, and any `TARGET_COLS` minus `RI_24h`.
* No substitution of missing values — XGBoost's native missing-value handling
  is used; no scaler, no imputer.
* Enforced at train/val/test extraction time by
  `RI/src/era5_training.py::assert_predictor_contract`.

---

## F. Storm-wise split

Deterministic storm-wise split, **seed = 42**, no storm appears in more than
one split (reused the project convention from `RI/config.yaml`:
`test_storm_fraction: 0.20`, `val_storm_fraction: 0.15`, `keep_balanced: true`;
implementation `RI/src/data.py::split_by_storms`).

| Split | Storms | Rows | RI positive | RI negative | Prevalence |
|---|---|---|---|---|---|
| Train | 82 | 587 | 53 | 534 | 0.09029 |
| Validation | 19 | 106 | 4 | 102 | 0.03774 |
| Test | 25 | 177 | 25 | 152 | 0.14124 |
| **Total** | **126** | **870** | **82** | **788** | 0.09425 |

Zero storm overlap is asserted by `Split.verify()` and re-checked by
`test_zero_overlap`. Same-seed split is reproducible bit-for-bit;
`test_seed_changes_split` confirms a different seed changes the partition.

---

## G. Class weighting

Used **only the training split**:

```
scale_pos_weight = negative_train / positive_train = 534 / 53 = 10.0754717
```

No oversampling, no synthetic examples, no class weights from val/test.
Asserted by `test_from_train_only` and `test_never_uses_test_or_val`.

---

## H. Model configuration

Conservative XGBoost baseline (identical to the frozen procedure), no
hyperparameter search:

| Parameter | Value |
|---|---|
| objective | `binary:logistic` |
| seed | 42 (deterministic) |
| n_estimators | 400 |
| learning_rate | 0.05 |
| max_depth | 4 |
| min_child_weight | 2 |
| subsample | 0.85 |
| colsample_bytree | 0.85 |
| max_delta_step | 1 |
| eval_metric | `aucpr` |
| early_stopping_rounds | 50 |
| scale_pos_weight | 10.0754717 (train only) |
| missing-value handling | native (no imputation) |
| scaler / imputer | none |

Inner grouped-by-storm 5-fold CV on training (diagnostic / model selection):
**mean PR-AUC 0.2125** (folds 0.3099, 0.0585, 0.1855, 0.3676, 0.1412).

**Threshold**: selected on the validation split only (max F1, grid 0.01) →
**0.33**. Never test.

---

## I. Training result

* Best iteration (early stopping on validation, `aucpr`): **59**.
* The saved model's `best_iteration` matches the metadata and adapter
  prediction (`iteration_range=(0, 60)`).
* The same dataset + code + seed reproduces the identical split, grouped-CV
  score, model and metrics (verified by two runs).

---

## J. Test metrics

Held-out storm test split (177 rows, 25 RI), evaluated **once**, at the
validation-selected threshold 0.33:

| Metric | Value |
|---|---|
| ROC-AUC | **0.5871** |
| PR-AUC | **0.1627** |
| Positive-class prevalence | 0.14124 |
| Precision | 0.17308 |
| Recall | 0.36 |
| F1 | 0.23377 |
| Accuracy | 0.66667 |
| Brier score | 0.157886 |
| Predicted positives | 52 (TP 9, FP 43, FN 16, TN 109) |

Reliability (informational only, **not calibration**): binned table in the
metadata JSON; mean absolute calibration error **0.28263**.

---

## K. Baseline comparison

Same test observations (177 rows / 25 RI) unless noted.

| Baseline | ROC-AUC | PR-AUC | F1 | Brier | Note |
|---|---|---|---|---|---|
| **New ERA5 model** | 0.5871 | 0.1627 | 0.2338 | 0.1579 | clean disjoint-storm result |
| Constant prevalence | 0.5 | 0.1412 | 0.0 | 0.1239 | assigns train prevalence (0.0903) to all rows; PR-AUC equals test prevalence by construction |
| Frozen ERA5 (41 trees) | 0.7818 | 0.5411 | 0.4103 | 0.1218 | **confounded** — training/test storms of this artifact are not recorded; the rebuilt table shares the seed-42 shuffle so overlap with this test split is *likely*. Behaviour reference only |
| Frozen ERA5 documented (historical) | 0.7047 | 0.2969 | — | — | **different test population** (174 obs / 20 storms / 25 RI of the 848-row MVP-era split); labelled reference only |

The frozen model's better numbers on this test split are **not** evidence of
superior skill; they are expected under storm leakage. The freshly trained
model is the only clean, disjoint-storm comparison available. Metrics from
different test populations are never compared without labelling.

---

## L. Error analysis

Threshold 0.33 on the held-out test split (TP 9 / TN 109 / FP 43 / FN 16).

* **Highest-confidence false positives** (RI=0, highest P): e.g.
  `1997-001` 1997-05-18 06:00 (P 0.739), `1987-007` 1997-11-02 12:00 (P 0.706),
  `1999-006` 1999-10-16 15:00 (P 0.649) — the model confidently calls RI where
  none occurred.
* **Highest-confidence false negatives** (RI=1, highest P below 0.33): e.g.
  `1995-008` 1995-11-23 03:00 (P 0.320), `1999-006` 1999-10-16 06:00 (P 0.320),
  `1997-001` 1997-05-17 03:00 (P 0.305) — genuinely missed RIs with
  barely-sub-threshold confidence.
* **Lowest-confidence true positives** (RI=1, lowest P above threshold): e.g.
  `1982-002` 1982-06-02 18:00 (P 0.343), `1999-006` 1999-10-16 18:00 (P 0.368).
* Lowest-P true negatives (most confident negatives, reported sorted ascending
  by P in the metadata list): `1990-007`, `1999-005`, `1995-008`, `1985-006`,
  `1992-003` all P ≈ 0.06–0.07.

Breakdown (using only information already in the dataset — no extra features):

* **By basin** (longitude rule): Bay-of-Bengal 172 rows, ROC-AUC 0.5966, PR-AUC
  0.1633; Arabian-Sea/other 5 rows (1 RI).
* **By era**: ≤2004 175 rows (25 RI), ROC-AUC 0.5888; >2004 2 rows (0 RI) — the
  post-2004 test presence is tiny, an honest caveat.
* **By history availability** (any `delta_6h_*` non-NaN): history available 125
  rows, ROC-AUC 0.5729, PR-AUC 0.2045; no history 52 rows, ROC-AUC 0.4 — the
  model is meaningfully worse when no within-storm history exists.

---

## M. Calibration status

**NOT CALIBRATED.** No calibration procedure was performed or claimed. The
output is a raw XGBoost probability/ranking model. A binned reliability table
(mean abs calibration error 0.28263) is recorded in the metadata JSON purely as
informational currency for the future calibration improvement. The model must
not be described as calibrated or reliability-validated.

---

## N. Saved artifacts

`RI/models/`:

* `era5_ri_model.json` — trained XGBoost booster (best iteration 59; 89
  verified feature names).
* `era5_ri_training_metadata.json` — model type, objective, seed, feature
  count/names/order, split storm IDs, row/pos/neg counts per split, class
  weight, hyperparameters, best iteration, threshold + selection method,
  evaluation metrics, baseline comparisons, error analysis, reliability info,
  calibration status, dataset path + provenance reference, artifact paths,
  timestamp.
* `era5_ri_feature_schema.json` — the exact 89-feature schema, contract
  reference to the frozen model.
* `era5_ri_test_predictions.csv` — held-out test rows with `storm_id`,
  `datetime_utc`, `RI_24h`, `P_RI`, `P_RI_frozen` (frozen model on the same
  rows at verified best iteration).
* `era5_ri_storm_split.csv` — reproducible storm→split assignment.

No opaque model is saved without metadata.

---

## O. Reproducibility command

```
python3 train_era5_ri.py \
  --data era5_datasets/era5_ri_rebuilt.csv \
  --seed 42 \
  --output-dir models \
  --frozen-model models/era5_final_xgboost.json
```

Run from `RI/`. The CLI has no hard-coded machine-specific paths; the dataset
path and seed are explicit arguments. Same dataset + code + seed reproduces the
same split, model and metrics (verified). `--no-frozen-baseline` skips the
frozen comparison; `--query` prints the configuration without training. Note
the former `cyclone_backup/...` paths are the renamed `RI/...` paths; the CLI's
defaults already point at repo-relative files.

---

## P. Test results

All ERA5 tests pass (42) and the full root suite passes (208); 250 total.

```
RI/tests/test_era5_rebuild.py         12 passed
RI/tests/test_era5_training.py        30 passed
tests/ (root, incl. adapters/split/leakage/orchestrator)  208 passed
```

New/updated training tests cover: exact 89-feature input, feature order,
no forbidden predictor columns, predictor set ⊆ dataset columns, storm-wise
split with zero overlap, reproducible seed-42 split (and seed sensitivity),
training-only class weighting, best-iteration metadata == saved model, adapter
prediction at `(0, best+1)`, fallback-with-warning when no best iteration,
temporal-delta semantics (documented + behavioural), saved metadata
completeness/artifacts-on-disk, test-prediction schema, validation-only
threshold selection, no-calibration honesty, constant-prevalence baseline
semantics.

Structural note: `RI/src` and the repo-root `src` are two top-level packages
named `src` (namespace collision left over from the `cyclone_backup` → `RI`
rename), so the root suite and the RI suite must be run in **separate** pytest
processes (`pytest tests/` from the repo root; `pytest tests/` from `RI/`).
Each is green on its own.

---

## Q. Limitations

* **Dataset size**: 870 rows / 126 storms is small for an 89-feature model;
  the test split is only 177 rows / 25 RI.
* **RI class imbalance**: 9.4 % overall; mitigated only by
  `scale_pos_weight` (train-only). PR-AUC is a useful lens; extreme care is
  needed reading accuracy/F1 on this population.
* **Temporal-delta semantics**: features are "change vs previous within-storm
  observation, capped at lag", not true fixed-lag deltas. Preserved by design
  for this run; first-row-of-storm deltas are NaN and the model has no
  recency signal there.
* **ERA5 historical raw-data availability / CDS credentials**: raw NetCDF
  coverage is partial (20 files; 848 of 870 rows carried from the historical
  MVP table rather than freshly extracted) because CDS credentials/access are
  not available. No data was fabricated to fill the gap.
* **Frozen-model comparison is confounded**: the frozen artifact does not
  record its train/test storms; its strong numbers on this test split are
  expected under likely storm overlap and must not be read as skill.
* **Era skew in the test split**: the >2004 test presence is 2 rows / 0 RI;
  post-2004 era performance is not measurable here.
* **No calibration**: probabilities are raw and should not be consumed as
  reliable probabilities.
* **No leakage-free error-analysis features beyond the dataset**: basin/era
  breakdowns use rules over existing columns only.

---

## R. Readiness for Improvement 4

| Next experiment | Readiness | Notes |
|---|---|---|
| **IMD vs ERA5 comparison** | ✅ Ready | Clean ERA5 baseline on the rebuilt 89-feature contract, deterministic split, honest caveats documented. IMD baseline artifact (`imd_final_xgboost.json`) is present for a same-split comparison. |
| **IMD + ERA5 fusion** | 🟡 Partially ready | Requires aligning IMD rows to the rebuilt ERA5 rows on identical storm/test splits; the runtime fusion meta-model still does not exist. Feasible as a training-time experiment. |
| **Calibration** | 🟡 Ready to start | Reliability table baseline (MACE 0.28) recorded; separate calibration step is explicitly *not* claimed yet. |
| **Satellite branch work** | 🟢 Independent | Unrelated to ERA5; satellite metadata/path references were updated for the rename as cleanup, and its tests now pass. |

Overall: the phase delivers a trustworthy, reproducible ERA5-only RI baseline
with a held-out storm test result — the foundation for the IMD vs ERA5 and
IMD+ERA5 fusion phases.

---

## HARD-RULE compliance checklist

1. No fabricated training data — ✔ real rebuilt data only (848 carried + 22 genuinely extracted).
2. No fabricated metrics — ✔ all numbers from the one held-out test run.
3. No synthetic data — ✔.
4. No row-level random splitting — ✔ storm-wise, seed 42.
5. No tuning on the test set — ✔ test touched exactly once for evaluation.
6. No class weights from test data — ✔ train-only.
7. 89-feature contract unchanged — ✔ asserted everywhere.
8. Temporal-delta semantics unchanged — ✔ documented + regression-tested.
9. Not called calibrated — ✔ `NOT CALIBRATED` everywhere.
10. No arbitrary imputation — ✔ native XGBoost missing-value handling.
11. ERA5 not integrated into production runtime — ✔ adapter remains IMD-only.
12. Historical/frozen vs new metrics labelled — ✔ confounding caveat + different-population labels.
13. Training failure policy — ✔ none occurred; run completed deterministically.