"""RI Improvement 2 — focused tests for the ERA5 dataset rebuild pipeline."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import era5_rebuild as er  # noqa: E402
from src.features import era5_feature_columns_with_temporal  # noqa: E402

MVP_CSV = ROOT / "models" / "RI_ERA5_features_MVP.csv"
MODEL_JSON = ROOT / "models" / "era5_final_xgboost.json"
ERA5_DIR = ROOT / "ERA5_expanded"
SAT_META = ROOT / "satellite_cnn_recovered" / "metadata_clean.csv"
SPEC_JSON = ROOT / "era5_ri_feature_spec_89.json"


def _build() -> pd.DataFrame:
    return er.build_dataset(
        canonical_path=MVP_CSV,
        era5_dir=ERA5_DIR,
        satellite_meta=SAT_META,
        spec=er.build_feature_spec(),
    )


# ---------------------------------------------------------------------------
# 1. feature contract / ordering
# ---------------------------------------------------------------------------

def test_feature_spec_matches_generated_columns():
    spec = er.build_feature_spec()
    names = [f["name"] for f in spec]
    assert len(names) == 89
    assert names == era5_feature_columns_with_temporal()
    assert len(set(names)) == 89
    assert {f["group"] for f in spec} == {"base", "derived", "temporal_delta"}
    for f in spec:
        assert f["index"] == spec.index(f)
    assert all(f["delta_lag_hours"] is None or f["delta_lag_hours"] in (6, 12, 24)
               for f in spec)


def test_feature_spec_matches_frozen_model():
    spec = er.build_feature_spec()
    names = [f["name"] for f in spec]
    assert names == er.frozen_model_feature_names(MODEL_JSON)


def test_feature_spec_file_roundtrip(tmp_path):
    spec = er.build_feature_spec()
    out = tmp_path / "spec.json"
    er.write_feature_spec(out)
    loaded = er.load_feature_spec(out)
    assert [f["name"] for f in loaded] == [f["name"] for f in spec]
    assert len(loaded) == 89


# ---------------------------------------------------------------------------
# 2. bilinear interpolation
# ---------------------------------------------------------------------------

def test_bilinear_synthetic_flat_field():
    lat2d = np.arange(15.0, 12.75, -0.25)
    lon2d = np.arange(80.0, 82.0, 0.25)
    f = np.ones((len(lat2d), len(lon2d))) * 2.0
    v, cells = er.bilinear_with_cells(13.6, 80.9, lat2d, lon2d, f)
    assert abs(v - 2.0) < 1e-12
    assert cells is not None
    assert set(cells) == {"lat", "lon", "grid_indices"}


def test_bilinear_synthetic_ramp_and_asc_desc_equivalence():
    lat2d = np.arange(15.0, 12.75, -0.25)
    lon2d = np.arange(80.0, 82.0, 0.25)
    L, Lo = np.meshgrid(lat2d, lon2d, indexing="ij")
    f = 1 + 0.1 * (L - 13) + 0.05 * (Lo - 80)
    exp = 1 + 0.1 * (13.6 - 13) + 0.05 * (80.9 - 80)
    v, _ = er.bilinear_with_cells(13.6, 80.9, lat2d, lon2d, f)
    assert abs(v - exp) < 1e-9
    v2, _ = er.bilinear_with_cells(13.6, 80.9, lat2d[::-1], lon2d, f[::-1, :])
    assert abs(v2 - v) < 1e-9


# ---------------------------------------------------------------------------
# 3. raw extraction at exact valid time
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not ERA5_DIR.exists(), reason="ERA5_expanded absent")
def test_extract_era5_from_file_exact_time():
    files = sorted(ERA5_DIR.glob("era5_pressure_levels_*.nc"))
    assert len(files) >= 1
    from datetime import datetime
    import xarray as xr
    p = files[0]
    with xr.open_dataset(str(p)) as ds:
        valid = pd.to_datetime(ds["valid_time"].values)[0]
        lat = float(ds["latitude"].values[2])
        lon = float(ds["longitude"].values[2])
    obs = pd.DataFrame([{
        "storm_id": "TEST0",
        "datetime_utc": valid,
        "latitude": lat,
        "longitude": lon,
        "RI_24h": 0,
    }])
    out = er.extract_era5_from_file(p, obs)
    assert len(out) == 1
    assert out["era5_delta_minutes"].iloc[0] == 0.0
    base = [f"d_850", "r_850", "t_850", "u_850", "v_850", "shear_850_200"]
    for c in base:
        assert float(out[c].iloc[0]) == float(out[c].iloc[0]), f"{c} is NaN"
    assert out["era5_source_file"].iloc[0] == p.name
    assert out["bilinear_cells"].iloc[0] != []


# ---------------------------------------------------------------------------
# 4. temporal-delta semantics (frozen behaviour, unchanged)
# ---------------------------------------------------------------------------

def test_temporal_delta_semantics():
    df = pd.DataFrame({
        "storm_id": ["S1"] * 5,
        "datetime_utc": pd.to_datetime([
            "2020-01-01 00:00", "2020-01-01 06:00", "2020-01-01 12:00",
            "2020-01-02 12:00", "2020-01-02 18:00"]),
        "wind_mag_850": [10.0, 11.0, 13.0, 15.0, 17.0],
        "d_850": [1.0, 2.0, 3.0, 4.0, 5.0],
    })
    out = _raw_temporal(df)

    assert out["delta_6h_wind_mag_850"].iloc[0] != out["delta_6h_wind_mag_850"].iloc[0] or \
        pd.isna(out["delta_6h_wind_mag_850"].iloc[0])  # first row: no history
    assert out["delta_6h_wind_mag_850"].iloc[1] == 1.0   # 6h gap within storm
    assert out["delta_6h_wind_mag_850"].iloc[2] == 2.0
    assert pd.isna(out["delta_6h_wind_mag_850"].iloc[3])  # 24h gap > 6h lag
    assert pd.isna(out["delta_24h_wind_mag_850"].iloc[3]) is False
    assert out["delta_24h_wind_mag_850"].iloc[3] == 2.0   # exactly 24h allowed


def _raw_temporal(df):
    from src.features import add_temporal_features
    return add_temporal_features(df, id_col="storm_id",
                                 time_col="datetime_utc", lags_h=[6, 12, 24])


# ---------------------------------------------------------------------------
# 5. full rebuild: schema, counts, alignment, leakage
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not MVP_CSV.exists(), reason="canonical MVP absent")
def test_build_dataset_schema_and_counts():
    table = _build()
    spec = er.build_feature_spec()
    names = [f["name"] for f in spec]
    assert [c for c in table.columns if c in names] == names
    assert len(table) == 870
    assert int(table["RI_24h"].sum()) == 82
    assert int((table["RI_24h"] == 0).sum()) == 788
    assert table["storm_id"].nunique() == 126


def test_rebuilt_alignment_and_no_leakage():
    table = _build()
    assert int((table["era5_delta_minutes"] == 0).sum()) == len(table)
    assert int((table["era5_delta_minutes"] != 0).sum()) == 0
    assert int((pd.to_datetime(table["era5_datetime"]) >
                pd.to_datetime(table["datetime_utc"])).sum()) == 0
    forbidden = sorted(set(table.columns) & er.TARGET_COLS - {"RI_24h"})
    assert forbidden == []
    assert set(table["provenance_status"]) <= {"carried_historical",
                                               "extracted_from_raw"}
    assert set(table["spatial_method"]) == {er.SPATIAL_METHOD}


def test_missingness_by_group_no_fully_missing():
    table = _build()
    spec = er.build_feature_spec()
    names = [f["name"] for f in spec]
    miss = table[names].isna().mean()
    assert (miss == 1.0).sum() == 0
    assert miss.mean() < 0.30
    assert table[["d_850", "r_850", "t_850", "u_850", "v_850",
                  "shear_850_200"]].isna().sum().sum() == 0


# ---------------------------------------------------------------------------
# 6. MVP comparison (step 9)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not (ROOT / "ri_multimodal_dataset.csv").exists(),
                    reason="multimodal reference absent")
def test_compare_derived_to_multimodal():
    table = _build()
    res = er.compare_derived_to_multimodal(table)
    assert res.get("total_mismatches", 0) == 0
    assert res.get("max_abs_diff_overall", 1.0) < 1e-6
    assert res.get("rows_compared", 0) >= 848


@pytest.mark.skipif(not MVP_CSV.exists(), reason="canonical MVP absent")
def test_compare_historical_rows_recompute():
    table = _build()
    subset = table[table["provenance_status"] == "carried_historical"]
    res = er.compare_historical_rows_recompute(subset, MVP_CSV,
                                               er.build_feature_spec())
    assert res["rows_compared"] == 848
    assert res["total_mismatches"] == 0
    assert res["max_abs_diff_overall"] == 0.0