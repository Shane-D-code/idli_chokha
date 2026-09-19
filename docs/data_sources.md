# TOOFAN Data Sources

The provider layer is implemented in `src/providers`. Provider results never fabricate missing data: they return `AVAILABLE`, `DEGRADED`, `NOT_AVAILABLE`, or `ERROR` with provenance fields. Common retry, timeout, cache, TTL, and staleness handling live in `src/providers/base.py` and `src/providers/cache.py`.

Configured paths come from `configs/pipeline.yaml`.

| Provider | Data Type | Source / Path | Endpoint/API | Data Timestamp | Retrieval Timestamp | Cache / TTL | Staleness | Retry / Timeout | Auth | Current Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `cyclone_track` | Best-track observations | IMD `cyclone intensity/data/raw/IMD_best_track.xlsx` if present, fallback `wind/ibtracs.NI.list.v04r01.csv` | Local files | Request reference window | `ProviderResult.retrieved_at` | Optional `TTLCache`, default TTL 300s when used | Uses `stale_after_s` when configured | default no retries for this provider, 20s timeout | none | AVAILABLE when IMD or IBTrACS file exists; otherwise NOT_AVAILABLE |
| `weather_era5` | ERA5 pressure-level features/grids | `RI/models/RI_ERA5_features_MVP.csv`; fallback `RI/ERA5_expanded` or `RI/era5_datasets` | Local CSV/NetCDF | Request time when matched | `ProviderResult.retrieved_at` | Optional `TTLCache` | Uses `stale_after_s` | common retry/backoff, timeout | none | AVAILABLE when feature CSV or NetCDF archive exists; DEGRADED when only pressure-level archive exists for feature fetch |
| `rainfall_imerg` | IMERG observed precipitation | `rain/data` | Local files | Requested valid time | `ProviderResult.retrieved_at` | Optional `TTLCache` | Uses `stale_after_s` | common retry/backoff, timeout | none | AVAILABLE when matching grid exists; DEGRADED if no grid for time; NOT_AVAILABLE if archive absent |
| `satellite` | IR imagery/features | `RI/satellite_cnn_recovered/images`, `RI/satellite_cnn_recovered/metadata_clean.csv` | Local files | Image acquisition time | `ProviderResult.retrieved_at` | Optional `TTLCache` | Uses `stale_after_s` | common retry/backoff, timeout | none | AVAILABLE only if imagery archive exists and has a matching image; otherwise NOT_AVAILABLE/DEGRADED |
| `ocean_cmems` | CMEMS ocean fields | default `RI/models` granules matching `cmems_*.nc` | Local NetCDF | Requested/nearest time | `ProviderResult.retrieved_at` | Optional `TTLCache` | Uses `stale_after_s` | common retry/backoff, timeout | none | AVAILABLE when CMEMS granules exist; DEGRADED for missing variables/read gaps |
| `terrain` | Static DEM/soil/landcover/hydrology | `flood/data/dem.tif`, `flood/data/derived`, `flood/data/soil`, `flood/data/landcover.tif`, `flood/data/hydrology`, `flood/data/tide_surge` | Local rasters | Static/request time | `ProviderResult.retrieved_at` | Optional `TTLCache` | Usually static; `stale_after_s` can still be configured | common retry/backoff, timeout | none | NOT_AVAILABLE unless configured static raster files are present |
| `gridded_wind` | Six-frame U10/V10 wind grids | No source path | none | none | `ProviderResult.retrieved_at` for NOT_AVAILABLE result | Optional `TTLCache` but source unavailable | not applicable | not retried because `is_available()` is false | none | REQUIRED BUT NOT AVAILABLE |

## Required But Not Available

The wind model requires six temporal frames of U10/V10 10 m winds on an 81x57 grid with two channels. No legitimate provider for that contract is shipped. ERA5 pressure-level data is not a complete wind provider for this model because it does not implement the required six-frame surface U10/V10 pipeline.

`src/providers/gridded_wind.py` intentionally reports `NOT_AVAILABLE` so the rest of the system cannot silently substitute fake wind fields.

## Provider Behavior

Provider fetches are cached only when a cache object is supplied. `TTLCache` defaults to 300 seconds and 256 entries. Cache hits are copied before marking `from_cache=True`, avoiding aliasing between callers.

Staleness compares observation timestamp against `stale_after_s` and handles timezone-aware and naive timestamps safely. Stale data can still be returned as data, but warnings and `is_stale=True` make it visible.

Retry behavior is bounded. Retryable `ProviderError` failures use exponential backoff. Non-retryable errors, `ProviderNotAvailable`, validation failures, and timeouts return explicit provider statuses rather than raising through the pipeline.
