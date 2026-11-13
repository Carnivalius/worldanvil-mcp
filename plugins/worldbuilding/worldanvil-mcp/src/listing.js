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
