# Embed widget: real-time AI assistant on any website

One script tag adds a chat assistant that answers questions and **compares records side by side** (colleges, products, plans) from a LayerFlow dataset. It works on any site: plain HTML, WordPress, Webflow, Wix, Shopify, Next.js.

```html
<script src="https://agents.yourcompany.com/widget.js"
        data-key="lf_pk_xxxxxxxx"
        data-dataset="colleges"
        data-title="Compare colleges"
        data-color="#2563eb"
        defer></script>
```

| Attribute | Required | Meaning |
| --- | --- | --- |
| `data-key` | yes | API key with **only** the `assistant:chat` scope (it is visible in the page source; that scope is the only thing it allows) |
| `data-dataset` | one of | Dataset slug to answer from |
| `data-assistant` | one of | A specific *comparison_assistant* agent id (uses its instructions and dataset) |
| `data-title` | no | Header text |
| `data-color` | no | Brand colour (hex) |
| `data-position` | no | `right` (default) or `left` for the floating bubble |
| `data-greeting` | no | First message |
| `data-inline` | no | CSS selector of an element to render inside, instead of a floating bubble |

Control it from the page: `window.LayerFlow.open()`, `.close()`, `.ask("Compare IIT Bombay and BITS Pilani")`. For example, a "Compare" button on a college card can call `LayerFlow.ask(...)`.

## How it answers

1. The visitor's question goes to `POST /api/public/v1/chat` (rate-limited per key and IP).
2. LayerFlow finds the records mentioned (fuzzy name match + keyword search) **without calling the model**.
3. The **comparison table is computed from the data itself**, with the best value per row highlighted, so numbers are never invented.
4. The fast local model writes a short answer grounded only in those records and suggests follow-up questions.

The widget renders inside a Shadow DOM: the host site's CSS can't break it, and it can't break the site. It adapts to dark mode and phone screens.
