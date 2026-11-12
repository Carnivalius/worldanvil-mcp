/**
 * Write probe: can the API write what the site's editor writes?
 *
 *   WA_TEST_STAGE=create WA_TEST_PROBE=1 npm run test:live -- test/live/06-probe.live.test.js
 *   WA_TEST_STAGE=update WA_TEST_PROBE=1 npm run test:live -- test/live/06-probe.live.test.js
 *
 * Two runs, one stage each. The create run makes a chapter (folder part), a
 * scene (text part) inside it and three articles. The update run then edits
 * only those probe items, one field at a time. Needs stage 2 and the
 * discovery read-back first (the root part, a label, a tag and a character
 * must already be in the ledger).
 *
 * Most of these fields are not tool arguments yet, so the probe sends them
 * with the harness's guarded client (h.client). That is the same client the
 * tools use: every request still passes the server's world access guard
 * (with a backup before each edit) and the harness policy (test world only,
 * MCP-TEST- titles, ledger ids only). Only the tools' own argument handling
 * is skipped. Icons on articles go through the real tools, which already
 * accept `icon`.
 *
 * Nothing is asserted about World Anvil's answers: each attempt is logged as
 * a [probe] line saying whether the value stuck, was ignored or was refused.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_PROBE === "1";

const T = {
  chapter: "MCP-TEST-Probe Chapter",
  scene: "MCP-TEST-Probe Scene",
  iconDefault: "MCP-TEST-Probe Icon Default",
  iconCustom: "MCP-TEST-Probe Icon Custom",
  country: "MCP-TEST-Probe Country",
  category: "MCP-TEST-Probe Category",
};

const HTML = "<p>Probe with <strong>bold</strong> and <em>italic</em>.</p>";

function note(msg) {
  console.log(`[probe] ${msg}`);
}

/** Did `sent` come back? Links compare by id, lists by their ids. */
function same(sent, got) {
  const idOf = (v) => String(v?.id ?? v).toLowerCase();
  if (Array.isArray(sent))
    return Array.isArray(got) && sent.every((s) => got.some((g) => idOf(g) === idOf(s)));
  if (sent && typeof sent === "object") return !!got && idOf(got) === idOf(sent);
  return String(got ?? "") === String(sent);
}

function setup() {
  const ctx = { h: null, summary: [] };

  ctx.find = (path, title) =>
    ctx.h.ledger.live().find((e) => e.path === path && e.title === title)?.id ?? null;

  ctx.read = async (tool, arg, id) => {
    const res = await ctx.h.call(tool, { [arg]: id });
    return res.isError ? null : res.data;
  };

  /** Run one write; never throws. Returns the response, or null. */
  ctx.attempt = async (label, fn) => {
    try {
      const out = await fn();
      return out ?? {};
    } catch (err) {
      const msg = String(err.message ?? err).slice(0, 220);
      note(`${label}: REFUSED/ERROR ${msg}`);
      ctx.summary.push(`${label.padEnd(44)} ERROR  ${msg.slice(0, 90)}`);
      return null;
    }
  };

  /** Log which sent fields read back as sent. */
  ctx.report = (label, sent, got) => {
    for (const [k, v] of Object.entries(sent)) {
      const verdict = !got ? "NOT READ" : same(v, got[k]) ? "STUCK" : "IGNORED";
      const shown = JSON.stringify(got?.[k] ?? null).slice(0, 120);
      note(`${label} ${k}: ${verdict} (read back ${shown})`);
      ctx.summary.push(`${`${label} ${k}`.padEnd(44)} ${verdict}`);
    }
  };

  ctx.printSummary = () => {
    for (const line of ctx.summary) note(`SUMMARY ${line}`);
    expect(ctx.h.aborted).toBe(false);
  };

  return ctx;
}

// ---------------------------------------------------------------- create --

describe.runIf(enabled && stage === "create")("write probe: create", () => {
  const ctx = setup();
  let version, root, world, category, character, label;

  beforeAll(async () => {
    ctx.h = await createHarness({ stage: "create" });
    const h = ctx.h;
    world = h.testWorldId;
    version = h.ledger.live().find((e) => e.path === "/manuscript_version")?.id;
    category = h.ledger.live().find((e) => e.path === "/category")?.id;
    character = ctx.find("/article", "MCP-Test-Character");
    label = ctx.find("/manuscript_label", "Blue");
    // The root part is the adopted part titled as the manuscript.
    const manuscript = h.ledger.live().find((e) => e.path === "/manuscript");
    root = manuscript ? ctx.find("/manuscript_part", manuscript.title) : null;
  });

  it("has what it needs from earlier stages", async () => {
    expect(ctx.h.aborted).toBe(false);
    expect(version, "run stage 2 first").toBeTruthy();
    expect(root, "run the discovery read-back first").toBeTruthy();
    const part = await ctx.read("worldanvil_get_manuscriptpart", "part_id", root);
    expect(part?.type, "root part should be type manuscript").toBe("manuscript");
    note(`character in ledger: ${!!character}, label in ledger: ${!!label}`);
  });

  it("creates a chapter (folder) under the root part", async () => {
    if (ctx.find("/manuscript_part", T.chapter)) return note("chapter already made; reusing");
    const sent = { type: "folder", parent: { id: root } };
    const res = await ctx.attempt("create chapter", () =>
      ctx.h.client.createManuscriptPart({ title: T.chapter, version: { id: version }, ...sent }),
    );
    if (!res) return;
    const got = await ctx.read("worldanvil_get_manuscriptpart", "part_id", String(res.id));
    ctx.report("create chapter", sent, got);
    note(`chapter position as stored: ${JSON.stringify(got?.position ?? null)}`);
  });

  it("creates a scene (text) in the chapter, with text and writer fields", async () => {
    if (ctx.find("/manuscript_part", T.scene)) return note("scene already made; reusing");
    const chapter = ctx.find("/manuscript_part", T.chapter);
    const base = { title: T.scene, version: { id: version } };
    const core = { type: "text", ...(chapter ? { parent: { id: chapter } } : {}) };
    const writer = {
      content: HTML,
      synopsis: "Probe synopsis",
      notes: "Probe notes",
      sceneType: "reaction",
      sceneImportance: "subplot",
      sceneTimeOfDay: "Dawn",
      sceneDuration: "1 hour",
      ...(character ? { povCharacter: { id: character } } : {}),
      ...(label ? { label: { id: label } } : {}),
    };

    // Everything at once; if World Anvil refuses that, fall back to less.
    let sent = { ...core, ...writer };
    let res = await ctx.attempt("create scene (all fields)", () =>
      ctx.h.client.createManuscriptPart({ ...base, ...sent }),
    );
    if (!res) {
      sent = { ...core, content: HTML };
      res = await ctx.attempt("create scene (text only)", () =>
        ctx.h.client.createManuscriptPart({ ...base, ...sent }),
      );
    }
    if (!res) {
      sent = core;
      res = await ctx.attempt("create scene (bare)", () =>
        ctx.h.client.createManuscriptPart({ ...base, ...sent }),
      );
    }
    if (!res) return;
    const got = await ctx.read("worldanvil_get_manuscriptpart", "part_id", String(res.id));
    ctx.report("create scene", sent, got);
    note(`scene wordcount: ${JSON.stringify(got?.wordcount ?? null)}, position: ${JSON.stringify(got?.position ?? null)}`);
  });

  it("creates articles with an icon, through the real tool", async () => {
    for (const [title, template, icon] of [
      [T.iconDefault, "person", "fa-person"],
      [T.iconCustom, "myth", "fa-solid fa-dragon"],
    ]) {
      if (ctx.find("/article", title)) continue;
      const res = await ctx.h.call("worldanvil_create_article", {
        title, world_id: world, template, icon, category_id: category,
      });
      if (res.isError) {
        note(`create article ${title}: ERROR ${String(res.text).slice(0, 200)}`);
        ctx.summary.push(`${`create article icon ${icon}`.padEnd(44)} ERROR`);
        continue;
      }
      const got = await ctx.read("worldanvil_get_article", "article_id", String(res.data.id));
      ctx.report(`create article (${template})`, { icon }, got);
    }
  });

  it("compares category icons and creates a category with one (real tool)", async () => {
    // How the site stores a category's icon, next to our icon-less one.
    const listed = await ctx.h.call("worldanvil_list_categories", { world_id: world, limit: 50 });
    for (const c of listed.isError ? [] : (listed.data?.entities ?? [])) {
      const id = String(c.id).toLowerCase();
      let full = null;
      if (ctx.h.ledger.ids().has(id)) full = await ctx.read("worldanvil_get_category", "category_id", id);
      else full = await ctx.attempt("adopt category", () => ctx.h.adopt(id, "/category", world));
      note(`category ${JSON.stringify(full?.title ?? c.title)} icon: ${JSON.stringify(full?.icon ?? null)}`);
    }

    if (ctx.find("/category", T.category)) return;
    const icon = "fas fa-folder"; // what the site shows for a new category
    const res = await ctx.h.call("worldanvil_create_category", {
      title: T.category, world_id: world, icon,
    });
    if (res.isError) {
      note(`create category: ERROR ${String(res.text).slice(0, 200)}`);
      ctx.summary.push(`${"create category icon".padEnd(44)} ERROR`);
      return;
    }
    const got = await ctx.read("worldanvil_get_category", "category_id", String(res.data.id));
    ctx.report("create category", { icon }, got);
  });

  it("creates a Country (organization + variant)", async () => {
    if (ctx.find("/article", T.country)) return;
    const sent = { articleMetadata: '{ "variant": "country" }', icon: "fa-fort" };
    const res = await ctx.attempt("create country", () =>
      ctx.h.client.createArticle({
        title: T.country,
        world: { id: world },
        templateType: "organization",
        ...(category ? { category: { id: category } } : {}),
        ...sent,
      }),
    );
    if (!res) return;
    const got = await ctx.read("worldanvil_get_article", "article_id", String(res.id));
    ctx.report("create country", sent, got);
  });

  it("summary", () => ctx.printSummary());
});

// ---------------------------------------------------------------- update --

describe.runIf(enabled && stage === "update")("write probe: update", () => {
  const ctx = setup();
  let scene, chapter, root, character, label, tag, article, building, item;

  beforeAll(async () => {
    ctx.h = await createHarness({ stage: "update" });
    const h = ctx.h;
    scene = ctx.find("/manuscript_part", T.scene);
    chapter = ctx.find("/manuscript_part", T.chapter);
    const manuscript = h.ledger.live().find((e) => e.path === "/manuscript");
    root = manuscript ? ctx.find("/manuscript_part", manuscript.title) : null;
    character = ctx.find("/article", "MCP-Test-Character");
    label = ctx.find("/manuscript_label", "Green");
    tag = h.ledger.live().find((e) => e.path === "/manuscript_tag")?.id ?? null;
    article = ctx.find("/article", "MCP-TEST-Article");
    building = ctx.find("/article", "MCP-Test-Building");
    item = ctx.find("/article", "MCP-Test-Item");
  });

  it("has the probe items from the create run", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(scene, "run the create probe first").toBeTruthy();
  });

  it("edits the probe scene one field at a time", async () => {
    const fields = {
      content: "<p>Edited <strong>bold</strong>.</p><p>Second paragraph.</p>",
      synopsis: "Edited synopsis",
      notes: "Edited notes",
      sceneType: "action",
      sceneImportance: "mainplot",
      sceneTimeOfDay: "Midnight",
      sceneDuration: "10 minutes",
      isWip: true,
      ...(character ? { povCharacter: { id: character } } : {}),
      ...(label ? { label: { id: label } } : {}),
      ...(tag ? { tags: [{ id: tag }] } : {}),
      ...(character ? { relatedCharacters: [{ id: character }] } : {}),
      ...(article ? { relatedArticles: [{ id: article }] } : {}),
      ...(building ? { relatedLocations: [{ id: building }] } : {}),
      ...(item ? { relatedItems: [{ id: item }] } : {}),
    };
    for (const [k, v] of Object.entries(fields)) {
      const res = await ctx.attempt(`edit scene ${k}`, () =>
        ctx.h.client.updateManuscriptPart(scene, { [k]: v }),
      );
      if (!res) continue;
      const got = await ctx.read("worldanvil_get_manuscriptpart", "part_id", scene);
      ctx.report("edit scene", { [k]: v }, got);
    }
  });

  it("moves the scene out of its chapter and back, then reorders", async () => {
    for (const [label2, parent] of [["to root", root], ["back to chapter", chapter]]) {
      if (!parent) continue;
      const res = await ctx.attempt(`move scene ${label2}`, () =>
        ctx.h.client.updateManuscriptPart(scene, { parent: { id: parent } }),
      );
      if (!res) continue;
      const got = await ctx.read("worldanvil_get_manuscriptpart", "part_id", scene);
      ctx.report(`move scene ${label2}`, { parent: { id: parent } }, got);
    }
    if (chapter) {
      const res = await ctx.attempt("reorder chapter", () =>
        ctx.h.client.updateManuscriptPart(chapter, { position: 0 }),
      );
      if (res) {
        const got = await ctx.read("worldanvil_get_manuscriptpart", "part_id", chapter);
        ctx.report("reorder chapter", { position: 0 }, got);
      }
    }
  });

  it("sets, changes and clears an icon on an existing article (real tool)", async () => {
    const id = ctx.find("/article", "MCP-TEST-Template Myth");
    if (!id) return note("no MCP-TEST-Template Myth article; skipping");
    for (const icon of ["fa-dragon", "fa-duotone fa-dragon", ""]) {
      const res = await ctx.h.call("worldanvil_update_article", { article_id: id, icon });
      if (res.isError) {
        note(`edit article icon ${JSON.stringify(icon)}: ERROR ${String(res.text).slice(0, 200)}`);
        ctx.summary.push(`${`edit article icon ${JSON.stringify(icon)}`.padEnd(44)} ERROR`);
        continue;
      }
      const got = await ctx.read("worldanvil_get_article", "article_id", id);
      ctx.report(`edit article icon ${JSON.stringify(icon)}`, { icon }, got);
    }
  });

  it("turns an existing organization into a Religion (variant)", async () => {
    const id = ctx.find("/article", "MCP-TEST-Template Organization");
    if (!id) return note("no MCP-TEST-Template Organization article; skipping");
    const sent = { articleMetadata: '{ "variant": "religion" }', icon: "fa-ankh" };
    const res = await ctx.attempt("edit variant", () => ctx.h.client.updateArticle(id, sent));
    if (!res) return;
    const got = await ctx.read("worldanvil_get_article", "article_id", id);
    ctx.report("edit variant", sent, got);
  });

  it("summary", () => ctx.printSummary());
});
