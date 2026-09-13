# hagar-radiology-ai — metadata from Arena preview
Owner: dhrajar2-ship-it | Repo: hagar-radiology-ai (Private) | Branch: main

## Recent commits
- `a2db30b` Security: harden AnalysisRun ownership checks (3 hours ago)
- `e8196c2` test: enforce fail-closed reads for quarantined studies (18 hours ago)
- `8f4a1de` Security: harden AnalysisRun quarantine handling (2 days ago)
- `57cd208` Implement canonical AnalysisRun ownership (5 days ago)
- `32ba4f1` test: make FileBacked isolation harness deterministic (last week)

## Open pull requests
- #42 Security: harden AnalysisRun ownership checks — branch `security/analysis-ownership` (+128/-34, 3 hours ago)
- #41 test: enforce fail-closed reads for quarantined studies — branch `test/quarantine-isolation` (+86/-12, 18 hours ago)
- #39 Add shared analysis SSE event history — branch `feature/shared-events` (+246/-48, 2 days ago)
- #37 Implement canonical AnalysisRun ownership — branch `feature/analysis-owner` (+94/-26, 5 days ago)
- #35 feat: add archive upload controls to dashboard — branch `feature/archive-upload` (+172/-19, 2 weeks ago)

## Open issues
- #18 [enhancement] Move analysis event storage to a shared backend

  Replace the transitional filesystem-backed event adapter with Redis Streams or a PostgreSQL outbox. Event history should be replayable across independent API workers without relying on a shared local volume.
