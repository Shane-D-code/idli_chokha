# RI Improvement 2 — Rebuild the Real ERA5 RI Dataset (reconstruct, don't train)

> Audit date: 2026-09-12 · Branch: `main` · Scope: **dataset reconstruction only.**
> No training, no tuning, no threshold/class-weight/calibration changes, no
> re-parameterisation. The 89-feature contract is **fixed** to
> `era5_final_xgboost.json` and asserted everywhere; the temporal-delta
> semantics are **documented, not changed**; raw ERA5 is extracted from the
> real CDS-format NetCDF files present in the repo — nothing is fabricated.

---

## Completion report

```
STATUS:               rebuilt (870/870 rows; contract asserted vs frozen model)
DATASET:              cyclone_backup/era5_datasets/era5_ri_rebuilt.csv
ROWS:                 870
STORMS:               126
RI POSITIVES:         82
RI NEGATIVES:         788
DATE RANGE:           1982-05-01 03:00 → 2025-11-25 03:00 (UTC)
89-FEATURE CONTRACT:  True (generated == spec == era5_final_xgboost.json, exact order, no dupes)
ERA5 ALIGNMENT:       era5_delta_minutes == 0 for 870/870; 0 rows with era5_time after obs_time
SPATIAL METHOD:       bilinear_storm_center, 0.25° CDS grid, 4 surrounding cells recorded per field
TEMPORAL DELTA SEMANTICS: within-storm change vs previous observation, kept only if gap ≤ lag (unchanged); TODO for Improvement 3
MISSINGNESS:          base 0.00 / derived 0.00 / temporal_delta 0.2464; no fully-missing feature; overall 14.1%
LEAKAGE CHECK:        clean (no future ERA5, no target in predictors, no binned-target leak)
MVP COMPARISON:       vs ri_multimodal_dataset.csv → 0 mismatches, max|diff| 2.8e-14 (float noise)
                      vs canonical recompute → 0 mismatches, max|diff| 0.0
CDS STATUS:           unavailable (no CDS credentials). 20 existing NetCDF files used;
                      848 rows carried_historical (raw NC absent, reported, not fabricated),
                      22 rows extracted_from_raw (real reanalysis bilinear extraction)
REPRODUCIBLE:         True — deterministic entry point cyclone_backup/build_era5_ri_dataset.py
TRAINING PERFORMED:   NO
NEXT STEP:            RI Improvement 3 — ERA5 retrain, delta-semantics decision, runtime adapter iteration_range fix
```

---

## A. What was rebuilt, and from what

The target is the exact 89-feature matrix the frozen model was trained on, but
now produced by an auditable dataset-generation pipeline instead of a
hard-coded CSV. Every observation is tagged with a provenance status:

| Provenance | Rows | Storms | RI+ | RI− | Meaning |
| --- | --- | --- | --- | --- | --- |
| `carried_historical` | 848 | 107 | 76 | 772 | Canonical MVP extracted values (raw NetCDF for 1982–2000 is not in the repo). NOT fabricated — genuine historical values, source flagged per row. |
| `extracted_from_raw` | 22 | 19 | 6 | 16 | Bilinear extraction from real `ERA5_expanded/*.nc` at the storm centre, exact valid-time match. |
| **Total** | **870** | **126** | **82** | **788** | |

- The 4 satellite-meta obs already present in the canonical table
  (1998-008, 1999-001, 1999-006, 1999-007) are **not duplicated** — they are the
  carried rows.
- The 22 added rows are satellite-meta observations that had **no** ERA5 row in
  the canonical table and whose date **is** covered by the 20 raw NetCDF files.
- Zero universe rows were blocked (`rows_without_raw_and_not_in_canonical` = []):
  every observation was either carried or genuinely re-extracted.

## B. Deliverables

| File | Content |
| --- | --- |
| `era5_ri_feature_spec_89.json` | Machine-readable 89-feature contract (name, group, source variable, level, unit, formula, spatial method, delta lag). |
| `src/era5_rebuild.py` | Rebuild pipeline: spec builders, `bilinear_with_cells`, `extract_era5_from_file`, `build_dataset`, `integrity_checks`, MVP comparisons. |
| `build_era5_ri_dataset.py` | Deterministic CLI entry point (no hard-coded paths — flags only; defaults documented). |
| `era5_datasets/era5_ri_rebuilt.csv` | **The rebuilt dataset**: provenance + exactly the 89 features. |
| `era5_datasets/era5_ri_provenance.csv` | Per-row provenance (source file, grid, method, surrounding 4 cells for the 22 extracted rows). |
| `era5_datasets/era5_ri_manifest.json` | Provenance manifest: generation time, options, sources, stats, CDS blocker. |
| `era5_datasets/era5_ri_integrity_checks.json` | Full integrity battery results. |
| `era5_datasets/era5_ri_mvp_comparison.json` | MVP comparisons (Step 9, Section L below). |
| `tests/test_era5_rebuild.py` | 12 focused tests — all pass (`python3 -m pytest tests/test_era5_rebuild.py`). |

## C. 89-feature contract (frozen, asserted)

`era5_feature_columns_with_temporal((6,12,24))` produces exactly the 89 names
consumed by `era5_final_xgboost.json`. The rebuild asserts this at every stage:

| Assertion | Result |
| --- | --- |
| generated == spec (`era5_ri_feature_spec_89.json`) | True |
| generated == frozen model `feature_names` | True (89/89, exact order, no duplicates) |
| Columns in output at spec order | True (`integrity.feature.column_order_matches_spec`) |

Composition: 21 base (`d,r,t,u,v` @ 850/700/500/200 + `shear_850_200`) + 17
derived (physics) + 51 temporal deltas (`delta_{6,12,24}h_*` of the 17 derived).
No scaler and no imputation at dataset level (XGBoost-native missingness).

## D. ERA5 alignment

- `era5_delta_minutes == 0.0` for **870/870** rows; 0 rows non-zero.
- `era5_datetime > datetime_utc` for **0** rows (no future data).
- For the 22 extracted rows the matched `valid_time` equals the observation time
  to the minute (files carry a single hourly validity covering the obs hour).

## E. Spatial method (raw extraction)

- Interpolation: **bilinear at the storm centre** (`Spatial_method =
  bilinear_storm_center`), applied per level field.
- Grid: CDS `reanalysis-era5-pressure-levels`, 0.25°; latitude descending
  (handle in `bilinear_with_cells`); per-file domain verified.
- Provenance: for each of the 22 extracted rows and each field, the surrounding
  4 cells (`lat0/lat1/lon0/lon1` + grid indices) are recorded in
  `era5_ri_provenance.csv` (`bilinear_cells`, 20 cell records per row).
- Units verified consistent with the frozen MVP (values in Table below):
  `d` in s⁻¹ (e.g. extracted `d_850` ∈ [-1.68e-4, +2.32e-4] vs MVP
  [-5.16e-4, +2.18e-4] over 18 years — same SI scale, **no scaling applied**);
  `r` in %, `t` in K, `u/v` in m s⁻¹ — matching `era5_ri_feature_spec_89.json`.

| Field | Extracted (22 rows) | Frozen MVP (848 rows) | Contract unit |
| --- | --- | --- | --- |
| `r_850` | 84.6 – 110.0 % | 31.5 – 102.3 % | % |
| `t_850` | 291 – 296 K | 288 – 297 K | K |
| `d_850` | -1.68e-4 – 2.32e-4 | -5.17e-4 – 2.18e-4 | s⁻¹ |

The extracted ranges match the documented sanity range from the historical
expansion (r_850 → 84.6–109.9): identical figures.

## F. Temporal-delta semantics (documented, unchanged)

Forwarded from the frozen pipeline without modification:

> `delta_<lag>h_<feature>` = `feature(t) − feature(t_prev)` where `t_prev` is
> the **previous observation within the same storm**, and the result is kept
> only if `t − t_prev ≤ lag`; otherwise it is NaN. Deltas always use past rows
> (never future). First observation of each storm → NaN.

Regression test `test_temporal_delta_semantics` pins this exact behaviour
(6 h gap → delta at 6 h; 24 h gap → NaN at 6/12 h lags, value at 24 h lag).

**Named TODO for Improvement 3 (not actioned here):** this is *not* a true
t−6/12/24 h re-analysis-value difference when observations are sparse. A
decision is required (keep semantics vs switch to exact-time re-gridding); the
report is deliberately not changing it, and any future change must be flagged
as a contract-affecting alteration.

## G. Missingness

| Group | mean | min | max |
| --- | --- | --- | --- |
| base | 0.0000 | 0.0000 | 0.0000 |
| derived | 0.0000 | 0.0000 | 0.0000 |
| temporal_delta | 0.2464 | 0.1517 | 0.3506 |
| overall | 0.1411 | — | — |

- No feature is fully missing (`any_fully_missing = False`).
- Temporal-delta missingness is expected: 848 carried rows (same as frozen
  training matrix → identical NaN pattern), plus the 22 extracted rows have a
  single observation per storm, so all 51 deltas are NaN for them.
- No imputation performed (frozen behaviour).

## H. Leakage check

| Check | Result |
| --- | --- |
| `era5_datetime > datetime_utc` rows | 0 |
| Target (`RI_24h`, `wind_24h_kt`, `delta_v_24h_kt`, `target_time_24h`) in predictor spec | none |
| Binned-target predictors in frozen spec | none (static check `no_binned_targets`) |
| Storm-level split guaranteed downstream | splitter operates on storm IDs (unchanged, not part of dataset build) |

## I. MVP comparison (Step 9)

1. **Derived features vs persisted reference** — the 17 derived columns of the
   rebuilt table compared against `ri_multimodal_dataset.csv` (independent
   materialised copy of the same computation) on every overlapping key:
   **0 mismatches, max |diff| = 2.84e-14** (float rounding) across all 848
   canonical rows. The 22 extracted rows are structurally absent from that
   reference's ERA5 (NaN in `ri_multimodal_dataset.csv` — the fusion table
   never populated them), so there is nothing to compare them against there;
   their values are instead validated physically (§E) and by the exact-match
   test in §J.
2. **Canonical recompute** — recomputing the full 89 matrix from the canonical
   CSV via the same `src/features.py` transforms and comparing with the rebuilt
   `carried_historical` rows: **0 mismatches, max |diff| = 0.0** → the carried
   rows are byte-identical to the frozen training matrix.

## J. Raw-extraction cross-validation

- `test_extract_era5_from_file_exact_time` extracts a storm-centre profile from
  a real NetCDF and asserts all 21 base features are finite with
  `era5_delta_minutes == 0`.
- Bilinear verified on synthetic flat/ramp grids (ascending and descending
  latitude agree to 1e-9).
- The 22 extracted rows carry finite base + derived values (no all-NaN rows).

## K. CDS status (blockers, reported exactly)

- **CDS API credentials are absent** → downloading raw 1982–2000
  `reanalysis-era5-pressure-levels` is **blocked**. This is reported, not
  worked around.
- Consequence: the 848 historical rows use the canonical extracted values,
  explicitly flagged `era5_source_file = carried_from_RI_ERA5_features_MVP.csv
  (raw NC absent in repo)` — they are **historical extracted values, not
  synthetic** — while the 22 newer rows are genuine reanalysis extractions from
  the 20 NetCDF files present.
- To fully rebuild the 1982–2000 era with raw reanalysis only: obtain CDS
  credentials, download the ~18 years of daily 6-hourly pressure-level data,
  place files under an extension directory, re-run the unchanged CLI.

## L. Reproducibility

- No RNG anywhere in the dataset build (deterministic transform only).
- Single entry point:
  `python3 cyclone_backup/build_era5_ri_dataset.py` (flags `--best-track`,
  `--era5-directory`, `--satellite-meta`, `--frozen-model`, `--spec`,
  `--output-dir`, `--start-date`, `--end-date`, `--storms`, `--lags-h`);
  defaults mirror this audit, no hard-coded paths in code.
- `--write-spec-only` regenerates `era5_ri_feature_spec_89.json`.
- Full build runtime ≈ 0.8 s; outputs regenerated deterministically.
- All 12 focused tests pass: `cd cyclone_backup && python3 -m pytest
  tests/test_era5_rebuild.py -q` → `12 passed`.

## M. Open decisions forwarded to Improvement 3

1. **Temporal-delta semantics** — keep "prev-obs capped-at-lag" (current, frozen
   behaviour) or switch to exact-time re-analysis differences (contract
   change → must be explicit; feature meaning and NaN pattern will change).
2. **Runtime adapter (`src/models/adapters/ri_adapter.py`)** — currently loads the
   frozen ERA5 artifact but runs IMD-only; latent `predict_proba` missing
   `iteration_range` (would fall back to all 91 trees). Fix before any runtime
   ERA5 deployment.
3. **1982–2000 raw CDS** — blocked on credentials; pipeline is ready.

## N. Integrity battery (full)

`era5_datasets/era5_ri_integrity_checks.json` records every check: feature
schema/order/duplicates, temporal alignment, target counts (82/788, 0 NaN),
storm integrity (126 storms, 0 NaN), grouped missingness, and the leakage block.

## O. Scope confirmation

- **TRAINING PERFORMED: NO** — no model was trained, tuned, thresholded, or
  recalibrated in this phase.
- The 89-feature contract, spatial method, and temporal-delta semantics are
  unchanged; the only additions are the auditable code paths and artifacts in
  Section B and the genuine raw extraction of 22 satellite-meta rows.