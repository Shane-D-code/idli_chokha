"""Tests for leakage-safe recurvature evaluation utilities."""

import numpy as np
import pandas as pd

from recurvature.src.evaluation import (
    evaluate_models,
    evaluation_frame,
    reliability_table,
    storm_bootstrap_ci,
    temporal_storm_split,
)


def _evaluation_data():
    return pd.DataFrame(
        {
            "SID": ["old", "old", "validation", "validation", "recent", "recent", "recent"],
            "SEASON": [2014, 2014, 2017, 2017, 2020, 2020, 2020],
            "recurve_label": [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, np.nan],
            "ISO_TIME": pd.date_range("2020-01-01", periods=7, freq="3h"),
            "STORM_DIR": [0.0, 50.0, 10.0, 60.0, 0.0, 50.0, 50.0],
            "smoothed_storm_dir": [0.0, 50.0, 10.0, 60.0, 0.0, 50.0, 50.0],
            "lat": [10.0, 16.0, 10.0, 16.0, 10.0, 16.0, 16.0],
        }
    )


def test_temporal_split_is_by_sid_and_excludes_invalid_only_storms():
    train, validation, test = temporal_storm_split(_evaluation_data())

    assert train == {"old"}
    assert validation == {"validation"}
    assert test == {"recent"}


def test_evaluation_frame_excludes_invalid_labels_and_adds_fixed_baselines():
    frame = evaluation_frame(_evaluation_data(), {"recent"}, climatology_probability=0.25)

    assert len(frame) == 2
    assert frame["recurve_label"].notna().all()
    assert frame["climatology_probability"].tolist() == [0.25, 0.25]
    assert frame["persistence_probability"].tolist() == [0.0, 1.0]
    assert frame["latitude_rule_probability"].tolist() == [0.0, 1.0]


def test_future_observations_cannot_change_causal_persistence_at_t():
    data = _evaluation_data()
    baseline = evaluation_frame(data, {"recent"}, climatology_probability=0.25)

    changed_future = data.copy()
    changed_future.loc[6, "STORM_DIR"] = 250.0
    perturbed = evaluation_frame(changed_future, {"recent"}, climatology_probability=0.25)

    assert baseline.loc[baseline["ISO_TIME"] == data.loc[5, "ISO_TIME"], "persistence_probability"].iloc[0] == 1.0
    assert perturbed.loc[perturbed["ISO_TIME"] == data.loc[5, "ISO_TIME"], "persistence_probability"].iloc[0] == 1.0


def test_metrics_reliability_and_sid_bootstrap_are_reported():
    frame = pd.DataFrame(
        {
            "SID": ["a", "a", "b", "b", "c", "c"],
            "recurve_label": [0.0, 1.0, 0.0, 1.0, 0.0, 1.0],
            "xgboost_probability": [0.1, 0.9, 0.2, 0.8, 0.3, 0.7],
            "climatology_probability": [0.5] * 6,
            "persistence_probability": [0.0, 1.0, 0.0, 1.0, 0.0, 1.0],
            "latitude_rule_probability": [0.0, 1.0, 0.0, 1.0, 0.0, 1.0],
            "lat": [10.0, 16.0, 10.0, 16.0, 10.0, 16.0],
        }
    )

    metrics = evaluate_models(frame, reference_probability=0.5)
    ci = storm_bootstrap_ci(frame, "xgboost_probability", 0.5, n_replicates=50)
    reliability = reliability_table(frame["recurve_label"], frame["xgboost_probability"])

    assert {"XGBoost", "climatology", "persistence", "latitude_rule"} == set(metrics.index)
    assert metrics.loc["XGBoost", "pr_auc"] == 1.0
    assert metrics.loc["XGBoost", "roc_auc"] == 1.0
    assert metrics.loc["XGBoost", "brier_skill_score"] > 0
    assert ci["roc_auc"]["lower"] <= ci["roc_auc"]["upper"]
    assert reliability["count"].sum() == len(frame)
