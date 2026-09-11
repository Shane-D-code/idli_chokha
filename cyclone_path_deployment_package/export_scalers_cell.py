# RUN THIS CELL IN THE ORIGINAL COLAB NOTEBOOK
# after the final scalers have been fitted (track_scaler / physics_scaler)
# and before closing/downloading the notebook environment.

import joblib
import os

if "track_scaler" not in globals() or "physics_scaler" not in globals():
    raise RuntimeError("track_scaler and physics_scaler are not available.")

joblib.dump(
    {
        "track_scaler": track_scaler,
        "physics_scaler": physics_scaler,
    },
    "scalers.pkl",
)

print("[SAVED] scalers.pkl")
print("Download scalers.pkl and place it beside the model checkpoint.")
