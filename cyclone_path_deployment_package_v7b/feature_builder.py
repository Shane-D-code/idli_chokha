"""
Preprocessing reproduced from the notebook's real-data pipeline.

Input: 12 consecutive 2-hour observations:
    timestamp, latitude, longitude, wind, pressure

Output:
    track features [12,12]
    physics features [12,22]

The "physics" columns here are the same deterministic track-derived
proxies used by the notebook. They are not live atmospheric observations.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, Tuple
import numpy as np
import pandas as pd

from config import TRACK_FEATURES, PHYSICS_FEATURES


def haversine_distance(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    lat1_rad = np.radians(lat1)
    lat2_rad = np.radians(lat2)
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = (
        np.sin(dlat / 2.0) ** 2
        + np.cos(lat1_rad)
        * np.cos(lat2_rad)
        * np.sin(dlon / 2.0) ** 2
    )
    a = np.clip(a, 0.0, 1.0)
    return float(R * 2.0 * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a)))


def calculate_bearing(lat1, lon1, lat2, lon2) -> float:
    lat1_rad = np.radians(lat1)
    lat2_rad = np.radians(lat2)
    dlon = np.radians(lon2 - lon1)

    y = np.sin(dlon) * np.cos(lat2_rad)
    x = (
        np.cos(lat1_rad) * np.sin(lat2_rad)
        - np.sin(lat1_rad) * np.cos(lat2_rad) * np.cos(dlon)
    )
    bearing = np.degrees(np.arctan2(y, x))
    return float((bearing + 360.0) % 360.0)


def calculate_translation_speed(lat1, lon1, lat2, lon2, hours) -> float:
    distance = haversine_distance(lat1, lon1, lat2, lon2)
    return float(distance / hours) if hours > 0 else 0.0


def compute_track_physical_proxies(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # Steering flow estimated from translation speed and bearing.
    speed_ms = df["translation_speed"] * (1000.0 / 3600.0)
    bearing_rad = np.radians(df["bearing"])

    df["u_steer"] = speed_ms * np.sin(bearing_rad)
    df["v_steer"] = speed_ms * np.cos(bearing_rad)
    df["steering_speed"] = df["translation_speed"]
    df["steering_direction_sin"] = np.sin(bearing_rad)
    df["steering_direction_cos"] = np.cos(bearing_rad)

    # Notebook's latitude-dependent deterministic proxies.
    df["vws_magnitude"] = 8.0 + 0.3 * np.abs(df["lat"])
    vws_angle = np.radians(270.0 - df["lat"] * 2.0)
    df["vws_u"] = df["vws_magnitude"] * np.cos(vws_angle)
    df["vws_v"] = df["vws_magnitude"] * np.sin(vws_angle)
    df["vws_direction_sin"] = np.sin(vws_angle)
    df["vws_direction_cos"] = np.cos(vws_angle)

    df["rh_925"] = np.clip(
        80.0 - 0.5 * np.abs(df["lat"] - 20.0), 50.0, 95.0
    )
    df["rh_700"] = np.clip(
        68.0 - 0.4 * np.abs(df["lat"] - 20.0), 40.0, 90.0
    )
    df["sh_925"] = np.clip(
        16.0 - 0.2 * np.abs(df["lat"]), 5.0, 22.0
    )
    df["sh_700"] = np.clip(
        9.0 - 0.15 * np.abs(df["lat"]), 2.0, 15.0
    )

    df["sst"] = np.clip(
        30.0 - 0.35 * np.abs(df["lat"] - 15.0), 20.0, 31.5
    )
    df["ocean_heat_content"] = np.clip(
        (df["sst"] - 26.0) * 15.0, 0.0, 120.0
    )

    pressure_deficit = np.maximum(
        0.0, 1013.0 - df["pressure"]
    )
    df["vorticity_850"] = (
        2e-5 + pressure_deficit * 3e-6
    )
    df["vorticity_500"] = (
        1e-5 + pressure_deficit * 1.5e-6
    )
    df["deformation_850"] = (
        0.3 * df["vorticity_850"]
    )
    df["owzp_850"] = (
        df["vorticity_850"] ** 2
        - df["deformation_850"] ** 2
    )
    df["owzp_500"] = (
        df["vorticity_500"] ** 2
        - (0.3 * df["vorticity_500"]) ** 2
    )

    df["distance_to_coast"] = np.clip(
        np.abs(df["lon"] + 75.0) * 111.32,
        50.0,
        1500.0
    )

    return df


def build_real_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df.sort_values("timestamp").reset_index(drop=True)

    # Strictly use one storm sequence: the 12 observations supplied.
    speeds = np.zeros(len(df), dtype=float)
    bearings = np.zeros(len(df), dtype=float)

    for k in range(1, len(df)):
        dt = (
            df.loc[k, "timestamp"]
            - df.loc[k - 1, "timestamp"]
        ).total_seconds() / 3600.0
        if dt <= 0:
            raise ValueError("Timestamps must be strictly increasing.")

        speeds[k] = calculate_translation_speed(
            df.loc[k - 1, "latitude"],
            df.loc[k - 1, "longitude"],
            df.loc[k, "latitude"],
            df.loc[k, "longitude"],
            dt,
        )
        bearings[k] = calculate_bearing(
            df.loc[k - 1, "latitude"],
            df.loc[k - 1, "longitude"],
            df.loc[k, "latitude"],
            df.loc[k, "longitude"],
        )

    df["lat"] = df["latitude"].astype(float)
    df["lon"] = df["longitude"].astype(float)
    df["wind"] = df["wind"].astype(float)
    df["pressure"] = df["pressure"].astype(float)
    df["translation_speed"] = speeds
    df["bearing"] = bearings
    df["bearing_sin"] = np.sin(np.radians(bearings))
    df["bearing_cos"] = np.cos(np.radians(bearings))

    # Same pandas diff behavior as the notebook.
    df["wind_delta_2h"] = df["wind"].diff(1).fillna(0.0)
    df["wind_delta_6h"] = df["wind"].diff(3).fillna(0.0)
    df["pressure_delta_2h"] = df["pressure"].diff(1).fillna(0.0)
    df["pressure_delta_6h"] = df["pressure"].diff(3).fillna(0.0)

    df["storm_age"] = (
        df["timestamp"] - df["timestamp"].iloc[0]
    ).dt.total_seconds() / 3600.0

    df = compute_track_physical_proxies(df)

    return df


def validate_input_observations(observations: Iterable[Dict[str, Any]]) -> pd.DataFrame:
    records = list(observations)
    if len(records) != 12:
        raise ValueError(
            f"Exactly 12 observations are required; received {len(records)}."
        )

    required = {"timestamp", "latitude", "longitude", "wind", "pressure"}
    for i, row in enumerate(records):
        missing = required - set(row.keys())
        if missing:
            raise ValueError(
                f"Observation {i} is missing: {sorted(missing)}"
            )

    df = pd.DataFrame(records)

    df["timestamp"] = pd.to_datetime(
        df["timestamp"], utc=True, errors="raise"
    )
    for col in ["latitude", "longitude", "wind", "pressure"]:
        df[col] = pd.to_numeric(df[col], errors="raise")

    if not np.isfinite(
        df[["latitude", "longitude", "wind", "pressure"]].to_numpy()
    ).all():
        raise ValueError("Inputs contain NaN or infinite values.")

    if not df["latitude"].between(-90.0, 90.0).all():
        raise ValueError("Latitude must be in [-90, 90].")

    if not df["longitude"].between(-180.0, 180.0).all():
        raise ValueError("Longitude must be in [-180, 180].")

    df = df.sort_values("timestamp").reset_index(drop=True)

    delta_h = (
        df["timestamp"].diff().dt.total_seconds() / 3600.0
    ).iloc[1:].to_numpy()

    if not np.allclose(delta_h, 2.0, atol=1e-6):
        raise ValueError(
            "The 12 observations must be consecutive and exactly 2 hours apart."
        )

    return df


def build_model_inputs(
    observations: Iterable[Dict[str, Any]],
    track_scaler,
    physics_scaler,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    df = validate_input_observations(observations)
    feat = build_real_features(df)

    track = track_scaler.transform(
        feat[TRACK_FEATURES]
    ).astype(np.float32)

    physics = physics_scaler.transform(
        feat[PHYSICS_FEATURES]
    ).astype(np.float32)

    t0_latlon = feat[
        ["lat", "lon"]
    ].iloc[-1].to_numpy(dtype=np.float32)

    return track, physics, t0_latlon


def displacement_to_latlon(
    lat0: float,
    lon0: float,
    east_km: float,
    north_km: float,
) -> Tuple[float, float]:
    lat_new = lat0 + north_km / 111.32
    lon_new = lon0 + east_km / (
        111.32 * np.cos(np.radians(lat0))
    )
    return float(lat_new), float(lon_new)
