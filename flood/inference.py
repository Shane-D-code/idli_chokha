
import json
import joblib
import numpy as np
import pandas as pd


class ToofanFloodModel:

    def __init__(
        self,
        model_path="flood_xgboost_improved.pkl",
        config_path="flood_feature_config.json"
    ):

        self.model = joblib.load(model_path)

        with open(config_path, "r") as f:
            self.config = json.load(f)

        self.features = self.config["features"]

        self.rainfall_features = (
            self.config["rainfall_features"]
        )

        self.hydro_features = (
            self.config["hydrological_features"]
        )

        self.susceptibility_weight = (
            self.config["dynamic_risk"]
            ["susceptibility_weight"]
        )

        self.rainfall_weight = (
            self.config["dynamic_risk"]
            ["rainfall_hazard_weight"]
        )

        self.normalization = (
            self.config
            ["rainfall_normalization"]
        )

    def predict(self, data):

        data = data.copy()

        # ----------------------------------------------------
        # CHECK FEATURES
        # ----------------------------------------------------

        missing = [
            c for c in self.features
            if c not in data.columns
        ]

        if missing:
            raise ValueError(
                "Missing Flood features: "
                + str(missing)
            )

        # ----------------------------------------------------
        # MODEL SUSCEPTIBILITY
        # ----------------------------------------------------

        X = data[self.features].copy()

        X = X.replace(
            [np.inf, -np.inf],
            np.nan
        )

        for col in X.columns:

            if X[col].isna().any():

                X[col] = X[col].fillna(
                    X[col].median()
                )

        susceptibility = (
            self.model.predict_proba(X)[:, 1]
        )

        # ----------------------------------------------------
        # RAINFALL HAZARD
        # ----------------------------------------------------

        rainfall_scores = []

        for col in self.rainfall_features:

            q05 = self.normalization[col]["q05"]
            q95 = self.normalization[col]["q95"]

            if q95 > q05:

                score = (
                    (data[col] - q05)
                    / (q95 - q05)
                ).clip(0, 1)

            else:

                score = pd.Series(
                    0.0,
                    index=data.index
                )

            rainfall_scores.append(score)

        rainfall_hazard = pd.concat(
            rainfall_scores,
            axis=1
        ).mean(axis=1)

        # ----------------------------------------------------
        # DYNAMIC FLOOD RISK
        # ----------------------------------------------------

        risk = (
            self.susceptibility_weight
            * susceptibility
            +
            self.rainfall_weight
            * rainfall_hazard
        )

        risk = np.clip(
            risk,
            0,
            1
        )

        # ----------------------------------------------------
        # RISK LEVEL
        # ----------------------------------------------------

        risk_level = pd.cut(
            risk,

            bins=[
                -np.inf,
                0.25,
                0.50,
                0.75,
                np.inf
            ],

            labels=[
                "Low",
                "Moderate",
                "High",
                "Very High"
            ]
        )

        output = pd.DataFrame({

            "flood_susceptibility":
                susceptibility,

            "rainfall_hazard":
                rainfall_hazard.values,

            "dynamic_flood_risk":
                risk,

            "flood_risk_level":
                risk_level.astype(str)
        })

        return output
