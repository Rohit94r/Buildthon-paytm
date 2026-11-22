# Next.js sites

About 10 minutes. Content stays in LayerFlow. The site fetches it with ISR caching, and LayerFlow pings the site to refresh the moment something is published.

## 1. In LayerFlow (client workspace)

1. **Connections → API keys → New key**: name `website`, scopes `content:read` + `datasets:read`. Copy the secret.
2. **Connections → Next.js site → Set up**:
   - Receiver URL: `https://clientsite.com/api/layerflow`
   - Signing secret: any long random string (save it; the site needs the same value)
   - Public site URL: `https://clientsite.com` · Article path: `/news` (used to build live links)
   - **Test**: expect a failure until step 2 is deployed, then OK.
3. Add this connection to the pipeline's **Auto Publisher** agent.

## 2. In the client's Next.js project

```bash
# .env.local (and the hosting provider's env settings)
LAYERFLOW_API_URL=https://agents.yourcompany.com
LAYERFLOW_API_KEY=lf_pk_xxxxxxxx
LAYERFLOW_WEBHOOK_SECRET=the-same-secret-as-the-connection
# only if you use the assistant widget:
NEXT_PUBLIC_LAYERFLOW_URL=https://agents.yourcompany.com
NEXT_PUBLIC_LAYERFLOW_CHAT_KEY=lf_pk_yyyyyyyy   # a separate key with ONLY assistant:chat
```

Copy from [`integrations/nextjs/`](../../integrations/nextjs/):

| File | Purpose |
| --- | --- |
| `lib/layerflow.ts` | `getPosts()`, `getPost(slug)`, `getRecords(dataset)`, `getRecord()`, `askAssistant()`. Server-side, cached 5 min |
| `app/api/layerflow/route.ts` | Verifies `X-LayerFlow-Signature` and revalidates pages on publish |
| `app/news/page.tsx`, `app/news/[slug]/page.tsx` | Example listing + article page with SEO metadata and JSON-LD from the SEO agent |
| `app/colleges/compare/page.tsx` | Example dataset table + inline comparison assistant |

Usage anywhere in a server component:

```tsx
import { getPosts, getRecords } from "@/lib/layerflow";

const { items: posts } = await getPosts({ limit: 10, tag: "markets" });
const { items: colleges } = await getRecords("colleges", { sort: "nirf_rank:asc" });
```

## 3. How publishing flows

```
Pipeline run → content approved → Auto Publisher → POST https://clientsite.com/api/layerflow (signed)
                                                    → revalidatePath() → next request renders the new post
```

No database on the client side, no rebuilds, no redeploys.

## Variant: store posts in the site's own database

If the site has its own CMS or database, handle the webhook payload yourself. `event.content` contains the full post (`body_html`, `body_markdown`, `variants`, `seo`, `tags`). See [webhook.md](./webhook.md).
