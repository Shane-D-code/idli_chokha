"""Tests for data harmonization."""

import pytest
import numpy as np
import pandas as pd
from datetime import datetime, timezone, timedelta

from src.core.harmonizer import (
    DataHarmonizer, HarmonizationConfig, TimeNormalizer,
    TemporalAligner, SpatialAligner, CycloneCenteredExtractor,
    MissingValueHandler, OutlierDetector, UnitNormalizer,
    create_harmonizer, validate_no_future_data
)
from src.core.schema import CycloneState, Basin, DataQualityFlag


class TestTimeNormalizer:
    """Test TimeNormalizer."""

    def test_to_utc_from_string(self):
        """Test parsing various string formats."""
        normalizer = TimeNormalizer()

        # ISO format with Z
        dt = normalizer.to_utc("2024-05-20T12:00:00Z")
        assert dt == datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc)

        # ISO format with offset
        dt = normalizer.to_utc("2024-05-20T12:00:00+05:30")
        assert dt == datetime(2024, 5, 20, 6, 30, 0, tzinfo=timezone.utc)

        # Space separated
        dt = normalizer.to_utc("2024-05-20 12:00:00")
        assert dt == datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc)

    def test_to_utc_from_datetime(self):
        """Test conversion from datetime objects."""
        normalizer = TimeNormalizer()

        # Naive datetime
        dt = normalizer.to_utc(datetime(2024, 5, 20, 12, 0, 0))
        assert dt.tzinfo == timezone.utc

        # Aware datetime
        dt = normalizer.to_utc(datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc))
        assert dt.tzinfo == timezone.utc

    def test_normalize_series(self):
        """Test normalizing pandas Series."""
        normalizer = TimeNormalizer()
        series = pd.Series([
            "2024-05-20T12:00:00Z",
            "2024-05-20T15:00:00Z",
            "2024-05-20T18:00:00Z",
        ])
        normalized = normalizer.normalize_series(series)
        # Returns Series with UTC timezone
        assert isinstance(normalized, pd.Series)
        assert normalized.dt.tz is not None


class TestTemporalAligner:
    """Test TemporalAligner."""

    def setup_method(self):
        self.config = HarmonizationConfig(
            reference_frequency="3h",
            max_interpolation_gap=timedelta(hours=12),
        )
        self.aligner = TemporalAligner(self.config)

    def test_align_single_group(self):
        """Test aligning a single time series."""
        df = pd.DataFrame({
            'time': pd.date_range('2024-05-20', periods=5, freq='6h', tz='UTC'),
            'value': [1.0, 2.0, 3.0, 4.0, 5.0],
        })

        reference_times = pd.date_range('2024-05-20', periods=9, freq='3h', tz='UTC')
        result = self.aligner._align_group(df, 'time', reference_times)

        assert len(result) == 9
        assert 'time' in result.columns
        assert 'value' in result.columns
        # Values should be interpolated
        assert not result['value'].isna().all()

    def test_align_with_groups(self):
        """Test aligning with group ID."""
        df = pd.DataFrame({
            'storm_id': ['S1', 'S1', 'S2', 'S2'],
            'time': pd.date_range('2024-05-20', periods=4, freq='6h', tz='UTC'),
            'value': [1.0, 2.0, 10.0, 20.0],
        })

        reference_times = pd.date_range('2024-05-20', periods=9, freq='3h', tz='UTC')
        result = self.aligner.align_to_reference(df, 'time', reference_times, 'storm_id')

        # Should have 2 groups * 9 reference times = 18 rows
        assert len(result) == 18
        assert set(result['storm_id'].unique()) == {'S1', 'S2'}

    def test_create_reference_grid(self):
        """Test reference grid creation."""
        start = datetime(2024, 5, 20, 0, 0, 0, tzinfo=timezone.utc)
        end = datetime(2024, 5, 20, 21, 0, 0, tzinfo=timezone.utc)  # 21:00 to avoid 24:00
        grid = self.aligner.create_reference_grid(start, end)

        # 21 hours / 3h = 7 + 1 = 8 points
        assert len(grid) == 8
        assert grid.freq == pd.Timedelta(hours=3)


class TestSpatialAligner:
    """Test SpatialAligner."""

    def setup_method(self):
        self.config = HarmonizationConfig(target_resolution_km=10.0, grid_size=11)
        self.aligner = SpatialAligner(self.config)

    def test_regrid_2d(self):
        """Test regridding 2D data."""
        # Source grid
        src_lats = np.linspace(10, 20, 11)
        src_lons = np.linspace(80, 90, 11)
        src_data = np.random.rand(11, 11)

        # Target grid (slightly different)
        tgt_lats = np.linspace(10.5, 19.5, 11)
        tgt_lons = np.linspace(80.5, 89.5, 11)

        result = self.aligner.regrid(src_data, src_lats, src_lons, tgt_lats, tgt_lons)

        assert result.shape == (11, 11)
        assert not np.all(np.isnan(result))

    def test_create_cyclone_centered_grid(self):
        """Test cyclone-centered grid creation."""
        lats, lons = self.aligner.create_cyclone_centered_grid(15.0, 85.0, radius_km=200)

        assert len(lats) == 11
        assert len(lons) == 11
        assert np.isclose(lats[5], 15.0, atol=0.1)  # Center
        assert np.isclose(lons[5], 85.0, atol=0.1)  # Center


class TestMissingValueHandler:
    """Test MissingValueHandler."""

    def setup_method(self):
        self.config = HarmonizationConfig()
        self.handler = MissingValueHandler(self.config)

    def test_handle_missing_interpolation(self):
        """Test interpolation of missing values."""
        data = np.array([
            [1.0, np.nan, 3.0],
            [np.nan, 5.0, np.nan],
            [7.0, 8.0, 9.0],
        ])

        filled, flags = self.handler.handle_missing(data, 'test_field', method='interpolation')

        assert not np.any(np.isnan(filled))
        assert filled[0, 0] == 1.0  # Original preserved
        assert filled[2, 2] == 9.0  # Original preserved

    def test_handle_missing_mean(self):
        """Test mean imputation."""
        data = np.array([
            [1.0, np.nan, 3.0],
            [np.nan, 5.0, np.nan],
            [7.0, 8.0, 9.0],
        ])

        filled, flags = self.handler.handle_missing(data, 'test_field', method='mean')

        assert not np.any(np.isnan(filled))
        mean_val = np.nanmean(data)
        assert np.allclose(filled[np.isnan(data)], mean_val)

    def test_no_missing(self):
        """Test handling array with no missing values."""
        data = np.array([[1.0, 2.0], [3.0, 4.0]])
        filled, flags = self.handler.handle_missing(data, 'test_field')
        assert np.array_equal(filled, data)


class TestOutlierDetector:
    """Test OutlierDetector."""

    def setup_method(self):
        self.config = HarmonizationConfig(outlier_std_threshold=2.0)
        self.detector = OutlierDetector(self.config)

    def test_detect_outliers_std(self):
        """Test std-based outlier detection."""
        # Need at least 10 valid points for detection to run
        data = np.array([1, 2, 3, 4, 5, 100, 6, 7, 8, 9, 10])
        outliers = self.detector.detect_outliers(data, method='std')

        assert outliers[5] == True  # 100 is outlier
        assert outliers[0] == False  # 1 is not
        assert np.sum(outliers) == 1

    def test_cap_outliers(self):
        """Test capping outliers."""
        data = np.array([1, 2, 3, 4, 5, 100, 6, 7, 8, 9, 10]).astype(float)
        capped, mask = self.detector.cap_outliers(data, method='std')

        assert capped[5] < 100  # Capped
        assert capped[0] == 1  # Unchanged
        assert mask[5] == True


class TestUnitNormalizer:
    """Test UnitNormalizer."""

    def setup_method(self):
        self.config = HarmonizationConfig(target_units={
            'temperature': 'degC',
            'wind_speed': 'kt',
            'pressure': 'Pa',
        })
        self.normalizer = UnitNormalizer(self.config)

    def test_kelvin_to_celsius(self):
        """Test K to °C conversion."""
        data = np.array([300.0, 273.15, 250.0])
        result = self.normalizer.normalize(data, 'temperature', 'K')
        expected = np.array([26.85, 0.0, -23.15])
        assert np.allclose(result, expected, atol=0.01)

    def test_mps_to_kt(self):
        """Test m/s to kt conversion."""
        data = np.array([10.0, 20.0, 5.0])
        result = self.normalizer.normalize(data, 'wind_speed', 'm/s')
        expected = data * 1.94384
        assert np.allclose(result, expected)

    def test_hpa_to_pa(self):
        """Test hPa to Pa conversion."""
        data = np.array([1000.0, 950.0])
        result = self.normalizer.normalize(data, 'pressure', 'hPa')
        expected = data * 100
        assert np.allclose(result, expected)

    def test_no_conversion_needed(self):
        """Test when units already match."""
        data = np.array([10.0, 20.0])
        result = self.normalizer.normalize(data, 'wind_speed', 'kt')
        assert np.array_equal(result, data)


class TestDataHarmonizer:
    """Test DataHarmonizer."""

    def setup_method(self):
        self.config = HarmonizationConfig()
        self.harmonizer = DataHarmonizer(self.config)

    def test_harmonize_cyclone_state(self):
        """Test building CycloneState from raw dict."""
        raw = {
            'storm_id': '2024-001',
            'basin': 'BOB',
            'timestamp': '2024-05-20T12:00:00Z',
            'latitude': 15.5,
            'longitude': 85.3,
            'max_wind_kt': 65.0,
            'central_pressure_hpa': 980.0,
            'environmental': {'sst': 29.5, 't_850': 300.0},
            'ocean': {'sst': 29.5},
            'satellite': {'ir_brightness_temp_min': 200.0},
            'source_datasets': ['IMD', 'ERA5'],
        }

        state = self.harmonizer.harmonize_cyclone_state(raw)

        assert isinstance(state, CycloneState)
        assert state.storm_id == '2024-001'
        assert state.basin == Basin.BAY_OF_BENGAL
        assert state.max_wind_kt == 65.0
        assert state.environmental_features.sst == 29.5

    def test_harmonize_grids(self):
        """Test grid harmonization."""
        # Create test grids with size matching default grid_size (101)
        n = 101
        lats = np.linspace(10, 20, n)
        lons = np.linspace(80, 90, n)
        
        # Create data with NaN at center (which will map to cyclone center)
        sst = np.random.rand(n, n) + 28
        sst[n//2, n//2] = np.nan  # NaN at center
        
        wind = np.random.rand(n, n) * 20

        grids = {
            'sst': sst,
            'wind': wind,
        }

        cyclone_state = CycloneState(
            storm_id='2024-001',
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.0,
            longitude=85.0,
        )

        harmonized = self.harmonizer.harmonize_grids(grids, lats, lons, cyclone_state)

        assert 'sst' in harmonized
        assert 'wind' in harmonized
        # NaN at center should be filled by interpolation
        assert not np.any(np.isnan(harmonized['sst'])), "NaN should be filled"
        assert not np.any(np.isnan(harmonized['wind']))


class TestValidateNoFutureData:
    """Test validate_no_future_data function."""

    def test_clean_features(self):
        """Test clean features pass validation."""
        df = pd.DataFrame({
            'wind_kt': [40, 45, 50],
            'pressure_hpa': [1000, 995, 990],
            'wind_change_6h': [5, 5, 5],
        })

        is_clean, violations = validate_no_future_data(
            df, 'timestamp', datetime.now(timezone.utc),
            ['wind_kt', 'pressure_hpa', 'wind_change_6h']
        )
        assert is_clean
        assert len(violations) == 0

    def test_future_features_detected(self):
        """Test detection of future-leakage features."""
        df = pd.DataFrame({
            'wind_kt': [40, 45, 50],
            'wind_t_plus_6h': [50, 55, 60],  # Future!
            'pressure_lead_12h': [990, 985, 980],  # Future!
        })

        is_clean, violations = validate_no_future_data(
            df, 'timestamp', datetime.now(timezone.utc),
            ['wind_kt', 'wind_t_plus_6h', 'pressure_lead_12h']
        )
        assert not is_clean
        assert len(violations) >= 2


if __name__ == '__main__':
    pytest.main([__file__, '-v'])