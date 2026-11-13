/**
 * Looking back into backups: list an item's saved versions, search backups
 * for text, compare a saved version with the item as it is now, save a copy
 * of one item on request, and put one item back the way it was.
 *
 * Rules these keep:
 *
 * - **Backups are write-once.** Nothing here edits or deletes a backup.
 * - **The access settings apply to backups too.** Every tool first reads
 *   the world or the item through the guarded client, so the backups of a
 *   world that is blocked, off the allow list, or no longer one of the
 *   user's worlds can't be read. (A world deleted on World Anvil therefore
 *   has backups no tool will open: the files are still there for the user.)
 * - **A backup belongs to the world recorded inside it**, not to the folder
 *   it sits in: every file's own world id is checked before it is used.
 * - **Restore changes one item in place**, through the same guard as any
 *   edit, so the item as it is now is backed up first. It writes plain
 *   values only (text, numbers, yes/no). Links, lists, privacy and anything
 *   World Anvil works out for itself are reported, not written.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { retentionReport, safeName, stampTime } from "./backup.js";
import { ID_RE } from "./guard.js";
import { ITEM_TYPES, sectionOf } from "./world-backup.js";

/** How long one search works before answering with what it has. */
export const SEARCH_BUDGET_MS = 20_000;

/** Item types restore is allowed on: the ones whose edits were proven live. */
export const RESTORABLE = new Set(["article", "category", "manuscript_part"]);

/** Fields restore never writes: identity, ownership, privacy, placement. */
const NEVER_RESTORED = new Set([
  "id", "world", "category", "parent", "author", "owner", "user", "entityclass",
  "templatetype", "template", "slug", "url", "state", "isdraft", "iswip",
  "ispublic", "visibility", "passcode", "subscribergroups", "islocked",
  "isadultcontent", "ishiddenfromtoc", "allowcomments", "iseditable", "position",
]);
/** Things World Anvil works out for itself: by name, or dates, addresses and rendered text. */
const DERIVED_FIELDS = new Set(["wordcount", "views", "likes"]);
const DERIVED = /(date|url|parsed|html)$/i;
/** Plain values restore leaves alone because writing them has not been tried on World Anvil. */
const UNTESTED_FIELDS = new Set(["excerpt"]);

/**
 * Left out of comparisons wherever it appears, at any depth: the
 * last-changed date. It moves on every save, and an item's nested `world`
 * record carries the world's own, which moves when anything in the world
 * is edited (seen live 2026-11-13). Neither says anything about content.
 */
const NOT_COMPARED = new Set(["updateDate"]);

/** A copy of `value` without the last-changed dates. */
function withoutDates(value) {
  if (Array.isArray(value)) return value.map(withoutDates);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).filter(([k]) => !NOT_COMPARED.has(k)).map(([k, v]) => [k, withoutDates(v)]));
  return value;
}

/** The same content, last-changed dates aside. */
const sameContent = (a, b) => canonical(withoutDates(a)) === canonical(withoutDates(b));

const lower = (id) => String(id).toLowerCase();
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const isPlain = (v) => ["string", "number", "boolean"].includes(typeof v);

/** JSON with keys in a fixed order, so two copies of the same thing compare equal. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function short(value, max = 200) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}... (${text.length} characters)` : text;
}

function checkItem(type, id) {
  if (!sectionOf(type))
    throw new Error(`"${type}" is not an item type I know. Use one of: ${ITEM_TYPES.join(", ")}`);
  if (!ID_RE.test(String(id ?? ""))) throw new Error(`"${id}" is not a valid World Anvil id`);
}

function backupRoot(client) {
  const dir = client.backups?.dir;
  if (!dir) throw new Error("backups aren't configured (no backup folder), so there is nothing to look in");
  return dir;
}

/** The item as it is now (full detail, through the guard) and the world it is in. */
async function liveItem(client, type, id) {
  checkItem(type, id);
  const data = await client.request(`/${type}?id=${id}&granularity=2`);
  const worldId = lower(await client.access.worldOf(`/${type}`, id));
  return { data, worldId, worldTitle: client.access.worlds?.get(worldId) ?? "" };
}

/** Folders under items/ or worlds/ that may hold this world's backups (it may have been renamed). */
function worldFolders(root, kind, worldId) {
  const base = join(root, kind);
  if (!existsSync(base)) return [];
  const tail = `-${lower(worldId).slice(0, 8)}`;
  return readdirSync(base)
    .filter((n) => lower(n).endsWith(tail) && statSync(join(base, n)).isDirectory())
    .map((n) => join(base, n));
}

const REASONS = { update: "before an edit", delete: "before a delete", request: "on request" };

/** Every complete world backup of this world, newest first: {name, dir, manifest}. */
function worldBackups(root, worldId) {
  const out = [];
  for (const dir of worldFolders(root, "worlds", worldId))
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".partial")) continue;
      const file = join(dir, name, "manifest.json");
      if (!existsSync(file)) continue;
      let manifest;
      try {
        manifest = readJson(file);
      } catch {
        continue;
      }
      if (lower(manifest.world?.id) !== lower(worldId)) continue;
      out.push({ name, dir: join(dir, name), manifest });
    }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** Every folder of single-item copies in this world: {type, folder}. */
function itemFolders(root, worldId) {
  const out = [];
  for (const dir of worldFolders(root, "items", worldId))
    for (const type of readdirSync(dir)) {
      const typeDir = join(dir, type);
      if (!statSync(typeDir).isDirectory()) continue;
      for (const name of readdirSync(typeDir)) {
        const folder = join(typeDir, name);
        if (statSync(folder).isDirectory()) out.push({ type, folder });
      }
    }
  return out;
}

/** The single-item copies in one folder that belong to this world, newest first. */
function copiesIn(folder, worldId) {
  const out = [];
  for (const name of readdirSync(folder).filter((f) => f.endsWith(".json")).sort().reverse()) {
    let record;
    try {
      record = readJson(join(folder, name));
    } catch {
      continue;
    }
    if (lower(record.world?.id) !== lower(worldId)) continue;
    const stem = name.replace(/\.json$/, "");
    out.push({
      version: `item:${stem}`,
      taken: record.backed_up_at ?? null,
      time: stampTime(name),
      saved: REASONS[stem.split("-").pop()] ?? record.reason ?? "a single-item copy",
      title: record.title ?? null,
      type: record.type,
      id: String(record.id),
      file: join(folder, name),
      load: () => record.data,
    });
  }
  return out;
}

/**
 * Every saved version of one item, newest first. A world backup that only
 * carried an unchanged copy forward is not a new version: versions with the
 * same change date are shown once, as the oldest backup that holds them.
 */
function versionsOf(root, worldId, type, id) {
  const versions = [];
  const want = lower(id);
  for (const { type: folderType, folder } of itemFolders(root, worldId)) {
    if (folderType !== safeName(type)) continue;
    const name = lower(basename(folder));
    if (name !== want && !name.endsWith(` - ${want}`)) continue;
    versions.push(...copiesIn(folder, worldId).filter((v) => lower(v.id) === want));
  }

  const byStamp = new Map();
  for (const backup of worldBackups(root, worldId)) {
    const item = (backup.manifest.items ?? []).find((i) => i.type === type && lower(i.id) === want);
    if (!item?.file || !existsSync(join(backup.dir, item.file))) continue;
    const file = join(backup.dir, item.file);
    const version = {
      version: `world:${backup.name}`,
      taken: backup.manifest.finished_at ?? null,
      time: stampTime(backup.name),
      saved: "in a world backup",
      title: item.title ?? null,
      type,
      id: String(item.id),
      file,
      load: () => readJson(file).data,
    };
    // Newest first, so a later (older) backup with the same date replaces it.
    if (item.stamp) byStamp.set(item.stamp, { ...version, also_in_newer_world_backups: byStamp.has(item.stamp) ? (byStamp.get(item.stamp).also_in_newer_world_backups ?? 0) + 1 : 0 });
    else versions.push(version);
  }
  versions.push(...byStamp.values());
  return versions.sort((a, b) => (b.time || 0) - (a.time || 0));
}

const describe = (v) => ({
  version: v.version,
  taken: v.taken,
  saved: v.saved,
  title: v.title,
  size_kb: Math.round((statSync(v.file).size / 1024) * 10) / 10,
  ...(v.also_in_newer_world_backups ? { also_in_newer_world_backups: v.also_in_newer_world_backups } : {}),
});

function pickVersion(versions, wanted, what) {
  if (!versions.length) throw new Error(`There is no saved copy of ${what} in the backups.`);
  if (wanted === undefined || wanted === null || wanted === "") return versions[0];
  const found = versions.find((v) => v.version === String(wanted).trim());
  if (!found)
    throw new Error(
      `"${wanted}" is not a saved version of ${what}. Call worldanvil_list_backups with its type and id to see the versions.`,
    );
  return found;
}

/**
 * List what the backups hold: for a world, its world backups and how many
 * items have copies of their own; for one item, its saved versions.
 */
export async function listBackups(client, { world_id, type, id }) {
  const root = backupRoot(client);
  const world = await client.getWorld(world_id); // the access check
  const worldId = lower(world?.id ?? world_id);
  const settings = client.access?.settings ?? {};
  const keepDays = settings.backup_keep_days ?? 7;

  if ((type === undefined || type === "") !== (id === undefined || id === ""))
    throw new Error("Give both type and id to list one item's versions, or neither to see the whole world.");

  if (type) {
    checkItem(type, id);
    const versions = versionsOf(root, worldId, type, id);
    const own = versions.filter((v) => v.version.startsWith("item:"));
    return {
      world: world?.title ?? "",
      item: { type, id, title: versions[0]?.title ?? null },
      versions: versions.map(describe),
      own_copies: retentionReport({
        held: own.length,
        keep: settings.item_backup_keep ?? 10,
        keepDays,
        bytes: own.reduce((sum, v) => sum + statSync(v.file).size, 0),
      }),
      note: versions.length
        ? `${versions.length} saved version(s), newest first. Use a version's "version" text with worldanvil_compare_backup or worldanvil_restore_item.`
        : "No saved copy of this item was found in this world's backups.",
    };
  }

  const backups = worldBackups(root, worldId);
  const withCopies = {};
  for (const { type: t, folder } of itemFolders(root, worldId))
    if (copiesIn(folder, worldId).length) withCopies[t] = (withCopies[t] ?? 0) + 1;
  return {
    world: world?.title ?? "",
    world_backups: backups.map((b) => ({
      version: `world:${b.name}`,
      taken: b.manifest.finished_at ?? null,
      items: (b.manifest.items ?? []).length,
    })),
    world_backups_kept: retentionReport({
      held: backups.length,
      keep: settings.world_backup_keep ?? 20,
      keepDays,
      bytes: backups.reduce((sum, b) => sum + treeSize(b.dir), 0),
    }),
    items_with_copies_of_their_own: withCopies,
    note: "To see one item's saved versions, call again with its type and id.",
  };
}

function treeSize(dir) {
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const st = statSync(join(dir, name));
    bytes += st.isDirectory() ? treeSize(join(dir, name)) : st.size;
  }
  return bytes;
}

/** Where `needle` (lower case) appears in an item's text: [{field, snippet}]. */
function findText(data, needle) {
  const hits = [];
  const visit = (value, field) => {
    if (typeof value === "string") {
      const at = value.toLowerCase().indexOf(needle);
      if (at === -1) return;
      const from = Math.max(0, at - 60);
      const to = Math.min(value.length, at + needle.length + 60);
      hits.push({
        field,
        snippet: `${from > 0 ? "..." : ""}${value.slice(from, to).replace(/\s+/g, " ")}${to < value.length ? "..." : ""}`,
      });
    } else if (Array.isArray(value)) value.forEach((v) => visit(v, field));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, field ?? k);
  };
  for (const [k, v] of Object.entries(data ?? {})) visit(v, k);
  return hits;
}

/**
 * Search a world's backups for text. Newest copies first; an unchanged copy
 * carried from one world backup to the next is read once.
 */
export async function searchBackups(client, { world_id, text, type, limit }, opts = {}) {
  const root = backupRoot(client);
  const needle = String(text ?? "").trim().toLowerCase();
  if (needle.length < 2) throw new Error("Give at least two characters of text to search for.");
  if (type !== undefined && type !== "" && !sectionOf(type))
    throw new Error(`"${type}" is not an item type I know. Use one of: ${ITEM_TYPES.join(", ")}`);
  const world = await client.getWorld(world_id); // the access check
  const worldId = lower(world?.id ?? world_id);
  const max = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? SEARCH_BUDGET_MS;

  // Everything to read, newest first.
  const sources = [];
  for (const { type: t, folder } of itemFolders(root, worldId))
    for (const copy of copiesIn(folder, worldId)) if (!type || copy.type === type) sources.push(copy);
  const seen = new Set();
  for (const backup of worldBackups(root, worldId))
    for (const item of backup.manifest.items ?? []) {
      if (!item.file || (type && item.type !== type)) continue;
      const key = `${item.type}:${lower(item.id)}:${item.stamp ?? backup.name}`;
      if (seen.has(key)) continue; // the same copy, carried forward
      seen.add(key);
      const file = join(backup.dir, item.file);
      sources.push({
        version: `world:${backup.name}`,
        taken: backup.manifest.finished_at ?? null,
        time: stampTime(backup.name),
        saved: "in a world backup",
        title: item.title ?? null,
        type: item.type,
        id: String(item.id),
        file,
        load: () => readJson(file).data,
      });
    }
  sources.sort((a, b) => (b.time || 0) - (a.time || 0));

  const found = new Map();
  let read = 0;
  let stopped = null;
  for (const source of sources) {
    if (now() - started > budget) {
      stopped = "time";
      break;
    }
    const key = `${source.type}:${lower(source.id)}`;
    if (!found.has(key) && found.size >= max) {
      stopped = "limit";
      continue;
    }
    let data;
    try {
      data = source.load();
    } catch {
      continue;
    }
    read += 1;
    const hits = findText(data, needle);
    if (!hits.length) continue;
    if (!found.has(key)) found.set(key, { type: source.type, id: source.id, title: source.title, found_in: [] });
    const entry = found.get(key);
    if (entry.found_in.length < 3)
      entry.found_in.push({ version: source.version, taken: source.taken, saved: source.saved, field: hits[0].field, snippet: hits[0].snippet });
    else entry.more_versions = (entry.more_versions ?? 0) + 1;
  }

  return {
    world: world?.title ?? "",
    searched_for: String(text).trim(),
    items_found: found.size,
    results: [...found.values()],
    copies_searched: read,
    copies_in_backups: sources.length,
    ...(stopped === "time"
      ? { warning: `The search ran out of time after ${read} of ${sources.length} saved copies (newest first). Narrow it with a type, or search for something more specific.` }
      : stopped === "limit"
        ? { warning: `More than ${max} items matched; only the first ${max} are shown. Search for something more specific.` }
        : {}),
  };
}

/** Lines of text that are in `from` and not in `into`, counting repeats. */
function linesMissing(from, into) {
  const lines = (t) => String(t ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const have = new Map();
  for (const l of lines(into)) have.set(l, (have.get(l) ?? 0) + 1);
  const missing = [];
  for (const l of lines(from)) {
    const n = have.get(l) ?? 0;
    if (n > 0) have.set(l, n - 1);
    else missing.push(l);
  }
  return missing;
}

/** Field-by-field differences between a saved copy and the item now. */
export function differences(saved, current) {
  const out = [];
  for (const field of Object.keys(saved ?? {})) {
    if (NOT_COMPARED.has(field)) continue;
    const a = saved[field];
    const b = current?.[field];
    if (sameContent(a, b)) continue;
    const textual = (v) => typeof v === "string" || v === null || v === undefined;
    const long = (v) => typeof v === "string" && (v.includes("\n") || v.length > 200);
    if (textual(a) && textual(b) && (long(a) || long(b))) {
      const lost = linesMissing(a, b);
      const added = linesMissing(b, a);
      out.push({
        field,
        kind: "text",
        lines_lost: lost.length,
        lines_added: added.length,
        ...(lost.length ? { lost: lost.slice(0, 30).map((l) => short(l, 300)) } : {}),
        ...(added.length ? { added: added.slice(0, 30).map((l) => short(l, 300)) } : {}),
      });
    } else out.push({ field, kind: "value", saved: short(withoutDates(a)), current: short(withoutDates(b)) });
  }
  return out;
}

/** Compare a saved version of an item with the item as it is now. */
export async function compareBackup(client, { type, id, version }) {
  const root = backupRoot(client);
  const live = await liveItem(client, type, id);
  const what = `${type} ${id}`;
  const chosen = pickVersion(versionsOf(root, live.worldId, type, id), version, what);
  const saved = chosen.load();
  // The word count follows the text, so it is not a difference of its own:
  // it is shown as one line, a quick sign of text gained or lost.
  const diff = differences(saved, live.data).filter((d) => d.field !== "wordcount");
  const lostFrom = diff.filter((d) => d.kind === "text" && d.lines_lost).map((d) => d.field);
  const counted = typeof saved?.wordcount === "number" && typeof live.data?.wordcount === "number";
  return {
    item: { type, id, title: live.data?.title ?? chosen.title },
    compared_with: describe(chosen),
    ...(counted
      ? { words: { saved: saved.wordcount, now: live.data.wordcount, change: live.data.wordcount - saved.wordcount } }
      : {}),
    identical: diff.length === 0,
    text_lost_from: lostFrom,
    differences: diff,
    not_compared: "last-changed dates, wherever they appear",
    note:
      diff.length === 0
        ? "The item is the same now as in the saved copy."
        : lostFrom.length
          ? `${diff.length} field(s) differ. Lines that were in the saved copy and are not in the item now: ${lostFrom.join(", ")} (listed under "lost", up to 30 per field).`
          : `${diff.length} field(s) differ, and no line of text from the saved copy is missing from the item now.`,
  };
}

/** Save a copy of one item on request, unless it is the same as the newest saved copy. */
export async function backupItem(client, { type, id, force }) {
  const root = backupRoot(client);
  const live = await liveItem(client, type, id);
  const versions = versionsOf(root, live.worldId, type, id);
  const newest = versions[0];
  const item = { type, id, title: live.data?.title ?? null };

  if (newest && force !== true) {
    let same = false;
    try {
      same = sameContent(newest.load(), live.data);
    } catch {
      same = false;
    }
    if (same) {
      const folder = versions.find((v) => v.version.startsWith("item:"))?.file;
      return {
        backup_taken: false,
        item,
        newest_saved_copy: describe(newest),
        ...(folder ? client.backups.report(dirname(folder)) : {}),
        note:
          `No backup taken. No change since ${newest.taken ?? newest.version}: the item is the same as its ` +
          "newest saved copy. If the user wants one anyway, call again with force: true.",
      };
    }
  }

  const file = client.backups.saveItem({
    worldId: live.worldId,
    worldTitle: live.worldTitle,
    path: `/${type}`,
    id: String(id),
    action: "request",
    data: live.data,
  });
  return {
    backup_taken: true,
    item,
    file,
    ...client.backups.report(dirname(file)),
    note: newest ? "Backup taken." : "Backup taken (the first saved copy of this item).",
  };
}

/**
 * Put one item back the way a saved version had it. Without `confirm` it
 * only shows what would change. With it: the guard backs up the item as it
 * is now, the plain values are written, and the item is read back.
 */
export async function restoreItem(client, { type, id, version, confirm }) {
  const root = backupRoot(client);
  checkItem(type, id);
  if (!RESTORABLE.has(type))
    throw new Error(
      `Restoring a ${type} isn't supported yet (it hasn't been tested on World Anvil). Supported: ${[...RESTORABLE].join(", ")}. ` +
        "worldanvil_compare_backup shows what the saved copy holds.",
    );
  if (version === undefined || version === null || version === "")
    throw new Error("Say which saved version to restore (see worldanvil_list_backups). Restore never picks one itself.");

  const live = await liveItem(client, type, id);
  client.access.requireAction(live.worldId, "update");
  const chosen = pickVersion(versionsOf(root, live.worldId, type, id), version, `${type} ${id}`);
  const saved = chosen.load();

  const changes = {};
  const notRestored = [];
  for (const d of differences(saved, live.data)) {
    const field = d.field;
    const a = saved[field];
    const b = live.data?.[field];
    if (NEVER_RESTORED.has(field.toLowerCase()))
      notRestored.push({ field, why: "identity, privacy and placement are never changed by restore" });
    else if (DERIVED_FIELDS.has(field.toLowerCase()) || DERIVED.test(field))
      notRestored.push({ field, why: "World Anvil works this out itself" });
    else if (UNTESTED_FIELDS.has(field.toLowerCase()))
      notRestored.push({ field, why: "writing this hasn't been tested on World Anvil yet: change it by hand if it matters" });
    else if (isPlain(a) || (a === null && isPlain(b))) changes[field] = a;
    else notRestored.push({ field, why: "a link or a list: change it by hand if it matters" });
  }
  const fields = Object.keys(changes);
  const item = { type, id, title: live.data?.title ?? chosen.title };
  // Described now: the backup taken before the write can rename the item's
  // folder (when the title is one of the things changing).
  const from = describe(chosen);
  const preview = fields.map((f) => ({ field: f, now: short(live.data?.[f]), saved: short(saved[f]) }));

  if (!fields.length)
    return {
      restored: false,
      item,
      from,
      not_restored: notRestored,
      note: "Nothing to restore: every value restore can write is already the same as in that saved copy.",
    };

  if (confirm !== true)
    return {
      restored: false,
      confirm_needed: true,
      item,
      from,
      would_restore: preview,
      not_restored: notRestored,
      note:
        `Nothing has been changed. This would put ${fields.length} field(s) back to the saved copy: ${fields.join(", ")}. ` +
        "Show the user, and only if they agree call again with confirm: true. The item as it is now is backed up first.",
    };

  // The guard backs up the item as it is now before this is sent.
  await client.request(`/${type}?id=${id}`, "PATCH", changes);
  const after = await client.request(`/${type}?id=${id}&granularity=2`);
  const taken = fields.filter((f) => canonical(after?.[f]) === canonical(saved[f]));
  const refused = fields.filter((f) => !taken.includes(f));
  return {
    restored: refused.length === 0,
    item,
    from,
    fields_restored: taken,
    ...(refused.length
      ? {
          fields_not_taken: refused.map((f) => ({ field: f, now: short(after?.[f]), saved: short(saved[f]) })),
          warning: `World Anvil did not take ${refused.length} field(s): ${refused.join(", ")}. They are unchanged or differ from the saved copy.`,
        }
      : {}),
    not_restored: notRestored,
    note:
      "The item as it was just before this restore was backed up first: worldanvil_list_backups shows it as the newest version.",
  };
}
