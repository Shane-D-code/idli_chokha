"""Provider registry and factory."""

from __future__ import annotations

from typing import Optional

from src.providers.base import BaseProvider
from src.providers.cyclone_track import CycloneTrackProvider
from src.providers.gridded_wind import GriddedU10V10Provider
from src.providers.ocean import CMEMSOceanProvider
from src.providers.rainfall import RainfallProvider
from src.providers.satellite import SatelliteProvider
from src.providers.terrain import TerrainProvider
from src.providers.weather import ERA5WeatherProvider


class ProviderRegistry:
    """Named lookup of data providers."""

    def __init__(self):
        self._providers: dict[str, BaseProvider] = {}

    def register(self, provider: BaseProvider):
        if provider.name in self._providers:
            raise ValueError(f"provider already registered: {provider.name}")
        self._providers[provider.name] = provider
        return provider

    def get(self, name: str) -> Optional[BaseProvider]:
        return self._providers.get(name)

    def all(self) -> list[BaseProvider]:
        return list(self._providers.values())

    def names(self) -> list[str]:
        return list(self._providers.keys())

    def availabilities(self) -> dict[str, dict]:
        """Availability snapshot: name -> {available, source_path, dataset}."""
        return {
            p.name: {
                "available": p.is_available(),
                "source_path": p.source_path,
                "dataset": p.dataset,
            }
            for p in self._providers.values()
        }

    def __contains__(self, name: str) -> bool:
        return name in self._providers


def create_provider_layer(config: dict) -> ProviderRegistry:
    """Build the production provider layer from pipeline config.

    Providers are constructed over the SAME real data sources the ingestion
    layer already uses (no new fabricated inputs); a provider whose source is
    absent reports NOT_AVAILABLE at fetch time.
    """
    data_cfg = config.get("data", {}) or {}
    providers_cfg = config.get("providers", {}) or {}
    registry = ProviderRegistry()

    def _tuned(name: str) -> dict:
        return providers_cfg.get(name) or {}

    common = {
        "timeout_ms": providers_cfg.get("timeout_ms", 15_000),
        "max_retries": providers_cfg.get("max_retries", 2),
        "stale_after_s": providers_cfg.get("stale_after_s"),
    }

    registry.register(CycloneTrackProvider(
        imd_path=data_cfg.get("imd_path"),
        ibtracs_path=data_cfg.get("ibtracs_path"),
        **{**common, **_tuned("cyclone_track")},
    ))

    weather_cfg = _tuned("weather_era5")
    registry.register(ERA5WeatherProvider(
        era5_dir=weather_cfg.get("era5_dir", data_cfg.get("era5_dir")),
        extracted_features=weather_cfg.get(
            "extracted_features", data_cfg.get("era5_extracted_features")),
        candidate_dirs=["RI/ERA5_expanded", "RI/era5_datasets"],
        **{**common, **_tuned("weather_era5")},
    ))

    registry.register(RainfallProvider(
        imerg_dir=data_cfg.get("imerg_dir"),
        **{**common, **_tuned("rainfall_imerg")},
    ))

    registry.register(SatelliteProvider(
        images_dir=data_cfg.get("satellite_dir"),
        metadata_path=data_cfg.get("satellite_metadata"),
        **{**common, **_tuned("satellite")},
    ))

    ocean_cfg = _tuned("ocean_cmems")
    registry.register(CMEMSOceanProvider(
        ocean_dir=ocean_cfg.get("dir", "RI/models"),
        **{**common, **_tuned("ocean_cmems")},
    ))

    registry.register(TerrainProvider(
        data_config=data_cfg,
        **{**common, **_tuned("terrain")},
    ))

    registry.register(GriddedU10V10Provider(
        **{**common, **_tuned("gridded_wind")},
    ))

    return registry