# NIO Cyclone Intensity Model — CNN + Track/ERA5 Fusion (FINAL)

Best model from the North Indian Ocean cyclone-intensity project. Predicts
**+6h/+12h/+24h wind speed (kt)** and **+6h/+12h/+24h IMD grade** for
cyclone frames from one satellite snapshot plus 21 track/ERA5 features.

On the held-out 17-storm test window (2000–2016 HURSAT era) it beats
persistence (SOS) /\* (do-nothing) forecasts at +12h and +24h:

| Horizon | Wind MAE (this model) | Wind MAE (persistence = current wind) | Grade acc (this model) | Grade acc (persistence) |
|---|---|---|---|---|
| +6h  | 3.95 kt | 3.21 kt | 0.647 | 0.747 |
| +12h | **5.27 kt** | 6.21 kt | 0.554 | 0.566 |
| +24h | **8.67 kt** | 11.13 kt | **0.434** | 0.342 |

The exact-percentile / normalization statistics below are bundled, so
predictions reproduce the training-time pipeline exactly (verified
bit-identical, max abs diff ~1e-5 kt).

## What's in this folder

| File | Purpose |
|---|---|
| `cnn_fusion.pth` | Trained weights (122,658 params) + per-source per-column pixel percentiles + tabular mean/std (all bundled) |
| `cnn_fusion.json` | Human-readable config: architecture, feature list, normalization stats, params |
| `dev_norm.json` | Training-dev column medians used to impute missing feature cells |
| `predict.py` | Self-contained inference (model definition + preprocessing + scoring) |
| `requirements.txt` | Runtime deps for inference only |

## How to run

```bash
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
```

Prepare two inputs (see "Inputs" below), then:

```bash
# predict all storms in a directory of npz frames
python predict.py --data-dir storms --features features.csv --source himawari

# or a single storm
python predict.py --npz 2025-011.npz --features features.csv --source himawari
```

`predictions.csv` is written in the current directory.

## Inputs

### Satellite frames (`.npz` per storm, from the data pipeline)
Each cloud archive `<storm_id>.npz` holds:
- `images` — `(T, 301, 301, 2)` float32. Channel 0 = IR,
  channel 1 = WV (brightness temperature K for Himawari AHI B13/B09;
  HURSAT IRWIN/IRWVP counts for legacy frames).
- `time` — `(T,)` ISO-8601 UTC strings, one per frame; every row in the
  features CSV must match a frame time on its storm.

### Tabular features (one CSV row per frame)
Columns: `storm_id`, `time` (ISO UTC), `source` (`hursat` or `himawari`),
and the 21 features below (missing cells median-imputed using `dev_norm.json`):

```
wind, lat, lon, ci_no, pressure, pressure_drop,
season_sin, season_cos, storm_age_hours,
wind_6h_ago, wind_change_6h, lat_change_6h, lon_change_6h,
era5_shear_annulus_ms, era5_shear_center_ms,
era5_rh_700_annulus_percent, era5_rh_700_center_percent,
era5_sst_area_c,
era5_shear_annulus_ms_trend_24h, era5_rh_700_annulus_percent_trend_24h,
era5_sst_area_c_trend_24h
```

If the CSV has no `source` column, pass `--source hursat|himawari`.

## Output
Per row: storm, time, observed wind (if present), predicted wind +6/12/24 h
(kt), and predicted IMD grade +6/12/24 h as `D, DD, CS, SCS, VSCS, ESCS, SuCS`
plus numeric code (0–6).

## Model
- Image tower: Conv3x3 32(s2)/64/128 + BN/ReLU/MaxPool + global avg pool → 128
- Tabular tower: LayerNorm → Linear(21→64) ReLU Dropout(.2)
- Fuse: concat → Linear(192→128) ReLU Dropout(.3)
- Heads: 3 wind (smooth-L1) + 3 grade (weighted CE) for +6/+12/+24 h
- Trained on 2,831 dev rows (122 storms: 87 HURSAT + 35 Himawari), AdamW,
  lr 1e-3, wd 1e-4, 30 epochs max, patience 6, seed 42.
- Data license note: HURSAT and Himawari/AHI frames and IMD best-track data
  carry their own licenses — check before redistributing raw frames.