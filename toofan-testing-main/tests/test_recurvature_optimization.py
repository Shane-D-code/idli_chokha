"""Static contract tests for validation-only recurvature optimization."""

from recurvature.src.features import FEATURE_COLS, KINEMATIC_FEATURE_COLS, TRACK_FEATURE_COLS
from recurvature.src.optimize import ABLATIONS, PARAMETER_CONFIGS, _weight_options


def test_optimization_ablation_schema_and_search_size_are_fixed():
    assert ABLATIONS["A_kinematic"] == KINEMATIC_FEATURE_COLS
    assert ABLATIONS["B_kinematic_track_history"] == TRACK_FEATURE_COLS
    assert ABLATIONS["C_kinematic_track_history_era5"] == FEATURE_COLS
    assert len(PARAMETER_CONFIGS) == 12
    assert len(PARAMETER_CONFIGS) * 2 * len(ABLATIONS) == 72
    assert {"max_depth", "learning_rate", "n_estimators", "min_child_weight", "subsample",
            "colsample_bytree", "gamma", "reg_alpha", "reg_lambda"} == set(PARAMETER_CONFIGS[0])


def test_weighting_comparison_includes_unweighted_first():
    weighting = _weight_options([0, 0, 0, 1])
    assert weighting == [("unweighted", 1.0), ("weighted", 3.0)]
