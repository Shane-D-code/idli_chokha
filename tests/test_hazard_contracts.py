"""Hazard-branch contract tests (Phase 10 hazard audit).

Pins the honest contracts discovered during the Phase 10 audit:

RAINFALL
  - same-time heavy/light binary classifier (FANI 2019) — NOT a forecast
  - adapter returns status/carrying explanation without fabricating grids
  - artifact is a bare RandomForestClassifier (25 features, classes [0,1])
  - metadata metrics reproduce from the stored results CSV
WIND
  - schema now carries status/explanation (previously dropped by pydantic)
  - factory load path never hard-aborts the interpreter: TensorFlow import is
    probed in a subprocess and an explicit UNAVAILABLE status is returned, so
    the adapter must not crash and must never fabricate wind fields
RAINFALL
  - test results are the FINAL FOUR half-hourly snapshots of the 12 snapshots
    in the source data (temporal holdout, same day, autocorrelated)
FLOOD
  - adapter tolerates a missing rainfall prediction (previously crashed)
  - labels are per-cell constant across time (static spatial extent)
  - demo output is a static per-cell surface, not a temporal forecast
LANDSLIDE
  - adapter returns STATIC_SUSCEPTIBILITY / no dynamic ML model
"""

import json
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest

from src.core.schema import (
    RainfallPrediction,
    WindFieldGrid,
    WindFieldPrediction,
)
from src.models.flood.adapter import create_flood_adapter
from src.models.landslide.adapter import create_landslide_adapter
from src.models.rainfall.adapter import create_rainfall_adapter
from src.models.wind.adapter import create_wind_adapter

REPO_ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------
# RAINFALL
# --------------------------------------------------------------------------


def test_rainfall_adapter_is_same_time_not_forecast():
    pred = create_rainfall_adapter().predict(None)
    assert pred.status == "AVAILABLE_BASELINE"
    assert "same-time" in pred.explanation.lower()
    assert "not a future rainfall forecasting model" in pred.explanation.lower()


def test_rainfall_adapter_never_fabricates_outputs():
    pred = create_rainfall_adapter().predict(None)
    assert pred.rainfall_3h is None
    assert pred.rainfall_6h is None
    assert pred.rainfall_12h is None
    assert pred.rainfall_24h is None
    assert pred.confidence == 0.0


def test_rainfall_prediction_schema_carries_status():
    pred = RainfallPrediction(
        model_version="1.0",
        confidence=0.0,
        status="AVAILABLE_BASELINE",
        explanation="same-time classifier",
    )
    assert pred.status == "AVAILABLE_BASELINE"
    assert pred.explanation == "same-time classifier"


def test_rainfall_artifact_is_bare_random_forest():
    clf = joblib.load(REPO_ROOT / "rain/model/rainfall_classifier_12.pkl")
    assert type(clf).__name__ == "RandomForestClassifier"
    assert clf.n_features_in_ == 25
    assert list(clf.classes_) == [0, 1]


def test_rainfall_heavy_threshold_matches_metadata():
    meta = json.load(open(REPO_ROOT / "rain/metadata/rainfall_model_12_metadata.json"))
    assert meta["heavy_rain_threshold_mm_hr"] == 10.0
    assert meta["testing_samples"] == 112000


def test_rainfall_metrics_reproduce_from_results():
    res = pd.read_csv(REPO_ROOT / "rain/results/model12_results.csv")
    meta = json.load(open(REPO_ROOT / "rain/metadata/rainfall_model_12_metadata.json"))
    mae = float(np.mean(np.abs(res["rainfall_mm_hr"] - res["predicted_rainfall_mm_hr"])))
    assert mae == pytest.approx(meta["metrics"]["mae"], abs=1e-3)
    y = (res["rainfall_mm_hr"] >= meta["heavy_rain_threshold_mm_hr"]).astype(int)
    yhat = (res["heavy_probability"] >= 0.5).astype(int)
    tp = ((y == 1) & (yhat == 1)).sum()
    fp = ((y == 0) & (yhat == 1)).sum()
    fn = ((y == 1) & (yhat == 0)).sum()
    prec = tp / (tp + fp)
    rec = tp / (tp + fn)
    f1 = 2 * prec * rec / (prec + rec)
    assert f1 == pytest.approx(meta["metrics"]["classification_f1"], abs=5e-3)


def test_rainfall_results_are_last_four_half_hourly_snapshots():
    src = pd.read_csv(REPO_ROOT / "rain/data/FANI_2019_IMERG_20190430_0000_0600.csv")
    res = pd.read_csv(REPO_ROOT / "rain/results/model12_results.csv")
    src_ts = sorted(set(src["timestamp_utc"]))
    half_hourly = [t for t in src_ts if t.endswith(":00:00") or t.endswith(":30:00")]
    assert len(half_hourly) == 12
    assert sorted(set(res["timestamp_utc"])) == half_hourly[-4:]
    assert len(res) == 112000


# --------------------------------------------------------------------------
# WIND
# --------------------------------------------------------------------------


def test_wind_prediction_schema_carries_status_and_explanation():
    grid = WindFieldGrid(
        forecast_time=datetime.utcnow(),
        u10=np.zeros((2, 2)),
        v10=np.zeros((2, 2)),
        speed=np.zeros((2, 2)),
        direction=np.zeros((2, 2)),
        lats=np.array([1.0, 2.0]),
        lons=np.array([3.0, 4.0]),
    )
    pred = WindFieldPrediction(
        wind_fields=[grid],
        model_version="1.0",
        confidence=0.0,
        status="BASELINE",
        explanation="Yaas 2021 case study; no inference pipeline",
    )
    assert pred.status == "BASELINE"
    assert "case study" in pred.explanation


def test_wind_adapter_no_crash_no_fabrication():
    adapter = create_wind_adapter()
    pred = adapter.predict(None)
    assert pred.wind_fields == []  # never fabricates wind field grids
    assert pred.confidence == 0.0
    assert pred.status in {"UNAVAILABLE", "BASELINE"}
    if pred.status == "UNAVAILABLE":
        assert "cannot be loaded" in pred.explanation.lower()
    else:
        assert "case study" in pred.explanation.lower()


# --------------------------------------------------------------------------
# FLOOD
# --------------------------------------------------------------------------


def test_flood_adapter_tolerates_missing_rainfall():
    for args in [(None,), (None, None, None)]:
        pred = create_flood_adapter().predict(*args)
        assert pred.status == "DATA_UNAVAILABLE"
        assert pred.probability_grid.size == 0  # never fabricates a surface
        assert pred.confidence == 0.0


def test_flood_artifact_contract():
    model = joblib.load(REPO_ROOT / "flood/model/flood_xgboost_spatial_holdout.pkl")
    assert model.n_features_in_ == 28
    assert list(model.classes_) == [0, 1]


def test_flood_features_have_no_future_rainfall():
    model = joblib.load(REPO_ROOT / "flood/model/flood_xgboost_spatial_holdout.pkl")
    feats = [str(f) for f in model.feature_names_in_]
    leaked_future = [f for f in feats if "lead" in f or "future" in f]
    assert leaked_future == []
    assert any(f.startswith("rainfall_lag") for f in feats)
    assert any(f.startswith("distance_to") for f in feats)  # static hydrology


def test_flood_labels_static_per_cell():
    lab = pd.read_csv(REPO_ROOT / "flood/data/imerg/fani_spatial_flood_labels.csv")
    n = lab.groupby(["latitude", "longitude"])["flood_label"].nunique()
    assert (n == 1).all(), "flood labels must be constant per cell (static post-event extent)"
    assert len(lab) == 36278
    assert lab["flood_label"].sum() == 6790  # 70 cells x 97 timestamps (L2 scheme)


def test_flood_demo_output_is_static_surface():
    demo = pd.read_csv(REPO_ROOT / "flood/results/fani_flood_demo_output.csv")
    stats = demo.groupby(["latitude", "longitude"])["flood_probability"].agg(
        ["min", "max"]
    )
    max_dev = float((stats["max"] - stats["min"]).max())
    assert max_dev < 0.005, (
        "demo flood_probability must be ~constant per cell (static spatial map), "
        f"max per-cell deviation {max_dev}"
    )
    assert demo["timestamp_utc"].nunique() > 1  # but still produced across timestamps


# --------------------------------------------------------------------------
# LANDSLIDE
# --------------------------------------------------------------------------


def test_landslide_adapter_returns_static_susceptibility():
    pred = create_landslide_adapter().predict(None)
    assert pred.status == "STATIC_SUSCEPTIBILITY"
    assert "No dynamic landslide ML model" in pred.reason
    assert pred.probability_grid.susceptibility_grid.size == 0
    assert pred.confidence == 0.0
