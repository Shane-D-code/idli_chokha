"""Train and evaluate the XGBoost recurvature model.

Usage:
    python -m src.train --csv data/ibtracs_NI_list_v04r01.csv
"""

import argparse
import json

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.preprocessing import StandardScaler

# Compatibility shim: xgboost 2.1.3 reads `_estimator_type` when (de)serializing
# through its sklearn wrapper, but sklearn 1.8 removed it from ClassifierMixin.
# Without it, XGBClassifier.save_model() raises. Training itself is unaffected.
import xgboost.sklearn as _xgb_sklearn
if not hasattr(_xgb_sklearn.XGBClassifier, "_estimator_type"):
    _xgb_sklearn.XGBClassifier._estimator_type = "classifier"

from .prep import load_clean
from .features import build_features, label_diagnostics, FEATURE_COLS
from .dataset import make_tabular
from .evaluation import (
    evaluate_models,
    evaluation_frame,
    reliability_table,
    storm_bootstrap_ci,
    temporal_storm_split,
)
from .era5 import DEFAULT_ERA5_CACHE_PATH

SEED = 42


def main():
    parser = argparse.ArgumentParser(description="Train the Recurvature Cyclone Model.")
    parser.add_argument("--csv", required=True, help="Path to ibtracs_NI_list_v04r01.csv")
    parser.add_argument("--min-season", type=int, default=1980)
    parser.add_argument("--turn-threshold", type=float, default=45.0, help="Degrees of heading change counted as recurving")
    parser.add_argument("--future-steps", type=int, default=8, help="Timesteps ahead to check (8 * 3h = 24h)")
    parser.add_argument("--out", default="results.csv", help="Where to write the metrics table")
    parser.add_argument("--model-out", default="xgb_recurve_model.json", help="Where to save the trained model")
    parser.add_argument("--pred-out", default="test_predictions.csv", help="Where to save test-row predictions")
    parser.add_argument("--scaler-out", default="scaler.joblib", help="Where to save the fitted StandardScaler")
    parser.add_argument("--metadata-out", default="model_metadata.json", help="Where to save model metadata JSON")
    args = parser.parse_args()

    np.random.seed(SEED)

    print("Loading and cleaning data...")
    df = load_clean(args.csv, min_season=args.min_season)

    print("Engineering features and labels...")
    df = build_features(
        df, future_steps=args.future_steps, turn_threshold=args.turn_threshold,
        era5_source_path=DEFAULT_ERA5_CACHE_PATH,
    )
    print("\n=== Label diagnostics: legacy vs sustained signed turn ===")
    print(label_diagnostics(df).round(4).to_string())

    train_sids, val_sids, test_sids = temporal_storm_split(df)
    print(f"storms -> train {len(train_sids)}, val {len(val_sids)}, test {len(test_sids)}")

    X_tr, y_tr = make_tabular(df, train_sids)
    X_va, y_va = make_tabular(df, val_sids)
    X_te, y_te = make_tabular(df, test_sids)

    scaler = StandardScaler().fit(X_tr)
    X_tr_s, X_va_s, X_te_s = scaler.transform(X_tr), scaler.transform(X_va), scaler.transform(X_te)

    pos_weight = (y_tr == 0).sum() / (y_tr == 1).sum()
    model = xgb.XGBClassifier(
        n_estimators=400, max_depth=4, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        scale_pos_weight=pos_weight, eval_metric="logloss",
        random_state=SEED, early_stopping_rounds=30,
    )

    print("Training XGBoost...")
    model.fit(X_tr_s, y_tr, eval_set=[(X_va_s, y_va)], verbose=False)

    # Make the saved artifact self-describing: store real feature names/order
    # on the booster so runtime adapters can validate column alignment.
    model.get_booster().feature_names = list(FEATURE_COLS)
    model.save_model(args.model_out)

    prob = model.predict_proba(X_te_s)[:, 1]
    climatology_probability = float(y_tr.mean())
    d_te = evaluation_frame(df, test_sids, climatology_probability)
    d_te["xgboost_probability"] = prob
    res_df = evaluate_models(d_te, climatology_probability)
    xgb_result = res_df.loc["XGBoost"].to_dict()
    xgb_ci = storm_bootstrap_ci(d_te, "xgboost_probability", climatology_probability)
    reliability = reliability_table(d_te["recurve_label"], d_te["xgboost_probability"])
    print("\n=== Test-set results (recurvature within next", args.future_steps * 3, "hours) ===")
    print(res_df.round(3))
    print("\n=== XGBoost 95% SID-bootstrap CIs ===")
    print(pd.DataFrame(xgb_ci).T.round(3))
    res_df.to_csv(args.out)

    # Test-row provenance for honest reporting (real storm + timestamp per sample).
    pred_df = d_te[["SID", "NAME", "ISO_TIME"]].reset_index(drop=True)
    pred_df["prob"] = prob
    pred_df["label"] = y_te
    pred_df.to_csv(args.pred_out, index=False)

    # Save scaler + schema + metadata so the artifact set is reproducible.
    joblib.dump(scaler, args.scaler_out)
    metadata = {
        "task": "recurvature-24h",
        "label_definition": (
            "1 if the circularly smoothed heading makes a signed rightward turn "
            "of at least turn_threshold for two consecutive future 3-hour fixes "
            f"within {args.future_steps} timesteps (~24h); invalid labels are excluded"
        ),
        "turn_threshold_deg": args.turn_threshold,
        "future_steps": args.future_steps,
        "feature_names": list(FEATURE_COLS),
        "n_features": len(FEATURE_COLS),
        "storms": {"train": len(train_sids), "val": len(val_sids), "test": len(test_sids)},
        "samples": {"train": len(y_tr), "val": len(y_va), "test": len(y_te)},
        "positive_rate": {
            "train": round(float(y_tr.mean()), 4),
            "val": round(float(y_va.mean()), 4),
            "test": round(float(y_te.mean()), 4),
        },
        "metrics": xgb_result,
        "baseline_metrics": res_df.drop(index="XGBoost").to_dict(orient="index"),
        "bootstrap_ci_95": xgb_ci,
        "reliability": reliability.to_dict(orient="records"),
        "evaluation": {
            "split": "temporal storm split: train <= 2014, validation 2015-2018, test >= 2019",
            "test_storms": int(d_te["SID"].nunique()),
            "test_rows": int(len(d_te)),
            "invalid_label_rows_excluded": True,
            "calibration_applied": False,
        },
        "era5_provenance": df.attrs.get("era5_provenance", {}),
        "best_iteration": model.best_iteration,
        "model_config": {
            "n_estimators": model.n_estimators,
            "max_depth": model.max_depth,
            "learning_rate": model.learning_rate,
            "subsample": model.subsample,
            "colsample_bytree": model.colsample_bytree,
            "scale_pos_weight": float(model.scale_pos_weight),
            "eval_metric": "logloss",
            "early_stopping_rounds": 30,
        },
        "seed": SEED,
    }
    with open(args.metadata_out, "w") as f:
        json.dump(metadata, f, indent=2)

    importance = dict(zip(FEATURE_COLS, model.feature_importances_.tolist()))
    with open("feature_importance.json", "w") as f:
        json.dump(importance, f, indent=2)


if __name__ == "__main__":
    main()
