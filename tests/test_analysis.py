from backend.analysis import AnalysisRun


def test_owner_can_read_analysis():
    run = AnalysisRun(id="run-1", owner_id="user-1")
    assert run.is_visible_to("user-1")


def test_quarantined_analysis_fails_closed():
    run = AnalysisRun(id="run-1", owner_id="user-1", quarantined=True)
    assert not run.is_visible_to("user-1")


def test_non_owner_cannot_read_analysis():
    run = AnalysisRun(id="run-1", owner_id="user-1")
    assert not run.is_visible_to("user-2")
