"""
Classification module: Converts continuous predicted cyclone intensity (MSW, knots)
into India Meteorological Department (IMD) cyclone intensity categories using meteorological threshold rules.
"""

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, classification_report

from src.utils import GRADE_ORDER, GRADE_TO_IDX, msw_to_category, msw_to_category_vectorized, within_1_category_score


def classify_intensity(msw_values) -> np.ndarray:
    """
    Classify predicted or observed maximum sustained wind speed (MSW, knots)
    into IMD categories using explicit if-else threshold logic.
    
    Category Thresholds (IMD Standards):
      - MSW < 28 kt        --> 'D'    (Depression)
      - 28 <= MSW <= 33 kt --> 'DD'   (Deep Depression)
      - 34 <= MSW <= 47 kt --> 'CS'   (Cyclonic Storm)
      - 48 <= MSW <= 63 kt --> 'SCS'  (Severe Cyclonic Storm)
      - 64 <= MSW <= 89 kt --> 'VSCS' (Very Severe Cyclonic Storm)
      - 90 <= MSW <= 119 kt--> 'ESCS' (Extremely Severe Cyclonic Storm)
      - MSW >= 120 kt      --> 'SUCS' (Super Cyclonic Storm)
    """
    return msw_to_category_vectorized(msw_values)


def evaluate_intensity_classification(y_true_msw, y_pred_msw, model_name: str = "Tuned XGBoost"):
    """
    Evaluate categorical classification performance derived from predicted MSW values.
    
    Parameters
    ----------
    y_true_msw : array-like
        True ground-truth MSW values (+24h horizon, in knots).
    y_pred_msw : array-like
        Predicted MSW values (+24h horizon, in knots).
    model_name : str
        Name of the regression model producing the predictions.
        
    Returns
    -------
    metrics : dict
        Calculated classification metrics.
    report_dict : dict
        Detailed per-class classification report.
    true_cats : np.ndarray
        Array of true IMD categories.
    pred_cats : np.ndarray
        Array of predicted IMD categories.
    """
    true_cats = classify_intensity(y_true_msw)
    pred_cats = classify_intensity(y_pred_msw)
    
    acc = accuracy_score(true_cats, pred_cats) * 100.0
    within_1_acc = within_1_category_score(true_cats, pred_cats)
    
    macro_f1 = f1_score(true_cats, pred_cats, average='macro', zero_division=0) * 100.0
    weighted_f1 = f1_score(true_cats, pred_cats, average='weighted', zero_division=0) * 100.0
    macro_prec = precision_score(true_cats, pred_cats, average='macro', zero_division=0) * 100.0
    macro_rec = recall_score(true_cats, pred_cats, average='macro', zero_division=0) * 100.0
    
    present_labels = [g for g in GRADE_ORDER if (g in true_cats or g in pred_cats)]
    
    report_str = classification_report(
        true_cats,
        pred_cats,
        labels=present_labels,
        zero_division=0
    )
    
    report_dict = classification_report(
        true_cats,
        pred_cats,
        labels=present_labels,
        output_dict=True,
        zero_division=0
    )
    
    metrics = {
        'Model': model_name,
        'Accuracy (%)': round(acc, 2),
        'Within_1_Category (%)': round(within_1_acc, 2),
        'Macro_F1 (%)': round(macro_f1, 2),
        'Weighted_F1 (%)': round(weighted_f1, 2),
        'Macro_Precision (%)': round(macro_prec, 2),
        'Macro_Recall (%)': round(macro_rec, 2)
    }
    
    return metrics, report_str, report_dict, true_cats, pred_cats


def compare_regression_derived_classification(oof_predictions: dict, y_true_msw):
    """
    Compare multiple regression models on their derived IMD category classification performance.
    """
    comparison_records = []
    full_reports = {}
    
    for model_name, pred_msw in oof_predictions.items():
        metrics, report_str, report_dict, true_cats, pred_cats = evaluate_intensity_classification(
            y_true_msw, pred_msw, model_name=model_name
        )
        comparison_records.append(metrics)
        full_reports[model_name] = {
            'report_str': report_str,
            'report_dict': report_dict,
            'true_cats': true_cats,
            'pred_cats': pred_cats
        }
        
    summary_df = pd.DataFrame(comparison_records)
    return summary_df, full_reports
