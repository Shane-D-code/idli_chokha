"""Thread-safe TTL cache for provider results.

A lightweight in-memory implementation with a pluggable shape so a shared
Redis/cache layer can be substituted later without changing provider code.
"""

from __future__ import annotations

import threading
import time
from typing import Optional

from src.providers.base import ProviderResult

DEFAULT_TTL_S = 300
DEFAULT_MAX_ENTRIES = 256


class TTLCache:
    """Bounded, TTL-expiring cache keyed by (provider name, query)."""

    def __init__(self, ttl_s: int = DEFAULT_TTL_S, max_entries: int = DEFAULT_MAX_ENTRIES):
        self.ttl_s = int(ttl_s)
        self.max_entries = max(0, int(max_entries))
        self._entries: dict[tuple[str, tuple], tuple[float, ProviderResult]] = {}
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    @staticmethod
    def _make_key(provider: str, query: dict) -> tuple[str, tuple]:
        items = sorted((str(k), repr(v)) for k, v in query.items())
        return provider, tuple(items)

    def _is_fresh(self, stored_at: float) -> bool:
        return (time.monotonic() - stored_at) < self.ttl_s

    def get(self, provider: str, query: dict) -> Optional[ProviderResult]:
        key = self._make_key(provider, query)
        with self._lock:
            hit = self._entries.get(key)
            if hit is None or not self._is_fresh(hit[0]):
                self._misses += 1
                return None
            self._hits += 1
            return hit[1]

    def set(self, provider: str, query: dict, result: ProviderResult):
        key = self._make_key(provider, query)
        with self._lock:
            self._entries[key] = (time.monotonic(), result)
            if self.max_entries and len(self._entries) > self.max_entries:
                # Evict oldest 20% by monotonic timestamp.
                stale = sorted(
                    self._entries.items(), key=lambda kv: kv[1][0]
                )[: max(1, int(self.max_entries * 0.2))]
                for k, _ in stale:
                    self._entries.pop(k, None)

    def clear(self):
        with self._lock:
            self._entries.clear()

    def stats(self) -> dict:
        with self._lock:
            return {
                "ttl_s": self.ttl_s,
                "max_entries": self.max_entries,
                "entries": len(self._entries),
                "hits": self._hits,
                "misses": self._misses,
            }

    def __repr__(self) -> str:  # pragma: no cover
        return f"<TTLCache entries={len(self._entries)} hits={self._hits} misses={self._misses}>"