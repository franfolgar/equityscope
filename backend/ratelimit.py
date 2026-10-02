"""Limitador de peticiones de ventana deslizante, en memoria."""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Callable


class SlidingWindowLimiter:
    def __init__(
        self,
        max_requests: int,
        window_seconds: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_requests = max_requests
        self.window = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = self._clock()
        cutoff = now - self.window
        with self._lock:
            if len(self._hits) > 10_000:
                self._hits = {
                    k: q for k, q in self._hits.items() if q and q[-1] > cutoff
                }
            queue = self._hits.setdefault(key, deque())
            while queue and queue[0] <= cutoff:
                queue.popleft()
            if len(queue) >= self.max_requests:
                return False
            queue.append(now)
            return True


def allow_analysis_request(
    per_ip_limiter: SlidingWindowLimiter,
    global_limiter: SlidingWindowLimiter,
    client_key: str,
) -> bool:
    """Rechaza primero por IP para no gastar cuota global en peticiones bloqueadas."""
    if not per_ip_limiter.allow(client_key):
        return False
    return global_limiter.allow("global")
