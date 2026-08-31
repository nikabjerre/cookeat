// Shared family state, stored in one key in Upstash Redis (REST API, no npm deps).
//   GET  /api/state            -> the whole state object
//   PUT  /api/state   (body)   -> save; body.baseRev must match current rev or 409
//
// Works without a database too: if no Upstash env vars are set it reports
// { error: "no_database" } and the app falls back to this-device-only storage.

const URL_ENV = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const TOKEN_ENV = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
const KEY = "familydinner:state:v1";

const EMPTY = () => ({
  recipes: [],
  plan: {},
  grocery: { done: {}, hidden: {}, edits: {}, extra: [] },
  rev: 0,
  updatedAt: null,
});

async function redis(command) {
  const r = await fetch(URL_ENV, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN_ENV, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("redis " + r.status + " " + JSON.stringify(j));
  return j.result;
}

export default async function handler(req, res) {
  if (!URL_ENV || !TOKEN_ENV) {
    return res.status(503).json({
      error: "no_database",
      message: "Connect an Upstash Redis store to this Vercel project to enable sharing.",
    });
  }

  try {
    if (req.method === "GET") {
      const raw = await redis(["GET", KEY]);
      return res.status(200).json(raw ? JSON.parse(raw) : EMPTY());
    }

    if (req.method === "PUT" || req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "bad_body" });
      }

      const raw = await redis(["GET", KEY]);
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
      await redis(["SET", KEY, JSON.stringify(next)]);
      return res.status(200).json({ ok: true, rev: next.rev, updatedAt: next.updatedAt });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(500).json({ error: "server_error", detail: String(e) });
  }
}
