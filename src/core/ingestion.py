"""Data Ingestion Layer for TOOFAN.

Provides unified access to all data sources with consistent interfaces.
Each source has a dedicated loader class with standardized output format.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional
import warnings

import numpy as np
import pandas as pd
import xarray as xr

from src.core.schema import (
    Basin, CycloneState, EnvironmentalFeatures, OceanFeatures,
    SatelliteFeatures, SatelliteImages, Metadata, DataQualityFlag
)


class DataSource(ABC):
    """Abstract base class for all data sources."""

    @abstractmethod
    def load(self, **kwargs) -> Any:
        """Load data from source."""
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Check if source is accessible."""
        pass

    @abstractmethod
    def get_metadata(self) -> dict:
        """Get source metadata."""
        pass


class IMDBestTrackLoader(DataSource):
    """Load IMD best-track data."""

    def __init__(self, data_path: str | Path):
        self.data_path = Path(data_path)
        self._cache: Optional[pd.DataFrame] = None

    def is_available(self) -> bool:
        return self.data_path.exists()

    def get_metadata(self) -> dict:
        return {
            "source": "IMD Best Track",
            "path": str(self.data_path),
            "available": self.is_available()
        }

    def load(self, storm_id: Optional[str] = None, basin: Optional[Basin] = None,
             start_date: Optional[datetime] = None, end_date: Optional[datetime] = None) -> pd.DataFrame:
        """Load IMD best-track data with optional filtering."""
        if self._cache is None:
            if not self.is_available():
                raise FileNotFoundError(f"IMD data not found at {self.data_path}")

            # Try to detect format
            if self.data_path.suffix == '.csv':
                df = pd.read_csv(self.data_path)
            elif self.data_path.suffix in ['.xlsx', '.xls']:
                df = pd.read_excel(self.data_path)
            else:
                raise ValueError(f"Unsupported format: {self.data_path.suffix}")

            # Standardize column names
            df = self._standardize_columns(df)
            self._cache = df

        df = self._cache.copy()

        # Apply filters
        if storm_id:
            df = df[df['storm_id'] == storm_id]
        if basin:
            df = df[df['basin'] == basin.value]
        if start_date:
            df = df[df['timestamp'] >= start_date]
        if end_date:
            df = df[df['timestamp'] <= end_date]

        return df.sort_values(['storm_id', 'timestamp']).reset_index(drop=True)

    def _standardize_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Standardize column names to expected schema."""
        col_map = {
            'SID': 'storm_id',
            'ISO_TIME': 'timestamp',
            'LAT': 'latitude',
            'LON': 'longitude',
            'WIND': 'max_wind_kt',
            'MSLP': 'central_pressure_hpa',
            'BASIN': 'basin',
            'STORM_DIR': 'heading_deg',
            'STORM_SPEED': 'translation_speed_kt',
        }
        df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})

        # Ensure timestamp is datetime
        if 'timestamp' in df.columns:
            df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True)

        # Add basin if missing
        if 'basin' not in df.columns:
            df['basin'] = Basin.NORTH_INDIAN.value

        return df


class IBTrACSLoader(DataSource):
    """Load IBTrACS best-track data."""

    def __init__(self, data_path: str | Path):
        self.data_path = Path(data_path)
        self._cache: Optional[pd.DataFrame] = None

    def is_available(self) -> bool:
        return self.data_path.exists()

    def get_metadata(self) -> dict:
        return {"source": "IBTrACS", "path": str(self.data_path), "available": self.is_available()}

    def load(self, basin: Optional[Basin] = None, **kwargs) -> pd.DataFrame:
        if self._cache is None:
            if not self.is_available():
                raise FileNotFoundError(f"IBTrACS data not found at {self.data_path}")

            df = pd.read_csv(self.data_path, low_memory=False)
            df = self._standardize_columns(df)
            self._cache = df

        df = self._cache.copy()

        if basin:
            df = df[df['basin'] == basin.value]

        return df

    def _standardize_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Standardize IBTrACS columns."""
        # IBTrACS v04r01 column mapping (agency-specific wind/pressure sources
        # vary by file: WMO_*, USA_*, NOAA_* are all observed best-track sets).
        col_map = {
            'SID': 'storm_id',
            'ISO_TIME': 'timestamp',
            'LAT': 'latitude',
            'LON': 'longitude',
            'BASIN': 'basin',
            'STORM_DIR': 'heading_deg',
            'STORM_SPEED': 'translation_speed_kt',
        }
        df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})

        # Observed wind/pressure best-track sets vary by IBTrACS file
        # (WMO_*, USA_*, NOAA_*). Coalesce in a priority order so a file
        # containing several agency columns still yields ONE standardized pair.
        for target, preferred in [('max_wind_kt', ('WMO_WIND', 'USA_WIND', 'NOAA_WIND')),
                                  ('central_pressure_hpa', ('WMO_PRES', 'USA_PRES', 'NOAA_PRES'))]:
            cols = [c for c in preferred if c in df.columns]
            if cols:
                if target not in df.columns:
                    df[target] = df[cols[0]].copy()
                else:
                    df[target] = df[df.columns[df.columns == target][0]].copy()
                for c in cols:
                    if c == target or c not in df.columns:
                        continue
                    df[target] = df[target].fillna(df[c])
                df = df.drop(columns=[c for c in cols if c in df.columns])

        if 'timestamp' in df.columns:
            df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True, errors='coerce')
            valid = df['timestamp'].notna()
            if valid.sum() < len(df):
                df = df[valid].copy()

        if 'basin' in df.columns:
            df['basin'] = df['basin'].str.strip()
        elif 'basin' not in df.columns:
            df['basin'] = Basin.NORTH_INDIAN.value

        # IBTrACS stores numeric cells as text ('' for missing); coerce so
        # arithmetic on the standardized columns never sees str values.
        for col in ['max_wind_kt', 'central_pressure_hpa', 'latitude', 'longitude',
                    'heading_deg', 'translation_speed_kt']:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')

        return df


class ERA5Loader(DataSource):
    """Load ERA5 reanalysis data (NetCDF or pre-extracted CSV)."""
    def load(self, **kwargs) -> Any:
        raise NotImplementedError("use load_extracted_features() / load_raw_netcdf()")


    def __init__(self, data_dir: str | Path, extracted_features_path: Optional[str | Path] = None):
        self.data_dir = Path(data_dir)
        self.extracted_features_path = Path(extracted_features_path) if extracted_features_path else None
        self._features_cache: Optional[pd.DataFrame] = None

    def is_available(self) -> bool:
        return self.data_dir.exists() or (self.extracted_features_path and self.extracted_features_path.exists())

    def get_metadata(self) -> dict:
        return {
            "source": "ERA5",
            "data_dir": str(self.data_dir),
            "extracted_features": str(self.extracted_features_path) if self.extracted_features_path else None,
            "available": self.is_available()
        }

    def load_extracted_features(self, storm_id: Optional[str] = None,
                                start_date: Optional[datetime] = None,
                                end_date: Optional[datetime] = None) -> pd.DataFrame:
        """Load pre-extracted ERA5 features (CSV format)."""
        if self.extracted_features_path is None or not self.extracted_features_path.exists():
            raise FileNotFoundError("Extracted ERA5 features not available")

        if self._features_cache is None:
            self._features_cache = pd.read_csv(self.extracted_features_path)
            if 'datetime_utc' in self._features_cache.columns:
                self._features_cache['datetime_utc'] = pd.to_datetime(
                    self._features_cache['datetime_utc'], utc=True)

        df = self._features_cache.copy()

        if storm_id:
            df = df[df['storm_id'] == storm_id]
        if start_date:
            df = df[df['datetime_utc'] >= start_date]
        if end_date:
            df = df[df['datetime_utc'] <= end_date]

        return df.sort_values(['storm_id', 'datetime_utc']).reset_index(drop=True)

    def load_raw_netcdf(self, variable: str, time: datetime, lat_range: tuple,
                        lon_range: tuple, pressure_levels: Optional[list[int]] = None) -> xr.DataArray:
        """Load raw ERA5 NetCDF for a specific variable/time/region."""
        # Find matching NetCDF file
        pattern = f"*{variable}*{time.strftime('%Y%m%d')}*.nc"
        files = list(self.data_dir.glob(pattern))
        if not files:
            # Try broader pattern
            files = list(self.data_dir.glob("*.nc"))

        if not files:
            raise FileNotFoundError(f"No ERA5 NetCDF files found in {self.data_dir}")

        # Load first matching file
        ds = xr.open_dataset(files[0])

        # Select region and time
        da = ds[variable]
        da = da.sel(latitude=slice(lat_range[1], lat_range[0]),  # ERA5 lat descending
                    longitude=slice(lon_range[0], lon_range[1]))

        if 'time' in da.dims:
            da = da.sel(time=time, method='nearest')

        if pressure_levels and 'level' in da.dims:
            da = da.sel(level=pressure_levels)

        return da


class SatelliteLoader(DataSource):
    """Load satellite imagery (INSAT, TCIR, etc.)."""
    def load(self, **kwargs) -> Any:
        raise NotImplementedError("use load_metadata() / load_image()")


    def __init__(self, data_dir: str | Path, metadata_path: Optional[str | Path] = None):
        self.data_dir = Path(data_dir)
        self.metadata_path = Path(metadata_path) if metadata_path else None
        self._metadata_cache: Optional[pd.DataFrame] = None

    def is_available(self) -> bool:
        return self.data_dir.exists()

    def get_metadata(self) -> dict:
        return {"source": "Satellite", "data_dir": str(self.data_dir), "available": self.is_available()}

    def load_metadata(self) -> pd.DataFrame:
        """Load satellite metadata (image index)."""
        if self._metadata_cache is None:
            if self.metadata_path and self.metadata_path.exists():
                self._metadata_cache = pd.read_csv(self.metadata_path)
            else:
                # Build metadata from files
                self._metadata_cache = self._build_metadata_index()
        return self._metadata_cache

    def _build_metadata_index(self) -> pd.DataFrame:
        """Build metadata index from image files."""
        records = []
        for img_file in self.data_dir.rglob("*.npy"):
            # Parse filename: typically storm_id_YYYYMMDD_HHMM.npy
            parts = img_file.stem.split('_')
            if len(parts) >= 3:
                storm_id = parts[0]
                try:
                    dt_str = '_'.join(parts[1:3])
                    dt = datetime.strptime(dt_str, '%Y%m%d_%H%M')
                    records.append({
                        'storm_id': storm_id,
                        'datetime_utc': dt,
                        'image_path': str(img_file),
                        'granule_file': img_file.name
                    })
                except ValueError:
                    pass
        return pd.DataFrame(records)

    def load_image(self, storm_id: str, time: datetime, tolerance_minutes: int = 60) -> Optional[SatelliteImages]:
        """Load satellite image closest to given time."""
        meta = self.load_metadata()
        if meta.empty:
            return None

        # Filter by storm
        storm_meta = meta[meta['storm_id'] == storm_id].copy()
        if storm_meta.empty:
            return None

        # Find closest time
        storm_meta['time_diff'] = (storm_meta['datetime_utc'] - time).abs()
        closest = storm_meta.loc[storm_meta['time_diff'].idxmin()]

        if closest['time_diff'] > timedelta(minutes=tolerance_minutes):
            return None

        # Load image
        img_path = Path(closest['image_path'])
        if not img_path.exists():
            return None

        img_data = np.load(img_path)

        # Expecting (H, W) or (H, W, 1)
        if img_data.ndim == 3 and img_data.shape[-1] == 1:
            img_data = img_data[..., 0]

        # Create valid mask (non-NaN pixels)
        mask = (~np.isnan(img_data)).astype(np.float32)

        # Fill NaN with neutral value
        img_filled = np.where(np.isnan(img_data), 280.0, img_data)

        return SatelliteImages(
            ir_image=img_filled.astype(np.float32),
            ir_mask=mask,
            image_center_lat=closest.get('latitude'),
            image_center_lon=closest.get('longitude'),
            acquisition_time=closest['datetime_utc']
        )


class IMERGLoader(DataSource):
    """Load IMERG precipitation data."""

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)

    def is_available(self) -> bool:
        return self.data_dir.exists()

    def get_metadata(self) -> dict:
        return {"source": "IMERG", "data_dir": str(self.data_dir), "available": self.is_available()}

    def load(self, time: datetime, lat_range: tuple, lon_range: tuple) -> np.ndarray:
        """Load IMERG precipitation for given time and region."""
        # IMERG files typically named like: 3B-HHR.MS.MRG.3IMERG.YYYYMMDD-SHHMMSS-EHHMMSS.V06B.HDF5
        # For simplicity, look for CSV exports
        pattern = f"*{time.strftime('%Y%m%d')}*.csv"
        files = list(self.data_dir.glob(pattern))

        if not files:
            warnings.warn(f"No IMERG files found for {time}")
            return np.array([])

        # Load first matching file
        df = pd.read_csv(files[0])

        # Expect columns: lat, lon, precipitation
        if all(c in df.columns for c in ['lat', 'lon', 'precipitation']):
            # Pivot to grid
            lats = np.sort(df['lat'].unique())
            lons = np.sort(df['lon'].unique())
            grid = df.pivot(index='lat', columns='lon', values='precipitation').values
            return grid

        return np.array([])


class DEMLoader(DataSource):
    """Load Digital Elevation Model and derived terrain products."""
    def load(self, **kwargs) -> Any:
        raise NotImplementedError("use load_dem() / load_derived()")


    def __init__(self, dem_path: str | Path, derived_dir: Optional[str | Path] = None):
        self.dem_path = Path(dem_path)
        self.derived_dir = Path(derived_dir) if derived_dir else None

    def is_available(self) -> bool:
        return self.dem_path.exists()

    def get_metadata(self) -> dict:
        return {"source": "DEM", "path": str(self.dem_path), "available": self.is_available()}

    def load_dem(self, lat_range: tuple, lon_range: tuple) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Load DEM for region. Returns (elevation, lats, lons)."""
        if self.dem_path.suffix in ['.nc', '.nc4']:
            ds = xr.open_dataset(self.dem_path)
            # Assume variable name 'elevation' or 'z'
            var = 'elevation' if 'elevation' in ds else list(ds.data_vars)[0]
            da = ds[var]
            da = da.sel(lat=slice(lat_range[1], lat_range[0]),  # depends on convention
                        lon=slice(lon_range[0], lon_range[1]))
            elevation = da.values
            lats = da.lat.values
            lons = da.lon.values
            return elevation, lats, lons
        else:
            # Try GeoTIFF
            import rasterio
            with rasterio.open(self.dem_path) as src:
                window = src.window(*lon_range, *lat_range)
                elevation = src.read(1, window=window)
                transform = src.window_transform(window)
                lats = np.array([transform * (0, i) for i in range(elevation.shape[0])])[:, 1]
                lons = np.array([transform * (j, 0) for j in range(elevation.shape[1])])[:, 0]
                return elevation, lats, lons

    def load_derived(self, product: str, lat_range: tuple, lon_range: tuple) -> np.ndarray:
        """Load derived product (slope, aspect, curvature, flow_accumulation)."""
        if not self.derived_dir:
            raise ValueError("Derived products directory not configured")

        path = self.derived_dir / f"{product}.tif"
        if not path.exists():
            path = self.derived_dir / f"{product}.nc"

        if path.suffix == '.tif':
            import rasterio
            with rasterio.open(path) as src:
                window = src.window(*lon_range, *lat_range)
                return src.read(1, window=window)
        else:
            ds = xr.open_dataset(path)
            var = product if product in ds else list(ds.data_vars)[0]
            da = ds[var].sel(lat=slice(lat_range[1], lat_range[0]),
                             lon=slice(lon_range[0], lon_range[1]))
            return da.values


class SoilLoader(DataSource):
    """Load soil properties (type, moisture, depth)."""

    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)

    def is_available(self) -> bool:
        return self.data_dir.exists()

    def get_metadata(self) -> dict:
        return {"source": "Soil", "data_dir": str(self.data_dir), "available": self.is_available()}

    def load(self, product: str, lat_range: tuple, lon_range: tuple) -> np.ndarray:
        """Load soil product."""
        path = self.data_dir / f"{product}.tif"
        if not path.exists():
            return np.array([])

        import rasterio
        with rasterio.open(path) as src:
            window = src.window(*lon_range, *lat_range)
            return src.read(1, window=window)


class LandCoverLoader(DataSource):
    """Load land cover / land use data."""

    def __init__(self, data_path: str | Path):
        self.data_path = Path(data_path)

    def is_available(self) -> bool:
        return self.data_path.exists()

    def get_metadata(self) -> dict:
        return {"source": "LandCover", "path": str(self.data_path), "available": self.is_available()}

    def load(self, lat_range: tuple, lon_range: tuple) -> np.ndarray:
        if self.data_path.suffix == '.tif':
            import rasterio
            with rasterio.open(self.data_path) as src:
                window = src.window(*lon_range, *lat_range)
                return src.read(1, window=window)
        return np.array([])


class RiverNetworkLoader(DataSource):
    """Load river network and drainage data."""
    def load(self, **kwargs) -> Any:
        raise NotImplementedError("use load_drainage_area() / load_flow_accumulation()")


    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)

    def is_available(self) -> bool:
        return self.data_dir.exists()

    def get_metadata(self) -> dict:
        return {"source": "RiverNetwork", "data_dir": str(self.data_dir), "available": self.is_available()}

    def load_drainage_area(self, lat_range: tuple, lon_range: tuple) -> np.ndarray:
        path = self.data_dir / "drainage_area.tif"
        if path.exists():
            import rasterio
            with rasterio.open(path) as src:
                window = src.window(*lon_range, *lat_range)
                return src.read(1, window=window)
        return np.array([])

    def load_flow_accumulation(self, lat_range: tuple, lon_range: tuple) -> np.ndarray:
        path = self.data_dir / "flow_accumulation.tif"
        if path.exists():
            import rasterio
            with rasterio.open(path) as src:
                window = src.window(*lon_range, *lat_range)
                return src.read(1, window=window)
        return np.array([])


class TideStormSurgeLoader(DataSource):
    """Load tide and storm surge data."""
    def load(self, **kwargs) -> Any:
        raise NotImplementedError("use load_tide() / load_surge()")


    def __init__(self, data_dir: str | Path):
        self.data_dir = Path(data_dir)

    def is_available(self) -> bool:
        return self.data_dir.exists()

    def get_metadata(self) -> dict:
        return {"source": "TideSurge", "data_dir": str(self.data_dir), "available": self.is_available()}

    def load_tide(self, time: datetime, lat: float, lon: float) -> float:
        """Load tide height for location/time."""
        # Placeholder - would integrate with tide models
        return 0.0

    def load_surge(self, time: datetime, lat_range: tuple, lon_range: tuple) -> np.ndarray:
        """Load storm surge grid."""
        # Placeholder
        return np.array([])


class DataIngestionLayer:
    """Unified data ingestion layer coordinating all sources."""

    def __init__(self, config: dict):
        self.config = config
        self.sources = self._initialize_sources()

    def _initialize_sources(self) -> dict[str, DataSource]:
        """Initialize all data source loaders from config."""
        sources = {}

        # Cyclone track data
        if 'ibtracs_path' in self.config:
            sources['ibtracs'] = IBTrACSLoader(self.config['ibtracs_path'])
        if 'imd_path' in self.config:
            sources['imd'] = IMDBestTrackLoader(self.config['imd_path'])

        # ERA5
        if 'era5_dir' in self.config:
            sources['era5'] = ERA5Loader(
                self.config['era5_dir'],
                self.config.get('era5_extracted_features')
            )

        # Satellite
        if 'satellite_dir' in self.config:
            sources['satellite'] = SatelliteLoader(
                self.config['satellite_dir'],
                self.config.get('satellite_metadata')
            )

        # Precipitation
        if 'imerg_dir' in self.config:
            sources['imerg'] = IMERGLoader(self.config['imerg_dir'])

        # Terrain
        if 'dem_path' in self.config:
            sources['dem'] = DEMLoader(
                self.config['dem_path'],
                self.config.get('dem_derived_dir')
            )

        # Soil
        if 'soil_dir' in self.config:
            sources['soil'] = SoilLoader(self.config['soil_dir'])

        # Land cover
        if 'landcover_path' in self.config:
            sources['landcover'] = LandCoverLoader(self.config['landcover_path'])

        # Hydrology
        if 'hydro_dir' in self.config:
            sources['hydrology'] = RiverNetworkLoader(self.config['hydro_dir'])

        # Coastal
        if 'tide_surge_dir' in self.config:
            sources['tide_surge'] = TideStormSurgeLoader(self.config['tide_surge_dir'])

        return sources

    def check_availability(self) -> dict[str, bool]:
        """Check which sources are available."""
        return {name: src.is_available() for name, src in self.sources.items()}

    def get_source_metadata(self) -> dict:
        """Get metadata for all sources."""
        return {name: src.get_metadata() for name, src in self.sources.items()}

    def load_cyclone_history(self, storm_id: str, basin: Basin,
                             lookback_hours: int = 72,
                             reference_time: Optional[datetime] = None) -> pd.DataFrame:
        """Load historical cyclone track for a storm.

        The retrieval window is anchored at ``reference_time`` (falling back to
        now) so HISTORICAL storms can be loaded against their forecast
        initialization time instead of only live storms in the last
        ``lookback_hours``.
        """
        # Prefer IMD, fallback to IBTrACS
        end_time = reference_time or datetime.utcnow()  # Caller may anchor on reference time
        start_time = end_time - timedelta(hours=lookback_hours)

        if 'imd' in self.sources and self.sources['imd'].is_available():
            return self.sources['imd'].load(storm_id=storm_id, basin=basin,
                                             start_date=start_time, end_date=end_time)
        elif 'ibtracs' in self.sources and self.sources['ibtracs'].is_available():
            return self.sources['ibtracs'].load(basin=basin,
                                                 start_date=start_time, end_date=end_time)
        else:
            raise RuntimeError("No cyclone track data source available")

    def load_era5_for_storm(self, storm_id: str, time: datetime) -> Optional[pd.DataFrame]:
        """Load ERA5 features for a specific storm at time."""
        if 'era5' in self.sources and self.sources['era5'].is_available():
            try:
                return self.sources['era5'].load_extracted_features(
                    storm_id=storm_id,
                    start_date=time - timedelta(hours=6),
                    end_date=time + timedelta(hours=6)
                )
            except Exception as e:
                warnings.warn(f"Failed to load ERA5: {e}")
        return None

    def load_satellite_for_storm(self, storm_id: str, time: datetime) -> Optional[SatelliteImages]:
        """Load satellite image for storm at time."""
        if 'satellite' in self.sources and self.sources['satellite'].is_available():
            return self.sources['satellite'].load_image(storm_id, time)
        return None

    def load_environmental_grid(self, time: datetime, center_lat: float, center_lon: float,
                                 radius_km: float = 500) -> dict[str, np.ndarray]:
        """Load environmental grids (ERA5, IMERG, etc.) centered on cyclone."""
        lat_range = (center_lat - radius_km/111, center_lat + radius_km/111)
        lon_range = (center_lon - radius_km/111, center_lon + radius_km/111)

        grids = {}

        # ERA5 variables
        if 'era5' in self.sources and self.sources['era5'].is_available():
            for var in ['t', 'r', 'u', 'v', 'd']:
                for level in [850, 700, 500, 200]:
                    try:
                        da = self.sources['era5'].load_raw_netcdf(
                            var, time, lat_range, lon_range, [level]
                        )
                        grids[f'{var}_{level}'] = da.values
                    except Exception:
                        pass

        # IMERG precipitation
        if 'imerg' in self.sources and self.sources['imerg'].is_available():
            grids['precipitation'] = self.sources['imerg'].load(time, lat_range, lon_range)

        # SST
        if 'era5' in self.sources and self.sources['era5'].is_available():
            try:
                da = self.sources['era5'].load_raw_netcdf('sst', time, lat_range, lon_range)
                grids['sst'] = da.values
            except Exception:
                pass

        return grids

    def load_terrain_grid(self, center_lat: float, center_lon: float,
                          radius_km: float = 500) -> dict[str, np.ndarray]:
        """Load terrain and static grids centered on location."""
        lat_range = (center_lat - radius_km/111, center_lat + radius_km/111)
        lon_range = (center_lon - radius_km/111, center_lon + radius_km/111)

        grids = {}

        if 'dem' in self.sources and self.sources['dem'].is_available():
            grids['elevation'], grids['lats'], grids['lons'] = \
                self.sources['dem'].load_dem(lat_range, lon_range)

            for product in ['slope', 'aspect', 'curvature', 'flow_accumulation']:
                grids[product] = self.sources['dem'].load_derived(product, lat_range, lon_range)

        if 'soil' in self.sources and self.sources['soil'].is_available():
            for product in ['soil_type', 'soil_moisture', 'soil_depth']:
                grids[product] = self.sources['soil'].load(product, lat_range, lon_range)

        if 'landcover' in self.sources and self.sources['landcover'].is_available():
            grids['landcover'] = self.sources['landcover'].load(lat_range, lon_range)

        if 'hydrology' in self.sources and self.sources['hydrology'].is_available():
            grids['drainage_area'] = self.sources['hydrology'].load_drainage_area(lat_range, lon_range)
            grids['flow_accumulation'] = self.sources['hydrology'].load_flow_accumulation(lat_range, lon_range)

        return grids