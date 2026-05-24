# Frontend Notes — Rev 5+6 Backend Changes

This document maps every backend change since the original Rev 4 frontend was
written to the frontend code that needs to be updated. Read this **before**
opening `frontend/src/`.

The frontend currently builds and runs cleanly against the new backend
because the API contracts kept legacy fields (`hiro_cumulative`,
`net_premium`, `cumulative`, etc.) for backward compatibility. Nothing is
*broken*. But to surface the new SpotGamma-aligned HIRO chart and the new
streaming features properly, several files need updates.

---

## 1. HIRO multi-line chart — biggest rework

**Backend change:** `compute_hiro` now emits the full SpotGamma four-line
breakdown per bucket (Total / Calls / Puts / 0DTE green line) using the
canonical **delta-notional** formula. Falls back to signed-premium when
delta is unavailable.

**Frontend today:** [HiroPanel.tsx](frontend/src/components/live/HiroPanel.tsx)
renders one line off `cumulative` (legacy signed premium scalar).

**What to update:**

### `frontend/src/lib/streamClient.ts:103-112`

Extend `HiroSeriesPoint` and `HiroPayload`:

```ts
export interface HiroSeriesPoint {
  ts: string;
  // Legacy fields (kept for backwards compat)
  call_premium?: number;
  put_premium?: number;
  net_premium?: number;
  cumulative?: number;
  // Rev 6 — canonical SpotGamma delta-notional fields
  call_delta_notional?: number;
  put_delta_notional?: number;
  net_delta_notional?: number;
  next_expiry_delta_notional?: number;
  next_expiry_premium?: number;
  weight_source?: "delta_notional" | "signed_premium";
  // Pre-Rev 6 the chart used `value`; new payload doesn't carry it but
  // legacy snapshots still might:
  value?: number;
}

export interface HiroPayload {
  bucket_size?: string;
  cumulative: number;
  series: HiroSeriesPoint[];
  weight_source?: "delta_notional" | "signed_premium" | "mixed";
}
```

### `frontend/src/components/live/HiroPanel.tsx`

Currently:
```ts
const series = payload?.series ?? [];
return series
  .filter((p) => p && Number.isFinite(p.value))    // ← reads legacy `value`
  .map((p) => ({ ts: p.ts, value: p.value }));
```

Becomes (renders four lines per SpotGamma spec):
```ts
const series = payload?.series ?? [];
return series.map((p) => {
  // Prefer canonical delta-notional. Fall back to signed-premium when
  // the bucket's weight_source is "signed_premium".
  const total = p.net_delta_notional ?? p.net_premium ?? p.value ?? 0;
  return {
    ts: p.ts,
    total,
    call: p.call_delta_notional ?? p.call_premium ?? 0,
    put:  p.put_delta_notional  ?? p.put_premium  ?? 0,
    nextExpiry: p.next_expiry_delta_notional ?? p.next_expiry_premium ?? 0,
  };
});
```

Then in the JSX add three more `<Line>` entries (orange for `call`, blue for
`put`, green for `nextExpiry`, current purple for `total`). Recharts handles
the multi-line legend automatically.

### Status badge — use `payload?.weight_source`

Show a small chip when `weight_source === "signed_premium"` to indicate
"approximate (no delta data)" — useful for operators when the chain feed is
slow.

---

## 2. Snapshot envelope — new fields

**Backend change:** `/v1/{symbol}/snapshot.data` gained two fields in Rev 6:

* `flow: FlowEvent[]` — the most-recent 50 flow events (same shape as `/flow`). Frontend can render a flow ticker without a second roundtrip.
* `hiro: HiroPayload` — full HIRO payload (bucket_size + series + cumulative + weight_source). Replaces the need for a second `/v1/{symbol}/hiro` call on `Live.tsx` mount.

**Where to update:** `frontend/src/lib/streamClient.ts:202-223` — `SnapshotData`
already has both fields declared (lines 214-215). They're just not consumed
anywhere yet. Wire them up in:

* `Live.tsx` — pass `data?.flow` to `FlowFeed` instead of (or alongside) the existing fetch
* `HiroPanel.tsx` — already receives `payload={data?.hiro}` so it just needs the multi-line update from §1

---

## 3. New WS endpoint `/v1/{symbol}/stream/ticks`

**Backend change:** Rev 5 added a high-frequency tick channel for raw
spot/futures prints (typed `{type: "tick", symbol, data: {...}}`).

**Frontend opportunity:** the existing snapshot stream pushes once per
pipeline tick (~60s). For an intraday "live ticker" that updates on every
ES print, subscribe to `/stream/ticks` separately.

**Suggested implementation:**

1. Add `useTickStream(symbol, apiKey)` hook in
   `frontend/src/lib/tickStreamClient.ts` (clone of the existing
   `streamClient.ts` reconnect / heartbeat logic).
2. Render a small "spot price + basis" pill on `Live.tsx` driven by the
   tick stream.
3. Per-key WS cap is 5 — sharing the budget between `/stream` and
   `/stream/ticks` means each user can have one of each plus a few
   reconnect attempts. Document this in user-facing docs.

---

## 4. Mid-stream revocation — close code 4401

**Backend change:** Rev 5 added an independent revocation watcher that
closes WS streams with code `4401` when the API key is deactivated/expired
mid-stream (every 30s on busy streams, was completely broken pre-Rev 5).

**Where to update:** `frontend/src/lib/streamClient.ts` reconnect handler.

Currently any close triggers reconnect. After Rev 5 the frontend should
distinguish `4401` from a transient network drop:

```ts
ws.onclose = (event) => {
  if (event.code === 4401) {
    // Auth was revoked mid-stream — don't auto-reconnect.
    // Toast: "API key revoked. Please re-enter your key."
    setStatus({ kind: "auth_revoked" });
    return;
  }
  // ...existing reconnect-with-backoff logic
};
```

`Login.tsx` already prompts for the API key — surface the toast and
re-route the user there.

---

## 5. Snapshot prime cache — already free

**Backend change:** Rev 6 added a 10s TTL cache around
`build_snapshot_payload`. Pipeline writes through after every successful
tick.

**Frontend impact:** none — the cache is transparent. WS connect /
reconnect storms (e.g. after a deploy) no longer hammer the DB. Document
in user-facing docs that "reconnects are cheap" so the frontend doesn't
need to add its own debounce.

---

## 6. Admin dashboard — `GET /admin/metrics`

**Backend change:** Rev 6 added a Prometheus-style text exposition at
`/admin/metrics` (JWT-protected, same auth as the rest of `/admin/*`).

**Frontend opportunity:** none required — this endpoint targets external
Prometheus scrapers. But you could surface a small "Metrics" tab on
`SystemStatus.tsx` that links to `/admin/metrics?token=<jwt>` for power
users who want raw gauges.

---

## 7. Future-proofing checklist before frontend redesign

When you start the frontend pass, make sure these contracts are stable:

- [ ] `data.spot.source` ∈ `{"futures_basis", "parity", "stale_cache"}` — three states need three colours
- [ ] `data.hiro.weight_source` ∈ `{"delta_notional", "signed_premium", "mixed"}` — surface as a chip
- [ ] `data.session_state.is_rth` controls a banner — already wired
- [ ] `data.zero_gamma` may be `null` — render "—" instead of throwing
- [ ] Flow events have `event_type` ∈ `{"SWEEP", "BLOCK", "UOA"}` — distinct icons + tooltip
- [ ] WS close `4401` → "auth revoked" toast + redirect to Login
- [ ] DataInspector `chain_quality` already works; just confirm it still queries via `/admin/inspector` after the Rev 5 chain_quality bound was tightened

---

## 8. Files I haven't re-read but flagging for review when you redesign

| File | Why look |
|------|----------|
| `frontend/src/components/live/GexChart.tsx` | GEX payload shape is unchanged but `weight_source` is new |
| `frontend/src/components/live/RegimeBadge.tsx` | Unchanged — no rework needed |
| `frontend/src/components/live/FlowFeed.tsx` | Now has access to `data?.flow` from snapshot — can drop the dedicated `/flow` fetch on mount |
| `frontend/src/pages/Live.tsx` | Wire the new fields above |
| `frontend/src/pages/ZeroDte.tsx` | Unchanged contracts — but verify `zero_dte.flip_speed` still renders if `null` |
| `frontend/src/pages/SystemStatus.tsx` | Same shape; consider adding a "metrics URL" link |
| `frontend/src/pages/DataInspector.tsx` | The ingester diagnostics block has new fields (`active_key_label`, `dropped_no_ts_count`) — surface them |
| `frontend/src/pages/DatabentoKeys.tsx` | No change in shape, but the description should mention `DB_ENCRYPTION_KEY` (rotation invalidates the pool — see OPS.md §3) |
