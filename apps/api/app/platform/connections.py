"""Website / channel connections: kind catalog (form fields), encrypted secrets, delivery and health checks.

Secrets are one Fernet-encrypted JSON blob per connection (same key management as the newsroom's
integration secrets). All outbound calls go through the shared Fetcher's SSRF guard. Channels without
usable API access (X, LinkedIn without a token) are recorded as `manual`: the post is prepared for copy-paste,
which is honest about what happened."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.security import decrypt_secret, encrypt_secret
from app.models import Connection, ContentItem, Tenant
from app.platform.catalog import CONTENT_FORMATS, F
from app.platform.content import primary_format
from app.services.fetcher import Fetcher, FetchError

SETUP_STEPS: dict[str, list[str]] = {
    "nextjs": ["Add the LayerFlow receiver route to your Next.js app (see the guide).",
               "Create a long random signing secret and put it in the site's environment as LAYERFLOW_SECRET.",
               "Paste the route's full URL and the same secret here, then press Test: you should see 'answered 200'.",
               "Optional: add your public site URL so published links point to the live pages."],
    "wordpress": ["In WordPress go to Users → Profile → Application Passwords.",
                  "Type a name like 'LayerFlow' and click Add New; copy the password it shows.",
                  "Enter your site address, your WordPress username and that application password here.",
                  "Choose Publish or Save as draft, then press Test."],
    "webhook": ["Create an endpoint in Zapier, Make, n8n or your own backend that accepts POST requests.",
                "Pick a signing secret and store it on the receiving side to verify the X-LayerFlow-Signature header.",
                "Paste the URL and the secret here and press Test: a signed 'ping' is sent."],
    "linkedin": ["Optional: create a LinkedIn developer app and get an access token with posting permission.",
                 "Paste the token and your organization or member URN here.",
                 "Without a token, posts are prepared for you to copy and paste (marked 'manual')."],
    "telegram": ["Open Telegram, message @BotFather and send /newbot; copy the bot token it gives you.",
                 "Add the bot to your channel or group as an admin.",
                 "Enter the token and the channel (like @mychannel) here, then press Test."],
    "x": ["Nothing to set up: X API access is paid, so threads are prepared for copy and paste.",
          "Add your handle so prepared posts show which account they are for.",
          "After publishing, open the content item: the ready-to-paste thread is under Publications."],
    "ghost": ["In Ghost Admin open Settings → Integrations → Add custom integration.",
              "Copy the Admin API key (it looks like id:secret) and the API URL.",
              "Paste both here, choose Publish or Draft, and press Test."],
    "slack": ["In Slack open Apps → Incoming Webhooks → Add to Slack.",
              "Choose the channel and copy the webhook URL.",
              "Paste it here and press Test (nothing is posted during the test)."],
    "discord": ["In Discord open the channel's settings → Integrations → Webhooks → New Webhook.",
                "Copy the webhook URL.", "Paste it here and press Test (nothing is posted during the test).",
                "Optional: give the webhook a name and avatar so posts are easy to recognise."],
    "email_smtp": ["Get your mail provider's SMTP details (Gmail: smtp.gmail.com, port 587, with an app password).",
                   "Enter the host, port, username, password and the From address.",
                   "Add default recipients separated by commas.", "Press Test: LayerFlow signs in without sending anything."],
    "rest_api": ["Find your CRM's or system's API base URL (for Google Sheets: deploy an Apps Script web app).",
                 "If the API needs a key, enter the header name (usually Authorization) and its value.",
                 "Add any other hosts the API redirects to under 'Extra allowed hosts'.",
                 "Press Test to check the API answers."],
}
FORMAT_OPTIONS = [{"value": k, "label": v} for k, v in CONTENT_FORMATS.items()]


def _format_field(default: str) -> dict[str, Any]:
    return F("format", "Content format", "select", options=FORMAT_OPTIONS, default=default,
             help="Which variant to send. Falls back to the closest available format.")


@dataclass(frozen=True)
class ConnectionKindInfo:
    kind: str
    name: str
    description: str
    icon: str
    auto_publish: bool
    fields: list[dict[str, Any]]
    docs: str

    def out(self) -> dict[str, Any]:
        return {"kind": self.kind, "name": self.name, "description": self.description, "icon": self.icon,
                "auto_publish": self.auto_publish, "fields": self.fields, "docs": self.docs, "setup_steps": SETUP_STEPS.get(self.kind, [])}

    @property
    def secret_keys(self) -> set[str]:
        return {f["key"] for f in self.fields if f.get("secret")}


CONNECTION_KINDS: dict[str, ConnectionKindInfo] = {
    k.kind: k
    for k in (
        ConnectionKindInfo(
            kind="nextjs",
            name="Next.js site",
            description="Pushes published content to your Next.js app as a signed webhook; the route saves or revalidates the page.",
            icon="Triangle",
            auto_publish=True,
            fields=[
                F("endpoint_url", "Receiver URL", "text", required=True, placeholder="https://client.com/api/layerflow"),
                F("signing_secret", "Signing secret", "text", required=True, secret=True,
                  help="Shared secret used for the X-LayerFlow-Signature HMAC. Put the same value in the site's env."),
                F("site_url", "Public site URL", "text", placeholder="https://client.com", help="Used to build live links."),
                F("path_prefix", "Article path", "text", default="/blog"),
                _format_field("article"),
            ],
            docs="docs/integrations/nextjs.md",
        ),
        ConnectionKindInfo(
            kind="wordpress",
            name="WordPress",
            description="Creates posts through the WordPress REST API with an application password.",
            icon="Globe",
            auto_publish=True,
            fields=[
                F("site_url", "Site URL", "text", required=True, placeholder="https://blog.client.com"),
                F("username", "Username", "text", required=True),
                F("app_password", "Application password", "text", required=True, secret=True,
                  help="Users → Profile → Application Passwords in WordPress."),
                F("status", "Post status", "select", default="publish",
                  options=[{"value": "publish", "label": "Publish"}, {"value": "draft", "label": "Save as draft"}]),
                _format_field("article"),
            ],
            docs="docs/integrations/wordpress.md",
        ),
        ConnectionKindInfo(
            kind="webhook",
            name="Webhook",
            description="POSTs every published item to any URL (Zapier, Make, n8n, your own backend), HMAC-signed.",
            icon="Webhook",
            auto_publish=True,
            fields=[
                F("url", "URL", "text", required=True, placeholder="https://hooks.example.com/layerflow"),
                F("secret", "Signing secret", "text", required=True, secret=True),
                _format_field("article"),
            ],
            docs="docs/integrations/webhook.md",
        ),
        ConnectionKindInfo(
            kind="linkedin",
            name="LinkedIn",
            description="Posts through LinkedIn's official API when an access token is available; otherwise the post is prepared for copy-paste.",
            icon="Linkedin",
            auto_publish=True,
            fields=[
                F("author_urn", "Author URN", "text", placeholder="urn:li:organization:123456",
                  help="Organization or member URN. Empty = the newsroom's LinkedIn integration."),
                F("access_token", "Access token", "text", secret=True,
                  help="Optional. Without a token (here or in Settings → Integrations) posts are marked manual."),
                _format_field("linkedin_post"),
            ],
            docs="docs/integrations/channels.md",
        ),
        ConnectionKindInfo(
            kind="telegram",
            name="Telegram",
            description="Sends each item to a Telegram channel or group through your bot.",
            icon="Send",
            auto_publish=True,
            fields=[
                F("bot_token", "Bot token", "text", required=True, secret=True, help="From @BotFather."),
                F("chat_id", "Chat / channel", "text", required=True, placeholder="@mychannel or -1001234567890",
                  help="Add the bot to the channel as an admin first."),
                _format_field("whatsapp_message"),
            ],
            docs="docs/integrations/channels.md",
        ),
        ConnectionKindInfo(
            kind="x",
            name="X (Twitter)",
            description="Threads are prepared for copy-paste (X API access is paid and not configured).",
            icon="Twitter",
            auto_publish=False,
            fields=[F("handle", "Handle", "text", placeholder="@brand"), _format_field("x_thread")],
            docs="docs/integrations/channels.md",
        ),
        ConnectionKindInfo(
            kind="ghost",
            name="Ghost",
            description="Creates posts through the Ghost Admin API.",
            icon="Ghost",
            auto_publish=True,
            fields=[
                F("admin_url", "Admin API URL", "text", required=True, placeholder="https://blog.client.com"),
                F("admin_api_key", "Admin API key", "text", required=True, secret=True,
                  help="Settings → Integrations → Custom integration. Format id:secret."),
                F("status", "Post status", "select", default="published",
                  options=[{"value": "published", "label": "Publish"}, {"value": "draft", "label": "Save as draft"}]),
                _format_field("article"),
            ],
            docs="docs/integrations/channels.md",
        ),
        ConnectionKindInfo(
            kind="slack",
            name="Slack",
            description="Posts messages to a Slack channel through an incoming webhook.",
            icon="Slack",
            auto_publish=True,
            fields=[F("webhook_url", "Incoming webhook URL", "text", required=True, secret=True,
                      placeholder="https://hooks.slack.com/services/…", help="Slack → Apps → Incoming Webhooks.")],
            docs="docs/integrations/channels.md",
        ),
        ConnectionKindInfo(
            kind="discord",
            name="Discord",
            description="Posts messages to a Discord channel through a channel webhook.",
            icon="MessageCircle",
            auto_publish=True,
            fields=[F("webhook_url", "Webhook URL", "text", required=True, secret=True,
                      placeholder="https://discord.com/api/webhooks/…", help="Channel settings → Integrations → Webhooks.")],
            docs="docs/integrations/channels.md",
        ),
        ConnectionKindInfo(
            kind="email_smtp",
            name="Email (SMTP)",
            description="Sends email through your SMTP server (digests, alerts, follow-ups).",
            icon="Mail",
            auto_publish=True,
            fields=[
                F("host", "SMTP host", "text", required=True, placeholder="smtp.gmail.com"),
                F("port", "Port", "text", default="587"),
                F("username", "Username", "text", required=True),
                F("password", "Password", "text", required=True, secret=True),
                F("from_email", "From address", "text", required=True, placeholder="alerts@client.com"),
                F("to_emails", "Default recipients", "text", required=True, placeholder="team@client.com, owner@client.com"),
                F("security", "Security", "select", default="starttls",
                  options=[{"value": "starttls", "label": "STARTTLS (587)"}, {"value": "ssl", "label": "SSL/TLS (465)"}]),
            ],
            docs="docs/integrations/channels.md",
        ),
        ConnectionKindInfo(
            kind="rest_api",
            name="REST API",
            description="Any JSON API (CRM, Google Sheets via Apps Script, your backend). Requests may only go to the "
            "base URL's host and the extra hosts you allow.",
            icon="Plug",
            auto_publish=True,
            fields=[
                F("base_url", "Base URL", "text", required=True, placeholder="https://api.crm.example.com/v1"),
                F("auth_header", "Auth header name", "text", default="Authorization"),
                F("auth_value", "Auth header value", "text", secret=True, placeholder="Bearer …"),
                F("allowed_hosts", "Extra allowed hosts", "text", placeholder="sheets.googleapis.com",
                  help="Comma-separated. Requests to any other host are refused."),
                F("health_path", "Health check path", "text", default="", placeholder="/health"),
            ],
            docs="docs/integrations/channels.md",
        ),
    )
}
MESSAGE_KINDS = ("telegram", "slack", "discord", "email_smtp", "webhook")


# ---------------------------------------------------------------- config / secrets
def read_secrets(conn: Connection) -> dict[str, str]:
    if not conn.secrets_enc:
        return {}
    raw = decrypt_secret(conn.secrets_enc)
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {}


def write_config(conn: Connection, values: dict[str, Any], *, partial: bool) -> None:
    """Split `values` into plain config and encrypted secrets. In partial (PATCH) mode an omitted secret is kept,
    and an empty/null one is removed."""
    info = CONNECTION_KINDS[conn.kind]
    fields = {f["key"]: f for f in info.fields}
    unknown = sorted(set(values) - set(fields))
    if unknown:
        raise ValueError(f"Unknown setting(s) for {info.name}: {', '.join(unknown)}")
    config = dict(conn.config or {}) if partial else {}
    secrets = read_secrets(conn) if partial else {}
    for key, f in fields.items():
        if key not in values:
            if not partial and "default" in f and not f.get("secret"):
                config[key] = f["default"]
            continue
        value = values[key]
        if value is not None and not isinstance(value, str | bool | int | float):
            raise ValueError(f"{f['label']} must be text")
        value = value.strip() if isinstance(value, str) else value
        if f.get("type") == "select" and value not in {o["value"] for o in f.get("options") or []}:
            raise ValueError(f"{f['label']} must be one of {', '.join(o['value'] for o in f['options'])}")
        if key in ("endpoint_url", "url", "site_url", "admin_url", "base_url", "webhook_url") and value and not str(value).startswith(("http://", "https://")):
            raise ValueError(f"{f['label']} must start with http:// or https://")
        if f.get("secret"):
            if value:
                secrets[key] = str(value)
            else:
                secrets.pop(key, None)
        elif value in (None, ""):
            config.pop(key, None)
        else:
            config[key] = value
    conn.config = config
    conn.secrets_enc = encrypt_secret(json.dumps(secrets)) if secrets else None


def missing_fields(conn: Connection) -> list[str]:
    info = CONNECTION_KINDS[conn.kind]
    secrets = read_secrets(conn)
    return [f["key"] for f in info.fields if f.get("required") and not (secrets.get(f["key"]) if f.get("secret") else (conn.config or {}).get(f["key"]))]


def status_of(conn: Connection) -> str:
    if missing_fields(conn):
        return "needs_setup"
    return "error" if conn.last_error else "connected"


# ---------------------------------------------------------------- delivery
class DeliveryError(Exception):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


def signature(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def ghost_token(admin_key: str, now: int | None = None) -> str:
    """Ghost Admin API JWT (HS256, 5 minute expiry, audience /admin/), built without a JWT dependency."""
    try:
        kid, secret = admin_key.split(":", 1)
        key = bytes.fromhex(secret)
    except ValueError as exc:
        raise DeliveryError("Ghost Admin API key must look like <id>:<hex secret>") from exc

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    iat = int(now or time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": kid}, separators=(",", ":")).encode())
    payload = b64(json.dumps({"iat": iat, "exp": iat + 300, "aud": "/admin/"}, separators=(",", ":")).encode())
    sig = b64(hmac.new(key, f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def _check(resp, what: str) -> Any:
    """Turn an HTTP answer into data or a specific, plain-language error."""
    code = resp.status_code
    detail = ""
    try:
        body = resp.json()
        detail = str(body.get("description") or body.get("message") or body.get("error") or "")[:160] if isinstance(body, dict) else ""
    except ValueError:
        detail = resp.text[:160]
    if code == 429:
        raise DeliveryError(f"{what} is rate limiting us (429); it will be retried later", retryable=True)
    if code >= 500:
        raise DeliveryError(f"{what} had a server error ({code}); it will be retried", retryable=True)
    if code in (401, 403):
        raise DeliveryError(f"{what} refused the credentials ({code}). Check the token, key or password." + (f" ({detail})" if detail else ""))
    if code == 404:
        raise DeliveryError(f"{what} was not found at this address (404). Check the URL." + (f" ({detail})" if detail else ""))
    if code >= 400:
        raise DeliveryError(f"{what} rejected the request ({code})" + (f": {detail}" if detail else ""))
    try:
        return resp.json()
    except ValueError:
        return {}


async def _send(fetcher: Fetcher, method: str, url: str, *, log: tuple[Connection, str] | None = None, **kw: Any):
    """Outbound call through the SSRF guard. With `log=(connection, event)` the attempt is recorded as a webhook
    delivery (GET /connections/{id}/deliveries)."""
    started = time.perf_counter()
    try:
        resp = await fetcher.send(method, url, allow_private=get_settings().connections_allow_private, **kw)
    except FetchError as exc:
        if log:
            await record_delivery(log[0], log[1], url, None, int((time.perf_counter() - started) * 1000), str(exc))
        raise DeliveryError(f"{_safe_url(url)}: {exc}", retryable=exc.kind == "network") from exc
    if log:
        await record_delivery(log[0], log[1], url, resp.status_code, int((time.perf_counter() - started) * 1000),
                              None if resp.status_code < 400 else resp.text[:300])
    return resp


def _safe_url(url: str) -> str:
    from app.platform.events import redact

    return redact(url)


async def record_delivery(conn: Connection, event: str, url: str, status: int | None, ms: int, error: str | None) -> None:
    from app.core.db import session_factory
    from app.models import WebhookDelivery

    async with session_factory()() as db:
        db.add(WebhookDelivery(tenant_id=conn.tenant_id, connection_id=conn.id, event=event, url=_safe_url(url)[:2000],
                               status_code=status, ok=status is not None and status < 400, duration_ms=ms,
                               error=_safe_url(error)[:1000] if error else None))
        await db.commit()


async def deliver(
    db: AsyncSession,
    tenant: Tenant,
    conn: Connection,
    content: ContentItem,
    fetcher: Fetcher,
) -> dict[str, Any]:
    """Send `content` to one connection. Returns a ContentPublication dict (plus internal `remote_id` and
    `retryable`). Never raises for delivery problems: they are recorded on the publication."""
    from app.platform.serializers import public_content_out

    info = CONNECTION_KINDS[conn.kind]
    cfg = conn.config or {}
    secrets = read_secrets(conn)
    fmt = primary_format(content, cfg.get("format")) or "article"
    pub: dict[str, Any] = {
        "connection_id": str(conn.id), "connection_name": conn.name, "kind": conn.kind, "format": fmt,
        "status": "published", "url": None, "error": None, "at": utcnow().isoformat(), "retryable": False,
    }
    previous = next((p for p in content.publications or [] if p.get("connection_id") == str(conn.id)), None)
    try:
        if missing_fields(conn):
            raise DeliveryError(f"{info.name} connection is missing: {', '.join(missing_fields(conn))}")
        body_payload = public_content_out(content, fmt)
        text = body_payload["body_markdown"]
        if conn.kind in ("nextjs", "webhook"):
            url = cfg["endpoint_url"] if conn.kind == "nextjs" else cfg["url"]
            secret = secrets["signing_secret"] if conn.kind == "nextjs" else secrets["secret"]
            raw = json.dumps({"event": "content.published", "workspace": tenant.slug, "content": body_payload},
                             ensure_ascii=False, default=str).encode("utf-8")
            resp = await _send(fetcher, "POST", url, log=(conn, "content.published"), content=raw, headers={
                "Content-Type": "application/json",
                "X-LayerFlow-Event": "content.published",
                "X-LayerFlow-Signature": signature(secret, raw),
                "Idempotency-Key": f"{content.id}:{fmt}",
            })
            data = _check(resp, info.name)
            site = (cfg.get("site_url") or "").rstrip("/")
            prefix = "/" + cfg.get("path_prefix", "/blog").strip("/") if cfg.get("path_prefix", "/blog").strip("/") else ""
            pub["url"] = (data.get("url") if isinstance(data, dict) else None) or (f"{site}{prefix}/{content.slug}" if site else None)
        elif conn.kind == "wordpress":
            site = cfg["site_url"].rstrip("/")
            body = {"title": content.title, "content": body_payload["body_html"], "excerpt": content.summary,
                    "slug": content.slug, "status": cfg.get("status", "publish")}
            remote = (previous or {}).get("remote_id")
            path = f"/wp-json/wp/v2/posts/{remote}" if remote else "/wp-json/wp/v2/posts"
            resp = await _send(fetcher, "POST", site + path, json_body=body, auth=(cfg["username"], secrets["app_password"]))
            data = _check(resp, "WordPress")
            pub["remote_id"] = str(data.get("id") or remote or "")
            pub["url"] = data.get("link")
        elif conn.kind == "ghost":
            site = cfg["admin_url"].rstrip("/")
            body = {"posts": [{"title": content.title, "html": body_payload["body_html"], "status": cfg.get("status", "published"),
                               "custom_excerpt": (content.summary or "")[:300], "tags": [{"name": t} for t in content.tags or []]}]}
            resp = await _send(fetcher, "POST", f"{site}/ghost/api/admin/posts/?source=html", json_body=body, headers={
                "Authorization": f"Ghost {ghost_token(secrets['admin_api_key'])}", "Accept-Version": "v5.0"})
            data = _check(resp, "Ghost")
            post = (data.get("posts") or [{}])[0] if isinstance(data, dict) else {}
            pub["remote_id"] = str(post.get("id") or "")
            pub["url"] = post.get("url")
        elif conn.kind == "telegram":
            message = text if len(text) <= 4000 else text[:3990] + "…"
            if content.source_url and content.source_url not in message and len(message) + len(content.source_url) < 4000:
                message += f"\n\n{content.source_url}"
            resp = await _send(fetcher, "POST", f"https://api.telegram.org/bot{secrets['bot_token']}/sendMessage",
                               json_body={"chat_id": cfg["chat_id"], "text": message})
            data = _check(resp, "Telegram")
            msg_id = (data.get("result") or {}).get("message_id") if isinstance(data, dict) else None
            chat = str(cfg["chat_id"])
            pub["url"] = f"https://t.me/{chat.lstrip('@')}/{msg_id}" if chat.startswith("@") and msg_id else None
        elif conn.kind == "linkedin":
            await _linkedin(db, tenant, conn, content, text, pub)
        elif conn.kind in ("slack", "discord", "email_smtp"):
            link = content.source_url if content.source_url and content.source_url not in text else None
            await send_message(conn, f"{text}\n\n{link}" if link else text, subject=content.title, fetcher=fetcher)
        else:  # x and any channel without API access
            pub["status"] = "manual"
    except DeliveryError as exc:
        pub.update(status="failed", error=str(exc)[:500], retryable=exc.retryable)
    except (KeyError, TypeError) as exc:
        pub.update(status="failed", error=f"Connection is not fully configured ({exc})")
    return pub


async def _linkedin(db: AsyncSession, tenant: Tenant, conn: Connection, content: ContentItem, text: str, pub: dict[str, Any]) -> None:
    from app.adapters import linkedin as li
    from app.services.integrations import get_secret, integration_config

    secrets = read_secrets(conn)
    token = secrets.get("access_token") or await get_secret(db, tenant.id, "linkedin_access_token")
    author = (conn.config or {}).get("author_urn") or integration_config(tenant)["linkedin"].get("org_urn")
    if not token or not author:
        pub["status"] = "manual"
        return
    try:
        urn = await li.create_post(token, author, text[:2900], link=content.source_url, title=content.title, description=content.summary)
    except li.LinkedInError as exc:
        raise DeliveryError(str(exc), retryable=exc.retryable) from exc
    pub["remote_id"] = urn
    pub["url"] = f"https://www.linkedin.com/feed/update/{urn}/"


async def test_connection(db: AsyncSession, tenant: Tenant, conn: Connection, fetcher: Fetcher) -> dict[str, Any]:
    """A real, lightweight check that never publishes anything (signed `ping` for webhooks)."""
    started = time.perf_counter()
    cfg, secrets = conn.config or {}, read_secrets(conn)

    def done(ok: bool, detail: str) -> dict[str, Any]:
        return {"ok": ok, "detail": detail, "latency_ms": int((time.perf_counter() - started) * 1000)}

    missing = missing_fields(conn)
    if missing:
        return {"ok": False, "detail": f"Missing: {', '.join(missing)}", "latency_ms": None}
    try:
        if conn.kind in ("nextjs", "webhook"):
            url = cfg["endpoint_url"] if conn.kind == "nextjs" else cfg["url"]
            secret = secrets["signing_secret"] if conn.kind == "nextjs" else secrets["secret"]
            raw = json.dumps({"event": "ping", "workspace": tenant.slug, "id": uuid.uuid4().hex}).encode()
            resp = await _send(fetcher, "POST", url, content=raw, headers={
                "Content-Type": "application/json", "X-LayerFlow-Event": "ping", "X-LayerFlow-Signature": signature(secret, raw)})
            _check(resp, "Receiver")
            return done(True, f"Receiver answered {resp.status_code} to a signed ping")
        if conn.kind == "wordpress":
            resp = await _send(fetcher, "GET", cfg["site_url"].rstrip("/") + "/wp-json/wp/v2/users/me?context=edit",
                               auth=(cfg["username"], secrets["app_password"]))
            data = _check(resp, "WordPress")
            return done(True, f"Signed in as {data.get('name') or cfg['username']}")
        if conn.kind == "ghost":
            resp = await _send(fetcher, "GET", cfg["admin_url"].rstrip("/") + "/ghost/api/admin/site/", headers={
                "Authorization": f"Ghost {ghost_token(secrets['admin_api_key'])}", "Accept-Version": "v5.0"})
            data = _check(resp, "Ghost")
            return done(True, f"Connected to {(data.get('site') or {}).get('title') or 'Ghost'}")
        if conn.kind == "telegram":
            resp = await _send(fetcher, "GET", f"https://api.telegram.org/bot{secrets['bot_token']}/getMe")
            data = _check(resp, "Telegram")
            return done(True, f"Bot @{(data.get('result') or {}).get('username', '?')} is ready; make sure it can post in {cfg['chat_id']}")
        if conn.kind == "linkedin":
            from app.adapters import linkedin as li
            from app.services.integrations import get_secret

            token = secrets.get("access_token") or await get_secret(db, tenant.id, "linkedin_access_token")
            if not token:
                return done(False, "No access token: posts will be prepared for manual copy")
            try:
                urn = await li.member_urn(token)
            except li.LinkedInError as exc:
                return done(False, str(exc))
            return done(True, f"Token valid ({urn})")
        if conn.kind == "slack":
            # An empty payload is rejected with 400 "no_text" by a valid webhook and 403/404 by a revoked one: a check
            # that never posts anything.
            resp = await _send(fetcher, "POST", secrets["webhook_url"], json_body={})
            ok = resp.status_code == 400 and "no_text" in resp.text
            return done(ok, "Webhook is valid" if ok else f"Slack answered {resp.status_code}: {resp.text[:120]}")
        if conn.kind == "discord":
            resp = await _send(fetcher, "GET", secrets["webhook_url"])
            data = _check(resp, "Discord")
            return done(True, f"Webhook '{data.get('name', 'Discord')}' is valid")
        if conn.kind == "email_smtp":
            await _smtp(conn, secrets, None, None, None, check_only=True, fetcher=fetcher)
            return done(True, f"Signed in to {cfg['host']}")
        if conn.kind == "rest_api":
            url = rest_url(conn, cfg.get("health_path") or "")
            resp = await _send(fetcher, "GET", url, headers=_rest_headers(conn, secrets))
            return done(resp.status_code < 500, f"{_safe_url(url)} answered {resp.status_code}")
        return done(True, "Manual channel: posts are prepared for copy and paste")
    except DeliveryError as exc:
        return done(False, str(exc))



# ---------------------------------------------------------------- messages (notifier) and REST calls (http_action)
async def send_message(conn: Connection, text: str, *, subject: str | None, fetcher: Fetcher, to: list[str] | None = None) -> dict[str, Any]:
    """One message to a message-capable connection. Raises DeliveryError on failure."""
    cfg, secrets = conn.config or {}, read_secrets(conn)
    missing = missing_fields(conn)
    if missing:
        raise DeliveryError(f"{conn.name} is missing: {', '.join(missing)}")
    if conn.kind == "telegram":
        resp = await _send(fetcher, "POST", f"https://api.telegram.org/bot{secrets['bot_token']}/sendMessage",
                           log=(conn, "message"), json_body={"chat_id": cfg["chat_id"], "text": text[:4000]})
        _check(resp, "Telegram")
    elif conn.kind == "slack":
        resp = await _send(fetcher, "POST", secrets["webhook_url"], log=(conn, "message"),
                           json_body={"text": (f"*{subject}*\n" if subject else "") + text[:3800]})
        _check(resp, "Slack")
    elif conn.kind == "discord":
        resp = await _send(fetcher, "POST", secrets["webhook_url"], log=(conn, "message"),
                           json_body={"content": ((f"**{subject}**\n" if subject else "") + text)[:2000]})
        _check(resp, "Discord")
    elif conn.kind == "webhook":
        raw = json.dumps({"event": "message", "subject": subject, "text": text}, ensure_ascii=False).encode()
        resp = await _send(fetcher, "POST", cfg["url"], log=(conn, "message"), content=raw, headers={
            "Content-Type": "application/json", "X-LayerFlow-Event": "message", "X-LayerFlow-Signature": signature(secrets["secret"], raw)})
        _check(resp, "Webhook")
    elif conn.kind == "email_smtp":
        await _smtp(conn, secrets, subject or "LayerFlow", text, to, fetcher=fetcher)
    else:
        raise DeliveryError(f"{CONNECTION_KINDS[conn.kind].name} connections cannot send messages")
    return {"ok": True, "kind": conn.kind}


async def _smtp(conn: Connection, secrets: dict[str, str], subject: str | None, text: str | None, to: list[str] | None, *,
                fetcher: Fetcher, check_only: bool = False) -> None:
    """SMTP in a thread (smtplib is blocking). The host passes the same public-address check as HTTP targets."""
    import asyncio
    import smtplib
    import ssl
    from email.message import EmailMessage

    cfg = conn.config or {}
    host = cfg["host"]
    if not get_settings().connections_allow_private:
        try:
            await fetcher.check_url(f"https://{host}/")
        except FetchError as exc:
            raise DeliveryError(f"SMTP host refused: {exc}") from exc
    port = int(cfg.get("port") or (465 if cfg.get("security") == "ssl" else 587))
    recipients = to or [r.strip() for r in str(cfg.get("to_emails") or "").split(",") if r.strip()]

    def run() -> None:
        ctx = ssl.create_default_context()
        server = smtplib.SMTP_SSL(host, port, timeout=20, context=ctx) if cfg.get("security") == "ssl" else smtplib.SMTP(host, port, timeout=20)
        try:
            if cfg.get("security") != "ssl":
                server.starttls(context=ctx)
            server.login(cfg["username"], secrets["password"])
            if not check_only:
                msg = EmailMessage()
                msg["Subject"], msg["From"], msg["To"] = subject, cfg["from_email"], ", ".join(recipients)
                msg.set_content(text or "")
                server.send_message(msg)
        finally:
            try:
                server.quit()
            except smtplib.SMTPException:
                pass

    try:
        await asyncio.to_thread(run)
    except smtplib.SMTPAuthenticationError as exc:
        raise DeliveryError("SMTP login failed: check the username and password (Gmail and Outlook need an app password)") from exc
    except smtplib.SMTPRecipientsRefused as exc:
        raise DeliveryError(f"The mail server refused the recipients: {', '.join(exc.recipients)}") from exc
    except smtplib.SMTPException as exc:
        raise DeliveryError(f"SMTP error from {host}: {exc}") from exc
    except OSError as exc:
        raise DeliveryError(f"Could not reach the SMTP server {host}:{port} ({exc.__class__.__name__}); check host, port and security",
                            retryable=True) from exc


def rest_url(conn: Connection, path: str) -> str:
    """Resolve `path` against the connection's base URL and enforce the host allowlist."""
    from urllib.parse import urljoin, urlsplit

    cfg = conn.config or {}
    base = cfg["base_url"].rstrip("/") + "/"
    url = urljoin(base, path.lstrip("/")) if path and not path.startswith(("http://", "https://")) else (path or base)
    allowed = {urlsplit(base).hostname} | {h.strip().lower() for h in str(cfg.get("allowed_hosts") or "").split(",") if h.strip()}
    host = (urlsplit(url).hostname or "").lower()
    if host not in allowed:
        raise DeliveryError(f"Host '{host}' is not allowed for {conn.name} (allowed: {', '.join(sorted(h for h in allowed if h))})")
    return url


def _rest_headers(conn: Connection, secrets: dict[str, str]) -> dict[str, str]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if secrets.get("auth_value"):
        headers[(conn.config or {}).get("auth_header") or "Authorization"] = secrets["auth_value"]
    return headers


async def rest_request(conn: Connection, method: str, path: str, body: Any, fetcher: Fetcher) -> dict[str, Any]:
    if conn.kind != "rest_api":
        raise DeliveryError(f"{conn.name} is not a REST API connection")
    missing = missing_fields(conn)
    if missing:
        raise DeliveryError(f"{conn.name} is missing: {', '.join(missing)}")
    url = rest_url(conn, path)
    resp = await _send(fetcher, method.upper(), url, log=(conn, f"http.{method.lower()}"), headers=_rest_headers(conn, read_secrets(conn)),
                       content=json.dumps(body, ensure_ascii=False, default=str).encode() if body is not None else None)
    data = _check(resp, conn.name)
    return {"status": resp.status_code, "body": data}
