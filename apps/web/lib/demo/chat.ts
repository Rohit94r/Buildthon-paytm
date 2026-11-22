// Deterministic "comparison assistant" for demo mode: no LLM, just matching, filters and templated markdown.
// Finds records named in the question (fuzzy name / alias match) or applies filters and sorts parsed from it,
// then answers with insights, a comparison table with per-field winners and follow-up suggestions.

import type { ChatMessage, ChatResponse, ChatSource, ComparisonTable, Dataset, DatasetField, DatasetRecord } from "@/lib/platform-types";

export interface ChatInput {
  dataset: Dataset;
  records: DatasetRecord[];
  message: string;
  history?: ChatMessage[];
  compareKeys?: string[];
  maxRecords?: number;
}

export type ChatResult = Omit<ChatResponse, "model" | "latency_ms">;

const NO_SOURCES: Pick<ChatResponse, "sources" | "sources_degraded"> = { sources: [] as ChatSource[], sources_degraded: false };

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokens = (s: string) => norm(s).split(" ").filter(Boolean);

function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

const hasPhrase = (hay: string, phrase: string) => phrase.length > 0 && ` ${hay} `.includes(` ${phrase} `);

/** Hand-written aliases for well-known names (normalized key -> normalized aliases). */
const ALIASES: Record<string, string[]> = {
  "iit bombay": ["iitb", "iit b", "iit mumbai"],
  "iit delhi": ["iitd", "iit d"],
  "iit madras": ["iitm", "iit chennai"],
  "bits pilani": ["bits", "bitsp", "bits p"],
  "nit trichy": ["nitt", "nit tiruchirappalli", "trichy"],
  "nit surathkal": ["nitk", "surathkal"],
  "vit vellore": ["vit"],
  "iiit hyderabad": ["iiith", "iiit hyd", "iiit h"],
  "coep technological university": ["coep", "coep pune"],
  "manipal institute of technology": ["mit manipal", "manipal", "mahe"],
};

/** Words never used on their own to identify a record. */
const STOP = new Set(
  "the of and for in at on to a an institute technology technological university college colleges engineering school national indian india iit iits nit nits iiit iiits online offline hybrid hackathon hackathons hack hacks challenge sprint week buildathon fest summit labs ai ml data open best top compare which what show list ipo ipos company limited ltd pro".split(
    " ",
  ),
);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function today(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function relDays(d: Date): string {
  const diff = Math.round((d.getTime() - today().getTime()) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v.replace(/,/g, "")))) return Number(v.replace(/,/g, ""));
  return null;
}

function inr(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function money(n: number, unit?: string): string {
  if (unit && /cr/i.test(unit)) return `₹${inr(n)} Cr`;
  if (!unit || unit === "₹") return `₹${inr(n)}`;
  return `${unit}${inr(n)}`;
}

/** ₹ amount in words for differences: ₹12.5 lakh, ₹1.2 crore. */
function moneyShort(n: number, unit?: string): string {
  if (unit && /cr/i.test(unit)) return `₹${inr(Math.round(n))} Cr`;
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${+(a / 1e7).toFixed(2)} crore`;
  if (a >= 1e5) return `₹${+(a / 1e5).toFixed(1)} lakh`;
  return `₹${inr(a)}`;
}

function fmtValue(f: DatasetField, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (f.type === "boolean") return v ? "Yes" : "No";
  if (f.type === "date") {
    const d = parseDate(v);
    return d ? `${fmtDate(d)} ${d.getFullYear()}` : String(v);
  }
  const n = num(v);
  if (n === null) return String(v);
  if (f.type === "currency") return money(n, f.unit);
  if (f.type === "rating") return `${n}/5`;
  if (/rank/.test(f.key)) return `#${n}`;
  if (!f.unit) return inr(n);
  if (f.unit === "%" || f.unit === "x") return `${n}${f.unit}`;
  if (f.unit === "₹") return `₹${inr(n)}`;
  return `${n} ${f.unit}`;
}

const plainLabel = (f: DatasetField) => f.label.replace(/\s*\(.*?\)/g, "").toLowerCase();

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function nounOf(ds: Dataset): string {
  return ds.name
    .trim()
    .split(/\s+/)
    .map((w) => (/^[A-Z]{2,}/.test(w) ? w : w.toLowerCase()))
    .join(" ");
}

const nameOf = (ds: Dataset, r: DatasetRecord) => String(r.data[ds.key_field] ?? r.key);

/* ------------------------------------------------------------------ */
/* Record matching                                                     */
/* ------------------------------------------------------------------ */

function matchRecords(ds: Dataset, records: DatasetRecord[], text: string): DatasetRecord[] {
  const msg = norm(text);
  const msgTokens = msg.split(" ").filter(Boolean);
  const rawWords = new Set(text.split(/[^A-Za-z0-9]+/).filter(Boolean));
  const keyTokens = records.map((r) => tokens(nameOf(ds, r)));
  const tokenFreq = new Map<string, number>();
  for (const ts of keyTokens) for (const t of new Set(ts)) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);

  const hits: { r: DatasetRecord; score: number; pos: number }[] = [];
  records.forEach((r, i) => {
    const name = nameOf(ds, r);
    const nk = norm(name);
    const kt = keyTokens[i];
    let score = 0;
    let pos = Infinity;
    const note = (s: number, phrase: string) => {
      if (s > score) score = s;
      const p = ` ${msg} `.indexOf(` ${phrase} `);
      if (p >= 0 && p < pos) pos = p;
    };
    if (hasPhrase(msg, nk)) note(3, nk);
    for (const a of ALIASES[nk] ?? []) if (hasPhrase(msg, a)) note(3, a);
    // "IIIT Hyd" -> every message token is a prefix of the matching name token
    if (kt.length >= 2) {
      for (let s = 0; s + kt.length <= msgTokens.length; s++) {
        let ok = true;
        for (let j = 0; j < kt.length; j++) {
          const m = msgTokens[s + j];
          if (!(kt[j].startsWith(m) && m.length >= Math.min(3, kt[j].length))) {
            ok = false;
            break;
          }
        }
        if (ok) note(2, msgTokens.slice(s, s + kt.length).join(" "));
      }
    }
    // "IITB" -> acronym prefix + initials
    if (kt.length >= 2 && kt[0].length <= 4) {
      const acr = kt[0] + kt.slice(1).map((t) => t[0]).join("");
      if (msgTokens.includes(acr)) note(2, acr);
    }
    // distinctive single tokens: "BITS", "Manipal", "AgentVerse"
    for (const t of kt) {
      if (STOP.has(t) || /^\d+$/.test(t) || (tokenFreq.get(t) ?? 0) > 1) continue;
      const shortAcronym = t.length === 3 && [...rawWords].some((w) => w.toLowerCase() === t && w === w.toUpperCase());
      if (t.length < 4 && !shortAcronym) continue;
      if (msgTokens.includes(t)) note(1, t);
    }
    if (score > 0) hits.push({ r, score, pos });
  });
  hits.sort((a, b) => a.pos - b.pos || b.score - a.score);
  return hits.map((h) => h.r);
}

/* ------------------------------------------------------------------ */
/* Question parsing: focus fields, filters, sort                       */
/* ------------------------------------------------------------------ */

const FIELD_GENERIC = new Set(["total", "rate", "date", "pool", "size", "yrs", "avg", "average", "highest", "student", "popular", "the", "of", "per", "and"]);
const SYN: Record<string, string[]> = {
  fee: ["cost", "price", "tuition", "cheap", "cheaper", "cheapest", "expensive", "afford", "affordable", "budget", "costliest"],
  package: ["placement", "salary", "ctc", "lpa", "pay"],
  placement: ["placed", "package", "job"],
  rank: ["ranking", "ranked", "nirf"],
  rating: ["rated", "review"],
  prize: ["reward", "money", "cash", "winning"],
  deadline: ["close", "closing", "closes", "register", "registration", "last"],
  subscription: ["subscribed", "oversubscribed", "demand"],
  gmp: ["grey", "premium", "listing"],
  discount: ["deal", "off", "saving"],
  price: ["cheap", "cheaper", "cheapest", "cost", "expensive", "costliest"],
};

function fieldStems(f: DatasetField): Set<string> {
  const out = new Set<string>();
  for (const t of [...f.key.split("_"), ...tokens(f.label)]) {
    const s = stem(t);
    if (s.length < 3 || FIELD_GENERIC.has(s)) continue;
    out.add(s);
    for (const x of SYN[s] ?? []) out.add(stem(x));
  }
  return out;
}

/** Compare fields mentioned in the message, in order of first mention. */
function focusFields(ds: Dataset, text: string): DatasetField[] {
  const ms = tokens(text).map(stem);
  const found: { f: DatasetField; pos: number; idx: number }[] = [];
  ds.fields.forEach((f, idx) => {
    if (!f.compare) return;
    const st = fieldStems(f);
    const pos = ms.findIndex((t) => st.has(t));
    if (pos >= 0) found.push({ f, pos, idx });
  });
  found.sort((a, b) => a.pos - b.pos || a.idx - b.idx);
  return found.map((x) => x.f);
}

interface Filter {
  label: string;
  test: (r: DatasetRecord) => boolean;
  field: DatasetField;
  kind: "text" | "list" | "number" | "date";
  hidden?: boolean;
}

const GEO = /^(city|state|location|region|country)$/;

function wordInRaw(text: string, word: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`).test(text);
}

function detectFilters(ds: Dataset, records: DatasetRecord[], text: string): { filters: Filter[]; dateField: DatasetField | null } {
  const msg = norm(text);
  const lower = text.toLowerCase();
  const filters: Filter[] = [];
  const usedText = new Set<string>();

  // Text values ("Online", "Maharashtra", "IIT") and list elements ("AI", "JEE Main").
  for (const f of ds.fields) {
    if (f.key === ds.key_field) continue;
    if (f.type === "text") {
      const values = new Map<string, string>();
      for (const r of records) {
        const v = r.data[f.key];
        if (typeof v === "string" && v.trim()) values.set(norm(v), v);
      }
      const hit: string[] = [];
      for (const [nv, v] of values) {
        const nt = nv.split(" ");
        if (nt.length > 4 || /^[\d ]+$/.test(nv)) continue;
        if (nv.length <= 2 && !wordInRaw(text, v)) continue;
        if (hasPhrase(msg, nv) || hasPhrase(msg, `${nv}s`)) hit.push(v);
      }
      if (hit.length) {
        const set = new Set(hit.map(norm));
        const hidden = [...set].every((x) => usedText.has(x));
        for (const x of set) usedText.add(x);
        filters.push({
          field: f,
          kind: "text",
          hidden,
          label: GEO.test(f.key) ? `in ${joinAnd(hit)}` : `${plainLabel(f)}: ${hit.join(" or ")}`,
          test: (r) => typeof r.data[f.key] === "string" && set.has(norm(String(r.data[f.key]))),
        });
      }
    } else if (f.type === "list") {
      const values = new Map<string, string>();
      for (const r of records) {
        const v = r.data[f.key];
        if (Array.isArray(v)) for (const x of v) if (typeof x === "string") values.set(norm(x), x);
      }
      const hit: string[] = [];
      for (const [nv, v] of values) {
        if (nv.split(" ").length > 4) continue;
        if (nv.length <= 2 && !wordInRaw(text, v)) continue;
        if (hasPhrase(msg, nv)) hit.push(v);
      }
      if (hit.length) {
        const set = new Set(hit.map(norm));
        filters.push({
          field: f,
          kind: "list",
          label: `${plainLabel(f)} include ${hit.join(" or ")}`,
          test: (r) => Array.isArray(r.data[f.key]) && (r.data[f.key] as unknown[]).some((x) => typeof x === "string" && set.has(norm(x))),
        });
      }
    }
  }

  // Numeric limits: "under 10 lakh", "above 20 LPA", "85%+ placements".
  const numFields = ds.fields.filter((f) => f.type === "number" || f.type === "currency" || f.type === "rating");
  const pickField = (unitWord: string | undefined, around: string): DatasetField | undefined => {
    const u = (unitWord ?? "").toLowerCase();
    if (u === "lpa") return numFields.find((f) => f.unit === "LPA");
    if (u === "%") return focusFields(ds, around).find((f) => f.unit === "%") ?? numFields.find((f) => f.unit === "%");
    if (u === "x") return numFields.find((f) => f.unit === "x");
    const mentioned = focusFields(ds, around).find((f) => numFields.includes(f));
    if (mentioned && !(u && /lakh|lac|crore|cr|k|₹|rs|inr/.test(u) && mentioned.type !== "currency")) return mentioned;
    return numFields.find((f) => f.type === "currency" && f.higher_is_better === false) ?? numFields.find((f) => f.type === "currency");
  };
  const scale = (unitWord: string | undefined, f: DatasetField) => {
    const u = (unitWord ?? "").toLowerCase();
    let m = 1;
    if (/^(lakhs?|lacs?|l)$/.test(u)) m = 1e5;
    else if (/^(crores?|cr)$/.test(u)) m = 1e7;
    else if (u === "k") m = 1e3;
    if (f.unit && /cr/i.test(f.unit)) m = m / 1e7;
    return m;
  };
  const re = /(under|below|less than|cheaper than|within|upto|up to|at most|max(?:imum)?|over|above|more than|at least|min(?:imum)?)\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|l\b|crores?|cr\b|k\b|lpa|%|x\b)?/g;
  for (const m of lower.matchAll(re)) {
    const op = /under|below|less|cheaper|within|upto|up to|at most|max/.test(m[1]) ? "lte" : "gte";
    const around = lower.slice(Math.max(0, (m.index ?? 0) - 30), (m.index ?? 0) + m[0].length + 30);
    const f = pickField(m[3], around);
    if (!f) continue;
    const limit = Number(m[2].replace(/,/g, "")) * scale(m[3], f);
    const shown = f.type === "currency" ? moneyShort(limit, f.unit) : fmtValue(f, limit);
    filters.push({
      field: f,
      kind: "number",
      label: `${plainLabel(f)} ${op === "lte" ? "under" : "over"} ${shown}`,
      test: (r) => {
        const v = num(r.data[f.key]);
        return v !== null && (op === "lte" ? v <= limit : v >= limit);
      },
    });
  }
  for (const m of lower.matchAll(/(\d+(?:\.\d+)?)\s*%\s*\+/g)) {
    const f = pickField("%", lower);
    if (!f || filters.some((x) => x.field === f)) continue;
    const limit = Number(m[1]);
    filters.push({ field: f, kind: "number", label: `${plainLabel(f)} of ${limit}% or more`, test: (r) => (num(r.data[f.key]) ?? -1) >= limit });
  }

  // Date windows on the deadline-like date field.
  const dateFields = ds.fields.filter((f) => f.type === "date");
  let dateField: DatasetField | null = null;
  if (dateFields.length) {
    const wantsStart = /\b(start|starts|starting|begin|begins|opens?)\b/.test(lower);
    const df =
      (wantsStart ? dateFields.find((f) => /start|open/.test(f.key)) : null) ??
      dateFields.find((f) => /deadline|close/.test(f.key)) ??
      dateFields.find((f) => f.compare) ??
      dateFields[0];
    const t0 = today();
    let range: [Date, Date, string] | null = null;
    let mm: RegExpMatchArray | null;
    if (/\bthis month\b/.test(lower)) range = [t0, new Date(t0.getFullYear(), t0.getMonth() + 1, 0), "this month"];
    else if (/\bnext month\b/.test(lower)) range = [new Date(t0.getFullYear(), t0.getMonth() + 1, 1), new Date(t0.getFullYear(), t0.getMonth() + 2, 0), "next month"];
    else if (/\bthis week\b|\bwithin a week\b|\bnext 7 days\b|\bseven days\b/.test(lower)) range = [t0, addDays(t0, 7), "this week"];
    else if (/\bnext week\b/.test(lower)) range = [addDays(t0, 7), addDays(t0, 14), "next week"];
    else if ((mm = lower.match(/\b(?:next|within|in)\s+(\d{1,3})\s+days?\b/))) range = [t0, addDays(t0, Number(mm[1])), `in the next ${mm[1]} days`];
    else if (/\btoday\b/.test(lower)) range = [t0, t0, "today"];
    else if (/\btomorrow\b/.test(lower)) range = [addDays(t0, 1), addDays(t0, 1), "tomorrow"];
    else if (/\b(closing|ending) soon\b|\bsoon\b/.test(lower)) range = [t0, addDays(t0, 14), "in the next two weeks"];
    if (range) {
      const [a, b, label] = range;
      dateField = df;
      filters.push({
        field: df,
        kind: "date",
        label: `${plainLabel(df)} ${label} (${fmtDate(a)}–${fmtDate(b)})`,
        test: (r) => {
          const d = parseDate(r.data[df.key]);
          return !!d && d >= a && d <= b;
        },
      });
    }
  }
  return { filters, dateField };
}

function better(f: DatasetField, a: number, b: number): boolean {
  return f.higher_is_better === false ? a < b : a > b;
}

function sortValue(f: DatasetField, r: DatasetRecord): number | null {
  if (f.type === "date") return parseDate(r.data[f.key])?.getTime() ?? null;
  return num(r.data[f.key]);
}

function sortRecords(rs: DatasetRecord[], f: DatasetField, reverse: boolean): DatasetRecord[] {
  const dir = f.type === "date" || f.higher_is_better === false ? 1 : -1;
  const d = reverse ? -dir : dir;
  return [...rs].sort((x, y) => {
    const a = sortValue(f, x);
    const b = sortValue(f, y);
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * d;
  });
}

/* ------------------------------------------------------------------ */
/* Table + insights                                                    */
/* ------------------------------------------------------------------ */

function buildTable(ds: Dataset, rows: DatasetRecord[], focus: DatasetField[]): ComparisonTable {
  const compare = ds.fields.filter((f) => f.compare);
  const fields = [...focus.filter((f) => compare.includes(f)), ...compare.filter((f) => !focus.includes(f))];
  const winners: Record<string, string> = {};
  if (rows.length >= 2) {
    for (const f of fields) {
      if (f.higher_is_better === undefined) continue;
      let best: DatasetRecord | null = null;
      let bestV = 0;
      let tie = false;
      let count = 0;
      for (const r of rows) {
        const v = sortValue(f, r);
        if (v === null) continue;
        count++;
        if (best === null || better(f, v, bestV)) {
          best = r;
          bestV = v;
          tie = false;
        } else if (v === bestV) tie = true;
      }
      if (best && count >= 2 && !tie) winners[f.key] = best.key;
    }
  }
  return {
    fields: fields.map((f) => ({ ...f })),
    rows: rows.map((r) => ({ key: r.key, values: Object.fromEntries(fields.map((f) => [f.key, r.data[f.key] ?? null])) })),
    winners,
  };
}

function insight(ds: Dataset, f: DatasetField, rows: DatasetRecord[]): string | null {
  const vals = rows.map((r) => ({ r, v: sortValue(f, r) })).filter((x): x is { r: DatasetRecord; v: number } => x.v !== null);
  if (vals.length === 0) return null;
  const label = `**${f.label.replace(/\s*\(.*?\)/g, "")}:**`;
  if (f.type === "date") {
    const s = [...vals].sort((a, b) => a.v - b.v);
    const first = s[0];
    const d0 = parseDate(first.r.data[f.key]) as Date;
    if (s.length === 1) return `${label} ${nameOf(ds, first.r)}, ${fmtDate(d0)} (${relDays(d0)}).`;
    const rest = s.slice(1).map((x) => {
      const d = parseDate(x.r.data[f.key]) as Date;
      return `${nameOf(ds, x.r)} on ${fmtDate(d)}`;
    });
    return `${label} ${nameOf(ds, first.r)} comes first, on ${fmtDate(d0)} (${relDays(d0)}); then ${joinAnd(rest)}.`;
  }
  if (f.higher_is_better === undefined) {
    return `${label} ${vals.map((x) => `${nameOf(ds, x.r)} ${fmtValue(f, x.r.data[f.key])}`).join(" · ")}.`;
  }
  const s = [...vals].sort((a, b) => (better(f, a.v, b.v) ? -1 : better(f, b.v, a.v) ? 1 : 0));
  if (s.length === 2) {
    const [w, l] = s;
    if (w.v === l.v) return `${label} level at ${fmtValue(f, w.r.data[f.key])} each.`;
    const diff = Math.abs(w.v - l.v);
    let gap: string;
    if (f.type === "currency") gap = f.higher_is_better === false ? `${moneyShort(diff, f.unit)} cheaper` : `${moneyShort(diff, f.unit)} more`;
    else if (/rank/.test(f.key)) gap = `${diff} place${diff === 1 ? "" : "s"} higher`;
    else if (f.unit === "%") gap = `${+diff.toFixed(1)} points ahead`;
    else if (f.type === "rating") gap = `${+diff.toFixed(1)} higher`;
    else gap = `ahead by ${+diff.toFixed(2)}${f.unit ? ` ${f.unit}` : ""}`;
    const order = [s.find((x) => x.r === rows[0]) ?? w, s.find((x) => x.r === rows[1]) ?? l];
    return `${label} ${order.map((x) => `${nameOf(ds, x.r)} ${fmtValue(f, x.r.data[f.key])}`).join(" vs ")}; **${nameOf(ds, w.r)}** is ${gap}.`;
  }
  const [w, ...rest] = s;
  return `${label} best is **${nameOf(ds, w.r)}** (${fmtValue(f, w.r.data[f.key])}), then ${joinAnd(rest.map((x) => `${nameOf(ds, x.r)} (${fmtValue(f, x.r.data[f.key])})`))}.`;
}

function recommendation(ds: Dataset, rows: DatasetRecord[], table: ComparisonTable, focus: DatasetField[]): string {
  const winFields = Object.entries(table.winners);
  if (winFields.length === 0) return `**Recommendation:** they're closely matched on these numbers, so decide on fit: ${joinAnd(rows.map((r) => nameOf(ds, r)))}.`;
  const wins = new Map<string, string[]>();
  for (const [fk, rk] of winFields) wins.set(rk, [...(wins.get(rk) ?? []), fk]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const ranked = [...wins.entries()].sort((a, b) => b[1].length - a[1].length);
  const label = (fk: string) => plainLabel(ds.fields.find((f) => f.key === fk) as DatasetField);
  const [topKey, topFields] = ranked[0];
  const top = nameOf(ds, byKey.get(topKey) as DatasetRecord);
  const focusWinner = focus.map((f) => table.winners[f.key]).find(Boolean);
  const deadline = ds.fields.find((f) => f.type === "date" && /deadline|close/.test(f.key));
  const by = (rk: string) => {
    if (!deadline) return "";
    const d = parseDate(byKey.get(rk)?.data[deadline.key]);
    return d ? ` (${/deadline|registration/.test(deadline.key) ? "register by" : "closes"} ${fmtDate(d)})` : "";
  };
  if (winFields.length === 1) {
    const [fk, rk] = winFields[0];
    const f = ds.fields.find((x) => x.key === fk) as DatasetField;
    const r = byKey.get(rk) as DatasetRecord;
    return `**Recommendation:** go with **${nameOf(ds, r)}** for the best ${plainLabel(f)} (${fmtValue(f, r.data[fk])})${by(rk)}.`;
  }
  if (focusWinner && focusWinner !== topKey && focus.length > 0) {
    const fw = nameOf(ds, byKey.get(focusWinner) as DatasetRecord);
    const fl = plainLabel(focus.find((f) => table.winners[f.key] === focusWinner) ?? focus[0]);
    return `**Recommendation:** if ${fl} matters most, go with **${fw}**${by(focusWinner)}. Overall, **${top}** wins more of the compared metrics (${topFields.length} of ${winFields.length}), led by ${joinAnd(topFields.slice(0, 2).map(label))}.`;
  }
  let text = `**Recommendation:** **${top}** is the stronger pick on these numbers${by(topKey)}: it wins ${topFields.length} of ${winFields.length} compared metrics, including ${joinAnd(topFields.slice(0, 3).map(label))}.`;
  const runner = ranked[1];
  if (runner) {
    const rn = nameOf(ds, byKey.get(runner[0]) as DatasetRecord);
    text += ` **${rn}** leads on ${joinAnd(runner[1].map(label))}, so consider it if that matters more to you.`;
  }
  return text;
}

function sourceNote(ds: Dataset): string {
  return /illustrative|demo purposes|fictional|sample data/i.test(ds.description)
    ? `_From the ${ds.name} dataset (sample data: figures are illustrative)._`
    : `_From the ${ds.name} dataset._`;
}

function contextBits(ds: Dataset, r: DatasetRecord, skip: Set<string>): string[] {
  const out: string[] = [];
  for (const f of ds.fields) {
    if (f.key === ds.key_field || skip.has(f.key) || f.compare || f.type !== "text") continue;
    const v = r.data[f.key];
    if (typeof v === "string" && v && v.split(" ").length <= 4 && !out.some((x) => norm(x) === norm(v))) out.push(v);
    if (out.length >= 3) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

function suggestions(ds: Dataset, records: DatasetRecord[], shown: DatasetRecord[], message: string): string[] {
  const noun = nounOf(ds);
  const out: string[] = [];
  const names = records.map((r) => nameOf(ds, r));
  const shownNames = new Set(shown.map((r) => nameOf(ds, r)));
  const other = names.find((n) => !shownNames.has(n));
  if (shown.length >= 1 && other) out.push(`Compare ${nameOf(ds, shown[0])} vs ${other}`);
  else if (names.length >= 2) out.push(`Compare ${names[0]} vs ${names[1]}`);
  const dateF = ds.fields.find((f) => f.type === "date" && /deadline|close/.test(f.key));
  if (dateF) out.push(`Which ${noun} close this week?`);
  const cheap = ds.fields.find((f) => f.type === "currency" && f.higher_is_better === false);
  if (cheap) {
    const vals = records.map((r) => num(r.data[cheap.key])).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)] ?? 0;
    const l = med / 1e5;
    const lakh = med >= 1e5 ? `₹${l <= 5 ? Math.ceil(l) : Math.ceil(l / 5) * 5} lakh` : `₹${inr(Math.ceil(med / 100) * 100)}`;
    out.push(`Which ${noun} cost under ${lakh}?`);
  }
  const big = ds.fields.find((f) => f.type === "currency" && f.higher_is_better === true);
  if (big) out.push(`Which ${noun} have the biggest ${plainLabel(big)}?`);
  const geo = ["state", "location", "city"].map((k) => ds.fields.find((f) => f.key === k)).find(Boolean);
  if (geo) {
    const counts = new Map<string, number>();
    for (const r of records) {
      const v = r.data[geo.key];
      if (typeof v === "string" && v.split(" ").length <= 3) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const hi = ds.fields.find((f) => f.compare && f.higher_is_better === true && f.type !== "currency");
    if (top) out.push(hi ? `Best ${plainLabel(hi)} in ${top[0]}` : `${noun.charAt(0).toUpperCase()}${noun.slice(1)} in ${top[0]}`);
  }
  const hi = ds.fields.find((f) => f.compare && f.higher_is_better === true);
  if (hi) out.push(`Which has the best ${plainLabel(hi)}?`);
  const m = norm(message);
  return [...new Set(out)].filter((s) => norm(s) !== m).slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function runChat(input: ChatInput): ChatResult {
  const { dataset: ds, records, message } = input;
  const max = Math.max(1, Math.min(10, input.maxRecords ?? 4));
  const noun = nounOf(ds);
  const lower = message.toLowerCase();

  let named: DatasetRecord[] = [];
  if (input.compareKeys?.length) {
    const want = input.compareKeys.map(norm);
    named = want.map((k) => records.find((r) => norm(r.key) === k || norm(nameOf(ds, r)) === k)).filter((r): r is DatasetRecord => !!r);
  }
  if (named.length === 0) named = matchRecords(ds, records, message);

  const focusAll = focusFields(ds, message);
  const { filters, dateField } = named.length ? { filters: [] as Filter[], dateField: null } : detectFilters(ds, records, message);
  // A field used as a date window is a filter, not the thing being compared.
  const focus = focusAll.filter((f) => f !== dateField);
  const reverse = /most expensive|costliest|highest fee|lowest (package|placement|rating)|worst/.test(lower);

  // Follow-up questions ("which is cheaper?") reuse names from earlier turns.
  const followUp = focusAll.length > 0 || /\b(which|it|its|they|them|those|these|both|either|cheaper|better|worse|more|less|vs|versus|compare|difference)\b/.test(lower);
  if (named.length === 0 && filters.length === 0 && followUp && input.history?.length) {
    for (const h of [...input.history].reverse()) {
      if (h.role !== "user") continue;
      const prev = matchRecords(ds, records, h.content);
      if (prev.length) {
        named = prev;
        break;
      }
    }
  }

  const superlative = /\b(best|top|highest|lowest|cheapest|biggest|largest|most|least|maximum|minimum|leading|which|rank|ranked)\b/.test(lower);

  /* ---- nothing understood ---- */
  if (named.length === 0 && filters.length === 0 && focus.length === 0 && !superlative) {
    const compareLabels = ds.fields.filter((f) => f.compare).map(plainLabel);
    const filterLabels = ds.fields.filter((f) => (f.type === "text" || f.type === "list") && f.key !== ds.key_field && !/url|eligib/.test(f.key)).map(plainLabel);
    const examples = records.slice(0, 4).map((r) => nameOf(ds, r));
    const intro = `I couldn't find a specific name or filter in that question. I answer from the **${ds.name}** dataset (${records.length} records), so try one of these:`;
    const bullets = [
      examples.length >= 2 ? `- **Compare by name:** “Compare ${examples[0]} vs ${examples[1]}” (also: ${examples.slice(2).join(", ") || "any record"})` : "- **Compare by name:** mention two or more records",
      compareLabels.length ? `- **Rank by:** ${compareLabels.join(", ")}` : "",
      filterLabels.length ? `- **Filter by:** ${filterLabels.slice(0, 5).join(", ")}${ds.fields.some((f) => f.type === "date") ? ", or dates like “this week” / “this month”" : ""}` : "",
      ds.fields.some((f) => f.type === "currency") ? `- **Budget limits:** “under 10 lakh”, “over ₹2,00,000”` : "",
    ].filter((l) => l !== "");
    const answer = [intro, "", ...bullets].join("\n");
    return { answer, records: [], table: null, suggestions: suggestions(ds, records, [], message), ...NO_SOURCES };
  }

  /* ---- choose records ---- */
  let rows: DatasetRecord[];
  let fromFilter = false;
  let matchedTotal = 0;
  if (named.length) {
    rows = named.slice(0, Math.max(max, Math.min(named.length, 4)));
  } else {
    fromFilter = true;
    let pool = records.filter((r) => filters.every((f) => f.test(r)));
    matchedTotal = pool.length;
    const sortField =
      focus[0] ??
      (dateField && dateField) ??
      ds.fields.find((f) => f.compare && /rank/.test(f.key)) ??
      ds.fields.find((f) => f.compare && f.type === "rating") ??
      ds.fields.find((f) => f.compare && f.higher_is_better !== undefined);
    if (sortField) pool = sortRecords(pool, sortField, reverse);
    rows = pool.slice(0, max);
    if (rows.length === 0) {
      const answer = [
        `No ${noun} match ${joinAnd(filters.filter((f) => !f.hidden).map((f) => f.label))}.`,
        "",
        `The dataset has ${records.length} records. Try widening the filter, for example drop ${filters.length > 1 ? "one of the conditions" : "the condition"} or pick a longer date range.`,
      ].join("\n");
      return { answer, records: [], table: null, suggestions: suggestions(ds, records, [], message), ...NO_SOURCES };
    }
  }

  /* ---- single record ---- */
  if (rows.length === 1) {
    const r = rows[0];
    const name = nameOf(ds, r);
    const bits = contextBits(ds, r, new Set());
    const lines = ds.fields
      .filter((f) => f.key !== ds.key_field && (f.compare || f.type === "list" || f.type === "url"))
      .map((f) => {
        const v = r.data[f.key];
        if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return null;
        let s = fmtValue(f, v);
        if (f.type === "date") {
          const d = parseDate(v);
          if (d) s += ` (${relDays(d)})`;
        }
        return `- **${f.label.replace(/\s*\(.*?\)/g, "")}:** ${s}`;
      })
      .filter((x): x is string => !!x);
    const intro = fromFilter
      ? filters.some((f) => !f.hidden)
        ? `Only one of the ${noun} matches ${joinAnd(filters.filter((f) => !f.hidden).map((f) => f.label))}: **${name}**${bits.length ? ` (${bits.join(" · ")})` : ""}.`
        : `The best match is **${name}**${bits.length ? ` (${bits.join(" · ")})` : ""}${records.length === 1 ? ", the only record in the dataset so far" : ""}.`
      : `**${name}**${bits.length ? ` (${bits.join(" · ")})` : ""}: here's what the dataset says.`;
    const others = records.filter((x) => x.key !== r.key).map((x) => nameOf(ds, x));
    const answer = [
      intro,
      "",
      ...lines,
      "",
      others.length ? `Want a side-by-side view? Ask me to compare ${name} with ${others[0]}${others[1] ? ` or ${others[1]}` : ""}.` : "",
      "",
      sourceNote(ds),
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    const table = buildTable(ds, [r], focus);
    table.winners = {};
    return { answer, records: [r], table, suggestions: suggestions(ds, records, [r], message), ...NO_SOURCES };
  }

  /* ---- comparison (2–4+) ---- */
  const table = buildTable(ds, rows, focus);
  const fieldsForInsights = (focus.length ? [...focus, ...(dateField ? [dateField] : [])] : table.fields.filter((f) => f.higher_is_better !== undefined || f.type === "date").slice(0, 5)).filter(
    (f, i, a) => a.indexOf(f) === i,
  );
  const insights = fieldsForInsights.map((f) => insight(ds, f, rows)).filter((x): x is string => !!x);
  const names = rows.map((r) => `**${nameOf(ds, r)}**`);
  const focusText = focus.length ? ` on ${joinAnd(focus.map(plainLabel))}` : "";
  const parts: string[] = [];
  if (fromFilter) {
    const what = filters.length ? `matching ${joinAnd(filters.filter((f) => !f.hidden).map((f) => f.label))}` : "";
    const sortNote = focus[0] ? `, ranked by ${plainLabel(focus[0])}` : dateField ? `, soonest first` : "";
    parts.push(
      `I found **${matchedTotal} ${noun}**${what ? ` ${what}` : ""}${matchedTotal > rows.length ? ` (showing the top ${rows.length}${sortNote})` : sortNote}:`,
      "",
      ...rows.map((r, i) => {
        const bits = contextBits(ds, r, new Set());
        const extra = [...(focus[0] ? [fmtValue(focus[0], r.data[focus[0].key])] : []), ...(dateField ? [`closes ${fmtValue(dateField, r.data[dateField.key])}`] : [])];
        return `${i + 1}. **${nameOf(ds, r)}**${[...bits, ...extra].length ? ` — ${[...bits, ...extra].join(" · ")}` : ""}`;
      }),
      "",
      "**How they compare**",
      "",
    );
  } else {
    parts.push(`Here's how ${joinAnd(names)} compare${focusText}:`, "");
  }
  parts.push(...insights.map((s) => `- ${s}`), "", recommendation(ds, rows, table, focus), "", sourceNote(ds));
  return { answer: parts.join("\n").replace(/\n{3,}/g, "\n\n"), records: rows, table, suggestions: suggestions(ds, records, rows, message), ...NO_SOURCES };
}
