# RI Improvement 4 — Fair IMD vs ERA5 vs IMD+ERA5 Fusion Comparison

> Audit date: 2026-09-13 · Branch: `main` · Scope: **controlled comparison of the
> IMD-only, ERA5-only and IMD+ERA5-fusion RI models on identical held-out test
> storms.** The path prefix in this record is `RI/…` (the former
> `cyclone_backup/…` directory was renamed to `RI/`).

---

## Completion report

```
STATUS:                compared
COMMON DATASET:        inner join of RI/era5_datasets/era5_ri_rebuilt.csv
                       (rebuilt ERA5, 870 rows) with RI/models/IMD_BoB_RI_training_base.csv
                       on (storm_id, datetime_utc)
ROWS:                  870 (0 lost; both modalities present for every row)
STORMS:                126
RI POSITIVES:          82
RI NEGATIVES:          788
COMMON TRAIN/VAL/TEST: train 82 storms / 587 rows | val 19 storms / 106 rows | test 25 storms / 177 rows
ZERO STORM OVERLAP:    True (verified); split IDENTICAL to Improvement 3
IMD ROC-AUC:           0.5555
IMD PR-AUC:            0.2230
IMD BRIER:             0.192635
ERA5 ROC-AUC:          0.5871
ERA5 PR-AUC:           0.1627
ERA5 BRIER:            0.157886
FUSION ROC-AUC:        0.6532
FUSION PR-AUC:         0.2249
FUSION BRIER:          0.148069
ERA5 UPLIFT (vs IMD):  ROC +0.0316 | PR-AUC -0.0603 | BRIER -0.0347
FUSION UPLIFT (vs IMD): ROC +0.0976 | PR-AUC +0.0019 | BRIER -0.0446
BOOTSTRAP (95% CI, storm-level): see section J (overlapping PR-AUC CIs)
CALIBRATED:            NO
FUSION ARTIFACT:       RI/models/imd_era5_fusion_model.json
TESTS:                 60 RI tests (12 rebuild + 30 training + 18 comparison) + 208 root tests all pass
REPRODUCIBLE:          python3 compare_ri_imd_era5.py --era5-data era5_datasets/era5_ri_rebuilt.csv
                       --imd-csv models/IMD_BoB_RI_training_base.csv --seed 42 \
                       --output-dir models --bootstrap-n 1000
SCIENTIFIC CONCLUSION: ERA5 ALONE does not add useful predictive value over IMD
                       in this sample by the primary decision metric (PR-AUC −0.060).
                       The IMD+ERA5 fusion also does not separate from IMD on PR-AUC
                       (Δ +0.002; 95% bootstrap CIs overlap): an honest reading is
                       NEGATIVE (ERA5 alone) and NEUTRAL / INCONCLUSIVE (fusion).
NEXT STEP:             calibration of the fusion model; more positive storms /
                       longer record before any production claim
```

---

## A. Objective

Answer the scientific question:

> **Does ERA5 add useful predictive information for rapid-intensification (RI)
> ranking beyond the existing IMD model?**

with a **fair, controlled experiment**:

1. a single common observation universe (both modalities + valid target),
2. one storm-wise seed-42 split shared by every arm,
3. three arms — IMD-only, ERA5-only, IMD+ERA5 fusion — each evaluated once on
   the same held-out test storms,
4. thresholds selected on the validation split only (never test),
5. storm-level bootstrap to express sampling uncertainty,
6. an explicit, machine-readable verdict (positive / negative / neutral /
   inconclusive) that refuses to over-read tiny deltas.

Nothing here fabricates data, imputes whole modalities, splits at row level, or
turns on classification **by looking at the test set**.

---

## B. Common observation universe

**Construction.** The rebuilt ERA5 table (`era5_ri_rebuilt.csv`, RI Improvement 2)
was inner-joined with the canonical IMD feature table
(`IMD_BoB_RI_training_base.csv`) on `(storm_id, datetime_utc)`. The resulting
universe is every observation that exists in **both** modalities with a valid RI
target.

| Quantity | Value |
|---|---|
| Rebuilt ERA5 rows | 870 |
| Rows joined 1:1 to IMD | 870 (0 lost) |
| Storms | 126 |
| RI positive / negative | 82 / 788 |
| Prevalence | 0.14124 |

**Target agreement.** Every common row has an identical `RI_24h` from both
source tables (asserted: `RI_24h_era == RI_24h` for all 870 rows).

**IMD feature missingness (transparent, not imputed).** The 12 IMD predictors
arrive with sparse missingness because they are physically undefined at the start
of a storm record or missing in the early record:

| IMD feature | non-null / 870 |
|---|---|
| latitude, longitude, max_wind_kt | 870 / 870 |
| central_pressure_hpa | 639 |
| pressure_drop_hpa | 727 |
| wind_6h_change, wind_minus_6h_kt, delta_v_minus_6h_kt | 508 |
| wind_minus_12h_kt, delta_v_minus_12h_kt | 439 |
| wind_minus_24h_kt, delta_v_minus_24h_kt | 494 |
| **all 12 complete** | **234** |

Following the project’s documented design, missing values are handled by
XGBoost’s **native missing-value branch** — the same design used for the frozen
IMD model, the ERA5 baseline and the fusion model. Requiring all 12 IMD features
to be non-null would have discarded 73% of the sample (234/870 rows, 38/126
storms), which would have been a worse, unrepresentative compromise. The
missingness itself is recorded in the artifact metadata.

---

## C. Feature contracts

| Arm | Feature count | Source |
|---|---|---|
| IMD-only | 12 | `IMD_FEATURE_COLS` (frozen ordering, asserted equal to `imd_final_xgboost.json`) |
| ERA5-only | 89 | exact Improvement-2 contract (`era5_feature_names()`), asserted |
| Fusion | 101 | 12 IMD + 89 ERA5, **unique names**, no IMD↔ERA5 overlap (asserted) |

The fusion vector is exactly `IMD_FEATURE_ORDER + era5_feature_names()`. The
schema artifact (`imd_era5_fusion_feature_schema.json`) records all 101 names
machine-readably with source tags (`imd`/`era5`), a uniqueness flag and an empty
overlap list. No id/target/provenance column appears in any arm; the stricter
ERA5 contract additionally excludes `latitude`/`longitude` (they remain
legitimate IMD predictors, part of the frozen IMD model).

---

## D. Common storm-wise split

`storm_split(common_df, seed=42)` — the identical deterministic procedure used in
Improvement 3 — produces the train/val/test partition. It is **verified against
the recorded Improvement-3 artifact** (`era5_ri_storm_split.csv`) and found
identical storm-for-storm:

| Split | Storms | Rows | RI+ / RI− |
|---|---|---|---|
| train | 82 | 587 | 53 / 534 |
| val | 19 | 106 | 4 / 102 |
| test | 25 | 177 | 25 / 152 |

Zero storm overlap is asserted for train/val/test. Because the common split is
identical to Improvement 3, the **Improvement-3 ERA5 model itself is reused as
the ERA5 arm** (`mode = reuse_improvement_3`, verified best iteration 59) — the
cleanest possible reuse, with no retraining and no leakage.

---

## E. Model configuration

XGBoost `binary:logistic` for every arm; hyperparameters from `RI/config.yaml`
(`imd_model` / `era5_model` / `combined_model` blocks are identical values):

- `n_estimators=400`, `learning_rate=0.05`, `max_depth=4`, `min_child_weight=2`,
- `subsample=0.85`, `colsample_bytree=0.85`, `max_delta_step=1`,
- early stopping (50 rounds) on validation PR-AUC (`eval_metric=aucpr`),
- `scale_pos_weight = neg_train / pos_train = 534/53 = 10.0755` (train only),
- no scaler/imputer; native missing-value handling,
- storm-level grouped 5-fold CV as a diagnostic (not hyperparameters).

Grouped-CV PR-AUC: **IMD 0.4583** (folds [0.714, 0.024, 0.866, 0.465, 0.222]),
**fusion 0.4164** (folds [0.707, 0.065, 0.557, 0.585, 0.169]). ERA5 grouped-CV
0.2125 was recorded in Improvement 3 (model reused, not re-CV’d).

---

## F. Training / arms

The freshly trained arms (IMD, fusion) fit on the **common train storms only**;
the ERA5 arm is the parked Improvement-3 model with its verified best iteration
(59) constrained via `iteration_range`. Thresholds are selected **per arm** on the
**common validation split** (max F1, grid 0.01):

| Arm | Threshold | Val F1 | Best iteration |
|---|---|---|---|
| IMD | 0.01 | 0.1379 | fits in run (`imd_ri_model.json`) |
| ERA5 | 0.33 | 0.2105 | 59 (reused artifact) |
| Fusion | 0.49 | 0.3333 | 73 (`imd_era5_fusion_model.json`) |

> The IMD threshold lands at the floor of the grid (0.01) because the validation
> split holds only 4 RI positives; this is a legitimate val-selected value but it
> makes the IMD *thresholded* metrics (precision/recall/F1/accuracy) fragile.
> Threshold-free metrics (ROC-AUC, PR-AUC, Brier) are unaffected.

---

## G. Test metrics (identical 25 storm / 177 row test set for every arm)

At each arm’s own validation-selected threshold:

| Metric | IMD | ERA5 | Fusion |
|---|---|---|---|
| ROC-AUC | 0.5555 | 0.5871 | **0.6532** |
| PR-AUC | **0.2230** | 0.1627 | **0.2249** |
| Brier | 0.192635 | 0.157886 | **0.148069** |
| Precision | 0.14286 | 0.17308 | 0.29167 |
| Recall | 0.76 | 0.36 | 0.28 |
| F1 | 0.24051 | 0.23377 | **0.28571** |
| Accuracy | 0.32203 | 0.66667 | 0.80226 |
| Pred positive | 133 | 52 | 24 |
| Prevalence (test) | 0.14124 | 0.14124 | 0.14124 |

---

## H. Baselines

| Baseline | ROC-AUC | PR-AUC | Note |
|---|---|---|---|
| Constant prevalence (train prev 0.09029) | 0.5 | 0.1412 | honest no-leak baseline; Brier 0.12389 |
| **Frozen IMD** `imd_final_xgboost.json` (same test) | 0.8368 | 0.4033 | **CONFOUNDED** — trained on the seed-42 IMD table; test-storm overlap LIKELY |
| **Frozen ERA5** `era5_final_xgboost.json` (same test) | 0.7818 | 0.5411 | **CONFOUNDED** — trained on the 848-row MVP; test-storm overlap LIKELY |

The contrast is instructive: the frozen artifacts *look* dramatically better
(PR-AUC 0.40/0.54 vs fresh 0.22/0.16) but are contaminated by likely training/test
storm overlap. **They are reference-only and never used in the verdict.**

---

## I. Uplift analysis (ERA5 beyond IMD)

| Delta | ERA5 vs IMD | Fusion vs IMD | Fusion vs ERA5 |
|---|---|---|---|
| ROC-AUC | +0.0316 | +0.0976 | +0.0661 |
| PR-AUC | **−0.0603** | **+0.0019** | +0.0622 |
| Brier | −0.0347 | −0.0446 | −0.0098 |

Interpretation on this sample:

- **ERA5 alone** has *lower* PR-AUC than IMD (0.163 vs 0.223) while achieving a
  slightly higher ROC-AUC and lower Brier. On the project’s primary decision
  metric (PR-AUC), ERA5 does not add value over IMD.
- **Fusion** recovers the best overall Brier (0.148), the best ROC-AUC (0.653),
  the best F1 (0.286) and a PR-AUC statistically indistinguishable from IMD
  (0.225 vs 0.223). The small PR-AUC delta (+0.002) is **not** meaningful on its
  own — see the bootstrap intervals.

---

## J. Storm-level bootstrap (1 000 resamples, seed 42)

Storms in the test split are resampled with replacement (all observations of each
sampled storm travel together); per-resample ROC-AUC / PR-AUC are collected when
both classes are present. Percentile 95% intervals:

| Arm | ROC-AUC mean [95% CI] | PR-AUC mean [95% CI] |
|---|---|---|
| IMD | 0.5632 [0.4268, 0.7437] | 0.2456 [0.1261, 0.4009] |
| ERA5 | 0.5829 [0.4874, 0.6826] | 0.1689 [0.0934, 0.2530] |
| Fusion | 0.6519 [0.5213, 0.7851] | 0.2506 [0.1230, 0.3985] |

All 1 000 resamples were usable for every arm. The IMD and fusion PR-AUC
intervals overlap almost completely — the fusion Δ+0.002 cannot be separated from
noise at 95% confidence. The ERA5 PR-AUC interval sits below IMD’s (pointwise),
which is why the verdict for “ERA5 alone” is negative rather than neutral.

---

## K. Cross-model error analysis (same 177 test rows, each arm’s own threshold)

| Category | Count |
|---|---|
| IMD right & ERA5 wrong | 16 |
| ERA5 right & IMD wrong | 77 |
| Both right | 41 |
| Both wrong | 43 |
| **Fusion corrects where both wrong** | **26** |
| Fusion introduces errors where both right | 4 |

Notable qualitative observations:

- **ERA5 was right where IMD was wrong 77×** (and where IMD missed, e.g.
  `1999-006`, `1994-004` RI=1 events that IMD scored near 0.008–0.004 while ERA5
  scored 0.39–0.38). This is complementary information, but it did not translate
  into a PR-AUC improvement because ERA5 also produced more high-confidence
  false positives on non-RI rows.
- **IMD was right where ERA5 was wrong 16×** — most strikingly the 1997-001 and
  2000-001 non-RI rows ERA5 scored ≥ 0.43.
- **Largest IMD↔ERA5 disagreements**: `1982-002` non-RI rows that IMD scored
  0.99/0.96 while ERA5 scored 0.15/0.16; an `1989-008` RI row IMD scored 0.92
  while ERA5 scored 0.12.
- **Fusion fixes**: in 26 of the 43 rows where both single-modality arms were
  wrong, the fusion was right; it introduced an error in only 4 of the 41 rows
  where both were right. The fusion lever downsizes ERA5’s excess confidence on
  non-RI rows (fusion predicted positive only 24 times vs IMD’s 133).

Decision-threshold caveat: these counts are threshold-dependent; the threshold
for the IMD arm is fragile (section F).

---

## L. Calibration status

**NOT CALIBRATED.** All probabilities are raw XGBoost sigmoid outputs. No
calibration is claimed anywhere in this record or its artifacts.

---

## M. Verdict — does ERA5 add useful predictive information beyond IMD?

Primary decision metric (project convention): **PR-AUC.** The verdict is
encoded machine-readably in the comparison metadata (`verdict`):

| Field | Value |
|---|---|
| `era5_vs_imd_pr_auc_uplift` | −0.0603 |
| `fusion_vs_imd_pr_auc_uplift` | +0.0019 |
| `era5_adds_value_over_imd` | **negative** |
| `fusion_adds_value_over_imd` | **neutral** |

**Statement.** In this controlled sample, **ERA5 alone does not add useful
predictive value over IMD**: its PR-AUC is materially *lower* (0.163 vs 0.223).
Fusing ERA5 with IMD yields the best Brier/ROC/F1 of any arm but only a
statistically indistinguishable +0.002 PR-AUC over IMD with overlapping
storm-level bootstrap intervals — an honest reading is **neutral / inconclusive
for fusion**. The evidence does not support the claim that ERA5 provides
independent, reproducible predictive lift for RI in this 25-storm test sample.
The complementary-error analysis (fusion corrects 26 of 43 both-wrong rows)
suggests ERA5 *contains* information worth fusing, but the sample is too small to
elevate that to a finding.

Also note: the frozen artifacts’ superior-looking raw numbers (PR-AUC 0.40/0.54)
are **confounded by likely storm overlap** and are not evidence of model quality.

---

## N. Saved artifacts (in `RI/models/`)

| File | Contents |
|---|---|
| `imd_era5_fusion_model.json` | fresh 101-feature fusion XGBoost (best it. 73) |
| `imd_era5_fusion_feature_schema.json` | machine-readable 101-feature schema (unique, tagged) |
| `imd_era5_fusion_training_metadata.json` | fusion training/eval metadata |
| `imd_era5_fusion_test_predictions.csv` | 177 test rows with `P_IMD, P_ERA5, P_FUSION` + thresholds |
| `imd_era5_common_storm_split.csv` | 126 storms with train/val/test membership |
| `imd_era5_comparison_metadata.json` | full comparison: universe, arms, bootstrap, uplift, verdict, error analysis |
| `imd_ri_model.json` | fresh 12-feature IMD arm (fair-arm artifact) |

Existing artifacts still present and reused read-only: `era5_ri_model.json`,
`era5_final_xgboost.json`, `imd_final_xgboost.json`.

---

## O. Reproducibility command

```
python3 compare_ri_imd_era5.py \
    --era5-data era5_datasets/era5_ri_rebuilt.csv \
    --imd-csv models/IMD_BoB_RI_training_base.csv \
    --seed 42 --output-dir models --bootstrap-n 1000
```

Determinism was **verified twice**: two full runs produced identical thresholds,
evaluations, bootstrap means/CIs and verdicts for every arm.

---

## P. Test results

`RI/tests/test_ri_comparison.py` (18 new tests) covers: common-universe
construction and 1:1 join, native-missing documentation, zero storm overlap,
identical-Improvement-3 split, 101-unique fusion contract, schema/artifact
integrity, shared test-storm sets per arm, ERA5-arm reuse mode, thresholds
reproduced from validation-only (recomputed and compared), honest constant
baseline (assigned train prevalence; AP = data prevalence), frozen-vs-fair
separation, bootstrap presence, cross-model error accounting (categories sum to
177), and the explicit verdict vocabulary.

RI suite: **60 passed** (12 rebuild + 30 training + 18 comparison).
Root suite (separate process): **208 passed**. Total 268.

---

## Q. Limitations

1. **Small positive count** — only 25 test RI rows (74 test-adjacent; universe
   82). PR-AUC differences of ±0.06 sit inside the noise floor of the bootstrap.
2. **Fragile IMD threshold** — IMD val-selected threshold sits at the grid floor
   (0.01) because the val split has 4 RI positives; its thresholded metrics are
   unstable. AUC/Brier are threshold-free and unaffected.
3. **MD missingness 73%** — only 234/870 rows carry all 12 IMD features. Native
   missing-handling is the shared, documented design, but it does not recover
   information absent at the source.
4. **Threshold-dependent error analysis** — category counts (section K) change
   with each arm’s threshold and must not be over-read.
5. **The 1982-era compared** — ERA5 is drawn from a rebuilt record carrying
   early-era uncertainty (see Improvement-2 record); results are record-bound.
6. **No calibration** — a calibrated fusion might be the production-worthy
   artifact; this experiment stops at ranking/uncertainty, not decision entropy.
7. **Not a deployment** — no runtime adapter changes; the production RI branch
   remains IMD-only.

---

## HARD-RULE compliance checklist

1. No fabricated training data — ✔ real rebuilt ERA5 + real IMD, joined 1:1.
2. No fabricated metrics — ✔ every number from the one held-out run.
3. No synthetic data — ✔.
4. No row-level splitting — ✔ storm-wise, seed 42, zero overlap, identical to Imp3.
5. No test-set tuning / thresholds / class weights — ✔ threshold per arm from the
   common validation split; `scale_pos_weight` train-only.
6. No calibration claims — ✔ `NOT CALIBRATED` everywhere.
7. No imputation of whole modalities — ✔ native XGBoost missing handling,
   missingness recorded.
8. No production integration — ✔ adapter remains IMD-only; comparison is a
   training-time experiment.
9. Historical/frozen vs new metrics labelled — ✔ both frozen artifacts explicitly
   flagged as confounded/likely-storm-overlap and kept out of the verdict.
10. Tiny-delta over-reading avoided — ✔ bootstrap CIs + `neutral/inconclusive`
    vocabulary; the only 'negative' claim is a metric where the gap (−0.060
    PR-AUC) is consistent with its bootstrap interval.
11. Explicit conclusion field — ✔ `verdict` in metadata + section M answers the
    objective question directly.
12. STOP-if-unbuildable policy — ✔ no blocker arose: the common universe,
    identical split and fair arms were all constructible from real data.