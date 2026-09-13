"""RI Improvement 4: IMD vs ERA5 vs IMD+ERA5 fusion comparison tests.

A session-scoped fixture runs the full comparison once into a temp dir; every
test then inspects the artifacts. The ERA5 arm reuses the Improvement-3 model
(the common split must verify as identical), so only the IMD and fusion arms
are freshly trained.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import importlib.util
import numpy as np
import pandas as pd
import pytest

# The repo lives with two top-level `src` packages: RI/src (models.py is a
# module) and the root src (models/ is a package). test_era5_training.py wires
# the root adapter by swapping sys.modules['src.models'] to the ROOT package,
# which does not export the RI training helpers. When this module is collected
# after that wiring in the same process, the RI comparison import would break,
# so re-bind `src.models` to RI's models.py if needed (self-healing; no-op in
# a standalone run).
_ri_models_path = str(ROOT / "src" / "models.py")
_cur_models = sys.modules.get("src.models")
if _cur_models is None or str(getattr(_cur_models, "__file__", "")) != _ri_models_path:
    _src = sys.modules.get("src")
    if _src is None:
        import src as _src
    _spec = importlib.util.spec_from_file_location(
        "src.models", _ri_models_path)
    _models = importlib.util.module_from_spec(_spec)
    sys.modules["src.models"] = _models
    setattr(_src, "models", _models)  # keep parent attr in sync
    _spec.loader.exec_module(_models)

from src.ri_comparison import (  # noqa: E402
    build_common_universe,
    common_split,
    fusion_feature_names,
    imd_feature_order,
    run_comparison,
)
from src.data import IMD_FEATURE_COLS  # noqa: E402
from src.era5_training import (  # noqa: E402
    FORBIDDEN_PREDICTOR_COLS,
    era5_feature_names,
    select_threshold,
)

DATASET = ROOT / "era5_datasets" / "era5_ri_rebuilt.csv"
IMD_CSV = ROOT / "models" / "IMD_BoB_RI_training_base.csv"
ERA5_MODEL = ROOT / "models" / "era5_ri_model.json"
RECORDED_SPLIT = ROOT / "models" / "era5_ri_storm_split.csv"
FROZEN_IMD = ROOT / "models" / "imd_final_xgboost.json"
FROZEN_ERA5 = ROOT / "models" / "era5_final_xgboost.json"
SEED = 42


@pytest.fixture(scope="session")
def comparison(tmp_path_factory):
    """One full comparison run (bootstrap kept small for suite speed)."""
    out = tmp_path_factory.mktemp("ri_comp")
    summary, metadata, comp, models, test_rows = run_comparison(
        era5_data=DATASET, imd_csv=IMD_CSV, seed=SEED, output_dir=out,
        era5_model_path=ERA5_MODEL, recorded_split_path=RECORDED_SPLIT,
        frozen_imd_path=FROZEN_IMD, frozen_era5_path=FROZEN_ERA5,
        force_retrain_era5=False, bootstrap_n=50)
    return {
        "out": out,
        "summary": summary,
        "metadata": metadata,
        "comparison": comp,
        "models": models,
        "test_rows": test_rows,
    }


class TestCommonUniverse:
    def test_era5_imd_1to1_join_no_loss(self):
        """Every rebuilt ERA5 row must match an IMD row with an identical RI."""
        common, stats = build_common_universe(DATASET, IMD_CSV)
        assert len(common) == 870
        assert stats["rows_lost"] == 0
        assert stats["storms"] == 126
        assert stats["ri_positives"] == 82
        assert stats["ri_negatives"] == 788
        assert (common["RI_24h_era"].astype(int) == common["RI_24h"].astype(int)).all()

    def test_no_imputation_of_missing_modality(self, comparison):
        """Native missing-value handling: no fabricated rows, missingness reported."""
        c = comparison["comparison"]
        missing = c["common_universe"]["imd_missingness"]
        assert missing["n_rows"] == 870
        assert 0 <= missing["rows_with_all_12_imd_features"] <= 870
        assert "No imputation of whole modalities" in missing["note"]

    def test_common_universe_contains_both_feature_sets(self):
        """The universe provides all 89 ERA5 + all 12 IMD predictor columns."""
        common, _ = build_common_universe(DATASET, IMD_CSV)
        for c in era5_feature_names():
            assert c in common.columns
        for c in IMD_FEATURE_COLS:
            assert c in common.columns


class TestCommonSplit:
    def test_zero_storm_overlap(self, comparison):
        c = comparison["comparison"]
        assert c["common_split"]["zero_storm_overlap"] is True
        # verify via the recorded common split file
        df = pd.read_csv(ROOT / "models" / "imd_era5_common_storm_split.csv")
        tr_s = set(df[df.split == "train"].storm_id)
        va_s = set(df[df.split == "val"].storm_id)
        te_s = set(df[df.split == "test"].storm_id)
        assert tr_s.isdisjoint(va_s)
        assert tr_s.isdisjoint(te_s)
        assert va_s.isdisjoint(te_s)

    def test_matches_improvement_3(self, comparison):
        assert comparison["comparison"]["common_split"]["matches_improvement_3"] is True
        # identical train/val/test row counts to Improvement-3 record
        s = comparison["comparison"]["common_split"]["splits"]
        assert (s["train"]["rows"], s["train"]["storms"]) == (587, 82)
        assert (s["val"]["rows"], s["val"]["storms"]) == (106, 19)
        assert (s["test"]["rows"], s["test"]["storms"]) == (177, 25)


class TestFeatureContract:
    def test_fusion_101_unique_features(self):
        names = fusion_feature_names()
        assert len(names) == 101
        assert len(set(names)) == len(names)
        assert names[:12] == list(IMD_FEATURE_COLS)
        assert names[12:] == era5_feature_names()

    def test_no_imd_era5_name_overlap(self, comparison):
        schema = json.loads(
            (comparison["out"] / "imd_era5_fusion_feature_schema.json").read_text())
        assert schema["n_features"] == 101
        assert schema["unique_names"] is True
        assert schema["imd_era5_name_overlap"] == []

    def test_no_forbidden_columns(self):
        """No arm may leak identity/target/provenance columns.

        latitude/longitude are legitimate IMD predictors (part of the frozen
        IMD model); the ERA5 contract deliberately excludes them. The
        forbidden columns are the id/target/provenance columns, which must
        never appear in any arm.
        """
        forbidden_universal = set(FORBIDDEN_PREDICTOR_COLS) - {"latitude", "longitude"}
        for names in (imd_feature_order(), era5_feature_names(), fusion_feature_names()):
            assert not (set(names) & forbidden_universal)
        # the ERA5 arm keeps the full (stricter) ERA5 contract
        assert not (set(era5_feature_names()) & set(FORBIDDEN_PREDICTOR_COLS))
        # lat/lon appear BY DESIGN in the IMD and fusion arms only
        assert {"latitude", "longitude"} <= set(imd_feature_order())
        assert {"latitude", "longitude"} <= set(fusion_feature_names())

    def test_fusion_model_uses_101_features(self, comparison):
        import xgboost as xgb
        booster = xgb.Booster()
        booster.load_model(str(comparison["out"] / "imd_era5_fusion_model.json"))
        assert list(booster.feature_names) == fusion_feature_names()


class TestArmsAndEvaluation:
    def test_identical_test_storms_for_all_arms(self, comparison):
        pred = pd.read_csv(
            comparison["out"] / "imd_era5_fusion_test_predictions.csv")
        sp = pd.read_csv(ROOT / "models" / "imd_era5_common_storm_split.csv")
        te = set(sp[sp.split == "test"].storm_id)
        assert set(pred.storm_id.astype(str)) == te
        assert len(pred) == 177

    def test_era5_arm_reuses_improvement3_model(self, comparison):
        a = comparison["comparison"]["arms"]["era5"]
        assert a["mode"] == "reuse_improvement_3"
        assert a["evaluation"]["roc_auc"] == pytest.approx(0.5871052631578947)

    def test_threshold_from_validation_only(self, comparison):
        """Recomputing max-F1 threshold on the val predictions reproduces the
        recorded threshold (i.e. it was selected on the validation split)."""
        fusion = comparison["models"]["fusion"]
        # rebuild val predictions
        common, _ = build_common_universe(DATASET, IMD_CSV)
        split, _ = common_split(common, SEED, RECORDED_SPLIT)
        Xv = split.val[fusion_feature_names()]
        p_val = fusion.predict_proba(Xv)[:, 1]
        thr, _ = select_threshold(np.asarray(split.val["RI_24h"]).astype(int), p_val)
        rec = comparison["comparison"]["arms"]["fusion"]["threshold"]
        assert thr == pytest.approx(float(rec), abs=1e-9)
        meta = json.loads(
            (comparison["out"] / "imd_era5_fusion_training_metadata.json").read_text())
        assert "validation" in meta["threshold"]["selection"]

    def test_constant_baseline_honest_prevalence(self, comparison):
        """The constant baseline assigns the TRAIN prevalence (no leak), so
        its PR-AUC equals the data prevalence while ROC-AUC is 0.5 by
        construction (repo convention, see Improvement-3 record)."""
        const = comparison["comparison"]["baselines"]["constant_prevalence"]
        test_prev = comparison["comparison"]["arms"]["fusion"]["evaluation"]["prevalence"]
        train_prev = comparison["comparison"]["common_split"]["splits"]["train"]["prevalence"]
        # AP of a constant predictor = class prevalence of the data it scores
        assert const["pr_auc"] == pytest.approx(test_prev, abs=1e-5)
        assert const["roc_auc"] == pytest.approx(0.5, abs=1e-9)
        # but the ASSIGNED probability is the train prevalence (honest, no leak)
        c = train_prev
        expected_brier = c ** 2 * (1 - test_prev) + (1 - c) ** 2 * test_prev
        assert const["brier"] == pytest.approx(expected_brier, abs=1e-5)

    def test_frozen_vs_fair_separation(self, comparison):
        """Frozen artifacts are clearly labelled as confounded references and
        kept separate from the fair arms."""
        bases = comparison["comparison"]["baselines"]
        assert "frozen_imd_on_same_test" in bases
        assert "frozen_era5_on_same_test" in bases
        for res in (bases["frozen_imd_on_same_test"], bases["frozen_era5_on_same_test"]):
            assert res is not None
            assert "overlap is LIKELY" in res["caveat"]


class TestBootstrapAndArtifacts:
    def test_bootstrap_ci_present_all_arms(self, comparison):
        arms = comparison["comparison"]["arms"]
        for arm in ("imd", "era5", "fusion"):
            for metric in ("roc_auc", "pr_auc"):
                b = arms[arm]["bootstrap"][metric]
                assert b["n_used"] > 0
                assert b["ci_low"] is not None and b["ci_high"] is not None

    def test_required_artifacts_written(self, comparison):
        expected = [
            "imd_era5_fusion_model.json",
            "imd_era5_fusion_feature_schema.json",
            "imd_era5_fusion_training_metadata.json",
            "imd_era5_fusion_test_predictions.csv",
            "imd_era5_common_storm_split.csv",
        ]
        for name in expected:
            assert (comparison["out"] / name).exists(), f"missing {name}"

    def test_verdict_is_explicit(self, comparison):
        v = comparison["comparison"]["verdict"]
        for key in ("era5_adds_value_over_imd", "fusion_adds_value_over_imd"):
            assert v[key] in {"positive", "negative", "neutral", "inconclusive"}


class TestCrossModelErrors:
    def test_error_analysis_on_same_rows(self, comparison):
        e = comparison["comparison"]["error_analysis"]
        assert e["n_test_rows"] == 177
        together = (e["imd_right_era5_wrong"] + e["era5_right_imd_wrong"]
                    + e["both_right"] + e["both_wrong"])
        assert together == 177