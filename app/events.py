"""In-memory pub/sub for SSE progress updates per job."""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def publish(self, job_id: str, event: dict[str, Any]) -> None:
        async with self._lock:
            queues = list(self._subscribers.get(job_id, ()))
        for q in queues:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

    async def subscribe(self, job_id: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=64)
        async with self._lock:
            self._subscribers[job_id].add(q)
        return q

    async def unsubscribe(self, job_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            self._subscribers[job_id].discard(q)
            if not self._subscribers[job_id]:
                self._subscribers.pop(job_id, None)


bus = EventBus()
