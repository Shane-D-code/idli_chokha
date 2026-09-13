"""RI Improvement 3: ERA5 training + evaluation tests.

One session-scoped fixture runs the full training pipeline once into a temp
dir; every test then inspects the artifacts (no per-test retraining).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd
import pytest
import xgboost as xgb

from src.config import get_config  # noqa: E402
from src.era5_training import (  # noqa: E402
    FORBIDDEN_PREDICTOR_COLS,
    class_weight_from_train,
    era5_feature_names,
    load_rebuilt_dataset,
    run_training,
    select_threshold,
    storm_split,
)


def _wire_root_src_adapter():
    """Make the repo-root ``src.models.adapters.ri_adapter`` importable.

    Both ``RI/src`` and the repo-root ``src`` are top-level packages named
    ``src``, and ``RI/src/models.py`` would otherwise shadow the root
    ``src.models`` package. The RI modules are imported *first* (they bind
    ``from src.models import train_xgboost`` to RI's module), then the root
    ``src`` path is appended and ``sys.modules['src.models']`` is swapped for
    the root package so the runtime adapter can be exercised.
    """
    import importlib.util
    import sys

    root_src = ROOT.parent / "src"
    assert "src" in sys.modules, "import RI src modules before wiring"
    src = sys.modules["src"]
    if str(root_src) not in src.__path__:
        src.__path__.append(str(root_src))
    models_init = root_src / "models" / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "src.models", str(models_init),
        submodule_search_locations=[str(root_src / "models")])
    models = importlib.util.module_from_spec(spec)
    sys.modules["src.models"] = models
    spec.loader.exec_module(models)


_wire_root_src_adapter()  # must run AFTER the RI src imports above
from src.models.adapters.ri_adapter import RIBranchModel  # noqa: E402

DATASET = ROOT / "era5_datasets" / "era5_ri_rebuilt.csv"
FROZEN = ROOT / "models" / "era5_final_xgboost.json"
SEED = 42


@pytest.fixture(scope="session")
def training(tmp_path_factory):
    """One full training run with the deployed frozen baseline."""
    out = tmp_path_factory.mktemp("era5_train")
    summary, metadata, model, split, test_rows = run_training(
        dataset_path=DATASET, seed=SEED, output_dir=out,
        frozen_model=FROZEN, return_data=True)
    return {
        "out": out,
        "summary": summary,
        "metadata": metadata,
        "model": model,
        "split": split,
        "test_rows": test_rows,
        "df": load_rebuilt_dataset(DATASET),
    }


class TestFeatureContract:
    def test_predictors_are_exactly_89(self, training):
        names = era5_feature_names()
        assert len(names) == 89
        df = training["df"]
        feats = [c for c in df.columns if c in set(names)]
        assert feats == names
        # the PREDICTOR set must never contain id/target/provenance columns
        forbidden = {"storm_id", "RI_24h", "bilinear_cells", "provenance_status"}
        assert not (set(names) & forbidden)

    def test_order_matches_frozen_model(self):
        frozen = xgb.Booster()
        frozen.load_model(str(FROZEN))
        assert list(frozen.feature_names) == era5_feature_names()

    def test_schema_artifact_contract(self, training):
        schema = json.loads(
            (training["out"] / "era5_ri_feature_schema.json").read_text())
        assert schema["n_features"] == 89
        assert schema["order_contract"] is True
        assert [f["name"] for f in schema["features"]] == era5_feature_names()

    def test_no_forbidden_predictor_columns(self, training):
        """Neither the training X matrix nor the saved schema may contain
        provenance / id / target columns."""
        df = training["df"]
        for col in FORBIDDEN_PREDICTOR_COLS:
            assert col not in era5_feature_names()
        frozen = xgb.Booster()
        frozen.load_model(str(FROZEN))
        model_feats = set(frozen.feature_names)
        assert not (model_feats & set(FORBIDDEN_PREDICTOR_COLS))
        schema = json.loads(
            (training["out"] / "era5_ri_feature_schema.json").read_text())
        schema_feats = set(f["name"] for f in schema["features"])
        assert not (schema_feats & set(FORBIDDEN_PREDICTOR_COLS))

    def test_predictor_set_is_subset_of_dataset_columns(self, training):
        """Every predictor must be a real dataset column (no fabricated inputs)."""
        df = training["df"]
        names = set(era5_feature_names())
        assert names <= set(df.columns)
        assert len(names) == 89


class TestStormSplit:
    def test_zero_overlap(self, training):
        m = training["metadata"]["splits"]
        tr, va, te = set(m["train_storm_ids"]), set(m["val_storm_ids"]), \
            set(m["test_storm_ids"])
        assert tr & va == set()
        assert tr & te == set()
        assert va & te == set()
        assert len(tr | va | te) == training["df"]["storm_id"].nunique()

    def test_deterministic_same_seed(self, training):
        df = training["df"]
        s1 = storm_split(df, seed=SEED)
        s2 = storm_split(df, seed=SEED)
        assert s1.train_storms == s2.train_storms
        assert s1.val_storms == s2.val_storms
        assert s1.test_storms == s2.test_storms

    def test_seed_changes_split(self, training):
        df = training["df"]
        s42 = storm_split(df, seed=42)
        s43 = storm_split(df, seed=43)
        assert s42.test_storms != s43.test_storms

    def test_split_totals(self, training):
        m = training["metadata"]["splits"]
        total_rows = sum(m[k]["rows"] for k in ("train", "val", "test"))
        assert total_rows == len(training["df"])

    def test_storm_split_csv_matches_metadata(self, training):
        out = training["out"]
        split_csv = pd.read_csv(out / "era5_ri_storm_split.csv")
        assert set(split_csv["split"].unique()) == {"train", "val", "test"}
        m = training["metadata"]["splits"]
        for part in ("train", "val", "test"):
            got = int((split_csv["split"] == part).sum())
            assert got == len(m[f"{part}_storm_ids"])
        counts = split_csv["split"].value_counts()
        assert counts.to_dict() == {
            k: len(m[f"{k}_storm_ids"]) for k in ("train", "val", "test")}


class TestClassWeight:
    def test_from_train_only(self, training):
        m = training["metadata"]
        sw = m["class_weight"]["scale_pos_weight"]
        tr = m["splits"]["train"]
        assert sw == pytest.approx(tr["ri_neg"] / tr["ri_pos"], rel=1e-5)
        assert tr["ri_pos"] + tr["ri_neg"] == tr["rows"]

    def test_never_uses_test_or_val(self, training):
        m = training["metadata"]
        assert "training split only" in m["class_weight"]["method"].lower()
        te = m["splits"]["test"]
        own = te["ri_neg"] / te["ri_pos"]
        assert m["class_weight"]["scale_pos_weight"] != pytest.approx(own)


class TestModelBestIteration:
    def test_metadata_matches_saved_model(self, training):
        m = training["metadata"]
        booster = xgb.Booster()
        booster.load_model(str(m["artifacts"]["model"]))
        assert m["best_iteration"] == booster.best_iteration

    def test_predictions_use_best_iteration(self, training):
        m = training["metadata"]
        model_file = m["artifacts"]["model"]
        best = m["best_iteration"]
        names = era5_feature_names()

        adapter = RIBranchModel(model_file, feature_names=names)
        assert adapter.best_iteration == best
        X = np.zeros((3, len(names)), dtype=np.float32)
        p_adapter = adapter.predict_proba(X)

        booster = xgb.Booster()
        booster.load_model(model_file)
        p_man = booster.predict(
            xgb.DMatrix(X, feature_names=names),
            iteration_range=(0, best + 1))
        assert np.allclose(p_adapter, p_man, rtol=1e-6, atol=1e-7)


class TestFrozenAdapterIteration:
    def test_frozen_best_iteration_verified(self):
        adapter = RIBranchModel(str(FROZEN), feature_names=era5_feature_names())
        assert adapter.best_iteration == 40

    def test_frozen_predicts_at_41_trees(self):
        adapter = RIBranchModel(str(FROZEN), feature_names=era5_feature_names())
        names = era5_feature_names()
        X = np.zeros((2, len(names)), dtype=np.float32)
        p = adapter.predict_proba(X)
        booster = xgb.Booster()
        booster.load_model(str(FROZEN))
        p_man = booster.predict(xgb.DMatrix(X, feature_names=names),
                                iteration_range=(0, 41))
        assert np.allclose(p, p_man, rtol=1e-6, atol=1e-7)
        # regression: the verified range differs from a full-tree prediction
        p_all = booster.predict(xgb.DMatrix(X, feature_names=names))
        assert not np.allclose(p, p_all)


class TestAdapterIterationFallback:
    def test_no_best_iteration_uses_all_trees_with_warning(self, tmp_path):
        """Regression: when an artifact carries no verified best iteration the
        branch falls back to every built tree but MUST warn (never silently
        guess an iteration range)."""
        rng = np.random.RandomState(0)
        X = rng.rand(240, 4)
        y = (rng.rand(240) > 0.7).astype(int)
        bst = xgb.train({"objective": "binary:logistic"},
                        xgb.DMatrix(X, label=y), num_boost_round=25)
        p = tmp_path / "plain_no_attrs.json"
        bst.save_model(str(p))

        adapter = RIBranchModel(str(p), feature_names=["a", "b", "c", "d"])
        assert adapter.best_iteration is None
        X2 = np.zeros((3, 4), dtype=np.float32)
        with pytest.warns(UserWarning):
            prob = adapter.predict_proba(X2)
        booster = xgb.Booster()
        booster.load_model(str(p))
        p_all = booster.predict(xgb.DMatrix(X2, feature_names=["a", "b", "c", "d"]))
        assert np.allclose(prob, p_all, rtol=1e-6, atol=1e-7)


class TestDeltaSemantics:
    """The 89-feature contract preserves the frozen within-storm temporal-delta
    semantics: delta = value(t) - value(previous within-storm observation),
    kept only when t - t_prev <= lag hours (else NaN). This is a documented
    methodological limitation, NOT redesigned for this training run."""

    def test_delta_semantics_documented_in_metadata(self, training):
        ds = training["metadata"]["delta_semantics"].lower()
        assert "within-storm" in ds
        assert "preserved" in ds
        assert "previous" in ds or "previous observation" in ds

    def test_delta_columns_present_and_counted(self, training):
        names = era5_feature_names()
        delta_cols = [c for c in names if c.startswith("delta_")]
        assert len(delta_cols) == 51
        for lag in ("6", "12", "24"):
            assert any(c.startswith(f"delta_{lag}h_") for c in delta_cols)

    def test_delta_uses_previous_observation_and_capped_lag(self):
        from src.features import add_temporal_features
        df = pd.DataFrame({
            "storm_id": ["S1"] * 4,
            "datetime_utc": pd.to_datetime([
                "2020-01-01 00:00", "2020-01-01 06:00",
                "2020-01-01 12:00", "2020-01-02 12:00"]),
            "wind_mag_850": [10.0, 11.0, 13.0, 15.0],
        })
        out = add_temporal_features(df, id_col="storm_id",
                                    time_col="datetime_utc",
                                    lags_h=[6, 12, 24])
        # first row: no previous within-storm observation -> NaN
        assert pd.isna(out["delta_6h_wind_mag_850"].iloc[0])
        assert pd.isna(out["delta_24h_wind_mag_850"].iloc[0])
        # 6h gap: delta = 13 - 11
        assert out["delta_6h_wind_mag_850"].iloc[2] == pytest.approx(2.0)
        # 12h lag also accepts the 6h-gap previous row (window overlap):
        assert out["delta_12h_wind_mag_850"].iloc[2] == pytest.approx(2.0)
        # 24h gap exceeds the 6h/12h lags -> NaN for those lags
        assert pd.isna(out["delta_6h_wind_mag_850"].iloc[3])
        assert pd.isna(out["delta_12h_wind_mag_850"].iloc[3])
        # but is exactly allowed for the 24h lag
        assert out["delta_24h_wind_mag_850"].iloc[3] == pytest.approx(2.0)


class TestMetadataCompleteness:
    def test_metadata_file_exists_with_required_fields(self, training):
        m = training["metadata"]
        required = {"model_type", "objective", "seed", "feature_count",
                    "dataset_path", "dataset_provenance", "delta_semantics",
                    "splits", "class_weight", "hyperparameters",
                    "best_iteration", "threshold", "evaluation", "baselines",
                    "calibration_status", "artifacts"}
        assert required <= set(m)
        assert m["feature_count"] == 89
        assert m["objective"] == "binary:logistic"
        assert m["seed"] == SEED
        assert "NOT CALIBRATED" in m["calibration_status"].upper()
        assert m["training_performed"] is True

    def test_metadata_artifacts_exist_on_disk(self, training):
        out = training["out"]
        for key in ("model", "feature_schema", "test_predictions", "metadata"):
            p = Path(str(training["metadata"]["artifacts"][key]))
            assert p.exists(), f"missing artifact {key}: {p}"


class TestEvaluation:
    def test_threshold_selected_on_validation(self, training):
        m = training["metadata"]
        assert "validation" in m["threshold"]["selection"]
        assert "never test" in m["threshold"]["selection"]

    def test_single_test_evaluation(self, training):
        eval_keys = {"roc_auc", "pr_auc", "brier", "precision", "recall", "f1",
                     "accuracy", "n", "n_positive", "prevalence"}
        assert eval_keys <= set(training["metadata"]["evaluation"])

    def test_predictions_csv_schema(self, training):
        preds = pd.read_csv(training["out"] / "era5_ri_test_predictions.csv",
                            parse_dates=["datetime_utc"])
        assert list(preds.columns) == ["storm_id", "datetime_utc", "RI_24h",
                                       "P_RI", "P_RI_frozen"]
        assert preds["RI_24h"].isin([0, 1]).all()
        assert preds["P_RI"].between(0.0, 1.0).all()
        assert preds["P_RI_frozen"].between(0.0, 1.0).all()

    def test_constant_baseline_uses_train_prevalence(self, training):
        b = training["metadata"]["baselines"]["constant_prevalence"]
        m = training["metadata"]["splits"]
        tr, te = m["train"], m["test"]
        train_prev = tr["ri_pos"] / tr["rows"]
        test_prev = te["ri_pos"] / te["rows"]
        # Honest no-skill reference: ROC-AUC is exactly 0.5 by construction and
        # the assigned probability is the TRAINING prevalence (no leak).
        assert b["roc_auc"] == pytest.approx(0.5)
        assert b["n"] == te["rows"]
        y_test = np.array([0.0] * te["ri_neg"] + [1.0] * te["ri_pos"])
        expected_brier = float(np.mean((y_test - train_prev) ** 2))
        assert b["brier"] == pytest.approx(expected_brier, abs=2e-4)
        # For a constant-score predictor sklearn's ranking AP equals the
        # observed (test) prevalence, NOT the assigned probability.
        assert b["pr_auc"] == pytest.approx(round(test_prev, 5), abs=1e-5)


class TestHonesty:
    def test_no_calibration_claimed(self, training):
        assert "NOT CALIBRATED" in \
            training["metadata"]["calibration_status"].upper()

    def test_seed_reproducible_config(self):
        assert get_config()["seed"] == 42


@pytest.mark.parametrize("grid,pos", [(0.01, [0.9, 0.8, 0.2, 0.1, 0.05]),
                                      (0.05, [0.95, 0.90, 0.30, 0.20, 0.10])])
def test_select_threshold_grid(grid, pos):
    y = np.array([1, 1, 0, 0, 0])
    p = np.array(pos)
    t, f1 = select_threshold(y, p, grid=grid)
    assert 0.0 <= t <= 1.0
    assert 0.0 <= f1 <= 1.0
    assert (t * 1000) % round(grid * 1000) == pytest.approx(0, abs=1e-3)