# TOOFAN Environment Configuration

## Runtime Configuration

TOOFAN requires a specific runtime configuration to prevent native crashes when using multiple ML frameworks (PyTorch + XGBoost) on macOS Apple Silicon.

### Required: OMP_NUM_THREADS=1

**This must be set BEFORE importing any ML frameworks.**

```python
# At the very top of your entry point:
from src.core.runtime import configure_runtime
configure_runtime()  # Sets OMP_NUM_THREADS=1

# Now safe to import ML frameworks
import torch
import xgboost
import tensorflow
```

### Why This Is Required

On macOS arm64 (Apple Silicon), both PyTorch 2.13+ and XGBoost 3.4+ embed/link against separate instances of the OpenMP runtime (`libomp.dylib`). When both libraries initialize their OpenMP thread pools in the same process, a native segmentation fault occurs during model loading.

**Crash signature:**
```
Thread 7 (OpenMP worker):
__kmp_create_worker
__kmp_allocate_thread
__kmp_fork_call
xgboost::gbm::GBTreeModel::LoadModel
```

**Root cause:** OpenMP worker thread creation conflict between PyTorch's and XGBoost's libomp instances.

**Solution:** Setting `OMP_NUM_THREADS=1` limits OpenMP to single-threaded mode, eliminating the runtime conflict. This is the only tested setting that reliably prevents the crash.

### Verified Test Results

| Configuration | Result |
|---------------|--------|
| No OMP setting | ❌ CRASH (SIGSEGV) |
| OMP_NUM_THREADS=1 | ✅ PASS |
| OPENBLAS_NUM_THREADS=1 | ❌ CRASH |
| MKL_NUM_THREADS=1 | ❌ CRASH |

Only `OMP_NUM_THREADS=1` works. Do not add other thread variables.

### Entry Points That Auto-Configure

The following TOOFAN entry points automatically call `configure_runtime()`:

- `python -m src.cli.main ...` (CLI)
- `tests/integration/test_native_model_compatibility.py` (integration tests)

### For Custom Scripts

If writing custom scripts that use TOOFAN models:

```python
# FIRST - before ANY imports
import os
os.environ['OMP_NUM_THREADS'] = '1'

# OR use TOOFAN's runtime module
from src.core.runtime import configure_runtime
configure_runtime()

# THEN import frameworks and TOOFAN
import torch
import xgboost
from src.models.adapters.trajectory_adapter import create_trajectory_adapter
from src.models.adapters.recurvature_adapter import create_recurvature_adapter
```

### Performance Impact

- **Minimal**: Inference for these models is typically memory-bound, not compute-bound
- Single-threaded OpenMP only affects internal parallelism during model operations
- No change to model architecture, weights, or prediction semantics

### Testing

Run the native compatibility regression test:

```bash
python -m pytest tests/integration/test_native_model_compatibility.py -v
```

Expected: 8/8 tests pass, including both load orders and repeated predictions.

## Python Version

TOOFAN is tested on:
- Python 3.11.15 (current CI)
- Python 3.14.5 (development environment - same crash behavior)

The OpenMP conflict is **independent of Python version** - it would occur on any Python version where both PyTorch and XGBoost load their OpenMP runtimes.

## Framework Versions (Pinned)

| Framework | Version | Notes |
|-----------|---------|-------|
| PyTorch | 2.13.0 | arm64 macOS wheel |
| XGBoost | 3.4.1 | arm64 macOS wheel |
| NumPy | 2.4.6 | |
| scikit-learn | 1.5.0 | |
| Pandas | 2.2.0 | |

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| macOS 26.6 (arm64) | ✅ Tested | Requires OMP_NUM_THREADS=1 |
| Linux (x86_64) | ⏳ Untested | May not need mitigation |
| Linux (arm64) | ⏳ Untested | May need mitigation |
| Windows | ⏳ Untested | Different OpenMP runtime |

## Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| OMP_NUM_THREADS | 1 | **REQUIRED** - Prevents OpenMP crash |
| PYTHONWARNINGS | ignore::UserWarning | Suppresses deprecation noise |

Do not set: `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS`, `VECLIB_MAXIMUM_THREADS`, `NUMEXPR_NUM_THREADS` - they do not prevent the crash and may interfere.