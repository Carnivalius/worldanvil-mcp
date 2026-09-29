/**
 * Live-test safety harness - on-disk state (ledger + protected worlds).
 *
 * Both files are gitignored and live in the package directory:
 *   test-ledger.json       - every resource the tests created (append-only log)
 *   protected-worlds.json  - every pre-existing world id/slug (append-only)
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export const PACKAGE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export const PATHS = {
  env: join(PACKAGE_DIR, ".env.test"),
  ledger: join(PACKAGE_DIR, "test-ledger.json"),
  protected: join(PACKAGE_DIR, "protected-worlds.json"),
  access: join(PACKAGE_DIR, "test-access.json"),
  backups: join(PACKAGE_DIR, "test-backups"),
};

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

export class Ledger {
  constructor(file = PATHS.ledger) {
    this.file = file;
    this.data = existsSync(file) ? readJson(file) : { version: 1, entries: [] };
  }

  static exists(file = PATHS.ledger) {
    return existsSync(file);
  }

  save() {
    writeJsonAtomic(this.file, this.data);
  }

  live() {
    return this.data.entries.filter((e) => !e.deletedAt);
  }

  get(id) {
    return this.live().find((e) => e.id === id.toLowerCase());
  }

  ids() {
    return new Set(this.live().map((e) => e.id));
  }

  worldIds() {
    return new Set(
      this.live()
        .filter((e) => e.path === "/world")
        .map((e) => e.id),
    );
  }

  /** Record a created resource immediately (called before returning to tests). */
  record({ id, path, title, worldId, parentIds = [], auto = false }) {
    this.data.entries.push({
      id: id.toLowerCase(),
      path,
      title,
      worldId: worldId?.toLowerCase() ?? null,
      parentIds: parentIds.map((p) => p.toLowerCase()),
      auto,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    });
    this.save();
  }

  markDeleted(id) {
    const entry = this.get(id);
    if (entry) {
      entry.deletedAt = new Date().toISOString();
      this.save();
    }
  }

  /** Live entries newest first - the order cleanup must delete in. */
  reverseCreationOrder() {
    return [...this.live()].reverse();
  }
}

export class ProtectedWorlds {
  constructor(file = PATHS.protected) {
    this.file = file;
    this.data = existsSync(file) ? readJson(file) : null;
  }

  static exists(file = PATHS.protected) {
    return existsSync(file);
  }

  /** Lowercase ids and slugs for fast token matching. */
  tokens() {
    const set = new Set();
    for (const w of this.data?.worlds ?? []) {
      if (w.id) set.add(w.id.toLowerCase());
      if (w.slug) set.add(w.slug.toLowerCase());
    }
    return set;
  }

  ids() {
    return new Set((this.data?.worlds ?? []).map((w) => w.id.toLowerCase()));
  }

  /** Append worlds; never removes existing entries. */
  append(worlds) {
    if (!this.data)
      this.data = { version: 1, createdAt: new Date().toISOString(), worlds: [] };
    const have = this.ids();
    const added = [];
    for (const w of worlds) {
      const id = w.id.toLowerCase();
      if (have.has(id)) continue;
      this.data.worlds.push({
        id,
        slug: w.slug ? String(w.slug).toLowerCase() : null,
        addedAt: new Date().toISOString(),
      });
      have.add(id);
      added.push(id);
    }
    writeJsonAtomic(this.file, this.data);
    return added;
  }
}
