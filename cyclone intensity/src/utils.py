"""
Utility functions and meteorological domain mappings for Tropical Cyclone Intensity Prediction.
"""

import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.metrics import confusion_matrix

# Official IMD Intensity Classification Ordinal Hierarchy
GRADE_ORDER = [
    'D',     # Depression (17-27 kt)
    'DD',    # Deep Depression (28-33 kt)
    'CS',    # Cyclonic Storm (34-47 kt)
    'SCS',   # Severe Cyclonic Storm (48-63 kt)
    'VSCS',  # Very Severe Cyclonic Storm (64-89 kt)
    'ESCS',  # Extremely Severe Cyclonic Storm (90-119 kt)
    'SUCS'   # Super Cyclonic Storm (>= 120 kt)
]

GRADE_TO_IDX = {grade: i for i, grade in enumerate(GRADE_ORDER)}
IDX_TO_GRADE = {i: grade for i, grade in enumerate(GRADE_ORDER)}

GRADE_DESCRIPTIONS = {
    'D': 'Depression (17–27 kt / 31–49 km/h)',
    'DD': 'Deep Depression (28–33 kt / 50–61 km/h)',
    'CS': 'Cyclonic Storm (34–47 kt / 62–88 km/h)',
    'SCS': 'Severe Cyclonic Storm (48–63 kt / 89–117 km/h)',
    'VSCS': 'Very Severe Cyclonic Storm (64–89 kt / 118–166 km/h)',
    'ESCS': 'Extremely Severe Cyclonic Storm (90–119 kt / 167–221 km/h)',
    'SUCS': 'Super Cyclonic Storm (≥ 120 kt / ≥ 222 km/h)'
}

# 30 standard predictor features (13 cyclone history/dynamics + 17 ERA5 environmental)
FEATURE_COLUMNS = [
    # Cyclone Current State & Dynamics (13)
    'msw_kt',
    'pressure_hpa',
    'lat',
    'lon',
    'msw_change_6h',
    'msw_change_12h',
    'msw_change_24h',
    'pressure_change_6h',
    'pressure_change_12h',
    'pressure_change_24h',
    'lat_change_6h',
    'lon_change_6h',
    'movement_speed_kt',
    
    # ERA5 Environmental Features (17)
    'era5_sst',
    'era5_t850',
    'era5_t700',
    'era5_t500',
    'era5_t200',
    'era5_r850',
    'era5_r700',
    'era5_r500',
    'era5_r200',
    'era5_u850',
    'era5_u700',
    'era5_u500',
    'era5_u200',
    'era5_v850',
    'era5_v700',
    'era5_v500',
    'era5_v200'
]


def msw_to_category(msw: float) -> str:
    """
    Convert Maximum Sustained Wind speed (MSW in knots) into India Meteorological Department (IMD) grade.
    
    Parameters
    ----------
    msw : float or int
        Maximum sustained wind speed in knots.
        
    Returns
    -------
    str
        IMD grade label ('D', 'DD', 'CS', 'SCS', 'VSCS', 'ESCS', 'SUCS').
    """
    if pd.isna(msw):
        return None
    
    msw_val = float(msw)
    if msw_val < 28.0:
        return 'D'
    elif msw_val <= 33.0:
        return 'DD'
    elif msw_val <= 47.0:
        return 'CS'
    elif msw_val <= 63.0:
        return 'SCS'
    elif msw_val <= 89.0:
        return 'VSCS'
    elif msw_val <= 119.0:
        return 'ESCS'
    else:
        return 'SUCS'


def msw_to_category_vectorized(msw_arr) -> np.ndarray:
    """
    Vectorized conversion of MSW values (knots) into IMD categories.
    """
    msw_arr = np.asarray(msw_arr, dtype=float)
    categories = np.empty(len(msw_arr), dtype=object)
    
    for i, val in enumerate(msw_arr):
        categories[i] = msw_to_category(val)
        
    return categories


def msw_to_ordinal_index(msw_arr) -> np.ndarray:
    """
    Convert MSW values directly to ordinal grade index (0 to 6).
    """
    categories = msw_to_category_vectorized(msw_arr)
    indices = np.array([GRADE_TO_IDX.get(c, -1) for c in categories])
    return indices


def within_1_category_score(y_true_grades, y_pred_grades) -> float:
    """
    Calculate within-1-category accuracy for ordinal cyclone classification.
    
    Parameters
    ----------
    y_true_grades : array-like
        True IMD categories (or integer grade indices).
    y_pred_grades : array-like
        Predicted IMD categories (or integer grade indices).
        
    Returns
    -------
    float
        Within-1-category accuracy percentage (0.0 to 100.0).
    """
    if len(y_true_grades) == 0:
        return 0.0
        
    if isinstance(y_true_grades[0], str):
        true_indices = np.array([GRADE_TO_IDX.get(g, -1) for g in y_true_grades])
    else:
        true_indices = np.asarray(y_true_grades)
        
    if isinstance(y_pred_grades[0], str):
        pred_indices = np.array([GRADE_TO_IDX.get(g, -1) for g in y_pred_grades])
    else:
        pred_indices = np.asarray(y_pred_grades)
        
    diff = np.abs(true_indices - pred_indices)
    within_1 = np.mean(diff <= 1) * 100.0
    return float(within_1)


def plot_confusion_matrix(y_true_grades, y_pred_grades, title: str, save_path: str):
    """
    Generate and save a formatted confusion matrix heatmap for IMD cyclone categories.
    """
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    
    # Filter only categories present in the true/pred data while keeping GRADE_ORDER
    labels = [g for g in GRADE_ORDER if (g in y_true_grades or g in y_pred_grades)]
    
    cm = confusion_matrix(y_true_grades, y_pred_grades, labels=labels)
    
    plt.figure(figsize=(8, 6), dpi=300)
    sns.heatmap(
        cm,
        annot=True,
        fmt='d',
        cmap='Blues',
        xticklabels=labels,
        yticklabels=labels,
        cbar=True
    )
    plt.title(title, fontsize=14, pad=15, fontweight='bold')
    plt.xlabel('Predicted IMD Grade', fontsize=12, labelpad=10)
    plt.ylabel('Actual IMD Grade', fontsize=12, labelpad=10)
    plt.tight_layout()
    plt.savefig(save_path)
    plt.close()
    print(f"Saved confusion matrix: {save_path}")


def plot_feature_importance(feature_names, importances, title: str, save_path: str, top_n: int = 15):
    """
    Generate and save a horizontal bar chart of top predictor feature importances.
    """
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    
    df_imp = pd.DataFrame({
        'Feature': feature_names,
        'Importance': importances
    }).sort_values('Importance', ascending=False).head(top_n)
    
    plt.figure(figsize=(10, 7), dpi=300)
    plt.barh(df_imp['Feature'][::-1], df_imp['Importance'][::-1], color='#1f77b4', edgecolor='black', alpha=0.85)
    plt.xlabel('Normalized Importance', fontsize=12, labelpad=10)
    plt.ylabel('Feature', fontsize=12, labelpad=10)
    plt.title(title, fontsize=14, pad=15, fontweight='bold')
    plt.grid(axis='x', linestyle='--', alpha=0.7)
    plt.tight_layout()
    plt.savefig(save_path)
    plt.close()
    print(f"Saved feature importance plot: {save_path}")
