"""Static terrain provider (DEM, soil, landcover, hydrology grids)."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from src.providers.base import BaseProvider, FetchOutcome, ProviderNotAvailable
from src.core.ingestion import DEMLoader


class _DemReader(DEMLoader):
    """Concrete DEM loader; the base class declares abstract ``load``."""

    def load(self, **kwargs):
        raise NotImplementedError("use load_dem() / load_derived()")


_TERRAIN_KEYS = (
    "dem_path", "dem_derived_dir", "soil_dir",
    "landcover_path", "hydro_dir", "tide_surge_dir",
)


class TerrainProvider(BaseProvider):
    """Static susceptibility layers used by the flood and landslide branches.

    No DEM/soil/landcover/hydrology rasters ship in this repository, so this
    provider honestly reports NOT_AVAILABLE while declaring the configured
    source paths (``configs/pipeline.yaml`` -> ``data.*``). A deployment that
    supplies the rasters starts serving AVAILABLE automatically.
    """

    name = "terrain"
    dataset = "Static terrain rasters (DEM, slope, soil, landcover, hydrology)"

    def __init__(self, data_config: Optional[dict] = None, **kwargs):
        super().__init__(**kwargs)
        self.data_config = dict(data_config or {})
        self.dem_path = Path(self.data_config["dem_path"]) if self.data_config.get("dem_path") else None
        self.source_path = str(self.dem_path) if self.dem_path else None

    def _static_paths(self) -> dict[str, str]:
        return {k: str(self.data_config[k]) for k in _TERRAIN_KEYS
                if self.data_config.get(k)}

    def is_available(self) -> bool:
        if self.dem_path is not None and self.dem_path.exists():
            return True
        for v in self._static_paths().values():
            if Path(v).exists():
                return True
        return False

    def _fetch(self, query: dict) -> FetchOutcome:
        if not self.is_available():
            raise ProviderNotAvailable(
                "no static terrain rasters in this deployment; configured targets: "
                + "; ".join(f"{k}={v}" for k, v in self._static_paths().items())
            )
        region = query.get("region")
        time = query.get("time")

        grids: dict[str, object] = {}
        warnings: list[str] = []
        try:
            loader = _DemReader(
                self.dem_path,
                self.data_config.get("dem_derived_dir"),
            )
            if loader.is_available() and region:
                elevation, lats, lons = loader.load_dem(region[0], region[2])
                grids["elevation"] = elevation
                grids["lats"] = lats
                grids["lons"] = lons
        except Exception as e:  # noqa: BLE001
            warnings.append(f"terrain load failed: {e}")

        if not grids:
            return FetchOutcome(
                data=None, degraded=True,
                warnings=warnings or ["terrain rasters present but unreadable"],
                source_path=self.source_path, dataset=self.dataset,
                observation_timestamp=time,
            )
        return FetchOutcome(
            data=grids, degraded=bool(warnings), warnings=warnings,
            source_path=self.source_path, dataset=self.dataset,
            observation_timestamp=time,
        )