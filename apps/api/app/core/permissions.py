"""Workspace roles -> permissions (docs/platform/API.md §5). The server enforces these on every mutating route;
the dashboard only hides what a role cannot do."""

from __future__ import annotations

ROLES = ("owner", "admin", "developer", "operator", "analyst", "viewer")
PERMISSIONS = (
    "workspace.manage",
    "members.manage",
    "agents.manage",
    "agents.run",
    "content.approve",
    "integrations.manage",
    "data.edit",
    "view",
)
# Not part of the public Permission union: who may read usage + the audit trail.
INSIGHT = "insight.view"

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset(PERMISSIONS) | {INSIGHT},
    "admin": frozenset(PERMISSIONS) | {INSIGHT},  # minus workspace deletion / owner changes (checked where they happen)
    "developer": frozenset({"agents.manage", "agents.run", "integrations.manage", "data.edit", "view"}),
    "operator": frozenset({"agents.run", "content.approve", "data.edit", "view"}),
    "analyst": frozenset({"view", INSIGHT}),
    "viewer": frozenset({"view"}),
}
# Read-only access for platform admins in workspaces they are not a member of (audited as support_access).
SUPPORT_PERMISSIONS = frozenset({"view", INSIGHT})

# The newsroom's original user roles map onto workspace roles: an editor wrote and approved, a reviewer approved.
LEGACY_ROLE = {"owner": "owner", "editor": "operator", "reviewer": "operator"}


def permissions_for(role: str | None) -> frozenset[str]:
    return ROLE_PERMISSIONS.get(role or "", frozenset())


def public_permissions(perms: frozenset[str]) -> list[str]:
    return [p for p in PERMISSIONS if p in perms]
