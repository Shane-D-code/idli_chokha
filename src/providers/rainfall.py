"""IMERG precipitation provider (same-time rainfall grids)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import numpy as np

from src.core.ingestion import IMERGLoader
from src.providers.base import BaseProvider, FetchOutcome, ProviderNotAvailable


class RainfallProvider(BaseProvider):
    """IMERG half-hourly precipitation accumulated as a regional grid.

    The shipped archive (:file:`rain/data`) covers the FANI 2019 case study
    and is same-time observed rainfall — it is NOT a forecast. The provider
    reports DEGRADED when no grid matches the requested valid time.
    """

    name = "rainfall_imerg"
    dataset = "IMERG precipitation (mm/hr)"

    def __init__(self, imerg_dir: str | None = None, **kwargs):
        super().__init__(**kwargs)
        self.imerg_dir = Path(imerg_dir) if imerg_dir else None
        self.source_path = str(self.imerg_dir) if self.imerg_dir else None
        self.loader = IMERGLoader(self.imerg_dir) if self.imerg_dir else None

    def is_available(self) -> bool:
        return bool(self.imerg_dir and self.imerg_dir.exists())

    def _fetch(self, query: dict) -> FetchOutcome:
        if self.loader is None or not self.loader.is_available():
            raise ProviderNotAvailable("no IMERG archive in this deployment")
        time = query.get("time")
        lat_range = query.get("lat_range", (8.0, 24.0))
        lon_range = query.get("lon_range", (80.0, 92.0))

        grid = self.loader.load(time or datetime.utcnow(), lat_range, lon_range)
        if grid is None or (isinstance(grid, np.ndarray) and grid.size == 0):
            return FetchOutcome(
                data=None, degraded=True,
                warnings=[f"no IMERG grid for {time}"],
                source_path=self.source_path, dataset=self.dataset,
                observation_timestamp=time,
            )
        return FetchOutcome(
            data=grid, degraded=False, warnings=[],
            source_path=self.source_path, dataset=self.dataset,
            observation_timestamp=time,
        )