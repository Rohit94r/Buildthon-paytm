# Client playbooks

Two real client setups, end to end. Both run on the same LayerFlow install, in separate workspaces.

---

## A. News media autopilot: "MarketPulse News"

**The ask:** a news website wants agents that (1) go to the market and collect information, (2) rewrite it in the owner's persona, (3) produce several formats instead of one, and (4) post automatically.

### Setup (≈15 min)

1. **Clients → New client** → name *MarketPulse News*, industry *News & media*, domain `marketpulse.in`. Pick the starter agents below from the catalogue (or add them later from **Agents → Catalogue**).
2. Configure the agents:

| # | Agent (type) | Set this |
| --- | --- | --- |
| 1 | **Market Scraper** (`web_scraper`) | Sources: exchange/regulator press pages, the sector RSS feeds you trust, sitemaps of the sites you follow. Extraction: *AI* with fields `headline, date, key_numbers, companies` |
| 2 | **Trend Monitor** (`news_monitor`) | Keywords: `Sensex, Nifty, RBI policy, IPO, SEBI, rupee` · lookback 12 h · max 20 items |
| 3 | **Persona Rewriter** (`persona_rewriter`) | Persona: *"Ex-banker, 20 years in markets. Direct, numbers first, explains what it means for a retail investor. Short sentences. No hype."* · language English (or Hindi) · 400–600 words |
| 4 | **Format Studio** (`multi_format`) | Formats: article, LinkedIn post, X thread, Instagram caption, newsletter blurb, 60-second video script, WhatsApp message |
| 5 | **SEO Optimizer** (`seo_optimizer`) | Site name, default keywords |
| 6 | **Quality Gate** (`quality_gate`) | Block banned phrases, flag numbers not found in the source, drop duplicates of the last 3 days |
| 7 | **Auto Publisher** (`auto_publisher`) | Connections: Next.js site, LinkedIn page, Telegram channel, X (copy-ready) |

3. **Connections**: Next.js site ([guide](../integrations/nextjs.md)), Telegram bot, LinkedIn.
4. **Pipeline "Daily market desk"**: steps 2 → 1 → 3 → 4 → 5 → 6 → 7, trigger **every 60 minutes**, **Require approval: on** for the first weeks.

### Daily flow

```
every hour ─► Trend Monitor + Market Scraper collect 10–20 fresh items
            ─► Persona Rewriter writes each in the owner's voice (grounded, no invented numbers)
            ─► Format Studio creates 7 formats per story
            ─► SEO + Quality Gate
            ─► Content inbox (approval) ─► one click ─► website + LinkedIn + Telegram; X thread copy-ready
```

Once the owner trusts the output, turn approval off for low-risk formats, or keep it on and approve from a phone.

---

## B. College portal: "CollegeCompass" (CollegeDunia-style)

**The ask:** agents that collect college data and add it to the website automatically, plus a real-time AI that lets anyone compare colleges.

### Setup (≈20 min)

1. **Clients → New client** → *CollegeCompass*, industry *Education*. Create a **Colleges** dataset (Data → Datasets → New).
2. Give the **Colleges** dataset fields such as: name, city, state, type, NIRF rank, total fees (₹), average package (LPA), highest package (LPA), placement rate (%), rating, courses, entrance exams, website. Edit the fields freely, e.g. add `hostel_fees` or `cutoff_rank`.
3. Agents:

| Agent (type) | Set this |
| --- | --- |
| **College Data Collector** (`dataset_builder`) | Listing pages that link to college pages (official sites, public ranking pages you're allowed to use) → follow up to N detail pages → AI-extract the dataset fields → upsert by `name` |
| **Fees & Placement Updater** (`dataset_builder`) | Official fee/placement report URLs per college; runs weekly; updates only those fields |
| **Admission News Monitor** (`news_monitor`) | `JEE Main, JoSAA, CUET, counselling, cutoff` |
| **Article Writer** (`persona_rewriter`) | Persona: *"Friendly counsellor for students and parents. Clear, exact dates and steps."* |
| **SEO Optimizer** + **Publisher** | Publish to the WordPress blog or Next.js site |
| **Compare Assistant** (`comparison_assistant`) | Dataset: Colleges · instructions: *"Always show fees, average package, placement rate and NIRF rank. Mention that data is from official sources and the update date."* |

4. Pipelines: **Weekly college refresh** (collector → updater, every 7 days) and **Admission news → blog** (every 6 h, approval on).
5. Website:
   - College list and detail pages read `GET /api/public/v1/datasets/colleges/records` ([Next.js](../integrations/nextjs.md) or the WordPress `[layerflow_table]` shortcode). Pages update by themselves when agents refresh the data.
   - The real-time comparison assistant: one script tag ([embed-widget.md](../integrations/embed-widget.md)) or `[layerflow_assistant dataset="colleges"]`.

### What a visitor sees

> **"Compare IIT Bombay vs BITS Pilani for CSE, fees and placements"**
>
> A side-by-side table (fees, average and highest package, placement rate, NIRF rank) with the better value highlighted in each row, computed directly from the dataset. Below it, a short plain-language answer and three follow-up suggestions.

The table never hallucinates: numbers come straight from the records. The model only writes the explanation, and it only sees those records.

---

## C. Hackathon listings: "HackFinder"

**The ask:** a hackathon website founder wants one agent to find available hackathons across the web, a second to clean and sort them, a third to rewrite each listing, with everything appearing on the site automatically.

### Setup (≈15 min)

1. **Clients → New client** → *HackFinder*, industry *Events*. Activate the agents below from the catalogue: every one of them is a generic agent anyone can use.

| # | Agent (type) | Set this |
| --- | --- | --- |
| 1 | **Hackathon Scraper** (`web_scraper`) | Sources: public hackathon listing pages, organiser sitemaps/RSS, university event pages. Extraction *AI*: `name, organizer, start_date, end_date, registration_deadline, mode, location, prize_pool, themes, eligibility, url` |
| 2 | **Hackathon Sorter** (`data_transform`) | Dedupe by `url` and `data.name` · filter `registration_deadline` *after today* · sort by `registration_deadline` ascending · AI-categorize into AI / Web3 / Fintech / Climate / Student / Open |
| 3 | **Listing Rewriter** (`persona_rewriter`) | Persona: *"Clear, exciting, student-friendly. Exact dates, prizes and eligibility. Never invent details."* · 80–150 words |
| 4 | **Save to Hackathons** (`dataset_builder`, mode *pipeline items*) | Target dataset: Hackathons, key field `name` |
| 5 | **Hackathon Finder** (`comparison_assistant`) | Dataset: Hackathons, e.g. *"Which online AI hackathons close this month? Compare prizes."* |
| 6 | (optional) **Format Studio** + **Auto Publisher** | Weekly "Top hackathons" LinkedIn/Instagram/Telegram posts |

2. **Pipeline "Daily hackathon sweep"**: 1 → 2 → 3 → 4, every 12 hours. A run log reads like *scraped 42 → 18 after dedupe/open-only/sort → 18 rewritten → 18 saved*.
3. **Website**: list pages read `GET /api/public/v1/datasets/hackathons/records?sort=registration_deadline:asc` (Next.js `getRecords("hackathons")` or WordPress `[layerflow_table dataset="hackathons"]`), plus the assistant widget with `data-dataset="hackathons"`.

The same chain (**collect → clean/sort → rewrite → save/publish**) works for job boards, scholarships, real-estate listings, events, courses or product catalogues: swap the sources and fields.

---

## Adding the next client

Every new client follows the same loop: **pick agents from the catalogue → adjust → connect site → run → approve**. No new code and no new deployment. If a client needs something no agent type covers, start with a `custom_llm` agent (your own prompt + output fields) before writing code.
