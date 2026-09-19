"""Cyclone best-track provider (IMD preferred, IBTrACS fallback)."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

from src.core.ingestion import IBTrACSLoader, IMDBestTrackLoader
from src.core.schema import Basin
from src.providers.base import BaseProvider, FetchOutcome

_BASIN_ENUM = Basin


class CycloneTrackProvider(BaseProvider):
    """Best-track history for a cyclone, filtered to a reference window.

    Prefers the IMD best-track (storm-labelled); falls back to IBTrACS and
    filters by basin + storm_id. Returns a normalized DataFrame of historical
    observations — the same rows the harmonizer consumes. Honest about gaps:
    a storm with no observations in the window returns a DEGRADED outcome.
    """

    name = "cyclone_track"
    dataset = "IMD/IBTrACS best-track observations"

    def __init__(self, imd_path: str | None = None, ibtracs_path: str | None = None,
                 *, timeout_ms: int = 20_000, max_retries: int = 0, **kwargs):
        super().__init__(timeout_ms=timeout_ms, max_retries=max_retries, **kwargs)
        self.imd_path = Path(imd_path) if imd_path else None
        self.ibtracs_path = Path(ibtracs_path) if ibtracs_path else None
        self.source_path = self._preferred_source()
        self._imd_loader = IMDBestTrackLoader(self.imd_path) if self.imd_path else None
        self._ibtracs_loader = IBTrACSLoader(self.ibtracs_path) if self.ibtracs_path else None

    def _preferred_source(self) -> Optional[str]:
        if self.imd_path and self.imd_path.exists():
            return str(self.imd_path)
        if self.ibtracs_path and self.ibtracs_path.exists():
            return str(self.ibtracs_path)
        return None

    def is_available(self) -> bool:
        return bool(self._preferred_source())

    def _fetch(self, query: dict) -> FetchOutcome:
        storm_id = query.get("storm_id")
        basin_raw = query.get("basin")
        basin = None
        if basin_raw is not None:
            try:
                basin = _BASIN_ENUM(basin_raw if not hasattr(basin_raw, "value") else basin_raw)
            except ValueError:
                basin = None
        reference_time = query.get("reference_time")
        lookback_hours = int(query.get("lookback_hours", 72))

        rows: pd.DataFrame = pd.DataFrame()
        source_used: str | None = None
        warnings: list[str] = []

        # Prefer IMD (storm-labelled best track).
        if self._imd_loader and self._imd_loader.is_available():
            try:
                df = self._imd_loader.load(
                    storm_id=storm_id,
                    basin=basin,
                )
                if not df.empty:
                    rows = df
                    source_used = str(self.imd_path)
            except Exception as e:  # noqa: BLE001 - report and fall through
                warnings.append(f"IMD load failed: {e}")

        if rows.empty and self._ibtracs_loader and self._ibtracs_loader.is_available():
            try:
                df = self._ibtracs_loader.load(basin=basin)
                if storm_id:
                    df = df[df["storm_id"] == storm_id]
                if not df.empty:
                    rows = df
                    source_used = str(self.ibtracs_path)
            except Exception as e:  # noqa: BLE001
                warnings.append(f"IBTrACS load failed: {e}")
                return FetchOutcome(
                    data=None, degraded=True,
                    warnings=warnings or ["track data load failed"],
                    source_path=source_used or self.source_path, dataset=self.dataset,
                )

        if rows.empty:
            return FetchOutcome(
                data=None, degraded=True,
                warnings=warnings or [
                    f"no observations for storm {storm_id!r} within {lookback_hours}h window"
                ],
                source_path=source_used or self.source_path, dataset=self.dataset,
            )

        end_time = reference_time or datetime.utcnow()
        start_time = end_time - timedelta(hours=lookback_hours)
        if "timestamp" in rows.columns:
            ts = pd.to_datetime(rows["timestamp"], utc=True)
            rows = rows[(ts >= start_time) & (ts <= end_time)]
            rows = rows.sort_values("timestamp").reset_index(drop=True)

        if rows.empty:
            return FetchOutcome(
                data=rows, degraded=True,
                warnings=[f"track observations outside the {lookback_hours}h window for {storm_id!r}"],
                source_path=source_used, dataset=self.dataset,
                observation_timestamp=end_time,
            )

        return FetchOutcome(
            data=rows, degraded=False, warnings=warnings,
            source_path=source_used, dataset=self.dataset,
            observation_timestamp=end_time,
        )