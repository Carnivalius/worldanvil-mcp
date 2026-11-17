/**
 * Copy categories, articles and secrets from one world into another.
 *
 * The source world is only read. Everything made in the target is private.
 * Text is copied by this code, never retyped: the main text and author
 * notes are written in the form World Anvil's editor uses when that can be
 * done without a reader seeing any difference, and otherwise exactly as
 * stored. Each copy is read back and compared with its source.
 *
 * Without `confirm` nothing is changed: the answer is a preview. With it,
 * each call works for a limited time and then says to call again. A run
 * can always be repeated: anything already in the target under the same
 * title is left alone.
 *
 * Every request goes through the guarded client, so the user's access
 * settings decide what is allowed: the source needs read access, the
 * target needs create (and update, to finish links between the copies).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { listAll, allArticles, titleKey } from "./listing.js";
import { templateOfArticle, mainTextField, CATEGORY_DEFAULT_ICON } from "./article-templates.js";
import { toEditorForm, compareAsRead } from "./reader-view.js";
import { placeholderText, fitsPlaceholder } from "./utils.js";

const lower = (id) => String(id ?? "").toLowerCase();

/** Working time for one call before it answers "call again". */
export const COPY_BUDGET_MS = 40_000;

/**
 * Article fields that are not template text: identity, placement, state,
 * things World Anvil works out itself, and the ones this module sets on
 * its own. Every other non-empty text field of an article is copied.
 */
const NOT_TEMPLATE_TEXT = new Set(
  [
    "id", "title", "slug", "state", "entityClass", "templateType", "url", "editURL",
    "folderId", "editor", "content", "authornotes", "icon", "articleMetadata",
    "coverSource", "passcode", "visibility", "position", "wordcount", "success",
  ].map((k) => k.toLowerCase()),
);

/** What this tool never carries, said once in every answer. */
const NOT_CARRIED =
  "Not copied: images (covers included), parent/child links between articles, display switches " +
  "(such as show in contents), creation dates and web addresses. Maps, timelines, manuscripts and " +
  "other kinds of item are not copied by this tool.";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const MENTION = new RegExp(`@\\[([^\\]]*)\\]\\(([A-Za-z_]+):(${UUID})\\)`, "g");
const HEADING_ANCHOR = new RegExp(`\\[h\\d?\\|${UUID}\\]`, "g");

/**
 * Re-point mentions of source articles at their copies.
 *
 * @param {string} text
 * @param {(id: string) => ({ targetId: string } | { pending: true, title?: string } | null)} lookup
 *   what a mentioned id is: copied already, a source article not copied
 *   yet, or not a source article at all (null: left exactly as written)
 * @returns {{ text: string, pending: number, otherIds: boolean }}
 *   pending: mentions written for now as {{Title|shown words}}
 *   placeholders (plain words where a placeholder cannot say it);
 *   otherIds: the text still names some item by id (an image, a secret,
 *   an article outside the copy), which still points at the source world
 */
export function repointMentions(text, lookup) {
  let pending = 0;
  const made = [];
  const out = String(text ?? "").replace(MENTION, (whole, shown, kind, id) => {
    const hit = lookup(lower(id));
    if (!hit) return whole;
    if (hit.pending) {
      pending += 1;
      // A placeholder any later update or reformat can also finish. Not
      // every title or wording fits inside one: then plain words.
      if (!fitsPlaceholder(hit.title) || !fitsPlaceholder(shown)) return shown;
      return shown.trim() === hit.title.trim() ? placeholderText(hit.title) : placeholderText(hit.title, shown);
    }
    const mention = `@[${shown}](${kind}:${hit.targetId})`;
    made.push(mention);
    return mention;
  });
  let rest = out.replace(HEADING_ANCHOR, "");
  for (const m of made) rest = rest.split(m).join("");
  return { text: out, pending, otherIds: new RegExp(UUID).test(rest) };
}

/**
 * Whether a copy reads the same as its source. A mention is compared by
 * the words it shows: the copy's mentions point at the copies, so their
 * ids are bound to differ.
 */
function readsAs(source, copy) {
  const shownOnly = (t) => String(t ?? "").replace(MENTION, (whole, shown, kind) => `@[${shown}](${kind})`);
  return compareAsRead(shownOnly(source), shownOnly(copy)).status;
}

/** A category's place in its world, as a path of compared titles. */
function pathKey(titles) {
  return titles.map(titleKey).join(" / ");
}

/** Read every category of a world in full, with its path from the top. */
async function readCategories(client, worldId) {
  const listed = await listAll((o) => client.listCategories(worldId, o));
  const byId = new Map();
  for (const entry of listed) {
    const full = await client.getCategory(entry.id);
    byId.set(lower(entry.id), {
      id: lower(entry.id),
      title: String(full?.title ?? entry.title ?? ""),
      parentId: full?.parent?.id ? lower(full.parent.id) : null,
      full,
      articleIds: (Array.isArray(full?.articles) ? full.articles : []).filter((a) => a?.id).map((a) => lower(a.id)),
    });
  }
  const titlesOf = (cat, seen = new Set()) => {
    if (seen.has(cat.id)) return [cat.title]; // a loop: should not happen
    seen.add(cat.id);
    const parent = cat.parentId ? byId.get(cat.parentId) : null;
    return parent ? [...titlesOf(parent, seen), cat.title] : [cat.title];
  };
  for (const cat of byId.values()) cat.titles = titlesOf(cat);
  return byId;
}

/** The text to send for a stored main text or author notes, and how it was treated. */
function editorText(stored, seed, paragraphs) {
  const text = typeof stored === "string" ? stored : "";
  if (!text.trim()) return { text: null, how: "empty" };
  const result = toEditorForm(text, { anchorSeed: seed, paragraphs });
  if (result.status === "reformatted") return { text: result.text, how: "editor form" };
  if (result.status === "refused") return { text, how: "as stored", why: result.why };
  return { text, how: "as stored" };
}

/** The template text fields of an article: every other non-empty text field. */
function templateText(article) {
  const out = {};
  for (const [key, value] of Object.entries(article ?? {})) {
    if (typeof value !== "string" || value.trim() === "") continue;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
    if (NOT_TEMPLATE_TEXT.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

/** Read a new item back and make sure it is private; one line for the answer. */
async function privateCheck(read, update, created) {
  let after = await read(created.id);
  if (after?.state !== "private") {
    await update(created.id, { state: "private" });
    after = await read(created.id);
    if (after?.state !== "private")
      return { after, warning: `WARNING: it is "${after?.state}" on World Anvil and could not be set to private. Check it on the website.` };
  }
  return { after, warning: null };
}

/**
 * Links that could not be made yet, kept between calls of one copy: in
 * memory, and in a small file beside the backups (when there is a backup
 * folder) so a restart in the middle of a copy does not lose them.
 */
const pendingLinks = new Map();

function pendingFile(client, key) {
  const dir = client?.backups?.dir;
  if (!dir) return null;
  const name = key.split(">").map((part) => part.slice(0, 8) || "all").join("-");
  return join(dir, "copies", `links-${name}.json`);
}

function loadPending(client, key) {
  if (pendingLinks.has(key)) return pendingLinks.get(key);
  const file = pendingFile(client, key);
  try {
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(saved)) return saved.filter((x) => x?.sourceId && x?.targetId);
    }
  } catch {
    // An unreadable file is the same as none: the links stay as plain words.
  }
  return [];
}

function savePending(client, key, pending) {
  const file = pendingFile(client, key);
  if (pending.length) pendingLinks.set(key, pending);
  else pendingLinks.delete(key);
  if (!file) return;
  try {
    if (pending.length) {
      mkdirSync(join(client.backups.dir, "copies"), { recursive: true });
      writeFileSync(file, JSON.stringify(pending, null, 2));
    } else if (existsSync(file)) rmSync(file);
  } catch {
    // Kept in memory all the same.
  }
}

/**
 * @param {object} client - guarded WorldAnvilClient
 * @param {object} args
 * @param {string} args.source_world_id
 * @param {string} args.target_world_id
 * @param {string} [args.category_id] - copy only this source category and what is under it
 * @param {boolean} [args.confirm] - without it, only a preview
 * @param {object} [opts]
 * @param {number} [opts.budgetMs]
 * @param {() => number} [opts.now]
 */
export async function copyArticles(client, args, { budgetMs = COPY_BUDGET_MS, now = Date.now } = {}) {
  const sourceId = lower(args.source_world_id);
  const targetId = lower(args.target_world_id);
  if (!sourceId || !targetId) throw new Error("source_world_id and target_world_id are both needed.");
  if (sourceId === targetId) throw new Error("The source and the target are the same world. Nothing was done.");
  const started = now();
  const timeLeft = () => now() - started < budgetMs;

  // ---- what the source holds ------------------------------------------------
  const sourceWorld = await client.getWorld(args.source_world_id);
  const targetWorld = await client.getWorld(args.target_world_id);
  const srcCats = await readCategories(client, args.source_world_id);
  const srcArticles = await allArticles(client, args.source_world_id);
  const srcArticleById = new Map(srcArticles.map((a) => [lower(a.id), a]));

  let chosenCats = [...srcCats.values()];
  let rootDepth = 0;
  if (args.category_id) {
    const root = srcCats.get(lower(args.category_id));
    if (!root) throw new Error("category_id is not a category of the source world. Nothing was done.");
    rootDepth = root.titles.length - 1;
    const under = (cat) => cat.id === root.id || (cat.parentId && srcCats.has(cat.parentId) && under(srcCats.get(cat.parentId)));
    chosenCats = chosenCats.filter(under);
  }
  // Parents before children.
  chosenCats.sort((a, b) => a.titles.length - b.titles.length || a.title.localeCompare(b.title));
  const targetPath = (cat) => cat.titles.slice(rootDepth);

  const categoryOfArticle = new Map();
  for (const cat of chosenCats) for (const id of cat.articleIds) categoryOfArticle.set(id, cat);
  const inAnyCategory = new Set([...srcCats.values()].flatMap((c) => c.articleIds));
  const chosenArticles = srcArticles.filter((a) =>
    args.category_id ? categoryOfArticle.has(lower(a.id)) : categoryOfArticle.has(lower(a.id)) || !inAnyCategory.has(lower(a.id)),
  );

  const problems = [];
  // One title, one article: a second source article with the same title cannot be copied.
  const firstWithTitle = new Map();
  const copyable = [];
  for (const a of chosenArticles) {
    const key = titleKey(a.title);
    if (!key) {
      problems.push("An article with no title was left out.");
      continue;
    }
    if (firstWithTitle.has(key)) {
      problems.push(`The source has more than one article titled "${a.title}"; only the first is copied.`);
      continue;
    }
    firstWithTitle.set(key, a);
    copyable.push(a);
  }

  // ---- what the target holds --------------------------------------------------
  const tgtCats = await readCategories(client, args.target_world_id);
  const tgtCatByPath = new Map([...tgtCats.values()].map((c) => [pathKey(c.titles), c.id]));
  const tgtArticles = await allArticles(client, args.target_world_id);
  const tgtArticleByTitle = new Map(tgtArticles.map((a) => [titleKey(a.title), lower(a.id)]));

  const srcSecretsListed = await listAll((o) => client.listSecrets(args.source_world_id, o));
  const tgtSecrets = await listAll((o) => client.listSecrets(args.target_world_id, o));
  const tgtSecretTitles = new Set(tgtSecrets.map((s) => titleKey(s.title)));

  const catsToMake = chosenCats.filter((c) => !tgtCatByPath.has(pathKey(targetPath(c))));
  const articlesToMake = copyable.filter((a) => !tgtArticleByTitle.has(titleKey(a.title)));
  const articlesThere = copyable.filter((a) => tgtArticleByTitle.has(titleKey(a.title)));
  const secretsToConsider = srcSecretsListed.filter((s) => !tgtSecretTitles.has(titleKey(s.title)));

  const key = `${sourceId}>${targetId}>${lower(args.category_id ?? "")}`;
  // Links still to finish, less any whose copy is no longer in the target.
  const inTarget = new Set(tgtArticles.map((a) => lower(a.id)));
  const pending = loadPending(client, key).filter((item) => inTarget.has(lower(item.targetId)));

  const header = {
    source: sourceWorld?.title ?? args.source_world_id,
    target: targetWorld?.title ?? args.target_world_id,
  };
  const templateName = (a) => templateOfArticle(a)?.siteName ?? a.entityClass ?? a.templateType ?? "unknown";

  // ---- preview ------------------------------------------------------------------
  if (args.confirm !== true) {
    return {
      status: "preview",
      ...header,
      would_create: {
        categories: catsToMake.map((c) => targetPath(c).join(" / ")),
        articles: articlesToMake.map((a) => ({ title: a.title, template: templateName(a) })),
        secrets_at_most: secretsToConsider.length,
      },
      already_in_target: {
        categories: chosenCats.length - catsToMake.length,
        articles: articlesThere.map((a) => a.title),
        secrets: srcSecretsListed.length - secretsToConsider.length,
      },
      ...(problems.length ? { problems } : {}),
      not_carried: NOT_CARRIED,
      note:
        "Preview only: nothing was changed. Everything would be created private. An article or secret whose title is " +
        "already in the target is left alone. A secret is copied when it is attached to a copied article" +
        (args.category_id ? "." : ", or to no article.") +
        " Show this to the user; with their go-ahead, call again with confirm: true (several calls may be needed).",
    };
  }

  // ---- copy ---------------------------------------------------------------------
  const made = { categories: [], articles: [], secrets: [], links_finished: [] };

  // 1. Categories, parents first.
  for (const cat of catsToMake) {
    if (!timeLeft()) break;
    const path = targetPath(cat);
    const parentPath = path.slice(0, -1);
    const data = {
      title: cat.title,
      world: { id: args.target_world_id },
      icon: typeof cat.full?.icon === "string" && cat.full.icon ? cat.full.icon : CATEGORY_DEFAULT_ICON,
    };
    for (const field of ["description", "custom1"])
      if (typeof cat.full?.[field] === "string" && cat.full[field].trim()) data[field] = cat.full[field];
    if (parentPath.length) {
      const parentId = tgtCatByPath.get(pathKey(parentPath));
      if (!parentId) {
        problems.push(`Category "${path.join(" / ")}" was not made: the category above it is missing in the target.`);
        continue;
      }
      data.parent = { id: parentId };
    }
    const created = await client.createCategory(data);
    if (!created?.id) {
      problems.push(`Category "${path.join(" / ")}": World Anvil returned no id, so it cannot be used.`);
      continue;
    }
    tgtCatByPath.set(pathKey(path), lower(created.id));
    made.categories.push(path.join(" / "));
  }
  const catsLeft = catsToMake.filter((c) => !tgtCatByPath.has(pathKey(targetPath(c)))).length;

  // 2. Articles.
  const lookup = (id) => {
    const src = srcArticleById.get(id);
    if (!src) return null;
    const there = tgtArticleByTitle.get(titleKey(src.title));
    if (there) return { targetId: there };
    // A source article that is part of this copy will exist later; one that
    // is not part of it never will, so its mention is left as written.
    return firstWithTitle.get(titleKey(src.title)) === src ? { pending: true, title: String(src.title) } : null;
  };

  let articlesLeft = articlesToMake.length;
  if (catsLeft === 0) {
    for (const listed of articlesToMake) {
      if (!timeLeft()) break;
      const source = await client.getArticle(listed.id);
      const title = String(source?.title ?? listed.title);
      const cat = categoryOfArticle.get(lower(listed.id));
      // The main text is in `content`, or for a Prose article in `prose`.
      const mainField = mainTextField(source);
      const main = editorText(source?.[mainField], title, true);
      const notes = editorText(source?.authornotes, title, "auto");
      const linked = main.text === null ? null : repointMentions(main.text, lookup);
      const linkedNotes = notes.text === null ? null : repointMentions(notes.text, lookup);

      const data = { title, world: { id: args.target_world_id } };
      if (source?.templateType) data.templateType = source.templateType;
      if (typeof source?.articleMetadata === "string" && source.articleMetadata.trim())
        data.articleMetadata = source.articleMetadata;
      Object.assign(data, templateText(source));
      // A Prose article may hold text in `content` as well: carried as stored.
      if (mainField !== "content" && typeof source?.content === "string" && source.content.trim())
        data.content = source.content;
      if (linked) data[mainField] = linked.text;
      if (linkedNotes) data.authornotes = linkedNotes.text;
      const icon = typeof source?.icon === "string" && source.icon ? source.icon : templateOfArticle(source)?.icon;
      if (icon) data.icon = icon;
      data.state = "private";
      if (cat) data.category = { id: tgtCatByPath.get(pathKey(targetPath(cat))) };

      const created = await client.createArticle(data);
      articlesLeft -= 1;
      const line = { title, template: templateName(source), main_text: main.how };
      if (!created?.id) {
        problems.push(`Article "${title}": World Anvil returned no id; check the target for it before running again.`);
        continue;
      }
      line.id = created.id;
      tgtArticleByTitle.set(titleKey(title), lower(created.id));

      const { after, warning } = await privateCheck(
        (id) => client.getArticle(id),
        (id, d) => client.updateArticle(id, d),
        created,
      );
      line.privacy = warning ?? "private";
      if (warning) problems.push(`Article "${title}": ${warning}`);

      // Stored as sent, and reading the same as the source.
      const differs = Object.keys(data).filter((k) => typeof data[k] === "string" && k !== "state" && after?.[k] !== data[k]);
      const pendingHere = (linked?.pending ?? 0) + (linkedNotes?.pending ?? 0);
      const reads =
        pendingHere === 0 && typeof source?.[mainField] === "string" && source[mainField].trim()
          ? readsAs(source[mainField], after?.[mainField])
          : null;
      if (differs.length) {
        line.check = `WARNING: stored differently from what was sent: ${differs.join(", ")}`;
        problems.push(`Article "${title}": ${line.check}`);
      } else if (reads === "changed") {
        line.check = "WARNING: stored as sent, but it does not read the same as the source";
        problems.push(`Article "${title}": ${line.check}`);
      } else line.check = pendingHere ? "stored as sent; links to finish" : "stored as sent; reads the same as the source";

      if (main.why) line.main_text_note = main.why;
      if (notes.why) line.author_notes_note = notes.why;
      if (linked?.otherIds || linkedNotes?.otherIds)
        line.references = "The text names other items by id (an image, a secret, or an article outside this copy). They were kept as written and still point at the source world.";
      if (pendingHere) pending.push({ sourceId: lower(listed.id), targetId: lower(created.id), title });
      if (Array.isArray(source?.secrets) && source.secrets.length) line.secrets_attached = source.secrets.length;
      made.articles.push(line);
    }
  }

  // 3. Secrets: those attached to a copied article, or (whole-world copy) to none.
  let secretsLeft = secretsToConsider.length;
  let linksStopped = null;
  const secretsSkipped = [];
  if (catsLeft === 0 && articlesLeft === 0) {
    for (const listed of secretsToConsider) {
      if (!timeLeft()) break;
      const source = await client.getSecret(listed.id);
      secretsLeft -= 1;
      const title = String(source?.title ?? listed.title);
      const attachedTo = source?.article?.id ? lower(source.article.id) : null;
      let articleId = null;
      if (attachedTo) {
        const src = srcArticleById.get(attachedTo);
        articleId = src ? tgtArticleByTitle.get(titleKey(src.title)) : null;
        const partOfCopy = src && firstWithTitle.get(titleKey(src.title)) === src;
        if (!articleId || !partOfCopy) {
          secretsSkipped.push(title);
          continue;
        }
      } else if (args.category_id) {
        secretsSkipped.push(title);
        continue;
      }
      const text = editorText(source?.content, title, true);
      const data = { title, world: { id: args.target_world_id }, state: "private" };
      if (text.text !== null) data.content = text.text;
      if (articleId) data.article = { id: articleId };
      const created = await client.createSecret(data);
      if (!created?.id) {
        problems.push(`Secret "${title}": World Anvil returned no id; check the target for it before running again.`);
        continue;
      }
      const { after, warning } = await privateCheck(
        (id) => client.getSecret(id),
        (id, d) => client.updateSecret(id, d),
        created,
      );
      const line = { title, id: created.id, privacy: warning ?? "private", attached: articleId ? "to its article" : "to no article" };
      if (warning) problems.push(`Secret "${title}": ${warning}`);
      const sameText = text.text === null || after?.content === text.text;
      const sameLink = !articleId || lower(after?.article?.id) === articleId;
      line.check = sameText && sameLink ? "stored as sent" : `WARNING: ${sameText ? "" : "text stored differently from what was sent. "}${sameLink ? "" : "Not attached to its article."}`.trim();
      if (!sameText || !sameLink) problems.push(`Secret "${title}": ${line.check}`);
      made.secrets.push(line);
    }
  }

  // 4. Links between copies that could not be made the first time round.
  // Last, because it is the only step that changes something already made.
  if (catsLeft === 0 && articlesLeft === 0 && secretsLeft === 0) {
    while (pending.length && timeLeft()) {
      const item = pending[0];
      try {
        const source = await client.getArticle(item.sourceId);
        const mainField = mainTextField(source);
        const main = editorText(source?.[mainField], item.title, true);
        const notes = editorText(source?.authornotes, item.title, "auto");
        const data = {};
        const linked = main.text === null ? null : repointMentions(main.text, lookup);
        const linkedNotes = notes.text === null ? null : repointMentions(notes.text, lookup);
        if (linked) data[mainField] = linked.text;
        if (linkedNotes) data.authornotes = linkedNotes.text;
        await client.updateArticle(item.targetId, data);
        const after = await client.getArticle(item.targetId);
        const differs = Object.keys(data).filter((k) => after?.[k] !== data[k]);
        const reads =
          typeof source?.[mainField] === "string" && source[mainField].trim()
            ? readsAs(source[mainField], after?.[mainField])
            : null;
        if (differs.length || reads === "changed")
          problems.push(
            `Article "${item.title}": after its links were finished it ${differs.length ? "is stored differently from what was sent" : "does not read the same as the source"}.`,
          );
      } catch (e) {
        // Left for the next call: the copy itself is complete, its links are plain words for now.
        linksStopped = `Links in "${item.title}" could not be finished (${e.message}). The article is copied; the names it links to are {{placeholders}} for now. Call again to finish them.`;
        problems.push(linksStopped);
        break;
      }
      made.links_finished.push(item.title);
      pending.shift();
    }
  }
  savePending(client, key, pending);

  const done = catsLeft === 0 && articlesLeft === 0 && pending.length === 0 && secretsLeft === 0;
  return {
    status: done ? "done" : "in_progress",
    done,
    ...header,
    created_this_call: {
      categories: made.categories,
      articles: made.articles,
      ...(made.links_finished.length ? { links_finished: made.links_finished } : {}),
      secrets: made.secrets,
    },
    ...(done
      ? {}
      : { remaining: { categories: catsLeft, articles: articlesLeft, links_to_finish: pending.length, secrets_to_look_at: secretsLeft } }),
    left_alone: {
      articles_in_target_before_this_call: articlesThere.map((a) => a.title),
      ...(secretsSkipped.length ? { secrets_not_attached_to_a_copied_article: secretsSkipped } : {}),
    },
    ...(problems.length ? { problems } : {}),
    not_carried: NOT_CARRIED,
    note: done
      ? "Finished. Everything created is private. Articles that were in the target before this call (made by an earlier call of this copy, or there already) were left untouched; links inside ones this copy did not make were not checked." +
        (problems.length ? " See `problems`." : "")
      : "Not finished: call again with the same arguments to continue. Nothing is copied twice.",
  };
}
