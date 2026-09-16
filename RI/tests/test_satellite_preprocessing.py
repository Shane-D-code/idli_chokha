"""Satellite RI audit / repair regression tests.

Three contracts guarded here (Phase 2 of the satellite audit):
1. Preprocessing: recovered .npy crops (stored in GLOBAL-normalised [0,1] units
   with a 0.5 NaN bucket) must be inverted back to Kelvin + a validity mask
   before ``normalize_patch`` -- feeding the stored units straight through
   produced a degenerate constant -1.0 CNN input (now fixed in
   ``satellite_cnn.recovered_crops_to_kelvin``).
2. Labels / leakage: the manifest contains exactly the usable, leakage-safe
   rows (satellite time <= cache time + 5 min) and its RI_24h labels match the
   canonical ``ri_multimodal_dataset.csv``.
3. Reproducibility: the storm-disjoint train/val/test split is deterministic
   (seed 42) and documented in ``ri_satellite_split.json``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402

from src.satellite_cnn import normalize_patch, recovered_crops_to_kelvin  # noqa: E402

RECOVERED = ROOT / "satellite_cnn_recovered"
IMAGES = RECOVERED / "images"
MULTIMODAL = ROOT / "ri_multimodal_dataset.csv"

# Documented storage contract (satellite_recovery._global_normalization).
NAN_BUCKET = 0.5
TB_MIN, TB_MAX = 180.0, 310.0
FILL_TB = 280.0
RECOVERY_TOLERANCE_MIN = 5


def _usable_metadata() -> pd.DataFrame:
    meta = pd.read_csv(RECOVERED / "metadata_clean.csv",
                       parse_dates=["datetime_utc", "satellite_datetime"])
    return meta[meta["satellite_datetime"] <=
                meta["datetime_utc"] + pd.Timedelta(minutes=RECOVERY_TOLERANCE_MIN)]


def _manifest() -> pd.DataFrame:
    return pd.read_csv(RECOVERED / "manifest.csv")


# ---------------------------------------------------------------------------
# Preprocessing repair
# ---------------------------------------------------------------------------

def test_recovered_crops_produce_varying_nonconstant_input():
    """Regression: stored [0,1] crops must not become a constant -1.0 channel."""
    manifest = _manifest()
    stds, count = [], 0
    for image_file in manifest["image_file"]:
        img = np.load(str(IMAGES / image_file))
        tb, mask = recovered_crops_to_kelvin(img, out_of_domain=NAN_BUCKET)
        sample = normalize_patch(tb, mask)
        stds.append(float(np.std(sample[0])))
        count += 1
    assert count == len(manifest)
    assert all(s > 1e-2 for s in stds), f"constant channel: stds={stds}"


def test_inversion_window_and_bucket():
    """Bottom/top of the stored window invert to the Tb clip bounds."""
    arr = np.array([[0.0], [0.5], [1.0]], dtype=np.float32)
    tb, mask = recovered_crops_to_kelvin(arr, out_of_domain=NAN_BUCKET,
                                         tb_min=TB_MIN, tb_max=TB_MAX,
                                         fill_tb=FILL_TB)
    assert float(tb[0, 0]) == pytest.approx(TB_MAX)   # stored 0.0 -> hottest 310 K
    assert float(tb[2, 0]) == pytest.approx(TB_MIN)   # stored 1.0 -> coldest 180 K
    assert float(mask[0, 0]) == 1.0
    assert float(mask[2, 0]) == 1.0


def test_nan_bucket_is_filled_and_excluded_from_mask():
    """0.5 bucket pixels are filled with FILL_TB and marked invalid, never
    treated as a real 245 K measurement (the documented conservative choice)."""
    arr = np.full((4, 4), 0.2, dtype=np.float32)
    arr[1, 1] = NAN_BUCKET
    tb, mask = recovered_crops_to_kelvin(arr, out_of_domain=NAN_BUCKET,
                                         tb_min=TB_MIN, tb_max=TB_MAX,
                                         fill_tb=FILL_TB)
    assert float(tb[1, 1]) == pytest.approx(FILL_TB)
    assert float(mask[1, 1]) == 0.0
    assert float(mask[0, 0]) == 1.0
    assert float(mask[0, 0]) == 1.0


# ---------------------------------------------------------------------------
# Labels / leakage in the manifest
# ---------------------------------------------------------------------------

def test_manifest_counts_match_usable_set():
    usable = _usable_metadata()
    manifest = _manifest()
    assert len(manifest) == len(usable) == 25
    assert manifest["storm_id"].nunique() == 23
    assert int(manifest["RI_24h"].sum()) == 8
    assert int((manifest["RI_24h"] == 0).sum()) == 17
    assert manifest["obs_key"].is_unique


def test_manifest_excludes_satellite_after_observation():
    """Leakage guard: the 2020-001 18:00 UTC obs whose satellite image was
    taken 19:00 UTC (inside the RI window) must NOT appear."""
    manifest = _manifest()
    assert "2020-001@2020-05-17T18:00:00Z" not in set(manifest["obs_key"])


def test_manifest_labels_match_canonical_multimodal():
    mm = pd.read_csv(MULTIMODAL)
    mm = mm[mm["has_satellite"] == 1].drop(columns=["has_satellite"])
    manifest = _manifest()
    mm["datetime_utc"] = pd.to_datetime(mm["datetime_utc"], utc=True)
    manifest["datetime_utc"] = pd.to_datetime(manifest["datetime_utc"], utc=True)
    merged = manifest.merge(
        mm, on=["storm_id", "datetime_utc"], how="left",
        validate="one_to_one", suffixes=("_manifest", "_canonical"))
    assert merged["RI_24h_manifest"].astype(int).eq(
        merged["RI_24h_canonical"].astype(int)).all()


# ---------------------------------------------------------------------------
# Reproducibility of the split
# ---------------------------------------------------------------------------

def test_storm_disjoint_split_is_exact():
    manifest = _manifest()
    by_storm = {sid: set(m["split"]) for sid, m in manifest.groupby("storm_id")}
    assert all(len(sets) == 1 for sets in by_storm.values()), "storm split across sets"
    assert set(manifest["split"]) == {"train", "val", "test"}


def test_split_deterministic_and_documented():
    split_json = json.loads((RECOVERED / "ri_satellite_split.json").read_text())
    assert split_json["seed"] == 42
    manifest = _manifest()
    assert split_json["n_rows"] == len(manifest) == 25
    assert int(manifest["split"].value_counts().get("train", 0)) == split_json["split_rows"]["train"]
    assert int(manifest["split"].value_counts().get("val", 0)) == split_json["split_rows"]["val"]
    assert int(manifest["split"].value_counts().get("test", 0)) == split_json["split_rows"]["test"]
    # Determinism: re-running the builder must reproduce the same storm sets.
    sys.path.insert(0, str(ROOT))
    from build_satellite_manifest import storm_split
    split = storm_split(manifest["storm_id"].astype(str), 42,
                        json.loads((RECOVERED / "ri_satellite_split.json").read_text())["fractions"])
    for set_name, storms in split.items():
        assert storms == set(manifest.loc[manifest["split"] == set_name, "storm_id"])


def test_reproducibility_flagged_not_silent():
    """16 of 25 source granules are on disk; the others must be flagged so a
    re-derivation can never silently loss coverage."""
    manifest = _manifest()
    assert int(manifest["has_granule_on_disk"].sum()) == 16
    assert not manifest["label_conflict"].any()


# ---------------------------------------------------------------------------
# Training-motivation guard
# ---------------------------------------------------------------------------

def test_hybrid_trainable_subset_is_insufficient():
    """Even the full satellite+11-IMD join is far too small for a defensible
    CNN baseline. This test is a sentinel: it must fail loudly if the usable
    set ever grows past the documented blocked threshold, forcing re-review
    before any training is attempted."""
    mm = pd.read_csv(MULTIMODAL)
    sat = mm[mm["has_satellite"] == 1]
    feats = ["latitude", "longitude", "max_wind_kt", "central_pressure_hpa",
             "pressure_drop_hpa", "wind_minus_6h_kt", "delta_v_minus_6h_kt",
             "wind_minus_12h_kt", "delta_v_minus_12h_kt", "wind_minus_24h_kt",
             "delta_v_minus_24h_kt"]
    complete = sat.dropna(subset=feats)
    assert len(complete) <= 12, (
        f"hybrid trainable set grew to {len(complete)} rows "
        f"({complete.storm_id.nunique()} storms, {int(complete.RI_24h.sum())} RI); "
        "re-assess the BLOCKED verdict before training")
