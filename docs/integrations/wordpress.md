# WordPress sites and blogs

## Option A: no plugin (fastest)

LayerFlow publishes straight into WordPress through its built-in REST API.

1. In WordPress: **Users → Profile → Application Passwords** → name it `LayerFlow` → **Add**. Copy the password.
2. In LayerFlow: **Connections → WordPress → Set up**:
   - Site URL `https://clientblog.com`, username, application password
   - Post status: *Publish* or *Save as draft* (draft lets the client review in WP too)
   - **Test**: checks the credentials against `/wp-json/wp/v2/users/me`.
3. Add the connection to the pipeline's **Auto Publisher**.

Posts arrive with title, content, excerpt, tags and slug.

## Option B: the LayerFlow Connector plugin (more features)

[`integrations/wordpress/layerflow-connector/`](../../integrations/wordpress/layerflow-connector/layerflow-connector.php) is one PHP file.

**Install:** zip the `layerflow-connector` folder → WP Admin → Plugins → Add New → Upload → Activate.

**Configure:** Settings → LayerFlow:

| Field | Value |
| --- | --- |
| LayerFlow URL | `https://agents.yourcompany.com` |
| Server API key | key with `content:read` + `datasets:read` (stays on the server) |
| Assistant key (public) | key with **only** `assistant:chat` (visible in the page source) |
| Webhook secret | the same secret as the LayerFlow **Webhook** connection |
| New posts | Publish / Draft / Pending review |

Then in LayerFlow add a **Webhook** connection with URL `https://clientblog.com/wp-json/layerflow/v1/publish` and that value as the signing secret.

What the plugin adds:

- **Idempotent publishing**: re-publishing updates the same post (matched by LayerFlow id).
- **SEO meta** written for Yoast, Rank Math and AIOSEO (title tag + meta description from the SEO agent).
- **Shortcodes** for any page or post:

```text
[layerflow_assistant dataset="colleges" title="Compare colleges"]
[layerflow_table dataset="colleges" fields="name,city,fees_total,avg_package,placement_rate" sort="nirf_rank:asc"]
[layerflow_posts limit="5" tag="admissions"]
```

`layerflow_table` and `layerflow_posts` render server-side (good for SEO) and are cached for 5–10 minutes.
