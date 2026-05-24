"""Pull a real SPX/SPXW snapshot from Databento for Friday 2026-05-22 close
and emit a JSON document the frontend fixture can consume.

Usage:
    python scripts/pull_friday_snapshot.py

Reads keys from pantek-waang-main/.env (DATABENTO_API_KEY_OPRA, _GLOBEX).

Cost guardrail: queries `metadata.get_cost` before each pull and aborts
if the estimate is above $2 total. The script is read-only.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / "pantek-waang-main" / ".env"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


ENV = load_env(ENV_PATH)
KEY_OPRA = ENV.get("DATABENTO_API_KEY_OPRA") or ENV.get("DATABENTO_API_KEY")
KEY_GLBX = ENV.get("DATABENTO_API_KEY_GLOBEX") or ENV.get("DATABENTO_API_KEY")

if not KEY_OPRA:
    print("ERROR: DATABENTO_API_KEY_OPRA missing in .env", file=sys.stderr)
    sys.exit(1)

import databento as db  # noqa: E402

# ---- Targets ---------------------------------------------------------------
# Friday 2026-05-22, US Eastern close at 16:00 ET = 20:00 UTC (DST).
FRIDAY_CLOSE_UTC = datetime(2026, 5, 22, 20, 0, 0, tzinfo=UTC)
QUOTE_WINDOW_MINUTES = 3  # last 3 min of RTH (full SPXW chain via cmbp-1 is huge)
DEF_LOOKBACK_DAYS = 5
COST_LIMIT_USD = 2.0
OUT_PATH = ROOT / "pantek-waang-main" / "frontend" / "src" / "lib" / "fixtureSnapshotData.json"


def _print(msg: str) -> None:
    print(msg, flush=True)


def _scale_price(value):
    if value is None or pd.isna(value):
        return None
    f = float(value)
    if abs(f) > 1e6:
        f /= 1e9
    return f


def fetch_definition(client: db.Historical, parent: str) -> pd.DataFrame:
    end = FRIDAY_CLOSE_UTC
    start = end - timedelta(days=DEF_LOOKBACK_DAYS)
    _print(f"[def] cost check {parent} {start.date()}..{end.date()} ...")
    cost = client.metadata.get_cost(
        dataset="OPRA.PILLAR",
        symbols=[parent],
        stype_in="parent",
        schema="definition",
        start=start.isoformat(),
        end=end.isoformat(),
    )
    _print(f"[def] est cost ${cost:.4f}")
    if cost > COST_LIMIT_USD:
        raise RuntimeError(f"definition cost ${cost} exceeds ${COST_LIMIT_USD}")

    data = client.timeseries.get_range(
        dataset="OPRA.PILLAR",
        symbols=[parent],
        stype_in="parent",
        schema="definition",
        start=start.isoformat(),
        end=end.isoformat(),
    )
    df = data.to_df()
    _print(f"[def] {len(df)} rows")
    return df


def fetch_quotes(client: db.Historical, parent: str) -> pd.DataFrame:
    end = FRIDAY_CLOSE_UTC
    start = end - timedelta(minutes=QUOTE_WINDOW_MINUTES)
    _print(f"[quotes] cost check {parent} window={QUOTE_WINDOW_MINUTES}m ...")
    cost = client.metadata.get_cost(
        dataset="OPRA.PILLAR",
        symbols=[parent],
        stype_in="parent",
        schema="cmbp-1",
        start=start.isoformat(),
        end=end.isoformat(),
    )
    _print(f"[quotes] est cost ${cost:.4f}")
    if cost > COST_LIMIT_USD:
        raise RuntimeError(f"quotes cost ${cost} exceeds ${COST_LIMIT_USD}")

    # Stream to disk via batch.submit_job? simpler: timeseries.get_range with longer timeout via DBN buffer.
    raw_path = OUT_PATH.parent / "quotes.dbn.zst"
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    _print(f"[quotes] downloading raw DBN to {raw_path} ...")
    client.timeseries.get_range(
        dataset="OPRA.PILLAR",
        symbols=[parent],
        stype_in="parent",
        schema="cmbp-1",
        start=start.isoformat(),
        end=end.isoformat(),
        path=str(raw_path),
    )
    _print(f"[quotes] decoding ...")
    data = db.DBNStore.from_file(str(raw_path))
    df = data.to_df()
    _print(f"[quotes] {len(df)} rows")
    return df


def fetch_es_close(client: db.Historical) -> dict:
    end = FRIDAY_CLOSE_UTC + timedelta(minutes=5)
    start = FRIDAY_CLOSE_UTC - timedelta(minutes=5)
    _print(f"[es] fetching ES front-month around {FRIDAY_CLOSE_UTC} ...")
    cost = client.metadata.get_cost(
        dataset="GLBX.MDP3",
        symbols=["ES.c.0"],
        stype_in="continuous",
        schema="trades",
        start=start.isoformat(),
        end=end.isoformat(),
    )
    _print(f"[es] est cost ${cost:.4f}")
    if cost > 0.5:
        raise RuntimeError(f"ES cost ${cost} too high")
    data = client.timeseries.get_range(
        dataset="GLBX.MDP3",
        symbols=["ES.c.0"],
        stype_in="continuous",
        schema="trades",
        start=start.isoformat(),
        end=end.isoformat(),
    )
    df = data.to_df()
    _print(f"[es] {len(df)} trades")
    if df.empty:
        return {"price": None, "ts": None}
    last = df.iloc[-1]
    price = _scale_price(last.get("price"))
    return {"price": price, "ts": last.name.isoformat() if hasattr(last.name, "isoformat") else None}


def main() -> int:
    opra = db.Historical(key=KEY_OPRA)
    glbx = db.Historical(key=KEY_GLBX) if KEY_GLBX else opra

    out: dict = {"generated_at": datetime.now(UTC).isoformat()}

    # ES futures for spot reference
    try:
        out["es"] = fetch_es_close(glbx)
    except Exception as e:  # noqa: BLE001
        _print(f"[es] FAILED: {e}")
        out["es"] = {"error": str(e)}

    # SPXW definitions
    try:
        defs = fetch_definition(opra, "SPXW.OPT")
        out["definition_rows"] = len(defs)
        # Keep just the columns we need
        defs_keep = defs[
            [c for c in (
                "instrument_id", "raw_symbol", "expiration",
                "strike_price", "instrument_class",
            ) if c in defs.columns]
        ].copy()
        # Build instrument_id -> contract registry (latest definition per instrument)
        if "instrument_id" in defs_keep.columns:
            defs_keep = defs_keep.drop_duplicates(subset=["instrument_id"], keep="last")
        out["definition_path"] = str(OUT_PATH.parent / "definition.parquet")
        defs_keep.to_parquet(OUT_PATH.parent / "definition.parquet")
    except Exception as e:  # noqa: BLE001
        _print(f"[def] FAILED: {e}")
        out["definition_error"] = str(e)
        return 1

    # SPXW quotes
    try:
        quotes = fetch_quotes(opra, "SPXW.OPT")
        out["quote_rows"] = len(quotes)
        out["quote_path"] = str(OUT_PATH.parent / "quotes.parquet")
        quotes.to_parquet(OUT_PATH.parent / "quotes.parquet")
    except Exception as e:  # noqa: BLE001
        _print(f"[quotes] FAILED: {e}")
        out["quote_error"] = str(e)
        return 1

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2))
    _print(f"[done] manifest -> {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
