# TOOFAN Python 3.14 Compatibility Analysis

**Date:** 2026-09-02

| Package | Installed Version | Python 3.14 Support | arm64 Support | Notes |
|---------|-------------------|---------------------|---------------|-------|
| numpy | 2.4.6 | ✅ Yes | ✅ Yes | Official wheel available |
| scipy | 1.17.1 | ✅ Yes | ✅ Yes | Official wheel available |
| pandas | 3.0.5 | ✅ Yes | ✅ Yes | Official wheel available |
| scikit-learn | 1.9.0 | ✅ Yes | ✅ Yes | Official wheel available |
| xgboost | 3.4.1 | ✅ Yes | ✅ Yes | Official wheel available (macosx_12_0_arm64) |
| torch | 2.13.0 | ✅ Yes | ✅ Yes | Official wheel available (macosx_14_0_arm64), MPS support |
| torchvision | 0.28.0 | ✅ Yes | ✅ Yes | Official wheel available |
| tensorflow | N/A | ❌ No | N/A | No official wheel for Python 3.14 yet |
| joblib | 1.6.0 | ✅ Yes | ✅ Yes | Pure Python |
| pydantic | 2.13.5 | ✅ Yes | ✅ Yes | Official wheel available |
| PyYAML | 6.0.3 | ✅ Yes | ✅ Yes | Official wheel available |
| networkx | 3.6.1 | ✅ Yes | ✅ Yes | Pure Python |
| xarray | 2026.7.0 | ✅ Yes | ✅ Yes | Pure Python |
| netCDF4 | 1.7.4 | ✅ Yes | ✅ Yes | abi3 wheel (cp311-abi3) |
| rasterio | 1.5.1 | ✅ Yes | ✅ Yes | Official wheel available |
| matplotlib | 3.11.1 | ✅ Yes | ✅ Yes | Official wheel available |
| seaborn | 0.13.2 | ✅ Yes | ✅ Yes | Pure Python |
| tqdm | 4.70.0 | ✅ Yes | ✅ Yes | Pure Python |
| requests | 2.34.2 | ✅ Yes | ✅ Yes | Pure Python |
| shap | 0.52.0 | ✅ Yes* | ✅ Yes* | cp312-abi3 wheel (works on 3.14 via abi3) |

## Key Findings

1. **All core ML packages have official Python 3.14 wheels for arm64** - NumPy, SciPy, pandas, scikit-learn, XGBoost, PyTorch, torchvision
2. **TensorFlow is the only major ML framework without Python 3.14 support** - Not critical for TOOFAN as it uses PyTorch/XGBoost
3. **No architecture/binary incompatibility detected** - All packages are arm64 native
4. **Python 3.14 ABI compatibility** - All packages provide compatible binaries (abi3 or native 3.14 wheels)

## Conclusion

**Python 3.14 is NOT the root cause** of the native crash. All required packages are officially supported on Python 3.14/arm64 with native wheels. The crash is caused by an OpenMP runtime conflict between PyTorch and XGBoost (see root cause analysis).