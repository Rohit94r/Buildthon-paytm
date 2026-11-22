// Sensible demo config applied when a catalogue agent is activated (POST /catalog/{key}/activate).
// A `preset` in catalog-agents.json (when present) is merged on top of this.
import type { AgentKind, Connection, ConnectionKind, Dataset } from "../platform-types";

export interface PresetContext {
  industry: string;
  domain: string | null;
  datasets: Dataset[];
  connections: Connection[];
}

const F = (key: string, label: string, type = "text", description?: string) => ({ key, label, type, ...(description ? { description } : {}) });
const html = (url: string) => ({ url, type: "html" });

const KEYWORDS: Record<string, string[]> = {
  news_media: ["Sensex", "Nifty", "RBI policy"],
  education: ["JEE Main", "NEET", "college admissions"],
  events: ["hackathon", "devfest", "coding contest"],
  ecommerce: ["smartphone launch", "price cut", "festive sale"],
  executive_media: ["CEO appointment", "board", "strategy"],
};
const SEEDS: Record<string, string[]> = {
  news_media: ["ipo gmp today", "sensex today", "best mutual funds"],
  education: ["best engineering colleges", "jee main cutoff", "college fees"],
  events: ["hackathons in india", "online hackathon", "student hackathon"],
  ecommerce: ["best budget phone", "phone under 20000", "5g phone offers"],
};

function pickConnections(conns: Connection[], kinds: ConnectionKind[]): string[] {
  return conns.filter((c) => kinds.includes(c.kind) && c.status === "connected").map((c) => c.id);
}

export function activationConfig(key: string, kind: AgentKind, ctx: PresetContext): Record<string, unknown> {
  const site = `https://${ctx.domain ?? "example.com"}`;
  const kw = KEYWORDS[ctx.industry] ?? ["AI agents", "automation"];
  const seeds = SEEDS[ctx.industry] ?? ["best budget phone", "ai tools for small business"];
  const ds = ctx.datasets[0]?.id ?? "";
  const shop = "https://www.example-shop.in";
  switch (key) {
    case "smart_scraper":
      return { sources: [html(`${shop}/category/smartphones`)], extraction: "auto", extract_fields: [F("name", "Name"), F("price", "Price", "currency"), F("rating", "Rating", "number")], follow_links: false, max_items: 50 };
    case "url_collector":
      return { start_urls: [`${shop}/`], include_patterns: ["/product/"], use_sitemap: true, max_links: 500 };
    case "site_crawler":
      return { sources: [{ url: `${site}/sitemap.xml`, type: "sitemap" }], extraction: "auto", extract_fields: [F("title", "Page title"), F("description", "Description"), F("updated", "Last updated", "date")], max_items: 100 };
    case "table_extractor":
      return { sources: [html("https://en.wikipedia.org/wiki/List_of_states_and_union_territories_of_India_by_population")], extraction: "css", extract_fields: [F("state", "State"), F("population", "Population", "number"), F("area_km2", "Area (km²)", "number")] };
    case "structured_data_reader":
      return { sources: [html(`${shop}/product/redmi-note-14-pro`)], extraction: "css", extract_fields: [F("name", "Name"), F("price", "Price", "currency"), F("availability", "In stock"), F("brand", "Brand")] };
    case "image_scraper":
      return { sources: [html(`${shop}/product/redmi-note-14-pro`), html(`${site}/gallery`)], search_open_libraries: false, min_width: 800, require_credit: false };
    case "open_image_finder":
      return { sources: [], search_open_libraries: true, min_width: 1200, require_credit: true };
    case "alt_text_writer":
      return { search_open_libraries: false, write_alt_text: true, min_width: 300, require_credit: false };
    case "news_discovery":
      return { keywords: kw, lookback_hours: 24, max_items: 40 };
    case "topic_monitor":
      return { sources: [{ url: `https://news.google.com/rss/search?q=${encodeURIComponent(kw[0])}&hl=en-IN`, type: "rss" }], keywords: kw.slice(0, 2), lookback_hours: 12 };
    case "research_analyst":
      return { question: `What changed this week around ${kw[0]} and why does it matter for our readers?`, max_sources: 8 };
    case "data_finder":
      return { question: `Find the latest official numbers for ${kw[0]} with their sources`, max_sources: 6 };
    case "contact_finder":
      return { sources: [html("https://www.example-directory.in/digital-agencies/mumbai")], extraction: "auto", extract_fields: [F("company", "Company"), F("email", "Public email"), F("phone", "Phone"), F("website", "Website", "url")] };
    case "product_price_scraper":
      return { sources: [html(`${shop}/category/smartphones`)], extraction: "auto", extract_fields: [F("product", "Product"), F("price", "Price", "currency"), F("mrp", "MRP", "currency"), F("discount", "Discount %", "number"), F("rating", "Rating", "number")], follow_links: true };
    case "job_collector":
      return { sources: [html("https://www.example-jobs.in/remote-developer-jobs")], extraction: "auto", extract_fields: [F("title", "Job title"), F("company", "Company"), F("location", "Location"), F("salary", "Salary"), F("posted", "Posted on", "date")] };
    case "event_finder":
      return { sources: [html("https://www.example-events.in/bengaluru/tech")], extraction: "auto", extract_fields: [F("name", "Event"), F("date", "Date", "date"), F("city", "City"), F("url", "Link", "url")], include_keywords: kw.slice(0, 1) };
    case "review_collector":
      return { sources: [html(`${shop}/product/redmi-note-14-pro/reviews`)], extraction: "auto", extract_fields: [F("author", "Reviewer"), F("rating", "Stars", "number"), F("text", "Review"), F("date", "Date", "date")] };
    case "document_reader":
      return { sources: [html(`${site.replace("example.com", "example-college.edu.in")}/docs/fees-2026.pdf`)], extract_fields: [F("tuition_fee", "Tuition fee", "currency"), F("hostel_fee", "Hostel fee", "currency"), F("last_date", "Last date to pay", "date")], max_pages: 50 };
    case "page_watcher":
      return { sources: [html(`${shop}/product/galaxy-a56-5g`), html("https://www.example-college.edu.in/admissions/notices")], watch_selector: ".price, #notices", ignore_text: ["Last updated"] };
    case "institution_researcher":
      return { source_mode: "scrape", dataset: ds, sources: [html("https://www.nirfindia.org/Rankings/2026/EngineeringRanking.html")], key_field: "name" };
    case "content_writer":
      return { persona: "You write for a smart, busy reader in our brand voice. Lead with the news, explain why it matters, keep every number and never invent quotes.", tone: "conversational", length: "medium" };
    case "summarizer":
      return { persona: "Summarise the item in plain words for someone with one minute: what happened, why it matters, what to do next.", tone: "friendly", length: "short" };
    case "translator":
      return { persona: "Translate the item into natural Hindi. Keep names, numbers, links and formatting exactly as they are.", tone: "friendly", length: "medium", language: "Hindi" };
    case "multiformat_creator":
      return { formats: ["article", "linkedin_post", "x_thread", "instagram_caption", "newsletter"] };
    case "social_caption_writer":
      return { formats: ["linkedin_post", "instagram_caption", "x_thread", "whatsapp_message"], max_hashtags: 3 };
    case "newsletter_builder":
      return { title: "This week in brief", sections: ["Top stories", "Numbers that mattered", "What to watch next week"] };
    case "report_builder":
      return { title: "Weekly report", sections: ["Summary", "Highlights", "Risks", "Next steps"] };
    case "faq_generator":
      return { prompt: "Write 5 frequently asked questions with short, factual answers about {title}, using only {text}.", output_fields: [F("faqs", "FAQs", "list")] };
    case "email_drafter":
      return { prompt: "Draft a short, friendly email to {data.company} introducing our services. Mention one thing from their website. Under 120 words.", output_fields: [F("subject", "Subject"), F("body", "Email body")] };
    case "lead_qualifier":
      return { prompt: "Score this lead from 0 to 100 for fit (company size, need, budget signals) and explain in one line.", output_fields: [F("score", "Score", "number"), F("reason", "Reason")] };
    case "custom_agent":
      return { prompt: "Summarise the item in three bullet points for a busy reader." };
    case "seo_optimizer":
      return { focus_keywords: seeds.slice(0, 2), site_name: ctx.domain ?? "" };
    case "seo_site_auditor":
      return { site_url: site, max_pages: 25 };
    case "broken_link_checker":
      return { site_url: site, max_pages: 100, checks: ["links"] };
    case "keyword_researcher":
      return { seed_keywords: seeds, country: "in", max_ideas: 150, group_by_intent: true };
    case "sentiment_tagger":
      return { ai_categorize: true, categories: ["Positive", "Neutral", "Negative"], category_field: "sentiment" };
    case "comparison_builder":
      return { match_field: "name", compare_fields: ["price", "rating", "delivery_days"], lower_is_better: ["price", "delivery_days"] };
    case "change_detector":
      return { dataset: ds || null, watch_fields: ["price", "rating"] };
    case "dataset_saver":
      return { source_mode: "pipeline_items", dataset: ds, key_field: ctx.datasets[0]?.key_field ?? "name" };
    case "auto_publisher":
      return { connections: pickConnections(ctx.connections, ["nextjs", "wordpress", "ghost", "linkedin", "telegram", "x", "webhook"]) };
    case "crm_sync":
      return { connections: pickConnections(ctx.connections, ["rest_api"]), method: "POST", path: "/leads" };
    case "sheets_sync":
      return { connections: pickConnections(ctx.connections, ["rest_api", "webhook"]), method: "POST", path: "/exec", body_template: '{ "title": "{title}", "url": "{url}", "date": "{published_at}" }' };
    case "alerts_sender":
      return { connections: pickConnections(ctx.connections, ["telegram", "slack", "discord", "email_smtp"]), mode: "digest" };
    case "comparison_assistant":
      return { dataset: ds, suggested_questions: ["Compare the top three", "Which is the best value?"] };
    case "support_assistant":
      return { dataset: ds, system_prompt: "You answer customer questions politely using only the help articles in the dataset. If you are not sure, say so and offer to connect a person.", suggested_questions: ["How do I reset my password?", "What is your refund policy?"] };
    default:
      break;
  }
  // fallback by engine
  switch (kind) {
    case "web_scraper":
      return { sources: [html(site)], extraction: "auto" };
    case "news_monitor":
      return { keywords: kw };
    case "dataset_builder":
    case "comparison_assistant":
    case "change_detector":
      return { dataset: ds || (kind === "change_detector" ? null : "") };
    case "link_collector":
      return { start_urls: [site] };
    case "keyword_researcher":
      return { seed_keywords: seeds };
    default:
      return {};
  }
}
