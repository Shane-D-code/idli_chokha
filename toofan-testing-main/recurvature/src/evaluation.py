"""Leakage-safe evaluation helpers for the recurvature XGBoost pipeline."""

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

from .features import TURN_THRESHOLD, circ_diff


def temporal_storm_split(df: pd.DataFrame) -> tuple[set, set, set]:
    """Split valid-label storms into the fixed operational time periods."""
    valid = df.dropna(subset=["recurve_label"])
    storm_season = valid.groupby("SID")["SEASON"].agg(lambda s: s.iloc[0])
    if valid.groupby("SID")["SEASON"].nunique().gt(1).any():
        raise ValueError("Each SID must have exactly one season for temporal splitting.")

    return (
        set(storm_season[storm_season <= 2014].index),
        set(storm_season[(storm_season >= 2015) & (storm_season <= 2018)].index),
        set(storm_season[storm_season >= 2019].index),
    )


def evaluation_frame(df: pd.DataFrame, sids: set, climatology_probability: float) -> pd.DataFrame:
    """Build valid-label evaluation rows and fixed, observation-only baselines."""
    work = df.copy()
    prior_heading = work.groupby("SID")["STORM_DIR"].shift(1)
    prior_time = work.groupby("SID")["ISO_TIME"].shift(1)
    prior_turn = circ_diff(work["STORM_DIR"], prior_heading)
    contiguous = (work["ISO_TIME"] - prior_time).eq(pd.Timedelta(hours=3))

    # Persistence is an operationally observable continuation rule: if the
    # storm has already made a >=45-degree rightward turn over the preceding
    # contiguous 3h raw-heading interval, predict it will persist. This uses
    # only observations available at t; centered smoothing is never used.
    work["persistence_probability"] = ((prior_turn >= TURN_THRESHOLD) & contiguous).astype(float)
    work["climatology_probability"] = float(climatology_probability)
    work["latitude_rule_probability"] = (work["lat"] >= 15.0).astype(float)

    return work.loc[work["SID"].isin(sids)].dropna(subset=["recurve_label"]).copy()


def metric_summary(y_true, probability, reference_probability: float) -> dict:
    """Threshold-free discrimination and probability metrics for one forecast."""
    y = np.asarray(y_true, dtype=float)
    p = np.asarray(probability, dtype=float)
    reference_brier = brier_score_loss(y, np.full(y.shape, reference_probability))
    brier = brier_score_loss(y, p)
    one_class = np.unique(y).size < 2
    return {
        "pr_auc": np.nan if one_class else float(average_precision_score(y, p)),
        "roc_auc": np.nan if one_class else float(roc_auc_score(y, p)),
        "brier": float(brier),
        "brier_skill_score": np.nan if reference_brier == 0 else float(1 - brier / reference_brier),
    }


def evaluate_models(frame: pd.DataFrame, reference_probability: float) -> pd.DataFrame:
    """Evaluate XGBoost and the fixed baselines on the same valid-label rows."""
    model_columns = {
        "XGBoost": "xgboost_probability",
        "climatology": "climatology_probability",
        "persistence": "persistence_probability",
    }
    if "lat" in frame:
        model_columns["latitude_rule"] = "latitude_rule_probability"

    rows = []
    for name, column in model_columns.items():
        rows.append({"model": name, **metric_summary(frame["recurve_label"], frame[column], reference_probability)})
    return pd.DataFrame(rows).set_index("model")


def reliability_table(y_true, probability, n_bins: int = 10) -> pd.DataFrame:
    """Return binned reliability data; this is descriptive, not calibration."""
    y = np.asarray(y_true, dtype=float)
    p = np.asarray(probability, dtype=float)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bins = np.minimum(np.digitize(p, edges[1:-1], right=False), n_bins - 1)
    rows = []
    for bin_id in range(n_bins):
        mask = bins == bin_id
        rows.append(
            {
                "bin_lower": float(edges[bin_id]),
                "bin_upper": float(edges[bin_id + 1]),
                "count": int(mask.sum()),
                "mean_predicted_probability": float(p[mask].mean()) if mask.any() else np.nan,
                "observed_rate": float(y[mask].mean()) if mask.any() else np.nan,
            }
        )
    return pd.DataFrame(rows)


def storm_bootstrap_ci(
    frame: pd.DataFrame,
    probability_column: str,
    reference_probability: float,
    n_replicates: int = 1000,
    seed: int = 42,
) -> dict:
    """95% percentile confidence intervals from SID-cluster bootstrap samples."""
    storms = frame["SID"].drop_duplicates().to_numpy()
    rng = np.random.default_rng(seed)
    samples = {key: [] for key in ("pr_auc", "roc_auc", "brier", "brier_skill_score")}

    for _ in range(n_replicates):
        selected = rng.choice(storms, size=len(storms), replace=True)
        sampled = pd.concat([frame.loc[frame["SID"] == sid] for sid in selected], ignore_index=True)
        metrics = metric_summary(sampled["recurve_label"], sampled[probability_column], reference_probability)
        for key, value in metrics.items():
            if np.isfinite(value):
                samples[key].append(value)

    return {
        key: {
            "lower": float(np.quantile(values, 0.025)) if values else np.nan,
            "upper": float(np.quantile(values, 0.975)) if values else np.nan,
        }
        for key, values in samples.items()
    }
