# RI — IMD+ERA5 Fusion Runtime Integration Record

**Date:** 2026-09-16
**Change:** Wire the completed IMD+ERA5 fusion RI model into the TOOFAN runtime
RI path as the production inference branch, without touching any locked
scientific artifacts.

## 1. Model registered

| Field | Value |
|---|---|
| Registry key | `ri_fusion_v1` (`models/registry/registry_index.json`) |
| Checkpoint | `RI/era5_datasets/imd_era5_fusion_experiment/final_model_seed42/imd_era5_fusion_xgboost_final.json` |
| SHA-256 | `dfdb75adb4be284599a40c7e21b887a156795b827313b629207197f2c32bda20` |
| Predictors | 98 = 89 ERA5 + 9 IMD |
| Trees | 29 |
| Locked test metrics | n=233, storms=26, RI cases=24, ROC-AUC=0.7373, PR-AUC=0.2364, Brier=0.15166, threshold=0.54 |

Read from `imd_era5_fusion_locked_test_metrics.csv`; copied verbatim, not recomputed.

## 2. Runtime component

`src/models/ri/fusion.py` provides:

- `build_era5_static_features` — 38 static ERA5 predictors from the 20 raw
  level fields in `CycloneState.environmental_features` (t/r/u/v/d at
  850/700/500/200 + `shear_850_200` + 17 derived thermodynamics/wind already
  final-format for the booster, in exact booster order).
- `build_era5_temporal_features` — 51 capped-lag deltas (`delta_{6,12,24}h_*`
  over the 17 derived features) from an optional in-storm `era5_history`
  (previous-observation, capped-lag semantics as in the frozen dataset); NaN
  when no observation within the cap.
- `build_imd_fusion_features` — the 9 IMD predictors, NaN-preserving:
  `wind_minus_Lh_kt == wind(t-L)`, `delta_v_minus_Lh_kt == wind(t) - wind(t-L)`,
  `pressure_drop_hpa == -pressure_change_6h`.
- `build_fusion_feature_vector` — returns a `(1, 98)` vector with
  `feature_names` identical to `booster.feature_names` (validated at load).
- `IMDERA5FusionModel` — loads the locked JSON via `xgb.XGBClassifier`-compatible
  `Booster`, re-validates feature count (98) and tree count (29) per load, caches.

## 3. Adapter integration (`src/models/adapters/ri_adapter.py`)

- New mode `IMD_ERA5_FUSION`, selected when the fusion checkpoint is loaded and
  `has_era5_base_fields(state)` is true.
- `predict(state, era5_history=None)`:
  - fusion path → `RIPrediction(probability_24h, fusion_probability, imd_probability, ...)`,
    calibrated probability mirrors the fusion branch in fusion mode;
  - IMD-only fallback → `mode="IMD_ONLY"`, `fusion_probability=None`,
    `era5_probability=None`, clearly labelled in `explanation`; never reported as
    an IMD+ERA5 prediction.
- Orchestrator wrapper (`src/models/ri/adapter.py`) reads
  `metadata.configuration["fusion_checkpoint"]`; production config
  (`configs/pipeline.yaml`) carries `provider: imd_era5_fusion` plus the canonical
  `imd_era5_fusion_checkpoint`.

## 4. Missing-data policy

- IMD gaps (missing trend or pressure fields) stay NaN; the IMD branch and
  XGBoost native missing-value handling consume them as-is. No zero-filling.
- ERA5 temporal deltas are NaN when in-storm history is unavailable at runtime
  (no `era5_history`); this is in-distribution (end-of-storm rows in training
  carry NaN temporals). Static ERA5 still runs whenever the 20 base fields exist.
- No fabricated ERA5: if the base fields are absent, fusion is **not** executed —
  the adapter falls back to IMD-only and labels it as such.

## 5. Backend / API / frontend status (honest recording)

- No HTTP/API REST endpoint exists today for RI. The frontend
  (`IntensityPage.tsx` / `toofanService.getRI()`) consumes demo-mode mock data.
  Therefore there is **no runtime HTTP wiring to do**; the runtime path is the
  Python orchestrator (`PipelineOrchestrator -> ModelAdapter -> fusion adapter`).
- Wiring fusion into a future REST tier is a documented follow-up (see `B` and
  `I` in the integration report); nothing is faked to fake an endpoint.

## 6. Tests

`tests/test_ri_fusion.py` (21 tests) covers: model loading (29 trees/98
features); feature count contract (89+9=98) and agreement with
`era5_ri_feature_spec_89.json`; static-derived and temporal-delta reproduction of
frozen CSV rows (including real consecutive-pair deltas for 6/12/24 h); IMD lag
semantics; absence of future-leakage columns (`wind_24h_kt`,
`delta_v_24h_kt`, `RI_24h`); booster-consistent ordering; determinism; NaN
preservation to the booster; ERA5-unavailable → IMD_ONLY fallback; orchestrator
end-to-end fusion flow; real-row fixtures.

Full suite: `python3 -m pytest tests/ -q` → **233 passed** (baseline 25 adapter+
orchestrator tests still green).

## 7. Locked artifacts

None modified. All reads only; `imd_era5_fusion_xgboost_final.json`,
`imd_era5_fusion_1086_final.csv`, `era5_ri_feature_spec_89.json`, the locked
metrics/predictions CSVs, and `RI/config.yaml` research blocks are untouched.