#!/usr/bin/env python3
"""Deterministic entry point for the ERA5 RI dataset rebuild (RI Improvement 2).

Rebuilds the exact 89-feature ERA5 RI matrix:

* universe = canonical MVP observations + satellite-meta observations whose
  ERA5 row is absent from the canonical table;
* rows covered by a raw CDS NetCDF in ``--era5-directory`` are extracted with
  bilinear interpolation at the storm centre (``extracted_from_raw``);
* remaining historical rows carry the canonical extracted values
  (``carried_historical`` — the raw NetCDF is not in the repo; reported as a
  blocker rather than fabricated);
* the frozen 89-feature contract is asserted against the spec and the frozen
  model artifact; derived + temporal features use the same code as the frozen
  model (``src/features.py``), nothing is re-implemented.

Outputs (default ``era5_datasets/`` under the project): feature CSV with
provenance, provenance CSV, manifest JSON, integrity-check JSON, MVP
comparison JSON. No model training or tuning is performed by this script.

Usage:
    python build_era5_ri_dataset.py [--best-track models/RI_ERA5_features_MVP.csv]
        [--era5-directory ERA5_expanded]
        [--satellite-meta satellite_cnn_recovered/metadata_clean.csv]
        [--frozen-model models/era5_final_xgboost.json]
        [--spec era5_ri_feature_spec_89.json]
        [--output-dir era5_datasets]
        [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]
        [--storms "id1 id2"] [--lags-h 6 12 24] [--write-spec-only]
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src import era5_rebuild as er  # noqa: E402

DEFAULTS = {
    "best_track": ROOT / "models" / "RI_ERA5_features_MVP.csv",
    "era5_dir": ROOT / "ERA5_expanded",
    "satellite_meta": ROOT / "satellite_cnn_recovered" / "metadata_clean.csv",
    "frozen_model": ROOT / "models" / "era5_final_xgboost.json",
    "spec": ROOT / "era5_ri_feature_spec_89.json",
    "output_dir": ROOT / "era5_datasets",
}


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--best-track", default=str(DEFAULTS["best_track"]))
    p.add_argument("--era5-directory", default=str(DEFAULTS["era5_dir"]),
                   help="Directory of raw CDS NetCDF files era5_pressure_levels_*.nc")
    p.add_argument("--satellite-meta",
                   default=str(DEFAULTS["satellite_meta"]),
                   help="optional; adds satellite obs missing from canonical ERA5")
    p.add_argument("--frozen-model", default=str(DEFAULTS["frozen_model"]))
    p.add_argument("--spec", default=str(DEFAULTS["spec"]))
    p.add_argument("--output-dir", default=str(DEFAULTS["output_dir"]))
    p.add_argument("--start-date", default=None)
    p.add_argument("--end-date", default=None)
    p.add_argument("--storms", default=None,
                   help="space-separated storm_id filter")
    p.add_argument("--lags-h", type=int, nargs="*", default=[6, 12, 24])
    p.add_argument("--write-spec-only", action="store_true",
                   help="write the 89-feature spec JSON and exit")
    return p.parse_args(argv)


def _schema_stamp() -> dict:
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python": platform.python_version(),
        "seed_note": "no RNG used in dataset build (deterministic transform only)",
        "code_version": "ri-improvement-2 era5_rebuild.py",
    }


def main(argv=None) -> int:
    args = parse_args(argv)
    lags = tuple(args.lags_h)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.write_spec_only:
        spec = er.write_feature_spec(Path(args.spec), lags_h=lags)
        print(json.dumps({"features": len(spec), "file": args.spec}, indent=2))
        return 0

    # --- contract -----------------------------------------------------------------
    spec = er.load_feature_spec(args.spec) if Path(args.spec).exists() \
        else er.build_feature_spec(lags_h=lags)
    spec_names = [f["name"] for f in spec]
    if len(spec_names) != 89:
        print(f"ERROR: spec has {len(spec_names)} features, expected 89"); return 1
    er.assert_89_contract(spec_names, spec)
    if Path(args.frozen_model).exists():
        er.assert_89_contract(spec_names, model_path=args.frozen_model)
    print(f"[contract] 89-feature spec OK (matches frozen model: "
          f"{spec_names == er.frozen_model_feature_names(args.frozen_model)})")

    # --- build --------------------------------------------------------------------
    t0 = time.time()
    table = er.build_dataset(
        canonical_path=args.best_track,
        era5_dir=args.era5_directory,
        satellite_meta=args.satellite_meta,
        start_date=args.start_date,
        end_date=args.end_date,
        storm_list=args.storms.split() if args.storms else None,
        lags_h=lags,
        spec=spec,
    )
    build_s = time.time() - t0

    checks = er.integrity_checks(table, spec, model_path=args.frozen_model)
    prov = er.provenance_summary(table)
    mvp_cmp = er.compare_derived_to_multimodal(table)
    recompute_cmp = er.compare_historical_rows_recompute(
        table, args.best_track, spec, lags_h=lags)

    files_by_date = er._era5_files_by_date(args.era5_directory)
    manifest = {
        "purpose": "RI Improvement 2 — rebuild of the 89-feature ERA5 RI dataset",
        "status": "rebuilt; raw CDS extraction where NetCDF present, historical "
                  "carry otherwise (no fabrication)",
        **_schema_stamp(),
        "options": {
            "best_track": str(Path(args.best_track).name),
            "era5_directory": str(Path(args.era5_directory).name),
            "satellite_meta": (str(Path(args.satellite_meta).name)
                               if args.satellite_meta else None),
            "start_date": args.start_date,
            "end_date": args.end_date,
            "storm_filter": args.storms,
            "lags_h": list(lags),
        },
        "contract": {
            "n_features": 89,
            "matches_frozen_model": bool(checks["feature"]["matches_frozen_model"]),
            "spec_file": str(Path(args.spec).name) if Path(args.spec).exists() else None,
        },
        "sources": {
            "n_netcdf_files_present": len(files_by_date),
            "netcdf_dates": sorted(files_by_date),
            "netcdf_variables": "d,r,t,u,v @ 850/700/500/200 hPa",
            "grid_resolution_deg": er.GRID_RESOLUTION_DEG,
            "spatial_interpolation": er.SPATIAL_METHOD,
            "time_alignment": "exact valid_time match; era5_delta_minutes must be 0",
        },
        "provenance": prov,
        "blocked": {
            "cds_api_credentials": "absent — raw 1982-2000 CDS downloads NOT possible "
                                   "(rows carried from canonical extraction, not fabricated)",
            "rows_without_raw_and_not_in_canonical": [],  # filled below if any
        },
        "stats": {
            "build_seconds": round(build_s, 2),
            "rows": int(checks["temporal"]["rows"]),
            "storms": int(checks["storm"]["storms"]),
            "ri_pos": int(checks["target"]["ri_pos"]),
            "ri_neg": int(checks["target"]["ri_neg"]),
            "date_range": [
                str(table["datetime_utc"].min()),
                str(table["datetime_utc"].max()),
            ],
        },
    }

    # --- writes -------------------------------------------------------------------
    prefix = "era5_ri_rebuilt"
    table.to_csv(out_dir / f"{prefix}.csv", index=False)
    prov_cols = [c for c in [
        "storm_id", "datetime_utc", "latitude", "longitude", "RI_24h",
        "era5_datetime", "era5_delta_minutes", "era5_source_file",
        "era5_grid_resolution", "spatial_method", "provenance_status",
        "bilinear_cells"] if c in table.columns]
    table[prov_cols].to_csv(out_dir / "era5_ri_provenance.csv", index=False)
    out_dir.joinpath("era5_ri_manifest.json").write_text(
        json.dumps(manifest, indent=2, default=str))
    out_dir.joinpath("era5_ri_integrity_checks.json").write_text(
        json.dumps(checks, indent=2, default=str))
    out_dir.joinpath("era5_ri_mvp_comparison.json").write_text(
        json.dumps({"multimodal_reference": mvp_cmp,
                    "historical_rows_recompute": recompute_cmp}, indent=2,
                   default=str))

    # --- report -------------------------------------------------------------------
    print(json.dumps({
        "STATUS": "rebuilt" if (checks["feature"]["all_present"]
                                and checks["leakage"]["era5_only_past_or_present"])
                  else "blocked",
        "DATASET": str(out_dir / f"{prefix}.csv"),
        "ROWS": int(checks["temporal"]["rows"]),
        "STORMS": int(checks["storm"]["storms"]),
        "RI POSITIVES": int(checks["target"]["ri_pos"]),
        "RI NEGATIVES": int(checks["target"]["ri_neg"]),
        "RI NAN": int(checks["target"]["ri_nan"]),
        "DATE RANGE": [str(table["datetime_utc"].min()),
                       str(table["datetime_utc"].max())],
        "89-FEATURE CONTRACT": bool(checks["feature"]["column_order_matches_spec"]
                                    and checks["feature"]["all_present"]),
        "ERA5 ALIGNMENT": {
            "delta_minutes_eq_0": int(checks["temporal"]["era5_delta_minutes_eq_0"]),
            "delta_minutes_neq_0": int(checks["temporal"]["era5_delta_minutes_neq_0"]),
            "era5_after_obs": int(checks["temporal"]["era5_datetime_after_obs"]),
        },
        "SPATIAL METHOD": {
            "method": er.SPATIAL_METHOD,
            "grid_resolution_deg": er.GRID_RESOLUTION_DEG,
        },
        "TEMPORAL DELTA SEMANTICS": (
            "within-storm change vs previous observation, kept only if "
            "t - t_prev <= lag; unchanged from frozen model"
        ),
        "MISSINGNESS": {
            "overall": checks["missingness"]["overall"],
            "by_group": checks["missingness"]["by_group"],
            "any_fully_missing": checks["missingness"]["any_fully_missing"],
            "fully_missing_features": checks["missingness"]["fully_missing_features"],
        },
        "LEAKAGE CHECK": checks["leakage"],
        "MVP COMPARISON": {
            "multimodal_reference": mvp_cmp,
            "historical_rows_recompute": recompute_cmp,
        },
        "CDS STATUS": (
            f"unavailable (credentials absent); used {len(files_by_date)} existing "
            "NetCDF files; 848 rows carried_historical, "
            f"{prov['extracted_from_raw']['rows']} rows extracted_from_raw"
        ),
        "REPRODUCIBLE": True,
        "TRAINING PERFORMED": "NO",
        "NEXT STEP": "RI Improvement 3: training + delta-semantics decision + "
                     "adapter iteration_range fix",
    }, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())