/**
 * Copy one category from the test world into a second test world, live.
 *
 *   WA_TEST_STAGE=create WA_TEST_COPY=1 npm run test:live -- test/live/22-copy-articles.live.test.js
 *   WA_TEST_STAGE=update WA_TEST_COPY=1 npm run test:live -- test/live/22-copy-articles.live.test.js
 *
 * Create stage:
 *   1. Makes a second test world ("MCP-TEST-Copy Target"), private. The
 *      harness allows two test worlds; this one has to be deleted by hand
 *      on the site afterwards.
 *   2. Previews a copy of the "MCP-TEST-Stage1" category (with its
 *      sub-category) and checks nothing was changed.
 *   3. Copies it, calling again until only link-finishing is left (that
 *      step changes an article already made, which this stage refuses).
 *   4. Checks the copies: all private, same titles, in matching
 *      categories, reading the same as their originals; and that the
 *      source world was not changed.
 *
 * Update stage (only needed if the create stage left links to finish):
 *   calls the copy again so the links between copied articles are made.
 *
 * The source test world is only read.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";
import { readerBlocks } from "../../src/reader-view.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_COPY === "1";

const TARGET = "MCP-TEST-Copy Target";
const CATEGORY = "MCP-TEST-Stage1";
const SPOT = ["MCP-TEST-Lore Format", "MCP-TEST-S1 Generic"];
const LONG = 10 * 60 * 1000;

function note(msg) {
  console.log(`[copy] ${msg}`);
}

/** Mentions compared by the words they show: the copies have other ids. */
const shownOnly = (t) => String(t ?? "").replace(/@\[([^\]]*)\]\(([A-Za-z_]+):[0-9a-f-]{36}\)/gi, "@[$1]($2)");

function setup(ctx, stageName) {
  beforeAll(async () => {
    ctx.h = await createHarness({ stage: stageName });
    const live = ctx.h.ledger.live();
    ctx.source = ctx.h.testWorldId;
    ctx.categoryId = live.find((e) => e.path === "/category" && e.title === CATEGORY)?.id ?? null;
    ctx.target = live.find((e) => e.path === "/world" && e.title === TARGET)?.id ?? null;
    ctx.ok = async (tool, args) => {
      const res = await ctx.h.call(tool, args);
      expect(ctx.h.aborted, res.text).toBe(false);
      expect(res.isError, `${tool}: ${String(res.text).slice(0, 500)}`).toBeFalsy();
      return res.data;
    };
    ctx.all = async (tool, args) => {
      const items = [];
      for (let offset = 0; ; offset += 50) {
        const page = await ctx.ok(tool, { ...args, limit: 50, offset });
        const got = page?.entities ?? [];
        items.push(...got);
        if (got.length < 50) break;
      }
      return items;
    };
  }, LONG);
}

describe.runIf(enabled && stage === "create")("copy a category into a second test world", () => {
  const ctx = {};
  setup(ctx, "create");
  let preview, sourceBefore, last;

  it("has the source category", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.source).toBeTruthy();
    expect(ctx.categoryId, `"${CATEGORY}" is missing: run the stage 1 create`).toBeTruthy();
  });

  it("makes the second test world, private", async () => {
    if (ctx.target) {
      note("second test world already exists; using it");
    } else {
      const res = await ctx.h.createTestWorld(TARGET);
      expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
      ctx.target = String(res.data.id).toLowerCase();
      note(`create_world said: privacy = ${JSON.stringify(res.data.privacy)}`);
    }
    const w = await ctx.ok("worldanvil_get_world", { world_id: ctx.target });
    note(`second world: state ${w.state}; new articles forced private ${w.articlesPrivateOnCreation}`);
    expect(w.state).toBe("private");
    expect(w.articlesPrivateOnCreation).toBe(true);
    expect(ctx.h.testWorldId).toBe(ctx.source);
  }, LONG);

  it("preview: lists what would be made and changes nothing", async () => {
    sourceBefore = await ctx.all("worldanvil_list_articles", { world_id: ctx.source });
    const targetBefore = await ctx.all("worldanvil_list_articles", { world_id: ctx.target });
    preview = await ctx.ok("worldanvil_copy_articles", {
      source_world_id: ctx.source,
      target_world_id: ctx.target,
      category_id: ctx.categoryId,
    });
    note(`preview: ${preview.would_create.categories.length} categories, ${preview.would_create.articles.length} articles, up to ${preview.would_create.secrets_at_most} secrets`);
    note(`categories: ${preview.would_create.categories.join(" | ")}`);
    note(`already in target: ${JSON.stringify(preview.already_in_target)}`);
    if (preview.problems) note(`problems: ${JSON.stringify(preview.problems)}`);
    expect(preview.status).toBe("preview");
    // The harness only lets test-named items be created.
    for (const a of preview.would_create.articles) expect(a.title).toMatch(/^MCP-TEST-/);
    const targetAfter = await ctx.all("worldanvil_list_articles", { world_id: ctx.target });
    expect(targetAfter.length).toBe(targetBefore.length);
    expect(targetBefore.length).toBe(preview.already_in_target.articles.length);
  }, LONG);

  it("copies, calling again until only link-finishing is left", async () => {
    const totals = { categories: 0, articles: 0, secrets: 0 };
    const hows = {};
    const bad = [];
    for (let call = 1; call <= 15; call++) {
      const started = Date.now();
      last = await ctx.ok("worldanvil_copy_articles", {
        source_world_id: ctx.source,
        target_world_id: ctx.target,
        category_id: ctx.categoryId,
        confirm: true,
      });
      const c = last.created_this_call;
      totals.categories += c.categories.length;
      totals.articles += c.articles.length;
      totals.secrets += c.secrets.length;
      for (const a of c.articles) {
        hows[a.main_text] = (hows[a.main_text] ?? 0) + 1;
        if (!String(a.check).startsWith("stored as sent") || a.privacy !== "private") bad.push(`${a.title}: ${a.check}; ${a.privacy}`);
        if (a.references) note(`  ${a.title}: names other items by id`);
      }
      for (const x of c.secrets) {
        note(`  secret "${x.title}": ${x.privacy}; ${x.attached}; ${x.check}`);
        if (x.check !== "stored as sent" || x.privacy !== "private") bad.push(`secret ${x.title}: ${x.check}; ${x.privacy}`);
      }
      note(
        `call ${call}: ${Math.round((Date.now() - started) / 1000)} s; made ${c.categories.length} categories, ${c.articles.length} articles, ${c.secrets.length} secrets; ` +
          `status ${last.status}; remaining ${JSON.stringify(last.remaining ?? {})}`,
      );
      if (last.problems) note(`  problems: ${JSON.stringify(last.problems)}`);
      const r = last.remaining;
      if (last.done || (r && r.categories === 0 && r.articles === 0 && r.secrets_to_look_at === 0)) break;
    }
    note(`totals: ${JSON.stringify(totals)}; main text: ${JSON.stringify(hows)}`);
    note(`left alone: ${JSON.stringify(last.left_alone)}`);
    expect(bad).toEqual([]);
    const r = last.remaining ?? { categories: 0, articles: 0, secrets_to_look_at: 0, links_to_finish: 0 };
    expect([r.categories, r.articles, r.secrets_to_look_at]).toEqual([0, 0, 0]);
    note(r.links_to_finish ? `LINKS TO FINISH: ${r.links_to_finish} (run the update stage)` : "no links left to finish");
  }, LONG);

  it("the copies are private, complete and in matching categories", async () => {
    const copies = await ctx.all("worldanvil_list_articles", { world_id: ctx.target });
    const states = {};
    for (const a of copies) states[a.state] = (states[a.state] ?? 0) + 1;
    note(`target articles: ${copies.length}; states ${JSON.stringify(states)}`);
    expect(copies.every((a) => a.state === "private")).toBe(true);
    const wanted = [...preview.would_create.articles.map((a) => a.title), ...preview.already_in_target.articles].sort();
    expect(copies.map((a) => a.title).sort()).toEqual(wanted);

    const outline = await ctx.ok("worldanvil_get_world_outline", { world_id: ctx.target });
    const top = outline.categories;
    note(`target outline: ${outline.totals.categories} categories, ${outline.totals.articles} articles, ${outline.totals.uncategorised} uncategorised`);
    for (const c of top) note(`  ${c.title} (state ${c.state}, icon ${c.icon}): ${c.articles.length} articles; under it: ${c.categories.map((x) => `${x.title} (state ${x.state}): ${x.articles.length}`).join(", ") || "none"}`);
    expect(top.map((c) => c.title)).toEqual([CATEGORY]);
    expect(outline.totals.uncategorised).toBe(0);

    const source = await ctx.ok("worldanvil_get_world_outline", { world_id: ctx.source });
    const find = (nodes) => nodes.find((n) => n.title === CATEGORY) ?? nodes.map((n) => find(n.categories)).find(Boolean);
    const original = find(source.categories);
    const shape = (n) => ({ title: n.title, articles: n.articles.map((a) => a.title).sort(), categories: n.categories.map(shape) });
    expect(shape(top[0])).toEqual(shape(original));
  }, LONG);

  it("spot check: copies read the same as their originals", async () => {
    const copies = await ctx.all("worldanvil_list_articles", { world_id: ctx.target });
    for (const title of SPOT) {
      const srcId = sourceBefore.find((a) => a.title === title)?.id;
      const tgtId = copies.find((a) => a.title === title)?.id;
      if (!srcId || !tgtId) {
        note(`spot check skipped for "${title}" (not in this category)`);
        continue;
      }
      const src = await ctx.ok("worldanvil_get_article", { article_id: srcId });
      const copy = await ctx.ok("worldanvil_get_article", { article_id: tgtId });
      const same = JSON.stringify(readerBlocks(shownOnly(src.content))) === JSON.stringify(readerBlocks(shownOnly(copy.content)));
      note(`"${title}": reads the same ${same}; identical text ${src.content === copy.content}; template ${copy.templateType}; icon same ${src.icon === copy.icon}; author notes ${src.authornotes ? (src.authornotes === copy.authornotes ? "identical" : "differ (links?)") : "none"}`);
      expect(copy.title).toBe(src.title);
      expect(copy.templateType).toBe(src.templateType);
      expect(copy.state).toBe("private");
      expect(String(copy.world?.id).toLowerCase()).toBe(String(ctx.target).toLowerCase());
    }
  }, LONG);

  it("the source world was not changed", async () => {
    const after = await ctx.all("worldanvil_list_articles", { world_id: ctx.source });
    const stamp = (list) => list.map((a) => `${a.id}:${a.title}:${a.state}:${JSON.stringify(a.updateDate)}`).sort();
    expect(stamp(after)).toEqual(stamp(sourceBefore));
    note(`source: ${after.length} articles, none changed`);
  }, LONG);
});

describe.runIf(enabled && stage === "update")("finish the links between copied articles", () => {
  const ctx = {};
  setup(ctx, "update");

  it("calls the copy again until it says done", async () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.target, `"${TARGET}" is missing: run the create stage`).toBeTruthy();
    let last;
    for (let call = 1; call <= 10; call++) {
      last = await ctx.ok("worldanvil_copy_articles", {
        source_world_id: ctx.source,
        target_world_id: ctx.target,
        category_id: ctx.categoryId,
        confirm: true,
      });
      note(`call ${call}: status ${last.status}; links finished ${JSON.stringify(last.created_this_call.links_finished ?? [])}`);
      if (last.problems) note(`  problems: ${JSON.stringify(last.problems)}`);
      if (last.done) break;
    }
    expect(last.done).toBe(true);
    expect(last.created_this_call.articles).toEqual([]);
    expect(last.problems).toBeUndefined();
  }, LONG);

  it("the linked copy now reads the same as its original, with its links pointing into the new world", async () => {
    const title = SPOT[0];
    const find = async (world) => (await ctx.all("worldanvil_list_articles", { world_id: world })).find((a) => a.title === title)?.id;
    const src = await ctx.ok("worldanvil_get_article", { article_id: await find(ctx.source) });
    const copy = await ctx.ok("worldanvil_get_article", { article_id: await find(ctx.target) });
    const same = (a, b) => JSON.stringify(readerBlocks(shownOnly(a))) === JSON.stringify(readerBlocks(shownOnly(b)));
    const ids = (t) => [...String(t ?? "").matchAll(/@\[[^\]]*\]\([A-Za-z_]+:([0-9a-f-]{36})\)/gi)].map((m) => m[1].toLowerCase());
    const copyIds = [...ids(copy.content), ...ids(copy.authornotes)];
    const srcIds = [...ids(src.content), ...ids(src.authornotes)];
    note(`"${title}": main text reads the same ${same(src.content, copy.content)}; author notes read the same ${same(src.authornotes, copy.authornotes)}; mentions ${srcIds.length} in the original, ${copyIds.length} in the copy`);
    expect(same(src.content, copy.content)).toBe(true);
    expect(same(src.authornotes, copy.authornotes)).toBe(true);
    expect(copyIds.length).toBe(srcIds.length);
    // None of the copy's mentions points back at the source world's articles.
    expect(copyIds.filter((id) => srcIds.includes(id))).toEqual([]);
    expect(copy.state).toBe("private");
  }, LONG);
});
