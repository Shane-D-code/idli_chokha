"""Tests for leakage prevention."""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timezone, timedelta

from src.core.leakage import (
    TemporalLeakageChecker, TargetLeakageChecker,
    StormSplitLeakageChecker, FusionLeakageChecker,
    comprehensive_leakage_audit, enforce_no_future_data,
    LeakageReport
)


class TestTemporalLeakageChecker:
    """Test temporal leakage checker."""

    def test_future_indicator_detection(self):
        """Test detection of future-indicating column names."""
        df = pd.DataFrame({
            'feature_1': [1, 2, 3],
            'wind_t_plus_6h': [10, 20, 30],
            'pressure_future': [1000, 1001, 1002],
            'lead_time': [1, 2, 3],
        })

        checker = TemporalLeakageChecker()
        report = checker.check_dataframe(df)

        assert not report.passed
        assert len(report.violations) >= 3
        violations = [v['column'] for v in report.violations]
        assert 'wind_t_plus_6h' in violations
        assert 'pressure_future' in violations
        assert 'lead_time' in violations

    def test_forbidden_columns(self):
        """Test detection of forbidden target-derived columns."""
        df = pd.DataFrame({
            'feature_1': [1, 2, 3],
            'delta_v_24h': [5, 10, 15],
            'RI_24h': [0, 1, 0],
        })

        checker = TemporalLeakageChecker()
        report = checker.check_dataframe(df)

        assert not report.passed
        violations = [v['column'] for v in report.violations]
        assert 'delta_v_24h' in violations
        assert 'RI_24h' in violations

    def test_clean_dataframe(self):
        """Test that clean dataframe passes."""
        df = pd.DataFrame({
            'wind_kt': [40, 45, 50],
            'pressure_hpa': [1000, 995, 990],
            'wind_change_6h': [5, 5, 5],
            'pressure_change_6h': [-5, -5, -5],
        })

        checker = TemporalLeakageChecker()
        report = checker.check_dataframe(df)

        assert report.passed
        assert len(report.violations) == 0


class TestTargetLeakageChecker:
    """Test target leakage checker."""

    def test_target_in_features(self):
        """Test detection of target column in features."""
        X = pd.DataFrame({
            'feature_1': [1, 2, 3],
            'RI_24h': [0, 1, 0],  # Target leaked as feature
        })
        y = pd.Series([0, 1, 0])

        checker = TargetLeakageChecker('RI_24h')
        report = checker.check_features(X, y)

        assert not report.passed
        violations = [v['column'] for v in report.violations]
        assert 'RI_24h' in violations

    def test_forbidden_features(self):
        """Test detection of forbidden features."""
        X = pd.DataFrame({
            'feature_1': [1, 2, 3],
            'delta_v_24h': [5, 10, 15],  # Forbidden for RI prediction
        })
        y = pd.Series([0, 1, 0])

        checker = TargetLeakageChecker('RI_24h', forbidden_features=['delta_v_24h'])
        report = checker.check_features(X, y)

        assert not report.passed
        violations = [v['column'] for v in report.violations]
        assert 'delta_v_24h' in violations

    def test_high_correlation_warning(self):
        """Test high correlation warning."""
        X = pd.DataFrame({
            'feature_1': [1, 2, 3, 4, 5],
            'feature_2': [2, 4, 6, 8, 10],  # Perfect correlation with target
        })
        y = pd.Series([2, 4, 6, 8, 10])

        checker = TargetLeakageChecker('target')
        report = checker.check_features(X, y)

        # Should pass but have warnings
        assert report.passed
        assert len(report.warnings) > 0


class TestStormSplitLeakageChecker:
    """Test storm split leakage checker."""

    def test_no_overlap(self):
        """Test that non-overlapping splits pass."""
        df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S2', 'S2', 'S3', 'S3'],
            'value': [1, 2, 3, 4, 5, 6],
        })

        train_idx = np.array([0, 1])
        val_idx = np.array([2, 3])
        test_idx = np.array([4, 5])

        checker = StormSplitLeakageChecker()
        report = checker.check_split(df, train_idx, val_idx, test_idx)

        assert report.passed

    def test_train_val_overlap(self):
        """Test detection of train/val overlap."""
        df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S2', 'S2', 'S3', 'S3'],
            'value': [1, 2, 3, 4, 5, 6],
        })

        train_idx = np.array([0, 1, 2])  # S1, S2
        val_idx = np.array([2, 3])       # S2 (overlap!)
        test_idx = np.array([4, 5])      # S3

        checker = StormSplitLeakageChecker()
        report = checker.check_split(df, train_idx, val_idx, test_idx)

        assert not report.passed
        violations = [v['type'] for v in report.violations]
        assert 'storm_overlap_train_val' in violations

    def test_near_duplicates_warning(self):
        """Test warning for near-duplicate observations."""
        base_time = datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc)
        df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S1'],
            'datetime_utc': [
                base_time,
                base_time + timedelta(hours=1),  # Only 1 hour apart!
                base_time + timedelta(hours=6),
            ],
            'value': [1, 2, 3],
        })

        train_idx = np.array([0, 1, 2])
        val_idx = np.array([])
        test_idx = np.array([])

        checker = StormSplitLeakageChecker()
        report = checker.check_split(df, train_idx, val_idx, test_idx)

        assert report.passed
        assert len(report.warnings) > 0
        assert any('near_duplicate' in w['type'] for w in report.warnings)


class TestFusionLeakageChecker:
    """Test fusion leakage checker."""

    def test_oof_integrity(self):
        """Test OOF integrity check."""
        oof_preds = {
            'imd': np.array([0.1, 0.9, 0.2, 0.8]),
            'era5': np.array([0.2, 0.8, 0.3, 0.7]),
        }
        true_labels = np.array([0, 1, 0, 1])
        storm_ids = np.array(['S1', 'S2', 'S3', 'S4'])
        fold_indices = [
            (np.array([0, 1]), np.array([2, 3])),
            (np.array([2, 3]), np.array([0, 1])),
        ]

        checker = FusionLeakageChecker()
        report = checker.check_oof_integrity(oof_preds, true_labels, storm_ids, fold_indices)

        assert report.passed

    def test_oof_storm_overlap(self):
        """Test detection of storm overlap in folds."""
        oof_preds = {
            'imd': np.array([0.1, 0.9, 0.2, 0.8]),
        }
        true_labels = np.array([0, 1, 0, 1])
        storm_ids = np.array(['S1', 'S2', 'S1', 'S2'])  # S1 and S2 in both folds
        fold_indices = [
            (np.array([0, 1]), np.array([2, 3])),
            (np.array([2, 3]), np.array([0, 1])),
        ]

        checker = FusionLeakageChecker()
        report = checker.check_oof_integrity(oof_preds, true_labels, storm_ids, fold_indices)

        assert not report.passed
        violations = [v['type'] for v in report.violations]
        assert 'fold_storm_overlap' in violations


class TestComprehensiveAudit:
    """Test comprehensive leakage audit."""

    def test_full_audit_clean(self):
        """Test audit on clean data."""
        # Include target column in dataframe for target leakage check
        df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S2', 'S2', 'S3', 'S3'],
            'timestamp': [
                datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc),
                datetime(2024, 5, 20, 15, 0, 0, tzinfo=timezone.utc),
                datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc),
                datetime(2024, 5, 20, 15, 0, 0, tzinfo=timezone.utc),
                datetime(2024, 5, 21, 12, 0, 0, tzinfo=timezone.utc),
                datetime(2024, 5, 21, 15, 0, 0, tzinfo=timezone.utc),
            ],
            'wind_kt': [40, 45, 35, 40, 50, 55],
            'pressure_hpa': [1000, 995, 1002, 998, 990, 985],
            'wind_change_6h': [5, 5, 5, 5, 5, 5],
            'RI_24h': [0, 1, 0, 1, 1, 0],
        })

        train_idx = np.array([0, 1])  # S1
        val_idx = np.array([2, 3])    # S2
        test_idx = np.array([4, 5])   # S3

        reports = comprehensive_leakage_audit(
            df, 'RI_24h',
            ['wind_kt', 'pressure_hpa', 'wind_change_6h'],
            train_indices=train_idx,
            val_indices=val_idx,
            test_indices=test_idx
        )

        assert reports['overall'].passed

    def test_full_audit_with_violations(self):
        """Test audit with multiple violations."""
        df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S2', 'S2'],
            'timestamp': [
                datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc),
                datetime(2024, 5, 20, 15, 0, 0, tzinfo=timezone.utc),
                datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc),
                datetime(2024, 5, 20, 15, 0, 0, tzinfo=timezone.utc),
            ],
            'wind_kt': [40, 45, 35, 40],
            'wind_t_plus_6h': [50, 55, 40, 45],  # Future data!
            'RI_24h': [0, 1, 0, 1],
        })

        train_idx = np.array([0, 1])
        val_idx = np.array([2])
        test_idx = np.array([3])

        reports = comprehensive_leakage_audit(
            df, 'RI_24h',
            ['wind_kt', 'wind_t_plus_6h'],
            train_indices=train_idx,
            val_indices=val_idx,
            test_indices=test_idx
        )

        assert not reports['overall'].passed
        assert not reports['temporal'].passed


class TestEnforceNoFutureData:
    """Test enforce_no_future_data function."""

    def test_zeros_future_features(self):
        """Test that future features are zeroed."""
        df = pd.DataFrame({
            'feature_1': [1, 2, 3],
            'wind_t_plus_6h': [10, 20, 30],
            'pressure_future': [1000, 1001, 1002],
        })

        clean_df = enforce_no_future_data(df, datetime.now(timezone.utc), ['feature_1', 'wind_t_plus_6h', 'pressure_future'])

        assert clean_df['wind_t_plus_6h'].sum() == 0
        assert clean_df['pressure_future'].sum() == 0
        assert clean_df['feature_1'].sum() == 6  # Unchanged


class TestLeakageReport:
    """Test LeakageReport dataclass."""

    def test_report_creation(self):
        report = LeakageReport(passed=True)
        assert report.passed
        assert report.violations == []

    def test_report_with_violations(self):
        report = LeakageReport(
            passed=False,
            violations=[{'type': 'test', 'column': 'col1', 'severity': 'HIGH'}],
            warnings=[{'type': 'warning', 'note': 'test warning'}]
        )
        assert not report.passed
        assert len(report.violations) == 1
        assert len(report.warnings) == 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])