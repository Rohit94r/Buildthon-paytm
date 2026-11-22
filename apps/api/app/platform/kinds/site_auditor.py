"""site_auditor: crawl a website (sitemap from robots.txt or /sitemap.xml, else same-host links) and audit every
page with the newsroom's on-page parser and SEO rules: status, title, meta description, H1, canonical, Open
Graph, JSON-LD, duplicate titles. Produces findings in the site-audit format plus a markdown report."""

from __future__ import annotations

from collections import defaultdict
from typing import Any
from urllib.parse import urljoin, urlsplit

from app.platform.flow import FlowItem
from app.platform.kinds.live_evidence import cited_answer, cited_answer_markdown, live_hits
from app.platform.tools import invoke
from app.services.fetcher import FetchError
from app.services.htmlmeta import parse_page
from app.services.seo_rules import META_MAX, META_MIN, TITLE_MAX, TITLE_MIN
from app.services.site_audit import _finding

SEVERITY_ORDER = {"critical": 0, "major": 1, "minor": 2, "info": 3}
CHECKS = {
    "broken": ("Broken pages", "critical", "Pages answer with an error status", "Return 200 or redirect/remove the links"),
    "missing_title": ("Missing <title>", "critical", "No title tag", "Write a unique 30–60 character title"),
    "title_length": ("Title length", "minor", f"Title outside {TITLE_MIN}–{TITLE_MAX} characters", "Rewrite the title to 30–60 characters"),
    "duplicate_title": ("Duplicate titles", "major", "Several pages share one title", "Give every page a unique title"),
    "missing_meta": ("Missing meta description", "major", 'No name="description"', "Add a 140–158 character description"),
    "meta_length": ("Meta description length", "minor", f"Description outside {META_MIN}–{META_MAX} characters", "Rewrite to 140–158 characters"),
    "missing_h1": ("Missing H1", "major", "No <h1> heading", "Use exactly one H1 with the page headline"),
    "multiple_h1": ("Multiple H1", "minor", "More than one <h1>", "Keep one H1 per page"),
    "missing_canonical": ("Missing canonical", "major", 'No rel="canonical"', "Add a self-referencing canonical URL"),
    "missing_og": ("Missing Open Graph", "minor", "No og:title / og:description / og:image", "Add Open Graph tags for link previews"),
    "missing_jsonld": ("Missing structured data", "minor", "No application/ld+json", "Add Organization / Article JSON-LD"),
    "thin_content": ("Thin content", "minor", "Fewer than 150 words", "Expand or consolidate thin pages"),
    "broken_links": ("Broken links", "critical", "Links that return an error or do not answer", "Fix or remove each link (page shown after →)"),
}
MAX_LINK_CHECKS = 300


def analyze_page(html: str, url: str, status: int = 200) -> dict[str, Any]:
    """On-page checks for one page (also the `seo.analyze` tool)."""
    if status >= 400:
        return {"url": url, "status": status, "title": None, "issues": ["broken"], "links": []}
    m = parse_page(html, url)
    issues = []
    if not m.title:
        issues.append("missing_title")
    elif not TITLE_MIN <= len(m.title) <= TITLE_MAX:
        issues.append("title_length")
    if not m.meta_description:
        issues.append("missing_meta")
    elif not META_MIN <= len(m.meta_description) <= META_MAX:
        issues.append("meta_length")
    if not m.h1:
        issues.append("missing_h1")
    elif len(m.h1) > 1:
        issues.append("multiple_h1")
    if not m.canonical:
        issues.append("missing_canonical")
    if not m.og:
        issues.append("missing_og")
    if not m.has_jsonld:
        issues.append("missing_jsonld")
    if m.word_count < 150:
        issues.append("thin_content")
    return {"url": url, "status": status, "title": m.title, "issues": issues, "links": m.internal_links, "words": m.word_count}


async def _discover(ctx, site: str, limit: int, use_sitemap: bool) -> list[str]:
    urls: list[str] = []
    if use_sitemap:
        for sm in (urljoin(site, "/sitemap.xml"), urljoin(site, "/sitemap_index.xml")):
            try:
                urls = await invoke(ctx, "sitemap.read", summary=lambda r: {"urls": len(r)}, url=sm, limit=limit * 3)
            except FetchError:
                continue
            host = urlsplit(site).hostname
            urls = [u for u in urls if urlsplit(u).hostname == host]
            if urls:
                break
    return list(dict.fromkeys([site, *urls]))[:limit]


def report_markdown(site: str, pages: list[dict[str, Any]], findings: list[dict[str, Any]]) -> str:
    ok = sum(1 for p in pages if not p["issues"])
    lines = [f"# SEO audit: {site}", "", f"{len(pages)} page(s) checked · {ok} without issues · {len(findings)} finding(s)", ""]
    for f in findings:
        lines += [f"## [{f['severity']}] {f['title']} ({f['affected_count']})", "", f"{f['evidence']}. **Fix:** {f['fix']}", ""]
        lines += [f"- {u}" for u in f["affected_urls"][:8]] + [""]
    if not findings:
        lines.append("No issues found on the checked pages.")
    return "\n".join(lines).strip()


async def run(ctx, cfg: dict[str, Any], items: list[FlowItem]) -> list[FlowItem]:
    site = (cfg.get("site_url") or "").rstrip("/") + "/"
    targets = [site] if cfg.get("site_url") else [it.url for it in items if it.url]
    if not targets:
        raise ValueError("Set the site URL to audit")
    limit = int(cfg.get("max_pages", 25))
    queue = await _discover(ctx, targets[0], limit, cfg.get("use_sitemap", True)) if cfg.get("site_url") else targets[:limit]
    host = urlsplit(queue[0]).hostname
    if cfg.get("live_sources"):
        # Audit what people actually find in search, not only what the sitemap advertises.
        query = cfg.get("live_query") or f"site:{host}"
        try:
            hits = await live_hits(ctx, query, engine="google", count=int(cfg.get("live_count", 10)),
                                   location=cfg.get("location", ""))
            extra = [h["url"] for h in hits if urlsplit(h["url"]).hostname == host]
            queue = list(dict.fromkeys([*queue, *extra]))
            await ctx.log(f"SerpApi added {len(extra)} live result(s) to the SEO audit queue")
        except Exception as exc:  # a sponsor outage must not kill the audit
            await ctx.log(f"SerpApi discovery failed: {exc}", "warn")
    links_only = cfg.get("checks") == "links"
    link_sources: dict[str, str] = {}
    pages: list[dict[str, Any]] = []
    seen: set[str] = set()
    while queue and len(pages) < limit:
        await ctx.check_cancel()
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            res = await invoke(ctx, "web.fetch", summary=lambda r: {"status": r.status}, url=url)
            page = await invoke(ctx, "seo.analyze", summary=lambda p: {"issues": len(p["issues"])}, html=res.text, url=res.final_url or url,
                                status=res.status)
        except FetchError as exc:
            if exc.kind in ("robots",):
                await ctx.log(f"Skipped (robots.txt): {url}", "warn")
                continue
            page = {"url": url, "status": exc.status or 0, "title": None, "issues": ["broken"], "links": []}
            res = None
        if links_only:
            page["issues"] = [i for i in page["issues"] if i == "broken"]
            if res is not None:
                for link, _ in await invoke(ctx, "links.collect", summary=lambda r: {"links": len(r)}, html=res.text, url=res.final_url or url,
                                            same_site=not cfg.get("check_external_links")):
                    link_sources.setdefault(link, res.final_url or url)
        pages.append(page)
        for link in page.get("links") or []:
            if urlsplit(link).hostname == host and link not in seen and len(seen) + len(queue) < limit * 3:
                queue.append(link)

    by_issue: dict[str, list[str]] = defaultdict(list)
    for p in pages:
        for i in p["issues"]:
            by_issue[i].append(p["url"])
    if links_only:
        status_of = {p["url"]: p["status"] for p in pages}
        checked = 0
        for link, on_page in list(link_sources.items())[:MAX_LINK_CHECKS]:
            await ctx.check_cancel()
            status = status_of.get(link)
            if status is None:
                checked += 1
                try:
                    status = (await invoke(ctx, "web.fetch", summary=lambda r: {"status": r.status}, url=link)).status
                except FetchError as exc:
                    if exc.kind == "robots":
                        continue
                    status = exc.status or 0
            if not status or status >= 400:
                by_issue["broken_links"].append(f"{link} → {on_page}")
        await ctx.log(f"Checked {len(link_sources)} link(s) ({checked} fetched): {len(by_issue['broken_links'])} broken")
        by_issue.pop("broken", None)
    titles: dict[str, list[str]] = defaultdict(list)
    for p in pages:
        if p.get("title"):
            titles[p["title"].strip().lower()].append(p["url"])
    for urls in titles.values():
        if len(urls) > 1:
            by_issue["duplicate_title"] += urls
    findings = [_finding(k, CHECKS[k][0], CHECKS[k][1], CHECKS[k][2], f"{len(v)} {'link' if k == 'broken_links' else 'page'}(s) affected",
                         affected=v, fix=CHECKS[k][3]) for k, v in by_issue.items() if v]
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f["severity"], 9), -f["affected_count"]))
    report = report_markdown(targets[0], pages, findings)
    live_answer_data = None
    if cfg.get("live_answer"):
        query = cfg.get("live_query") or f"{targets[0]} review"
        try:
            live_answer_data = await cited_answer(ctx, query, country=cfg.get("country", "IN"), language=cfg.get("language", "EN"))
            report += "\n\n---\n\n" + cited_answer_markdown(query, live_answer_data)
        except Exception as exc:
            await ctx.log(f"You.com cited answer failed: {exc}", "warn")
    ctx.outputs["report"] = report
    await ctx.log(f"Audited {len(pages)} page(s): {len(findings)} finding(s)")
    score = max(0, 100 - sum({"critical": 15, "major": 8, "minor": 3}.get(f["severity"], 1) for f in findings))
    return [FlowItem(title=f"SEO audit: {targets[0]}", url=targets[0], text=report, summary=f"{len(pages)} pages, {len(findings)} findings, score {score}",
                     formats={"article": report},
                     data={"findings": findings, "pages": pages, "score": score,
                           "live_answer": {"answer": live_answer_data.get("answer"),
                                           "citations": live_answer_data.get("citations") or []} if live_answer_data else None})]

