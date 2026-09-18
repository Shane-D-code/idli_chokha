#!/usr/bin/env python3
"""Train and evaluate the ERA5-only RI baseline (RI Improvement 3).

Reproducible CLI: every training run derives from the data + seed; there are
no hidden machine paths or defaults that depend on the author's filesystem.

Usage:
    python train_era5_ri.py --data era5_datasets/era5_ri_rebuilt.csv \
        --seed 42 --output-dir models

Options:
    --data          rebuilt ERA5 RI dataset (RI Improvement 2 output).
                    Default: era5_datasets/era5_ri_rebuilt.csv (repo-relative).
    --seed          RNG seed for the storm-wise split (default 42).
    --output-dir    directory for model + metadata artifacts (default models/).
    --frozen-model  frozen ERA5 xgboost artifact used as same-test baseline
                    (default: models/era5_final_xgboost.json if present).
    --query         print the raw STATUS dictionary and exit (no training).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.era5_training import run_training, era5_feature_names


def _repo_default(path: str) -> Path:
    p = Path(path)
    return p if p.is_absolute() else (Path(__file__).resolve().parent / p)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="era5_datasets/era5_ri_rebuilt.csv")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--output-dir", default="models")
    ap.add_argument("--frozen-model", default="models/era5_final_xgboost.json")
    ap.add_argument("--no-frozen-baseline", action="store_true")
    ap.add_argument("--query", action="store_true")
    args = ap.parse_args(argv)

    data = _repo_default(args.data)
    out = _repo_default(args.output_dir)
    frozen = None if args.no_frozen_baseline else _repo_default(args.frozen_model)
    if not data.exists():
        raise SystemExit(
            f"dataset not found: {data} (did you run the RI Improvement 2 "
            f"build? see build_era5_ri_dataset.py / era5_ri_rebuilt.csv)")
    if frozen is not None and not frozen.exists():
        print(f"[warn] frozen model not found; skipping baseline: {frozen}",
              file=sys.stderr)
        frozen = None

    if args.query:
        print(json.dumps({
            "data": str(data),
            "seed": args.seed,
            "output_dir": str(out),
            "frozen_model": str(frozen) if frozen else None,
            "n_features": len(era5_feature_names()),
        }, indent=2))
        return

    summary, metadata, model = run_training(
        dataset_path=data, seed=args.seed, output_dir=out,
        frozen_model=frozen)
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()