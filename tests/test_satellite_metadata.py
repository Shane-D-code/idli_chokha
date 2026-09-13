"""Satellite recovered-metadata consistency tests (Phase 9 satellite audit).

These pin the Phase 9 fixes to the recovered satellite dataset:
    - every row's ``image_path`` must resolve to a real file in the repo
      (previously they pointed at a stale external path ``/Users/apple/cyclone/...``)
    - every ``image_file`` must exist under satellite_cnn_recovered/images/
    - row count and RI_24h distribution must match the documented inventory
    - source MERG-IR granule coverage (16/26) and delta tolerances
"""

import csv
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
META = (
    REPO_ROOT
    / "RI"
    / "satellite_cnn_recovered"
    / "metadata_clean.csv"
)
IMAGES = REPO_ROOT / "RI" / "satellite_cnn_recovered" / "images"


def _load_rows():
    with open(META, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_metadata_file_exists():
    assert META.exists(), "recovered metadata_clean.csv must be present"


def test_all_image_paths_resolve_to_repo_files():
    rows = _load_rows()
    assert len(rows) == 26
    for row in rows:
        p = (REPO_ROOT / row["image_path"]).resolve()
        assert p == (IMAGES / row["image_file"]).resolve(), (
            f"{row['image_file']}: image_path must point into the repo images dir"
        )
        assert p.exists(), f"image_path does not resolve: {row['image_path']}"


def test_ri_distribution_matches_inventory():
    rows = _load_rows()
    dist = {}
    for row in rows:
        dist[row["RI_24h"]] = dist.get(row["RI_24h"], 0) + 1
    assert dist == {"1": 9, "0": 17}, f"RI distribution mismatch: {dist}"


def test_unique_storm_count():
    rows = _load_rows()
    storms = {row["storm_id"] for row in rows}
    assert len(storms) == 23


def test_temporal_alignment_within_tolerance():
    rows = _load_rows()
    for row in rows:
        delta = abs(float(row["delta_minutes"]))
        assert delta <= 120, f"fix↔image delta {delta}m exceeds 120m tolerance"


def test_source_granule_coverage():
    granules = {p.name for p in (REPO_ROOT / "RI" / "Cnnfiles").glob("*.nc4")}
    rows = _load_rows()
    covered = sum(1 for row in rows if row["granule_file"] in granules)
    assert covered == 16, f"expected 16/26 source granules in repo, got {covered}/26"


def test_recovered_crops_are_float_stable():
    rows = _load_rows()
    rng = np.random.RandomState(0)
    for row in rng.choice(rows, size=min(3, len(rows)), replace=False):
        arr = np.load(IMAGES / row["image_file"])
        assert arr.shape == (128, 128, 1), f"unexpected shape {arr.shape}"
        assert arr.dtype == np.float32
        assert np.isfinite(arr).all()
        assert 0.0 <= arr.min() and arr.max() <= 1.0


@pytest.mark.parametrize(
    "missing", ["image_path", "image_file", "granule_file", "RI_24h", "delta_minutes"]
)
def test_required_columns_present(missing):
    rows = _load_rows()
    assert all(row.get(missing, "") != "" for row in rows), f"empty column: {missing}"
