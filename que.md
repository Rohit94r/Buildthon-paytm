# `que.md` — Judge Question Bank + Product One-Pager + Crazy-Level Speech Upgrade

> Use this file the night before the pitch. It contains: **what the product is**, **problem → solution → USP**, **end-to-end flow**, **numbers you can defend**, **every likely judge question with a crisp answer**, and **how to level up the speech/deck**.
>
> **Positioning rule (never break):** One product. **LayerFlow / Aentazo / Agentsy** is the agent platform. **LiveDesk** is a research desk inside it. **SerpApi + You.com** are platform capabilities used by real agents. Not two apps. Not a wrapper.

---

## 0. Read this first — the 5 rules of answering

1. **Answer in 15–30 seconds**, then stop. Let them ask follow-up.
2. **One line, one idea.** No long setup.
3. **Numbers only if you can defend them.** Fake TAM = instant trust loss.
4. **Admit what is not done.** Honesty > fake perfection.
5. **Always come back to the product:** “…aur ye platform me save hota hai.”

**Golden close line:**
> “Ye sirf API call nahi — ek real agent run hai jo dataset, events aur audit me save hota hai.”

---

## 1. Product one-pager (30-second memory)

### What it is
**LayerFlow (Aentazo / Agentsy)** = multi-tenant AI agent platform: FastAPI + Next.js, **26 agent kinds**, **50 ready-made presets**, pipelines, datasets, run logs, assistant chat, activity feed, public API + TS/Python SDKs.

**LiveDesk** = the research desk inside that platform. Ask one question → SerpApi collects structured signals → You.com writes a cited answer → result becomes a **real pipeline run + dataset record + assistant context**.

### Problem
Indian **students, freelancers and early-stage founders** need fresh, checkable research. Today they:
- switch 5 tabs,
- copy-paste into docs,
- get stale model answers,
- have no citations they can open,
- and cannot turn the research into a repeatable workflow.

### Solution
One question → two sponsors in parallel → one evidence response → saved as platform state.

```
Question ──► /livedesk/research
                ├── SerpApi: Web/News/Jobs/Shopping/Maps/Scholar (6 engines)
                └── You.com: cited answer + web results
                          ▼
              answer · [n] citations · per-engine cards
                          ▼
        pipeline run (5 steps) · dataset record · events · audit
                          ▼
              follow-up assistant with live sources ON
```

### USP (one line)
> **“Do sponsor tracks, one flow. SerpApi gives structured evidence, You.com gives the cited narrator, and the platform turns both into reusable agent work.”**

### What it is NOT
- ❌ Not two products joined together.
- ❌ Not a chatbot with links.
- ❌ Not fake data shown as live. Sample rows are clearly labelled; real runs overwrite them.

---

## 2. End-to-end — explain like a story

1. User opens **LiveDesk** inside LayerFlow, sees **“Sponsor keys connected”**.
2. Types/picks a question, toggles **Web + News**, count 5.
3. `POST /api/v1/livedesk/research` fires **SerpApi engines and You.com Answer API in parallel** (`asyncio.gather`).
4. SerpApi returns normalized hits: title, snippet, URL, source, date, engine.
5. You.com returns `answer`, `citations[]`, `results.web[]`. If citations missing, we promote result URLs to links — **no answer goes unsourced**.
6. Response returns: `answer`, `sources`, `collections`, `evidence`, `degraded`, `latency_ms`, `run_id`, `record_id`.
7. Backend persists: `PipelineRun` (5 steps, `succeeded`), `ExecutionEvent`s (`step.finished`×5 + `run.finished`), `AuditLog`, and upserts `research_queue` dataset row.
8. UI shows **“saved as run”** → opens run detail page.
9. **Follow-up assistant** reads the saved record and calls both sponsors again with `live_sources: true`.
10. Run appears in **Activity**, **Runs**, **Datasets** — same objects every other agent uses.

**Say it in Hinglish:**
> “Ek sawaal aata hai, do sponsors parallel chalte hain, ek cited answer aata hai, aur wo answer platform ke andar run, dataset aur assistant ban jata hai. Agla sawaal usi evidence se answer hota hai.”

---

## 3. Numbers you can say out loud (defensible card)

| Number | What it is | How to say it |
| --- | --- | --- |
| **26** | agent kinds in the platform | “26 agent kinds, same runtime.” |
| **50** | ready-made presets | “50 catalogue presets install like apps.” |
| **4** | sponsor tools | `serpapi.search`, `serpapi.extract`, `you.search`, `you.answer` |
| **2** | sponsor agent kinds | `serpapi_search`, `you_research` |
| **3+** | ordinary agents using live evidence | `researcher`, `news_monitor`, `site_auditor` |
| **6** | SerpApi engines | Web, News, Jobs, Shopping, Maps, Scholar |
| **7** | agents in seeded LiveDesk desk | Collector, Monitor, Researcher, Auditor, Answer Desk + 2 more |
| **5** | steps in LiveDesk pipeline | Collect → Monitor → Research → Audit → Answer |
| **10** | labelled sample research questions | “Fixtures for offline demo; real runs overwrite them.” |
| **148** | passing backend tests | “148 tests pass, typecheck clean, production build works.” |
| **~4 s** | observed live research latency | “Live call around 4 seconds with 2 engines + answer.” |
| **10** | citations in verified browser run | “10 clickable sources from the live run.” |
| **5 plans** | pricing tiers | ₹0 / ₹1,999 / ₹4,999 / ₹14,999 / custom |

### When they ask “what is the claim of the number?” / “perfect number?”
**Say:**
> “Main fake market size nahi bolta. Mere paas teen tarah ke numbers hain:
> **platform numbers** — 26 kinds, 50 presets, 148 tests;
> **live numbers** — ~4 second latency, 10 citations, 5 steps;
> **business hypothesis** — 1,000 paid workspaces × ₹1,999 = ₹2.4 crore ARR.
> Ye last wala *assumption* hai, *claim* nahi. Main odisha/mumbai ke 100 students se survey karke validate karunga.”

**Never say:** “We will get 1 million users” without evidence.

---

## 4. The question bank (with answers)

### A. Product & positioning

**Q: Exactly what have you built?**
> “One platform — LayerFlow, presented as Aentazo/Agentsy. LiveDesk is its research desk. It has 26 agent kinds, pipelines, datasets, an assistant, and two sponsor capabilities inside the same runtime. I built the platform; LiveDesk is a desk inside it.”

**Q: Is LiveDesk a separate app?**
> “No. Same workspace system, same agents, same run logs, same permissions. There is no second codebase for LiveDesk.”

**Q: Why the name confusion — LayerFlow, Aentazo, Agentsy?**
> “LayerFlow is the repo/platform name. Aentazo/Agentsy is how I present the agent product on stage. LiveDesk is a desk inside it — like a newsroom desk or SEO desk.”

**Q: What are the main features?**
> “Agent catalogue, pipelines with schedules and approvals, datasets with comparison tables, assistant chat, run logs/events, workspaces and permissions, connections for publishing, scoped public API, SDKs, and the LiveDesk research desk. Sponsor tools are first-class inside all of it.”

**Q: What is the working type?**
> “Event-driven async. A pipeline step calls an agent; the agent calls tools; every tool call, model call and step transition writes an event. Runs are resumable/cancellable and visible live in the UI.”

---

### B. Problem / customer / market numbers

**Q: Who is this for?**
> “Three segments: Indian students doing projects and assignments, freelancers who need quick research for clients, and early-stage founders tracking markets and competitors. All three want automation but cannot afford a research team.”

**Q: What exact problem are you solving?**
> “Freshness and traceability. They need today’s data with links they can open, and they need the output to become a table, a report or a scheduled workflow — not a paragraph they retype.”

**Q: How many users do you have?**
> “This is a buildathon prototype, so I am not claiming a user count. What I can show is a working seeded LiveDesk workspace with 7 agents, 5 steps and 10 labelled sample questions — and real sponsor calls that save real runs.”

**Q: What is your market claim?**
> “Bottom-up hypothesis, not a fake TAM: 1,000 paid workspaces × ₹1,999/month = about ₹2.4 crore ARR. Validation is the next step — 100 interviews with students and freelancers.”

**Q: What problem are YOU facing right now?**
> “Honest list: checkout/billing is not wired yet (limits are enforced in code); the model provider is mock locally, so real-model keys are needed for production; Next.js prints a security advisory on build; and I want a larger hallucination eval set. The DB pooler issue and LiveDesk crash are already fixed.”

---

### C. Sponsors — SerpApi + You.com

**Q: What did you integrate?**
> “Two sponsor tracks. SerpApi: 6 search engines plus Extract API. You.com: Web Search and Answer API. They appear as 4 tools, 2 dedicated agent kinds, and opt-in live evidence inside `researcher`, `news_monitor` and `site_auditor`.”

**Q: What is SerpApi’s main use in your product?**
> “The **evidence pipeline**. It turns a question into structured, comparable rows — title, snippet, date, publisher, price, rating — that become dataset records and agent inputs.”

**Q: What is You.com’s main use?**
> “The **cited narrator**. The Answer API writes a readable brief with numbered citations and web results. We render those as clickable sources and feed them to the assistant.”

**Q: Why both? Why not one?**
> “Search alone gives links without an answer. Synthesis alone gives an answer without a checkable table. Research needs both. We normalized both into one evidence response, not two separate demos.”

**Q: Are the keys in the frontend?**
> “No. Server-side only, from `.env`, with aliases (`SERPAPI_KEY`, `YDC_API_KEY`). Never in requests, cache keys, logs or responses.”

**Q: What if a key is missing?**
> “Deterministic labelled sample data with `provider='demo'` and a **sample** badge. We never present sample as live.”

**Q: What if one sponsor is down?**
> “Per-call degradation. `degraded` flags on the response, answer and each collection. The other sponsor still works. Failed calls are never cached, so a retry recovers.”

**Q: Credit usage?**
> “One You.com answer per run, 5-minute cache, 12s timeouts, answer results reused as links, mocked HTTP in tests. Tests spend zero credits.”

**Q: SerpApi bonus credits?**
> “Mumbai: `serpapi.com/beyond9to5mumbai500` · Bengaluru: `serpapi.com/beyond9to5blr`.”

---

### D. Hallucination & trust

**Q: What is hallucination?**
> “Confident falsehood. The model invents a number, date, URL or quote that is not in the evidence — and says it smoothly.”

**Q: How do you stop it?**
> “Four layers:
> 1) evidence first — SerpApi/You.com sources before generation;
> 2) strict prompt — use only sources, copy numbers exactly, refuse if absent;
> 3) deterministic check — every `[n]` must match a real source URL;
> 4) low temperature — 0–0.2 for factual agents.
> Plus an explicit refusal: ‘checked sources me jawab nahi mila.’”

**Q: Which improvement gives the most impact?**
> “Grounded generation. If the model never speaks from memory, most hallucinations disappear. Second is the citation validator — it is code, not luck.”

**Q: Do you fine-tune?**
> “Not for the hackathon. Fine-tuning teaches behaviour, not freshness; retrieval and verification give 80% of the win at 10% of the cost. It is on the roadmap.”

**Q: How do you measure hallucination?**
> “Eval set: questions with unsupported claims, stale dates and fake URLs. We assert the agent refuses or flags them. We have 20 eval cases today; I am adding 3 hallucination-specific ones.”

**Q: Can the model still lie?**
> “Yes, no system is perfect. That is why we show sources, timestamps, degraded flags and a ‘needs review’ path instead of hiding uncertainty.”

**Master 15-second answer:**
> “Hallucination = model ka confident jhooth. Hum pehle real evidence laate hain, phir strict prompt se sirf usi se bolate hain, har [n] real URL se match karte hain, aur source na mile to refuse karte hain. Model yaad se nahi bolta.”

---

### E. Agents & architecture

**Q: How did you build an agent?**
> “Six steps: 1) define one job; 2) allowlist tools; 3) write strict system prompt; 4) fixed output schema; 5) add refusal + flags; 6) test success/no-evidence/degraded. In code: one module in `platform/kinds/`, register in `RUNNERS`, describe in `catalog.py`, allow tools in `tools/__init__.py`, optional blueprint preset, then tests.”

**Q: How do you improve an agent?**
> “Measure first: wrong answers, missing citations, latency. Then tighten prompt, narrow tools, lower temperature, add validator, add eval cases. Improve the loop, not just the model.”

**Q: Why build agents at all?**
> “Chatbot jawab deta hai, agent kaam karta hai. Agent tools use karta hai, multi-step workflow chalata hai, har step log karta hai, aur bina source ke guess nahi karta.”

**Q: How many agents did you build?**
> “26 kinds in the platform, 50 presets, and a seeded LiveDesk desk with 7 agents in a 5-step pipeline.”

**Q: Does the agent have memory?**
> “Workspace-scoped state: datasets, run items and events. The assistant reads the saved research record — that is short-term grounded memory, not unbounded chat history.”

**Q: Can I add my own agent?**
> “Yes — install a preset from Catalogue, configure it, add it to a pipeline. For a custom kind, add one `run(ctx, cfg, items)` module and register it.”

**Q: Do you use a model for everything?**
> “No. SerpApi and You.com agents are model-free and deterministic. We use the model only where synthesis helps — research briefs, assistant answers, rewriting — with low temperature.”

---

### F. Demo / working / features

**Q: Show me the working.**
> 90-second script (also in `paytm.md`):
> 1. Open `/livedesk` → point at **Sponsor keys connected**.
> 2. Preset *AI agent startup funding in India this month*, Web + News, 5 results.
> 3. **Run research** → “both sponsors are being called now.”
> 4. Open a `[n]` citation → real URL.
> 5. Show SerpApi cards → publisher, date, snippet, link.
> 6. Click **saved as run** → 5 steps, `Succeeded`.
> 7. Follow-up assistant with live sources → cited answer.
> 8. Catalogue → search `SerpApi`/`You.com` → installed agent kinds.
> 9. Workspaces → LiveDesk → 7 agents, 5 steps, Research Queue.

**Q: Is this real data?**
> “Real endpoints, real request shapes, real responses. Watch the network tab. Sample data appears only with no key or failure, and it is labelled.”

**Q: How fast is it?**
> “Verified live run: ~4 seconds for two SerpApi engines plus the You.com answer, with 10 citations.”

**Q: What if the internet is slow in the hall?**
> “We have demo mode: `NEXT_PUBLIC_DEMO_MODE=true` renders the same screens with labelled sample data. I will show live first, then fallback only if needed.”

---

### G. Business & pricing

**Q: How do you make money?**
> “SaaS per workspace. Plans: Free ₹0, Starter ₹1,999, Pro ₹4,999, Business ₹14,999, Enterprise custom. Limits are enforced in code today; checkout is the remaining short integration.”

**Q: Are you charging today?**
> “No live checkout — I will not pretend. Entitlements work; payment gateway is next.”

**Q: Who pays and why?**
> “Newsrooms and publishers for cited research; founders and analysts for daily market signals; colleges for admissions/event research; agencies for SEO and content workflows.”

**Q: Sponsor cost?**
> “Clients can bring keys, or we margin the credits. Cache + one answer per run keeps cost predictable.”

---

### H. Challenges & next steps

**Q: Biggest technical challenge?**
> “Shared Neon database: legacy tables were in `public`. We isolated the product into a `buildthon` schema. Neon’s transaction pooler drops session state, so we set `search_path` on every checkout, not just connect. That fixed intermittent 500s.”

**Q: What did you fix during testing?**
> “LiveDesk crash from unnormalized demo response, admin membership in all workspaces, partial-outage degradation, You.com malformed shapes, and the pooler issue.”

**Q: What is next?**
> “1) Razorpay/Stripe checkout, 2) hallucination eval suite + grounding badge, 3) real model keys in production, 4) Next.js security upgrade, 5) 100-customer validation.”

**Q: What did you personally build?**
> “The platform architecture, agent runtime, sponsor tool layer, LiveDesk desk and persistence flow, seed workspace, pitch docs, and the test suite. I used the sponsors exactly as the APIs document them.”

---

### I. Quick-fire tricky ones

| Question | One-line answer |
| --- | --- |
| “Is it just a UI over APIs?” | “No — the APIs are tools inside a runtime with 26 kinds, pipelines, datasets, permissions and run logs.” |
| “Why not use Google directly?” | “Google gives links; we need normalized rows plus a cited answer plus saved state.” |
| “Can judges use their own keys?” | “Yes — server-side env vars, documented in `.env.example`.” |
| “Is data cached forever?” | “Five minutes, key excludes secrets, failed calls never cached.” |
| “What about prompt injection from scraped pages?” | “Source text is wrapped as untrusted; extraction uses `temperature=0` and schema validation.” |
| “Do you publish automatically?” | “Only through explicit approval steps; nothing goes live without a human gate.” |
| “Are keys committed?” | “No. `.env` is gitignored; rotate the pasted keys after the event.” |

---

## 5. Speech upgrade — “crazy level”

### 60-second opener (use this instead of “Hi, I built…”)
> “Judges, imagine a student at 2 a.m. with an assignment due, a freelancer with a client brief, and a founder tracking competitors. All three have the same problem: they need **fresh, checkable research**, and they have **five tabs open**. We built one platform where one question becomes structured evidence from SerpApi, a cited answer from You.com, and a saved agent run that the next question can reuse. Not a chatbot — a working research desk inside an agent platform.”

### Power lines to drop naturally
- “Search without synthesis is noise; synthesis without sources is a guess.”
- “We don’t make the model remember — we make it look, cite, and refuse.”
- “A paid-for API call is never thrown away; it becomes state.”
- “Other teams demo an API call. We demo an API call that changes the product.”
- “Fake accuracy is worse than honest uncertainty.”
- “Ek sawaal, do sponsors, ek response, aur poora platform us evidence ka use karta hai.”

### Transitions between slides
- Problem → Insight: *“So the gap is not search. The gap is trust + workflow.”*
- Insight → Product: *“That is why we built one evidence model, not two demos.”*
- Sponsors → Platform: *“And here is the part judges usually don’t see — the evidence doesn’t stop at the UI.”*
- Demo → Business: *“The same run you just saw is the unit of value a customer pays for.”*

### Deck add-on slides (insert into `paytm.md`)
1. **“Numbers I can defend”** — the table from Section 3.
2. **“Hallucination → Grounding”** — 4-layer diagram, refusal line.
3. **“Why agents, not chatbots?”** — comparison table from Section 4E.
4. **“How to build an agent in 6 files”** — code map.
5. **“Challenges we solved / what’s next”** — honest roadmap slide.

### Stage delivery
- Pause after the one-line pitch. Let it land.
- When showing a citation, **actually click it**.
- When showing the run, say the word **“real”** twice: real run, real events.
- If you don’t know a number, say: *“I won’t guess — here is what I can defend.”* Judges respect that.

---

## 6. One-page cheat sheet (print this)

**Product:** LayerFlow/Aentazo/Agentsy platform + LiveDesk research desk.  
**Problem:** students, freelancers, early founders need fresh + checkable + reusable research.  
**Solution:** SerpApi evidence + You.com cited answer → saved run + dataset + assistant.  
**USP:** two sponsors, one flow, full platform reuse.  
**Numbers:** 26 kinds · 50 presets · 4 tools · 2 kinds · 3 agents · 6 engines · 7 desk agents · 5 steps · 10 sample questions · 148 tests · ~4s · 10 citations.  
**Hallucination:** evidence first → strict prompt → citation check → low temp → refuse.  
**Build agent:** one job → tools → prompt → schema → guardrails → tests.  
**Business:** ₹0/1,999/4,999/14,999/custom; limits in code; checkout next.  
**Honesty:** billing not live; model mock locally; Next.js advisory; eval suite growing.  
**Close:** “Ek sawaal, do sponsors, ek response — aur poora platform us evidence ka use karta hai.”

---

## 7. Final judge line

> **“We did not build a chatbot. We built an agent platform where live evidence becomes a verifiable, reusable workflow. SerpApi supplies structured facts, You.com supplies the cited narrative, and LayerFlow turns both into runs, datasets and assistant answers that a real user can trust.”**
