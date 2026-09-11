"""
Main execution pipeline for Tropical Cyclone Intensity Prediction & IMD Classification.
Predicts 24-hour maximum sustained wind speed (MSW) using tuned tree ensembles
(XGBoost and Extra Trees) with storm-wise cross-validation and evaluates derived IMD classification.
"""

import os
import sys
import pandas as pd
import numpy as np

from src.utils import FEATURE_COLUMNS, GRADE_ORDER, GRADE_DESCRIPTIONS
from src.preprocessing import load_or_process_clean_model_dataset
from src.regression import get_regression_models, evaluate_regression_storm_cv, train_final_regression_model
from src.classification import compare_regression_derived_classification
from src.evaluation import save_evaluation_results


def main():
    print("=" * 80)
    print("TROPICAL CYCLONE 24-HOUR INTENSITY PREDICTION & CLASSIFICATION PIPELINE")
    print("=" * 80)
    
    # ---------------------------------------------------------
    # 1. LOAD MODELING DATASET
    # ---------------------------------------------------------
    csv_path = "data/processed/clean_model_data.csv"
    if not os.path.exists(csv_path):
        parquet_path = "data/processed/clean_model_data.parquet"
        if not os.path.exists(parquet_path):
            print(f"Dataset not found at {csv_path}. Please wait for or run data reconstruction.")
            return 1
            
    df = load_or_process_clean_model_dataset(csv_path)
    
    print("\nDataset Summary:")
    print(f"  • Observations      : {len(df)}")
    print(f"  • Unique Storms     : {df['storm_id'].nunique()}")
    print(f"  • Predictor Features: {len(FEATURE_COLUMNS)}")
    print(f"  • Regression Target : msw_target_24h (Mean: {df['msw_target_24h'].mean():.2f} kt, Min: {df['msw_target_24h'].min():.1f} kt, Max: {df['msw_target_24h'].max():.1f} kt)")
    print(f"  • IMD Grade Target  : target_category_24h")
    print("\nTarget Class Distribution (+24h IMD Grade):")
    class_counts = df['target_category_24h'].value_counts()[GRADE_ORDER].dropna()
    class_pcts = df['target_category_24h'].value_counts(normalize=True)[GRADE_ORDER].dropna() * 100
    dist_df = pd.DataFrame({'Count': class_counts, 'Percentage (%)': class_pcts.round(2)})
    print(dist_df.to_string())

    # ---------------------------------------------------------
    # 2. RUN 5-FOLD STORM-WISE REGRESSION
    # ---------------------------------------------------------
    models = get_regression_models(tuned_only=True)
    reg_summary_df, oof_predictions, fold_df = evaluate_regression_storm_cv(
        df=df,
        models=models,
        n_splits=5
    )
    
    print("\n" + "=" * 80)
    print("REGRESSION CROSS-VALIDATION SUMMARY (5-Fold Storm-Wise GroupKFold)")
    print("=" * 80)
    print(reg_summary_df.to_string(index=False))

    # ---------------------------------------------------------
    # 3. DERIVE & EVALUATE IMD CATEGORY CLASSIFICATION
    # ---------------------------------------------------------
    y_true_msw = df['msw_target_24h'].to_numpy()
    cls_summary_df, full_cls_reports = compare_regression_derived_classification(
        oof_predictions=oof_predictions,
        y_true_msw=y_true_msw
    )
    
    print("\n" + "=" * 80)
    print("DERIVED IMD CATEGORY CLASSIFICATION SUMMARY (If-Else Meteorological Mapping)")
    print("=" * 80)
    print(cls_summary_df.to_string(index=False))
    
    print("\nDetailed Per-Class Classification Report (Tuned XGBoost):")
    print(full_cls_reports['Tuned XGBoost']['report_str'])

    # ---------------------------------------------------------
    # 4. TRAIN FINAL REGRESSION MODEL & EXTRACT IMPORTANCE
    # ---------------------------------------------------------
    final_pipeline, feature_importances = train_final_regression_model(
        df=df,
        model_name="Tuned XGBoost",
        save_path="models/final_xgb_regressor.joblib"
    )

    # ---------------------------------------------------------
    # 5. SAVE ALL ARTIFACTS, CSV METRICS, AND PLOTS
    # ---------------------------------------------------------
    save_evaluation_results(
        reg_summary_df=reg_summary_df,
        cls_summary_df=cls_summary_df,
        full_cls_reports=full_cls_reports,
        feature_importances=feature_importances,
        results_dir="results"
    )
    
    print("\n" + "=" * 80)
    print("PIPELINE EXECUTION COMPLETED SUCCESSFULLY!")
    print("=" * 80)
    return 0


if __name__ == "__main__":
    sys.exit(main())
