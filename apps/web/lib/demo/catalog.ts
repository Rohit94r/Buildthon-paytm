// Demo catalog: agent types, blueprints and connection kinds served by the platform mock (lib/demo/platform.ts).
// Mirrors what the FastAPI backend exposes on /agent-types, /blueprints and /connection-kinds.

import type { AgentKind, AgentType, Blueprint, ConfigField, ConnectionKind, ConnectionKindInfo, ContentFormat, Module } from "@/lib/platform-types";

/* ------------------------------------------------------------------ */
/* Agent types                                                         */
/* ------------------------------------------------------------------ */

export const FORMAT_LABELS: Record<ContentFormat, string> = {
  article: "Article",
  blog_post: "Blog post",
  linkedin_post: "LinkedIn post",
  x_thread: "X thread",
  instagram_caption: "Instagram caption",
  facebook_post: "Facebook post",
  newsletter: "Newsletter",
  short_video_script: "Short video script",
  whatsapp_message: "WhatsApp message",
};

export const ALL_FORMATS = Object.keys(FORMAT_LABELS) as ContentFormat[];

const modelField = (def: "fast" | "writer"): ConfigField => ({
  key: "model",
  label: "Model",
  type: "model",
  default: def,
  help: "“fast” for extraction and checks, “writer” for long-form copy, or an explicit Ollama tag.",
});

export const AGENT_TYPES: AgentType[] = [
  {
    kind: "web_scraper",
    name: "Web scraper",
    description: "Crawls pages, RSS feeds and sitemaps and turns them into structured items with CSS selectors or AI extraction.",
    category: "collect",
    icon: "Globe",
    uses_model: true,
    default_model: "fast",
    inputs: "Nothing (start of a pipeline) or URLs from the previous step",
    outputs: "Items with title, url, text and extracted fields",
    config_schema: [
      { key: "sources", label: "Sources", type: "sources", required: true, default: [], help: "Pages, RSS feeds, sitemaps or JSON endpoints to crawl." },
      {
        key: "extraction",
        label: "Extraction mode",
        type: "select",
        default: "auto",
        options: [
          { value: "auto", label: "Automatic (the AI reads the page)" },
          { value: "tables", label: "Tables on the page" },
          { value: "structured", label: "Structured data (JSON-LD, microdata)" },
          { value: "crawl", label: "Crawl the site and read every page" },
          { value: "css", label: "CSS selectors (advanced)" },
        ],
      },
      { key: "extract_fields", label: "Fields to extract", type: "extract_fields", default: [], help: "Each field becomes a key in item.data. Add a selector to skip the model for that field." },
      { key: "max_items", label: "Max items per run", type: "number", default: 50, min: 1, max: 500 },
      { key: "follow_links", label: "Follow links to detail pages", type: "boolean", default: false },
      { key: "include_keywords", label: "Only keep items mentioning", type: "string_list", default: [], placeholder: "e.g. hackathon" },
      modelField("fast"),
    ],
  },
  {
    kind: "news_monitor",
    name: "News monitor",
    description: "Watches feeds, Google News and GDELT for your keywords and returns fresh, de-duplicated stories.",
    category: "collect",
    icon: "Radar",
    uses_model: false,
    default_model: null,
    inputs: "Nothing (start of a pipeline)",
    outputs: "News items with source, time and full text",
    config_schema: [
      { key: "sources", label: "Feeds", type: "sources", default: [], help: "RSS / Atom feeds. Leave empty to use Google News search for the keywords." },
      { key: "keywords", label: "Keywords", type: "string_list", required: true, default: [], placeholder: "e.g. Sensex" },
      { key: "exclude_keywords", label: "Exclude keywords", type: "string_list", default: [] },
      {
        key: "languages",
        label: "Languages",
        type: "multiselect",
        default: ["en"],
        options: [
          { value: "en", label: "English" },
          { value: "hi", label: "Hindi" },
          { value: "mr", label: "Marathi" },
          { value: "ta", label: "Tamil" },
        ],
      },
      { key: "lookback_hours", label: "Look back (hours)", type: "number", default: 24, min: 1, max: 168 },
      { key: "max_items", label: "Max items per run", type: "number", default: 40, min: 1, max: 200 },
    ],
  },
  {
    kind: "persona_rewriter",
    name: "Persona rewriter",
    description: "Rewrites each item in a named persona or brand voice, keeping every fact from the source.",
    category: "create",
    icon: "Feather",
    uses_model: true,
    default_model: "writer",
    inputs: "Items with text",
    outputs: "The same items, rewritten (title, summary, body)",
    config_schema: [
      {
        key: "persona",
        label: "Persona",
        type: "textarea",
        required: true,
        default: "You write for a smart, busy reader. Lead with the news, explain why it matters, keep every number from the source and never invent quotes.",
        help: "Who is writing, for whom, and the house rules. Mention the persona's name to sign the copy.",
      },
      {
        key: "tone",
        label: "Tone",
        type: "select",
        default: "analytical",
        options: [
          { value: "authoritative", label: "Authoritative" },
          { value: "analytical", label: "Analytical" },
          { value: "conversational", label: "Conversational" },
          { value: "friendly", label: "Friendly" },
          { value: "punchy", label: "Punchy" },
        ],
      },
      {
        key: "length",
        label: "Length",
        type: "select",
        default: "medium",
        options: [
          { value: "short", label: "Short (~150 words)" },
          { value: "medium", label: "Medium (~400 words)" },
          { value: "long", label: "Long (~800 words)" },
        ],
      },
      { key: "banned_phrases", label: "Banned phrases", type: "string_list", default: ["in today's fast-paced world", "delve", "game-changer"] },
      modelField("writer"),
    ],
  },
  {
    kind: "multi_format",
    name: "Multi-format creator",
    description: "Turns one item into an article, LinkedIn post, X thread, Instagram caption, newsletter and video script in one pass.",
    category: "create",
    icon: "Layers",
    uses_model: true,
    default_model: "writer",
    inputs: "Items with text",
    outputs: "Items with one variant per selected format",
    config_schema: [
      { key: "formats", label: "Formats", type: "formats", required: true, default: ["article", "linkedin_post", "x_thread", "instagram_caption"] },
      {
        key: "instructions",
        label: "Per-format instructions",
        type: "textarea",
        default: "LinkedIn: hook in the first line, short paragraphs.\nX: numbered thread, max 6 tweets.\nInstagram: emojis allowed, 8–12 hashtags.",
        help: "One line per format. Applied on top of the persona.",
      },
      { key: "hashtags", label: "Add hashtags", type: "boolean", default: true },
      { key: "max_hashtags", label: "Max hashtags (LinkedIn / X)", type: "number", default: 3, min: 0, max: 10 },
      modelField("writer"),
    ],
  },
  {
    kind: "seo_optimizer",
    name: "SEO optimizer",
    description: "Writes the title tag, meta description, slug, keywords and JSON-LD for each item.",
    category: "quality",
    icon: "Search",
    uses_model: true,
    default_model: "fast",
    inputs: "Items with a title and body",
    outputs: "The same items with an SEO block",
    config_schema: [
      { key: "focus_keywords", label: "Focus keywords", type: "string_list", default: [] },
      { key: "site_name", label: "Site name", type: "text", default: "", placeholder: "Appended to title tags" },
      {
        key: "schema_type",
        label: "JSON-LD type",
        type: "select",
        default: "Article",
        options: [
          { value: "NewsArticle", label: "NewsArticle" },
          { value: "Article", label: "Article" },
          { value: "BlogPosting", label: "BlogPosting" },
          { value: "FAQPage", label: "FAQPage" },
        ],
      },
      { key: "title_max", label: "Title tag max length", type: "number", default: 60, min: 40, max: 70 },
      { key: "meta_max", label: "Meta description max length", type: "number", default: 155, min: 120, max: 170 },
      modelField("fast"),
    ],
  },
  {
    kind: "quality_gate",
    name: "Quality gate",
    description: "Scores every item for grounding, duplication, length and banned phrases, then passes, flags or drops it.",
    category: "quality",
    icon: "ShieldCheck",
    uses_model: true,
    default_model: "fast",
    inputs: "Items with text",
    outputs: "Items that passed, with a score and flags",
    config_schema: [
      { key: "min_score", label: "Minimum score", type: "number", default: 70, min: 0, max: 100 },
      {
        key: "checks",
        label: "Checks",
        type: "multiselect",
        default: ["fact_grounding", "duplication", "length", "banned_phrases"],
        options: [
          { value: "fact_grounding", label: "Fact grounding (numbers match the source)" },
          { value: "duplication", label: "Duplicate of recent content" },
          { value: "length", label: "Length" },
          { value: "banned_phrases", label: "Banned phrases" },
          { value: "tone", label: "Tone matches persona" },
          { value: "links", label: "Links resolve" },
        ],
      },
      { key: "min_words", label: "Minimum words (article)", type: "number", default: 150, min: 0, max: 5000 },
      { key: "banned_phrases", label: "Banned phrases", type: "string_list", default: [] },
      {
        key: "on_fail",
        label: "When an item fails",
        type: "select",
        default: "drop",
        options: [
          { value: "drop", label: "Drop it" },
          { value: "flag", label: "Keep it, flagged for review" },
        ],
      },
      modelField("fast"),
    ],
  },
  {
    kind: "data_transform",
    name: "Data transform",
    description: "Filters, de-duplicates, sorts, limits and AI-categorizes items, e.g. upcoming hackathons sorted by deadline.",
    category: "data",
    icon: "Filter",
    uses_model: true,
    default_model: "fast",
    inputs: "Items with data fields",
    outputs: "Fewer, cleaner, ordered items",
    config_schema: [
      { key: "dedupe_by", label: "De-duplicate by", type: "string_list", default: ["url"], help: "Items with the same value for any of these fields are merged." },
      {
        key: "filters",
        label: "Filters",
        type: "textarea",
        default: [],
        help: "JSON list of {field, op, value}; ops: eq|neq|contains|not_contains|gt|gte|lt|lte|exists|date_after_today|date_within_days",
        placeholder: '[{"field": "registration_deadline", "op": "date_after_today"}]',
      },
      { key: "sort_by", label: "Sort by field", type: "text", default: "", placeholder: "e.g. registration_deadline" },
      {
        key: "sort_order",
        label: "Sort order",
        type: "select",
        default: "asc",
        options: [
          { value: "asc", label: "Ascending" },
          { value: "desc", label: "Descending" },
        ],
      },
      { key: "limit", label: "Keep at most", type: "number", default: 50, min: 1, max: 1000 },
      { key: "ai_categorize", label: "AI-categorize items", type: "boolean", default: false },
      { key: "categories", label: "Categories", type: "string_list", default: [] },
      { key: "category_field", label: "Category field", type: "text", default: "category" },
    ],
  },
  {
    kind: "auto_publisher",
    name: "Auto publisher",
    description: "Pushes approved content to your connections: Next.js and WordPress sites, webhooks, LinkedIn, Telegram and X.",
    category: "deliver",
    icon: "Send",
    uses_model: false,
    default_model: null,
    inputs: "Approved content",
    outputs: "Publications (one per connection and format)",
    config_schema: [
      { key: "connections", label: "Publish to", type: "connections", required: true, default: [] },
      { key: "formats", label: "Formats to send", type: "formats", default: ["article"], help: "Each connection receives the best matching format (LinkedIn gets the LinkedIn post, X the thread…)." },
      {
        key: "publish_mode",
        label: "Publish mode",
        type: "select",
        default: "immediate",
        options: [
          { value: "immediate", label: "Publish immediately" },
          { value: "scheduled", label: "Next schedule slot" },
          { value: "draft", label: "Send as draft (WordPress / Ghost)" },
        ],
      },
    ],
  },
  {
    kind: "dataset_builder",
    name: "Dataset builder",
    description: "Scrapes structured records (or saves incoming pipeline items) into a dataset, upserting by its key field.",
    category: "data",
    icon: "Database",
    uses_model: true,
    default_model: "fast",
    inputs: "Nothing (scrape mode) or items from the previous step",
    outputs: "Upserted records (also passed on as items)",
    config_schema: [
      {
        key: "source_mode",
        label: "Source",
        type: "select",
        default: "scrape",
        options: [
          { value: "scrape", label: "Scrape sources" },
          { value: "pipeline_items", label: "Save incoming pipeline items" },
        ],
      },
      { key: "dataset", label: "Dataset", type: "dataset", required: true, default: "" },
      { key: "sources", label: "Sources", type: "sources", default: [], help: "Used in “Scrape sources” mode." },
      { key: "extract_fields", label: "Fields to extract", type: "extract_fields", default: [] },
      { key: "key_field", label: "Key field", type: "text", default: "name", help: "Records with the same value are updated instead of duplicated." },
      { key: "max_records", label: "Max records per run", type: "number", default: 200, min: 1, max: 1000 },
      modelField("fast"),
    ],
  },
  {
    kind: "comparison_assistant",
    name: "Comparison assistant",
    description: "Answers questions and builds side-by-side comparisons over a dataset in real time, on your site or in the dashboard.",
    category: "assist",
    icon: "MessagesSquare",
    uses_model: true,
    default_model: "fast",
    inputs: "A visitor's question",
    outputs: "An answer, the records used and a comparison table",
    config_schema: [
      { key: "dataset", label: "Dataset", type: "dataset", required: true, default: "" },
      {
        key: "system_prompt",
        label: "System prompt",
        type: "textarea",
        default: "You are a helpful, neutral advisor. Answer only from the dataset, quote numbers exactly, compare side by side and end with a clear recommendation.",
      },
      { key: "max_records", label: "Max records per answer", type: "number", default: 4, min: 1, max: 10 },
      { key: "suggested_questions", label: "Suggested questions", type: "string_list", default: [] },
      modelField("fast"),
    ],
  },
  {
    kind: "custom_llm",
    name: "Custom LLM step",
    description: "Runs your own prompt on every item and returns the output fields you define.",
    category: "create",
    icon: "Sparkles",
    uses_model: true,
    default_model: "writer",
    inputs: "Items",
    outputs: "Items with your output fields in item.data",
    config_schema: [
      { key: "prompt", label: "Prompt", type: "textarea", required: true, default: "Summarise the item in three bullet points for a busy reader.", help: "Use {title}, {text} and {data.field} placeholders." },
      { key: "output_fields", label: "Output fields", type: "extract_fields", default: [] },
      { key: "temperature", label: "Temperature", type: "number", default: 0.4, min: 0, max: 1.5 },
      modelField("writer"),
    ],
  },
  /* ---- wave 3 engines ---- */
  {
    kind: "link_collector",
    name: "Link collector",
    description: "Gathers links from pages, sitemaps and search results, keeps the ones matching your pattern and removes duplicates and tracking junk.",
    category: "collect",
    icon: "Link",
    uses_model: false,
    default_model: null,
    inputs: "Nothing (start of a pipeline) or pages from the previous step",
    outputs: "One item per clean, unique URL",
    config_schema: [
      { key: "start_urls", label: "Start pages", type: "string_list", required: true, default: [], placeholder: "https://example.com/shop", help: "Home pages, category pages or sitemap.xml links." },
      { key: "include_patterns", label: "Keep links containing", type: "string_list", default: [], placeholder: "/product/", help: "Leave empty to keep every link on the same site." },
      { key: "exclude_patterns", label: "Skip links containing", type: "string_list", default: ["/login", "/cart", "?utm_"] },
      { key: "use_sitemap", label: "Also read the sitemap", type: "boolean", default: true },
      { key: "same_site_only", label: "Only links on the same website", type: "boolean", default: true },
      { key: "max_links", label: "Max links per run", type: "number", default: 500, min: 10, max: 5000 },
    ],
  },
  {
    kind: "document_reader",
    name: "Document reader",
    description: "Opens PDFs and documents from links, pulls out the text and the fields you ask for, and passes them on.",
    category: "collect",
    icon: "FileText",
    uses_model: true,
    default_model: "fast",
    inputs: "Document links (or items with a document URL)",
    outputs: "One item per document with text and extracted fields",
    config_schema: [
      { key: "sources", label: "Documents", type: "sources", required: true, default: [], help: "Links to PDFs, Word files or plain-text documents." },
      { key: "extract_fields", label: "Fields to pull out", type: "extract_fields", default: [], help: "Describe each field in plain words, e.g. “total fees for the first year”." },
      { key: "max_pages", label: "Max pages per document", type: "number", default: 50, min: 1, max: 500 },
      { key: "keep_full_text", label: "Keep the full text", type: "boolean", default: false },
      modelField("fast"),
    ],
  },
  {
    kind: "page_watcher",
    name: "Page watcher",
    description: "Checks pages (or one part of a page, like a price) on a schedule and reports only what changed since the last check.",
    category: "data",
    icon: "Eye",
    uses_model: false,
    default_model: null,
    inputs: "Nothing (start of a pipeline)",
    outputs: "One item per changed page, with before and after",
    config_schema: [
      { key: "sources", label: "Pages to watch", type: "sources", required: true, default: [] },
      { key: "watch_selector", label: "Only watch this part (CSS selector)", type: "text", default: "", placeholder: ".price, #notices", help: "Leave empty to watch the main text of the page." },
      { key: "ignore_text", label: "Ignore changes containing", type: "string_list", default: ["Last updated", "visitors online"] },
      { key: "min_change_percent", label: "Ignore number changes smaller than (%)", type: "number", default: 0, min: 0, max: 100 },
    ],
  },
  {
    kind: "keyword_researcher",
    name: "Keyword researcher",
    description: "Expands topics into the questions and phrases people search for (free search suggestions + competitor pages) and groups them by intent.",
    category: "quality",
    icon: "KeyRound",
    uses_model: false,
    default_model: null,
    inputs: "Seed keywords (or items with titles)",
    outputs: "Keyword ideas grouped by intent",
    config_schema: [
      { key: "seed_keywords", label: "Seed keywords", type: "string_list", required: true, default: [], placeholder: "e.g. best budget phone" },
      { key: "competitor_urls", label: "Competitor pages", type: "string_list", default: [] },
      {
        key: "country",
        label: "Country",
        type: "select",
        default: "in",
        options: [
          { value: "in", label: "India" },
          { value: "us", label: "United States" },
          { value: "gb", label: "United Kingdom" },
          { value: "ae", label: "UAE" },
        ],
      },
      { key: "max_ideas", label: "Max ideas", type: "number", default: 150, min: 10, max: 1000 },
      { key: "group_by_intent", label: "Group by intent (learn / compare / buy / local)", type: "boolean", default: true },
    ],
  },
  {
    kind: "comparer",
    name: "Comparer",
    description: "Matches the same product, plan or college across sources and builds a side-by-side table with the best value per field.",
    category: "data",
    icon: "Scale",
    uses_model: false,
    default_model: null,
    inputs: "Items from several sources with data fields",
    outputs: "One comparison item per matched thing (table + best values)",
    config_schema: [
      { key: "match_field", label: "Match items on", type: "text", required: true, default: "name", help: "Names are matched loosely: “iPhone 16 128GB Black” = “Apple iPhone 16 (128 GB)”." },
      { key: "compare_fields", label: "Fields to compare", type: "string_list", required: true, default: ["price", "rating"] },
      { key: "lower_is_better", label: "Lower is better for", type: "string_list", default: ["price", "delivery_days"] },
      { key: "match_threshold", label: "How close names must be (0.5–1)", type: "number", default: 0.85, min: 0.5, max: 1 },
    ],
  },
  {
    kind: "serpapi_search",
    name: "SerpApi Live Search",
    description: "Real-time structured results from Google Web, News, Jobs, Shopping, Maps or Scholar through SerpApi.",
    category: "collect",
    icon: "ScanSearch",
    uses_model: false,
    default_model: null,
    inputs: "Queries (settings) or items whose titles are queries",
    outputs: "One item per result with URL, snippet, publisher and date",
    config_schema: [
      { key: "engine", label: "SerpApi engine", type: "select", default: "google", options: [
        { value: "google", label: "Google Web" }, { value: "google_news", label: "Google News" },
        { value: "google_jobs", label: "Google Jobs" }, { value: "google_shopping", label: "Google Shopping" },
        { value: "google_maps", label: "Google Maps" }, { value: "google_scholar", label: "Google Scholar" },
      ] },
      { key: "query", label: "Search query", type: "textarea", default: "", placeholder: "AI agent startups in Bengaluru" },
      { key: "queries", label: "Extra queries", type: "string_list", default: [] },
      { key: "location", label: "Location", type: "text", default: "" },
      { key: "gl", label: "Country code", type: "text", default: "in" },
      { key: "hl", label: "Language code", type: "text", default: "en" },
      { key: "count", label: "Results per query", type: "number", default: 10, min: 1, max: 30 },
      { key: "max_queries", label: "Max queries", type: "number", default: 5, min: 1, max: 10 },
      { key: "extract_top", label: "Deepen top N with Extract API", type: "number", default: 0, min: 0, max: 10 },
      { key: "dedupe", label: "Remove duplicate URLs", type: "boolean", default: true },
    ],
  },
  {
    kind: "you_research",
    name: "You.com Cited Researcher",
    description: "Live answers with numbered citations from You.com, or a cited brief built from You.com web results.",
    category: "collect",
    icon: "BookOpenCheck",
    uses_model: false,
    default_model: null,
    inputs: "A question (setting) or items whose titles are questions",
    outputs: "One cited answer per question",
    config_schema: [
      { key: "question", label: "Question", type: "textarea", default: "", placeholder: "What changed in AI agent pricing?" },
      { key: "mode", label: "Mode", type: "select", default: "answer", options: [
        { value: "answer", label: "Cited answer" }, { value: "search", label: "Cited brief from search" },
      ] },
      { key: "max_questions", label: "Max questions from items", type: "number", default: 5, min: 1, max: 10 },
      { key: "count", label: "Sources in search mode", type: "number", default: 5, min: 1, max: 20 },
      { key: "freshness", label: "Freshness", type: "select", default: "", options: [
        { value: "", label: "Any time" }, { value: "day", label: "24 hours" }, { value: "week", label: "Week" },
        { value: "month", label: "Month" }, { value: "year", label: "Year" },
      ] },
      { key: "country", label: "Country", type: "text", default: "IN" },
      { key: "language", label: "Language", type: "text", default: "EN" },
    ],
  },
];

export function agentType(kind: AgentKind): AgentType | undefined {
  return AGENT_TYPES.find((t) => t.kind === kind);
}

/** Config filled with every schema default (deep-copied). */
export function configDefaults(kind: AgentKind): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of agentType(kind)?.config_schema ?? []) {
    if (f.default !== undefined) out[f.key] = JSON.parse(JSON.stringify(f.default));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Connection kinds                                                    */
/* ------------------------------------------------------------------ */

export const CONNECTION_KINDS: ConnectionKindInfo[] = [
  {
    kind: "nextjs",
    name: "Your website (Next.js)",
    description: "Sends each published post to your website, which saves it and refreshes the page.",
    icon: "Triangle",
    auto_publish: true,
    fields: [
      { key: "site_url", label: "Site URL", type: "text", required: true, placeholder: "https://example.com" },
      { key: "webhook_url", label: "Webhook URL", type: "text", required: true, placeholder: "https://example.com/api/layerflow" },
      { key: "webhook_secret", label: "Webhook secret", type: "text", required: true, secret: true, help: "Used to sign X-LayerFlow-Signature (HMAC SHA-256)." },
      { key: "path_template", label: "Post URL template", type: "text", default: "/news/{slug}" },
    ],
    setup_steps: ["Ask your developer to add the small LayerFlow route to your Next.js site (the guide below has the code).","Paste your website address and the route address below.","Copy the secret shown below into your site's settings so it can check that posts really come from LayerFlow.","Press Test: we send a sample post and check that your site answers."],
    docs: "docs/integrations/nextjs.md",
  },
  {
    kind: "wordpress",
    name: "WordPress site",
    description: "Creates posts on your WordPress site (as drafts or published).",
    icon: "Newspaper",
    auto_publish: true,
    fields: [
      { key: "site_url", label: "Site URL", type: "text", required: true, placeholder: "https://blog.example.com" },
      { key: "username", label: "Username", type: "text", required: true },
      { key: "application_password", label: "Application password", type: "text", required: true, secret: true, help: "Users → Profile → Application passwords." },
      {
        key: "default_status",
        label: "Post status",
        type: "select",
        default: "draft",
        options: [
          { value: "draft", label: "Draft" },
          { value: "publish", label: "Publish" },
        ],
      },
      { key: "category", label: "Category", type: "text", default: "" },
    ],
    setup_steps: ["In WordPress, open Users → Profile and scroll to Application passwords.","Type “LayerFlow” as the name and press Add new application password.","Copy the password it shows (you only see it once).","Paste your site address, your WordPress username and that password below."],
    docs: "docs/integrations/wordpress.md",
  },
  {
    kind: "webhook",
    name: "Webhook (Zapier, Make, n8n)",
    description: "Sends each post as data to any app that accepts webhooks: Zapier, Make, n8n or your own system.",
    icon: "Webhook",
    auto_publish: true,
    fields: [
      { key: "url", label: "URL", type: "text", required: true, placeholder: "https://hooks.example.com/layerflow" },
      { key: "secret", label: "Signing secret", type: "text", secret: true },
    ],
    setup_steps: ["In Zapier, Make or n8n, create a new flow that starts with a “Webhook” trigger.","Copy the webhook address it gives you.","Paste it below (add a signing secret if your app checks one).","Press Test so your flow receives a sample post and learns the fields."],
    docs: "docs/integrations/webhook.md",
  },
  {
    kind: "linkedin",
    name: "LinkedIn",
    description: "Posts the LinkedIn version of each story on your profile or company page.",
    icon: "Linkedin",
    auto_publish: true,
    fields: [
      { key: "author_urn", label: "Author URN", type: "text", required: true, placeholder: "urn:li:person:… or urn:li:organization:…" },
      { key: "access_token", label: "Access token", type: "text", required: true, secret: true },
    ],
    setup_steps: ["Open the LinkedIn developer portal and create an app for your company page.","Turn on “Share on LinkedIn” and create an access token for your account.","Copy your profile or company ID (it starts with urn:li:).","Paste the ID and the token below, then press Test."],
    docs: "docs/integrations/linkedin.md",
  },
  {
    kind: "telegram",
    name: "Telegram channel",
    description: "Posts a short summary with a link to your Telegram channel through your own bot.",
    icon: "Send",
    auto_publish: true,
    fields: [
      { key: "bot_token", label: "Bot token", type: "text", required: true, secret: true, help: "From @BotFather. Add the bot as a channel admin." },
      { key: "chat_id", label: "Channel / chat id", type: "text", required: true, placeholder: "@mychannel or -100…" },
    ],
    setup_steps: ["Open @BotFather in Telegram and send /newbot.","Copy the bot token it gives you.","Add the bot to your channel as an admin.","Paste the token and the channel name below."],
    docs: "docs/integrations/telegram.md",
  },
  {
    kind: "x",
    name: "X (Twitter)",
    description: "Prepares ready-to-post threads you can publish with one click. Automatic posting needs a paid X plan, so nothing is posted by itself.",
    icon: "Twitter",
    auto_publish: false,
    fields: [
      { key: "handle", label: "Handle", type: "text", required: true, placeholder: "@handle" },
      { key: "api_key", label: "API key (optional)", type: "text", secret: true },
      { key: "api_secret", label: "API secret (optional)", type: "text", secret: true },
    ],
    setup_steps: ["Type your X handle below (for example @yourbrand).","Each new thread appears in Content with a Copy button.","Optional: if you have paid X API access, paste the API key and secret to post automatically."],
    docs: "docs/integrations/x.md",
  },
  {
    kind: "ghost",
    name: "Ghost blog",
    description: "Creates posts on your Ghost blog (as drafts or published).",
    icon: "Ghost",
    auto_publish: true,
    fields: [
      { key: "api_url", label: "Admin API URL", type: "text", required: true, placeholder: "https://example.ghost.io" },
      { key: "admin_key", label: "Admin API key", type: "text", required: true, secret: true },
      {
        key: "default_status",
        label: "Post status",
        type: "select",
        default: "draft",
        options: [
          { value: "draft", label: "Draft" },
          { value: "published", label: "Published" },
        ],
      },
    ],
    setup_steps: ["In Ghost, open Settings → Integrations and press Add custom integration.","Name it “LayerFlow” and save.","Copy the Admin API key and the API URL it shows.","Paste both below and press Test."],
    docs: "docs/integrations/ghost.md",
  },
];

export function connectionKind(kind: ConnectionKind): ConnectionKindInfo | undefined {
  return CONNECTION_KINDS.find((k) => k.kind === kind);
}

/* ------------------------------------------------------------------ */
/* Blueprints                                                          */
/* ------------------------------------------------------------------ */

export const BLUEPRINTS: Blueprint[] = [
  {
    key: "news_media_autopilot",
    name: "News media autopilot",
    tagline: "Scrape the news, rewrite it in your voice, publish everywhere.",
    description:
      "A six-agent newsroom: a monitor collects fresh stories, a persona rewriter turns them into your house voice, the multi-format creator spins out social posts and a newsletter, SEO and quality agents check the copy, and the publisher ships it after an editor approves.",
    industry: "news_media",
    icon: "Newspaper",
    agents: [
      { name: "News Scraper", kind: "news_monitor", description: "Collects fresh stories for your beat from RSS feeds and Google News." },
      { name: "Persona Rewriter", kind: "persona_rewriter", description: "Rewrites each story in your editor's voice." },
      { name: "Multi-format Creator", kind: "multi_format", description: "Article, LinkedIn post, X thread, Instagram caption and newsletter." },
      { name: "SEO Optimizer", kind: "seo_optimizer", description: "Title tags, meta descriptions and NewsArticle JSON-LD." },
      { name: "Quality Gate", kind: "quality_gate", description: "Drops duplicates and anything with numbers that don't match the source." },
      { name: "Auto Publisher", kind: "auto_publisher", description: "Publishes approved stories to your site and social channels." },
    ],
    pipelines: [
      { name: "Hourly news brief", steps: ["News Scraper", "Persona Rewriter", "Multi-format Creator", "SEO Optimizer", "Quality Gate", "Auto Publisher"], trigger: "Every hour" },
    ],
    datasets: [],
    modules: ["pipelines", "assistant"],
  },
  {
    key: "livedesk_research",
    name: "LiveDesk research workspace",
    tagline: "SerpApi structured signals plus You.com cited answers.",
    description:
      "A live research desk: SerpApi collects web and news signals, You.com writes a cited answer, and a comparison assistant answers follow-up questions with fresh sponsor sources.",
    industry: "other",
    icon: "ScanSearch",
    agents: [
      { name: "Web Signal Collector", kind: "serpapi_search", description: "Structured web results from SerpApi." },
      { name: "News Signal Monitor", kind: "serpapi_search", description: "Fresh news via SerpApi's Google News engine." },
      { name: "Cited Answer Desk", kind: "you_research", description: "Cited answer from the You.com Answer API." },
      { name: "Live Research Assistant", kind: "comparison_assistant", description: "Follow-up Q&A with live sponsor citations." },
    ],
    pipelines: [{ name: "Daily live research", steps: ["Web Signal Collector", "News Signal Monitor", "Cited Answer Desk"], trigger: "Manual" }],
    datasets: ["Research Queue"],
    modules: ["pipelines", "datasets", "assistant"],
  },
  {
    key: "college_portal",
    name: "College portal",
    tagline: "College data, an AI comparison assistant and admission content.",
    description:
      "Keeps a dataset of colleges (fees, placements, rankings) fresh from official sites, answers student questions with side-by-side comparisons, and writes admission guides for your blog.",
    industry: "education",
    icon: "GraduationCap",
    agents: [
      { name: "College Data Scraper", kind: "dataset_builder", description: "Scrapes rankings, fees and placement figures into the Colleges dataset." },
      { name: "College Comparison Assistant", kind: "comparison_assistant", description: "Answers “X vs Y” questions with a comparison table." },
      { name: "Admissions News Monitor", kind: "news_monitor", description: "Watches JEE, NTA and JoSAA announcements." },
      { name: "Admission Blog Writer", kind: "persona_rewriter", description: "Turns admission news into counsellor-style guides." },
      { name: "SEO Optimizer", kind: "seo_optimizer", description: "BlogPosting JSON-LD and meta tags." },
      { name: "WordPress Publisher", kind: "auto_publisher", description: "Publishes approved guides to WordPress." },
    ],
    pipelines: [
      { name: "Weekly college data refresh", steps: ["College Data Scraper"], trigger: "Weekly" },
      { name: "Admission blog posts", steps: ["Admissions News Monitor", "Admission Blog Writer", "SEO Optimizer", "WordPress Publisher"], trigger: "Manual" },
    ],
    datasets: ["Colleges"],
    modules: ["pipelines", "datasets", "assistant"],
  },
  {
    key: "hackathon_listings",
    name: "Hackathon / event listings",
    tagline: "Scrape hackathons, sort them by deadline and keep your listings fresh.",
    description:
      "Scrapes hackathon platforms with AI extraction, drops closed and duplicate events, sorts by registration deadline, categorizes by theme, rewrites the blurbs and saves everything into a dataset your site and assistant read from.",
    industry: "events",
    icon: "Trophy",
    agents: [
      { name: "Hackathon Scraper", kind: "web_scraper", description: "Extracts name, dates, prizes and eligibility from listing pages." },
      { name: "Hackathon Sorter", kind: "data_transform", description: "Removes closed and duplicate events, sorts by deadline, tags a theme." },
      { name: "Listing Rewriter", kind: "persona_rewriter", description: "Writes a short, consistent blurb for each event." },
      { name: "Save to Hackathons", kind: "dataset_builder", description: "Upserts the events into the Hackathons dataset." },
      { name: "Hackathon Finder", kind: "comparison_assistant", description: "Answers “which AI hackathons close this week?”." },
    ],
    pipelines: [{ name: "Daily hackathon sweep", steps: ["Hackathon Scraper", "Hackathon Sorter", "Listing Rewriter", "Save to Hackathons"], trigger: "Every 12 hours" }],
    datasets: ["Hackathons"],
    modules: ["pipelines", "datasets", "assistant"],
  },
  {
    key: "executive_newsroom",
    name: "Executive newsroom",
    tagline: "Leadership news turned into executive briefs for editors to finish.",
    description:
      "Monitors business and leadership news and drafts executive briefs in a senior editor's voice, ready for the newsroom's research, review and publishing flow.",
    industry: "executive_media",
    icon: "Briefcase",
    agents: [
      { name: "News Monitor", kind: "news_monitor", description: "Tracks CEO moves, boardroom news and strategy stories." },
      { name: "Executive Writer", kind: "persona_rewriter", description: "Drafts briefs in the publication's executive voice." },
      { name: "Quality Gate", kind: "quality_gate", description: "Checks grounding and house style before an editor sees the draft." },
    ],
    pipelines: [{ name: "Executive brief draft", steps: ["News Monitor", "Executive Writer", "Quality Gate"], trigger: "Manual" }],
    datasets: [],
    modules: ["newsroom", "pipelines"],
  },
  {
    key: "blog_seo_autopilot",
    name: "Blog SEO autopilot",
    tagline: "One well-researched, SEO-ready blog post a day.",
    description:
      "Finds trending topics in your niche, writes a long-form post with your prompt, optimizes it for search, checks quality and publishes to WordPress, Ghost or your Next.js blog after approval.",
    industry: "blog",
    icon: "PenLine",
    agents: [
      { name: "Topic Scout", kind: "news_monitor", description: "Finds trending questions in your niche." },
      { name: "Blog Writer", kind: "custom_llm", description: "Writes a 1,000-word post from your outline prompt." },
      { name: "SEO Optimizer", kind: "seo_optimizer", description: "BlogPosting JSON-LD, meta tags and internal links." },
      { name: "Quality Gate", kind: "quality_gate", description: "Length, banned phrases and duplicate checks." },
      { name: "Blog Publisher", kind: "auto_publisher", description: "Publishes to your blog after approval." },
    ],
    pipelines: [{ name: "Daily blog post", steps: ["Topic Scout", "Blog Writer", "SEO Optimizer", "Quality Gate", "Blog Publisher"], trigger: "Every day" }],
    datasets: [],
    modules: ["pipelines"],
  },
  {
    key: "ecommerce_price_watch",
    name: "E-commerce price watch",
    tagline: "Track competitor prices and post deal alerts automatically.",
    description:
      "Scrapes competitor product pages into a price dataset, keeps only real price drops, writes deal posts for social channels and powers a shopping assistant that compares products.",
    industry: "ecommerce",
    icon: "ShoppingCart",
    agents: [
      { name: "Competitor Price Scraper", kind: "dataset_builder", description: "Scrapes product prices into the Competitor prices dataset." },
      { name: "Price Drop Filter", kind: "data_transform", description: "Keeps products whose discount is at least 15%." },
      { name: "Deal Post Writer", kind: "multi_format", description: "Writes Instagram, X and WhatsApp deal posts." },
      { name: "Shopping Assistant", kind: "comparison_assistant", description: "Compares products on price, discount and rating." },
      { name: "Deals Publisher", kind: "auto_publisher", description: "Posts deal alerts to your channels." },
    ],
    pipelines: [{ name: "Price sweep", steps: ["Competitor Price Scraper", "Price Drop Filter", "Deal Post Writer", "Deals Publisher"], trigger: "Every 6 hours" }],
    datasets: ["Competitor prices"],
    modules: ["pipelines", "datasets", "assistant"],
  },
];

/** Extra data used when a blueprint is applied (not part of the public Blueprint shape). */
export interface BlueprintSpec {
  /** Partial config per agent name, merged over the type defaults. "$dataset" is replaced by the first created dataset id. */
  configs: Record<string, Record<string, unknown>>;
  /** Dataset name -> dataset template key (see DATASET_TEMPLATES in platform-fixtures). */
  datasets: Record<string, string>;
  /** Pipeline names that pause for approval before publishing. */
  approval: string[];
}

export const BLUEPRINT_SPECS: Record<string, BlueprintSpec> = {
  news_media_autopilot: {
    configs: {
      "News Scraper": { keywords: ["breaking", "markets"], lookback_hours: 6 },
      "Multi-format Creator": { formats: ["article", "linkedin_post", "x_thread", "instagram_caption", "newsletter"] },
      "SEO Optimizer": { schema_type: "NewsArticle" },
      "Auto Publisher": { formats: ["article", "linkedin_post", "x_thread"] },
    },
    datasets: {},
    approval: ["Hourly news brief"],
  },
  livedesk_research: {
    configs: {
      "Web Signal Collector": {
        engine: "google", query: "AI agent startups India", gl: "in", hl: "en", count: 8,
        queries: ["AI agent platform funding", "agentic AI product launches India"], dedupe: true,
      },
      "News Signal Monitor": { engine: "google_news", query: "AI agents India", gl: "in", hl: "en", count: 8, dedupe: true },
      "Cited Answer Desk": {
        question: "What changed in India's AI agent startup ecosystem this month?", mode: "answer", country: "IN", language: "EN",
      },
      "Live Research Assistant": {
        dataset: "$dataset", live_sources: true, max_sources: 5,
        instructions: "Be concise and neutral. Use live web sources for fresh context and cite them with [n].",
      },
    },
    datasets: { "Research Queue": "research_queue" },
    approval: [],
  },
  college_portal: {
    configs: {
      "College Data Scraper": {
        source_mode: "scrape",
        dataset: "$dataset",
        sources: [
          { url: "https://www.nirfindia.org/Rankings/2026/EngineeringRanking.html", type: "html" },
          { url: "https://josaa.nic.in/", type: "html" },
        ],
        extract_fields: [
          { key: "nirf_rank", label: "NIRF rank", type: "number" },
          { key: "fees_total", label: "Total fees", type: "currency" },
          { key: "avg_package", label: "Average package", type: "number" },
          { key: "placement_rate", label: "Placement rate", type: "number" },
        ],
      },
      "College Comparison Assistant": { dataset: "$dataset", suggested_questions: ["Compare the top 3 colleges on placements", "Which colleges cost under ₹10 lakh?"] },
      "Admissions News Monitor": { keywords: ["JEE Main", "JEE Advanced", "JoSAA", "NTA"] },
      "Admission Blog Writer": { persona: "You are a senior admissions counsellor writing for Class 12 students and their parents. Be precise about dates and cutoffs, explain jargon, end with a checklist.", tone: "friendly" },
      "SEO Optimizer": { schema_type: "BlogPosting" },
      "WordPress Publisher": { formats: ["blog_post"], publish_mode: "draft" },
    },
    datasets: { Colleges: "colleges" },
    approval: ["Admission blog posts"],
  },
  hackathon_listings: {
    configs: {
      "Hackathon Scraper": {
        sources: [
          { url: "https://devfolio.co/hackathons", type: "html" },
          { url: "https://unstop.com/hackathons", type: "html" },
        ],
        extraction: "auto",
        extract_fields: HACKATHON_EXTRACT_FIELDS(),
        follow_links: true,
      },
      "Hackathon Sorter": {
        dedupe_by: ["url", "name"],
        filters: [{ field: "registration_deadline", op: "date_after_today" }],
        sort_by: "registration_deadline",
        sort_order: "asc",
        limit: 50,
        ai_categorize: true,
        categories: ["AI/ML", "Web3", "FinTech", "HealthTech", "Open Innovation", "Climate"],
        category_field: "theme_category",
      },
      "Listing Rewriter": { persona: "You write crisp two-sentence hackathon blurbs for students: what it is, who can join, what you can win. No hype words.", tone: "punchy", length: "short" },
      "Save to Hackathons": { source_mode: "pipeline_items", dataset: "$dataset", key_field: "name" },
      "Hackathon Finder": { dataset: "$dataset", suggested_questions: ["Which online AI hackathons close this month?", "Biggest prize pools this week"] },
    },
    datasets: { Hackathons: "hackathons" },
    approval: [],
  },
  executive_newsroom: {
    configs: {
      "News Monitor": { keywords: ["CEO", "board", "chief executive", "strategy"], lookback_hours: 24 },
      "Executive Writer": { persona: "You write for C-suite readers in the measured voice of a senior business editor. Lead with the decision, then the context and what peers should take from it.", tone: "authoritative" },
    },
    datasets: {},
    approval: [],
  },
  blog_seo_autopilot: {
    configs: {
      "Topic Scout": { keywords: ["how to", "guide"], lookback_hours: 72 },
      "Blog Writer": { prompt: "Write a 1,000-word blog post answering the topic's main question. Use H2 sections, a quick-answer box at the top and an FAQ at the end." },
      "SEO Optimizer": { schema_type: "BlogPosting" },
      "Blog Publisher": { formats: ["blog_post"], publish_mode: "draft" },
    },
    datasets: {},
    approval: ["Daily blog post"],
  },
  ecommerce_price_watch: {
    configs: {
      "Competitor Price Scraper": { source_mode: "scrape", dataset: "$dataset", key_field: "product" },
      "Price Drop Filter": { filters: [{ field: "discount", op: "gte", value: 15 }], sort_by: "discount", sort_order: "desc", limit: 10 },
      "Deal Post Writer": { formats: ["instagram_caption", "x_thread", "whatsapp_message"] },
      "Shopping Assistant": { dataset: "$dataset" },
      "Deals Publisher": { formats: ["instagram_caption", "x_thread"] },
    },
    datasets: { "Competitor prices": "prices" },
    approval: [],
  },
};

function HACKATHON_EXTRACT_FIELDS() {
  return [
    { key: "name", label: "Name", type: "text" },
    { key: "organizer", label: "Organizer", type: "text" },
    { key: "start_date", label: "Start date", type: "date" },
    { key: "end_date", label: "End date", type: "date" },
    { key: "registration_deadline", label: "Registration deadline", type: "date" },
    { key: "mode", label: "Mode", type: "text", description: "Online, Offline or Hybrid" },
    { key: "location", label: "Location", type: "text" },
    { key: "prize_pool", label: "Prize pool", type: "currency" },
    { key: "themes", label: "Themes", type: "list" },
    { key: "eligibility", label: "Eligibility", type: "text" },
    { key: "url", label: "URL", type: "url" },
  ];
}

export const hackathonExtractFields = HACKATHON_EXTRACT_FIELDS;

/** "Every hour" / "Every 12 hours" / "Weekly" / "Manual" / "Webhook" -> trigger. */
export function parseBlueprintTrigger(t: string): { type: "manual" | "schedule" | "webhook"; every_minutes: number | null } {
  const s = t.toLowerCase();
  if (s.includes("webhook")) return { type: "webhook", every_minutes: null };
  if (s.includes("manual")) return { type: "manual", every_minutes: null };
  if (s.includes("week")) return { type: "schedule", every_minutes: 10080 };
  if (s.includes("day") || s.includes("daily")) return { type: "schedule", every_minutes: 1440 };
  const m = s.match(/(\d+)\s*hour/);
  if (m) return { type: "schedule", every_minutes: Number(m[1]) * 60 };
  if (s.includes("hour")) return { type: "schedule", every_minutes: 60 };
  const mm = s.match(/(\d+)\s*min/);
  if (mm) return { type: "schedule", every_minutes: Number(mm[1]) };
  return { type: "manual", every_minutes: null };
}

export const MODULES: Module[] = ["newsroom", "pipelines", "datasets", "assistant"];
