"""Workspace progress: points, levels, streaks, achievements and the onboarding checklist, all derived from real
rows (runs, content, records, agents, connections, members, audit). Nothing is stored or synthesised: the same
data always gives the same numbers.

Time saved is an estimate: items processed × typical manual minutes per item for that agent kind (table below),
labelled as an estimate in the UI."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.models import (
    Agent,
    AuditLog,
    Connection,
    ContentItem,
    DatasetRecord,
    Membership,
    Pipeline,
    PipelineRun,
    Tenant,
)

# action key -> (label, points). The activity feed uses the same table, so points always add up.
XP = {
    "run_succeeded": ("Successful run", 10),
    "item_processed": ("Item processed (up to 200 per run)", 1),
    "content_published": ("Content published", 25),
    "record_saved": ("Dataset record saved", 1),
    "agent_activated": ("Agent activated", 15),
    "connection_working": ("Connection working", 20),
    "approval_handled": ("Approval handled", 5),
}
ITEMS_PER_RUN_CAP = 200
APPROVAL_ACTIONS = ("content.approved", "content.rejected", "run.approved", "run.rejected")
LEVELS = [(0, "Getting started"), (100, "Explorer"), (300, "Builder"), (700, "Automator"), (1500, "Pro operator"),
          (3000, "Power user"), (6000, "Agent master"), (12000, "Legend")]
# Typical minutes a person spends per item doing the same work by hand (estimate).
MINUTES_PER_ITEM = {
    "web_scraper": 2, "news_monitor": 3, "persona_rewriter": 20, "multi_format": 25, "seo_optimizer": 8, "quality_gate": 4,
    "data_transform": 0.5, "auto_publisher": 5, "dataset_builder": 2, "comparison_assistant": 3, "custom_llm": 5, "researcher": 30,
    "fact_checker": 10, "site_auditor": 3, "image_finder": 4, "change_detector": 1, "http_action": 2, "notifier": 2, "report_builder": 30,
    "link_collector": 0.3, "document_reader": 10, "page_watcher": 3, "keyword_researcher": 0.5, "comparer": 6,
    "serpapi_search": 4, "you_research": 25,
}


def level_for(xp: int) -> tuple[int, str, int, int]:
    """(level number, name, xp at level start, xp for next level)."""
    idx = max(i for i, (threshold, _) in enumerate(LEVELS) if xp >= threshold)
    start = LEVELS[idx][0]
    nxt = LEVELS[idx + 1][0] if idx + 1 < len(LEVELS) else start * 2
    return idx + 1, LEVELS[idx][1], start, nxt


def streaks(days: set[date], today: date) -> tuple[int, int]:
    """(current streak ending today — or yesterday if nothing ran yet today, best streak)."""
    best = run = 0
    prev: date | None = None
    for d in sorted(days):
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        best = max(best, run)
        prev = d
    cur, d = 0, today if today in days else today - timedelta(days=1)
    while d in days:
        cur += 1
        d -= timedelta(days=1)
    return cur, best


def _achievement(key: str, title: str, description: str, icon: str, current: int, target: int, at: datetime | None) -> dict[str, Any]:
    unlocked = current >= target
    return {"key": key, "title": title, "description": description, "icon": icon, "unlocked": unlocked,
            "unlocked_at": at.isoformat() if unlocked and at else None, "progress": round(min(1.0, current / target), 3) if target else 1.0,
            "target": target, "current": current}


def _nth(times: list[datetime], n: int) -> datetime | None:
    return sorted(times)[n - 1] if len(times) >= n else None


async def progress(db: AsyncSession, tenant: Tenant) -> dict[str, Any]:
    tid = tenant.id
    tz = ZoneInfo(tenant.timezone or "UTC")
    now = utcnow()
    today = now.astimezone(tz).date()
    week_ago = now - timedelta(days=7)
    day_start = datetime.combine(today, datetime.min.time(), tzinfo=tz)

    runs = (await db.execute(select(PipelineRun.status, PipelineRun.created_at, PipelineRun.finished_at, PipelineRun.items_out, PipelineRun.steps)
                             .where(PipelineRun.tenant_id == tid))).all()
    ok_runs = [r for r in runs if r.status == "succeeded"]
    content = (await db.execute(select(ContentItem.status, ContentItem.created_at, ContentItem.published_at).where(ContentItem.tenant_id == tid))).all()
    published = [c.published_at for c in content if c.status == "published" and c.published_at]
    records = [r for (r,) in (await db.execute(select(DatasetRecord.created_at).where(DatasetRecord.tenant_id == tid))).all()]
    agents = [a for (a,) in (await db.execute(select(Agent.created_at).where(Agent.tenant_id == tid))).all()]
    scheduled = (await db.execute(select(func.count()).select_from(Agent).where(Agent.tenant_id == tid, Agent.every_minutes.is_not(None)))).scalar_one() + \
        (await db.execute(select(func.count()).select_from(Pipeline).where(Pipeline.tenant_id == tid, Pipeline.trigger_type == "schedule"))).scalar_one()
    workflows = [p for p in (await db.execute(select(Pipeline.steps, Pipeline.created_at).where(Pipeline.tenant_id == tid))).all()]
    from app.platform.connections import status_of

    conns = list((await db.execute(select(Connection).where(Connection.tenant_id == tid))).scalars())
    working = [c for c in conns if status_of(c) == "connected" and (c.last_used_at is not None or c.last_error is None)]
    members = (await db.execute(select(func.count()).select_from(Membership).where(Membership.tenant_id == tid))).scalar_one()
    approvals = [a for (a,) in (await db.execute(select(AuditLog.created_at).where(AuditLog.tenant_id == tid, AuditLog.action.in_(APPROVAL_ACTIONS)))).all()]

    items_xp = sum(min(int(r.items_out or 0), ITEMS_PER_RUN_CAP) for r in ok_runs)
    counts = {"run_succeeded": len(ok_runs), "item_processed": items_xp, "content_published": len(published), "record_saved": len(records),
              "agent_activated": len(agents), "connection_working": len(working), "approval_handled": len(approvals)}
    xp = sum(XP[k][1] * n for k, n in counts.items())
    level, name, start, nxt = level_for(xp)

    run_days = {(r.finished_at or r.created_at).astimezone(tz).date() for r in ok_runs}
    streak, best = streaks(run_days, today)

    def since(ts: datetime | None, start_at: datetime) -> bool:
        return ts is not None and ts >= start_at

    week_runs = [r for r in runs if since(r.created_at, week_ago)]
    week_done = [r for r in week_runs if r.status in ("succeeded", "failed")]
    week_ok = [r for r in week_runs if r.status == "succeeded"]
    minutes = 0.0
    for r in week_ok:
        for s in r.steps or []:
            if s.get("status") == "succeeded":
                minutes += int(s.get("items_out") or 0) * MINUTES_PER_ITEM.get(s.get("kind") or "", 1)

    total_items = sum(int(r.items_out or 0) for r in ok_runs)
    ok_times = [r.finished_at or r.created_at for r in ok_runs]
    item_times: list[tuple[datetime, int]] = []
    acc = 0
    for r in sorted(ok_runs, key=lambda r: r.finished_at or r.created_at):
        acc += int(r.items_out or 0)
        item_times.append((r.finished_at or r.created_at, acc))

    def items_at(n: int) -> datetime | None:
        """When the running total of processed items first reached n."""
        return next((t for t, total in item_times if total >= n), None)

    multi_step = [p.created_at for p in workflows if len(p.steps or []) >= 2]
    failed_week = sum(1 for r in week_runs if r.status == "failed")
    achievements = [
        _achievement("first_run", "First run", "Run any agent or workflow successfully once", "Play", len(ok_runs), 1, _nth(ok_times, 1)),
        _achievement("ten_runs", "Ten runs", "Complete 10 successful runs", "Repeat", len(ok_runs), 10, _nth(ok_times, 10)),
        _achievement("hundred_items", "100 items", "Process 100 items", "Layers", total_items, 100, items_at(100)),
        _achievement("thousand_items", "1,000 items", "Process 1,000 items", "Rocket", total_items, 1000, items_at(1000)),
        _achievement("first_publish", "First publish", "Publish content to a website or channel", "Send", len(published), 1, _nth(published, 1)),
        _achievement("ten_published", "Ten published", "Publish 10 pieces of content", "Megaphone", len(published), 10, _nth(published, 10)),
        _achievement("first_dataset", "First dataset", "Save your first dataset record", "Database", len(records), 1, _nth(records, 1)),
        _achievement("hundred_records", "100 records", "Keep 100 records in your datasets", "Table", len(records), 100, _nth(records, 100)),
        _achievement("three_agents", "Team of three", "Activate 3 agents", "Bot", len(agents), 3, _nth(agents, 3)),
        _achievement("five_agents", "Five agents", "Activate 5 agents", "Users", len(agents), 5, _nth(agents, 5)),
        _achievement("first_workflow", "First workflow", "Chain two or more agents in a workflow", "Workflow", len(multi_step), 1, _nth(multi_step, 1)),
        _achievement("first_connection", "Connected", "Connect a website or channel that works", "Plug", len(working), 1, None),
        _achievement("on_schedule", "On autopilot", "Schedule an agent or workflow", "Clock", int(scheduled), 1, None),
        _achievement("team_player", "Team player", "Invite a teammate", "UserPlus", int(members), 2, None),
        _achievement("first_approval", "Editor's eye", "Approve or reject something", "CheckCheck", len(approvals), 1, _nth(approvals, 1)),
        _achievement("streak_3", "3-day streak", "Successful runs on 3 days in a row", "Flame", best, 3, None),
        _achievement("streak_7", "7-day streak", "Successful runs 7 days in a row", "Flame", best, 7, None),
        _achievement("zero_failures_week", "Clean week", "At least 5 runs this week and none failed", "ShieldCheck",
                     len(week_done) if failed_week == 0 else 0, 5, None),
    ]
    steps = [
        ("connect_website", "Connect your website", "Add a Next.js, WordPress, Ghost or webhook connection.", "/connections", len(conns) >= 1),
        ("activate_agents", "Activate 3 agents", "Pick ready-made agents from the catalogue.", "/agents/catalog", len(agents) >= 3),
        ("create_workflow", "Create a workflow", "Chain agents so they run one after another.", "/workflows/new", len(workflows) >= 1),
        ("first_run", "Run it once", "Start a run and watch the agents work live.", "/workflows", len(ok_runs) >= 1),
        ("first_publish", "Publish something", "Approve content and publish it to your site or channel.", "/content", len(published) >= 1),
        ("invite_teammate", "Invite a teammate", "Give someone a role in this workspace.", "/settings/team", members >= 2),
    ]
    return {
        "level": level, "level_name": name, "xp": xp, "xp_level_start": start, "xp_next_level": nxt,
        "streak_days": streak, "best_streak_days": best,
        "today": {"runs": sum(1 for r in runs if since(r.created_at, day_start)),
                  "items": sum(int(r.items_out or 0) for r in ok_runs if since(r.finished_at or r.created_at, day_start)),
                  "content": sum(1 for c in content if since(c.created_at, day_start)),
                  "published": sum(1 for p in published if since(p, day_start)),
                  "records": sum(1 for r in records if since(r, day_start))},
        "week": {"runs": len(week_runs), "items": sum(int(r.items_out or 0) for r in week_ok),
                 "content": sum(1 for c in content if since(c.created_at, week_ago)), "published": sum(1 for p in published if since(p, week_ago)),
                 "success_rate": round(len(week_ok) / len(week_done), 3) if week_done else None},
        "time_saved_minutes_week": int(round(minutes)),
        "achievements": achievements,
        "next_steps": [{"key": k, "title": t, "description": d, "href": h, "done": bool(done)} for k, t, d, h, done in steps],
        "xp_rules": [{"action": label, "points": pts} for label, pts in XP.values()],
    }

