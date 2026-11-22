# Webhooks (any backend)

When the Auto Publisher sends content to a **Webhook** or **Next.js** connection, LayerFlow POSTs:

```http
POST <your URL>
Content-Type: application/json
X-LayerFlow-Event: content.published
X-LayerFlow-Signature: sha256=<hex HMAC-SHA256 of the raw request body, keyed with the connection secret>
```

```json
{
  "event": "content.published",
  "workspace": "marketpulse",
  "content": {
    "id": "…", "slug": "rbi-holds-repo-rate-at-6-5", "title": "…", "summary": "…",
    "body_markdown": "…", "body_html": "…", "format": "article",
    "variants": { "linkedin_post": "…", "x_thread": "…", "instagram_caption": "…" },
    "tags": ["markets", "rbi"], "image_url": null, "source_url": "https://…",
    "seo": { "title_tag": "…", "meta_description": "…", "json_ld": { } },
    "published_at": "2026-11-13T08:30:00Z"
  }
}
```

**Verify the signature on the raw bytes** before parsing, and respond `2xx` within 10 seconds. Non-2xx responses are retried 3 times (30 s, 2 min, 10 min), and the failure is shown on the content item in the dashboard.

Ready-made receivers: [`integrations/webhook-receivers/express.js`](../../integrations/webhook-receivers/express.js), [`fastapi_receiver.py`](../../integrations/webhook-receivers/fastapi_receiver.py), the Next.js route in [`integrations/nextjs/app/api/layerflow/route.ts`](../../integrations/nextjs/app/api/layerflow/route.ts), and the WordPress plugin.

## Inbound: trigger a pipeline from outside

Each pipeline with a **webhook trigger** gets a URL like:

```
POST https://agents.yourcompany.com/api/public/v1/hooks/pipelines/<pipeline id>?token=<secret>
```

Call it from a form submission, a cron job, Zapier/Make, or another system to start a run. The token is shown on the pipeline page and can be rotated by switching the trigger off and on.
