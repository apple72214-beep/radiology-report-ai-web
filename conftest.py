"""Shared fixtures for isolated analysis tests."""

import pytest


@pytest.fixture
def event_store_path(tmp_path, monkeypatch):
    path = tmp_path / "analysis-events.jsonl"
    monkeypatch.setenv("HAGAR_ANALYSIS_EVENT_STORE_PATH", str(path))
    return path
