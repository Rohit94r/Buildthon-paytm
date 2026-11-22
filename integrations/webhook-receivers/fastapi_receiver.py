"""Minimal LayerFlow webhook receiver for Python sites (FastAPI). `pip install fastapi uvicorn`

LayerFlow → Connections → Webhook: URL https://yoursite.com/layerflow-webhook, secret = LAYERFLOW_WEBHOOK_SECRET
"""

import hashlib
import hmac
import json
import os

from fastapi import FastAPI, HTTPException, Request

app = FastAPI()
SECRET = os.environ["LAYERFLOW_WEBHOOK_SECRET"].encode()


@app.post("/layerflow-webhook")
async def layerflow_webhook(request: Request):
    raw = await request.body()  # sign over the exact bytes received
    expected = "sha256=" + hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("x-layerflow-signature", "")):
        raise HTTPException(401, "invalid signature")
    event = json.loads(raw)
    if event["event"] == "content.published":
        content = event["content"]
        print("New post from LayerFlow:", content["slug"], content["title"])  # save to your DB / CMS
    return {"ok": True}
