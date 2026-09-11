"""
Regression modeling pipeline for 24-hour tropical cyclone intensity (MSW) prediction
using tree-based ensembles and storm-wise cross-validation.
"""

import os
import joblib
import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor, HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

from src.utils import FEATURE_COLUMNS


def get_regression_models(tuned_only: bool = True):
    """
    Construct regression pipelines with Median SimpleImputer for tree ensembles.
    Preserves exact optimal hyperparameter configurations from Colab tuning experiments.
    """
    models = {
        "Tuned XGBoost": Pipeline([
            ('imputer', SimpleImputer(strategy='median')),
            ('model', XGBRegressor(
                objective='reg:squarederror',
                random_state=42,
                n_jobs=-1,
                n_estimators=159,
                max_depth=2,
                learning_rate=0.04499098541918724,
                min_child_weight=4,
                subsample=0.9861677405155175,
                colsample_bytree=0.6914200087189198,
                reg_alpha=0.260829174830409,
                reg_lambda=2.4925073995158487
            ))
        ]),
        "Tuned Extra Trees": Pipeline([
            ('imputer', SimpleImputer(strategy='median')),
            ('model', ExtraTreesRegressor(
                random_state=42,
                n_jobs=-1,
                n_estimators=443,
                max_depth=15,
                max_features=0.5,
                min_samples_leaf=4,
                min_samples_split=8
            ))
        ])
    }
    
    if not tuned_only:
        models["Baseline XGBoost"] = Pipeline([
            ('imputer', SimpleImputer(strategy='median')),
            ('model', XGBRegressor(random_state=42, n_jobs=-1, n_estimators=200))
        ])
        models["Baseline Extra Trees"] = Pipeline([
            ('imputer', SimpleImputer(strategy='median')),
            ('model', ExtraTreesRegressor(random_state=42, n_jobs=-1, n_estimators=200))
        ])
        
    return models


def evaluate_regression_storm_cv(df: pd.DataFrame, models: dict = None, n_splits: int = 5):
    """
    Perform 5-fold storm-wise cross-validation to evaluate MSW regression performance.
    
    Returns
    -------
    summary_df : pd.DataFrame
        Summary table of Mean/Std MAE, RMSE, R2.
    oof_predictions : dict
        Out-of-fold predicted MSW array for each model.
    fold_details : list
        Detailed per-fold results.
    """
    if models is None:
        models = get_regression_models(tuned_only=True)
        
    X = df[FEATURE_COLUMNS].copy()
    y = df['msw_target_24h'].copy().to_numpy()
    groups = df['storm_id'].copy()
    
    gkf = GroupKFold(n_splits=n_splits)
    
    cv_summary_records = []
    oof_predictions = {name: np.zeros(len(df)) for name in models.keys()}
    fold_details = []
    
    print("=" * 70)
    print("RUNNING 5-FOLD STORM-WISE REGRESSION CROSS-VALIDATION")
    print(f"Total Observations: {len(df)} | Features: {X.shape[1]} | Storms: {groups.nunique()}")
    print("=" * 70)
    
    for name, pipeline in models.items():
        print(f"\nEvaluating Model: {name}")
        fold_mae, fold_rmse, fold_r2 = [], [], []
        
        for fold, (train_idx, val_idx) in enumerate(gkf.split(X, y, groups), start=1):
            X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
            y_train, y_val = y[train_idx], y[val_idx]
            
            pipeline.fit(X_train, y_train)
            val_preds = pipeline.predict(X_val)
            oof_predictions[name][val_idx] = val_preds
            
            mae = mean_absolute_error(y_val, val_preds)
            rmse = np.sqrt(mean_squared_error(y_val, val_preds))
            r2 = r2_score(y_val, val_preds)
            
            fold_mae.append(mae)
            fold_rmse.append(rmse)
            fold_r2.append(r2)
            
            fold_details.append({
                'Model': name,
                'Fold': fold,
                'Val_Storms': len(np.unique(groups.iloc[val_idx])),
                'Val_Samples': len(val_idx),
                'MAE': mae,
                'RMSE': rmse,
                'R2': r2
            })
            print(f"  Fold {fold} | MAE: {mae:6.3f} kt | RMSE: {rmse:6.3f} kt | R2: {r2:6.3f}")
            
        mean_mae, std_mae = np.mean(fold_mae), np.std(fold_mae)
        mean_rmse, std_rmse = np.mean(fold_rmse), np.std(fold_rmse)
        mean_r2, std_r2 = np.mean(fold_r2), np.std(fold_r2)
        
        print(f"  --> Mean MAE: {mean_mae:.3f} (+/- {std_mae:.3f}) | Mean RMSE: {mean_rmse:.3f} | Mean R2: {mean_r2:.3f}")
        
        cv_summary_records.append({
            'Model': name,
            'Mean_MAE': round(mean_mae, 3),
            'Std_MAE': round(std_mae, 3),
            'Mean_RMSE': round(mean_rmse, 3),
            'Std_RMSE': round(std_rmse, 3),
            'Mean_R2': round(mean_r2, 3),
            'Std_R2': round(std_r2, 3)
        })
        
    summary_df = pd.DataFrame(cv_summary_records)
    return summary_df, oof_predictions, pd.DataFrame(fold_details)


def train_final_regression_model(df: pd.DataFrame, model_name: str = "Tuned XGBoost", save_path: str = "models/final_xgb_regressor.joblib"):
    """
    Train final model on full dataset and return fitted pipeline + feature importances.
    """
    models = get_regression_models(tuned_only=True)
    if model_name not in models:
        raise ValueError(f"Unknown model: {model_name}. Available: {list(models.keys())}")
        
    pipeline = models[model_name]
    X = df[FEATURE_COLUMNS].copy()
    y = df['msw_target_24h'].copy().to_numpy()
    
    print(f"Fitting final {model_name} on {len(df)} samples...")
    pipeline.fit(X, y)
    
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    joblib.dump(pipeline, save_path)
    print(f"Saved fitted model to: {save_path}")
    
    importances = None
    if hasattr(pipeline.named_steps['model'], 'feature_importances_'):
        importances = pipeline.named_steps['model'].feature_importances_
        
    return pipeline, importances
