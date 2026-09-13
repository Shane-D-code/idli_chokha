# TOOFAN Cyclone Forecast Pipeline

A research repository integrating tropical-cyclone models: genesis, track
(trajectory), rapid intensification (RI), intensity, recurvature, and the
static hazard/baseline modules (rainfall, wind, flood, landslide).

> **Status of this repository (2026-09-12):** Most branches are research-grade.
> The pipeline runs, but **no model is production-ready**. See the
> [Model Health Check](docs/model_audit/model_health_check.md) and
> [Model Inventory](docs/model_inventory.md) for the full audit.

---

## 1. What actually runs today

| Module | Real inference | Status |
|--------|----------------|--------|
| Trajectory (track) | ✅ point forecasts (+2h…+24h) | **LIMITED / UNVERIFIED** — uncertainty head is a **saturated ~209.9 km constant bound** (not calibrated, does not grow with lead time) |
| Genesis | ✅ P(genesis \| disturbance) | PROTOTYPE — synthetic features; uncalibrated ensemble; not production-validated; training data/code not in repo |
| Recurvature | ✅ | LIMITED — threshold/confidence are fixed, not calibrated |
| RI — IMD branch | ✅ | AVAILABLE — IMD-only; `calibrated_probability` is an **alias of `imd_probability`** (no applied calibration) |
| RI — ERA5 branch | ❌ | UNAVAILABLE — runtime feature reconstruction not wired |
| RI — Satellite CNN | ❌ | UNVERIFIED — real fitted artifact loads, but inference NOT runnable in-repo (fold-0 scaler absent; `[0,1]`↔Kelvin mismatch); OOF claims are HISTORICAL CLAIMs |
| RI — Fusion | ❌ | NOT IMPLEMENTED — no fusion meta-model exists |
| Intensity | ❌ | UNAVAILABLE — no trained artifact in repository; retrain recipe exists (`cyclone intensity/retrain.py`) |
| Rainfall | ⚠️ | BASELINE ONLY — same-time classifier, **not** a forecast |
| Wind | ❌ | UNAVAILABLE in current env — Yaas single case study; `.keras` artifact not loadable (TensorFlow import crashes the interpreter); no inference pipeline |
| Flood | ⚠️ | BASELINE — single event (FANI), spatial holdout only |
| Landslide | ⚠️ | STATIC VISUALIZATION — no ML model |

Context: `REPAIR_LOG.md` documents the ongoing scientific-honesty audit.

---

## 2. Quick start (full pipeline)

```bash
pip install -e .            # or: pip install -r requirements.txt
python -m pytest            # runs the test suite (currently 167 passing)
```

Run the CLI:

```bash
python -m src.cli.main --help
```

The pipeline uses the shared adapters in `src/models/adapters/` (Trajectory,
RI, Intensity, Recurvature) plus `src/models/genesis/adapter.py`.

---

## 3. Trajectory / track model

The deployed trajectory model is a distilled V12 ("LT3P") PyTorch checkpoint:
`best_cyclone_model_lt3p_distilled.pth` (plus `scalers.pkl`) at the repository
root, loaded through `cyclone_path_deployment_package/`.

- Full CLI/API guide for running a single-storm 12-horizon forecast:
  **see [`cyclone_path_deployment_package/README.md`](cyclone_path_deployment_package/README.md)**.
- Adapter: `src/models/adapters/trajectory_adapter.py`
  (`create_trajectory_adapter` / `predict_with_uncertainty`).

### Honest limitations of the trajectory model

- **Valid out to 24 h only** (+2h…+24h, 12 steps) — a short-range tracker.
- **Uncertainty is NOT calibrated and does NOT grow with lead time.** At
  inference the uncertainty output is a saturated constant bound (~209.9 km),
  i.e. `sigma_km` should be treated as *a fixed, unvalidated spread*, not a
  per-horizon calibrated confidence interval. *This contradicts older V12
  documentation that claimed a per-horizon, lead-time-growing, calibrated
  `sigma_km`.*
- **SST / shear are climatology proxies**, not real-time satellite or
  reanalysis fields.
- Requires **≥ 12 observed fixes** (2-hourly spacing for the distilled
  checkpoint); more history = better forecast.
- Historically reported 24h track errors (~50–80 km) are a
  **HISTORICAL CLAIM — NOT REPRODUCED FROM CURRENT REPOSITORY**.

---

## 4. Other modules

- **Intensity** — training code + deterministic retraining entry point exist
  (`cyclone intensity/retrain.py`), but the artifact and dataset are absent:
  **UNAVAILABLE / UNVERIFIED**. See `cyclone intensity/README.md`.
- **RI** — IMD XGBoost branch works (`cyclone_backup/models/imd_final_xgboost.json`).
  ERA5 branch features are not wired; the satellite CNN artifact exists but is NOT
  runnable in-repo (fold-0 scaler missing; storage↔preprocess unit mismatch) and
  its OOF skill figures are historical claims, not reproduced here; the fusion
  meta-model does not exist. `calibrated_probability` is **not** the product of
  any calibration step.
- **Genesis** — `src/models/genesis/adapter.py`, LightGBM production +
  soft-voting ensemble (**uncalibrated**); features are synthetic per the
  external source report; `calibrated=False`; training data, script, and
  metrics are not in this repository.
- **Recurvature** — `recurvature/`, XGBoost on IBTrACS, storm-wise split,
  ROC-AUC ≈ 0.722 (historical claim).
- **Rainfall / Wind / Flood / Landslide** — baselines or static maps in
  `rain/`, `wind/`, `flood/`, `stage17_hazard_maps/`. They are **not** future-
  forecasting models.

---

## 5. Documentation map

- `docs/model_inventory.md` — catalog of models, datasets, artifacts, statuses
- `docs/model_audit/model_health_check.md` (+`.json`) — 9-model health table
- `REPAIR_LOG.md` — phase-by-phase repair/scientific-honesty log
- `cyclone intensity/README.md`, `cyclone_path_deployment_package/README.md` —
  per-module guides