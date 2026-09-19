"""CMEMS ocean state provider (real NetCDF archive in this repo)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import xarray as xr

from src.providers.base import BaseProvider, FetchOutcome, ProviderNotAvailable

OCEAN_VARIABLES = ["uo", "vo", "thetao", "mlotst", "zos"]


class CMEMSOceanProvider(BaseProvider):
    """Copernicus Marine (CMEMS) physical reanalysis fields.

    Three ``cmems_mod_glo_phy_my_*.nc`` granules ship under ``RI/models/``.
    ``fetch`` returns the variables available nearest to the requested time,
    reporting DEGRADED for any requested variable that is absent from the
    archive rather than manufacturing a substitute.
    """

    name = "ocean_cmems"
    dataset = "CMEMS global ocean physics (uo/vo/thetao/mlotst/zos)"

    def __init__(self, ocean_dir: str | None = "RI/models", **kwargs):
        super().__init__(**kwargs)
        self.ocean_dir = Path(ocean_dir) if ocean_dir else None
        self.source_path = str(self.ocean_dir) if self.ocean_dir else None

    def _granules(self) -> list[Path]:
        if self.ocean_dir is None or not self.ocean_dir.exists():
            return []
        return sorted(self.ocean_dir.glob("cmems_*.nc"))

    def is_available(self) -> bool:
        return bool(self._granules())

    def _fetch(self, query: dict) -> FetchOutcome:
        granules = self._granules()
        if not granules:
            raise ProviderNotAvailable(
                "no CMEMS granules in this deployment "
                f"(searched {self.ocean_dir})"
            )
        time = query.get("time") or datetime.utcnow()
        time_naive = time.replace(tzinfo=None) if time.tzinfo else None
        region = query.get("region")  # (lat_min, lat_max, lon_min, lon_max)
        requested = query.get("variables", OCEAN_VARIABLES)

        warnings: list[str] = []
        fields: dict[str, np.ndarray] = {}
        missing: list[str] = []
        used_granule: Optional[Path] = None

        for granule in granules:
            try:
                with xr.open_dataset(granule) as ds:
                    available = {str(v): v for v in ds.data_vars}
                    time_sel = None
                    if "time" in ds.coords or "time" in ds.dims:
                        time_dim = ds["time"]
                        q_time = time
                        if time_dim.dtype.kind == "M" and time_naive is not None:
                            q_time = time_naive
                        time_sel = time_dim.sel(time=q_time, method="nearest")
                        if isinstance(time_sel, xr.DataArray):
                            time_sel = time_sel.values
                    for var in requested:
                        if var not in available:
                            if var not in missing:
                                missing.append(var)
                            continue
                        da = ds[available[var]]
                        if region and (da.ndim >= 2):
                            lat_min, lat_max, lon_min, lon_max = region
                            sel = {}
                            if "latitude" in da.dims:
                                sel["latitude"] = slice(max(lat_min, float(da.latitude.min())),
                                                        min(lat_max, float(da.latitude.max())))
                            if "longitude" in da.dims:
                                sel["longitude"] = slice(float(da.longitude.min()),
                                                         float(da.longitude.max()))
                            if sel:
                                da = da.sel(**sel)
                        if time_sel is not None and "time" in da.dims:
                            da = da.sel(time=time_sel, method="nearest")
                        fields[var] = np.asarray(da.values, dtype=np.float64)
                    used_granule = granule
                    break
            except Exception as e:  # noqa: BLE001
                warnings.append(f"{granule.name}: {e}")
                continue

        if not fields:
            return FetchOutcome(
                data=None, degraded=True,
                warnings=warnings or ["CMEMS granules present but unreadable"],
                source_path=str(used_granule or self.ocean_dir), dataset=self.dataset,
                observation_timestamp=time,
            )

        degraded = bool(missing or warnings)
        if missing:
            warnings.append(f"variables absent from archive: {', '.join(missing)}")
        return FetchOutcome(
            data=fields, degraded=degraded, warnings=warnings,
            source_path=str(used_granule), dataset=self.dataset,
            observation_timestamp=time,
        )