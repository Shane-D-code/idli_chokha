"""Tests for storm-wise splitting."""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timezone, timedelta

from src.core.splitting import (
    StormWiseSplitter, TemporalStormSplitter, LeaveOneStormOut,
    LeaveOneBasinOut, SplitResult, verify_split_integrity, get_storm_statistics
)


class TestStormWiseSplitter:
    """Test StormWiseSplitter."""

    def setup_method(self):
        """Create test data."""
        np.random.seed(42)
        n_storms = 20
        obs_per_storm = 5

        data = []
        for i in range(n_storms):
            storm_id = f"S{i:03d}"
            base_time = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(days=i*2)
            for j in range(obs_per_storm):
                data.append({
                    'storm_id': storm_id,
                    'timestamp': base_time + timedelta(hours=j*3),
                    'feature_1': np.random.randn(),
                    'feature_2': np.random.randn(),
                    'target': np.random.randint(0, 2),
                })
        self.df = pd.DataFrame(data)

    def test_basic_split(self):
        """Test basic 70/15/15 split."""
        splitter = StormWiseSplitter(random_state=42)
        result = splitter.split(self.df, train_frac=0.7, val_frac=0.15, test_frac=0.15)

        assert isinstance(result, SplitResult)
        assert len(result.train_storms) + len(result.val_storms) + len(result.test_storms) == 20
        assert len(result.train_indices) + len(result.val_indices) + len(result.test_indices) == len(self.df)

        # Verify no overlap
        assert verify_split_integrity(self.df, result)

    def test_stratified_split(self):
        """Test stratified split by target."""
        splitter = StormWiseSplitter(random_state=42)
        result = splitter.split(self.df, train_frac=0.7, val_frac=0.15, test_frac=0.15,
                                 stratify_col='target')

        assert isinstance(result, SplitResult)
        assert verify_split_integrity(self.df, result)

        # Check target distribution roughly preserved
        train_targets = self.df.iloc[result.train_indices]['target'].mean()
        val_targets = self.df.iloc[result.val_indices]['target'].mean()
        test_targets = self.df.iloc[result.test_indices]['target'].mean()

        # All should be around 0.5 (roughly)
        assert abs(train_targets - 0.5) < 0.2
        assert abs(val_targets - 0.5) < 0.2
        assert abs(test_targets - 0.5) < 0.2

    def test_split_fractions(self):
        """Test that fractions are roughly respected."""
        splitter = StormWiseSplitter(random_state=42)
        result = splitter.split(self.df, train_frac=0.7, val_frac=0.15, test_frac=0.15)

        n = len(self.df)
        assert abs(len(result.train_indices) / n - 0.7) < 0.15
        assert abs(len(result.val_indices) / n - 0.15) < 0.15
        assert abs(len(result.test_indices) / n - 0.15) < 0.15

    def test_insufficient_storms(self):
        """Test error with insufficient storms."""
        small_df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S2', 'S2'],
            'timestamp': [datetime.now(timezone.utc)] * 4,
            'feature_1': [1, 2, 3, 4],
        })

        splitter = StormWiseSplitter()
        with pytest.raises(ValueError):
            splitter.split(small_df)


class TestTemporalStormSplitter:
    """Test TemporalStormSplitter."""

    def setup_method(self):
        """Create test data with time-ordered storms."""
        data = []
        base = datetime(2020, 1, 1, tzinfo=timezone.utc)
        for i in range(10):
            storm_id = f"S{i:03d}"
            storm_time = base + timedelta(days=i*30)
            for j in range(5):
                data.append({
                    'storm_id': storm_id,
                    'timestamp': storm_time + timedelta(hours=j*3),
                    'feature_1': np.random.randn(),
                })
        self.df = pd.DataFrame(data)

    def test_temporal_split(self):
        """Test split by storm start time."""
        splitter = TemporalStormSplitter()
        train_end = datetime(2020, 6, 1, tzinfo=timezone.utc)
        val_end = datetime(2020, 9, 1, tzinfo=timezone.utc)

        result = splitter.split(self.df, train_end=train_end, val_end=val_end)

        assert isinstance(result, SplitResult)
        assert len(result.train_storms) > 0
        assert len(result.val_storms) > 0
        assert len(result.test_storms) > 0
        assert verify_split_integrity(self.df, result)

    def test_temporal_split_no_val(self):
        """Test split with only train/test."""
        splitter = TemporalStormSplitter()
        train_end = datetime(2020, 6, 1, tzinfo=timezone.utc)

        result = splitter.split(self.df, train_end=train_end)

        assert len(result.val_storms) == 0
        assert len(result.train_storms) + len(result.test_storms) == 10
        assert verify_split_integrity(self.df, result)


class TestLeaveOneStormOut:
    """Test LeaveOneStormOut."""

    def setup_method(self):
        """Create test data."""
        data = []
        for i in range(5):
            storm_id = f"S{i:03d}"
            for j in range(4):
                data.append({
                    'storm_id': storm_id,
                    'timestamp': datetime.now(timezone.utc),
                    'feature_1': np.random.randn(),
                })
        self.df = pd.DataFrame(data)

    def test_loo_iteration(self):
        """Test LOO iteration yields correct splits."""
        loo = LeaveOneStormOut()
        splits = list(loo.split(self.df))

        assert len(splits) == 5  # 5 storms

        for train_idx, test_idx in splits:
            # Each test should have exactly 4 observations (1 storm)
            assert len(test_idx) == 4
            # Train should have 16 observations (4 storms)
            assert len(train_idx) == 16

            # No overlap
            assert len(set(train_idx) & set(test_idx)) == 0


class TestLeaveOneBasinOut:
    """Test LeaveOneBasinOut."""

    def setup_method(self):
        """Create test data with multiple basins."""
        data = []
        basins = ['NI', 'SI', 'WP']
        for basin in basins:
            for i in range(3):
                storm_id = f"{basin}{i:03d}"
                for j in range(3):
                    data.append({
                        'storm_id': storm_id,
                        'basin': basin,
                        'timestamp': datetime.now(timezone.utc),
                        'feature_1': np.random.randn(),
                    })
        self.df = pd.DataFrame(data)

    def test_lobo_iteration(self):
        """Test LOBO iteration."""
        lobo = LeaveOneBasinOut()
        splits = list(lobo.split(self.df))

        assert len(splits) == 3  # 3 basins

        for train_idx, test_idx in splits:
            # Each test has 9 observations (3 storms * 3 obs)
            assert len(test_idx) == 9
            # Train has 18 observations
            assert len(train_idx) == 18
            assert len(set(train_idx) & set(test_idx)) == 0


class TestSplitResult:
    """Test SplitResult dataclass."""

    def test_split_result_creation(self):
        result = SplitResult(
            train_storms=['S1', 'S2'],
            val_storms=['S3'],
            test_storms=['S4'],
            train_indices=np.array([0, 1, 2, 3]),
            val_indices=np.array([4, 5]),
            test_indices=np.array([6, 7]),
            metadata={'n_storms_total': 4}
        )
        assert len(result.train_storms) == 2
        assert result.metadata['n_storms_total'] == 4


class TestVerifySplitIntegrity:
    """Test verify_split_integrity function."""

    def test_valid_split(self):
        """Test valid split passes."""
        df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S2', 'S2', 'S3', 'S3'],
            'value': [1, 2, 3, 4, 5, 6],
        })
        result = SplitResult(
            train_storms=['S1', 'S2'],
            val_storms=['S3'],
            test_storms=[],
            train_indices=np.array([0, 1, 2, 3]),
            val_indices=np.array([4, 5]),
            test_indices=np.array([]),
            metadata={}
        )
        assert verify_split_integrity(df, result)

    def test_invalid_split_overlap(self):
        """Test invalid split with overlap fails."""
        df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S2', 'S2'],
            'value': [1, 2, 3, 4],
        })
        result = SplitResult(
            train_storms=['S1', 'S2'],
            val_storms=['S2'],  # Overlap!
            test_storms=[],
            train_indices=np.array([0, 1, 2, 3]),
            val_indices=np.array([2, 3]),
            test_indices=np.array([]),
            metadata={}
        )
        assert not verify_split_integrity(df, result)


class TestGetStormStatistics:
    """Test get_storm_statistics function."""

    def test_statistics(self):
        """Test storm statistics computation."""
        df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S2', 'S2', 'S2'],
            'timestamp': [
                datetime(2024, 1, 1, tzinfo=timezone.utc),
                datetime(2024, 1, 1, 3, tzinfo=timezone.utc),
                datetime(2024, 1, 2, tzinfo=timezone.utc),
                datetime(2024, 1, 2, 3, tzinfo=timezone.utc),
                datetime(2024, 1, 2, 6, tzinfo=timezone.utc),
            ],
            'target': [0, 1, 0, 0, 1],
        })

        stats = get_storm_statistics(df, target_col='target')

        assert len(stats) == 2
        assert stats[stats['storm_id'] == 'S1']['n_obs'].values[0] == 2
        assert stats[stats['storm_id'] == 'S2']['n_obs'].values[0] == 3
        assert 'target_sum' in stats.columns
        assert 'target_mean' in stats.columns


if __name__ == '__main__':
    pytest.main([__file__, '-v'])