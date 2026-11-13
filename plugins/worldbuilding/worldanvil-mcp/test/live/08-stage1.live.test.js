/**
 * Stage 1 live check: article templates, variants, icons, privacy, listing
 * and the world outline, all through the real tools.
 *
 *   WA_TEST_STAGE=create WA_TEST_STAGE1=1 npm run test:live -- test/live/08-stage1.live.test.js
 *   WA_TEST_STAGE=read   WA_TEST_STAGE1=1 npm run test:live -- test/live/08-stage1.live.test.js
 *   WA_TEST_STAGE=update WA_TEST_STAGE1=1 npm run test:live -- test/live/08-stage1.live.test.js
 *
 * One run per stage, in that order (create first: it takes the test world
 * past 50 articles, which the read stage needs to check paging properly).
 *
 *   create  A category, then one article per tile on the site's new-article
 *           screen (30), each read back: template, variant, icon, private.
 *           One more with a chosen icon.
 *   read    Listing: whole world, one category, uncategorised; walking the
 *           pages; the world outline, and that it agrees with the walk.
 *   update  Set an icon, reset it; switch an Organization to a variant;
 *           a change of template is refused; category icon set and reset.
 *
 * Everything is titled MCP-TEST-, recorded in the ledger and left for the
 * delete stage. A re-run reuses what is already there. Nothing is made
 * public. Unlike the probes, these are assertions: the tools must behave.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";
import { TEMPLATES, variantOf } from "../../src/article-templates.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_STAGE1 === "1";

const CATEGORY = "MCP-TEST-Stage1";
const titleFor = (siteName) => `MCP-TEST-S1 ${siteName.replace(/[^A-Za-z]+/g, " ").trim()}`;
const CUSTOM = "MCP-TEST-S1 Custom Icon";
const SUB_CATEGORY = "MCP-TEST-Stage1 Sub";
const NESTED = "MCP-TEST-S1 Nested Article";

function note(msg) {
  console.log(`[stage1] ${msg}`);
}

function setup(stageName) {
  const ctx = { h: null, world: null };
  ctx.find = (path, title) =>
    ctx.h.ledger.live().find((e) => e.path === path && e.title === title)?.id ?? null;
  ctx.ok = async (tool, args) => {
    const res = await ctx.h.call(tool, args);
    expect(ctx.h.aborted, res.text).toBe(false);
    expect(res.isError, `${tool}: ${String(res.text).slice(0, 300)}`).toBeFalsy();
    return res.data;
  };
  ctx.article = (id) => ctx.ok("worldanvil_get_article", { article_id: id });
  beforeAll(async () => {
    ctx.h = await createHarness({ stage: stageName });
    ctx.world = ctx.h.testWorldId;
  });
  return ctx;
}

// ---------------------------------------------------------------- create --

describe.runIf(enabled && stage === "create")("stage 1: create", () => {
  const ctx = setup("create");
  let category;

  it("is not aborted and has the test world", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.world, "run the create stage (01) first").toBeTruthy();
  });

  it("a new category gets the site's folder icon", async () => {
    category = ctx.find("/category", CATEGORY);
    if (!category) {
      const made = await ctx.ok("worldanvil_create_category", { title: CATEGORY, world_id: ctx.world });
      category = String(made.id);
    }
    const read = await ctx.ok("worldanvil_get_category", { category_id: category });
    note(`category icon: ${JSON.stringify(read.icon)}`);
    expect(read.icon).toBe("fas fa-folder");
  });

  for (const t of TEMPLATES)
    it(`${t.siteName}: created as ${t.templateType}${t.variant ? ` + ${t.variant}` : ""}, icon ${t.icon}, private`, async () => {
      const title = titleFor(t.siteName);
      let id = ctx.find("/article", title);
      if (!id) {
        const made = await ctx.ok("worldanvil_create_article", {
          title,
          world_id: ctx.world,
          template: t.siteName,
          category_id: category,
        });
        id = String(made.id);
        if (t === TEMPLATES[0])
          note(`create answer includes state: ${"state" in made && made.state !== undefined}; privacy: ${made.privacy}`);
        expect(made.privacy, made.privacy).toMatch(/^private/);
        expect(made.template).toBe(t.siteName);
      }
      const read = await ctx.article(id);
      note(
        `${t.siteName}: templateType=${read.templateType} variant=${variantOf(read.articleMetadata)} ` +
          `icon=${JSON.stringify(read.icon)} state=${read.state}`,
      );
      expect(read.templateType).toBe(t.templateType);
      expect(variantOf(read.articleMetadata)).toBe(t.variant);
      expect(read.icon).toBe(t.icon);
      expect(read.state).toBe("private");
      expect(String(read.category?.id).toLowerCase()).toBe(String(category).toLowerCase());
    });

  it("a chosen icon is stored as the site's picker stores it", async () => {
    let id = ctx.find("/article", CUSTOM);
    if (!id) {
      const made = await ctx.ok("worldanvil_create_article", {
        title: CUSTOM,
        world_id: ctx.world,
        template: "Myth",
        icon: "duotone dragon",
        category_id: category,
      });
      id = String(made.id);
    }
    expect((await ctx.article(id)).icon).toBe("fa-duotone fa-dragon");
  });

  it("a category inside the category, with an article in it", async () => {
    let sub = ctx.find("/category", SUB_CATEGORY);
    if (!sub) {
      const made = await ctx.ok("worldanvil_create_category", {
        title: SUB_CATEGORY,
        world_id: ctx.world,
        parent_category_id: category,
      });
      sub = String(made.id);
    }
    const read = await ctx.ok("worldanvil_get_category", { category_id: sub });
    note(`sub-category: parent=${read.parent?.title} icon=${JSON.stringify(read.icon)}`);
    expect(String(read.parent?.id).toLowerCase()).toBe(String(category).toLowerCase());
    expect(read.icon).toBe("fas fa-folder");

    if (!ctx.find("/article", NESTED))
      await ctx.ok("worldanvil_create_article", {
        title: NESTED,
        world_id: ctx.world,
        template: "Settlement",
        category_id: sub,
      });
  });

  it("an unknown template is refused without creating anything", async () => {
    const before = ctx.h.ledger.live().length;
    const res = await ctx.h.call("worldanvil_create_article", {
      title: "MCP-TEST-S1 Should Not Exist",
      world_id: ctx.world,
      template: "kingdom",
    });
    expect(res.isError).toBe(true);
    expect(String(res.text)).toMatch(/not an article template/);
    expect(ctx.h.ledger.live().length).toBe(before);
  });
});

// ------------------------------------------------------------------ read --

describe.runIf(enabled && stage === "read")("stage 1: read", () => {
  const ctx = setup("read");
  let walked = [];

  it("is not aborted and has the stage 1 category", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.find("/category", CATEGORY), "run the stage 1 create half first").toBeTruthy();
  });

  it("list_articles returns the whole world by default and says if there is more", async () => {
    const first = await ctx.ok("worldanvil_list_articles", { world_id: ctx.world });
    note(`default list: ${JSON.stringify(first.paging)}`);
    expect(first.entities.length).toBeLessThanOrEqual(50);
    expect(first.entities.some((e) => /^MCP-TEST-S1 /.test(e.title))).toBe(true); // categorised ones are there
  });

  it("walking the pages reaches every article exactly once", async () => {
    const seen = new Set();
    let offset = 0;
    for (let guard = 0; guard < 40; guard++) {
      const page = await ctx.ok("worldanvil_list_articles", { world_id: ctx.world, limit: 20, offset });
      for (const e of page.entities) {
        expect(seen.has(e.id), `repeated across pages: ${e.title}`).toBe(false);
        seen.add(e.id);
        walked.push(e);
      }
      note(`page at ${offset}: ${JSON.stringify(page.paging)}`);
      if (!page.paging.more) break;
      expect(page.paging.next_offset).toBe(offset + page.entities.length);
      offset = page.paging.next_offset;
    }
    note(`walk found ${walked.length} articles`);
    expect(walked.length).toBeGreaterThan(50);
  });

  it("the default page of 50 reports more, and the next page continues from it", async () => {
    const first = await ctx.ok("worldanvil_list_articles", { world_id: ctx.world });
    expect(first.entities).toHaveLength(50);
    expect(first.paging).toMatchObject({ more: true, next_offset: 50 });
    const second = await ctx.ok("worldanvil_list_articles", { world_id: ctx.world, offset: 50 });
    expect(first.entities.length + second.entities.length).toBe(walked.length);
    expect(second.paging.more).toBe(false);
    const firstIds = new Set(first.entities.map((e) => e.id));
    expect(second.entities.some((e) => firstIds.has(e.id))).toBe(false);
  });

  it("lists one category, and the uncategorised ones, separately", async () => {
    const category = ctx.find("/category", CATEGORY);
    const inCategory = await ctx.ok("worldanvil_list_articles", { world_id: ctx.world, category_id: category });
    note(`in ${CATEGORY}: ${inCategory.entities.length}`);
    expect(inCategory.entities.length).toBeGreaterThanOrEqual(TEMPLATES.length);
    expect(inCategory.entities.every((e) => /^MCP-TEST-S1 /.test(e.title))).toBe(true);
    // A category's list is its own articles only, not those of categories inside it.
    note(`parent category's list includes the nested article: ${inCategory.entities.some((e) => e.title === NESTED)}`);

    const loose = await ctx.ok("worldanvil_list_articles", { world_id: ctx.world, category_id: "uncategorised" });
    note(`uncategorised: ${loose.entities.length}`);
    expect(loose.entities.some((e) => /^MCP-TEST-S1 /.test(e.title))).toBe(false);
  });

  it("list_categories reports paging too", async () => {
    const page = await ctx.ok("worldanvil_list_categories", { world_id: ctx.world });
    note(`categories: ${JSON.stringify(page.paging)}`);
    expect(page.paging.more).toBe(false);
    expect(page.entities.some((c) => c.title === CATEGORY)).toBe(true);
  });

  it("the world outline nests everything and agrees with the walk", async () => {
    const started = Date.now();
    const outline = await ctx.ok("worldanvil_get_world_outline", { world_id: ctx.world });
    note(`outline took ${Math.round((Date.now() - started) / 100) / 10}s; totals ${JSON.stringify(outline.totals)}`);

    const flat = [];
    const collect = (cats, depth) => {
      for (const c of cats) {
        note(`${"  ".repeat(depth)}[${c.title}] icon=${JSON.stringify(c.icon)} articles=${c.articles.length} sub=${c.categories.length}`);
        flat.push(...c.articles);
        collect(c.categories, depth + 1);
      }
    };
    collect(outline.categories, 0);
    flat.push(...outline.uncategorised);

    expect(outline.totals.articles).toBe(walked.length);
    expect(new Set(flat.map((a) => a.id)).size).toBe(flat.length); // each article filed once
    expect(flat.length).toBe(walked.length);

    const find = (cats, title) => {
      for (const c of cats) {
        if (c.title === title) return c;
        const below = find(c.categories, title);
        if (below) return below;
      }
      return null;
    };
    const stage1 = find(outline.categories, CATEGORY);
    expect(stage1).toBeTruthy();
    const character = stage1.articles.find((a) => a.title === titleFor("Character"));
    note(`outline line for a Character: ${JSON.stringify(character)}`);
    expect(character).toMatchObject({ template: "Character", icon: "fa-person", state: "private" });

    // Nesting: the sub-category sits inside its parent, not at the top.
    expect(outline.categories.some((c) => c.title === SUB_CATEGORY)).toBe(false);
    const sub = stage1.categories.find((c) => c.title === SUB_CATEGORY);
    expect(sub, "sub-category should be nested under its parent").toBeTruthy();
    expect(sub.articles.map((a) => a.title)).toEqual([NESTED]);
    expect(sub.articles[0]).toMatchObject({ template: "Settlement", icon: "fa-building-columns" });
    expect(stage1.articles.some((a) => a.title === NESTED)).toBe(false);
  });
});

// ---------------------------------------------------------------- update --

describe.runIf(enabled && stage === "update")("stage 1: update", () => {
  const ctx = setup("update");
  const idOf = (siteName) => ctx.find("/article", titleFor(siteName));

  it("is not aborted and has the stage 1 articles", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(idOf("Character"), "run the stage 1 create half first").toBeTruthy();
  });

  it("sets a chosen icon, then resets it to the template's own", async () => {
    const id = idOf("Character");
    await ctx.ok("worldanvil_update_article", { article_id: id, icon: "fa-crown" });
    expect((await ctx.article(id)).icon).toBe("fa-solid fa-crown");
    await ctx.ok("worldanvil_update_article", { article_id: id, icon: "default" });
    expect((await ctx.article(id)).icon).toBe("fa-person");
  });

  it("resets a variant to the variant's icon", async () => {
    const id = idOf("Religion");
    await ctx.ok("worldanvil_update_article", { article_id: id, icon: "duotone dragon" });
    expect((await ctx.article(id)).icon).toBe("fa-duotone fa-dragon");
    await ctx.ok("worldanvil_update_article", { article_id: id, icon: "default" });
    expect((await ctx.article(id)).icon).toBe("fa-ankh");
  });

  it("refuses to turn a Vehicle into a Military (a different template)", async () => {
    const refused = await ctx.h.call("worldanvil_update_article", { article_id: idOf("Vehicle"), template: "Military" });
    expect(refused.isError).toBe(true);
    expect(String(refused.text)).toMatch(/This article is a Vehicle/);
    const vehicle = await ctx.article(idOf("Vehicle"));
    expect(vehicle.templateType).toBe("vehicle");
    expect(variantOf(vehicle.articleMetadata)).toBeNull();
  });

  it("switches an Organization to Military, moving its icon with it", async () => {
    const id = idOf("Organization");
    const before = await ctx.article(id);
    note(`before: variant=${variantOf(before.articleMetadata)} icon=${JSON.stringify(before.icon)}`);
    await ctx.ok("worldanvil_update_article", { article_id: id, template: "Military" });
    const after = await ctx.article(id);
    note(`after: variant=${variantOf(after.articleMetadata)} icon=${JSON.stringify(after.icon)}`);
    expect(after.templateType).toBe("organization");
    expect(variantOf(after.articleMetadata)).toBe("military");
    expect(after.icon).toBe("fa-flag-swallowtail");
    expect(after.state).toBe("private");
  });

  it("sets and resets a category's icon", async () => {
    const id = ctx.find("/category", CATEGORY);
    await ctx.ok("worldanvil_update_category", { category_id: id, icon: "fa-users" });
    expect((await ctx.ok("worldanvil_get_category", { category_id: id })).icon).toBe("fa-solid fa-users");
    await ctx.ok("worldanvil_update_category", { category_id: id, icon: "default" });
    expect((await ctx.ok("worldanvil_get_category", { category_id: id })).icon).toBe("fas fa-folder");
  });
});
