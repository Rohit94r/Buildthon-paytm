"""Multi-client platform: workspace profile + plan on tenants, memberships and roles, platform admins, agents
(lifecycle + versions), pipelines (+ versions), runs, execution events, content, connections (+ webhook
deliveries), datasets, public API keys, notifications and usage counters.

Existing installs are single-tenant newsrooms, so the upgrade marks every existing tenant as an executive-media
workspace with the newsroom module on the enterprise plan, gives every existing user a membership in their
tenant (owner → owner, editor/reviewer → operator) and promotes the earliest owner to platform admin.

Revision ID: 0003_platform
Revises: 0002_images
Create Date: 2026-11-13
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.core.db import BigIntPK, JSONType, UTCDateTime

revision: str = "0003_platform"
down_revision: str | None = "0002_images"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _pk() -> sa.Column:
    return sa.Column("id", sa.Uuid(), primary_key=True)


def _tenant_fk() -> sa.Column:
    return sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)


def _stamps(updated: bool = True) -> list[sa.Column]:
    cols = [sa.Column("created_at", UTCDateTime(), nullable=False)]
    if updated:
        cols.append(sa.Column("updated_at", UTCDateTime(), nullable=False))
    return cols


def upgrade() -> None:
    with op.batch_alter_table("tenants") as batch:
        batch.add_column(sa.Column("industry", sa.String(32), nullable=False, server_default="other"))
        batch.add_column(sa.Column("brand_color", sa.String(16), nullable=False, server_default="#2563eb"))
        batch.add_column(sa.Column("modules", JSONType, nullable=False, server_default=sa.text("'[]'")))
        batch.add_column(sa.Column("blueprint", sa.String(64)))
        batch.add_column(sa.Column("plan", sa.String(16), nullable=False, server_default="free"))
        batch.add_column(sa.Column("status", sa.String(16), nullable=False, server_default="active"))
        batch.add_column(sa.Column("website", sa.Text()))

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("is_platform_admin", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Existing tenants are the original self-hosted newsroom (TEN): keep their dashboard and give them no limits.
    op.execute(
        sa.text(
            "UPDATE tenants SET modules = '[\"newsroom\", \"pipelines\"]', industry = 'executive_media', "
            "brand_color = '#8a3b12', plan = 'enterprise'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE users SET is_platform_admin = :yes WHERE id = ("
            "SELECT id FROM users WHERE role = 'owner' AND active = :yes ORDER BY created_at LIMIT 1)"
        ).bindparams(yes=True)
    )

    op.create_table(
        "memberships",
        _pk(),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        _tenant_fk(),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "tenant_id"),
    )
    users = sa.table("users", sa.column("id", sa.Uuid()), sa.column("tenant_id", sa.Uuid()), sa.column("role", sa.String()),
                     sa.column("created_at", UTCDateTime()))
    conn = op.get_bind()
    rows = conn.execute(sa.select(users.c.id, users.c.tenant_id, users.c.role, users.c.created_at)).all()
    if rows:
        import uuid

        memberships = sa.table("memberships", sa.column("id", sa.Uuid()), sa.column("user_id", sa.Uuid()),
                               sa.column("tenant_id", sa.Uuid()), sa.column("role", sa.String()), sa.column("status", sa.String()),
                               sa.column("created_at", UTCDateTime()))
        op.bulk_insert(memberships, [
            {"id": uuid.uuid4(), "user_id": uid, "tenant_id": tid, "role": "owner" if role == "owner" else "operator",
             "status": "active", "created_at": created}
            for uid, tid, role, created in rows
        ])

    op.create_table(
        "agents",
        _pk(),
        _tenant_fk(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("config", JSONType, nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("catalog_key", sa.String(64)),
        sa.Column("package_key", sa.String(64)),
        sa.Column("every_minutes", sa.Integer()),
        sa.Column("next_run_at", UTCDateTime()),
        sa.Column("requires_approval", sa.Boolean(), nullable=False),
        sa.Column("limits", JSONType, nullable=False),
        sa.Column("tools", JSONType, nullable=False),
        sa.Column("last_error", sa.Text()),
        *_stamps(),
    )
    op.create_index("agents_tenant_idx", "agents", ["tenant_id", "created_at"])

    op.create_table(
        "agent_versions",
        _pk(),
        _tenant_fk(),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("config", JSONType, nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("created_by", sa.Uuid()),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("agent_id", "version"),
    )

    op.create_table(
        "pipelines",
        _pk(),
        _tenant_fk(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("steps", JSONType, nullable=False),
        sa.Column("trigger_type", sa.String(16), nullable=False),
        sa.Column("every_minutes", sa.Integer()),
        sa.Column("webhook_token_enc", sa.Text()),
        sa.Column("require_approval", sa.Boolean(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("next_run_at", UTCDateTime()),
        sa.Column("version", sa.Integer(), nullable=False),
        *_stamps(),
    )
    op.create_index("pipelines_due_idx", "pipelines", ["trigger_type", "enabled", "next_run_at"])

    op.create_table(
        "pipeline_versions",
        _pk(),
        _tenant_fk(),
        sa.Column("pipeline_id", sa.Uuid(), sa.ForeignKey("pipelines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("steps", JSONType, nullable=False),
        sa.Column("trigger", JSONType, nullable=False),
        sa.Column("created_by", sa.Uuid()),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("pipeline_id", "version"),
    )

    op.create_table(
        "pipeline_runs",
        _pk(),
        _tenant_fk(),
        sa.Column("pipeline_id", sa.Uuid(), sa.ForeignKey("pipelines.id", ondelete="CASCADE")),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id", ondelete="CASCADE")),
        sa.Column("idempotency_key", sa.String(128)),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("input", JSONType),
        sa.Column("steps", JSONType, nullable=False),
        sa.Column("items", JSONType, nullable=False),
        sa.Column("resume_step", sa.Integer()),
        sa.Column("items_out", sa.Integer(), nullable=False),
        sa.Column("content_created", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text()),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.Uuid()),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("started_at", UTCDateTime()),
        sa.Column("finished_at", UTCDateTime()),
    )
    op.create_index("pipeline_runs_tenant_created_idx", "pipeline_runs", ["tenant_id", "created_at"])
    op.create_index("pipeline_runs_pipeline_idx", "pipeline_runs", ["pipeline_id", "created_at"])
    op.create_index("pipeline_runs_idem_idx", "pipeline_runs", ["tenant_id", "idempotency_key"])

    op.create_table(
        "execution_events",
        sa.Column("id", BigIntPK, primary_key=True, autoincrement=True),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid()),
        sa.Column("step_id", sa.String(64)),
        sa.Column("agent_id", sa.Uuid()),
        sa.Column("agent_name", sa.Text()),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("level", sa.String(8), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("data", JSONType, nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("execution_events_tenant_idx", "execution_events", ["tenant_id", "id"])
    op.create_index("execution_events_run_idx", "execution_events", ["run_id", "id"])
    op.create_index("execution_events_agent_idx", "execution_events", ["agent_id", "id"])

    op.create_table(
        "content_items",
        _pk(),
        _tenant_fk(),
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("pipeline_runs.id", ondelete="SET NULL")),
        sa.Column("pipeline_id", sa.Uuid(), sa.ForeignKey("pipelines.id", ondelete="SET NULL")),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text()),
        sa.Column("source_name", sa.Text()),
        sa.Column("persona", sa.Text()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("tags", JSONType, nullable=False),
        sa.Column("image_url", sa.Text()),
        sa.Column("images", JSONType, nullable=False, server_default=sa.text("'[]'")),
        sa.Column("seo", JSONType),
        sa.Column("quality", JSONType),
        sa.Column("variants", JSONType, nullable=False),
        sa.Column("publications", JSONType, nullable=False),
        sa.Column("source_text", sa.Text()),
        sa.Column("reject_reason", sa.Text()),
        *_stamps(),
        sa.Column("published_at", UTCDateTime()),
        sa.UniqueConstraint("tenant_id", "slug"),
    )
    op.create_index("content_items_tenant_status_idx", "content_items", ["tenant_id", "status", "created_at"])

    op.create_table(
        "connections",
        _pk(),
        _tenant_fk(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("config", JSONType, nullable=False),
        sa.Column("secrets_enc", sa.Text()),
        sa.Column("last_used_at", UTCDateTime()),
        sa.Column("last_error", sa.Text()),
        *_stamps(),
    )

    op.create_table(
        "webhook_deliveries",
        _pk(),
        _tenant_fk(),
        sa.Column("connection_id", sa.Uuid(), sa.ForeignKey("connections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event", sa.String(64), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("status_code", sa.Integer()),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("webhook_deliveries_conn_idx", "webhook_deliveries", ["connection_id", "created_at"])

    op.create_table(
        "datasets",
        _pk(),
        _tenant_fk(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("key_field", sa.String(64), nullable=False),
        sa.Column("fields", JSONType, nullable=False),
        sa.Column("public", sa.Boolean(), nullable=False),
        *_stamps(),
        sa.UniqueConstraint("tenant_id", "slug"),
    )

    op.create_table(
        "dataset_records",
        _pk(),
        _tenant_fk(),
        sa.Column("dataset_id", sa.Uuid(), sa.ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("data", JSONType, nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text()),
        *_stamps(),
        sa.UniqueConstraint("dataset_id", "key"),
    )

    op.create_table(
        "api_keys",
        _pk(),
        _tenant_fk(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("prefix", sa.String(16), nullable=False),
        sa.Column("secret_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("scopes", JSONType, nullable=False),
        sa.Column("last_used_at", UTCDateTime()),
        sa.Column("revoked_at", UTCDateTime()),
        sa.Column("created_by", sa.Uuid()),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )

    op.create_table(
        "notifications",
        _pk(),
        _tenant_fk(),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("link", sa.Text()),
        sa.Column("read", sa.Boolean(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
    )
    op.create_index("notifications_tenant_idx", "notifications", ["tenant_id", "created_at"])

    op.create_table(
        "usage_counters",
        _pk(),
        _tenant_fk(),
        sa.Column("day", sa.String(10), nullable=False),
        sa.Column("metric", sa.String(32), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.UniqueConstraint("tenant_id", "day", "metric"),
    )


def downgrade() -> None:
    op.drop_table("usage_counters")
    op.drop_index("notifications_tenant_idx", table_name="notifications")
    op.drop_table("notifications")
    op.drop_table("api_keys")
    op.drop_table("dataset_records")
    op.drop_table("datasets")
    op.drop_index("webhook_deliveries_conn_idx", table_name="webhook_deliveries")
    op.drop_table("webhook_deliveries")
    op.drop_table("connections")
    op.drop_index("content_items_tenant_status_idx", table_name="content_items")
    op.drop_table("content_items")
    for idx in ("execution_events_agent_idx", "execution_events_run_idx", "execution_events_tenant_idx"):
        op.drop_index(idx, table_name="execution_events")
    op.drop_table("execution_events")
    for idx in ("pipeline_runs_idem_idx", "pipeline_runs_pipeline_idx", "pipeline_runs_tenant_created_idx"):
        op.drop_index(idx, table_name="pipeline_runs")
    op.drop_table("pipeline_runs")
    op.drop_table("pipeline_versions")
    op.drop_index("pipelines_due_idx", table_name="pipelines")
    op.drop_table("pipelines")
    op.drop_table("agent_versions")
    op.drop_index("agents_tenant_idx", table_name="agents")
    op.drop_table("agents")
    op.drop_table("memberships")

    with op.batch_alter_table("users") as batch:
        batch.drop_column("is_platform_admin")

    with op.batch_alter_table("tenants") as batch:
        for col in ("website", "status", "plan", "blueprint", "modules", "brand_color", "industry"):
            batch.drop_column(col)
