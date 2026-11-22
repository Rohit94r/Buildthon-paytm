"""LayerFlow Python SDK — zero-dependency client for the LayerFlow public API.

    from layerflow import LayerFlow, verify_webhook

    lf = LayerFlow("https://agents.example.com", api_key="lf_pk_...")
    posts = lf.content.list(limit=10)["items"]
    colleges = lf.datasets.records("colleges", sort="nirf_rank:asc")["items"]
    run = lf.workflows.run("<pipeline id>", input={"url": "https://..."}, wait=True)

Docs: docs/integrations/sdk.md · API: docs/platform/API.md
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

__all__ = ["LayerFlow", "LayerFlowError", "verify_webhook"]
__version__ = "1.0.0"

TERMINAL = {"succeeded", "failed", "cancelled", "awaiting_approval"}


class LayerFlowError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message, self.details = status, code, message, details


class _Http:
    def __init__(self, base_url: str, api_key: str, timeout: float) -> None:
        if not base_url or not api_key:
            raise ValueError("base_url and api_key are required")
        self.base = base_url.rstrip("/") + "/api/public/v1"
        self.key = api_key
        self.timeout = timeout

    def request(self, method: str, path: str, *, query: dict[str, Any] | None = None,
                body: Any = None, headers: dict[str, str] | None = None) -> Any:
        url = self.base + path
        if query:
            clean = {k: v for k, v in query.items() if v is not None and v != ""}
            if clean:
                url += "?" + urllib.parse.urlencode(clean)
        data = json.dumps(body).encode() if body is not None else None
        h = {"X-API-Key": self.key, "Accept": "application/json", "User-Agent": f"layerflow-python/{__version__}"}
        if data is not None:
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:  # noqa: S310 (https base URL supplied by caller)
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read() or b"{}").get("error", {})
            except ValueError:
                err = {}
            raise LayerFlowError(e.code, err.get("code", "http_error"), err.get("message", str(e)), err.get("details")) from None


class _Content:
    def __init__(self, http: _Http) -> None:
        self._h = http

    def list(self, *, limit: int = 20, offset: int = 0, tag: str | None = None, format: str | None = None) -> dict:
        return self._h.request("GET", "/content", query={"limit": limit, "offset": offset, "tag": tag, "format": format})

    def get(self, slug: str) -> dict:
        return self._h.request("GET", f"/content/{urllib.parse.quote(slug, safe='')}")


class _Datasets:
    def __init__(self, http: _Http) -> None:
        self._h = http

    def records(self, dataset: str, *, q: str | None = None, limit: int = 50, offset: int = 0, sort: str | None = None) -> dict:
        return self._h.request("GET", f"/datasets/{urllib.parse.quote(dataset, safe='')}/records",
                               query={"q": q, "limit": limit, "offset": offset, "sort": sort})

    def record(self, dataset: str, key: str) -> dict:
        return self._h.request("GET", f"/datasets/{urllib.parse.quote(dataset, safe='')}/records/{urllib.parse.quote(key, safe='')}")


class _Runs:
    def __init__(self, http: _Http) -> None:
        self._h = http

    def get(self, run_id: str) -> dict:
        return self._h.request("GET", f"/runs/{urllib.parse.quote(run_id, safe='')}")

    def wait(self, run_id: str, *, timeout_s: float = 600, poll_s: float = 2.0) -> dict:
        deadline = time.monotonic() + timeout_s
        while True:
            run = self.get(run_id)
            if run["status"] in TERMINAL or time.monotonic() > deadline:
                return run
            time.sleep(poll_s)


class _Runner:
    def __init__(self, http: _Http, runs: _Runs, prefix: str) -> None:
        self._h, self._runs, self._prefix = http, runs, prefix

    def run(self, target_id: str, *, input: dict | None = None, wait: bool = False,
            idempotency_key: str | None = None, timeout_s: float = 600) -> dict:
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        run = self._h.request("POST", f"/{self._prefix}/{urllib.parse.quote(target_id, safe='')}/run",
                              body={"input": input or {}}, headers=headers)
        return self._runs.wait(run["id"], timeout_s=timeout_s) if wait else run


class LayerFlow:
    """Client bound to one workspace (the API key's workspace)."""

    def __init__(self, base_url: str, api_key: str, *, timeout: float = 30.0) -> None:
        self._http = _Http(base_url, api_key, timeout)
        self.content = _Content(self._http)
        self.datasets = _Datasets(self._http)
        self.runs = _Runs(self._http)
        self.workflows = _Runner(self._http, self.runs, "workflows")
        self.agents = _Runner(self._http, self.runs, "agents")

    def chat(self, message: str, *, dataset: str | None = None, assistant_id: str | None = None,
             history: list[dict] | None = None, compare_keys: list[str] | None = None) -> dict:
        body = {"message": message, "dataset": dataset, "assistant_id": assistant_id,
                "history": history or [], "compare_keys": compare_keys}
        return self._http.request("POST", "/chat", body={k: v for k, v in body.items() if v is not None})


def verify_webhook(raw_body: bytes, signature_header: str | None, secret: str) -> bool:
    """Check X-LayerFlow-Signature (sha256=<hex HMAC of the raw body>)."""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
