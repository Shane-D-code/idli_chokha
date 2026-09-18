"""
Data Preprocessing, Cleaning, Feature Engineering and ERA5 Integration Pipeline
for Tropical Cyclone Intensity Prediction.
"""

import os
import re
import gc
import urllib.request
import ssl
import numpy as np
import pandas as pd
import datetime as dt

from src.utils import FEATURE_COLUMNS, msw_to_category


def download_raw_data_if_missing(data_dir: str = "data/raw"):
    """
    Download IMD Best Track and IBTrACS archives if not already present locally.
    """
    os.makedirs(data_dir, exist_ok=True)
    imd_path = os.path.join(data_dir, "IMD_BestTrack_1982_2026.xlsx")
    ibtracs_path = os.path.join(data_dir, "ibtracs_NI.csv")
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    if not os.path.exists(imd_path):
        print(f"Downloading IMD Best Track to {imd_path}...")
        imd_url = "https://rsmcnewdelhi.imd.gov.in/download.php?path=uploads/best-track/78b4b0_Best_Tracks__Data__1982-2026_.xlsx"
        req = urllib.request.Request(imd_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=ctx) as resp, open(imd_path, "wb") as f:
            f.write(resp.read())
        print("Downloaded IMD Best Track.")

    if not os.path.exists(ibtracs_path):
        print(f"Downloading IBTrACS NI to {ibtracs_path}...")
        ibtracs_url = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.NI.list.v04r01.csv"
        req = urllib.request.Request(ibtracs_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, context=ctx) as resp, open(ibtracs_path, "wb") as f:
            f.write(resp.read())
        print("Downloaded IBTrACS NI.")

    return imd_path, ibtracs_path


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Normalize inconsistent Excel sheet column headers across historical IMD records.
    """
    mapping, seen = {}, set()
    for col in df.columns:
        c = str(col).strip().lower()
        if 'serial' in c: new = 'serial_no'
        elif 'basin' in c or 'barbin' in c: new = 'basin'
        elif c == 'name': new = 'name'
        elif 'date' in c: new = 'date'
        elif c == 'dd': new = 'day'
        elif c == 'mm': new = 'month'
        elif c == 'yyyy': new = 'year_col'
        elif 'time' in c: new = 'time_utc'
        elif 'lat' in c: new = 'lat'
        elif 'lon' in c: new = 'lon'
        elif 'ci no' in c or 't. no' in c or 't.no' in c: new = 'ci_no'
        elif 'pressure' in c and 'drop' not in c and 'outermost' not in c: new = 'pressure_hpa'
        elif 'wind' in c: new = 'msw_kt'
        elif 'drop' in c: new = 'pressure_drop'
        elif 'grade' in c: new = 'grade'
        elif 'outermost' in c and 'diameter' not in c and 'size' not in c: new = 'outer_isobar'
        elif 'diameter' in c or 'size' in c: new = 'outer_diameter'
        else: new = str(col).strip()
        if new in seen and new != col:
            new = f"{new}__dup{len(seen)}"
        seen.add(new)
        mapping[col] = new
    return df.rename(columns=mapping)


def find_header_row(path: str, sheet_name: str, max_scan: int = 6):
    """
    Detect non-standard header row offset for misaligned Excel sheets (e.g. 1992, 2019, 2020, 2026).
    """
    raw = pd.read_excel(path, sheet_name=sheet_name, header=None, nrows=max_scan)
    for i in range(len(raw)):
        row_vals = raw.iloc[i].astype(str).str.lower()
        if row_vals.str.contains('lat').any() and row_vals.str.contains('grade|wind', regex=True).any():
            return i
    return None


def get_lag_value(df: pd.DataFrame, value_col: str, hours: float, tolerance_hours: float = 1.5):
    """
    Perform exact temporal as-of merge for historical storm observations to prevent lookahead leakage.
    """
    left = df[['storm_id', 'datetime_final']].copy()
    left['original_index'] = df.index
    left['target_time'] = left['datetime_final'] - pd.Timedelta(hours=hours)
    
    right = df[['storm_id', 'datetime_final', value_col]].copy().rename(
        columns={'datetime_final': 'matched_time', value_col: 'matched_value'}
    )
    left_sorted = left.sort_values(['target_time', 'storm_id'])
    right_sorted = right.sort_values(['matched_time', 'storm_id'])
    
    merged = pd.merge_asof(
        left_sorted, right_sorted,
        left_on='target_time', right_on='matched_time',
        by='storm_id', direction='nearest',
        tolerance=pd.Timedelta(hours=tolerance_hours)
    )
    merged = merged.sort_values('original_index')
    return merged['matched_value'].to_numpy(), pd.to_datetime(merged['matched_time']).to_numpy()


def build_cyclone_history_dataset(imd_path: str) -> pd.DataFrame:
    """
    Process raw multi-sheet IMD Best Track workbook into fully cleaned, lag-engineered v2 dataframe.
    """
    print(f"Reading Excel sheets from {imd_path}...")
    xls = pd.ExcelFile(imd_path)
    all_sheets = pd.read_excel(xls, sheet_name=None)
    
    # Handle known offset sheets
    broken_years = ['1992', '2019', '2020', '2026']
    fixed_sheets = {}
    for yr in broken_years:
        hdr = find_header_row(imd_path, yr)
        if hdr is not None:
            fixed_sheets[yr] = pd.read_excel(imd_path, sheet_name=yr, header=hdr)

    all_sheets_fixed = dict(all_sheets)
    all_sheets_fixed.update(fixed_sheets)

    frames = []
    for sheet_year, df in all_sheets_fixed.items():
        df = normalize_columns(df.copy())
        df['sheet_year'] = int(sheet_year)
        df['serial_no'] = df['serial_no'].ffill()
        frames.append(df)

    combined4 = pd.concat(frames, ignore_index=True, sort=False)
    combined4['storm_id'] = (combined4['sheet_year'].astype(str) + "_" +
                              combined4['basin'].astype(str) + "_" +
                              combined4['serial_no'].astype(str))

    base = combined4[combined4['lat'].notna() & combined4['msw_kt'].notna()].copy()
    base['storm_id'] = np.where(
        base['name'].notna(),
        base['sheet_year'].astype(str) + "_" + base['basin'].astype(str) + "_" + base['name'].astype(str),
        base['sheet_year'].astype(str) + "_" + base['basin'].astype(str) + "_" + base['serial_no'].astype(str)
    )
    base = base.sort_index()

    def parse_raw(val):
        if pd.isna(val):
            return pd.NaT
        if isinstance(val, (pd.Timestamp, dt.datetime, dt.date)):
            return pd.Timestamp(val).normalize()
        s = str(val).strip().replace('.', '-')
        try:
            return pd.to_datetime(s, dayfirst=True)
        except Exception:
            return pd.NaT

    base['date_parsed'] = base['date'].apply(parse_raw)
    corrected = []
    for sid, grp in base.groupby('storm_id', sort=False):
        grp = grp.sort_index()
        prev_date, fixed = None, []
        for val in grp['date_parsed']:
            if pd.isna(val):
                fixed.append(prev_date)
            else:
                if prev_date is not None:
                    delta = (val - prev_date).days
                    if delta < 0 or delta > 3:
                        val = prev_date + pd.Timedelta(days=1)
                fixed.append(val)
                prev_date = val
        grp = grp.copy()
        grp['date_final'] = fixed
        corrected.append(grp)

    base = pd.concat(corrected).sort_index()
    base['date_final'] = base.groupby('storm_id')['date_final'].ffill()

    has_split = base['day'].notna() & base['month'].notna() & base['year_col'].notna()
    base.loc[has_split, 'date_final'] = pd.to_datetime(
        dict(year=base.loc[has_split, 'year_col'].astype(int),
             month=base.loc[has_split, 'month'].astype(int),
             day=base.loc[has_split, 'day'].astype(int))
    )

    base['time_utc_clean'] = pd.to_numeric(base['time_utc'], errors='coerce').astype('Int64').astype(str).str.zfill(4)
    base['datetime_final'] = pd.to_datetime(
        base['date_final'].dt.strftime('%Y-%m-%d') + ' ' +
        base['time_utc_clean'].str[:2] + ':' + base['time_utc_clean'].str[2:],
        errors='coerce'
    )
    base = base[base['datetime_final'].notna()].copy()
    base = base.drop_duplicates(subset=['storm_id', 'datetime_final'], keep='first')
    base['msw_kt'] = pd.to_numeric(base['msw_kt'], errors='coerce')
    base['pressure_hpa'] = pd.to_numeric(base['pressure_hpa'], errors='coerce')
    base = base.sort_values(['storm_id', 'datetime_final']).reset_index(drop=True)

    idx_view = base.set_index('datetime_final')
    feat_frames = []
    for sid, grp in idx_view.groupby('storm_id', sort=False):
        grp = grp.sort_index()
        g = grp.copy()
        for lag_h in [6, 12, 24]:
            g[f'msw_lag{lag_h}h'] = grp['msw_kt'].reindex(grp.index - pd.Timedelta(hours=lag_h), method='nearest', tolerance=pd.Timedelta(hours=2)).values
            g[f'pres_lag{lag_h}h'] = grp['pressure_hpa'].reindex(grp.index - pd.Timedelta(hours=lag_h), method='nearest', tolerance=pd.Timedelta(hours=2)).values
        feat_frames.append(g)
        
    combined7 = pd.concat(feat_frames).reset_index()
    combined7['msw_trend_24h'] = combined7['msw_kt'] - combined7['msw_lag24h']

    for lead_h in [24, 48, 72]:
        tgt = []
        for sid, grp in combined7.groupby('storm_id', sort=False):
            grp = grp.sort_values('datetime_final').set_index('datetime_final')
            t = grp['msw_kt'].reindex(grp.index + pd.Timedelta(hours=lead_h), method='nearest', tolerance=pd.Timedelta(hours=2))
            tgt.append(pd.Series(t.values, index=grp.index))
        combined7[f'msw_target_{lead_h}h'] = pd.concat(tgt).reindex(combined7.set_index('datetime_final').index).values

    # Build v2
    v2 = combined7.copy()
    v2 = v2.sort_values(['storm_id', 'datetime_final']).reset_index(drop=True)
    for col in ['msw_kt', 'pressure_hpa', 'lat', 'lon']:
        v2[col] = pd.to_numeric(v2[col], errors='coerce')

    v2.loc[(v2['pressure_hpa'] < 850) | (v2['pressure_hpa'] > 1100), 'pressure_hpa'] = np.nan

    for h in [6, 12, 24]:
        prev_val, prev_time = get_lag_value(v2, 'msw_kt', h, tolerance_hours=1.5)
        v2[f'msw_prev_{h}h'] = prev_val
        v2[f'msw_prev_time_{h}h'] = prev_time
        v2[f'msw_change_{h}h'] = v2['msw_kt'] - v2[f'msw_prev_{h}h']

        pres_val, pres_time = get_lag_value(v2, 'pressure_hpa', h, tolerance_hours=1.5)
        v2[f'pressure_prev_{h}h'] = pres_val
        v2[f'pressure_prev_time_{h}h'] = pres_time
        v2[f'pressure_change_{h}h'] = v2['pressure_hpa'] - v2[f'pressure_prev_{h}h']

    v2['msw_acceleration'] = v2['msw_kt'] - 2 * v2['msw_prev_6h'] + v2['msw_prev_12h']

    prev_lat, prev_time = get_lag_value(v2, 'lat', 6, tolerance_hours=1.5)
    prev_lon, _ = get_lag_value(v2, 'lon', 6, tolerance_hours=1.5)
    v2['lat_change_6h'] = v2['lat'] - prev_lat
    v2['lon_change_6h'] = v2['lon'] - prev_lon

    prev_time = pd.to_datetime(prev_time)
    actual_hours = (v2['datetime_final'] - prev_time) / pd.Timedelta(hours=1)
    mean_lat = (v2['lat'] + prev_lat) / 2
    north_nm = (v2['lat'] - prev_lat) * 60
    east_nm = (v2['lon'] - prev_lon) * 60 * np.cos(np.radians(mean_lat))
    distance_nm = np.sqrt(north_nm**2 + east_nm**2)
    v2['movement_speed_kt'] = np.where(actual_hours > 0, distance_nm / actual_hours, np.nan)

    # Derived extreme value cleanup
    v2.loc[v2['msw_change_6h'].abs() > 50, 'msw_change_6h'] = np.nan
    v2.loc[v2['msw_acceleration'].abs() > 50, 'msw_acceleration'] = np.nan
    v2.loc[v2['pressure_change_6h'].abs() > 40, 'pressure_change_6h'] = np.nan
    v2.loc[v2['movement_speed_kt'] > 60, 'movement_speed_kt'] = np.nan

    return v2


def load_or_process_clean_model_dataset(csv_path: str = "data/processed/clean_model_data.csv") -> pd.DataFrame:
    """
    Load the clean model dataset from disk, or reconstruct it if missing.
    """
    if os.path.exists(csv_path):
        print(f"Loading modeling dataset from {csv_path}...")
        df = pd.read_csv(csv_path)
        df['datetime_final'] = pd.to_datetime(df['datetime_final'])
        if 'target_category_24h' not in df.columns:
            df['target_category_24h'] = df['msw_target_24h'].apply(msw_to_category)
        return df
        
    parquet_path = csv_path.replace(".csv", ".parquet")
    if os.path.exists(parquet_path):
        print(f"Loading modeling dataset from {parquet_path}...")
        df = pd.read_parquet(parquet_path)
        df['datetime_final'] = pd.to_datetime(df['datetime_final'])
        if 'target_category_24h' not in df.columns:
            df['target_category_24h'] = df['msw_target_24h'].apply(msw_to_category)
        return df
        
    raise FileNotFoundError(f"Clean model dataset not found at {csv_path} or {parquet_path}. Please run dataset reconstruction.")
