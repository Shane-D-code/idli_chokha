"""Unified Hazard Risk Engine for TOOFAN.

Combines all model outputs into a unified hazard assessment.
"""

from __future__ import annotations

import warnings
from typing import Any, Optional
from dataclasses import dataclass

import numpy as np

from src.core.schema import (
    CycloneState, GenesisPrediction, TrackPrediction, IntensityPrediction,
    RIPrediction, RecurvaturePrediction, WindFieldPrediction,
    RainfallPrediction, FloodPrediction, LandslidePrediction,
    UnifiedForecastState, RiskLevel
)


@dataclass
class HazardComponent:
    """Individual hazard component with weight."""
    name: str
    risk_level: RiskLevel
    probability: float
    confidence: float
    weight: float
    affected_area_km2: float = 0.0


class HazardRiskEngine:
    """Unified hazard risk engine.

    Does NOT simply average probabilities. Instead:
    1. Evaluates each hazard component independently
    2. Applies domain-specific combination rules
    3. Accounts for spatial overlap of hazards
    4. Produces overall severity with uncertainty
    """

    # Default weights for hazard components
    DEFAULT_WEIGHTS = {
        'wind': 0.25,
        'rainfall': 0.20,
        'flood': 0.20,
        'landslide': 0.10,
        'storm_surge': 0.10,
        'ri': 0.05,
        'intensity': 0.10,
    }

    def __init__(self, config: dict):
        self.config = config
        self.weights = config.get('weights', self.DEFAULT_WEIGHTS)
        self.risk_thresholds = config.get('risk_thresholds', {
            RiskLevel.NONE: (0.0, 0.15),
            RiskLevel.LOW: (0.15, 0.35),
            RiskLevel.MODERATE: (0.35, 0.60),
            RiskLevel.HIGH: (0.60, 0.80),
            RiskLevel.EXTREME: (0.80, 1.0),
        })

    def compute(self,
                cyclone_state: CycloneState,
                genesis: Optional[GenesisPrediction] = None,
                track: Optional[TrackPrediction] = None,
                intensity: Optional[IntensityPrediction] = None,
                ri: Optional[RIPrediction] = None,
                recurvature: Optional[RecurvaturePrediction] = None,
                wind: Optional[WindFieldPrediction] = None,
                rainfall: Optional[RainfallPrediction] = None,
                flood: Optional[FloodPrediction] = None,
                landslide: Optional[LandslidePrediction] = None) -> UnifiedForecastState:
        """Compute unified hazard assessment."""

        components = []

        # Wind hazard
        if wind:
            wind_hazard = self._assess_wind_hazard(wind, track, intensity)
            components.append(wind_hazard)

        # Rainfall hazard
        if rainfall:
            rain_hazard = self._assess_rainfall_hazard(rainfall)
            components.append(rain_hazard)

        # Flood hazard
        if flood:
            flood_hazard = self._assess_flood_hazard(flood)
            components.append(flood_hazard)

        # Landslide hazard
        if landslide:
            slide_hazard = self._assess_landslide_hazard(landslide)
            components.append(slide_hazard)

        # RI hazard (rapid intensification increases all hazards)
        if ri:
            ri_hazard = self._assess_ri_hazard(ri, intensity)
            components.append(ri_hazard)

        # Intensity hazard
        if intensity:
            intensity_hazard = self._assess_intensity_hazard(intensity)
            components.append(intensity_hazard)

        # Combine hazards
        overall_severity, overall_confidence = self._combine_hazards(components)

        # Determine affected region
        affected_region = self._compute_affected_region(components, track, cyclone_state)

        # Build unified state
        unified = UnifiedForecastState(
            cyclone=cyclone_state,
            genesis=genesis,
            track=track,
            intensity=intensity,
            rapid_intensification=ri,
            recurvature=recurvature,
            wind=wind,
            rainfall=rainfall,
            flood=flood,
            landslide=landslide,
            overall_hazard_severity=overall_severity,
            affected_region=affected_region,
            confidence=overall_confidence,
            model_versions={},  # Filled by orchestrator
            uncertainty_summary=self._compute_uncertainty_summary(components),
            explanations=self._generate_explanations(components, cyclone_state)
        )

        return unified

    def _assess_wind_hazard(self, wind: WindFieldPrediction,
                             track: Optional[TrackPrediction],
                             intensity: Optional[IntensityPrediction]) -> HazardComponent:
        """Assess wind hazard from wind field prediction."""
        # Use maximum wind probability across grid
        max_prob = 0.0
        for wf in wind.wind_fields:
            if wf.p_gt_64kt is not None:
                max_prob = max(max_prob, float(np.nanmax(wf.p_gt_64kt)))
            elif wf.p_gt_50kt is not None:
                max_prob = max(max_prob, float(np.nanmax(wf.p_gt_50kt)))
            elif wf.p_gt_34kt is not None:
                max_prob = max(max_prob, float(np.nanmax(wf.p_gt_34kt)))

        # Boost by intensity forecast if available
        if intensity and intensity.predicted_msw_24h:
            if intensity.predicted_msw_24h > 90:  # VSCS+
                max_prob = min(1.0, max_prob * 1.3)
            elif intensity.predicted_msw_24h > 64:  # SCS+
                max_prob = min(1.0, max_prob * 1.15)

        risk_level = self._prob_to_risk(max_prob)
        affected_area = self._estimate_wind_affected_area(wind)

        return HazardComponent(
            name='wind',
            risk_level=risk_level,
            probability=max_prob,
            confidence=wind.confidence,
            weight=self.weights.get('wind', 0.25),
            affected_area_km2=affected_area
        )

    def _assess_rainfall_hazard(self, rainfall: RainfallPrediction) -> HazardComponent:
        """Assess rainfall hazard."""
        max_prob = 0.0
        for horizon_name in ['rainfall_3h', 'rainfall_6h', 'rainfall_12h', 'rainfall_24h']:
            grid = getattr(rainfall, horizon_name, None)
            if grid and grid.heavy_rain_probability is not None:
                max_prob = max(max_prob, float(np.nanmax(grid.heavy_rain_probability)))
            if grid and grid.extreme_rain_probability is not None:
                max_prob = max(max_prob, float(np.nanmax(grid.extreme_rain_probability)) * 1.5)

        risk_level = self._prob_to_risk(max_prob)
        affected_area = self._estimate_rain_affected_area(rainfall)

        return HazardComponent(
            name='rainfall',
            risk_level=risk_level,
            probability=max_prob,
            confidence=rainfall.confidence,
            weight=self.weights.get('rainfall', 0.20),
            affected_area_km2=affected_area
        )

    def _assess_flood_hazard(self, flood: FloodPrediction) -> HazardComponent:
        """Assess flood hazard."""
        if flood.status == "UNAVAILABLE":
            return HazardComponent(
                name='flood',
                risk_level=RiskLevel.NONE,
                probability=0.0,
                confidence=0.0,
                weight=self.weights.get('flood', 0.20)
            )

        max_prob = float(np.nanmax(flood.probability_grid)) if flood.probability_grid.size > 0 else 0.0
        risk_level = self._prob_to_risk(max_prob)
        affected_area = flood.affected_area_km2

        return HazardComponent(
            name='flood',
            risk_level=risk_level,
            probability=max_prob,
            confidence=flood.confidence,
            weight=self.weights.get('flood', 0.20),
            affected_area_km2=affected_area
        )

    def _assess_landslide_hazard(self, landslide: LandslidePrediction) -> HazardComponent:
        """Assess landslide hazard."""
        if landslide.status == "UNAVAILABLE":
            return HazardComponent(
                name='landslide',
                risk_level=RiskLevel.NONE,
                probability=0.0,
                confidence=0.0,
                weight=self.weights.get('landslide', 0.10)
            )

        grid = landslide.probability_grid
        max_prob = float(np.nanmax(grid.probability_grid)) if grid.probability_grid.size > 0 else 0.0
        risk_level = self._prob_to_risk(max_prob)
        affected_area = self._estimate_slide_affected_area(grid)

        return HazardComponent(
            name='landslide',
            risk_level=risk_level,
            probability=max_prob,
            confidence=landslide.confidence,
            weight=self.weights.get('landslide', 0.10),
            affected_area_km2=affected_area
        )

    def _assess_ri_hazard(self, ri: RIPrediction,
                           intensity: Optional[IntensityPrediction]) -> HazardComponent:
        """Assess RI hazard (amplifies other hazards)."""
        prob = ri.calibrated_probability or ri.probability_24h
        risk_level = self._prob_to_risk(prob)

        return HazardComponent(
            name='ri',
            risk_level=risk_level,
            probability=prob,
            confidence=ri.confidence,
            weight=self.weights.get('ri', 0.05),
            affected_area_km2=0.0  # RI itself doesn't have area, amplifies others
        )

    def _assess_intensity_hazard(self, intensity: IntensityPrediction) -> HazardComponent:
        """Assess intensity hazard."""
        # Use 24h forecast category
        if intensity.predicted_category_24h:
            category_risk = {
                'D': 0.05, 'DD': 0.15, 'CS': 0.35,
                'SCS': 0.55, 'VSCS': 0.75, 'ESCS': 0.90, 'SUCS': 0.98
            }
            prob = category_risk.get(intensity.predicted_category_24h.value, 0.0)
        else:
            prob = 0.0

        risk_level = self._prob_to_risk(prob)

        return HazardComponent(
            name='intensity',
            risk_level=risk_level,
            probability=prob,
            confidence=intensity.confidence,
            weight=self.weights.get('intensity', 0.10),
            affected_area_km2=0.0
        )

    def _prob_to_risk(self, prob: float) -> RiskLevel:
        """Convert probability to risk level."""
        for level, (low, high) in self.risk_thresholds.items():
            if low <= prob < high:
                return level
        return RiskLevel.EXTREME if prob >= 1.0 else RiskLevel.NONE

    def _combine_hazards(self, components: list[HazardComponent]) -> tuple[RiskLevel, float]:
        """Combine hazard components into overall severity."""
        if not components:
            return RiskLevel.NONE, 0.0

        # Weighted combination of probabilities
        total_weight = sum(c.weight for c in components)
        if total_weight == 0:
            return RiskLevel.NONE, 0.0

        weighted_prob = sum(c.probability * c.weight for c in components) / total_weight
        weighted_conf = sum(c.confidence * c.weight for c in components) / total_weight

        # Apply spatial overlap adjustment
        # If multiple hazards affect same area, risk increases
        total_area = sum(c.affected_area_km2 for c in components)
        if total_area > 0:
            # Simple overlap factor - would need actual spatial analysis for precision
            overlap_factor = 1.0 + min(0.3, len(components) * 0.05)
            weighted_prob = min(1.0, weighted_prob * overlap_factor)

        overall_risk = self._prob_to_risk(weighted_prob)
        return overall_risk, weighted_conf

    def _compute_affected_region(self, components: list[HazardComponent],
                                  track: Optional[TrackPrediction],
                                  cyclone_state: CycloneState) -> dict:
        """Compute overall affected region."""
        region = {
            'center_lat': cyclone_state.latitude,
            'center_lon': cyclone_state.longitude,
            'radius_km': 300,  # Default
            'hazard_zones': {}
        }

        # Expand region based on track forecast
        if track and track.latitudes:
            lats = track.latitudes
            lons = track.longitudes
            region['track_bounds'] = {
                'min_lat': float(np.min(lats)),
                'max_lat': float(np.max(lats)),
                'min_lon': float(np.min(lons)),
                'max_lon': float(np.max(lons)),
            }
            # Expand radius to cover track
            region['radius_km'] = max(region['radius_km'],
                                     self._track_spread_km(lats, lons))

        # Add hazard-specific zones
        for comp in components:
            if comp.affected_area_km2 > 0:
                region['hazard_zones'][comp.name] = {
                    'risk_level': comp.risk_level.value,
                    'area_km2': comp.affected_area_km2,
                    'probability': comp.probability
                }

        return region

    def _track_spread_km(self, lats: list[float], lons: list[float]) -> float:
        """Estimate track spread in km."""
        from src.core.schema import _hav_km_np
        if len(lats) < 2:
            return 300
        # Distance from first to last point
        return _hav_km_np(lats[0], lons[0], lats[-1], lons[-1]) + 200

    def _estimate_wind_affected_area(self, wind: WindFieldPrediction) -> float:
        """Estimate area affected by damaging winds."""
        area = 0.0
        for wf in wind.wind_fields:
            if wf.p_gt_34kt is not None:
                # Count grid cells with P > 0.5
                frac = np.sum(wf.p_gt_34kt > 0.5) / wf.p_gt_34kt.size
                # Approximate grid cell area
                cell_area = 100  # km² per cell (10km resolution)
                area += frac * wf.p_gt_34kt.size * cell_area
        return area

    def _estimate_rain_affected_area(self, rainfall: RainfallPrediction) -> float:
        """Estimate area affected by heavy rainfall."""
        area = 0.0
        for horizon_name in ['rainfall_3h', 'rainfall_6h', 'rainfall_12h', 'rainfall_24h']:
            grid = getattr(rainfall, horizon_name, None)
            if grid and grid.heavy_rain_probability is not None:
                frac = np.sum(grid.heavy_rain_probability > 0.5) / grid.heavy_rain_probability.size
                cell_area = 100
                area += frac * grid.heavy_rain_probability.size * cell_area
        return area

    def _estimate_slide_affected_area(self, grid: LandslidePrediction) -> float:
        """Estimate area affected by landslides."""
        if grid.probability_grid.size == 0:
            return 0.0
        frac = np.sum(grid.probability_grid > 0.5) / grid.probability_grid.size
        cell_area = 100
        return frac * grid.probability_grid.size * cell_area

    def _compute_uncertainty_summary(self, components: list[HazardComponent]) -> dict:
        """Compute uncertainty summary."""
        return {
            'components': {
                c.name: {
                    'confidence': c.confidence,
                    'probability': c.probability,
                    'risk_level': c.risk_level.value
                }
                for c in components
            },
            'overall_confidence': float(np.mean([c.confidence for c in components])) if components else 0.0,
            'min_confidence': float(np.min([c.confidence for c in components])) if components else 0.0,
            'max_confidence': float(np.max([c.confidence for c in components])) if components else 0.0,
        }

    def _generate_explanations(self, components: list[HazardComponent],
                                cyclone_state: CycloneState) -> dict:
        """Generate human-readable explanations."""
        explanations = {}

        for comp in components:
            if comp.name == 'wind':
                explanations['wind'] = (
                    f"Maximum damaging wind probability: {comp.probability:.1%}. "
                    f"Risk level: {comp.risk_level.value}."
                )
            elif comp.name == 'rainfall':
                explanations['rainfall'] = (
                    f"Maximum heavy rainfall probability: {comp.probability:.1%}. "
                    f"Risk level: {comp.risk_level.value}."
                )
            elif comp.name == 'flood':
                explanations['flood'] = (
                    f"Flood probability: {comp.probability:.1%}. "
                    f"Affected area: {comp.affected_area_km2:.0f} km². "
                    f"Risk level: {comp.risk_level.value}."
                )
            elif comp.name == 'landslide':
                explanations['landslide'] = (
                    f"Landslide probability: {comp.probability:.1%}. "
                    f"Affected area: {comp.affected_area_km2:.0f} km². "
                    f"Risk level: {comp.risk_level.value}."
                )
            elif comp.name == 'ri':
                explanations['ri'] = (
                    f"Rapid intensification probability: {comp.probability:.1%}. "
                    f"Risk level: {comp.risk_level.value}. "
                    f"This amplifies all other hazards."
                )
            elif comp.name == 'intensity':
                explanations['intensity'] = (
                    f"Predicted intensity category: {comp.risk_level.value} equivalent. "
                    f"Probability: {comp.probability:.1%}."
                )

        # Overall explanation
        if components:
            max_risk = max(c.risk_level for c in components)
            main_hazards = [c.name for c in components if c.risk_level == max_risk]
            explanations['overall'] = (
                f"Overall hazard severity: {max_risk.value}. "
                f"Primary hazards: {', '.join(main_hazards)}. "
                f"Cyclone {cyclone_state.storm_id} at "
                f"{cyclone_state.latitude:.1f}°N, {cyclone_state.longitude:.1f}°E "
                f"with {cyclone_state.max_wind_kt or 'unknown'} kt winds."
            )

        return explanations