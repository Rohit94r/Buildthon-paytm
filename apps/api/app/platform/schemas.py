"""Request bodies for the platform API (shapes from platform-types.ts)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.platform.catalog import AGENT_KINDS

Module = Literal["newsroom", "pipelines", "datasets", "assistant"]
ConnectionKind = Literal["nextjs", "wordpress", "webhook", "linkedin", "telegram", "x", "ghost", "slack", "discord", "email_smtp", "rest_api"]
ApiScope = Literal["content:read", "datasets:read", "assistant:chat", "runs:write", "runs:read"]
Role = Literal["owner", "admin", "developer", "operator", "analyst", "viewer"]
PlanKey = Literal["free", "starter", "pro", "business", "enterprise"]
INDUSTRIES = ("news_media", "education", "executive_media", "ecommerce", "blog", "events", "other")
HEX = r"^#[0-9a-fA-F]{6}$"


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class WorkspaceCreate(Body):
    name: str = Field(min_length=2, max_length=120)
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{1,40}$")
    industry: str = Field(default="other", max_length=32)
    brand_color: str | None = Field(default=None, pattern=HEX)
    domain: str | None = Field(default=None, max_length=200)
    timezone: str | None = Field(default=None, max_length=64)
    blueprint: str | None = None


class WorkspacePatch(Body):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    industry: str | None = Field(default=None, max_length=32)
    brand_color: str | None = Field(default=None, pattern=HEX)
    domain: str | None = Field(default=None, max_length=200)
    timezone: str | None = Field(default=None, max_length=64)
    modules: list[Module] | None = None
    website: str | None = Field(default=None, max_length=300)
    status: Literal["active", "suspended"] | None = None  # platform admin only
    models: dict[Literal["fast", "writer", "embed"], str] | None = None  # per-workspace model profile overrides
    plan: PlanKey | None = None  # platform admin only


class WorkspaceDelete(Body):
    confirm: str


class ScheduleIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    every_minutes: int | None = Field(default=None, ge=0, le=60 * 24 * 31)


class LimitsIn(Body):
    max_items: int | None = Field(default=None, ge=0, le=10_000)
    timeout_s: int | None = Field(default=None, ge=10, le=7200)
    max_retries: int | None = Field(default=None, ge=0, le=3)
    allow_model_fallback: bool | None = None


class AgentWrite(Body):
    name: str = Field(min_length=2, max_length=120)
    kind: str
    description: str | None = Field(default=None, max_length=2000)
    config: dict[str, Any] | None = None
    model: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    schedule: ScheduleIn | None = None
    requires_approval: bool | None = None
    limits: LimitsIn | None = None

    def kind_ok(self) -> bool:
        return self.kind in AGENT_KINDS


class AgentPatch(Body):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    kind: str | None = None  # accepted only if unchanged (the dashboard sends the full AgentWrite)
    description: str | None = Field(default=None, max_length=2000)
    config: dict[str, Any] | None = None
    model: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool | None = None
    schedule: ScheduleIn | None = None
    requires_approval: bool | None = None
    limits: LimitsIn | None = None
    version_note: str | None = Field(default=None, max_length=300)


class ActivateIn(Body):
    name: str | None = Field(default=None, min_length=2, max_length=120)


class TestInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str | None = None
    url: str | None = None
    items: list[dict[str, Any]] | None = Field(default=None, max_length=50)


class AgentTestRequest(Body):
    input: TestInput | None = None
    config_override: dict[str, Any] | None = None


class StepCondition(Body):
    field: str = Field(min_length=1, max_length=120)
    op: Literal["gt", "gte", "lt", "lte", "eq", "neq", "contains", "not_contains", "exists", "empty", "not_empty"]
    value: Any = None


class StepWrite(Body):
    id: str | None = None
    agent_id: str | None = None
    overrides: dict[str, Any] | None = None
    type: Literal["agent", "approval"] = "agent"
    condition: StepCondition | None = None
    on_error: Literal["stop", "continue", "retry"] = "stop"
    retries: int = Field(default=0, ge=0, le=3)
    label: str | None = Field(default=None, max_length=120)
    # read-only fields the dashboard may echo back
    agent_name: str | None = None
    kind: str | None = None


class TriggerWrite(Body):
    type: Literal["manual", "schedule", "webhook"] = "manual"
    every_minutes: int | None = Field(default=None, ge=5, le=60 * 24 * 31)


class PipelineWrite(Body):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    steps: list[StepWrite] = Field(default_factory=list, max_length=20)
    trigger: TriggerWrite = Field(default_factory=TriggerWrite)
    require_approval: bool | None = None
    enabled: bool | None = None


class PipelinePatch(Body):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    steps: list[StepWrite] | None = Field(default=None, max_length=20)
    trigger: TriggerWrite | None = None
    require_approval: bool | None = None
    enabled: bool | None = None


class RunRequest(Body):
    input: TestInput | None = None


class RunDecision(Body):
    note: str | None = Field(default=None, max_length=1000)
    reason: str | None = Field(default=None, max_length=1000)


class PublicRunInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text: str | None = Field(default=None, max_length=50_000)
    url: str | None = Field(default=None, max_length=2000)
    items: list[dict[str, Any]] | None = Field(default=None, max_length=100)
    data: dict[str, Any] | None = None


class PublicRunRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    input: PublicRunInput | None = None
    wait: bool = False


class InviteIn(Body):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str | None = Field(default=None, max_length=200)
    role: Role


class MemberPatch(Body):
    role: Role


class VariantWrite(Body):
    format: Literal["article", "blog_post", "linkedin_post", "x_thread", "instagram_caption", "facebook_post", "newsletter",
                    "short_video_script", "whatsapp_message"]
    title: str | None = None
    body: str = Field(max_length=100_000)
    char_count: int | None = None  # ignored; recomputed


class ContentPatch(Body):
    title: str | None = Field(default=None, min_length=2, max_length=500)
    summary: str | None = Field(default=None, max_length=2000)
    tags: list[str] | None = Field(default=None, max_length=20)
    variants: list[VariantWrite] | None = Field(default=None, max_length=20)


class RejectIn(Body):
    reason: str = Field(default="Rejected", max_length=1000)


class PublishIn(Body):
    connection_ids: list[str] | None = None


class DatasetFieldIn(Body):
    key: str = Field(min_length=1, max_length=64)
    label: str | None = Field(default=None, max_length=120)
    type: Literal["text", "number", "currency", "url", "list", "rating", "boolean", "date"] = "text"
    compare: bool | None = None
    unit: str | None = Field(default=None, max_length=16)
    higher_is_better: bool | None = None


class DatasetWrite(Body):
    name: str = Field(min_length=2, max_length=120)
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{1,60}$")
    description: str | None = Field(default=None, max_length=2000)
    key_field: str
    fields: list[DatasetFieldIn] = Field(min_length=1, max_length=60)
    public: bool | None = None


class DatasetPatch(Body):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9-]{1,60}$")
    description: str | None = Field(default=None, max_length=2000)
    key_field: str | None = None
    fields: list[DatasetFieldIn] | None = Field(default=None, min_length=1, max_length=60)
    public: bool | None = None


class RecordWrite(Body):
    data: dict[str, Any]
    source_url: str | None = Field(default=None, max_length=2000)


class RecordPatch(Body):
    data: dict[str, Any] | None = None
    source_url: str | None = Field(default=None, max_length=2000)


class ImportIn(Body):
    rows: list[dict[str, Any]] = Field(max_length=5000)


class ChatMessage(Body):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ChatRequest(Body):
    assistant_id: str | None = None
    dataset: str | None = None
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] | None = Field(default=None, max_length=20)
    compare_keys: list[str] | None = Field(default=None, max_length=10)


class ConnectionWrite(Body):
    name: str = Field(min_length=1, max_length=120)
    kind: ConnectionKind
    config: dict[str, Any] | None = None


class ConnectionPatch(Body):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: ConnectionKind | None = None
    config: dict[str, Any] | None = None


class ApiKeyCreate(Body):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[ApiScope] = Field(min_length=1)
