from fastapi.testclient import TestClient

from backend.dicom_utils import create_synthetic_dicom
from backend.main import app
from backend.triage import analyze


def test_lesion_scores_higher_than_clean():
    lesion = analyze(create_synthetic_dicom(index=0, seed=3, lesion=True))
    clean = analyze(create_synthetic_dicom(index=0, seed=3, lesion=False))
    assert lesion.score > clean.score
    assert lesion.priority == "urgent"
    assert clean.priority == "routine"


def test_worklist_orders_urgent_first(tmp_path, monkeypatch):
    monkeypatch.setenv("HAGAR_STUDY_STORE", str(tmp_path / "store"))
    client = TestClient(app)
    clean = create_synthetic_dicom(index=0, seed=5, lesion=False)
    lesion = create_synthetic_dicom(index=1, seed=5, lesion=True)
    client.post("/studies/upload", files=[("files", ("c.dcm", clean, "application/dicom"))])
    client.post("/studies/upload", files=[("files", ("l.dcm", lesion, "application/dicom"))])
    worklist = client.get("/studies").json()
    assert len(worklist) == 2
    assert worklist[0]["triage"]["priority"] == "urgent"
    assert worklist[1]["triage"]["priority"] == "routine"


def test_event_bus_replays_history():
    import asyncio

    from backend.events import EventBus

    async def scenario():
        local = EventBus()
        await local.publish(type="study_received", study_uid="a")
        await local.publish(type="study_received", study_uid="b")
        generator = local.subscribe(0)
        first = await anext(generator)
        second = await anext(generator)
        await generator.aclose()
        return first, second

    first, second = asyncio.run(scenario())
    assert first["type"] == "study_received"
    assert first["study_uid"] == "a"
    assert second["id"] == first["id"] + 1


def test_events_endpoint_streams_sse(tmp_path, monkeypatch):
    import asyncio

    from backend.events import bus
    from backend.main import events as events_route

    monkeypatch.setenv("HAGAR_STUDY_STORE", str(tmp_path / "store"))
    client = TestClient(app)
    dcm = create_synthetic_dicom(index=0, seed=9, lesion=True)
    client.post("/studies/upload", files=[("files", ("e.dcm", dcm, "application/dicom"))])

    async def scenario():
        response = await events_route(last_event_id=0)
        chunk = await anext(response.body_iterator)
        await response.body_iterator.aclose()
        return response, chunk

    response, chunk = asyncio.run(scenario())
    assert response.media_type == "text/event-stream"
    assert chunk.startswith("id: ")
    assert "study_received" in chunk
    assert bus is not None
