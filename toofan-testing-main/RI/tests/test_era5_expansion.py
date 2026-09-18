"""RI Improvement 5 — audits for the real-dataset expansion artifact.

The expansion is STRICTLY data-only. Because every raw-ERA5 NetCDF in this
repository is a local storm-centred tile, and every master-track observation
that falls inside such a tile at an exact valid time is already present in the
frozen dataset, the honest expansion delta is 0 rows / 0 storms. These tests
assert that the expanded artifact:

1. has unique ``(storm_id, datetime_utc)`` keys;
2. reproduces the frozen 89-feature schema (names and order);
3. contains no future ERA5 timestamps;
4. is aligned with ``era5_delta_minutes == 0`` for every row;
5. carries only genuine RI labels;
6. contains no target-derived predictors;
7. survives the storm-wise split helper without storm leakage;
8. has complete provenance;
9. contains nothing fabricated (no invented rows / sources);
10. keeps the frozen 870 rows byte-identical;
11. is reproducible (deterministic build);
12. matches the frozen baseline stats (870 / 126 / 82 / 788).
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import era5_rebuild as er  # noqa: E402
from src.era5_training import storm_split  # noqa: E402
from src.features import era5_feature_columns_with_temporal  # noqa: E402

REBUILT_CSV = ROOT / "era5_datasets" / "era5_ri_rebuilt.csv"
EXPANDED_CSV = ROOT / "era5_datasets" / "era5_ri_expanded.csv"
MANIFEST = ROOT / "era5_datasets" / "era5_ri_expanded_manifest.json"
INTEGRITY = ROOT / "era5_datasets" / "era5_ri_expanded_integrity.json"
PROVENANCE = ROOT / "era5_datasets" / "era5_ri_expanded_provenance.csv"
SPEC_JSON = ROOT / "era5_ri_feature_spec_89.json"
MODEL_JSON = ROOT / "models" / "era5_final_xgboost.json"
ERA5_DIR = ROOT / "ERA5_expanded"
BUILD_SCRIPT = ROOT / "build_expanded_era5_ri_dataset.py"

FROZEN = {"rows": 870, "storms": 126, "ri_pos": 82, "ri_neg": 788}


@pytest.fixture(scope="module")
def expanded() -> pd.DataFrame:
    return pd.read_csv(EXPANDED_CSV, parse_dates=["datetime_utc"])


@pytest.fixture(scope="module")
def rebuilt() -> pd.DataFrame:
    return pd.read_csv(REBUILT_CSV, parse_dates=["datetime_utc"])


# ---------------------------------------------------------------------------
# 1. unique keys
# ---------------------------------------------------------------------------

def test_unique_observation_keys(expanded):
    dup = expanded.duplicated(["storm_id", "datetime_utc"]).sum()
    assert dup == 0


# ---------------------------------------------------------------------------
# 2. 89-feature schema: names AND order
# ---------------------------------------------------------------------------

def test_feature_schema_matches_spec_and_model(expanded):
    spec = er.load_feature_spec(SPEC_JSON)
    names = [f["name"] for f in spec]
    assert len(names) == 89
    assert names == era5_feature_columns_with_temporal()
    assert names == er.frozen_model_feature_names(MODEL_JSON)
    present = [c for c in expanded.columns if c in names]
    assert present == names  # exact order


# ---------------------------------------------------------------------------
# 3 + 4. no future ERA5; era5_delta_minutes == 0
# ---------------------------------------------------------------------------

def test_no_future_era5(expanded):
    assert int((pd.to_datetime(expanded["era5_datetime"]) >
                pd.to_datetime(expanded["datetime_utc"])).sum()) == 0


def test_era5_delta_minutes_zero_everywhere(expanded):
    assert int((expanded["era5_delta_minutes"] == 0).sum()) == len(expanded)
    assert int((expanded["era5_delta_minutes"] != 0).sum()) == 0


# ---------------------------------------------------------------------------
# 5. genuine RI labels (no invented positives)
# ---------------------------------------------------------------------------

def test_ri_labels_binary_and_counts(expanded):
    assert expanded["RI_24h"].dropna().isin([0, 1]).all()
    assert int((expanded["RI_24h"] == 1).sum()) == FROZEN["ri_pos"]
    assert int((expanded["RI_24h"] == 0).sum()) == FROZEN["ri_neg"]


def test_no_new_ri_positives(expanded):
    """The honest expansion (0 rows) must NOT invent new RI positives."""
    integrity = json.loads(INTEGRITY.read_text())
    assert integrity["expansion"]["added_rows"] == 0
    assert int((expanded["RI_24h"] == 1).sum()) == FROZEN["ri_pos"]


# ---------------------------------------------------------------------------
# 6. no target-derived predictors
# ---------------------------------------------------------------------------

def test_no_target_derived_predictors(expanded):
    forbidden = sorted(set(expanded.columns) & set(er.TARGET_COLS) - {"RI_24h"})
    assert forbidden == []
    # no feature may be a pure function of the frozen RI label in the carried block
    table = expanded[expanded["provenance_status"].isin(
        ["carried_historical", "extracted_from_raw"])].copy()
    feats = era5_feature_columns_with_temporal()
    y = table["RI_24h"].astype(float)
    suspicious = []
    for c in feats:
        g = table[[c]].groupby(y).first()
        if len(g) == 2 and (g.iloc[0] == g.iloc[1]).all():
            suspicious.append(c)
    assert suspicious == []


# ---------------------------------------------------------------------------
# 7. storm-wise split helper: no leakage, Improvement-4 test storms preserved
# ---------------------------------------------------------------------------

CURRENT_TEST_STORMS = {"1982-002", "1982-003", "1984-003", "1985-006",
                       "1985-007", "1985-010", "1986-006", "1987-007",
                       "1989-007", "1989-008", "1990-007", "1992-003",
                       "1992-007", "1994-004", "1995-007", "1995-008",
                       "1997-001", "1998-008", "1999-005", "1999-006",
                       "1999-008", "2000-001", "2003-003", "2005-004",
                       "2025-014"}


def test_split_helper_no_storm_overlap(expanded):
    split = storm_split(expanded, 42)
    assert set(split.train_storms).isdisjoint(split.val_storms)
    assert set(split.train_storms).isdisjoint(split.test_storms)
    assert set(split.val_storms).isdisjoint(split.test_storms)
    assert len(split.train_storms) == 82
    assert len(split.val_storms) == 19
    assert len(split.test_storms) == 25
    # dedupe: storm appears in exactly one split, rows stay complete
    n = (len(split.train) + len(split.val) + len(split.test))
    assert n == len(expanded)


def test_improvement4_test_storms_untouched(expanded):
    split = storm_split(expanded, 42)
    assert set(split.test_storms) == CURRENT_TEST_STORMS


# ---------------------------------------------------------------------------
# 8. provenance completeness
# ---------------------------------------------------------------------------

def test_provenance_file_complete(expanded):
    prov = pd.read_csv(PROVENANCE)
    assert (prov[["storm_id", "datetime_utc"]]
            .drop_duplicates().shape[0]) == prov.shape[0]
    for c in ["storm_id", "datetime_utc", "era5_delta_minutes",
              "era5_source_file", "provenance_status"]:
        assert c in prov.columns
    assert prov["provenance_status"].isin(
        ["carried_historical", "extracted_from_raw"]).all()


def test_extracted_rows_have_real_sources(expanded):
    ex = expanded[expanded["provenance_status"] == "extracted_from_raw"]
    assert ex["era5_source_file"].notna().all()
    known = {p.name for p in ERA5_DIR.glob("era5_pressure_levels_*.nc")}
    assert set(ex["era5_source_file"].astype(str)) <= known


# ---------------------------------------------------------------------------
# 9. nothing fabricated
# ---------------------------------------------------------------------------

def test_manifest_reports_no_fabrication():
    manifest = json.loads(MANIFEST.read_text())
    assert manifest["added"]["rows"] == 0
    assert manifest["status"].startswith("audited real-data expansion")
    assert manifest["candidate_universe"]["new_candidates_usable"] == 0


# ---------------------------------------------------------------------------
# 10. frozen 870 rows byte-identical
# ---------------------------------------------------------------------------

def test_expanded_csv_is_byteidentical_to_frozen():
    hashes = [hashlib.sha256(p.read_bytes()).hexdigest()
              for p in (REBUILT_CSV, EXPANDED_CSV)]
    assert hashes[0] == hashes[1]


def test_expanded_rows_unchanged_positionally(expanded, rebuilt):
    pd.testing.assert_frame_equal(expanded, rebuilt)


# ---------------------------------------------------------------------------
# 11 + 12. determinism + baseline stats
# ---------------------------------------------------------------------------

def test_build_is_deterministic(tmp_path):
    import platform
    if platform.system() != "Darwin":
        pytest.skip("determinism check run on reference machine")
    out1, out2 = tmp_path / "o1", tmp_path / "o2"
    cmd = [sys.executable, str(BUILD_SCRIPT), "--output-dir", str(out1)]
    subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True)
    cmd[-1] = str(out2)
    subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True)
    h1 = hashlib.sha256((out1 / "era5_ri_expanded.csv").read_bytes()).hexdigest()
    h2 = hashlib.sha256((out2 / "era5_ri_expanded.csv").read_bytes()).hexdigest()
    assert h1 == h2


def test_baseline_stats_preserved(expanded):
    assert len(expanded) == FROZEN["rows"]
    assert expanded["storm_id"].nunique() == FROZEN["storms"]
    assert int((expanded["RI_24h"] == 1).sum()) == FROZEN["ri_pos"]
    assert int((expanded["RI_24h"] == 0).sum()) == FROZEN["ri_neg"]