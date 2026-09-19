"""Wind integration tests: registry -> model load -> real grid inference.

Pins the real inference path added for the wind module:

1. Registry discovery: ``wind`` / ``baseline`` entry resolves to the canonical
   checkpoint with the verified ``(batch, 6, 81, 57, 2) -> (batch, 81, 57, 2)``
   contract and the documented SHA-256 file hash.
2. Model load: the registry can load the Keras artifact in-process.
3. Normalization: the documented constants are parsed from
   ``wind/metadata/wind_normalization.txt`` and used verbatim (never invented).
4. Inference: ``predict_grids`` runs the model in an isolated worker and
   returns AVAILABLE ``WindFieldGrid``s with finite physical m/s fields.
5. Adapter contract: without real grids the adapter stays honestly
   BASELINE/UNAVAILABLE and never fabricates wind fields.
6. Orchestrator: ``PipelineOrchestrator`` discovers and attaches the wind model.

NOTE on isolation: ``model.predict`` runs in a subprocess that imports
TensorFlow before numpy/pandas. On macOS arm64, importing pandas/xarray first
makes in-process TF ``predict()`` deadlock (native-library load order); the
worker process also contains a TensorFlow hard-abort (SIGABRT) so a broken
runtime cannot kill the whole test session.

This repository ships NO gridded U10/V10 provider, so tests feed synthetic
real-valued m/s grids. That is legitimate: the code path being verified is
``caller-supplied grids -> documented normalization -> model -> denormalized
fields``, not a fabricated production input.
"""

from pathlib import Path

import numpy as np
import pytest

from src.core.registry import get_registry
from src.models.wind.adapter import _parse_normalization, create_wind_adapter

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = REPO_ROOT / "wind/model/wind_model_best.keras"
NORM_PATH = REPO_ROOT / "wind/metadata/wind_normalization.txt"
MODEL_SHA256 = "53779bf2c5619b59f7bd08d4093ca70e1419aabc3d24437a59ffd2fd47655132"


def _fake_grids(seed: int = 0, scale: float = 6.0) -> np.ndarray:
    """Synthetic caller-supplied U10/V10 grids in m/s (finite, plausible)."""
    rng = np.random.default_rng(seed)
    return rng.normal(loc=[2.0, 3.0], scale=[scale, scale], size=(6, 81, 57, 2)).astype("float32")


# --------------------------------------------------------------------------
# 1. Registry discovery
# --------------------------------------------------------------------------


def test_wind_registry_entry_discoverable():
    reg = get_registry()
    entry = reg.get("wind", "baseline")
    assert entry is not None, "wind/baseline must resolve from the registry"
    assert entry.name == "wind"
    assert entry.version == "baseline"
    assert Path(entry.checkpoint_path).exists()
    assert entry.configuration.get("input_shape") == [None, 6, 81, 57, 2]
    assert entry.configuration.get("output_shape") == [None, 81, 57, 2]


def test_wind_registry_artifact_hash_matches_verified_model():
    reg = get_registry()
    entry = reg.get("wind", "baseline")
    import hashlib

    digest = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
    assert digest == MODEL_SHA256
    assert entry.file_hash == MODEL_SHA256


# --------------------------------------------------------------------------
# 2. Model load + input shape
# --------------------------------------------------------------------------


def test_wind_registry_load_model_contract():
    reg = get_registry()
    raw = reg.load_model("wind", "baseline")
    assert raw is not None
    assert raw.input_shape == (None, 6, 81, 57, 2)
    assert raw.output_shape == (None, 81, 57, 2)


def test_wind_adapter_loads_model_and_normalization():
    adapter = create_wind_adapter(str(MODEL_PATH))
    assert adapter._is_loaded
    assert adapter._model is not None
    assert adapter._normalization is not None


# --------------------------------------------------------------------------
# 3. Normalization preprocessing
# --------------------------------------------------------------------------


def test_wind_normalization_constants_match_artifact():
    norm = _parse_normalization(NORM_PATH)
    assert norm is not None
    expected = {
        "u_mean": 1.7261697,
        "u_std": 4.4725676,
        "v_mean": 3.1894329,
        "v_std": 4.518691,
    }
    for key, value in expected.items():
        assert norm[key] == pytest.approx(value, rel=1e-5)


def test_wind_adapter_uses_documented_normalization_verbatim():
    adapter = create_wind_adapter(str(MODEL_PATH))
    for key, value in _parse_normalization(NORM_PATH).items():
        assert adapter._normalization[key] == value
    assert set(adapter._normalization) == {"u_mean", "u_std", "v_mean", "v_std"}


# --------------------------------------------------------------------------
# 4. Real grid inference (isolated worker)
# --------------------------------------------------------------------------


def test_wind_predict_grids_returns_available_real_field():
    adapter = create_wind_adapter(str(MODEL_PATH))
    pred = adapter.predict_grids(_fake_grids())
    assert pred.status == "AVAILABLE"
    assert pred.confidence == 0.0
    assert len(pred.wind_fields) == 1

    field = pred.wind_fields[0]
    assert field.forecast_time is not None
    assert field.u10.shape == (81, 57)
    assert field.v10.shape == (81, 57)
    assert field.speed.shape == (81, 57)
    assert field.direction.shape == (81, 57)
    assert np.all(np.isfinite(field.u10))
    assert np.all(np.isfinite(field.v10))
    assert np.all(np.isfinite(field.speed))
    assert np.all(np.isfinite(field.direction))

    # Physical invariants of the denormalized output.
    assert np.allclose(field.speed, np.sqrt(field.u10**2 + field.v10**2))
    assert field.direction.min() >= 0.0 and field.direction.max() < 360.0
    # Denormalized output is back in physical m/s magnitude (not standard-normal
    # normalized): plausible tropical-cyclone surface wind range.
    assert float(field.speed.max()) > 1.0

    # Index-space coordinates when no lats/lons supplied (extent undocumented).
    assert field.lats.shape == (81,)
    assert field.lons.shape == (57,)


def test_wind_predict_grids_supports_batch():
    adapter = create_wind_adapter(str(MODEL_PATH))
    grids = np.stack([_fake_grids(0), _fake_grids(1)])
    pred = adapter.predict_grids(grids)
    assert pred.status == "AVAILABLE"
    assert len(pred.wind_fields) == 2
    for field in pred.wind_fields:
        assert field.u10.shape == (81, 57)
        assert np.all(np.isfinite(field.u10))


def test_wind_predict_grids_accepts_user_coordinates():
    adapter = create_wind_adapter(str(MODEL_PATH))
    lats = np.linspace(8.0, 24.0, 81)
    lons = np.linspace(85.0, 95.0, 57)
    pred = adapter.predict_grids(_fake_grids(), lats=lats, lons=lons)
    assert pred.status == "AVAILABLE"
    np.testing.assert_allclose(pred.wind_fields[0].lats, lats)
    np.testing.assert_allclose(pred.wind_fields[0].lons, lons)


def test_wind_predict_grids_rejects_wrong_contract():
    adapter = create_wind_adapter(str(MODEL_PATH))
    with pytest.raises(ValueError):
        adapter.predict_grids(np.zeros((3, 81, 57, 2), dtype="float32"))
    bad = _fake_grids()
    bad[0, 0, 0, 0] = np.nan
    with pytest.raises(ValueError, match="NaN/inf"):
        adapter.predict_grids(bad)


# --------------------------------------------------------------------------
# 5. Adapter contract (no fabrication)
# --------------------------------------------------------------------------


def test_wind_adapter_baseline_never_fabricates():
    adapter = create_wind_adapter(str(MODEL_PATH))
    pred = adapter.predict(None)
    assert pred.wind_fields == []
    assert pred.confidence == 0.0
    assert pred.status in {"UNAVAILABLE", "BASELINE"}
    if pred.status == "BASELINE":
        assert "case study" in pred.explanation.lower()


# --------------------------------------------------------------------------
# 6. Orchestrator discovery
# --------------------------------------------------------------------------


def test_wind_orchestrator_discovers_model():
    import yaml

    from src.pipeline.orchestrator import ModuleName, PipelineOrchestrator

    config = yaml.safe_load((REPO_ROOT / "configs/pipeline.yaml").read_text())
    orchestrator = PipelineOrchestrator(config)
    assert orchestrator.dependency_graph is not None
    wind_module = orchestrator.dependency_graph.modules.get(ModuleName.WIND)
    assert wind_module is not None, "wind module must be registered"
    assert wind_module.model is not None, "wind model must be discovered via registry"
    assert wind_module.model._checkpoint_path is not None