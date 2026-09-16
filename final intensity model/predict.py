"""Self-contained inference for the CNN+tabular fusion model (best model).

Predicts wind speed (kt) and IMD grade (+6h/+12h/+24h) for North Indian
Ocean cyclone frames. The checkpoint bundles everything needed to run:
per-source pixel normalisation ranges, tabular feature mean/std and the
feature ordering. No other file from the training repo is required.

Inputs
------
* --checkpoint : cnn_fusion.pth (model weights + normalisation stats)
* a directory of per-storm ``<storm_id>.npz`` frames, or a single npz.
  Each npz has ``images`` (T,301,301,2) float32 — channel 0 = IR
  (Himawari B13 10.4 um / HURSAT IRWIN), channel 1 = WV (B09 6.9 um /
  HURSAT IRWVP) — brightness temperature K (Himawari) or counts
  (HURSAT) — plus ``time`` (ISO-8601 UTC strings, T) and optionally
  ``wind``/``grade`` actuals for verification.
* --features : CSV with one row per frame: ``storm_id``, ``time`` (ISO
  UTC), a ``source`` column ('hursat' | 'himawari'), and the 21 feature
  columns listed in cnn_fusion.json["tab_features"]. Missing cells are
  median-imputed — by default with the training-dev column medians in
  ``dev_norm.json`` (ships with the checkpoint), falling back to the
  provided table's medians if that file is absent.

Output
------
A per-row table: time, observed wind/grade (if present) and predicted
wind (kt) + IMD grade for +6/+12/+24 h.

Example
-------
python predict.py --data-dir storms --features features.csv \
    --source himawari --checkpoint cnn_fusion.pth
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn

GRADE_ORDER = ["D", "DD", "CS", "SCS", "VSCS", "ESCS", "SuCS"]
HORIZONS = (6, 12, 24)
CROP_SIZE = 128


class FusionCNN(nn.Module):
    """Architecture identical to training: image tower + tab tower -> fuse -> heads."""

    def __init__(self, n_tab: int = 21, n_grades: int = 7, with_grade: bool = True) -> None:
        super().__init__()
        self.with_grade = with_grade
        self.image_tower = nn.Sequential(
            nn.Conv2d(2, 32, 3, stride=2, padding=1),
            nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, stride=1, padding=1),
            nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, stride=1, padding=1),
            nn.BatchNorm2d(128), nn.ReLU(), nn.MaxPool2d(2),
            nn.AdaptiveAvgPool2d(1),
        )
        self.tab_tower = nn.Sequential(
            nn.LayerNorm(n_tab),
            nn.Linear(n_tab, 64), nn.ReLU(), nn.Dropout(0.2),
        )
        self.fuse = nn.Sequential(
            nn.Linear(128 + 64, 128), nn.ReLU(), nn.Dropout(0.3),
        )
        self.wind_heads = nn.ModuleDict({str(h): nn.Linear(128, 1) for h in HORIZONS})
        if with_grade:
            self.grade_heads = nn.ModuleDict({str(h): nn.Linear(128, n_grades) for h in HORIZONS})

    def forward(self, img: torch.Tensor, tab: torch.Tensor) -> dict[str, dict[str, torch.Tensor]]:
        feat_img = self.image_tower(img).flatten(1)
        feat_tab = self.tab_tower(tab)
        feat = self.fuse(torch.cat([feat_img, feat_tab], dim=1))
        out = {"wind": {str(h): self.wind_heads[str(h)](feat).squeeze(-1) for h in HORIZONS}}
        if self.with_grade:
            out["grade"] = {str(h): self.grade_heads[str(h)](feat) for h in HORIZONS}
        return out


def center_crop(img: np.ndarray, size: int) -> np.ndarray:
    """Center-crop the (..., H, W, C) frame, as done during training."""
    h, w = img.shape[-3], img.shape[-2]
    y0, x0 = (h - size) // 2, (w - size) // 2
    return img[..., y0:y0 + size, x0:x0 + size, :]


def clip_scale(images: np.ndarray, p_low: np.ndarray, p_high: np.ndarray) -> np.ndarray:
    """Clip+scale the LAST dimension using saved percentile ranges (mirrors training).

    Note: the saved percentile arrays are per-column (len 128), not per-channel,
    so the loop runs over images.shape[-1] exactly as train_cnn.normalize does.
    """
    out = images.astype(np.float32).copy()
    for c in range(images.shape[-1]):
        lo, hi = p_low[c], p_high[c]
        if hi - lo < 1e-6:
            hi = lo + 1.0
        out[..., c] = np.clip((out[..., c] - lo) / (hi - lo), 0.0, 1.0)
    return out


def load_checkpoint(path: Path) -> dict:
    ck = torch.load(path, map_location="cpu", weights_only=False)
    if "state_dict" not in ck:
        raise SystemExit(f"not a fusion checkpoint: {path}")
    return ck


def build_model(ck: dict) -> tuple[nn.Module, bool]:
    with_grade = not ck.get("wind_only", False)
    model = FusionCNN(with_grade=with_grade)
    model.load_state_dict(ck["state_dict"])
    model.eval()
    return model, with_grade


def features_from_csv(path: Path, tab_features: list[str]) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    for f in tab_features:
        df[f] = pd.to_numeric(df[f], errors="coerce")
    return df.sort_values(["storm_id", "time"]).reset_index(drop=True)


def normalize_features(df: pd.DataFrame, tab_features: list[str], ck: dict,
                       medians: pd.Series) -> np.ndarray:
    """Z-score the 21 features; NaN cells imputed with table-wide column medians (as in training)."""
    feats = df[tab_features].astype(np.float64)
    feats = feats.fillna(medians)
    return ((feats.to_numpy(dtype=np.float32) - ck["tab_mean"]) / ck["tab_std"]).astype(np.float32)


def _naive_utc(ts) -> np.datetime64:
    t = pd.Timestamp(ts)
    if t.tzinfo is not None:
        t = t.tz_convert("UTC").tz_localize(None)
    return np.datetime64(t)


def predict_storm(model: nn.Module, ck: dict, npz: Path, tab_of_row: np.ndarray,
                  source: str, with_grade: bool, row_times: np.ndarray) -> pd.DataFrame:
    data = np.load(npz)
    images = data["images"]  # (T, 301, 301, 2)
    n = images.shape[0]
    if len(row_times) != n:
        raise SystemExit(f"{npz.name}: {n} frames but {len(row_times)} feature rows")
    t_npz = [_naive_utc(t) for t in data["time"]]
    t_row = [_naive_utc(t) for t in row_times]
    if any(t_npz[i] != t_row[i] for i in range(n)):
        raise SystemExit(f"{npz.name}: features rows not aligned to npz frame times (sort both by time)")
    crops = center_crop(images, CROP_SIZE)  # (T,128,128,2)
    norm = crops.transpose(0, 3, 1, 2).copy()  # NCHW, same as training build_arrays
    p_low = np.asarray(ck["norm_p1_by_source"][source])
    p_high = np.asarray(ck["norm_p99_by_source"][source])
    norm = clip_scale(norm, p_low, p_high)

    out = {"wind_6h": [], "wind_12h": [], "wind_24h": []}
    if with_grade:
        out.update({"grade_6h": [], "grade_12h": [], "grade_24h": []})
    with torch.no_grad():
        for s in range(0, n, 64):
            img = torch.from_numpy(norm[s:s + 64])
            tab = torch.from_numpy(tab_of_row[s:s + 64])
            pred = model(img, tab)
            out["wind_6h"] += pred["wind"]["6"].tolist()
            out["wind_12h"] += pred["wind"]["12"].tolist()
            out["wind_24h"] += pred["wind"]["24"].tolist()
            if with_grade:
                out["grade_6h"] += pred["grade"]["6"].argmax(1).tolist()
                out["grade_12h"] += pred["grade"]["12"].argmax(1).tolist()
                out["grade_24h"] += pred["grade"]["24"].argmax(1).tolist()

    rows = pd.DataFrame({
        "time": list(data["time"]),
        "wind_obs_kt": list(data["wind"]) if "wind" in data.files else [np.nan] * n,
        **out,
    })
    for h in HORIZONS:
        lab = f"grade_{h}h"
        if lab in out:
            rows[lab] = [GRADE_ORDER[c] for c in out[lab]]
            rows[f"{lab}_code"] = out[lab]
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--checkpoint", type=Path, default=Path("cnn_fusion.pth"))
    ap.add_argument("--data-dir", type=Path, default=None, help="dir of <storm_id>.npz frames")
    ap.add_argument("--npz", type=Path, help="single storm npz (alternative to --data-dir)")
    ap.add_argument("--features", type=Path, required=True,
                    help="CSV with storm_id, time, source and the 21 tabular features")
    ap.add_argument("--source", choices=("hursat", "himawari"), default=None,
                    help="pixel-unit source; required if features CSV has no 'source' column")
    ap.add_argument("--json", type=Path, default=Path("cnn_fusion.json"), help="config json")
    ap.add_argument("--impute-medians", type=Path, default=Path("dev_norm.json"),
                    help="optional JSON of training-dev column medians for NaN imputation")
    a = ap.parse_args()

    cfg = json.loads(a.json.read_text())
    tab_features = cfg["tab_features"]
    ck = load_checkpoint(a.checkpoint)
    model, with_grade = build_model(ck)

    feats = features_from_csv(a.features, tab_features)
    medians = None
    if a.impute_medians and a.impute_medians.exists():
        medians = pd.Series(json.loads(a.impute_medians.read_text()))
    else:
        medians = feats[tab_features].astype(np.float64).median()
    storms = {}
    if a.npz:
        storms[a.npz.stem] = a.npz
    elif a.data_dir:
        storms = {p.stem: p for p in sorted(a.data_dir.glob("*.npz"))}
    else:
        raise SystemExit("pass one of --data-dir or --npz")
    missing = set(feats["storm_id"]) - set(storms)
    if missing:
        print(f"warning: no npz for storm_ids {sorted(missing)}")
    if "source" not in feats.columns:
        if a.source is None:
            raise SystemExit("features CSV has no 'source' column; pass --source hursat|himawari")
        feats["source"] = a.source

    results = []
    for storm_id, npz in sorted(storms.items()):
        sub = feats[feats["storm_id"] == storm_id]
        if len(sub) == 0:
            continue
        tab_all = normalize_features(sub, tab_features, ck, medians)
        src = sub["source"].iloc[0]
        r = predict_storm(model, ck, npz, tab_all, src, with_grade, sub["time"].to_numpy())
        r.insert(0, "storm_id", storm_id)
        results.append(r)

    if not results:
        raise SystemExit("no matching frames to predict")
    out = pd.concat(results, ignore_index=True)
    csv_path = Path("predictions.csv")
    out.to_csv(csv_path, index=False)
    print(out.to_string(index=False))
    print(f"\nWrote {csv_path.resolve()}")


if __name__ == "__main__":
    main()