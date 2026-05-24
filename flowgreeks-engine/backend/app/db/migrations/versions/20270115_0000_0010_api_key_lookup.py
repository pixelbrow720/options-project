"""Add ``api_keys.key_lookup`` (keyed BLAKE2b digest) for O(1) auth lookup.

Pre-existing rows have ``key_lookup = NULL`` and continue to work via
the prefix-scan fallback; the auth path lazily backfills the column on
the next successful verify so the population grows organically.

Revision ID: 0010
Revises: 0009
Create Date: 2027-01-15 00:00:00
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "api_keys",
        sa.Column("key_lookup", sa.Text(), nullable=True),
    )
    op.create_unique_constraint(
        "uq_api_keys_key_lookup", "api_keys", ["key_lookup"]
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_api_keys_key_lookup", "api_keys", type_="unique"
    )
    op.drop_column("api_keys", "key_lookup")
