"""Integration test: orchestrator -> registry -> validated RI model path.

Verifies the MVP runtime wiring for the RI module end to end in Python:

    CycloneState (runtime input)
        -> src.models.ri.adapter.ModelAdapter (loaded via the real registry)
        -> RIPrediction (validated IMD branch, IMD_ONLY)
        -> UnifiedForecastState.rapid_intensification

No fabricated values: if the artifact were missing the module would report
UNAVAILABLE, never a fake probability.
"""

from datetime import datetime, timezone

import pytest

from src.core.registry import get_registry
from src.core.schema import Basin, CycloneState
from src.models.ri.adapter import ModelAdapter, create_ri_adapter
from src.pipeline.orchestrator import ModuleName, PipelineOrchestrator


@pytest.fixture
def cyclone_state():
    return CycloneState(
        storm_id='2024-001',
        basin=Basin.BAY_OF_BENGAL,
        timestamp=datetime.now(timezone.utc),
        latitude=15.0,
        longitude=85.0,
        max_wind_kt=65.0,
        central_pressure_hpa=980.0,
        heading_deg=280.0,
        translation_speed_kt=10.0,
        wind_change_6h=5.0,
        wind_change_12h=8.0,
        wind_change_24h=12.0,
        pressure_change_6h=-3.0,
        pressure_change_12h=-5.0,
        pressure_change_24h=-8.0,
    )


class TestRIOrchestratorWiring:
    def test_ri_registered_in_index(self):
        """The validated RI model must be registered (name=ri, type=ri)."""
        entry = get_registry('models/registry').get_latest('ri', 'ri')
        assert entry is not None
        assert entry.checkpoint_path == 'RI/models/imd_ri_model.json'

    def test_orchestrator_adapter_predicts_real_imd_prob(self, cyclone_state):
        """The orchestrator-shaped adapter loads the validated IMD branch."""
        adapter = ModelAdapter(raw_model=None, metadata=None)
        assert adapter._is_loaded
        assert adapter._mode == "IMD_ONLY"

        result = adapter.predict(cyclone_state)

        assert result.imd_probability is not None
        assert 0.0 <= result.imd_probability <= 1.0
        assert result.era5_probability is None
        assert result.satellite_probability is None
        assert result.fusion_probability is None
        assert result.status != "UNAVAILABLE"

    def test_create_ri_adapter_factory(self, cyclone_state):
        adapter = create_ri_adapter('RI/models')
        result = adapter.predict(cyclone_state)
        assert result.imd_probability is not None
        assert 0.0 <= result.probability_24h <= 1.0

    def test_orchestrator_runs_ri_through_unified_state(self, cyclone_state):
        """Full orchestrator flow: RI module -> UnifiedForecastState."""
        config = {
            'data': {},
            'harmonization': {},
            'hazard_engine': {},
            'models': {'ri': {'name': 'ri', 'version': '1'}},
            'registry_dir': 'models/registry',
        }

        class FakeStateBuilder:
            def build_from_storm_id(self, storm_id, basin, reference_time):
                return cyclone_state

        orchestrator = PipelineOrchestrator(
            config, registry=get_registry('models/registry'),
            state_builder=FakeStateBuilder(),
        )

        unified = orchestrator.execute(
            storm_id='2024-001',
            basin='BOB',
            reference_time=datetime.now(timezone.utc),
            modules=[ModuleName.RI],
        )

        ri_result = orchestrator.results[ModuleName.RI]
        assert ri_result.status == "SUCCESS"
        assert unified.rapid_intensification is not None
        assert unified.rapid_intensification.imd_probability is not None
        assert 0.0 <= unified.rapid_intensification.probability_24h <= 1.0
        assert unified.module_status['ri'] == "SUCCESS"
