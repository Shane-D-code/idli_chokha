# TOOFAN Failure Handling

TOOFAN uses an honest failure model. Missing artifacts, providers, dependencies, and invalid inputs are exposed instead of converted into fabricated predictions.

## Status Vocabulary

| Status | Meaning |
|---|---|
| `AVAILABLE` | Real data/model output was produced. |
| `DEGRADED` | Output or source exists but is partial, stale, limited, or unverified. |
| `BASELINE` | Baseline or case-study output, not a complete verified operational forecast. |
| `NOT_AVAILABLE` | Required artifact, provider, dependency, or usable input is absent. |
| `ERROR` | A provider or model raised an execution error. |

Internal orchestrator execution statuses are `SUCCESS`, `FAILED`, and `UNAVAILABLE`. `PipelineService` maps those into the API hazard status vocabulary.

## Failure Cases

Provider failure returns `ERROR` after retry/backoff is exhausted. Non-retryable provider errors stop retry immediately. Provider absence returns `NOT_AVAILABLE`.

Timeouts return `ERROR` with timeout detail after the configured attempts.

Stale data returns a result with `is_stale=True` and warnings. Depending on provider output it may be treated as degraded rather than fresh.

Missing model artifacts leave the module graph node intact, but the module returns `UNAVAILABLE` with reason `model artifact unavailable (not loaded)`.

Missing dependencies propagate to dependent modules only. If rainfall is unavailable, landslide is unavailable. If wind is unavailable, flood is unavailable. RI does not become unavailable just because wind failed.

Missing upstream results are caught before dependent prediction where the parallel DAG requires them. The serial legacy path has intentionally narrower gating for rainfall, wind, flood, and landslide.

Invalid model input becomes a module `FAILED`/API `ERROR` condition unless the adapter returns an explicit unavailable status.

Malformed provider data becomes `DEGRADED` or `ERROR` depending on whether the provider can return partial validated data.

Unavailable wind U10/V10 provider is explicit. The wind adapter does not fabricate wind fields. Grid-fed wind inference remains verified separately through `predict_grids()` with real arrays matching `(6, 81, 57, 2)`.

Partial pipeline completion is normal. A completed run may contain available, degraded, baseline, unavailable, and error statuses across different modules.

## Concrete Examples

Genesis unavailable:

```text
genesis -> NOT_AVAILABLE
trajectory -> NOT_AVAILABLE because dependency unavailable: genesis
intensity -> NOT_AVAILABLE because dependency unavailable: genesis
rainfall -> NOT_AVAILABLE because dependency unavailable: trajectory
wind -> NOT_AVAILABLE because dependency unavailable: trajectory
flood -> NOT_AVAILABLE because dependency unavailable: rainfall or wind
hazard_engine -> returns an honest degraded or empty assessment
```

Wind provider absent:

```text
trajectory and intensity can complete
wind -> BASELINE or NOT_AVAILABLE with no wind_fields
flood -> NOT_AVAILABLE if usable wind/rainfall inputs are missing
hazard_engine -> excludes unusable wind/flood components
```

Rainfall unavailable but RI available:

```text
genesis -> AVAILABLE or DEGRADED
ri -> AVAILABLE/DEGRADED if its own inputs and artifact are usable
rainfall -> NOT_AVAILABLE
landslide -> NOT_AVAILABLE because rainfall is missing
hazard_engine -> aggregates usable RI and other branches, skips unusable rainfall/landslide
```

All upstream hazards unavailable:

```text
hazard_engine assessed_hazards -> []
overall_hazard_severity -> null
confidence -> 0.0
```

The hazard engine constructs components only for usable hazard outputs: non-empty `wind_fields`, valid rainfall grids, non-empty flood probability grids, and usable landslide outputs.
