"""Request dependencies: DB session, authenticated user, active workspace + role, CSRF and per-session rate
limits, permission guards."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import session_factory, utcnow
from app.core.errors import ApiError, forbidden
from app.core.permissions import LEGACY_ROLE, SUPPORT_PERMISSIONS, permissions_for
from app.core.ratelimit import limiter
from app.core.security import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, constant_time_equals, hash_token
from app.models import Membership, Session, Tenant, User

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

# Newsroom route guards, now expressed as workspace permissions (see core/permissions.py).
ROLE_ADMIN = "workspace.manage"
ROLE_CONTENT = "agents.run"
ROLE_REVIEW = "content.approve"
ROLE_PUBLISH = "content.approve"
WORKSPACE_HEADER = "x-workspace"


async def get_db() -> AsyncIterator[AsyncSession]:
    async with session_factory()() as session:
        yield session


@dataclass
class Principal:
    """The signed-in user acting on the *active* workspace (`tenant`) with their role there. `home_tenant` is the
    user's own workspace. `support_access` = a platform admin viewing a workspace they are not a member of
    (read-only, audited)."""

    user: User
    tenant: Tenant
    session_id: str
    home_tenant: Tenant | None = None
    workspace_role: str = "viewer"
    support_access: bool = False
    permissions: frozenset[str] = field(default_factory=frozenset)

    @property
    def tenant_id(self):
        return self.tenant.id

    @property
    def role(self) -> str:
        return self.workspace_role

    @property
    def is_platform_admin(self) -> bool:
        return bool(self.user.is_platform_admin)

    def can(self, permission: str) -> bool:
        return permission in self.permissions


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def current_principal(request: Request, db: AsyncSession = Depends(get_db)) -> Principal:
    settings = get_settings()

    # Local development escape hatch. Auth is bypassed completely: every request is the
    # first active user (normally the owner). Never enable this on a shared/public host.
    if settings.disable_auth:
        user = (
            await db.execute(select(User).where(User.active.is_(True)).order_by(User.created_at).limit(1))
        ).scalar_one_or_none()
        if user is None:
            raise ApiError(503, "no_local_user", "DISABLE_AUTH is on but no active user exists. Run: python -m app.cli bootstrap")
        return await resolve_workspace(request, db, user, "local-dev")

    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise ApiError(401, "unauthenticated", "Sign in to continue")
    row = (
        await db.execute(
            select(Session, User)
            .join(User, User.id == Session.user_id)
            .where(Session.token_hash == hash_token(token))
        )
    ).first()
    if row is None:
        raise ApiError(401, "unauthenticated", "Session expired or invalid")
    sess, user = row
    if sess.expires_at < utcnow() or not user.active:
        raise ApiError(401, "unauthenticated", "Session expired")

    if request.method not in SAFE_METHODS:
        header = request.headers.get(CSRF_HEADER, "")
        cookie = request.cookies.get(CSRF_COOKIE, "")
        if not header or not cookie or not constant_time_equals(header, cookie):
            raise ApiError(403, "csrf_failed", "Missing or invalid CSRF token. Reload the page and try again.")
        allowed, retry = limiter.hit(f"mut:{sess.id}", settings.rate_limit_mutations_per_min, 60)
    else:
        allowed, retry = limiter.hit(f"read:{sess.id}", settings.rate_limit_reads_per_min, 60)
    if not allowed:
        raise ApiError(429, "rate_limited", "Too many requests, slow down.", {"retry_after_s": round(retry, 1)})
    return await resolve_workspace(request, db, user, str(sess.id))


async def membership_role(db: AsyncSession, user: User, tenant_id) -> str | None:
    """Active role of `user` in a workspace. Users created before memberships existed keep their legacy role in
    their own workspace."""
    m = (
        await db.execute(select(Membership).where(Membership.user_id == user.id, Membership.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if m is not None:
        return m.role if m.status == "active" else None
    if tenant_id == user.tenant_id:
        return LEGACY_ROLE.get(user.role, "viewer")
    return None


async def resolve_workspace(request: Request, db: AsyncSession, user: User, session_id: str) -> Principal:
    """`X-Workspace: <slug>` (or `?workspace=` for EventSource, which cannot send headers) picks the active
    workspace. Members act with their role; platform admins without a membership get read-only support
    access, written to the audit log; everyone else gets 403 workspace_forbidden."""
    slug = (request.headers.get(WORKSPACE_HEADER) or request.query_params.get("workspace") or "").strip().lower()
    home = user.tenant
    if not slug or slug == home.slug:
        tenant = home
    else:
        tenant = (await db.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
        if tenant is None:
            if user.is_platform_admin:
                raise ApiError(404, "workspace_not_found", f"Workspace '{slug}' does not exist")
            raise ApiError(403, "workspace_forbidden", "You do not have access to that workspace")
    role = await membership_role(db, user, tenant.id)
    if role is not None:
        return Principal(user=user, tenant=tenant, session_id=session_id, home_tenant=home, workspace_role=role,
                         permissions=permissions_for(role))
    if not user.is_platform_admin:
        raise ApiError(403, "workspace_forbidden", "You do not have access to that workspace")
    # Support access: audit once per hour per admin + workspace, not on every request.
    allowed, _ = limiter.hit(f"support:{user.id}:{tenant.id}", 1, 3600)
    if allowed:
        from app.core.audit import audit

        audit(db, tenant_id=tenant.id, actor_type="user", actor_id=user.id, action="support_access", entity="tenant",
              entity_id=tenant.id, detail={"email": user.email, "path": request.url.path})
        await db.commit()
    return Principal(user=user, tenant=tenant, session_id=session_id, home_tenant=home, workspace_role="viewer",
                     support_access=True, permissions=SUPPORT_PERMISSIONS)


def require(permission: str) -> Callable:
    async def _dep(principal: Principal = Depends(current_principal)) -> Principal:
        if not principal.can(permission):
            if principal.support_access:
                raise forbidden("Support access is read-only")
            raise forbidden(f"Your role ({principal.role}) cannot do this ({permission})")
        return principal

    return _dep


async def platform_admin(principal: Principal = Depends(current_principal)) -> Principal:
    if not principal.is_platform_admin:
        raise ApiError(403, "platform_admin_required", "Only platform admins can do this")
    return principal
