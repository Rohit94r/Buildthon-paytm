# Final Presentation Script — LayerFlow / Aentazo / Agentsy + LiveDesk

Stage-ready. Say it in this order. Total: 6–8 min + 90 sec demo.

Rule: LayerFlow = agent platform. LiveDesk = research desk inside it. SerpApi + You.com = two sponsor capabilities in one runtime.

---

## Slide 0 — Open (15 sec)

Say: "Judges, good morning. A student at 2 a.m., a freelancer with a client brief, a founder tracking competitors — same problem: fresh, checkable research, and five tabs open. We built one platform where one question becomes structured evidence, a cited answer, and a saved agent run."

Show: **LayerFlow / Aentazo · LiveDesk** — *One question. Two sponsors. Every answer backed by sources you can open.*

Land: "Ye chatbot nahi — ek working research desk hai, andar ek full agent platform ke."

---

## Slide 1 — Problem (45 sec)

Say: "Students, freelancers and founders need research that is fresh and verifiable. Today they open Google, click five links, copy into a doc, and still cannot trust the numbers. A normal AI chatbot gives a smooth paragraph — but no live source, no date, no table, nothing reusable."

Show: 1) Stale answers — model memory. 2) Five-tab research. 3) No proof — no clickable citations. 4) No workflow — research dies in chat.

Land: "Gap search nahi hai. Gap hai trust aur workflow."

---

## Slide 2 — Insight (20 sec)

Say: "Search alone gives links without an answer. Synthesis alone gives an answer without proof. Research needs both — plus a place where the result becomes reusable work."

Show: `STRUCTURED FACTS + CITED ANSWER + SAVED STATE = TRUSTWORTHY RESEARCH`

---

## Slide 3 — Solution (60 sec)

Say: "We built LayerFlow — a multi-tenant agent platform with 26 agent kinds, 50 presets, pipelines, datasets, an assistant, run logs and SDKs. Inside it is LiveDesk: ask one question, SerpApi collects structured signals from six Google engines, You.com writes a cited answer, and the platform saves it as a real pipeline run, a dataset record and assistant context."

Show flow:
```
Question -> /livedesk/research
  |- SerpApi: Web, News, Jobs, Shopping, Maps, Scholar
  |- You.com: Answer + Web results + citations
  => answer + [1][2] sources + per-engine cards
  => pipeline run (5 steps) + dataset + events + audit
  => follow-up assistant with live sources ON
```

Land: "Ek sawaal, do sponsors, ek response, aur poora platform us evidence ka use karta hai."

---

## Slide 4 — USP (30 sec)

Say: "Other teams demo an API call. We demo an API call that changes the product. Evidence does not stop at the screen — it becomes an agent run, a dataset row, an audit entry and the assistant's next answer. That is a platform, not a wrapper."

Show: **Two sponsor tracks, one evidence model, full platform reuse.**
- Sponsor calls are tools and agent kinds, not UI decoration.
- Researcher, News Monitor, SEO Auditor opt into the same live evidence.
- Every paid-for result is saved as platform state.

---

## Slide 5 — Why SerpApi + Why You.com (45 sec)

Say: "SerpApi is my evidence pipeline: machine-readable rows — title, snippet, publisher, date, price, rating, real URLs — across six engines. That becomes comparisons and agent inputs. You.com is my cited narrator: its Answer API gives a readable brief with numbered citations we render as clickable sources."

| | SerpApi | You.com |
| --- | --- | --- |
| Role | Evidence pipeline | Cited narrator |
| Gives | Structured facts, 6 engines | Answer + `[n]` citations |
| Used in | LiveDesk cards, datasets, researcher, news monitor, auditor | LiveDesk answer, assistant, cited evidence |
| Value | Proof you can compare | Explanation you can verify |

Land: "SerpApi ke bina table nahi. You.com ke bina verification nahi."

---

## Slide 6 — Stopping Hallucination (45 sec)

Say: "Hallucination is a confident falsehood — an invented number, date or link. Four layers: evidence before generation; strict prompt — use only these sources, copy numbers exactly, refuse if absent; a code check that every citation maps to a real URL; low temperature for factual work. If evidence is missing, we say 'checked sources me jawab nahi mila' — we do not guess."

Show: 1. Evidence first. 2. Strict prompt. 3. Citation check. 4. Low temperature 0–0.2.

Land: "Hum model ko yaad nahi karate — dekhate, cite karate aur refuse karate hain."

---

## Slide 7 — Numbers I Can Defend (30 sec)

Say: "I don't quote fake market size. These are the numbers I can defend."

- **26** agent kinds · **50** catalogue presets
- **4** sponsor tools · **2** sponsor agent kinds + **3** ordinary agents wired
- **6** SerpApi engines · **7** LiveDesk agents · **5** pipeline steps
- **148** passing backend tests · **~4s** live latency · **10** clickable citations
- **5 plans**: Free, Rs 1,999, Rs 4,999, Rs 14,999, custom

If asked "what is the claim?": "Hypothesis, not claim: 1,000 workspaces x Rs 1,999 = about Rs 2.4 crore ARR. Validate with 100 interviews."

---

## Slide 8 — Live Demo (90 sec) — DO THIS

Open `http://localhost:3000/livedesk`. If pill says Demo mode, reload once — boot script detects live keys and switches.

1. Point at pill: **Sponsor keys connected**.
2. Question: *AI agent startup funding in India this month* — Web + News, 5 results.
3. Click **Run research**: "Both sponsors are being called in parallel."
4. Open a citation: "Real live URL, not generated."
5. Show SerpApi cards: "Publisher, date, snippet, link."
6. Click **saved as run**: "Five steps, Succeeded, real events."
7. Assistant with **live sources on**: "What should we research first about AI agents in India?"
8. Catalogue → `SerpApi` / `You.com` agent kinds.
9. Workspaces → LiveDesk: 7 agents, 5 steps, Research Queue dataset.

Land: "Network tab — real sponsor calls. Run page — the answer became platform state."

---

## Slide 9 — Agents, Not Chatbots (25 sec)

| Chatbot | Agent |
| --- | --- |
| Answers from memory | Calls live tools |
| One reply | Multi-step pipeline |
| No log | Every step in run log |
| No verification | Citations + refusal |

Land: "Chatbot bolta hai, agent karta hai."

---

## Slide 10 — Business (30 sec)

Say: "Monetisation is per workspace: Free, Starter, Pro, Business, Enterprise. Usage limits are enforced in code; checkout is the remaining short integration. The saved run you just saw is the unit of value a customer pays for."

Honest line: "Billing is not live yet — I won't pretend. Entitlements work; payment gateway is next."

---

## Slide 11 — Challenges & Next (30 sec)

**Solved:** DB schema isolation · Neon pooler `search_path` fix · LiveDesk crash · partial-outage degradation · demo-mode auto-exit so sample data never shows while API is live.

**Next:** checkout · grounding eval badge · real production model keys · Next.js security upgrade · 100-customer validation.

---

## Slide 12 — Closing (20 sec)

Say: "We did not build a chatbot. We built an agent platform where live evidence becomes a verifiable, reusable workflow. SerpApi supplies structured facts, You.com the cited narrative, and LayerFlow turns both into runs, datasets and assistant answers a real user can trust. Students, freelancers and founders don't need another tab — they need one desk that proves its answers."

Show: **One question. Two sponsors. One saved, cited, reusable answer.**

Hinglish closer: "SerpApi facts, You.com sources, LayerFlow kaam. Ek sawaal — aur poora platform us evidence ke saath chal jaata hai."

---

## Appendix A — Pocket Q&A

| Question | Answer |
| --- | --- |
| What integrated? | SerpApi search.json + Extract; You.com /v1/search + /v1/answer. 4 tools, 2 agent kinds, 3 ordinary agents. |
| SerpApi main use? | Structured evidence pipeline for rows, comparisons, agent inputs. |
| You.com main use? | Cited readable answer with numbered sources. |
| Why both? | Search without synthesis is noise; synthesis without sources is a guess. |
| Stop hallucination? | Evidence first -> strict prompt -> citation validator -> low temperature -> refuse. |
| Build an agent? | One job -> tool allowlist -> strict prompt -> fixed output -> guardrails -> tests. |
| Data real? | Yes — status pill, network tab, real URLs. Sample rows labelled, overwritten by real runs. |
| Not done? | Checkout, real model keys in prod, larger eval set, Next.js upgrade. |
| Market claim? | Hypothesis: 1,000 x Rs 1,999 = Rs 2.4 Cr ARR. |

## Appendix B — Stage check

```
curl -s http://127.0.0.1:8000/api/v1/livedesk/status
curl -s -X POST http://127.0.0.1:8000/api/v1/livedesk/research \
  -H 'Content-Type: application/json' -H 'X-Workspace: livedesk' \
  -d '{"query":"AI agent startup funding in India this month","engines":["google","google_news"],"location":"India","count":5}'
```

Expect: `degraded:false`, `answer.provider:"you.com"`, real serpapi collections, clickable citations, `saved:true` with `run_id`.

Web: `cd apps/web && pnpm dev` -> `/livedesk` -> **Sponsor keys connected**.

---

Final memory line: "SerpApi facts deta hai, You.com sources ke saath jawab, LayerFlow usse run, dataset aur assistant bana deta hai — proof ke saath."
