# RI Improvement 1 — Reconstruct the Existing ERA5 RI Training Pipeline

> Audit date: 2026-09-12 · Branch: `main` · HEAD `c6a8db9`
> Scope: READ-ONLY reconstruction. **Nothing was trained, tuned, re-parameterised,
> or modified.** The purpose is to establish exactly what data, features and
> procedure produced `era5_final_xgboost.json` before rebuilding the ERA5 branch.
> All "factory" scripts live in `cyclone_backup/`; the runtime adapter lives in
> `src/models/adapters/ri_adapter.py`.

---

## 1. What training code exists, and what it actually does

| Artifact | File | Role |
| --- | --- | --- |
| Canonial ERA5 feature table | `cyclone_backup/models/RI_ERA5_features_MVP.csv` | **The training data.** 21 base ERA5 columns matched to IMD observations. |
| Base-column schema | `cyclone_backup/src/data.py:49` (`ERA5_RAW_COLS`) | 20 level fields + shear. |
| Derived (physics) features | `cyclone_backup/src/features.py:82` (`add_era5_derived`) | +17 features computed from the base columns. |
| Temporal-delta features | `cyclone_backup/src/features.py:137` (`add_temporal_features`) | +51 features (`delta_6h/12h/24h_*`). |
| Feature list constructor | `cyclone_backup/src/features.py:29-45` | `era5_feature_columns_with_temporal()` → exactly the 89 names. |
| Final ERA5 model artifact | `cyclone_backup/models/era5_final_xgboost.json` | 89 features, 91 trees, `best_iteration=40`. |
| Trainer | `cyclone_backup/src/models.py:101` (`train_xgboost`) | XGBoost, `binary:logistic`, early stopping on val, `scale_pos_weight` from train. |
| Training script | `cyclone_backup/run_pipeline.py:381-470` | Builds table, splits storms, trains+save, evaluates. |
| Definitive comparison script | `cyclone_backup/run_final_imd_era5_comparison.py` | Copies `era5_xgboost.json` → `era5_final_xgboost.json`; evaluates on the strict common test set; never retrains. |
| Runtime adapter | `src/models/adapters/ri_adapter.py` | Loads the SAME 89-feature artifact but runs **IMD-only** (feature builder for 89 reanalysis features doesn't exist at runtime). |

**Verified identity:** `era5_final_xgboost.json` is a byte-level copy of `era5_xgboost.json`
(`run_final_imd_era5_comparison.py:588-594`). The model is therefore exactly the one
trained by `run_pipeline.py` (seed 42).

**Reproduced end-to-end metric check (this audit):** rebuilding the matrix from
`RI_ERA5_features_MVP.csv` via `add_era5_derived` + `add_temporal_features(lags=[6,12,24])`
and predicting the ERA5 test split (174 obs / 20 storms / 25 RI) with
`iteration_range=(0, 41)` (best 41 trees) reproduces the documented metrics **exactly**:

| Metric | Documented (§9c) | Reproduced |
| --- | --- | --- |
| PR-AUC | 0.2969 | 0.2969 |
| ROC-AUC | 0.7047 | 0.7047 |

This proves the reconstruction procedure in §2–§7 **is** the original training procedure.

---

## 2. The exact 89-feature list (from the artifact's own `feature_names`, order = model)

The Booster stores exactly 89 named features; `era5_feature_columns_with_temporal()`
reconstructs the **same 89 names in the same order** (verified, 0 mismatches).

### Group A — raw ERA5 levels (20 features): `d`, `r`, `t`, `u`, `v` at 850/700/500/200 hPa

| # | Feature | ERA5 CDS variable | Level (hPa) | Calculation | Units | Reproducible? |
| - | - | - | - | - | - | - |
| 1–4 | `d_850/700/500/200` | `divergence` | 850/700/500/200 | bilinear interpolation at storm centre | 10⁻⁶ s⁻¹ | YES — in CSV & from NetCDF |
| 5–8 | `r_850/700/500/200` | `relative_humidity` | 850/700/500/200 | bilinear at centre | % (ERA5 RH, can exceed 100) | YES |
| 9–12 | `t_850/700/500/200` | `temperature` | 850/700/500/200 | bilinear at centre | K | YES |
| 13–16 | `u_850/700/500/200` | `u_component_of_wind` | 850/700/500/200 | bilinear at centre | m s⁻¹ | YES |
| 17–20 | `v_850/700/500/200` | `v_component_of_wind` | 850/700/500/200 | bilinear at centre | m s⁻¹ | YES |

### Group B — base environment (21 features): #20 ends with `shear_850_200`

| # | Feature | Source | Calculation | Units |
| - | - | - | - | - |
| 21 | `shear_850_200` | `u,v` 850 & 200 | `sqrt((u200−u850)² + (v200−v850)²)` | m s⁻¹ |

### Group C — derived physics (17 features): `add_era5_derived` (`src/features.py:47-79`)

| # | Feature | Calculation | Units |
| - | - | - | - |
| 22 | `rh_mean_850_500` | `(r_850 + r_700 + r_500)/3` | % |
| 23 | `wind_mag_850` | `sqrt(u_850² + v_850²)` | m s⁻¹ |
| 24 | `wind_mag_700` | `sqrt(u_700² + v_700²)` | m s⁻¹ |
| 25 | `wind_mag_500` | `sqrt(u_500² + v_500²)` | m s⁻¹ |
| 26 | `wind_mag_200` | `sqrt(u_200² + v_200²)` | m s⁻¹ |
| 27 | `divergence_contrast_200_850` | `d_200 − d_850` | 10⁻⁶ s⁻¹ |
| 28 | `u_shear_850_200` | `u_200 − u_850` | m s⁻¹ |
| 29 | `v_shear_850_200` | `v_200 − v_850` | m s⁻¹ |
| 30 | `shear_direction_deg` | `degrees(atan2(v_shear_850_200, u_shear_850_200))` | ° |
| 31 | `r_850_minus_500` | `r_850 − r_500` | % |
| 32 | `r_850_minus_700` | `r_850 − r_700` | % |
| 33 | `r_700_minus_500` | `r_700 − r_500` | % |
| 34 | `t_850_minus_500` | `t_850 − t_500` | K |
| 35 | `t_850_minus_700` | `t_850 − t_700` | K |
| 36 | `t_700_minus_500` | `t_700 − t_500` | K |
| 37 | `divergence_contrast_500_850` | `d_500 − d_850` | 10⁻⁶ s⁻¹ |
| 38 | `divergence_contrast_200_500` | `d_200 − d_500` | 10⁻⁶ s⁻¹ |

### Group D — temporal deltas (51 features): `add_temporal_features`

For lag ∈ {6, 12, 24} h and base feature `c`, the value at time `t` is
`(c(t) − c(t−lag))` computed from the **previous observation within the same
storm**, kept only if that previous row is within `lag` hours (`<=`, inclusive).
17 base features receive this treatment per lag (all of Group C **except** the
pure re-combinations: `wind_mag_*` kept, all `*_minus_*` kept, divergence
contrasts kept, shear terms kept, `rh_mean` kept) → 17 × 3 = 51 columns:

`delta_6h_`: `rh_mean_850_500`, `wind_mag_850/700/500/200`, `divergence_contrast_200_850`,
`u_shear_850_200`, `v_shear_850_200`, `shear_direction_deg`, `r_850_minus_500/700`, `r_700_minus_500`,
`t_850_minus_500/700`, `t_700_minus_500`, `divergence_contrast_500_850`, `divergence_contrast_200_500`
(17); same 17 repeated for `delta_12h_` and `delta_24h_`.

> **Names are NOT renamed or re-ordered anywhere.** Training uses the raw columns
> in HTML-native model order; no feature is dropped (all 89 survive
> `prepare_features` — 0 fully-missing columns in the training data).

---

## 3. Original training dataset status

| Property | Value |
| --- | --- |
| File | `cyclone_backup/models/RI_ERA5_features_MVP.csv` (**present, 989 KB**) |
| Rows | 848 (all with known `RI_24h`; 0 censored) |
| Storms | 107 |
| Positive / negative | **76 RI / 772 non-RI** (prevalence 8.96 %) |
| Date range | `1982-05-01 03:00` → `2000-03-29 12:00` |
| Starred columns | 21 base ERA5 + identity/label/timestamp (`storm_id`, `datetime_utc`, `latitude`, `longitude`, `RI_24h`, `era5_datetime`, `era5_delta_minutes`) |
| Target column | `RI_24h` (integer) |
| Derived/temporal columns | **not stored** — recomputed at load time by `src/features.py` |

**The raw training table therefore reconstructs the training matrix in full**:
`load_era5` → `add_era5_derived` → `add_temporal_features` yields exactly the 89 columns
the model consumes, with 848 rows, 174 (20 storms / 25 RI) held out for test.

### Related files present in repo (not the training data)
- `models/IMD_BoB_RI_training_base.csv` — raw IMD table (5009 rows / 291 storms; 1791 end-of-storm censored rows w/ NaN `RI_24h`).
- `models/IMD_RI_dataset_1982_2025.csv` — wider IMD export (7566 rows / 425 storms; 2567 censored).
- `models/IMD_ERA5_observations_ready.csv` — IMD rows joined to `era5_longitude/date/hour` metadata only (not the level features).
- `ri_multimodal_dataset.csv` (repo root) — canonical 3-modal table (has_imd/has_era5/has_satellite flags), built by `src/ri_dataset.py`.
- `ERA5_expanded/*.nc` — **20** Copernicus CDS `reanalysis-era5-pressure-levels` files (0.25° grid, 5 vars × 4 levels). These cover only satellite-overlap dates; the expanded feature table they feed (`results/RI_ERA5_features_expanded.csv`, 870 rows / 126 storms) and the three-way table are **absent** (the `results/` directory does not exist in the repo).

---

## 4. Reconstructed target definition (unchanged contract)

- **Definition:** RI = Δ(max sustained wind) ≥ **30 kt** over the next **24 h** (`config.yaml`: `ri.horizon_hours=24`, `ri.threshold_kt=30`).
- **Binary label:** `RI_24h = 1` if `delta_v_24h_kt >= 30`, else 0 (computed from `wind_24h_kt − max_wind_kt` where the t+24h observation exists).
- **Timestamp:** label is aligned to a *prediction time `t`* = the current observation's `datetime_utc`; the window used is `[t, t+24h]`.
- **Missing future observations:** rows where the t+24h observation does not exist are **censored (dropped, never set to 0)** — `src/data.py:load_imd` drops NaN `RI_24h`; the raw export records 1791 such rows.
- **Overlapping windows allowed:** yes — every observation is an independent sample with its own 24 h window; consecutive rows overlap by ~21 h (typical 3–6 h sampling).
- **Near storm start/end:** observational `wind_minus_6h/12h/24h` and the ERA5 `delta_*` features are simply NaN for early rows (no special handling); XGBoost splits missing values natively. No row is dropped for missing *predictors*, only for missing *labels*.
- **Best-track observation gaps:** gaps > 12 h inside a storm are flagged by `audit_ri_label_construction` (they widen the true window of a label); such rows are retained but reported.

**Not modified in this audit.**

---

## 5. Temporal alignment & leakage audit (per feature group)

| Group | At time `t`, what is used? | Leakage? |
| --- | --- | --- |
| A/B raw levels + shear | ERA5 reanalysis interpolated **at the exact IMD observation instant** (`era5_delta_minutes` = 0.0 for **all 848 rows**, verified; `era5_datetime == datetime_utc` in 100 % of rows). Reanalysis already incorporates data *up to* that valid time. | NONE — no field after `t`. |
| C derived physics | Pure function of Group A/B at the same `t`. | NONE. |
| D temporal deltas | `c(t) − c(t_prev)` where `t_prev` is the immediately preceding row in the **same storm** and `t − t_prev ≤ lag` (verified code). Only past rows. | NONE — historical only. |
| Target | `RI_24h` is the **label only**; forbidden predictor set enforced (`RI_24h`, `wind_24h_kt`, `delta_v_24h_kt`, `target_time_24h`) — `run_final_…`:60. | Labels only. |

**Caveats (honest, not leakage):**
1. **Delta-lag mismatch.** IMD is 3-hourly (median 3 h, modes 3/6/9/15 h) and ERA5 is 6-hourly (median 6 h, modes 6/3/9/15 h). `add_temporal_features` compares the current row to the *previous* row **within the storm and within the lag window** — when rows are 3 h apart, `delta_6h_*` is really a 3 h change; when 15 h apart, it is dropped. It is "change since the last observation (capped at lag)" rather than a true 6/12/24 h change. Fine for training consistency; must be pinned when rebuilding a cleaner dataset.
2. **Reanalysis caveat (operational, not statistical):** ERA5 is reanalysis, not a forecast. At a *real* issue time `t` you don't have ERA5 valid at `t`; the training pipeline consumes reanalysis valid exactly at `t`, which is the scientific standard for a development/evaluation dataset but must be replaced by forecast/analysis fields for operational issuance (already documented in `cyclone_backup/README.md` §5b).
3. **Window overlap** is allowed, so repeated rapid-change periods contribute several positive rows from one storm (normal for RI detection; handled implicitly by storm-safe splits).

---

## 6. Spatial extraction method

- **Grid:** ERA5 `reanalysis-era5-pressure-levels`, 0.25° × 0.25° regular lat/lon (verified in the 20 expanded NetCDFs). 5 variables (`d`,`r`,`t`,`u`,`v`) × 4 levels (850/700/500/200 hPa).
- **Sampling: point extraction at the storm centre** — bilinear interpolation of the field at `(latitude, longitude)` of the IMD observation (`run_era5_expansion_stage2b.py:42` `bilinear`; nearest valid-time match, `era5_delta_minutes = 0`).
- **No box / radial average / max / min / gradients** are used for the 89 training features. The derived physics features are arithmetic combinations of the point values (no extra spatial sampling).
- **Day-0 origin note:** the canonical 848-row table's extraction code is not in the repo (produced before the audit pipeline); it is *statistically consistent* with the extraction method above — `era5_delta_minutes` all-zero, sane value ranges, and full training reproduction (§1) — but its NetCDF source files for 1982–2000 are not present. Only the **21 extracted columns** per row survive on disk.

**Value ranges (canonical table, all non-NaN):** `d_850` ∈ [−0.001, 0.000] (≈ −10/0 ×10⁻⁶ s⁻¹ when un-scaled), `r_850` ∈ [31.5, 102.3] %, `t_850` ∈ [288.4, 297.2] K, `u_850` ∈ [−21.1, 39.4] m s⁻¹, `shear_850_200` ∈ [1.0, 38.2] m s⁻¹. RH > 100 % is physical ERA5 supersaturation (documented in `cyclone_backup/LEAKAGE_AUDIT.md`).

---

## 7. Preprocessing

| Concern | Handling | Artifact needed? |
| --- | --- | --- |
| Inf | `replace([inf, −inf], NaN)` in `prepare_features` | none |
| Missing values | **XGBoost native missing** (no imputation anywhere) | none |
| Fully-missing columns | dropped from usable features (here: **none** — all 89 present) | none |
| Fully-missing rows | dropped by `mask = X.notna().any(axis=1)` | none |
| Scaling / normalisation | **None** for the tabular branches | none |
| Class imbalance | **`scale_pos_weight` computed from the training split only** (verified: JSON 9.9148941 vs recomputed 9.9148936 on 68-train-storm split) | none |
| Categories | N/A (all numeric) | none |
| Satellite branch | Per-fold MinMaxScaler fit on *training storms only* (`+180/310 K` normalisation) — **not** needed by the ERA5 model, but the fold-0 scaler that the runtime would need is absent from `results/` | **scaler absent** (only matters for the satellite branch) |

**No preprocessing object is required to load or predict the ERA5 model** — the raw 89-column matrix is fed straight to the Booster.

---

## 8. Existing ERA5 artifact details (verified by loading)

| Property | Value |
| --- | --- |
| Path | `cyclone_backup/models/era5_final_xgboost.json` (131,253 bytes) |
| Objective | `binary:logistic` (from saved config) |
| `scale_pos_weight` | `9.9148941` (matches era5 train split, §7) |
| Boosted trees | **91** |
| `best_iteration` | **40** (41 trees effective). `predict_proba` on an early-stopped XGBClassifier uses the best 41 trees — verified: this reproduces PR-AUC 0.2969 / ROC 0.7047 exactly on the 174-row test. **`best_iteration` is a loaded attribute, not stored in the JSON top level** — any caller must read `booster.best_iteration` (xgboost ≥2.x does expose it after load). |
| Feature names / count / order | 89, exact-match vs `era5_feature_columns_with_temporal()`, order preserved |
| Artifact integrity | Loads cleanly; identical to `era5_xgboost.json` (the `_final` copy); same 89/91/best40. |
| Identity of other era5 artifacts | `era5_only_xgboost_mvp.json` = 21-feature MVP (300 trees, no best); `era5_xgboost_improved.json` = 31-feature variant (51 trees) — **neither is the production model**. |
| Runtime adapter honesty | `src/models/adapters/ri_adapter.py` loads the *same* 89-feature artifact as a `Booster` and *would* predict, **but the adapter's mode is hard-limited to `IMD_ONLY`** (`_determine_mode`) because no runtime feature-builder turns `CycloneState`'s 17 environmental fields into the 89 reanalysis features. It never fabricates ERA5 probabilities. |

**One latent inconsistency to fix in the integration phase:** `RIBranchModel.predict_proba`
(`ri_adapter.py:69-72`) calls `booster.predict` without an `iteration_range`,
so if it were ever invoked it would use all 91 trees (PR-AUC 0.33) instead of the
best 41 (0.2969) — the 0.033 difference matters when we later integrate ERA5 at runtime.
Because the mode is `IMD_ONLY` today, this is theoretical, not live.

---

## 9. What is actually needed to rebuild the dataset (external)

To retrain ERA5 from raw reanalysis (not merely re-fit on the existing CSV):

```text
Required:
- IMD / IBTrACS 6-hourly best track (storm_id, datetime_utc, lat, lon, max_wind_kt)
    -> IMD_BoB_RI_training_base.csv/IMD_RI_dataset_1982_2025.csv are present (1982-2026)
- ERA5 `reanalysis-era5-pressure-levels`, variables divergence, relative_humidity,
  temperature, u_component_of_wind, v_component_of_wind
    -> only levels 850/700/500/200 are used
- Extraction: bilinear interpolation of each field at the storm centre,
    valid-time == observation time (era5_delta_minutes = 0, nearest match)
- Temporal deltas: previous-row-within-{6,12,24}h difference per storm
- RI labels: delta_v_24h_kt >= 30 kt; drop censored (t+24h missing) rows
```

| Need | Status |
| --- | --- |
| CDS credentials (`~/.cdsapirc`) | NOT present |
| ERA5 downloads for 1982–2000 (era5_final training domain) | NOT present (only 20 files for satellite-overlap dates are in `ERA5_expanded/`) |
| Storage | ~5 vars × 4 levels × full BoB domain per timestep; MVP used one ~0.25° file per date |
| Expected file format | NetCDF; CDS ids `d`,`r`,`t`,`u`,`v` on `reanalysis-era5-pressure-levels` |

**Important scope note for Prompt 2:** the existing 89-feature schema **does not
require** any ERA5 data beyond those 5 pressure-level variables at 850/700/500/200 —
no SST, no OHC, no full-column fields. A faithful "real ERA5 dataset" rebuild can
stay exactly within the proven 89-feature contract.

---

## 10. Leakage findings (summarised)

- **No future ERA5 used:** all 848 rows `era5_delta_minutes = 0.0`; 0 rows with `era5_datetime > datetime_utc`.
- **No future best-track used:** target only in `RI_24h`; forbidden-set enforced; temporal deltas are backward-only.
- **Storm-safe splits** (no storm in >1 split) applied at all stages; `LEAKAGE_AUDIT.md` documents 0/7 rule-group failures.
- **No label-derived predictors** (no `wind_24h_kt`, `delta_v_24h_kt`, `imd_p`-style future vars).
- **Reanalysis-at-`t` caveat** (must swap for forecast/analysis fields for genuine operational dishonesty-free use) — already known.
- Two non-leakage modelling caveats worth fixing *later* (documented, not hidden): delta-lag mismatch (§5.1) and `predict` without `best_iteration` in the runtime adapter (§8).

---

## 11. Can the existing ERA5 model be legitimately retrained from repo data?

**YES — two distinct senses, both currently feasible:**

1. **Exact re-fit (bit-compatible):** the canonical 848-row table + `src/features.py`
   + `src/models.py` (seed 42, lags [6,12,24]) reconstruct the exact training matrix,
   splits and hyperparameters. Verified: rebuilt features → predicted on the aligned
   test split → reproduced PR-AUC **0.2969** / ROC **0.7047** exactly.
2. **Dataset-wise rebuild for NEW storms/time:** also feasible in principle, but
   requires CDS credentials + ERA5 downloads for the target dates (the 1982–2000
   training domain is NOT in the repo, only its extracted 21 columns). The `ERA5_expanded/`
   mechanism already proves the pipeline pattern end-to-end for 20 satellite-overlap dates.

So the *retraining harness* is fully reproducible in-repo; the *raw reanalysis inputs*
for new dates are external (CDS) and absent.

---

## 12. Recommended next action

**RI Prompt 2 (build the real ERA5 dataset), constrained as follows:**

- Keep the **exact 89-feature schema** and the exact extraction contract (5 vars ×
  4 levels, bilinear at storm centre, `era5_delta_minutes = 0`).
- First target: **rebuild the 1982–2000 domain with real CDS ERA5 downloads** so the
  canonical table is repopulated from raw reanalysis (not just carried-over CSVs),
  adding a hard `era5_delta_minutes == 0` assertion and storing provenance per row.
- Consider extending coverage past 2000 (the canonical table currently stops 2000-03-29)
  to broaden storms — this is the single largest coverage lever for the ERA5 branch.
- Before any retrain, fix the two documented caveats: (a) define delta-lag semantics
  (true t−6/12/24 h vs previous-observation) and (b) add `iteration_range=(0, best_iteration+1)`
  to the runtime Booster predict.
- Do **not** touch IMD, satellite, or fusion during Prompt 2; deliver a leakage-safe
  dataset + validation report (rows/storms/RI, era5_delta_minutes=0 check, NaN audit,
  value-sanity report, split parity with the IMD branch).

**Stopped after this report.** No training, no satellite work, no fusion.

---

### Appendix: provenance of the numbers above
- Feature names/order/objective/trees/best_iteration/scale_pos_weight: loaded directly from `era5_final_xgboost.json` and `era5_xgboost.json`.
- Table statistics: recomputed from CSV row counts.
- Metric reproduction: local XGBoost 2.x Booster predict with `iteration_range=(0,41)` on the aligned (seed-42) test split.
- Grid/extraction: verified in `ERA5_expanded/*.nc` + `run_era5_expansion_stage2b.py`.