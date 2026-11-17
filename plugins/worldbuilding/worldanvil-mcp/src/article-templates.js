/**
 * World Anvil MCP Server - article templates, variants and icons
 *
 * One table for everything the site's "new article" screen offers: the name
 * a writer sees, the templateType the API wants, the variant (if the tile is
 * a second route into another template) and the icon the site gives it.
 *
 * Every row was read from the site and checked through the API on
 * 2026-11-12. Template names are case-sensitive ("militaryConflict").
 * Default icons are stored bare ("fa-person"), exactly as the site stores
 * them; an icon picked by hand is stored with its style ("fa-solid fa-x").
 */

/** [site name, templateType, variant, default icon] */
const ROWS = [
  ["Generic", "article", null, "fa-books"],
  ["Building", "landmark", null, "fa-chart-pyramid"],
  ["Character", "person", null, "fa-person"],
  ["Geography", "location", null, "fa-mountain-sun"],
  ["Item", "item", null, "fa-sword"],
  ["Organization", "organization", null, "fa-gear"],
  ["Species", "species", null, "fa-fish-fins"],
  ["Vehicle", "vehicle", null, "fa-horse-saddle"],
  ["Settlement", "settlement", null, "fa-building-columns"],
  ["Condition", "condition", null, "fa-biohazard"],
  ["Conflict", "militaryConflict", null, "fa-swords"],
  ["Document", "document", null, "fa-scroll-old"],
  ["Culture / Ethnicity", "ethnicity", null, "fa-shoe-prints"],
  ["Language", "language", null, "fa-sign-hanging"],
  ["Material", "material", null, "fa-coins"],
  ["Military Formation", "formation", null, "fa-hammer-crash"],
  ["Myth", "myth", null, "fa-dragon"],
  ["Natural Law", "law", null, "fa-cloud-bolt"],
  ["Plot", "plot", null, "fa-staff"],
  ["Profession", "profession", null, "fa-hammer"],
  ["Prose", "prose", null, "fa-gem"],
  ["Title", "rank", null, "fa-crown"],
  ["Spell", "spell", null, "fa-wand-magic-sparkles"],
  ["Technology", "technology", null, "fa-vial"],
  ["Tradition", "ritual", null, "fa-heart"],
  ["Session Report", "report", null, "fa-book-sparkles"],
  // Variants: the base template plus a "variant" in articleMetadata.
  ["Country", "organization", "country", "fa-fort"],
  ["Military", "organization", "military", "fa-flag-swallowtail"],
  ["Religion", "organization", "religion", "fa-ankh"],
  ["God/Deity", "person", "deity", "fa-omega"],
];

export const TEMPLATES = ROWS.map(([siteName, templateType, variant, icon]) => ({
  siteName,
  templateType,
  variant,
  icon,
}));

/** Other words a writer might reasonably use for a tile. */
const ALIASES = {
  culture: "Culture / Ethnicity",
  ethnicity: "Culture / Ethnicity",
  god: "God/Deity",
  deity: "God/Deity",
  generic: "Generic",
  genericarticle: "Generic",
  sessionreport: "Session Report",
};

export const CATEGORY_DEFAULT_ICON = "fas fa-folder";
export const DEFAULT_TEMPLATE = "Generic";

/** Compare names loosely: case, spaces and punctuation don't matter. */
const key = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");

const BY_KEY = new Map();
for (const t of TEMPLATES) BY_KEY.set(key(t.siteName), t);
for (const [alias, siteName] of Object.entries(ALIASES))
  BY_KEY.set(alias, BY_KEY.get(key(siteName)));
// The API's own names win where they differ from a site name's key
// ("article", "person", "landmark", "militaryConflict" ...). None collide
// with a different tile: "organization" and "person" are their own bases.
for (const t of TEMPLATES) if (!t.variant) BY_KEY.set(key(t.templateType), t);

export function templateNames() {
  return TEMPLATES.map((t) => t.siteName);
}

/**
 * Turn the name a caller gave into a template row. Refuses unknown names
 * before anything is sent, listing the valid ones.
 */
export function resolveTemplate(name) {
  if (name === undefined || name === null || name === "") return BY_KEY.get(key(DEFAULT_TEMPLATE));
  const found = typeof name === "string" ? BY_KEY.get(key(name)) : undefined;
  if (!found)
    throw new Error(
      `"${name}" is not an article template. Use one of: ${templateNames().join(", ")}.`,
    );
  return found;
}

/** Read the variant out of an article's articleMetadata (a JSON string). */
export function variantOf(articleMetadata) {
  if (!articleMetadata) return null;
  try {
    const meta = typeof articleMetadata === "string" ? JSON.parse(articleMetadata) : articleMetadata;
    return typeof meta?.variant === "string" && meta.variant ? meta.variant : null;
  } catch {
    return null;
  }
}

/**
 * articleMetadata with the variant set, keeping anything else already in
 * it. With nothing else to keep, it is written exactly as the site writes it.
 */
export function metadataWithVariant(existing, variant) {
  let meta = {};
  if (existing) {
    try {
      const parsed = typeof existing === "string" ? JSON.parse(existing) : existing;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = { ...parsed };
    } catch {
      meta = {};
    }
  }
  delete meta.variant;
  if (Object.keys(meta).length === 0) return `{ "variant": "${variant}" }`;
  return JSON.stringify({ ...meta, variant });
}

/**
 * The template row for an article as World Anvil returns it: by
 * templateType (or entityClass, which is the same name capitalised) and
 * the variant in its metadata. Null if World Anvil reports a template this
 * table doesn't know.
 */
export function templateOfArticle(article) {
  const type = article?.templateType ?? article?.entityClass;
  if (!type) return null;
  const variant = variantOf(article.articleMetadata);
  const sameType = TEMPLATES.filter((t) => t.templateType.toLowerCase() === String(type).toLowerCase());
  return (
    sameType.find((t) => t.variant === variant) ??
    sameType.find((t) => t.variant === null) ??
    null
  );
}

/**
 * The field that holds an article's main text: the one the site's editor
 * shows as the page's own text box. Every template uses `content`, except
 * Prose, whose editor shows its `prose` field and not `content` (seen live
 * 2026-11-17: text sent as `content` to a Prose article was stored, and
 * invisible in its editor).
 *
 * @param {object|string} article - an article as World Anvil returns it,
 *   or a templateType
 */
export function mainTextField(article) {
  const type = typeof article === "string" ? article : (article?.templateType ?? article?.entityClass);
  return String(type ?? "").toLowerCase() === "prose" ? "prose" : "content";
}

/**
 * Work out the icon to store from what the caller asked for.
 *
 * - "default" gives the icon World Anvil itself would give (`fallback`).
 * - A Font Awesome name is stored the way the site's picker stores it:
 *   "fa-solid fa-dragon" or "fa-duotone fa-dragon". A bare name ("dragon",
 *   "fa-dragon") is taken as Solid.
 * - Anything else is refused. Removing an icon altogether is not offered.
 */
export function resolveIcon(icon, fallback) {
  if (typeof icon !== "string" || icon.trim() === "")
    throw new Error(
      'icon must be "default" (the icon World Anvil gives this kind of item) or a Font Awesome ' +
        'name such as "fa-dragon" or "fa-duotone fa-dragon". Removing an icon is not supported.',
    );
  const text = icon.trim().toLowerCase();
  if (text === "default") {
    if (!fallback)
      throw new Error("Can't tell what the default icon is for this item, so it was left unchanged.");
    return fallback;
  }
  const m = /^(?:(fa-solid|fa-duotone|fas|fad|solid|duotone)\s+)?(?:fa-)?([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(text);
  if (!m)
    throw new Error(
      `"${icon}" is not an icon this tool can set. Use "default", or a Font Awesome name in Solid ` +
        'or Duotone style, such as "fa-dragon" or "fa-duotone fa-dragon".',
    );
  const style = ["fa-duotone", "fad", "duotone"].includes(m[1]) ? "fa-duotone" : "fa-solid";
  return `${style} fa-${m[2]}`;
}
