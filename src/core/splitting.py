"""Storm-wise data splitting for TOOFAN.

Critical: All splits must be at the storm level to prevent data leakage.
No storm should appear in more than one split (train/val/test).
"""

from __future__ import annotations

import warnings
from datetime import datetime
from typing import Any, Optional
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold, GroupShuffleSplit
from sklearn.model_selection import StratifiedGroupKFold


@dataclass
class SplitResult:
    """Result of a storm-wise split."""
    train_storms: list[str]
    val_storms: list[str]
    test_storms: list[str]
    train_indices: np.ndarray
    val_indices: np.ndarray
    test_indices: np.ndarray
    metadata: dict


class StormWiseSplitter:
    """Splitter that ensures storms are kept together across splits."""

    def __init__(self, storm_id_col: str = 'storm_id', time_col: str = 'timestamp',
                 random_state: int = 42):
        self.storm_id_col = storm_id_col
        self.time_col = time_col
        self.random_state = random_state

    def split(self, df: pd.DataFrame,
              train_frac: float = 0.7,
              val_frac: float = 0.15,
              test_frac: float = 0.15,
              stratify_col: Optional[str] = None) -> SplitResult:
        """Split DataFrame into train/val/test by storm.

        Args:
            df: DataFrame with storm_id_col and optional stratify_col
            train_frac: Fraction for training
            val_frac: Fraction for validation
            test_frac: Fraction for test
            stratify_col: Optional column to stratify by (e.g., 'RI_24h' for RI detection)

        Returns:
            SplitResult with storm lists and indices
        """
        # Validate fractions
        total = train_frac + val_frac + test_frac
        if abs(total - 1.0) > 1e-6:
            raise ValueError(f"Fractions must sum to 1.0, got {total}")

        # Get unique storms
        storms = df[self.storm_id_col].unique()
        n_storms = len(storms)

        if n_storms < 3:
            raise ValueError(f"Need at least 3 storms for 3-way split, got {n_storms}")

        # Create storm-level dataframe for stratification
        storm_df = df.drop_duplicates(subset=[self.storm_id_col]).copy()

        if stratify_col and stratify_col in df.columns:
            # Use first occurrence of stratify column per storm
            storm_stratify = storm_df.set_index(self.storm_id_col).loc[storms, stratify_col].values
        else:
            storm_stratify = None

        # First split: train+val vs test
        test_size = test_frac
        gss1 = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=self.random_state)

        # We need to split at storm level - use storm indices as groups
        storm_indices = np.arange(n_storms)

        train_val_idx, test_idx = next(gss1.split(storm_indices, storm_stratify, groups=storm_indices))

        train_val_storms = storms[train_val_idx]
        test_storms = storms[test_idx]

        # Second split: train vs val from train_val
        val_size_adjusted = val_frac / (train_frac + val_frac)
        gss2 = GroupShuffleSplit(n_splits=1, test_size=val_size_adjusted,
                                 random_state=self.random_state + 1)

        train_idx_rel, val_idx_rel = next(gss2.split(
            train_val_storms,
            storm_stratify[train_val_idx] if storm_stratify is not None else None,
            groups=np.arange(len(train_val_storms))
        ))

        train_storms = train_val_storms[train_idx_rel]
        val_storms = train_val_storms[val_idx_rel]

        # Get row indices for each split
        train_mask = df[self.storm_id_col].isin(train_storms)
        val_mask = df[self.storm_id_col].isin(val_storms)
        test_mask = df[self.storm_id_col].isin(test_storms)

        train_indices = np.where(train_mask)[0]
        val_indices = np.where(val_mask)[0]
        test_indices = np.where(test_mask)[0]

        # Verify no overlap
        assert len(set(train_storms) & set(val_storms)) == 0
        assert len(set(train_storms) & set(test_storms)) == 0
        assert len(set(val_storms) & set(test_storms)) == 0

        metadata = {
            'n_storms_total': n_storms,
            'n_storms_train': len(train_storms),
            'n_storms_val': len(val_storms),
            'n_storms_test': len(test_storms),
            'n_samples_train': len(train_indices),
            'n_samples_val': len(val_indices),
            'n_samples_test': len(test_indices),
            'train_frac_actual': len(train_indices) / len(df),
            'val_frac_actual': len(val_indices) / len(df),
            'test_frac_actual': len(test_indices) / len(df),
            'random_state': self.random_state,
            'stratify_col': stratify_col,
        }

        return SplitResult(
            train_storms=list(train_storms),
            val_storms=list(val_storms),
            test_storms=list(test_storms),
            train_indices=train_indices,
            val_indices=val_indices,
            test_indices=test_indices,
            metadata=metadata
        )

    def split_kfold(self, df: pd.DataFrame, n_splits: int = 5,
                    stratify_col: Optional[str] = None) -> list[SplitResult]:
        """Generate K-fold storm-wise splits for cross-validation."""
        storms = df[self.storm_id_col].unique()
        n_storms = len(storms)

        if n_storms < n_splits:
            warnings.warn(f"Only {n_storms} storms available, reducing n_splits to {n_storms}")
            n_splits = max(2, n_storms)

        if stratify_col and stratify_col in df.columns:
            storm_stratify = df.drop_duplicates(subset=[self.storm_id_col]).set_index(self.storm_id_col).loc[storms, stratify_col].values
            cv = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=self.random_state)
            splits = cv.split(storms, storm_stratify, groups=storms)
        else:
            cv = GroupKFold(n_splits=n_splits)
            splits = cv.split(storms, groups=storms)

        results = []
        for fold, (train_idx, test_idx) in enumerate(splits):
            train_storms = storms[train_idx]
            test_storms = storms[test_idx]

            train_mask = df[self.storm_id_col].isin(train_storms)
            test_mask = df[self.storm_id_col].isin(test_storms)

            results.append(SplitResult(
                train_storms=list(train_storms),
                val_storms=[],  # No separate val in kfold
                test_storms=list(test_storms),
                train_indices=np.where(train_mask)[0],
                val_indices=np.array([], dtype=int),
                test_indices=np.where(test_mask)[0],
                metadata={
                    'fold': fold,
                    'n_splits': n_splits,
                    'n_storms_train': len(train_storms),
                    'n_storms_test': len(test_storms),
                    'n_samples_train': int(train_mask.sum()),
                    'n_samples_test': int(test_mask.sum()),
                }
            ))

        return results


class TemporalStormSplitter:
    """Split storms by time (older storms for train, newer for test).

    Useful for simulating real-time forecasting where future storms
    are unseen during training.
    """

    def __init__(self, storm_id_col: str = 'storm_id', time_col: str = 'timestamp',
                 storm_time_col: str = 'storm_start_time'):
        self.storm_id_col = storm_id_col
        self.time_col = time_col
        self.storm_time_col = storm_time_col

    def split(self, df: pd.DataFrame,
              train_end: datetime,
              val_end: Optional[datetime] = None) -> SplitResult:
        """Split by storm start time.

        Args:
            df: DataFrame with storm timing info
            train_end: Storms starting before this go to train
            val_end: Storms between train_end and val_end go to val (optional)
                     Storms after val_end go to test
        """
        # Get storm start times
        storm_starts = df.groupby(self.storm_id_col)[self.time_col].min()

        train_storms = storm_starts[storm_starts <= train_end].index.tolist()

        if val_end is not None:
            val_storms = storm_starts[(storm_starts > train_end) & (storm_starts <= val_end)].index.tolist()
            test_storms = storm_starts[storm_starts > val_end].index.tolist()
        else:
            val_storms = []
            test_storms = storm_starts[storm_starts > train_end].index.tolist()

        train_mask = df[self.storm_id_col].isin(train_storms)
        val_mask = df[self.storm_id_col].isin(val_storms)
        test_mask = df[self.storm_id_col].isin(test_storms)

        return SplitResult(
            train_storms=train_storms,
            val_storms=val_storms,
            test_storms=test_storms,
            train_indices=np.where(train_mask)[0],
            val_indices=np.where(val_mask)[0],
            test_indices=np.where(test_mask)[0],
            metadata={
                'split_type': 'temporal',
                'train_end': train_end.isoformat(),
                'val_end': val_end.isoformat() if val_end else None,
                'n_storms_train': len(train_storms),
                'n_storms_val': len(val_storms),
                'n_storms_test': len(test_storms),
            }
        )


class LeaveOneStormOut:
    """Leave-one-storm-out cross-validation iterator."""

    def __init__(self, storm_id_col: str = 'storm_id'):
        self.storm_id_col = storm_id_col

    def split(self, df: pd.DataFrame):
        """Yield (train_indices, test_indices) for each storm left out."""
        storms = df[self.storm_id_col].unique()

        for storm in storms:
            train_mask = df[self.storm_id_col] != storm
            test_mask = df[self.storm_id_col] == storm
            yield np.where(train_mask)[0], np.where(test_mask)[0]


class LeaveOneBasinOut:
    """Leave-one-basin-out cross-validation for basin generalization."""

    def __init__(self, basin_col: str = 'basin', storm_id_col: str = 'storm_id'):
        self.basin_col = basin_col
        self.storm_id_col = storm_id_col

    def split(self, df: pd.DataFrame):
        """Yield (train_indices, test_indices) for each basin left out."""
        basins = df[self.basin_col].unique()

        for basin in basins:
            train_mask = df[self.basin_col] != basin
            test_mask = df[self.basin_col] == basin
            yield np.where(train_mask)[0], np.where(test_mask)[0]


def verify_split_integrity(df: pd.DataFrame, split_result: SplitResult,
                           storm_id_col: str = 'storm_id') -> bool:
    """Verify that a split has no storm overlap."""
    train_storms = set(split_result.train_storms)
    val_storms = set(split_result.val_storms)
    test_storms = set(split_result.test_storms)

    overlap_train_val = train_storms & val_storms
    overlap_train_test = train_storms & test_storms
    overlap_val_test = val_storms & test_storms

    if overlap_train_val:
        warnings.warn(f"Train/Val storm overlap: {overlap_train_val}")
        return False
    if overlap_train_test:
        warnings.warn(f"Train/Test storm overlap: {overlap_train_test}")
        return False
    if overlap_val_test:
        warnings.warn(f"Val/Test storm overlap: {overlap_val_test}")
        return False

    # Verify indices match storms
    train_storms_from_idx = set(df.iloc[split_result.train_indices][storm_id_col].unique())
    if train_storms != train_storms_from_idx:
        warnings.warn("Train storm mismatch between indices and storm list")
        return False

    return True


def get_storm_statistics(df: pd.DataFrame, storm_id_col: str = 'storm_id',
                         target_col: Optional[str] = None) -> pd.DataFrame:
    """Get statistics per storm for split analysis."""
    stats = df.groupby(storm_id_col).agg(
        n_obs=('storm_id', 'count'),
        start_time=(df.columns[1] if len(df.columns) > 1 else storm_id_col, 'min'),
        end_time=(df.columns[1] if len(df.columns) > 1 else storm_id_col, 'max'),
    ).reset_index()

    if target_col and target_col in df.columns:
        target_stats = df.groupby(storm_id_col)[target_col].agg(['sum', 'mean', 'max']).reset_index()
        target_stats.columns = [storm_id_col, 'target_sum', 'target_mean', 'target_max']
        stats = stats.merge(target_stats, on=storm_id_col)

    return stats