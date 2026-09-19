import type { DataSource, SatelliteObservation, SatelliteBand } from '../../types/satellite'
import { VALID_BASE_ISO } from './cyclone'

/** Geographic frame displayed by every simulated band. The storm centre is
 *  read from demoCyclone.position at render time — never hardcoded here. */
const BAY_OF_BENGAL_BOUNDS = {
  north: 21,
  south: 7,
  east: 95,
  west: 78,
}

export const demoSatellite: SatelliteObservation[] = [
  {
    band: 'ir',
    label: 'Thermal IR',
    channel: '10.4 µm IR',
    source: 'INSAT-3D / INSAT-3DR',
    capturedAt: VALID_BASE_ISO,
    status: 'simulated',
    seed: 41,
    notes: 'Cloud-top brightness temperature · 120°E–78°E · ±0 field, not a live observation',
    bounds: BAY_OF_BENGAL_BOUNDS,
    temperatureRange: { min: -80, max: 35 },
  },
  {
    band: 'visible',
    label: 'Visible',
    channel: '0.64 µm VIS',
    source: 'INSAT-3D / INSAT-3DR',
    capturedAt: VALID_BASE_ISO,
    status: 'simulated',
    seed: 92,
    notes: 'Day-lit reflectance · 0.64 µm · procedural cloud bands',
    bounds: BAY_OF_BENGAL_BOUNDS,
  },
  {
    band: 'wv',
    label: 'Water Vapor',
    channel: '6.2 µm WV',
    source: 'INSAT-3D / INSAT-3DR',
    capturedAt: VALID_BASE_ISO,
    status: 'simulated',
    seed: 17,
    notes: 'Mid/upper tropospheric humidity · 6.2 µm · dry slot west of centre',
    bounds: BAY_OF_BENGAL_BOUNDS,
  },
  {
    band: 'radar',
    label: 'Radar',
    channel: 'C-band reflectivity',
    source: 'DWR · Visakhapatnam',
    capturedAt: VALID_BASE_ISO,
    status: 'simulated',
    seed: 66,
    notes: 'Composite reflectivity (dBZ) · eyewall & feeder bands',
    bounds: BAY_OF_BENGAL_BOUNDS,
  },
]

export const demoSources: DataSource[] = [
  { id: 'insat', name: 'INSAT-3DR', provides: 'Satellite imagery · IR / visible / water-vapor', status: 'demo', detail: 'Geostationary over the Indian Ocean sector' },
  { id: 'era5', name: 'ERA5 / ERA5-Land', provides: 'Atmospheric & oceanic environmental fields', status: 'demo', detail: 'Reanalysis aggregates for the storm environment' },
  { id: 'imd', name: 'IMD', provides: 'Best-track validation · cyclone bulletins', status: 'demo', detail: 'Reference intensity estimates for calibration' },
  { id: 'nwp', name: 'NWP', provides: 'Ensemble track & intensity guidance', status: 'demo', detail: 'Multi-model forecast ensemble' },
  { id: 'imerg', name: 'GPM IMERG', provides: 'Precipitation estimates', status: 'demo', detail: 'Half-hourly rain-rate fields' },
  { id: 'ibtracs', name: 'IBTrACS', provides: 'Historical cyclone tracks', status: 'demo', detail: 'Training data for trajectory models' },
  { id: 'gsi', name: 'ISRO GSI', provides: 'Geology & slope data for landslide assessment', status: 'unavailable', detail: 'Contact point not configured' },
  { id: 'gis', name: 'District GIS', provides: 'Administrative boundaries · census attributes', status: 'demo', detail: 'Census 2011 boundaries (offline bundle)' },
]

export { VALID_BASE_ISO }
export type { SatelliteBand }