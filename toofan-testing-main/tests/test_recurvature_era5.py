"""Causality and schema tests for recurvature's RI-cache ERA5 features."""

import numpy as np
import pandas as pd

from recurvature.src.era5 import ERA5_FEATURE_COLS, ERA5_MISSING_INDICATOR_COLS, ERA5_VALUE_COLS
from recurvature.src.features import FEATURE_COLS, build_features


def _track(n=15):
    return pd.DataFrame(
        {
            "SID": ["storm"] * n,
            "SEASON": [2000] * n,
            "NUMBER": [1] * n,
            "BASIN": ["NI"] * n,
            "ISO_TIME": pd.date_range("2000-01-01", periods=n, freq="3h"),
            "STORM_DIR": np.arange(n) * 4.0,
            "STORM_SPEED": np.linspace(6.0, 12.0, n),
            "wind": np.linspace(30.0, 50.0, n),
            "pres": [990.0] * n,
            "lat": np.linspace(10.0, 16.0, n),
            "lon": np.linspace(80.0, 86.0, n),
            "DIST2LAND": [100.0] * n,
        }
    )


def _era5_source(n=15):
    time = pd.date_range("2000-01-01", periods=n, freq="3h")
    data = {"storm_id": ["2000-001"] * n, "datetime_utc": time, "era5_datetime": time}
    for level in (850, 700, 500, 200):
        data[f"u_{level}"] = np.arange(n, dtype=float) + level / 1000
        data[f"v_{level}"] = np.arange(n, dtype=float) + level / 2000
    data["r_700"] = np.linspace(60.0, 70.0, n)
    data["r_500"] = np.linspace(40.0, 50.0, n)
    data["shear_850_200"] = np.linspace(8.0, 12.0, n)
    return pd.DataFrame(data)


def test_era5_schema_is_centralized_and_has_missing_indicators():
    assert len(FEATURE_COLS) == 25 + len(ERA5_FEATURE_COLS)
    assert len(FEATURE_COLS) == len(set(FEATURE_COLS))
    assert all(column in FEATURE_COLS for column in ERA5_FEATURE_COLS)
    assert len(ERA5_MISSING_INDICATOR_COLS) == len(ERA5_VALUE_COLS)


def test_era5_matching_is_backward_causal_and_marks_unavailable_grid_fields():
    result = build_features(_track(), era5_source=_era5_source())

    assert result.loc[10, "era5_source_time"] <= result.loc[10, "ISO_TIME"]
    assert result.loc[10, "era5_steering_u_850_200_missing"] == 0.0
    assert result.loc[10, "era5_u500_ne_missing"] == 1.0
    assert np.isnan(result.loc[10, "era5_u500_ne"])


def test_future_era5_rows_cannot_change_features_at_time_t():
    track = _track()
    source = _era5_source()
    baseline = build_features(track, era5_source=source)

    changed_future = source.copy()
    changed_future.loc[11:, ["u_850", "u_700", "u_500", "u_200", "r_700", "r_500"]] = 999.0
    perturbed = build_features(track, era5_source=changed_future)

    np.testing.assert_allclose(
        baseline.loc[10, ERA5_FEATURE_COLS].to_numpy(dtype=float),
        perturbed.loc[10, ERA5_FEATURE_COLS].to_numpy(dtype=float),
        equal_nan=True,
    )
