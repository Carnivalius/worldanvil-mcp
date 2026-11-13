/**
 * Local backups taken before every edit or delete.
 *
 * Layout (in the backup folder, outside any repository):
 *   backups/items/<world>/<type>/<item title> - <item id>/<timestamp>-<action>.json
 *
 * The folder carries the item's title so a person can find it by eye. The
 * id keeps it unique and is what identifies it: if the item is renamed its
 * folder is renamed too, so all its versions stay together.
 *
 * Backups are write-once. Files are written read-only; tools may read them
 * (the look-back tools, which follow the access settings) but no tool can
 * edit or delete one. The only removal is pruning, straight after a new
 * copy is saved:
 *
 *   - a backup is never refused for being over the limit;
 *   - pruning happens only while there are more copies than the limit
 *     (item_backup_keep per item, world_backup_keep per world);
 *   - oldest first, and only copies older than backup_keep_days. Age alone
 *     never deletes anything, and a burst of new copies can't push out
 *     recent history: the folder grows instead, and the answer says so.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";

export function safeName(text, fallback = "untitled") {
  const s = String(text ?? "")
    .replace(/[^A-Za-z0-9 _.-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return s || fallback;
}

/** "<title> - <id>": readable by a person, unique by its id. */
export function itemName(title, id) {
  return `${safeName(title, "untitled")} - ${id}`;
}

export function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** The time in a backup's name ("2026-11-13T10-00-00-000Z..."), in ms; NaN if it has none. */
export function stampTime(name) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(String(name));
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which backups may go. `names` are every copy held (their names start with
 * the time they were taken). Only while there are more than `keep`: oldest
 * first, and only those older than `keepDays`. A name whose time can't be
 * read is never chosen.
 */
export function pickExpired(names, { keep, keepDays, now = Date.now() }) {
  const sorted = [...names].sort();
  const excess = Math.max(0, sorted.length - keep);
  const out = [];
  for (const name of sorted.slice(0, excess)) {
    const taken = stampTime(name);
    if (Number.isNaN(taken) || now - taken <= keepDays * DAY_MS) break; // the rest are newer still
    out.push(name);
  }
  return out;
}

/** What is held against the limit, in words the assistant can pass on. */
export function retentionReport({ held, keep, keepDays, bytes }) {
  const size_mb = Math.round((bytes / 1048576) * 100) / 100;
  // Under a tenth of a megabyte, megabytes round to nothing: say kilobytes.
  const size = bytes < 104858 ? `${Math.round((bytes / 1024) * 10) / 10} KB` : `${size_mb} MB`;
  const storing = `Storing ${held}/${keep} backups using ${size}.`;
  return {
    backups_held: held,
    backup_limit: keep,
    backups_size_mb: size_mb,
    storing:
      held > keep
        ? `Your backups have exceeded your set limit of ${keep}; your retention of ${keepDays} days ` +
          `has stopped the excess being deleted. ${storing}`
        : storing,
  };
}

export class Backups {
  /**
   * @param {object} opts
   * @param {string} opts.dir - backups root (absolute)
   * @param {number} opts.keep - copies kept per item
   * @param {number} [opts.keepDays] - a copy younger than this is never pruned
   * @param {() => number} [opts.now]
   */
  constructor({ dir, keep, keepDays = 7, now = Date.now }) {
    if (!dir) throw new Error("backup folder not configured");
    this.dir = dir;
    this.keep = keep;
    this.keepDays = keepDays;
    this.now = now;
  }

  /**
   * The folder for one item's versions: "<title> - <id>". If the item
   * already has a folder under another title (it was renamed) or under the
   * older id-only name, that folder is renamed, so versions stay together.
   */
  itemFolder({ worldId, worldTitle, path, id, title }) {
    const world = `${safeName(worldTitle, "world")}-${String(worldId).slice(0, 8)}`;
    const parent = join(this.dir, "items", world, safeName(path.replace(/^\//, ""), "item"));
    const wanted = join(parent, itemName(title, id));
    if (existsSync(parent) && !existsSync(wanted)) {
      const suffix = ` - ${id}`.toLowerCase();
      const old = readdirSync(parent).find((n) => {
        const name = n.toLowerCase();
        return name === String(id).toLowerCase() || name.endsWith(suffix);
      });
      if (old) renameSync(join(parent, old), wanted);
    }
    return wanted;
  }

  /** Save one item's current state; returns the file written. */
  saveItem({ worldId, worldTitle, path, id, action, data }) {
    const folder = this.itemFolder({ worldId, worldTitle, path, id, title: data?.title });
    mkdirSync(folder, { recursive: true });
    const when = new Date(this.now());
    const file = join(folder, `${timestamp(when)}-${action}.json`);
    const tmp = `${file}.tmp`;
    const record = {
      backed_up_at: when.toISOString(),
      reason: action === "request" ? "on request" : `before ${action}`,
      world: { id: worldId, title: worldTitle },
      type: path.replace(/^\//, ""),
      id,
      title: data?.title ?? null,
      data,
    };
    writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    renameSync(tmp, file);
    chmodSync(file, 0o444);
    this.rotate(folder);
    return file;
  }

  /** Prune one item's folder by the rule at the top of this file. */
  rotate(folder) {
    const files = readdirSync(folder).filter((f) => f.endsWith(".json"));
    for (const old of pickExpired(files, { keep: this.keep, keepDays: this.keepDays, now: this.now() })) {
      const p = join(folder, old);
      chmodSync(p, 0o644);
      unlinkSync(p);
    }
  }

  /** How many copies one item's folder holds against the limit, and their size. */
  report(folder) {
    const files = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".json")) : [];
    const bytes = files.reduce((sum, f) => sum + statSync(join(folder, f)).size, 0);
    return retentionReport({ held: files.length, keep: this.keep, keepDays: this.keepDays, bytes });
  }
}
