"""Gridded 10 m wind provider (declared but intentionally absent).

The wind model (``wind/model/wind_model_best.keras``, input
``(None, 6, 81, 57, 2)``) requires six temporal frames of gridded U10/V10
10 m winds. No such provider ships in this repository. This provider is the
explicit, honest seam: it always reports NOT_AVAILABLE with the exact grid
contract, so callers cannot mistake a missing source for a validated input
and the pipeline never fabricates U10/V10 grids.
"""

from __future__ import annotations

from src.providers.base import BaseProvider, FetchOutcome, ProviderNotAvailable

GRID_CONTRACT = (
    "6 temporal frames of U10/V10 (m/s) on an 81x57 grid (2 channels), "
    "normalized per wind/metadata/wind_normalization.txt (U10 mean 1.7261697 "
    "std 4.4725676; V10 mean 3.1894329 std 4.518691). Spatial extent and "
    "orientation are undocumented in this repo."
)


class GriddedU10V10Provider(BaseProvider):
    name = "gridded_wind"
    dataset = "Gridded U10/V10 10 m wind fields (6 frames, 81x57)"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.source_path = None

    def is_available(self) -> bool:
        return False

    def _fetch(self, query: dict) -> FetchOutcome:  # pragma: no cover - never reached
        raise ProviderNotAvailable(
            f"gridded U10/V10 provider is intentionally absent; contract: {GRID_CONTRACT}"
        )