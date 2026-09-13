# Phase 9 — Satellite / Multi-Source Scientific Audit (Repair Plan)

> Status: **COMPLETE — Phase 9 of the TOOFAN Cyclone Repair Plan (2026-09-12).**
> Central question: *"Does this repository currently demonstrate a scientifically
> reproducible AI/ML system using multi-source satellite data for tropical-cyclone
> identification, classification, or prediction?"*
> **Verdict: NO.** One satellite imagery product (MERG-IR) is present as data and a
> trained CNN artifact exists, but (a) CNN inference is NOT runnable inside the repo,
> (b) every published satellite/TCIR metric is an unreproducible historical claim,
> (c) the CNN is wired into no runtime adapter, and (d) no multi-source fusion is
> demonstrated anywhere. Everything "multimodal / satellite" in the docs is a design
> aspiration, not a working capability.

---

## 1. Summary table

| # | Component | Location / ref | In-repo evidence | Reproducible from repo? | Runtime wiring | Multi-source role | Status |
|---|-----------|----------------|------------------|-------------------------|----------------|-------------------|--------|
| 1 | **MERG-IR granules** (NCEP/CPC 4 km) | `cyclone_backup/Cnnfiles/*.nc4` | 16 granules on disk; download script `tc_ri_cnn/data/download_mergir.py` present (needs external NOMADS service) | PARTIAL — raw source data for **16/26** recovered crops; 10 requested granules absent | Not consumed by any runtime path | Single satellite product | PARTIAL |
| 2 | **Recovered satellite crops** | `cyclone_backup/satellite_cnn_recovered/images/*.npy` | 26 files, `(128,128,1)` float32, QC-passed 26/26, duplicate groups 0; 23 storms / 9 RI / 17 non-RI; extraction log + QC report present | YES (data + audit trail present; recovery script reproducible) | Not consumed by any runtime path | Training data for CNN | AVAILABLE |
| 3 | **Satellite CNN artifact** | `cyclone_backup/models/satellite_cnn.pt` | Real fitted PyTorch `RICNNFusion` state dict: 308,705 params; IR encoder 2 ch, tabular 11 ch, 99×99 input; loads cleanly; architecture matches `tc_ri_cnn/models/cnn_model.py` | PARTIAL — artifact loads, but **inference NOT runnable in-repo**: (a) fold-0 scaler `results/cnn_tabular_scaler.json` is ABSENT (no `results/` dir in repo); (b) stored crops are global-normalised `[0,1]` (`normalization.json`, norm=`(310−Tb)/130`) while `normalize_patch` expects Kelvin `[180,310]` → feeding stored crops produces a constant −1 K channel; (c) evaluation outputs (OOF CSVs) absent | **NOT WIRED** — `RISatelliteBranch` exists in the RI adapter but is never instantiated | Classifier for RI identification (future 24 h target) | PARTIAL / UNVERIFIED |
| 4 | **Satellite OOF / ablation metrics** | Reported in `cyclone_backup/README.md` §9d (`results/satellite_ablation_final.csv`) | CSV absent; no eval script output in repo | **NO** — labels as `UNVERIFIED / HISTORICAL CLAIM` | — | — | UNREPRODUCIBLE |
| 5 | **TCIR CNN artifact** | `cyclone_backup/models/tcir/TCIR_CNN_RI_FINAL.keras` + `TCIR_CNN_config.json` (img 128, 4 ch, thr 0.21) + `TCIR_channel_mean.npy` / `TCIR_channel_std.npy` | Artifact present (7.5 MB); **channel-4 normalisation stats are pathological** (mean = `inf`, std = `nan`); requires TensorFlow, which fails to import in the current environment (libc++ mutex error) | **NO** — metrics (PR-AUC 0.0917 / ROC 0.5782 / N=928 / 19 storms / 69 RI) have NO dataset or results in repo; cannot be executed here | NOT WIRED | Second (design) satellite product | UNREPRODUCIBLE |
| 6 | **TCIR dataset** | Report claim "2,840 rows / 64 storms / 189 RI" (`cyclone_backup/README.md:367`, `SIH_FINAL_RI_REPORT.md:349`) | **No dataset file in repo** (only model artifact) | **NO** — labels as `UNVERIFIED / HISTORICAL CLAIM` | — | Second (design) satellite product | UNREPRODUCIBLE |
| 7 | **Multi-source fusion** | `cyclone_backup/src/fusion.py` (late-fusion meta-classifier over branch OOF CSVs) | `fusion.py` reads result CSVs that do not exist; **NO fusion meta-model artifact exists anywhere** | **NO** | Not wired; `fusion_probability` is never produced | — | FAIL / DESIGN ONLY |
| 8 | **Multimodal satellite coverage** | `cyclone_backup/ri_multimodal_dataset.csv` | `has_satellite=1` for **25 rows / 23 storms / 8 RI / 17 non-RI**; `image_file` present for all | YES (data present) | Analysis artefact only | Multi-source table (design) | AVAILABLE (data) |
| 9 | **RI adapter satellite branch** | `src/models/adapters/ri_adapter.py` (`RISatelliteBranch`, lines 78–111) | Defined but **never instantiated** in `load()`; constructor requires absent fold-0 scaler | N/A | **NOT WIRED** — adapter returns `satellite_probability=None`, `fusion_probability=None`, `mode="IMD_ONLY"` honestly | — | UNAVAILABLE (honest) |
| 10 | **Active ingestion `SatelliteLoader`** | `src/core/ingestion.py` (lines ~248–380) | Class exists but not meaningfully wired; `.load_image` assumes Kelvin, stale vs stored `[0,1]` crops | NO — would corrupt input units | Produces nothing in live pipeline | — | UNAVAILABLE |
| 11 | **IMERG precipitation** | `rain/data/FANI_2019_IMERG_*.csv` (12.6 MB) | FANI 2019 case-study feature data for the **rainfall baseline** (same-time classifier) | YES for FANI baseline | Rainfall baseline only | NOT a CNN imagery source | BASELINE |
| 12 | **ERA5 satellite overlap** | `cyclone_backup/README.md` §9d/.e | Error/coverage audits present; only **1** of the 9 satellite-OOF rows has ERA5 features (3-way untestable) | PARTIAL | ERA5 RI branch FAILS at runtime (89-feature vs 17-feature mismatch) | Reanalysis, not satellite | FAIL / single-source |

**Cross-cutting**: `docs/model_inventory.md:38` "TCIR global: 2,840 obs / 64 storms / 189 RI" and
the `docs/model_inventory.md` §10-§19 "multimodal (IMD, ERA5, Satellite)" descriptions of the RI
adapter describe the **designed** architecture, not the implemented one.

---

## 2. Data provenance

- **MERG-IR**: NCEP/CPC global 4 km IR (10-minute). 16 of the 26 recovered crops have their source
  granule on disk (`cyclone_backup/Cnnfiles/`). The download script requires the external NOMADS
  service (not available in a clean repo run). `metadata_clean.csv` `image_path` column was previously
  stale (pointed to `/Users/apple/cyclone/…`); **fixed in Phase 9** to repo-relative paths —
  26/26 resolve; original backed up as `metadata_clean.csv.bak`.
- **Recovered crops**: produced by the (reproducible) recovery pipeline
  (`cyclone_backup/src/satellite_recovery.py` + extraction log + QC report). Stored **normalised to
  `[0,1]`** via the *global physical window* `norm = (310 − Tb)/130`. This is the correct storage unit
  and is self-documenting via `normalization.json`, but it is stale with respect to
  `normalize_patch` (Kelvin), which is why direct inference on stored crops fails.
- **TCIR**: 4 channel (ch1 ≈ 263.55 K, ch2 ≈ 234.64 K, ch3 ≈ 0.389, ch4 ≈ `inf` mean / `nan` std).
  The `inf`/`nan` normalisation stats are pathological and would produce NaN activations. No dataset
  accompanies the artifact.

## 3. Label, target, and leakage audit

- **Target (`RI_24h`)**: binary label = RI onset within the next 24 h (future-defined target) — the
  CNN therefore performs *identification of future-onset RI* from IR imagery; it is NOT deployed as a
  forecast and confidence is NOT calibrated.
- **Temporal alignment**: `delta_minutes` between best-track fix and satellite image is 0–60 min
  (mean ≈ 7), well within the ±120 min stated tolerance. All 26 rows have a `granule_file`.
- **Storm-wise splitting**: training code uses `StratifiedGroupKFold`/`GroupKFold` grouped by storm
  (`satellite_cnn.py run_cnn_oof`) and the tabular scaler is fitted on **training storms only** — the
  designed procedure is leak-free w.r.t. storm membership.
- **No leakage of evaluation**: the OOF CSV that would substantiate skill is absent, so the honest
  position is "trained artifact; skill UNVERIFIED".

## 4. Multi-source / multimodality reality check

- The word "multi-source" is only legitimate for the **designed** pipeline
  (IMD best-track + ERA5 reanalysis + satellite IR). The **implemented, runnable** RI adapter is
  single-source (IMD only).
- No two satellite products are jointly consumed anywhere ⇒ **no satellite fusion** is demonstrated.
  TERMINOLOGY RULE applied: "multiple satellite products exist in-repo" (MERG-IR data + TCIR artifact)
  does **NOT** equal "satellite fusion".
- "Multiple datasets exist" (IMD, ERA5, satellite, IMERG) does **NOT** equal "multi-source model".

## 5. Actions taken in Phase 9

1. `cyclone_backup/satellite_cnn_recovered/metadata_clean.csv` — fixed 26 broken `image_path` values
   (now repo-relative; 26/26 resolve); original at `metadata_clean.csv.bak`.
2. `docs/model_inventory.md` — corrected satellite row (§10 RI Satellite CNN "not fitted" → fitted but
   unverifiable), TCIR rows (§9.3 dataset "Global IR+MW dataset" → artifact-only + HISTORICAL CLAIM;
   §10 "Pre-computed OOF" → HISTORICAL CLAIM), IMD training-base row (3,211/259 → **5,009/291**),
   §19.1 RI adapter row (multimodal → IMD-only runtime), §1 design-vs-implemented wording, dataset row
   HISTORICAL CLAIM labels.
3. `docs/model_audit/model_health_check.md` — §4.4 architecture line qualified as "designed (not
   runtime-wired)"; §4.4.4 documents the two inference blockers (absent fold-0 scaler + storage↔
   preprocess unit mismatch).
4. `frontend/src/data/mock/MOCK.ts` — "satellite CNN is not fitted" → "artifact exists but is NOT
   runnable/validated in-repo (fold-0 scaler absent; storage↔preprocess unit mismatch)".
5. `cyclone_backup/tc_ri_cnn/README.md` — fixed garbage storm count "425 storms / 5.47%" → current
   trained base "5,009 rows / 291 storms / 179 RI / 5.6% BoB".
6. `cyclone_backup/README.md` + `cyclone_backup/SIH_FINAL_RI_REPORT.md` — Phase 9 reproducibility note
   added at top: satellite/TCIR/fusion metrics are `UNVERIFIED / HISTORICAL CLAIM — NOT REPRODUCED
   FROM CURRENT REPOSITORY`.
7. `tests/test_satellite_metadata.py` — new regression test: recovered metadata `image_path` must
   resolve and row count / RI distribution must match inventory.

## 6. What would be required to make a multi-source satellite system real (NOT done in Phase 9)

- Regenerate or recover the fold-0 scaler (`results/cnn_tabular_scaler.json`) to make `satellite_cnn.pt`
  inferable, and add a unit adapter (Kelvin ⇄ `[0,1]` storage) in `normalize_patch`/`SatelliteLoader`.
- Re-run the CNN OOF from a documented training dataset to substantiate the 0.516 PR-AUC claim.
- Obtain a TCIR dataset + healthy normalisation stats; retrain/evaluate TCIR in an environment where
  TensorFlow runs; reproduce the 0.0917 PR-AUC claim or remove it.
- Train a fusion meta-model on a common test set and wire `fusion_probability` end-to-end.
- Only then may docs/frontend describe RI as "multimodal / multi-source" and only with the
  demonstrated evidence.

**Phase 9 exit criterion preview (Phase 10):** a documented, reproducible satellite/multi-source
pipeline with at least: data → preprocess → train/test split (storm-wise) → trained artifact →
reproducible metrics → wired runtime inference, all inside the repo.