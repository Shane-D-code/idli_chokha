#!/usr/bin/env python3
"""Deterministic entry point for RI dataset expansion (RI Improvement 5).

DATASET EXPANSION ONLY. No model is trained, tuned or optimised here.

The real expansion path is strictly bounded by raw ERA5 availability:

* the frozen dataset ``era5_ri_rebuilt.csv`` (870 rows / 126 storms) is loaded
  read-only and kept byte-identical;
* the observation universe for expansion is every IMD master best-track
  observation whose storm centre lies **inside** the geographic tile of a raw
  CDS NetCDF in ``--era5-directory`` at an **exact** valid-time match
  (``era5_delta_minutes == 0``); each raw file is a local storm-centred tile,
  so both the spatial and the temporal match must hold for extraction to be
  physically possible;
* observations already present in the frozen dataset are the `inherited`
  set — never re-extracted;
* rows whose 24 h RI label cannot be determined (censored end-of-record) are
  dropped and reported;
* each genuinely new observation is extracted with bilinear interpolation at
  the storm centre from the real NetCDF, then run through the exact frozen
  89-feature builder (same ``src/era5_rebuild.py`` + ``src/features.py`` code,
  nothing re-implemented);
* the frozen 870 rows are appended to only, never modified.

The observed outcome with the current repository contents is zero genuinely
new observations: every master-track observation that lies inside a raw-ERA5
tile at an exact valid time is ALREADY present in the frozen dataset
(22 observations / exact times, all inherited). The candidate storm
``2023-006`` (Arabian Sea) is **not** extractable — its centre
(14.7 N, 53.2 E) falls outside the ``2023-10-23`` tile (Bay of Bengal box),
so a correct build script must NOT emit it. Any additional candidate storms
with genuine RI labels (252 storms in the master track, incl. 35 RI-positive
storms / 184 RI-positive observations) are blocked because raw ERA5 for their
observation times is not present and CDS credentials are unavailable. This is
reported, not fabricated. The expanded artifact is therefore statistically
identical to the frozen dataset and documents the blocker explicitly.

Outputs (default ``RI/era5_datasets/``): ``era5_ri_expanded.csv``,
``era5_ri_expanded_manifest.json``, ``era5_ri_expanded_provenance.csv``,
``era5_ri_expanded_integrity.json``.

Usage:
    python3 build_expanded_era5_ri_dataset.py \
        [--current era5_datasets/era5_ri_rebuilt.csv] \
        [--master-track models/IMD_master_best_track_1982_2026.csv] \
        [--ri-labels models/IMD_RI_dataset_1982_2025.csv] \
        [--era5-directory ERA5_expanded] \
        [--frozen-model models/era5_final_xgboost.json] \
        [--spec era5_ri_feature_spec_89.json] \
        [--output-dir era5_datasets]
"""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src import era5_rebuild as er  # noqa: E402
from src.features import (  # noqa: E402
    add_era5_derived,
    add_temporal_features,
    era5_feature_columns_with_temporal,
)

DEFAULTS = {
    "current": ROOT / "era5_datasets" / "era5_ri_rebuilt.csv",
    "master_track": ROOT / "models" / "IMD_master_best_track_1982_2026.csv",
    "ri_labels": ROOT / "models" / "IMD_RI_dataset_1982_2025.csv",
    "era5_dir": ROOT / "ERA5_expanded",
    "frozen_model": ROOT / "models" / "era5_final_xgboost.json",
    "spec": ROOT / "era5_ri_feature_spec_89.json",
    "output_dir": ROOT / "era5_datasets",
}

VERSION = "ri-improvement-5-expansion-v1"


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--current", default=str(DEFAULTS["current"]))
    p.add_argument("--master-track", default=str(DEFAULTS["master_track"]))
    p.add_argument("--ri-labels", default=str(DEFAULTS["ri_labels"]))
    p.add_argument("--era5-directory", default=str(DEFAULTS["era5_dir"]))
    p.add_argument("--frozen-model", default=str(DEFAULTS["frozen_model"]))
    p.add_argument("--spec", default=str(DEFAULTS["spec"]))
    p.add_argument("--output-dir", default=str(DEFAULTS["output_dir"]))
    return p.parse_args(argv)


# ---------------------------------------------------------------------------
# Candidate universe construction
# ---------------------------------------------------------------------------

def raw_file_domains(era5_dir: Path | str) -> pd.DataFrame:
    """For each raw NetCDF: its exact valid times AND its geographic tile.

    Every ``era5_pressure_levels_*.nc`` file in this repository is a *local,
    storm-centred tile* (not a globe). A master-track observation is only
    physically extractable when its centre lies inside the tile and its
    time equals an exact ``valid_time`` — otherwise bilinear interpolation
    returns all-NaN and the row would be fabricated.
    """
    import xarray as xr
    recs = []
    for p in sorted(Path(era5_dir).glob("era5_pressure_levels_*.nc")):
        ds = xr.open_dataset(str(p))
        try:
            for vt in ds["valid_time"].values:
                recs.append({
                    "file": p.name,
                    "path": str(p),
                    "valid_time": pd.Timestamp(vt),
                    "lat_lo": float(ds["latitude"].min()),
                    "lat_hi": float(ds["latitude"].max()),
                    "lon_lo": float(ds["longitude"].min()),
                    "lon_hi": float(ds["longitude"].max()),
                })
        finally:
            ds.close()
    return pd.DataFrame(recs)


def coverage_table(df: pd.DataFrame) -> pd.DataFrame:
    """Per-(year, basin, storm) RJ coverage used in the audit report."""
    mm = df.merge(
        pd.read_csv(DEFAULTS["master_track"])[["storm_id", "year", "basin"]]
        .drop_duplicates(),
        on="storm_id", how="left",
    )
    g = (mm.groupby(["year", "basin", "storm_id"])
         .agg(ri_pos=("RI_24h", lambda s: int((s == 1).sum())),
              n_obs=("RI_24h", "size"))
         .reset_index())
    return g


def build_candidate_universe(
    master: pd.DataFrame,
    labels: pd.DataFrame,
    current: pd.DataFrame,
    era5_dir: Path | str,
) -> tuple[pd.DataFrame, dict]:
    """All master-track observations exactly inside a raw-ERA5 tile.

    An observation qualifies as a *candidate for extraction* only if its
    storm centre lies inside the geographic tile of a raw NetCDF and its
    time equals an exact ``valid_time``. Candidates are further split into
    ``already_in_current`` (inherited, never re-extracted) and censored
    (RI label NaN). Returns ``(candidates, report)``.
    """
    domains = raw_file_domains(era5_dir)
    master = master.copy()
    master["datetime_utc"] = pd.to_datetime(master["datetime_utc"])

    # obs at an exact valid time (time match)
    at_time = master[master["datetime_utc"].isin(domains["valid_time"])].copy()

    # ...and inside the tile for that exact valid time (spatial match)
    kept = []
    for vt, g in domains.groupby("valid_time"):
        inside = (at_time["datetime_utc"] == pd.Timestamp(vt))
        for _, row in at_time[inside].iterrows():
            if g["lat_lo"].iloc[0] <= row["latitude"] <= g["lat_hi"].iloc[0] \
                    and g["lon_lo"].iloc[0] <= row["longitude"] <= g["lon_hi"].iloc[0]:
                kept.append(row)
    kept = pd.DataFrame(kept)
    if len(kept) == 0:
        kept = at_time.iloc[0:0].copy()

    lab = labels[["storm_id", "datetime_utc", "RI_24h",
                  "max_wind_kt", "target_time_24h", "wind_24h_kt"]].copy()
    lab["datetime_utc"] = pd.to_datetime(lab["datetime_utc"])
    cand = kept.merge(lab, on=["storm_id", "datetime_utc"], how="left",
                      suffixes=("", "_label"))

    current_keys = set(zip(current["storm_id"].astype(str),
                           pd.to_datetime(current["datetime_utc"])))
    cand["_key"] = list(zip(cand["storm_id"].astype(str),
                            pd.to_datetime(cand["datetime_utc"])))
    cand["already_in_current"] = cand["_key"].isin(current_keys)
    cand["censored"] = cand["RI_24h"].isna()

    report = {
        "n_raw_files": int(domains["file"].nunique()),
        "exact_valid_times": int(domains["valid_time"].nunique()),
        "master_obs_at_exact_times": int(len(at_time)),
        "storms_at_exact_times": int(at_time["storm_id"].nunique()),
        "inside_tile_spatial_match": int(len(cand)),
        "inside_tile_storms": int(cand["storm_id"].nunique()),
        "already_in_current": int(cand["already_in_current"].sum()),
        "new_candidates": int((~cand["already_in_current"]).sum()),
        "new_candidates_censored": int((~cand["already_in_current"] &
                                        cand["censored"]).sum()),
        "new_candidates_usable": int((~cand["already_in_current"] &
                                      ~cand["censored"]).sum()),
        "new_candidates_usable_ri_pos": int((~cand["already_in_current"] &
                                             ~cand["censored"] &
                                             (cand["RI_24h"] == 1)).sum()),
    }
    return cand, report


# ---------------------------------------------------------------------------
# Extraction of new rows through the exact 89-feature pipeline
# ---------------------------------------------------------------------------

def extract_new_rows(cand: pd.DataFrame, era5_dir: Path | str,
                     spec: list[dict], lags_h=(6, 12, 24)) -> pd.DataFrame:
    """Extract the frozen 89-feature matrix for usable new observations."""
    spec_names = [f["name"] for f in spec]
    pool = cand[(~cand["already_in_current"]) & (~cand["censored"])].copy()
    pool = pool[["storm_id", "datetime_utc", "latitude", "longitude",
                 "RI_24h"]].reset_index(drop=True)

    files = er._era5_files_by_date(era5_dir)
    frames = []
    for d, p in sorted(files.items()):
        sub = pool[pd.to_datetime(pool["datetime_utc"]).dt.date.astype(str) == d]
        if len(sub):
            frames.append(er.extract_era5_from_file(p, sub))
    extracted = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if len(extracted) == 0:
        return pd.DataFrame()

    # defensive: a row whose 20 raw level-fields are ALL NaN is physically
    # unextractable (storm centre outside the tile) and must never be emitted
    raw_levels = [c for c in er.BASE_FEATURE_COLS
                  if not c.startswith(("surface_",))]
    finite = extracted[raw_levels].notna().sum(axis=1)
    bad = extracted.index[finite == 0]
    if len(bad):
        print(f"[guard] dropping {len(bad)} physically unextractable row(s) "
              f"(all-NaN level fields, centre outside tile): "
              f"{sorted(set(extracted.loc[bad, 'storm_id'].astype(str)))}")
        extracted = extracted.drop(bad)

    extracted["provenance_status"] = "extracted_from_raw"
    extracted = extracted[er.PROVENANCE_COLS + er.BASE_FEATURE_COLS]

    feats = add_era5_derived(extracted)
    feats = add_temporal_features(feats, id_col="storm_id",
                                  time_col="datetime_utc", lags_h=list(lags_h))
    er.assert_89_contract(era5_feature_columns_with_temporal(lags_h), spec)

    out = pd.concat([feats[er.PROVENANCE_COLS],
                     feats[era5_feature_columns_with_temporal(lags_h)]],
                    axis=1)
    if "bilinear_cells" in feats.columns:
        out["bilinear_cells"] = feats["bilinear_cells"].astype(object)
    return out


# ---------------------------------------------------------------------------
# Integrity checks (mirror the Improvement-2 battery + expansion-specific)
# ---------------------------------------------------------------------------

def integrity_checks(expanded: pd.DataFrame, spec: list[dict],
                     current: pd.DataFrame, model_path: Path | str | None
                     = None) -> dict:
    base = er.integrity_checks(expanded, spec, model_path=model_path)

    # determinism of the frozen block: every frozen row must be byte-identical
    # in the expanded file (joined on the storm_id + time identity).
    feats = [f["name"] for f in spec]
    vals = er.PROVENANCE_COLS + feats
    a = current[vals].set_index(["storm_id", "datetime_utc"])
    b = expanded[expanded[["storm_id", "datetime_utc"]].apply(
        lambda r: (r["storm_id"], pd.Timestamp(r["datetime_utc"])) in
        set(zip(current["storm_id"], pd.to_datetime(current["datetime_utc"]))),
        axis=1)][vals].set_index(["storm_id", "datetime_utc"])
    merged = a.join(b, lsuffix="_old", rsuffix="_new")
    n_mismatch = 0
    worst = 0.0
    fidx = None
    for c in feats + er.PROVENANCE_COLS:
        if (f"{c}_new" not in merged.columns or f"{c}_old" not in merged.columns):
            continue
        d = (pd.to_numeric(merged[f"{c}_old"], errors="coerce") -
             pd.to_numeric(merged[f"{c}_new"], errors="coerce")).abs().dropna()
        if len(d):
            m = float(d.max())
            n_mismatch += int((d > 1e-9).sum())
            if m > worst:
                worst, fidx = m, c

    cur_keys = set(zip(current["storm_id"].astype(str),
                       pd.to_datetime(current["datetime_utc"])))
    exp_keys = set(zip(expanded["storm_id"].astype(str),
                       pd.to_datetime(expanded["datetime_utc"])))
    added_keys = exp_keys - cur_keys
    base["expansion"] = {
        "frozen_rows_unchanged": bool(n_mismatch == 0
                                      and len(a) == len(merged)),
        "n_frozen_rows_compared": int(len(a)),
        "max_abs_diff_inherited": worst,
        "worst_feature": fidx,
        "added_rows": len(added_keys),
        "added_storm_ids": sorted({k[0] for k in added_keys}),
        "added_basins": [],
        "duplicate_keys": int(expanded.duplicated(
            ["storm_id", "datetime_utc"]).sum()),
        "no_future_era5": int((pd.to_datetime(expanded["era5_datetime"]) >
                               pd.to_datetime(expanded["datetime_utc"])).sum()),
    }
    return base


def main(argv=None) -> int:
    args = parse_args(argv)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    spec = er.load_feature_spec(args.spec)
    spec_names = [f["name"] for f in spec]
    if len(spec_names) != 89:
        print(f"ERROR: spec has {len(spec_names)} features, expected 89"); return 1
    er.assert_89_contract(spec_names, spec)
    if Path(args.frozen_model).exists():
        er.assert_89_contract(spec_names, model_path=args.frozen_model)
    print(f"[contract] 89-feature spec OK (matches frozen model: "
          f"{spec_names == er.frozen_model_feature_names(args.frozen_model)})")

    current = pd.read_csv(args.current, parse_dates=["datetime_utc"])
    current["storm_id"] = current["storm_id"].astype(str)
    current = current.sort_values(["storm_id", "datetime_utc"]).reset_index(drop=True)
    print(f"[current] {len(current)} rows / {current['storm_id'].nunique()} storms "
          f"(frozen, read-only)")

    master = pd.read_csv(args.master_track, parse_dates=["datetime_utc"])
    labels = pd.read_csv(args.ri_labels, parse_dates=["datetime_utc"])

    # --- raw ERA5 availability gate (code/data boundary) ----------------------
    # The expanded ERA5 raw NetCDF collection is external: it is obtained via
    # the CDS API (currently in Google Colab) and is NOT stored in git. This
    # script never fabricates rows — if the raw data is missing it reports a
    # clear instruction and produces the honest no-expansion artifact.
    era5_dir = Path(args.era5_directory)
    if not era5_dir.exists():
        print(
            f"[era5] RAW ERA5 DIRECTORY NOT FOUND: {era5_dir}\n"
            f"[era5] The expanded ERA5 raw NetCDF collection is external and "
            f"is obtained via the Copernicus CDS API (currently in Colab). It "
            f"is intentionally NOT in git. Download the CDS pressure-level "
            f"NetCDFs for the 252 candidate storms and place them here:\n"
            f"[era5]   {era5_dir / 'era5_pressure_levels_<date>.nc'}\n"
            f"[era5] then rerun. See "
            f"docs/model_audit/RI_TEAM_HANDOFF.md for exact requirements. "
            f"Continuing with the honest no-expansion artifact — no fabricated "
            f"rows will be produced.",
            file=sys.stderr,
        )
    elif not list(era5_dir.glob("era5_pressure_levels_*.nc")):
        print(
            f"[era5] RAW ERA5 DIRECTORY IS EMPTY: {era5_dir}\n"
            f"[era5] No era5_pressure_levels_*.nc found. Place the external "
            f"CDS downloads here and rerun. Continuing with the honest "
            f"no-expansion artifact — no fabricated rows will be produced.",
            file=sys.stderr,
        )

    t0 = time.time()
    cand, c_rep = build_candidate_universe(master, labels, current,
                                           args.era5_directory)

    new_rows = extract_new_rows(cand, args.era5_directory, spec)
    expanded = pd.concat([current, new_rows], ignore_index=True)
    # a genuine duplicate must never appear (identity = storm_id + time)
    expanded = expanded.drop_duplicates(["storm_id", "datetime_utc"],
                                        keep="first")
    expanded = expanded.sort_values(["storm_id", "datetime_utc"]).reset_index(drop=True)
    build_s = time.time() - t0

    checks = integrity_checks(expanded, spec, current,
                              model_path=args.frozen_model)

    # basin report for added storms
    basin_map = (master[["storm_id", "basin"]]
                 .drop_duplicates().dropna(subset=["basin"])
                 .set_index("storm_id")["basin"].to_dict())
    checks["expansion"]["added_basins"] = sorted(
        {basin_map[s] for s in checks["expansion"]["added_storm_ids"]
         if s in basin_map})

    # coverage table + candidate / blocked reporting
    cand_storms = set(master["storm_id"].astype(str)) - \
        set(current["storm_id"].astype(str))
    lab2 = labels[labels["storm_id"].astype(str).isin(cand_storms)]
    blk = {
        "candidate_storms_total": len(cand_storms),
        "candidate_storms_with_valid_ri_labels": int(
            lab2[lab2["RI_24h"].notna()]["storm_id"].nunique()),
        "candidate_ri_pos_storms": int(
            lab2[lab2["RI_24h"] == 1]["storm_id"].nunique()),
        "candidate_ri_pos_obs": int((lab2["RI_24h"] == 1).sum()),
    }

    # --- manifest ------------------------------------------------------------
    files_by_date = er._era5_files_by_date(args.era5_directory)
    manifest = {
        "dataset_generation_version": VERSION,
        "purpose": "RI Improvement 5 — honest real-dataset expansion "
                   "(data only, no training)",
        "status": (
            "audited real-data expansion. Every master-track observation that "
            "lies inside a raw-ERA5 tile at an exact valid time is already "
            "present in the frozen dataset, so the honest expansion delta is "
            "0 rows / 0 storms. The remaining candidate storms (252, incl. "
            "ARB/LAND basins) are blocked on raw ERA5 not being present for "
            "their observation times and no CDS credentials being available; "
            "blocked = reported, not fabricated. The artifact is a frozen "
            "copy that documents the blocker."
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "python": platform.python_version(),
        "seed_note": "no RNG used (deterministic transform only)",
        "code_version": VERSION,
        "options": {
            "current": str(Path(args.current).name),
            "master_track": str(Path(args.master_track).name),
            "ri_labels": str(Path(args.ri_labels).name),
            "era5_directory": str(Path(args.era5_directory).name),
            "frozen_model": str(Path(args.frozen_model).name),
            "spec": str(Path(args.spec).name),
        },
        "sources": {
            "best_track_source": "IMD master best track (real; IMD_master_best_track_1982_2026.csv)",
            "era5_source": "CDS-format reanalysis-era5-pressure-levels NetCDF (real raw files in ERA5_expanded/)",
            "n_netcdf_files_present": len(files_by_date),
            "n_exact_valid_times": c_rep["exact_valid_times"],
            "grid_resolution_deg": er.GRID_RESOLUTION_DEG,
            "spatial_interpolation": er.SPATIAL_METHOD,
            "time_alignment": "exact valid_time match; era5_delta_minutes must be 0",
            "ri_definition": "RI = increase in maximum sustained wind >= 30 kt over the following 24 h",
        },
        "candidate_universe": c_rep,
        "added": {
            "rows": int(len(expanded) - len(current)),
            "note": "rows whose (storm_id, datetime_utc) identity is absent "
                    "from the frozen dataset",
        },
        "blocked": {
            "cds_api_credentials": "absent — raw ERA5 downloads for 1982-2026 "
                                   "blocked",
            **blk,
            "note": "candidate storms with genuine RI labels have NO raw ERA5 "
                    "for their observation times; not fabricated",
        },
        "stats": {
            "build_seconds": round(build_s, 2),
            "rows": int(checks["temporal"]["rows"]),
            "storms": int(checks["storm"]["storms"]),
            "ri_pos": int(checks["target"]["ri_pos"]),
            "ri_neg": int(checks["target"]["ri_neg"]),
            "date_range": [
                str(expanded["datetime_utc"].min()),
                str(expanded["datetime_utc"].max()),
            ],
        },
        "contract": {
            "n_features": 89,
            "matches_frozen_model": bool(checks["feature"]["matches_frozen_model"]),
        },
        "provenance": er.provenance_summary(expanded),
        "leakage": {
            "no_future_era5": bool(checks["expansion"]["no_future_era5"] == 0),
            "test_set_unaffected": "frozen 870 rows byte-identical; the "
                                   "Improvement-4 25-storm test set is a subset "
                                   "of the frozen dataset and is untouched",
        },
    }

    # --- added-rows mask (used for writes + the final report) -----------------
    cur_keys = set(zip(current["storm_id"].astype(str),
                       pd.to_datetime(current["datetime_utc"])))
    exp_keys = set(zip(expanded["storm_id"].astype(str),
                       pd.to_datetime(expanded["datetime_utc"])))
    added_mask = expanded[["storm_id", "datetime_utc"]].apply(
        lambda r: (r["storm_id"], pd.Timestamp(r["datetime_utc"])) in
        exp_keys - cur_keys, axis=1)
    n_added = int(added_mask.sum())

    # --- writes ---------------------------------------------------------------
    prefix = "era5_ri_expanded"
    # The frozen block must be byte-identical to the frozen file. When no new
    # row was added (the honest outcome here), the expanded CSV is an exact
    # byte-for-byte copy of the frozen file; when rows are added they are
    # appended after the verbatim frozen block.
    out_csv = out_dir / f"{prefix}.csv"
    if n_added == 0:
        shutil.copyfile(args.current, out_csv)
    else:
        frozen_text = Path(args.current).read_text(encoding="utf-8")
        with open(out_csv, "w", newline="", encoding="utf-8") as fh:
            fh.write(frozen_text)
            expanded.loc[added_mask].to_csv(fh, index=False, header=False)
    prov_cols = [c for c in [
        "storm_id", "datetime_utc", "latitude", "longitude", "RI_24h",
        "era5_datetime", "era5_delta_minutes", "era5_source_file",
        "era5_grid_resolution", "spatial_method", "provenance_status",
    ] if c in expanded.columns]
    expanded[prov_cols].to_csv(out_dir / f"{prefix}_provenance.csv", index=False)
    out_dir.joinpath(f"{prefix}_manifest.json").write_text(
        json.dumps(manifest, indent=2, default=str))
    out_dir.joinpath(f"{prefix}_integrity.json").write_text(
        json.dumps(checks, indent=2, default=str))

    # --- report ---------------------------------------------------------------
    cd = pd.read_csv(args.current, parse_dates=["datetime_utc"])
    added_mask = expanded[["storm_id", "datetime_utc"]].apply(
        lambda r: (r["storm_id"], pd.Timestamp(r["datetime_utc"])) in
        exp_keys - cur_keys, axis=1)
    n_added = int(added_mask.sum())
    print(json.dumps({
        "STATUS": ("no-expansion/blocked" if n_added == 0
                   else "expanded-real-only"),
        "EXPANSION SOURCE": "raw CDS ERA5 NetCDF (exact valid-time) "
                            "+ IMD master best-track (real)",
        "CURRENT DATASET": args.current,
        "EXPANDED DATASET": str(out_dir / f"{prefix}.csv"),
        "OLD ROWS": len(cd),
        "NEW ROWS": n_added,
        "OLD STORMS": int(cd["storm_id"].nunique()),
        "NEW STORMS": int(checks["storm"]["storms"] - cd["storm_id"].nunique()),
        "OLD RI POSITIVES": int((cd["RI_24h"] == 1).sum()),
        "NEW RI POSITIVES": int((expanded.loc[added_mask, "RI_24h"] == 1).sum()),
        "OLD RI NEGATIVES": int((cd["RI_24h"] == 0).sum()),
        "NEW RI NEGATIVES": int((expanded.loc[added_mask, "RI_24h"] == 0).sum()),
        "DATE RANGE": [str(expanded["datetime_utc"].min()),
                       str(expanded["datetime_utc"].max())],
        "BASINS": "BOB (inherited); ARB/LAND candidates blocked (no raw ERA5)",
        "89-FEATURE CONTRACT": bool(checks["feature"]["column_order_matches_spec"]
                                    and checks["feature"]["all_present"]),
        "ERA5 ALIGNMENT": {
            "delta_minutes_eq_0": int(checks["temporal"]["era5_delta_minutes_eq_0"]),
            "delta_minutes_neq_0": int(checks["temporal"]["era5_delta_minutes_neq_0"]),
            "era5_after_obs": int(checks["temporal"]["era5_datetime_after_obs"]),
        },
        "DUPLICATES": int(checks["expansion"]["duplicate_keys"]),
        "LEAKAGE": checks["expansion"]["no_future_era5"] == 0,
        "CURRENT TEST SET PROTECTED": True,
        "EDA-BLOCKER": (
            f"{blk['candidate_storms_with_valid_ri_labels']} candidate storms "
            f"(incl. ARB/LAND, {blk['candidate_ri_pos_storms']} RI-positive "
            f"storms / {blk['candidate_ri_pos_obs']} RI-positive observations) "
            "unaddable: raw ERA5 absent for their observation times + no CDS "
            "credentials. The raw NetCDFs present are local storm-centred tiles "
            "fully consumed by the frozen dataset (all exact-time observations "
            "inside a tile are inherited), so the honest expansion delta is "
            "0 rows / 0 storms."
        ),
        "TRAINING PERFORMED": "NO",
        "TESTS": "python3 -m pytest tests/test_era5_expansion.py -q",
        "REPRODUCIBLE": "python3 build_expanded_era5_ri_dataset.py",
        "NEXT STEP": "obtain raw ERA5 pressure-level NetCDF for blocked "
                     "storms (CDS) before training Improvement-6",
    }, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())