"""Post-review fixes — FK on access_requests.api_key_id, retention indexes,
duration_ms type.

Three small corrections layered on top of the Rev 5 schema:

* Adds the missing foreign-key constraint
  ``access_requests.api_key_id -> api_keys.id`` (ON DELETE SET NULL) so the
  audit row can survive an admin revoking the bridged API key without
  becoming a dangling reference.
* Adds simple ``ts``-only indexes on ``flow_events`` and
  ``dead_letter_queue`` to support operator-driven retention queries.
  These two tables grow unbounded today; converting them to TimescaleDB
  hypertables would require rewriting their UUID primary keys to include
  ``ts`` (a destructive operation), so for now operators are expected to
  schedule a periodic ``DELETE FROM ... WHERE ts < NOW() - INTERVAL ...``
  job externally — the indexes added here keep that delete cheap.
* Converts ``pipeline_runs.duration_ms`` from ``Numeric(20, 3)`` to
  ``double precision`` to match the model's ``float`` annotation and avoid
  unnecessary Decimal round-trips in the hot path.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-15 00:00:00
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── FK on access_requests.api_key_id ────────────────────────────────
    op.create_foreign_key(
        "fk_access_requests_api_key_id",
        "access_requests",
        "api_keys",
        ["api_key_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ── Retention-support indexes ───────────────────────────────────────
    # Both flow_events and dead_letter_queue grow unbounded. Cannot convert
    # to hypertables without rewriting the UUID PK to include ``ts``
    # (destructive). Operators are expected to schedule a periodic
    # ``DELETE FROM <table> WHERE ts < NOW() - INTERVAL ...`` job; these
    # indexes keep that delete inexpensive.
    op.create_index(
        "ix_flow_events_ts_only",
        "flow_events",
        ["ts"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_dead_letter_queue_ts_only",
        "dead_letter_queue",
        ["ts"],
        if_not_exists=True,
    )

    # ── pipeline_runs.duration_ms: Numeric(20, 3) -> double precision ──
    op.alter_column(
        "pipeline_runs",
        "duration_ms",
        existing_type=sa.Numeric(20, 3),
        type_=sa.Float(),
        existing_nullable=False,
        existing_server_default=sa.text("0"),
        postgresql_using="duration_ms::double precision",
    )


def downgrade() -> None:
    op.alter_column(
        "pipeline_runs",
        "duration_ms",
        existing_type=sa.Float(),
        type_=sa.Numeric(20, 3),
        existing_nullable=False,
        existing_server_default=sa.text("0"),
        postgresql_using="duration_ms::numeric(20,3)",
    )

    op.drop_index(
        "ix_dead_letter_queue_ts_only",
        table_name="dead_letter_queue",
        if_exists=True,
    )
    op.drop_index(
        "ix_flow_events_ts_only",
        table_name="flow_events",
        if_exists=True,
    )

    op.drop_constraint(
        "fk_access_requests_api_key_id",
        "access_requests",
        type_="foreignkey",
    )
