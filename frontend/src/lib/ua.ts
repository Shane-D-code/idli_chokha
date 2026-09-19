import type { IntensityCategory } from '../types/cyclone'

/**
 * SINGLE SOURCE OF TRUTH for North Indian Ocean intensity classification.
 * Every component (globe, map, timeline, charts, legends, cards) derives its
 * category label + colour from these two functions so they can never drift.
 */

const KNOTS_TO_KMH = 1.852

export function ktToKmh(kt: number): number {
  return kt * KNOTS_TO_KMH
}

export function getCycloneCategory(windKt: number): IntensityCategory {
  if (windKt >= 120) return 'sucs'
  if (windKt >= 90) return 'escs'
  if (windKt >= 64) return 'vscs'
  if (windKt >= 48) return 'scs'
  if (windKt >= 34) return 'cs'
  if (windKt >= 28) return 'dd'
  if (windKt >= 17) return 'd'
  return 'low'
}

/** Category → text label. */
export function getCycloneLabel(windKt: number): string {
  return CATEGORY_TEXT[getCycloneCategory(windKt)]
}

const CATEGORY_TEXT: Record<IntensityCategory, string> = {
  low: 'Low Pressure Area',
  d: 'Depression',
  dd: 'Deep Depression',
  cs: 'Cyclonic Storm',
  scs: 'Severe Cyclonic Storm',
  vscs: 'Very Severe Cyclonic Storm',
  escs: 'Extremely Severe Cyclonic Storm',
  sucs: 'Super Cyclonic Storm',
}

export function getCycloneAbbr(windKt: number): string {
  return CATEGORY_ABBR[getCycloneCategory(windKt)]
}

const CATEGORY_ABBR: Record<IntensityCategory, string> = {
  low: 'LPA',
  d: 'D',
  dd: 'DD',
  cs: 'CS',
  scs: 'SCS',
  vscs: 'VSCS',
  escs: 'ESCS',
  sucs: 'SuCS',
}

/** Category → semantic colour (light theme). */
export function getIntensityColor(windKt: number): string {
  return CATEGORY_COLORS[getCycloneCategory(windKt)]
}

/** Colour for an intensity value that may be missing — neutral for NULL. */
export function intensityColorOf(kt: number | null | undefined): string {
  if (kt == null || !Number.isFinite(kt)) return '#8fa3b5'
  return getIntensityColor(kt)
}

const CATEGORY_COLORS: Record<IntensityCategory, string> = {
  low: '#9db4c6',
  d: '#10afc4',
  dd: '#0d9db8',
  cs: '#f2a93b',
  scs: '#e8892f',
  vscs: '#e2603c',
  escs: '#e84c4c',
  sucs: '#b32020',
}

/** Category → soft background tint for chips/legends. */
export function getIntensityTint(windKt: number): string {
  return CATEGORY_TINTS[getCycloneCategory(windKt)]
}

const CATEGORY_TINTS: Record<IntensityCategory, string> = {
  low: '#e6eef4',
  d: '#d9f0f8',
  dd: '#cbeaf5',
  cs: '#fcebd2',
  scs: '#fbe3c8',
  vscs: '#f8d3c6',
  escs: '#fbdfdf',
  sucs: '#f3c7c7',
}

/** Ordered list of categories with ranges — used for the intensity legend. */
export function intensityLegend(): { category: IntensityCategory; label: string; abbr: string; range: string; color: string }[] {
  const order: IntensityCategory[] = ['d', 'dd', 'cs', 'scs', 'vscs', 'escs', 'sucs']
  const ranges: Record<IntensityCategory, string> = {
    low: '< 17 kt',
    d: '17 – 27 kt',
    dd: '28 – 33 kt',
    cs: '34 – 47 kt',
    scs: '48 – 63 kt',
    vscs: '64 – 89 kt',
    escs: '90 – 119 kt',
    sucs: '≥ 120 kt',
  }
  return order.map((c) => ({ category: c, label: CATEGORY_TEXT[c], abbr: CATEGORY_ABBR[c], range: ranges[c], color: CATEGORY_COLORS[c] }))
}