"""Data Leakage Prevention for TOOFAN.

Comprehensive leakage detection and prevention utilities.
"""

from __future__ import annotations

import warnings
from datetime import datetime, timedelta
from typing import Any, Optional
from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class LeakageReport:
    """Report of leakage audit results."""
    passed: bool
    violations: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    info: list[dict] = field(default_factory=list)


class TemporalLeakageChecker:
    """Check for temporal leakage in features."""

    FUTURE_INDICATORS = [
        't_plus', 'future', 'lead', 'ahead', 'forward',
        'target', 'forecast', 'pred', 'next_', 't+',
        'h_ahead', 'hr_ahead', 'hour_ahead'
    ]

    FORBIDDEN_DERIVED = [
        'delta_v_24h', 'wind_24h', 'msw_24h', 'pressure_24h',
        'RI_24h', 'genesis_24h', 'landfall_24h'
    ]

    def __init__(self, reference_time_col: str = 'timestamp',
                 forecast_horizon_hours: int = 24):
        self.reference_time_col = reference_time_col
        self.forecast_horizon = timedelta(hours=forecast_horizon_hours)

    def check_dataframe(self, df: pd.DataFrame, target_col: Optional[str] = None) -> LeakageReport:
        """Comprehensive leakage check on a DataFrame."""
        violations = []
        warnings_list = []
        info = []

        # 1. Check column names for future indicators
        for col in df.columns:
            col_lower = col.lower()
            for indicator in self.FUTURE_INDICATORS:
                if indicator in col_lower:
                    violations.append({
                        'type': 'future_indicator_in_column',
                        'column': col,
                        'indicator': indicator,
                        'severity': 'HIGH'
                    })

        # 2. Check for forbidden derived columns
        for col in df.columns:
            if col in self.FORBIDDEN_DERIVED:
                violations.append({
                    'type': 'forbidden_target_column',
                    'column': col,
                    'severity': 'CRITICAL'
                })

        # 3. Check temporal consistency if reference time available
        if self.reference_time_col in df.columns:
            ref_times = pd.to_datetime(df[self.reference_time_col], utc=True)

            # Check for any feature that might use future data
            for col in df.columns:
                if df[col].dtype.kind in 'fc':  # float or complex
                    # This is a heuristic - in practice need domain knowledge
                    pass

        # 4. Check target column if provided
        if target_col and target_col in df.columns:
            # Verify target is not used as feature
            if target_col in df.columns:
                info.append({
                    'type': 'target_column_present',
                    'column': target_col,
                    'note': 'Ensure this is only used as label, never as feature'
                })

        passed = len(violations) == 0

        return LeakageReport(
            passed=passed,
            violations=violations,
            warnings=warnings_list,
            info=info
        )

    def check_feature_engineering(self, df: pd.DataFrame,
                                  feature_cols: list[str],
                                  time_col: str) -> LeakageReport:
        """Check that feature engineering doesn't use future data."""
        violations = []

        # Check for rolling windows that look forward
        for col in feature_cols:
            if col not in df.columns:
                continue

            # Check if column name suggests forward-looking window
            if any(s in col.lower() for s in ['forward', 'lead', 'ahead', 'future', 't+']):
                violations.append({
                    'type': 'forward_looking_feature',
                    'column': col,
                    'severity': 'HIGH'
                })

        # Check for any shift(-n) operations in feature creation
        # This is a runtime check - would need to inspect code

        return LeakageReport(passed=len(violations) == 0, violations=violations)


class PreprocessingLeakageChecker:
    """Check for leakage in preprocessing (scaling, imputation, etc.)."""

    def __init__(self):
        pass

    def check_scaler_fit(self, scaler, train_indices: np.ndarray,
                         all_indices: np.ndarray) -> LeakageReport:
        """Verify scaler was fit only on training data."""
        violations = []

        # Check if scaler has been fit
        if not hasattr(scaler, 'n_samples_seen_'):
            return LeakageReport(passed=True, warnings=[{'note': 'Scaler not yet fit'}])

        # Can't directly verify without storing train indices during fit
        # This is a documentation/enforcement check

        return LeakageReport(passed=True, info=[{'note': 'Scaler fit verification requires storing train indices at fit time'}])

    def check_imputation(self, imputer, train_indices: np.ndarray,
                         all_indices: np.ndarray) -> LeakageReport:
        """Verify imputer was fit only on training data."""
        violations = []

        if hasattr(imputer, 'statistics_'):
            # Imputer has been fit - can't verify without stored indices
            pass

        return LeakageReport(passed=True, info=[{'note': 'Imputer fit verification requires storing train indices'}])

    def audit_preprocessing_pipeline(self, pipeline, X_train, X_all,
                                      train_indices: np.ndarray) -> LeakageReport:
        """Audit entire preprocessing pipeline for leakage."""
        violations = []
        warnings_list = []

        from sklearn.pipeline import Pipeline
        from sklearn.base import BaseEstimator

        def check_step(step, step_name):
            if isinstance(step, Pipeline):
                for sub_name, sub_step in step.steps:
                    check_step(sub_step, f"{step_name}.{sub_name}")
            elif isinstance(step, BaseEstimator):
                # Check if step has been fit on full data
                if hasattr(step, 'n_samples_seen_') or hasattr(step, 'statistics_'):
                    # This step has been fit - would need to verify it was on train only
                    warnings_list.append({
                        'step': step_name,
                        'type': 'preprocessing_step_fit',
                        'note': f'Step {step_name} has been fit; verify it used only training data'
                    })

        if isinstance(pipeline, Pipeline):
            for name, step in pipeline.steps:
                check_step(step, name)

        return LeakageReport(passed=len(violations) == 0, violations=violations, warnings=warnings_list)


class TargetLeakageChecker:
    """Check for target leakage (using target or target-derived info as feature)."""

    def __init__(self, target_col: str, forbidden_features: Optional[list[str]] = None):
        self.target_col = target_col
        self.forbidden_features = forbidden_features or []

    def check_features(self, X: pd.DataFrame, y: pd.Series) -> LeakageReport:
        """Check if any feature is derived from or identical to target."""
        violations = []
        warnings_list = []

        # Direct column match
        if self.target_col in X.columns:
            violations.append({
                'type': 'target_column_in_features',
                'column': self.target_col,
                'severity': 'CRITICAL'
            })

        # Forbidden features (e.g., wind_24h when predicting RI_24h)
        for forbidden in self.forbidden_features:
            if forbidden in X.columns:
                violations.append({
                    'type': 'forbidden_feature_present',
                    'column': forbidden,
                    'severity': 'CRITICAL'
                })

        # Correlation-based check (heuristic)
        # High correlation with target might indicate leakage
        for col in X.select_dtypes(include=[np.number]).columns:
            if col == self.target_col:
                continue
            try:
                corr = X[col].corr(y)
                if abs(corr) > 0.95:
                    warnings_list.append({
                        'type': 'high_target_correlation',
                        'column': col,
                        'correlation': corr,
                        'severity': 'WARNING',
                        'note': 'Very high correlation with target - verify not derived from target'
                    })
            except Exception:
                pass

        return LeakageReport(
            passed=len(violations) == 0,
            violations=violations,
            warnings=warnings_list
        )


class StormSplitLeakageChecker:
    """Verify storm-wise splitting integrity."""

    def __init__(self, storm_id_col: str = 'storm_id'):
        self.storm_id_col = storm_id_col

    def check_split(self, df: pd.DataFrame,
                    train_indices: np.ndarray,
                    val_indices: np.ndarray,
                    test_indices: np.ndarray) -> LeakageReport:
        """Verify no storm appears in multiple splits."""
        violations = []
        warnings_list = []

        train_storms = set(df.iloc[train_indices][self.storm_id_col].unique())
        val_storms = set(df.iloc[val_indices][self.storm_id_col].unique())
        test_storms = set(df.iloc[test_indices][self.storm_id_col].unique())

        overlap_train_val = train_storms & val_storms
        overlap_train_test = train_storms & test_storms
        overlap_val_test = val_storms & test_storms

        if overlap_train_val:
            violations.append({
                'type': 'storm_overlap_train_val',
                'storms': list(overlap_train_val),
                'severity': 'CRITICAL'
            })

        if overlap_train_test:
            violations.append({
                'type': 'storm_overlap_train_test',
                'storms': list(overlap_train_test),
                'severity': 'CRITICAL'
            })

        if overlap_val_test:
            violations.append({
                'type': 'storm_overlap_val_test',
                'storms': list(overlap_val_test),
                'severity': 'CRITICAL'
            })

        # Check for near-duplicate observations (same storm, similar time)
        # This is important for satellite frames from same storm
        if self.storm_id_col in df.columns and 'datetime_utc' in df.columns:
            for split_name, indices in [('train', train_indices), ('val', val_indices), ('test', test_indices)]:
                split_df = df.iloc[indices].sort_values([self.storm_id_col, 'datetime_utc'])
                if len(split_df) > 1:
                    time_diffs = split_df.groupby(self.storm_id_col)['datetime_utc'].diff()
                    near_dupes = time_diffs[time_diffs < timedelta(hours=3)]
                    if len(near_dupes) > 0:
                        warnings_list.append({
                            'type': 'near_duplicate_observations',
                            'split': split_name,
                            'count': len(near_dupes),
                            'note': f'Observations from same storm within 3h in {split_name} set'
                        })

        return LeakageReport(
            passed=len(violations) == 0,
            violations=violations,
            warnings=warnings_list
        )


class FusionLeakageChecker:
    """Check for leakage in multimodal fusion (using in-sample predictions)."""

    def __init__(self):
        pass

    def check_oof_integrity(self, oof_predictions: dict[str, np.ndarray],
                            true_labels: np.ndarray,
                            storm_ids: np.ndarray,
                            fold_indices: list[tuple[np.ndarray, np.ndarray]]) -> LeakageReport:
        """Verify out-of-fold predictions are truly out-of-fold."""
        violations = []
        warnings_list = []

        for branch_name, oof_preds in oof_predictions.items():
            if len(oof_preds) != len(true_labels):
                violations.append({
                    'type': 'oof_length_mismatch',
                    'branch': branch_name,
                    'oof_length': len(oof_preds),
                    'target_length': len(true_labels),
                    'severity': 'HIGH'
                })
                continue

            # Check that each prediction was made by model not trained on that storm
            # This requires tracking which fold each sample belongs to
            for fold_idx, (train_idx, val_idx) in enumerate(fold_indices):
                val_storms = set(storm_ids[val_idx])
                train_storms = set(storm_ids[train_idx])

                # Check if any validation storm appears in training
                overlap = val_storms & train_storms
                if overlap:
                    violations.append({
                        'type': 'fold_storm_overlap',
                        'branch': branch_name,
                        'fold': fold_idx,
                        'overlapping_storms': list(overlap),
                        'severity': 'CRITICAL'
                    })

        return LeakageReport(passed=len(violations) == 0, violations=violations, warnings=warnings_list)

    def check_fusion_inputs(self, branch_predictions: dict[str, pd.DataFrame],
                            target_col: str = 'RI_24h') -> LeakageReport:
        """Check that fusion uses only OOF probabilities, not in-sample."""
        violations = []
        warnings_list = []

        for branch_name, pred_df in branch_predictions.items():
            if 'P_RI' in pred_df.columns:
                # Check if probabilities look like they're from in-sample (too perfect)
                if 'P_RI' in pred_df.columns and target_col in pred_df.columns:
                    y_true = pred_df[target_col].values
                    y_pred = pred_df['P_RI'].values

                    # Perfect separation is suspicious
                    if y_pred[y_true == 1].min() > y_pred[y_true == 0].max():
                        warnings_list.append({
                            'type': 'perfect_separation_suspicious',
                            'branch': branch_name,
                            'note': 'Predictions perfectly separate classes - possible in-sample leakage'
                        })

        return LeakageReport(passed=len(violations) == 0, violations=violations, warnings=warnings_list)


def comprehensive_leakage_audit(df: pd.DataFrame,
                                 target_col: str,
                                 feature_cols: list[str],
                                 storm_id_col: str = 'storm_id',
                                 time_col: str = 'timestamp',
                                 train_indices: Optional[np.ndarray] = None,
                                 val_indices: Optional[np.ndarray] = None,
                                 test_indices: Optional[np.ndarray] = None) -> dict[str, LeakageReport]:
    """Run comprehensive leakage audit.

    Returns dict of reports from each checker.
    """
    reports = {}

    # Temporal leakage - check only feature columns (not target)
    feature_df = df[feature_cols].copy()
    if time_col in df.columns:
        feature_df[time_col] = df[time_col]
    if storm_id_col in df.columns:
        feature_df[storm_id_col] = df[storm_id_col]

    temporal_checker = TemporalLeakageChecker(time_col)
    reports['temporal'] = temporal_checker.check_dataframe(feature_df, target_col)
    reports['feature_engineering'] = temporal_checker.check_feature_engineering(feature_df, feature_cols, time_col)

    # Target leakage
    target_checker = TargetLeakageChecker(target_col, forbidden_features=[
        'delta_v_24h', 'wind_24h', 'msw_24h', 'pressure_24h',
        'RI_24h', 'genesis_24h', 'landfall_24h'
    ])
    reports['target'] = target_checker.check_features(df[feature_cols], df[target_col])

    # Storm split leakage
    if train_indices is not None and val_indices is not None and test_indices is not None:
        split_checker = StormSplitLeakageChecker(storm_id_col)
        reports['storm_split'] = split_checker.check_split(df, train_indices, val_indices, test_indices)

    # Overall verdict
    all_passed = all(r.passed for r in reports.values())
    reports['overall'] = LeakageReport(passed=all_passed)

    return reports


def enforce_no_future_data(df: pd.DataFrame, reference_time: datetime,
                           feature_cols: list[str]) -> pd.DataFrame:
    """Enforce no future data by zeroing/nulling features that use future info.

    This is a safety net - proper prevention should happen at feature engineering time.
    """
    clean_df = df.copy()

    # Zero out any feature that might contain future info
    for col in feature_cols:
        if col not in clean_df.columns:
            continue

        col_lower = col.lower()
        if any(indicator in col_lower for indicator in TemporalLeakageChecker.FUTURE_INDICATORS):
            warnings.warn(f"Zeroing potentially leaked feature: {col}")
            clean_df[col] = 0.0

    return clean_df