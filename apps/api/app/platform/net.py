"""Network access for platform code. Everything goes through the shared SSRF-safe Fetcher; tests swap the
factory for one backed by the mocked internet."""

from __future__ import annotations

from collections.abc import Callable

from app.services.fetcher import Fetcher

_factory: Callable[[], Fetcher] | None = None


def new_fetcher() -> Fetcher:
    """A fresh Fetcher for request-scoped work (agent tests, connection tests). Caller closes it."""
    return _factory() if _factory is not None else Fetcher()


def set_fetcher_factory(factory: Callable[[], Fetcher] | None) -> None:
    global _factory
    _factory = factory
