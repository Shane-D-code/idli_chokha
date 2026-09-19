"""Satellite imagery provider (IR granules / extracted features)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

from src.core.ingestion import SatelliteLoader
from src.providers.base import BaseProvider, FetchOutcome, ProviderNotAvailable


class _SatelliteReader(SatelliteLoader):
    """Concrete loader; the base class declares abstract ``load``."""

    def load(self, **kwargs):
        raise NotImplementedError("use load_image() / load_metadata()")


class SatelliteProvider(BaseProvider):
    """IR brightness-temperature imagery nearest to a requested time.

    No satellite imagery is shipped in this repository, so ``fetch`` honestly
    reports NOT_AVAILABLE while declaring the exact source that would feed it.
    """

    name = "satellite"
    dataset = "INSAT / satellite IR imagery"

    def __init__(self, images_dir: str | None = None,
                 metadata_path: str | None = None, **kwargs):
        super().__init__(**kwargs)
        self.images_dir = Path(images_dir) if images_dir else None
        self.metadata_path = Path(metadata_path) if metadata_path else None
        self.source_path = str(self.images_dir) if self.images_dir else None
        self.loader = _SatelliteReader(self.images_dir, self.metadata_path) if self.images_dir else None

    def is_available(self) -> bool:
        return bool(self.images_dir and self.images_dir.exists())

    def _fetch(self, query: dict) -> FetchOutcome:
        if self.loader is None or not self.loader.is_available():
            raise ProviderNotAvailable(
                "no satellite imagery archive in this deployment (expected dir "
                f"{self.images_dir})"
            )
        storm_id = query.get("storm_id")
        time = query.get("time")
        tolerance_minutes = int(query.get("tolerance_minutes", 60))
        image = self.loader.load_image(storm_id, time, tolerance_minutes)
        if image is None:
            return FetchOutcome(
                data=None, degraded=True,
                warnings=[f"no satellite image for {storm_id} within "
                          f"{tolerance_minutes} min of {time}"],
                source_path=self.source_path, dataset=self.dataset,
                observation_timestamp=time,
            )
        return FetchOutcome(
            data=image, degraded=False, warnings=[],
            source_path=self.source_path, dataset=self.dataset,
            observation_timestamp=image.acquisition_time,
        )