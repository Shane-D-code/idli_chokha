# Exact feature order/configuration used by the notebook.

TRACK_FEATURES = [
    "lat", "lon", "wind", "pressure",
    "translation_speed", "bearing_sin", "bearing_cos",
    "wind_delta_2h", "wind_delta_6h",
    "pressure_delta_2h", "pressure_delta_6h",
    "storm_age",
]

PHYSICS_FEATURES = [
    "u_steer", "v_steer", "steering_speed",
    "steering_direction_sin", "steering_direction_cos",
    "vws_u", "vws_v", "vws_magnitude",
    "vws_direction_sin", "vws_direction_cos",
    "rh_925", "rh_700", "sh_925", "sh_700",
    "sst", "ocean_heat_content",
    "vorticity_850", "vorticity_500",
    "deformation_850", "owzp_850", "owzp_500",
    "distance_to_coast",
]

HISTORY_LENGTH = 12
N_HORIZONS = 12
FORECAST_HOURS = list(range(2, 25, 2))

MODEL_KWARGS = {
    "track_features": len(TRACK_FEATURES),
    "physics_features": len(PHYSICS_FEATURES),
    "hidden_dim": 128,
    "n_layers": 4,
    "n_heads": 8,
    "n_horizons": N_HORIZONS,
    "dropout": 0.1,
}
