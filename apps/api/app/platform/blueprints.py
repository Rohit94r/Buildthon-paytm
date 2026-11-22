"""Blueprints: ready-made agent teams per industry. Applying one creates its datasets, agents and pipelines in
the active workspace. Applying is idempotent: anything that already exists by name/slug is reused, never
duplicated or overwritten. Dataset references in agent configs are written as "@<dataset slug>"."""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.security import encrypt_secret
from app.models import Agent, AgentVersion, Dataset, Pipeline, PipelineVersion, Tenant
from app.platform.catalog import validate_config


@dataclass(frozen=True)
class Blueprint:
    key: str
    name: str
    tagline: str
    description: str
    industry: str
    icon: str
    modules: list[str]
    brand_color: str
    agents: list[dict[str, Any]] = field(default_factory=list)
    pipelines: list[dict[str, Any]] = field(default_factory=list)
    datasets: list[dict[str, Any]] = field(default_factory=list)
    version: str = "1.0.0"
    required_integrations: list[str] = field(default_factory=list)

    def out(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "tagline": self.tagline,
            "description": self.description,
            "industry": self.industry,
            "icon": self.icon,
            "agents": [{"name": a["name"], "kind": a["kind"], "description": a.get("description", "")} for a in self.agents],
            "pipelines": [{"name": p["name"], "steps": [_step_name(x) for x in p["steps"]], "trigger": _trigger_label(p)} for p in self.pipelines],
            "datasets": [d["name"] for d in self.datasets],
            "modules": list(self.modules),
        }


def _step_name(step: str | dict[str, Any]) -> str:
    return step if isinstance(step, str) else step.get("agent") or step.get("label") or "Approval"


def _trigger_label(p: dict[str, Any]) -> str:
    if p.get("trigger") == "schedule":
        m = int(p["every_minutes"])
        return f"Every {m // 1440} day(s)" if m % 1440 == 0 else f"Every {m // 60} hour(s)" if m % 60 == 0 else f"Every {m} min"
    return "Webhook" if p.get("trigger") == "webhook" else "Manual"


def _f(key: str, label: str, type: str = "text", **kw: Any) -> dict[str, Any]:
    return {"key": key, "label": label, "type": type, **kw}


COLLEGE_FIELDS = [
    _f("name", "College"),
    _f("city", "City"),
    _f("state", "State"),
    _f("type", "Type", compare=True),
    _f("nirf_rank", "NIRF rank", "number", compare=True, higher_is_better=False),
    _f("fees_total", "Total fees", "currency", unit="₹", compare=True, higher_is_better=False),
    _f("avg_package", "Average package", "number", unit="LPA", compare=True, higher_is_better=True),
    _f("highest_package", "Highest package", "number", unit="LPA", compare=True, higher_is_better=True),
    _f("placement_rate", "Placement rate", "number", unit="%", compare=True, higher_is_better=True),
    _f("rating", "Rating", "rating", compare=True, higher_is_better=True),
    _f("courses", "Courses", "list", compare=True),
    _f("entrance_exams", "Entrance exams", "list", compare=True),
    _f("website", "Website", "url"),
]

PRODUCT_FIELDS = [
    _f("name", "Product"),
    _f("brand", "Brand", compare=True),
    _f("price", "Price", "currency", unit="₹", compare=True, higher_is_better=False),
    _f("mrp", "MRP", "currency", unit="₹", compare=True),
    _f("discount", "Discount", "number", unit="%", compare=True, higher_is_better=True),
    _f("rating", "Rating", "rating", compare=True, higher_is_better=True),
    _f("in_stock", "In stock", "boolean", compare=True, higher_is_better=True),
    _f("url", "Product page", "url"),
]

HACKATHON_FIELDS = [
    _f("name", "Hackathon"),
    _f("organizer", "Organizer", compare=True),
    _f("start_date", "Starts", "date", compare=True),
    _f("end_date", "Ends", "date"),
    _f("registration_deadline", "Registration deadline", "date", compare=True),
    _f("mode", "Mode", compare=True),
    _f("location", "Location", compare=True),
    _f("prize_pool", "Prize pool", compare=True),
    _f("themes", "Themes", "list", compare=True),
    _f("eligibility", "Eligibility", compare=True),
    _f("category", "Category", compare=True),
    _f("description", "Description"),
    _f("url", "Link", "url"),
]

HACKATHON_EXTRACT = [
    _f("name", "Hackathon name"),
    _f("organizer", "Organizer"),
    _f("start_date", "Start date", "date", description="ISO date YYYY-MM-DD"),
    _f("end_date", "End date", "date", description="ISO date YYYY-MM-DD"),
    _f("registration_deadline", "Registration deadline", "date", description="ISO date YYYY-MM-DD; null if not stated"),
    _f("mode", "Mode", description="online, offline or hybrid"),
    _f("location", "Location", description="City/country, or Online"),
    _f("prize_pool", "Prize pool", description="As written, with currency"),
    _f("themes", "Themes", "list"),
    _f("eligibility", "Eligibility", description="Who can take part"),
    _f("url", "Registration / event URL", "url"),
]

RESEARCH_FIELDS = [
    _f("question", "Research question"),
    _f("topic", "Topic", compare=True),
    _f("priority", "Priority", "number", compare=True, higher_is_better=True),
    _f("status", "Status", compare=True),
    _f("notes", "Notes"),
]


BLUEPRINTS: dict[str, Blueprint] = {
    b.key: b
    for b in (
        Blueprint(
            key="news_media_autopilot",
            name="News media autopilot",
            tagline="From market headlines to articles, threads and reels every hour",
            description="Collects market news from feeds and Google News, rewrites it in your desk's voice, turns every story into "
            "LinkedIn, X, Instagram, newsletter, WhatsApp and short-video formats, adds SEO, checks quality and publishes "
            "after an editor approves.",
            industry="news_media",
            icon="Newspaper",
            modules=["pipelines"],
            brand_color="#2563eb",
            agents=[
                {"name": "Market Scraper", "kind": "web_scraper", "description": "Reads market news feeds.",
                 "config": {"sources": [{"url": "https://www.livemint.com/rss/markets", "type": "rss"},
                                        {"url": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", "type": "rss"}],
                            "max_items": 4, "max_age_hours": 12}},
                {"name": "Trend Monitor", "kind": "news_monitor", "description": "Watches Google News for market topics.",
                 "config": {"keywords": ["Sensex", "Nifty 50", "RBI monetary policy", "India IPO"], "max_items": 4, "max_age_hours": 12}},
                {"name": "Persona Rewriter", "kind": "persona_rewriter", "model": "writer", "description": "Writes in the MarketPulse desk voice.",
                 "config": {"persona": "The MarketPulse markets desk: explains what moved Indian markets and why it matters to retail "
                                       "investors, in plain English, without hype or tips.",
                            "tone": "professional", "target_words": 350, "output_format": "article", "audience": "Retail investors in India"}},
                {"name": "Format Studio", "kind": "multi_format", "model": "writer", "description": "One story, every channel.",
                 "config": {"formats": ["linkedin_post", "x_thread", "instagram_caption", "newsletter", "short_video_script", "whatsapp_message"],
                            "hashtags": 5}},
                {"name": "SEO Optimizer", "kind": "seo_optimizer", "description": "Titles, meta, slugs and JSON-LD.",
                 "config": {"path_prefix": "/markets", "schema_type": "NewsArticle"}},
                {"name": "Quality Gate", "kind": "quality_gate", "description": "Numbers, banned phrases, duplicates.",
                 "config": {"on_fail": "flag"}},
                {"name": "Auto Publisher", "kind": "auto_publisher", "description": "Publishes approved content.", "config": {"connections": []}},
            ],
            pipelines=[
                {"name": "Daily market desk", "description": "Hourly: collect, write, repurpose, optimise, check, publish after approval.",
                 "steps": ["Market Scraper", "Trend Monitor", "Persona Rewriter", "Format Studio", "SEO Optimizer", "Quality Gate", "Auto Publisher"],
                 "trigger": "schedule", "every_minutes": 60, "require_approval": True},
            ],
        ),
        Blueprint(
            key="livedesk_research",
            name="LiveDesk research workspace",
            tagline="SerpApi structured signals + You.com cited answers in one workspace",
            description="A ready-made research desk: SerpApi collects web and news signals, You.com writes a cited answer, "
            "and a comparison assistant answers follow-up questions with the same live sources.",
            industry="other",
            icon="ScanSearch",
            modules=["pipelines", "datasets", "assistant"],
            brand_color="#0ea5e9",
            required_integrations=["serpapi", "youcom"],
            datasets=[{"name": "Research Queue", "slug": "research_queue", "key_field": "question", "public": False,
                       "fields": RESEARCH_FIELDS, "description": "Sample research questions for the LiveDesk demo."}],
            agents=[
                {"name": "Web Signal Collector", "kind": "serpapi_search",
                 "description": "Collects structured web results with SerpApi.",
                 "config": {"engine": "google", "query": "AI agent startups India", "gl": "in", "hl": "en", "count": 8,
                            "queries": ["AI agent platform funding", "agentic AI product launches India"], "dedupe": True}},
                {"name": "News Signal Monitor", "kind": "serpapi_search",
                 "description": "Collects fresh news with SerpApi's Google News engine.",
                 "config": {"engine": "google_news", "query": "AI agents India", "gl": "in", "hl": "en", "count": 8,
                            "dedupe": True}},
                {"name": "Cited Answer Desk", "kind": "you_research",
                 "description": "Answers the question of the day with You.com citations.",
                 "config": {"question": "What changed in India's AI agent startup ecosystem this month?",
                            "mode": "answer", "country": "IN", "language": "EN"}},
                {"name": "Live Research Assistant", "kind": "comparison_assistant", "model": "fast",
                 "description": "Answers dataset questions with fresh sponsor citations.",
                 "config": {"dataset": "@research_queue", "live_sources": True, "max_sources": 5,
                            "instructions": "Be concise and neutral. Quote the question details, then use the live web "
                                            "sources for fresh context and cite them with [n]."}},
            ],
            pipelines=[
                {"name": "Daily live research", "description": "Collect web + news signals, then write a cited brief.",
                 "steps": ["Web Signal Collector", "News Signal Monitor", "Cited Answer Desk"],
                 "trigger": "manual"},
            ],
        ),
        Blueprint(
            key="college_portal",
            name="College comparison portal",
            tagline="College data, admission news and a real-time compare assistant",
            description="Builds a colleges dataset (fees, placements, rankings, courses) from the pages you choose, keeps it fresh, "
            "writes admission news for the site and answers 'IIT vs NIT'-style questions instantly with a comparison table.",
            industry="education",
            icon="GraduationCap",
            modules=["pipelines", "datasets", "assistant"],
            brand_color="#7c3aed",
            datasets=[{"name": "Colleges", "slug": "colleges", "key_field": "name", "public": True, "fields": COLLEGE_FIELDS,
                       "description": "Colleges with fees, placements and rankings."}],
            agents=[
                {"name": "College Data Collector", "kind": "dataset_builder", "description": "Reads college pages into the dataset.",
                 "config": {"dataset": "@colleges", "mode": "ai", "max_pages": 20}},
                {"name": "Fees & Placement Updater", "kind": "dataset_builder", "description": "Refreshes fees and placement figures.",
                 "config": {"dataset": "@colleges", "mode": "ai", "max_pages": 20,
                            "extract_fields": [_f("name", "College"), _f("fees_total", "Total fees", "currency"),
                                               _f("avg_package", "Average package (LPA)", "number"),
                                               _f("highest_package", "Highest package (LPA)", "number"),
                                               _f("placement_rate", "Placement rate (%)", "number")]}},
                {"name": "Admission News Monitor", "kind": "news_monitor", "description": "Exams, counselling and rankings news.",
                 "config": {"keywords": ["JEE Main", "NEET UG", "CUET", "NIRF ranking", "JoSAA counselling"], "max_items": 5, "max_age_hours": 24}},
                {"name": "Article Writer", "kind": "persona_rewriter", "model": "writer", "description": "Student-friendly admission news.",
                 "config": {"persona": "A friendly admissions counsellor who explains exam and admission news to students and parents "
                                       "with exact dates and steps.", "tone": "friendly", "output_format": "blog_post", "target_words": 450}},
                {"name": "SEO Optimizer", "kind": "seo_optimizer", "description": "SEO for admission articles.",
                 "config": {"path_prefix": "/news", "schema_type": "NewsArticle"}},
                {"name": "Publisher", "kind": "auto_publisher", "description": "Publishes approved articles.", "config": {"connections": []}},
                {"name": "Compare Assistant", "kind": "comparison_assistant", "description": "Real-time college comparisons.",
                 "config": {"dataset": "@colleges", "greeting": "Compare colleges on fees, placements and rankings.",
                            "instructions": "Answer like a careful admissions counsellor: neutral, concise, quote the figures with units, "
                                            "and remind users to verify fees on the college website before deciding."}},
            ],
            pipelines=[
                {"name": "Admission news desk", "description": "Every 6 hours: admission news → article → SEO → publish after approval.",
                 "steps": ["Admission News Monitor", "Article Writer", "SEO Optimizer", "Publisher"],
                 "trigger": "schedule", "every_minutes": 360, "require_approval": True},
                {"name": "College data refresh", "description": "Run after adding college pages to the collectors' sources.",
                 "steps": ["College Data Collector", "Fees & Placement Updater"], "trigger": "manual", "require_approval": False},
            ],
        ),
        Blueprint(
            key="executive_newsroom",
            name="Executive newsroom",
            tagline="The original LayerFlow newsroom plus social repurposing",
            description="Turns on the newsroom module (discovery, research, writing, SEO, review, publishing to your site) and adds a "
            "small team that repurposes executive news into LinkedIn posts, X threads and a newsletter.",
            industry="executive_media",
            icon="Briefcase",
            modules=["newsroom", "pipelines"],
            brand_color="#8a3b12",
            agents=[
                {"name": "Executive Signal Monitor", "kind": "news_monitor", "description": "Leadership and capital moves.",
                 "config": {"keywords": ["CEO appointment", "capital expenditure plan", "acquisition announced"], "max_items": 5}},
                {"name": "Social Repurposer", "kind": "multi_format", "model": "writer", "description": "LinkedIn, X and newsletter.",
                 "config": {"formats": ["linkedin_post", "x_thread", "newsletter"], "hashtags": 3, "tone": "authoritative"}},
                {"name": "Quality Gate", "kind": "quality_gate", "description": "Grounding and voice checks.", "config": {}},
            ],
            pipelines=[
                {"name": "Executive social repurposing", "description": "Signals → social formats → quality check (approval required).",
                 "steps": ["Executive Signal Monitor", "Social Repurposer", "Quality Gate"], "trigger": "manual", "require_approval": True},
            ],
        ),
        Blueprint(
            key="blog_seo_autopilot",
            name="Blog SEO autopilot",
            tagline="A researched, SEO-ready blog post every day",
            description="Finds fresh stories in your niche, writes an original blog post grounded in them, optimises it for search, "
            "checks it and publishes to WordPress, Ghost or your Next.js site after approval.",
            industry="blog",
            icon="PenTool",
            modules=["pipelines"],
            brand_color="#059669",
            agents=[
                {"name": "Topic Monitor", "kind": "news_monitor", "description": "Watches your niche.",
                 "config": {"keywords": ["remote work", "productivity tools"], "max_items": 3, "max_age_hours": 48}},
                {"name": "Blog Writer", "kind": "persona_rewriter", "model": "writer", "description": "Long-form blog posts.",
                 "config": {"persona": "A practical, friendly blogger who turns news into useful advice.", "tone": "conversational",
                            "output_format": "blog_post", "target_words": 800}},
                {"name": "SEO Optimizer", "kind": "seo_optimizer", "description": "Search metadata.", "config": {"schema_type": "BlogPosting"}},
                {"name": "Quality Gate", "kind": "quality_gate", "description": "Checks before publishing.", "config": {"min_words": 300}},
                {"name": "Auto Publisher", "kind": "auto_publisher", "description": "Publishes approved posts.", "config": {"connections": []}},
            ],
            pipelines=[
                {"name": "Daily blog post", "description": "Once a day, approval required.",
                 "steps": ["Topic Monitor", "Blog Writer", "SEO Optimizer", "Quality Gate", "Auto Publisher"],
                 "trigger": "schedule", "every_minutes": 1440, "require_approval": True},
            ],
        ),
        Blueprint(
            key="ecommerce_price_watch",
            name="E-commerce price watch",
            tagline="Track product prices and let shoppers compare instantly",
            description="Scrapes product pages into a products dataset (price, MRP, discount, rating, stock) on a schedule and adds a "
            "shopping assistant that compares products side by side.",
            industry="ecommerce",
            icon="ShoppingCart",
            modules=["pipelines", "datasets", "assistant"],
            brand_color="#ea580c",
            datasets=[{"name": "Products", "slug": "products", "key_field": "name", "public": True, "fields": PRODUCT_FIELDS,
                       "description": "Tracked products with current prices."}],
            agents=[
                {"name": "Price Tracker", "kind": "dataset_builder", "description": "Reads product pages into the dataset.",
                 "config": {"dataset": "@products", "mode": "ai", "max_pages": 30}},
                {"name": "Product Compare", "kind": "comparison_assistant", "description": "Side-by-side product comparisons.",
                 "config": {"dataset": "@products", "greeting": "Compare products on price, discount and rating."}},
            ],
            pipelines=[
                {"name": "Price refresh", "description": "Every 6 hours: re-read product pages.", "steps": ["Price Tracker"],
                 "trigger": "schedule", "every_minutes": 360, "require_approval": False},
            ],
        ),
        Blueprint(
            key="seo_automation",
            name="SEO automation",
            tagline="Weekly site audit, report and alert",
            description="Crawls your website every week, checks every page's SEO basics, writes a prioritised report into Content "
            "and alerts your team on Slack, Discord, Telegram or email.",
            industry="other",
            icon="ScanSearch",
            modules=["pipelines"],
            brand_color="#0891b2",
            version="1.0.0",
            agents=[
                {"name": "SEO Site Auditor", "kind": "site_auditor", "catalog": "seo_site_auditor", "description": "Crawls and checks your site.",
                 "config": {"max_pages": 40}},
                {"name": "SEO Report", "kind": "report_builder", "catalog": "report_builder", "model": "writer",
                 "description": "Turns the audit into a report.", "config": {"title": "Weekly SEO audit {{date}}"}},
                {"name": "SEO Alert", "kind": "notifier", "catalog": "alerts_sender", "description": "Sends the report summary.",
                 "config": {"mode": "per_item", "template": "{{title}}\n{{summary}}"}},
            ],
            pipelines=[
                {"name": "Weekly SEO audit", "description": "Set the auditor's site URL and pick a notifier connection.",
                 "steps": ["SEO Site Auditor", "SEO Report", {"agent": "SEO Alert", "on_error": "continue"}],
                 "trigger": "schedule", "every_minutes": 10080, "require_approval": False},
            ],
        ),
        Blueprint(
            key="lead_management",
            name="Lead management",
            tagline="Validate, score, route and sync every enquiry",
            description="For a teaching institute or any sales team: website form submissions arrive on a webhook, are validated and "
            "de-duplicated, scored and categorised, assigned to a counsellor by rules, saved to a Leads dataset, pushed to your CRM "
            "and announced to the team.",
            industry="education",
            icon="Target",
            modules=["pipelines", "datasets"],
            brand_color="#16a34a",
            version="1.0.0",
            required_integrations=["rest_api"],
            datasets=[{"name": "Leads", "slug": "leads", "key_field": "email", "public": False, "description": "Enquiries from the website.",
                       "fields": [_f("email", "Email"), _f("name", "Name"), _f("phone", "Phone"), _f("course", "Course", compare=True),
                                  _f("city", "City", compare=True), _f("source", "Source"),
                                  _f("score", "Score", "number", compare=True, higher_is_better=True), _f("category", "Category", compare=True),
                                  _f("assigned_to", "Assigned to", compare=True), _f("status", "Status"), _f("message", "Message")]}],
            agents=[
                {"name": "Lead Validator", "kind": "data_transform", "catalog": "data_cleaner", "description": "Drops invalid and duplicate leads.",
                 "config": {"dedupe_by": ["data.email", "data.phone"],
                            "filters": [{"field": "data.email", "op": "contains", "value": "@"}]}},
                {"name": "Lead Qualifier", "kind": "custom_llm", "catalog": "lead_qualifier", "model": "fast", "description": "Scores each lead.",
                 "config": {"prompt": "Score this enquiry from 0 to 100 for how likely the person is to enrol, give a one-line reason and the "
                                      "best-fit course category.\n\nName: {{data.name}}\nCourse: {{data.course}}\nCity: {{data.city}}\n"
                                      "Message: {{data.message}}",
                            "output_fields": [{"key": "score", "label": "Score", "type": "number"}, {"key": "reason", "label": "Reason", "type": "text"},
                                              {"key": "category", "label": "Category", "type": "text"}], "temperature": 0.1}},
                {"name": "Lead Router", "kind": "data_transform", "description": "Assigns a counsellor by rules.",
                 "config": {"dedupe_by": [], "set_fields": {"data.status": "new"},
                            "assign_rules": [{"if": {"field": "data.course", "op": "contains", "value": "MBA"}, "set": {"data.assigned_to": "MBA admissions desk"}},
                                             {"if": {"field": "data.course", "op": "contains", "value": "Data"}, "set": {"data.assigned_to": "Tech courses desk"}},
                                             {"if": {"field": "data.email", "op": "exists"}, "set": {"data.assigned_to": "General counsellor"}}]}},
                {"name": "Save Leads", "kind": "dataset_builder", "catalog": "dataset_saver", "description": "Upserts leads by email.",
                 "config": {"dataset": "@leads", "source_mode": "pipeline_items"}},
                {"name": "CRM Sync", "kind": "http_action", "catalog": "crm_sync", "description": "Pushes leads to your CRM.",
                 "config": {"path": "/leads", "body_template": '{"email": "{{data.email}}", "name": "{{data.name}}", "phone": "{{data.phone}}", '
                                                              '"course": "{{data.course}}", "score": "{{data.score}}", "owner": "{{data.assigned_to}}"}'}},
                {"name": "Follow-up Notifier", "kind": "notifier", "catalog": "alerts_sender", "description": "Tells the team about each lead.",
                 "config": {"mode": "per_item", "template": "New lead: {{data.name}} ({{data.course}}, {{data.city}}) → {{data.assigned_to}}, score {{data.score}}"}},
            ],
            pipelines=[
                {"name": "Lead intake", "description": "Point your website form at this workflow's webhook URL.",
                 "steps": ["Lead Validator", "Lead Qualifier", "Lead Router", "Save Leads", {"agent": "CRM Sync", "on_error": "continue"},
                           {"agent": "Follow-up Notifier", "on_error": "continue"}],
                 "trigger": "webhook", "require_approval": False},
            ],
        ),
        Blueprint(
            key="customer_support",
            name="Customer support",
            tagline="An FAQ assistant on your website",
            description="Keeps an FAQ dataset (import rows or read your help pages) and answers visitors in real time through the "
            "embeddable assistant widget, citing the matching entries.",
            industry="other",
            icon="LifeBuoy",
            modules=["datasets", "assistant", "pipelines"],
            brand_color="#9333ea",
            version="1.0.0",
            datasets=[{"name": "FAQ", "slug": "faq", "key_field": "question", "public": True, "description": "Questions and answers.",
                       "fields": [_f("question", "Question"), _f("answer", "Answer", compare=True), _f("category", "Category", compare=True),
                                  _f("tags", "Tags", "list")]}],
            agents=[
                {"name": "FAQ Importer", "kind": "dataset_builder", "description": "Reads your help pages into the FAQ.",
                 "config": {"dataset": "@faq", "mode": "ai", "max_pages": 30}},
                {"name": "Support Assistant", "kind": "comparison_assistant", "catalog": "support_assistant", "description": "Answers from the FAQ.",
                 "config": {"dataset": "@faq", "max_records": 3, "greeting": "Hi! Ask me anything about our product.",
                            "instructions": "Answer like a friendly support agent using only the FAQ entries. If they do not cover the question, "
                                            "say so and suggest contacting support."}},
            ],
            pipelines=[
                {"name": "Refresh FAQ", "description": "Add your help pages to the importer's sources first.", "steps": ["FAQ Importer"],
                 "trigger": "manual", "require_approval": False},
            ],
        ),
        Blueprint(
            key="hackathon_listings",
            name="Hackathon / event listings",
            tagline="Scrape, clean, rewrite and list upcoming hackathons on your site",
            description="Scrapes hackathon listings, removes duplicates and closed events, sorts by registration deadline, "
            "categorises each one, rewrites the description in a student-friendly voice and saves everything to a public "
            "Hackathons dataset your website reads through the public API, plus a finder assistant.",
            industry="events",
            icon="Trophy",
            modules=["pipelines", "datasets", "assistant"],
            brand_color="#db2777",
            datasets=[{"name": "Hackathons", "slug": "hackathons", "key_field": "name", "public": True, "fields": HACKATHON_FIELDS,
                       "description": "Upcoming hackathons with dates, prizes and eligibility."}],
            agents=[
                {"name": "Hackathon Scraper", "kind": "web_scraper", "description": "Finds open hackathons and extracts their details.",
                 "config": {"sources": [{"url": "https://devpost.com/api/hackathons?status[]=upcoming&status[]=open", "type": "json"}],
                            "mode": "auto", "extract_fields": HACKATHON_EXTRACT, "detail_follow": True, "max_items": 20, "max_age_hours": 0}},
                {"name": "Hackathon Sorter", "kind": "data_transform", "description": "De-duplicates, drops closed events, sorts by deadline.",
                 "config": {"dedupe_by": ["url", "data.name"],
                            "filters": [{"field": "data.registration_deadline", "op": "date_after_today"}],
                            "sort_by": "data.registration_deadline", "sort_order": "asc", "ai_categorize": True,
                            "categories": ["AI", "Web3", "Fintech", "Health", "Climate", "Student", "Open innovation"],
                            "category_field": "category"}},
                {"name": "Listing Rewriter", "kind": "persona_rewriter", "model": "writer", "description": "Clear, exciting listing copy.",
                 "config": {"persona": "A clear, exciting, student-friendly events writer.", "tone": "friendly", "output_format": "article",
                            "target_words": 180,
                            "instructions": "Keep exact dates, prizes and eligibility. Never invent details. End with how to register."}},
                {"name": "Save to Hackathons", "kind": "dataset_builder", "description": "Upserts the cleaned listings into the dataset.",
                 "config": {"dataset": "@hackathons", "source_mode": "pipeline_items"}},
                {"name": "Hackathon Finder", "kind": "comparison_assistant", "description": "Helps visitors pick a hackathon.",
                 "config": {"dataset": "@hackathons", "greeting": "Looking for a hackathon? Ask by theme, prize or deadline.",
                            "instructions": "Be upbeat and precise. Quote exact dates and prizes from the records."}},
                {"name": "Social Posts", "kind": "multi_format", "model": "writer", "description": "Optional: social posts per listing.",
                 "config": {"formats": ["linkedin_post", "x_thread", "instagram_caption"], "tone": "friendly"}},
                {"name": "Auto Publisher", "kind": "auto_publisher", "description": "Optional: publish the social posts.", "config": {"connections": []}},
            ],
            pipelines=[
                {"name": "Daily hackathon sweep", "description": "Twice a day: scrape → clean → rewrite → save to the dataset.",
                 "steps": ["Hackathon Scraper", "Hackathon Sorter", "Listing Rewriter", "Save to Hackathons"],
                 "trigger": "schedule", "every_minutes": 720, "require_approval": False},
            ],
        ),
    )
}


def _pipeline_step(spec: str | dict[str, Any], by_name: dict[str, Agent]) -> dict[str, Any]:
    spec = {"agent": spec} if isinstance(spec, str) else dict(spec)
    stype = spec.get("type", "agent")
    return {"id": uuid.uuid4().hex, "type": stype, "agent_id": str(by_name[spec["agent"]].id) if stype == "agent" else None,
            "overrides": {}, "condition": spec.get("condition"), "on_error": spec.get("on_error", "stop"), "retries": spec.get("retries", 0),
            "label": spec.get("label")}


def _resolve(value: Any, datasets: dict[str, Dataset]) -> Any:
    if isinstance(value, str) and value.startswith("@") and value[1:] in datasets:
        return str(datasets[value[1:]].id)
    if isinstance(value, list):
        return [_resolve(v, datasets) for v in value]
    if isinstance(value, dict):
        return {k: _resolve(v, datasets) for k, v in value.items()}
    return value


PACKAGES: dict[str, str] = {
    "college_discovery": "college_portal",
    "executive_editorial": "executive_newsroom",
    "news_publishing": "news_media_autopilot",
    "seo_automation": "seo_automation",
    "lead_management": "lead_management",
    "customer_support": "customer_support",
    "hackathon_listings": "hackathon_listings",
    "ecommerce_price_watch": "ecommerce_price_watch",
    "blog_seo_autopilot": "blog_seo_autopilot",
}


def package_out(key: str, installed: dict[str, Any] | None) -> dict[str, Any]:
    bp = BLUEPRINTS[PACKAGES[key]]
    return {
        **bp.out(), "key": key, "version": bp.version, "required_integrations": list(bp.required_integrations),
        "catalog_agents": sorted({a["catalog"] for a in bp.agents if a.get("catalog")}),
        "installed": {"version": installed["version"], "at": installed["at"], "upgrade_available": installed["version"] != bp.version}
        if installed else None,
    }


async def apply_blueprint(db: AsyncSession, tenant: Tenant, key: str, *, package_key: str | None = None,
                          check_quota: bool = True) -> dict[str, list[Any]]:
    """Create the blueprint's datasets, agents and pipelines in `tenant`; anything that already exists by name/slug
    is reused and reported in `skipped`, never overwritten. Caller commits."""
    bp = BLUEPRINTS[key]
    created: dict[str, list[Any]] = {"agents": [], "pipelines": [], "datasets": [], "skipped": [], "new_agents": [], "new_pipelines": [],
                                     "new_datasets": []}
    if check_quota:
        from app.platform.plans import check_agents

        have = set((await db.execute(select(Agent.name).where(Agent.tenant_id == tenant.id))).scalars())
        await check_agents(db, tenant, adding=sum(1 for a in bp.agents if a["name"] not in have))

    existing_ds = {d.slug: d for d in (await db.execute(select(Dataset).where(Dataset.tenant_id == tenant.id))).scalars()}
    for spec in bp.datasets:
        ds = existing_ds.get(spec["slug"])
        if ds is None:
            ds = Dataset(tenant_id=tenant.id, name=spec["name"], slug=spec["slug"], description=spec.get("description", ""),
                         key_field=spec["key_field"], fields=[dict(f) for f in spec["fields"]], public=spec.get("public", False))
            db.add(ds)
            await db.flush()
            existing_ds[ds.slug] = ds
            created["new_datasets"].append(ds)
        else:
            created["skipped"].append(spec["name"])
        created["datasets"].append(ds)

    existing_agents = {a.name: a for a in (await db.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars()}
    by_name: dict[str, Agent] = {}
    for spec in bp.agents:
        agent = existing_agents.get(spec["name"])
        if agent is None:
            from app.platform.catalog import AGENT_KINDS

            info = AGENT_KINDS[spec["kind"]]
            from app.platform.tools import KIND_TOOLS

            agent = Agent(tenant_id=tenant.id, name=spec["name"], kind=spec["kind"], description=spec.get("description", ""),
                          config=validate_config(spec["kind"], _resolve(spec.get("config", {}), existing_ds), require=False),
                          model=spec.get("model") or info.default_model or "fast", enabled=True, status="active",
                          source="package", package_key=package_key or key, catalog_key=spec.get("catalog"),
                          tools=list(KIND_TOOLS.get(spec["kind"], [])), limits={})
            db.add(agent)
            await db.flush()
            db.add(AgentVersion(tenant_id=tenant.id, agent_id=agent.id, version=1, config=agent.config, model=agent.model,
                                note=f"Installed by package {package_key or key} v{bp.version}"))
            created["new_agents"].append(agent)
        else:
            created["skipped"].append(spec["name"])
        by_name[spec["name"]] = agent
        created["agents"].append(agent)

    existing_pipes = {p.name: p for p in (await db.execute(select(Pipeline).where(Pipeline.tenant_id == tenant.id))).scalars()}
    for spec in bp.pipelines:
        pipe = existing_pipes.get(spec["name"])
        if pipe is None:
            trigger = spec.get("trigger", "manual")
            pipe = Pipeline(
                tenant_id=tenant.id, name=spec["name"], description=spec.get("description", ""),
                steps=[_pipeline_step(x, by_name) for x in spec["steps"]],
                trigger_type=trigger, every_minutes=spec.get("every_minutes") if trigger == "schedule" else None,
                webhook_token_enc=encrypt_secret(secrets.token_urlsafe(24)),
                require_approval=spec.get("require_approval", True), enabled=True,
                next_run_at=utcnow() + timedelta(minutes=int(spec["every_minutes"])) if trigger == "schedule" else None,
            )
            db.add(pipe)
            await db.flush()
            db.add(PipelineVersion(tenant_id=tenant.id, pipeline_id=pipe.id, version=1, steps=pipe.steps,
                                   trigger={"type": trigger, "every_minutes": pipe.every_minutes}))
            created["new_pipelines"].append(pipe)
        else:
            created["skipped"].append(spec["name"])
        created["pipelines"].append(pipe)

    tenant.modules = list(dict.fromkeys([*(tenant.modules or []), *bp.modules]))
    tenant.blueprint = tenant.blueprint or bp.key
    if (tenant.industry or "other") == "other":
        tenant.industry = bp.industry
    return created
