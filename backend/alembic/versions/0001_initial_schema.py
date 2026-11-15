"""Initial schema — all 13 ForgeOptima AI tables.

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-15

This is the baseline revision. It is created from the SQLAlchemy metadata so the
migration cannot drift from the models; subsequent revisions should use
`alembic revision --autogenerate -m "..."` and be reviewed before applying.
"""
from __future__ import annotations

from alembic import op

from app.core.database import Base
from app import models  # noqa: F401  (registers table metadata)

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
