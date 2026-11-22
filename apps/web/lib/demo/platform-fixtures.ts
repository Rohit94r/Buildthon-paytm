// Seed data for the platform mock: workspaces, agents, pipelines, runs, content, datasets, connections and keys.
// Declarative: references ("$conn:x", "$ds:y") are resolved to ids by lib/demo/platform.ts when a workspace is seeded.
// All dates are relative to "now" so the demo always looks fresh.

import type { AgentKind, ApiScope, ConnectionKind, ContentFormat, ContentStatus, DatasetField, Module } from "@/lib/platform-types";

/* ------------------------------------------------------------------ */
/* Workspaces                                                          */
/* ------------------------------------------------------------------ */

export interface WorkspaceSeed {
  slug: string;
  name: string;
  industry: string;
  brand_color: string;
  domain: string | null;
  timezone: string;
  modules: Module[];
  blueprint: string | null;
  created_days_ago: number;
  /** Byline used in generated content. */
  persona: string;
  /** URL prefix for content on the client's site. */
  path_prefix: string;
}

export const WORKSPACE_SEEDS: WorkspaceSeed[] = [
  {
    slug: "marketpulse",
    name: "MarketPulse News",
    industry: "news_media",
    brand_color: "#0f766e",
    domain: "marketpulse.in",
    timezone: "Asia/Kolkata",
    modules: ["pipelines", "datasets", "assistant"],
    blueprint: "news_media_autopilot",
    created_days_ago: 142,
    persona: "Rohit Mehra, markets editor",
    path_prefix: "/markets",
  },
  {
    slug: "collegecompass",
    name: "CollegeCompass",
    industry: "education",
    brand_color: "#2563eb",
    domain: "collegecompass.in",
    timezone: "Asia/Kolkata",
    modules: ["pipelines", "datasets", "assistant"],
    blueprint: "college_portal",
    created_days_ago: 87,
    persona: "Ananya Rao, admissions counsellor",
    path_prefix: "/guides",
  },
  {
    slug: "hackfinder",
    name: "HackFinder",
    industry: "events",
    brand_color: "#c2410c",
    domain: "hackfinder.dev",
    timezone: "Asia/Kolkata",
    modules: ["pipelines", "datasets", "assistant"],
    blueprint: "hackathon_listings",
    created_days_ago: 23,
    persona: "HackFinder team",
    path_prefix: "/hackathons",
  },
  {
    slug: "livedesk",
    name: "LiveDesk",
    industry: "other",
    brand_color: "#0ea5e9",
    domain: "livedesk.example.com",
    timezone: "Asia/Kolkata",
    modules: ["pipelines", "datasets", "assistant"],
    blueprint: "livedesk_research",
    created_days_ago: 7,
    persona: "LiveDesk research team",
    path_prefix: "/research",
  },
  {
    slug: "ten",
    name: "The Executive Narrative",
    industry: "executive_media",
    brand_color: "#8a3b12",
    domain: "theexecutivenarrative.com",
    timezone: "Europe/London",
    modules: ["newsroom", "pipelines"],
    blueprint: "executive_newsroom",
    created_days_ago: 210,
    persona: "The Executive Narrative editors",
    path_prefix: "/leadership",
  },
];

/* ------------------------------------------------------------------ */
/* Dataset templates (fields + sample rows)                            */
/* ------------------------------------------------------------------ */

export interface DatasetTemplate {
  key: string;
  name: string;
  slug: string;
  description: string;
  key_field: string;
  public: boolean;
  fields: DatasetField[];
  /** All rows the mock knows about; seeds use the first `seed` rows, pipeline runs "discover" the rest. */
  rows: () => Record<string, unknown>[];
  source: (row: Record<string, unknown>) => string | null;
}

function localDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Whole days left in the current (local) month, 0 on the last day. */
function daysLeftInMonth(): number {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return last - now.getDate();
}

const COLLEGE_FIELDS: DatasetField[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "type", label: "Type", type: "text" },
  { key: "nirf_rank", label: "NIRF rank", type: "number", compare: true, higher_is_better: false },
  { key: "fees_total", label: "Total fees (4 yrs)", type: "currency", unit: "₹", compare: true, higher_is_better: false },
  { key: "avg_package", label: "Average package", type: "number", unit: "LPA", compare: true, higher_is_better: true },
  { key: "highest_package", label: "Highest package", type: "number", unit: "LPA", compare: true, higher_is_better: true },
  { key: "placement_rate", label: "Placement rate", type: "number", unit: "%", compare: true, higher_is_better: true },
  { key: "rating", label: "Student rating", type: "rating", compare: true, higher_is_better: true },
  { key: "courses", label: "Popular courses", type: "list" },
  { key: "entrance_exams", label: "Entrance exams", type: "list" },
  { key: "website", label: "Website", type: "url" },
];

const college = (
  name: string,
  city: string,
  state: string,
  type: string,
  nirf_rank: number,
  fees_total: number,
  avg_package: number,
  highest_package: number,
  placement_rate: number,
  rating: number,
  courses: string[],
  entrance_exams: string[],
  website: string,
) => ({ name, city, state, type, nirf_rank, fees_total, avg_package, highest_package, placement_rate, rating, courses, entrance_exams, website });

const HACKATHON_FIELDS: DatasetField[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "organizer", label: "Organizer", type: "text" },
  { key: "mode", label: "Mode", type: "text" },
  { key: "location", label: "Location", type: "text" },
  { key: "start_date", label: "Starts", type: "date" },
  { key: "end_date", label: "Ends", type: "date" },
  { key: "registration_deadline", label: "Registration deadline", type: "date", compare: true },
  { key: "prize_pool", label: "Prize pool", type: "currency", unit: "₹", compare: true, higher_is_better: true },
  { key: "themes", label: "Themes", type: "list" },
  { key: "theme_category", label: "Category", type: "text" },
  { key: "eligibility", label: "Eligibility", type: "text" },
  { key: "team_size", label: "Team size", type: "text", compare: true },
  { key: "url", label: "URL", type: "url" },
];

const IPO_FIELDS: DatasetField[] = [
  { key: "name", label: "Company", type: "text" },
  { key: "sector", label: "Sector", type: "text" },
  { key: "exchange", label: "Exchange", type: "text" },
  { key: "price_band", label: "Price band", type: "text" },
  { key: "issue_size", label: "Issue size", type: "currency", unit: "₹ Cr", compare: true, higher_is_better: true },
  { key: "open_date", label: "Opens", type: "date" },
  { key: "close_date", label: "Closes", type: "date", compare: true },
  { key: "subscription", label: "Subscription", type: "number", unit: "x", compare: true, higher_is_better: true },
  { key: "gmp", label: "Grey market premium", type: "number", unit: "₹", compare: true, higher_is_better: true },
  { key: "status", label: "Status", type: "text" },
];

const PRICE_FIELDS: DatasetField[] = [
  { key: "product", label: "Product", type: "text" },
  { key: "brand", label: "Brand", type: "text" },
  { key: "retailer", label: "Retailer", type: "text" },
  { key: "price", label: "Price", type: "currency", unit: "₹", compare: true, higher_is_better: false },
  { key: "mrp", label: "MRP", type: "currency", unit: "₹" },
  { key: "discount", label: "Discount", type: "number", unit: "%", compare: true, higher_is_better: true },
  { key: "rating", label: "Rating", type: "rating", compare: true, higher_is_better: true },
  { key: "in_stock", label: "In stock", type: "boolean" },
  { key: "url", label: "URL", type: "url" },
];

export const DATASET_TEMPLATES: Record<string, DatasetTemplate> = {
  colleges: {
    key: "colleges",
    name: "Engineering Colleges",
    slug: "colleges",
    description: "Top Indian engineering colleges with rankings, fees and placement outcomes. Sample data for demo purposes — figures are illustrative.",
    key_field: "name",
    public: true,
    fields: COLLEGE_FIELDS,
    rows: () => [
      college("IIT Bombay", "Mumbai", "Maharashtra", "IIT", 3, 900000, 23.5, 168, 88, 4.8, ["Computer Science", "Electrical", "Mechanical", "Chemical", "Aerospace", "Engineering Physics"], ["JEE Advanced"], "https://www.iitb.ac.in"),
      college("IIT Delhi", "New Delhi", "Delhi", "IIT", 2, 880000, 22.8, 145, 87, 4.8, ["Computer Science", "Electrical", "Mathematics & Computing", "Mechanical", "Textile"], ["JEE Advanced"], "https://home.iitd.ac.in"),
      college("BITS Pilani", "Pilani", "Rajasthan", "Deemed", 20, 2150000, 21.0, 60, 92, 4.6, ["Computer Science", "Electronics", "Mechanical", "Chemical", "Economics (dual)"], ["BITSAT"], "https://www.bits-pilani.ac.in"),
      college("NIT Trichy", "Tiruchirappalli", "Tamil Nadu", "NIT", 9, 640000, 12.6, 52, 90, 4.5, ["Computer Science", "ECE", "EEE", "Mechanical", "Production"], ["JEE Main"], "https://www.nitt.edu"),
      college("VIT Vellore", "Vellore", "Tamil Nadu", "Private", 11, 780000, 9.2, 75, 89, 4.2, ["Computer Science", "IT", "ECE", "Biotechnology", "Mechanical"], ["VITEEE"], "https://vit.ac.in"),
      college("IIIT Hyderabad", "Hyderabad", "Telangana", "IIIT", 47, 1600000, 30.4, 102, 96, 4.7, ["Computer Science", "ECE", "Computational Linguistics", "CS + Research (dual)"], ["JEE Main", "UGEE"], "https://www.iiit.ac.in"),
      college("COEP Technological University", "Pune", "Maharashtra", "State", 75, 380000, 8.6, 44, 85, 4.3, ["Computer Science", "Mechanical", "Civil", "Electrical", "Metallurgy"], ["MHT CET", "JEE Main"], "https://www.coep.org.in"),
      college("Manipal Institute of Technology", "Manipal", "Karnataka", "Private", 56, 1820000, 8.9, 54, 84, 4.1, ["Computer Science", "Data Science", "ECE", "Mechatronics", "Biomedical"], ["MET"], "https://manipal.edu/mit.html"),
      college("IIT Madras", "Chennai", "Tamil Nadu", "IIT", 1, 870000, 22.0, 131, 86, 4.8, ["Computer Science", "Electrical", "Data Science", "Ocean Engineering"], ["JEE Advanced"], "https://www.iitm.ac.in"),
      college("NIT Surathkal", "Mangaluru", "Karnataka", "NIT", 12, 620000, 13.0, 54, 89, 4.4, ["Computer Science", "IT", "ECE", "Mining"], ["JEE Main"], "https://www.nitk.ac.in"),
    ],
    source: (r) => (typeof r.website === "string" ? r.website : "https://www.nirfindia.org/Rankings/2026/EngineeringRanking.html"),
  },
  hackathons: {
    key: "hackathons",
    name: "Hackathons",
    slug: "hackathons",
    description: "Upcoming hackathons across India and online, refreshed twice a day. Fictional events for demo purposes.",
    key_field: "name",
    public: true,
    fields: HACKATHON_FIELDS,
    rows: () => {
      const left = daysLeftInMonth();
      const d1 = Math.round(left * 0.25);
      const d2 = Math.round(left * 0.6);
      const d3 = left;
      return [
        {
          name: "Bharat GenAI Sprint",
          organizer: "Bharat AI Collective",
          mode: "Online",
          location: "Online",
          start_date: localDate(d1 + 4),
          end_date: localDate(d1 + 6),
          registration_deadline: localDate(d1),
          prize_pool: 500000,
          themes: ["AI", "LLMs", "Indic languages"],
          theme_category: "AI/ML",
          eligibility: "Students and developers under 30 in India",
          team_size: "2–4",
          url: "https://bharatgenai.devfolio.co",
        },
        {
          name: "AgentVerse Buildathon",
          organizer: "Kairo Labs",
          mode: "Online",
          location: "Online",
          start_date: localDate(d2 + 3),
          end_date: localDate(d2 + 5),
          registration_deadline: localDate(d2),
          prize_pool: 300000,
          themes: ["AI", "Agents", "Automation"],
          theme_category: "AI/ML",
          eligibility: "Open to everyone",
          team_size: "1–3",
          url: "https://agentverse.kairolabs.dev",
        },
        {
          name: "SheBuilds Responsible AI Challenge",
          organizer: "WomenInTech India",
          mode: "Online",
          location: "Online",
          start_date: localDate(d3 + 5),
          end_date: localDate(d3 + 7),
          registration_deadline: localDate(d3),
          prize_pool: 150000,
          themes: ["AI", "Ethics", "Safety"],
          theme_category: "AI/ML",
          eligibility: "Every team must include at least one woman",
          team_size: "2–4",
          url: "https://shebuilds.in/responsible-ai",
        },
        {
          name: "ChainCraft Bengaluru",
          organizer: "Polygon Builders Guild",
          mode: "Offline",
          location: "Bengaluru, Karnataka",
          start_date: localDate(left + 16),
          end_date: localDate(left + 17),
          registration_deadline: localDate(left + 12),
          prize_pool: 800000,
          themes: ["Web3", "DeFi", "Zero-knowledge"],
          theme_category: "Web3",
          eligibility: "Open to all; travel support for 20 teams",
          team_size: "2–5",
          url: "https://chaincraft.events/blr",
        },
        {
          name: "GreenLedger Climate Hack",
          organizer: "Climate Collective Pune",
          mode: "Hybrid",
          location: "Pune, Maharashtra + online",
          start_date: localDate(left + 24),
          end_date: localDate(left + 26),
          registration_deadline: localDate(left + 20),
          prize_pool: 250000,
          themes: ["Climate", "FinTech", "Sustainability"],
          theme_category: "Climate",
          eligibility: "College students (UG/PG)",
          team_size: "2–4",
          url: "https://greenledger.climatecollective.in",
        },
        {
          name: "MedAI Hack Week",
          organizer: "HealthStack Foundation",
          mode: "Online",
          location: "Online",
          start_date: localDate(left + 12),
          end_date: localDate(left + 18),
          registration_deadline: localDate(left + 8),
          prize_pool: 200000,
          themes: ["HealthTech", "AI", "Diagnostics"],
          theme_category: "HealthTech",
          eligibility: "Students and healthcare professionals",
          team_size: "2–4",
          url: "https://medaihack.healthstack.org",
        },
        {
          name: "PaySprint FinTech Hackathon",
          organizer: "Mumbai FinTech Hub",
          mode: "Hybrid",
          location: "Mumbai, Maharashtra + online",
          start_date: localDate(left + 19),
          end_date: localDate(left + 20),
          registration_deadline: localDate(left + 15),
          prize_pool: 400000,
          themes: ["FinTech", "UPI", "Payments"],
          theme_category: "FinTech",
          eligibility: "Open to all",
          team_size: "2–4",
          url: "https://paysprint.mumbaifintechhub.in",
        },
      ];
    },
    source: (r) => (typeof r.url === "string" ? r.url : null),
  },
  ipos: {
    key: "ipos",
    name: "Upcoming IPOs",
    slug: "ipos",
    description: "Mainboard IPOs open or opening soon on NSE and BSE, with subscription and grey market premium. Fictional companies for demo purposes.",
    key_field: "name",
    public: true,
    fields: IPO_FIELDS,
    rows: () => [
      { name: "Avanti Green Energy", sector: "Renewable energy", exchange: "NSE, BSE", price_band: "₹312–328", issue_size: 1850, open_date: localDate(-4), close_date: localDate(-2), subscription: 38.2, gmp: 78, status: "Closed" },
      { name: "Kaveri Fintech", sector: "NBFC / lending", exchange: "NSE, BSE", price_band: "₹184–194", issue_size: 960, open_date: localDate(-1), close_date: localDate(1), subscription: 6.4, gmp: 22, status: "Open" },
      { name: "Northstar Logistics", sector: "Logistics", exchange: "NSE, BSE", price_band: "₹402–424", issue_size: 2400, open_date: localDate(3), close_date: localDate(5), subscription: null, gmp: 35, status: "Upcoming" },
      { name: "Sahyadri Hospitals", sector: "Healthcare", exchange: "NSE, BSE", price_band: "₹655–690", issue_size: 1320, open_date: localDate(6), close_date: localDate(8), subscription: null, gmp: 58, status: "Upcoming" },
      { name: "Lumen Semicon", sector: "Semiconductors", exchange: "NSE", price_band: "₹96–101", issue_size: 480, open_date: localDate(10), close_date: localDate(12), subscription: null, gmp: 19, status: "Upcoming" },
      { name: "Trident Agro Foods", sector: "FMCG", exchange: "NSE, BSE", price_band: "₹140–148", issue_size: 610, open_date: localDate(14), close_date: localDate(16), subscription: null, gmp: 9, status: "Upcoming" },
    ],
    source: () => "https://www.nseindia.com/market-data/all-upcoming-issues-ipo",
  },
  prices: {
    key: "prices",
    name: "Competitor prices",
    slug: "competitor-prices",
    description: "Prices scraped from competitor product pages, with discount against MRP.",
    key_field: "product",
    public: false,
    fields: PRICE_FIELDS,
    rows: () => [
      { product: "Nimbus Air Fryer 4.2L", brand: "Nimbus", retailer: "Amazon.in", price: 4299, mrp: 6999, discount: 39, rating: 4.3, in_stock: true, url: "https://www.amazon.in/dp/B0NIMBUS42" },
      { product: "Echo Buds Pro wireless earbuds", brand: "Echo", retailer: "Flipkart", price: 2499, mrp: 3999, discount: 38, rating: 4.1, in_stock: true, url: "https://www.flipkart.com/echo-buds-pro" },
      { product: "Volt 65W GaN charger", brand: "Volt", retailer: "Croma", price: 1899, mrp: 2499, discount: 24, rating: 4.5, in_stock: true, url: "https://www.croma.com/volt-65w-gan" },
      { product: "Aurora 55-inch 4K TV", brand: "Aurora", retailer: "Reliance Digital", price: 38990, mrp: 42990, discount: 9, rating: 4.0, in_stock: false, url: "https://www.reliancedigital.in/aurora-55-4k" },
    ],
    source: (r) => (typeof r.url === "string" ? r.url : null),
  },
  research_queue: {
    key: "research_queue",
    name: "Research Queue",
    slug: "research-queue",
    description: "Sample research questions answered with SerpApi signals and You.com citations.",
    key_field: "question",
    public: false,
    fields: [
      { key: "question", label: "Research question", type: "text" },
      { key: "topic", label: "Topic", type: "text", compare: true },
      { key: "priority", label: "Priority", type: "number", compare: true, higher_is_better: true },
      { key: "status", label: "Status", type: "text", compare: true },
      { key: "notes", label: "Notes", type: "text" },
    ],
    rows: () => [
      { question: "What changed in India's AI agent startup ecosystem this month?", topic: "Funding", priority: 5, status: "queued", notes: "Sample data: demo purposes" },
      { question: "SerpApi vs You.com for live research agents", topic: "Sponsors", priority: 4, status: "queued", notes: "Sample data: demo purposes" },
      { question: "Which agentic AI hackathons are open in India in 2026?", topic: "Events", priority: 3, status: "queued", notes: "Sample data: demo purposes" },
    ],
    source: () => null,
  },
};

/* ------------------------------------------------------------------ */
/* Per-workspace seeds                                                 */
/* ------------------------------------------------------------------ */

export interface AgentSeed {
  ref: string;
  name: string;
  kind: AgentKind;
  description: string;
  config: Record<string, unknown>;
  enabled?: boolean;
  created_days_ago: number;
}

export interface ConnectionSeed {
  ref: string;
  name: string;
  kind: ConnectionKind;
  config: Record<string, unknown>;
  secrets: string[];
  last_used_minutes_ago: number | null;
  last_error?: string | null;
  created_days_ago: number;
}

export interface DatasetSeed {
  ref: string;
  template: string;
  /** How many of the template rows exist at seed time. */
  seed: number;
  created_days_ago: number;
  updated_minutes_ago: number;
}

export interface PipelineSeed {
  ref: string;
  name: string;
  description: string;
  steps: string[];
  trigger: { type: "manual" | "schedule" | "webhook"; every_minutes?: number | null };
  require_approval: boolean;
  enabled?: boolean;
  created_days_ago: number;
}

export interface RunSeed {
  ref: string;
  pipeline: string;
  trigger: "manual" | "schedule" | "webhook";
  minutes_ago: number;
  /** items_out per step. */
  counts: number[];
  content: string[];
  /** Fail the given step with this error. */
  fail?: { step: number; error: string };
  /** Extra log lines appended to a step (by index). */
  notes?: Record<number, string[]>;
}

export interface ContentSeed {
  ref: string;
  topic: string;
  status: ContentStatus;
  pipeline: string | null;
  run: string | null;
  formats: ContentFormat[];
  minutes_ago: number;
  published_minutes_ago?: number;
  publications?: { connection: string; status: "published" | "failed" | "manual"; error?: string }[];
  quality: { score: number; flags: string[] };
  schema_type: string;
}

export interface ApiKeySeed {
  name: string;
  prefix: string;
  scopes: ApiScope[];
  last_used_minutes_ago: number | null;
  created_days_ago: number;
}

export interface EventSeed {
  minutes_ago: number;
  kind: "run" | "content" | "publish" | "dataset" | "agent" | "connection" | "error";
  message: string;
  status: "ok" | "warn" | "error" | "info";
}

export interface PlatformSeed {
  agents: AgentSeed[];
  connections: ConnectionSeed[];
  datasets: DatasetSeed[];
  pipelines: PipelineSeed[];
  runs: RunSeed[];
  content: ContentSeed[];
  api_keys: ApiKeySeed[];
  events: EventSeed[];
}

const ALL_SOCIAL: ContentFormat[] = ["article", "linkedin_post", "x_thread", "instagram_caption", "newsletter", "short_video_script"];

const MARKETPULSE: PlatformSeed = {
  connections: [
    {
      ref: "site",
      name: "marketpulse.in (Next.js)",
      kind: "nextjs",
      config: { site_url: "https://marketpulse.in", webhook_url: "https://marketpulse.in/api/layerflow", path_template: "/markets/{slug}" },
      secrets: ["webhook_secret"],
      last_used_minutes_ago: 1530,
      created_days_ago: 140,
    },
    { ref: "linkedin", name: "LinkedIn · Rohit Mehra", kind: "linkedin", config: { author_urn: "urn:li:person:8kR2xQ1mPa" }, secrets: ["access_token"], last_used_minutes_ago: 1530, created_days_ago: 138 },
    { ref: "telegram", name: "Telegram · @marketpulse_in", kind: "telegram", config: { chat_id: "@marketpulse_in" }, secrets: ["bot_token"], last_used_minutes_ago: 1530, created_days_ago: 120 },
    { ref: "x", name: "X · @MarketPulseIN", kind: "x", config: { handle: "@MarketPulseIN" }, secrets: [], last_used_minutes_ago: 1530, created_days_ago: 120 },
  ],
  datasets: [{ ref: "ipos", template: "ipos", seed: 5, created_days_ago: 60, updated_minutes_ago: 1560 }],
  agents: [
    {
      ref: "scraper",
      name: "Market News Scraper",
      kind: "news_monitor",
      description: "Pulls market-moving stories from Moneycontrol, ET Markets and LiveMint plus BSE/NSE corporate announcements.",
      config: {
        sources: [
          { url: "https://www.moneycontrol.com/rss/marketreports.xml", type: "rss" },
          { url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", type: "rss" },
          { url: "https://www.livemint.com/rss/markets", type: "rss" },
          { url: "https://www.nseindia.com/api/corporate-announcements?index=equities", type: "json" },
          { url: "https://www.bseindia.com/corporates/ann.html", type: "html" },
        ],
        keywords: ["Sensex", "Nifty", "RBI", "IPO", "FII", "rupee"],
        exclude_keywords: ["crypto", "horoscope"],
        languages: ["en", "hi"],
        lookback_hours: 6,
        max_items: 60,
      },
      created_days_ago: 140,
    },
    {
      ref: "rewriter",
      name: "Persona Rewriter",
      kind: "persona_rewriter",
      description: "Rewrites each story in Rohit Mehra's voice for retail investors.",
      config: {
        persona:
          "You are Rohit Mehra, markets editor at MarketPulse News. You write for retail investors who know the basics: lead with the number that moved, explain why in plain English, then add one line on what it means for their money. Never give buy/sell advice. Keep every figure from the source and attribute data to the exchange or regulator.",
        tone: "analytical",
        length: "medium",
        banned_phrases: ["multibagger", "sure-shot", "guaranteed returns", "to the moon"],
        model: "writer",
      },
      created_days_ago: 140,
    },
    {
      ref: "multi",
      name: "Multi-format Creator",
      kind: "multi_format",
      description: "Article, LinkedIn post, X thread, Instagram caption, newsletter and a 40-second video script per story.",
      config: {
        formats: ALL_SOCIAL,
        instructions: "LinkedIn: hook first, arrows for numbers, 3 hashtags.\nX: numbered thread, 5–7 tweets, numbers in every tweet.\nInstagram: 📈 emoji lead, 8 hashtags.\nVideo: 40 seconds, [HOOK]/[SCENE] cues.",
        hashtags: true,
        max_hashtags: 3,
        model: "writer",
      },
      created_days_ago: 140,
    },
    {
      ref: "seo",
      name: "SEO Optimizer",
      kind: "seo_optimizer",
      description: "NewsArticle JSON-LD, title tags and meta descriptions tuned for Google Discover.",
      config: { focus_keywords: ["sensex today", "nifty", "rbi policy", "ipo gmp"], site_name: "MarketPulse", schema_type: "NewsArticle", title_max: 60, meta_max: 155, model: "fast" },
      created_days_ago: 140,
    },
    {
      ref: "quality",
      name: "Quality Gate",
      kind: "quality_gate",
      description: "Checks every number against the source and drops duplicates of the last 24 hours.",
      config: {
        min_score: 75,
        checks: ["fact_grounding", "duplication", "length", "banned_phrases"],
        min_words: 220,
        banned_phrases: ["guaranteed returns", "multibagger"],
        on_fail: "drop",
        model: "fast",
      },
      created_days_ago: 140,
    },
    {
      ref: "publisher",
      name: "Auto Publisher",
      kind: "auto_publisher",
      description: "Publishes approved stories to marketpulse.in, LinkedIn and Telegram; prepares X threads for manual posting.",
      config: { connections: ["$conn:site", "$conn:linkedin", "$conn:telegram", "$conn:x"], formats: ["article", "linkedin_post", "x_thread"], publish_mode: "immediate" },
      created_days_ago: 138,
    },
    {
      ref: "ipo",
      name: "IPO Tracker",
      kind: "dataset_builder",
      description: "Scrapes NSE/BSE issue pages into the Upcoming IPOs dataset: price band, subscription and GMP.",
      config: {
        source_mode: "scrape",
        dataset: "$ds:ipos",
        sources: [
          { url: "https://www.nseindia.com/api/ipo-current-issue", type: "json" },
          { url: "https://www.bseindia.com/publicissue.html", type: "html" },
        ],
        extract_fields: [
          { key: "name", label: "Company", type: "text" },
          { key: "price_band", label: "Price band", type: "text" },
          { key: "issue_size", label: "Issue size (₹ Cr)", type: "currency" },
          { key: "subscription", label: "Subscription (x)", type: "number" },
          { key: "gmp", label: "GMP (₹)", type: "number", description: "From unofficial grey market quotes" },
        ],
        key_field: "name",
        max_records: 50,
        model: "fast",
      },
      created_days_ago: 60,
    },
  ],
  pipelines: [
    {
      ref: "mob",
      name: "Market Open Brief",
      description: "Hourly during market hours: scrape → rewrite in Rohit's voice → six formats → SEO → quality → publish after approval.",
      steps: ["scraper", "rewriter", "multi", "seo", "quality", "publisher"],
      trigger: { type: "schedule", every_minutes: 60 },
      require_approval: true,
      created_days_ago: 138,
    },
    {
      ref: "ipo_watch",
      name: "IPO Watch",
      description: "Triggered by the exchange-alert webhook: refresh the IPO dataset and publish a subscription update.",
      steps: ["ipo", "rewriter", "multi", "publisher"],
      trigger: { type: "webhook" },
      require_approval: false,
      created_days_ago: 58,
    },
  ],
  runs: [
    { ref: "r1", pipeline: "mob", trigger: "schedule", minutes_ago: 2640, counts: [44, 6, 6, 6, 1, 1], content: ["rbi"] },
    { ref: "r2", pipeline: "ipo_watch", trigger: "webhook", minutes_ago: 1800, counts: [5, 1, 1, 0], content: [], fail: { step: 3, error: "Telegram: chat not found (400)" } },
    { ref: "r3", pipeline: "ipo_watch", trigger: "webhook", minutes_ago: 1560, counts: [5, 1, 1, 1], content: ["avanti"] },
    {
      ref: "r4",
      pipeline: "mob",
      trigger: "schedule",
      minutes_ago: 540,
      counts: [39, 6, 6, 6, 1, 0],
      content: ["sensex"],
      notes: { 5: ["Holding 1 approved item for the 15:30 IST market-close slot"] },
    },
    { ref: "r5", pipeline: "mob", trigger: "schedule", minutes_ago: 180, counts: [31, 5, 5, 5, 0, 0], content: [], notes: { 4: ["All 5 items were duplicates of stories published in the last 24h"] } },
    { ref: "r6", pipeline: "mob", trigger: "schedule", minutes_ago: 38, counts: [46, 6, 6, 6, 1], content: ["fii"] },
  ],
  content: [
    {
      ref: "rbi",
      topic: "rbi_repo",
      status: "published",
      pipeline: "mob",
      run: "r1",
      formats: ALL_SOCIAL,
      minutes_ago: 2610,
      published_minutes_ago: 2575,
      publications: [
        { connection: "site", status: "published" },
        { connection: "linkedin", status: "published" },
        { connection: "telegram", status: "published" },
        { connection: "x", status: "manual" },
      ],
      quality: { score: 92, flags: [] },
      schema_type: "NewsArticle",
    },
    {
      ref: "avanti",
      topic: "avanti_ipo",
      status: "published",
      pipeline: "ipo_watch",
      run: "r3",
      formats: ALL_SOCIAL,
      minutes_ago: 1548,
      published_minutes_ago: 1546,
      publications: [
        { connection: "site", status: "published" },
        { connection: "linkedin", status: "published" },
        { connection: "telegram", status: "published" },
        { connection: "x", status: "manual" },
      ],
      quality: { score: 88, flags: ["GMP is an unofficial grey-market quote: labelled as such"] },
      schema_type: "NewsArticle",
    },
    { ref: "sensex", topic: "sensex_85k", status: "approved", pipeline: "mob", run: "r4", formats: ALL_SOCIAL, minutes_ago: 520, quality: { score: 94, flags: [] }, schema_type: "NewsArticle" },
    {
      ref: "fii",
      topic: "fii_rupee",
      status: "draft",
      pipeline: "mob",
      run: "r6",
      formats: ALL_SOCIAL,
      minutes_ago: 30,
      quality: { score: 81, flags: ["Forex reserve figure is from last week's RBI bulletin: confirm before publishing"] },
      schema_type: "NewsArticle",
    },
  ],
  api_keys: [
    { name: "marketpulse.in (Next.js)", prefix: "lf_pk_7c2e", scopes: ["content:read"], last_used_minutes_ago: 4, created_days_ago: 139 },
    { name: "Mobile app", prefix: "lf_pk_a91f", scopes: ["content:read", "datasets:read"], last_used_minutes_ago: 125, created_days_ago: 45 },
  ],
  events: [
    { minutes_ago: 1700, kind: "connection", message: "Telegram · @marketpulse_in reconnected: channel id corrected after the bot was re-added", status: "ok" },
    { minutes_ago: 3100, kind: "agent", message: "Quality Gate updated: minimum score 70 → 75", status: "info" },
  ],
};

const COLLEGECOMPASS: PlatformSeed = {
  connections: [
    {
      ref: "wp",
      name: "CollegeCompass blog (WordPress)",
      kind: "wordpress",
      config: { site_url: "https://blog.collegecompass.in", username: "cc-editorial", default_status: "publish", category: "Admissions" },
      secrets: ["application_password"],
      last_used_minutes_ago: 4300,
      created_days_ago: 85,
    },
    {
      ref: "site",
      name: "collegecompass.in (Next.js)",
      kind: "nextjs",
      config: { site_url: "https://collegecompass.in", webhook_url: "https://collegecompass.in/api/layerflow", path_template: "/guides/{slug}" },
      secrets: ["webhook_secret"],
      last_used_minutes_ago: 4300,
      created_days_ago: 80,
    },
  ],
  datasets: [{ ref: "colleges", template: "colleges", seed: 8, created_days_ago: 86, updated_minutes_ago: 296 }],
  agents: [
    {
      ref: "data_scraper",
      name: "College Data Scraper",
      kind: "dataset_builder",
      description: "Scrapes NIRF rankings and official college sites into the Engineering Colleges dataset.",
      config: {
        source_mode: "scrape",
        dataset: "$ds:colleges",
        sources: [
          { url: "https://www.nirfindia.org/Rankings/2026/EngineeringRanking.html", type: "html" },
          { url: "https://www.iitb.ac.in/en/about-iit-bombay", type: "html" },
          { url: "https://www.bits-pilani.ac.in/fee-structure", type: "html" },
          { url: "https://vit.ac.in/admissions/fee-structure", type: "html" },
        ],
        extract_fields: COLLEGE_FIELDS.map((f) => ({ key: f.key, label: f.label, type: f.type })),
        key_field: "name",
        max_records: 200,
        model: "fast",
      },
      created_days_ago: 86,
    },
    {
      ref: "updater",
      name: "Fee & Placement Updater",
      kind: "dataset_builder",
      description: "Reads each college's latest placement report and fee notice and updates those fields.",
      config: {
        source_mode: "scrape",
        dataset: "$ds:colleges",
        sources: [
          { url: "https://www.iitb.ac.in/placement-statistics", type: "html" },
          { url: "https://www.nitt.edu/home/students/placement/", type: "html" },
          { url: "https://manipal.edu/mit/placements.html", type: "html" },
        ],
        extract_fields: [
          { key: "fees_total", label: "Total fees (4 yrs)", type: "currency" },
          { key: "avg_package", label: "Average package (LPA)", type: "number" },
          { key: "highest_package", label: "Highest package (LPA)", type: "number" },
          { key: "placement_rate", label: "Placement rate (%)", type: "number" },
        ],
        key_field: "name",
        max_records: 200,
        model: "fast",
      },
      created_days_ago: 70,
    },
    {
      ref: "assistant",
      name: "College Comparison Assistant",
      kind: "comparison_assistant",
      description: "Answers students' “X vs Y” questions on collegecompass.in with a comparison table.",
      config: {
        dataset: "$ds:colleges",
        system_prompt:
          "You are CollegeCompass, a neutral admissions advisor. Answer only from the Engineering Colleges dataset, quote fees in ₹ lakh and packages in LPA, compare side by side, and end with a recommendation that depends on the student's priorities.",
        max_records: 4,
        suggested_questions: ["Compare IIT Bombay vs BITS Pilani on fees and placements", "Cheapest colleges with 85%+ placements", "Best colleges in Maharashtra"],
        model: "fast",
      },
      created_days_ago: 84,
    },
    {
      ref: "monitor",
      name: "Admissions News Monitor",
      kind: "news_monitor",
      description: "Watches NTA, JoSAA and IIT announcements for JEE and counselling news.",
      config: {
        sources: [
          { url: "https://nta.ac.in/rss", type: "rss" },
          { url: "https://josaa.nic.in/", type: "html" },
        ],
        keywords: ["JEE Main", "JEE Advanced", "JoSAA", "cutoff", "BITSAT", "VITEEE"],
        exclude_keywords: [],
        languages: ["en"],
        lookback_hours: 72,
        max_items: 30,
      },
      created_days_ago: 84,
    },
    {
      ref: "writer",
      name: "Admission Blog Writer",
      kind: "persona_rewriter",
      description: "Turns admission news and dataset numbers into counsellor-style guides.",
      config: {
        persona:
          "You are Ananya Rao, senior admissions counsellor at CollegeCompass. You write for Class 12 students and their parents: precise about ranks, dates and fees, explain jargon once, and end with a short checklist. Always say figures are from the CollegeCompass dataset.",
        tone: "friendly",
        length: "long",
        banned_phrases: ["dream college", "100% placement guaranteed"],
        model: "writer",
      },
      created_days_ago: 84,
    },
    {
      ref: "social",
      name: "Social Repurposer",
      kind: "multi_format",
      description: "Creates the blog post, a site article, a LinkedIn post and an Instagram caption from each guide.",
      config: { formats: ["article", "blog_post", "linkedin_post", "instagram_caption"], instructions: "Instagram: 🎓 lead, speak to students.\nLinkedIn: for parents and counsellors.", hashtags: true, max_hashtags: 3, model: "writer" },
      created_days_ago: 84,
    },
    {
      ref: "seo",
      name: "SEO Optimizer",
      kind: "seo_optimizer",
      description: "BlogPosting JSON-LD and meta tags for admission guides.",
      config: { focus_keywords: ["jee cutoff", "college comparison", "fees and placements"], site_name: "CollegeCompass", schema_type: "BlogPosting", title_max: 60, meta_max: 155, model: "fast" },
      created_days_ago: 84,
    },
    {
      ref: "publisher",
      name: "WordPress Publisher",
      kind: "auto_publisher",
      description: "Publishes approved guides to the WordPress blog and the Next.js site.",
      config: { connections: ["$conn:wp", "$conn:site"], formats: ["blog_post", "article"], publish_mode: "immediate" },
      created_days_ago: 84,
    },
  ],
  pipelines: [
    {
      ref: "refresh",
      name: "Weekly college data refresh",
      description: "Re-scrapes rankings, fees and placement figures for every college in the dataset.",
      steps: ["data_scraper", "updater"],
      trigger: { type: "schedule", every_minutes: 10080 },
      require_approval: false,
      created_days_ago: 85,
    },
    {
      ref: "blog",
      name: "Admission blog posts",
      description: "Admission news → counsellor-style guide → social formats → SEO → WordPress, after approval.",
      steps: ["monitor", "writer", "social", "seo", "publisher"],
      trigger: { type: "manual" },
      require_approval: true,
      created_days_ago: 84,
    },
  ],
  runs: [
    { ref: "c1", pipeline: "refresh", trigger: "schedule", minutes_ago: 8640, counts: [8, 8], content: [] },
    { ref: "c2", pipeline: "blog", trigger: "manual", minutes_ago: 4330, counts: [12, 1, 1, 1, 1], content: ["jee"] },
    { ref: "c3", pipeline: "refresh", trigger: "manual", minutes_ago: 300, counts: [8, 8], content: [] },
    { ref: "c4", pipeline: "blog", trigger: "manual", minutes_ago: 125, counts: [9, 1, 1, 1], content: ["bits"] },
  ],
  content: [
    {
      ref: "jee",
      topic: "jee_cutoffs",
      status: "published",
      pipeline: "blog",
      run: "c2",
      formats: ["article", "blog_post", "linkedin_post", "instagram_caption"],
      minutes_ago: 4310,
      published_minutes_ago: 4300,
      publications: [
        { connection: "wp", status: "published" },
        { connection: "site", status: "published" },
      ],
      quality: { score: 90, flags: [] },
      schema_type: "BlogPosting",
    },
    {
      ref: "bits",
      topic: "bits_vs_vit",
      status: "draft",
      pipeline: "blog",
      run: "c4",
      formats: ["article", "blog_post", "linkedin_post", "instagram_caption"],
      minutes_ago: 118,
      quality: { score: 84, flags: ["VIT fees vary by category: the post quotes category 1"] },
      schema_type: "BlogPosting",
    },
  ],
  api_keys: [
    { name: "Website comparison widget", prefix: "lf_pk_c0b4", scopes: ["datasets:read", "assistant:chat"], last_used_minutes_ago: 2, created_days_ago: 80 },
    { name: "WordPress plugin", prefix: "lf_pk_5d1e", scopes: ["content:read"], last_used_minutes_ago: 4300, created_days_ago: 84 },
  ],
  events: [{ minutes_ago: 1440, kind: "agent", message: "College Comparison Assistant answered 312 questions on collegecompass.in in the last 24h", status: "info" }],
};

const HACKFINDER: PlatformSeed = {
  connections: [
    {
      ref: "site",
      name: "hackfinder.dev (Next.js)",
      kind: "nextjs",
      config: { site_url: "https://hackfinder.dev", webhook_url: "https://hackfinder.dev/api/layerflow", path_template: "/hackathons/{slug}" },
      secrets: ["webhook_secret"],
      last_used_minutes_ago: 58,
      created_days_ago: 22,
    },
  ],
  datasets: [{ ref: "hackathons", template: "hackathons", seed: 5, created_days_ago: 22, updated_minutes_ago: 58 }],
  agents: [
    {
      ref: "scraper",
      name: "Hackathon Scraper",
      kind: "web_scraper",
      description: "Reads hackathon listing pages with AI extraction and follows each event's detail page.",
      config: {
        sources: [
          { url: "https://devfolio.co/hackathons", type: "html" },
          { url: "https://unstop.com/hackathons", type: "html" },
          { url: "https://mlh.io/seasons/2027/events", type: "html" },
          { url: "https://www.hackerearth.com/challenges/hackathon/", type: "html" },
        ],
        extraction: "auto",
        extract_fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "organizer", label: "Organizer", type: "text" },
          { key: "start_date", label: "Start date", type: "date" },
          { key: "end_date", label: "End date", type: "date" },
          { key: "registration_deadline", label: "Registration deadline", type: "date" },
          { key: "mode", label: "Mode", type: "text", description: "Online, Offline or Hybrid" },
          { key: "location", label: "Location", type: "text" },
          { key: "prize_pool", label: "Prize pool", type: "currency", description: "Total in ₹; convert USD at the day's rate" },
          { key: "themes", label: "Themes", type: "list" },
          { key: "eligibility", label: "Eligibility", type: "text" },
          { key: "url", label: "URL", type: "url" },
        ],
        max_items: 100,
        follow_links: true,
        include_keywords: [],
        model: "fast",
      },
      created_days_ago: 22,
    },
    {
      ref: "sorter",
      name: "Hackathon Sorter",
      kind: "data_transform",
      description: "Drops closed and duplicate events, sorts by registration deadline and tags a theme category.",
      config: {
        dedupe_by: ["url", "name"],
        filters: [{ field: "registration_deadline", op: "date_after_today" }],
        sort_by: "registration_deadline",
        sort_order: "asc",
        limit: 50,
        ai_categorize: true,
        categories: ["AI/ML", "Web3", "FinTech", "HealthTech", "Open Innovation", "Climate"],
        category_field: "theme_category",
      },
      created_days_ago: 22,
    },
    {
      ref: "rewriter",
      name: "Listing Rewriter",
      kind: "persona_rewriter",
      description: "Writes a consistent two-sentence blurb for every listing.",
      config: {
        persona: "You write crisp two-sentence hackathon blurbs for Indian students: what it is, who can join and what you can win. No hype words, always include the deadline.",
        tone: "punchy",
        length: "short",
        banned_phrases: ["epic", "insane", "once-in-a-lifetime"],
        model: "fast",
      },
      created_days_ago: 22,
    },
    {
      ref: "save",
      name: "Save to Hackathons",
      kind: "dataset_builder",
      description: "Upserts the sorted, rewritten events into the Hackathons dataset by name.",
      config: { source_mode: "pipeline_items", dataset: "$ds:hackathons", sources: [], extract_fields: [], key_field: "name", max_records: 200, model: "fast" },
      created_days_ago: 22,
    },
    {
      ref: "finder",
      name: "Hackathon Finder",
      kind: "comparison_assistant",
      description: "Answers “which AI hackathons close this week?” on hackfinder.dev.",
      config: {
        dataset: "$ds:hackathons",
        system_prompt: "You help students pick hackathons. Answer only from the Hackathons dataset, always mention registration deadlines, and compare prizes, mode and eligibility.",
        max_records: 4,
        suggested_questions: ["Which online AI hackathons close this month? Compare prizes", "Hackathons in Bengaluru", "Biggest prize pools"],
        model: "fast",
      },
      created_days_ago: 21,
    },
  ],
  pipelines: [
    {
      ref: "sweep",
      name: "Daily hackathon sweep",
      description: "Twice a day: scrape listing sites → drop closed/duplicates and sort by deadline → rewrite blurbs → save to the Hackathons dataset.",
      steps: ["scraper", "sorter", "rewriter", "save"],
      trigger: { type: "schedule", every_minutes: 720 },
      require_approval: false,
      created_days_ago: 22,
    },
  ],
  runs: [
    { ref: "h1", pipeline: "sweep", trigger: "schedule", minutes_ago: 780, counts: [39, 16, 16, 16], content: [] },
    { ref: "h2", pipeline: "sweep", trigger: "schedule", minutes_ago: 62, counts: [42, 18, 18, 18], content: [] },
  ],
  content: [],
  api_keys: [{ name: "hackfinder.dev frontend", prefix: "lf_pk_h4ck", scopes: ["datasets:read", "assistant:chat"], last_used_minutes_ago: 1, created_days_ago: 21 }],
  events: [{ minutes_ago: 20000, kind: "agent", message: "Hackathon Sorter created from the hackathon_listings blueprint", status: "info" }],
};

const TEN: PlatformSeed = {
  connections: [{ ref: "linkedin", name: "LinkedIn · The Executive Narrative", kind: "linkedin", config: { author_urn: "urn:li:organization:90314722" }, secrets: [], last_used_minutes_ago: null, created_days_ago: 30 }],
  datasets: [],
  agents: [
    {
      ref: "monitor",
      name: "News Monitor",
      kind: "news_monitor",
      description: "Tracks CEO appointments, boardroom moves and strategy stories from business wires.",
      config: {
        sources: [
          { url: "https://www.ft.com/companies?format=rss", type: "rss" },
          { url: "https://feeds.reuters.com/reuters/businessNews", type: "rss" },
        ],
        keywords: ["CEO", "chief executive", "board", "chair", "succession", "Chief AI Officer"],
        exclude_keywords: ["sport"],
        languages: ["en"],
        lookback_hours: 24,
        max_items: 30,
      },
      created_days_ago: 200,
    },
    {
      ref: "writer",
      name: "Executive Writer",
      kind: "persona_rewriter",
      description: "Drafts executive briefs in the publication's measured, senior voice.",
      config: {
        persona:
          "You are the executive editor of The Executive Narrative. You write for chairs, CEOs and their direct reports: lead with the decision, then the context, then what peers should take from it. British spelling, no hype, no unattributed claims.",
        tone: "authoritative",
        length: "medium",
        banned_phrases: ["game-changer", "synergy", "disrupt"],
        model: "writer",
      },
      created_days_ago: 200,
    },
  ],
  pipelines: [
    {
      ref: "brief",
      name: "Executive brief draft",
      description: "Leadership news → executive brief draft for the newsroom to research, edit and publish.",
      steps: ["monitor", "writer"],
      trigger: { type: "manual" },
      require_approval: false,
      created_days_ago: 200,
    },
  ],
  runs: [
    { ref: "t1", pipeline: "brief", trigger: "manual", minutes_ago: 1560, counts: [14, 1], content: ["cao"] },
    { ref: "t2", pipeline: "brief", trigger: "manual", minutes_ago: 240, counts: [3, 0], content: [], notes: { 1: ["No story cleared the newsworthiness bar since the last brief"] } },
  ],
  content: [
    {
      ref: "cao",
      topic: "chief_ai_officer",
      status: "draft",
      pipeline: "brief",
      run: "t1",
      formats: ["article", "linkedin_post", "newsletter"],
      minutes_ago: 1555,
      quality: { score: 86, flags: ["Share-of-companies estimate needs a named source"] },
      schema_type: "NewsArticle",
    },
  ],
  api_keys: [{ name: "theexecutivenarrative.com", prefix: "lf_pk_t3n0", scopes: ["content:read"], last_used_minutes_ago: 18, created_days_ago: 190 }],
  events: [{ minutes_ago: 43000, kind: "connection", message: "LinkedIn · The Executive Narrative added: access token still missing", status: "warn" }],
};

export const PLATFORM_SEEDS: Record<string, PlatformSeed> = {
  marketpulse: MARKETPULSE,
  collegecompass: COLLEGECOMPASS,
  hackfinder: HACKFINDER,
  ten: TEN,
};
