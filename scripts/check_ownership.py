"""Validate analysis run ownership before processing."""

from backend.analysis import AnalysisRun


def check_ownership(run: AnalysisRun, user_id: str) -> None:
    if not run.is_visible_to(user_id):
        raise PermissionError("Analysis run is not available")
