"""TOOFAN Core Package."""

from src.core.schema import (
    CycloneState, Basin, CycloneCategory, RiskLevel,
    GenesisPrediction, TrackPrediction, RainfallPrediction,
    WindFieldPrediction, FloodPrediction, RIPrediction,
    IntensityPrediction, RecurvaturePrediction, LandslidePrediction,
    UnifiedForecastState, ModelMetadata,
    DataQualityFlag, ImputationRecord,
    EnvironmentalFeatures, OceanFeatures, SatelliteFeatures, SatelliteImages,
    msw_to_category, probability_to_risk_level
)
from src.core.ingestion import (
    DataIngestionLayer, IMDBestTrackLoader, IBTrACSLoader,
    ERA5Loader, SatelliteLoader, IMERGLoader,
    DEMLoader, SoilLoader, LandCoverLoader, RiverNetworkLoader, TideStormSurgeLoader
)
from src.core.harmonizer import (
    DataHarmonizer, HarmonizationConfig, TimeNormalizer,
    TemporalAligner, SpatialAligner, CycloneCenteredExtractor,
    MissingValueHandler, OutlierDetector, UnitNormalizer,
    create_harmonizer, validate_no_future_data
)
from src.core.splitting import (
    StormWiseSplitter, TemporalStormSplitter, LeaveOneStormOut,
    LeaveOneBasinOut, SplitResult, verify_split_integrity, get_storm_statistics
)
from src.core.leakage import (
    TemporalLeakageChecker, PreprocessingLeakageChecker,
    TargetLeakageChecker, StormSplitLeakageChecker,
    FusionLeakageChecker, comprehensive_leakage_audit,
    enforce_no_future_data, LeakageReport
)
from src.core.registry import (
    ModelRegistry, RegistryEntry, ModelLoader,
    create_registry_entry, get_registry, register_model
)

__all__ = [
    # Schema
    'CycloneState', 'Basin', 'CycloneCategory', 'RiskLevel',
    'GenesisPrediction', 'TrackPrediction', 'RainfallPrediction',
    'WindFieldPrediction', 'FloodPrediction', 'RIPrediction',
    'IntensityPrediction', 'RecurvaturePrediction', 'LandslidePrediction',
    'UnifiedForecastState', 'ModelMetadata',
    'DataQualityFlag', 'ImputationRecord',
    'EnvironmentalFeatures', 'OceanFeatures', 'SatelliteFeatures', 'SatelliteImages',
    'msw_to_category', 'probability_to_risk_level',
    # Ingestion
    'DataIngestionLayer', 'IMDBestTrackLoader', 'IBTrACSLoader',
    'ERA5Loader', 'SatelliteLoader', 'IMERGLoader',
    'DEMLoader', 'SoilLoader', 'LandCoverLoader', 'RiverNetworkLoader', 'TideStormSurgeLoader',
    # Harmonization
    'DataHarmonizer', 'HarmonizationConfig', 'TimeNormalizer',
    'TemporalAligner', 'SpatialAligner', 'CycloneCenteredExtractor',
    'MissingValueHandler', 'OutlierDetector', 'UnitNormalizer',
    'create_harmonizer', 'validate_no_future_data',
    # Splitting
    'StormWiseSplitter', 'TemporalStormSplitter', 'LeaveOneStormOut',
    'LeaveOneBasinOut', 'SplitResult', 'verify_split_integrity', 'get_storm_statistics',
    # Leakage
    'TemporalLeakageChecker', 'PreprocessingLeakageChecker',
    'TargetLeakageChecker', 'StormSplitLeakageChecker',
    'FusionLeakageChecker', 'comprehensive_leakage_audit',
    'enforce_no_future_data', 'LeakageReport',
    # Registry
    'ModelRegistry', 'RegistryEntry', 'ModelLoader',
    'create_registry_entry', 'get_registry', 'register_model',
]