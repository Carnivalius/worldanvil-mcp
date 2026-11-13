/**
 * Stage 2 live check: the backup look-back tools, on the test world.
 *
 *   WA_TEST_STAGE=read   WA_TEST_LOOKBACK=1 npm run test:live -- test/live/11-lookback.live.test.js
 *   WA_TEST_STAGE=update WA_TEST_LOOKBACK=1 npm run test:live -- test/live/11-lookback.live.test.js
 *
 * One run per stage, in that order. Needs the stage 1 articles (08) and at
 * least one world backup (09).
 *
 *   read    Changes nothing on World Anvil. Lists the world's backups and one
 *           article's saved versions, searches the backups for the article's
 *           title, compares the newest saved copy with the article now, and
 *           saves a copy on request twice: the second must answer "No backup
 *           taken", and force must save one anyway.
 *   update  Edits one test article through the tool (which saves a copy
 *           first), checks the comparison shows the old text as lost, then
 *           restores that copy: preview first (nothing changes), then for
 *           real, then reads the article back. This is the first live proof
 *           of which fields World Anvil takes on a restore: every field it
 *           does not take is printed.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_LOOKBACK === "1";
const TARGET = "MCP-TEST-S1 Prose";

function note(msg) {
  console.log(`[lookback] ${msg}`);
}

function setup(stageName) {
  const ctx = { h: null, world: null, id: null };
  ctx.ok = async (tool, args) => {
    const res = await ctx.h.call(tool, args);
    expect(ctx.h.aborted, res.text).toBe(false);
    expect(res.isError, `${tool}: ${String(res.text).slice(0, 300)}`).toBeFalsy();
    return res.data;
  };
  beforeAll(async () => {
    ctx.h = await createHarness({ stage: stageName });
    ctx.world = ctx.h.testWorldId;
    ctx.id = ctx.h.ledger.live().find((e) => e.path === "/article" && e.title === TARGET)?.id ?? null;
  });
  return ctx;
}

describe.runIf(enabled && stage === "read")("backup look-back: read", () => {
  const ctx = setup("read");

  it("is not aborted and has the test article", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.id).toBeTruthy();
  });

  it("lists the world's backups and the article's saved versions", async () => {
    const summary = await ctx.ok("worldanvil_list_backups", { world_id: ctx.world });
    note(`world backups: ${summary.world_backups.length}; ${summary.world_backups_kept.storing}`);
    note(`items with copies of their own: ${JSON.stringify(summary.items_with_copies_of_their_own)}`);
    expect(summary.world_backups.length).toBeGreaterThan(0);

    const listed = await ctx.ok("worldanvil_list_backups", { world_id: ctx.world, type: "article", id: ctx.id });
    note(`versions of the article: ${listed.versions.map((v) => `${v.saved} (${v.taken})`).join("; ")}`);
    note(`its own copies: ${listed.own_copies.storing}`);
    expect(listed.versions.length).toBeGreaterThan(0);
  });

  it("finds the article by searching the backups for its title", async () => {
    const found = await ctx.ok("worldanvil_search_backups", { world_id: ctx.world, text: TARGET, type: "article" });
    note(`search: ${found.items_found} item(s), ${found.copies_searched} of ${found.copies_in_backups} copies read${found.warning ? `; ${found.warning}` : ""}`);
    expect(found.results.some((r) => r.id.toLowerCase() === ctx.id.toLowerCase())).toBe(true);
  });

  it("compares the newest saved copy with the article now", async () => {
    const result = await ctx.ok("worldanvil_compare_backup", { type: "article", id: ctx.id });
    note(`compared with: ${result.compared_with.saved} (${result.compared_with.taken}); identical: ${result.identical}`);
    // Fields that differ with no edit in between are ones World Anvil moves
    // by itself: they belong in the "not compared" list.
    note(`fields that differ: ${result.differences.map((d) => d.field).join(", ") || "none"}`);
    expect(Array.isArray(result.differences)).toBe(true);
  });

  it("saves a copy on request, then answers 'No backup taken' until forced", async () => {
    const first = await ctx.ok("worldanvil_backup_item", { type: "article", id: ctx.id });
    note(`first request: backup_taken ${first.backup_taken}; ${first.note}`);
    const second = await ctx.ok("worldanvil_backup_item", { type: "article", id: ctx.id });
    note(`second request: ${second.note}`);
    // If this fails, two reads of an untouched article differ: the field that
    // moves is in the comparison above.
    expect(second.backup_taken).toBe(false);
    expect(second.note).toMatch(/^No backup taken\. No change since /);
    const forced = await ctx.ok("worldanvil_backup_item", { type: "article", id: ctx.id, force: true });
    expect(forced.backup_taken).toBe(true);
    note(`forced: ${forced.storing}`);
  });
});

describe.runIf(enabled && stage === "update")("backup look-back: update", () => {
  const ctx = setup("update");
  let version;
  let original;

  it("is not aborted and has the test article", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.id).toBeTruthy();
  });

  it("after an edit, the comparison shows the old text as lost", async () => {
    original = (await ctx.ok("worldanvil_get_article", { article_id: ctx.id })).content ?? "";
    const marker = `Look-back test line ${new Date().toISOString()}`;
    // Make sure there is a line to lose, whatever the article held before.
    await ctx.ok("worldanvil_update_article", { article_id: ctx.id, content: `${marker}\nSecond line to keep` });
    await ctx.ok("worldanvil_update_article", { article_id: ctx.id, content: "Second line to keep\nA new line" });

    const result = await ctx.ok("worldanvil_compare_backup", { type: "article", id: ctx.id });
    version = result.compared_with.version;
    note(`compared with ${result.compared_with.saved}; fields that differ: ${result.differences.map((d) => d.field).join(", ")}`);
    expect(result.compared_with.saved).toBe("before an edit");
    expect(result.text_lost_from).toContain("content");
    expect(result.differences.find((d) => d.field === "content").lost.join("\n")).toContain("Look-back test line");
  });

  it("restore previews first and changes nothing", async () => {
    const preview = await ctx.ok("worldanvil_restore_item", { type: "article", id: ctx.id, version });
    note(`would restore: ${preview.would_restore.map((f) => f.field).join(", ")}`);
    note(`not restored: ${preview.not_restored.map((f) => `${f.field} (${f.why})`).join("; ") || "none"}`);
    expect(preview.confirm_needed).toBe(true);
    expect(preview.would_restore.map((f) => f.field)).toContain("content");
    const now = await ctx.ok("worldanvil_get_article", { article_id: ctx.id });
    expect(now.content).toContain("A new line");
  });

  it("restore with confirm puts the saved text back, and can itself be undone", async () => {
    const result = await ctx.ok("worldanvil_restore_item", { type: "article", id: ctx.id, version, confirm: true });
    note(`restored: ${result.fields_restored.join(", ")}`);
    if (result.warning) note(`WARNING from the tool: ${result.warning}`);
    for (const f of result.fields_not_taken ?? []) note(`not taken by World Anvil: ${f.field}`);
    expect(result.fields_restored).toContain("content");

    const now = await ctx.ok("worldanvil_get_article", { article_id: ctx.id });
    expect(now.content).toContain("Look-back test line");
    expect(now.state).toBe("private");

    const listed = await ctx.ok("worldanvil_list_backups", { world_id: ctx.world, type: "article", id: ctx.id });
    expect(listed.versions[0].saved).toBe("before an edit"); // the state just before the restore
    note(`its own copies after the restore: ${listed.own_copies.storing}`);
    note(`original text was ${original.length} characters; the article now holds the look-back test text`);
  });
});
