"""Website / channel connections (secrets write-only) and public API keys (secret shown once)."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import utcnow
from app.core.deps import Principal, current_principal, get_db, require
from app.core.errors import ApiError
from app.core.security import hash_token
from app.models import ApiKey, Connection, Notification, Tenant, WebhookDelivery
from app.platform.connections import CONNECTION_KINDS, test_connection, write_config
from app.platform.net import new_fetcher
from app.platform.schemas import ApiKeyCreate, ConnectionPatch, ConnectionWrite
from app.platform.serializers import api_key_out, connection_out
from app.routers.common import owned

router = APIRouter(tags=["connections"])
KEY_PREFIX = "lf_pk_"


@router.get("/connection-kinds")
async def connection_kinds(_: Principal = Depends(current_principal)):
    return {"items": [k.out() for k in CONNECTION_KINDS.values()]}


@router.get("/connections")
async def list_connections(principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Connection).where(Connection.tenant_id == principal.tenant_id).order_by(Connection.created_at))).scalars()
    return {"items": [connection_out(c) for c in rows]}


@router.post("/connections")
async def create_connection(body: ConnectionWrite, principal: Principal = Depends(require("integrations.manage")), db: AsyncSession = Depends(get_db)):
    conn = Connection(tenant_id=principal.tenant_id, name=body.name, kind=body.kind, config={})
    try:
        write_config(conn, body.config or {}, partial=False)
    except ValueError as exc:
        raise ApiError(422, "invalid_config", str(exc)) from exc
    db.add(conn)
    await db.flush()
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="connection.created", entity="connection",
          entity_id=conn.id, detail={"message": f"Connection {conn.name} ({CONNECTION_KINDS[conn.kind].name}) added"})
    await db.commit()
    return connection_out(conn)


@router.patch("/connections/{connection_id}")
async def patch_connection(connection_id: str, body: ConnectionPatch, principal: Principal = Depends(require("integrations.manage")), db: AsyncSession = Depends(get_db)):
    conn = await owned(db, Connection, connection_id, principal.tenant_id, "connection")
    if body.kind is not None and body.kind != conn.kind:
        raise ApiError(400, "kind_immutable", "A connection's kind cannot change; add a new connection instead")
    if body.name:
        conn.name = body.name
    if body.config is not None:
        try:
            write_config(conn, body.config, partial=True)
        except ValueError as exc:
            raise ApiError(422, "invalid_config", str(exc)) from exc
        conn.last_error = None
    conn.updated_at = utcnow()
    await db.commit()
    return connection_out(conn)


@router.get("/connections/{connection_id}/deliveries")
async def deliveries(connection_id: str, limit: int = 50, principal: Principal = Depends(current_principal), db: AsyncSession = Depends(get_db)):
    conn = await owned(db, Connection, connection_id, principal.tenant_id, "connection")
    rows = (await db.execute(select(WebhookDelivery).where(WebhookDelivery.connection_id == conn.id)
                             .order_by(WebhookDelivery.created_at.desc()).limit(max(1, min(limit, 200))))).scalars()
    return {"items": [{"id": str(d.id), "connection_id": str(d.connection_id), "event": d.event, "url": d.url, "status_code": d.status_code,
                       "ok": d.ok, "attempts": d.attempts, "duration_ms": d.duration_ms, "error": d.error, "at": d.created_at.isoformat()}
                      for d in rows]}


@router.delete("/connections/{connection_id}", status_code=204)
async def delete_connection(connection_id: str, principal: Principal = Depends(require("integrations.manage")), db: AsyncSession = Depends(get_db)):
    conn = await owned(db, Connection, connection_id, principal.tenant_id, "connection")
    await db.delete(conn)
    await db.commit()
    return Response(status_code=204)


@router.post("/connections/{connection_id}/test")
async def test(connection_id: str, principal: Principal = Depends(require("integrations.manage")), db: AsyncSession = Depends(get_db)):
    conn = await owned(db, Connection, connection_id, principal.tenant_id, "connection")
    tenant = await db.get(Tenant, principal.tenant_id)
    fetcher = new_fetcher()
    try:
        result = await test_connection(db, tenant, conn, fetcher)
    finally:
        await fetcher.close()
    conn.last_error = None if result["ok"] else result["detail"][:500]
    if not result["ok"]:
        db.add(Notification(tenant_id=principal.tenant_id, kind="connection_error", title=f"{conn.name}: connection test failed",
                            body=result["detail"][:500], link="/connections"))
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id,
          action="connection.tested" if result["ok"] else "connection.test_failed", entity="connection", entity_id=conn.id,
          detail={"message": f"{conn.name}: {result['detail']}", "error": not result["ok"]})
    await db.commit()
    return result


# ---------------------------------------------------------------- API keys
@router.get("/api-keys")
async def list_keys(principal: Principal = Depends(require("integrations.manage")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ApiKey).where(ApiKey.tenant_id == principal.tenant_id).order_by(ApiKey.created_at.desc()))).scalars()
    return {"items": [api_key_out(k) for k in rows]}


@router.post("/api-keys")
async def create_key(body: ApiKeyCreate, principal: Principal = Depends(require("integrations.manage")), db: AsyncSession = Depends(get_db)):
    secret = KEY_PREFIX + secrets.token_hex(20)
    key = ApiKey(tenant_id=principal.tenant_id, name=body.name, prefix=secret[: len(KEY_PREFIX) + 4], secret_hash=hash_token(secret),
                 scopes=list(dict.fromkeys(body.scopes)), created_by=principal.user.id)
    db.add(key)
    await db.flush()
    audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="connection.api_key_created",
          entity="api_key", entity_id=key.id, detail={"message": f"API key {key.name} created ({', '.join(key.scopes)})"})
    await db.commit()
    return {"key": api_key_out(key), "secret": secret}


@router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_key(key_id: str, principal: Principal = Depends(require("integrations.manage")), db: AsyncSession = Depends(get_db)):
    key = await owned(db, ApiKey, key_id, principal.tenant_id, "API key")
    if key.revoked_at is None:
        key.revoked_at = utcnow()
        audit(db, tenant_id=principal.tenant_id, actor_type="user", actor_id=principal.user.id, action="connection.api_key_revoked",
              entity="api_key", entity_id=key.id, detail={"message": f"API key {key.name} revoked"})
        await db.commit()
    return Response(status_code=204)
