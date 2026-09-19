"""Cyclone State Builder for TOOFAN pipeline.

Builds the canonical CycloneState from raw data sources.
"""

from __future__ import annotations

import warnings
from datetime import datetime, timedelta
from typing import Any, Optional
from pathlib import Path

import numpy as np
import pandas as pd

from src.core.schema import (
    CycloneState, Basin, CycloneCategory, EnvironmentalFeatures,
    OceanFeatures, SatelliteFeatures, SatelliteImages, Metadata, DataQualityFlag
)
from src.core.ingestion import DataIngestionLayer
from src.core.harmonizer import DataHarmonizer, create_harmonizer


def _clean_scalar(value):
    """Coerce NaN/missing scalars to None so Pydantic bounded fields accept them."""
    try:
        if value is None or pd.isna(value):
            return None
    except (TypeError, ValueError):
        return value
    return value


class CycloneStateBuilder:
    """Builds validated CycloneState from multi-source data."""

    def __init__(self, ingestion_layer: DataIngestionLayer,
                 harmonizer: Optional[DataHarmonizer] = None):
        self.ingestion = ingestion_layer
        self.harmonizer = harmonizer or create_harmonizer()

    def build_from_storm_id(self, storm_id: str, basin: Basin,
                            reference_time: datetime,
                            lookback_hours: int = 72) -> CycloneState:
        """Build CycloneState for a storm at reference time.

        Args:
            storm_id: Storm identifier
            basin: Ocean basin
            reference_time: Forecast initialization time (UTC)
            lookback_hours: Hours of history to retrieve

        Returns:
            Validated CycloneState
        """
        # Load historical track
        history = self.ingestion.load_cyclone_history(
            storm_id, basin, lookback_hours, reference_time
        )

        # Filter to times <= reference_time
        history = history[history['timestamp'] <= reference_time].copy()

        if history.empty:
            raise ValueError(f"No historical data for storm {storm_id} before {reference_time}")

        # Get the latest observation (closest to reference_time)
        latest = history.iloc[-1]

        # Compute derived features from history
        derived = self._compute_derived_features(history, reference_time)

        # Load ERA5 environmental data
        era5_data = self._load_era5_features(storm_id, reference_time)

        # Load satellite data
        satellite_images = self._load_satellite(storm_id, reference_time)
        satellite_features = self._extract_satellite_features(satellite_images)

        # Load ocean data
        ocean_features = self._load_ocean_features(latest['latitude'], latest['longitude'],
                                                    reference_time)

        # Build raw state dict
        raw_state = {
            'storm_id': storm_id,
            'basin': basin.value,
            'timestamp': reference_time,
            'latitude': float(latest['latitude']),
            'longitude': float(latest['longitude']),
            'max_wind_kt': _clean_scalar(latest.get('max_wind_kt')),
            'central_pressure_hpa': _clean_scalar(latest.get('central_pressure_hpa')),
            'category': latest.get('category'),
            'heading_deg': _clean_scalar(latest.get('heading_deg')),
            'translation_speed_kt': _clean_scalar(latest.get('translation_speed_kt')),
            **derived,
            'environmental': era5_data or {},
            'ocean': ocean_features or {},
            'satellite': satellite_features or {},
            'satellite_images': satellite_images,
            'source_datasets': self._get_source_datasets(),
            'warnings': [],
            'missing_modalities': self._check_missing_modalities(era5_data, satellite_images, ocean_features)
        }

        # Harmonize and validate
        cyclone_state = self.harmonizer.harmonize_cyclone_state(raw_state)

        return cyclone_state

    def _compute_derived_features(self, history: pd.DataFrame,
                                   reference_time: datetime) -> dict:
        """Compute derived features from storm history."""
        derived = {}

        # Sort by time
        history = history.sort_values('timestamp')

        # Get current observation (closest to reference_time)
        current_idx = (history['timestamp'] - reference_time).abs().idxmin()
        current = history.loc[current_idx]

        # Wind changes
        for hours in [6, 12, 24]:
            target_time = reference_time - timedelta(hours=hours)
            past = history[history['timestamp'] <= target_time]
            if not past.empty:
                past_wind = past.iloc[-1].get('max_wind_kt')
                curr_wind = current.get('max_wind_kt')
                if past_wind is not None and curr_wind is not None:
                    derived[f'wind_change_{hours}h'] = _clean_scalar(float(curr_wind - past_wind))
                else:
                    derived[f'wind_change_{hours}h'] = None
            else:
                derived[f'wind_change_{hours}h'] = None

        # Pressure changes
        for hours in [6, 12, 24]:
            target_time = reference_time - timedelta(hours=hours)
            past = history[history['timestamp'] <= target_time]
            if not past.empty:
                past_pres = past.iloc[-1].get('central_pressure_hpa')
                curr_pres = current.get('central_pressure_hpa')
                if past_pres is not None and curr_pres is not None:
                    derived[f'pressure_change_{hours}h'] = _clean_scalar(float(curr_pres - past_pres))
                else:
                    derived[f'pressure_change_{hours}h'] = None
            else:
                derived[f'pressure_change_{hours}h'] = None

        # Acceleration (change in translation speed)
        if 'translation_speed_kt' in history.columns:
            speed_series = history['translation_speed_kt'].dropna()
            if len(speed_series) >= 2:
                derived['acceleration'] = _clean_scalar(float(speed_series.iloc[-1] - speed_series.iloc[-2]))
            else:
                derived['acceleration'] = None
        else:
            derived['acceleration'] = None

        return derived

    def _load_era5_features(self, storm_id: str, time: datetime) -> Optional[dict]:
        """Load ERA5 features for storm at time."""
        try:
            era5_df = self.ingestion.load_era5_for_storm(storm_id, time)
            if era5_df is not None and not era5_df.empty:
                # Get closest time match
                era5_df['time_diff'] = (era5_df['datetime_utc'] - time).abs()
                closest = era5_df.loc[era5_df['time_diff'].idxmin()]

                # Extract features (exclude metadata columns)
                exclude = ['storm_id', 'datetime_utc', 'time_diff', 'latitude', 'longitude',
                           'RI_24h', 'era5_delta_minutes']
                features = {k: float(v) for k, v in closest.items()
                           if k not in exclude and pd.notna(v)}
                return features
        except Exception as e:
            warnings.warn(f"Failed to load ERA5: {e}")
        return None

    def _load_satellite(self, storm_id: str, time: datetime) -> Optional[SatelliteImages]:
        """Load satellite image for storm at time."""
        try:
            return self.ingestion.load_satellite_for_storm(storm_id, time)
        except Exception as e:
            warnings.warn(f"Failed to load satellite: {e}")
        return None

    def _extract_satellite_features(self, images: Optional[SatelliteImages]) -> Optional[dict]:
        """Extract scalar features from satellite images."""
        if images is None or images.ir_image is None:
            return None

        ir = images.ir_image
        mask = images.ir_mask if images.ir_mask is not None else (~np.isnan(ir)).astype(float)

        valid_ir = ir[mask > 0.5]
        if len(valid_ir) == 0:
            return None

        return {
            'ir_brightness_temp_min': float(np.min(valid_ir)),
            'ir_brightness_temp_mean': float(np.mean(valid_ir)),
            'cloud_top_temperature': float(np.min(valid_ir)),
            'convective_area_fraction': float(np.sum(ir < 240) / np.sum(mask > 0.5)),
        }

    def _load_ocean_features(self, lat: float, lon: float, time: datetime) -> Optional[dict]:
        """Load ocean features for location/time."""
        # Try to get from ingestion layer if it has ocean data
        if hasattr(self.ingestion, 'sources') and 'era5' in self.ingestion.sources:
            try:
                grids = self.ingestion.load_environmental_grid(time, lat, lon, radius_km=200)
                if 'sst' in grids and grids['sst'].size > 0:
                    sst_grid = grids['sst']
                    center_idx = (sst_grid.shape[0] // 2, sst_grid.shape[1] // 2)
                    sst = float(sst_grid[center_idx])
                    return {
                        'sst': sst,
                        'sst_anomaly': None,  # Would need climatology
                        'tchp': None,
                    }
            except Exception:
                pass
        return None

    def _get_source_datasets(self) -> list[str]:
        """Get list of source datasets used."""
        datasets = []
        for name, source in self.ingestion.sources.items():
            if source.is_available():
                datasets.append(name)
        return datasets

    def _check_missing_modalities(self, era5: Optional[dict],
                                   satellite: Optional[SatelliteImages],
                                   ocean: Optional[dict]) -> list[str]:
        """Check which modalities are missing."""
        missing = []
        if era5 is None:
            missing.append('ERA5')
        if satellite is None:
            missing.append('satellite')
        if ocean is None:
            missing.append('ocean')
        return missing

    def build_from_observation(self, observation: dict,
                                history: Optional[pd.DataFrame] = None) -> CycloneState:
        """Build CycloneState from a single observation dict (for inference)."""
        # This is for when we have a single observation with all features
        raw_state = {
            'storm_id': observation['storm_id'],
            'basin': observation.get('basin', 'NI'),
            'timestamp': observation['timestamp'],
            'latitude': observation['latitude'],
            'longitude': observation['longitude'],
            'max_wind_kt': observation.get('max_wind_kt'),
            'central_pressure_hpa': observation.get('central_pressure_hpa'),
            'category': observation.get('category'),
            'heading_deg': observation.get('heading_deg'),
            'translation_speed_kt': observation.get('translation_speed_kt'),
            'acceleration': observation.get('acceleration'),
            'wind_change_6h': observation.get('wind_change_6h'),
            'wind_change_12h': observation.get('wind_change_12h'),
            'wind_change_24h': observation.get('wind_change_24h'),
            'pressure_change_6h': observation.get('pressure_change_6h'),
            'pressure_change_12h': observation.get('pressure_change_12h'),
            'pressure_change_24h': observation.get('pressure_change_24h'),
            'environmental': observation.get('environmental', {}),
            'ocean': observation.get('ocean', {}),
            'satellite': observation.get('satellite', {}),
            'satellite_images': observation.get('satellite_images'),
            'source_datasets': observation.get('source_datasets', []),
            'warnings': [],
            'missing_modalities': observation.get('missing_modalities', [])
        }

        return self.harmonizer.harmonize_cyclone_state(raw_state)


def create_state_builder(config: dict) -> CycloneStateBuilder:
    """Create state builder from config."""
    ingestion = DataIngestionLayer(config)
    harmonizer = create_harmonizer(config.get('harmonization', {}))
    return CycloneStateBuilder(ingestion, harmonizer)