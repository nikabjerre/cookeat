// Shared family state — one JSON blob in Redis, keyed by REDIS_URL.
//   GET  /api/state          -> the whole state object
//   PUT  /api/state  (body)  -> save; body.baseRev must match current rev or 409
//
// No database configured (no REDIS_URL) -> 503 { error: "no_database" } and the
// front-end falls back to this-device-only storage.

import { createClient } from "redis";

const KEY = "cookeat:state:v1";
const EMPTY = () => ({
  recipes: [],
  plan: {},
  grocery: { done: {}, hidden: {}, edits: {}, extra: [] },
  rev: 0,
  updatedAt: null,
});

let client = null;
async function getClient() {
  if (client && client.isOpen) return client;
  client = createClient({ url: process.env.REDIS_URL });
  client.on("error", () => {});
  await client.connect();
  return client;
}

export default async function handler(req, res) {
  if (!process.env.REDIS_URL) {
    return res.status(503).json({
      error: "no_database",
      message: "Set REDIS_URL (connect a Redis store to this Vercel project) to enable sharing.",
    });
  }

  try {
    const c = await getClient();

    if (req.method === "GET") {
      const raw = await c.get(KEY);
      return res.status(200).json(raw ? JSON.parse(raw) : EMPTY());
    }

    if (req.method === "PUT" || req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "bad_body" });
      }

      const raw = await c.get(KEY);
      const current = raw ? JSON.parse(raw) : EMPTY();

      if (body.baseRev != null && current.rev != null && body.baseRev !== current.rev) {
        return res.status(409).json({ error: "conflict", current });
      }

      const next = {
        recipes: Array.isArray(body.recipes) ? body.recipes : [],
        plan: body.plan && typeof body.plan === "object" ? body.plan : {},
        grocery: body.grocery && typeof body.grocery === "object" ? body.grocery : EMPTY().grocery,
        rev: (current.rev || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      await c.set(KEY, JSON.stringify(next));
      return res.status(200).json({ ok: true, rev: next.rev, updatedAt: next.updatedAt });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String(e && e.message || e) });
  }
}
