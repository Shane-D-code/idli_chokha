"""Focused tests for the sustained, signed recurvature target."""

import numpy as np
import pandas as pd

from recurvature.src.features import FEATURE_COLS, build_features, circ_diff, circular_mean_deg


def _track(headings, speeds=None):
    n = len(headings)
    return pd.DataFrame(
        {
            "SID": ["storm"] * n,
            "ISO_TIME": pd.date_range("2000-01-01", periods=n, freq="3h"),
            "STORM_DIR": headings,
            "STORM_SPEED": speeds if speeds is not None else [10.0] * n,
            "wind": [30.0] * n,
            "pres": [990.0] * n,
            "lat": [10.0] * n,
            "lon": [80.0] * n,
            "DIST2LAND": [100.0] * n,
        }
    )


def test_sustained_60_degree_right_turn_is_positive():
    result = build_features(_track([0, 0, 0] + [60] * 8))

    assert result.loc[1, "label_valid"] == 1
    assert result.loc[1, "recurve_label"] == 1.0
    assert result.loc[1, "turn_direction"] == "right"
    assert result.loc[1, "max_turn_signed"] == 60.0


def test_sustained_60_degree_left_turn_is_negative():
    result = build_features(_track([0, 0, 0] + [300] * 8))

    assert result.loc[1, "label_valid"] == 1
    assert result.loc[1, "recurve_label"] == 0.0
    assert result.loc[1, "turn_direction"] == "left"
    assert result.loc[1, "max_turn_signed"] == -60.0


def test_one_step_60_degree_spike_is_negative():
    result = build_features(_track([0, 0, 0, 60] + [0] * 7))

    assert result.loc[1, "label_valid"] == 1
    assert result.loc[1, "recurve_label"] == 0.0


def test_near_stationary_storm_produces_invalid_not_negative_label():
    result = build_features(_track([0, 0, 0] + [60] * 8, speeds=[10, 2] + [10] * 9))

    assert result.loc[1, "label_valid"] == 0
    assert np.isnan(result.loc[1, "recurve_label"])


def test_circular_heading_handles_359_to_1_as_two_degrees():
    assert circ_diff(pd.Series([1.0]), 359.0).iloc[0] == 2.0
    assert circular_mean_deg(np.array([359.0, 0.0, 1.0])) == 0.0


def test_history_features_leave_short_history_missing():
    result = build_features(_track(list(range(0, 72, 6))))

    assert np.isnan(result.loc[7, "turn_rate_24h"])
    assert np.isnan(result.loc[7, "recent_turn_rate_mean"])
    assert result.loc[8, "turn_rate_24h"] == 2.0
    assert not np.isnan(result.loc[8, "recent_turn_rate_mean"])


def test_future_rows_cannot_change_features_at_time_t():
    n = 15
    track = _track([i * 4 for i in range(n)])
    track["lat"] = np.linspace(10.0, 17.0, n)
    track["lon"] = np.linspace(80.0, 87.0, n)
    track["wind"] = np.linspace(30.0, 58.0, n)
    track["STORM_SPEED"] = np.linspace(6.0, 13.0, n)
    baseline = build_features(track)

    changed_future = track.copy()
    changed_future.loc[11:, ["STORM_DIR", "lat", "lon", "wind", "STORM_SPEED"]] = [250, 30, 40, 150, 30]
    perturbed = build_features(changed_future)

    np.testing.assert_allclose(
        baseline.loc[10, FEATURE_COLS].to_numpy(dtype=float),
        perturbed.loc[10, FEATURE_COLS].to_numpy(dtype=float),
        equal_nan=True,
    )
