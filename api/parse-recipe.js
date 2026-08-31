// GET /api/parse-recipe?url=<recipe page url>
// Fetches the page server-side and pulls the ingredient list out of it.
// Primary path: schema.org JSON-LD `recipeIngredient` (most recipe sites publish this
// for Google). Fallbacks: microdata, itemprop, and a couple of common list patterns.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  frac12: "½", frac14: "¼", frac34: "¾", frac13: "⅓", frac23: "⅔",
  deg: "°", eacute: "é", egrave: "è", agrave: "à", ouml: "ö", auml: "ä",
  uuml: "ü", aring: "å", oslash: "ø", aelig: "æ", Aring: "Å", Oslash: "Ø", AElig: "Æ",
  hellip: "…", ndash: "–", mdash: "—", middot: "·", times: "×",
};

function decodeEntities(s) {
  if (!s) return "";
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCP(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCP(parseInt(d, 10)))
    .replace(/&([a-z0-9]+);/gi, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}
function safeCP(cp) {
  try { return String.fromCodePoint(cp); } catch { return ""; }
}

function cleanLine(s) {
  return decodeEntities(String(s || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const txt = m[1].trim();
    try { out.push(JSON.parse(txt)); }
    catch {
      // some sites concatenate multiple objects or add trailing junk
      try { out.push(JSON.parse(txt.replace(/}\s*{/, "},{").replace(/^/, "[").replace(/$/, "]"))); }
      catch { /* give up on this block */ }
    }
  }
  return out;
}

function flattenNodes(data, acc = []) {
  if (!data) return acc;
  if (Array.isArray(data)) { data.forEach((d) => flattenNodes(d, acc)); return acc; }
  if (typeof data === "object") {
    acc.push(data);
    if (data["@graph"]) flattenNodes(data["@graph"], acc);
  }
  return acc;
}

function isRecipe(node) {
  const t = node && node["@type"];
  if (!t) return false;
  return Array.isArray(t) ? t.some((x) => /recipe/i.test(x)) : /recipe/i.test(String(t));
}

function pickImage(img) {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return pickImage(img[0]);
  if (typeof img === "object") return img.url || img.contentUrl || null;
  return null;
}

function fromJsonLd(html) {
  const nodes = flattenNodes(collectJsonLd(html));
  const recipe = nodes.find(isRecipe);
  if (!recipe) return null;
  let ing = recipe.recipeIngredient || recipe.ingredients || [];
  if (typeof ing === "string") ing = ing.split(/\r?\n/);
  const ingredients = (Array.isArray(ing) ? ing : []).map(cleanLine).filter(Boolean);
  return {
    title: cleanLine(recipe.name) || null,
    image: pickImage(recipe.image),
    ingredients,
    method: "json-ld",
  };
}

function fromMicrodata(html) {
  const out = [];
  // capture the whole element that carries the itemprop, matched to its own closing tag
  const re = /<(\w+)[^>]*\bitemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const line = cleanLine(m[2]);
    if (line && line.length < 240) out.push(line);
  }
  return out.length ? { title: metaTitle(html), image: ogImage(html), ingredients: out, method: "microdata" } : null;
}
function ogImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function fromClassList(html) {
  // last resort: <li> elements whose class mentions "ingredient"
  const out = [];
  const re = /<li[^>]*class=["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html))) {
    const line = cleanLine(m[1]);
    if (line && line.length < 200) out.push(line);
  }
  return out.length ? { title: metaTitle(html), image: ogImage(html), ingredients: out, method: "class-guess" } : null;
}

function metaTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return cleanLine(og[1]);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? cleanLine(t[1]) : null;
}

export default async function handler(req, res) {
  const url = (req.query.url || "").trim();
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return res.status(400).json({ error: "invalid_url", ingredients: [] });
  }
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
    });
    if (!r.ok) {
      return res.status(502).json({ error: "fetch_failed", status: r.status, ingredients: [] });
    }
    const html = await r.text();
    const parsed =
      fromJsonLd(html) || fromMicrodata(html) || fromClassList(html) ||
      { title: metaTitle(html), image: ogImage(html), ingredients: [], method: "none" };

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).json({
      title: parsed.title,
      image: parsed.image,
      ingredients: parsed.ingredients.slice(0, 60),
      method: parsed.method,
      found: parsed.ingredients.length,
    });
  } catch (e) {
    res.status(502).json({ error: "exception", detail: String(e), ingredients: [] });
  }
}
