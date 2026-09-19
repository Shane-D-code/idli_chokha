"""Provider-layer tests: timeout, retry/backoff, cache, staleness and failure
isolation. The base layer must never raise and never fabricate substitute data;
every expected failure maps to an explicit ProviderResult status."""

from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from src.core.schema import ProviderStatus
from src.providers.base import (
    BaseProvider,
    FetchOutcome,
    ProviderError,
    ProviderNotAvailable,
)
from src.providers.cache import TTLCache
from src.providers.registry import ProviderRegistry


class FakeProvider(BaseProvider):
    """Concrete provider whose behavior is injected via a callable."""

    def __init__(self, fetch_fn, *, available: bool = True, name: str = "fake", **kwargs):
        super().__init__(**kwargs)
        self.name = name
        self.dataset = "fake_dataset"
        self.source_path = "fake/source/path"
        self._fetch_fn = fetch_fn
        self._available = available

    def is_available(self) -> bool:
        return self._available

    def _fetch(self, query: dict) -> FetchOutcome:
        return self._fetch_fn(query)


def _ok(query):
    return FetchOutcome(data={"echo": query})


class TestStatusCodeMapping:
    def test_available_fetch(self):
        provider = FakeProvider(_ok)
        result = provider.fetch({"storm": "X"})
        assert result.status == ProviderStatus.AVAILABLE
        assert result.data == {"echo": {"storm": "X"}}
        assert not result.from_cache
        assert result.latency_ms >= 0
        assert result.source_path == "fake/source/path"
        assert result.dataset == "fake_dataset"

    def test_unavailable_when_no_source_configured(self):
        provider = FakeProvider(_ok, available=False)
        result = provider.fetch({})
        assert result.status == ProviderStatus.NOT_AVAILABLE
        assert result.data is None
        assert "no real source" in result.detail

    def test_provider_not_available_raised_by_fetch(self):
        def fn(query):
            raise ProviderNotAvailable("no real source configured in this deployment")

        provider = FakeProvider(fn)
        result = provider.fetch({})
        assert result.status == ProviderStatus.NOT_AVAILABLE
        assert result.data is None

    def test_degraded_partial_data(self):
        def fn(query):
            return FetchOutcome(data="partial", degraded=True, warnings=["missing bands"])

        provider = FakeProvider(fn)
        result = provider.fetch({})
        assert result.status == ProviderStatus.DEGRADED
        assert result.data == "partial"
        assert "missing bands" in result.detail

    def test_degraded_no_warnings_gets_generic_detail(self):
        def fn(query):
            return FetchOutcome(data="x", degraded=True)

        provider = FakeProvider(fn)
        result = provider.fetch({})
        assert result.status == ProviderStatus.DEGRADED
        assert result.detail


class TestRetryAndTimeout:
    def test_retry_transient_then_success_with_backoff(self):
        calls = {"n": 0}
        sleeps = []

        def fn(query):
            calls["n"] += 1
            if calls["n"] < 3:
                raise ProviderError("transient", retryable=True)
            return FetchOutcome(data="ok")

        def noop_sleep(seconds):
            sleeps.append(seconds)

        with patch("src.providers.base.time.sleep", noop_sleep):
            provider = FakeProvider(fn, max_retries=2)
            result = provider.fetch({})

        assert result.status == ProviderStatus.AVAILABLE
        assert result.data == "ok"
        assert calls["n"] == 3
        # exponential backoff: 0.5 * 2^0, 0.5 * 2^1
        assert sleeps == [0.5, 1.0]

    def test_retries_exhausted_returns_error(self):
        calls = {"n": 0}

        def fn(query):
            calls["n"] += 1
            raise ProviderError("still transient", retryable=True)

        with patch("src.providers.base.time.sleep", lambda s: None):
            provider = FakeProvider(fn, max_retries=2)
            result = provider.fetch({})

        assert result.status == ProviderStatus.ERROR
        assert result.data is None
        assert calls["n"] == 3
        assert "fetch failed" in result.detail

    def test_non_retryable_failure_is_not_retried(self):
        calls = {"n": 0}

        def fn(query):
            calls["n"] += 1
            raise ProviderError("permanent", retryable=False)

        with patch("src.providers.base.time.sleep", lambda s: None):
            provider = FakeProvider(fn)
            result = provider.fetch({})

        assert result.status == ProviderStatus.ERROR
        assert calls["n"] == 1

    def test_unexpected_exception_becomes_error_never_raises(self):
        def fn(query):
            raise RuntimeError("boom")

        with patch("src.providers.base.time.sleep", lambda s: None):
            provider = FakeProvider(fn)
            result = provider.fetch({})

        assert result.status == ProviderStatus.ERROR
        assert "RuntimeError" in result.detail

    def test_timeout_produces_error_with_details(self):
        release = threading.Event()

        def slow(query):
            release.wait(timeout=5)
            return FetchOutcome(data="late")

        with patch("src.providers.base.time.sleep", lambda s: None):
            provider = FakeProvider(slow, timeout_ms=10, max_retries=1)
            result = provider.fetch({})
            release.set()

        assert result.status == ProviderStatus.ERROR
        assert result.data is None
        assert "timeout" in result.detail.lower()

    def test_boundary_attempts_zero(self):
        calls = {"n": 0}

        def fn(query):
            calls["n"] += 1
            raise ProviderError("boom", retryable=True)

        with patch("src.providers.base.time.sleep", lambda s: None):
            provider = FakeProvider(fn, max_retries=0)
            result = provider.fetch({})

        assert result.status == ProviderStatus.ERROR
        assert calls["n"] == 1


class TestCache:
    def test_cache_hit_skips_fetch(self):
        calls = {"n": 0}

        def fn(query):
            calls["n"] += 1
            return FetchOutcome(data={"call": calls["n"]})

        provider = FakeProvider(fn)
        cache = TTLCache()

        first = provider.fetch({"a": 1}, cache=cache)
        second = provider.fetch({"a": 1}, cache=cache)

        assert calls["n"] == 1
        assert first.from_cache is False
        assert second.from_cache is True
        assert first.data == second.data
        assert cache.stats()["hits"] == 1
        assert cache.stats()["misses"] == 1

    def test_cache_key_differs_by_query(self):
        calls = {"n": 0}

        def fn(query):
            calls["n"] += 1
            return FetchOutcome(data=query)

        provider = FakeProvider(fn)
        cache = TTLCache()
        provider.fetch({"a": 1}, cache=cache)
        provider.fetch({"a": 2}, cache=cache)

        assert calls["n"] == 2
        assert cache.stats()["misses"] == 2

    def test_ttl_expiry_refetches(self):
        calls = {"n": 0}

        def fn(query):
            calls["n"] += 1
            return FetchOutcome(data=calls["n"])

        provider = FakeProvider(fn)
        # A zero-TTL cache is always expired -> every fetch is a miss.
        cache = TTLCache(ttl_s=0)
        provider.fetch({"a": 1}, cache=cache)
        provider.fetch({"a": 1}, cache=cache)

        assert calls["n"] == 2

    def test_use_cache_disabled(self):
        calls = {"n": 0}

        def fn(query):
            calls["n"] += 1
            return FetchOutcome(data=1)

        provider = FakeProvider(fn)
        cache = TTLCache()
        provider.fetch({"a": 1}, cache=cache)
        provider.fetch({"a": 1}, cache=cache, use_cache=False)

        assert calls["n"] == 2


class TestStaleness:
    def test_stale_when_observation_beyond_threshold(self):
        stale_observation = datetime.now(timezone.utc) - timedelta(hours=48)

        def fn(query):
            return FetchOutcome(data="old", observation_timestamp=stale_observation)

        provider = FakeProvider(fn, stale_after_s=3600)
        result = provider.fetch({})

        assert result.is_stale is True
        assert any("stale" in warning for warning in result.warnings)

    def test_fresh_when_within_threshold(self):
        def fn(query):
            return FetchOutcome(
                data="fresh",
                observation_timestamp=datetime.now(timezone.utc),
            )

        provider = FakeProvider(fn, stale_after_s=3600)
        result = provider.fetch({})

        assert result.is_stale is False

    def test_cached_stale_flag_computed_on_hit(self):
        stale_observation = datetime.now(timezone.utc) - timedelta(hours=48)

        def fn(query):
            return FetchOutcome(data="old", observation_timestamp=stale_observation)

        provider = FakeProvider(fn, stale_after_s=3600)
        cache = TTLCache(ttl_s=3600)
        first = provider.fetch({}, cache=cache)
        cached = provider.fetch({}, cache=cache)

        assert first.is_stale is True
        assert cached.from_cache is True
        assert cached.is_stale is True


class TestFailureIsolation:
    def test_broken_provider_does_not_affect_good_provider(self):
        def fn(query):
            raise ProviderError("boom", retryable=True)

        good = FakeProvider(_ok, name="good")
        bad = FakeProvider(fn, name="bad", max_retries=1)

        with patch("src.providers.base.time.sleep", lambda s: None):
            good_result = good.fetch({})
            bad_result = bad.fetch({})

        assert good_result.status == ProviderStatus.AVAILABLE
        assert bad_result.status == ProviderStatus.ERROR

    def test_registry_snapshot_survives_broken_member(self):
        registry = ProviderRegistry()
        registry.register(FakeProvider(_ok, name="good"))
        registry.register(
            FakeProvider(lambda q: (_ for _ in ()).throw(ProviderError("boom")),
                         name="bad", max_retries=1)
        )

        assert registry.names() == ["good", "bad"]
        snapshot = registry.availabilities()
        assert set(snapshot) == {"good", "bad"}
        assert snapshot["bad"]["available"] is True

    def test_registry_rejects_duplicate_name(self):
        registry = ProviderRegistry()
        registry.register(FakeProvider(_ok, name="dup"))
        with pytest.raises(ValueError):
            registry.register(FakeProvider(_ok, name="dup"))