"""In-process SSE event bus with replayable history.

Transitional single-process adapter, consistent with the deployment
notes in the README: for multi-worker deployments replace with a shared
store (the ``HAGAR_ANALYSIS_EVENT_STORE_PATH`` pattern).
"""

from __future__ import annotations

import asyncio
import time
from collections import deque


class EventBus:
    def __init__(self, maxlen: int = 200) -> None:
        self._history: deque[dict] = deque(maxlen=maxlen)
        self._condition: asyncio.Condition | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    def _get_condition(self) -> asyncio.Condition:
        loop = asyncio.get_running_loop()
        if self._condition is None or self._loop is not loop:
            self._condition = asyncio.Condition()
            self._loop = loop
        return self._condition

    async def publish(self, **payload) -> dict:
        condition = self._get_condition()
        event = {"id": len(self._history) + 1, "time": round(time.time(), 3), **payload}
        async with condition:
            self._history.append(event)
            condition.notify_all()
        return event

    async def subscribe(self, last_event_id: int = 0):
        """Yield replayed history then live events forever."""
        while True:
            condition = self._get_condition()
            async with condition:
                pending = [e for e in self._history if e["id"] > last_event_id]
                if not pending:
                    await condition.wait()
                    continue
            for event in pending:
                last_event_id = event["id"]
                yield event


bus = EventBus()
