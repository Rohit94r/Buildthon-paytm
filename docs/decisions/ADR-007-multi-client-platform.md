# ADR-007: From single-site newsroom to multi-client agent platform

**Status:** Accepted · **Date:** 2026-11-13 · **Supersedes:** the "single-tenant UI" part of [ADR-006](./ADR-006-tenant-scoped-data.md)

## Context

LayerFlow was built for one publication (TEN): a fixed 10-agent editorial pipeline, configured mostly in code and YAML. New clients need different agent teams: a news site wants scrape → persona rewrite → multi-format → auto-post, and a college portal wants data collection into datasets plus a real-time comparison assistant. Building a separate product per client does not scale for one operator.

## Decision

1. **Workspaces.** Each client is a workspace (the existing `tenants` table). A platform admin switches between workspaces with the `X-Workspace` header. All existing tenant-scoped code works unchanged.
2. **Configurable agents from a fixed catalog of 11 agent types**, not free-form code. Each type has a typed config schema rendered as a form in the dashboard. That covers most client needs safely; `custom_llm` covers the rest.
3. **Pipelines = ordered steps of agents** passing a uniform `FlowItem` list, with manual, interval or webhook triggers and an optional approval gate before publishing. A linear chain is easy to reason about, test and show to clients; branching can come later.
4. **Content, Datasets and Connections are first-class**, so outputs reach client sites through a **public API with scoped keys**, signed webhooks, an embeddable widget and ready-made Next.js/WordPress kits.
5. **The newsroom engine becomes a module** (`modules: ["newsroom"]`) instead of the whole product.
6. **Real-time assistant bypasses the job queue** and uses the warm fast model. Comparison tables are computed deterministically from records.
7. **The dashboard has a demo mode** (in-browser mock backend) so the product can be shown without any server.

## Consequences

- One deployment serves many clients. The model is the shared bottleneck, so model sizing ([models.md](../setup/models.md)) becomes the main capacity lever.
- Agent behaviour is constrained to the catalog, which keeps it predictable but means some client asks need a new agent type (a code change). That trade-off is deliberate.
- Client-user logins (clients seeing only their own workspace) are a short follow-up: the data model already supports it.
