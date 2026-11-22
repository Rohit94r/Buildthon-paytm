// Minimal LayerFlow webhook receiver for any Node site (Express). `npm i express`
// LayerFlow → Connections → Webhook: URL https://yoursite.com/layerflow-webhook, secret = LAYERFLOW_WEBHOOK_SECRET
const crypto = require("node:crypto");
const express = require("express");

const app = express();
const SECRET = process.env.LAYERFLOW_WEBHOOK_SECRET;

// Keep the raw body: the signature is computed over the exact bytes LayerFlow sent.
app.post("/layerflow-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(req.body).digest("hex");
  const given = req.get("x-layerflow-signature") || "";
  if (given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return res.status(401).json({ error: "invalid signature" });
  }
  const { event, content } = JSON.parse(req.body.toString("utf8"));
  if (event === "content.published") {
    // Save it in your own database / CMS, or just clear your cache.
    console.log("New post from LayerFlow:", content.slug, content.title);
  }
  res.json({ ok: true });
});

app.listen(process.env.PORT || 4000);
