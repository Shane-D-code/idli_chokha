import type { RiskLevel } from '../../types/common'
import type { SearchableLocation } from '../../types/district'

export interface SiteSeed extends SearchableLocation {
  /** Text used for the "what this means" area of the detail panel. */
  shortName: string
  /** Static demo risk band; geometry is computed at service time. */
  kind: 'district' | 'city' | 'town' | 'port'
}

const S = (id: string, name: string, shortName: string, state: string, lat: number, lon: number, riskLevel: RiskLevel, kind: SiteSeed['kind']): SiteSeed => ({
  id,
  name,
  shortName,
  type: kind,
  kind,
  state,
  position: { lat, lon },
  riskLevel,
})

/**
 * Locations selectable in "CHECK YOUR LOCATION". Each carries a demo risk band;
 * distances and approach timing are derived from the live cyclone state.
 */
export const demoSites: SiteSeed[] = [
  S('balasore', 'Balasore', 'Balasore', 'Odisha', 21.494, 86.932, 'low', 'district'),
  S('puri', 'Puri', 'Puri', 'Odisha', 19.813, 85.831, 'moderate', 'district'),
  S('bhubaneswar', 'Bhubaneswar', 'Bhubaneswar', 'Odisha', 20.296, 85.824, 'low', 'city'),
  S('paradip', 'Paradip', 'Paradip', 'Odisha', 20.268, 86.612, 'high', 'port'),
  S('dhamra', 'Dhamra', 'Dhamra', 'Odisha', 20.884, 86.994, 'high', 'port'),
  S('digha', 'Digha', 'Digha', 'West Bengal', 21.626, 87.507, 'moderate', 'town'),
  S('haldia', 'Haldia', 'Haldia', 'West Bengal', 22.061, 88.1, 'moderate', 'port'),
  S('kolkata', 'Kolkata', 'Kolkata', 'West Bengal', 22.573, 88.363, 'low', 'city'),
  S('south24', 'South 24 Parganas', 'S-24 Parganas', 'West Bengal', 21.95, 88.4, 'moderate', 'district'),
  S('north24', 'North 24 Parganas', 'N-24 Parganas', 'West Bengal', 22.82, 88.7, 'moderate', 'district'),
  S('srikakulam', 'Srikakulam', 'Srikakulam', 'Andhra Pradesh', 18.295, 83.898, 'moderate', 'district'),
  S('vizianagaram', 'Vizianagaram', 'Vizianagaram', 'Andhra Pradesh', 18.107, 83.395, 'low', 'district'),
  S('visakhapatnam', 'Visakhapatnam', 'Visakhapatnam', 'Andhra Pradesh', 17.686, 82.82, 'moderate', 'city'),
  S('kakinada', 'Kakinada', 'Kakinada', 'Andhra Pradesh', 16.989, 82.247, 'low', 'town'),
  S('gopalpur', 'Gopalpur', 'Gopalpur', 'Odisha', 19.258, 84.903, 'low', 'port'),
  S('chennai', 'Chennai', 'Chennai', 'Tamil Nadu', 13.083, 80.27, 'low', 'city'),
  S('portblair', 'Port Blair', 'Port Blair', 'Andaman & Nicobar', 11.623, 92.734, 'high', 'city'),
  S('nma', 'North & Middle Andaman', 'N&M Andaman', 'Andaman & Nicobar', 12.5, 92.9, 'moderate', 'district'),
  S('nicobar', 'Nicobar', 'Nicobar', 'Andaman & Nicobar', 7.3, 93.7, 'moderate', 'district'),
  S('gajapati', 'Gajapati', 'Gajapati', 'Odisha', 18.46, 84.2, 'low', 'district'),
  S('keonjhar', 'Keonjhar', 'Keonjhar', 'Odisha', 21.69, 85.78, 'low', 'district'),
  S('mayurbhanj', 'Mayurbhanj', 'Mayurbhanj', 'Odisha', 21.93, 86.38, 'low', 'district'),
  S('jajapur', 'Jajapur', 'Jajapur', 'Odisha', 20.84, 86.32, 'moderate', 'district'),
  S('kendrapara', 'Kendrapara', 'Kendrapara', 'Odisha', 20.53, 86.43, 'moderate', 'district'),
  S('jagatsinghpur', 'Jagatsinghpur', 'Jagatsinghpur', 'Odisha', 20.26, 86.17, 'high', 'district'),
  S('cuttack', 'Cuttack', 'Cuttack', 'Odisha', 20.462, 85.879, 'low', 'city'),
  S('khordha', 'Khordha', 'Khordha', 'Odisha', 20.16, 85.66, 'low', 'district'),
  S('ganjam', 'Ganjam', 'Ganjam', 'Odisha', 19.38, 85.05, 'low', 'district'),
  S('eastgodavari', 'East Godavari', 'E-Godavari', 'Andhra Pradesh', 17.2, 82.2, 'low', 'district'),
  S('westgodavari', 'West Godavari', 'W-Godavari', 'Andhra Pradesh', 16.84, 81.24, 'low', 'district'),
  S('krishna', 'Krishna', 'Krishna', 'Andhra Pradesh', 16.35, 80.9, 'low', 'district'),
  S('nagapattinam', 'Nagapattinam', 'Nagapattinam', 'Tamil Nadu', 10.76, 79.84, 'low', 'district'),
  S('mumbai', 'Mumbai', 'Mumbai', 'Maharashtra', 19.076, 72.877, 'low', 'city'),
  S('kochi', 'Kochi', 'Kochi', 'Kerala', 9.931, 76.267, 'low', 'city'),
]

export const demoQuickSelectIds = [
  'puri',
  'bhubaneswar',
  'paradip',
  'dhamra',
  'balasore',
  'digha',
  'haldia',
  'kolkata',
]