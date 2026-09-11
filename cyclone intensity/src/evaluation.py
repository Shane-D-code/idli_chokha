"""
Evaluation Suite: Comprehensive reporting and artifact generation for
Tropical Cyclone Intensity Prediction & IMD Grade Classification.
"""

import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

from src.utils import plot_confusion_matrix, plot_feature_importance, FEATURE_COLUMNS


def save_evaluation_results(
    reg_summary_df: pd.DataFrame,
    cls_summary_df: pd.DataFrame,
    full_cls_reports: dict,
    feature_importances: np.ndarray = None,
    results_dir: str = "results"
):
    """
    Export all evaluation tables, text reports, and visualization artifacts to results/.
    """
    metrics_dir = os.path.join(results_dir, "metrics")
    figures_dir = os.path.join(results_dir, "figures")
    cls_dir = os.path.join(results_dir, "classification")
    
    os.makedirs(metrics_dir, exist_ok=True)
    os.makedirs(figures_dir, exist_ok=True)
    os.makedirs(cls_dir, exist_ok=True)
    
    # 1. Save Metrics CSVs
    reg_metrics_path = os.path.join(metrics_dir, "regression_metrics.csv")
    reg_summary_df.to_csv(reg_metrics_path, index=False)
    print(f"Exported regression metrics: {reg_metrics_path}")
    
    cls_metrics_path = os.path.join(metrics_dir, "classification_metrics.csv")
    cls_summary_df.to_csv(cls_metrics_path, index=False)
    print(f"Exported classification metrics: {cls_metrics_path}")
    
    # 2. Save Classification Text Report
    report_txt_path = os.path.join(metrics_dir, "classification_report.txt")
    with open(report_txt_path, "w", encoding="utf-8") as f:
        f.write("=" * 75 + "\n")
        f.write("TROPICAL CYCLONE INTENSITY PREDICTION: CLASSIFICATION REPORT\n")
        f.write("India Meteorological Department (IMD) 7-Class Intensity Scale\n")
        f.write("Derived from 24-Hour Ahead Maximum Sustained Wind (MSW) Regression\n")
        f.write("=" * 75 + "\n\n")
        
        f.write("SUMMARY COMPARISON TABLE:\n")
        f.write(cls_summary_df.to_string(index=False) + "\n\n")
        
        for model_name, data in full_cls_reports.items():
            f.write("-" * 75 + "\n")
            f.write(f"MODEL: {model_name}\n")
            f.write("-" * 75 + "\n")
            f.write(data['report_str'] + "\n\n")
            
    print(f"Exported classification report text: {report_txt_path}")
    
    # 3. Save Confusion Matrices
    for model_name, data in full_cls_reports.items():
        clean_name = model_name.lower().replace(" ", "_")
        cm_path = os.path.join(figures_dir, f"{clean_name}_confusion_matrix.png")
        plot_confusion_matrix(
            y_true_grades=data['true_cats'],
            y_pred_grades=data['pred_cats'],
            title=f"IMD Grade Confusion Matrix ({model_name})",
            save_path=cm_path
        )
        
    # 4. Save Feature Importance Plot
    if feature_importances is not None:
        imp_path = os.path.join(figures_dir, "feature_importance.png")
        plot_feature_importance(
            feature_names=FEATURE_COLUMNS,
            importances=feature_importances,
            title="Top 15 Predictor Importances (Tuned XGBoost)",
            save_path=imp_path,
            top_n=15
        )
        
        # Save feature importance CSV
        imp_df = pd.DataFrame({
            'Feature': FEATURE_COLUMNS,
            'Importance': feature_importances
        }).sort_values('Importance', ascending=False)
        imp_df.to_csv(os.path.join(metrics_dir, "feature_importances.csv"), index=False)
        
    print("\nAll evaluation artifacts saved successfully.")
