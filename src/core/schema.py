"""Core schema definitions for TOOFAN pipeline.

All data contracts use Pydantic for validation and serialization.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, field_validator, computed_field
import numpy as np


class Basin(str, Enum):
    """Ocean basin identifiers."""
    NORTH_INDIAN = "NI"
    BAY_OF_BENGAL = "BOB"
    ARABIAN_SEA = "AS"
    WEST_PACIFIC = "WP"
    EAST_PACIFIC = "EP"
    NORTH_ATLANTIC = "NA"
    SOUTH_INDIAN = "SI"
    SOUTH_PACIFIC = "SP"


class CycloneCategory(str, Enum):
    """IMD cyclone intensity categories."""
    D = "D"       # Depression (17-27 kt)
    DD = "DD"     # Deep Depression (28-33 kt)
    CS = "CS"     # Cyclonic Storm (34-47 kt)
    SCS = "SCS"   # Severe Cyclonic Storm (48-63 kt)
    VSCS = "VSCS" # Very Severe Cyclonic Storm (64-89 kt)
    ESCS = "ESCS" # Extremely Severe Cyclonic Storm (90-119 kt)
    SUCS = "SUCS" # Super Cyclonic Storm (>=120 kt)


class RiskLevel(str, Enum):
    """Standardized risk levels across all hazard models."""
    NONE = "NONE"
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    EXTREME = "EXTREME"


class DataQualityFlag(str, Enum):
    """Data quality flags for harmonized inputs."""
    ORIGINAL = "ORIGINAL"
    IMPUTED_MEAN = "IMPUTED_MEAN"
    IMPUTED_MEDIAN = "IMPUTED_MEDIAN"
    IMPUTED_INTERPOLATION = "IMPUTED_INTERPOLATION"
    IMPUTED_CLIMATOLOGY = "IMPUTED_CLIMATOLOGY"
    OUTLIER_CAPPED = "OUTLIER_CAPPED"
    MISSING = "MISSING"
    SUSPECT = "SUSPECT"


class ImputationRecord(BaseModel):
    """Record of imputation applied to a field."""
    field_name: str
    original_value: Optional[float] = None
    imputed_value: float
    method: DataQualityFlag
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class EnvironmentalFeatures(BaseModel):
    """ERA5-derived environmental features at cyclone center."""
    # Temperature at pressure levels (K)
    t_850: Optional[float] = None
    t_700: Optional[float] = None
    t_500: Optional[float] = None
    t_200: Optional[float] = None

    # Relative humidity at pressure levels (%)
    r_850: Optional[float] = None
    r_700: Optional[float] = None
    r_500: Optional[float] = None
    r_200: Optional[float] = None

    # Zonal wind at pressure levels (m/s)
    u_850: Optional[float] = None
    u_700: Optional[float] = None
    u_500: Optional[float] = None
    u_200: Optional[float] = None

    # Meridional wind at pressure levels (m/s)
    v_850: Optional[float] = None
    v_700: Optional[float] = None
    v_500: Optional[float] = None
    v_200: Optional[float] = None

    # Divergence at pressure levels (1/s)
    d_850: Optional[float] = None
    d_700: Optional[float] = None
    d_500: Optional[float] = None
    d_200: Optional[float] = None

    # Derived features
    sst: Optional[float] = None                    # Sea surface temperature (°C)
    sst_anomaly: Optional[float] = None            # SST anomaly (°C)
    ohc: Optional[float] = None                    # Ocean heat content (kJ/cm²)
    tchp: Optional[float] = None                   # Tropical cyclone heat potential
    vertical_wind_shear: Optional[float] = None    # 850-200 hPa shear (m/s)
    shear_direction: Optional[float] = None        # Shear direction (degrees)

    # Quality flags for each field
    quality_flags: dict[str, DataQualityFlag] = Field(default_factory=dict)
    imputation_records: list[ImputationRecord] = Field(default_factory=list)


class OceanFeatures(BaseModel):
    """Ocean state features."""
    sst: Optional[float] = None
    sst_anomaly: Optional[float] = None
    mixed_layer_depth: Optional[float] = None
    barrier_layer_thickness: Optional[float] = None
    ocean_heat_content: Optional[float] = None
    tchp: Optional[float] = None
    salinity_0_50m: Optional[float] = None
    current_speed: Optional[float] = None
    current_direction: Optional[float] = None

    quality_flags: dict[str, DataQualityFlag] = Field(default_factory=dict)
    imputation_records: list[ImputationRecord] = Field(default_factory=list)


class SatelliteFeatures(BaseModel):
    """Satellite-derived features (scalar)."""
    ir_brightness_temp_min: Optional[float] = None      # Minimum IR BT (K)
    ir_brightness_temp_mean: Optional[float] = None     # Mean IR BT in inner core (K)
    cloud_top_temperature: Optional[float] = None       # Cloud top temp (K)
    convective_area_fraction: Optional[float] = None    # Fraction of cold clouds
    symmetry_index: Optional[float] = None              # Azimuthal symmetry metric
    eye_score: Optional[float] = None                   # Eye detection confidence
    spiral_band_score: Optional[float] = None           # Banding structure score

    quality_flags: dict[str, DataQualityFlag] = Field(default_factory=dict)
    imputation_records: list[ImputationRecord] = Field(default_factory=list)


class SatelliteImages(BaseModel):
    """Satellite image data (gridded)."""
    ir_image: Optional[np.ndarray] = None               # (H, W) brightness temperature
    ir_mask: Optional[np.ndarray] = None                # (H, W) valid pixel mask
    vis_image: Optional[np.ndarray] = None              # (H, W) visible channel
    mw_image: Optional[np.ndarray] = None               # (H, W) microwave
    sar_image: Optional[np.ndarray] = None              # (H, W) SAR wind retrieval
    image_center_lat: Optional[float] = None
    image_center_lon: Optional[float] = None
    image_resolution_km: Optional[float] = None
    acquisition_time: Optional[datetime] = None

    class Config:
        arbitrary_types_allowed = True


class Metadata(BaseModel):
    """Metadata about the cyclone state assembly."""
    source_datasets: list[str] = Field(default_factory=list)
    ingestion_timestamp: datetime = Field(default_factory=datetime.utcnow)
    harmonization_version: str = "1.0"
    schema_version: str = "1.0"
    warnings: list[str] = Field(default_factory=list)
    missing_modalities: list[str] = Field(default_factory=list)


class CycloneState(BaseModel):
    """Canonical representation of a tropical cyclone at reference time t.

    This is the single validated input contract for all downstream models.
    """
    # Identity
    storm_id: str = Field(..., description="Unique storm identifier (e.g., '2024-001', 'BOB-03')")
    basin: Basin = Field(..., description="Ocean basin")

    # Time
    timestamp: datetime = Field(..., description="Reference/forecast initialization time (UTC)")

    # Position
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude (degrees North)")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude (degrees East)")

    # Intensity
    max_wind_kt: Optional[float] = Field(None, ge=0.0, le=200.0, description="Maximum sustained wind (knots)")
    central_pressure_hpa: Optional[float] = Field(None, ge=850.0, le=1050.0, description="Central pressure (hPa)")
    category: Optional[CycloneCategory] = Field(None, description="IMD intensity category")

    # Motion
    heading_deg: Optional[float] = Field(None, ge=0.0, lt=360.0, description="Movement heading (degrees, 0=N, 90=E)")
    translation_speed_kt: Optional[float] = Field(None, ge=0.0, le=50.0, description="Translation speed (knots)")
    acceleration: Optional[float] = Field(None, description="Acceleration (kt/6h)")

    # Intensity trends (historical, never future)
    wind_change_6h: Optional[float] = Field(None, description="Wind change over past 6h (kt)")
    wind_change_12h: Optional[float] = Field(None, description="Wind change over past 12h (kt)")
    wind_change_24h: Optional[float] = Field(None, description="Wind change over past 24h (kt)")
    pressure_change_6h: Optional[float] = Field(None, description="Pressure change over past 6h (hPa)")
    pressure_change_12h: Optional[float] = Field(None, description="Pressure change over past 12h (hPa)")
    pressure_change_24h: Optional[float] = Field(None, description="Pressure change over past 24h (hPa)")

    # Environmental context
    environmental_features: EnvironmentalFeatures = Field(default_factory=EnvironmentalFeatures)
    ocean_features: OceanFeatures = Field(default_factory=OceanFeatures)
    satellite_features: SatelliteFeatures = Field(default_factory=SatelliteFeatures)
    satellite_images: Optional[SatelliteImages] = None

    # Metadata
    metadata: Metadata = Field(default_factory=Metadata)

    @field_validator('timestamp', mode='before')
    @classmethod
    def parse_timestamp(cls, v):
        if isinstance(v, str):
            return datetime.fromisoformat(v.replace('Z', '+00:00'))
        return v

    def get_era5_environmental_dict(self) -> dict[str, float]:
        """Extract ERA5 environmental features as flat dict for model input."""
        env = self.environmental_features
        return {
            'era5_sst': env.sst or 0.0,
            'era5_t850': env.t_850 or 0.0,
            'era5_t700': env.t_700 or 0.0,
            'era5_t500': env.t_500 or 0.0,
            'era5_t200': env.t_200 or 0.0,
            'era5_r850': env.r_850 or 0.0,
            'era5_r700': env.r_700 or 0.0,
            'era5_r500': env.r_500 or 0.0,
            'era5_r200': env.r_200 or 0.0,
            'era5_u850': env.u_850 or 0.0,
            'era5_u700': env.u_700 or 0.0,
            'era5_u500': env.u_500 or 0.0,
            'era5_u200': env.u_200 or 0.0,
            'era5_v850': env.v_850 or 0.0,
            'era5_v700': env.v_700 or 0.0,
            'era5_v500': env.v_500 or 0.0,
            'era5_v200': env.v_200 or 0.0,
        }

    def get_imd_features_dict(self) -> dict[str, float]:
        """Extract IMD features as flat dict for model input."""
        return {
            'latitude': self.latitude,
            'longitude': self.longitude,
            'max_wind_kt': self.max_wind_kt or 0.0,
            'central_pressure_hpa': self.central_pressure_hpa or 1000.0,
            'pressure_drop_hpa': -(self.pressure_change_6h or 0.0) if self.pressure_change_6h else 0.0,
            'wind_minus_6h_kt': (self.max_wind_kt or 0.0) - (self.wind_change_6h or 0.0),
            'delta_v_minus_6h_kt': self.wind_change_6h or 0.0,
            'wind_minus_12h_kt': (self.max_wind_kt or 0.0) - (self.wind_change_12h or 0.0),
            'delta_v_minus_12h_kt': self.wind_change_12h or 0.0,
            'wind_minus_24h_kt': (self.max_wind_kt or 0.0) - (self.wind_change_24h or 0.0),
            'delta_v_minus_24h_kt': self.wind_change_24h or 0.0,
        }

    def get_track_features_array(self, history_length: int = 12) -> np.ndarray:
        """Get features formatted for trajectory model (13 features per timestep).
        
        Note: This requires historical track data; for now returns single-timestep
        with climatology proxies for SST/shear as the original model expects.
        """
        # Feature order: lat, lon, wind, mslp, rmw, sst, shear, speed_kmh, dt_hours,
        # bearing_sin, bearing_cos, month_sin, month_cos
        month = self.timestamp.month
        bearing = self.heading_deg or 0.0
        speed_kmh = (self.translation_speed_kt or 0.0) * 1.852

        return np.array([[
            self.latitude,
            self.longitude,
            self.max_wind_kt or 0.0,
            self.central_pressure_hpa or 1000.0,
            0.0,  # rmw - not in current state
            self.environmental_features.sst or 28.0,
            self.environmental_features.vertical_wind_shear or 10.0,
            speed_kmh,
            3.0,  # dt_hours (assumes 3-hourly)
            np.sin(np.deg2rad(bearing)),
            np.cos(np.deg2rad(bearing)),
            np.sin(2 * np.pi * month / 12),
            np.cos(2 * np.pi * month / 12),
        ]], dtype=np.float32)


# ============================================================================
# PREDICTION OUTPUT SCHEMAS
# ============================================================================

class GenesisPrediction(BaseModel):
    """Short-term tropical cyclone genesis probability.

    `probability` is the primary 24-hour genesis probability (equivalent to
    `probability_24h`, provided both for downstream readability and backward
    compatibility with the original multi-horizon schema). The model produces
    a probability of genesis for class 1, not only a hard binary label.
    """
    # Genesis probability (class 1) at 24h
    probability_24h: float = Field(..., ge=0.0, le=1.0)
    probability_48h: float = Field(..., ge=0.0, le=1.0)
    probability_72h: float = Field(..., ge=0.0, le=1.0)

    # Inference control fields
    threshold: float = Field(0.24, ge=0.0, le=1.0, description="Optimized genesis threshold")
    predicted_class: int = Field(0, ge=0, le=1)
    model_name: str = Field("genesis")
    model_version: str
    mode: str = Field("production", description="Inference mode: 'production' or 'ensemble'")
    artifact_hash: str = Field("", description="SHA-256 of the model artifact")
    artifact_path: str = Field("", description="Path to the model artifact")
    feature_schema: dict = Field(default_factory=dict, description="Feature schema used by the model")
    provenance: dict = Field(default_factory=dict, description="Full model provenance")
    calibrated: bool = Field(False, description="Whether probabilities are calibration-adjusted")

    # Calibrated probability semantics (distinct from raw)
    raw_probability: Optional[float] = Field(None, ge=0.0, le=1.0)
    calibrated_probability: Optional[float] = Field(None, ge=0.0, le=1.0)

    # Ensemble component probabilities (soft-voting only)
    lightgbm_probability: Optional[float] = Field(None, ge=0.0, le=1.0)
    xgboost_probability: Optional[float] = Field(None, ge=0.0, le=1.0)
    randomforest_probability: Optional[float] = Field(None, ge=0.0, le=1.0)
    ensemble_probability: Optional[float] = Field(None, ge=0.0, le=1.0)
    ensemble_weights: dict = Field(default_factory=dict)

    # Candidate disturbance location
    candidate_latitude: Optional[float] = Field(None, ge=-90.0, le=90.0)
    candidate_longitude: Optional[float] = Field(None, ge=-180.0, le=180.0)

    # Risk / confidence
    risk_level: RiskLevel
    confidence: float = Field(..., ge=0.0, le=1.0, description="Model confidence in this prediction")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    contributing_factors: dict[str, float] = Field(default_factory=dict)
    feature_importance: dict[str, float] = Field(default_factory=dict)
    explanation: Optional[str] = None

    @computed_field
    @property
    def probability(self) -> float:
        """Primary 24-hour genesis probability (class 1)."""
        return self.probability_24h


class TrackPoint(BaseModel):
    """Single forecast track point."""
    forecast_time: datetime
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    position_error_estimate_km: Optional[float] = Field(None, ge=0.0)


class TrackPrediction(BaseModel):
    """Cyclone trajectory forecast."""
    forecast_times: list[datetime]
    latitudes: list[float]
    longitudes: list[float]
    position_error_estimates_km: list[float]
    uncertainty_km: list[float] = Field(..., description="Uncertainty radius per horizon (km)")
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    # Cone of uncertainty (polygon points)
    cone_polygons: Optional[list[list[tuple[float, float]]]] = None

    @field_validator('forecast_times', mode='before')
    @classmethod
    def parse_forecast_times(cls, v):
        if isinstance(v, list) and v and isinstance(v[0], str):
            return [datetime.fromisoformat(t.replace('Z', '+00:00')) for t in v]
        return v


class RainfallGrid(BaseModel):
    """Rainfall accumulation grid for a specific horizon."""
    horizon_hours: int
    valid_time: datetime
    grid: np.ndarray  # (H, W) rainfall in mm
    lats: np.ndarray  # (H,) latitude coordinates
    lons: np.ndarray  # (W,) longitude coordinates
    heavy_rain_probability: Optional[np.ndarray] = None  # P(rain > 50mm)
    extreme_rain_probability: Optional[np.ndarray] = None  # P(rain > 100mm)
    uncertainty: Optional[np.ndarray] = None

    class Config:
        arbitrary_types_allowed = True


class RainfallPrediction(BaseModel):
    """Future rainfall forecasts at multiple horizons."""
    rainfall_3h: Optional[RainfallGrid] = None
    rainfall_6h: Optional[RainfallGrid] = None
    rainfall_12h: Optional[RainfallGrid] = None
    rainfall_24h: Optional[RainfallGrid] = None
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    confidence: float = Field(..., ge=0.0, le=1.0)


class WindFieldGrid(BaseModel):
    """Wind field grid for a specific forecast time."""
    forecast_time: datetime
    u10: np.ndarray       # (H, W) 10m zonal wind (m/s)
    v10: np.ndarray       # (H, W) 10m meridional wind (m/s)
    speed: np.ndarray     # (H, W) wind speed (m/s)
    direction: np.ndarray # (H, W) wind direction (degrees, met convention)
    p_gt_34kt: Optional[np.ndarray] = None
    p_gt_50kt: Optional[np.ndarray] = None
    p_gt_64kt: Optional[np.ndarray] = None
    uncertainty: Optional[np.ndarray] = None
    lats: np.ndarray
    lons: np.ndarray

    class Config:
        arbitrary_types_allowed = True


class WindFieldPrediction(BaseModel):
    """Future wind field forecasts."""
    wind_fields: list[WindFieldGrid]
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    confidence: float = Field(..., ge=0.0, le=1.0)


class FloodPrediction(BaseModel):
    """Flash flood probability forecast."""
    probability_grid: np.ndarray      # (H, W) P(flood)
    risk_grid: np.ndarray             # (H, W) RiskLevel encoded
    affected_area_km2: float
    high_risk_regions: list[dict]     # List of {lat, lon, risk_level, prob}
    lats: np.ndarray
    lons: np.ndarray
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    status: str = "AVAILABLE"
    reason: Optional[str] = None

    class Config:
        arbitrary_types_allowed = True


class RIPrediction(BaseModel):
    """Rapid intensification probability."""
    probability_24h: float = Field(..., ge=0.0, le=1.0)
    risk_level: RiskLevel
    imd_probability: Optional[float] = None
    era5_probability: Optional[float] = None
    satellite_probability: Optional[float] = None
    fusion_probability: Optional[float] = None
    calibrated_probability: Optional[float] = None
    explanation: Optional[str] = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    shap_values: Optional[dict[str, float]] = None
    gradcam_heatmap: Optional[np.ndarray] = None

    class Config:
        arbitrary_types_allowed = True


class IntensityPrediction(BaseModel):
    """Cyclone intensity forecast."""
    predicted_msw_6h: Optional[float] = Field(None, ge=0.0)
    predicted_msw_12h: Optional[float] = Field(None, ge=0.0)
    predicted_msw_24h: Optional[float] = Field(None, ge=0.0)
    predicted_msw_48h: Optional[float] = Field(None, ge=0.0)
    predicted_category_6h: Optional[CycloneCategory] = None
    predicted_category_12h: Optional[CycloneCategory] = None
    predicted_category_24h: Optional[CycloneCategory] = None
    predicted_category_48h: Optional[CycloneCategory] = None
    uncertainty_kt: Optional[float] = Field(None, ge=0.0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    feature_importance: dict[str, float] = Field(default_factory=dict)


class RecurvaturePrediction(BaseModel):
    """Recurvature probability forecast."""
    probability: float = Field(..., ge=0.0, le=1.0)
    expected_turning_window: Optional[str] = None  # e.g., "+12h to +24h"
    risk_level: RiskLevel
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    feature_importance: dict[str, float] = Field(default_factory=dict)


class LandslideGrid(BaseModel):
    """Landslide probability/susceptibility grid."""
    probability_grid: np.ndarray
    susceptibility_grid: Optional[np.ndarray] = None
    risk_level_grid: np.ndarray
    lats: np.ndarray
    lons: np.ndarray

    class Config:
        arbitrary_types_allowed = True


class LandslidePrediction(BaseModel):
    """Cyclone-induced landslide risk forecast."""
    probability_grid: LandslideGrid
    high_risk_regions: list[dict]
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    status: str = "AVAILABLE"
    reason: Optional[str] = None


class UnifiedForecastState(BaseModel):
    """Complete unified forecast from all models."""
    cyclone: CycloneState
    genesis: Optional[GenesisPrediction] = None
    track: Optional[TrackPrediction] = None
    intensity: Optional[IntensityPrediction] = None
    rapid_intensification: Optional[RIPrediction] = None
    recurvature: Optional[RecurvaturePrediction] = None
    wind: Optional[WindFieldPrediction] = None
    rainfall: Optional[RainfallPrediction] = None
    flood: Optional[FloodPrediction] = None
    landslide: Optional[LandslidePrediction] = None
    uncertainty_summary: dict = Field(default_factory=dict)
    explanations: dict = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    model_versions: dict[str, str] = Field(default_factory=dict)

    # Overall hazard assessment
    overall_hazard_severity: Optional[RiskLevel] = None
    affected_region: Optional[dict] = None
    confidence: float = Field(..., ge=0.0, le=1.0)

    class Config:
        arbitrary_types_allowed = True


class ModelMetadata(BaseModel):
    """Model registry metadata."""
    name: str
    version: str
    model_type: str  # 'genesis', 'trajectory', 'rainfall', 'wind', 'flood', 'ri', 'intensity', 'recurvature', 'landslide'
    training_dataset: str
    feature_version: str
    training_period: tuple[str, str]  # (start, end)
    validation_metrics: dict[str, float]
    test_metrics: dict[str, float]
    preprocessing_version: str
    checkpoint_path: str
    calibration_artifact: Optional[str] = None
    timestamp: datetime
    git_commit: Optional[str] = None
    configuration: dict = Field(default_factory=dict)


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def msw_to_category(msw: float) -> CycloneCategory:
    """Convert maximum sustained wind (kt) to IMD category."""
    if msw < 28.0:
        return CycloneCategory.D
    elif msw <= 33.0:
        return CycloneCategory.DD
    elif msw <= 47.0:
        return CycloneCategory.CS
    elif msw <= 63.0:
        return CycloneCategory.SCS
    elif msw <= 89.0:
        return CycloneCategory.VSCS
    elif msw <= 119.0:
        return CycloneCategory.ESCS
    else:
        return CycloneCategory.SUCS


def probability_to_risk_level(prob: float, thresholds: Optional[dict[RiskLevel, tuple[float, float]]] = None) -> RiskLevel:
    """Convert probability to risk level using standard thresholds."""
    if thresholds is None:
        thresholds = {
            RiskLevel.NONE: (0.0, 0.1),
            RiskLevel.LOW: (0.1, 0.3),
            RiskLevel.MODERATE: (0.3, 0.5),
            RiskLevel.HIGH: (0.5, 0.75),
            RiskLevel.EXTREME: (0.75, 1.0),
        }
    for level, (low, high) in thresholds.items():
        if low <= prob < high:
            return level
    return RiskLevel.EXTREME if prob >= 1.0 else RiskLevel.NONE