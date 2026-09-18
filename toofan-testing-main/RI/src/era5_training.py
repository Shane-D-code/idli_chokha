"""ERA5-only RI training + rigorous evaluation (RI Improvement 3).

This module trains a clean ERA5 baseline on the *rebuilt* dataset produced in
RI Improvement 2 (``era5_datasets/era5_ri_rebuilt.csv``) and evaluates it:

* the **exact 89-feature frozen contract** is used (order asserted);
* storm-wise deterministic split (seed 42) with zero train/val/test storm
  overlap;
* ``scale_pos_weight`` computed from the **training split only**;
* XGBoost ``binary:logistic`` with early stopping on the validation split
  (mirrors the frozen model's conservatism — no hyperparameter search);
* the test split is touched exactly once for the final evaluation;
* thresholded metrics use a threshold selected on the **validation** split
  (max F1), never on test;
* baselines: constant-prevalence (training prevalence) and the frozen ERA5
  model (with its verified best iteration) on the same test observations.

Nothing here fabricates data, imputes missing values, oversamples, or claims
calibration. This is the ERA5 ranking/probability baseline; calibration is a
later improvement.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import get_config  # noqa: E402
from src.data import split_by_storms  # noqa: E402
from src.features import (  # noqa: E402
    era5_feature_columns_with_temporal,
    prepare_features,
)
from src.models import train_xgboost, save_model  # noqa: E402
from src import era5_rebuild as er  # noqa: E402


# ---------------------------------------------------------------------------
# Feature contract
# ---------------------------------------------------------------------------

def era5_feature_names() -> list[str]:
    """The exact 89 recovered predictor names, in frozen ordering."""
    return list(era5_feature_columns_with_temporal((6, 12, 24)))


FORBIDDEN_PREDICTOR_COLS = {
    "storm_id", "datetime_utc", "latitude", "longitude", "RI_24h",
    "era5_datetime", "era5_delta_minutes", "era5_source_file",
    "era5_grid_resolution", "spatial_method", "provenance_status",
    "bilinear_cells",
} | er.TARGET_COLS


def assert_predictor_contract(predictor_cols: list[str]) -> list[str]:
    """Assert the model input is exactly the 89 recovered features, in order."""
    expected = era5_feature_names()
    if predictor_cols != expected:
        diff = [c for c in predictor_cols if c not in set(expected)]
        missing = [c for c in expected if c not in set(predictor_cols)]
        raise AssertionError(
            f"89-feature predictor contract violated: unexpected={diff[:10]}, "
            f"missing={missing[:10]} (len preds={len(predictor_cols)}, "
            f"expected={len(expected)})")
    forbidden = [c for c in predictor_cols if c in FORBIDDEN_PREDICTOR_COLS]
    if forbidden:
        raise AssertionError(f"forbidden columns in predictors: {forbidden}")
    return expected


# ---------------------------------------------------------------------------
# Data loading + storm-wise split
# ---------------------------------------------------------------------------

SPLIT_FRACS = {"test_storm_fraction": 0.20, "val_storm_fraction": 0.15,
               "keep_balanced": True}


def load_rebuilt_dataset(path: Path | str) -> pd.DataFrame:
    """Load the rebuilt ERA5 RI dataset with parsed timestamps."""
    df = pd.read_csv(path, parse_dates=["datetime_utc"])
    df["storm_id"] = df["storm_id"].astype(str)
    assert not df["RI_24h"].isna().any(), "censored (NaN target) rows present"
    df["RI_24h"] = df["RI_24h"].astype(int)
    return df


def storm_split(df: pd.DataFrame, seed: int = 42):
    """Deterministic storm-wise train/val/test split (zero storm overlap)."""
    split_cfg = {"seed": int(seed), "split": dict(SPLIT_FRACS)}
    split = split_by_storms(df, split_cfg)
    split.verify()
    return split


# ---------------------------------------------------------------------------
# Class weighting (training split only)
# ---------------------------------------------------------------------------

def class_weight_from_train(y_train: np.ndarray) -> float:
    """scale_pos_weight = negative_train / positive_train."""
    n_neg = int((np.asarray(y_train) == 0).sum())
    n_pos = int((np.asarray(y_train) == 1).sum())
    if n_pos == 0:
        return 1.0
    return float(n_neg / n_pos)


def prepare_splits(df: pd.DataFrame, seed: int = 42):
    """Prepare (X, y, storm) matrices for train/val/test from the storm split."""
    feats = era5_feature_names()
    split = storm_split(df, seed)

    X_tr, y_tr, use = prepare_features(split.train, feats)
    assert_predictor_contract(use)
    X_va, y_va, use_va = prepare_features(split.val, feats)
    assert_predictor_contract(use_va)
    X_te, y_te, use_te = prepare_features(split.test, feats)
    assert_predictor_contract(use_te)

    groups_tr = split.train.loc[X_tr.index, "storm_id"].to_numpy()
    return split, X_tr, y_tr, groups_tr, X_va, y_va, X_te, y_te


# ---------------------------------------------------------------------------
# Training (conservative baseline, mirrors frozen procedure)
# ---------------------------------------------------------------------------

def train_era5(X_train, y_train, groups_train, X_val, y_val, X_test, y_test,
               cfg: dict, seed: int):
    """Train the ERA5 XGBoost baseline with early stopping on validation."""
    return train_xgboost(X_train, y_train, groups_train, X_val, y_val,
                         X_test, y_test, cfg, "era5", seed)


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def _safe_roc(y, p):
    if len(np.unique(y)) < 2:
        return float("nan")
    from sklearn.metrics import roc_auc_score
    return float(roc_auc_score(y, p))


def _safe_pr(y, p):
    if len(np.unique(y)) < 2:
        return float("nan")
    from sklearn.metrics import average_precision_score
    return float(average_precision_score(y, p))


def select_threshold(y_val, p_val, grid: float = 0.01) -> tuple[float, float]:
    """Select a decision threshold on the validation split (max F1).

    Returns ``(threshold, val_f1_at_threshold)``.
    """
    from sklearn.metrics import f1_score
    best_t, best_f1 = 0.5, -1.0
    for t in np.arange(0.0, 1.0 + grid, grid):
        pred = (p_val >= t).astype(int)
        if len(np.unique(pred)) < 2 or len(np.unique(y_val)) < 2:
            continue
        f1 = float(f1_score(y_val, pred))
        if f1 > best_f1:
            best_t, best_f1 = float(t), f1
    if best_f1 < 0:
        return 0.5, float("nan")
    return best_t, best_f1


def evaluate(y_true, p_prob, threshold: float, label: str = "test") -> dict:
    """One-shot held-out metrics at the given decision threshold."""
    from sklearn.metrics import (accuracy_score, brier_score_loss, f1_score,
                                 precision_score, recall_score)
    y = np.asarray(y_true).astype(int)
    p = np.asarray(p_prob).astype(float)
    pred = (p >= threshold).astype(int)
    return {
        "label": label,
        "n": int(len(y)),
        "n_positive": int((y == 1).sum()),
        "prevalence": round(float(y.mean()), 5),
        "roc_auc": _safe_roc(y, p),
        "pr_auc": _safe_pr(y, p),
        "brier": round(float(brier_score_loss(y, p)), 6),
        "threshold": float(threshold),
        "precision": round(float(precision_score(y, pred)), 5),
        "recall": round(float(recall_score(y, pred)), 5),
        "f1": round(float(f1_score(y, pred)), 5),
        "accuracy": round(float(accuracy_score(y, pred)), 5),
        "pred_positive": int(pred.sum()),
    }


def reliability_table(y_true, p_prob, n_bins: int = 10) -> dict:
    """Simple binned reliability info (informational; model is NOT calibrated)."""
    y = np.asarray(y_true).astype(int)
    p = np.asarray(p_prob).astype(float)
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    idx = np.clip(np.searchsorted(bins, p, side="right") - 1, 0, n_bins - 1)
    out = {"bins": [], "mean_predicted": [], "mean_observed": [],
           "n": [], "abs_gap": []}
    for bi in range(n_bins):
        m = idx == bi
        if m.sum() == 0:
            continue
        mp = float(p[m].mean())
        mo = float(y[m].mean())
        out["bins"].append(f"{bins[bi]:.2f}-{bins[bi+1]:.2f}")
        out["mean_predicted"].append(round(mp, 4))
        out["mean_observed"].append(round(mo, 4))
        out["n"].append(int(m.sum()))
        out["abs_gap"].append(round(abs(mp - mo), 4))
    mace = float(np.mean(np.abs(np.asarray(out["abs_gap"])))) if out["abs_gap"] else None
    out["mean_abs_calibration_error"] = round(mace, 5) if mace is not None else None
    return out


# ---------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------

def constant_prevalence_baseline(y_true, train_prevalence: float,
                                 threshold: float = 0.5) -> dict:
    """Constant-prevalence baseline predicting the same P for every sample.

    Uses **training** prevalence (never test-or-val), so this is an honest,
    no-leak baseline. PR-AUC of a constant predictor equals its assigned
    probability; ROC-AUC is 0.5 by construction.
    """
    y = np.asarray(y_true).astype(int)
    p = np.full(len(y), float(train_prevalence))
    res = evaluate(y, p, threshold=threshold, label="constant_prevalence")
    return res


def predict_frozen_era5(X_test: pd.DataFrame, model_path: Path | str,
                        feature_names: list[str]) -> np.ndarray:
    """Frozen ERA5 model probabilities on the same test rows (verified best it.)."""
    import xgboost as xgb
    booster = xgb.Booster()
    booster.load_model(str(model_path))
    expected = list(booster.feature_names or feature_names)
    if expected != feature_names:
        raise AssertionError(
            f"frozen model feature order mismatch vs contract "
            f"{expected[:2]}... != {feature_names[:2]}...")
    dmatrix = xgb.DMatrix(X_test.to_numpy(), feature_names=feature_names)
    # verified best iteration from artifact metadata
    payload = json.loads(Path(model_path).read_text())
    raw = payload["learner"].get("attributes", {}).get("best_iteration")
    if raw is None:
        raise ValueError(f"{model_path} has no verified best_iteration attribute")
    return booster.predict(dmatrix, iteration_range=(0, int(raw) + 1))


# ---------------------------------------------------------------------------
# Error analysis
# ---------------------------------------------------------------------------

def error_analysis(test_info: pd.DataFrame, threshold: float) -> dict:
    """Identify FPs/FNs, highest/lowest-confidence errors on the test split.

    ``test_info`` must contain storm_id/datetime_utc/latitude/longitude/
    RI_24h/P_RI; rows are already the held-out test rows.
    """
    df = test_info.copy()
    df["pred"] = (df["P_RI"] >= threshold).astype(int)
    df["correct"] = (df["pred"] == df["RI_24h"])
    fp = df[(df["RI_24h"] == 0) & (df["pred"] == 1)].sort_values("P_RI", ascending=False)
    tn = df[(df["RI_24h"] == 0) & (df["pred"] == 0)]
    fn = df[(df["RI_24h"] == 1) & (df["pred"] == 0)].sort_values("P_RI", ascending=False)
    tp = df[(df["RI_24h"] == 1) & (df["pred"] == 1)]

    def rows(sub, n=6):
        cols = ["storm_id", "datetime_utc", "RI_24h", "P_RI"]
        out = sub[cols].head(n).assign(P_RI=lambda d: d["P_RI"].round(4))
        return out.to_dict("records")

    history_available_metric = "history_available"
    df[history_available_metric] = df[
        [c for c in df.columns if c.startswith("delta_6h_")]].notna().any(axis=1)

    basin_of = ["BAY_OF_BENGAL" if 80 <= lon <= 100 else "ARABIAN_SEA_OTHER"
                for lon in df["longitude"]]
    era_of = pd.to_datetime(df["datetime_utc"]).dt.year.apply(
        lambda yr: "<=2004" if int(yr) <= 2004 else ">2004")
    df["_basin"] = basin_of
    df["_era"] = era_of.values if hasattr(era_of, "values") else era_of

    def group_metrics(sub):
        if len(sub) == 0:
            return {"n": 0, "prevalence": None}
        return evaluate(sub["RI_24h"].to_numpy(), sub["P_RI"].to_numpy(),
                        threshold=threshold, label="group")

    breakdown = {
        "by_basin": {b: group_metrics(sub)
                     for b, sub in df.groupby("_basin")},
        "by_era": {str(era): group_metrics(sub)
                   for era, sub in df.groupby("_era")},
        "by_history_availability": {
            str(bool(h)): group_metrics(sub)
            for h, sub in df.groupby(df[history_available_metric])},
    }

    return {
        "n_false_positives": int(len(fp)),
        "n_false_negatives": int(len(fn)),
        "n_true_positives": int(len(tp)),
        "n_true_negatives": int(len(tn)),
        "highest_confidence_false_positives": rows(fp, 6),
        "highest_confidence_false_negatives": rows(fn, 6),
        "lowest_confidence_true_positives": rows(tp.sort_values("P_RI"), 6),
        "lowest_confidence_true_negatives": rows(tn.sort_values("P_RI"), 6),
        "threshold": float(threshold),
        "breakdown": breakdown,
    }


# ---------------------------------------------------------------------------
# Artifacts / metadata
# ---------------------------------------------------------------------------

def write_feature_schema(path: Path | str) -> dict:
    """Save the 89-feature schema (name + contract reference)."""
    names = era5_feature_names()
    spec = er.build_feature_spec()
    schema = {
        "n_features": len(names),
        "order_contract": names == [f["name"] for f in spec],
        "features": spec,
        "frozen_model_reference": "models/era5_final_xgboost.json",
        "note": "Exact 89 recovered features, frozen ordering, RI Improvement 2.",
    }
    Path(path).write_text(json.dumps(schema, indent=2))
    return schema


def build_training_metadata(
    *,
    seed: int,
    split,
    X_tr, y_tr, X_va, y_va, X_te, y_te,
    scale_pos_weight: float,
    model_config: dict,
    best_iteration: int,
    test_metrics: dict,
    baselines: dict,
    threshold: float,
    dataset_path: Path | str,
    provenance_ref: str,
    model_file: str,
    feature_schema_file: str,
    predictions_file: str,
    error_analysis: dict | None = None,
    reliability: dict | None = None,
) -> dict:
    """Assemble the complete training metadata artifact."""
    from datetime import datetime, timezone

    def _stats(df):
        return {
            "rows": int(len(df)),
            "storms": int(df["storm_id"].nunique()),
            "ri_pos": int((df["RI_24h"] == 1).sum()),
            "ri_neg": int((df["RI_24h"] == 0).sum()),
            "prevalence": round(float(df["RI_24h"].mean()), 5),
        }

    return {
        "phase": "RI Improvement 3 — ERA5-only baseline (no tuning)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_type": "xgb",
        "objective": "binary:logistic",
        "seed": int(seed),
        "feature_count": 89,
        "feature_contract": "exact frozen order (RI Improvement 2 spec)",
        "feature_schema_file": feature_schema_file,
        "dataset_path": str(dataset_path),
        "dataset_provenance": provenance_ref,
        "delta_semantics": (
            "within-storm change vs previous observation, kept only when "
            "t - t_prev <= lag; PRESERVED unchanged (RI Improvement 2 semantics)."
        ),
        "splits": {
            "train": _stats(split.train),
            "val": _stats(split.val),
            "test": _stats(split.test),
            "train_storm_ids": sorted(set(split.train["storm_id"])),
            "val_storm_ids": sorted(set(split.val["storm_id"])),
            "test_storm_ids": sorted(set(split.test["storm_id"])),
            "method": "storm-wise deterministic split, seed 42, "
                      "test 20% val 15% of storms, keep_balanced",
        },
        "class_weight": {
            "method": "scale_pos_weight = neg_train / pos_train (training split only)",
            "scale_pos_weight": round(float(scale_pos_weight), 7),
        },
        "hyperparameters": {k: v for k, v in model_config.items()},
        "best_iteration": int(best_iteration),
        "threshold": {
            "value": float(threshold),
            "selection": "max F1 on the validation split (never test)",
            "selection_grid": 0.01,
        },
        "evaluation": test_metrics,
        "baselines": baselines,
        "error_analysis": error_analysis,
        "reliability_info": reliability,
        "calibration_status": "NOT CALIBRATED — raw XGBoost probabilities only",
        "artifacts": {
            "model": model_file,
            "feature_schema": feature_schema_file,
            "test_predictions": predictions_file,
            "metadata": None,  # filled by run_training after the file is written
        },
        "training_performed": True,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run_training(
    dataset_path: Path | str,
    seed: int = 42,
    output_dir: Path | str = None,
    frozen_model: Path | str | None = None,
    provenance_ref: str = (
        "ROOT/era5_datasets/era5_ri_rebuilt.csv (RI Improvement 2 rebuild; "
        "manifest era5_ri_manifest.json)"),
    return_data: bool = False,
):
    """Run the full ERA5 baseline training/evaluation; returns artifacts dict.

    Saves (under ``output_dir``):
      era5_ri_model.json, era5_ri_training_metadata.json,
      era5_ri_feature_schema.json, era5_ri_test_predictions.csv,
      era5_ri_storm_split.csv
    """
    output_dir = Path(output_dir) if output_dir else Path.cwd() / "models"
    output_dir.mkdir(parents=True, exist_ok=True)

    df = load_rebuilt_dataset(dataset_path)
    split, X_tr, y_tr, groups_tr, X_va, y_va, X_te, y_te = prepare_splits(df, seed)

    feats = era5_feature_names()
    y_tr_np = np.asarray(y_tr).astype(int)

    # training config: conservative baseline from the project config (era5 block)
    cfg = get_config()
    cfg["seed"] = int(seed)
    model = train_era5(X_tr, y_tr_np, groups_tr, X_va, y_va, X_te, y_te,
                       cfg, seed)
    save_model(model, str(output_dir / "era5_ri_model.json"))

    scale_pos_weight = class_weight_from_train(y_tr_np)
    best_iteration = int(model.best_iteration if model.best_iteration is not None
                         else -1)

    # probabilities
    p_tr = model.predict_proba(X_tr)[:, 1]
    p_va = model.predict_proba(X_va)[:, 1]
    p_te = model.predict_proba(X_te)[:, 1]

    # validation-selected threshold (max F1) — only VAL used, never test
    threshold, _val_f1 = select_threshold(np.asarray(y_va).astype(int), p_va)

    test_metrics = evaluate(np.asarray(y_te).astype(int), p_te,
                            threshold=threshold, label="era5_test")

    # baselines
    train_prevalence = float(y_tr_np.mean())
    const_base = constant_prevalence_baseline(
        np.asarray(y_te).astype(int), train_prevalence, threshold=threshold)
    frozen_res = None
    frozen_documented = None
    if frozen_model is not None and Path(frozen_model).exists():
        p_frozen = predict_frozen_era5(X_te, frozen_model, feats)
        frozen_res = evaluate(np.asarray(y_te).astype(int), p_frozen,
                              threshold=threshold,
                              label="frozen_era5_on_new_test_split")
        frozen_res["confounding_caveat"] = (
            "The frozen artifact does not record its training/test storm IDs, "
            "so whether its training storms overlap THIS test split cannot be "
            "verified. Its training table (848-row MVP) shares the seed-42 "
            "storm shuffle, so overlap with these test storms is LIKELY. These "
            "numbers are a behavior reference only and may be flattered by "
            "head leakage; the freshly trained model is the only clean "
            "disjoint-storm comparison.")
        # documented frozen metrics (RI Improvement 1) — DIFFERENT test population
        frozen_documented = {
            "roc_auc": 0.7047, "pr_auc": 0.2969,
            "test_population": "era5 split of 848-row MVP table: 174 obs / 20 "
                               "storms / 25 RI (NOT this rebuild's test split)",
            "iteration_range": "(0, 41) verified best iteration",
            "note": "historical reference only — different test population",
        }

    # error analysis on held-out test rows
    test_rows = split.test.loc[X_te.index].copy()
    test_rows["P_RI"] = p_te
    test_rows["P_RI_frozen"] = p_frozen if frozen_res and p_frozen is not None else np.nan
    err_analysis = error_analysis(test_rows, threshold)
    reliab = reliability_table(np.asarray(y_te).astype(int), p_te)

    # artifacts
    schema_file = "era5_ri_feature_schema.json"
    write_feature_schema(output_dir / schema_file)

    predicted_cols = ["storm_id", "datetime_utc", "RI_24h", "P_RI"]
    if frozen_res:
        predicted_cols.append("P_RI_frozen")
    pred_path = output_dir / "era5_ri_test_predictions.csv"
    test_rows[predicted_cols].to_csv(pred_path, index=False)

    split_csv = split.train[["storm_id"]].assign(split="train").pipe(
        lambda c: pd.concat([
            c,
            split.val[["storm_id"]].assign(split="val"),
            split.test[["storm_id"]].assign(split="test"),
        ])).drop_duplicates("storm_id").sort_values("storm_id")
    split_csv.to_csv(output_dir / "era5_ri_storm_split.csv", index=False)

    model_config = {
        "n_estimators": int(cfg["era5_model"]["n_estimators"]),
        "learning_rate": float(cfg["era5_model"]["learning_rate"]),
        "max_depth": int(cfg["era5_model"]["max_depth"]),
        "min_child_weight": int(cfg["era5_model"]["min_child_weight"]),
        "subsample": float(cfg["era5_model"]["subsample"]),
        "colsample_bytree": float(cfg["era5_model"]["colsample_bytree"]),
        "early_stopping_rounds": int(cfg["era5_model"]["early_stopping_rounds"]),
        "max_delta_step": 1,
        "eval_metric": "aucpr",
        "objective": "binary:logistic",
    }

    metadata = build_training_metadata(
        seed=seed, split=split,
        X_tr=X_tr, y_tr=y_tr_np, X_va=X_va, y_va=np.asarray(y_va).astype(int),
        X_te=X_te, y_te=np.asarray(y_te).astype(int),
        scale_pos_weight=scale_pos_weight, model_config=model_config,
        best_iteration=best_iteration, test_metrics=test_metrics,
        baselines={"constant_prevalence": const_base,
                   "frozen_era5_on_new_test_split": frozen_res,
                   "frozen_era5_documented_reference": frozen_documented},
        threshold=threshold, dataset_path=dataset_path,
        provenance_ref=provenance_ref,
        model_file=str(output_dir / "era5_ri_model.json"),
        feature_schema_file=str(output_dir / schema_file),
        predictions_file=str(pred_path),
        error_analysis=err_analysis, reliability=reliab,
    )
    metadata_path = output_dir / "era5_ri_training_metadata.json"
    metadata["artifacts"]["metadata"] = str(metadata_path)
    metadata_path.write_text(json.dumps(metadata, indent=2, default=str))

    summary = {
        "STATUS": "trained_and_evaluated",
        "TRAINING PERFORMED": "YES",
        "DATASET": str(dataset_path),
        "ROWS": int(len(df)),
        "STORMS": int(df["storm_id"].nunique()),
        "RI POSITIVES": int((df["RI_24h"] == 1).sum()),
        "RI NEGATIVES": int((df["RI_24h"] == 0).sum()),
        "TRAIN/VAL/TEST": {
            "train": {"storms": len(metadata["splits"]["train_storm_ids"]),
                      "rows": metadata["splits"]["train"]["rows"]},
            "val": {"storms": len(metadata["splits"]["val_storm_ids"]),
                    "rows": metadata["splits"]["val"]["rows"]},
            "test": {"storms": len(metadata["splits"]["test_storm_ids"]),
                     "rows": metadata["splits"]["test"]["rows"]},
        },
        "89-FEATURE CONTRACT": True,
        "DELTA SEMANTICS": metadata["delta_semantics"],
        "ADAPTER ITERATION FIX": "ri_adapter.py RIBranchModel honors verified "
                                 "best_iteration (iteration_range).",
        "MODEL": str(output_dir / "era5_ri_model.json"),
        "BEST ITERATION": best_iteration,
        "ROC-AUC": test_metrics.get("roc_auc"),
        "PR-AUC": test_metrics.get("pr_auc"),
        "PREVALENCE": test_metrics.get("prevalence"),
        "PRECISION": test_metrics.get("precision"),
        "RECALL": test_metrics.get("recall"),
        "F1": test_metrics.get("f1"),
        "ACCURACY": test_metrics.get("accuracy"),
        "BRIER": test_metrics.get("brier"),
        "FROZEN ERA5 COMPARISON": {
            "frozen_on_same_test": frozen_res,
            "frozen_documented_reference": frozen_documented,
        },
        "CONSTANT BASELINE": const_base,
        "CALIBRATED": "NO",
        "ARTIFACTS": {
            "model": str(output_dir / "era5_ri_model.json"),
            "metadata": str(metadata_path),
            "schema": str(output_dir / schema_file),
            "predictions": str(pred_path),
            "storm_split": str(output_dir / "era5_ri_storm_split.csv"),
        },
        "TESTS": "cyclone_backup/tests/test_era5_training.py",
        "REPRODUCIBLE": f"python train_era5_ri.py --data {dataset_path} --seed {seed}",
        "NEXT STEP": "IMD vs ERA5 comparison; IMD+ERA5 fusion; calibration",
    }
    if return_data:
        return summary, metadata, model, split, test_rows
    return summary, metadata, model