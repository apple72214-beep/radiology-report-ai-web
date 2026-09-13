# hagar-radiology-ai

Enterprise AI Radiology Platform

## Shared analysis SSE event history

For a multi-worker deployment, set `HAGAR_ANALYSIS_EVENT_STORE_PATH` to a file on a **shared persistent filesystem** (for example a mounted volume visible to every API worker). The analysis SSE hub then persists event history and polls the shared store so a subscriber connected to Worker B can replay and receive events published by Worker A.

This filesystem-backed adapter is a transitional deployment option. For horizontally scaled production across independent containers/hosts, replace it with a shared event backend such as Redis Streams or PostgreSQL/outbox-backed event storage rather than relying on a local container filesystem.

## Cross-worker analysis idempotency

For a multi-worker deployment, set `ANALYSIS_IDEMPOTENCY_STORAGE_FILE` to a file on the same **shared persistent filesystem** used by every API worker. Completed `Idempotency-Key` results are stored there so a retry routed to another worker reuses the original response instead of starting a second analysis.

This filesystem-backed adapter is a transitional deployment option. For horizontally scaled production across independent containers/hosts, replace it with a shared transactional store such as PostgreSQL or Redis rather than relying on a local container filesystem.
