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
 * Files are written read-only. No tool can read, edit or delete them; the
 * only automatic removal is rotating out copies beyond item_backup_keep.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
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

export class Backups {
  /**
   * @param {object} opts
   * @param {string} opts.dir - backups root (absolute)
   * @param {number} opts.keep - copies kept per item
   */
  constructor({ dir, keep }) {
    if (!dir) throw new Error("backup folder not configured");
    this.dir = dir;
    this.keep = keep;
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
    const file = join(folder, `${timestamp()}-${action}.json`);
    const tmp = `${file}.tmp`;
    const record = {
      backed_up_at: new Date().toISOString(),
      reason: `before ${action}`,
      world: { id: worldId, title: worldTitle },
      type: path.replace(/^\//, ""),
      id,
      title: data?.title ?? null,
      data,
    };
    writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    renameSync(tmp, file);
    chmodSync(file, 0o444);
    this.rotate(folder, this.keep);
    return file;
  }

  /** Keep only the newest `keep` backups in a folder. */
  rotate(folder, keep) {
    const files = readdirSync(folder)
      .filter((f) => f.endsWith(".json"))
      .sort();
    for (const old of files.slice(0, Math.max(0, files.length - keep))) {
      const p = join(folder, old);
      chmodSync(p, 0o644);
      unlinkSync(p);
    }
  }
}
