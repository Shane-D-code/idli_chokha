"""Base abstractions for the TOOFAN data-provider layer.

Design rules
------------
* ``fetch()`` NEVER raises for expected failures — it returns a
  ``ProviderResult`` with an explicit status.
* ``NOT_AVAILABLE`` means "no real source in this deployment". Providers do
  not fabricate substitute data to fill that gap.
* ``DEGRADED`` means the source exists but returned partial or stale data,
  with reasons attached.
* ``ERROR`` means the source exists but failed (exception, timeout, invalid
  payload) after retries.
* Timeouts, bounded retries with exponential backoff, caching and staleness
  tracking are handled here so concrete providers stay small and honest.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as _FutureTimeoutError
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Optional

from src.core.schema import ProviderSource, ProviderStatus

DEFAULT_TIMEOUT_MS = 15_000
DEFAULT_MAX_RETRIES = 2
RETRY_BACKOFF_S = 0.5


def _age_s(timestamp: datetime) -> float:
    """Seconds since ``timestamp``, tolerant of aware/naive mixups.

    The rest of the provider layer uses naive-UTC ``datetime.utcnow()``, but
    real observations may carry a tzinfo; normalize before subtracting so
    staleness checks never raise ``TypeError``.
    """
    if timestamp.tzinfo is not None:
        timestamp = timestamp.astimezone(timezone.utc).replace(tzinfo=None)
    return (datetime.utcnow() - timestamp).total_seconds()


class ProviderError(Exception):
    """Raised by ``_fetch`` for a transient or invalid-result failure."""

    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class ProviderNotAvailable(Exception):
    """Raised by ``_fetch`` when no real source exists for the query."""


@dataclass
class FetchOutcome:
    """Internal result returned by ``_fetch`` implementations.

    Concrete providers do the low-level work (file/API/archive reads) and
    describe the outcome; the base layer derives the public ``ProviderResult``.
    """
    data: Any = None
    degraded: bool = False
    warnings: list[str] = field(default_factory=list)
    observation_timestamp: datetime | None = None
    source_path: str | None = None
    dataset: str | None = None


@dataclass
class ProviderResult:
    """Public result of a provider fetch (never raises)."""
    provider: str
    status: ProviderStatus
    data: Any = None
    detail: str | None = None
    latency_ms: float = 0.0
    retrieved_at: datetime = field(default_factory=datetime.utcnow)
    observation_timestamp: datetime | None = None
    is_stale: bool = False
    warnings: list[str] = field(default_factory=list)
    from_cache: bool = False
    source_path: str | None = None
    dataset: str | None = None

    def to_source(self) -> ProviderSource:
        """Convert to the provenance schema attached to every pipeline run."""
        return ProviderSource(
            name=self.provider,
            dataset=self.dataset,
            source_path=self.source_path,
            retrieved_at=self.retrieved_at,
            observation_timestamp=self.observation_timestamp,
            is_stale=self.is_stale,
            latency_ms=self.latency_ms,
            status=self.status,
            warnings=self.warnings,
            detail=self.detail,
        )


class BaseProvider(ABC):
    """Uniform, honest interface every data provider implements."""

    name: str
    dataset: str
    source_path: str | None = None

    def __init__(
        self,
        *,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_backoff_s: float = RETRY_BACKOFF_S,
        stale_after_s: float | None = None,
    ):
        self.timeout_ms = int(timeout_ms)
        self.max_retries = int(max_retries)
        self.retry_backoff_s = float(retry_backoff_s)
        self.stale_after_s = stale_after_s

    # -- to implement ---------------------------------------------------------

    @abstractmethod
    def _fetch(self, query: dict) -> FetchOutcome:
        """Fetch and validate data for ``query``.

        Must never raise for expected outcomes: return a ``FetchOutcome``
        (possibly ``degraded=True``) instead. ``ProviderNotAvailable``
        declares an absent source; ``ProviderError`` declares a failed fetch
        (``retryable`` controls whether the base layer retries).
        """

    def is_available(self) -> bool:
        """Whether a real source exists in this deployment. Default: yes."""
        return True

    def observation_time(self, query: dict, data: Any) -> datetime | None:
        """Reference time of the fetched data, when known."""
        return None

    # -- public contract (timeout / retry / cache / status) --------------------

    def fetch(
        self,
        query: dict | None = None,
        *,
        use_cache: bool = True,
        cache: "TTLCache | None" = None,
    ) -> ProviderResult:
        """Fetch data for ``query``.

        Precedence: cache hit -> NOT_AVAILABLE (no source) -> fetch with
        timeout + retries -> AVAILABLE/DEGRADED/ERROR result. Never raises for
        expected failures.
        """
        start = time.perf_counter()
        q = dict(query or {})

        if use_cache and cache is not None:
            cached = cache.get(self.name, q)
            if cached is not None:
                # Copy the cached result before marking it so later hits never
                # mutate the object already handed to earlier callers.
                snapshot = replace(cached)
                if self.stale_after_s and snapshot.observation_timestamp is not None:
                    age_s = _age_s(snapshot.observation_timestamp)
                    snapshot.is_stale = age_s > self.stale_after_s
                    if snapshot.is_stale and snapshot.warnings is None:
                        snapshot.warnings = []
                    if snapshot.is_stale:
                        snapshot.warnings.append("observation older than staleness threshold")
                snapshot.from_cache = True
                return snapshot

        if not self.is_available():
            return self._result(
                ProviderStatus.NOT_AVAILABLE,
                None,
                f"{self.name}: no real source configured in this deployment",
                start,
                observation_timestamp=self.observation_time(q, None),
            )

        last_detail: str | None = None
        attempts = max(0, self.max_retries) + 1
        for attempt in range(attempts):
            try:
                outcome = self._run_with_timeout(q)
                latency_ms = (time.perf_counter() - start) * 1000.0
                obs = outcome.observation_timestamp or self.observation_time(q, outcome.data)
                status = ProviderStatus.DEGRADED if outcome.degraded else ProviderStatus.AVAILABLE
                stale = bool(
                    self.stale_after_s
                    and obs is not None
                    and _age_s(obs) > self.stale_after_s
                )
                result = ProviderResult(
                    provider=self.name,
                    status=status,
                    data=outcome.data,
                    latency_ms=latency_ms,
                    observation_timestamp=obs,
                    is_stale=stale,
                    warnings=outcome.warnings,
                    source_path=outcome.source_path or self.source_path,
                    dataset=outcome.dataset or self.dataset,
                )
                if outcome.degraded:
                    result.detail = "; ".join(outcome.warnings) if outcome.warnings else "partial data"
                if stale:
                    result.warnings.append("observation older than staleness threshold")
                if use_cache and cache is not None:
                    cache.set(self.name, q, result)
                return result

            except ProviderNotAvailable as e:
                return self._result(
                    ProviderStatus.NOT_AVAILABLE,
                    None,
                    str(e) or f"{self.name}: source not available",
                    start,
                )
            except ProviderError as e:
                last_detail = str(e)
                if not e.retryable or attempt >= attempts - 1:
                    break
                time.sleep(self.retry_backoff_s * (2 ** attempt))
            except Exception as e:  # defensive: unexpected failure -> ERROR
                last_detail = f"{type(e).__name__}: {e}"
                break

        return self._result(
            ProviderStatus.ERROR,
            None,
            f"{self.name}: fetch failed after {attempts} attempt(s): {last_detail}",
            start,
        )

    # -- internals -------------------------------------------------------------

    def _run_with_timeout(self, query: dict) -> FetchOutcome:
        if self.timeout_ms <= 0:
            return self._fetch(query)
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(self._fetch, query)
            try:
                return future.result(timeout=self.timeout_ms / 1000.0)
            except _FutureTimeoutError:
                raise ProviderError(
                    f"{self.name}: timeout after {self.timeout_ms} ms", retryable=True
                )

    def _result(
        self,
        status: ProviderStatus,
        data: Any,
        detail: str | None,
        start: float,
        observation_timestamp: datetime | None = None,
    ) -> ProviderResult:
        return ProviderResult(
            provider=self.name,
            status=status,
            data=data,
            detail=detail,
            latency_ms=(time.perf_counter() - start) * 1000.0,
            observation_timestamp=observation_timestamp,
            source_path=self.source_path,
            dataset=self.dataset,
        )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return (f"<{type(self).__name__} name={self.name!r} "
                f"source={self.source_path!r} available={self.is_available()}>")