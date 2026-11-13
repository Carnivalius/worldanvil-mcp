/**
 * Whole-world backup: a local copy of everything in a world that the API
 * can read, taken before working on it.
 *
 * Layout (beside the item backups, outside the repository):
 *   backups/worlds/<world>/<timestamp>/manifest.json
 *                                      world.json
 *                                      <type folder>/<title> - <id>.json   (one per item)
 *
 * What shapes it:
 *
 * - **One request per item, paced.** A large world takes minutes, longer
 *   than an assistant's tool call may wait. So each call works for a fixed
 *   time, saves its place on disk, and says to call again. A backup in
 *   progress lives in "<timestamp>.partial" and only becomes a backup when
 *   every item is saved.
 * - **A world need not have everything.** No maps means an empty list of
 *   maps, and the backup moves on.
 * - **A list that fails must not sink the backup.** World Anvil has lists
 *   that fail on its own side. Such a section is recorded as "could not be
 *   saved" and reported plainly. The exception is categories and articles:
 *   without those there is no backup, so a failure there stops the call.
 * - **Unchanged items are not read again.** World Anvil's lists give each
 *   item's last-changed date. An item whose date matches the previous
 *   complete backup is copied from it. `full` reads everything afresh.
 * - **An untouched manuscript is not walked again.** Changing anything
 *   inside a manuscript (a scene, a label, a beat) moves the manuscript's
 *   own change date (seen live 2026-11-13). So when that date matches the
 *   previous backup, everything inside it is copied forward without asking
 *   World Anvil for a single list. `full` walks it regardless.
 * - **Every backup is complete in itself.** Copies, not links, so an old
 *   backup can be rotated out without damaging a newer one.
 * - **Nothing changed, nothing saved.** If every item was copied from the
 *   previous backup and none was added or removed, the answer is "no
 *   changes since <date>" and no backup is kept. `full` always saves one.
 * - **Backups are write-once.** Nothing here edits a finished backup. Old
 *   ones are pruned by the rule in backup.js: only over world_backup_keep,
 *   oldest first, and never one younger than backup_keep_days.
 *
 * Everything is read through the guarded client, so a world the access
 * settings don't allow can't be backed up either.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { itemName, pickExpired, retentionReport, safeName, timestamp } from "./backup.js";
import { listAll } from "../listing.js";

/** How long one call works before saving its place and returning. */
export const CALL_BUDGET_MS = 40_000;
/** A half-finished backup older than this is started again: its lists are stale. */
export const PARTIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Everything a world can hold, as a tree. Each entry names the client
 * method that lists it (given its parent's id; the world's for the top
 * level) and the one that reads a single item in full. `children` are
 * listed per item. `core` sections must succeed.
 */
const s = (type, folder, label, list, read, extra = {}) => ({ type, folder, label, list, read, ...extra });
export const SECTIONS = [
  s("category", "categories", "categories", "listCategories", "getCategory", { core: true }),
  s("article", "articles", "articles", "listArticles", "getArticle", { core: true }),
  s("secret", "secrets", "secrets", "listSecrets", "getSecret"),
  s("timeline", "timelines", "timelines", "listTimelines", "getTimeline"),
  s("history", "histories", "timeline events", "listHistories", "getHistory"),
  s("map", "maps", "maps", "listMaps", "getMap", {
    children: [
      s("layer", "map-layers", "map layers", "listLayers", "getLayer"),
      s("markergroup", "map-marker-groups", "map marker groups", "listMarkerGroups", "getMarkerGroup"),
      s("marker", "map-markers", "map markers", "listMarkers", "getMarker"),
    ],
  }),
  s("notebook", "notebooks", "notebooks", "listNotebooks", "getNotebook", {
    children: [
      s("notesection", "notebook-sections", "notebook sections", "listNotesections", "getNotesection", {
        children: [s("note", "notes", "notes", "listNotes", "getNote")],
      }),
    ],
  }),
  s("blockfolder", "statblock-folders", "statblock folders", "listBlockFolders", "getBlockFolder", {
    children: [s("block", "statblocks", "statblocks", "listBlocksInFolder", "getBlock")],
  }),
  s("block", "statblocks", "statblocks", "listBlocks", "getBlock"),
  s("variablecollection", "variable-collections", "variable collections", "listVariableCollections", "getVariableCollection", {
    children: [s("variable", "variables", "variables", "listVariables", "getVariable")],
  }),
  s("canvas", "canvases", "canvases", "listCanvases", "getCanvas"),
  s("manuscript", "manuscripts", "manuscripts", "listManuscripts", "getManuscript", {
    // Its change date moves when anything inside it changes.
    dateCoversChildren: true,
    children: [
      s("manuscript_version", "manuscript-drafts", "manuscript drafts", "listManuscriptVersions", "getManuscriptVersion", {
        children: [
          s("manuscript_part", "manuscript-parts", "chapters and scenes", "listManuscriptParts", "getManuscriptPart", {
            children: [s("manuscript_beat", "manuscript-beats", "beats", "listManuscriptBeats", "getManuscriptBeat")],
          }),
          s("manuscript_plot", "manuscript-plots", "plots", "listManuscriptPlots", "getManuscriptPlot"),
          s("manuscript_stat", "manuscript-stats", "manuscript stats", "listManuscriptStats", "getManuscriptStat"),
        ],
      }),
      s("manuscript_tag", "manuscript-tags", "manuscript tags", "listManuscriptTags", "getManuscriptTag"),
      s("manuscript_label", "manuscript-labels", "manuscript labels", "listManuscriptLabels", "getManuscriptLabel"),
      s("manuscript_bookmark", "manuscript-bookmarks", "manuscript bookmarks", "listManuscriptBookmarks", "getManuscriptBookmark"),
    ],
  }),
];

export const NOT_INCLUDED =
  "image files and subscriber groups (switched off in this fork), statblock templates (they belong to " +
  "the account, not the world), and timeline eras except as each timeline lists them";

/** type -> section, and (parent type or "world") -> the sections listed under it. */
const BY_TYPE = new Map();
const UNDER = new Map([["world", []]]);
(function index(sections, parentType) {
  for (const section of sections) {
    if (!BY_TYPE.has(section.type)) BY_TYPE.set(section.type, section);
    if (!UNDER.has(parentType)) UNDER.set(parentType, []);
    UNDER.get(parentType).push(section);
    if (section.children) index(section.children, section.type);
  }
})(SECTIONS, "world");

/** The section for an item type ("article", "manuscript_part", ...), or null. */
export const sectionOf = (type) => BY_TYPE.get(String(type)) ?? null;
export const ITEM_TYPES = [...BY_TYPE.keys()];

export const INCLUDED = ["world settings record", ...new Set([...BY_TYPE.values()].map((x) => x.label))];

const lower = (id) => String(id).toLowerCase();
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

/** World Anvil's last-changed stamp for a list record, as comparable text. */
function stampOf(record) {
  const value = record?.updateDate;
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** An answer from World Anvil that will be the same if asked again. */
function isLasting(error) {
  const status = error?.status;
  return typeof status === "number" && status >= 400 && status !== 429;
}

/** A short, readable reason: World Anvil sometimes answers with a whole web page. */
function plainReason(error) {
  let text = String(error?.message ?? error);
  const summary = /"summary":"((?:[^"\\]|\\.)*)"/.exec(text);
  if (summary) text = `${text.split("{")[0].trim()} ${summary[1].replace(/\\n/g, " ").replace(/\\+/g, "\\")}`;
  const head = text.split(/<!DOCTYPE|<html/i)[0].replace(/\s+/g, " ").trim().replace(/[:\s]+$/, "");
  const reason = head || `HTTP ${error?.status ?? "error"}`;
  return /<!DOCTYPE|<html/i.test(text) ? `${reason} (World Anvil answered with a web page, not data)`.slice(0, 200) : reason.slice(0, 200);
}

function removeTree(dir) {
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else chmodSync(p, 0o644); // backups are written read-only
    }
  };
  if (!existsSync(dir)) return;
  walk(dir);
  rmSync(dir, { recursive: true, force: true });
}

/** Total size of a folder's files, in bytes. */
function sizeOfTree(dir) {
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    bytes += st.isDirectory() ? sizeOfTree(p) : st.size;
  }
  return bytes;
}

function lockTree(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) lockTree(p);
    else chmodSync(p, 0o444);
  }
}

/** Complete backups of a world, oldest first (folder names sort by time). */
function completeBackups(worldDir) {
  if (!existsSync(worldDir)) return [];
  return readdirSync(worldDir)
    .filter((n) => !n.endsWith(".partial") && existsSync(join(worldDir, n, "manifest.json")))
    .sort();
}

/**
 * Is the world's own record the same as in the previous backup? By its
 * change date when it has one, otherwise by its whole content.
 */
function sameWorldRecord(current, previousFile) {
  let before;
  try {
    before = readJson(previousFile);
  } catch {
    return false;
  }
  const a = stampOf(current);
  const b = stampOf(before);
  if (a !== null || b !== null) return a === b;
  return JSON.stringify(current) === JSON.stringify(before);
}

function partials(worldDir) {
  if (!existsSync(worldDir)) return [];
  return readdirSync(worldDir).filter((n) => n.endsWith(".partial")).sort();
}

/** "<title> - <id>.json", so a person can find an item by its title. */
const fileOf = (item) => join(BY_TYPE.get(item.type).folder, `${itemName(item.title, lower(item.id))}.json`);
const listKey = (section, parentId) => `${section.list}:${lower(parentId)}`;

/**
 * Back up a world, or carry on with a backup already in progress.
 *
 * @param {object} client - guarded WorldAnvilClient (has .access and .backups)
 * @param {string} worldId
 * @param {object} [opts]
 * @param {boolean} [opts.full] - read every item, even unchanged ones
 * @param {boolean} [opts.restart] - discard a backup in progress and start again
 * @param {number} [opts.budgetMs] - working time for this call
 * @param {() => number} [opts.now]
 */
export async function backupWorld(client, worldId, opts = {}) {
  const backups = client.backups;
  if (!backups?.dir)
    throw new Error("backups aren't configured (no backup folder), so a world backup can't be taken");
  const keep = client.access?.settings?.world_backup_keep ?? 20;
  const keepDays = client.access?.settings?.backup_keep_days ?? 7;
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? CALL_BUDGET_MS;
  const startedCall = now();

  // Also the access check: a world that can't be read can't be backed up.
  const world = await client.getWorld(worldId);
  const id = lower(world?.id ?? worldId);
  const title = String(world?.title ?? "");
  const worldDir = join(backups.dir, "worlds", `${safeName(title, "world")}-${id.slice(0, 8)}`);
  mkdirSync(worldDir, { recursive: true });

  // ---- find a backup in progress, or start one ---------------------------
  const notes = [];
  let dir = null;
  let progress = null;
  for (const name of partials(worldDir).reverse()) {
    const candidate = join(worldDir, name);
    let found = null;
    try {
      found = readJson(join(candidate, "progress.json"));
    } catch {
      found = null;
    }
    const age = found ? now() - Date.parse(found.started_at) : Infinity;
    if (!dir && found && !opts.restart && age <= PARTIAL_MAX_AGE_MS && lower(found.world?.id) === id) {
      dir = candidate;
      progress = found;
    } else {
      removeTree(candidate);
      if (found && !opts.restart && age > PARTIAL_MAX_AGE_MS)
        notes.push("An unfinished backup from more than a day ago was discarded and a new one started.");
    }
  }

  const saveProgress = () => writeJson(join(dir, "progress.json"), progress);
  const addLists = (parentType, parentId) => {
    let added = false;
    for (const section of UNDER.get(parentType) ?? []) {
      const key = listKey(section, parentId);
      if (progress.lists.some((l) => l.key === key)) continue;
      progress.lists.push({ key, type: section.type, list: section.list, parentType, parentId: String(parentId), done: false });
      added = true;
    }
    return added;
  };

  if (!dir) {
    progress = {
      started_at: new Date(now()).toISOString(),
      world: { id, title },
      full: Boolean(opts.full),
      lists: [],
      items: [],
      not_saved: [],
      missing: [],
      read: 0,
      reused: 0,
    };
    dir = join(worldDir, `${timestamp(new Date(now()))}.partial`);
    mkdirSync(dir, { recursive: true });
    addLists("world", id);
    writeJson(join(dir, "world.json"), world);
    saveProgress();
  } else {
    notes.push("Carried on with the backup already in progress.");
  }

  // ---- what the previous complete backup holds ---------------------------
  const previousName = completeBackups(worldDir).pop() ?? null;
  const previous = new Map(); // items with a change date, by type:id
  const previousInside = new Map(); // parent type:id -> the items directly inside it
  let previousNotSaved = [];
  let previousCount = -1;
  let previousFinished = null;
  if (previousName && !progress.full) {
    try {
      const manifest = readJson(join(worldDir, previousName, "manifest.json"));
      previousCount = (manifest.items ?? []).length;
      previousFinished = manifest.finished_at ?? null;
      for (const item of manifest.items ?? []) {
        if (!item.file) continue;
        if (item.stamp) previous.set(`${item.type}:${lower(item.id)}`, item);
        if (item.parent?.id) {
          const key = `${item.parent.type}:${lower(item.parent.id)}`;
          if (!previousInside.has(key)) previousInside.set(key, []);
          previousInside.get(key).push(item);
        }
      }
      previousNotSaved = manifest.could_not_be_saved ?? [];
    } catch {
      previous.clear(); // unreadable manifest: read everything
      previousInside.clear();
      previousNotSaved = [];
      previousCount = -1;
    }
  }

  /**
   * Copy everything inside an unchanged item from the previous backup.
   * Returns false, having copied nothing that matters, if any file is
   * missing: the caller then walks the item the ordinary way.
   */
  const carryInside = (top) => {
    const found = [];
    const queue = [top];
    while (queue.length) {
      const parent = queue.shift();
      for (const child of previousInside.get(`${parent.type}:${lower(parent.id)}`) ?? []) {
        if (!BY_TYPE.has(child.type) || !existsSync(join(worldDir, previousName, child.file))) return false;
        found.push(child);
        queue.push(child);
      }
    }
    for (const child of found) {
      const item = { type: child.type, id: child.id, title: child.title, stamp: child.stamp ?? null, parent: child.parent };
      const key = `${item.type}:${lower(item.id)}`;
      mkdirSync(join(dir, BY_TYPE.get(item.type).folder), { recursive: true });
      const target = join(dir, fileOf(item));
      copyFileSync(join(worldDir, previousName, child.file), target);
      chmodSync(target, 0o644);
      if (!known.has(key)) {
        known.add(key);
        progress.items.push(item);
        progress.reused += 1;
      }
      savedKeys.add(key);
    }
    // What World Anvil refused inside it last time is still not saved: keep saying so.
    const inside = new Set([top, ...found].map((i) => `${i.type}:${lower(i.id)}`));
    for (const gap of previousNotSaved)
      if (gap.of?.id && inside.has(`${gap.of.type}:${lower(gap.of.id)}`) && !progress.not_saved.some((n) => n.what === gap.what && n.of?.id === gap.of.id))
        progress.not_saved.push(gap);
    progress.carried = (progress.carried ?? 0) + 1;
    return true;
  };

  // ---- work until done or out of time ------------------------------------
  const known = new Set(progress.items.map((i) => `${i.type}:${lower(i.id)}`));
  const isMissing = (item) => progress.missing.some((m) => m.type === item.type && lower(m.id) === lower(item.id));
  // Checked on disk once, then kept in memory: a big world has thousands.
  const keyOf = (item) => `${item.type}:${lower(item.id)}`;
  const savedKeys = new Set(progress.items.filter((i) => existsSync(join(dir, fileOf(i)))).map(keyOf));
  const isSaved = (item) => savedKeys.has(keyOf(item));
  let cursor = 0;
  let handled = 0;
  let outOfTime = false;
  // Always get at least one thing done, so every call moves forward.
  const timeUp = () => handled > 0 && now() - startedCall >= budgetMs;

  try {
    for (;;) {
      // Lists first: they say what there is to save.
      const list = progress.lists.find((l) => !l.done);
      if (list) {
        if (timeUp()) {
          outOfTime = true;
          break;
        }
        handled += 1;
        const section = BY_TYPE.get(list.type);
        try {
          const records = await listAll((page) => client[list.list](list.parentId, page));
          for (const r of records) {
            const key = `${list.type}:${lower(r.id)}`;
            if (known.has(key)) continue;
            known.add(key);
            progress.items.push({
              type: list.type,
              id: String(r.id),
              title: r.title ?? "",
              stamp: stampOf(r),
              parent: list.parentType === "world" ? null : { type: list.parentType, id: list.parentId },
            });
          }
        } catch (e) {
          // Categories and articles are the backup; never finish without them.
          if (section.core || !isLasting(e)) throw e;
          progress.not_saved.push({
            what: section.label,
            ...(list.parentType === "world" ? {} : { of: { type: list.parentType, id: list.parentId } }),
            reason: plainReason(e),
          });
        }
        list.done = true;
        saveProgress();
        continue;
      }

      while (cursor < progress.items.length && (isSaved(progress.items[cursor]) || isMissing(progress.items[cursor]))) cursor += 1;
      const item = progress.items[cursor];
      if (!item) break;
      if (timeUp()) {
        outOfTime = true;
        break;
      }
      handled += 1;

      const target = join(dir, fileOf(item));
      mkdirSync(join(dir, BY_TYPE.get(item.type).folder), { recursive: true });
      const before = previous.get(`${item.type}:${lower(item.id)}`);
      const source = before ? join(worldDir, previousName, before.file) : null;
      const unchanged = Boolean(before && item.stamp && before.stamp === item.stamp && existsSync(source));

      // Queue this item's own lists before its file is written, so a call
      // that stops between the two can't lose them. An unchanged item whose
      // date covers what is inside it has that copied forward instead; its
      // own file is written last, so a call that stops midway does it again.
      const carried = unchanged && BY_TYPE.get(item.type).dateCoversChildren && carryInside(item);
      if (carried || addLists(item.type, item.id)) saveProgress();

      if (unchanged) {
        copyFileSync(source, target);
        chmodSync(target, 0o644);
        savedKeys.add(keyOf(item));
        progress.reused += 1;
        continue;
      }
      let data;
      try {
        data = await client[BY_TYPE.get(item.type).read](item.id);
      } catch (e) {
        // Deleted on World Anvil since the list was taken: note it and go on.
        if (e?.status === 403 || e?.status === 404) {
          progress.missing.push({ type: item.type, id: item.id, title: item.title, reason: e.message });
          continue;
        }
        throw e;
      }
      writeJson(target, { type: item.type, id: item.id, title: item.title, stamp: item.stamp, parent: item.parent, data });
      savedKeys.add(keyOf(item));
      progress.read += 1;
    }
  } finally {
    saveProgress(); // whatever happened, the next call carries on from here
  }

  const saved = progress.items.filter(isSaved).length;
  const total = progress.items.length;
  const counts = {};
  for (const item of progress.items) {
    const label = BY_TYPE.get(item.type).label;
    counts[label] = (counts[label] ?? 0) + 1;
  }

  if (outOfTime) {
    const listsLeft = progress.lists.filter((l) => !l.done).length;
    return {
      done: false,
      world: title,
      saved,
      found_so_far: total,
      note:
        `Backup NOT finished: ${saved} of ${total} items found so far are saved` +
        (listsLeft ? `, and ${listsLeft} list(s) are still to be read` : "") +
        ". Call worldanvil_backup_world again with the same world_id to carry on from here. " +
        "Don't change anything in this world until it reports done.",
      ...(notes.length ? { notes } : {}),
    };
  }

  /** Every complete backup of this world against the limit, and their size. */
  const held = () => {
    const complete = completeBackups(worldDir);
    const bytes = complete.reduce((sum, name) => sum + sizeOfTree(join(worldDir, name)), 0);
    return retentionReport({ held: complete.length, keep, keepDays, bytes });
  };

  // ---- nothing changed since the previous backup: keep nothing new --------
  // Every item was copied from it (none read, none missing) and the count is
  // the same, so the two would be identical. `full` never gets here: it
  // reads everything, so it always saves.
  if (
    !progress.full &&
    previousName &&
    progress.read === 0 &&
    progress.missing.length === 0 &&
    total === previousCount &&
    saved === total &&
    sameWorldRecord(readJson(join(dir, "world.json")), join(worldDir, previousName, "world.json"))
  ) {
    removeTree(dir);
    const since = previousFinished ?? previousName;
    return {
      done: true,
      backup_taken: false,
      world: title,
      last_backup: join(worldDir, previousName),
      last_backup_taken: since,
      checked: total,
      ...held(),
      note:
        `No backup taken. No changes since ${since}: all ${total} items have the same change date ` +
        "as in that backup, and none was added or removed. If the user wants one anyway, call again " +
        "with full: true, which reads every item afresh and always saves.",
      ...(notes.length ? { notes } : {}),
    };
  }

  // ---- finish: manifest, rename, lock, rotate -----------------------------
  const manifest = {
    format: 2,
    world: { id, title },
    started_at: progress.started_at,
    finished_at: new Date(now()).toISOString(),
    includes: INCLUDED,
    not_included: NOT_INCLUDED,
    counts,
    read_from_world_anvil: progress.read,
    copied_unchanged_from_previous_backup: progress.reused,
    previous_backup: progress.reused ? previousName : null,
    could_not_be_saved: progress.not_saved,
    missing: progress.missing,
    items: progress.items
      .filter((item) => !isMissing(item))
      .map((item) => ({ ...item, file: fileOf(item).replace(/\\/g, "/") })),
  };
  writeJson(join(dir, "manifest.json"), manifest);
  rmSync(join(dir, "progress.json"), { force: true });
  const finalDir = dir.replace(/\.partial$/, "");
  renameSync(dir, finalDir);
  lockTree(finalDir);

  for (const old of pickExpired(completeBackups(worldDir), { keep, keepDays, now: now() }))
    removeTree(join(worldDir, old));
  const retention = held();

  if (progress.missing.length)
    notes.push(
      `${progress.missing.length} item(s) were listed but could not be read (deleted meanwhile?); they are named in the manifest.`,
    );
  const unsaved = [...new Set(progress.not_saved.map((n) => n.what))];
  const summary = Object.entries(counts)
    .map(([label, n]) => `${n} ${label}`)
    .join(", ");
  return {
    done: true,
    backup_taken: true,
    world: title,
    folder: finalDir,
    saved,
    total,
    counts,
    read_from_world_anvil: progress.read,
    copied_unchanged_from_previous_backup: progress.reused,
    ...(progress.carried ? { manuscripts_unchanged_and_not_walked: progress.carried } : {}),
    ...(unsaved.length
      ? {
          could_not_be_saved: progress.not_saved,
          warning:
            `NOT in this backup, because World Anvil refused the list: ${unsaved.join(", ")}. ` +
            "Everything else was saved. Details are in the manifest.",
        }
      : {}),
    not_included: NOT_INCLUDED,
    size_mb: Math.round((sizeOfTree(finalDir) / 1048576) * 100) / 100,
    backups_kept: retention.backups_held,
    ...retention,
    note: `Backup complete: ${summary || "the world is empty"}.`,
    ...(notes.length ? { notes } : {}),
  };
}
