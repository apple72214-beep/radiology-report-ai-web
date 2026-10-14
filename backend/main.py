"""Application entry point."""

import json
from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import studies
from .demo import seed_demo
from .events import bus
from .render import PRESETS, render_png

app = FastAPI(
    title="Radiology report AI",
    description="Enterprise AI Radiology Platform",
    version="0.3.0",
)


@app.on_event("startup")
def _seed_if_empty() -> None:
    """Keep ephemeral hosting (free tiers) demonstrable after cold starts."""
    if not studies.list_studies():
        seed_demo()

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"

app.mount(
    "/icons", StaticFiles(directory=FRONTEND / "icons"), name="icons"
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


SAMPLES = Path(__file__).resolve().parent.parent / "data" / "samples"


@app.get("/samples/{name}.dcm")
def sample_dicom(name: str):
    """Downloadable synthetic sample studies (lesion = urgent, clean = routine)."""
    if name not in {"lesion", "clean"}:
        return Response(status_code=404, content="unknown sample")
    return FileResponse(
        SAMPLES / f"{name}.dcm",
        media_type="application/dicom",
        filename=f"{name}.dcm",
    )


@app.get("/")
def viewer():
    """Built-in, offline-friendly study worklist and viewer (PWA)."""
    return FileResponse(FRONTEND / "viewer.html", media_type="text/html")


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(
        FRONTEND / "manifest.webmanifest",
        media_type="application/manifest+json",
    )


@app.get("/sw.js")
def service_worker():
    return FileResponse(
        FRONTEND / "sw.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


@app.post("/studies/upload", status_code=201)
async def upload_studies(files: list[UploadFile] = File(...)):
    payload = [(f.filename or "instance.dcm", await f.read()) for f in files]
    if not payload:
        raise HTTPException(status_code=400, detail="No files provided")
    created = studies.ingest(owner_id="anonymous", files=payload)
    for study in created:
        await bus.publish(
            type="study_received",
            study_uid=study.study_uid,
            patient_id=study.patient_id,
            priority=(study.triage or {}).get("priority", "routine"),
        )
    return [asdict(study) for study in created]


@app.get("/studies")
def worklist():
    return [asdict(study) for study in studies.list_studies()]


@app.get("/studies/{study_uid}")
def study_detail(study_uid: str):
    study = studies.get_study(study_uid)
    if study is None:
        raise HTTPException(status_code=404, detail="Study not found")
    return asdict(study)


@app.get("/studies/{study_uid}/instances/{idx}/png")
def instance_png(study_uid: str, idx: int, preset: str = "auto"):
    if preset not in PRESETS:
        raise HTTPException(status_code=400, detail=f"Unknown preset: {preset}")
    data = studies.read_instance(study_uid, idx)
    if data is None:
        raise HTTPException(status_code=404, detail="Instance not found")
    return Response(content=render_png(data, preset), media_type="image/png")


@app.get("/events")
async def events(last_event_id: int = 0):
    """Server-Sent Events: replayable history then live worklist updates."""

    async def stream():
        async for event in bus.subscribe(last_event_id):
            yield f"id: {event['id']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
