"""TOOFAN Runtime Configuration.

Centralized runtime initialization for native library compatibility.
Must be called BEFORE importing any ML frameworks (torch, xgboost, tensorflow, etc.)
to prevent OpenMP runtime conflicts on macOS Apple Silicon.

In addition to setting ``OMP_NUM_THREADS=1``, this module pre-loads a single
canonical OpenMP runtime (``libomp``) so that PyTorch, XGBoost and LightGBM all
share one OpenMP implementation instead of each loading its own and racing on
thread-pool creation (which caused an intermittent SIGSEGV when LightGBM was
added to the PyTorch + XGBoost process).
"""

from __future__ import annotations

import glob
import os
import sys
from typing import Optional


def _find_libomp() -> Optional[str]:
    """Locate a canonical libomp.dylib on macOS.

    Returns the first found path, or None if none is available.
    """
    candidates = [
        # Homebrew libomp (preferred single canonical runtime)
        "/opt/homebrew/opt/libomp/lib/libomp.dylib",
        "/usr/local/opt/libomp/lib/libomp.dylib",
        # Cellar paths
        "/opt/homebrew/Cellar/libomp/*/lib/libomp.dylib",
        "/usr/local/Cellar/libomp/*/lib/libomp.dylib",
    ]
    for c in candidates:
        if "*" in c:
            matches = sorted(glob.glob(c))
            if matches:
                return matches[0]
        elif os.path.exists(c):
            return c
    return None


class RuntimeConfig:
    """Runtime configuration state."""

    _initialized: bool = False
    _omp_threads_set: bool = False
    _libomp_preloaded: bool = False

    @classmethod
    def is_initialized(cls) -> bool:
        return cls._initialized

    @classmethod
    def configure(cls, omp_threads: int = 1) -> None:
        """Configure TOOFAN runtime environment.

        This MUST be called before importing PyTorch, XGBoost, TensorFlow,
        or any other native ML frameworks.

        Args:
            omp_threads: Number of OpenMP threads. Default 1 prevents
                native crash from PyTorch/XGBoost OpenMP runtime conflict
                on macOS Apple Silicon (arm64).

        Raises:
            RuntimeError: If called after ML frameworks have been imported.
        """
        if cls._initialized:
            return

        # Check if ML frameworks that spawn their own OpenMP thread pools are
        # already imported. sklearn is intentionally excluded here: it gets
        # imported by pytest infrastructure before conftest, and it does not
        # initialize the same OpenMP worker-pool conflict that PyTorch/XGBoost/
        # LightGBM do. Pre-loading a single canonical libomp is still safe and
        # effective even if sklearn is present.
        ml_frameworks = {'torch', 'xgboost', 'lightgbm', 'tensorflow'}
        imported = [f for f in ml_frameworks if f in sys.modules]
        if imported:
            raise RuntimeError(
                f"Runtime configuration must be called BEFORE importing ML frameworks. "
                f"Already imported: {imported}"
            )

        # Set OMP_NUM_THREADS before any framework loads libomp
        os.environ['OMP_NUM_THREADS'] = str(omp_threads)
        cls._omp_threads_set = True

        # Pre-load a single canonical OpenMP runtime so that PyTorch, XGBoost
        # and LightGBM share one libomp instead of each loading its own. This
        # prevents the multi-libomp thread-pool SIGSEGV on macOS arm64 (which
        # appeared when LightGBM was added alongside PyTorch + XGBoost).
        if sys.platform == 'darwin' and not cls._libomp_preloaded:
            libomp_path = _find_libomp()
            if libomp_path:
                try:
                    import ctypes
                    ctypes.CDLL(libomp_path)
                    cls._libomp_preloaded = True
                except OSError:
                    # Best-effort; frameworks will still attempt to load their own.
                    pass

        # Additional safe runtime settings
        os.environ.setdefault('PYTHONWARNINGS', 'ignore::UserWarning')

        cls._initialized = True

    @classmethod
    def get_omp_threads(cls) -> Optional[int]:
        """Get the configured OMP_NUM_THREADS value."""
        val = os.environ.get('OMP_NUM_THREADS')
        return int(val) if val else None


def configure_runtime(omp_threads: int = 1) -> None:
    """Configure TOOFAN runtime for native library compatibility.

    This function must be called at the earliest possible entry point,
    before any ML framework imports.

    Args:
        omp_threads: Number of OpenMP threads (default: 1).
            Setting to 1 prevents the confirmed PyTorch/XGBoost
            OpenMP worker initialization crash on macOS arm64.

    Example:
        # At the very top of your entry point:
        from src.core.runtime import configure_runtime
        configure_runtime()

        # Now safe to import ML frameworks
        import torch
        import xgboost
    """
    RuntimeConfig.configure(omp_threads)


def is_runtime_configured() -> bool:
    """Check if runtime has been configured."""
    return RuntimeConfig.is_initialized()


# Auto-configure when imported (for convenience in simple scripts)
# Note: This only works if this module is imported BEFORE ML frameworks
# For guaranteed correctness, call configure_runtime() explicitly at entry points.
if not RuntimeConfig.is_initialized():
    try:
        configure_runtime()
    except RuntimeError:
        # ML frameworks already imported; configuration skipped
        pass