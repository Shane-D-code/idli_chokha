"""Causal recurvature ERA5 features backed by the existing RI ERA5 cache.

The RI rebuild is the sole ERA5 extraction path in this repository.  This
module consumes its persisted, provenance-tagged table and never downloads or
re-extracts ERA5.  A backward as-of match ensures an environmental source row
is available no later than the storm observation being predicted.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ERA5_CACHE_PATH = REPO_ROOT / "RI" / "era5_datasets" / "era5_ri_rebuilt.csv"
ERA5_CACHE_PROVENANCE_PATH = REPO_ROOT / "RI" / "era5_datasets" / "era5_ri_manifest.json"

QUADRANTS = ("nw", "ne", "sw", "se")
ERA5_VALUE_COLS = [
    "era5_steering_u_850_200", "era5_steering_v_850_200",
    "era5_steering_magnitude_850_200", "era5_steering_direction_850_200",
    "era5_steering_heading_angle", 
    *[f"era5_u500_{q}" for q in QUADRANTS],
    *[f"era5_v500_{q}" for q in QUADRANTS],
    "era5_z500", "era5_ridge_axis_lat", "era5_storm_to_ridge_distance_deg",
    "era5_shear_200_850", "era5_midlevel_relative_humidity",
    "era5_steering_u_850_200_tendency_24h", "era5_steering_v_850_200_tendency_24h",
    "era5_steering_magnitude_850_200_tendency_24h", "era5_shear_200_850_tendency_24h",
    "era5_midlevel_relative_humidity_tendency_24h",
]
ERA5_SOURCE_VALUE_COLS = [
    name for name in ERA5_VALUE_COLS
    if name not in {
        "era5_steering_heading_angle", "era5_storm_to_ridge_distance_deg",
        "era5_steering_u_850_200_tendency_24h", "era5_steering_v_850_200_tendency_24h",
        "era5_steering_magnitude_850_200_tendency_24h", "era5_shear_200_850_tendency_24h",
        "era5_midlevel_relative_humidity_tendency_24h",
    }
]
ERA5_MISSING_INDICATOR_COLS = [f"{name}_missing" for name in ERA5_VALUE_COLS]
ERA5_FEATURE_COLS = ERA5_VALUE_COLS + ERA5_MISSING_INDICATOR_COLS


@lru_cache(maxsize=4)
def _load_ri_era5_cache(path: str) -> pd.DataFrame:
    """Load RI's persisted ERA5 feature cache once per process."""
    source = pd.read_csv(path)
    for column in ("datetime_utc", "era5_datetime"):
        source[column] = pd.to_datetime(source[column], errors="coerce")
    return source


def _storm_key(df: pd.DataFrame) -> pd.Series:
    raw_number = df["NUMBER"] if "NUMBER" in df else pd.Series(np.nan, index=df.index)
    number = pd.to_numeric(raw_number, errors="coerce").astype("Int64")
    season = pd.to_numeric(df["SEASON"], errors="coerce").astype("Int64")
    return season.astype(str) + "-" + number.astype(str).str.zfill(3)


def _empty_environment(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for column in ERA5_VALUE_COLS:
        out[column] = np.nan
    out[ERA5_MISSING_INDICATOR_COLS] = 1.0
    out["era5_source_time"] = pd.NaT
    out["era5_source_age_h"] = np.nan
    return out


def _source_environment(source: pd.DataFrame) -> pd.DataFrame:
    """Derive center-point environmental fields from RI's base ERA5 cache."""
    out = source.copy()
    levels = (850, 700, 500, 200)
    out["era5_steering_u_850_200"] = out[[f"u_{level}" for level in levels]].mean(axis=1)
    out["era5_steering_v_850_200"] = out[[f"v_{level}" for level in levels]].mean(axis=1)
    out["era5_steering_magnitude_850_200"] = np.hypot(
        out["era5_steering_u_850_200"], out["era5_steering_v_850_200"]
    )
    # atan2(eastward, northward) gives a bearing compatible with STORM_DIR.
    out["era5_steering_direction_850_200"] = (
        np.degrees(np.arctan2(out["era5_steering_u_850_200"], out["era5_steering_v_850_200"])) + 360
    ) % 360
    out["era5_shear_200_850"] = out.get("shear_850_200")
    out["era5_midlevel_relative_humidity"] = out[["r_700", "r_500"]].mean(axis=1)

    # The RI cache is storm-centre only.  Preserve these grid-dependent fields
    # as missing unless an upgraded RI extraction cache provides them.
    for q in QUADRANTS:
        for component in ("u", "v"):
            out[f"era5_{component}500_{q}"] = out.get(f"{component}_500_{q}", np.nan)
    out["era5_z500"] = out.get("z_500", np.nan)
    out["era5_ridge_axis_lat"] = out.get("ridge_axis_lat", np.nan)
    return out


def attach_era5_features(
    track: pd.DataFrame,
    source_path: str | Path | None = None,
    source: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Attach causal ERA5 features and source provenance to a storm track.

    ``source`` is useful for tests; production training passes the existing RI
    rebuilt cache.  Missing source coverage remains NaN with explicit 1-valued
    missing indicators, rather than being imputed.
    """
    out = _empty_environment(track)
    if source is None:
        if source_path is None or not Path(source_path).exists():
            out.attrs["era5_provenance"] = {
                "status": "unavailable", "cache_path": str(source_path) if source_path else None,
                "manifest_path": str(ERA5_CACHE_PROVENANCE_PATH),
            }
            return out
        source = _load_ri_era5_cache(str(source_path)).copy()
    else:
        source = source.copy()
        for column in ("datetime_utc", "era5_datetime"):
            source[column] = pd.to_datetime(source[column], errors="coerce")

    required = {"storm_id", "era5_datetime", "u_850", "u_700", "u_500", "u_200",
                "v_850", "v_700", "v_500", "v_200", "r_700", "r_500"}
    missing = required.difference(source.columns)
    if missing:
        raise ValueError(f"RI ERA5 cache missing required columns: {sorted(missing)}")

    source = _source_environment(source).rename(columns={"storm_id": "era5_storm_id"})
    out["era5_storm_id"] = _storm_key(out)
    out["_row_order"] = np.arange(len(out))
    matched = []
    use_cols = ["era5_storm_id", "era5_datetime", *ERA5_SOURCE_VALUE_COLS]
    for storm_id, storm_rows in out.groupby("era5_storm_id", sort=False):
        left = storm_rows.sort_values("ISO_TIME")
        right = source.loc[source["era5_storm_id"] == storm_id, use_cols].sort_values("era5_datetime")
        if right.empty:
            matched.append(left)
            continue
        joined = pd.merge_asof(
            left, right, left_on="ISO_TIME", right_on="era5_datetime", direction="backward"
        )
        matched.append(joined)
    out = pd.concat(matched, ignore_index=True).sort_values("_row_order").reset_index(drop=True)

    # merge_asof adds suffixed cache values; overwrite the intentionally-empty
    # schema columns with its causal match and retain provenance timing.
    for column in ERA5_VALUE_COLS:
        cache_column = f"{column}_y" if f"{column}_y" in out else column
        if cache_column in out:
            out[column] = out[cache_column]
            if cache_column != column:
                out.drop(columns=cache_column, inplace=True)
        source_column = f"{column}_x"
        if source_column in out:
            out.drop(columns=source_column, inplace=True)
    out["era5_source_time"] = out["era5_datetime"]
    out["era5_source_age_h"] = (out["ISO_TIME"] - out["era5_source_time"]).dt.total_seconds() / 3600
    if (out["era5_source_age_h"].dropna() < 0).any():
        raise AssertionError("future ERA5 source row matched to a recurvature observation")

    out["era5_steering_heading_angle"] = (
        (out["era5_steering_direction_850_200"] - out["STORM_DIR"] + 180) % 360 - 180
    ).abs()
    out["era5_storm_to_ridge_distance_deg"] = out["lat"] - out["era5_ridge_axis_lat"]

    # Environmental tendencies use only the current and t-24h-or-earlier
    # matched source values within the same storm.
    for column in (
        "era5_steering_u_850_200", "era5_steering_v_850_200",
        "era5_steering_magnitude_850_200", "era5_shear_200_850",
        "era5_midlevel_relative_humidity",
    ):
        prior = out.groupby("SID", sort=False)[column].shift(8)
        prior_time = out.groupby("SID", sort=False)["ISO_TIME"].shift(8)
        contiguous = (out["ISO_TIME"] - prior_time).eq(pd.Timedelta(hours=24))
        out[f"{column}_tendency_24h"] = (out[column] - prior).where(contiguous)

    out[ERA5_MISSING_INDICATOR_COLS] = out[ERA5_VALUE_COLS].isna().astype(float).to_numpy()
    out.drop(columns=[c for c in ("era5_storm_id", "era5_datetime", "_row_order") if c in out], inplace=True)
    out.attrs["era5_provenance"] = {
        "status": "attached_from_ri_cache",
        "cache_path": str(source_path) if source_path else "in_memory_test_source",
        "manifest_path": str(ERA5_CACHE_PROVENANCE_PATH),
        "source_time_policy": "backward as-of: era5 source time <= prediction time",
        "spatial_method": "RI cached bilinear_storm_center where available",
        "matched_rows": int(out["era5_source_time"].notna().sum()),
    }
    return out
