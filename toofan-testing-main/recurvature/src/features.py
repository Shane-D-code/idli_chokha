"""Feature engineering and recurvature-label construction.

Direction and month are encoded as sin/cos so a heading of 359 degrees and
1 degree read as close together, not far apart. "Heading momentum"
features (how much the storm has already turned in the last 3h / 9h) are
included since a track already mid-turn is more likely to keep turning.
"""

import numpy as np
import pandas as pd

from .era5 import ERA5_FEATURE_COLS, attach_era5_features

FUTURE_STEPS = 8        # 8 * 3h = 24h ahead
TURN_THRESHOLD = 45.0   # degrees of heading change counted as "recurving"
MIN_SUSTAIN = 2         # consecutive future fixes required to confirm the turn
MIN_STORM_SPEED_KT = 3.0
HISTORY_STEPS = 8       # 24 hours of 3-hourly, causal track history

BASIN_CODES = {
    "NA": 0, "SA": 1, "NI": 2, "SI": 3, "SP": 4, "WP": 5, "EP": 6,
}

KINEMATIC_FEATURE_COLS = [
    "lat", "lon", "wind", "pres", "STORM_SPEED", "dir_sin", "dir_cos",
    "month_sin", "month_cos", "DIST2LAND",
]
TRACK_HISTORY_FEATURE_COLS = [
    "turn_rate_3h", "turn_rate_6h", "turn_rate_12h", "turn_rate_24h",
    "recent_turn_rate_mean", "recent_turn_rate_std", "recent_track_curvature",
    "recent_storm_speed_trend", "recent_wind_trend", "storm_age_h",
    "cumulative_track_distance_km", "latitude_rate_24h", "basin_code", "season",
    "latitude_x_month",
]
TRACK_FEATURE_COLS = KINEMATIC_FEATURE_COLS + TRACK_HISTORY_FEATURE_COLS
FEATURE_COLS = TRACK_FEATURE_COLS + ERA5_FEATURE_COLS


def circ_diff(a: pd.Series, b: pd.Series) -> pd.Series:
    """Smallest signed difference a-b in degrees, result in [-180, 180)."""
    return (a - b + 180) % 360 - 180


def circular_mean_deg(values: np.ndarray) -> float:
    """Return the circular mean of degree values, or NaN for missing input."""
    if np.isnan(values).any():
        return np.nan
    radians = np.deg2rad(values)
    mean = float(np.rad2deg(np.arctan2(np.sin(radians).mean(), np.cos(radians).mean())) % 360)
    return 0.0 if np.isclose(mean, 360.0) else mean


def _centred_circular_mean(series: pd.Series) -> pd.Series:
    """Three-fix centred circular mean; endpoints are undefined by design."""
    return series.rolling(window=3, center=True, min_periods=3).apply(
        circular_mean_deg, raw=True
    )


def _has_consecutive_turn(turns: np.ndarray, threshold: float, min_sustain: int) -> bool:
    """Whether a signed-turn sequence has a qualifying sustained right turn."""
    run_length = 0
    for turn in turns:
        run_length = run_length + 1 if turn >= threshold else 0
        if run_length >= min_sustain:
            return True
    return False


def _haversine_km(lat1, lon1, lat2, lon2) -> pd.Series:
    """Great-circle distance for paired latitude/longitude observations."""
    lat1, lon1, lat2, lon2 = map(np.deg2rad, (lat1, lon1, lat2, lon2))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return pd.Series(6371.0 * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a)))


def _causal_history_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add track-history features using observations at or before each row only."""
    group = df.groupby("SID", sort=False)
    timestamps = df["ISO_TIME"]

    def lagged(column: str, steps: int) -> tuple[pd.Series, pd.Series]:
        previous = group[column].shift(steps)
        previous_time = group["ISO_TIME"].shift(steps)
        contiguous = timestamps.sub(previous_time).eq(pd.Timedelta(hours=3 * steps))
        return previous, contiguous

    for hours, steps in ((3, 1), (6, 2), (12, 4), (24, 8)):
        prior_heading, contiguous = lagged("STORM_DIR", steps)
        df[f"turn_rate_{hours}h"] = (circ_diff(df["STORM_DIR"], prior_heading) / hours).where(contiguous)

    recent_turns = df.groupby("SID", sort=False)["turn_rate_3h"].rolling(
        HISTORY_STEPS, min_periods=HISTORY_STEPS
    )
    df["recent_turn_rate_mean"] = recent_turns.mean().reset_index(level=0, drop=True)
    df["recent_turn_rate_std"] = recent_turns.std(ddof=0).reset_index(level=0, drop=True)

    prior_lat, contiguous_3h = lagged("lat", 1)
    prior_lon, _ = lagged("lon", 1)
    segment_distance = _haversine_km(prior_lat, prior_lon, df["lat"], df["lon"]).where(contiguous_3h)
    df["recent_track_curvature"] = (
        (df["turn_rate_3h"] * 3).div(segment_distance.where(segment_distance > 0))
    )

    prior_speed, contiguous_24h = lagged("STORM_SPEED", HISTORY_STEPS)
    prior_wind, _ = lagged("wind", HISTORY_STEPS)
    prior_lat_24h, _ = lagged("lat", HISTORY_STEPS)
    df["recent_storm_speed_trend"] = ((df["STORM_SPEED"] - prior_speed) / 24).where(contiguous_24h)
    df["recent_wind_trend"] = ((df["wind"] - prior_wind) / 24).where(contiguous_24h)
    df["latitude_rate_24h"] = ((df["lat"] - prior_lat_24h) / 24).where(contiguous_24h)

    df["storm_age_h"] = (timestamps - group["ISO_TIME"].transform("first")).dt.total_seconds() / 3600
    df["segment_distance_km"] = segment_distance.fillna(0.0)
    df["cumulative_track_distance_km"] = df.groupby("SID", sort=False)["segment_distance_km"].cumsum()
    df.drop(columns="segment_distance_km", inplace=True)
    return df


def label_diagnostics(df: pd.DataFrame) -> pd.DataFrame:
    """Summarise the legacy and sustained-turn labels for training diagnostics."""
    def summary(label: pd.Series, signed_turn: pd.Series) -> dict:
        valid = label.notna()
        signed = signed_turn[valid].dropna()
        return {
            "row_count": int(len(label)),
            "positive_rate": float(label[valid].mean()) if valid.any() else np.nan,
            "invalid_rows": int((~valid).sum()),
            "right_turn_count": int((signed > 0).sum()),
            "left_turn_count": int((signed < 0).sum()),
            "max_turn_p00": float(signed.quantile(0.00)) if not signed.empty else np.nan,
            "max_turn_p25": float(signed.quantile(0.25)) if not signed.empty else np.nan,
            "max_turn_p50": float(signed.quantile(0.50)) if not signed.empty else np.nan,
            "max_turn_p75": float(signed.quantile(0.75)) if not signed.empty else np.nan,
            "max_turn_p100": float(signed.quantile(1.00)) if not signed.empty else np.nan,
        }

    return pd.DataFrame.from_dict(
        {
            "old": summary(df["old_recurve_label"], df["old_turn_signed"]),
            "new": summary(df["recurve_label"], df["max_turn_signed"]),
        },
        orient="index",
    )


def build_features(
    df: pd.DataFrame,
    future_steps: int = FUTURE_STEPS,
    turn_threshold: float = TURN_THRESHOLD,
    min_sustain: int = MIN_SUSTAIN,
    era5_source_path=None,
    era5_source: pd.DataFrame | None = None,
) -> pd.DataFrame:
    df = df.sort_values(["SID", "ISO_TIME"]).reset_index(drop=True).copy()

    # Forward fill is causal; leading missing values stay missing and are
    # explicitly excluded by make_tabular rather than inferred from the future.
    df["wind"] = df.groupby("SID")["wind"].ffill()
    df["pres"] = df.groupby("SID")["pres"].ffill()

    df["month"] = df["ISO_TIME"].dt.month
    if "SEASON" not in df:
        df["SEASON"] = df["ISO_TIME"].dt.year
    if "BASIN" not in df:
        df["BASIN"] = "UNK"
    df["dir_sin"] = np.sin(np.deg2rad(df["STORM_DIR"]))
    df["dir_cos"] = np.cos(np.deg2rad(df["STORM_DIR"]))
    df["month_sin"] = np.sin(2 * np.pi * df["month"] / 12)
    df["month_cos"] = np.cos(2 * np.pi * df["month"] / 12)
    df["basin_code"] = df["BASIN"].map(BASIN_CODES).fillna(-1.0)
    df["season"] = df["SEASON"].astype(float)
    df["latitude_x_month"] = df["lat"] * df["month"]

    df = _causal_history_features(df)
    df = attach_era5_features(df, source_path=era5_source_path, source=era5_source)

    # Retain the legacy target only for side-by-side diagnostics.  It is not
    # used by the dataset builder or model.
    df["future_dir"] = df.groupby("SID")["STORM_DIR"].shift(-future_steps)
    df["old_turn_signed"] = circ_diff(df["future_dir"], df["STORM_DIR"])
    df["heading_swing"] = df["old_turn_signed"].abs()
    df["old_recurve_label"] = (df["heading_swing"] >= turn_threshold).astype(float)
    df.loc[df["future_dir"].isna(), "old_recurve_label"] = np.nan

    # A centred three-point circular mean avoids false turns at the 0/360
    # boundary and leaves the first/last fix of each storm undefined.
    df["smoothed_storm_dir"] = df.groupby("SID", group_keys=False)["STORM_DIR"].apply(
        _centred_circular_mean
    )

    df["max_turn_signed"] = np.nan
    df["turn_direction"] = pd.Series(pd.NA, index=df.index, dtype="object")
    df["time_to_max_turn_h"] = np.nan
    df["label_valid"] = 0
    df["recurve_label"] = np.nan

    # Labels require a complete, contiguous 3-hour future window.  Because
    # smoothing is centred, the final inspected heading also requires its
    # following neighbour to form a true three-point mean.
    for _, storm in df.groupby("SID", sort=False):
        indices = storm.index.to_numpy()
        times = storm["ISO_TIME"].to_numpy()
        speeds = storm["STORM_SPEED"].to_numpy(dtype=float)
        headings = storm["smoothed_storm_dir"].to_numpy(dtype=float)

        for pos, idx in enumerate(indices):
            future_end = pos + future_steps
            smoothing_end = future_end + 1
            if pos == 0 or smoothing_end >= len(storm):
                continue
            required_times = times[pos - 1:smoothing_end + 1]
            if np.any(np.diff(required_times) != np.timedelta64(3, "h")):
                continue
            if np.any(speeds[pos:smoothing_end + 1] < MIN_STORM_SPEED_KT):
                continue
            current_heading = headings[pos]
            future_headings = headings[pos + 1:future_end + 1]
            if np.isnan(current_heading) or np.isnan(future_headings).any():
                continue

            turns = circ_diff(pd.Series(future_headings), current_heading).to_numpy()
            peak_offset = int(np.abs(turns).argmax())
            peak_turn = float(turns[peak_offset])
            df.at[idx, "max_turn_signed"] = peak_turn
            df.at[idx, "turn_direction"] = "right" if peak_turn > 0 else "left" if peak_turn < 0 else "none"
            df.at[idx, "time_to_max_turn_h"] = (peak_offset + 1) * 3
            df.at[idx, "label_valid"] = 1
            df.at[idx, "recurve_label"] = float(
                _has_consecutive_turn(turns, turn_threshold, min_sustain)
            )

    return df
