"""Pytest session configuration for TOOFAN.

Guarantees the native runtime (OpenMP) configuration runs BEFORE any test
module imports an ML framework (torch, xgboost, lightgbm). This pre-loads a
single canonical libomp and sets OMP_NUM_THREADS=1, preventing the
multi-OpenMP-runtime thread-pool SIGSEGV on macOS arm64 when PyTorch, XGBoost
and LightGBM coexist in a single process.
"""

import os

# Belt-and-suspenders: set OMP_NUM_THREADS before anything else.
os.environ.setdefault("OMP_NUM_THREADS", "1")

from src.core.runtime import configure_runtime

configure_runtime()
