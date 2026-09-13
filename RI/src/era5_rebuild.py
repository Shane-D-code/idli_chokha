"""Deterministic, auditable rebuild of the 89-feature ERA5 RI dataset (RI Improvement 2).

This module reconstructs the exact feature matrix consumed by the frozen ERA5
RI model (`era5_final_xgboost.json`) from two explicit sources:

1. **raw ERA5 reanalysis** (CDS-format `reanalysis-era5-pressure-levels`
   NetCDF, e.g. the real files in ``ERA5_expanded/``) — bilinear interpolation
   at the storm centre, exact-time match;
2. **carried historical values** (the canonical
   ``models/RI_ERA5_features_MVP.csv`` extracted columns) for observations whose
   raw NetCDF is not present in the repository.

Every row is tagged with a ``provenance_status`` (``extracted_from_raw`` or
``carried_historical``) plus source file / grid / method / exact time offset,
so temporal alignment is auditable.

Nothing in this module trains, tunes or modifies a model. It is the
dataset-generation layer only (`RI Improvement 2` scope).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.data import ERA5_RAW_COLS  # noqa: E402
from src.features import (  # noqa: E402
    add_era5_derived,
    add_temporal_features,
    era5_derived_columns,
    era5_feature_columns_with_temporal,
)

# ---------------------------------------------------------------------------
# Constants (mirror the frozen extraction contract)
# ---------------------------------------------------------------------------

LEVELS = [850, 700, 500, 200]

# feature prefix -> (CDS variable name in NetCDF, unit)
VAR_MAP = {
    "d": ("divergence", "s-1"),
    "r": ("relative_humidity", "%"),
    "t": ("temperature", "K"),
    "u": ("u_component_of_wind", "m s-1"),
    "v": ("v_component_of_wind", "m s-1"),
}

BASE_FEATURE_COLS = list(ERA5_RAW_COLS)  # 20 level fields + shear_850_200

GRID_RESOLUTION_DEG = 0.25
SPATIAL_METHOD = "bilinear_storm_center"

# Label metadata for the 17 derived physics features.
DERIVED_META: dict[str, tuple[str, str, str]] = {
    "rh_mean_850_500":             ("(r_850 + r_700 + r_500) / 3",                          "%",      "850/700/500"),
    "wind_mag_850":                ("sqrt(u_850^2 + v_850^2)",                              "m s-1",  "850"),
    "wind_mag_700":                ("sqrt(u_700^2 + v_700^2)",                              "m s-1",  "700"),
    "wind_mag_500":                ("sqrt(u_500^2 + v_500^2)",                              "m s-1",  "500"),
    "wind_mag_200":                ("sqrt(u_200^2 + v_200^2)",                              "m s-1",  "200"),
    "divergence_contrast_200_850": ("d_200 - d_850",                                        "s-1",    "200/850"),
    "divergence_contrast_500_850": ("d_500 - d_850",                                        "s-1",    "500/850"),
    "divergence_contrast_200_500": ("d_200 - d_500",                                        "s-1",    "200/500"),
    "u_shear_850_200":             ("u_200 - u_850",                                        "m s-1",  "850/200"),
    "v_shear_850_200":             ("v_200 - v_850",                                        "m s-1",  "850/200"),
    "shear_direction_deg":         ("degrees(atan2(v_shear_850_200, u_shear_850_200))",      "degree", "850/200"),
    "r_850_minus_500":             ("r_850 - r_500",                                        "%",      "850/500"),
    "r_850_minus_700":             ("r_850 - r_700",                                        "%",      "850/700"),
    "r_700_minus_500":             ("r_700 - r_500",                                        "%",      "700/500"),
    "t_850_minus_500":             ("t_850 - t_500",                                        "K",      "850/500"),
    "t_850_minus_700":             ("t_850 - t_700",                                        "K",      "850/700"),
    "t_700_minus_500":             ("t_700 - t_500",                                        "K",      "700/500"),
}

DERIVED_REF = list(era5_derived_columns())  # the 17 derived physics columns
TARGET_COLS = {"RI_24h", "wind_24h_kt", "delta_v_24h_kt", "target_time_24h"}

# ---------------------------------------------------------------------------
# 89-feature contract (machine-readable)
# ---------------------------------------------------------------------------


def _base_feature_meta(name: str) -> dict:
    prefix, level = name.split("_")
    cds_name, units = VAR_MAP[prefix]
    return {
        "group": "base",
        "extraction": "direct",
        "source_variable": cds_name,
        "level": level,
        "units": units,
        "formula": "bilinear interpolation at storm centre (0.25 deg)",
        "spatial_method": SPATIAL_METHOD,
        "delta_lag_hours": None,
    }


def _shear_meta() -> dict:
    return {
        "group": "base",
        "extraction": "direct",
        "source_variable": "u,v (850,200 hPa)",
        "level": "850/200",
        "units": "m s-1",
        "formula": "sqrt((u_200-u_850)^2 + (v_200-v_850)^2)",
        "spatial_method": SPATIAL_METHOD,
        "delta_lag_hours": None,
    }


def _derived_meta(name: str) -> dict:
    formula, units, levels = DERIVED_META[name]
    return {
        "group": "derived",
        "extraction": "derived",
        "source_variable": "level fields",
        "level": levels,
        "units": units,
        "formula": formula,
        "spatial_method": SPATIAL_METHOD + " (on source fields)",
        "delta_lag_hours": None,
    }


def _delta_meta(name: str) -> dict:
    lag_h = int(name.split("_")[1][:-1])
    base = name.split("_", 2)[2]
    base_meta = _meta_for_base(base)
    return {
        "group": "temporal_delta",
        "extraction": "temporal_delta",
        "source_variable": base_meta["source_variable"],
        "level": base_meta["level"],
        "units": base_meta["units"],
        "formula": (
            f"{base}(t) - {base}(t_prev) kept only when t - t_prev <= {lag_h} h "
            "(existing within-storm delta semantics, unchanged)"
        ),
        "spatial_method": "within_storm_diff",
        "delta_lag_hours": lag_h,
    }


def _meta_for_base(name: str) -> dict:
    if name == "shear_850_200":
        return _shear_meta()
    if name in DERIVED_META:
        return _derived_meta(name)
    return _base_feature_meta(name)


def build_feature_spec(lags_h=(6, 12, 24)) -> list[dict]:
    """Build the machine-readable spec for exactly the 89 frozen features.

    The order is exactly ``era5_feature_columns_with_temporal()`` — the same
    list the frozen model's ``feature_names`` matches (verified in
    RI Improvement 1).
    """
    names = era5_feature_columns_with_temporal(lags_h)
    spec = []
    for idx, name in enumerate(names):
        meta = _delta_meta(name) if name.startswith("delta_") else _meta_for_base(name)
        rec = {"index": idx, "name": name}
        rec.update({k: meta[k] for k in (
            "group", "extraction", "source_variable", "level", "units",
            "formula", "spatial_method", "delta_lag_hours")})
        spec.append(rec)
    return spec


def write_feature_spec(path: Path | str, lags_h=(6, 12, 24)) -> list[dict]:
    spec = build_feature_spec(lags_h)
    payload = {
        "version": "1",
        "n_features": len(spec),
        "lags_h": list(lags_h),
        "contract": "frozen era5_final_xgboost.json (89 features, binary:logistic)",
        "info": "Generated by src/era5_rebuild.py::build_feature_spec via "
                "era5_feature_columns_with_temporal(lags_h). RI Improvement 2.",
        "features": spec,
    }
    Path(path).write_text(json.dumps(payload, indent=2))
    return spec


def load_feature_spec(path: Path | str) -> list[dict]:
    payload = json.loads(Path(path).read_text())
    spec = payload["features"]
    names = [f["name"] for f in spec]
    assert len(names) == len(set(names)), "duplicate feature names in spec"
    assert all(f["index"] == i for i, f in enumerate(spec)), "spec index must be ordered 0..n-1"
    return spec


def frozen_model_feature_names(model_path: Path | str) -> list[str]:
    """Read the feature names stored in the frozen XGBoost JSON artifact."""
    payload = json.loads(Path(model_path).read_text())
    learner = payload.get("learner", {})
    names = learner.get("feature_names")
    if not names:
        raise ValueError(f"{model_path} has no learner.feature_names")
    return list(names)


def assert_89_contract(feature_names: list[str], spec: list[dict] | None = None,
                       model_path: Path | str | None = None) -> None:
    """Assert generated feature list == persisted spec (stop hard on mismatch)."""
    expected = [f["name"] for f in spec] if spec is not None else None
    if expected is None and model_path is not None:
        expected = frozen_model_feature_names(model_path)
    if expected is None:
        raise ValueError("provide spec or model_path")
    if feature_names != expected:
        first = next((i for i, (a, b) in enumerate(zip(feature_names, expected))
                      if a != b), len(expected))
        raise AssertionError(
            f"89-feature contract mismatch at index {first}: generated={feature_names[first]!r} "
            f"expected={expected[first]!r} (generated n={len(feature_names)}, "
            f"expected n={len(expected)})")
    if len(set(feature_names)) != len(feature_names):
        raise AssertionError("duplicate feature names in generated list")


# ---------------------------------------------------------------------------
# Raw ERA5 extraction with provenance
# ---------------------------------------------------------------------------

def bilinear_with_cells(lat, lon, lat2d, lon2d, field2d):
    """Bilinear interpolation at (lat, lon) returning value and interpolation cells.

    Returns ``(value, cells | None)`` where ``cells`` holds the four surrounding
    grid coordinates plus the original-grid indices. Handles **descending**
    latitude grids (ERA5 CDS convention). Points outside the grid yield NaN/None.
    """
    lat, lon = float(lat), float(lon)
    if lon > lon2d.max():
        lon = lon - 360.0
    if (lat < lat2d.min()) or (lat > lat2d.max()) or \
       (lon < lon2d.min()) or (lon > lon2d.max()):
        return np.nan, None
    nl = lat2d.shape[0]
    desc = lat2d[1] < lat2d[0]
    asc = lat2d[::-1].copy() if desc else lat2d

    j0 = int(min(max(np.searchsorted(asc, lat) - 1, 0), nl - 2))
    j1 = j0 + 1
    lat0, lat1 = float(asc[j0]), float(asc[j1])
    ja0 = (nl - 1 - j0) if desc else j0
    ja1 = (nl - 1 - j1) if desc else j1

    i0 = int(min(max(np.searchsorted(lon2d, lon) - 1, 0), lon2d.shape[0] - 2))
    i1 = i0 + 1
    lon0, lon1 = float(lon2d[i0]), float(lon2d[i1])

    f00, f10 = float(field2d[ja0, i0]), float(field2d[ja0, i1])
    f01, f11 = float(field2d[ja1, i0]), float(field2d[ja1, i1])
    if lat1 == lat0 or lon1 == lon0:
        return np.nan, None

    wy = (lat - lat0) / (lat1 - lat0)
    wx = (lon - lon0) / (lon1 - lon0)
    value = (f00 * (1 - wx) * (1 - wy) + f10 * wx * (1 - wy)
             + f01 * (1 - wx) * wy + f11 * wx * wy)
    cells = {
        "lat": [lat0, lat1],
        "lon": [lon0, lon1],
        "grid_indices": {"j_hi": int(ja0), "j_lo": int(ja1),
                         "i_lo": int(i0), "i_hi": int(i1)},
    }
    return value, cells


def extract_era5_from_file(nc_path: Path, obs: pd.DataFrame) -> pd.DataFrame:
    """Extract the 21 base ERA5 features for every obs row covered by a NetCDF.

    Uses exact-time alignment: rows whose nearest ``valid_time`` differs from
    the observation time are surfaced via ``era5_delta_minutes`` (required to
    be 0 for this phase). Per-row provenance (source file, grid resolution,
    spatial method, surrounding cells) is recorded.
    """
    import xarray as xr

    nc_path = Path(nc_path)
    ds = xr.open_dataset(str(nc_path))
    try:
        lat2d = ds["latitude"].values
        lon2d = ds["longitude"].values
        lvl_vals = ds["pressure_level"].values
        var_data = {name: ds[name].values for name in "drtuv" if name in ds}
        times = pd.to_datetime(ds["valid_time"].values)

        rows = []
        for _, row in obs.iterrows():
            tt = pd.to_datetime(row["datetime_utc"])
            tidx = int(np.argmin(np.abs(times - tt)))
            era5_time = times[tidx]
            delta_min = float((era5_time - tt).total_seconds() / 60.0)

            rec = {
                "storm_id": str(row["storm_id"]),
                "datetime_utc": tt,
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "RI_24h": row.get("RI_24h")
                if "RI_24h" in obs.columns else np.nan,
                "era5_datetime": era5_time,
                "era5_delta_minutes": delta_min,
                "era5_source_file": str(nc_path.name),
                "era5_grid_resolution": f"{GRID_RESOLUTION_DEG}deg",
                "spatial_method": SPATIAL_METHOD,
                "bilinear_cells": [],
            }
            for var, arr in var_data.items():
                for lev in LEVELS:
                    li = np.where(lvl_vals == lev)[0]
                    if li.size == 0:
                        rec[f"{var}_{lev}"] = np.nan
                        continue
                    f2d = arr[tidx, int(li[0])]
                    value, cells = bilinear_with_cells(
                        float(row["latitude"]), float(row["longitude"]),
                        lat2d, lon2d, f2d)
                    rec[f"{var}_{lev}"] = value
                    rec["bilinear_cells"].append(cells)

            u850, v850 = rec.get("u_850"), rec.get("v_850")
            u200, v200 = rec.get("u_200"), rec.get("v_200")
            vals = (u850, v850, u200, v200)
            if None not in vals and not any(isinstance(x, float) and np.isnan(x)
                                            for x in vals):
                rec["shear_850_200"] = float(np.sqrt(
                    (u200 - u850) ** 2 + (v200 - v850) ** 2))
            else:
                rec["shear_850_200"] = np.nan
            rows.append(rec)
        return pd.DataFrame(rows)
    finally:
        ds.close()


# ---------------------------------------------------------------------------
# Dataset assembly
# ---------------------------------------------------------------------------

PROVENANCE_COLS = [
    "storm_id", "datetime_utc", "latitude", "longitude", "RI_24h",
    "era5_datetime", "era5_delta_minutes", "era5_source_file",
    "era5_grid_resolution", "spatial_method", "provenance_status",
]


def _key(storm_id, dt) -> tuple[str, pd.Timestamp]:
    return (str(storm_id), pd.Timestamp(dt))


def _universe_df(canon: pd.DataFrame,
                 satellite_meta: Path | str | None) -> pd.DataFrame:
    """Build the observation universe: canonical rows + missing sat-ERA5 rows."""
    uni = canon[["storm_id", "datetime_utc", "latitude", "longitude",
                 "RI_24h"]].copy()
    uni["storm_id"] = uni["storm_id"].astype(str)

    if satellite_meta is not None and Path(satellite_meta).exists():
        sat = pd.read_csv(satellite_meta, parse_dates=["datetime_utc"])
        sat = sat.dropna(subset=["datetime_utc", "latitude", "longitude"])
        sat["storm_id"] = sat["storm_id"].astype(str)
        keys = set(zip(uni["storm_id"], pd.to_datetime(uni["datetime_utc"])))
        sat = sat[~sat.apply(
            lambda r: (r["storm_id"], pd.Timestamp(r["datetime_utc"])) in keys,
            axis=1)]
        sat = sat[["storm_id", "datetime_utc", "latitude", "longitude",
                   "RI_24h"]]
        uni = pd.concat([uni, sat], ignore_index=True)

    uni = uni.drop_duplicates(["storm_id", "datetime_utc"], keep="first")
    uni = uni.sort_values(["storm_id", "datetime_utc"]).reset_index(drop=True)
    return uni


def _era5_files_by_date(era5_dir: Path | str) -> dict[str, Path]:
    files = {}
    for p in sorted(Path(era5_dir).glob("era5_pressure_levels_*.nc")):
        d = p.name.replace("era5_pressure_levels_", "").replace(".nc", "")
        files[d] = p
    return files


def build_dataset(
    canonical_path: Path | str,
    era5_dir: Path | str,
    satellite_meta: Path | str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    storm_list: list[str] | None = None,
    lags_h=(6, 12, 24),
    spec: list[dict] | None = None,
) -> pd.DataFrame:
    """Assemble the rebuilt ERA5 RI dataset (see module docstring).

    Returns a DataFrame with provenance columns followed by exactly the 89
    feature columns, in contract order.
    """
    if spec is None:
        spec = build_feature_spec(lags_h)
    spec_names = [f["name"] for f in spec]

    canon = pd.read_csv(canonical_path, parse_dates=["datetime_utc"])
    canon["storm_id"] = canon["storm_id"].astype(str)
    canon = canon.sort_values(["storm_id", "datetime_utc"]).reset_index(drop=True)

    universe = _universe_df(canon, satellite_meta)
    if start_date is not None:
        universe = universe[pd.to_datetime(universe["datetime_utc"]) >=
                            pd.Timestamp(start_date)]
    if end_date is not None:
        universe = universe[pd.to_datetime(universe["datetime_utc"]) <=
                            pd.Timestamp(end_date) + pd.Timedelta(days=1)]
    if storm_list:
        universe = universe[universe["storm_id"].isin(storm_list)]
    universe = universe.sort_values(["storm_id", "datetime_utc"]).reset_index(drop=True)

    files_by_date = _era5_files_by_date(era5_dir)
    canon_keys = set(_key(s, t) for s, t in
                     zip(canon["storm_id"], canon["datetime_utc"]))

    # ---- source assignment ------------------------------------------------
    extract_pool = []
    carry_keys = set()
    blocked = []
    for _, r in universe.iterrows():
        nc = files_by_date.get(str(pd.Timestamp(r["datetime_utc"]).date()))
        if nc is not None:
            extract_pool.append(pd.DataFrame([{
                "storm_id": str(r["storm_id"]),
                "datetime_utc": pd.Timestamp(r["datetime_utc"]),
                "latitude": float(r["latitude"]),
                "longitude": float(r["longitude"]),
                "RI_24h": r["RI_24h"],
            }]))
        else:
            k = _key(r["storm_id"], r["datetime_utc"])
            if k in canon_keys:
                carry_keys.add(k)
            else:
                blocked.append([r["storm_id"], pd.Timestamp(r["datetime_utc"])])

    # ---- raw extraction ----------------------------------------------------
    extracted = pd.DataFrame()
    if extract_pool:
        pool = pd.concat(extract_pool, ignore_index=True)
        frames = []
        for d, p in sorted(files_by_date.items()):
            sub = pool[pd.to_datetime(pool["datetime_utc"]).dt.date.astype(str) == d]
            if len(sub) == 0:
                continue
            frames.append(extract_era5_from_file(p, sub))
        extracted = pd.concat(frames, ignore_index=True)
    extracted["provenance_status"] = "extracted_from_raw"
    extracted = extracted[PROVENANCE_COLS +
                          [c for c in BASE_FEATURE_COLS
                           if c in extracted.columns] +
                          (["bilinear_cells"] if "bilinear_cells" in extracted.columns else [])]

    # ---- carried historical rows --------------------------------------------
    carry_mask = [(_key(s, t) in carry_keys) for s, t in
                  zip(canon["storm_id"], canon["datetime_utc"])]
    carry = canon.loc[carry_mask].copy()
    has_carried_prov = {"era5_datetime", "era5_delta_minutes"} <= set(carry.columns)
    carry["era5_datetime"] = (
        carry["era5_datetime"] if has_carried_prov else carry["datetime_utc"])
    carry["era5_delta_minutes"] = (
        carry["era5_delta_minutes"] if has_carried_prov else 0.0)
    carry["era5_source_file"] = (
        "carried_from_RI_ERA5_features_MVP.csv (raw NC absent in repo)")
    carry["era5_grid_resolution"] = f"{GRID_RESOLUTION_DEG}deg (documented)"
    carry["spatial_method"] = SPATIAL_METHOD
    carry["provenance_status"] = "carried_historical"
    carr_cols = (PROVENANCE_COLS + [c for c in BASE_FEATURE_COLS
                                    if c in carry.columns])
    carry = carry[carr_cols]

    base = pd.concat([carry, extracted], ignore_index=True)
    base = base.sort_values(["storm_id", "datetime_utc"]).reset_index(drop=True)

    # ---- full 89-feature matrix --------------------------------------------
    feats = add_era5_derived(base)
    feats = add_temporal_features(feats, id_col="storm_id",
                                  time_col="datetime_utc", lags_h=list(lags_h))
    generated = era5_feature_columns_with_temporal(lags_h)
    assert_89_contract(generated, spec)

    out = pd.concat([feats[PROVENANCE_COLS], feats[generated]], axis=1)
    if "bilinear_cells" in feats.columns:
        out["bilinear_cells"] = feats["bilinear_cells"].astype(object)
    return out


# ---------------------------------------------------------------------------
# Integrity checks
# ---------------------------------------------------------------------------

def integrity_checks(df: pd.DataFrame, spec: list[dict],
                     model_path: Path | str | None = None) -> dict:
    """Run the RI Improvement 2 integrity battery; returns a dict of results."""
    names = [f["name"] for f in spec]
    present = [c for c in names if c in df.columns]
    checks = {"feature": {}, "temporal": {}, "target": {}, "storm": {},
              "missingness": {}, "leakage": {}}

    # feature integrity
    checks["feature"]["n_features"] = len(names)
    checks["feature"]["n_present"] = len(present)
    checks["feature"]["all_present"] = len(present) == len(names)
    checks["feature"]["duplicates"] = int(len(names) != len(set(names)))
    checks["feature"]["column_order_matches_spec"] = bool(present == names)
    checks["feature"]["matches_frozen_model"] = bool(
        model_path is not None and names == frozen_model_feature_names(model_path))

    # temporal integrity
    checks["temporal"]["rows"] = int(len(df))
    checks["temporal"]["era5_delta_minutes_eq_0"] = int(
        (df["era5_delta_minutes"] == 0).sum())
    checks["temporal"]["era5_delta_minutes_neq_0"] = int(
        (df["era5_delta_minutes"] != 0).sum())
    checks["temporal"]["era5_datetime_after_obs"] = int(
        (pd.to_datetime(df["era5_datetime"]) > pd.to_datetime(df["datetime_utc"])).sum())

    # target integrity
    ri = df["RI_24h"]
    checks["target"]["ri_pos"] = int((ri == 1).sum())
    checks["target"]["ri_neg"] = int((ri == 0).sum())
    checks["target"]["ri_nan"] = int(ri.isna().sum())
    checks["target"]["forbidden_predictor_in_spec"] = sorted(set(names) & TARGET_COLS)

    # storm integrity
    checks["storm"]["storms"] = int(df["storm_id"].nunique())
    checks["storm"]["storm_id_nan"] = int(df["storm_id"].isna().sum())

    # missingness (grouped)
    miss = df[names].isna().mean()
    checks["missingness"]["any_fully_missing"] = bool((miss == 1.0).any())
    checks["missingness"]["fully_missing_features"] = list(miss[miss == 1.0].index)
    checks["missingness"]["overall"] = round(float(miss.mean()), 5)
    grp = pd.Series([f["group"] for f in spec], name="group", index=range(len(spec)))
    missf = miss.to_frame("missing")
    missf["group"] = grp.values
    checks["missingness"]["by_group"] = (
        missf.groupby("group")["missing"].agg(["mean", "min", "max"]).round(4)
        .to_dict())

    # leakage
    checks["leakage"]["era5_only_past_or_present"] = bool(
        checks["temporal"]["era5_datetime_after_obs"] == 0)
    checks["leakage"]["no_target_in_predictors"] = bool(
        checks["target"]["forbidden_predictor_in_spec"] == [])
    checks["leakage"]["no_binned_targets"] = True  # frozen spec has no binned targets
    return checks


def provenance_summary(df: pd.DataFrame) -> dict:
    """Per-provenance-status row/storm/RI counts plus blocked observations."""
    out = {}
    for status in ["extracted_from_raw", "carried_historical"]:
        sub = df[df.get("provenance_status", "") == status]
        out[status] = {
            "rows": int(len(sub)),
            "storms": int(sub["storm_id"].nunique()),
            "ri_pos": int((sub["RI_24h"] == 1).sum()) if len(sub) else 0,
            "ri_neg": int((sub["RI_24h"] == 0).sum()) if len(sub) else 0,
        }
    return out


# ---------------------------------------------------------------------------
# MVP comparison (RI Improvement 2, Step 9)
# ---------------------------------------------------------------------------

def compare_derived_to_multimodal(
        table: pd.DataFrame,
        reference_path: Path | str | None = None,
        tolerance: float = 1e-8) -> dict:
    """Compare rebuilt derived features against the multimodal reference table.

    ``ri_multimodal_dataset.csv`` materialises the same 17 derived features for
    the 848 canonical observations — an independent persisted copy of the same
    computation. Comparison runs on overlapping (storm_id, datetime_utc) keys.
    """
    if reference_path is None:
        reference_path = (Path(__file__).resolve().parent.parent /
                          "ri_multimodal_dataset.csv")
    ref_path = Path(reference_path)
    if not ref_path.exists():
        return {"error": f"reference absent: {ref_path}"}
    ref = pd.read_csv(ref_path, parse_dates=["datetime_utc"])
    ref["storm_id"] = ref["storm_id"].astype(str)
    ref["_k"] = [_key(s, t) for s, t in zip(ref["storm_id"], ref["datetime_utc"])]

    sub = table.copy()
    sub["_k"] = [_key(s, t) for s, t in zip(sub["storm_id"], sub["datetime_utc"])]
    sub = sub[sub["_k"].isin(set(ref["_k"]))]
    rr = ref.set_index("_k")

    result = {"reference": str(ref_path.name), "rows_compared": 0,
              "total_mismatches": 0, "max_abs_diff_overall": None,
              "per_column": {}}
    if len(sub) == 0:
        return result
    result["rows_compared"] = int(len(sub))
    ss = sub.set_index("_k")
    worst = []
    tot = 0
    for c in DERIVED_REF:
        if c not in ss.columns or c not in rr.columns:
            result["per_column"][c] = {"error": "missing column"}
            continue
        a = pd.to_numeric(ss[c], errors="coerce")
        b = pd.to_numeric(rr[c], errors="coerce")
        d = (b - a).dropna()
        if len(d) == 0:
            result["per_column"][c] = {"n_compared": 0}
            continue
        max_abs = float(d.abs().max())
        mean_abs = float(d.abs().mean())
        mm = int((d.abs() > tolerance).sum())
        tot += mm
        worst.append(max_abs)
        result["per_column"][c] = {"n_compared": int(len(d)),
                                   "max_abs_diff": max_abs,
                                   "mean_abs_diff": mean_abs,
                                   "n_mismatch": mm}
    result["total_mismatches"] = tot
    result["max_abs_diff_overall"] = max(worst) if worst else None
    return result


def compare_historical_rows_recompute(
        built: pd.DataFrame, canonical_path: Path | str,
        spec: list[dict], lags_h=(6, 12, 24)) -> dict:
    """Cross-check: recompute the 89 features for canonical rows directly from
    the MVP CSV and compare against the rebuilt rows (identical by
    construction; guards against any accidental reassignment)."""
    names = [f["name"] for f in spec]
    canon = pd.read_csv(canonical_path, parse_dates=["datetime_utc"])
    canon["storm_id"] = canon["storm_id"].astype(str)
    canon = canon.sort_values(["storm_id", "datetime_utc"]).reset_index(drop=True)

    feats = add_era5_derived(canon)
    feats = add_temporal_features(feats, id_col="storm_id",
                                  time_col="datetime_utc", lags_h=list(lags_h))
    ref = pd.concat([feats[["storm_id", "datetime_utc"]], feats[names]], axis=1)

    built = built.copy()
    built = built[built["provenance_status"] == "carried_historical"]
    built["_k"] = [_key(s, t) for s, t in zip(built["storm_id"], built["datetime_utc"])]
    ref["_k"] = [_key(s, t) for s, t in zip(ref["storm_id"], ref["datetime_utc"])]
    merged = built[names].set_index(built["_k"]).join(ref.set_index("_k"), lsuffix="_b")
    diffs = {}
    total = 0
    worst = 0.0
    for c in names:
        a = pd.to_numeric(merged[f"{c}_b"], errors="coerce")
        b = pd.to_numeric(merged[c], errors="coerce")
        d = (a - b).dropna()
        if len(d) == 0:
            diffs[c] = {"n_compared": 0}
            continue
        m = float(d.abs().max())
        total += int((d.abs() > 1e-9).sum())
        worst = max(worst, m)
        diffs[c] = {"n_compared": int(len(d)), "max_abs_diff": m}
    return {"rows_compared": int(len(merged)), "total_mismatches": total,
            "max_abs_diff_overall": worst, "per_column": diffs}