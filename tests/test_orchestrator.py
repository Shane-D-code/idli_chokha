"""Tests for pipeline orchestrator."""

import pytest
from unittest.mock import Mock, MagicMock, patch
from datetime import datetime, timezone, timedelta
import numpy as np

from src.pipeline.orchestrator import (
    PipelineOrchestrator, ModuleName, DependencyGraph,
    create_orchestrator
)
from src.core.schema import (
    CycloneState, Basin, GenesisPrediction, TrackPrediction,
    IntensityPrediction, RIPrediction, RainfallPrediction,
    WindFieldPrediction, FloodPrediction, LandslidePrediction,
    LandslideGrid,
    RecurvaturePrediction, UnifiedForecastState, RiskLevel,
    CycloneCategory
)
from src.models.base import BaseModel, ModelInfo


class MockModel(BaseModel):
    """Mock model for testing."""

    def __init__(self, model_type: str, should_succeed: bool = True):
        info = ModelInfo(
            name=f"mock_{model_type}",
            version="v1.0",
            model_type=model_type,
            loaded_at=datetime.now(timezone.utc),
        )
        super().__init__(info)
        self.should_succeed = should_succeed
        self._is_loaded = True

    def load(self, checkpoint_path: str, **kwargs):
        pass

    def validate_input(self, input_data) -> bool:
        return True

    def predict(self, input_data):
        if not self.should_succeed:
            raise RuntimeError("Mock model failure")
        
        # Return appropriate schema objects based on model type
        if self.model_info.model_type == 'genesis':
            return GenesisPrediction(
                probability_24h=0.5,
                probability_48h=0.4,
                probability_72h=0.3,
                risk_level=RiskLevel.MODERATE,
                confidence=0.8,
                model_version="v1.0",
            )
        elif self.model_info.model_type == 'trajectory':
            return TrackPrediction(
                forecast_times=[datetime.now(timezone.utc) + timedelta(hours=6)],
                latitudes=[15.5],
                longitudes=[85.5],
                position_error_estimates_km=[25.0],
                uncertainty_km=[20.0],
                confidence=0.8,
                model_version="v1.0",
            )
        elif self.model_info.model_type == 'intensity':
            return IntensityPrediction(
                predicted_msw_24h=65.0,
                predicted_category_24h=CycloneCategory.VSCS,
                uncertainty_kt=10.0,
                confidence=0.8,
                model_version="v1.0",
            )
        elif self.model_info.model_type == 'ri':
            return RIPrediction(
                probability_24h=0.3,
                risk_level=RiskLevel.LOW,
                confidence=0.7,
                model_version="v1.0",
            )
        elif self.model_info.model_type == 'rainfall':
            return RainfallPrediction(
                model_version="v1.0",
                confidence=0.7,
            )
        elif self.model_info.model_type == 'wind':
            return WindFieldPrediction(
                wind_fields=[],
                model_version="v1.0",
                confidence=0.7,
            )
        elif self.model_info.model_type == 'flood':
            return FloodPrediction(
                probability_grid=np.zeros((10, 10)),
                risk_grid=np.zeros((10, 10), dtype=int),
                affected_area_km2=0.0,
                high_risk_regions=[],
                lats=np.linspace(15, 16, 10),
                lons=np.linspace(85, 86, 10),
                confidence=0.7,
                model_version="v1.0",
            )
        elif self.model_info.model_type == 'landslide':
            return LandslidePrediction(
                probability_grid=LandslideGrid(
                    probability_grid=np.zeros((10, 10)),
                    risk_level_grid=np.zeros((10, 10), dtype=int),
                    lats=np.linspace(15, 16, 10),
                    lons=np.linspace(85, 86, 10),
                ),
                high_risk_regions=[],
                confidence=0.7,
                model_version="v1.0",
            )
        elif self.model_info.model_type == 'recurvature':
            return RecurvaturePrediction(
                probability=0.2,
                risk_level=RiskLevel.LOW,
                confidence=0.7,
                model_version="v1.0",
            )
        return f"prediction_{self.model_info.model_type}"

    def explain(self, input_data, prediction):
        return {"explanation": "mock"}


class TestDependencyGraph:
    """Test DependencyGraph."""

    def test_add_module(self):
        """Test adding modules to graph."""
        graph = DependencyGraph()

        spec = Mock()
        spec.name = ModuleName.GENESIS
        spec.dependencies = []

        graph.add_module(spec)

        assert ModuleName.GENESIS in graph.modules

    def test_execution_order(self):
        """Test topological sort."""
        graph = DependencyGraph()

        # Add modules with dependencies
        for name, deps in {
            ModuleName.GENESIS: [],
            ModuleName.TRAJECTORY: [ModuleName.GENESIS],
            ModuleName.RAINFALL: [ModuleName.TRAJECTORY],
            ModuleName.FLOOD: [ModuleName.RAINFALL],
        }.items():
            spec = Mock()
            spec.name = name
            spec.dependencies = deps
            graph.add_module(spec)

        order = graph.get_execution_order(list(ModuleName))
        order_names = [m.value for m in order]

        # GENESIS should come before TRAJECTORY
        assert order_names.index('genesis') < order_names.index('trajectory')
        # TRAJECTORY before RAINFALL
        assert order_names.index('trajectory') < order_names.index('rainfall')
        # RAINFALL before FLOOD
        assert order_names.index('rainfall') < order_names.index('flood')

    def test_cycle_detection(self):
        """Test cycle detection."""
        graph = DependencyGraph()

        # Create cycle: A -> B -> A
        spec_a = Mock()
        spec_a.name = ModuleName.GENESIS
        spec_a.dependencies = [ModuleName.TRAJECTORY]

        spec_b = Mock()
        spec_b.name = ModuleName.TRAJECTORY
        spec_b.dependencies = [ModuleName.GENESIS]

        graph.add_module(spec_a)
        graph.add_module(spec_b)

        errors = graph.validate()
        assert len(errors) > 0
        assert any('cycle' in e.lower() for e in errors)


class TestPipelineOrchestrator:
    """Test PipelineOrchestrator."""

    def setup_method(self):
        """Create mock config and models."""
        self.config = {
            'data': {},
            'harmonization': {},
            'models': {
                'genesis': {'name': 'genesis', 'version': 'v1'},
                'trajectory': {'name': 'trajectory', 'version': 'v1'},
                'intensity': {'name': 'intensity', 'version': 'v1'},
                'ri': {'name': 'ri', 'version': 'v1'},
                'rainfall': {'name': 'rainfall', 'version': 'v1'},
                'wind': {'name': 'wind', 'version': 'v1'},
                'flood': {'name': 'flood', 'version': 'v1'},
                'landslide': {'name': 'landslide', 'version': 'v1'},
                'recurvature': {'name': 'recurvature', 'version': 'v1'},
                'hazard_engine': {'name': 'hazard_engine', 'version': 'v1'},
            },
            'hazard_engine': {},
            'registry_dir': 'models/registry',
        }

        # Mock registry
        self.mock_registry = Mock()
        self.mock_registry.get_latest.return_value = None

    def test_orchestrator_creation(self):
        """Test orchestrator can be created."""
        with patch('src.pipeline.orchestrator.get_registry', return_value=self.mock_registry):
            with patch('src.pipeline.orchestrator.CycloneStateBuilder'):
                orchestrator = PipelineOrchestrator(self.config, self.mock_registry)
                assert orchestrator is not None
                assert len(orchestrator.dependency_graph.modules) > 0

    def test_dependency_graph_structure(self):
        """Test default dependency graph is correct."""
        with patch('src.pipeline.orchestrator.get_registry', return_value=self.mock_registry):
            with patch('src.pipeline.orchestrator.CycloneStateBuilder'):
                orchestrator = PipelineOrchestrator(self.config, self.mock_registry)

                # Check key dependencies
                traj_deps = orchestrator.dependency_graph.get_dependencies(ModuleName.TRAJECTORY)
                assert ModuleName.GENESIS in traj_deps

                rain_deps = orchestrator.dependency_graph.get_dependencies(ModuleName.RAINFALL)
                assert ModuleName.TRAJECTORY in rain_deps

                flood_deps = orchestrator.dependency_graph.get_dependencies(ModuleName.FLOOD)
                assert ModuleName.RAINFALL in flood_deps
                assert ModuleName.WIND in flood_deps

    def test_mock_execution_full(self):
        """Test full pipeline execution with mock models."""
        # Create mock models for each module
        mock_models = {}
        for module in ModuleName:
            if module != ModuleName.HAZARD_ENGINE:
                mock_models[module] = MockModel(module.value)

        # Mock registry to return our models
        def mock_get_latest(name, model_type=None):
            for module, model in mock_models.items():
                if model.model_info.name == name:
                    return Mock(
                        name=name,
                        version='v1.0',
                        checkpoint_path='/fake/path',
                    )
            return None

        self.mock_registry.get_latest.side_effect = mock_get_latest
        self.mock_registry.load_model.side_effect = lambda name, version: mock_models.get(
            ModuleName(name.split('_')[0]) if '_' in name else ModuleName(name),
            MockModel(name)
        ).raw_model if hasattr(mock_models.get(ModuleName(name), None), 'raw_model') else "mock"

        with patch('src.pipeline.orchestrator.get_registry', return_value=self.mock_registry):
            with patch('src.pipeline.orchestrator.CycloneStateBuilder') as mock_builder:
                # Mock state builder
                mock_state = CycloneState(
                    storm_id='2024-001',
                    basin=Basin.BAY_OF_BENGAL,
                    timestamp=datetime.now(timezone.utc),
                    latitude=15.0,
                    longitude=85.0,
                )
                mock_builder.return_value.build_from_storm_id.return_value = mock_state

                orchestrator = PipelineOrchestrator(self.config, self.mock_registry)
                orchestrator.state_builder = mock_builder.return_value

                # Replace models with our mocks
                for module_name, spec in orchestrator.dependency_graph.modules.items():
                    if module_name in mock_models:
                        spec.model = mock_models[module_name]

                # Execute
                result = orchestrator.execute(
                    storm_id='2024-001',
                    basin='BOB',
                    reference_time=datetime.now(timezone.utc),
                    mode='full'
                )

                assert isinstance(result, UnifiedForecastState)
                assert result.cyclone.storm_id == '2024-001'

    def test_single_module_execution(self):
        """Test executing single module."""
        mock_model = MockModel('genesis')

        def mock_get_latest(name, model_type=None):
            if name == 'genesis':
                return Mock(name='genesis', version='v1', checkpoint_path='/fake/path')
            return None

        self.mock_registry.get_latest.side_effect = mock_get_latest
        self.mock_registry.load_model.return_value = mock_model

        with patch('src.pipeline.orchestrator.get_registry', return_value=self.mock_registry):
            with patch('src.pipeline.orchestrator.CycloneStateBuilder') as mock_builder:
                mock_state = CycloneState(
                    storm_id='2024-001',
                    basin=Basin.BAY_OF_BENGAL,
                    timestamp=datetime.now(timezone.utc),
                    latitude=15.0,
                    longitude=85.0,
                )
                mock_builder.return_value.build_from_storm_id.return_value = mock_state

                orchestrator = PipelineOrchestrator(self.config, self.mock_registry)
                orchestrator.state_builder = mock_builder.return_value

                # Replace genesis model
                orchestrator.dependency_graph.modules[ModuleName.GENESIS].model = mock_model

                result = orchestrator.execute(
                    storm_id='2024-001',
                    basin='BOB',
                    reference_time=datetime.now(timezone.utc),
                    modules=[ModuleName.GENESIS],
                    mode='custom'
                )

                assert result.genesis is not None


class TestModuleName:
    """Test ModuleName enum."""

    def test_all_modules_defined(self):
        """Test all expected modules exist."""
        expected = [
            'genesis', 'trajectory', 'intensity', 'ri',
            'rainfall', 'wind', 'flood', 'landslide',
            'recurvature', 'hazard_engine'
        ]
        actual = [m.value for m in ModuleName]
        for exp in expected:
            assert exp in actual


class TestCreateOrchestrator:
    """Test create_orchestrator factory."""

    def test_factory(self):
        """Test factory function."""
        config = {
            'data': {},
            'harmonization': {},
            'models': {},
            'registry_dir': 'models/registry',
        }

        with patch('src.pipeline.orchestrator.get_registry') as mock_registry:
            with patch('src.pipeline.orchestrator.CycloneStateBuilder'):
                orchestrator = create_orchestrator(config)
                assert orchestrator is not None


if __name__ == '__main__':
    pytest.main([__file__, '-v'])