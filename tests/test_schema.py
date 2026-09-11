"""Tests for schema validation."""

import pytest
from datetime import datetime, timezone
import numpy as np

from src.core.schema import (
    CycloneState, Basin, CycloneCategory, RiskLevel,
    GenesisPrediction, TrackPrediction, RainfallPrediction,
    WindFieldPrediction, FloodPrediction, RIPrediction,
    IntensityPrediction, RecurvaturePrediction, LandslidePrediction,
    LandslideGrid,
    UnifiedForecastState, EnvironmentalFeatures, OceanFeatures,
    SatelliteFeatures, SatelliteImages, Metadata,
    DataQualityFlag, ImputationRecord,
    msw_to_category, probability_to_risk_level
)


class TestCycloneState:
    """Test CycloneState schema."""

    def test_valid_cyclone_state(self):
        """Test creating a valid CycloneState."""
        state = CycloneState(
            storm_id="2024-001",
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc),
            latitude=15.5,
            longitude=85.3,
            max_wind_kt=65.0,
            central_pressure_hpa=980.0,
            category=CycloneCategory.VSCS,
            heading_deg=315.0,
            translation_speed_kt=12.0,
        )
        assert state.storm_id == "2024-001"
        assert state.basin == Basin.BAY_OF_BENGAL
        assert state.latitude == 15.5
        assert state.max_wind_kt == 65.0

    def test_invalid_latitude(self):
        """Test that invalid latitude raises error."""
        with pytest.raises(ValueError):
            CycloneState(
                storm_id="2024-001",
                basin=Basin.BAY_OF_BENGAL,
                timestamp=datetime.now(timezone.utc),
                latitude=95.0,  # Invalid
                longitude=85.3,
            )

    def test_invalid_longitude(self):
        """Test that invalid longitude raises error."""
        with pytest.raises(ValueError):
            CycloneState(
                storm_id="2024-001",
                basin=Basin.BAY_OF_BENGAL,
                timestamp=datetime.now(timezone.utc),
                latitude=15.5,
                longitude=200.0,  # Invalid
            )

    def test_timestamp_parsing(self):
        """Test timestamp parsing from string."""
        state = CycloneState(
            storm_id="2024-001",
            basin=Basin.BAY_OF_BENGAL,
            timestamp="2024-05-20T12:00:00Z",
            latitude=15.5,
            longitude=85.3,
        )
        assert state.timestamp == datetime(2024, 5, 20, 12, 0, 0, tzinfo=timezone.utc)

    def test_get_era5_dict(self):
        """Test ERA5 feature extraction."""
        state = CycloneState(
            storm_id="2024-001",
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.5,
            longitude=85.3,
            environmental_features=EnvironmentalFeatures(
                sst=29.5,
                t_850=300.0,
                r_850=80.0,
            )
        )
        era5_dict = state.get_era5_environmental_dict()
        assert era5_dict['era5_sst'] == 29.5
        assert era5_dict['era5_t850'] == 300.0
        assert era5_dict['era5_r850'] == 80.0

    def test_get_imd_dict(self):
        """Test IMD feature extraction."""
        state = CycloneState(
            storm_id="2024-001",
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.5,
            longitude=85.3,
            max_wind_kt=65.0,
            central_pressure_hpa=980.0,
            wind_change_6h=5.0,
            pressure_change_6h=-3.0,
        )
        imd_dict = state.get_imd_features_dict()
        assert imd_dict['max_wind_kt'] == 65.0
        assert imd_dict['wind_minus_6h_kt'] == 60.0
        assert imd_dict['delta_v_minus_6h_kt'] == 5.0


class TestGenesisPrediction:
    """Test GenesisPrediction schema."""

    def test_valid_genesis(self):
        pred = GenesisPrediction(
            probability_24h=0.75,
            probability_48h=0.60,
            probability_72h=0.45,
            risk_level=RiskLevel.HIGH,
            confidence=0.85,
            model_version="v1.0",
        )
        assert pred.probability_24h == 0.75
        assert pred.risk_level == RiskLevel.HIGH

    def test_invalid_probability(self):
        """Test that probability > 1 raises error."""
        with pytest.raises(ValueError):
            GenesisPrediction(
                probability_24h=1.5,
                probability_48h=0.60,
                probability_72h=0.45,
                risk_level=RiskLevel.HIGH,
                confidence=0.85,
                model_version="v1.0",
            )


class TestTrackPrediction:
    """Test TrackPrediction schema."""

    def test_valid_track(self):
        times = [datetime(2024, 5, 20, 14, 0, 0, tzinfo=timezone.utc),
                 datetime(2024, 5, 20, 16, 0, 0, tzinfo=timezone.utc)]
        pred = TrackPrediction(
            forecast_times=times,
            latitudes=[16.0, 16.5],
            longitudes=[85.5, 85.8],
            position_error_estimates_km=[25.0, 35.0],
            uncertainty_km=[20.0, 30.0],
            confidence=0.8,
            model_version="v12",
        )
        assert len(pred.forecast_times) == 2
        assert pred.uncertainty_km[1] == 30.0


class TestRainfallPrediction:
    """Test RainfallPrediction schema."""

    def test_valid_rainfall(self):
        grid = np.ones((10, 10)) * 50.0
        lats = np.linspace(15, 16, 10)
        lons = np.linspace(85, 86, 10)

        pred = RainfallPrediction(
            rainfall_24h={
                'horizon_hours': 24,
                'valid_time': datetime.now(timezone.utc),
                'grid': grid,
                'lats': lats,
                'lons': lons,
            },
            model_version="v1.0",
            timestamp=datetime.now(timezone.utc),
            confidence=0.75,
        )
        assert pred.rainfall_24h is not None
        assert pred.confidence == 0.75


class TestFloodPrediction:
    """Test FloodPrediction schema."""

    def test_valid_flood(self):
        grid = np.zeros((10, 10))
        grid[5, 5] = 0.8
        lats = np.linspace(15, 16, 10)
        lons = np.linspace(85, 86, 10)

        pred = FloodPrediction(
            probability_grid=grid,
            risk_grid=np.zeros((10, 10), dtype=int),
            affected_area_km2=100.0,
            high_risk_regions=[{'lat': 15.5, 'lon': 85.5, 'risk_level': 'HIGH', 'prob': 0.8}],
            lats=lats,
            lons=lons,
            confidence=0.8,
            model_version="v1.0",
        )
        assert pred.affected_area_km2 == 100.0
        assert pred.status == "AVAILABLE"


class TestRIPrediction:
    """Test RIPrediction schema."""

    def test_valid_ri(self):
        pred = RIPrediction(
            probability_24h=0.65,
            risk_level=RiskLevel.MODERATE,
            imd_probability=0.70,
            era5_probability=0.40,
            satellite_probability=0.55,
            fusion_probability=0.65,
            calibrated_probability=0.62,
            confidence=0.78,
            model_version="v1.0",
        )
        assert pred.probability_24h == 0.65
        assert pred.imd_probability == 0.70


class TestIntensityPrediction:
    """Test IntensityPrediction schema."""

    def test_valid_intensity(self):
        pred = IntensityPrediction(
            predicted_msw_24h=85.0,
            predicted_category_24h=CycloneCategory.VSCS,
            uncertainty_kt=12.0,
            confidence=0.82,
            model_version="v1.0",
        )
        assert pred.predicted_msw_24h == 85.0
        assert pred.predicted_category_24h == CycloneCategory.VSCS


class TestRecurvaturePrediction:
    """Test RecurvaturePrediction schema."""

    def test_valid_recurvature(self):
        pred = RecurvaturePrediction(
            probability=0.55,
            expected_turning_window="+12h to +24h",
            risk_level=RiskLevel.MODERATE,
            confidence=0.75,
            model_version="v1.0",
        )
        assert pred.probability == 0.55
        assert pred.expected_turning_window == "+12h to +24h"


class TestLandslidePrediction:
    """Test LandslidePrediction schema."""

    def test_valid_landslide(self):
        prob_grid = np.zeros((10, 10))
        prob_grid[5, 5] = 0.7
        risk_grid = np.zeros((10, 10), dtype=int)
        risk_grid[5, 5] = 3  # HIGH
        lats = np.linspace(15, 16, 10)
        lons = np.linspace(85, 86, 10)

        landslide_grid = LandslideGrid(
            probability_grid=prob_grid,
            risk_level_grid=risk_grid,
            lats=lats,
            lons=lons,
        )

        pred = LandslidePrediction(
            probability_grid=landslide_grid,
            high_risk_regions=[{'lat': 15.5, 'lon': 85.5, 'risk_level': 'HIGH'}],
            confidence=0.7,
            model_version="v1.0",
        )
        assert pred.confidence == 0.7


class TestUnifiedForecastState:
    """Test UnifiedForecastState schema."""

    def test_valid_unified(self):
        state = CycloneState(
            storm_id="2024-001",
            basin=Basin.BAY_OF_BENGAL,
            timestamp=datetime.now(timezone.utc),
            latitude=15.5,
            longitude=85.3,
        )

        unified = UnifiedForecastState(
            cyclone=state,
            overall_hazard_severity=RiskLevel.HIGH,
            confidence=0.8,
            model_versions={"genesis": "v1.0", "trajectory": "v12"},
        )
        assert unified.cyclone.storm_id == "2024-001"
        assert unified.overall_hazard_severity == RiskLevel.HIGH


class TestUtilityFunctions:
    """Test utility functions."""

    def test_msw_to_category(self):
        assert msw_to_category(20.0) == CycloneCategory.D
        assert msw_to_category(30.0) == CycloneCategory.DD
        assert msw_to_category(40.0) == CycloneCategory.CS
        assert msw_to_category(55.0) == CycloneCategory.SCS
        assert msw_to_category(75.0) == CycloneCategory.VSCS
        assert msw_to_category(100.0) == CycloneCategory.ESCS
        assert msw_to_category(130.0) == CycloneCategory.SUCS

    def test_probability_to_risk_level(self):
        assert probability_to_risk_level(0.05) == RiskLevel.NONE
        assert probability_to_risk_level(0.20) == RiskLevel.LOW
        assert probability_to_risk_level(0.45) == RiskLevel.MODERATE
        assert probability_to_risk_level(0.70) == RiskLevel.HIGH
        assert probability_to_risk_level(0.90) == RiskLevel.EXTREME


class TestEnvironmentalFeatures:
    """Test EnvironmentalFeatures schema."""

    def test_valid_features(self):
        features = EnvironmentalFeatures(
            sst=29.5,
            t_850=300.0,
            r_850=80.0,
            u_850=5.0,
            v_850=-2.0,
            vertical_wind_shear=12.0,
        )
        assert features.sst == 29.5
        assert features.vertical_wind_shear == 12.0


class TestDataQualityFlag:
    """Test DataQualityFlag enum."""
    def test_flags(self):
        assert DataQualityFlag.ORIGINAL.value == "ORIGINAL"
        assert DataQualityFlag.IMPUTED_MEAN.value == "IMPUTED_MEAN"
        assert DataQualityFlag.MISSING.value == "MISSING"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])