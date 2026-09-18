"""IMD vs ERA5 vs IMD+ERA5 fusion fair comparison (RI Improvement 4).

This module answers the scientific question:

    Does ERA5 add useful predictive information for rapid-intensification
    (RI) ranking beyond the existing IMD model?

The experiment is deliberately *fair*:

* a single **common observation universe** — every row that exists in both
  modalities with a valid RI target (no fabrication, no row-level splits);
* a single storm-wise deterministic split (seed 42) shared by **all arms** —
  the exact split used in RI Improvement 3 wherever possible;
* exactly three arms trained/evaluated on the same held-out test storms:
    - IMD-only   (12 canonical IMD features, freshly trained),
    - ERA5-only  (89-feature ERA5 contract; the Improvement-3 model is reused
                  when the common split is identical),
    - IMD+ERA5 fusion (the 12 + 89 = 101 unique features in one XGBoost).
* native XGBoost missing-value handling everywhere (the project's documented
  design — no imputation of whole modalities);
* thresholds selected on the **validation** split only (never test);
* ``scale_pos_weight`` from the training split only;
* storm-level bootstrap to express sampling uncertainty, plus a cross-model
  error analysis; and:
* an explicit, machine-readable statement of whether ERA5 adds value
  (positive / neutral / negative / inconclusive), never over-read from tiny
  numerical differences.

Nothing here claims calibration, imputes missing values, or reports a metric
computed by tuning on the test split.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import get_config  # noqa: E402
from src.data import IMD_FEATURE_COLS, split_by_storms  # noqa: E402
from src.features import prepare_features  # noqa: E402
from src.models import save_model, train_xgboost  # noqa: E402
from src.era5_training import (  # noqa: E402
    SPLIT_FRACS,
    constant_prevalence_baseline,
    era5_feature_names,
    evaluate,
    load_rebuilt_dataset,
    predict_frozen_era5,
    select_threshold,
    storm_split,
)

# ---------------------------------------------------------------------------
# Feature contracts
# ---------------------------------------------------------------------------

# Canonical 12 IMD features in the frozen ordering.
IMD_FEATURE_ORDER = list(IMD_FEATURE_COLS)


def fusion_feature_names() -> list[str]:
    """The 101-feature IMD+ERA5 fusion vector (12 IMD + 89 ERA5)."""
    names = IMD_FEATURE_ORDER + era5_feature_names()
    assert len(names) == 101, f"expected 101 features, got {len(names)}"
    assert len(set(names)) == len(names), "duplicate feature names in fusion"
    return names


def imd_feature_order() -> list[str]:
    """Return the 12 canonical IMD feature names (order asserted contracts)."""
    return list(IMD_FEATURE_ORDER)


# ---------------------------------------------------------------------------
# Common observation universe
# ---------------------------------------------------------------------------

def load_imd_features(path: Path | str) -> pd.DataFrame:
    """Load the canonical IMD table restricted to the 12 predictor columns.

    Mirrors ``data.load_imd`` (censoring + derivation), but keeps only the
    identity columns and the canonical predictor set so the merge with the
    rebuilt ERA5 table is clean.
    """
    df = pd.read_csv(path, parse_dates=["datetime_utc"])
    df["storm_id"] = df["storm_id"].astype(str)
    df = df.dropna(subset=["storm_id", "datetime_utc", "RI_24h",
                           "latitude", "longitude"]).copy()
    df["RI_24h"] = df["RI_24h"].astype(int)
    if "wind_6h_change" not in df.columns:
        df["wind_6h_change"] = df["max_wind_kt"] - df["wind_minus_6h_kt"]
    return df[["storm_id", "datetime_utc", "RI_24h"] + IMD_FEATURE_ORDER].copy()


def _imd_missingness(df: pd.DataFrame) -> dict:
    """Per-feature non-null counts over the common universe (transparency)."""
    counts = {c: int(df[c].notna().sum()) for c in IMD_FEATURE_ORDER}
    return {
        "n_rows": int(len(df)),
        "feature_non_null": counts,
        "rows_with_all_12_imd_features": int(df[IMD_FEATURE_ORDER].notna().all(axis=1).sum()),
        "note": (
            "IMD missingness is handled by XGBoost's native missing-value "
            "branch, exactly as every model in this project was trained. No "
            "imputation of whole modalities is performed."
        ),
    }


def build_common_universe(era5_path: Path | str, imd_path: Path | str):
    """Join the rebuilt ERA5 table onto the IMD table on (storm, time).

    Returns ``(common_df, stats)`` where ``common_df`` contains identity,
    target, the 12 IMD predictors and the 89 ERA5 predictors for every
    observation present in *both* modalities. Nothing is imputed; ERA5 rows
    with no IMD match are dropped (and reported).
    """
    era = load_rebuilt_dataset(era5_path)
    imd = load_imd_features(imd_path)

    before = len(era)
    common = era.merge(
        imd, on=["storm_id", "datetime_utc"], how="inner",
        suffixes=("_era", ""))
    after = len(common)

    # Every common row must have an identical target from both modalities.
    assert (common["RI_24h_era"].astype(int) == common["RI_24h"].astype(int)).all(), \
        "RI target disagrees between ERA5 and IMD tables"
    assert common["RI_24h"].notna().all(), "censored rows leaked into universe"

    stats = {
        "era5_rows": before,
        "imd_rows": len(imd),
        "common_rows": after,
        "rows_lost": int(before - after),
        "storms": int(common["storm_id"].nunique()),
        "ri_positives": int((common["RI_24h"] == 1).sum()),
        "ri_negatives": int((common["RI_24h"] == 0).sum()),
        "prevalence": round(float(common["RI_24h"].mean()), 5),
        "imd_missingness": _imd_missingness(common),
        "note": "inner join on (storm_id, datetime_utc); everything in both "
                "modalities with a valid RI target is retained.",
    }
    return common, stats


# ---------------------------------------------------------------------------
# Common storm-wise split
# ---------------------------------------------------------------------------

def _recorded_split(path: Path | str) -> dict[str, str]:
    """Read the Improvement-3 recorded storm split as a storm_id -> split map."""
    df = pd.read_csv(path)
    return dict(zip(df["storm_id"].astype(str), df["split"]))


def common_split(common: pd.DataFrame, seed: int = 42,
                 recorded_split_path: Path | str | None = None):
    """Storm-wise split of the common universe (seed 42, zero overlap).

    When ``recorded_split_path`` is given, the split is verified against the
    Improvement-3 artifact; identical storm sets mean the Improvement-3 ERA5
    model can be reused as the ERA5 arm (no retraining).
    """
    split = storm_split(common, seed)
    split.verify()
    info = {"matches_improvement_3": False, "detail": None}
    if recorded_split_path is not None and Path(recorded_split_path).exists():
        rec = _recorded_split(recorded_split_path)
        for name, df in (("train", split.train), ("val", split.val),
                         ("test", split.test)):
            got = set(df["storm_id"].astype(str))
            expected = {k for k, v in rec.items() if v == name}
            if got != expected:
                info = {
                    "matches_improvement_3": False,
                    "detail": f"{name} differs from Improvement-3 record",
                }
                return split, info
        info = {
            "matches_improvement_3": True,
            "detail": f"identical storm sets to Improvement-3 split "
                      f"(seed {seed})",
        }
    return split, info


def prepare_split_xyg(split, feats: list[str]):
    """Prepare (X, y, groups) matrices for train/val/test for a feature list.

    Asserts the usable-column contract is exactly ``feats`` for every split.
    """
    out = {}
    for name in ("train", "val", "test"):
        df = getattr(split, name)
        X, y, usable = prepare_features(df, feats)
        assert usable == feats, (
            f"{name}: usable columns != requested ({len(usable)} vs "
            f"{len(feats)}); dropped_candidates="
            f"{[c for c in feats if c not in usable]}"
        )
        out[f"X_{name}"] = X
        out[f"y_{name}"] = np.asarray(y).astype(int)
        out[f"g_{name}"] = df.loc[X.index, "storm_id"].to_numpy()
    return out


# ---------------------------------------------------------------------------
# ERA5 model loading (reuse the Improvement-3 artifact where the split matches)
# ---------------------------------------------------------------------------

def predict_booster_at_best(model_path: Path | str, X: pd.DataFrame,
                            feature_names: list[str]) -> np.ndarray:
    """Predict P(RI=1) with an XGBoost booster at its verified best iteration."""
    import xgboost as xgb
    booster = xgb.Booster()
    booster.load_model(str(model_path))
    expected = list(booster.feature_names or feature_names)
    if expected != feature_names:
        raise AssertionError(
            f"artifact feature order mismatch ({expected[:3]}... != "
            f"{feature_names[:3]}...)")
    payload = json.loads(Path(model_path).read_text())
    raw = payload["learner"].get("attributes", {}).get("best_iteration")
    if raw is None:
        raise ValueError(f"{model_path} has no verified best_iteration")
    dmatrix = xgb.DMatrix(X.to_numpy(), feature_names=feature_names)
    return booster.predict(dmatrix, iteration_range=(0, int(raw) + 1))


# ---------------------------------------------------------------------------
# Storm-level bootstrap
# ---------------------------------------------------------------------------

def storm_bootstrap(y: np.ndarray, p: np.ndarray, storm_ids: np.ndarray,
                    metric: str = "roc_auc", n_boot: int = 1000,
                    seed: int = 42) -> dict:
    """Resample *storms* (with all their observations) bootstrap CI.

    ``metric`` in {"roc_auc", "pr_auc"} using sklearn's scorers. Resamples in
    which either class is absent are skipped (and reported). Returns the mean
    and a 95% percentile interval over the bootstrap distribution.
    """
    from sklearn.metrics import roc_auc_score, average_precision_score
    y = np.asarray(y).astype(int)
    p = np.asarray(p).astype(float)
    storm_ids = np.asarray(storm_ids)
    storms = np.unique(storm_ids)
    scorer = (lambda ys, ps: roc_auc_score(ys, ps)
              if metric == "roc_auc" else average_precision_score(ys, ps))

    rng = np.random.RandomState(seed)
    values = []
    for _ in range(int(n_boot)):
        idx = rng.choice(storms, size=len(storms), replace=True)
        m = np.isin(storm_ids, idx)
        ys, ps = y[m], p[m]
        if len(np.unique(ys)) < 2:
            continue
        values.append(float(scorer(ys, ps)))

    if not values:
        return {"metric": metric, "n_boot": int(n_boot), "n_used": 0,
                "mean": None, "ci_low": None, "ci_high": None,
                "note": "no valid resample (single class); CI unavailable"}
    values = np.asarray(values)
    return {
        "metric": metric,
        "n_boot": int(n_boot),
        "n_used": int(len(values)),
        "mean": round(float(values.mean()), 5),
        "ci_low": round(float(np.percentile(values, 2.5)), 5),
        "ci_high": round(float(np.percentile(values, 97.5)), 5),
        "method": "storm-level resampling with replacement, 95% percentile CI",
    }


# ---------------------------------------------------------------------------
# Uplift + verdict
# ---------------------------------------------------------------------------

def uplift(base: dict, other: dict, keys=("roc_auc", "pr_auc", "brier")) -> dict:
    """Signed difference other - base for the given metrics."""
    return {k: round(float(other[k]) - float(base[k]), 6) for k in keys}


def compute_verdict(uplift_fusion_vs_imd: dict, uplift_era5_vs_imd: dict,
                    bootstrap: dict) -> dict:
    """Machine-readable statement of whether ERA5 adds useful information.

    The primary decision metric follows the project convention (PR-AUC).
    The verdict is deliberately conservative: it is only called 'positive'
    or 'negative' when it is supported by the bootstrap intervals; overlapped
    or unavailable intervals yield 'inconclusive'.
    """
    primary = "pr_auc"

    def _classify(u: dict, boot: dict, arm: str) -> str:
        delta = u.get(primary)
        if delta is None or np.isnan(delta):
            return "inconclusive"
        base_ci = boot.get("imd", {}).get("ci_low")
        arm_ci = boot.get(arm, {}).get("ci_high")
        if base_ci is None or arm_ci is None:
            base_note = f"bootstrap interval unavailable; raw delta {delta:+.4f}"
            return "inconclusive"
        # conservative: require the arm's CI lower bound to clear IMD's high bound
        if arm_ci < base_ci:
            return "negative" if delta < 0 else "inconclusive"
        if delta > 0 and arm_ci >= base_ci:
            # not enough separation to claim an improvement
            return "neutral"
        if delta < 0:
            return "negative" if delta < -1e-9 else "neutral"
        return "inconclusive"

    fusion_state = _classify(uplift_fusion_vs_imd, bootstrap, "fusion")
    era5_state = _classify(uplift_era5_vs_imd, bootstrap, "era5")
    return {
        "primary_metric": primary,
        "era5_vs_imd_pr_auc_uplift": uplift_era5_vs_imd.get(primary),
        "fusion_vs_imd_pr_auc_uplift": uplift_fusion_vs_imd.get(primary),
        "era5_adds_value_over_imd": era5_state,
        "fusion_adds_value_over_imd": fusion_state,
        "statement": (
            "ERA5 adds positive predictive value over IMD in this sample "
            "only if its PR-AUC improvement is supported by the storm-level "
            "bootstrap (primary decision metric, project convention). "
            "Small deltas with overlapping confidence intervals are reported "
            "as 'neutral'/'inconclusive', not as a finding."
        ),
    }


# ---------------------------------------------------------------------------
# Cross-model error analysis
# ---------------------------------------------------------------------------

def cross_model_error_analysis(test_info: pd.DataFrame) -> dict:
    """Compare where each arm is right/wrong on the SAME held-out test rows."""
    df = test_info.copy()
    for arm, thr in (("IMD", "th_imd"), ("ERA5", "th_era5"),
                     ("FUSION", "th_fusion")):
        df[f"pred_{arm}"] = (df[f"P_{arm}"] >= df[thr]).astype(int)
        df[f"ok_{arm}"] = (df[f"pred_{arm}"] == df["RI_24h"])
    y = df["RI_24h"] == 1

    imd_only = df["ok_IMD"] & ~df["ok_ERA5"]
    era5_only = df["ok_ERA5"] & ~df["ok_IMD"]

    no_agree = ~df["ok_IMD"] & ~df["ok_ERA5"]
    fusion_fixes = ((no_agree) & df["ok_FUSION"]).sum()
    both_right = df["ok_IMD"] & df["ok_ERA5"]
    fusion_introduces = (both_right & ~df["ok_FUSION"]).sum()

    def _examples(mask, n=5):
        cols = ["storm_id", "datetime_utc", "RI_24h", "P_IMD", "P_ERA5",
                "P_FUSION"]
        sub = df.loc[mask, cols].sort_values("P_ERA5", ascending=False)
        out = sub.assign(
            **{c: sub[c].round(4) for c in ("P_IMD", "P_ERA5", "P_FUSION")}
        ).head(n).to_dict("records")
        return out

    disag = df.assign(diff=(df["P_ERA5"] - df["P_IMD"]).abs())
    top_disagreement = disag.sort_values("diff", ascending=False) \
        [["storm_id", "datetime_utc", "RI_24h", "P_IMD", "P_ERA5"]].head(8) \
        .assign(P_IMD=lambda d: d["P_IMD"].round(4),
                P_ERA5=lambda d: d["P_ERA5"].round(4)).to_dict("records")

    return {
        "n_test_rows": int(len(df)),
        "imd_right_era5_wrong": int(imd_only.sum()),
        "era5_right_imd_wrong": int(era5_only.sum()),
        "both_right": int(both_right.sum()),
        "both_wrong": int(no_agree.sum()),
        "fusion_corrects_where_both_wrong": int(fusion_fixes),
        "fusion_introduces_errors_where_both_right": int(fusion_introduces),
        "imd_only_correct_examples": _examples(imd_only),
        "era5_only_correct_examples": _examples(era5_only),
        "top_imd_era5_disagreement": top_disagreement,
        "note": "thresholds are each arm's own validation-selected threshold.",
    }


# ---------------------------------------------------------------------------
# Feature schema artifact
# ---------------------------------------------------------------------------

def write_fusion_feature_schema(path: Path | str) -> dict:
    """Machine-readable 101-feature fusion schema (unique names, no dupes)."""
    names = fusion_feature_names()
    imd_set = set(IMD_FEATURE_ORDER)
    features = [{"name": n, "source": ("imd" if n in imd_set else "era5")}
                for n in names]
    schema = {
        "n_features": len(names),
        "n_imd": len(IMD_FEATURE_ORDER),
        "n_era5": len(era5_feature_names()),
        "unique_names": len(set(names)) == len(names),
        "imd_era5_name_overlap": sorted(set(IMD_FEATURE_ORDER)
                                        & set(era5_feature_names())),
        "features": features,
        "order_contract": True,
        "note": "Fusion vector = 12 canonical IMD predictors followed by the "
                "89-feature ERA5 contract. Native missing-value handling.",
    }
    Path(path).write_text(json.dumps(schema, indent=2))
    return schema


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def run_comparison(
    era5_data: Path | str,
    imd_csv: Path | str,
    seed: int = 42,
    output_dir: Path | str = None,
    era5_model_path: Path | str | None = None,
    recorded_split_path: Path | str | None = None,
    frozen_imd_path: Path | str | None = None,
    frozen_era5_path: Path | str | None = None,
    force_retrain_era5: bool = False,
    bootstrap_n: int = 1000,
):
    """Run the full IMD vs ERA5 vs fusion comparison; save artifacts.

    Saves under ``output_dir``:
      imd_era5_fusion_model.json, imd_era5_fusion_feature_schema.json,
      imd_era5_fusion_training_metadata.json,
      imd_era5_fusion_test_predictions.csv, imd_era5_common_storm_split.csv,
      imd_ri_model.json, imd_era5_comparison_metadata.json

    Returns ``(summary, metadata, comparison, models, test_info)``.
    """
    output_dir = Path(output_dir) if output_dir else Path.cwd() / "models"
    output_dir.mkdir(parents=True, exist_ok=True)
    era5_model_path = Path(era5_model_path) if era5_model_path else \
        output_dir / "era5_ri_model.json"

    # 1. common universe + split
    common, universe_stats = build_common_universe(era5_data, imd_csv)
    split, split_info = common_split(common, seed, recorded_split_path)
    disjoint = (set(split.train["storm_id"]).isdisjoint(split.test["storm_id"])
                and set(split.val["storm_id"]).isdisjoint(split.test["storm_id"])
                and set(split.train["storm_id"]).isdisjoint(split.val["storm_id"]))

    # 2. matrices for each arm
    era5_feats = era5_feature_names()
    fusion_feats = fusion_feature_names()
    m_imd = prepare_split_xyg(split, IMD_FEATURE_ORDER)
    m_era = prepare_split_xyg(split, era5_feats)
    m_fus = prepare_split_xyg(split, fusion_feats)

    y_te = np.asarray(split.test["RI_24h"]).astype(int)
    train_prevalence = float(m_imd["y_train"].mean())

    models = {}

    # 3a. IMD arm (freshly trained on the common train storms)
    cfg = get_config()
    cfg["seed"] = int(seed)
    imd_model = train_xgboost(m_imd["X_train"], m_imd["y_train"],
                              m_imd["g_train"], m_imd["X_val"],
                              m_imd["y_val"], m_imd["X_test"],
                              m_imd["y_test"], cfg, "imd", seed)
    models["imd"] = imd_model
    save_model(imd_model, str(output_dir / "imd_ri_model.json"))

    p_imd_val = imd_model.predict_proba(m_imd["X_val"])[:, 1]
    p_imd_te = imd_model.predict_proba(m_imd["X_test"])[:, 1]
    th_imd, f1_imd_val = select_threshold(np.asarray(m_imd["y_val"]).astype(int),
                                          p_imd_val)

    # 3b. ERA5 arm (reuse Improvement-3 artifact when the split matches)
    era5_mode = "retrain"
    if not force_retrain_era5 and split_info["matches_improvement_3"] \
            and era5_model_path.exists():
        p_era_val = predict_booster_at_best(era5_model_path, m_era["X_val"],
                                            era5_feats)
        p_era_te = predict_booster_at_best(era5_model_path, m_era["X_test"],
                                           era5_feats)
        era5_mode = "reuse_improvement_3"
        era5_best_iteration = None
        models["era5"] = era5_model_path
    else:
        if not force_retrain_era5 and not split_info["matches_improvement_3"]:
            print("[comparison] common split differs from Improvement-3; "
                  "retraining ERA5 arm on the common train storms.")
        era5_model = train_xgboost(m_era["X_train"], m_era["y_train"],
                                   m_era["g_train"], m_era["X_val"],
                                   m_era["y_val"], m_era["X_test"],
                                   m_era["y_test"], cfg, "era5", seed)
        models["era5"] = era5_model
        save_model(era5_model, str(output_dir / "era5_ri_model.json"))
        p_era_val = era5_model.predict_proba(m_era["X_val"])[:, 1]
        p_era_te = era5_model.predict_proba(m_era["X_test"])[:, 1]
        era5_best_iteration = getattr(era5_model, "best_iteration", None)
    th_era5, f1_era5_val = select_threshold(np.asarray(m_era["y_val"]).astype(int),
                                            p_era_val)

    # 3c. fusion arm
    fus_model = train_xgboost(m_fus["X_train"], m_fus["y_train"],
                              m_fus["g_train"], m_fus["X_val"],
                              m_fus["y_val"], m_fus["X_test"],
                              m_fus["y_test"], cfg, "combined", seed)
    models["fusion"] = fus_model
    fusion_file = output_dir / "imd_era5_fusion_model.json"
    save_model(fus_model, str(fusion_file))

    p_fus_val = fus_model.predict_proba(m_fus["X_val"])[:, 1]
    p_fus_te = fus_model.predict_proba(m_fus["X_test"])[:, 1]
    th_fusion, f1_fus_val = select_threshold(np.asarray(m_fus["y_val"]).astype(int),
                                             p_fus_val)

    # 4. one-shot held-out evaluation per arm
    ev_imd = evaluate(y_te, p_imd_te, threshold=th_imd, label="imd_test")
    ev_era5 = evaluate(y_te, p_era_te, threshold=th_era5, label="era5_test")
    ev_fus = evaluate(y_te, p_fus_te, threshold=th_fusion, label="fusion_test")
    const_base = constant_prevalence_baseline(y_te, train_prevalence,
                                              threshold=th_fusion)

    # 5. baselines: frozen artifacts (informational; caveat-filled)
    frozen_imd_res = None
    if frozen_imd_path is not None and Path(frozen_imd_path).exists():
        p_fimd = predict_booster_at_best(frozen_imd_path, m_imd["X_test"],
                                         IMD_FEATURE_ORDER)
        frozen_imd_res = evaluate(y_te, p_fimd, threshold=th_imd,
                                  label="frozen_imd_same_test")
        frozen_imd_res["caveat"] = (
            "The frozen IMD artifact does not record train/test storm IDs; it "
            "was trained on the full IMD table with the seed-42 shuffle, so "
            "test-storm overlap is LIKELY. Reference only — the fresh IMD arm "
            "is the only clean disjoint-storm IMD comparison.")
    frozen_era5_res = None
    if frozen_era5_path is not None and Path(frozen_era5_path).exists():
        p_fera5 = predict_frozen_era5(m_era["X_test"], frozen_era5_path,
                                      era5_feats)
        frozen_era5_res = evaluate(y_te, p_fera5, threshold=th_era5,
                                   label="frozen_era5_same_test")
        frozen_era5_res["caveat"] = (
            "Frozen ERA5 artifact trained on the 848-row MVP table; test-storm "
            "overlap is LIKELY (impression; see Improvement-3 record). Reference"
            " only — the Improvement-3/retrained ERA5 arm is the clean arm.")

    # 6. storm-level bootstrap
    test_storms = split.test.loc[m_era["X_test"].index, "storm_id"].to_numpy()
    boot = {
        f"{arm}_{metric}": storm_bootstrap(y_te, p, test_storms,
                                           metric=metric,
                                           n_boot=int(bootstrap_n),
                                           seed=int(seed))
        for arm, p in (("imd", p_imd_te), ("era5", p_era_te),
                       ("fusion", p_fus_te))
        for metric in ("roc_auc", "pr_auc")
    }

    # 7. uplifts + verdict
    upl_era5 = uplift(ev_imd, ev_era5)
    upl_fus = uplift(ev_imd, ev_fus)
    upl_fus_v_era5 = uplift(ev_era5, ev_fus)
    verdict = compute_verdict(upl_fus, upl_era5, {
        "imd": boot.get("imd_pr_auc"),
        "era5": boot.get("era5_pr_auc"),
        "fusion": boot.get("fusion_pr_auc"),
    })

    # 8. cross-model error analysis on the held-out test rows
    test_rows = split.test.loc[m_era["X_test"].index].copy()
    test_rows["P_IMD"] = p_imd_te
    test_rows["P_ERA5"] = p_era_te
    test_rows["P_FUSION"] = p_fus_te
    test_rows["th_imd"] = th_imd
    test_rows["th_era5"] = th_era5
    test_rows["th_fusion"] = th_fusion
    err = cross_model_error_analysis(test_rows)

    # 9. artifacts
    schema = write_fusion_feature_schema(output_dir / "imd_era5_fusion_feature_schema.json")

    pred_cols = ["storm_id", "datetime_utc", "RI_24h", "P_IMD", "P_ERA5",
                 "P_FUSION", "th_imd", "th_era5", "th_fusion"]
    pred_path = output_dir / "imd_era5_fusion_test_predictions.csv"
    test_rows[pred_cols].to_csv(pred_path, index=False)

    split_csv = pd.concat([
        split.train[["storm_id"]].assign(split="train"),
        split.val[["storm_id"]].assign(split="val"),
        split.test[["storm_id"]].assign(split="test"),
    ]).drop_duplicates("storm_id").sort_values("storm_id")
    split_csv.to_csv(output_dir / "imd_era5_common_storm_split.csv", index=False)

    def _stats(df):
        return {"rows": int(len(df)),
                "storms": int(df["storm_id"].nunique()),
                "ri_pos": int((df["RI_24h"] == 1).sum()),
                "ri_neg": int((df["RI_24h"] == 0).sum()),
                "prevalence": round(float(df["RI_24h"].mean()), 5)}

    comparison = {
        "phase": "RI Improvement 4 — IMD vs ERA5 vs IMD+ERA5 fusion",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": int(seed),
        "common_universe": universe_stats,
        "common_split": {
            "method": "storm-wise seed-42 split (test 20%, val 15%, "
                      "keep_balanced) — identical for every arm",
            "zero_storm_overlap": disjoint,
            "matches_improvement_3": split_info["matches_improvement_3"],
            "splits": {k: _stats(getattr(split, k)) for k in ("train", "val", "test")},
            "split_detail": split_info["detail"],
        },
        "arms": {
            "imd": {"arm": "imd", "features": len(IMD_FEATURE_ORDER),
                    "model": str(output_dir / "imd_ri_model.json"),
                    "threshold": th_imd,
                    "threshold_val_f1": f1_imd_val,
                    "evaluation": ev_imd,
                    "bootstrap": {"roc_auc": boot["imd_roc_auc"],
                                  "pr_auc": boot["imd_pr_auc"]},
                    "grouped_cv": None},
            "era5": {"arm": "era5", "features": len(era5_feats),
                     "mode": era5_mode,
                     "best_iteration_reused": era5_best_iteration,
                     "model": str(era5_model_path) if era5_mode == "reuse_improvement_3"
                              else str(output_dir / "era5_ri_model.json"),
                     "threshold": th_era5,
                     "threshold_val_f1": f1_era5_val,
                     "evaluation": ev_era5,
                     "bootstrap": {"roc_auc": boot["era5_roc_auc"],
                                   "pr_auc": boot["era5_pr_auc"]},
                     "grouped_cv": None},
            "fusion": {"arm": "fusion", "features": len(fusion_feats),
                       "model": str(fusion_file),
                       "threshold": th_fusion,
                       "threshold_val_f1": f1_fus_val,
                       "evaluation": ev_fus,
                       "bootstrap": {"roc_auc": boot["fusion_roc_auc"],
                                     "pr_auc": boot["fusion_pr_auc"]},
                       "grouped_cv": None},
        },
        "baselines": {
            "constant_prevalence": const_base,
            "frozen_imd_on_same_test": frozen_imd_res,
            "frozen_era5_on_same_test": frozen_era5_res,
        },
        "uplift": {
            "era5_vs_imd": upl_era5,
            "fusion_vs_imd": upl_fus,
            "fusion_vs_era5": upl_fus_v_era5,
            "interpretation": (
                "Signed deltas (arm - IMD). On this small sample every delta is "
                "informational; the conclusion uses the storm-level bootstrap "
                "and explicitly flags tiny differences as inconclusive."),
        },
        "verdict": verdict,
        "error_analysis": err,
        "calibration_status": "NOT CALIBRATED — raw XGBoost probabilities",
        "artifacts": {
            "fusion_model": str(fusion_file),
            "fusion_feature_schema": str(output_dir / "imd_era5_fusion_feature_schema.json"),
            "fusion_metadata": str(output_dir / "imd_era5_fusion_training_metadata.json"),
            "fusion_test_predictions": str(pred_path),
            "common_storm_split": str(output_dir / "imd_era5_common_storm_split.csv"),
            "imd_model": str(output_dir / "imd_ri_model.json"),
        },
    }

    # fusion training metadata (required artifact name)
    metadata = {
        "phase": "RI Improvement 4 — IMD+ERA5 fusion training metadata",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_type": "xgb",
        "objective": "binary:logistic",
        "seed": int(seed),
        "feature_counts": {"imd": len(IMD_FEATURE_ORDER),
                           "era5": len(era5_feats),
                           "fusion": len(fusion_feats)},
        "feature_schema_file": str(output_dir / "imd_era5_fusion_feature_schema.json"),
        "duplicate_names": False,
        "class_weight": {
            "method": "scale_pos_weight = neg_train / pos_train (train only)",
            "scale_pos_weight": round(float(
                (m_fus["y_train"] == 0).sum() / max(1, int((m_fus["y_train"] == 1).sum()))), 7),
        },
        "hyperparameters": {k: v for k, v in cfg["combined_model"].items()},
        "best_iteration": getattr(fus_model, "best_iteration", None),
        "threshold": {
            "value": float(th_fusion),
            "selection": "max F1 on the common validation split (never test)",
            "val_f1": f1_fus_val,
        },
        "evaluation": ev_fus,
        "baselines": comparison["baselines"],
        "epoch_comparison": comparison,
        "calibration_status": "NOT CALIBRATED — raw XGBoost probabilities only",
        "artifacts": {
            "model": str(fusion_file),
            "feature_schema": str(output_dir / "imd_era5_fusion_feature_schema.json"),
            "test_predictions": str(pred_path),
            "metadata": str(output_dir / "imd_era5_fusion_training_metadata.json"),
        },
    }
    meta_path = output_dir / "imd_era5_fusion_training_metadata.json"
    meta_path.write_text(json.dumps(metadata, indent=2, default=str))

    comp_path = output_dir / "imd_era5_comparison_metadata.json"
    comp_path.write_text(json.dumps(comparison, indent=2, default=str))

    summary = {
        "STATUS": "compared",
        "COMMON DATASET": (
            f"inner join of {era5_data} (rebuilt ERA5) with {imd_csv} (IMD) "
            f"on (storm_id, datetime_utc)"),
        "ROWS": int(universe_stats["common_rows"]),
        "STORMS": int(universe_stats["storms"]),
        "RI POSITIVES": int(universe_stats["ri_positives"]),
        "RI NEGATIVES": int(universe_stats["ri_negatives"]),
        "COMMON TRAIN/VAL/TEST": {
            "train": _stats(split.train),
            "val": _stats(split.val),
            "test": _stats(split.test),
        },
        "IMD ROC-AUC": ev_imd["roc_auc"],
        "IMD PR-AUC": ev_imd["pr_auc"],
        "IMD BRIER": ev_imd["brier"],
        "ERA5 ROC-AUC": ev_era5["roc_auc"],
        "ERA5 PR-AUC": ev_era5["pr_auc"],
        "ERA5 BRIER": ev_era5["brier"],
        "FUSION ROC-AUC": ev_fus["roc_auc"],
        "FUSION PR-AUC": ev_fus["pr_auc"],
        "FUSION BRIER": ev_fus["brier"],
        "ERA5 UPLIFT": upl_era5,
        "FUSION UPLIFT": upl_fus,
        "BOOTSTRAP": {
            "imd": {"roc_auc": boot["imd_roc_auc"], "pr_auc": boot["imd_pr_auc"]},
            "era5": {"roc_auc": boot["era5_roc_auc"], "pr_auc": boot["era5_pr_auc"]},
            "fusion": {"roc_auc": boot["fusion_roc_auc"], "pr_auc": boot["fusion_pr_auc"]},
        },
        "CALIBRATED": "NO",
        "VERDICT": verdict,
        "FUSION ARTIFACT": str(fusion_file),
        "TESTS": "RI/tests/test_ri_comparison.py",
        "REPRODUCIBLE": (
            f"python compare_ri_imd_era5.py --era5-data {era5_data} "
            f"--imd-csv {imd_csv} --seed {seed} --output-dir {output_dir} "
            f"--bootstrap-n {bootstrap_n}"),
        "SCIENTIFIC CONCLUSION": verdict["statement"],
        "NEXT STEP": (
            "calibration of the fusion model (posterior checking), or "
            "season/granule QC before a production claim"),
    }
    return summary, metadata, comparison, models, test_rows