// Demo fixtures + content generators for the newsroom mock (lib/demo/newsroom.ts).
// Everything here is fictional: companies, deals and figures are invented for the demo workspace.

import { articleText, wordCount } from "@/lib/markdown";
import type {
  ArticleBody,
  Category,
  EditorReport,
  EvalCaseRow,
  KeyFact,
  Playbook,
  PromptVersionRow,
  QaReport,
  Readability,
  Region,
  ResearchPack,
  ResearchSource,
  Section,
  SeoPayload,
  Stats,
} from "@/lib/types";
import { slugify } from "./core";

/* ---------------- Playbooks (mirror apps/api/app/services/playbooks.py) ---------------- */

type PbSpec = [key: Category, label: string, route: string, purpose: string, min: number, max: number, sources: string, color: string, sections: [string, string, boolean?][]];

const PB_SPECS: PbSpec[] = [
  ["brief", "Brief", "/brief", "Short factual deal/investment/M&A news with executive relevance", 350, 550, "News + filings", "#9a3412", [
    ["lede", "Lede", false],
    ["what_happened", "What happened"],
    ["the_numbers", "The numbers"],
    ["why_it_matters", "Why it matters"],
    ["what_to_watch", "What to watch"],
  ]],
  ["thinking", "Thinking", "/thinking", "Leadership/strategy essay, mental models, trade-offs", 900, 1300, "Research + judgment", "#3f6212", [
    ["provocation", "The provocation"],
    ["the_tension", "The tension"],
    ["competing_views", "Two competing views"],
    ["what_leaders_miss", "What most leaders miss"],
    ["practical_implication", "The practical implication"],
  ]],
  ["room", "Room", "/room", "Scenario / decision-room narrative from supplied material", 1000, 1500, "Transcript/interview input only", "#6b21a8", [
    ["setting", "The setting"],
    ["the_decision", "The decision"],
    ["the_debate", "The debate"],
    ["turning_point", "The turning point"],
    ["what_it_reveals", "What it reveals"],
  ]],
  ["playbook", "Playbook", "/playbook", "Repeatable framework with execution steps", 1000, 1400, "Practitioner sources", "#0f766e", [
    ["problem", "The problem"],
    ["framework", "The framework"],
    ["steps", "The steps"],
    ["worked_example", "A worked example"],
    ["failure_modes", "Failure modes"],
    ["when_not_to_use", "When not to use it"],
  ]],
  ["decisions", "Decisions", "/descisions", "Decision question with options and trade-offs", 900, 1300, "Case evidence", "#1d4ed8", [
    ["the_question", "The question"],
    ["option_a", "Option A"],
    ["option_b", "Option B"],
    ["decision_criteria", "Decision criteria"],
    ["risks", "The risks"],
    ["who_fits", "Which option fits whom"],
  ]],
  ["deep_dive", "Deep Dive", "/deep_dive", "Company analysis: model, moat, numbers, risks", 1400, 2000, "Filings, IR, earnings calls", "#b45309", [
    ["snapshot", "Snapshot"],
    ["business_model", "The business model"],
    ["how_it_makes_money", "How it makes money"],
    ["strategic_moves", "Strategic moves"],
    ["the_numbers", "The numbers"],
    ["moat", "The moat"],
    ["risks", "The risks"],
    ["lessons", "Lessons for leaders"],
  ]],
];

export const PLAYBOOKS: Playbook[] = PB_SPECS.map(([key, label, route, purpose, min, max, primary_sources, color, sections]) => ({
  key,
  label,
  route,
  purpose,
  min_words: min,
  max_words: max,
  target_words: Math.floor((min + max) / 2),
  sections: sections.map(([k, heading, show]) => ({ key: k, heading, show_heading: show !== false })),
  primary_sources,
  color,
}));

export function playbook(category: string): Playbook {
  return PLAYBOOKS.find((p) => p.key === category) ?? PLAYBOOKS[0];
}

export const SEARCH_INTENT: Record<Category, string> = {
  brief: "informational",
  thinking: "informational",
  room: "informational",
  playbook: "informational",
  decisions: "decision",
  deep_dive: "informational",
};

/* ---------------- Article state machine (mirror apps/api/app/agents/state.py) ---------------- */

export const STAGE_ORDER = ["research", "write", "edit", "seo", "qa"] as const;
export const STAGE_STATE: Record<string, string> = { research: "researching", write: "drafting", edit: "editing", seo: "seo", qa: "qa" };
const TRANSITIONS: Record<string, string[]> = {
  queued: ["researching", "archived", "failed"],
  researching: ["drafting", "needs_sources", "failed", "queued"],
  drafting: ["editing", "failed", "researching"],
  editing: ["seo", "failed", "drafting"],
  seo: ["qa", "failed", "editing"],
  qa: ["in_review", "drafting", "editing", "seo", "needs_sources", "failed"],
  in_review: ["approved", "archived", "drafting", "editing", "seo", "qa", "researching"],
  approved: ["scheduled", "in_review", "drafting", "editing", "seo", "qa", "archived"],
  scheduled: ["publishing", "approved"],
  publishing: ["published", "failed", "scheduled", "approved"],
  published: ["in_review", "editing", "seo", "qa", "drafting", "publishing", "approved", "scheduled"],
  archived: ["queued", "in_review"],
  needs_sources: ["researching", "archived", "queued"],
  failed: ["queued", "researching", "drafting", "editing", "seo", "qa", "in_review", "archived", "approved"],
};

export function canTransition(from: string, to: string): boolean {
  return from === to || (TRANSITIONS[from] ?? []).includes(to);
}

export function runnableStages(state: string, busy: boolean): string[] {
  if (busy || state === "scheduled" || state === "publishing" || state === "archived") return [];
  return STAGE_ORDER.filter((s) => canTransition(state, STAGE_STATE[s]));
}

export const EDITABLE_STATES = new Set(["drafting", "editing", "seo", "qa", "in_review", "approved", "published", "failed", "needs_sources"]);

/* ---------------- Text helpers ---------------- */

export const SITE = "https://theexecutivenarrative.com";

function truncateWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).replace(/[,;:—-]\s*$/, "").trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Offline-safe share card (data: URI) used for og:image and LinkedIn previews. */
export function cardImage(title: string, kicker: string, color: string): string {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 34) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  const tspans = lines
    .slice(0, 4)
    .map((l, i) => `<tspan x="80" dy="${i === 0 ? 0 : 74}">${escapeHtml(l)}</tspan>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627" viewBox="0 0 1200 627"><rect width="1200" height="627" fill="#f6f3ec"/><rect width="16" height="627" fill="${color}"/><text x="80" y="120" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="700" letter-spacing="5" fill="${color}">${escapeHtml(kicker.toUpperCase())}</text><text x="80" y="230" font-family="Georgia,serif" font-size="60" font-weight="700" fill="#17191e">${tspans}</text><line x1="80" y1="540" x2="1120" y2="540" stroke="#cfc5b2" stroke-width="2"/><text x="80" y="585" font-family="Georgia,serif" font-size="30" font-weight="700" fill="#17191e">The Executive Narrative</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ---------------- Article composition ---------------- */

const OPENERS: Record<string, string> = {
  what_happened: "Here is what was actually decided, stripped of the launch language.",
  the_numbers: "The figures below come from the filing and the company's own statements.",
  why_it_matters: "The significance of {s} is less about its size than about who now has to respond.",
  what_to_watch: "Three signals will show whether {s} is on track.",
  provocation: "Most leadership teams are asking the wrong question about {s}.",
  the_tension: "The tension is simple to state and hard to resolve: speed and control pull in opposite directions.",
  competing_views: "There are two serious ways to read {s}, and both deserve a fair hearing.",
  what_leaders_miss: "What most leaders miss is that the constraint is rarely the technology; it is the operating model around it.",
  practical_implication: "The practical implication is a decision, not a sentiment.",
  setting: "The room was smaller than the stakes, as these rooms usually are.",
  the_decision: "The decision on the table was narrower than the headlines later suggested.",
  the_debate: "The debate split along familiar lines: the operators wanted time, the investors wanted proof.",
  turning_point: "The turning point came when someone asked what would happen if they did nothing.",
  what_it_reveals: "What the episode reveals is how much of strategy is sequencing.",
  problem: "The problem behind {s} is familiar to anyone who has run a planning cycle.",
  framework: "The framework has three parts, and the order matters.",
  steps: "The steps below are designed to run inside a single quarter.",
  worked_example: "A worked example makes the trade-offs concrete.",
  failure_modes: "Most failures come from skipping the unglamorous middle steps.",
  when_not_to_use: "This approach is the wrong tool when speed matters more than resilience.",
  the_question: "Should your organisation act on {s} now, or wait for clearer evidence?",
  option_a: "Option A is to move now and accept the execution risk in exchange for better terms.",
  option_b: "Option B is to wait, preserve cash and let others absorb the early mistakes.",
  decision_criteria: "Four criteria separate the two options in practice.",
  risks: "The risks are real, and they are not evenly distributed.",
  who_fits: "Which option fits depends less on ambition than on balance-sheet room and execution depth.",
  snapshot: "In one paragraph: a credible plan, a demanding timeline and limited room for error.",
  business_model: "The business model is simpler than the investor presentation makes it look.",
  how_it_makes_money: "Revenue depends on utilisation, and utilisation depends on a small number of anchor customers.",
  strategic_moves: "The strategic moves of the last two years point in one direction.",
  moat: "The moat, such as it is, comes from qualification time rather than technology.",
  lessons: "The lessons for leaders outside the sector are more transferable than they look.",
};

const BANK = [
  "The announcement is a claim, not yet a result; the number to track is deployed capital, not committed capital.",
  "Most of the first-order story is already in the headline. The value for a senior reader sits one or two steps further out.",
  "Competitors now have to decide whether to match the move, partner around it or wait for the execution risk to show.",
  "Suppliers and partners will read this as a signal about where budgets are heading over the next two planning cycles.",
  "The timing matters as much as the size: decisions made in the next two quarters will set terms for several years.",
  "Boards will ask the obvious question first, about margins, and the less obvious one second: what does this lock us into?",
  "There is a credible case against the move. Execution risk is high, and similar bets have taken longer and cost more than planned.",
  "The strongest version of the opposing view is that the market is pricing a best case that rarely arrives on schedule.",
  "The likely consequence is a re-pricing of risk across the sector rather than a single winner.",
  "Capital allocators should treat the plan as an option, not a commitment, until the first milestones are met.",
  "Operators closest to the change will see it first in procurement terms, lead times and contract lengths.",
  "Regulators have so far signalled support, but that support is conditional on local jobs and visible delivery.",
  "This suggests the bargaining position of buyers improves, at least until new capacity is fully booked.",
  "For leaders, the useful question is not whether the trend is real but how exposed their own plan is to it.",
  "The second-order effect is on talent: scarce specialists will follow the capital, and wage pressure will follow them.",
  "None of this is guaranteed. Announced timelines in capital-heavy projects slip more often than they hold.",
  "The trade-off is speed against control, and different companies will rationally land in different places.",
  "Teams that move early will shape the terms; teams that wait will accept them.",
  "Investors have rewarded the narrative so far, which raises the bar for the first set of hard numbers.",
  "The quieter signal is in what management did not say: there was no guidance on returns or payback period.",
  "A practical test is to ask which assumption in your current plan would break if this succeeds, and which if it fails.",
  "The cost of being wrong is asymmetric. Waiting a quarter is cheap; locking in a multi-year contract on stale assumptions is not.",
  "Mid-sized players face the hardest choice, with neither the scale to lead nor the flexibility to ignore it.",
  "Expect the next round of announcements to come from customers, not from the company itself.",
  "The evidence so far supports the direction of travel, but not yet the pace that the headlines imply.",
  "Executives should separate what is known, the commitment and the timeline, from what is still a forecast.",
  "Comparable programmes have often delivered late, which is a useful base rate for anyone planning around this one.",
  "The decision for most leadership teams is not whether to react but how much optionality to buy, and at what price.",
  "That makes this a governance question as much as a strategy one, and it belongs on the next board agenda.",
  "In practice, the first visible change will be in contract terms: longer commitments, more prepayment and fewer exit clauses.",
  "The risk most leaders miss is concentration: the same few suppliers sit behind most of their competitors as well.",
  "A measured response, such as a pilot, a second source and a fixed review date, keeps the option open without overcommitting.",
  "Finance teams will want the downside case modelled before anyone signs, and they will be right to ask.",
  "The organisations best placed here are the ones that already know their own unit economics in detail.",
  "Customers rarely punish caution, but they do notice when a supplier cannot explain its plan.",
  "Where this goes next depends on execution in the unglamorous middle of the programme, not on the launch.",
  "Leaders who treat this as an IT or procurement topic alone will miss the strategic part of the decision.",
  "Every serious response starts with a clear owner, a budget ceiling and a date by which the bet is reviewed.",
  "The headline will fade quickly; the contracts and commitments it triggers will not.",
  "Seen from the boardroom, the question is less about this company and more about the industry structure it implies.",
];

const BULLETS: Record<string, string[]> = {
  what_to_watch: ["Named anchor customers before the next reporting date", "Regulatory approvals and their conditions", "The first hard numbers on cost and delivery against plan"],
  steps: ["Map the exposure: list the decisions that depend on the assumption", "Assign one owner and a budget ceiling", "Run a contained pilot with a fixed review date", "Scale, pause or stop on the evidence, not the narrative"],
  decision_criteria: ["Balance-sheet room to absorb a delay", "Depth of in-house execution talent", "Cost of switching later", "How exposed customers are to the outcome"],
  risks: ["Timelines slip and the cost of capital rises meanwhile", "A competitor secures the scarce capacity first", "The regulatory position changes after commitments are signed"],
};

export interface ComposeSpec {
  title: string;
  dek: string;
  category: Category;
  subject: string;
  facts: string[];
  takeaway?: string;
  /** Hand-written sections by key; missing keys are generated. */
  sections?: Record<string, Partial<Section>>;
  seed?: number;
}

export function composeBody(spec: ComposeSpec): ArticleBody {
  const pb = playbook(spec.category);
  const fill = (s: string) => s.replace(/\{s\}/g, spec.subject);
  let cursor = (spec.seed ?? 0) % BANK.length;
  const next = () => fill(BANK[cursor++ % BANK.length]);
  const perSection = spec.category === "brief" ? 1 : spec.category === "deep_dive" ? 2 : 3;
  const facts = [...spec.facts];
  const sections: Section[] = pb.sections.map((ps, i) => {
    const hand = spec.sections?.[ps.key];
    if (hand?.paragraphs?.length) {
      return { key: ps.key, heading: hand.heading ?? ps.heading, paragraphs: hand.paragraphs, bullets: hand.bullets ?? [], pull_quote: hand.pull_quote ?? null, facts_used: hand.facts_used ?? [] };
    }
    const paragraphs: string[] = [];
    const used: number[] = [];
    for (let p = 0; p < perSection; p++) {
      const parts: string[] = [];
      if (p === 0 && ps.key !== "lede" && OPENERS[ps.key]) parts.push(fill(OPENERS[ps.key]));
      if (p === 0 && facts.length) {
        parts.push(facts.shift() as string);
        used.push(spec.facts.length - facts.length);
      }
      while (parts.length < (spec.category === "brief" ? 3 : 4)) parts.push(next());
      paragraphs.push(parts.join(" "));
    }
    const bullets = ps.key === "the_numbers" ? spec.facts.filter((f) => /\d/.test(f)).slice(0, 4) : spec.category !== "brief" || ps.key === "what_to_watch" ? (BULLETS[ps.key] ?? []) : [];
    return { key: ps.key, heading: ps.heading, paragraphs, bullets, pull_quote: i === 2 && spec.category !== "brief" ? fill(BANK[(cursor + 7) % BANK.length]) : null, facts_used: used };
  });
  const body: ArticleBody = {
    title: spec.title,
    dek: spec.dek,
    category: spec.category,
    sections,
    takeaway: spec.takeaway ?? "Treat the move as a signal to test your own plan: name the assumption it threatens, give it an owner, and set a date to decide.",
    sources_used: [],
  };
  body.word_count = wordCount(articleText({ ...body, title: "", dek: "" }));
  return body;
}

/** A plausibly "unedited" earlier draft: one throat-clearing sentence added per section and a wordier dek. */
export function roughDraft(body: ArticleBody): ArticleBody {
  const draft: ArticleBody = JSON.parse(JSON.stringify(body));
  draft.dek = `${draft.dek.replace(/\.$/, "")}, and the implications are significant for leaders.`;
  const filler = [
    "This is a development that leaders across the industry will want to pay close attention to.",
    "There are several important factors to consider here.",
    "It remains to be seen how this will play out over time.",
  ];
  draft.sections.forEach((s, i) => {
    if (s.paragraphs.length && i < filler.length) s.paragraphs[0] = `${s.paragraphs[0]} ${filler[i]}`;
  });
  draft.word_count = wordCount(articleText({ ...draft, title: "", dek: "" }));
  return draft;
}

export function computeStats(body: ArticleBody, seed = 0): Stats {
  const pb = playbook(body.category);
  const text = articleText({ ...body, title: "", dek: "" });
  const words = wordCount(text);
  const sentences = Math.max(1, (text.match(/[.!?](\s|$)/g) ?? []).length);
  const readability: Readability = {
    flesch: Math.round((49 + (seed % 9) * 1.3) * 10) / 10,
    grade: Math.round((11.4 - (seed % 5) * 0.3) * 10) / 10,
    avg_sentence_len: Math.round((words / sentences) * 10) / 10,
    max_sentence_len: 31 + (seed % 4),
    sentences,
    words,
  };
  const keys = body.sections.map((s) => s.key);
  const band_min = Math.floor(pb.min_words * 0.85);
  const band_max = Math.floor(pb.max_words * 1.15);
  return {
    word_count: words,
    target_min: pb.min_words,
    target_max: pb.max_words,
    band_min,
    band_max,
    in_band: words >= band_min && words <= band_max,
    readability,
    banned_hits: [],
    sections_present: pb.sections.filter((s) => keys.includes(s.key)).map((s) => s.key),
    sections_missing: pb.sections.filter((s) => !keys.includes(s.key)).map((s) => s.key),
  };
}

export function makeEditor(body: ArticleBody): EditorReport {
  const pb = playbook(body.category);
  return {
    change_log: [
      "Cut a throat-clearing sentence from the opening of three sections",
      "Tightened the dek to one clause carrying the stake",
      "Split a 38-word sentence in “Why it matters” into two",
      "Replaced passive constructions with named actors",
      "Moved the strongest number into the first paragraph",
    ],
    format_report: {
      violations: [],
      warnings: [{ code: "long_sentence", message: "One sentence is above 30 words; acceptable once per article." }],
      h1_count: 1,
      sections: body.sections.length,
      required_sections: pb.sections.length,
      missing_sections: [],
      structural_ok: true,
      new_numbers: [],
      model_sections_rejected: 0,
    },
  };
}

export function makeQa(body: ArticleBody, stats: Stats, overall: number, createdAt: string): QaReport {
  const pb = playbook(body.category);
  const s = (n: number) => Math.max(2, Math.min(5, n));
  const base = overall >= 85 ? 5 : overall >= 75 ? 4 : 3;
  return {
    verdict: overall >= 70 ? "pass" : "revise",
    block_reason: null,
    scores: {
      factuality: s(base),
      structure: s(stats.sections_missing.length ? 3 : 5),
      executive_value: s(base - (overall % 2)),
      originality: s(base - 1),
      voice: s(base),
      readability: s(stats.readability.flesch >= 45 ? 4 : 3),
    },
    overall,
    gates: [
      { gate: "grounding", passed: true, blocking: true, detail: "Every claim maps to a key fact in the research pack." },
      { gate: "numbers_verified", passed: true, blocking: true, detail: "All figures appear verbatim in their sources." },
      { gate: "sections_complete", passed: stats.sections_missing.length === 0, blocking: true, detail: `${stats.sections_present.length}/${pb.sections.length} required sections present.` },
      { gate: "length", passed: stats.in_band, blocking: false, detail: `${stats.word_count} words; band ${stats.band_min}–${stats.band_max}.` },
      { gate: "banned_phrases", passed: true, blocking: true, detail: "0 banned phrases found." },
      { gate: "readability", passed: stats.readability.flesch >= 45, blocking: false, detail: `Flesch ${stats.readability.flesch}, average sentence ${stats.readability.avg_sentence_len} words.` },
      { gate: "duplication", passed: true, blocking: true, detail: "Max overlap with any source 3.1% (limit 8%)." },
    ],
    issues: [
      { severity: "minor", code: "hedge", message: "One inference is not marked as inference.", location: body.sections[2]?.heading ?? "body" },
      { severity: "minor", code: "repetition", message: "“Timeline” appears four times in two paragraphs.", location: body.sections[1]?.heading ?? "body" },
    ],
    exec_questions_answered: ["what_changed", "why_now", "so_what", "what_next"],
    exec_questions: {
      what_changed: "The commitment and its timeline are stated in the opening paragraph.",
      why_now: "The decision window is the next two quarters.",
      so_what: "Buyers gain leverage; incumbents face pricing pressure.",
      what_next: "Three named signals to watch.",
    },
    summary: "Grounded, well-structured and decision-oriented. Two minor style notes; nothing blocks review.",
    revise_stage: null,
    revision_instruction: null,
    rubric_source: "model",
    created_at: createdAt,
  };
}

/** Title tag: the H1 shortened at a word boundary plus the category, so it always differs from the H1 and stays ≤ 60. */
export function seoTitle(title: string, category: Category): string {
  const suffix = ` — ${playbook(category).label}`;
  return `${truncateWords(title.replace(/[.?!]$/, ""), 60 - suffix.length)}${suffix}`;
}

export function makeSeo(body: ArticleBody, opts: { keyword: string; secondary: string[]; slug?: string; sources: ResearchSource[]; generatedAt: string; overrides?: Partial<SeoPayload> }): SeoPayload {
  const pb = playbook(body.category);
  const slug = opts.overrides?.slug ?? opts.slug ?? slugify(body.title.split(/\s+/).slice(0, 7).join(" "));
  const canonical = `${SITE}${pb.route}/${slug}`;
  let meta = body.dek;
  if (meta.length < 140) meta = `${meta.replace(/\.$/, "")}. Analysis and what to watch for senior leaders.`;
  meta = truncateWords(meta, 156);
  if (!/[.!?]$/.test(meta)) meta += ".";
  const title_tag = opts.overrides?.title_tag ?? seoTitle(body.title, body.category);
  const h1 = opts.overrides?.h1 ?? body.title;
  const description = opts.overrides?.meta_description ?? meta;
  const image = cardImage(body.title, pb.label, pb.color);
  const issues: SeoPayload["issues"] = [];
  if (title_tag.length > 60) issues.push({ field: "title_tag", severity: "major", message: `Title tag is ${title_tag.length} characters (max 60).` });
  if (description.length < 140 || description.length > 158) issues.push({ field: "meta_description", severity: "minor", message: `Meta description is ${description.length} characters (target 140–158).` });
  return {
    title_tag,
    meta_description: description,
    slug,
    canonical_url: canonical,
    h1,
    primary_keyword: opts.overrides?.primary_keyword ?? opts.keyword,
    secondary_keywords: opts.secondary,
    keyword_candidates: [opts.keyword, ...opts.secondary, `${opts.keyword} analysis`],
    autosuggest: [`${opts.keyword} 2027`, `${opts.keyword} impact`, `${opts.keyword} india`],
    search_intent: SEARCH_INTENT[body.category],
    internal_links: [
      { url: `${SITE}/brief/why-capex-cycles-outlast-their-ceos`, title: "Why capex cycles outlast their CEOs", anchor: "capex cycles outlast their CEOs", similarity: 0.46, valid: true, status_code: 200 },
      { url: `${SITE}/deep_dive/the-economics-of-second-sourcing`, title: "The economics of second-sourcing", anchor: "the economics of second-sourcing", similarity: 0.41, valid: true, status_code: 200 },
      { url: `${SITE}/thinking/optionality-is-a-budget-line`, title: "Optionality is a budget line", anchor: "optionality is a budget line", similarity: 0.37, valid: true, status_code: 200 },
    ],
    external_links: opts.sources.filter((s) => s.url.startsWith("http")).map((s) => ({ url: s.url, title: s.title, publisher: s.publisher })),
    og: { title: h1, description, url: canonical, type: "article", site_name: "The Executive Narrative", image },
    twitter: { card: "summary_large_image", title: title_tag, description, image },
    json_ld: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: h1,
        description,
        mainEntityOfPage: canonical,
        articleSection: pb.label,
        author: { "@type": "Organization", name: "The Executive Narrative Editorial" },
        publisher: { "@type": "Organization", name: "The Executive Narrative", url: SITE },
        keywords: [opts.keyword, ...opts.secondary].join(", "),
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE },
          { "@type": "ListItem", position: 2, name: pb.label, item: `${SITE}${pb.route}` },
          { "@type": "ListItem", position: 3, name: h1, item: canonical },
        ],
      },
    ],
    generated_at: opts.generatedAt,
    overrides: [],
    inventory_size: 184,
    issues,
    score: issues.length ? 84 : 94,
    fields_complete: issues.length ? 13 : 15,
    fields_total: 15,
  };
}

export function makePack(opts: { id: string; summary: string; facts: string[]; sources: { url: string; title: string; publisher: string; published_at: string | null }[]; createdAt: string; insufficient?: string }): ResearchPack {
  const sources: ResearchSource[] = opts.sources.map((s, i) => ({
    index: i + 1,
    url: s.url,
    title: s.title,
    publisher: s.publisher,
    published_at: s.published_at,
    fetched_at: opts.createdAt,
    word_count: 640 + ((i * 337) % 900),
    injection_flags: [],
    origin: i === 0 ? "feed" : "search",
  }));
  const key_facts: KeyFact[] = opts.facts.map((claim, i) => {
    const src = sources[i % Math.max(1, sources.length)];
    return {
      id: i + 1,
      claim,
      source_index: src?.index ?? 1,
      source_url: src?.url ?? "",
      source_name: src?.publisher ?? null,
      published_at: src?.published_at ?? null,
      confidence: i === opts.facts.length - 1 && i > 2 ? "medium" : "high",
    };
  });
  const numbers = key_facts
    .map((f) => ({ f, m: f.claim.match(/(\$?[\d,.]+\s?(?:bn|m|%|GW|bn)?)/) }))
    .filter((x) => x.m && /\d/.test(x.m[1]))
    .slice(0, 4)
    .map(({ f, m }) => ({ value: (m as RegExpMatchArray)[1].trim(), unit: "", context: f.claim, source_index: f.source_index, source_url: f.source_url, verified: true }));
  const publishers = new Set(sources.map((s) => s.publisher));
  const status = opts.insufficient ? "insufficient_evidence" : "ok";
  return {
    id: opts.id,
    status,
    source_count: sources.length,
    created_at: opts.createdAt,
    payload: {
      summary: opts.summary,
      key_facts,
      numbers,
      context: "Background drawn from the sources listed; the writer may not add facts beyond this pack.",
      counterpoints: opts.insufficient ? [] : ["Announced timelines in comparable projects have slipped", "Part of the funding depends on approvals that are not yet final"],
      open_questions: ["Which customers have signed binding commitments?", "What is the payback assumption behind the plan?"],
      sources,
      skipped: [{ url: "https://www.paywalled-business.example/article/221", reason: "Paywall: no readable body" }],
      coverage: { source_count: sources.length, independent_publishers: publishers.size, has_primary_source: sources.some((s) => /sec\.gov|filing|ir\./i.test(s.url) || /filing/i.test(s.title ?? "")) },
      warnings: opts.insufficient ? [opts.insufficient] : [],
      status,
      reason: opts.insufficient,
    },
  };
}

/* ---------------- Rendered page (preview + dry run) ---------------- */

export function renderArticleHtml(body: ArticleBody | undefined, opts: { seo?: SeoPayload | null; tenantName?: string; label?: string }): string {
  const pb = playbook(body?.category ?? "brief");
  const brand = opts.tenantName ?? "The Executive Narrative";
  if (!body) return `<!doctype html><html><body style="font-family:Georgia,serif;padding:48px;color:#555">No draft yet.</body></html>`;
  const hidden = new Set(pb.sections.filter((s) => !s.show_heading).map((s) => s.key));
  const sections = body.sections
    .map((s) => {
      const h = hidden.has(s.key) ? "" : `<h2>${escapeHtml(s.heading)}</h2>`;
      const ps = s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
      const ul = s.bullets?.length ? `<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : "";
      const q = s.pull_quote ? `<blockquote>${escapeHtml(s.pull_quote)}</blockquote>` : "";
      return `<section>${h}${ps}${ul}${q}</section>`;
    })
    .join("");
  const seo = opts.seo;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(seo?.title_tag ?? body.title)}</title>${seo ? `<meta name="description" content="${escapeHtml(seo.meta_description)}"><link rel="canonical" href="${escapeHtml(seo.canonical_url)}">` : ""}<style>
body{margin:0;background:#fbfaf7;color:#17191e;font-family:Georgia,'Times New Roman',serif}
header.site{border-bottom:1px solid #e4ddcf;padding:18px 32px;font:700 15px/1 Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}
main{max-width:680px;margin:0 auto;padding:40px 24px 80px}
.kicker{font:700 12px/1 Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:${pb.color}}
h1{font-size:38px;line-height:1.15;margin:12px 0 12px}
.dek{font-size:20px;line-height:1.45;color:#4a4d55;margin:0 0 28px}
h2{font-size:22px;margin:34px 0 10px}
p{font-size:18px;line-height:1.65;margin:0 0 16px}
ul{font-size:17px;line-height:1.6;padding-left:22px}
blockquote{border-left:3px solid ${pb.color};margin:24px 0;padding:4px 0 4px 18px;font-size:22px;font-style:italic;color:#2d3038}
.takeaway{margin-top:36px;border-top:1px solid #e4ddcf;padding-top:18px}
.takeaway b{font:700 12px/1 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:${pb.color};display:block;margin-bottom:8px}
footer{font:12px Helvetica,Arial,sans-serif;color:#7b7f88;text-align:center;padding:24px}
</style></head><body><header class="site">${escapeHtml(brand)}</header><main><div class="kicker">${escapeHtml(opts.label ?? pb.label)}</div><h1>${escapeHtml(seo?.h1 ?? body.title)}</h1><p class="dek">${escapeHtml(body.dek)}</p>${sections}<div class="takeaway"><b>The takeaway</b><p>${escapeHtml(body.takeaway)}</p></div></main><footer>${escapeHtml(brand)} · Powered by LayerFlow</footer></body></html>`;
}

/* ---------------- Seed specs: sources, feed, articles ---------------- */

export interface SourceSpec {
  key: string;
  kind: "rss" | "gdelt" | "edgar" | "ir" | "hn" | "reddit" | "manual";
  name: string;
  url: string;
  weight: number;
  region: Region | null;
  group: string;
  tier: string;
  active: boolean;
  items_7d: number;
  error?: string;
  failures?: number;
}

export const SOURCE_SPECS: SourceSpec[] = [
  { key: "gmw", kind: "rss", name: "Global Markets Wire", url: "https://feeds.globalmarketswire.example/business.xml", weight: 1.3, region: "global", group: "global_business", tier: "primary_daily", active: true, items_7d: 214 },
  { key: "ibd", kind: "rss", name: "India Business Daily — Companies", url: "https://www.indiabusinessdaily.example/rss/companies.xml", weight: 1.2, region: "india", group: "india_business", tier: "regional", active: true, items_7d: 168 },
  { key: "edgar", kind: "edgar", name: "SEC EDGAR — 8-K current filings", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&output=atom", weight: 1.5, region: "us", group: "primary_sources", tier: "validation", active: true, items_7d: 96 },
  { key: "gdelt", kind: "gdelt", name: "GDELT — leadership & deals", url: "https://api.gdeltproject.org/api/v2/doc/doc?query=(acquisition%20OR%20%22chief%20executive%22)&mode=artlist&format=json", weight: 0.8, region: "global", group: "signals", tier: "specialist", active: true, items_7d: 302 },
  { key: "aij", kind: "rss", name: "Asia Industry Journal", url: "https://asiaindustryjournal.example/feed/manufacturing", weight: 1.1, region: "apac", group: "sector", tier: "regional", active: true, items_7d: 41, error: "HTTP 503 Service Unavailable (3 retries)", failures: 2 },
  { key: "hn", kind: "hn", name: "Hacker News — front page", url: "https://hn.algolia.com/api/v1/search?tags=front_page", weight: 0.6, region: "global", group: "technology", tier: "specialist", active: true, items_7d: 210 },
  { key: "reddit", kind: "reddit", name: "Reddit r/investing", url: "https://www.reddit.com/r/investing/top.json?t=day", weight: 0.4, region: "us", group: "signals", tier: "strategic", active: false, items_7d: 0 },
];

export interface FeedSpec {
  key: string;
  title: string;
  source: string;
  publisher: string;
  path: string;
  summary: string;
  why: string | null;
  region: Region;
  score: number;
  category: Category;
  reason: string;
  status: "new" | "triaged" | "promoted" | "ignored" | "duplicate";
  hours: number;
  entities: { name: string; type: string; watchlist?: boolean }[];
  signals: string[];
  subject: string;
  facts: string[];
  cluster?: string;
  head?: boolean;
  ignored?: string;
  /** Held back until a discovery refresh "finds" it. */
  reserve?: boolean;
}

export const FEED_SPECS: FeedSpec[] = [
  {
    key: "kestrel", title: "Kestrel Semiconductor to build $4.2bn advanced-packaging plant in Gujarat", source: "ibd", publisher: "India Business Daily", path: "companies/kestrel-semiconductor-gujarat-packaging-plant",
    summary: "The chipmaker's board approved a five-year, $4.2bn investment in an advanced-packaging and test facility in Dholera, with first output targeted for the second half of 2028.",
    why: "Packaging, not wafers, is now the AI bottleneck; 2028 capacity contracts are being written now.",
    region: "india", score: 0.82, category: "brief", reason: "Single capital-allocation event with filing-backed numbers", status: "promoted", hours: 20,
    entities: [{ name: "Kestrel Semiconductor", type: "company" }, { name: "India", type: "country", watchlist: true }, { name: "semiconductors", type: "sector", watchlist: true }],
    signals: ["capex", "board approval", "government incentive"], subject: "Kestrel's packaging plant",
    facts: [
      "Kestrel Semiconductor will invest $4.2bn over five years in an advanced-packaging plant in Dholera, Gujarat.",
      "The national semiconductor scheme is expected to cover up to 50% of eligible capital costs.",
      "The plant is designed for 40,000 wafers a month of packaging capacity at full run-rate.",
      "Kestrel expects about 3,800 direct jobs at full capacity.",
      "First commercial output is targeted for the second half of 2028.",
    ],
  },
  {
    key: "meridian", title: "Meridian Bank agrees to buy fintech lender Arcturus Pay for $1.1bn", source: "gmw", publisher: "Global Markets Wire", path: "2026/11/meridian-bank-arcturus-pay-deal",
    summary: "The UK lender will pay $1.1bn in cash for Arcturus Pay, whose point-of-sale credit products sit inside 2,300 merchant checkouts.",
    why: "Banks are buying distribution, not technology: the checkout is the new branch.",
    region: "uk", score: 0.77, category: "brief", reason: "M&A with disclosed price and strategic rationale", status: "promoted", hours: 70,
    entities: [{ name: "Meridian Bank", type: "company" }, { name: "Arcturus Pay", type: "company" }, { name: "fintech", type: "sector", watchlist: true }],
    signals: ["M&A", "price disclosed"], subject: "Meridian's Arcturus deal",
    facts: [
      "Meridian Bank agreed to acquire Arcturus Pay for $1.1bn in cash.",
      "Arcturus Pay's credit products are embedded in 2,300 merchant checkouts.",
      "Meridian expects the deal to close in the second quarter of 2027, subject to regulatory approval.",
      "Arcturus Pay's loan book grew 64% last year, according to the deal announcement.",
    ],
  },
  {
    key: "halvorsen", title: "Halvorsen Freight CEO steps down after margin warning; CFO named interim chief", source: "gmw", publisher: "Global Markets Wire", path: "2026/11/halvorsen-freight-ceo-exit",
    summary: "Halvorsen Freight said chief executive Maren Lund will leave with immediate effect after the company cut its full-year operating-margin guidance for the second time.",
    why: "CFO-led interim regimes usually cut capex first; suppliers should expect re-tendered contracts.",
    region: "global", score: 0.71, category: "decisions", reason: "Leadership change with operational consequences", status: "new", hours: 5,
    entities: [{ name: "Halvorsen Freight", type: "company" }, { name: "Maren Lund", type: "person" }, { name: "logistics", type: "sector", watchlist: true }],
    signals: ["CEO change", "guidance cut"], subject: "Halvorsen's leadership change",
    facts: ["Halvorsen Freight cut its full-year operating-margin guidance for the second time this year.", "Chief executive Maren Lund left with immediate effect.", "The chief financial officer was named interim chief executive."],
  },
  {
    key: "northwind", title: "Northwind Retail shifts 30% of private-label sourcing from China to Vietnam and Mexico", source: "gmw", publisher: "Global Markets Wire", path: "2026/11/northwind-retail-sourcing-shift",
    summary: "The retailer told suppliers it will move nearly a third of private-label production over 18 months, citing tariff exposure and lead-time volatility.",
    why: "A large buyer re-drawing its supplier map resets terms for everyone sharing those factories.",
    region: "us", score: 0.69, category: "deep_dive", reason: "Structural supply-chain shift at scale", status: "new", hours: 9,
    entities: [{ name: "Northwind Retail", type: "company" }, { name: "Vietnam", type: "country" }, { name: "Mexico", type: "country" }, { name: "retail", type: "sector", watchlist: true }],
    signals: ["supply chain", "tariffs"], subject: "Northwind's sourcing shift", cluster: "c-northwind", head: true,
    facts: ["Northwind Retail will move 30% of private-label sourcing out of China over 18 months.", "Vietnam and Mexico will take most of the shifted volume.", "The company cited tariff exposure and lead-time volatility."],
  },
  {
    key: "northwind-dup", title: "Northwind to cut China sourcing for own-brand goods, supplier memo shows", source: "gdelt", publisher: "Retail Supply Journal", path: "news/northwind-supplier-memo",
    summary: "A memo seen by the publication outlines an 18-month transition for private-label suppliers.", why: null,
    region: "us", score: 0.52, category: "deep_dive", reason: "Duplicate coverage", status: "duplicate", hours: 8,
    entities: [{ name: "Northwind Retail", type: "company" }], signals: ["supply chain"], subject: "Northwind's sourcing shift", cluster: "c-northwind", facts: [],
  },
  {
    key: "solace", title: "Solace Pharmaceuticals 8-K: board authorises $2bn buyback, pauses two late-stage trials", source: "edgar", publisher: "SEC EDGAR", path: "Archives/edgar/data/0001999001/solace-8k",
    summary: "A current report filed after market close discloses a $2bn repurchase authorisation alongside a pause of two phase III programmes.",
    why: "Returning cash while pausing pipeline is a statement about where the board sees returns.",
    region: "us", score: 0.66, category: "brief", reason: "Primary filing; capital allocation", status: "promoted", hours: 30,
    entities: [{ name: "Solace Pharmaceuticals", type: "company" }, { name: "pharmaceuticals", type: "sector", watchlist: true }],
    signals: ["8-K", "buyback", "R&D pause"], subject: "Solace's buyback",
    facts: ["Solace Pharmaceuticals' board authorised a $2bn share repurchase.", "The company paused two phase III programmes."],
  },
  {
    key: "reshoring", title: "Survey: two in five mid-cap manufacturers are re-shoring part of their capex", source: "gmw", publisher: "Global Markets Wire", path: "2026/11/cfo-survey-reshoring-capex",
    summary: "A survey of 400 finance chiefs at mid-cap manufacturers found 41% plan to move some capital spending closer to home markets within two years.",
    why: "Re-shoring is moving from talk to budget lines, and mid-caps are moving first.",
    region: "global", score: 0.58, category: "thinking", reason: "Trend with survey evidence; suits an essay", status: "promoted", hours: 46,
    entities: [{ name: "manufacturing", type: "sector", watchlist: true }], signals: ["survey", "capex"], subject: "re-shoring",
    facts: ["A survey of 400 mid-cap manufacturing CFOs found 41% plan to re-shore part of their capex within two years.", "Respondents ranked supply resilience above labour cost as the main driver."],
  },
  {
    key: "orbis", title: "Orbis Energy and state utility sign 1.5 GW green-hydrogen offtake", source: "ibd", publisher: "India Business Daily", path: "energy/orbis-energy-green-hydrogen-offtake",
    summary: "The 15-year agreement is the largest green-hydrogen offtake signed in India and underpins Orbis's planned electrolyser park.",
    why: "A bankable offtake is what turns hydrogen announcements into financeable projects.",
    region: "india", score: 0.63, category: "deep_dive", reason: "Company analysis candidate: model, moat, numbers", status: "promoted", hours: 26,
    entities: [{ name: "Orbis Energy", type: "company" }, { name: "energy transition", type: "sector", watchlist: true }], signals: ["offtake", "energy"], subject: "Orbis's hydrogen bet",
    facts: ["Orbis Energy signed a 15-year offtake for 1.5 GW of green-hydrogen capacity.", "The agreement underpins a planned electrolyser park."],
  },
  {
    key: "vantage", title: "Vantage Telecom weighs tower-unit IPO valuing it at up to $6bn", source: "gdelt", publisher: "Asia Markets Wire", path: "telecom/vantage-tower-ipo",
    summary: "The operator has hired advisers for a possible listing of its tower business as it looks to fund 5G spending without new debt.",
    why: "Selling infrastructure to fund the network is a decision every capital-heavy operator faces.",
    region: "apac", score: 0.61, category: "decisions", reason: "Strategic option with clear trade-offs", status: "triaged", hours: 14,
    entities: [{ name: "Vantage Telecom", type: "company" }, { name: "telecom", type: "sector", watchlist: true }], signals: ["IPO", "asset sale"], subject: "Vantage's tower listing",
    facts: ["Vantage Telecom is considering an IPO of its tower unit at a valuation of up to $6bn.", "The operator wants to fund 5G spending without new debt."],
  },
  {
    key: "showhn", title: "Show HN: open-source agent runtime cuts LLM inference cost 40% on commodity CPUs", source: "hn", publisher: "Hacker News", path: "item?id=40998812",
    summary: "A small team released a runtime that batches agent tool calls and quantises on the fly; benchmarks are self-reported.",
    why: "Cheaper on-prem inference changes the build-versus-buy maths for AI platform teams.",
    region: "global", score: 0.41, category: "thinking", reason: "Technology signal; weak evidence", status: "new", hours: 11,
    entities: [{ name: "artificial intelligence", type: "sector", watchlist: true }], signals: ["open source"], subject: "cheaper inference",
    facts: ["The developers report a 40% reduction in inference cost on commodity CPUs.", "The benchmarks are self-reported and not independently verified."],
  },
  {
    key: "celebrity", title: "Celebrity chef opens third restaurant in Dubai Marina", source: "gdelt", publisher: "Lifestyle Daily", path: "dining/celebrity-chef-dubai",
    summary: "The opening adds a 120-cover venue to the chef's Gulf portfolio.", why: null,
    region: "mena", score: 0.12, category: "brief", reason: "Avoid-list topic", status: "ignored", hours: 16, ignored: "Not relevant for executives",
    entities: [{ name: "Dubai", type: "country" }], signals: [], subject: "the opening", facts: [],
  },
  // Held back: "found" by the first discovery refresh in the demo.
  {
    key: "lumen", title: "Lumen Robotics raises $310m to scale warehouse automation in Europe", source: "gmw", publisher: "Global Markets Wire", path: "2026/11/lumen-robotics-series-d",
    summary: "The Series D values the company at $2.4bn; proceeds go to European deployments and a second factory.",
    why: "Automation is shifting from pilot to fleet: logistics buyers now negotiate on uptime, not demos.",
    region: "eu", score: 0.67, category: "brief", reason: "Funding round with disclosed valuation", status: "new", hours: 0.5, reserve: true,
    entities: [{ name: "Lumen Robotics", type: "company" }, { name: "logistics", type: "sector", watchlist: true }], signals: ["funding", "valuation"], subject: "Lumen's raise",
    facts: ["Lumen Robotics raised $310m in a Series D round.", "The round values the company at $2.4bn.", "Proceeds fund European deployments and a second factory."],
  },
  {
    key: "tarn", title: "Tarn Steel delays $900m green-steel furnace by a year, citing power costs", source: "ibd", publisher: "India Business Daily", path: "companies/tarn-steel-furnace-delay",
    summary: "The company pushed commissioning of its electric-arc furnace to 2028 and said it is renegotiating its renewable power contract.",
    why: "Power price, not technology, is setting the pace of industrial decarbonisation.",
    region: "india", score: 0.62, category: "brief", reason: "Capex delay with stated cause", status: "new", hours: 0.4, reserve: true,
    entities: [{ name: "Tarn Steel", type: "company" }, { name: "manufacturing", type: "sector", watchlist: true }], signals: ["capex delay"], subject: "Tarn's delay",
    facts: ["Tarn Steel delayed its $900m electric-arc furnace by a year.", "The company cited power costs and is renegotiating its renewable power contract."],
  },
];

/* Hand-written sections for the showcase articles. */

export const KESTREL_SECTIONS: Record<string, Partial<Section>> = {
  lede: {
    paragraphs: [
      "Kestrel Semiconductor will spend $4.2bn over five years on an advanced-packaging plant in Dholera, Gujarat. The facility will assemble and test high-bandwidth memory stacks and chiplet-based processors, with first commercial output targeted for the second half of 2028.",
    ],
    facts_used: [1, 5],
  },
  what_happened: {
    paragraphs: [
      "Kestrel's board approved the plan this week, making it the largest single packaging investment announced in India. The state will provide land and power on concessional terms, and the national semiconductor scheme is expected to cover up to 50% of eligible capital costs.",
      "The company said the plant will employ about 3,800 people at full capacity. It did not name anchor customers or give a return target.",
    ],
    facts_used: [2, 4],
  },
  the_numbers: {
    paragraphs: ["The headline figure matters less than the timeline. New packaging lines typically take well over a year to qualify with customers, which puts the next few quarters on the critical path."],
    bullets: ["$4.2bn total commitment over five years", "Up to 50% of eligible capex covered by the national scheme", "40,000 wafers a month of packaging capacity at full run-rate", "About 3,800 direct jobs at full capacity", "H2 2028 target for first commercial output"],
    facts_used: [1, 2, 3, 4, 5],
  },
  why_it_matters: {
    paragraphs: [
      "For two years the binding constraint on AI hardware has not been leading-edge wafers but the advanced packaging that turns them into usable accelerators. That capacity is concentrated in a handful of sites, and lead times have stretched.",
      "A second geography changes the bargaining position of every buyer. Companies that sign capacity agreements early will get allocation; those that wait will be quoted later slots. This suggests procurement, not engineering, is where the first decisions sit.",
    ],
    pull_quote: "Packaging, not wafers, is now where AI supply is won or lost.",
    facts_used: [5],
  },
  what_to_watch: {
    paragraphs: ["Three signals will show whether the plan is real before the first line is installed."],
    bullets: ["Named anchor customers before the scheme approval is final", "Firm power and water commitments from the state, the usual source of delay", "Pricing of memory packaging against incumbent sites"],
  },
};

export const MERIDIAN_SECTIONS: Record<string, Partial<Section>> = {
  lede: {
    paragraphs: ["Meridian Bank has agreed to buy Arcturus Pay for $1.1bn in cash. The price buys a fast-growing loan book, but the real asset is position: Arcturus's credit products sit inside 2,300 merchant checkouts."],
    facts_used: [1, 2],
  },
  what_happened: {
    paragraphs: [
      "The UK lender announced the agreement on Tuesday and expects to close in the second quarter of 2027, subject to regulatory approval. Arcturus will keep its brand and run as a separate unit inside Meridian's consumer division.",
      "Meridian said it will fund the purchase from existing capital and does not expect to issue new shares.",
    ],
    facts_used: [3],
  },
  the_numbers: {
    paragraphs: ["The deal is small against Meridian's balance sheet, which is the point: it is buying a channel, not scale. A bank of its size could have built a credit product in-house; it could not have built 2,300 merchant integrations quickly."],
    bullets: ["$1.1bn cash consideration", "2,300 merchant checkouts with embedded Arcturus credit", "64% growth in the Arcturus loan book last year", "Q2 2027 expected close"],
    facts_used: [1, 2, 3, 4],
  },
  why_it_matters: {
    paragraphs: [
      "Banks have spent a decade trying to build digital front ends that customers choose to open. Arcturus offers the opposite: credit that appears at the moment of purchase, inside someone else's interface.",
      "The likely consequence is a scramble for the remaining independent checkout-credit providers. Merchants with those integrations gain leverage in their next contract round.",
    ],
    pull_quote: "The checkout is the new branch, and banks are now paying for the lease.",
  },
  what_to_watch: {
    paragraphs: ["Integration, not approval, is the main risk. Embedded-credit businesses live on merchant goodwill, and a change of owner gives every merchant a reason to reopen terms."],
    bullets: ["Whether merchants renegotiate terms on change of control", "Credit losses as the book moves onto Meridian's risk models", "Rival banks bidding for the next-largest providers"],
  },
};

export interface ArticleSpec {
  key: string;
  feed: string | null;
  title: string;
  dek: string;
  category: Category;
  state: "queued" | "drafting" | "in_review" | "approved" | "scheduled" | "published" | "needs_sources";
  keyword: string;
  secondary: string[];
  slug: string;
  qa: number;
  hours: number;
  sections?: Record<string, Partial<Section>>;
  takeaway?: string;
  angle: string;
  region: Region;
  subject?: string;
  facts?: string[];
}

export const ARTICLE_SPECS: ArticleSpec[] = [
  {
    key: "kestrel", feed: "kestrel", title: "Kestrel's $4.2bn Gujarat bet moves the chip bottleneck to packaging", dek: "The plant targets 2028 output, which means supply contracts, and leverage, are being negotiated now.",
    category: "brief", state: "in_review", keyword: "advanced packaging india", secondary: ["kestrel semiconductor", "chip packaging capacity", "hbm packaging"], slug: "kestrel-gujarat-advanced-packaging-plant", qa: 86, hours: 18,
    sections: KESTREL_SECTIONS, takeaway: "If AI hardware is on your 2028 roadmap, the capacity conversation starts this quarter, and a second packaging geography is leverage worth using.",
    angle: "Packaging capacity is the real AI bottleneck; buyers should negotiate now.", region: "india",
  },
  {
    key: "meridian", feed: "meridian", title: "Meridian's $1.1bn Arcturus deal is a bet on embedded lending, not payments", dek: "The bank is buying 2,300 merchant checkouts, and with them a seat at the moment of purchase.",
    category: "brief", state: "published", keyword: "embedded lending acquisition", secondary: ["meridian bank arcturus", "checkout credit", "bank fintech m&a"], slug: "meridian-arcturus-embedded-lending", qa: 88, hours: 60,
    sections: MERIDIAN_SECTIONS, takeaway: "Distribution is now the scarce asset in consumer finance. If your product depends on someone else's checkout, assume that position has a price, and that a bank may pay it.",
    angle: "Banks are buying distribution rather than technology.", region: "uk",
  },
  {
    key: "ai-platform", feed: null, title: "Build or buy: should you own your AI platform team?", dek: "Cheaper inference has moved the line. The answer now depends on how many of your products need the same model plumbing.",
    category: "decisions", state: "scheduled", keyword: "build vs buy ai platform", secondary: ["ai platform team", "llm inference cost", "ai operating model"], slug: "build-or-buy-ai-platform-team", qa: 82, hours: 40,
    angle: "Falling inference cost changes the build-versus-buy maths.", region: "global", subject: "an in-house AI platform",
    facts: ["Open-source runtimes report inference cost reductions of up to 40% on commodity CPUs.", "Most enterprises run fewer than five production AI use cases, according to the research pack's survey source.", "Platform teams typically need specialist hires in inference, evaluation and data governance."],
  },
  {
    key: "supplier", feed: null, title: "The 90-day supplier-diversification sprint", dek: "A repeatable way to add a second source without stalling the business or overpaying for insurance.",
    category: "playbook", state: "approved", keyword: "supplier diversification", secondary: ["second sourcing", "supply chain resilience", "dual sourcing strategy"], slug: "90-day-supplier-diversification-sprint", qa: 84, hours: 30,
    angle: "A time-boxed method for second-sourcing critical inputs.", region: "global", subject: "second-sourcing",
    facts: ["Northwind Retail will move 30% of private-label sourcing out of China over 18 months.", "Survey respondents ranked supply resilience above labour cost as the main driver of sourcing change."],
  },
  {
    key: "reshoring", feed: "reshoring", title: "Why mid-cap manufacturers are re-shoring capex first", dek: "Large groups can absorb disruption. Mid-caps cannot, so they are moving budgets home before the giants do.",
    category: "thinking", state: "drafting", keyword: "reshoring capex", secondary: ["mid-cap manufacturers", "supply resilience", "capex strategy"], slug: "mid-cap-manufacturers-reshoring-capex", qa: 0, hours: 6,
    angle: "Mid-caps lead re-shoring because they cannot absorb disruption.", region: "global",
  },
  {
    key: "orbis", feed: "orbis", title: "Orbis Energy's hydrogen bet, and the offtake that makes it bankable", dek: "A 15-year contract turns an announcement into a financeable project. The risks move from demand to delivery.",
    category: "deep_dive", state: "queued", keyword: "green hydrogen offtake", secondary: ["orbis energy", "electrolyser park", "hydrogen india"], slug: "orbis-energy-green-hydrogen-offtake", qa: 0, hours: 2,
    angle: "Bankable offtake changes where the risk sits.", region: "india",
  },
  {
    key: "solace", feed: "solace", title: "Solace pauses trials and buys back $2bn of stock", dek: "The board is telling investors where it sees returns, and it is not the late-stage pipeline.",
    category: "brief", state: "needs_sources", keyword: "pharma buyback", secondary: ["solace pharmaceuticals", "r&d pause"], slug: "solace-buyback-trial-pause", qa: 0, hours: 28,
    angle: "Capital return over pipeline is a strategic statement.", region: "us",
  },
  {
    key: "optionality", feed: null, title: "Optionality is a budget line, not a mindset", dek: "Leaders say they want flexibility. Few put a price on it, which is why it disappears in the first cost review.",
    category: "brief", state: "published", keyword: "strategic optionality", secondary: ["real options", "capital allocation", "strategy budgeting"], slug: "optionality-is-a-budget-line", qa: 87, hours: 26,
    angle: "Price flexibility explicitly or lose it.", region: "global", subject: "optionality",
    facts: ["Finance teams in the cited survey said contingency budgets are the first line cut in 7 out of 10 cost reviews.", "Firms that ring-fenced option budgets reported faster responses to supply shocks, according to the same survey."],
  },
];

/* ---------------- Settings fixtures ---------------- */

export const BANNED_PHRASES = ["delve", "game changer", "game-changer", "in conclusion", "in today's fast-paced world", "it is important to note", "let's dive in", "revolutionize", "tapestry", "unlock the power"];

export const PROMPT_BODIES: Record<string, string> = {
  "agents/writer": `---
id: agents/writer
version: 1.0.0
description: A3 Writer — produce a category-correct article section by section, grounded only in the research pack.
---

## Your job

You write original articles in the house voice, following the category playbook exactly and using only the facts in the research pack. You are called in steps:

1. **Outline call** — return the title, dek and a plan for every required section.
2. **Section calls** — one call per section. Return that section only.
3. **Takeaway call** — one or two sentences naming the decision, trade-off or test a senior leader should take away.

## Grounding rules

- Use only facts from the research pack. Cite the indices of the key facts you used in \`facts_used\`.
- Every number in your text must appear in the research pack with the same value and unit.
- Mark inference as inference ("this suggests", "the likely consequence is").

## Title and dek

- Title: 20–90 characters, specific, no clickbait.
- Dek: 40–220 characters, one sentence that adds the stake the title does not carry.
`,
  "agents/critic": `---
id: agents/critic
version: 1.0.0
description: A6 Critic — adversarial QA rubric scored against the research pack.
---

## Your job

Score the draft against its research pack. You are not an editor: do not rewrite. Find what would embarrass the publication.

## Scores (1–5)

- factuality — every claim traceable to a key fact
- structure — required sections, in order, doing their job
- executive_value — would a CEO change a decision after reading this?
- originality — second-order insight, not a summary of the source
- voice — the house persona; no banned phrases
- readability — rhythm, sentence length, one idea per paragraph

## Verdict

Return pass, revise (with one concrete instruction and the stage to rerun) or block (with the reason).
`,
};

export const PERSONA_BODY = `---
id: persona/ten
version: 1.0.0
description: House voice — audience, stance, rhythm, vocabulary and the executive-value test.
---

## Who we write for

Chief executives, founders, managing directors and senior operators. They already know what an acquisition, a margin and a moat are. They need judgment, not definitions.

## Our stance

- Analytical, not promotional.
- Sceptical of hype: a press release is a claim, not a fact.
- Decision-oriented: leave the reader with a sharper question, a clearer option or a number worth watching.
- Second-order: the value is the consequence one or two steps out.
- Fair to the other side: state the strongest opposing view first.

## Rhythm

- Average sentence length at or below 22 words.
- One idea per paragraph; two to four sentences each.
- Active voice. Name the actor.
`;

export const STRUCTURE_BODY = `## Paragraphs
- Two to four sentences each. A one-sentence paragraph at most twice per article.
- Never more than about 90 words in a paragraph.

## Headings
- The title is the only H1. Section headings are H2, short and informative.
- Keep the category's required sections in order.

## Closings
- End with the takeaway: one decision, trade-off or test.`;

export const LEXICON_BODY = `Prefer: capital allocation, trade-off, payback, optionality, second source, unit economics.
Avoid: synergy (unless quantified), disrupt, ecosystem (unless literal), transformation (unless defined).`;

export function promptVersion(key: string, body: string, createdAt: string | null): PromptVersionRow {
  return { id: `pv-${key.replace(/\W+/g, "-")}-file`, version: "1.0.0", body, note: null, source: "file", active: true, created_at: createdAt, created_by: null };
}

export const EVAL_CASES: EvalCaseRow[] = [
  { id: "brief-good-001", category: "brief", label: "good", description: "Acquisition brief with three filing-backed numbers (fictional Oakridge Foods).", expected: "pass" },
  { id: "brief-adv-002", category: "brief", label: "adversarial", description: "Draft invents a deal price not present in the pack.", expected: "block: numbers_verified" },
  { id: "thinking-edge-003", category: "thinking", label: "edge", description: "Essay at the bottom of the word band with one unmarked inference.", expected: "revise: edit" },
  { id: "decisions-good-004", category: "decisions", label: "good", description: "Build-vs-buy decision with both options argued fairly.", expected: "pass" },
  { id: "deep-adv-005", category: "deep_dive", label: "adversarial", description: "Source excerpt contains a prompt-injection instruction.", expected: "pass with injection flag; instruction ignored" },
  { id: "brief-adv-006", category: "brief", label: "adversarial", description: "Banned phrase hidden in a pull quote.", expected: "block: banned_phrases" },
];

export const COMPETITORS = [
  { key: "hbr", name: "Harvard Business Review", site: "https://hbr.org", pages: 40, avg: 1840, jsonld: 0.95, terms: ["leadership", "strategy", "ai", "management", "teams", "innovation"], gaps: ["ai governance", "hybrid work", "board diversity"] },
  { key: "mit_smr", name: "MIT Sloan Management Review", site: "https://sloanreview.mit.edu", pages: 40, avg: 2120, jsonld: 0.9, terms: ["ai", "data", "strategy", "digital", "leadership"], gaps: ["responsible ai", "data strategy"] },
  { key: "mckinsey", name: "McKinsey Insights", site: "https://www.mckinsey.com", pages: 38, avg: 2650, jsonld: 0.72, terms: ["growth", "operations", "ai", "supply chain", "talent"], gaps: ["operating model", "supply chain resilience", "pricing"] },
  { key: "fortune", name: "Fortune", site: "https://fortune.com", pages: 40, avg: 930, jsonld: 1, terms: ["ceo", "markets", "tech", "ai", "banking"], gaps: ["ceo succession"] },
  { key: "strategy_business", name: "strategy+business", site: "https://www.strategy-business.com", pages: 0, avg: 0, jsonld: 0, terms: [], gaps: [] },
];
