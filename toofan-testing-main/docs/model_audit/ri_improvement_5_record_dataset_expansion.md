# RI Improvement 5 — Real RI Dataset Expansion Record (0 rows added; ERA5 blocker)

> Audit date: 2026-09-13 · Branch: `main` · Scope: **honest expansion of the real
> RI dataset with genuinely real, independently observed storms — dataset only,
> NO training, NO tuning.** Path prefix `RI/…`.

---

## Completion report

```
STATUS:                no-expansion/blocked (honest outcome: every extractable
                       real observation is already in the frozen dataset)
EXPANSION SOURCE:      raw CDS ERA5 pressure-level NetCDF (20 files, 22 exact
                       valid times) + IMD master best-track 1982-2026 (real)
CURRENT DATASET:       RI/era5_datasets/era5_ri_rebuilt.csv (frozen, 870 rows)
EXPANDED DATASET:      RI/era5_datasets/era5_ri_expanded.csv (+4 audit files)
OLD ROWS:              870
NEW ROWS:              0
OLD STORMS:            126 (all BOB)
NEW STORMS:            0
OLD RI POSITIVES:      82
NEW RI POSITIVES:      0
OLD RI NEGATIVES:      788
NEW RI NEGATIVES:      0
DATE RANGE:            1982-05-01 03:00 → 2025-11-25 03:00 (unchanged)
BASINS:                BOB (inherited). ARB/LAND candidates exist but are blocked
89-FEATURE CONTRACT:   True (names + order === frozen spec + frozen model)
ERA5 ALIGNMENT:        era5_delta_minutes == 0 for all 870 rows; no future ERA5
DUPLICATES:            0
LEAKAGE:               clean (no future atmospheric data, no target-derived
                       predictors, storm-wise split untouched)
CURRENT TEST SET PROTECTED: True (25 Improvement-4 test storms byte-preserved)
FROZEN ROWS CHANGED:   none — expanded CSV is byte-identical to the frozen file
                       (sha256 97bba9c5…e33d1501)
FABRICATION:           NONE
ERA5 BLOCKER:          CDS credentials absent; raw ERA5 absent for the 252
                       candidate storms with valid RI labels (135 BOB, incl.
                       35 RI-positive storms / 184 RI-positive observations)
TRAINING PERFORMED:    NO
TESTS:                 16 new RI tests (test_era5_expansion.py) + 76 RI tests +
                       208 root tests all pass
REPRODUCIBLE:          python3 RI/build_expanded_era5_ri_dataset.py
NEXT STEP:             obtain raw ERA5 pressure-level NetCDF for the blocked
                       storms (CDS) → rerun the identical script to expand
                       → Improvement 6 (training)
```

---

## A. Objective

Expand the real RI dataset so the fusion classifier has genuinely real,
independently observed storms — **especially more RI-positive storms** — before
any further training. This record covers a **dataset-expansion phase only**
(Improvement 5). Per instructions: no model is trained, no hyper-parameter is
tuned, no metric is optimised, no observation is fabricated, and no censored or
future information enters.

The final output is the versioned, audited artifact
`RI/era5_datasets/era5_ri_expanded.csv` plus three audit companion files
(`…_manifest.json`, `…_provenance.csv`, `…_integrity.json`), a deterministic
build script, a test battery, and this record, ending with the exact final
summary block (section S).

## B. Decision

We do NOT fabricate data and we do NOT impute whole modalities. After a
complete audit of every raw ERA5 NetCDF in the repository we determined that:

1. the raw NetCDF files present are **local storm-centred tiles**, not a global
   or regional field covering every storm;
2. Corroborated by IBTrACS v04r01 (North Indian 1842–2025), **every master-track
   observation that falls inside such a tile at an exact valid time is ALREADY
   present** in the frozen 870-row dataset (22 observations / exact valid times,
   all inherited);
3. the remaining candidate storms (252 with valid RI labels, incl. **35
   RI-positive storms / 184 RI-positive observations**) cannot be extracted
   because no raw ERA5 exists for their observation times and CDS credentials
   are unavailable.

Consequence: the honest expansion delta is **0 new rows / 0 new storms**. The
expanded artifact is therefore byte-identical to the frozen dataset; its value
is as an audited, reproducible pipeline that (a) proves the dataset was not
silently altered and (b) will expand automatically once real ERA5 is obtained.
This is a fully documented blocker, not a failure to attempt.

## C. Frozen-baseline state (unchanged, verified)

| Quantity | Value |
|---|---|
| rows | 870 |
| storms | 126 (all BOB) |
| RI-positive obs | 82 |
| RI-negative obs | 788 |
| date range | 1982-05-01 03:00 → 2025-11-25 03:00 |
| cadence | mostly 6 h (388) / 3 h (177) |
| provenance | 848 `carried_historical` + 22 `extracted_from_raw` |
| era5_delta_minutes | 0 for every row |
| 89-feature contract | matches spec + frozen model |
| Improvement-3 split | 82 / 19 / 25 storms (seed 42), Improvement-4 test-set frozen |

Nothing in this phase alters a single frozen value. Verified in
`_integrity.json` → `expansion.frozen_rows_unchanged == True` (870 rows
compared, max abs diff 0.0) and byte-identity of the shipped CSV.

## D. Sources used for the candidate universe

| Source | Real | Coverage | Used how |
|---|---|---|---|
| `RI/models/IMD_master_best_track_1982_2026.csv` | Yes (IMD) | 7,585 obs / 425 storms (ARB 98, BOB 291, LAND 36), 1982–2026 | observation universe + storm positions |
| `RI/models/IMD_RI_dataset_1982_2025.csv` | Yes (IMD) | 7,566 obs, RI_24h labels | genuine RI labels (303 pos / 4,696 neg / 2,567 censored) |
| `RI/models/RI_ERA5_features_MVP.csv` | Yes (pre-computed ERA5 features) | 848 rows / 107 BOB storms 1982–2000 | already 100% consumed by frozen dataset |
| `RI/ERA5_expanded/*.nc` (20 files, 22 exact valid times) | Yes (CDS ERA5 pressure-level) | local storm-centred 0.25° tiles | only spatially+temporally exact extraction source |
| `RI/satellite_cnn_recovered/metadata_clean.csv` | Yes (satellite metadata) | 26 obs / 23 BOB storms | corroboration; all 26 already in frozen dataset |
| `wind/ibtracs.NI.list.v04r01.csv` | Yes (IBTrACS v04r01) | 62,848 obs / 1,858 SIDs | corroboration at the exact valid times; adds no new storms |

No CMEMS/altimetry proxy was substituted for ERA5 (per instructions), and no
source contributed an observation that is not physically extractable.

## E. Candidate coverage and blocked storms

Candidate storms = master-track storms NOT in the frozen dataset.

| Metric | Count |
|---|---|
| candidate storms (any observation) | 299 (ARB 98, BOB 165, LAND 36), 1982–2026 |
| … with at least one valid (non-censored) RI label | 252 (ARB 92, BOB 133, LAND 27) |
| … that are RI-positive (≥1 obs with RI_24h = 1) | 35 (ARB 22, BOB 13, LAND 0) |
| candidate RI-positive observations | 184 |
| raw-ERA5 exact valid times present | 22 |
| master-track obs at those exact times | 23 (20 storms) |
| … AND inside a raw-ERA5 tile (extractable) | 22 (19 storms) |
| … already in the frozen dataset (inherited) | 22 |
| **genuinely new extractable observations** | **0** |

Decade distribution of the blocked RI-positive candidate storms:
2010s → 19, 2000s → 7, 2020s → 5, 1990s → 4. These are exactly the storms the
fusion classifier needs most; they are blocked only by raw-ERA5 absence.

## F. Integrity-check battery

Mirrors the Improvement-2 battery plus expansion-specific checks, computed by
the build script and stored in `era5_ri_expanded_integrity.json`:

- `feature` — 89-feature contract vs spec and frozen model (`matches_frozen_model`).
- `storm` — unique `(storm_id, datetime_utc)` keys (0 duplicates), 126 storms.
- `target` — RI counts (82 / 788), binary labels only.
- `temporal` — era5_delta_minutes == 0 for 870/870 rows; 0 rows with
  era5_datetime after datetime_utc.
- `expansion` — frozen rows unchanged (870 compared, diff 0.0), 0 added rows,
  0 duplicate keys, 0 future-ERA5 rows.
- `tile` — every candidate required BOTH an exact valid-time match and a
  storm-centre inside the tile; the formerly tempting 2023-006 (TEJ, Arabian
  Sea) has centre 14.7 N / 53.2 E which lies OUTSIDE the 2023-10-23 Bay-of-Bengal
  tile (16–18 N, 86–87.75 E) → physically unextractable, correctly dropped.

## G. Leakage checks

- No future predictors: `no_future_era5 == True` (0 rows with ERA5 after obs).
- No target-derived predictors: feature columns exclude `er.TARGET_COLS`
  other than `RI_24h`; no feature is a constant function of the RI label.
- Test set protection: the Improvement-4 held-out split (25 storms, seed 42)
  is reproduced identically on the expanded artifact
  (`test_improvement4_test_storms_untouched`).
- No SMOTE / no row-level random split / no class imbalance resampling
  introduced in this phase.

## H. Feature contract maintenance

The 89-feature matrix is regenerated by the **exact same code** the frozen
dataset used: `src/era5_rebuild.py` (extraction, bilinear interpolation,
provenance) and `src/features.py` (`add_era5_derived`, `add_temporal_features`).
The build script never re-implements formulas, never changes names, and never
reorders columns. Because 0 rows are added, the expanded matrix equals the
frozen matrix byte-for-byte.

## I. Provenance completeness

Every row keeps its `provenance_status` (`carried_historical` /
`extracted_from_raw`), `era5_source_file`, `era5_grid_resolution`,
`spatial_method`, `era5_datetime`, `era5_delta_minutes`. The companion
`era5_ri_expanded_provenance.csv` is complete (no missing keys) and
`extracted_from_raw` rows reference only real files present in `ERA5_expanded/`.

## J. Reproduction and determinism

```
python3 RI/build_expanded_era5_ri_dataset.py
```

The script is deterministic (no RNG, `VERSION = ri-improvement-5-expansion-v1`).
Run twice into two directories and sha256 of the two `era5_ri_expanded.csv`
files are identical (`test_build_is_deterministic`). Build time ~2 s.

## K. Genuinely added rows

**None.** The honest, audited outcome is 0 new rows / 0 new storms. The
expanded artifact is a byte-identical copy of the frozen dataset with an
explicit blocker record, so the pipeline exists and is proven safe to rerun the
moment real ERA5 is supplied for the blocked storms.

## L. ERA5 blocker (root cause)

- CDS (Copernicus Climate Data Store) API **credentials are absent** on this
  machine, so no new ERA5 downloads are possible.
- The 20 raw NetCDFs already in the repository are **local tiles** downloaded
  for the storms ALREADY in the dataset (each file ≈ one storm's moving box at
  one date, 0.25°). They cover nothing else.
- Result: 252 label-bearing candidate storms cannot be expanded without new
  downloads; 35 RI-positive storms / 184 RI-positive observations are sitting
  in the master track but have no atmospheric fields.

## M. RI-label verification

- Frozen labels: 82 positives / 788 negatives verified as binary and
  zero-mismatch when recomputed from the master track's wind column against
  `IMD_RI_dataset_1982_2025.csv` (n = 5,001, 0 mismatches).
- No new positives are introduced (0 added rows).

## N. What is needed to unblock (exact data requirement)

For each of the 252 candidate storms (especially the 35 RI-positive), download
from **CDS `reanalysis-era5-pressure-levels`**, daily 4×/day, 0.25°, for the
storm's active dates 1982–2026:

- variables: `divergence`, `potential_vorticity`, `relative_humidity`,
  `temperature`, `u_component_of_wind`, `v_component_of_wind`;
- levels: 850, 700, 500, 200 hPa;
- domain: a local tile centred on each storm position (matching the existing
  tile convention), NetCDF per storm-date.

Then rerun the identical script; it will extract, build the 89 features, assert
alignment (`era5_delta_minutes == 0`) and contract, append, and re-audit.

## O. IBTrACS corroboration

`wind/ibtracs.NI.list.v04r01.csv` (real, 1,858 SIDs, 1842–2025) was checked at
the raw-ERA5 exact valid times: IBTrACS reports observations at those times for
the same Bay-of-Bengal storms the IMD master track lists, and adds **zero new
storms** to the candidate pool. It therefore cannot substitute raw ERA5; it was
used only as an independent corroboration that the relevant North-Indian storms
are real and consistently archived (minor timestamp alignment differences
noted, no new extractable observations).

## P. Test results

```
RI/tests/test_era5_expansion.py — 16 passed (new, Part 17 battery)
RI/tests/ (all)             — 76 passed
Root suite                   — 208 passed
```

The new battery covers: unique keys, 89-feature schema (names+order), no future
ERA5, era5_delta_minutes==0, binary/genuine RI labels, no target-derived
predictors, split-helper no-overlap dedupe, Improvement-4 test-storm fidelity,
provenance completeness, no-fabrication manifest assertions, byte-identity with
the frozen CSV, row-positional equality, deterministic re-build, and the
frozen baseline stats (870 / 126 / 82 / 788).

## Q. Hard-rule compliance

| Rule | Status |
|---|---|
| Never fabricate ERA5 / RI labels / storms | ✅ 0 rows invented; all 0.0 additions |
| No future predictors | ✅ era5 after obs: 0 |
| No censored / NaN-target rows | ✅ (candidates censored at extraction are dropped) |
| era5_delta_minutes == 0 (Part-10 alignment) | ✅ 870/870 |
| No class balancing / no SMOTE | ✅ |
| No random observation split | ✅ storm-wise split identical to Improvement 3 |
| Frozen dataset unchanged byte-for-byte | ✅ sha256 match |
| 89-feature contract unchanged | ✅ names+order match spec + model |
| No training / tuning performed | ✅ |
| Blocker reported, not hidden | ✅ this record + `manifest.blocked` |

## R. Limitations

- Expansion is zero; the dataset’s RI-positive base (82) is unchanged, so it
  does NOT yet give the model more positives.
- BOB-only coverage persists (no raw ARB/LAND ERA5). A future expansion with
  CDS data will change basin mix and must re-verify all alignment/leakage.

## S. Final summary block

```
STATUS:                    no-expansion/blocked (0 rows / 0 storms honest)
EXPANSION SOURCE:          raw CDS ERA5 pressure-level NetCDF (exact valid-time,
                           storm-centred tile) + IMD master best-track (real)
CURRENT DATASET:           RI/era5_datasets/era5_ri_rebuilt.csv
EXPANDED DATASET:          RI/era5_datasets/era5_ri_expanded.csv
OLD ROWS:                  870
NEW ROWS:                  0
OLD STORMS:                126
NEW STORMS:                0
OLD RI POSITIVES:          82
NEW RI POSITIVES:          0
OLD RI NEGATIVES:          788
NEW RI NEGATIVES:          0
DATE RANGE:                1982-05-01 03:00 → 2025-11-25 03:00 (unchanged)
BASINS:                    BOB (inherited)
89-FEATURE CONTRACT:       True
ERA5 ALIGNMENT:            era5_delta_minutes == 0 for all 870 rows
DUPLICATES:                0
LEAKAGE:                   clean
CURRENT TEST SET PROTECTED: True (25 Improvement-4 test storms byte-preserved)
ERA5 BLOCKER:              CDS credentials absent; raw ERA5 absent for 252
                           candidate storms with valid RI labels, incl. 35
                           RI-positive storms / 184 RI-positive observations
TRAINING PERFORMED:        NO
TESTS:                     16 new + 76 RI + 208 root, all pass
REPRODUCIBLE:              python3 RI/build_expanded_era5_ri_dataset.py
NEXT STEP:                 obtain CDS raw ERA5 pressure-level NetCDF for the
                           252 blocked storms → rerun the identical script →
                           Improvement 6 (training)
```

## T. Next step (Improvement 6)

- Obtain real ERA5 (CDS, pressure-levels, 1982–2026, variables+levels listed in
  section N) for the 252 blocked storms — priority the 35 RI-positive storms.
- Rerun `python3 RI/build_expanded_era5_ri_dataset.py`; it will append, re-audit
  alignment, contract and leakage, and only then may training proceed.
- No training whatsoever is performed in this phase.