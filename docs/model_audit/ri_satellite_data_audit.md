# Satellite RI data audit & repair — BLOCKED — INSUFFICIENT/INVALID DATA

**Audit date:** 2026-09-13
**Scope:** TOOFAN satellite RI (Phase 1–4 of the satellite tasking).
**Verdict:** `BLOCKED — INSUFFICIENT/INVALID DATA`. No satellite RI model is
trained or re-trained. Phase 2 repairs (preprocessing bug, reproducible
manifest, regression tests) ARE applied. Nothing is integrated into the RI
runtime, nothing is fused with IMD/ERA5, no data is fabricated.

---

## A. Data inventory

| Item | Value |
| --- | --- |
| Granules requested (download manifest) | 60 (`RI/models/satellite_cnn_download_manifest.csv`) |
| Granules on disk (`RI/Cnnfiles/`) | **16** |
| Recovered crops on disk (`RI/satellite_cnn_recovered/images/`)| **26** `.npy`, `(128,128,1)` float32 |
| Metadata rows | 26 (`metadata_clean.csv`) |
| Unique storms | 23 |
| RI-positive crops (metadata) | 9 |
| Non-RI crops (metadata) | 17 |
| **Usable crops** (leakage-safe) | **25** / 23 storms / **8 RI** / 17 non-RI |
| Time range | 1998-11-14 – 2025-11-25 |
| Multi-sample storms | 1 (`2020-001`, 3 rows) |
| Hybrid trainable set (sat + all 11 IMD) | **9 rows / 7 storms / 6 RI** |
| `normalization.json` | `method=global_physical_fixed_window`, clip 180–310 K, `nan_fill=0.5`, `mean_nan_fraction=0.040` |

The recovered granules of 10 of the 26 crops are **not on disk**
(reproducibility gap, §D). Only 1 storm contributes more than a single crop,
so the effective N is ~23 storms total / ~8 positive.

## B. Preprocessing reconstruction and the fixed bug

Stored format (`satellite_recovery._global_normalization`):
`norm = clip((310 − Tb) / 130, 0, 1)` — cold (deep convection) maps to 1;
NaN maps to the neutral bucket `0.5` (collision with a real 245 K pixel, which
makes exact restoration of NaN pixels impossible; ~4% of pixels affected).

**Bug (confirmed and fixed):** the canonical CNN (`src/satellite_cnn.py`)
consumes Kelvin patches via `normalize_patch()` (clip 180–310 K → 2-channel
`[Tb_norm, valid_mask]`), but the training loader fed the stored `[0,1]`
crops straight through. Verified empirically: every stored crop became a
constant `-1.0` first channel (std 0.0, all-mask `~isnan` = all ones) — i.e.
a degenerate, information-free CNN input. `extract_embeddings()` had the same
defect.

**Fix:** new `recovered_crops_to_kelvin()` inverts the documented storage
(`Tb = 310 − norm·130`), derives the validity mask as `|norm − 0.5| > 3e-3`
(0.5-bucket pixels excluded, filled with the canonical 280 K `fill_tb`), and
both `run_cnn_oof` and `extract_embeddings` now build their tensors from the
inverted Kelvin + mask. Verified on all recovered crops: restored physical
range ~185–310 K, `normalize_patch` output now has real variance
(`ch0 std ≈ 0.04–0.5`) instead of the constant channel. This is a genuine
repair; it does not change the 11-feature tabular contract, the architecture,
or the label.

## C. Labels & leakage audit

- Label = `RI_24h` (future RI onset within 24 h from the IMD fix time),
  taken from the canonical `ri_multimodal_dataset.csv`; cross-checked for all
  25 usable rows — **0 mismatches**.
- Leakage guard (as in `src/ri_dataset.py`): a satellite image taken after
  the IMD observation would contain information from inside the RI window;
  crops are usable only when `satellite_datetime <= datetime_utc + 5 min`.
  Exactly **1 row excluded** by this rule (`2020-001`, obs 2020-05-17 18:00,
  image 19:00), consistent with the 26 → 25 usable drop.
- The excluded row is retained in `metadata_clean.csv` for transparency but
  flagged not-usable; the manifest never contains it (regression-tested).

## D. Reproducibility audit

16 of 26 recovered crops' source granules remain on disk. Missing
(`RI/Cnnfiles/`):
`merg_1998111403`, `merg_1999020103`, `merg_1999102706`, `merg_2000102512`,
`merg_2000112706`, `merg_2000122406`, `merg_2020051708`, `merg_2020051719`,
`merg_2020051803`, `merg_2020051811` (i.e. the entire 2020-001 sample).
The dataset **cannot be re-derived end-to-end** from the current repo
contents; a full refetch would need 44 granules.

Existing trained artifacts are **not** a valid satellite baseline:
- `RI/models/satellite_cnn.pt` — 99×99, 2-channel, `(X−240)/30` contract;
  incompatible with the recovered 128×128 crops (no provenance/scaler to map).
- `satellite_ir_cnn_mvp*.keras` + Colab CSVs — historical, undocumented
  splits, and trained on the same degenerate-input path; not trustworthy.
- `RI/src/satellite.py` (Keras MVP branch) — dead code.

## E. Training-eligibility assessment (Phase 1d)

Even after repair, the usable real set (25 crops / 23 storms / 8 RI, and only
**9 rows / 7 storms / 6 RI** for the hybrid CNN that needs the 11 IMD
features) is far below a defensible CNN baseline. Grouped storm-disjoint
splits would leave ≤ a handful of positives for any held-out set. Any metric
produced now would be noise-dominated and would mislead. **Training is
therefore skipped (Phase 3), per the CRITICAL rule: report the blocker and
stop before training.**

## F. Repairs applied (Phase 2, all shipped)

| Artifact | Change |
| --- | --- |
| `RI/src/satellite_cnn.py` | `recovered_crops_to_kelvin()`; `run_cnn_oof` + `extract_embeddings` build tensors from inverted Kelvin + validity mask (degenerate constant-input bug fixed) |
| `RI/satellite_cnn_recovered/manifest.csv` | reproducible manifest — obs_key, storm_id, timestamps, RI_24h, image/granule file, `nan_fraction`, `has_granule_on_disk`, `label_conflict`, `preprocessing_version`, `split` (25 rows) |
| `RI/satellite_cnn_recovered/ri_satellite_split.json` | deterministic storm-disjoint split (seed 42): 17/3/3 storms = 19/3/3 rows; documents leakage guard + preprocessing version |
| `RI/build_satellite_manifest.py` | builder — reproducible, does not fabricate or re-label |
| `RI/tests/test_satellite_preprocessing.py` | 10 regression tests: non-degenerate input, inversion window, NaN-bucket handling, usable-set counts, leakage exclusion, label ↔ multimodal, storm-disjoint split, determinism, reproducibility flags, and a sentinel test asserting the hybrid trainable set stays below the blocked threshold |

**Tests:** RI suite 86 passed; root suite 212 passed; new files ruff-clean.

## G. Recommendation & required data

To move off `BLOCKED`, the repo needs REAL, leakage-safe satellite IR data:

1. **Refetch the 60 requested granules** (`RI/models/satellite_cnn_download_manifest.csv`
   lists storm/time/expected filename; source = CPC 4-km Merged IR hourly,
   NOMADS/COLA, free, no credentials) → re-run
   `src/satellite_recovery` + QC to restore full coverage (44 granules missing).
2. **Expand the BoB sample substantially**: target ≥ 100 storms / ≥ 40 RI
   positives with the existing future-RI label and the 5-min leakage guard,
   ideally > 1 image per storm (multi-time), before any simple baseline is
   defensible.
3. Only then re-run Phase 1/2 checks (manifest, all-11 feature join, storm
   splits) and Phase 3 with an IR-only and hybrid baseline, reporting metrics
   vs the observed ~32% RI prevalence.

Do **not** use the legacy `.pt`/`.keras` numbers; do **not** integrate the
satellite branch into the runtime until a validated baseline exists.