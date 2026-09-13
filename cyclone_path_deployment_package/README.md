# Cyclone model deployment package

## Files
- best_cyclone_model_lt3p_distilled.pth : trained student weights (place your downloaded file here)
- model.py                         : exact CycloneForecaster architecture
- feature_builder.py               : exact inference feature construction from the notebook
- config.py                         : exact feature order and model configuration
- scalers.pkl                      : REQUIRED; export from the original notebook
- inference.py                     : Python inference interface
- api.py                            : FastAPI wrapper for frontend integration
- requirements.txt                  : dependencies
- export_scalers_cell.py            : cell to run once in the original notebook

## Important
The notebook did not serialize the fitted StandardScaler objects into the .pth checkpoint.
Therefore `scalers.pkl` must be created from the ORIGINAL NOTEBOOK's existing
`track_scaler` and `physics_scaler`, using `export_scalers_cell.py`.

Do NOT use or ship NASA Earthdata credentials from the training notebook.

## Direct Python usage
```python
from inference import predict

result = predict([
    {
        "timestamp": "2026-08-01T00:00:00Z",
        "latitude": 15.20,
        "longitude": 85.40,
        "wind": 45.0,
        "pressure": 992.0,
    },
    # ... exactly 12 observations, every 2 hours ...
])

print(result)
```

## API
Install:
```bash
pip install -r requirements.txt
```

Run:
```bash
uvicorn api:app --host 0.0.0.0 --port 8000
```

Then:
`POST http://localhost:8000/predict`

Request body:
```json
{
  "observations": [
    {
      "timestamp": "2026-08-01T00:00:00Z",
      "latitude": 15.20,
      "longitude": 85.40,
      "wind": 45.0,
      "pressure": 992.0
    }
  ]
}
```
Send exactly 12 such observations at 2-hour intervals.

The response contains 12 predictions at 2,4,...,24 hours.

## Limitations (audit finding, 2026-09-12)

- Valid out to +24 h only (12 steps, 2 h apart).
- **The uncertainty output is NOT calibrated and does NOT grow with lead time:**
  in the distilled checkpoint the uncertainty head is saturated at a constant
  bound (~209.9 km) at every horizon (`log_std` clamp). Treat it as a fixed,
  unvalidated spread, not a per-horizon confidence interval.
- SST / shear are climatology proxies, not real-time satellite/reanalysis fields.
- Historical track-error claims (~50–80 km at 24 h) are NOT reproduced from this
  repository.
