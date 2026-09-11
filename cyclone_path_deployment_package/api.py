from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List
from inference import predict


app = FastAPI(
    title="Cyclone Trajectory Prediction API",
    version="1.0.0",
)


class Observation(BaseModel):
    timestamp: str
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    wind: float
    pressure: float


class PredictionRequest(BaseModel):
    observations: List[Observation]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict_endpoint(req: PredictionRequest):
    try:
        return predict(
            [obs.model_dump() for obs in req.observations]
        )
    except (ValueError, FileNotFoundError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
