# Agent guide

Every agent in the LayerFlow catalogue (48 agents, catalogue v3.0.0), in plain language.
Activate one from **Agents → Catalogue**, fill in the highlighted fields, press **Test**, then use it alone or chain it with others in a workflow.

> Generated from `config/catalog/agents.json` by `scripts/sync_catalog.py`. Edit the JSON, not this file.

**Chaining tip:** most useful setups follow *collect → clean/sort → write/compare → save/publish/alert*. Any agent can follow any other.

| Category | Agents |
| --- | --- |
| Collect data | [Smart Web Scraper](#smart-web-scraper) · [URL Collector](#url-collector) · [Site Crawler](#site-crawler) · [Table Extractor](#table-extractor) · [Structured Data Reader](#structured-data-reader) · [Product & Price Scraper](#product-price-scraper) · [Job Listings Collector](#job-listings-collector) · [Event & Hackathon Finder](#event-hackathon-finder) · [Review Collector](#review-collector) · [PDF & Document Reader](#pdf-document-reader) · [Page Change Watcher](#page-change-watcher) |
| Images | [Image Scraper](#image-scraper) · [Open-License Image Finder](#open-license-image-finder) · [Image Alt-Text Writer](#image-alt-text-writer) |
| Research & news | [News Discovery](#news-discovery) · [Topic & Feed Monitor](#topic-feed-monitor) · [Research Analyst](#research-analyst) · [Data Finder](#data-finder) · [Fact Checker](#fact-checker) |
| Sales & leads | [Business Contact Finder](#business-contact-finder) · [Email Drafter](#email-drafter) · [Lead Qualifier](#lead-qualifier) · [CRM Sync](#crm-sync) |
| Clean, compare & save data | [College / Institution Researcher](#college-institution-researcher) · [Data Cleaner & Sorter](#data-cleaner-sorter) · [Sentiment & Topic Tagger](#sentiment-topic-tagger) · [Comparison Builder](#comparison-builder) · [Change Detector](#change-detector) · [Dataset Saver](#dataset-saver) |
| Write & create | [Content Writer](#content-writer) · [Summarizer](#summarizer) · [Translator](#translator) · [Multi-format Creator](#multi-format-creator) · [Social Caption Writer](#social-caption-writer) · [Newsletter Builder](#newsletter-builder) · [FAQ Generator](#faq-generator) · [Quality Gate](#quality-gate) |
| Operations & alerts | [Report Builder](#report-builder) · [Google Sheets Sync](#google-sheets-sync) · [Alerts & Digest Sender](#alerts-digest-sender) · [Custom AI Agent](#custom-ai-agent) |
| SEO | [SEO Optimizer](#seo-optimizer) · [SEO Site Auditor](#seo-site-auditor) · [Broken Link Checker](#broken-link-checker) · [Keyword Researcher](#keyword-researcher) |
| Publish | [Auto Publisher](#auto-publisher) |
| Website assistants | [Comparison Assistant](#comparison-assistant) |
| Customer support | [Customer Support Assistant](#customer-support-assistant) |

## Collect data

<a id="smart-web-scraper"></a>
### Smart Web Scraper

**Turn any website list into a clean spreadsheet.** (Free)

Paste a website and describe the information you want in plain words (for example: product name, price, rating). It reads the pages, follows 'next page' links and returns clean rows. No coding or selectors needed.

- **Can do:** AI extraction from plain-language field names, Follows pagination, Respects robots.txt and rate limits, Works with RSS, sitemaps and JSON
- **You fill in:** `sources`, `extract_fields`
- **Try:** Scrape listings → Clean & sort → Save to dataset
- Engine: `web_scraper`

<a id="url-collector"></a>
### URL Collector

**Get the full list of product, article or event pages on a site.** (Free)

Collects links from pages, sitemaps and search results, keeps only the ones matching your pattern (like /product/ or /event/), removes duplicates and tracking junk, and hands them to the next agent.

- **Can do:** Sitemaps, pages and search, Include / exclude patterns, Canonical, de-duplicated URLs, Same-site or cross-site
- **You fill in:** `start_urls`
- **Try:** URL Collector → Smart Web Scraper → Dataset Saver
- Engine: `link_collector`

<a id="site-crawler"></a>
### Site Crawler

**Make a full inventory of your own or a competitor's website.** (Free)

Starts from a homepage or sitemap and visits pages up to the depth and limit you set, collecting each page's title, text, headings and links. Great as the first step for audits, research and content inventories.

- **Can do:** Depth and page limits, Sitemap seeding, Same-domain only, Page text and metadata
- **You fill in:** `sources`
- **Try:** Site Crawler → SEO Site Auditor → Report Builder
- Engine: `web_scraper`

<a id="table-extractor"></a>
### Table Extractor

**Grab fee tables, price lists or rankings without retyping.** (Free)

Finds every HTML table on the pages you give it (fees, timetables, price lists, rankings) and turns each row into structured data with proper column names and numbers.

- **Can do:** All tables per page, Header detection, Number and currency cleanup
- **You fill in:** `sources`
- **Try:** Table Extractor → Change Detector → Alerts
- Engine: `web_scraper`

<a id="structured-data-reader"></a>
### Structured Data Reader

**Get exact prices, dates and ratings that sites already publish for Google.** (Free)

Many sites publish machine-readable details (schema.org JSON-LD, Open Graph, microdata) for products, events, recipes, jobs and articles. This agent reads them directly: fast, exact and with no AI guessing.

- **Can do:** JSON-LD, Open Graph, microdata, Products, events, jobs, articles, No model needed
- **You fill in:** `sources`
- **Try:** URL Collector → Structured Data Reader → Comparison Builder
- Engine: `web_scraper`

<a id="product-price-scraper"></a>
### Product & Price Scraper

**Track competitor prices every day.** (Free)

Collects product name, price, MRP, discount, stock and rating from shop pages, using published structured data first and AI extraction second.

- **Can do:** Price, MRP, discount, stock, Structured data first, Currency cleanup
- **You fill in:** `sources`
- **Try:** Product & Price Scraper → Change Detector → Alerts & Digest Sender
- Engine: `web_scraper`

<a id="job-listings-collector"></a>
### Job Listings Collector

**Run a job board or track who is hiring.** (Free)

Collects job title, company, location, salary, experience and apply link from career pages and job boards that allow it.

- **Can do:** JobPosting structured data, AI fallback, Deadline and location fields
- **You fill in:** `sources`
- **Try:** Job Listings Collector → Data Cleaner & Sorter → Dataset Saver
- Engine: `web_scraper`

<a id="event-hackathon-finder"></a>
### Event & Hackathon Finder

**Keep a live calendar of events and hackathons.** (Free)

Finds upcoming events, hackathons, webinars and contests with dates, deadlines, prizes, mode and registration link.

- **Can do:** Event structured data, Deadline parsing, Prize and mode fields
- **You fill in:** `sources`
- **Try:** Event & Hackathon Finder → Data Cleaner & Sorter → Content Writer → Dataset Saver
- Engine: `web_scraper`

<a id="review-collector"></a>
### Review Collector

**See all your reviews together and spot complaints early.** (Pro)

Collects reviews and ratings that are published on pages you're allowed to read (your own product pages, public review pages) with the date, rating and text.

- **Can do:** Review structured data, Rating and date, Text cleanup
- **You fill in:** `sources`
- **Try:** Review Collector → Sentiment & Topic Tagger → Report Builder
- Engine: `web_scraper`

<a id="pdf-document-reader"></a>
### PDF & Document Reader

**Get the important details out of long PDFs.** (Pro)

Opens PDFs and documents from links (brochures, fee notices, annual reports, circulars), pulls out the text and the fields you ask for, and passes them on.

- **Can do:** PDF text extraction, Field extraction with AI, Page limit
- **You fill in:** `sources`
- **Try:** URL Collector → PDF & Document Reader → Dataset Saver
- Engine: `document_reader`

<a id="page-change-watcher"></a>
### Page Change Watcher

**Get alerted when a price drops, a notice is posted or a date changes.** (Free)

Checks the pages you choose on a schedule (or just one part, like a price or a notice list) and reports only what changed since the last check, with before and after.

- **Can do:** Whole page or one element, Before / after diff, Ignores noise like dates and ads
- **You fill in:** `sources`
- **Try:** Page Change Watcher → Alerts & Digest Sender
- Engine: `page_watcher`

## Images

<a id="image-scraper"></a>
### Image Scraper

**Collect product, campus or event photos with duplicates removed.** (Free)

Collects images from the pages you choose: main image, gallery and Open Graph image. Small icons are skipped, the size and alt text are kept, and each picture gets an image hash so duplicates are removed automatically.

- **Can do:** og:image and page images, Minimum size filter, Perceptual hash de-duplication, Keeps credit and page link
- **You fill in:** `pages`
- **Try:** Smart Web Scraper → Image Scraper → Dataset Saver
- **Note:** Only use images you have the right to use.
- Engine: `image_finder`

<a id="open-license-image-finder"></a>
### Open-License Image Finder

**Get a free, properly credited picture for every article.** (Free)

Finds pictures for your topics from open-license libraries first (Openverse and Wikimedia Commons), with the licence and the credit line ready to paste. Duplicates are removed by image hash.

- **Can do:** Openverse + Wikimedia Commons, CC0 / CC BY / public domain first, Credit line and licence link, Hash de-duplication
- **Try:** Content Writer → Open-License Image Finder → Auto Publisher
- Engine: `image_finder`

<a id="image-alt-text-writer"></a>
### Image Alt-Text Writer

**Make every image accessible and better for Google.** (Pro · beta)

Writes short, accurate alt text and captions for images, which helps accessibility and SEO. It uses a vision model when one is installed; otherwise it writes from the page context and the existing caption.

- **Can do:** Vision model when available, Context-based fallback, SEO-friendly length
- **Try:** Image Scraper → Image Alt-Text Writer → Dataset Saver
- **Note:** Vision model optional (MODEL_VISION).
- Engine: `image_finder`

## Research & news

<a id="news-discovery"></a>
### News Discovery

**Never miss news about your market, competitors or city.** (Free)

Watches Google News and your chosen feeds for your keywords, removes duplicates and old stories, and gives you only what's new.

- **Can do:** Keywords and feeds, De-duplicated, Recency filter
- **You fill in:** `keywords`
- **Try:** News Discovery → Content Writer → Multi-format Creator → Auto Publisher
- Engine: `news_monitor`

<a id="topic-feed-monitor"></a>
### Topic & Feed Monitor

**One place for every blog and notice board you follow.** (Free)

Follows the RSS feeds, blogs and announcement pages you add and passes along new posts as they appear.

- **Can do:** RSS and Atom feeds, Per-source limits, New items only
- **You fill in:** `feeds`
- **Try:** Topic & Feed Monitor → Summarizer → Alerts & Digest Sender
- Engine: `news_monitor`

<a id="research-analyst"></a>
### Research Analyst

**Get a researched brief with sources in minutes.** (Pro)

Give it a question or topic. It finds sources, reads them and writes a short research brief where every fact links to where it came from.

- **Can do:** Multi-source, Evidence with links, Refuses thin evidence
- **You fill in:** `question`
- **Try:** Research Analyst → Content Writer → SEO Optimizer
- Engine: `researcher`

<a id="data-finder"></a>
### Data Finder

**Find a number or fact with the source attached.** (Free)

Ask for specific facts (for example 'average placement package at NIT Trichy' or 'GST rate on laptops'). It searches, reads and returns each value with its source and date so you can trust it.

- **Can do:** Fact and number lookup, Source and date per value, Confidence label
- **You fill in:** `question`
- **Try:** Data Finder → Dataset Saver
- Engine: `researcher`

<a id="fact-checker"></a>
### Fact Checker

**Publish with confidence, without embarrassing mistakes.** (Pro)

Checks the claims and numbers in each item against its sources and marks each one verified, unsupported or contradicted before anything is published.

- **Can do:** Numbers and claims, Verdict per claim, Flag or drop
- **Try:** Content Writer → Fact Checker → Auto Publisher
- Engine: `fact_checker`

## Sales & leads

<a id="business-contact-finder"></a>
### Business Contact Finder

**Build a clean list of business contacts from their own websites.** (Pro)

Reads public 'Contact' and 'About' pages of businesses and organisations and collects the publicly listed email, phone, address and social links. It only reads what the business has published.

- **Can do:** Email, phone, address, socials, Public pages only, Normalised formats
- **You fill in:** `sources`
- **Try:** URL Collector → Business Contact Finder → Lead Qualifier → CRM Sync
- **Note:** Respect privacy laws; business contacts only.
- Engine: `web_scraper`

<a id="email-drafter"></a>
### Email Drafter

**Reply to every enquiry quickly and politely.** (Free)

Drafts follow-up, outreach and reply emails from the details in each item (name, interest, last message) in the tone you choose.

- **Can do:** Tone control, Personalised from item data, Subject + body
- **Works with:** email_smtp
- **Try:** Lead Qualifier → Email Drafter → Alerts & Digest Sender
- Engine: `custom_llm`

<a id="lead-qualifier"></a>
### Lead Qualifier

**Call the best leads first.** (Pro)

Scores each new lead or enquiry using your rules and AI (budget, need, timeline, location), checks for duplicates and assigns it to the right person.

- **Can do:** Score and reason, Your rules + AI, Assignment
- **Try:** Webhook trigger → Lead Qualifier → CRM Sync → Alerts & Digest Sender
- Engine: `custom_llm`

<a id="crm-sync"></a>
### CRM Sync

**Every enquiry lands in your CRM automatically.** (Enterprise)

Sends each item to your CRM or internal system (Zoho, HubSpot, your own API) as a new lead or update, with fields mapped your way.

- **Can do:** Any JSON API, Field mapping, Allow-listed hosts only
- **You fill in:** `connections`
- **Works with:** rest_api
- **Try:** Lead Qualifier → CRM Sync
- Engine: `http_action`

## Clean, compare & save data

<a id="college-institution-researcher"></a>
### College / Institution Researcher

**Keep a college or school directory up to date automatically.** (Pro)

Visits institution websites and official pages to collect courses, fees, placements, rankings, facilities and admissions details into your dataset, keeping the source of every value.

- **Can do:** Follows listing to detail pages, Upsert by name, Source per record
- **You fill in:** `dataset`, `sources`
- **Try:** College Researcher → Change Detector → Content Writer
- Engine: `dataset_builder`

<a id="data-cleaner-sorter"></a>
### Data Cleaner & Sorter

**Turn a messy list into a clean, sorted one.** (Free)

Cleans any list: removes duplicates, keeps only what matches your rules (for example 'deadline after today'), sorts by date, number or name, and can sort items into categories with AI.

- **Can do:** Dedupe, Filter rules, Sort and limit, AI categories
- **Try:** Event & Hackathon Finder → Data Cleaner & Sorter → Dataset Saver
- Engine: `data_transform`

<a id="sentiment-topic-tagger"></a>
### Sentiment & Topic Tagger

**See what customers love and what annoys them.** (Free)

Labels each review, comment or post as positive, neutral or negative and tags the topic (price, delivery, quality, staff…) so you can see patterns at a glance.

- **Can do:** Sentiment label, Topic tags, Works in many languages
- **Try:** Review Collector → Sentiment & Topic Tagger → Report Builder
- Engine: `data_transform`

<a id="comparison-builder"></a>
### Comparison Builder

**Compare prices, plans or colleges across sites in one table.** (Free)

Matches the same product, college, plan or service across different sources, builds a side-by-side table and highlights the best value in each row (lowest price, highest rating…).

- **Can do:** Fuzzy name matching, Best value per field, Comparison content
- **You fill in:** `match_field`, `compare_fields`
- **Try:** Product & Price Scraper → Comparison Builder → Auto Publisher
- Engine: `comparer`

<a id="change-detector"></a>
### Change Detector

**Spot every change in prices, fees or dates.** (Free)

Compares new data with what's already in your dataset and tells you what's new, what changed (with old and new values) and what stayed the same.

- **Can do:** New / changed / unchanged, Field-level diff, Only pass changes on
- **You fill in:** `dataset`
- **Try:** Table Extractor → Change Detector → Alerts & Digest Sender
- Engine: `change_detector`

<a id="dataset-saver"></a>
### Dataset Saver

**Put collected data on your website automatically.** (Free)

Saves the items from earlier steps into a dataset (creating or updating records), which your website can show through the API or the WordPress table shortcode.

- **Can do:** Create or update by key, Field mapping, Source URL kept
- **You fill in:** `dataset`
- **Try:** Smart Web Scraper → Data Cleaner & Sorter → Dataset Saver
- Engine: `dataset_builder`

## Write & create

<a id="content-writer"></a>
### Content Writer

**Publish fresh articles every day without writing from scratch.** (Free)

Turns collected stories or notes into original articles in your brand voice, using only facts from the sources it was given.

- **Can do:** Brand voice / persona, Grounded in sources, Length control
- **You fill in:** `persona`
- **Try:** News Discovery → Content Writer → SEO Optimizer → Auto Publisher
- Engine: `persona_rewriter`

<a id="summarizer"></a>
### Summarizer

**Read the gist of anything in 30 seconds.** (Free)

Turns long articles, notices or reports into a short summary or bullet points that anyone can read in 30 seconds.

- **Can do:** Bullets or paragraph, Keeps numbers exact, Any length
- **Try:** Topic & Feed Monitor → Summarizer → Alerts & Digest Sender
- Engine: `persona_rewriter`

<a id="translator"></a>
### Translator

**Reach readers in their own language.** (Free)

Translates content into Hindi, Marathi, Tamil and other languages while keeping names, numbers and formatting intact.

- **Can do:** Indian and global languages, Keeps numbers and names, Tone control
- **You fill in:** `language`
- **Try:** Content Writer → Translator → Auto Publisher
- **Note:** Quality depends on the language; review before publishing.
- Engine: `persona_rewriter`

<a id="multi-format-creator"></a>
### Multi-format Creator

**Post everywhere from one story.** (Pro)

Turns one story into an article, LinkedIn post, X thread, Instagram caption, Facebook post, newsletter blurb, WhatsApp message and short-video script, each following that platform's rules.

- **Can do:** 9 formats, Platform length rules, Hashtags where useful
- **You fill in:** `formats`
- **Try:** Content Writer → Multi-format Creator → Auto Publisher
- Engine: `multi_format`

<a id="social-caption-writer"></a>
### Social Caption Writer

**Never stare at an empty caption box again.** (Free)

Writes Instagram, LinkedIn, Facebook and X captions with a strong first line, the right length and a few relevant hashtags.

- **Can do:** Hook-first captions, Hashtag suggestions, Per-platform limits
- **Try:** Open-License Image Finder → Social Caption Writer → Auto Publisher
- Engine: `multi_format`

<a id="newsletter-builder"></a>
### Newsletter Builder

**Send a weekly newsletter in minutes.** (Free)

Collects the week's best items and writes a ready-to-send newsletter with an intro, sections and links.

- **Can do:** Intro + sections, Links to sources, Saved as content
- **Works with:** email_smtp
- **Try:** News Discovery → Newsletter Builder → Alerts & Digest Sender
- Engine: `report_builder`

<a id="faq-generator"></a>
### FAQ Generator

**Add a helpful FAQ section to any page.** (Free)

Reads your pages or documents and writes the questions customers actually ask, with short answers taken only from your content.

- **Can do:** Answers grounded in your text, FAQ schema ready, Any language
- **Try:** Site Crawler → FAQ Generator → Dataset Saver → Customer Support Assistant
- Engine: `custom_llm`

<a id="quality-gate"></a>
### Quality Gate

**Keep your brand's quality bar automatically.** (Free)

Blocks or flags content that is too short or too long, uses banned phrases, repeats a recent post or mentions numbers not found in the source.

- **Can do:** Length and phrase rules, Duplicate check, Numbers vs source
- **Try:** Multi-format Creator → Quality Gate → Auto Publisher
- Engine: `quality_gate`

## Operations & alerts

<a id="report-builder"></a>
### Report Builder

**Get a daily summary you can forward to your boss.** (Free)

Turns what your agents found (leads, prices, changes, audits) into a clear report with highlights, numbers and next steps.

- **Can do:** Highlights and numbers, Markdown report, Saved as content
- **Try:** Change Detector → Report Builder → Alerts & Digest Sender
- Engine: `report_builder`

<a id="google-sheets-sync"></a>
### Google Sheets Sync

**Keep a live spreadsheet of everything your agents find.** (Free)

Adds each item as a new row in a Google Sheet through a small Apps Script web app (setup steps included). No Google login is stored in LayerFlow.

- **Can do:** One row per item, Column mapping, No OAuth needed
- **You fill in:** `connections`
- **Works with:** rest_api
- **Try:** Smart Web Scraper → Google Sheets Sync
- Engine: `http_action`

<a id="alerts-digest-sender"></a>
### Alerts & Digest Sender

**Get the important stuff on your phone.** (Free)

Sends a message for each important item, or one tidy digest, to Telegram, Slack, Discord, email or a webhook.

- **Can do:** Per item or digest, Many channels, Quiet when nothing changed
- **You fill in:** `connections`
- **Works with:** telegram, slack, discord, email_smtp, webhook
- **Try:** Page Change Watcher → Alerts & Digest Sender
- Engine: `notifier`

<a id="custom-ai-agent"></a>
### Custom AI Agent

**Build your own agent for any task.** (Free)

Write instructions in plain English and choose the fields you want back. Use it for anything the other agents don't cover, like classifying, extracting, rewriting or scoring.

- **Can do:** Your instructions, Your output fields, Any industry
- **You fill in:** `prompt`
- **Try:** Any agent → Custom AI Agent → Dataset Saver
- Engine: `custom_llm`

## SEO

<a id="seo-optimizer"></a>
### SEO Optimizer

**Make every post Google-ready.** (Free)

Writes the SEO title, meta description, clean URL slug, keywords and schema markup for each article so it shows up well on Google and social media.

- **Can do:** Title and meta rules, Slug, JSON-LD
- **Try:** Content Writer → SEO Optimizer → Auto Publisher
- Engine: `seo_optimizer`

<a id="seo-site-auditor"></a>
### SEO Site Auditor

**Get a prioritised SEO fix list for your site.** (Pro)

Crawls your website and lists every SEO problem (missing titles and descriptions, duplicate titles, missing H1, canonical, social tags, schema, slow or broken pages) with the fix for each.

- **Can do:** Technical and on-page checks, Prioritised fixes, Report saved
- **You fill in:** `site_url`
- **Try:** SEO Site Auditor → Report Builder → Alerts & Digest Sender
- Engine: `site_auditor`

<a id="broken-link-checker"></a>
### Broken Link Checker

**Fix broken links before visitors find them.** (Free)

Checks every link on your pages and lists the broken ones (404s, timeouts, redirects to nowhere) with the page they're on.

- **Can do:** Internal and external links, Status per link, Page where found
- **You fill in:** `site_url`
- **Try:** Broken Link Checker → Alerts & Digest Sender
- Engine: `site_auditor`

<a id="keyword-researcher"></a>
### Keyword Researcher

**Know what to write about next.** (Free)

Expands your topic into the questions and phrases people type into search engines (from free search suggestions), adds terms your competitors use, and groups them by intent.

- **Can do:** Search suggestions A–Z, Competitor terms, Grouped by intent
- **You fill in:** `seed_keywords`
- **Try:** Keyword Researcher → Content Writer → SEO Optimizer
- **Note:** No paid search-volume data.
- Engine: `keyword_researcher`

## Publish

<a id="auto-publisher"></a>
### Auto Publisher

**Publish everywhere with one approval.** (Free)

Publishes approved content to your connected website (Next.js, WordPress, Ghost) and channels (LinkedIn, Telegram, Slack…), and records every delivery.

- **Can do:** Many destinations, Approval first, Delivery history
- **You fill in:** `connections`
- **Works with:** nextjs, wordpress, ghost, linkedin, telegram, webhook
- **Try:** Content Writer → SEO Optimizer → Auto Publisher
- Engine: `auto_publisher`

## Website assistants

<a id="comparison-assistant"></a>
### Comparison Assistant

**Let visitors compare options on your website instantly.** (Pro)

A chat assistant for your website that answers questions and compares records side by side (colleges, products, plans), always from your own data.

- **Can do:** Real-time answers, Exact comparison tables, Website widget
- **You fill in:** `dataset`
- **Try:** Dataset → Comparison Assistant (website widget)
- Engine: `comparison_assistant`

## Customer support

<a id="customer-support-assistant"></a>
### Customer Support Assistant

**Answer common questions even at midnight.** (Pro)

Answers customer questions on your website from your FAQ and help content, and says so honestly when it doesn't know.

- **Can do:** Grounded in your FAQ, Honest 'I don't know', Website widget
- **You fill in:** `dataset`
- **Try:** FAQ Generator → Dataset Saver → Customer Support Assistant
- Engine: `comparison_assistant`
