"""`python -m app.cli seed-demo-platform`: demo workspaces next to the existing `ten` newsroom.

  marketpulse     news media autopilot, a few content items with variants and two finished runs
  collegecompass  college portal with 8 SAMPLE colleges (fictional names, illustrative figures)
  hackfinder      hackathon listings with 5 SAMPLE hackathons (fictional names, future dates)

Idempotent: workspaces, agents, pipelines and datasets are matched by slug/name and sample rows are only
added when missing. Everything sample is labelled as such so nobody mistakes it for real data."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from app.core.db import session_factory, utcnow
from app.models import ContentItem, Dataset, Membership, Pipeline, PipelineRun, Tenant, User
from app.platform.blueprints import apply_blueprint
from app.platform.content import make_variant
from app.platform.datasets import upsert_record

SAMPLE_NOTE = "Sample data: fictional, illustrative figures for the demo"
# A well-known Wikimedia Commons example file. Licence left unknown on purpose: replace sample images before publishing.
SAMPLE_IMAGE = {"url": "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg", "thumb_url": None,
                "page_url": "https://commons.wikimedia.org/wiki/File:Example.jpg", "source": "upload", "license": None, "license_url": None,
                "open_license": False, "credit": "Sample image (Wikimedia Commons example file)", "width": 275, "height": 297, "hash": None,
                "alt": "Sample illustration for demo content"}

WORKSPACES = [
    {"slug": "marketpulse", "name": "MarketPulse", "industry": "news_media", "brand_color": "#2563eb",
     "domain": "marketpulse.example.com", "blueprint": "news_media_autopilot"},
    {"slug": "collegecompass", "name": "CollegeCompass", "industry": "education", "brand_color": "#7c3aed",
     "domain": "collegecompass.example.com", "blueprint": "college_portal"},
    {"slug": "hackfinder", "name": "HackFinder", "industry": "events", "brand_color": "#db2777",
     "domain": "hackfinder.example.com", "blueprint": "hackathon_listings"},
]

MARKET_CONTENT = [
    {
        "title": "Sample: Benchmark index closes 1.2% higher as bank stocks rally",
        "summary": "Banking shares led a broad rally that lifted the benchmark index 1.2% on the session.",
        "status": "published",
        "tags": ["markets", "banks"],
        "article": "Banking shares led a broad rally on Tuesday, lifting the benchmark index 1.2% by the close.\n\n"
                   "## What moved\n\nPrivate lenders gained the most after quarterly loan growth of 14% beat expectations.\n\n"
                   "## Why it matters\n\nStronger credit growth usually points to healthier demand across the economy.",
        "linkedin_post": "Banks carried the market today: the benchmark index closed 1.2% higher.\n\nPrivate lenders led after loan growth of 14% beat estimates.\n\n#Markets #Banking",
        "x_thread": "Banks carried the market today: benchmark index +1.2% 1/2\n\nPrivate lenders led after loan growth of 14% beat estimates. 2/2",
    },
    {
        "title": "Sample: Central bank holds policy rate, signals patience on inflation",
        "summary": "The central bank kept its policy rate unchanged at 6.5% and said inflation needs to cool further.",
        "status": "approved",
        "tags": ["policy", "rates"],
        "article": "The central bank kept its policy rate unchanged at 6.5% on Friday.\n\n## The signal\n\n"
                   "Policymakers said inflation of 5.1% is still above the 4% target, so cuts are not imminent.",
        "newsletter": "**Rates on hold.** The policy rate stays at 6.5%; inflation (5.1%) is still above target.",
        "whatsapp_message": "Policy rate unchanged at 6.5%. Inflation at 5.1% keeps cuts off the table for now.",
    },
    {
        "title": "Sample: Three IPOs open this week; here is what they raise",
        "summary": "Three companies open their IPOs this week, seeking a combined 4,200 crore rupees.",
        "status": "draft",
        "tags": ["ipo"],
        "article": "Three companies open their initial public offerings this week, together seeking 4,200 crore rupees.\n\n"
                   "## The issues\n\nThe largest is a logistics firm raising 2,100 crore rupees.",
        "instagram_caption": "3 IPOs, 4,200 crore rupees, one busy week.\n\n#IPO #Markets #Investing",
        "short_video_script": "HOOK: Three IPOs open this week.\n\nSCENE 1\nVisual: Logos of the three companies\nVoiceover: Together they seek 4,200 crore rupees.\n\nCTA: Follow for the subscription numbers",
    },
]

COLLEGES = [
    ("Aravali Institute of Technology", "Jaipur", "Rajasthan", "Private", 48, 1850000, 9.4, 32.0, 88, 4.1,
     ["B.Tech CSE", "B.Tech ECE", "MBA"], ["JEE Main"]),
    ("Deccan National Engineering College", "Pune", "Maharashtra", "Government", 22, 620000, 11.8, 44.0, 92, 4.4,
     ["B.Tech CSE", "B.Tech Mechanical", "M.Tech"], ["JEE Main", "MHT CET"]),
    ("Kaveri University of Science", "Mysuru", "Karnataka", "Private", 61, 1420000, 7.9, 24.5, 81, 3.9,
     ["B.Sc", "B.Tech CSE", "BCA"], ["KCET", "COMEDK"]),
    ("Ganga Valley Institute of Technology", "Varanasi", "Uttar Pradesh", "Government", 35, 540000, 10.2, 38.0, 90, 4.2,
     ["B.Tech CSE", "B.Tech Civil"], ["JEE Main"]),
    ("Coromandel Institute of Engineering", "Chennai", "Tamil Nadu", "Private", 29, 1980000, 12.6, 52.0, 94, 4.5,
     ["B.Tech CSE", "B.Tech AI & DS", "MBA"], ["TNEA", "JEE Main"]),
    ("Satpura School of Management", "Bhopal", "Madhya Pradesh", "Private", 74, 1100000, 8.1, 21.0, 85, 3.8,
     ["BBA", "MBA"], ["CAT", "MAT"]),
    ("Brahmaputra Technical University", "Guwahati", "Assam", "Government", 41, 480000, 9.0, 29.0, 86, 4.0,
     ["B.Tech CSE", "B.Tech Electrical"], ["JEE Main"]),
    ("Konkan Coast College of Engineering", "Ratnagiri", "Maharashtra", "Private", 95, 890000, 5.6, 14.0, 72, 3.5,
     ["B.Tech Mechanical", "Diploma"], ["MHT CET"]),
]


def _hackathons() -> list[dict[str, Any]]:
    today = utcnow().date()

    def d(days: int) -> str:
        return (today + timedelta(days=days)).isoformat()

    return [
        {"name": "Sample: Monsoon AI Build Sprint", "organizer": "Fictional Labs", "start_date": d(21), "end_date": d(23),
         "registration_deadline": d(14), "mode": "online", "location": "Online", "prize_pool": "₹3,00,000",
         "themes": ["AI", "Agents"], "eligibility": "Students and early-career developers", "category": "AI"},
        {"name": "Sample: ChainCraft Web3 Weekend", "organizer": "Demo DAO Collective", "start_date": d(35), "end_date": d(36),
         "registration_deadline": d(28), "mode": "hybrid", "location": "Bengaluru + Online", "prize_pool": "$10,000",
         "themes": ["Web3", "DeFi"], "eligibility": "Open to all", "category": "Web3"},
        {"name": "Sample: FinFuture Hack", "organizer": "Example Bank Innovation Cell", "start_date": d(12), "end_date": d(13),
         "registration_deadline": d(7), "mode": "offline", "location": "Mumbai", "prize_pool": "₹5,00,000",
         "themes": ["Fintech", "Payments"], "eligibility": "Teams of 2–4, college students", "category": "Fintech"},
        {"name": "Sample: GreenGrid Climate Challenge", "organizer": "Placeholder Foundation", "start_date": d(50), "end_date": d(52),
         "registration_deadline": d(40), "mode": "online", "location": "Online", "prize_pool": "$5,000",
         "themes": ["Climate", "Energy"], "eligibility": "Anyone 18+", "category": "Climate"},
        {"name": "Sample: Campus First Hack", "organizer": "Demo University Coding Club", "start_date": d(9), "end_date": d(10),
         "registration_deadline": d(5), "mode": "offline", "location": "Pune", "prize_pool": "₹50,000",
         "themes": ["Open innovation"], "eligibility": "First- and second-year students", "category": "Student"},
    ]


async def _ensure_workspace(spec: dict[str, Any]) -> tuple[Tenant, bool]:
    async with session_factory()() as db:
        t = (await db.execute(select(Tenant).where(Tenant.slug == spec["slug"]))).scalar_one_or_none()
        created = t is None
        if t is None:
            t = Tenant(slug=spec["slug"], name=spec["name"], domain=spec["domain"], timezone="Asia/Kolkata",
                       industry=spec["industry"], brand_color=spec["brand_color"], modules=[], plan=spec.get("plan", "pro"),
                       website=f"https://{spec['domain']}",
                       settings={"brand": {"name": spec["name"], "short_name": spec["name"], "site_url": f"https://{spec['domain']}"}})
            db.add(t)
            await db.flush()
        await apply_blueprint(db, t, spec["blueprint"], check_quota=False)
        admin = (await db.execute(select(User).where(User.is_platform_admin.is_(True)).order_by(User.created_at).limit(1))).scalar_one_or_none()
        if admin is not None and (await db.execute(select(Membership.id).where(Membership.user_id == admin.id, Membership.tenant_id == t.id))).scalar_one_or_none() is None:
            db.add(Membership(user_id=admin.id, tenant_id=t.id, role="owner", status="active"))
        await db.commit()
        await db.refresh(t)
        return t, created


async def _seed_market(t: Tenant) -> int:
    async with session_factory()() as db:
        if (await db.execute(select(func.count()).select_from(ContentItem).where(ContentItem.tenant_id == t.id))).scalar_one():
            return 0
        pipe = (await db.execute(select(Pipeline).where(Pipeline.tenant_id == t.id, Pipeline.name == "Daily market desk"))).scalar_one()
        from app.platform.runtime import initial_steps, tenant_agents

        agents = await tenant_agents(db, t.id)
        runs = []
        # One successful run a day for five days, so the streak, points and achievements reflect real history.
        for hours_ago, items in ((98, 3), (74, 2), (50, 4), (26, 2), (2, 1)):
            started = utcnow() - timedelta(hours=hours_ago)
            steps = initial_steps(pipe.steps, agents)
            for i, s in enumerate(steps):
                s.update(status="succeeded", started_at=(started + timedelta(seconds=40 * i)).isoformat(),
                         finished_at=(started + timedelta(seconds=40 * i + 35)).isoformat(), duration_ms=35_000,
                         items_in=items, items_out=items,
                         logs=[{"at": (started + timedelta(seconds=40 * i + 35)).isoformat(), "level": "info",
                                "message": "Sample run (seed-demo-platform)"}])
            run = PipelineRun(tenant_id=t.id, pipeline_id=pipe.id, status="succeeded", trigger="schedule", steps=steps, items=[],
                              items_out=items, content_created=items, started_at=started,
                              finished_at=started + timedelta(seconds=40 * len(steps)), created_at=started)
            db.add(run)
            await db.flush()
            runs.append(run)
        for i, spec in enumerate(MARKET_CONTENT):
            formats = {k: v for k, v in spec.items() if k not in ("title", "summary", "status", "tags")}
            variants = [make_variant(f, body, spec["title"] if f in ("article", "newsletter") else None) for f, body in formats.items()]
            created = utcnow() - timedelta(hours=24 - i * 8)
            db.add(ContentItem(
                tenant_id=t.id, run_id=runs[-2 if i < 2 else -1].id, pipeline_id=pipe.id, title=spec["title"],
                slug=f"sample-{i + 1}-" + "-".join(spec["title"].lower().split()[1:5]).replace(",", "").replace(";", "").replace("%", "pct")[:40],
                summary=spec["summary"], source_url=None, source_name="Sample data", persona="MarketPulse markets desk",
                status=spec["status"], tags=spec["tags"], variants=variants, publications=[],
                quality={"score": 100, "flags": []}, source_text=spec["article"], created_at=created, updated_at=created,
                images=[SAMPLE_IMAGE], image_url=SAMPLE_IMAGE["url"],
                published_at=created if spec["status"] == "published" else None,
            ))
        await db.commit()
        return len(MARKET_CONTENT)


async def _seed_records(t: Tenant, slug: str, rows: list[dict[str, Any]], note: str) -> int:
    async with session_factory()() as db:
        ds = (await db.execute(select(Dataset).where(Dataset.tenant_id == t.id, Dataset.slug == slug))).scalar_one()
        if SAMPLE_NOTE not in (ds.description or ""):
            ds.description = f"{ds.description} {note}".strip()
        n = 0
        for row in rows:
            outcome, _ = await upsert_record(db, ds, {**row, "notes": SAMPLE_NOTE}, update_existing=False)
            n += outcome == "created"
        await db.commit()
        return n


async def _ensure_platform_admin() -> str | None:
    async with session_factory()() as db:
        if (await db.execute(select(User.id).where(User.is_platform_admin.is_(True)).limit(1))).scalar_one_or_none():
            return None
        owner = (await db.execute(select(User).where(User.role == "owner", User.active.is_(True)).order_by(User.created_at).limit(1))).scalar_one_or_none()
        if owner is None:
            return None
        owner.is_platform_admin = True
        await db.commit()
        return owner.email


async def seed_demo_platform() -> dict[str, Any]:
    report: dict[str, Any] = {}
    promoted = await _ensure_platform_admin()
    if promoted:
        report["platform_admin"] = promoted
    for spec in WORKSPACES:
        t, created = await _ensure_workspace(spec)
        entry: dict[str, Any] = {"created": created}
        if spec["slug"] == "marketpulse":
            entry["content_added"] = await _seed_market(t)
        elif spec["slug"] == "collegecompass":
            rows = [dict(zip(("name", "city", "state", "type", "nirf_rank", "fees_total", "avg_package", "highest_package",
                              "placement_rate", "rating", "courses", "entrance_exams"), c, strict=True)) for c in COLLEGES]
            entry["records_added"] = await _seed_records(t, "colleges", rows, f"({SAMPLE_NOTE}.)")
        elif spec["slug"] == "hackfinder":
            entry["records_added"] = await _seed_records(t, "hackathons", _hackathons(), f"({SAMPLE_NOTE}.)")
            entry["members_added"] = await _seed_members(t)
        report[spec["slug"]] = entry
    return report


DEMO_MEMBERS = [("ops@hackfinder.example", "Demo Operator", "operator"), ("analyst@hackfinder.example", "Demo Analyst", "analyst")]


async def _seed_members(t: Tenant) -> list[dict[str, Any]]:
    """Demo teammates with different roles. Passwords are random and printed once (no fixed demo passwords)."""
    import secrets

    from app.core.security import hash_password

    added = []
    async with session_factory()() as db:
        for email, name, role in DEMO_MEMBERS:
            if (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none() is not None:
                continue
            password = secrets.token_urlsafe(12)
            user = User(tenant_id=t.id, email=email, name=name, role="editor", password_hash=hash_password(password))
            db.add(user)
            await db.flush()
            db.add(Membership(user_id=user.id, tenant_id=t.id, role=role, status="active"))
            added.append({"email": email, "role": role, "password": password})
        await db.commit()
    return added
