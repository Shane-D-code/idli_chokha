#!/usr/bin/env python3
"""Fair IMD vs ERA5 vs IMD+ERA5 fusion RI comparison (RI Improvement 4).

Reproducible CLI: all paths default to repo-relative locations and every run
derives from the data + seed (42). No hidden machine paths.

Usage:
    python compare_ri_imd_era5.py \
        --era5-data era5_datasets/era5_ri_rebuilt.csv \
        --imd-csv models/IMD_BoB_RI_training_base.csv \
        --seed 42 --output-dir models

Options:
    --era5-data           rebuilt ERA5 RI dataset (RI Improvement 2 output).
    --imd-csv             canonical IMD feature table.
    --seed                RNG seed for the storm-wise split (default 42).
    --output-dir          directory for comparison artifacts (default models/).
    --era5-model          Improvement-3 ERA5 artifact to reuse for the ERA5 arm
                          when the common split matches (default models/era5_ri_model.json).
    --recorded-split      Improvement-3 recorded storm split CSV used to verify
                          the common split matches (default models/era5_ri_storm_split.csv).
    --retrain-era5        force retraining of the ERA5 arm even when the common
                          split matches the Improvement-3 split.
    --frozen-imd-model    frozen IMD baseline artifact (default models/imd_final_xgboost.json).
    --frozen-era5-model   frozen ERA5 baseline artifact (default models/era5_final_xgboost.json).
    --bootstrap-n         storm-level bootstrap resamples (default 1000).
    --query               print the raw STATUS summary and exit (no training).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.ri_comparison import fusion_feature_names, run_comparison  # noqa: E402


def _repo_default(path: str) -> Path:
    p = Path(path)
    return p if p.is_absolute() else (Path(__file__).resolve().parent / p)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--era5-data", default="era5_datasets/era5_ri_rebuilt.csv")
    ap.add_argument("--imd-csv", default="models/IMD_BoB_RI_training_base.csv")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--output-dir", default="models")
    ap.add_argument("--era5-model", default="models/era5_ri_model.json")
    ap.add_argument("--recorded-split",
                    default="models/era5_ri_storm_split.csv")
    ap.add_argument("--retrain-era5", action="store_true")
    ap.add_argument("--frozen-imd-model", default="models/imd_final_xgboost.json")
    ap.add_argument("--frozen-era5-model", default="models/era5_final_xgboost.json")
    ap.add_argument("--bootstrap-n", type=int, default=1000)
    ap.add_argument("--query", action="store_true")
    args = ap.parse_args(argv)

    era5_data = _repo_default(args.era5_data)
    imd_csv = _repo_default(args.imd_csv)
    out = _repo_default(args.output_dir)
    era5_model = _repo_default(args.era5_model)
    recorded_split = _repo_default(args.recorded_split)
    frozen_imd = _repo_default(args.frozen_imd_model)
    frozen_era5 = _repo_default(args.frozen_era5_model)

    for p, label in ((era5_data, "ERA5 data"), (imd_csv, "IMD data")):
        if not p.exists():
            raise SystemExit(f"{label} not found: {p}")

    if args.query:
        print(json.dumps({
            "era5_data": str(era5_data),
            "imd_csv": str(imd_csv),
            "seed": args.seed,
            "output_dir": str(out),
            "era5_model": str(era5_model),
            "recorded_split": str(recorded_split),
            "retrain_era5": args.retrain_era5,
            "frozen_imd_model": str(frozen_imd),
            "frozen_era5_model": str(frozen_era5),
            "bootstrap_n": args.bootstrap_n,
            "n_fusion_features": len(fusion_feature_names()),
        }, indent=2))
        return

    summary, metadata, comparison, models, test_rows = run_comparison(
        era5_data=era5_data,
        imd_csv=imd_csv,
        seed=args.seed,
        output_dir=out,
        era5_model_path=era5_model,
        recorded_split_path=recorded_split,
        frozen_imd_path=frozen_imd,
        frozen_era5_path=frozen_era5,
        force_retrain_era5=args.retrain_era5,
        bootstrap_n=args.bootstrap_n,
    )
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()