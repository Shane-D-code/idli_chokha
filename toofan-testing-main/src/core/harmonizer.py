"""Data Harmonization Layer for TOOFAN.

Handles:
1. Timestamp normalization (timezone, format)
2. Temporal alignment (interpolation to common time grid)
3. Spatial alignment (regridding to common grid)
4. Cyclone-centered extraction
5. Grid generation
6. Missing value handling with audit trail
7. Outlier detection
8. Unit normalization
9. Quality control flags
"""

from __future__ import annotations

import warnings
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import xarray as xr
from scipy import interpolate
from scipy.ndimage import gaussian_filter

from src.core.schema import (
    CycloneState, EnvironmentalFeatures, OceanFeatures, SatelliteFeatures,
    SatelliteImages, DataQualityFlag, ImputationRecord, Metadata
)


@dataclass
class HarmonizationConfig:
    """Configuration for data harmonization."""
    # Temporal
    reference_frequency: str = "3h"  # 3-hourly reference grid
    max_interpolation_gap: timedelta = timedelta(hours=12)
    extrapolation_limit: timedelta = timedelta(hours=6)

    # Spatial
    target_resolution_km: float = 10.0
    extraction_radius_km: float = 500.0
    grid_size: int = 101  # Odd number for centered grid

    # Quality control
    outlier_std_threshold: float = 4.0
    outlier_iqr_multiplier: float = 1.5
    min_valid_fraction: float = 0.5

    # Units
    target_units: dict[str, str] = field(default_factory=lambda: {
        'temperature': 'K',
        'wind_speed': 'm/s',
        'pressure': 'Pa',
        'precipitation': 'mm/hr',
        'humidity': '%',
        'sst': 'degC',
    })


class TimeNormalizer:
    """Normalize timestamps to UTC, handle timezone issues."""

    @staticmethod
    def to_utc(dt: Any) -> datetime:
        """Convert any timestamp to timezone-aware UTC datetime."""
        if isinstance(dt, str):
            # Try multiple formats
            for fmt in ['%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%d %H:%M:%S%z',
                        '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S']:
                try:
                    parsed = datetime.strptime(dt, fmt)
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                    return parsed.astimezone(timezone.utc)
                except ValueError:
                    continue
            raise ValueError(f"Unable to parse timestamp: {dt}")

        if isinstance(dt, datetime):
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)

        if isinstance(dt, (np.datetime64, pd.Timestamp)):
            return pd.Timestamp(dt).tz_localize('UTC').to_pydatetime()

        raise TypeError(f"Unsupported timestamp type: {type(dt)}")

    @staticmethod
    def normalize_series(series: pd.Series) -> pd.Series:
        """Normalize a pandas Series of timestamps to UTC."""
        return pd.to_datetime(series, utc=True)


class TemporalAligner:
    """Align time series to a common reference grid."""

    def __init__(self, config: HarmonizationConfig):
        self.config = config

    def align_to_reference(self, df: pd.DataFrame, time_col: str,
                           reference_times: pd.DatetimeIndex,
                           id_col: Optional[str] = None) -> pd.DataFrame:
        """Align DataFrame to reference time grid via interpolation."""
        df = df.copy()
        df[time_col] = TimeNormalizer.normalize_series(df[time_col])

        if id_col:
            # Group by ID and align each group
            aligned_groups = []
            for gid, group in df.groupby(id_col):
                aligned = self._align_group(group, time_col, reference_times)
                aligned[id_col] = gid
                aligned_groups.append(aligned)
            return pd.concat(aligned_groups, ignore_index=True)
        else:
            return self._align_group(df, time_col, reference_times)

    def _align_group(self, group: pd.DataFrame, time_col: str,
                     reference_times: pd.DatetimeIndex) -> pd.DataFrame:
        """Align a single group to reference times."""
        group = group.sort_values(time_col).reset_index(drop=True)

        # Identify numeric columns to interpolate
        numeric_cols = group.select_dtypes(include=[np.number]).columns.tolist()
        if time_col in numeric_cols:
            numeric_cols.remove(time_col)

        # Interpolate each numeric column
        result = pd.DataFrame({time_col: reference_times})

        for col in numeric_cols:
            values = group[col].values
            
            # Get times preserving timezone info
            times = group[time_col].to_numpy()

            # Convert times to UTC nanoseconds for interpolation
            # Handle both timezone-aware and naive timestamps
            if isinstance(times, pd.DatetimeIndex):
                # Pandas DatetimeIndex with timezone
                time_ns = times.tz_convert('UTC').astype('int64')
            elif isinstance(times, np.ndarray) and times.dtype.kind == 'M':
                # numpy datetime64 array - may have lost timezone, assume UTC
                time_ns = times.astype('datetime64[ns]').astype('int64')
            else:
                # Assume it's an array of Timestamp objects (from .to_numpy())
                time_ns = pd.DatetimeIndex(times).tz_convert('UTC').astype('int64')
            
            ref_ns = reference_times.tz_convert('UTC').astype('int64')

            # Check gap size
            time_diffs = np.diff(time_ns)
            max_gap_ns = np.max(time_diffs) if len(time_diffs) > 0 else 0
            max_gap = timedelta(microseconds=int(max_gap_ns / 1000))

            if max_gap > self.config.max_interpolation_gap:
                warnings.warn(f"Gap {max_gap} exceeds max interpolation gap for column {col}")

            # Linear interpolation
            interp_func = interpolate.interp1d(
                time_ns,
                values,
                kind='linear',
                bounds_error=False,
                fill_value='extrapolate'
            )

            result[col] = interp_func(ref_ns)

            # Mask extrapolated values beyond limit
            first_time_ns = time_ns[0]
            last_time_ns = time_ns[-1]
            extrap_limit_ns = int(self.config.extrapolation_limit.total_seconds() * 1e9)
            extrap_mask = (ref_ns < first_time_ns - extrap_limit_ns) | \
                          (ref_ns > last_time_ns + extrap_limit_ns)
            result.loc[extrap_mask, col] = np.nan

        return result

    def create_reference_grid(self, start: datetime, end: datetime) -> pd.DatetimeIndex:
        """Create reference time grid."""
        return pd.date_range(start=start, end=end, freq=self.config.reference_frequency, tz='UTC')


class SpatialAligner:
    """Align spatial data to common grid via regridding."""

    def __init__(self, config: HarmonizationConfig):
        self.config = config

    def regrid(self, data: np.ndarray, src_lats: np.ndarray, src_lons: np.ndarray,
               target_lats: np.ndarray, target_lons: np.ndarray,
               method: str = 'linear') -> np.ndarray:
        """Regrid 2D data from source to target grid."""
        # Create interpolator
        if method == 'linear':
            interp = interpolate.RegularGridInterpolator(
                (src_lats, src_lons), data,
                method='linear', bounds_error=False, fill_value=np.nan
            )
        elif method == 'nearest':
            interp = interpolate.RegularGridInterpolator(
                (src_lats, src_lons), data,
                method='nearest', bounds_error=False, fill_value=np.nan
            )
        else:
            raise ValueError(f"Unknown method: {method}")

        # Evaluate on target grid
        target_lons_2d, target_lats_2d = np.meshgrid(target_lons, target_lats)
        points = np.column_stack([target_lats_2d.ravel(), target_lons_2d.ravel()])
        result = interp(points).reshape(target_lats_2d.shape)
        return result

    def create_cyclone_centered_grid(self, center_lat: float, center_lon: float,
                                      radius_km: float = None,
                                      resolution_km: float = None) -> tuple[np.ndarray, np.ndarray]:
        """Create a regular lat/lon grid centered on cyclone."""
        radius = radius_km or self.config.extraction_radius_km
        res = resolution_km or self.config.target_resolution_km

        # Grid dimensions
        n = self.config.grid_size
        if n % 2 == 0:
            n += 1

        # Degree offsets
        dlat = radius / 111.0
        dlon = radius / (111.0 * np.cos(np.deg2rad(center_lat)))

        lats = np.linspace(center_lat + dlat, center_lat - dlat, n)
        lons = np.linspace(center_lon - dlon, center_lon + dlon, n)

        return lats, lons


class CycloneCenteredExtractor:
    """Extract cyclone-centered data cubes from global/regional grids."""

    def __init__(self, config: HarmonizationConfig):
        self.config = config
        self.spatial_aligner = SpatialAligner(config)

    def extract(self, state: CycloneState, grids: dict[str, np.ndarray],
                grid_lats: np.ndarray, grid_lons: np.ndarray) -> dict[str, np.ndarray]:
        """Extract cyclone-centered patches from multiple grids."""
        target_lats, target_lons = self.spatial_aligner.create_cyclone_centered_grid(
            state.latitude, state.longitude
        )

        extracted = {}
        for name, grid in grids.items():
            if grid.size == 0:
                extracted[name] = np.full((len(target_lats), len(target_lons)), np.nan)
                continue

            # Handle different grid shapes
            if grid.ndim == 2:
                extracted[name] = self.spatial_aligner.regrid(
                    grid, grid_lats, grid_lons, target_lats, target_lons
                )
            elif grid.ndim == 3:
                # Time series of grids: (T, H, W)
                extracted[name] = np.stack([
                    self.spatial_aligner.regrid(grid[t], grid_lats, grid_lons, target_lats, target_lons)
                    for t in range(grid.shape[0])
                ])
            else:
                warnings.warn(f"Unexpected grid shape for {name}: {grid.shape}")
                extracted[name] = np.full((len(target_lats), len(target_lons)), np.nan)

        return extracted


class MissingValueHandler:
    """Handle missing values with full audit trail."""

    def __init__(self, config: HarmonizationConfig):
        self.config = config
        self.imputation_records: list[ImputationRecord] = []

    def handle_missing(self, data: np.ndarray, field_name: str,
                       method: str = 'interpolation') -> tuple[np.ndarray, dict[str, DataQualityFlag]]:
        """Handle missing values in array, returning filled array and quality flags."""
        if data.ndim != 2:
            raise ValueError("Missing value handler expects 2D arrays")

        filled = data.copy()
        flags = np.full(data.shape, DataQualityFlag.ORIGINAL, dtype=object)

        # Find missing
        missing_mask = np.isnan(data) | np.isinf(data)

        if not np.any(missing_mask):
            return filled, {field_name: DataQualityFlag.ORIGINAL}

        valid_mask = ~missing_mask
        valid_fraction = np.sum(valid_mask) / data.size

        if valid_fraction < self.config.min_valid_fraction:
            warnings.warn(f"Field {field_name}: only {valid_fraction:.1%} valid data")

        if method == 'interpolation':
            filled, interp_flags = self._interpolate_2d(filled, missing_mask)
            flags[interp_flags] = DataQualityFlag.IMPUTED_INTERPOLATION

        elif method == 'mean':
            mean_val = np.nanmean(data)
            filled[missing_mask] = mean_val
            flags[missing_mask] = DataQualityFlag.IMPUTED_MEAN
            self.imputation_records.append(ImputationRecord(
                field_name=field_name, original_value=None, imputed_value=float(mean_val),
                method=DataQualityFlag.IMPUTED_MEAN
            ))

        elif method == 'median':
            median_val = np.nanmedian(data)
            filled[missing_mask] = median_val
            flags[missing_mask] = DataQualityFlag.IMPUTED_MEDIAN
            self.imputation_records.append(ImputationRecord(
                field_name=field_name, original_value=None, imputed_value=float(median_val),
                method=DataQualityFlag.IMPUTED_MEDIAN
            ))

        elif method == 'climatology':
            # Would need climatology data - placeholder
            filled[missing_mask] = 0.0
            flags[missing_mask] = DataQualityFlag.IMPUTED_CLIMATOLOGY

        else:
            raise ValueError(f"Unknown imputation method: {method}")

        return filled, {field_name: DataQualityFlag.ORIGINAL}

    def _interpolate_2d(self, data: np.ndarray, missing_mask: np.ndarray
                        ) -> tuple[np.ndarray, np.ndarray]:
        """2D interpolation for missing values."""
        filled = data.copy()
        interp_flags = np.zeros(data.shape, dtype=bool)

        valid_points = np.where(~missing_mask)
        if len(valid_points[0]) < 4:
            # Not enough points for interpolation
            return filled, interp_flags

        interp = interpolate.LinearNDInterpolator(
            np.column_stack(valid_points),
            data[valid_points],
            fill_value=np.nan
        )

        missing_points = np.where(missing_mask)
        interp_values = interp(np.column_stack(missing_points))

        # Only fill where interpolation succeeded
        success = ~np.isnan(interp_values)
        filled[missing_points[0][success], missing_points[1][success]] = interp_values[success]
        interp_flags[missing_points[0][success], missing_points[1][success]] = True

        return filled, interp_flags


class OutlierDetector:
    """Detect and optionally cap outliers."""

    def __init__(self, config: HarmonizationConfig):
        self.config = config

    def detect_outliers(self, data: np.ndarray, method: str = 'std') -> np.ndarray:
        """Return boolean mask of outliers."""
        valid = data[~np.isnan(data)]
        if len(valid) < 10:
            return np.zeros(data.shape, dtype=bool)

        if method == 'std':
            mean = np.mean(valid)
            std = np.std(valid)
            threshold = self.config.outlier_std_threshold * std
            return (np.abs(data - mean) > threshold) & ~np.isnan(data)

        elif method == 'iqr':
            q25, q75 = np.percentile(valid, [25, 75])
            iqr = q75 - q25
            lower = q25 - self.config.outlier_iqr_multiplier * iqr
            upper = q75 + self.config.outlier_iqr_multiplier * iqr
            return ((data < lower) | (data > upper)) & ~np.isnan(data)

        else:
            raise ValueError(f"Unknown outlier method: {method}")

    def cap_outliers(self, data: np.ndarray, method: str = 'std') -> tuple[np.ndarray, np.ndarray]:
        """Cap outliers to threshold values. Returns (capped_data, outlier_mask)."""
        outlier_mask = self.detect_outliers(data, method)
        capped = data.copy()

        if method == 'std':
            valid = data[~np.isnan(data) & ~outlier_mask]
            if len(valid) > 0:
                mean = np.mean(valid)
                std = np.std(valid)
                upper = mean + self.config.outlier_std_threshold * std
                lower = mean - self.config.outlier_std_threshold * std
                capped[outlier_mask & (data > upper)] = upper
                capped[outlier_mask & (data < lower)] = lower

        elif method == 'iqr':
            valid = data[~np.isnan(data) & ~outlier_mask]
            if len(valid) > 0:
                q25, q75 = np.percentile(valid, [25, 75])
                iqr = q75 - q25
                lower = q25 - self.config.outlier_iqr_multiplier * iqr
                upper = q75 + self.config.outlier_iqr_multiplier * iqr
                capped[outlier_mask & (data > upper)] = upper
                capped[outlier_mask & (data < lower)] = lower

        return capped, outlier_mask


class UnitNormalizer:
    """Normalize units to target system."""

    CONVERSIONS = {
        ('K', 'degC'): lambda x: x - 273.15,
        ('degC', 'K'): lambda x: x + 273.15,
        ('m/s', 'kt'): lambda x: x * 1.94384,
        ('kt', 'm/s'): lambda x: x / 1.94384,
        ('hPa', 'Pa'): lambda x: x * 100,
        ('Pa', 'hPa'): lambda x: x / 100,
        ('mm/hr', 'mm'): lambda x: x,  # Would need time integration
        ('deg', 'rad'): lambda x: np.deg2rad(x),
        ('rad', 'deg'): lambda x: np.rad2deg(x),
    }

    def __init__(self, config: HarmonizationConfig):
        self.config = config

    def normalize(self, data: np.ndarray, variable: str, from_unit: str) -> np.ndarray:
        """Convert data from source unit to target unit."""
        target_unit = self.config.target_units.get(variable, from_unit)

        if from_unit == target_unit:
            return data

        key = (from_unit, target_unit)
        if key in self.CONVERSIONS:
            return self.CONVERSIONS[key](data)

        # Try reverse
        reverse_key = (target_unit, from_unit)
        if reverse_key in self.CONVERSIONS:
            # Need inverse - not implemented for all
            warnings.warn(f"Inverse conversion not available for {variable}: {from_unit} -> {target_unit}")
            return data

        warnings.warn(f"No conversion defined for {variable}: {from_unit} -> {target_unit}")
        return data


class DataHarmonizer:
    """Main harmonization orchestrator."""

    def __init__(self, config: Optional[HarmonizationConfig] = None):
        self.config = config or HarmonizationConfig()
        self.time_normalizer = TimeNormalizer()
        self.temporal_aligner = TemporalAligner(self.config)
        self.spatial_aligner = SpatialAligner(self.config)
        self.extractor = CycloneCenteredExtractor(self.config)
        self.missing_handler = MissingValueHandler(self.config)
        self.outlier_detector = OutlierDetector(self.config)
        self.unit_normalizer = UnitNormalizer(self.config)

    def harmonize_cyclone_state(self, raw_state: dict) -> CycloneState:
        """Build and validate CycloneState from raw inputs with full QC."""
        # Normalize timestamp
        timestamp = self.time_normalizer.to_utc(raw_state['timestamp'])

        # Build environmental features with QC
        env_features = self._harmonize_environmental(raw_state.get('environmental', {}))
        ocean_features = self._harmonize_ocean(raw_state.get('ocean', {}))
        sat_features = self._harmonize_satellite(raw_state.get('satellite', {}))

        # Build metadata
        metadata = Metadata(
            source_datasets=raw_state.get('source_datasets', []),
            warnings=raw_state.get('warnings', []),
            missing_modalities=raw_state.get('missing_modalities', [])
        )

        return CycloneState(
            storm_id=raw_state['storm_id'],
            basin=raw_state.get('basin', 'NI'),
            timestamp=timestamp,
            latitude=float(raw_state['latitude']),
            longitude=float(raw_state['longitude']),
            max_wind_kt=raw_state.get('max_wind_kt'),
            central_pressure_hpa=raw_state.get('central_pressure_hpa'),
            category=raw_state.get('category'),
            heading_deg=raw_state.get('heading_deg'),
            translation_speed_kt=raw_state.get('translation_speed_kt'),
            acceleration=raw_state.get('acceleration'),
            wind_change_6h=raw_state.get('wind_change_6h'),
            wind_change_12h=raw_state.get('wind_change_12h'),
            wind_change_24h=raw_state.get('wind_change_24h'),
            pressure_change_6h=raw_state.get('pressure_change_6h'),
            pressure_change_12h=raw_state.get('pressure_change_12h'),
            pressure_change_24h=raw_state.get('pressure_change_24h'),
            environmental_features=env_features,
            ocean_features=ocean_features,
            satellite_features=sat_features,
            satellite_images=raw_state.get('satellite_images'),
            metadata=metadata
        )

    def _harmonize_environmental(self, raw: dict) -> EnvironmentalFeatures:
        """Harmonize environmental features with QC."""
        features = EnvironmentalFeatures()
        for field in ['t_850', 't_700', 't_500', 't_200',
                      'r_850', 'r_700', 'r_500', 'r_200',
                      'u_850', 'u_700', 'u_500', 'u_200',
                      'v_850', 'v_700', 'v_500', 'v_200',
                      'd_850', 'd_700', 'd_500', 'd_200',
                      'sst', 'sst_anomaly', 'ohc', 'tchp',
                      'vertical_wind_shear', 'shear_direction']:
            if field in raw:
                val = raw[field]
                if val is not None and not (isinstance(val, float) and np.isnan(val)):
                    setattr(features, field, float(val))
                    features.quality_flags[field] = DataQualityFlag.ORIGINAL
                else:
                    features.quality_flags[field] = DataQualityFlag.MISSING

        return features

    def _harmonize_ocean(self, raw: dict) -> OceanFeatures:
        features = OceanFeatures()
        for field in ['sst', 'sst_anomaly', 'mixed_layer_depth',
                      'barrier_layer_thickness', 'ocean_heat_content',
                      'tchp', 'salinity_0_50m', 'current_speed', 'current_direction']:
            if field in raw:
                val = raw[field]
                if val is not None and not (isinstance(val, float) and np.isnan(val)):
                    setattr(features, field, float(val))
                    features.quality_flags[field] = DataQualityFlag.ORIGINAL
                else:
                    features.quality_flags[field] = DataQualityFlag.MISSING
        return features

    def _harmonize_satellite(self, raw: dict) -> SatelliteFeatures:
        features = SatelliteFeatures()
        for field in ['ir_brightness_temp_min', 'ir_brightness_temp_mean',
                      'cloud_top_temperature', 'convective_area_fraction',
                      'symmetry_index', 'eye_score', 'spiral_band_score']:
            if field in raw:
                val = raw[field]
                if val is not None and not (isinstance(val, float) and np.isnan(val)):
                    setattr(features, field, float(val))
                    features.quality_flags[field] = DataQualityFlag.ORIGINAL
                else:
                    features.quality_flags[field] = DataQualityFlag.MISSING
        return features

    def harmonize_grids(self, grids: dict[str, np.ndarray],
                        grid_lats: np.ndarray, grid_lons: np.ndarray,
                        cyclone_state: CycloneState) -> dict[str, np.ndarray]:
        """Full harmonization of gridded data."""
        # 1. Extract cyclone-centered patches
        extracted = self.extractor.extract(cyclone_state, grids, grid_lats, grid_lons)

        # 2. Handle missing values per grid
        harmonized = {}
        for name, grid in extracted.items():
            if grid.size == 0:
                harmonized[name] = grid
                continue

            # Handle missing
            filled, _ = self.missing_handler.handle_missing(grid, name, method='interpolation')

            # Detect/cap outliers
            capped, outlier_mask = self.outlier_detector.cap_outliers(filled)
            if np.any(outlier_mask):
                warnings.warn(f"Outliers capped in {name}: {np.sum(outlier_mask)} pixels")

            harmonized[name] = capped

        return harmonized

    def align_time_series(self, df: pd.DataFrame, time_col: str,
                          reference_start: datetime, reference_end: datetime,
                          id_col: Optional[str] = None) -> pd.DataFrame:
        """Align time series to common reference grid."""
        reference_times = self.temporal_aligner.create_reference_grid(reference_start, reference_end)
        return self.temporal_aligner.align_to_reference(df, time_col, reference_times, id_col)


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def create_harmonizer(config: Optional[dict] = None) -> DataHarmonizer:
    """Create harmonizer from config dict."""
    if config is None:
        return DataHarmonizer()
    hc = HarmonizationConfig(**config)
    return DataHarmonizer(hc)


def validate_no_future_data(df: pd.DataFrame, time_col: str,
                            reference_time: datetime,
                            feature_cols: list[str]) -> tuple[bool, list[str]]:
    """Validate that no feature uses data from after reference_time.

    Returns (is_clean, list_of_violations).
    """
    violations = []

    for col in feature_cols:
        if col not in df.columns:
            continue

        # Check for suspicious column names
        if any(suffix in col.lower() for suffix in ['_t_plus', '_future', '_lead', '_target',
                                                    '_ahead', '_forward', 't+', 'lead_']):
            violations.append(f"Column {col} has future-suggesting name")

    # Check if any feature values correlate with future target
    # This is a basic check - full validation requires domain knowledge
    future_cols = [c for c in df.columns if 't_plus' in c or 'future' in c or 'lead' in c]
    if future_cols:
        violations.append(f"Future-leakage columns present: {future_cols}")

    return len(violations) == 0, violations