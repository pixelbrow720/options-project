"""Snapshot prime cache TTL + write-through invariants.

Pins the contract for the in-memory cache populated by the pipeline tick
and consumed by the WS / SSE primer (Rev 6 #5):

* ``set_cached_snapshot`` then ``get_cached_snapshot`` returns the value
  while inside the TTL window.
* Once the monotonic clock advances past the TTL the cache returns None
  and evicts the entry.
* Different symbol keys are isolated.
* Write-through: the pipeline-side ``set_cached_snapshot`` produces a
  fresh entry that the streaming primer reads.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.api.endpoints import snapshot as snapshot_mod


@pytest.fixture(autouse=True)
def _reset_cache():
    snapshot_mod.reset_snapshot_cache_for_tests()
    yield
    snapshot_mod.reset_snapshot_cache_for_tests()


def _patch_monotonic(monkeypatch: pytest.MonkeyPatch, value: float) -> None:
    import time as time_mod

    monkeypatch.setattr(time_mod, "monotonic", lambda: value)


def test_set_then_get_within_ttl_returns_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_monotonic(monkeypatch, 1000.0)
    payload = {"gex": {"net_total": 1.0}}
    computed_at = datetime(2026, 5, 1, 12, 0, tzinfo=UTC)
    snapshot_mod.set_cached_snapshot("SPXW", payload, computed_at)

    _patch_monotonic(monkeypatch, 1005.0)
    cached = snapshot_mod.get_cached_snapshot("SPXW")

    assert cached is not None
    got_payload, got_at = cached
    assert got_payload == payload
    assert got_at == computed_at


def test_get_after_ttl_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_monotonic(monkeypatch, 2000.0)
    snapshot_mod.set_cached_snapshot("SPXW", {"gex": {}}, None)

    _patch_monotonic(
        monkeypatch, 2000.0 + snapshot_mod._SNAPSHOT_CACHE_TTL_SECONDS + 0.01
    )
    assert snapshot_mod.get_cached_snapshot("SPXW") is None


def test_get_after_ttl_evicts_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_monotonic(monkeypatch, 3000.0)
    snapshot_mod.set_cached_snapshot("SPXW", {"gex": {}}, None)
    assert "SPXW" in snapshot_mod._snapshot_cache

    _patch_monotonic(
        monkeypatch, 3000.0 + snapshot_mod._SNAPSHOT_CACHE_TTL_SECONDS + 1.0
    )
    snapshot_mod.get_cached_snapshot("SPXW")
    assert "SPXW" not in snapshot_mod._snapshot_cache


def test_different_symbol_keys_are_isolated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_monotonic(monkeypatch, 4000.0)
    snapshot_mod.set_cached_snapshot("SPXW", {"gex": {"net_total": 1.0}}, None)
    snapshot_mod.set_cached_snapshot("NDXP", {"gex": {"net_total": 2.0}}, None)

    spxw = snapshot_mod.get_cached_snapshot("SPXW")
    ndxp = snapshot_mod.get_cached_snapshot("NDXP")

    assert spxw is not None and spxw[0]["gex"]["net_total"] == 1.0
    assert ndxp is not None and ndxp[0]["gex"]["net_total"] == 2.0


def test_symbol_lookup_is_case_insensitive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_monotonic(monkeypatch, 5000.0)
    snapshot_mod.set_cached_snapshot("spxw", {"gex": {}}, None)
    assert snapshot_mod.get_cached_snapshot("SPXW") is not None
    assert snapshot_mod.get_cached_snapshot("SpXw") is not None


def test_write_through_overwrites_stale_entry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_monotonic(monkeypatch, 6000.0)
    first_at = datetime(2026, 5, 1, 12, 0, tzinfo=UTC)
    snapshot_mod.set_cached_snapshot("SPXW", {"v": 1}, first_at)

    _patch_monotonic(monkeypatch, 6005.0)
    second_at = datetime(2026, 5, 1, 12, 1, tzinfo=UTC)
    snapshot_mod.set_cached_snapshot("SPXW", {"v": 2}, second_at)

    cached = snapshot_mod.get_cached_snapshot("SPXW")
    assert cached is not None
    payload, computed_at = cached
    assert payload == {"v": 2}
    assert computed_at == second_at


def test_get_on_unset_symbol_returns_none() -> None:
    assert snapshot_mod.get_cached_snapshot("SPXW") is None


def test_reset_clears_all_entries(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_monotonic(monkeypatch, 7000.0)
    snapshot_mod.set_cached_snapshot("SPXW", {}, None)
    snapshot_mod.set_cached_snapshot("NDXP", {}, None)
    snapshot_mod.reset_snapshot_cache_for_tests()
    assert snapshot_mod.get_cached_snapshot("SPXW") is None
    assert snapshot_mod.get_cached_snapshot("NDXP") is None
