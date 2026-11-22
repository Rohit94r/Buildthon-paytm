# Connecting client websites

Pick the path that matches the client's site. Every path uses the same building blocks:

| Building block | What it is | Where |
| --- | --- | --- |
| **API key** | `lf_pk_…`, bound to one workspace, with scopes `content:read` · `datasets:read` · `assistant:chat` | Dashboard → Connections → API keys |
| **Public API** | Read published content and datasets, ask the assistant | `/api/public/v1/…` ([API.md §3](../platform/API.md#3-public-api-apipublicv1)) |
| **Connection** | Where the auto-publisher pushes content (Next.js, WordPress, webhook, LinkedIn, Telegram, X, Ghost) | Dashboard → Connections |
| **Signed webhook** | `content.published` POST with an `X-LayerFlow-Signature` HMAC | [webhook.md](./webhook.md) |
| **Widget** | One `<script>` tag that adds the real-time comparison assistant to any page | [embed-widget.md](./embed-widget.md) |

## Which guide?

| Client site | Guide | Effort |
| --- | --- | --- |
| Next.js (App Router) | [nextjs.md](./nextjs.md) | 2 files + 3 env vars, about 10 minutes |
| WordPress / any WP blog | [wordpress.md](./wordpress.md) | Application Password (no plugin), or upload one plugin file |
| Plain HTML / Webflow / Wix / Shopify | [embed-widget.md](./embed-widget.md) | Paste one script tag |
| Custom backend (Node, Python, PHP…) | [webhook.md](./webhook.md) + Public API | Verify one HMAC header |
| Any app that should **start** agents/workflows and read results | [sdk.md](./sdk.md): TypeScript + Python SDK, REST, optional MCP | A few lines |
| Telegram · Slack · Discord · Email · LinkedIn · X · Ghost · CRM/REST API | [channels.md](./channels.md) | 2–5 minutes each |

Ready-to-copy code lives in [`/integrations`](../../integrations/):

```
integrations/
  nextjs/            lib/layerflow.ts · app/api/layerflow/route.ts · example pages (news, article, college compare)
  wordpress/         layerflow-connector/layerflow-connector.php (plugin)
  webhook-receivers/ express.js · fastapi_receiver.py
  mcp/               layerflow_mcp.py (optional MCP adapter)
packages/sdk-typescript · packages/sdk-python   API clients (runs, content, datasets, assistant, webhook verification)
apps/web/public/widget.js   the embeddable assistant (served at https://<your-layerflow-domain>/widget.js)
```
