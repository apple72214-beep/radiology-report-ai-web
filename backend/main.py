"""Application entry point."""

from fastapi import FastAPI

app = FastAPI(
    title="Radiology report AI",
    description="Enterprise AI Radiology Platform",
    version="0.1.0",
)


@app.get("/health")
def health_check():
    return {"status": "ok"}
