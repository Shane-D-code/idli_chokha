"""ERA5 reanalysis weather provider.

Wraps the existing ERA5 loader. Two real data paths are honoured:
  1. Pre-extracted feature CSV (storm-labelled rows, e.g.
     ``RI/models/RI_ERA5_features_*.csv``) — returned as a DataFrame.
  2. Pressure-level NetCDF archive (which ships in this repo under
     ``RI/ERA5_expanded``) — served via :meth:`fetch_grid` for individual
     variables/levels/regions.

The archive is pressure-level only: it contains u/v/t/r at 850/700/500/200 hPa
and NO 10 m winds, so ``fetch`` reports DEGRADED when feature extraction is
not shipped and never fabricates surface wind.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

import xarray as xr

from src.core.ingestion import ERA5Loader
from src.providers.base import BaseProvider, FetchOutcome, ProviderError, ProviderNotAvailable

PRESSURE_LEVELS = [850, 700, 500, 200]
PRESSURE_VARIABLES = ["u", "v", "t", "r", "d"]


class _ERA5Reader(ERA5Loader):
    """Concrete ERA5 loader (the base class declares ``load`` abstract but the
    provider only needs the feature/grid readers)."""

    def load(self, **kwargs):
        raise NotImplementedError("use load_extracted_features() / load_raw_netcdf()")


class ERA5WeatherProvider(BaseProvider):
    name = "weather_era5"
    dataset = "ERA5 reanalysis (pressure-level) / pre-extracted feature CSV"

    def __init__(self, era5_dir: str | None = None,
                 extracted_features: str | None = None,
                 candidate_dirs: Optional[list[str]] = None, **kwargs):
        super().__init__(**kwargs)
        self.era5_dir = Path(era5_dir) if era5_dir else None
        self.extracted_features_path = Path(extracted_features) if extracted_features else None
        self._candidate_dirs = [Path(d) for d in (candidate_dirs or [])]
        self._resolved_dir: Optional[Path] = None
        if self.era5_dir and self.era5_dir.exists():
            self._resolved_dir = self.era5_dir
        elif self._candidate_dirs:
            for d in self._candidate_dirs:
                if d.exists():
                    self._resolved_dir = d
                    break
        self.source_path = str(self._resolved_dir) if self._resolved_dir else None
        self.loader = _ERA5Reader(
            self._resolved_dir or (Path(".") if not self.era5_dir else self.era5_dir),
            self.extracted_features_path,
        )

    def is_available(self) -> bool:
        if self.extracted_features_path and self.extracted_features_path.exists():
            return True
        return self._resolved_dir is not None and any(self._resolved_dir.glob("*.nc"))

    def _fetch(self, query: dict) -> FetchOutcome:
        storm_id = query.get("storm_id")
        time = query.get("time")
        warnings: list[str] = []

        # Extracted-feature CSV path.
        if self.extracted_features_path and self.extracted_features_path.exists():
            try:
                df = self.loader.load_extracted_features(
                    storm_id=storm_id,
                    start_date=(time - _hours(6)) if time else None,
                    end_date=(time + _hours(6)) if time else None,
                )
                if df.empty:
                    return FetchOutcome(
                        data=df, degraded=True,
                        warnings=[f"no extracted ERA5 rows for storm {storm_id!r}"],
                        source_path=str(self.extracted_features_path), dataset=self.dataset,
                    )
                return FetchOutcome(
                    data=df, degraded=False, warnings=[],
                    source_path=str(self.extracted_features_path), dataset=self.dataset,
                    observation_timestamp=time,
                )
            except Exception as e:  # noqa: BLE001
                return FetchOutcome(
                    data=None, degraded=True,
                    warnings=[f"extracted features unavailable: {e}"],
                    source_path=str(self.extracted_features_path), dataset=self.dataset,
                )

        # Pressure-level archive path (no 10 m winds in the archive).
        if self._resolved_dir is not None:
            nc_count = len(list(self._resolved_dir.glob("*.nc")))
            return FetchOutcome(
                data=None, degraded=True,
                warnings=[
                    "pre-extracted feature CSV not shipped; pressure-level NetCDF "
                    f"archive present ({nc_count} files) -> use fetch_grid(). "
                    "Archive has NO 10 m winds (u10/v10), so the wind model grid "
                    "provider remains unavailable."
                ],
                source_path=str(self._resolved_dir), dataset=self.dataset,
                observation_timestamp=time,
            )

        raise ProviderNotAvailable("no ERA5 source in this deployment")

    def fetch_grid(self, time: datetime, variable: str, region: tuple, level: int | None = None):
        """Read an ERA5 pressure-level field for a time/region (real NetCDF).

        Raises ``ProviderError`` when the archive or the field is absent.
        """
        if self._resolved_dir is None:
            raise ProviderNotAvailable("no ERA5 NetCDF archive in this deployment")
        try:
            da = self.loader.load_raw_netcdf(
                variable, time, region, None if level is None else [level]
            )
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f"ERA5 grid fetch failed: {e}", retryable=False) from e
        return da

    @property
    def archive_variables(self) -> list[str]:
        """Variables actually present in the shipped NetCDF archive."""
        if self._resolved_dir is None:
            return []
        for f in sorted(self._resolved_dir.glob("*.nc"))[:1]:
            with xr.open_dataset(f) as ds:
                return [str(v) for v in ds.data_vars]
        return []


def _hours(n: int):
    from datetime import timedelta
    return timedelta(hours=n)