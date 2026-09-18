# TOOFAN Native Crash Environment

**Date:** 2026-09-02
**OS:** macOS 26.6.2 (25G83)
**Architecture:** arm64 (Apple Silicon)
**Python:** 3.14.5 (main, May 10 2026, 10:21:34) [Clang 21.0.0 (clang-2100.0.123.102)]
**Executable:** /Users/shantanu/.venv/bin/python
**pip:** 26.1
**pytest:** 9.0.3

## Installed Packages

| Package | Version |
|---------|---------|
| numpy | 2.4.6 |
| scipy | 1.17.1 |
| pandas | 3.0.5 |
| scikit-learn | 1.9.0 |
| xgboost | 3.4.1 |
| torch | 2.13.0 |
| torchvision | 0.28.0 |
| joblib | 1.6.0 |
| pydantic | 2.13.5 |
| PyYAML | 6.0.3 |
| networkx | 3.6.1 |
| xarray | 2026.7.0 |
| netCDF4 | 1.7.4 |
| rasterio | 1.5.1 |
| matplotlib | 3.11.1 |
| seaborn | 0.13.2 |
| tqdm | 4.70.0 |
| requests | 2.34.2 |
| shap | 0.52.0 |

## Repository State

- **Branch:** main
- **Commit:** a6df99a (Move recurvature model files into dedicated recurvature/ folder)
- **Uncommitted changes:** requirements.txt (modified), configs/, cyclone intensity/, docs/, pyproject.toml, recurvature/scaler.joblib, src/, tests/ (untracked)

## Model Artifacts

| Model | Artifact | Size | Framework |
|-------|----------|------|-----------|
| Trajectory | cyclone_path/checkpoints/v12_best_model.pt | 2.0 MB | PyTorch |
| Recurvature | recurvature/xgb_recurve_model.json | 306 KB | XGBoost |
| RI (IMD) | cyclone_backup/models/imd_final_xgboost.json | 122 KB | XGBoost |
| RI (ERA5) | cyclone_backup/models/era5_final_xgboost.json | 334 KB | XGBoost |
| RI (IMD+ERA5) | cyclone_backup/models/imd_era5_final_xgboost.json | 78 KB | XGBoost |
| RI (Satellite) | cyclone_backup/models/satellite_cnn.pt | 1.2 MB | PyTorch |