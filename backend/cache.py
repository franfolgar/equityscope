"""Caché en memoria con TTL y bloqueo por clave (evita consultas duplicadas)."""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Optional


class TTLCache:
    def __init__(
        self,
        ttl_seconds: float,
        max_items: int = 256,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.ttl = ttl_seconds
        self.max_items = max_items
        self._clock = clock
        self._items: dict[str, tuple[float, Any]] = {}
        self._guard = threading.Lock()
        # Un lock por clave mientras alguien la está creando (con contador de
        # usuarios), para que solo esperen las peticiones del mismo ticker.
        self._key_locks: dict[str, tuple[threading.Lock, int]] = {}

    def get(self, key: str) -> Optional[Any]:
        with self._guard:
            entry = self._items.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at <= self._clock():
                del self._items[key]
                return None
            return value

    def set(self, key: str, value: Any) -> None:
        with self._guard:
            now = self._clock()
            if len(self._items) >= self.max_items:
                self._items = {k: v for k, v in self._items.items() if v[0] > now}
            while len(self._items) >= self.max_items:
                oldest = min(self._items, key=lambda k: self._items[k][0])
                del self._items[oldest]
            self._items[key] = (now + self.ttl, value)

    def get_or_create(self, key: str, factory: Callable[[], Any]) -> Any:
        """Devuelve el valor cacheado o lo crea. Las excepciones no se cachean."""
        cached = self.get(key)
        if cached is not None:
            return cached
        with self._guard:
            lock, users = self._key_locks.get(key, (None, 0))
            if lock is None:
                lock = threading.Lock()
            self._key_locks[key] = (lock, users + 1)
        try:
            with lock:
                cached = self.get(key)
                if cached is not None:
                    return cached
                value = factory()
                self.set(key, value)
                return value
        finally:
            with self._guard:
                lock, users = self._key_locks[key]
                if users == 1:
                    del self._key_locks[key]
                else:
                    self._key_locks[key] = (lock, users - 1)
