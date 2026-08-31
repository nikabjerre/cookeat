# Family Dinner

A small web app for planning family dinners:

- **Recipe book** — save recipes as a name + a link. When you add a link, the app reads
  the page and pulls out the ingredient list automatically (you can edit it).
- **This week** — seven day cards. Add a meal to any day either from the recipe book or
  as a free-text "manual" meal (with optional ingredients).
- **Grocery list** — built automatically from everything planned in the week you're
  looking at. Tick things off, edit the text, delete items, or add your own. Your
  changes stick even if the plan changes.

Everything is shared: open the same link on any phone or laptop and you see the same
plan, updating within ~15 seconds of someone else's change.

## Tech

Static `index.html` (vanilla JS, no build step) + two Vercel serverless functions:

| Route | Does |
|-------|------|
| `GET /api/state` · `PUT /api/state` | Reads / writes the shared state (recipes, plan, grocery list) in Upstash Redis. Falls back to `{ error: "no_database" }` if no store is connected. |
| `GET /api/parse-recipe?url=` | Fetches a recipe page server-side and extracts `recipeIngredient` from its schema.org JSON-LD (with microdata / list fallbacks). |

If no database is connected the app still works — it just stores data in that one
browser (the sync badge says "This device").

## Deploy

1. Push to GitHub.
2. [vercel.com](https://vercel.com) → **Add New… → Project** → import the repo.
   Framework Preset **Other**, all build settings blank → **Deploy**.
3. Add the shared database:
   - In the Vercel project → **Storage** tab → **Marketplace** → **Upstash** → **Redis**
     → create (free tier is plenty).
   - Vercel injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
   - **Redeploy** (Deployments tab → latest → ⋯ → Redeploy) so the functions pick them up.
4. Open the URL. The sync badge should say **Synced**. Share that URL with the family.

Node 18+ (global `fetch`). No npm dependencies.

## Local dev

Any static server works for the front-end, but `/api/*` needs the Vercel CLI:

```
npm i -g vercel
vercel dev
```

(or just deploy — it builds in well under a minute).

## Notes

- Recipe parsing relies on sites publishing schema.org Recipe data (most do, for Google).
  If a page has none, you'll get an empty list and a prompt to type the ingredients.
- `PUT /api/state` uses a simple revision check: if two people save at once, the later
  save is told to reload the newer version. With frequent auto-saves this window is tiny.
