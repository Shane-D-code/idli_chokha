"""Data-provider layer for TOOFAN.

A provider wraps a real, named data source (local archives or a remote API)
and exposes one uniform, honest contract: ``fetch(query)`` always returns a
``ProviderResult`` carrying an explicit status — AVAILABLE, DEGRADED,
NOT_AVAILABLE or ERROR — and never raises for expected failures. Providers
never fabricate: a source that does not exist in this deployment reports
NOT_AVAILABLE, and a source that only partially covers a query reports
DEGRADED with a reason.
"""

from __future__ import annotations

from src.providers.base import (
    BaseProvider,
    ProviderError,
    ProviderNotAvailable,
    ProviderResult,
    FetchOutcome,
)
from src.providers.cache import TTLCache
from src.providers.registry import ProviderRegistry, create_provider_layer
from src.providers.cyclone_track import CycloneTrackProvider
from src.providers.weather import ERA5WeatherProvider
from src.providers.rainfall import RainfallProvider
from src.providers.satellite import SatelliteProvider
from src.providers.ocean import CMEMSOceanProvider
from src.providers.terrain import TerrainProvider
from src.providers.gridded_wind import GriddedU10V10Provider

__all__ = [
    "BaseProvider",
    "ProviderError",
    "ProviderNotAvailable",
    "ProviderResult",
    "FetchOutcome",
    "TTLCache",
    "ProviderRegistry",
    "create_provider_layer",
    "CycloneTrackProvider",
    "ERA5WeatherProvider",
    "RainfallProvider",
    "SatelliteProvider",
    "CMEMSOceanProvider",
    "TerrainProvider",
    "GriddedU10V10Provider",
]