"""Application entry point."""

from dataclasses import asdict
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from . import studies
from .render import PRESETS, render_png

app = FastAPI(
    title="Radiology report AI",
    description="Enterprise AI Radiology Platform",
    version="0.2.0",
)

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/")
def viewer():
    """Built-in, offline-friendly study worklist and viewer."""
    return FileResponse(FRONTEND / "viewer.html", media_type="text/html")


@app.post("/studies/upload", status_code=201)
async def upload_studies(files: list[UploadFile] = File(...)):
    payload = [(f.filename or "instance.dcm", await f.read()) for f in files]
    if not payload:
        raise HTTPException(status_code=400, detail="No files provided")
    created = studies.ingest(owner_id="anonymous", files=payload)
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
