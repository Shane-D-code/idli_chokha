"""Build the reproducible satellite training manifest + storm-level split.

Phase 2 deliverable of the satellite RI audit: produce a single CSV that
records, for every *usable* recovered satellite crop (leakage-safe, i.e.
``satellite_datetime <= datetime_utc + 5 min``), the observation key, storm
ID, cache time, satellite image time, RI_24h label, source granule, whether
that granule still exists on disk, the preprocessing version and a
deterministic storm-disjoint train/val/test split.

Nothing here fabricates or re-labels data; every row comes from
``satellite_cnn_recovered/metadata_clean.csv`` and the RI_24h labels are
cross-checked against ``ri_multimodal_dataset.csv`` (rows mismatch the
canonical label source are flagged, not silently fixed).

Usage::

    python build_satellite_manifest.py [--seed 42]

Writes::

    satellite_cnn_recovered/manifest.csv
    satellite_cnn_recovered/ri_satellite_split.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_RECOVERED_DIR = REPO_ROOT / "satellite_cnn_recovered"
DEFAULT_MULTIMODAL = REPO_ROOT / "ri_multimodal_dataset.csv"
RECOVERY_TOLERANCE_MIN = 5  # matches ri_dataset.py's leakage guard
PREPROCESSING_VERSION = "recovered_global_physical_fixed_window_180-310K_nan0.5_v1"
SPLIT_FRACTIONS = {"train": 0.70, "val": 0.15, "test": 0.15}


def load_usable_rows(recovered_dir: Path) -> pd.DataFrame:
    meta = pd.read_csv(
        recovered_dir / "metadata_clean.csv",
        parse_dates=["datetime_utc", "satellite_datetime"],
    )
    usable = meta[meta["satellite_datetime"] <=
                  meta["datetime_utc"] + pd.Timedelta(minutes=RECOVERY_TOLERANCE_MIN)]
    return usable.reset_index(drop=True)


def load_normalization_version(recovered_dir: Path) -> str:
    norm_path = recovered_dir / "normalization.json"
    if not norm_path.exists():
        return PREPROCESSING_VERSION
    try:
        norm = json.loads(norm_path.read_text())
        method = norm.get("method")
        window = f'{norm.get("tb_clip_min", 180)}-{norm.get("tb_clip_max", 310)}K'
        return f"{method}_{window}_nan{norm.get('nan_fill', 0.5)}_v1"
    except Exception:
        return PREPROCESSING_VERSION


def cross_check_labels(rows: pd.DataFrame, multimodal_path: Path) -> pd.DataFrame:
    """Flag rows whose RI_24h differs from the canonical satellite label.

    The canonical label is the ``has_satellite == 1`` row in
    ``ri_multimodal_dataset.csv`` matched on ``storm_id`` + ``datetime_utc``.
    Mismatches are flagged in ``label_conflict``, never silently corrected.
    """
    if not multimodal_path.exists():
        rows["label_conflict"] = False
        return rows
    mm = pd.read_csv(multimodal_path, parse_dates=["datetime_utc"])
    mm = mm[mm["has_satellite"] == 1]
    mm = mm[["storm_id", "datetime_utc", "RI_24h"]].drop_duplicates(
        subset=["storm_id", "datetime_utc"])
    merged = rows.merge(
        mm, on=["storm_id", "datetime_utc"], how="left",
        suffixes=("", "_canonical"), indicator=True)
    rows["label_conflict"] = False
    both = merged[merged["_merge"] == "both"]
    rows.loc[both.index, "label_conflict"] = (
        both["RI_24h_canonical"].astype(float) != both["RI_24h"].astype(float))
    return rows


def storm_split(storm_ids, seed: int, fractions: dict) -> dict:
    """Deterministic storm-disjoint split: whole storms never cross sets."""
    storms = np.array(sorted(set(storm_ids)))
    rng = np.random.RandomState(seed)
    perm = rng.permutation(len(storms))
    n_val = int(round(len(storms) * fractions["val"]))
    n_test = int(round(len(storms) * fractions["test"]))
    val = set(storms[perm[:n_val]])
    test = set(storms[perm[n_val:n_val + n_test]])
    train = set(storms[perm[n_val + n_test:]])
    assert not (train & val), "train/val storms overlap"
    assert not (train & test), "train/test storms overlap"
    assert not (val & test), "val/test storms overlap"
    assert len(train) + len(val) + len(test) == len(storms)
    return {"train": train, "val": val, "test": test}


def build_manifest(recovered_dir: Path, multimodal_path: Path, seed: int) -> pd.DataFrame:
    rows = load_usable_rows(recovered_dir)
    normalization_version = load_normalization_version(recovered_dir)
    rows = cross_check_labels(rows, multimodal_path)

    on_disk = {f.name for f in (REPO_ROOT / "Cnnfiles").iterdir()}
    rows["has_granule_on_disk"] = rows["granule_file"].astype(str).isin(on_disk)

    image_dir = recovered_dir / "images"
    if image_dir.is_dir():
        rows = rows[rows["image_file"].apply(lambda p: (image_dir / p).exists())]
    rows = rows.reset_index(drop=True)

    split = storm_split(rows["storm_id"].astype(str), seed, SPLIT_FRACTIONS)
    rows["split"] = rows["storm_id"].astype(str).apply(
        lambda s: next(k for k, v in split.items() if s in v))

    rows["obs_key"] = (
        rows["storm_id"].astype(str) + "@" +
        rows["datetime_utc"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"))
    rows["preprocessing_version"] = normalization_version

    manifest = pd.DataFrame({
        "obs_key": rows["obs_key"],
        "storm_id": rows["storm_id"].astype(str),
        "datetime_utc": rows["datetime_utc"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "satellite_datetime": rows["satellite_datetime"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "RI_24h": rows["RI_24h"].astype(int),
        "image_file": rows["image_file"],
        "granule_file": rows["granule_file"],
        "nan_fraction": rows["nan_fraction"].round(4),
        "has_granule_on_disk": rows["has_granule_on_disk"],
        "label_conflict": rows["label_conflict"],
        "preprocessing_version": rows["preprocessing_version"],
        "split": rows["split"],
    })
    return manifest, split


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--recovered-dir", default=str(DEFAULT_RECOVERED_DIR))
    ap.add_argument("--multimodal", default=str(DEFAULT_MULTIMODAL))
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    recovered_dir = Path(args.recovered_dir)
    manifest, split = build_manifest(
        recovered_dir, Path(args.multimodal), args.seed)

    out_csv = recovered_dir / "manifest.csv"
    manifest.to_csv(out_csv, index=False)

    counts = {k: int(v) for k, v in manifest.groupby("split")["obs_key"].count().items()}
    storm_counts = {k: int(len(v)) for k, v in split.items()}
    split_json = {
        "seed": args.seed,
        "fractions": SPLIT_FRACTIONS,
        "n_rows": int(len(manifest)),
        "n_storms": int(manifest["storm_id"].nunique()),
        "n_ri": int(manifest["RI_24h"].sum()),
        "n_non_ri": int(len(manifest) - manifest["RI_24h"].sum()),
        "split_rows": counts,
        "split_storms": storm_counts,
        "leakage_guard": f"satellite_datetime <= datetime_utc + {RECOVERY_TOLERANCE_MIN} min",
        "preprocessing_version": manifest["preprocessing_version"].iloc[0],
    }
    out_json = recovered_dir / "ri_satellite_split.json"
    out_json.write_text(json.dumps(split_json, indent=2) + "\n")
    print(f"wrote {out_csv}")
    print(f"wrote {out_json}")
    print(json.dumps({k: v for k, v in split_json.items()
                      if k.startswith(("n_", "split_"))}, indent=2))


if __name__ == "__main__":
    main()
