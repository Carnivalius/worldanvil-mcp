/**
 * World Anvil MCP Server - paging and the world outline
 *
 * World Anvil's list calls return `entities` and nothing else: no total and
 * no "more" flag (Live 2026-11-12). So a list tool has to work out for
 * itself whether there is another page, and say so.
 */

import { templateOfArticle } from "./article-templates.js";

export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 100;

/**
 * The largest page World Anvil has actually been seen to return in one
 * call. A page that comes back short but smaller than this is certainly the
 * end of the list. A short page at or above it could instead be a ceiling
 * on World Anvil's side that nobody has documented, so that case is
 * confirmed with one extra one-item request. 51 came back in one call on
 * 2026-11-13, so a default list of 50 never needs the extra request.
 * Raise this as larger pages are seen live.
 */
export const PROVEN_PAGE = 51;

function wholeNumber(value, name, min, fallback) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min)
    throw new Error(`${name} must be a whole number of ${min} or more`);
  return n;
}

/**
 * One page of a list, with a plain statement of where it stands.
 *
 * Asks for one item more than wanted: if it arrives, there is more.
 * `fetchPage({ limit, offset })` must return World Anvil's list answer.
 */
export async function listPage(fetchPage, args = {}) {
  const limit = Math.min(wholeNumber(args.limit, "limit", 1, DEFAULT_PAGE), MAX_PAGE);
  const offset = wholeNumber(args.offset, "offset", 0, 0);

  const answer = await fetchPage({ limit: limit + 1, offset });
  const got = Array.isArray(answer?.entities) ? answer.entities : [];
  const entities = got.slice(0, limit);

  let more = got.length > limit;
  if (!more && got.length >= PROVEN_PAGE) {
    const probe = await fetchPage({ limit: 1, offset: offset + got.length });
    more = Array.isArray(probe?.entities) && probe.entities.length > 0;
  }

  const next = more ? offset + entities.length : null;
  return {
    ...answer,
    entities,
    paging: {
      returned: entities.length,
      offset,
      more,
      next_offset: next,
      note: more
        ? `${entities.length} returned and there are more. Call again with offset ${next} for the next ones.`
        : entities.length === 0 && offset > 0
          ? "Nothing at this offset: the list ended before it."
          : `${entities.length} returned. That is the end of the list.`,
    },
  };
}

/** Every item of a list, paging until World Anvil returns an empty page. */
export async function listAll(fetchPage, { pageSize = DEFAULT_PAGE, maxItems = 20000 } = {}) {
  const seen = new Set();
  const items = [];
  let offset = 0;
  while (items.length < maxItems) {
    const answer = await fetchPage({ limit: pageSize, offset });
    const got = Array.isArray(answer?.entities) ? answer.entities : [];
    if (got.length === 0) break;
    let fresh = 0;
    for (const item of got) {
      const id = String(item?.id ?? "").toLowerCase();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push(item);
      fresh += 1;
    }
    if (fresh === 0) break; // the same page again: stop rather than loop
    // A short page below the size World Anvil is known to return is the end:
    // no need to ask for an empty page to prove it.
    if (got.length < pageSize && got.length < PROVEN_PAGE) break;
    offset += got.length;
  }
  return items;
}

const lower = (id) => String(id ?? "").toLowerCase();

function articleLine(article) {
  const template = templateOfArticle({ entityClass: article.entityClass });
  return {
    id: article.id,
    title: article.title,
    template: template?.siteName ?? article.entityClass ?? null,
    icon: article.icon || null,
    state: article.state ?? null,
    draft: article.isDraft ?? null,
  };
}

/**
 * The whole world in one answer: the category tree with each category's
 * articles under it, plus the articles in no category.
 *
 * World Anvil gives no single call for this. A list record has no parent
 * and an article record has no category, so each category is read in full
 * (one request each) for its parent and its articles.
 */
export async function worldOutline(client, worldId) {
  const categories = await listAll((o) => client.listCategories(worldId, o));
  const articles = await listAll((o) => client.listArticles(worldId, o));
  const articleById = new Map(articles.map((a) => [lower(a.id), a]));

  const nodes = new Map();
  const placed = new Set();
  for (const listed of categories) {
    const full = await client.getCategory(listed.id);
    const inside = Array.isArray(full?.articles) ? full.articles : [];
    const node = {
      id: listed.id,
      title: full?.title ?? listed.title,
      icon: full?.icon || null,
      state: full?.state ?? listed.state ?? null,
      parentId: full?.parent?.id ? lower(full.parent.id) : null,
      articles: inside
        .filter((a) => a?.id)
        .map((a) => {
          placed.add(lower(a.id));
          return articleLine(articleById.get(lower(a.id)) ?? a);
        }),
      categories: [],
    };
    nodes.set(lower(listed.id), node);
  }

  const top = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null;
    (parent ? parent.categories : top).push(node);
  }
  for (const node of nodes.values()) delete node.parentId;

  const uncategorised = articles.filter((a) => !placed.has(lower(a.id))).map(articleLine);

  return {
    world_id: worldId,
    totals: {
      categories: nodes.size,
      articles: articles.length,
      uncategorised: uncategorised.length,
    },
    categories: top,
    uncategorised,
    note:
      "Complete: every category and article in the world. Variants (Country, Military, " +
      "Religion, God/Deity) show as their base template here; read the article for its variant.",
  };
}

/**
 * A title as it is compared: capitals, surrounding spaces and runs of
 * spaces make no difference. "The Iron Mountains" and "Iron Mountains"
 * stay different.
 */
export function titleKey(title) {
  return String(title ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Every article in the world, as World Anvil lists them. */
export function allArticles(client, worldId) {
  return listAll((o) => client.listArticles(worldId, o));
}

/**
 * Every article in the world whose title is the same as `title`
 * (see titleKey). Reads the world's whole article list.
 */
export async function articlesWithTitle(client, worldId, title, articles = null) {
  const key = titleKey(title);
  if (!key) return [];
  articles = articles ?? (await allArticles(client, worldId));
  return articles.filter((a) => titleKey(a?.title) === key).map(articleLine);
}

/**
 * Refuse a title another article in the world already has (agreed
 * 2026-11-16: no override; the way forward is a different title).
 * `exceptId` is the article being renamed, which may keep its own title.
 */
export async function refuseDuplicateTitle(client, worldId, title, exceptId = null, articles = null) {
  if (!worldId) throw new Error("Could not tell which world this article is in, so its title could not be checked against the others. Nothing was sent.");
  const clashes = (await articlesWithTitle(client, worldId, title, articles)).filter(
    (a) => !exceptId || lower(a.id) !== lower(exceptId),
  );
  if (clashes.length === 0) return;
  const list = clashes
    .map((a) => `"${a.title}" (${a.template ?? "article"}, id ${a.id}${a.state ? `, ${a.state}` : ""})`)
    .join("; ");
  throw new Error(
    `This world already has ${clashes.length === 1 ? "an article" : `${clashes.length} articles`} with that title: ${list}. ` +
      "Nothing was sent. Either use a different title, or change the existing article with worldanvil_update_article.",
  );
}

/**
 * A title with the differences a writer would not think of as differences
 * taken out: punctuation, and a leading "The", "A" or "An". Used only to
 * SUGGEST near matches, never to decide that two titles are the same.
 */
function looseKey(title) {
  return titleKey(title)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|an|a)\s+/, "");
}

const MAX_TITLES = 200;
const MAX_SUGGESTIONS = 5;

/** How an article is written into lore so that World Anvil links to it. */
const mentionOf = (article) => `@[${article.title}](Article:${article.id})`;

/**
 * Look up articles by title: one read of the world's article list, however
 * many titles are asked for.
 *
 * Each title gets "found" (exactly one article), "more_than_one" or
 * "not_found". A match is exact apart from capitals and spacing (titleKey).
 * A title that is not found also gets up to five near matches, as
 * suggestions for a person or session to choose from.
 *
 * `articles`: the world's article list, if the caller has already read it.
 */
export async function findArticles(client, worldId, titles, articles = null) {
  const asked = (Array.isArray(titles) ? titles : [titles]).map((t) => (typeof t === "string" ? t : ""));
  if (asked.length === 0 || asked.some((t) => titleKey(t) === ""))
    throw new Error("Give at least one title to look for, and no empty ones.");
  if (asked.length > MAX_TITLES)
    throw new Error(`At most ${MAX_TITLES} titles can be looked up in one call (${asked.length} given).`);

  articles = articles ?? (await allArticles(client, worldId));
  const byKey = new Map();
  for (const a of articles) {
    const key = titleKey(a?.title);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(a);
  }
  const line = (a) => ({ ...articleLine(a), mention: mentionOf(a) });

  const results = asked.map((title) => {
    const matches = (byKey.get(titleKey(title)) ?? []).map(line);
    if (matches.length === 1) return { asked: title, status: "found", ...matches[0] };
    if (matches.length > 1) return { asked: title, status: "more_than_one", matches };

    const loose = looseKey(title);
    const same = [];
    const partial = [];
    if (loose)
      for (const a of articles) {
        const other = looseKey(a?.title);
        if (!other) continue;
        if (other === loose) same.push(a);
        else if (loose.length >= 3 && other.length >= 3 && (other.includes(loose) || loose.includes(other)))
          partial.push(a);
      }
    const suggestions = [...same, ...partial].slice(0, MAX_SUGGESTIONS).map(line);
    return { asked: title, status: "not_found", ...(suggestions.length ? { suggestions } : {}) };
  });

  const count = (status) => results.filter((r) => r.status === status).length;
  return {
    world_id: worldId,
    articles_in_world: articles.length,
    totals: { found: count("found"), more_than_one: count("more_than_one"), not_found: count("not_found") },
    results,
    note:
      "A match is exact apart from capitals and spacing. Suggestions are near matches only: " +
      "check them before using one. `mention` is the text that links to the article from lore.",
  };
}
