"""Backend API integration tests.

Skip guard: the full backend wiring needs configs/pipeline.yaml present in the
repo root (CI/dev convention), so tests are skipped when missing.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from src.core.schema import Basin, PipelineRunRequest, PipelineRunResult

pytestmark = pytest.mark.skipif(
    not os.path.exists("configs/pipeline.yaml"),
    reason="pipeline config required",
)


@pytest.fixture(scope="module")
def client():
    from backend.app.main import app, get_service

    # Deterministic service: no real model execution in these tests.
    fake = Mock()
    stored = PipelineRunResult(
        request_id="test-req",
        run_id="test-run",
        pipeline_status="COMPLETED",
        assessment=None,
        per_hazard_status={"rainfall": "AVAILABLE", "genesis": "AVAILABLE"},
        provider_sources=[],
    )
    # Assessment object carries per-hazard predictions + module status maps.
    assessment = Mock()
    assessment.genesis = {"probability_24h": 0.5, "risk_level": "MODERATE"}
    assessment.track = {"latitudes": [15.5], "longitudes": [85.5]}
    assessment.rainfall = {"total_accumulation_mm": 120.5}
    assessment.rapid_intensification = None  # a not-assessed hazard -> 404
    assessment.module_status = {
        "genesis": "AVAILABLE",
        "track": "AVAILABLE",
        "rainfall": "AVAILABLE",
        "ri": "NOT_AVAILABLE",
    }
    assessment.module_reasons = {"ri": "model artifact unavailable (not loaded)"}
    stored.assessment = assessment

    fake.get_run.side_effect = lambda rid: stored if rid in ("test-req", "test-run") else None
    fake.run.return_value = stored
    fake.list_models.return_value = [{
        "name": "ri", "version": "1", "model_type": "ri", "artifact_present": True,
    }]
    fake.provider_availability.return_value = {"cyclone_track": {"available": True}}

    with TestClient(app) as c:
        c.app.dependency_overrides[get_service] = lambda: fake
        yield c


def test_root(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.json()["service"] == "TOOFAN Pipeline API"


def test_health(client):
    resp = client.get("/health/")
    assert resp.status_code == 200
    body = resp.json()
    assert "status" in body


def test_versioned_health_aliases_current_routes(client):
    resp = client.get("/api/v1/health/")
    assert resp.status_code == 200
    assert "status" in resp.json()

    resp = client.get("/api/v1/models/")
    assert resp.status_code == 200
    assert resp.json()["models"][0]["name"] == "ri"

    resp = client.get("/api/v1/data/sources")
    assert resp.status_code == 200
    assert "sources" in resp.json()


def test_models(client):
    resp = client.get("/models/")
    assert resp.status_code == 200
    assert resp.json()["models"][0]["name"] == "ri"


def test_data_sources(client):
    resp = client.get("/data/sources")
    assert resp.status_code == 200
    assert "sources" in resp.json()


def test_pipeline_validate(client):
    req = {
        "storm_id": "2020136N10088",
        "basin": "NI",
        "reference_time": "2020-05-15T06:00:00Z",
    }
    resp = client.post("/pipeline/validate", json=req)
    assert resp.status_code == 200
    assert resp.json()["valid"] is True


def test_pipeline_run_returns_result_envelope(client):
    req = {
        "storm_id": "2020136N10088",
        "basin": "NI",
        "reference_time": "2020-05-15T06:00:00Z",
    }
    resp = client.post("/pipeline/run", json=req)
    assert resp.status_code == 200
    body = resp.json()
    assert body["pipeline_status"] == "COMPLETED"
    assert body["run_id"] == "test-run"


def test_pipeline_run_validates_bad_basin(client):
    resp = client.post(
        "/pipeline/run",
        json={"storm_id": "x", "basin": "NOT_A_BASIN",
              "reference_time": "2020-05-15T06:00:00Z"},
    )
    assert resp.status_code in (400, 422)


# --------------------------------------------------------------------------
# Assessment / hazard endpoints
# --------------------------------------------------------------------------


def test_get_assessment_returns_stored_run(client):
    resp = client.get("/api/v1/assessment/test-req")
    assert resp.status_code == 200
    body = resp.json()
    assert body["request_id"] == "test-req"
    assert body["run_id"] == "test-run"
    assert body["pipeline_status"] == "COMPLETED"


def test_get_assessment_unknown_returns_404(client):
    resp = client.get("/api/v1/assessment/does-not-exist")
    assert resp.status_code == 404


def test_get_hazard_returns_prediction(client):
    resp = client.get("/api/v1/hazards/rain/test-req")
    assert resp.status_code == 200
    body = resp.json()
    assert body["request_id"] == "test-req"
    assert body["hazard_status"] == "AVAILABLE"
    assert body["prediction"]["total_accumulation_mm"] == 120.5


def test_get_hazard_cyclone_alias_maps_to_track(client):
    resp = client.get("/api/v1/hazards/cyclone/test-req")
    assert resp.status_code == 200
    assert resp.json()["hazard_status"] == "AVAILABLE"


def test_get_unassessed_hazard_returns_404(client):
    resp = client.get("/api/v1/hazards/ri/test-req")
    assert resp.status_code == 404
    assert "not assessed" in resp.json()["detail"].lower()


def test_get_unknown_hazard_slug_returns_400(client):
    resp = client.get("/api/v1/hazards/bogus/test-req")
    assert resp.status_code == 400


def test_get_hazard_unknown_run_returns_404(client):
    resp = client.get("/api/v1/hazards/rain/does-not-exist")
    assert resp.status_code == 404


def test_genesis_status_endpoint(client):
    resp = client.get("/api/v1/genesis")
    assert resp.status_code == 200
    body = resp.json()
    assert body["module"] == "genesis"
    assert "registered" in body


def test_run_genesis_forces_genesis_only_mode(client):
    from backend.app.main import get_service

    req = {
        "storm_id": "2020136N10088",
        "basin": "NI",
        "reference_time": "2020-05-15T06:00:00Z",
    }
    resp = client.post("/api/v1/genesis", json=req)
    assert resp.status_code == 200
    body = resp.json()
    assert body["request_id"] == "test-req"
    assert "genesis" in body

    # The service must have been called restricted to the genesis branch.
    called = client.app.dependency_overrides[get_service]()
    last = called.run.call_args.args[0]
    assert last.mode == "genesis_only"
    assert last.modules == ["genesis"]


def test_cyclone_path_status_endpoint(client):
    resp = client.get("/api/v1/cyclone/path")
    assert resp.status_code == 200
    body = resp.json()
    assert body["module"] == "trajectory"


def test_run_cyclone_path_forces_track_only_with_genesis(client):
    from backend.app.main import get_service

    req = {
        "storm_id": "2020136N10088",
        "basin": "NI",
        "reference_time": "2020-05-15T06:00:00Z",
    }
    resp = client.post("/api/v1/cyclone/path", json=req)
    assert resp.status_code == 200
    body = resp.json()
    assert body["request_id"] == "test-req"
    assert "cyclone_path" in body
    assert "genesis" in body

    service = client.app.dependency_overrides[get_service]()
    last = service.run.call_args.args[0]
    assert last.mode == "track_only"
    assert last.modules == ["genesis", "trajectory"]


def test_ws_assessment_streams_snapshot_and_run_events(client, monkeypatch):
    import backend.app.routers.assessment as assessment_router
    from backend.app.main import get_service

    fake = client.app.dependency_overrides[get_service]()
    monkeypatch.setattr(assessment_router, "get_service", lambda: fake)
    monkeypatch.setattr(assessment_router, "get_event_bus", lambda: [{
        "kind": "pipeline",
        "run_id": "test-req",
        "stage": "pipeline_completed",
        "status": "completed",
        "message": "run completed",
    }])

    try:
        with client.websocket_connect("/api/v1/ws/assessment/test-req") as ws:
            snapshot = json.loads(ws.receive_text())
            event = json.loads(ws.receive_text())
    except (RuntimeError, ImportError) as exc:  # pragma: no cover
        pytest.skip(f"websocket support unavailable: {exc}")

    assert snapshot["kind"] == "assessment_snapshot"
    assert snapshot["event_id"] == "test-req"
    assert snapshot["pipeline_status"] == "COMPLETED"

    assert event["kind"] == "pipeline"
    assert event["stage"] == "pipeline_completed"