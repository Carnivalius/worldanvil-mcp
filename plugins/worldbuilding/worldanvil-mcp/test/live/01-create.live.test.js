/**
 * Stage 2 (create): a test world and a few MCP-TEST- items inside it.
 *
 *   WA_TEST_STAGE=create npm run test:live -- test/live/01-create.live.test.js
 *
 * Creates and reads only; nothing is edited or deleted. Everything made here
 * is recorded in the ledger and left in place, for review in the web UI and
 * for the later update and delete stages. A re-run reuses the test world
 * and any items already in the ledger instead of making duplicates.
 *
 * How World Anvil stored things (visibility, BBCode, links) is logged as
 * [stage2] lines rather than asserted, so one surprise there doesn't stop
 * the rest of the run (the live config bails on the first failure).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;

const TITLES = {
  world: "MCP-TEST-World",
  category: "MCP-TEST-Category",
  article: "MCP-TEST-Article",
  manuscript: "MCP-TEST-Manuscript",
  version: "MCP-TEST-Draft",
  part: "MCP-TEST-Chapter 1",
};

const VISIBILITY_FIELDS = /public|private|visib|publish|state|draft|locked/i;

function note(msg) {
  console.log(`[stage2] ${msg}`);
}

/** "key=value" for scalar fields whose names match `re`. */
function describeFields(obj, re) {
  const found = Object.entries(obj ?? {})
    .filter(([k, v]) => re.test(k) && (v === null || typeof v !== "object"))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return found.join(", ") || "(none found)";
}

describe.runIf(stage === "create")("stage 2: create (test world only)", () => {
  let h;
  const ids = {};

  async function read(tool, args) {
    const res = await h.call(tool, args);
    expect(res.isError, res.text).toBe(false);
    return res.data;
  }

  async function create(tool, args) {
    const data = await read(tool, args);
    const id = data?.id ?? data?.entity?.id;
    expect(id, "created item has an id").toBeTruthy();
    expect(h.ledger.ids().has(String(id).toLowerCase()), "recorded in the ledger").toBe(true);
    return String(id);
  }

  /** A live ledger item from an earlier run, or a newly created one. */
  async function reuseOrCreate(path, tool, args) {
    const earlier = h.ledger.live().find((e) => e.path === path && e.title === args.title);
    if (earlier) {
      note(`reusing ${path} ${earlier.id} from an earlier run`);
      return earlier.id;
    }
    return create(tool, args);
  }

  beforeAll(async () => {
    h = await createHarness({ stage: "create" });
  });

  it("is not aborted after pre-flight and snapshot", () => {
    expect(h.aborted).toBe(false);
  });

  it("has a test world (made once, reused on re-runs)", async () => {
    if (h.testWorldId) {
      note(`reusing test world ${h.testWorldId}`);
    } else {
      const res = await h.createTestWorld(TITLES.world);
      expect(res.isError, res.text).toBe(false);
      note(`access settings: ${res.data?.access_settings}`);
    }
    ids.world = h.testWorldId;
    expect(ids.world).toBeTruthy();

    const world = await read("worldanvil_get_world", { world_id: ids.world });
    expect(String(world.title)).toMatch(/^MCP-TEST-/);
    note(`world visibility fields: ${describeFields(world, VISIBILITY_FIELDS)}`);
  });

  it("creates a category and reads it back", async () => {
    ids.category = await reuseOrCreate("/category", "worldanvil_create_category", {
      title: TITLES.category,
      world_id: ids.world,
    });
    const category = await read("worldanvil_get_category", { category_id: ids.category });
    expect(category.title).toBe(TITLES.category);
  });

  it("creates an article in the category and reads it back", async () => {
    ids.article = await reuseOrCreate("/article", "worldanvil_create_article", {
      title: TITLES.article,
      world_id: ids.world,
      template: "article",
      category_id: ids.category,
      content: "A **bold** start and an *italic* finish.",
    });
    const article = await read("worldanvil_get_article", { article_id: ids.article });
    expect(article.title).toBe(TITLES.article);
    note(`article content as stored: ${JSON.stringify(article.content)}`);
    note(`article category matches: ${article.category?.id === ids.category}`);
    note(`article visibility fields: ${describeFields(article, VISIBILITY_FIELDS)}`);
  });

  it("refuses a create without the MCP-TEST- prefix, without sending it", async () => {
    const before = h.ledger.ids().size;
    const res = await h.call("worldanvil_create_article", {
      title: "Untitled article",
      world_id: ids.world,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/REFUSED.*MCP-TEST-/);
    expect(h.ledger.ids().size).toBe(before);
    expect(h.aborted).toBe(false);
  });

  it("creates a manuscript and reads it back", async () => {
    ids.manuscript = await reuseOrCreate("/manuscript", "worldanvil_create_manuscript", {
      title: TITLES.manuscript,
      world_id: ids.world,
    });
    const manuscript = await read("worldanvil_get_manuscript", {
      manuscript_id: ids.manuscript,
    });
    expect(manuscript.title).toBe(TITLES.manuscript);
  });

  it("has a manuscript version (adopts World Anvil's default, or makes one)", async () => {
    const earlier = h.ledger
      .live()
      .find((e) => e.path === "/manuscript_version" && e.parentIds.includes(ids.manuscript.toLowerCase()));
    const list = earlier
      ? null
      : await read("worldanvil_list_manuscriptversions", { manuscript_id: ids.manuscript });
    const existing = list?.entities ?? [];
    if (earlier) {
      ids.version = earlier.id;
      note(`reusing /manuscript_version ${earlier.id} from an earlier run`);
    } else if (existing.length) {
      note(`versions World Anvil made with the manuscript: ${existing.length}`);
      ids.version = String(existing[0].id);
      await h.adopt(ids.version, "/manuscript_version", ids.manuscript);
      note(`adopted default version ${JSON.stringify(existing[0].title ?? null)}`);
    } else {
      note("World Anvil made no version with the manuscript");
      ids.version = await create("worldanvil_create_manuscriptversion", {
        title: TITLES.version,
        manuscript_id: ids.manuscript,
      });
    }
    const version = await read("worldanvil_get_manuscriptversion", { version_id: ids.version });
    expect(String(version.id).toLowerCase()).toBe(ids.version.toLowerCase());
  });

  it("creates a chapter in the version and reads it back", async () => {
    // The handover suspects this needs `version` + `type` rather than
    // `manuscriptVersion`; if so, World Anvil's error shows up here.
    ids.part = await reuseOrCreate("/manuscript_part", "worldanvil_create_manuscriptpart", {
      title: TITLES.part,
      version_id: ids.version,
      content: "The first line of **chapter one**.",
    });
    const part = await read("worldanvil_get_manuscriptpart", { part_id: ids.part });
    expect(part.title).toBe(TITLES.part);
    note(`chapter content as stored: ${JSON.stringify(part.content)}`);
    note(`chapter fields: ${Object.keys(part).sort().join(", ")}`);
  });
});
