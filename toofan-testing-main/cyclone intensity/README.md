# Tropical Cyclone Intensity Prediction & IMD Intensity Classification

A machine-learning framework for **24-hour tropical cyclone intensity forecasting** and **India Meteorological Department (IMD) cyclone grade classification** using historical cyclone best-track records and ECMWF ERA5 reanalysis environmental data.

> ## Reproducibility Status (TOOFAN Phase 6 audit)
>
> **The `data/`, `models/`, and `results/` directories are NOT present in this
> repository snapshot.** No trained artifact, modeling dataset, or validation
> outputs can be loaded or reproduced from here, so the pipeline cannot
> currently run and the metrics in the "Key Results" section below are
> **HISTORICAL CLAIMS — NOT REPRODUCED FROM THIS REPOSITORY**
> (phase-out when a new artifact + training report are produced).
>
> - **Status: UNAVAILABLE / UNVERIFIED**
> - **Retraining entry point:** `python retrain.py --data auto` (deterministic:
>   `random_state=42`, storm-wise `GroupKFold` on `storm_id`). When absent,
>   `retrain.py` prints the exact expected data schema and the real-data recipe
>   — it never fabricates or substitutes data.
> - **Inference:** `create_intensity_adapter()` reports `status="UNAVAILABLE"`
>   when the artifact is missing and `"UNVERIFIED"` with an explicit `reason`
>   when it is present (per-prediction uncertainty is not calibrated →
>   `uncertainty_kt=None`; the historical 14.554 kt MAE is **not** used as a
>   per-input uncertainty value).
> - **Notable training-method finding (usable when data returns):** the code
>   builds features strictly as-of the row time (lags ≤ +1.5h tolerance), the
>   +24h target is matched at t+24h ± 2h, and evaluation is storm-wise
>   `GroupKFold` — i.e. **no random row splits and no obvious lookahead
>   leakage** in the preprocessor.

---

## Executive Summary & Objectives

- **Primary Objective:** Forecast 24-hour ahead Maximum Sustained Surface Wind speed (MSW, knots) for North Indian Ocean tropical cyclones using tree-based ensemble models.
- **Classification Objective:** Classify future cyclone intensity into the 7 official IMD operational intensity grades (`D`, `DD`, `CS`, `SCS`, `VSCS`, `ESCS`, `SUCS`) using meteorological threshold rules derived from predicted MSW.
- **Methodological Principle:** Strict **storm-wise validation (`GroupKFold` on `storm_id`)** to prevent data leakage from temporally autocorrelated observations of the same storm.

---

## Key Results

### 1. Regression Performance (5-Fold Storm-Wise Cross-Validation)

Predicting `msw_target_24h` (+24 hours Maximum Sustained Wind in knots):

| Model | Mean MAE (kt) | Std MAE | Mean RMSE (kt) | Std RMSE | Mean $R^2$ |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Tuned XGBoost** | **14.554** | 5.281 | 19.664 | 7.288 | **0.037** |
| **Tuned Extra Trees** | **14.569** | 4.641 | **19.370** | 6.408 | -0.029 |
| Baseline XGBoost | 15.512 | 5.340 | 20.575 | 7.410 | -0.112 |
| Baseline Extra Trees | 15.786 | 4.890 | 20.925 | 6.850 | -0.304 |

> **Key Takeaway:** Hyperparameter-tuned XGBoost achieved the best Mean Absolute Error of **14.554 kt**, closely followed by Tuned Extra Trees at **14.569 kt** (with the lowest RMSE of 19.370 kt).

---

### 2. IMD Category Classification Performance (Derived from Predicted MSW)

Evaluating future intensity grade prediction using meteorological if-else threshold mapping:

| Model Source | Exact Accuracy (%) | Within-1-Category Accuracy (%) | Macro F1 (%) | Weighted F1 (%) | Macro Precision (%) | Macro Recall (%) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Tuned XGBoost Regressor** | **45.27%** | **83.95%** | **37.74%** | **44.88%** | **39.63%** | **38.86%** |
| **Tuned Extra Trees Regressor** | 44.24% | 83.13% | 36.19% | 43.62% | 37.95% | 37.40% |

> **Ordinal Classification Finding:** While exact category accuracy is ~45.3% due to fine class boundaries, **Within-1-Category Accuracy reaches ~84.0%**. This indicates that when the model misclassifies a cyclone's future grade, it almost always lands in an immediately adjacent intensity tier (e.g., predicting `SCS` for a `VSCS`), preserving operational utility.

---

## Dataset & Environmental Variables

### Data Sources
1. **IMD Best Track Data (1982–2026):** Primary official records for North Indian Ocean cyclones.
2. **IBTrACS v04r01:** Global best-track archive cross-referenced for quality checks.
3. **ECMWF ERA5 Reanalysis:** Point-interpolated atmospheric pressure-level fields and Sea Surface Temperature (SST).

### The 30 Predictor Features

```
Predictor Features (30)
├── Cyclone Current State & Dynamics (13)
│   ├── msw_kt (Current intensity, kt)
│   ├── pressure_hpa (Central pressure, hPa)
│   ├── lat, lon (Geographical coordinates)
│   ├── msw_change_6h, msw_change_12h, msw_change_24h (Intensity trends)
│   ├── pressure_change_6h, pressure_change_12h, pressure_change_24h (Pressure trends)
│   ├── lat_change_6h, lon_change_6h (6-hour displacement)
│   └── movement_speed_kt (Translational speed)
└── ERA5 Environmental Conditions (17)
    ├── era5_sst (Sea Surface Temperature, °C)
    ├── era5_t850, era5_t700, era5_t500, era5_t200 (Atmospheric Temperature, °C)
    ├── era5_r850, era5_r700, era5_r500, era5_r200 (Relative Humidity, %)
    ├── era5_u850, era5_u700, era5_u500, era5_u200 (Zonal Wind, m/s)
    └── era5_v850, era5_v700, era5_v500, era5_v200 (Meridional Wind, m/s)
```

---

## IMD Cyclone Intensity Scale Mapping

Maximum Sustained Wind (MSW, knots) is converted into IMD categories using standard meteorological operational brackets:

```python
def msw_to_category(msw: float) -> str:
    if msw < 28.0:
        return 'D'      # Depression (17-27 kt)
    elif msw <= 33.0:
        return 'DD'     # Deep Depression (28-33 kt)
    elif msw <= 47.0:
        return 'CS'     # Cyclonic Storm (34-47 kt)
    elif msw <= 63.0:
        return 'SCS'    # Severe Cyclonic Storm (48-63 kt)
    elif msw <= 89.0:
        return 'VSCS'   # Very Severe Cyclonic Storm (64-89 kt)
    elif msw <= 119.0:
        return 'ESCS'   # Extremely Severe Cyclonic Storm (90-119 kt)
    else:
        return 'SUCS'   # Super Cyclonic Storm (>= 120 kt)
```

---

## Project Structure

```text
cyclone-intensity-prediction/
│
├── data/
│   ├── raw/                      # Raw IMD workbook & IBTrACS data
│   ├── era5/                     # ERA5 download cache directory
│   ├── processed/                # Final clean modeling datasets
│   │   ├── clean_model_data.csv
│   │   └── clean_model_data.parquet
│   └── README.md                 # Dataset documentation and dictionary
│
├── src/                          # Modular Python source package
│   ├── __init__.py
│   ├── utils.py                  # Grade mappings, metrics, plotting functions
│   ├── preprocessing.py          # Data cleaning and lag feature engineering
│   ├── regression.py             # XGBoost & Extra Trees regression models
│   ├── classification.py         # MSW-to-IMD category classification module
│   └── evaluation.py             # Reporting and figure generation utilities
│
├── results/
│   ├── metrics/                  # Exported metrics CSVs and text reports
│   │   ├── regression_metrics.csv
│   │   ├── classification_metrics.csv
│   │   ├── feature_importances.csv
│   │   └── classification_report.txt
│   └── figures/                  # Visualization artifacts
│       ├── tuned_xgboost_confusion_matrix.png
│       ├── tuned_extra_trees_confusion_matrix.png
│       └── feature_importance.png
│
├── models/
│   └── .gitkeep                  # Fitted model artifact directory
│
├── docs/
│   └── experiment_report.pdf     # Experimental progress report documentation
│
├── legacy/
│   └── cyclone_intensity_prediction_part2.py # Full Colab research export
│
├── main.py                       # Main pipeline execution script
├── requirements.txt              # Pinned environment dependencies
├── .gitignore                    # Git rules ignoring NetCDF and model binaries
└── README.md
```

---

## Installation & Setup

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/your-username/cyclone-intensity-prediction.git
   cd cyclone-intensity-prediction
   ```

2. **Set up a Virtual Environment:**
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On Linux/macOS:
   source venv/bin/activate
   ```

3. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

---

## How to Run

To run the complete storm-wise cross-validation pipeline, evaluate regression, classify predicted intensities into IMD categories, and generate all output artifacts:

```bash
python main.py
```

**Deterministic retraining (recommended entry point):**

```bash
python retrain.py --data auto           # uses data/processed/clean_model_data.{csv,parquet}
python retrain.py --data path/to/clean_model_data.csv --n-splits 5
python retrain.py --data auto --validate-only    # check schema only
```

`retrain.py` validates the expected schema (the 30 predictor columns +
`storm_id` + `msw_target_24h`), runs the storm-wise CV, fits and saves
`models/final_xgb_regressor.joblib`, and writes `models/training_report.json`
with the metrics from **that run**. If the dataset is absent it prints the
exact recipe and refuses to fabricate data.

### Outputs Generated:
- `results/metrics/regression_metrics.csv`: Cross-validation MAE, RMSE, $R^2$.
- `results/metrics/classification_metrics.csv`: Accuracy, Macro F1, Within-1-Category accuracy.
- `results/metrics/classification_report.txt`: Per-class precision, recall, and support.
- `results/figures/*_confusion_matrix.png`: Heatmaps of predicted vs actual IMD grades.
- `results/figures/feature_importance.png`: Feature importance chart for top predictors.
- `models/final_xgb_regressor.joblib`: Persisted trained regression model.

---

## Feature Importance Insights

Analysis of the top predictor variables from the tuned XGBoost model indicates:
1. **Storm Persistence & Central Pressure Dominate:** `msw_kt`, `pressure_hpa`, `msw_change_24h`, and `pressure_change_12h` account for over 40% of total predictive weight.
2. **Mid-Tropospheric Environmental Signals:** `era5_t700` (700 hPa temperature) and `era5_r700` (700 hPa relative humidity) are the most influential environmental predictors, confirming that mid-level moisture and thermal stability govern intensification in the North Indian Ocean.
3. **Oceanic Heat:** `era5_sst` contributes meaningfully to longer-term intensification potential.

---

## Limitations & Future Work

- **Dataset Size:** The focused ERA5 dataset spans 486 observations across 30 storms. Expanding ERA5 coverage across the full 1982–2026 historical record will further improve generalization on rare extreme storms (`ESCS`, `SUCS`).
- **Spatial Deep Learning (Out of Scope):** Current models utilize point-extracted reanalysis variables. A future hybrid architecture incorporating 2D spatial ERA5 fields surrounding cyclone centers via Convolutional Neural Networks (CNNs) is proposed for subsequent project phases.
