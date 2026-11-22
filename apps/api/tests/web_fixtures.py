"""Extra pages for the mocked internet (wave 3 engines and every connection kind). `route()` returns a response
or None (fall through to the default fixtures in conftest)."""

from __future__ import annotations

import io
import json

import httpx

WATCH: dict[str, str] = {"html": ""}
SENT: list[httpx.Request] = []  # deliveries to Telegram / Slack / Discord / WordPress / Ghost


def make_pdf(lines: list[str]) -> bytes:
    """A minimal, valid one-page PDF with a text layer (offsets computed, so any reader accepts it)."""
    text = "BT /F1 12 Tf 50 750 Td 14 TL " + " ".join(f"({ln}) Tj T*" for ln in lines) + " ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(text)} >>\nstream\n{text}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Title (Fee notice 2026) >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def make_png(pattern: int, size: tuple[int, int] = (400, 300)) -> bytes:
    from PIL import Image

    w, h = size
    img = Image.new("L", (64, 48))
    for x in range(64):
        for y in range(48):
            v = {1: x * 4, 2: (x * y) % 256, 3: 255 - x * 4, 4: (x // 8 + y // 8) % 2 * 255}[pattern]
            img.putpixel((x, y), v % 256)
    buf = io.BytesIO()
    img.resize((w, h)).convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


IMAGES = {"hero": (1, (1200, 630)), "a": (2, (800, 600)), "a-copy": (2, (640, 480)), "b": (3, (900, 600)), "c": (4, (900, 600)), "icon": (3, (16, 16))}

PRODUCTS_1 = """<html><head><title>Shop</title><script type="application/ld+json">
{"@context": "https://schema.org", "@graph": [
 {"@type": "Product", "name": "Northwind Kettle 1.5L", "url": "/p/kettle", "offers": {"@type": "Offer", "price": "999", "priceCurrency": "INR"},
  "aggregateRating": {"ratingValue": "4.2", "reviewCount": "88"}},
 {"@type": "Product", "name": "Contoso Toaster", "url": "/p/toaster", "offers": {"price": "1500"}, "aggregateRating": {"ratingValue": 4.5}}]}
</script></head><body><h1>Products</h1><a rel="next" href="/products?page=2">Next ›</a></body></html>"""
PRODUCTS_2 = """<html><head><title>Shop p2</title><script type="application/ld+json">
{"@type": "Product", "name": "Fabrikam Mixer", "offers": {"price": 2499}, "aggregateRating": {"ratingValue": "3.9"}}
</script></head><body><h1>Products page 2</h1></body></html>"""
FEES = """<html><body><h1>Fees 2026</h1><table><caption>Course fees</caption>
<thead><tr><th>Course</th><th>Annual fees</th><th>Seats</th></tr></thead>
<tbody><tr><td>B.Tech CSE</td><td>₹ 1,20,000</td><td>60</td></tr><tr><td>MBA</td><td>₹ 2,50,000</td><td>120</td></tr></tbody></table></body></html>"""
EVENTS_TEXT = """<html><body><h1>Upcoming events</h1>
<p>Name: Monsoon AI Sprint</p><p>Start date: 2027-01-10</p><p>Prize pool: ₹3,00,000</p>
<p>Name: ChainCraft Weekend</p><p>Start date: 2027-02-01</p><p>Prize pool: $10,000</p></body></html>"""
EVENTS_LIST = """<html><body><nav><a href="/">Home</a></nav><h1>Events</h1>
<ul><li><a href="/list2/monsoon-ai">Monsoon AI Sprint</a></li><li><a href="/list2/chaincraft">ChainCraft Weekend</a></li></ul></body></html>"""
EVENT_PAGE = """<html><head><title>{name}</title></head><body><div itemscope itemtype="https://schema.org/Event">
<h1 itemprop="name">{name}</h1><time itemprop="startDate" datetime="{date}">{date}</time>
<span itemprop="location">{city}</span></div><p>Organizer: Demo Labs</p></body></html>"""
SITE = {
    "/": """<html><head><title>Acme Home</title><meta name="description" content="Acme makes things."></head><body><h1>Acme</h1>
<a href="/about">About</a> <a href="/blog/one?utm_source=x">Post one</a> <a href="/blog/two">Post two</a> <a href="/missing">Old page</a>
<a href="https://other.example.net/x">Partner</a></body></html>""",
    "/about": "<html><head><title>About Acme</title></head><body><h1>About</h1><p>We are Acme.</p><a href='/'>Home</a></body></html>",
    "/blog/one": "<html><head><title>Post one</title></head><body><h1>One</h1><a href='/blog/two'>Next post</a></body></html>",
    "/blog/two": "<html><head><title>Post two</title></head><body><h1>Two</h1></body></html>",
    "/contact": "<html><head><title>Contact</title></head><body><h1>Contact</h1></body></html>",
}
GALLERY = """<html><head><meta property="og:image" content="https://img.example.com/hero.png"></head><body><main>
<figure><img src="https://img.example.com/a.png" width="800" height="600"><figcaption>Campus library at dusk</figcaption></figure>
<img src="https://img.example.com/a-copy.png" alt="Library (smaller copy)"><img src="https://img.example.com/icon.png" width="16" height="16">
</main></body></html>"""


def _json(data, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=data)


def route(request: httpx.Request) -> httpx.Response | None:
    host, path, method = request.url.host, request.url.path, request.method
    query = dict(request.url.params)
    if host == "shop.example.com":
        if path == "/products":
            return httpx.Response(200, text=PRODUCTS_2 if query.get("page") == "2" else PRODUCTS_1, headers={"content-type": "text/html"})
        if path == "/fees":
            return httpx.Response(200, text=FEES, headers={"content-type": "text/html; charset=utf-8"})
    if host == "events.example.com":
        if path == "/list":
            return httpx.Response(200, text=EVENTS_TEXT, headers={"content-type": "text/html; charset=utf-8"})
        if path == "/list2":
            return httpx.Response(200, text=EVENTS_LIST, headers={"content-type": "text/html"})
        if path == "/list2/monsoon-ai":
            return httpx.Response(200, text=EVENT_PAGE.format(name="Monsoon AI Sprint", date="2027-01-10", city="Pune"), headers={"content-type": "text/html"})
        if path == "/list2/chaincraft":
            return httpx.Response(200, text=EVENT_PAGE.format(name="ChainCraft Weekend", date="2027-02-01", city="Online"), headers={"content-type": "text/html"})
    if host == "site.example.com":
        if path == "/sitemap.xml":
            return httpx.Response(200, text='<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                  "<url><loc>https://site.example.com/contact</loc></url></urlset>", headers={"content-type": "application/xml"})
        if path in SITE:
            return httpx.Response(200, text=SITE[path], headers={"content-type": "text/html"})
        return httpx.Response(404, text="gone")
    if host == "other.example.net":
        return httpx.Response(200, text="<html><body>partner</body></html>", headers={"content-type": "text/html"})
    if host == "docs.example.com":
        if path == "/notice.pdf":
            return httpx.Response(200, content=make_pdf(["Fee notice 2026", "Total fees: 250000", "Last date: 2026-12-31"]),
                                  headers={"content-type": "application/pdf"})
        if path == "/page.html":
            return httpx.Response(200, text="<html><body>not a pdf</body></html>", headers={"content-type": "text/html"})
    if host == "watch.example.com" and path == "/notices":
        return httpx.Response(200, text=WATCH["html"], headers={"content-type": "text/html"})
    if host == "gallery.example.com":
        return httpx.Response(200, text=GALLERY, headers={"content-type": "text/html"})
    if host == "img.example.com":
        name = path.strip("/").rsplit(".", 1)[0]
        if name in IMAGES:
            pattern, size = IMAGES[name]
            return httpx.Response(200, content=make_png(pattern, size), headers={"content-type": "image/png"})
    if host == "api.openverse.org":
        return _json({"result_count": 3, "results": [
            {"url": "https://img.example.com/b.png", "thumbnail": "https://img.example.com/b.png", "foreign_landing_url": "https://flickr.example/b",
             "license": "by-nc", "license_version": "2.0", "license_url": "https://creativecommons.org/licenses/by-nc/2.0/", "creator": "Ann",
             "provider": "flickr", "width": 900, "height": 600, "title": "Students in a lab"},
            {"url": "https://img.example.com/c.png", "thumbnail": "https://img.example.com/c.png", "foreign_landing_url": "https://flickr.example/c",
             "license": "cc0", "license_version": "1.0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/", "creator": "Bo",
             "provider": "flickr", "width": 900, "height": 600, "title": "Campus lawn"}]})
    if host == "commons.wikimedia.org":
        return _json({"query": {"pages": {"11": {"index": 1, "title": "File:Campus.png", "imageinfo": [{
            "url": "https://img.example.com/a.png", "thumburl": "https://img.example.com/a-copy.png", "descriptionurl": "https://commons.wikimedia.org/wiki/File:Campus.png",
            "width": 800, "height": 600, "extmetadata": {"LicenseShortName": {"value": "CC BY-SA 4.0"},
                                                          "LicenseUrl": {"value": "https://creativecommons.org/licenses/by-sa/4.0"},
                                                          "Artist": {"value": "<a href='x'>Chen</a>"}, "ImageDescription": {"value": "A campus"}}}]}}}})
    # ---- connection services
    if host == "blog.example.com" and path.startswith("/wp-json/"):
        if not request.headers.get("authorization", "").startswith("Basic "):
            return _json({"code": "rest_not_logged_in", "message": "You are not currently logged in."}, 401)
        if path == "/wp-json/wp/v2/users/me":
            return _json({"id": 1, "name": "Editor"})
        if path.startswith("/wp-json/wp/v2/posts") and method == "POST":
            SENT.append(request)
            return _json({"id": 7, "link": "https://blog.example.com/?p=7"}, 201)
    if host == "ghost.example.com" and path.startswith("/ghost/api/admin/"):
        if not request.headers.get("authorization", "").startswith("Ghost "):
            return _json({"errors": [{"message": "Authorization failed"}]}, 401)
        if path == "/ghost/api/admin/site/":
            return _json({"site": {"title": "Ghost demo"}})
        if path == "/ghost/api/admin/posts/" and method == "POST":
            SENT.append(request)
            return _json({"posts": [{"id": "g1", "url": "https://ghost.example.com/hello/"}]}, 201)
    if host == "api.telegram.org":
        if "/botbad" in path:
            return _json({"ok": False, "description": "Unauthorized"}, 401)
        if path.endswith("/getMe"):
            return _json({"ok": True, "result": {"username": "lf_demo_bot"}})
        if path.endswith("/sendMessage"):
            SENT.append(request)
            return _json({"ok": True, "result": {"message_id": 5}})
    if host == "hooks.slack.com":
        body = json.loads(request.content or b"{}")
        if not body.get("text"):
            return httpx.Response(400, text="no_text")
        SENT.append(request)
        return httpx.Response(200, text="ok")
    if host == "discord.com" and path.startswith("/api/webhooks/"):
        if method == "GET":
            return _json({"name": "LF hook", "channel_id": "1"})
        SENT.append(request)
        return httpx.Response(204)
    return None
