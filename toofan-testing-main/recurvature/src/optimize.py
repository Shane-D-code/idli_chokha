"""Validation-only XGBoost optimization for recurvature feature ablations.

The final >=2019 storms are never read during candidate selection.  Each
ablation selects one configuration on 2015-2018 validation PR-AUC, then is
refit once on train+validation and evaluated once on the final temporal test.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score
from sklearn.preprocessing import StandardScaler

from .era5 import DEFAULT_ERA5_CACHE_PATH
from .evaluation import metric_summary, reliability_table, storm_bootstrap_ci, temporal_storm_split
from .features import (
    ERA5_FEATURE_COLS,
    FEATURE_COLS,
    KINEMATIC_FEATURE_COLS,
    TRACK_FEATURE_COLS,
    build_features,
)
from .prep import load_clean

SEED = 42
EARLY_STOPPING_ROUNDS = 40

# Bounded, deliberately small coverage of every requested parameter.  Each
# configuration is evaluated unweighted and with train-prevalence weighting.
PARAMETER_CONFIGS = [
    {"max_depth": 3, "learning_rate": 0.03, "n_estimators": 800, "min_child_weight": 1, "subsample": 0.70, "colsample_bytree": 0.65, "gamma": 0.0, "reg_alpha": 0.0, "reg_lambda": 1.0},
    {"max_depth": 3, "learning_rate": 0.05, "n_estimators": 600, "min_child_weight": 3, "subsample": 0.85, "colsample_bytree": 0.80, "gamma": 0.0, "reg_alpha": 0.05, "reg_lambda": 3.0},
    {"max_depth": 3, "learning_rate": 0.08, "n_estimators": 400, "min_child_weight": 5, "subsample": 1.00, "colsample_bytree": 1.00, "gamma": 0.2, "reg_alpha": 0.20, "reg_lambda": 6.0},
    {"max_depth": 4, "learning_rate": 0.03, "n_estimators": 800, "min_child_weight": 3, "subsample": 0.85, "colsample_bytree": 0.65, "gamma": 0.2, "reg_alpha": 0.0, "reg_lambda": 3.0},
    {"max_depth": 4, "learning_rate": 0.05, "n_estimators": 600, "min_child_weight": 5, "subsample": 1.00, "colsample_bytree": 0.80, "gamma": 0.5, "reg_alpha": 0.05, "reg_lambda": 6.0},
    {"max_depth": 4, "learning_rate": 0.08, "n_estimators": 400, "min_child_weight": 1, "subsample": 0.70, "colsample_bytree": 1.00, "gamma": 0.0, "reg_alpha": 0.20, "reg_lambda": 1.0},
    {"max_depth": 5, "learning_rate": 0.03, "n_estimators": 800, "min_child_weight": 5, "subsample": 1.00, "colsample_bytree": 0.80, "gamma": 0.5, "reg_alpha": 0.20, "reg_lambda": 3.0},
    {"max_depth": 5, "learning_rate": 0.05, "n_estimators": 600, "min_child_weight": 1, "subsample": 0.70, "colsample_bytree": 1.00, "gamma": 0.2, "reg_alpha": 0.05, "reg_lambda": 6.0},
    {"max_depth": 5, "learning_rate": 0.08, "n_estimators": 400, "min_child_weight": 3, "subsample": 0.85, "colsample_bytree": 0.65, "gamma": 0.0, "reg_alpha": 0.0, "reg_lambda": 1.0},
    {"max_depth": 2, "learning_rate": 0.05, "n_estimators": 600, "min_child_weight": 1, "subsample": 1.00, "colsample_bytree": 0.65, "gamma": 0.5, "reg_alpha": 0.20, "reg_lambda": 6.0},
    {"max_depth": 6, "learning_rate": 0.03, "n_estimators": 800, "min_child_weight": 5, "subsample": 0.70, "colsample_bytree": 1.00, "gamma": 0.0, "reg_alpha": 0.05, "reg_lambda": 1.0},
    {"max_depth": 6, "learning_rate": 0.08, "n_estimators": 400, "min_child_weight": 3, "subsample": 0.85, "colsample_bytree": 0.80, "gamma": 0.5, "reg_alpha": 0.0, "reg_lambda": 3.0},
]

ABLATIONS = {
    "A_kinematic": KINEMATIC_FEATURE_COLS,
    "B_kinematic_track_history": TRACK_FEATURE_COLS,
    "C_kinematic_track_history_era5": FEATURE_COLS,
}


def _xgboost():
    """Delay the optional native import so --help and static validation work."""
    try:
        import xgboost as xgb
    except Exception as exc:  # pragma: no cover - host dependent native library
        raise RuntimeError(
            "XGBoost is unavailable. Install a working XGBoost/OpenMP runtime before running this experiment."
        ) from exc
    return xgb


def _rows(df: pd.DataFrame, sids: set) -> pd.DataFrame:
    """Use the existing valid-label eligibility: no label or track-history imputation."""
    return df.loc[df["SID"].isin(sids)].dropna(subset=["recurve_label", *TRACK_FEATURE_COLS]).copy()


def _fit(xgb, X_train, y_train, X_validation, y_validation, params: dict, scale_pos_weight: float):
    model = xgb.XGBClassifier(
        objective="binary:logistic", eval_metric="aucpr", random_state=SEED,
        early_stopping_rounds=EARLY_STOPPING_ROUNDS, n_jobs=1,
        scale_pos_weight=scale_pos_weight, **params,
    )
    model.fit(X_train, y_train, eval_set=[(X_validation, y_validation)], verbose=False)
    return model


def _predict(model, X):
    best_iteration = getattr(model, "best_iteration", None)
    if best_iteration is None:
        return model.predict_proba(X)[:, 1]
    return model.predict_proba(X, iteration_range=(0, best_iteration + 1))[:, 1]


def _weight_options(y_train) -> list[tuple[str, float]]:
    y_train = np.asarray(y_train)
    ratio = float((y_train == 0).sum() / (y_train == 1).sum())
    return [("unweighted", 1.0), ("weighted", ratio)]


def run_experiment(csv_path: str, output_dir: str | Path, min_season: int = 1980) -> dict:
    """Run all validation candidates, then one locked final test per ablation."""
    xgb = _xgboost()
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    df = build_features(load_clean(csv_path, min_season=min_season), era5_source_path=DEFAULT_ERA5_CACHE_PATH)
    train_sids, validation_sids, test_sids = temporal_storm_split(df)
    frames = {"train": _rows(df, train_sids), "validation": _rows(df, validation_sids), "test": _rows(df, test_sids)}
    trials, selected, final_rows = [], {}, []

    for name, columns in ABLATIONS.items():
        scaler = StandardScaler().fit(frames["train"][columns])
        X_train = scaler.transform(frames["train"][columns])
        X_validation = scaler.transform(frames["validation"][columns])
        y_train = frames["train"]["recurve_label"].to_numpy()
        y_validation = frames["validation"]["recurve_label"].to_numpy()
        for config_id, params in enumerate(PARAMETER_CONFIGS):
            for weighting, weight in _weight_options(y_train):
                model = _fit(xgb, X_train, y_train, X_validation, y_validation, params, weight)
                validation_pr_auc = float(average_precision_score(y_validation, _predict(model, X_validation)))
                trials.append({"ablation": name, "config_id": config_id, "weighting": weighting,
                               "scale_pos_weight": weight, "validation_pr_auc": validation_pr_auc,
                               "best_iteration": int(model.best_iteration), **params})

        ablation_trials = [row for row in trials if row["ablation"] == name]
        best = max(ablation_trials, key=lambda row: row["validation_pr_auc"])
        selected[name] = best

        # The final test is touched only after validation selection. Refit on
        # train+validation using the selected early-stopped tree count.
        train_validation = pd.concat([frames["train"], frames["validation"]], ignore_index=True)
        refit_scaler = StandardScaler().fit(train_validation[columns])
        final_params = {key: value for key, value in best.items() if key in PARAMETER_CONFIGS[0]}
        refit = xgb.XGBClassifier(
            objective="binary:logistic", eval_metric="aucpr", random_state=SEED, n_jobs=1,
            scale_pos_weight=best["scale_pos_weight"], **{**final_params, "n_estimators": best["best_iteration"] + 1},
        )
        refit.fit(refit_scaler.transform(train_validation[columns]), train_validation["recurve_label"].to_numpy(), verbose=False)
        probability = refit.predict_proba(refit_scaler.transform(frames["test"][columns]))[:, 1]
        climatology = float(train_validation["recurve_label"].mean())
        metrics = metric_summary(frames["test"]["recurve_label"], probability, climatology)
        test_frame = frames["test"][["SID", "recurve_label"]].copy()
        test_frame["probability"] = probability
        ci = storm_bootstrap_ci(test_frame.rename(columns={"probability": "xgboost_probability"}), "xgboost_probability", climatology)
        missing = frames["test"][ERA5_FEATURE_COLS].isna()
        final_rows.append({
            "ablation": name, "feature_count": len(columns),
            "train_rows": len(frames["train"]), "validation_rows": len(frames["validation"]), "test_rows": len(frames["test"]),
            "era5_missing_values": int(missing.sum().sum()), "era5_values": int(missing.size),
            "era5_missing_percentage": float(missing.mean().mean() * 100),
            "selected_config_id": best["config_id"], "selected_weighting": best["weighting"],
            **metrics, **{f"{metric}_{bound}": value for metric, interval in ci.items() for bound, value in interval.items()},
        })
        reliability_table(frames["test"]["recurve_label"], probability).to_csv(output_dir / f"{name}_test_reliability.csv", index=False)

    pd.DataFrame(trials).to_csv(output_dir / "validation_optimization_trials.csv", index=False)
    pd.DataFrame(final_rows).to_csv(output_dir / "locked_test_ablation_metrics.csv", index=False)
    payload = {
        "seed": SEED, "selection_metric": "validation PR-AUC", "early_stopping_rounds": EARLY_STOPPING_ROUNDS,
        "temporal_split": "train <=2014; validation 2015-2018; locked test >=2019",
        "candidate_fits": len(PARAMETER_CONFIGS) * 2 * len(ABLATIONS),
        "parameter_configurations": PARAMETER_CONFIGS, "selected_validation_configuration": selected,
        "feature_sets": ABLATIONS, "era5_provenance": df.attrs.get("era5_provenance", {}),
    }
    (output_dir / "best_validation_config.json").write_text(json.dumps(payload, indent=2, default=str))
    return payload


def main():
    parser = argparse.ArgumentParser(description="Validation-only recurvature XGBoost optimization.")
    parser.add_argument("--csv", required=True, help="IBTrACS CSV path")
    parser.add_argument("--output-dir", default="optimization_results")
    parser.add_argument("--min-season", type=int, default=1980)
    args = parser.parse_args()
    result = run_experiment(args.csv, args.output_dir, args.min_season)
    print(f"Completed {result['candidate_fits']} validation-only fits; final test was evaluated once per ablation.")


if __name__ == "__main__":
    main()
