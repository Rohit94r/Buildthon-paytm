# SDKs, external runs and MCP

Use these when a client's **app or backend** (not only its website) needs to work with LayerFlow: read content and data, ask the assistant, or **start agents and workflows** and fetch their results.

## API keys and scopes

Create keys in **Integrations → API keys**. Each key belongs to one workspace and has only the scopes you choose:

| Scope | Allows |
| --- | --- |
| `content:read` | Published content |
| `datasets:read` | Public datasets |
| `assistant:chat` | The assistant (the only scope safe to expose in a browser) |
| `runs:write` | Start workflows and agents |
| `runs:read` | Read run status and output |

## TypeScript / JavaScript: [`packages/sdk-typescript`](../../packages/sdk-typescript/src/index.ts)

Zero dependencies. Works in Node 18+, Next.js (server), Bun, Deno, edge runtimes. Install from the repo (`npm i ./packages/sdk-typescript`), or copy `src/index.ts` into your project.

```ts
import { LayerFlow, verifyWebhook } from "@layerflow/sdk";

const lf = new LayerFlow({ baseUrl: "https://agents.yourcompany.com", apiKey: process.env.LAYERFLOW_API_KEY! });

// read
const { items: posts } = await lf.content.list({ limit: 10, tag: "markets" });
const { items: hackathons } = await lf.datasets.records("hackathons", { sort: "registration_deadline:asc" });
const answer = await lf.chat({ dataset: "colleges", message: "IIT Delhi vs NIT Trichy on fees" });

// run a workflow from your app (e.g. when a user submits a URL) and wait for the result
const run = await lf.workflows.run("PIPELINE_ID", { input: { url: "https://example.org/event" } }, { wait: true, idempotencyKey: formId });
if (run.status === "succeeded") console.log(run.output?.items);

// run one agent
await lf.agents.run("AGENT_ID", { input: { text: "Summarise this lead: …" } });

// verify an incoming webhook (raw body!)
const ok = await verifyWebhook(rawBody, req.headers.get("x-layerflow-signature"), process.env.LAYERFLOW_WEBHOOK_SECRET!);
```

## Python: [`packages/sdk-python`](../../packages/sdk-python/layerflow/__init__.py)

Standard library only (Python 3.9+). Install with `pip install ./packages/sdk-python`.

```python
from layerflow import LayerFlow, verify_webhook

lf = LayerFlow("https://agents.yourcompany.com", api_key="lf_pk_...")
colleges = lf.datasets.records("colleges", sort="nirf_rank:asc")["items"]
run = lf.workflows.run("PIPELINE_ID", input={"url": "https://example.org"}, wait=True, idempotency_key="lead-123")
print(run["status"], run["output"])
```

## Plain HTTP

```bash
curl -X POST https://agents.yourcompany.com/api/public/v1/workflows/PIPELINE_ID/run \
  -H "X-API-Key: lf_pk_..." -H "Content-Type: application/json" -H "Idempotency-Key: lead-123" \
  -d '{"input":{"data":{"name":"Asha","phone":"98xxxxxx","course":"Data Science"}}}'

curl https://agents.yourcompany.com/api/public/v1/runs/RUN_ID -H "X-API-Key: lf_pk_..."
```

The same `Idempotency-Key` within 24 hours returns the original run instead of starting a new one, so form re-submits and retries are safe.

## MCP (optional): [`integrations/mcp/layerflow_mcp.py`](../../integrations/mcp/layerflow_mcp.py)

Exposes a workspace to MCP clients (Claude Desktop, IDE agents) as tools: `list_content`, `search_dataset`, `ask_assistant`, `run_workflow`, `get_run`. It's a thin layer over the public API, so it only sees what its API key's scopes allow. LayerFlow itself does not depend on MCP.

```bash
pip install "./packages/sdk-python[mcp]"
LAYERFLOW_URL=https://agents.yourcompany.com LAYERFLOW_API_KEY=lf_pk_... python integrations/mcp/layerflow_mcp.py
```
