"""Agent catalog: the ten agent kinds, their config schemas (rendered as forms by the dashboard) and the
validator that checks a config against its schema and fills defaults. The schema is the single source of
truth: the API validates with it, the dashboard renders it, the runtime reads the validated result."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

CONTENT_FORMATS: dict[str, str] = {
    "article": "Article",
    "blog_post": "Blog post",
    "linkedin_post": "LinkedIn post",
    "x_thread": "X thread",
    "instagram_caption": "Instagram caption",
    "facebook_post": "Facebook post",
    "newsletter": "Newsletter",
    "short_video_script": "Short video script",
    "whatsapp_message": "WhatsApp message",
}
DATASET_FIELD_TYPES = ("text", "number", "currency", "url", "list", "rating", "boolean", "date")
SOURCE_TYPES = ("rss", "html", "sitemap", "json")
FILTER_OPS = ("eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte", "exists", "date_after_today", "date_within_days")
TONES = ("professional", "conversational", "authoritative", "friendly", "witty", "neutral")


class ConfigError(ValueError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


def _opts(values: dict[str, str] | tuple[str, ...]) -> list[dict[str, str]]:
    if isinstance(values, dict):
        return [{"value": k, "label": v} for k, v in values.items()]
    return [{"value": v, "label": v.replace("_", " ").capitalize()} for v in values]


def F(key: str, label: str, type: str, **kw: Any) -> dict[str, Any]:
    """One ConfigField (see platform-types.ts)."""
    return {"key": key, "label": label, "type": type, **kw}


@dataclass(frozen=True)
class AgentKindInfo:
    kind: str
    name: str
    description: str
    category: str
    icon: str
    uses_model: bool
    default_model: str | None
    inputs: str
    outputs: str
    config_schema: list[dict[str, Any]] = field(default_factory=list)

    def out(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "icon": self.icon,
            "uses_model": self.uses_model,
            "default_model": self.default_model,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "config_schema": self.config_schema,
        }


TONE_FIELD = F("tone", "Tone", "select", options=_opts(TONES), default="professional")

AGENT_KINDS: dict[str, AgentKindInfo] = {
    k.kind: k
    for k in (
        AgentKindInfo(
            kind="web_scraper",
            name="Web Scraper",
            description="Collects data from websites, feeds, sitemaps and JSON endpoints. Describe the fields you want in plain words "
            "(AI mode), or read tables, published structured data (JSON-LD, Open Graph, microdata), CSS selectors, or crawl a whole "
            "site. Follows 'next page' links and listing → detail pages. Honours robots.txt and rate limits.",
            category="collect",
            icon="Globe",
            uses_model=True,
            default_model="fast",
            inputs="Nothing (starts a pipeline) or items with URLs",
            outputs="One item per row / entry / page, with extracted fields",
            config_schema=[
                F("sources", "Websites / feeds", "sources", required=True, default=[],
                  help="Start pages, RSS/Atom feeds, sitemaps or JSON endpoints."),
                F("mode", "How to read pages", "select", default="auto",
                  options=[{"value": "auto", "label": "Smart (structured data first, then AI from field names)"},
                           {"value": "tables", "label": "Tables (every HTML table → rows)"},
                           {"value": "structured", "label": "Structured data only (JSON-LD, Open Graph, microdata)"},
                           {"value": "crawl", "label": "Crawl the site (pages, headings, links)"},
                           {"value": "css", "label": "CSS selectors (advanced)"}],
                  help="Smart works for most sites: just list the fields you want below."),
                F("extract_fields", "Fields to collect", "extract_fields", default=[],
                  help="Plain names like name, price, rating, start_date. Add a CSS selector only in CSS mode."),
                F("follow_pagination", "Follow 'next page' links", "boolean", default=True),
                F("max_pages", "Max pages per source", "number", default=5, min=1, max=100,
                  help="Listing pages (pagination) or pages to crawl."),
                F("detail_follow", "Open each listed item's page", "boolean", default=False,
                  help="For listings: visit the detail page of each entry and read the fields there."),
                F("detail_link_pattern", "Detail link pattern", "text", default="", placeholder="/product/*",
                  help="Which links are detail pages (glob like /event/*, or a regex). Empty = links inside the listed entries."),
                F("crawl_depth", "Crawl depth", "number", default=1, min=0, max=3, help="Crawl mode: how many clicks away from the start page."),
                F("same_site", "Stay on the same website", "boolean", default=True),
                F("item_selector", "Item selector (CSS mode)", "text", default="", placeholder="article.card",
                  help="CSS mode: selector matching each entry on a listing page."),
                F("link_selector", "Link selector (CSS mode)", "text", default="a[href]", placeholder="h2 a"),
                F("follow_links", "Read full articles (feeds)", "boolean", default=True,
                  help="For feeds and article lists: open each link to read the full text."),
                F("max_items", "Max items per run", "number", default=50, min=1, max=1000),
                F("max_age_hours", "Only items newer than (hours)", "number", default=0, min=0, max=2160,
                  help="0 keeps items of any age. Undated items are kept."),
            ],
        ),
        AgentKindInfo(
            kind="news_monitor",
            name="News Monitor",
            description="Watches Google News and your own feeds for keywords and topics, removes duplicates by canonical "
            "URL and keeps only recent stories.",
            category="collect",
            icon="Radar",
            uses_model=False,
            default_model=None,
            inputs="Nothing (starts a pipeline)",
            outputs="Recent, de-duplicated news items",
            config_schema=[
                F("keywords", "Keywords / topics", "string_list", default=[],
                  placeholder="RBI repo rate", help="Each line becomes one news search. Quotes force exact phrases."),
                F("exclude_keywords", "Exclude stories mentioning", "string_list", default=[]),
                F("feeds", "Extra RSS feeds", "string_list", default=[], placeholder="https://example.com/rss.xml"),
                F("use_google_news", "Search Google News", "boolean", default=True),
                F("region", "Region", "select", default="IN",
                  options=[{"value": v, "label": lbl} for v, lbl in (("IN", "India"), ("US", "United States"), ("GB", "United Kingdom"),
                                                                 ("AE", "UAE"), ("SG", "Singapore"), ("AU", "Australia"))]),
                F("language", "Language code", "text", default="en"),
                F("max_age_hours", "Max age (hours)", "number", default=24, min=1, max=720),
                F("max_items", "Max items per run", "number", default=15, min=1, max=100),
                F("fetch_full_text", "Read full articles", "boolean", default=True,
                  help="Open each story to extract its text (needed by writers; respects robots.txt)."),
            ],
        ),
        AgentKindInfo(
            kind="persona_rewriter",
            name="Persona Rewriter",
            description="Rewrites each item in your brand voice or a persona, grounded only in the source text. "
            "It is told never to invent numbers, and numbers missing from the source are flagged.",
            category="create",
            icon="PenLine",
            uses_model=True,
            default_model="writer",
            inputs="Items with text",
            outputs="Items rewritten as an article, blog post or newsletter (draft content)",
            config_schema=[
                F("persona", "Persona / voice", "textarea", required=True,
                  default="An experienced business editor who writes clearly for busy decision-makers.",
                  help="Who is writing, for whom, and how they sound."),
                TONE_FIELD,
                F("output_format", "Write as", "select", default="article",
                  options=_opts({k: CONTENT_FORMATS[k] for k in ("article", "blog_post", "newsletter")})),
                F("target_words", "Target length (words)", "number", default=400, min=60, max=2000),
                F("language", "Language", "text", default="English"),
                F("audience", "Audience", "text", default="", placeholder="Retail investors in India"),
                F("instructions", "Extra instructions", "textarea", default="",
                  placeholder="Always end with a 'What to watch' line."),
                F("include_source_link", "Credit the source", "boolean", default=True),
            ],
        ),
        AgentKindInfo(
            kind="multi_format",
            name="Format Studio",
            description="Turns one item into many formats at once (LinkedIn post, X thread, Instagram caption, newsletter, "
            "short video script, WhatsApp message…), each respecting the platform's limits.",
            category="create",
            icon="LayoutGrid",
            uses_model=True,
            default_model="writer",
            inputs="Items with text (or rewritten articles)",
            outputs="Content items with one variant per format",
            config_schema=[
                F("formats", "Formats", "formats", required=True, default=["linkedin_post", "x_thread", "instagram_caption"],
                  options=_opts(CONTENT_FORMATS)),
                F("persona", "Voice", "textarea", default="", help="Optional. Leave empty to keep the source voice."),
                TONE_FIELD,
                F("hashtags", "Hashtags (Instagram / LinkedIn)", "number", default=5, min=0, max=15),
                F("cta", "Call to action", "text", default="", placeholder="Read the full story on our site"),
                F("include_link", "Include the source link", "boolean", default=True),
                F("language", "Language", "text", default="English"),
            ],
        ),
        AgentKindInfo(
            kind="seo_optimizer",
            name="SEO Optimizer",
            description="Adds a title tag (≤60 chars), meta description (140–158), clean slug, keywords and Article "
            "JSON-LD to each content item. Rules are enforced in code, not left to the model.",
            category="quality",
            icon="Search",
            uses_model=False,
            default_model=None,
            inputs="Content items",
            outputs="Content items with SEO metadata",
            config_schema=[
                F("site_url", "Site URL", "text", default="", placeholder="https://example.com",
                  help="Used for canonical URLs and JSON-LD. Defaults to the workspace domain."),
                F("path_prefix", "Article path", "text", default="/blog", placeholder="/news"),
                F("brand_name", "Publisher name", "text", default="", help="Defaults to the workspace name."),
                F("primary_keywords", "Preferred keywords", "string_list", default=[],
                  help="Used first when they appear in the text."),
                F("schema_type", "Schema type", "select", default="Article",
                  options=_opts({"Article": "Article", "NewsArticle": "NewsArticle", "BlogPosting": "BlogPosting"})),
                F("max_keywords", "Keywords per item", "number", default=6, min=1, max=15),
            ],
        ),
        AgentKindInfo(
            kind="quality_gate",
            name="Quality Gate",
            description="Checks every item before it ships: numbers must appear in the source, banned phrases, length and "
            "duplicates of recent content; optionally a model rubric. Failing items are flagged or dropped.",
            category="quality",
            icon="ShieldCheck",
            uses_model=True,
            default_model="fast",
            inputs="Content items",
            outputs="Items that passed (failures flagged or dropped)",
            config_schema=[
                F("min_words", "Minimum words (main body)", "number", default=60, min=0, max=5000),
                F("max_words", "Maximum words (main body)", "number", default=3000, min=50, max=20000),
                F("check_numbers", "Numbers must be in the source", "boolean", default=True),
                F("check_banned", "Block banned phrases", "boolean", default=True),
                F("extra_banned", "Extra banned phrases", "string_list", default=[]),
                F("check_duplicates", "Block duplicates of recent content", "boolean", default=True),
                F("use_model_rubric", "Model rubric review", "boolean", default=False,
                  help="Adds a 1–5 model score for accuracy, clarity and voice. Slower."),
                F("min_rubric_score", "Minimum rubric score", "number", default=3, min=1, max=5),
                F("on_fail", "When an item fails", "select", default="flag",
                  options=[{"value": "flag", "label": "Flag it and continue"}, {"value": "drop", "label": "Drop it (rejected)"}]),
            ],
        ),
        AgentKindInfo(
            kind="auto_publisher",
            name="Auto Publisher",
            description="Publishes approved content to your connections: Next.js sites, WordPress, Ghost, webhooks, "
            "Telegram, LinkedIn. Channels without API access get a ready-to-paste post. Pauses for approval when the pipeline requires it.",
            category="deliver",
            icon="Send",
            uses_model=False,
            default_model=None,
            inputs="Approved content items",
            outputs="Published content (with live URLs)",
            config_schema=[
                F("connections", "Publish to", "connections", default=[],
                  help="Pick one or more connections. Set them up under Connections."),
            ],
        ),
        AgentKindInfo(
            kind="dataset_builder",
            name="Dataset Builder",
            description="Scrapes structured records into a dataset: open listing pages, follow links to detail pages, "
            "extract fields with AI or CSS selectors, and upsert by the dataset's key field with the source URL.",
            category="data",
            icon="Database",
            uses_model=True,
            default_model="fast",
            inputs="Nothing, or items with URLs",
            outputs="Dataset records (also passed on as items)",
            config_schema=[
                F("dataset", "Target dataset", "dataset", required=True),
                F("source_mode", "Records come from", "select", default="scrape",
                  options=[{"value": "scrape", "label": "Scraping the pages below"},
                           {"value": "pipeline_items", "label": "Items from earlier pipeline steps"}],
                  help="Pipeline items: save what earlier steps produced (item data + title/url/summary mapped by field key)."),
                F("sources", "Pages to read", "sources", default=[],
                  help="Listing pages (with a link selector) or detail pages. Items from earlier steps are read too."),
                F("link_selector", "Detail link selector", "text", default="", placeholder="a.college-link",
                  help="On listing pages: CSS selector for links to detail pages. Empty = each source is a detail page."),
                F("max_pages", "Max detail pages per run", "number", default=10, min=1, max=200),
                F("mode", "Extraction mode", "select", default="ai",
                  options=[{"value": "ai", "label": "AI extraction"}, {"value": "css", "label": "CSS selectors"}]),
                F("extract_fields", "Field mapping", "extract_fields", default=[],
                  help="Empty = extract every dataset field. Add CSS selectors for CSS mode or hints for AI mode."),
                F("update_existing", "Update existing records", "boolean", default=True,
                  help="Off = only add records whose key is new."),
            ],
        ),
        AgentKindInfo(
            kind="data_transform",
            name="Data Cleaner",
            description="Cleans and organises items without writing anything: removes duplicates, filters (e.g. "
            "deadline after today), sorts by numbers or dates, limits, renames or sets fields, and can ask the fast model "
            "to put each item into one of your categories.",
            category="data",
            icon="Filter",
            uses_model=True,
            default_model="fast",
            inputs="Any items",
            outputs="The cleaned, filtered and sorted items",
            config_schema=[
                F("dedupe_by", "Remove duplicates by", "string_list", default=["url"], placeholder="data.name",
                  help="Field paths: title, url, text, summary, published_at or data.<field>. Items matching on any one are duplicates."),
                F("filters", "Filters (JSON)", "textarea", default="[]",
                  placeholder='[{"field": "data.registration_deadline", "op": "date_after_today"}, '
                              '{"field": "data.mode", "op": "neq", "value": "offline"}]',
                  help="A JSON list of {field, op, value}. ops: " + ", ".join(FILTER_OPS) + ". All filters must pass."),
                F("sort_by", "Sort by", "text", default="", placeholder="data.registration_deadline",
                  help="Numbers sort numerically, dates chronologically; items without a value go last."),
                F("sort_order", "Order", "select", default="asc",
                  options=[{"value": "asc", "label": "Ascending (soonest / smallest first)"}, {"value": "desc", "label": "Descending"}]),
                F("limit", "Keep at most", "number", default=0, min=0, max=1000, help="0 keeps everything."),
                F("rename_fields", "Rename fields (JSON)", "textarea", default="{}", placeholder='{"data.prize": "data.prize_pool"}',
                  help="A JSON object {from: to}. Applied before the other operations."),
                F("set_fields", "Set fields (JSON)", "textarea", default="{}", placeholder='{"data.source": "devpost"}',
                  help="A JSON object {field: value} written into every item."),
                F("assign_rules", "Assignment rules (JSON)", "textarea", default="[]",
                  placeholder='[{"if": {"field": "data.course", "op": "contains", "value": "MBA"}, "set": {"data.assigned_to": "Asha"}}]',
                  help="A JSON list of {if: {field, op, value}, set: {field: value}}. The first matching rule applies."),
                F("ai_categorize", "AI categorise", "boolean", default=False,
                  help="The fast model puts every item into exactly one of the categories below."),
                F("categories", "Categories", "string_list", default=[], placeholder="AI"),
                F("category_field", "Category field", "text", default="category", help="Written to data.<this field>."),
            ],
        ),
        AgentKindInfo(
            kind="comparison_assistant",
            name="Comparison Assistant",
            description="Real-time Q&A over a dataset: finds the records a visitor mentions, builds a side-by-side "
            "comparison with winners highlighted and answers from those records. Optionally grounds fresh claims in "
            "live, cited SerpApi / You.com web sources.",
            category="assist",
            icon="MessagesSquare",
            uses_model=True,
            default_model="fast",
            inputs="A visitor question",
            outputs="Answer, comparison table and follow-up suggestions",
            config_schema=[
                F("dataset", "Dataset", "dataset", required=True),
                F("instructions", "Instructions", "textarea",
                  default="Be concise and neutral. Quote the figures from the records. If the records do not answer the question, say so.",
                  help="How the assistant should answer. It never uses facts outside the records."),
                F("max_records", "Max records per answer", "number", default=5, min=1, max=10),
                F("live_sources", "Ground in live web sources", "boolean", default=False,
                  help="Adds fresh You.com / SerpApi results and numbered citations to every answer."),
                F("max_sources", "Live sources per answer", "number", default=5, min=1, max=8),
                F("suggestions", "Suggest follow-up questions", "boolean", default=True),
                F("greeting", "Greeting", "text", default="Ask me to compare options side by side."),
            ],
        ),
        AgentKindInfo(
            kind="researcher",
            name="Research Analyst",
            description="Answers a question or researches a topic: searches the news (Google News, or DuckDuckGo where its "
            "robots.txt allows) plus your sources, reads the pages and builds an evidence pack where every fact cites its source.",
            category="collect",
            icon="BookOpenCheck",
            uses_model=True,
            default_model="writer",
            inputs="A question (setting) or items whose titles are questions",
            outputs="One cited research brief per question",
            config_schema=[
                F("question", "Question / topic", "textarea", default="", placeholder="What changed in India's EV subsidy policy this month?",
                  help="Empty = research the title of each incoming item."),
                F("search", "Search", "select", default="google_news",
                  options=[{"value": "google_news", "label": "Google News"}, {"value": "duckduckgo", "label": "DuckDuckGo (if robots.txt allows)"},
                           {"value": "none", "label": "Only my sources"}]),
                F("sources", "Extra sources", "sources", default=[]),
                F("max_sources", "Sources to read", "number", default=5, min=1, max=10),
                F("max_facts", "Key facts", "number", default=10, min=3, max=16),
                F("region", "Region", "select", default="IN",
                  options=[{"value": v, "label": v} for v in ("IN", "US", "GB", "AE", "SG", "AU")]),
                F("focus", "Angle / focus", "textarea", default="", placeholder="What it means for small exporters"),
            ],
        ),
        AgentKindInfo(
            kind="fact_checker",
            name="Fact Checker",
            description="Checks each claim in generated text against the item's source: numbers must appear in the source, "
            "and the model labels every claim verified, unsupported or contradicted.",
            category="quality",
            icon="BadgeCheck",
            uses_model=True,
            default_model="fast",
            inputs="Items with generated text and source text",
            outputs="Items with a claim-by-claim fact check",
            config_schema=[
                F("max_claims", "Claims per item", "number", default=8, min=1, max=20),
                F("use_model", "Model verdicts", "boolean", default=True, help="Off = deterministic checks only (numbers + overlap)."),
                F("on_fail", "When claims are unsupported", "select", default="flag",
                  options=[{"value": "flag", "label": "Flag and continue"}, {"value": "drop", "label": "Drop the item"}]),
            ],
        ),
        AgentKindInfo(
            kind="site_auditor",
            name="SEO Site Auditor",
            description="Crawls a website (sitemap first, then links) and checks every page: status, title, meta description, "
            "H1, canonical, Open Graph, JSON-LD, duplicates and thin content. Produces a prioritised report.",
            category="quality",
            icon="ScanSearch",
            uses_model=False,
            default_model=None,
            inputs="Nothing (uses the site URL) or items with URLs",
            outputs="One audit report item with findings",
            config_schema=[
                F("site_url", "Website", "text", default="", placeholder="https://client.com", help="Empty = audit the URLs of incoming items."),
                F("max_pages", "Pages to check", "number", default=25, min=1, max=200),
                F("use_sitemap", "Use the sitemap", "boolean", default=True),
                F("checks", "What to check", "select", default="all",
                  options=[{"value": "all", "label": "Full SEO audit"}, {"value": "links", "label": "Broken links only"}]),
                F("check_external_links", "Also check links to other sites", "boolean", default=False),
            ],
        ),
        AgentKindInfo(
            kind="image_finder",
            name="Image Finder",
            description="Finds images for each item: the page's own pictures (main, gallery, social image) and open-license "
            "pictures from Openverse and Wikimedia Commons with the licence and credit line. Near-duplicates are removed and "
            "alt text can be written for you.",
            category="collect",
            icon="Image",
            uses_model=True,
            default_model="fast",
            inputs="Items with URLs or titles, or pages / search terms set here",
            outputs="Items with data.images (best image as image_url)",
            config_schema=[
                F("sources", "Where to look", "multiselect", default=["page"],
                  options=[{"value": "page", "label": "The item's own page"}, {"value": "openverse", "label": "Openverse (open licences)"},
                           {"value": "wikimedia", "label": "Wikimedia Commons"}]),
                F("pages", "Pages to collect images from", "sources", default=[], help="Used when there are no incoming items."),
                F("queries", "Search terms", "string_list", default=[], placeholder="college campus india",
                  help="For Openverse / Wikimedia. Empty = each item's title."),
                F("prefer_open_license", "Prefer open licences", "boolean", default=True,
                  help="CC0, public domain, CC BY and CC BY-SA come first."),
                F("exclude_unknown_license", "Skip images with an unknown licence", "boolean", default=False),
                F("min_width", "Minimum width (px)", "number", default=400, min=0, max=4000),
                F("min_height", "Minimum height (px)", "number", default=0, min=0, max=4000),
                F("max_images_per_item", "Images per item", "number", default=5, min=1, max=30),
                F("alt_text", "Write alt text", "boolean", default=False,
                  help="Uses a vision model when one is installed, otherwise the caption and context."),
                F("replace_existing", "Replace images already found", "boolean", default=False),
            ],
        ),
        AgentKindInfo(
            kind="change_detector",
            name="Change Detector",
            description="Compares incoming items with a dataset by key and reports what is new or changed, field by field "
            "(fees, prices, dates). Can write the changes back.",
            category="data",
            icon="GitCompare",
            uses_model=False,
            default_model=None,
            inputs="Items with data (e.g. from a scraper)",
            outputs="New / changed items with field diffs",
            config_schema=[
                F("dataset", "Compare with dataset", "dataset", required=True),
                F("compare_fields", "Fields to compare", "string_list", default=[], help="Empty = every dataset field."),
                F("emit", "Pass on", "select", default="new_and_changed",
                  options=[{"value": "new_and_changed", "label": "New and changed"}, {"value": "new", "label": "Only new"},
                           {"value": "changed", "label": "Only changed"}, {"value": "all", "label": "Everything (with status)"}]),
                F("update_dataset", "Write changes to the dataset", "boolean", default=False),
            ],
        ),
        AgentKindInfo(
            kind="http_action",
            name="API Action",
            description="Calls an allowlisted REST API connection (CRM, Google Sheets via Apps Script, your backend) with a JSON "
            "body built from each item. Requests can only reach the connection's hosts.",
            category="deliver",
            icon="Plug",
            uses_model=False,
            default_model=None,
            inputs="Any items",
            outputs="The same items (optionally with the API response)",
            config_schema=[
                F("connections", "REST API connection", "connections", required=True, default=[]),
                F("method", "Method", "select", default="POST", options=_opts({"POST": "POST", "PUT": "PUT", "PATCH": "PATCH"})),
                F("path", "Path", "text", default="", placeholder="/leads"),
                F("body_template", "JSON body template", "textarea", default='{"title": "{{title}}", "url": "{{url}}", "data": "{{data}}"}',
                  help='Valid JSON. A value that is exactly "{{field}}" keeps its type; {{field}} inside text is substituted as text.'),
                F("per_item", "One request per item", "boolean", default=True, help="Off = one request with all items."),
                F("response_field", "Store response in data.", "text", default="", placeholder="crm_response"),
            ],
        ),
        AgentKindInfo(
            kind="notifier",
            name="Notifier",
            description="Sends a message per item or a single digest to Telegram, Slack, Discord, email or a webhook.",
            category="deliver",
            icon="Bell",
            uses_model=False,
            default_model=None,
            inputs="Any items",
            outputs="The same items",
            config_schema=[
                F("connections", "Send to", "connections", required=True, default=[]),
                F("mode", "Mode", "select", default="digest",
                  options=[{"value": "digest", "label": "One digest"}, {"value": "per_item", "label": "One message per item"}]),
                F("title", "Title / subject", "text", default="", placeholder="New leads today"),
                F("template", "Message template", "textarea", default="{{title}}\n{{url}}",
                  help="Placeholders: {{title}}, {{summary}}, {{url}}, {{data.<field>}}."),
                F("skip_when_empty", "Skip when there are no items", "boolean", default=True),
            ],
        ),
        AgentKindInfo(
            kind="report_builder",
            name="Report Builder",
            description="Turns the items of a run into a markdown report with an executive summary grounded in those items, "
            "saved as content.",
            category="create",
            icon="FileBarChart",
            uses_model=True,
            default_model="writer",
            inputs="Any items",
            outputs="One report item (saved as content)",
            config_schema=[
                F("title", "Title", "text", default="Report {{date}}"),
                F("use_model", "Executive summary", "boolean", default=True),
                F("include_links", "Link items", "boolean", default=True),
                F("instructions", "Instructions", "textarea", default="", placeholder="Focus on what changed since last week"),
            ],
        ),
        AgentKindInfo(
            kind="link_collector",
            name="URL Collector",
            description="Collects links from pages and sitemaps, follows them up to two clicks deep, keeps only the ones matching "
            "your patterns, strips tracking codes and removes duplicates.",
            category="collect",
            icon="Link",
            uses_model=False,
            default_model=None,
            inputs="Nothing, or items with URLs to start from",
            outputs="One item per URL",
            config_schema=[
                F("start_urls", "Start pages", "string_list", required=True, default=[], placeholder="https://example.com/events"),
                F("sitemaps", "Sitemaps", "string_list", default=[], placeholder="https://example.com/sitemap.xml"),
                F("include_patterns", "Keep links matching", "string_list", default=[], placeholder="/event/*",
                  help="Glob (/product/*, *.pdf) or regex. Empty = keep all."),
                F("exclude_patterns", "Skip links matching", "string_list", default=[], placeholder="*/tag/*"),
                F("same_site", "Stay on the same website", "boolean", default=True),
                F("depth", "Follow links (clicks deep)", "number", default=0, min=0, max=2),
                F("max_links", "Max links", "number", default=200, min=1, max=5000),
            ],
        ),
        AgentKindInfo(
            kind="document_reader",
            name="PDF & Document Reader",
            description="Opens PDFs from links, extracts the text page by page and pulls out the fields you ask for.",
            category="collect",
            icon="FileText",
            uses_model=True,
            default_model="fast",
            inputs="PDF links (here or from an earlier step)",
            outputs="One item per document with text and fields",
            config_schema=[
                F("sources", "Document links", "sources", default=[], help="PDF URLs. Links from earlier steps are read too."),
                F("read_item_links", "Read links from earlier steps", "boolean", default=True),
                F("extract_fields", "Fields to pull out", "extract_fields", default=[], help="e.g. total_fees, last_date, eligibility"),
                F("max_pages", "Pages per document", "number", default=20, min=1, max=500),
                F("max_documents", "Documents per run", "number", default=20, min=1, max=200),
            ],
        ),
        AgentKindInfo(
            kind="page_watcher",
            name="Page Change Watcher",
            description="Checks pages (or one part of a page) and reports only what changed since the last check, with before "
            "and after. The first check saves a baseline.",
            category="collect",
            icon="Eye",
            uses_model=False,
            default_model=None,
            inputs="Nothing, or items with URLs",
            outputs="Only changed pages (before, after, diff)",
            config_schema=[
                F("sources", "Pages to watch", "sources", required=True, default=[]),
                F("selector", "Only this part of the page (CSS)", "text", default="", placeholder="#notices",
                  help="Empty = the whole page text."),
                F("ignore_dates", "Ignore dates and times", "boolean", default=True, help="Timestamps and 'x minutes ago' never count as changes."),
                F("ignore_numbers", "Ignore all numbers", "boolean", default=False, help="Turn on for pages with counters; off to catch price changes."),
                F("min_changed_lines", "Minimum changed lines", "number", default=1, min=1, max=1000),
                F("emit_on_first_run", "Report the first check too", "boolean", default=False),
            ],
        ),
        AgentKindInfo(
            kind="keyword_researcher",
            name="Keyword Researcher",
            description="Expands your topics into the phrases people search for (free search suggestions), adds terms competitor "
            "pages use, and groups everything by intent: learn, compare, buy, find a site.",
            category="quality",
            icon="KeyRound",
            uses_model=False,
            default_model=None,
            inputs="Nothing, or items whose titles are topics",
            outputs="One item per keyword with intent, plus a report",
            config_schema=[
                F("seed_keywords", "Topics / seed keywords", "string_list", required=True, default=[], placeholder="mba colleges in pune"),
                F("question_prefixes", "Add question forms", "boolean", default=True, help="how / what / why / best / vs …"),
                F("expand_alphabet", "Expand a–z", "boolean", default=True),
                F("competitor_urls", "Competitor pages", "string_list", default=[], help="Distinctive terms they use are added."),
                F("language", "Language code", "text", default="en"),
                F("region", "Country code", "text", default="IN"),
                F("max_keywords", "Max keywords", "number", default=100, min=5, max=1000),
                F("max_requests_per_seed", "Suggestion requests per topic", "number", default=36, min=1, max=60),
            ],
        ),
        AgentKindInfo(
            kind="comparer",
            name="Comparison Builder",
            description="Matches the same product, college, plan or service across sources (fuzzy names), builds a side-by-side "
            "table and marks the best value per field.",
            category="data",
            icon="Columns3",
            uses_model=False,
            default_model=None,
            inputs="Items from several sources, and/or a dataset",
            outputs="One item per matched thing, plus a comparison table (saved as content)",
            config_schema=[
                F("match_field", "Match on", "text", required=True, default="title", placeholder="data.name",
                  help="The field holding the name: title, or data.<field>."),
                F("compare_fields", "Fields to compare", "string_list", required=True, default=[], placeholder="data.price:lower",
                  help="One per line. Add :higher or :lower to mark the best value, e.g. data.rating:higher."),
                F("fuzzy_threshold", "Name match strictness (0–100)", "number", default=85, min=50, max=100),
                F("dataset", "Also compare a dataset", "dataset", default=None),
                F("save_content", "Save the table as content", "boolean", default=True),
                F("title", "Title", "text", default="Comparison {{date}}"),
            ],
        ),
        AgentKindInfo(
            kind="serpapi_search",
            name="SerpApi Live Search",
            description="Real-time structured results from Google Web, News, Jobs, Shopping, Maps or Scholar through "
            "SerpApi. Runs several queries, removes duplicate URLs and can deepen the top results with the Extract API.",
            category="collect",
            icon="ScanSearch",
            uses_model=False,
            default_model=None,
            inputs="Queries (settings) or items whose titles are queries",
            outputs="One item per result: title, snippet, URL, publisher, date and engine metadata",
            config_schema=[
                F("engine", "SerpApi engine", "select", default="google",
                  options=_opts({"google": "Google Web", "google_news": "Google News", "google_jobs": "Google Jobs",
                                 "google_shopping": "Google Shopping", "google_maps": "Google Maps",
                                 "google_scholar": "Google Scholar"})),
                F("query", "Search query", "textarea", default="", placeholder="AI agent startups in Bengaluru hiring",
                  help="Leave empty to use a query per incoming item."),
                F("queries", "Extra queries", "string_list", default=[], help="One search per line."),
                F("location", "Location", "text", default="", placeholder="Bengaluru, India"),
                F("gl", "Country code", "text", default="in"),
                F("hl", "Language code", "text", default="en"),
                F("count", "Results per query", "number", default=10, min=1, max=30),
                F("max_queries", "Max queries", "number", default=5, min=1, max=10),
                F("extract_top", "Deepen top N with Extract API", "number", default=0, min=0, max=10,
                  help="0 = off. Each extracted page replaces the snippet with full markdown."),
                F("dedupe", "Remove duplicate URLs", "boolean", default=True),
            ],
        ),
        AgentKindInfo(
            kind="you_research",
            name="You.com Cited Researcher",
            description="Answers a question from live web data. Answer mode returns a synthesized answer with numbered "
            "citations from You.com; Search mode builds a cited brief from You.com Web Search results.",
            category="collect",
            icon="BookOpenCheck",
            uses_model=False,
            default_model=None,
            inputs="A question (setting) or items whose titles are questions",
            outputs="One item per question with the answer, numbered citations and supporting sources",
            config_schema=[
                F("question", "Question", "textarea", default="", placeholder="What changed in AI agent pricing this month?"),
                F("mode", "Mode", "select", default="answer",
                  options=_opts({"answer": "Cited answer (Answer API)", "search": "Cited brief (Web Search)"})),
                F("max_questions", "Max questions from items", "number", default=5, min=1, max=10),
                F("count", "Sources in search mode", "number", default=5, min=1, max=20),
                F("freshness", "Freshness", "select", default="",
                  options=_opts({"": "Any time", "day": "Last 24 hours", "week": "Last week", "month": "Last month", "year": "Last year"})),
                F("country", "Country", "text", default="IN"),
                F("language", "Language", "text", default="EN"),
            ],
        ),
        AgentKindInfo(
            kind="custom_llm",
            name="Custom AI Step",
            description="Your own prompt with {{title}}, {{text}}, {{url}} and {{data.field}} placeholders. The model fills "
            "the output fields you define, which are written into each item's data.",
            category="create",
            icon="Sparkles",
            uses_model=True,
            default_model="writer",
            inputs="Any items",
            outputs="Items with new data fields",
            config_schema=[
                F("prompt", "Prompt", "textarea", required=True,
                  default="Summarise this in two sentences for a busy reader.\n\nTitle: {{title}}\n\n{{text}}",
                  help="Placeholders: {{title}}, {{text}}, {{summary}}, {{url}}, {{data.<field>}}."),
                F("system", "System instructions", "textarea",
                  default="You are a precise assistant. Use only the information in the prompt."),
                F("output_fields", "Output fields", "extract_fields", required=True,
                  default=[{"key": "summary", "label": "Summary", "type": "text"}]),
                F("temperature", "Creativity (temperature)", "number", default=0.3, min=0, max=1.5),
            ],
        ),
    )
}


# ---------------------------------------------------------------- validation
def _check_field(f: dict[str, Any], value: Any, problems: list[str]) -> Any:
    key, label, t = f["key"], f["label"], f["type"]

    def bad(msg: str) -> None:
        problems.append(f"{label} ({key}): {msg}")

    if value is None:
        return None
    if t in ("text", "textarea", "model"):
        if not isinstance(value, str):
            bad("must be text")
            return value
        return value.strip() if t != "textarea" else value
    if t == "number":
        if isinstance(value, bool) or not isinstance(value, int | float):
            try:
                value = float(value)
            except (TypeError, ValueError):
                bad("must be a number")
                return value
        if "min" in f and value < f["min"]:
            bad(f"must be at least {f['min']}")
        if "max" in f and value > f["max"]:
            bad(f"must be at most {f['max']}")
        return int(value) if float(value).is_integer() and isinstance(f.get("default"), int) else value
    if t == "boolean":
        if not isinstance(value, bool):
            bad("must be true or false")
        return value
    if t == "select":
        allowed = {o["value"] for o in f.get("options") or []}
        if value not in allowed:
            bad(f"must be one of {', '.join(sorted(allowed))}")
        return value
    if t in ("multiselect", "formats"):
        allowed = {o["value"] for o in f.get("options") or []} or set(CONTENT_FORMATS)
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            bad("must be a list")
            return value
        unknown = [v for v in value if v not in allowed]
        if unknown:
            bad(f"unknown value(s): {', '.join(unknown)}")
        return list(dict.fromkeys(value))
    if t in ("string_list", "connections"):
        if isinstance(value, str):
            value = [v for v in value.splitlines()]
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            bad("must be a list of text values")
            return value
        return [v.strip() for v in value if v.strip()]
    if t == "dataset":
        if not isinstance(value, str):
            bad("must be a dataset id")
        return value
    if t == "sources":
        if not isinstance(value, list):
            bad("must be a list of {url, type}")
            return value
        out = []
        for i, s in enumerate(value):
            if isinstance(s, str):
                s = {"url": s, "type": "html"}
            if not isinstance(s, dict) or not isinstance(s.get("url"), str) or not s["url"].strip():
                bad(f"source #{i + 1} needs a url")
                continue
            url = s["url"].strip()
            if not url.startswith(("http://", "https://")):
                bad(f"source #{i + 1} must be an http(s) URL")
            stype = s.get("type") or "html"
            if stype not in SOURCE_TYPES:
                bad(f"source #{i + 1} type must be one of {', '.join(SOURCE_TYPES)}")
            out.append({"url": url, "type": stype})
        return out
    if t == "extract_fields":
        if not isinstance(value, list):
            bad("must be a list of fields")
            return value
        out, seen = [], set()
        for i, ef in enumerate(value):
            if not isinstance(ef, dict) or not str(ef.get("key") or "").strip():
                bad(f"field #{i + 1} needs a key")
                continue
            k = str(ef["key"]).strip()
            if not k[0].isalpha() or not k.replace("_", "").isalnum():
                bad(f"field key '{k}' must start with a letter and use only letters, digits and _")
            if k in seen:
                bad(f"duplicate field key '{k}'")
            seen.add(k)
            ftype = ef.get("type") or "text"
            if ftype not in DATASET_FIELD_TYPES:
                bad(f"field '{k}' type must be one of {', '.join(DATASET_FIELD_TYPES)}")
            item = {"key": k, "label": str(ef.get("label") or k.replace("_", " ").capitalize()), "type": ftype}
            if ef.get("selector"):
                item["selector"] = str(ef["selector"])
            if ef.get("description"):
                item["description"] = str(ef["description"])
            out.append(item)
        return out
    return value


def validate_config(kind: str, config: dict[str, Any] | None, *, partial: bool = False, require: bool = True) -> dict[str, Any]:
    """Validate `config` against the kind's schema. Full mode fills defaults and enforces required fields;
    partial mode (pipeline step overrides) checks only the keys given. `require=False` (catalogue activation)
    fills defaults but lets required settings stay empty until the user configures the agent."""
    info = AGENT_KINDS.get(kind)
    if info is None:
        raise ConfigError([f"Unknown agent kind '{kind}'"])
    config = dict(config or {})
    for key in JSON_SETTINGS.get(kind, ()):
        # JSON-in-a-textarea settings may arrive already parsed (API clients, blueprints).
        if isinstance(config.get(key), list | dict):
            config[key] = json.dumps(config[key], ensure_ascii=False)
    fields = {f["key"]: f for f in info.config_schema}
    problems: list[str] = []
    unknown = sorted(set(config) - set(fields))
    if unknown:
        problems.append(f"Unknown setting(s) for {info.name}: {', '.join(unknown)}")
    out: dict[str, Any] = {}
    for key, f in fields.items():
        if key in config:
            out[key] = _check_field(f, config[key], problems)
        elif not partial and "default" in f:
            out[key] = _copy(f["default"])
        if require and not partial and f.get("required") and out.get(key) in (None, "", []):
            problems.append(f"{f['label']} ({key}) is required")
    if not problems and kind in _EXTRA_CHECKS:
        _EXTRA_CHECKS[kind](out, problems)
    if problems:
        raise ConfigError(problems)
    return out


def _json_setting(out: dict[str, Any], key: str, expected: type, problems: list[str]) -> Any:
    """JSON-in-a-textarea settings: accept the parsed value or JSON text; store canonical JSON text so the
    dashboard form round-trips it unchanged."""
    import json

    if key not in out:
        return None
    raw = out[key]
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(raw, str) and not raw.strip():
            value = expected()
    except ValueError as exc:
        problems.append(f"{key}: not valid JSON ({exc})")
        return None
    if not isinstance(value, expected):
        problems.append(f"{key}: must be a JSON {'list' if expected is list else 'object'}")
        return None
    out[key] = json.dumps(value, ensure_ascii=False, indent=1 if value else None)
    return value


def _check_transform(out: dict[str, Any], problems: list[str]) -> None:
    filters = _json_setting(out, "filters", list, problems) or []
    for i, f in enumerate(filters):
        if not isinstance(f, dict) or not isinstance(f.get("field"), str) or not f["field"].strip():
            problems.append(f"filters #{i + 1}: needs a field")
        elif f.get("op") not in FILTER_OPS:
            problems.append(f"filters #{i + 1}: op must be one of {', '.join(FILTER_OPS)}")
        elif f["op"] == "date_within_days" and not isinstance(f.get("value"), int | float):
            problems.append(f"filters #{i + 1}: date_within_days needs a number of days as value")
    renames = _json_setting(out, "rename_fields", dict, problems) or {}
    if any(not isinstance(v, str) or not v for v in renames.values()):
        problems.append("rename_fields: every target must be a field path")
    _json_setting(out, "set_fields", dict, problems)
    rules = _json_setting(out, "assign_rules", list, problems) or []
    for i, r in enumerate(rules):
        cond = r.get("if") if isinstance(r, dict) else None
        if not isinstance(cond, dict) or cond.get("op") not in FILTER_OPS or not isinstance(r.get("set"), dict):
            problems.append(f"assign_rules #{i + 1}: needs if: {{field, op, value}} and set: {{...}}")
    if out.get("ai_categorize") and not out.get("categories"):
        problems.append("Categories are required when AI categorise is on")


def _check_http(out: dict[str, Any], problems: list[str]) -> None:
    try:
        json.loads(out.get("body_template") or "{}")
    except ValueError as exc:
        problems.append(f"body_template: not valid JSON ({exc})")


_EXTRA_CHECKS = {"data_transform": _check_transform, "http_action": _check_http}
JSON_SETTINGS = {"data_transform": ("filters", "rename_fields", "set_fields", "assign_rules")}


def _copy(value: Any) -> Any:
    import copy

    return copy.deepcopy(value)


def field_of(kind: str, key: str) -> dict[str, Any] | None:
    return next((f for f in AGENT_KINDS[kind].config_schema if f["key"] == key), None)
