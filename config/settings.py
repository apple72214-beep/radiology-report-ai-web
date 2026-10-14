"""Environment-based application settings."""

import os

ANALYSIS_EVENT_STORE_PATH = os.getenv(
    "HAGAR_ANALYSIS_EVENT_STORE_PATH",
    "/data/analysis-events.jsonl",
)

ANALYSIS_IDEMPOTENCY_STORAGE_FILE = os.getenv(
    "ANALYSIS_IDEMPOTENCY_STORAGE_FILE",
    "/data/idempotency.json",
)
