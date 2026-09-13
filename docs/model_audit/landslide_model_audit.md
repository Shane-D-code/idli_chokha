# TOOFAN — Landslide Model Forensic Audit

**Audit Date:** 2026-09-02
**Audit Type:** FORENSIC DISCOVERY + HEALTH CHECK — READ-ONLY
**Scope:** Determine whether a trained Landslide model exists, where it is, whether it is the user's trained model, whether it loads/predicts, and whether it is integrated into TOOFAN.
**Constraint:** No retraining, no weight changes, no model substitution, no fabricated results.

---

## 1. Executive Conclusion

**The claimed trained Landslide model is NOT present anywhere in the repository.**

No artifact matching a Landslide model was found. All 16 artifacts inside the
Genesis model directory (`genisis models/`) are **Genesis tropical-cyclone
formation models** (34 oceanic/atmospheric features, binary `genesis_24h`
target). None corresponds to a landslide model (no slope/elevation/soil/
geology/NDVI/terrain features, no landslide target).

Evidence is presented in detail below. **"The model exists", "the model works",
"the model is integrated", and "the model is validated" are four distinct
claims — and NONE of them is supported for a Landslide model in this repo.**

---

## 2. Artifact Discovery

Exhaustive recursive search for all trained-model extensions
(`*.joblib *.pkl *.pickle *.pt *.pth *.keras *.h5 *.onnx *.ckpt
*.safetensors *.model *.bin *.npy *.npz`) excluding `.git`/`.venv`, plus a
filename scan for `landslide|slide|suscept|slope`.

### 2.1 Filenames containing landslide/slide/susceptibility/slope
**None found.** (``)

### 2.2 Landslide/Genesis directories
- `src/models/landslide/` → contains only `adapter.py` (no artifact)
- `src/models/genesis/` → contains only `adapter.py` (no artifact)
- `genisis models/` → 16 artifacts, ALL Genesis (see below)

### 2.3 Complete artifact inventory (non-venv, non-git)

| # | Artifact | Location | Nature |
|---|----------|----------|--------|
| 1–16 | All `genisis models/*.joblib` | `genisis models/` | **Genesis TC-formation** (34-feature; LGBM/XGB/RF/ExtraTrees/CatBoost) |
| 17 | `best_cyclone_model_lt3p_distilled.pth` (repo root). Legacy path `cyclone_path/checkpoints/v12_best_model.pt` no longer exists. | Trajectory | PyTorch Transformer — *not* landslide |
| 18 | `cyclone_backup/models/satellite_cnn.pt` | RI | PyTorch CNN — *not* landslide |
| 19–22 | `cyclone_backup/models/*.keras` (satellite + TCIR) | RI | Keras — *not* landslide |
| 23 | `cyclone_backup/models/xgboost_IMD_only_baseline.pkl` | RI | XGBoost, 12 IMD features — *not* landslide |
| 24 | `flood/model/flood_xgboost_spatial_holdout.pkl` | Flood | XGBoost, 28 rainfall/hydro/water-distance features — *not* landslide |
| 25 | `rain/model/rainfall_classifier_12.pkl` | Rainfall | RandomForest, 25 rainfall/cyclone features — *not* landslide |
| 26 | `recurvature/scaler.joblib` | Recurvature | StandardScaler (12 features) — *not* landslide |
| 27–28 | `wind/model/wind_model_best.keras`, `wind_model.keras` | Wind | Keras — *not* landslide |
| 29 | `stage17_hazard_maps/*.png` | Static hazard | Static maps, NOT a model |

**No Landslide-trained model was found in any location.**

---

## 3. Inspection of Candidate Artifacts (the genus of "Genesis area" artifacts)

Every artifact in the Genesis area was loaded and its serialized object
inspected (not inferred from filename).

| Artifact | Framework | Estimator | n_features | Classes | Feature set |
|----------|-----------|-----------|-----------|---------|-------------|
| `..._lightgbm_300_OPTIMIZED.joblib` | LightGBM | `LGBMClassifier` | 34 | 0/1 | 34-feature genesis |
| `..._xgboost_300_OPTIMIZED.joblib` | XGBoost | `XGBClassifier` | 34 | 0/1 | 34-feature genesis |
| `..._randomforest_300_OPTIMIZED.joblib` | sklearn | `RandomForestClassifier` | 34 | 0/1 | 34-feature genesis |
| `..._extratrees_300_OPTIMIZED.joblib` | sklearn | `ExtraTreesClassifier` | 34 | 0/1 | 34-feature genesis |
| `..._catboost_300_OPTIMIZED.joblib` | CatBoost | (un-loadable, no `catboost`) | — | — | — |
| `..._BEST_MODEL_300.joblib` | XGBoost | `XGBClassifier` | 34 | 0/1 | 34-feature genesis |
| `..._300_imputer.joblib` | sklearn | `SimpleImputer` | 34 | — | 34-feature genesis |
| `lightgbm_optimized_300.joblib` | LightGBM | `LGBMClassifier` | 34 | 0/1 | 34-feature genesis |
| `xgboost_optimized_300.joblib` | XGBoost | `XGBClassifier` | 34 | 0/1 | 34-feature genesis |
| `randomforest_optimized_300.joblib` | sklearn | `RandomForestClassifier` | 34 | 0/1 | 34-feature genesis |
| `catboost_optimized_300.joblib` | CatBoost | (un-loadable) | — | — | — |

**Dominant / shared feature schema (34 features) across ALL Genesis artifacts:**
```
tchp_kj_cm2_x, ohc700_kj_cm2_x,
u850, v850, r850, t850, w850, q850, z850,
u700, v700, r700, t700, w700, q700, z700,
u500, v500, r500, t500, w500, q500, z500,
u200, v200, r200, t200, w200, q200, z200,
sst, sst_anomaly,
tchp_kj_cm2_y, ohc700_kj_cm2_y
```
Target: binary tropical-cyclone genesis (`genesis_24h`).

**Evidence that none is a Landslide model:**
- No feature relates to rainfall/slope/elevation/soil/geology/land-cover/NDVI/
  drainage/terrain/susceptibility.
- Binary target 0/1 is TC genesis, not landslide occurrence/susceptibility.
- Estimator classes (LGBM/XGB/RF/ET classifiers) are genesis-family, matching
  the Genesis trainer, not a (hypothetical) landslide trainer.

---

## 4. Training-Code Evidence Chain

**Goal:** `TRAINING CODE → TRAINED ARTIFACT → CURRENT LOCATION → CURRENT LOADER`

- Training code for a Landslide model: **NOT FOUND** (no `landslide/train.py`,
  no notebook, no `joblib.dump`/`pickle.dump`/`torch.save` producing a landslide
  artifact).
- Produced artifact: **NONE**.
- Current location: **N/A**.
- Current loader (`src/models/landslide/adapter.py`): loads **no** artifact;
  it explicitly warns that no ML model exists and returns static status.

The only reproducible training→artifact→loader chains in the repo are for
Genesis (34 oceans/atmos features), Trajectory, RI, Recurvature, Rainfall,
Flood, and Wind. There is **no Landslide chain**.

---

## 5. What the Landslide model predicts — N/A

Because no trained artifact exists, there is **no** target to report. Per the
adapter and prior health-check, the only Landslide capability is
**STATIC SUSCEPTIBILITY** map generation from the `stage17_hazard_maps` PNGs
(rainfall + terrain → hazard PNG). This is:

- **NOT** a dynamic event prediction model.
- **NOT** a cyclone-triggered landslide forecasting model.
- **STATIC SUSCEPTIBILITY / VISUALIZATION ONLY.**

**Model type = UNKNOWN (no model).** Static hazard mapping is present, but it is
not an ML landslide model.

---

## 6. Input Features — N/A

No model → no feature schema. (For completeness: the `stage17_hazard_maps`
static maps use rainfall images + terrain, but these are not ML-model features,
and no trained artifact consumes them.)

---

## 7. Model File Load Test

| Check | Result |
|-------|--------|
| Landslide artifact exists | **NO** |
| Loads successfully | **N/A (no artifact)** |
| No native crash | **N/A** |
| Expected class/features/output | **N/A** |

**There is no Landslide artifact to load. MODEL LOAD = FAIL (artifact absent).**

(For contrast, the Genesis-area artifacts all load successfully, but they are
Genesis TC models, not Landslide.)

---

## 8. Inference Test

**No valid Landslide input fixture exists** (there is no model, hence no
input schema and no test fixture).

**MODEL LOAD = FAIL, INFERENCE = NOT VERIFIED, REASON = NO ARTIFACT / NO INPUT
FIXTURE.**

No inference result is fabricated.

---

## 9. Probability Output

No landslide model supports `predict_proba` (no model). No probability is
manufactured from a class label.

---

## 10. Landslide Adapter (`src/models/landslide/adapter.py`)

| Check | Result |
|-------|--------|
| Adapter exists | YES |
| Adapter imports | YES |
| Loads an actual ML artifact | **NO** (loads nothing; warns) |
| Correct artifact path | N/A (config checkpoint is `""`) |
| Correct preprocessing / feature ordering | N/A |
| Correct output conversion | N/A (returns empty grids) |
| Standardized `LandslidePrediction` schema | YES (produces the schema) |
| Provenance / model version | `version="unavailable"`, `framework="none"` |
| SHA-256 | N/A (no artifact) |

**The adapter is a correct stub** that returns `status="STATIC_SUSCEPTIBILITY"`
with a `reason` explaining that no dynamic landslide ML model exists. It does
NOT load or point to any trained landslide model.

---

## 11. Model Factory

| Check | Result |
|-------|--------|
| Landslide registered in `ModelFactory` | **NO** |
| Registered names | only `genesis`, `genesis_lightgbm`, `genesis_soft_voting_ensemble` |
| ModelFactory loads a landslide artifact | **NO** |

`ModelFactory` does not register any Landslide type, and `create(...)` for
`landslide` would raise `Unknown model type`.

---

## 12. Orchestrator

| Check | Result |
|-------|--------|
| Landslide module declared | YES (`ModuleName.LANDSLIDE`) |
| `_load_module_model(LANDSLIDE)` loads a model | **NO** — registry has no entry → warns and returns `None` |
| Landslide module added to dependency graph | **NO** (no model → not added) |
| `_execute_module` landslide branch reachable | Only if a model were loaded; it is not |
| Full data flow `CycloneState → Rainfall → Terrain → Landslide → HazardEngine` | **NOT** realized (no model) |

The orchestrator has the *hooks* for a landslide pipeline but there is no model
to instantiate, so Landslide does not actually execute with real predictions.

---

## 13. Genesis-Directory Issue

| Potential problem | Status |
|-------------------|--------|
| Incorrect model discovery | N/A — genesis dir contains genesis models only; no landslide present to be mis-discovered |
| Incorrect model classification | N/A |
| Filename collisions | **None** — no `landslide*` file anywhere |
| `ModelFactory` confusion | **None** — landslide not registered; genesis types distinct |
| Genesis adapter loads a landslide artifact | **No** — genesis artifacts are hard-coded genesis file paths; no landslide exists |
| Landslide adapter loads a genesis artifact | **No** — landslide adapter loads nothing |
| Generic “best model” / wildcard loading | Genesis adapter uses an explicit `ARTIFACTS` dict + `_GenesisComponent` estimator guard; no wildcard |
| Incorrect metadata / provenance | None — genesis provenance references genesis artifacts only |

---

## 14. Genesis Isolation (cross-module check)

| Model | Contract artifact | Verified points to |
|-------|-------------------|--------------------|
| Genesis LightGBM | `genisis models/tc_genesis_lightgbm_300_OPTIMIZED.joblib` | LightGBM, 34 genesis features — CORRECT |
| Genesis XGBoost | `genisis models/tc_genesis_xgboost_300_OPTIMIZED.joblib` | XGBoost, 34 genesis features — CORRECT |
| Genesis RandomForest | `genisis models/tc_genesis_randomforest_300_OPTIMIZED.joblib` | RandomForest, 34 genesis features — CORRECT |
| Landslide | (none) | Loads nothing — CORRECT (no artifact) |

**Genesis isolation = PASS.** `_GenesisComponent` rejects any estimator outside
`{lightgbm, xgboost, randomforest}` (would reject ExtraTrees/CatBoost and any
misplaced landslide model). No cross-loading between Genesis and Landslide
exists.

---

## 15. Native Runtime Compatibility

- Full test suite (`python -m pytest tests/ -q`): **143/143 PASS**.
- Shared canonical `libomp` pre-load + `OMP_NUM_THREADS=1` + `n_jobs=1`
  safeguards intact — **no second OpenMP configuration introduced**.
- Loading Genesis (LightGBM/XGBoost/RandomForest) alongside sklearn/others is
  stable; no native crash reintroduced.

**NATIVE RUNTIME = PASS.**

---

## 16. Original-vs-Adapter Fidelity

No original Landslide inference script and no Landslide artifact exist, so
fidelity cannot be computed.

**ORIGINAL VS ADAPTER = NOT VERIFIED (no model).**

---

## 17. Scientific Validation

No Landslide dataset, metrics, or evaluation exists:
- No accuracy / precision / recall / F1 / ROC-AUC / PR-AUC / IoU / etc.
- No train/test split or CV methodology for Landslide.
- No dataset size / positives / negatives / region / time period.
- No leakage assessment (spatial/temporal) because no model.

**SCIENTIFIC VALIDATION = NOT VERIFIED.**

---

## 18. Final Status

**`NOT FOUND`**

(Every other substantive status — AVAILABLE/LOAD/INFERENCE/ADAPTER/STATIC/
VALIDATED — is unsupported because no trained Landslide artifact exists.)

---

## 19. Known Limitations & Clarifications

1. **The user's premise is unsupported:** no trained landslide artifact was
   placed in the Genesis area (or anywhere). The Genesis area holds only Genesis
   TC models.
2. **A name like `..._landslide*`, not `..._genesis*`, would be expected but does
   not exist.**
3. Rain/flood artifacts touch rainfall+hazard but are flood/wind/rain models, not
   landslide models, and are not in the Genesis area.
4. The static `stage17_hazard_maps` PNGs are visual maps, not an ML model and not
   a forecasting capability.

**Recommendation (out of scope of this audit, informational only):** if a genuine
trained landslide artifact existed earlier, it is not in this repository; it would
need to be re-imported and re-registered before it can be loaded, integrated, and
validated.

---

## 20. Declaration

- MODEL FOUND: **NO**
- NO retraining, no weight changes, no model substitution, no fabricated results.