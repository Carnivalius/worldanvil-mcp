/**
 * Stage 0 probes: four questions the redesign depends on.
 *
 *   WA_TEST_STAGE=read   WA_TEST_STAGE0=1 npm run test:live -- test/live/07-stage0-probes.live.test.js
 *   WA_TEST_STAGE=create WA_TEST_STAGE0=1 npm run test:live -- test/live/07-stage0-probes.live.test.js
 *   WA_TEST_STAGE=update WA_TEST_STAGE0=1 npm run test:live -- test/live/07-stage0-probes.live.test.js
 *
 * One run per stage, in that order.
 *
 *   read    1. How can articles be listed by category and across a world,
 *              and how does paging behave?
 *           2. What privacy state do existing tool-made and site-made
 *              articles have, and what does a private world look like?
 *   create  3. Does a manuscript that has never been opened on the site
 *              already have a root part?
 *           4. Can an article be created private?
 *   update  5. Does sending a list of links (related characters, tags)
 *              replace the existing ones or add to them? Can a list be
 *              emptied?
 *           6. Can an existing article be made private?
 *
 * Needs stage 2, the discovery read-back and the write probe first. Fields
 * the tools don't take yet are sent with the harness's guarded client, as
 * in 06-probe: the access guard and the harness policy both still apply.
 * Nothing is asserted about World Anvil's answers; each is logged as a
 * [stage0] line. Nothing is ever made public by these probes.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_STAGE0 === "1";

const T = {
  world2: "MCP-TEST-World 2",
  untouched: "MCP-TEST-Manuscript Untouched",
  private: "MCP-TEST-Probe Private",
  stateDefault: "MCP-TEST-Probe State Default",
  scene: "MCP-TEST-Probe Scene",
};

const VISIBILITY = /public|private|visib|publish|state|draft|wip|locked/i;

function note(msg) {
  console.log(`[stage0] ${msg}`);
}

function setup() {
  const ctx = { h: null };
  ctx.find = (path, title) =>
    ctx.h.ledger.live().find((e) => e.path === path && e.title === title)?.id ?? null;
  ctx.first = (path) => ctx.h.ledger.live().find((e) => e.path === path)?.id ?? null;
  ctx.read = async (tool, arg, id) => {
    const res = await ctx.h.call(tool, { [arg]: id });
    if (res.isError) note(`${tool} failed: ${String(res.text).slice(0, 200)}`);
    return res.isError ? null : res.data;
  };
  /** Run one request; never throws. */
  ctx.attempt = async (label, fn) => {
    try {
      return (await fn()) ?? {};
    } catch (err) {
      note(`${label}: REFUSED/ERROR ${String(err.message ?? err).slice(0, 220)}`);
      return null;
    }
  };
  ctx.fields = (obj, re = VISIBILITY) =>
    Object.entries(obj ?? {})
      .filter(([k, v]) => re.test(k) && (v === null || typeof v !== "object"))
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ") || "(none)";
  return ctx;
}

const ids = (list) => (list ?? []).map((x) => String(x.id).toLowerCase());
const titles = (list) => (list ?? []).map((x) => x.title);

// ------------------------------------------------------------------ read --

describe.runIf(enabled && stage === "read")("stage 0 probes: read", () => {
  const ctx = setup();
  let world, category;

  beforeAll(async () => {
    ctx.h = await createHarness({ stage: "read" });
    world = ctx.h.testWorldId;
    category = ctx.find("/category", "MCP-TEST-Category");
  });

  it("has the test world and category", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(world).toBeTruthy();
    expect(category).toBeTruthy();
  });

  it("1. listing articles: by category, without a category, and paging", async () => {
    const list = (label, body) =>
      ctx.attempt(label, () => ctx.h.client.request(`/world/articles?id=${world}`, "POST", body));
    const show = (label, res) => {
      if (!res) return;
      const extra = Object.keys(res).filter((k) => k !== "entities");
      note(`${label}: ${res.entities?.length ?? "no"} entities; other response fields: ${extra.join(", ") || "(none)"}`);
    };

    const uncategorised = await list("category -1", { limit: "50", offset: "0", category: { id: "-1" } });
    show("category -1 (what the tool sends today)", uncategorised);

    const inCategory = await list("category id", { limit: "50", offset: "0", category: { id: category } });
    show("category = MCP-TEST-Category", inCategory);

    const noCategory = await list("no category", { limit: "50", offset: "0" });
    show("no category field at all", noCategory);
    if (noCategory?.entities)
      note(
        `no category field: includes categorised articles: ${noCategory.entities.some((e) => /^MCP-TEST-Template/.test(e.title))}, ` +
          `includes uncategorised: ${noCategory.entities.some((e) => /^MCP-Test-/.test(e.title))}`,
      );
    if (inCategory?.entities?.[0])
      note(`list record fields: ${Object.keys(inCategory.entities[0]).sort().join(", ")}`);

    // Paging: two pages of 10 must not overlap; and is there a ceiling on limit?
    const page1 = await list("page 1", { limit: "10", offset: "0", category: { id: category } });
    const page2 = await list("page 2", { limit: "10", offset: "10", category: { id: category } });
    if (page1?.entities && page2?.entities) {
      const overlap = ids(page1.entities).filter((id) => ids(page2.entities).includes(id)).length;
      note(`paging: page 1 has ${page1.entities.length}, page 2 has ${page2.entities.length}, overlap ${overlap}`);
    }
    const big = await list("limit 100", { limit: "100", offset: "0", category: { id: category } });
    show("limit 100 in MCP-TEST-Category", big);
    const past = await list("offset past the end", { limit: "10", offset: "500", category: { id: category } });
    show("offset 500 (past the end)", past);

    // Is there a per-category list endpoint?
    const perCategory = await ctx.attempt("/category/articles", () =>
      ctx.h.client.request(`/category/articles?id=${category}`, "POST", { limit: "50", offset: "0" }),
    );
    show("/category/articles endpoint", perCategory);
  });

  it("1b. categories: what a list gives for building the tree", async () => {
    const res = await ctx.h.call("worldanvil_list_categories", { world_id: world, limit: 50 });
    if (res.isError) return note(`list_categories failed: ${String(res.text).slice(0, 200)}`);
    const list = res.data?.entities ?? [];
    note(`categories listed: ${list.length}: ${titles(list).join(" | ")}`);
    if (list[0]) note(`category list record fields: ${Object.keys(list[0]).sort().join(", ")}`);
    const full = await ctx.read("worldanvil_get_category", "category_id", category);
    if (full)
      note(
        `category full read: parent=${JSON.stringify(full.parent?.id ?? null)}, ` +
          `has articles list: ${Array.isArray(full.articles)} (${full.articles?.length ?? 0}), ` +
          `has children list: ${Array.isArray(full.children)} (${full.children?.length ?? 0}); ` +
          `fields: ${Object.keys(full).sort().join(", ")}`,
      );
  });

  it("2. privacy as it stands: articles and the world", async () => {
    for (const title of ["MCP-TEST-Article", "MCP-TEST-Template Person", "MCP-TEST-Probe Icon Custom", "MCP-Test-Character"]) {
      const id = ctx.find("/article", title);
      if (!id) { note(`${title}: not in the ledger`); continue; }
      const a = await ctx.read("worldanvil_get_article", "article_id", id);
      note(`article ${JSON.stringify(title)}: ${ctx.fields(a)}`);
    }
    const w = await ctx.read("worldanvil_get_world", "world_id", world);
    note(`world (set private by hand on the site): ${ctx.fields(w)}`);
  });
});

// ---------------------------------------------------------------- create --

describe.runIf(enabled && stage === "create")("stage 0 probes: create", () => {
  const ctx = setup();
  let world, category;

  beforeAll(async () => {
    ctx.h = await createHarness({ stage: "create" });
    world = ctx.h.testWorldId;
    category = ctx.find("/category", "MCP-TEST-Category");
  });

  it("has the test world", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(world).toBeTruthy();
  });

  it("0. a new world is private from the moment it is created", async () => {
    // create_world now asks for a private world in the create request.
    // Makes a second test world (the harness allows two); it has to be
    // deleted by hand on the site afterwards.
    let second = ctx.find("/world", T.world2);
    if (second) {
      note("second test world already exists; reading it");
    } else {
      const res = await ctx.h.createTestWorld(T.world2);
      if (res.isError) return note(`create world failed: ${String(res.text).slice(0, 220)}`);
      second = String(res.data.id).toLowerCase();
      note(`create_world said: privacy = ${JSON.stringify(res.data.privacy)}`);
    }
    const w = await ctx.read("worldanvil_get_world", "world_id", second);
    note(`new world as stored: ${ctx.fields(w)}`);
    note(`NEW WORLD IS PRIVATE: ${w?.state === "private" && w?.articlesPrivateOnCreation === true}`);
    expect(ctx.h.testWorldId).toBe(world); // the original stays the working test world
  });

  it("3. a manuscript never opened on the site: does it have a root part?", async () => {
    let manuscript = ctx.find("/manuscript", T.untouched);
    if (!manuscript) {
      const res = await ctx.h.call("worldanvil_create_manuscript", { title: T.untouched, world_id: world });
      if (res.isError) return note(`create manuscript failed: ${String(res.text).slice(0, 200)}`);
      manuscript = String(res.data.id).toLowerCase();
    } else {
      note("untouched manuscript already exists; if it has been opened on the site this answer is void");
    }
    const versions = await ctx.h.call("worldanvil_list_manuscriptversions", { manuscript_id: manuscript });
    const v = versions.data?.entities?.[0];
    if (!v) return note("no version listed for the new manuscript");
    const version = String(v.id).toLowerCase();
    const full = ctx.h.ledger.ids().has(version)
      ? await ctx.read("worldanvil_get_manuscriptversion", "version_id", version)
      : await ctx.attempt("adopt version", () => ctx.h.adopt(version, "/manuscript_version", manuscript));
    const parts = full?.parts ?? [];
    note(`untouched manuscript: version ${JSON.stringify(full?.title ?? null)} has ${parts.length} part(s): ${titles(parts).join(" | ") || "(none)"}`);
    for (const p of parts) {
      const id = String(p.id).toLowerCase();
      const part = ctx.h.ledger.ids().has(id)
        ? await ctx.read("worldanvil_get_manuscriptpart", "part_id", id)
        : await ctx.attempt("adopt part", () => ctx.h.adopt(id, "/manuscript_part", version));
      note(`  part ${JSON.stringify(part?.title ?? p.title)}: type=${JSON.stringify(part?.type ?? null)}, parent=${JSON.stringify(part?.parent?.title ?? null)}`);
    }
    note(`ROOT PART PRESENT WITHOUT OPENING ON THE SITE: ${parts.length > 0}`);
  });

  it("4. creating an article private, and what the default is", async () => {
    for (const [title, extra] of [
      [T.stateDefault, {}],
      [T.private, { state: "private" }],
    ]) {
      if (ctx.find("/article", title)) continue;
      const res = await ctx.attempt(`create ${title}`, () =>
        ctx.h.client.createArticle({
          title,
          world: { id: world },
          templateType: "article",
          ...(category ? { category: { id: category } } : {}),
          ...extra,
        }),
      );
      if (!res) continue;
      const got = await ctx.read("worldanvil_get_article", "article_id", String(res.id));
      note(`created ${JSON.stringify(title)} sending ${JSON.stringify(extra)}: ${ctx.fields(got)}`);
    }
  });
});

// ---------------------------------------------------------------- update --

describe.runIf(enabled && stage === "update")("stage 0 probes: update", () => {
  const ctx = setup();
  let scene, character, person1, tag;

  beforeAll(async () => {
    ctx.h = await createHarness({ stage: "update" });
    scene = ctx.find("/manuscript_part", T.scene);
    character = ctx.find("/article", "MCP-Test-Character");
    person1 = ctx.find("/article", "Person 1");
    tag = ctx.first("/manuscript_tag");
  });

  it("has the probe scene", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(scene, "run the write probe (06) first").toBeTruthy();
  });

  it("5. link lists: replace or add, and can they be emptied?", async () => {
    const readScene = () => ctx.read("worldanvil_get_manuscriptpart", "part_id", scene);
    const patch = (label, body) =>
      ctx.attempt(label, () => ctx.h.client.updateManuscriptPart(scene, body));

    if (character && person1) {
      await patch("set to A", { relatedCharacters: [{ id: character }] });
      await patch("then send B only", { relatedCharacters: [{ id: person1 }] });
      const after = await readScene();
      const got = ids(after?.relatedCharacters);
      const verdict =
        got.includes(person1) && got.includes(character) ? "ADDS (both present)"
        : got.includes(person1) ? "REPLACES (only the new one)"
        : `UNEXPECTED (${got.length} present)`;
      note(`relatedCharacters: sending a new list ${verdict}`);

      await patch("send empty list", { relatedCharacters: [] });
      const cleared = await readScene();
      note(`relatedCharacters: sending [] leaves ${ids(cleared?.relatedCharacters).length} link(s)`);
      await patch("restore", { relatedCharacters: [{ id: character }] });
    } else note("skipping related characters: need both test characters in the ledger");

    if (tag) {
      await patch("empty tags", { tags: [] });
      const cleared = await readScene();
      const left = Array.isArray(cleared?.tags) ? cleared.tags.length : 0;
      note(`tags: sending [] leaves ${left} tag(s)`);
      await patch("restore tag", { tags: [{ id: tag }] });
      const restored = await readScene();
      note(`tags: restored to ${Array.isArray(restored?.tags) ? restored.tags.length : 0} tag(s)`);
    }

    // A single link: can it be cleared?
    await patch("clear POV", { povCharacter: null });
    const noPov = await readScene();
    note(`povCharacter: sending null leaves ${JSON.stringify(noPov?.povCharacter?.title ?? null)}`);
    if (character) await patch("restore POV", { povCharacter: { id: character } });
  });

  it("6. making an existing article private", async () => {
    const id = ctx.find("/article", T.stateDefault);
    if (!id) return note("run the create half first");
    const before = await ctx.read("worldanvil_get_article", "article_id", id);
    note(`before: ${ctx.fields(before)}`);
    const res = await ctx.attempt("set state private", () => ctx.h.client.updateArticle(id, { state: "private" }));
    if (!res) return;
    const after = await ctx.read("worldanvil_get_article", "article_id", id);
    note(`after sending state=private: ${ctx.fields(after)}`);
  });

  // Test 6 could not answer the question: its article was already private.
  // This one was made while the world was public, so it still reads public.
  it("7. making a PUBLIC article private", async () => {
    const id = ctx.find("/article", "MCP-TEST-Article");
    if (!id) return note("no MCP-TEST-Article in the ledger");
    const before = await ctx.read("worldanvil_get_article", "article_id", id);
    note(`public article before: ${ctx.fields(before)}`);
    if (before?.state !== "public") return note("it is not public, so this proves nothing");
    const res = await ctx.attempt("set state private", () => ctx.h.client.updateArticle(id, { state: "private" }));
    if (!res) return;
    const after = await ctx.read("worldanvil_get_article", "article_id", id);
    note(`public article after sending state=private: ${ctx.fields(after)}`);
    note(`PUBLIC ARTICLE MADE PRIVATE: ${after?.state === "private"}`);
  });
});
