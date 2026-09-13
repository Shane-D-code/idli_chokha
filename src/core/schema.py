"""Core schema definitions for TOOFAN pipeline.

All data contracts use Pydantic for validation and serialization.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

import numpy as np
from pydantic import BaseModel, Field, computed_field, field_validator


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
    original_value: float | None = None
    imputed_value: float
    method: DataQualityFlag
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class EnvironmentalFeatures(BaseModel):
    """ERA5-derived environmental features at cyclone center."""
    # Temperature at pressure levels (K)
    t_850: float | None = None
    t_700: float | None = None
    t_500: float | None = None
    t_200: float | None = None

    # Relative humidity at pressure levels (%)
    r_850: float | None = None
    r_700: float | None = None
    r_500: float | None = None
    r_200: float | None = None

    # Zonal wind at pressure levels (m/s)
    u_850: float | None = None
    u_700: float | None = None
    u_500: float | None = None
    u_200: float | None = None

    # Meridional wind at pressure levels (m/s)
    v_850: float | None = None
    v_700: float | None = None
    v_500: float | None = None
    v_200: float | None = None

    # Divergence at pressure levels (1/s)
    d_850: float | None = None
    d_700: float | None = None
    d_500: float | None = None
    d_200: float | None = None

    # Derived features
    sst: float | None = None                    # Sea surface temperature (°C)
    sst_anomaly: float | None = None            # SST anomaly (°C)
    ohc: float | None = None                    # Ocean heat content (kJ/cm²)
    tchp: float | None = None                   # Tropical cyclone heat potential
    vertical_wind_shear: float | None = None    # 850-200 hPa shear (m/s)
    shear_direction: float | None = None        # Shear direction (degrees)

    # Quality flags for each field
    quality_flags: dict[str, DataQualityFlag] = Field(default_factory=dict)
    imputation_records: list[ImputationRecord] = Field(default_factory=list)


class OceanFeatures(BaseModel):
    """Ocean state features."""
    sst: float | None = None
    sst_anomaly: float | None = None
    mixed_layer_depth: float | None = None
    barrier_layer_thickness: float | None = None
    ocean_heat_content: float | None = None
    tchp: float | None = None
    salinity_0_50m: float | None = None
    current_speed: float | None = None
    current_direction: float | None = None

    quality_flags: dict[str, DataQualityFlag] = Field(default_factory=dict)
    imputation_records: list[ImputationRecord] = Field(default_factory=list)


class SatelliteFeatures(BaseModel):
    """Satellite-derived features (scalar)."""
    ir_brightness_temp_min: float | None = None      # Minimum IR BT (K)
    ir_brightness_temp_mean: float | None = None     # Mean IR BT in inner core (K)
    cloud_top_temperature: float | None = None       # Cloud top temp (K)
    convective_area_fraction: float | None = None    # Fraction of cold clouds
    symmetry_index: float | None = None              # Azimuthal symmetry metric
    eye_score: float | None = None                   # Eye detection confidence
    spiral_band_score: float | None = None           # Banding structure score

    quality_flags: dict[str, DataQualityFlag] = Field(default_factory=dict)
    imputation_records: list[ImputationRecord] = Field(default_factory=list)


class SatelliteImages(BaseModel):
    """Satellite image data (gridded)."""
    ir_image: np.ndarray | None = None               # (H, W) brightness temperature
    ir_mask: np.ndarray | None = None                # (H, W) valid pixel mask
    vis_image: np.ndarray | None = None              # (H, W) visible channel
    mw_image: np.ndarray | None = None               # (H, W) microwave
    sar_image: np.ndarray | None = None              # (H, W) SAR wind retrieval
    image_center_lat: float | None = None
    image_center_lon: float | None = None
    image_resolution_km: float | None = None
    acquisition_time: datetime | None = None

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
    max_wind_kt: float | None = Field(None, ge=0.0, le=200.0, description="Maximum sustained wind (knots)")
    central_pressure_hpa: float | None = Field(None, ge=850.0, le=1050.0, description="Central pressure (hPa)")
    category: CycloneCategory | None = Field(None, description="IMD intensity category")

    # Motion
    heading_deg: float | None = Field(None, ge=0.0, lt=360.0, description="Movement heading (degrees, 0=N, 90=E)")
    translation_speed_kt: float | None = Field(None, ge=0.0, le=50.0, description="Translation speed (knots)")
    acceleration: float | None = Field(None, description="Acceleration (kt/6h)")

    # Intensity trends (historical, never future)
    wind_change_6h: float | None = Field(None, description="Wind change over past 6h (kt)")
    wind_change_12h: float | None = Field(None, description="Wind change over past 12h (kt)")
    wind_change_24h: float | None = Field(None, description="Wind change over past 24h (kt)")
    pressure_change_6h: float | None = Field(None, description="Pressure change over past 6h (hPa)")
    pressure_change_12h: float | None = Field(None, description="Pressure change over past 12h (hPa)")
    pressure_change_24h: float | None = Field(None, description="Pressure change over past 24h (hPa)")

    # Environmental context
    environmental_features: EnvironmentalFeatures = Field(default_factory=EnvironmentalFeatures)
    ocean_features: OceanFeatures = Field(default_factory=OceanFeatures)
    satellite_features: SatelliteFeatures = Field(default_factory=SatelliteFeatures)
    satellite_images: SatelliteImages | None = None

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
    raw_probability: float | None = Field(None, ge=0.0, le=1.0)
    calibrated_probability: float | None = Field(None, ge=0.0, le=1.0)

    # Ensemble component probabilities (soft-voting only)
    lightgbm_probability: float | None = Field(None, ge=0.0, le=1.0)
    xgboost_probability: float | None = Field(None, ge=0.0, le=1.0)
    randomforest_probability: float | None = Field(None, ge=0.0, le=1.0)
    ensemble_probability: float | None = Field(None, ge=0.0, le=1.0)
    ensemble_weights: dict = Field(default_factory=dict)

    # Candidate disturbance location
    candidate_latitude: float | None = Field(None, ge=-90.0, le=90.0)
    candidate_longitude: float | None = Field(None, ge=-180.0, le=180.0)

    # Risk / confidence
    risk_level: RiskLevel
    confidence: float = Field(..., ge=0.0, le=1.0, description="Model confidence in this prediction")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    contributing_factors: dict[str, float] = Field(default_factory=dict)
    feature_importance: dict[str, float] = Field(default_factory=dict)
    explanation: str | None = None

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
    position_error_estimate_km: float | None = Field(None, ge=0.0)


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
    status: str = "AVAILABLE"
    explanation: str = ""

    # Cone of uncertainty (polygon points)
    cone_polygons: list[list[tuple[float, float]]] | None = None

    @field_validator('forecast_times', mode='before')
    @classmethod
    def parse_forecast_times(cls, v):
        if isinstance(v, list) and v and isinstance(v[0], str):
            return [datetime.fromisoformat(t.replace('Z', '+00:00')) for t in v]
        return v


class RainfallGrid(BaseModel):
    """Rainfall rate grid for a specific time window (FANI 2019 same-time classifier)."""
    horizon_hours: int
    valid_time: datetime
    grid: np.ndarray  # (H, W) rainfall rate in mm/hr
    lats: np.ndarray  # (H,) latitude coordinates
    lons: np.ndarray  # (W,) longitude coordinates
    heavy_rain_probability: np.ndarray | None = None  # P(rain > heavy threshold; 10 mm/hr)
    extreme_rain_probability: np.ndarray | None = None  # P(rain > extreme threshold)
    uncertainty: np.ndarray | None = None

    class Config:
        arbitrary_types_allowed = True


class RainfallPrediction(BaseModel):
    """Rainfall estimation — same-time classifier on FANI 2019 (not a future forecast)."""
    rainfall_3h: RainfallGrid | None = None
    rainfall_6h: RainfallGrid | None = None
    rainfall_12h: RainfallGrid | None = None
    rainfall_24h: RainfallGrid | None = None
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    confidence: float = Field(..., ge=0.0, le=1.0)
    status: str = ""
    explanation: str = ""


class WindFieldGrid(BaseModel):
    """Wind field grid for a specific forecast time."""
    forecast_time: datetime
    u10: np.ndarray       # (H, W) 10m zonal wind (m/s)
    v10: np.ndarray       # (H, W) 10m meridional wind (m/s)
    speed: np.ndarray     # (H, W) wind speed (m/s)
    direction: np.ndarray # (H, W) wind direction (degrees, met convention)
    p_gt_34kt: np.ndarray | None = None
    p_gt_50kt: np.ndarray | None = None
    p_gt_64kt: np.ndarray | None = None
    uncertainty: np.ndarray | None = None
    lats: np.ndarray
    lons: np.ndarray

    class Config:
        arbitrary_types_allowed = True


class WindFieldPrediction(BaseModel):
    """Wind field output — Yaas 2021 baseline case study (no runnable inference)."""
    wind_fields: list[WindFieldGrid]
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    confidence: float = Field(..., ge=0.0, le=1.0)
    status: str = ""
    explanation: str = ""


class FloodPrediction(BaseModel):
    """Static spatial flood-extent classification (FANI 2019 case study)."""
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
    reason: str | None = None

    class Config:
        arbitrary_types_allowed = True


class RIPrediction(BaseModel):
    """Rapid intensification probability."""
    probability_24h: float = Field(..., ge=0.0, le=1.0)
    risk_level: RiskLevel
    imd_probability: float | None = None
    era5_probability: float | None = None
    satellite_probability: float | None = None
    fusion_probability: float | None = None
    calibrated_probability: float | None = None
    explanation: str | None = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    shap_values: dict[str, float] | None = None
    gradcam_heatmap: np.ndarray | None = None
    status: str = Field(
        "AVAILABLE",
        description="Runtime availability: AVAILABLE, UNAVAILABLE or UNVERIFIED",
    )

    class Config:
        arbitrary_types_allowed = True


class IntensityPrediction(BaseModel):
    """Cyclone intensity forecast."""
    predicted_msw_6h: float | None = Field(None, ge=0.0)
    predicted_msw_12h: float | None = Field(None, ge=0.0)
    predicted_msw_24h: float | None = Field(None, ge=0.0)
    predicted_msw_48h: float | None = Field(None, ge=0.0)
    predicted_category_6h: CycloneCategory | None = None
    predicted_category_12h: CycloneCategory | None = None
    predicted_category_24h: CycloneCategory | None = None
    predicted_category_48h: CycloneCategory | None = None
    uncertainty_kt: float | None = Field(None, ge=0.0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    feature_importance: dict[str, float] = Field(default_factory=dict)
    status: str = "AVAILABLE"
    reason: str | None = None


class RecurvaturePrediction(BaseModel):
    """Recurvature probability forecast."""
    probability: float = Field(..., ge=0.0, le=1.0)
    expected_turning_window: str | None = None  # e.g., "+12h to +24h"
    risk_level: RiskLevel
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    feature_importance: dict[str, float] = Field(default_factory=dict)


class LandslideGrid(BaseModel):
    """Landslide probability/susceptibility grid."""
    probability_grid: np.ndarray
    susceptibility_grid: np.ndarray | None = None
    risk_level_grid: np.ndarray
    lats: np.ndarray
    lons: np.ndarray

    class Config:
        arbitrary_types_allowed = True


class LandslidePrediction(BaseModel):
    """Cyclone-induced landslide static susceptibility (no ML model)."""
    probability_grid: LandslideGrid
    high_risk_regions: list[dict]
    confidence: float = Field(..., ge=0.0, le=1.0)
    model_version: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    status: str = "AVAILABLE"
    reason: str | None = None


class UnifiedForecastState(BaseModel):
    """Complete unified forecast from all models."""
    cyclone: CycloneState
    genesis: GenesisPrediction | None = None
    track: TrackPrediction | None = None
    intensity: IntensityPrediction | None = None
    rapid_intensification: RIPrediction | None = None
    recurvature: RecurvaturePrediction | None = None
    wind: WindFieldPrediction | None = None
    rainfall: RainfallPrediction | None = None
    flood: FloodPrediction | None = None
    landslide: LandslidePrediction | None = None
    uncertainty_summary: dict = Field(default_factory=dict)
    explanations: dict = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    model_versions: dict[str, str] = Field(default_factory=dict)

    # Overall hazard assessment
    overall_hazard_severity: RiskLevel | None = None
    affected_region: dict | None = None
    confidence: float = Field(..., ge=0.0, le=1.0)

    # Integration metadata (Phase 11)
    module_status: dict[str, str] = Field(
        default_factory=dict,
        description="Execution status per module: SUCCESS / FAILED / UNAVAILABLE",
    )
    module_reasons: dict[str, str] = Field(
        default_factory=dict,
        description="Reason per module when status != SUCCESS",
    )
    assessed_hazards: list[str] = Field(
        default_factory=list,
        description="Hazard components that were actually scored into the composite",
    )
    unassessed_hazards: list[str] = Field(
        default_factory=list,
        description="Hazard components skipped because unavailable / static / no grid",
    )

    class Config:
        arbitrary_types_allowed = True
        # UnifiedForecastState is the object the CLI/job persistence layer
        # serializes with model_dump(mode='json'). Prediction grids are numpy
        # arrays; without an encoder the JSON dump raises
        # PydanticSerializationError (demonstrated in Phase 11). Converting to
        # nested lists is lossless.
        json_encoders = {
            np.ndarray: lambda v: v.tolist(),
        }


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
    calibration_artifact: str | None = None
    timestamp: datetime
    git_commit: str | None = None
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


def probability_to_risk_level(prob: float, thresholds: dict[RiskLevel, tuple[float, float]] | None = None) -> RiskLevel:
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
