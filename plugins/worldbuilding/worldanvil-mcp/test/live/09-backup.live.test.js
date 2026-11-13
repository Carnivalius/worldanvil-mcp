/**
 * Stage 2 live check: the whole-world backup tool, on the test world.
 *
 *   WA_TEST_STAGE=read   WA_TEST_BACKUP=1 npm run test:live -- test/live/09-backup.live.test.js
 *   WA_TEST_STAGE=update WA_TEST_BACKUP=1 npm run test:live -- test/live/09-backup.live.test.js
 *
 * One run per stage, in that order. Needs the stage 1 articles (08).
 *
 *   read    Back the test world up (calling again until done), and check
 *           the copy against the world outline. Then back up again: with
 *           nothing changed, nothing should need reading from World Anvil.
 *   update  Edit one test article through the tool, back up again, and
 *           check that exactly that article was read again and the copy
 *           holds the new text. This is the proof that World Anvil's
 *           change date moves on an edit, which "copy unchanged items"
 *           relies on.
 *
 * The harness only lets tests read items it has on record. A backup reads
 * everything in the test world, including things made by hand on the site
 * that were never recorded. When the harness refuses one, this test
 * registers it with the harness's own adopt() check (which confirms the
 * item belongs to the test world) and calls the tool again. The harness
 * itself is unchanged, and the refusal doubles as a test that a backup
 * carries on where it stopped.
 *
 * The read stage changes nothing on World Anvil. Backups go to the
 * harness's backup folder, outside the repository (worldanvil_backup/worlds/...).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createHarness } from "./harness/harness.js";
import { PATHS } from "./harness/state.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_BACKUP === "1";
const EDITED = "MCP-TEST-S1 Prose";

function note(msg) {
  console.log(`[backup] ${msg}`);
}

function setup(stageName) {
  const ctx = { h: null, world: null };
  ctx.ok = async (tool, args) => {
    const res = await ctx.h.call(tool, args);
    expect(ctx.h.aborted, res.text).toBe(false);
    expect(res.isError, `${tool}: ${String(res.text).slice(0, 300)}`).toBeFalsy();
    return res.data;
  };
  /** The item's parent as the unfinished backup recorded it (null = the world). */
  ctx.parentInProgress = (id) => {
    const worlds = join(PATHS.backups, "worlds");
    if (!existsSync(worlds)) return null;
    for (const world of readdirSync(worlds))
      for (const name of readdirSync(join(worlds, world)).filter((n) => n.endsWith(".partial"))) {
        const file = join(worlds, world, name, "progress.json");
        if (!existsSync(file)) continue;
        const item = JSON.parse(readFileSync(file, "utf8")).items.find((i) => i.id.toLowerCase() === id.toLowerCase());
        if (item) return item.parent?.id ?? null;
      }
    return null;
  };
  /** Call the backup tool until it reports done, adopting hand-made items the harness doesn't know. */
  ctx.backup = async (extra = {}) => {
    const started = Date.now();
    let calls = 0;
    let adopted = 0;
    let result;
    do {
      const res = await ctx.h.call("worldanvil_backup_world", { world_id: ctx.world, ...(calls === 0 ? extra : {}) });
      calls += 1;
      expect(ctx.h.aborted, res.text).toBe(false);
      const refused = /REFUSED: read of (\/[a-z_]+) id=([A-Za-z0-9-]+) is not a ledger item/.exec(String(res.text ?? ""));
      if (res.isError && refused && adopted < 60) {
        const [, path, id] = refused;
        const parent = ctx.parentInProgress(id) ?? ctx.world;
        await ctx.h.adopt(id, path, parent);
        adopted += 1;
        note(`adopted a hand-made ${path.slice(1)} the harness didn't know (parent: ${parent === ctx.world ? "the test world" : "its recorded parent"})`);
        result = { done: false, saved: "?", found_so_far: "?" };
        continue;
      }
      expect(res.isError, `worldanvil_backup_world: ${String(res.text).slice(0, 300)}`).toBeFalsy();
      result = res.data;
      if (!result.done) note(`call ${calls}: ${result.saved} of ${result.found_so_far} found so far saved, not finished`);
    } while (!result.done && calls < 90);
    expect(result.done).toBe(true);
    if (adopted) note(`${adopted} item(s) adopted; the backup carried on after each refusal`);
    note(
      `done in ${calls} call(s), ${Math.round((Date.now() - started) / 1000)}s: ` +
        `${JSON.stringify(result.counts)}, read ${result.read_from_world_anvil}, ` +
        `copied ${result.copied_unchanged_from_previous_backup}, kept ${result.backups_kept}, ` +
        `size ${result.size_mb} MB, ${result.total} items`,
    );
    if (result.warning) note(`WARNING from the tool: ${result.warning}`);
    for (const n of result.could_not_be_saved ?? []) note(`could not be saved: ${JSON.stringify(n)}`);
    return result;
  };
  beforeAll(async () => {
    ctx.h = await createHarness({ stage: stageName });
    ctx.world = ctx.h.testWorldId;
  });
  return ctx;
}

const json = (...parts) => JSON.parse(readFileSync(join(...parts), "utf8"));

describe.runIf(enabled && stage === "read")("world backup: read", () => {
  const ctx = setup("read");
  let first;

  it("is not aborted and has the test world", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.world).toBeTruthy();
  });

  it("backs up the whole test world, reading everything", async () => {
    first = await ctx.backup({ full: true });
    expect(first.copied_unchanged_from_previous_backup).toBe(0);
    expect(first.read_from_world_anvil).toBe(first.total);
    expect(existsSync(join(first.folder, "manifest.json"))).toBe(true);
    expect(existsSync(join(first.folder, "world.json"))).toBe(true);
  });

  it("the copy matches the world outline, item for item", async () => {
    const outline = await ctx.ok("worldanvil_get_world_outline", { world_id: ctx.world });
    expect(first.counts.categories).toBe(outline.totals.categories);
    expect(first.counts.articles).toBe(outline.totals.articles);
    // The test world has a manuscript from the earlier stages: it must be in there too.
    expect(first.counts.manuscripts).toBeGreaterThan(0);
    expect(first.counts["chapters and scenes"]).toBeGreaterThan(0);

    const manifest = json(first.folder, "manifest.json");
    expect(manifest.missing).toEqual([]);
    const stamped = manifest.items.filter((i) => i.stamp).length;
    note(`items with a change date: ${stamped} of ${manifest.items.length}`);
    note(
      `change date present on categories: ${manifest.items.filter((i) => i.type === "category").every((i) => i.stamp)}, ` +
        `on articles: ${manifest.items.filter((i) => i.type === "article").every((i) => i.stamp)}`,
    );

    const ids = [];
    const walk = (cats) => {
      for (const c of cats) {
        ids.push(...c.articles.map((a) => a.id));
        walk(c.categories);
      }
    };
    walk(outline.categories);
    ids.push(...outline.uncategorised.map((a) => a.id));
    for (const id of ids) {
      const entry = manifest.items.find((i) => i.type === "article" && i.id.toLowerCase() === String(id).toLowerCase());
      expect(entry, `article ${id} is not in the manifest`).toBeTruthy();
      expect(existsSync(join(first.folder, entry.file)), `no copy of article ${id}`).toBe(true);
    }
    note(`example file name: ${manifest.items.find((i) => i.title === EDITED).file}`);
    const sample = manifest.items.find((i) => i.type === "article" && i.title === EDITED);
    const copy = json(first.folder, sample.file);
    note(`a saved article has ${Object.keys(copy.data).length} fields; title "${copy.data.title}"`);
    expect(copy.data.title).toBe(EDITED);
    expect(copy.data.world?.id).toBeTruthy();
  });

  it("a second backup with nothing changed reads nothing again", async () => {
    const second = await ctx.backup();
    note(`second backup: read ${second.read_from_world_anvil}, copied ${second.copied_unchanged_from_previous_backup}`);
    expect(second.total).toBe(first.total);
    expect(second.read_from_world_anvil + second.copied_unchanged_from_previous_backup).toBe(second.total);
    expect(second.folder).not.toBe(first.folder);
    // Complete in itself: every file is there, not just the changed ones.
    expect(json(second.folder, "manifest.json").items.every((i) => existsSync(join(second.folder, i.file)))).toBe(true);
  });
});

describe.runIf(enabled && stage === "update")("world backup: update", () => {
  const ctx = setup("update");

  it("is not aborted and has the article to edit", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.h.ledger.live().find((e) => e.path === "/article" && e.title === EDITED)).toBeTruthy();
  });

  it("after an edit, exactly the edited article is read again", async () => {
    const id = ctx.h.ledger.live().find((e) => e.path === "/article" && e.title === EDITED).id;
    const before = await ctx.backup(); // a baseline that already holds everything
    const text = `Edited for the backup test at ${new Date().toISOString()}.`;
    await ctx.ok("worldanvil_update_article", { article_id: id, content: text });

    const after = await ctx.backup();
    note(`after one edit: read ${after.read_from_world_anvil}, copied ${after.copied_unchanged_from_previous_backup}`);
    const copy = json(after.folder, json(after.folder, "manifest.json").items.find((i) => i.id === id).file);
    expect(copy.data.content).toContain("Edited for the backup test");
    const stampBefore = json(before.folder, "manifest.json").items.find((i) => i.id === id)?.stamp;
    note(`change date moved on the edit: ${stampBefore !== copy.stamp}`);
    expect(copy.stamp).not.toBe(stampBefore);
    // Items with no change date (some manuscript pieces) are read on every
    // backup, so the baseline is not zero: the edit must add exactly one.
    expect(after.read_from_world_anvil).toBe(before.read_from_world_anvil + 1);
    expect(after.copied_unchanged_from_previous_backup).toBe(before.copied_unchanged_from_previous_backup - 1);
  });
});
