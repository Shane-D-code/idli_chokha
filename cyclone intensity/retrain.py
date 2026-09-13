"""
Deterministic retraining entry point for the tropical cyclone intensity model.

This is the OFFICIAL retraining path for the intensity branch. It is designed
so that, once the correct real modeling dataset is supplied, the exact
artifact consumed by ``src.models.adapters.intensity_adapter
.create_intensity_adapter`` (default ``models/final_xgb_regressor.joblib``)
can be reproduced.

Current repository state (Phase 6 audit, STEP 1)
------------------------------------------------
- ``data/processed/clean_model_data.csv`` (or ``.parquet``): ABSENT.
- ``models/final_xgb_regressor.joblib``: ABSENT.
- ``results/``: ABSENT.
- Therefore no training can currently run, and the historical CV metrics
  (MAE 14.55 kt, RMSE 19.66 kt, R2 0.037) are **HISTORICAL CLAIMS — NOT
  REPRODUCED FROM THIS REPOSITORY** and MUST be treated as UNVERIFIED.

What this script does
---------------------
1. Resolves the modeling dataset (``--data``, or ``auto`` = standard paths).
2. Validates the expected schema (30 predictor columns + ``storm_id`` +
   ``msw_target_24h``). No random row splits; the CV protocol is
   storm-wise ``GroupKFold`` on ``storm_id``.
3. Runs the 5-fold storm-wise regression CV (default ``n_splits=5``):
   MAE / RMSE / R2 per fold. Optionally skippable with ``--skip-cv``.
4. Fits the final model on the full dataset and saves the artifact to
   ``--output`` (default ``models/final_xgb_regressor.joblib``), the exact
   path the inference adapter loads.
5. Writes ``--report`` (default ``models/training_report.json``) with
   reproducible metadata (data path, n observations, n storms, horizon,
   seed, CV metrics for THIS run).
6. Determinism: all model pipelines use ``random_state=42`` inside
   ``src/regression.py``; this script fixes ``seed=42`` by default and
   seeds ``numpy`` accordingly.

If the dataset is absent, NO synthetic or substitute data is generated: the
script prints the reproducible dataset recipe and exits.

Usage
-----
Create a venv with ``cyclone intensity/requirements.txt``, then run from the
``cyclone intensity`` directory::

    python retrain.py --data auto
    python retrain.py --data data/processed/clean_model_data.csv --n-splits 5
    python retrain.py --data auto --skip-cv
    python retrain.py --data auto --validate-only
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

DEFAULT_DATA_CSV = "data/processed/clean_model_data.csv"
DEFAULT_DATA_PARQUET = "data/processed/clean_model_data.parquet"
DEFAULT_OUTPUT = "models/final_xgb_regressor.joblib"
DEFAULT_REPORT = "models/training_report.json"
TARGET = "msw_target_24h"
HORIZON_H = 24
GROUP_COL = "storm_id"

# Canonical 30-column predictor list (must match the adapter's feature order).
# Preferred source is ciclone intensity/src/utils.py but its plotting helpers
# pull in seaborn; fall back to the same constant so the recipe/validation
# path stays runnable without plotting dependencies.
try:
    from src.utils import FEATURE_COLUMNS  # noqa: PLC0415
except Exception:  # seaborn (optional plotting dep) absent
    FEATURE_COLUMNS = [
        "msw_kt", "pressure_hpa", "lat", "lon",
        "msw_change_6h", "msw_change_12h", "msw_change_24h",
        "pressure_change_6h", "pressure_change_12h", "pressure_change_24h",
        "lat_change_6h", "lon_change_6h", "movement_speed_kt",
        "era5_sst", "era5_t850", "era5_t700", "era5_t500", "era5_t200",
        "era5_r850", "era5_r700", "era5_r500", "era5_r200",
        "era5_u850", "era5_u700", "era5_u500", "era5_u200",
        "era5_v850", "era5_v700", "era5_v500", "era5_v200",
    ]

REQUIRED_DATASET_COLUMNS = FEATURE_COLUMNS + [GROUP_COL]


def print_recipe() -> None:
    """Print the documented, deterministic recipe for reproducing the dataset.

    Does not create, download-substitute, or fabricate any data.
    """
    recipe = f"""
REPRODUCIBLE DATASET RECIPE (real data only — nothing is fabricated)

Expected input schema (the modeling file this script consumes):

  Path:          {DEFAULT_DATA_CSV}  (or {DEFAULT_DATA_PARQUET})
  Rows:          one row per best-track observation (the historical claims
                 used 486 observations across 30 storms with ERA5 coverage)
  Columns (exact, in any order):
    - the {len(FEATURE_COLUMNS)} predictor columns:
        {FEATURE_COLUMNS}
    - '{GROUP_COL}': storm identifier used for storm-wise GroupKFold split
    - '{TARGET}':    target — Maximum Sustained Wind speed (kt) observed
                     approximately +24h ahead of the row timestamp
                     (nearest best-track fix within a 2-hour tolerance)
    - optional: 'datetime_final' (UTC timestamp of the row)
    - optional: 'target_category_24h' (IMD grade derived from {TARGET})

Data sources:
  1. IMD Best Track (1982-2026): rsmcnewdelhi.imd.gov.in — downloaded by
     cyclones/src/download_raw_data_if_missing if absent.
  2. IBTrACS NI (v04r01): cross-reference for quality checks.
  3. ECMWF ERA5 reanalysis, point-interpolated at the cyclone centre:
     single-level SST + pressure-level fields (t850/700/500/200 in degC,
     r850/700/500/200 in %, u850/700/500/200 and v850/700/500/200 in m/s).
     Requires a Copernicus CDS account; the legacy Colab research script
     'cyclone intensity/notebook/cyclone_intensity_prediction_part2.py'
     contains the original ERA5 extraction/merge steps.

Feature engineering rule (no leakage):
  - All predictor features are as-of the row time or in the past:
    6/12/24h lags are matched strictly before the row time (tolerance
    <= 1.5h). The +24h target is matched at t+24h +/- 2h.
  - No random row split: evaluation uses storm-wise GroupKFold('{GROUP_COL}').

Once the file is present, run:

    python retrain.py --data auto
    or: python retrain.py --data path/to/clean_model_data.csv

Outputs:
  - {DEFAULT_OUTPUT}         -> the inference artifact consumed by
       src.models.adapters.intensity_adapter.create_intensity_adapter()
  - {DEFAULT_REPORT}         -> metadata + CV metrics from THIS run
  - results/metrics/...      -> CV metric tables/figures
"""
    print(recipe)


def resolve_data(path: str):
    """Resolve the modeling dataset file path."""
    if path is None or path == "auto":
        for candidate in (DEFAULT_DATA_CSV, DEFAULT_DATA_PARQUET):
            if os.path.exists(candidate):
                return candidate
        return None
    if not os.path.exists(path):
        return None
    return path


def load_data(path: str) -> pd.DataFrame:
    """Load the modeling dataset (CSV or parquet)."""
    if path.endswith(".parquet"):
        return pd.read_parquet(path)
    return pd.read_csv(path)


def validate_schema(df: pd.DataFrame) -> list[str]:
    """Return the list of missing required columns (empty if valid)."""
    missing = [c for c in REQUIRED_DATASET_COLUMNS if c not in df.columns]
    if TARGET not in df.columns:
        missing.append(f"target '{TARGET}'")
    return missing


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic retraining path for the TOOFAN intensity model."
    )
    parser.add_argument(
        "--data", default="auto",
        help=f"Path to {TARGET}-labeled clean modeling dataset; 'auto' uses "
             f"{DEFAULT_DATA_CSV}/{DEFAULT_DATA_PARQUET}.",
    )
    parser.add_argument("--model", default="Tuned XGBoost",
                        help="Final model name (default 'Tuned XGBoost').")
    parser.add_argument("--n-splits", type=int, default=5,
                        help="Number of storm-wise GroupKFold splits (default 5).")
    parser.add_argument("--seed", type=int, default=42,
                        help="Determinism seed (default 42).")
    parser.add_argument("--output", default=DEFAULT_OUTPUT,
                        help=f"Artifact output path (default {DEFAULT_OUTPUT}).")
    parser.add_argument("--report", default=DEFAULT_REPORT,
                        help=f"Metadata report path (default {DEFAULT_REPORT}).")
    parser.add_argument("--skip-cv", action="store_true",
                        help="Skip the 5-fold storm-wise CV evaluation.")
    parser.add_argument("--validate-only", action="store_true",
                        help="Only validate the dataset schema, then exit.")
    args = parser.parse_args()

    np.random.seed(args.seed)
    cv_summary = None

    data_path = resolve_data(args.data)
    if data_path is None:
        print(f"[retrain] NO modeling dataset found for --data='{args.data}'.")
        print("[retrain] The training data/artifact are NOT present in this repository.")
        print_recipe()
        return 1

    print(f"[retrain] Loading modeling dataset: {data_path}")
    df = load_data(data_path)

    missing = validate_schema(df)
    if missing:
        print("[retrain] Dataset schema validation FAILED. Missing required columns:")
        for col in missing:
            print(f"  - {col}")
        print("[retrain] See the recipe above for the exact expected schema.")
        return 1

    n_obs = len(df)
    n_storms = int(df[GROUP_COL].nunique())

    if args.skip_cv:
        print(f"[retrain] Skipping CV as requested; fitting {args.model} on "
              f"{n_obs} rows / {n_storms} storms.")
    else:
        print(f"[retrain] Running {args.n_splits}-fold storm-wise GroupKFold "
              f"({GROUP_COL}) on {n_obs} rows / {n_storms} storms...")
        # Deferred import: the full training path needs the intensity package's
        # requirements (e.g. seaborn for plotting helpers).
        from src.regression import evaluate_regression_storm_cv  # noqa: PLC0415
        summary_df, _, _ = evaluate_regression_storm_cv(
            df=df, n_splits=args.n_splits
        )
        cv_summary = summary_df
        print("[retrain] CV summary (from THIS run):")
        print(summary_df.to_string(index=False))

    print(f"[retrain] Fitting final '{args.model}' on the full dataset...")
    from src.regression import train_final_regression_model  # noqa: PLC0415
    _, _ = train_final_regression_model(
        df=df, model_name=args.model, save_path=args.output
    )

    report = {
        "script": "cyclone intensity/retrain.py",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "data_path": data_path,
        "n_observations": int(n_obs),
        "n_storms": int(n_storms),
        "target": TARGET,
        "horizon_h": HORIZON_H,
        "n_splits": None if args.skip_cv else args.n_splits,
        "cv_protocol": "storm-wise GroupKFold on 'storm_id'" if not args.skip_cv else "skipped",
        "seed": args.seed,
        "model": args.model,
        "n_features": len(FEATURE_COLUMNS),
        "features": FEATURE_COLUMNS,
        "artifact_path": args.output,
        "note": (
            "Metrics in this report are computed from THIS run on the supplied "
            "real dataset. They are NOT the historical 14.55 kt MAE claim, "
            "which remains UNVERIFIED / NOT REPRODUCED FROM THE REPOSITORY."
        ),
    }
    if cv_summary is not None:
        report["cv_summary"] = cv_summary.to_dict(orient="records")

    os.makedirs(os.path.dirname(args.report), exist_ok=True)
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"[retrain] Training report written to: {args.report}")
    print(f"[retrain] Artifact written to: {args.output}")
    print("[retrain] Done. The inference adapter can now load the artifact.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
