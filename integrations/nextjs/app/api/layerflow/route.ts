// Webhook receiver: LayerFlow calls this when content is published, so your site refreshes instantly.
// Copy into your Next.js site as `app/api/layerflow/route.ts`.
// In LayerFlow → Connections → Next.js site, set the URL to https://yoursite.com/api/layerflow
// and use the same secret as LAYERFLOW_WEBHOOK_SECRET.

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";

function validSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const given = header.slice("sha256=".length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

export async function POST(req: Request) {
  const secret = process.env.LAYERFLOW_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "LAYERFLOW_WEBHOOK_SECRET not set" }, { status: 500 });

  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-layerflow-signature"), secret)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw) as { event: string; content?: { slug: string } };

  // Content lives in LayerFlow and is fetched through lib/layerflow.ts, so all we do is drop caches.
  // ("layout" on "/" refreshes every page that reads LayerFlow data; narrow it if your site is large.)
  revalidatePath("/", "layout");
  if (event.content?.slug) revalidatePath(`/news/${event.content.slug}`);

  return Response.json({ ok: true, event: event.event });
}
