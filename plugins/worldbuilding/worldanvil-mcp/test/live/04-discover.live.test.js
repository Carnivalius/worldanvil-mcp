/**
 * Discovery (read only): read back the test manuscript after items were
 * made or edited by hand in the web UI, to learn how World Anvil stores
 * writer fields (folders, scene details, labels, tags, plots, stats).
 *
 *   WA_TEST_STAGE=read WA_TEST_DISCOVER=1 npm run test:live -- test/live/04-discover.live.test.js
 *
 * Nothing is created, edited or deleted on World Anvil. Items made on the
 * site are not in the ledger, so each one found under a ledger parent is
 * adopted (the harness checks it references that parent and is in the test
 * world) before it is read in full. Adopted items are never deleted
 * directly; they go with the manuscript.
 *
 * The full read-back is written to the live-test backup folder (outside the repository); a slimmed
 * view is logged as [discover] lines. Findings belong in the API guide,
 * without ids.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";
import { PATHS } from "./harness/state.js";

const enabled =
  process.env.WA_TEST_STAGE === "read" && process.env.WA_TEST_DISCOVER === "1";

function note(msg) {
  console.log(`[discover] ${msg}`);
}

/** Drop empty values; shrink linked objects to their id, title and type. */
function slim(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v)) {
      if (v.length) out[k] = v.map((x) => (x && typeof x === "object" ? link(x) : x));
    } else if (typeof v === "object") {
      out[k] = link(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function link(o) {
  if (!("id" in o)) return o;
  const l = { id: o.id };
  for (const k of ["title", "type", "entityClass", "color", "position"])
    if (o[k] !== null && o[k] !== undefined) l[k] = o[k];
  return l;
}

describe.runIf(enabled)("discovery: read back the test manuscript", () => {
  let h;
  const dump = {};

  const ledgerItem = (path) => h.ledger.live().find((e) => e.path === path);

  async function list(tool, args) {
    const res = await h.call(tool, { ...args, limit: 50 });
    if (res.isError) {
      note(`${tool} failed: ${res.text}`);
      return [];
    }
    return res.data?.entities ?? [];
  }

  /** Full read of a child of `parentId`, adopting it first if it is new. */
  async function full(id, path, parentId, getTool, idArg) {
    const key = String(id).toLowerCase();
    if (!h.ledger.ids().has(key)) {
      try {
        return await h.adopt(key, path, parentId);
      } catch (err) {
        note(`could not adopt ${path}: ${err.message}`);
        return null;
      }
    }
    const res = await h.call(getTool, { [idArg]: key });
    if (res.isError) note(`${getTool} failed: ${res.text}`);
    return res.isError ? null : res.data;
  }

  async function readAll(label, entities, path, parentId, getTool, idArg) {
    note(`${label}: ${entities.length} listed`);
    if (entities[0]) note(`${label} list fields: ${Object.keys(entities[0]).sort().join(", ")}`);
    const items = [];
    for (const e of entities) {
      const item = await full(e.id, path, parentId, getTool, idArg);
      if (!item) continue;
      items.push(item);
      note(`${label} ${JSON.stringify(slim(item))}`);
    }
    dump[label] = items;
    return items;
  }

  beforeAll(async () => {
    h = await createHarness({ stage: "read" });
  });

  it("is not aborted and has a test manuscript", () => {
    expect(h.aborted).toBe(false);
    expect(ledgerItem("/manuscript"), "run the create stage first").toBeTruthy();
    expect(ledgerItem("/manuscript_version")).toBeTruthy();
  });

  it("reads the manuscript and its version", async () => {
    for (const [path, tool, arg] of [
      ["/manuscript", "worldanvil_get_manuscript", "manuscript_id"],
      ["/manuscript_version", "worldanvil_get_manuscriptversion", "version_id"],
    ]) {
      const res = await h.call(tool, { [arg]: ledgerItem(path).id });
      expect(res.isError, res.text).toBe(false);
      dump[path] = res.data;
      note(`${path} ${JSON.stringify(slim(res.data))}`);
    }
  });

  it("reads every part (folders, text, image) and its beats", async () => {
    const version = ledgerItem("/manuscript_version").id;
    const listed = await list("worldanvil_list_manuscriptparts", { version_id: version });
    const parts = await readAll(
      "part", listed, "/manuscript_part", version,
      "worldanvil_get_manuscriptpart", "part_id",
    );
    expect(parts.length).toBeGreaterThan(0);

    const beats = [];
    for (const part of parts) {
      const id = String(part.id).toLowerCase();
      const found = await list("worldanvil_list_manuscriptbeats", { part_id: id });
      for (const b of found) beats.push({ ...b, _part: id });
    }
    note(`beat: ${beats.length} listed`);
    dump.beat = [];
    for (const b of beats) {
      const item = await full(
        b.id, "/manuscript_beat", b._part,
        "worldanvil_get_manuscriptbeat", "beat_id",
      );
      if (!item) continue;
      dump.beat.push(item);
      note(`beat ${JSON.stringify(slim(item))}`);
    }
  });

  it("reads labels, tags and bookmarks", async () => {
    const manuscript = ledgerItem("/manuscript").id;
    for (const [label, path, plural, arg] of [
      ["label", "/manuscript_label", "manuscriptlabels", "label_id"],
      ["tag", "/manuscript_tag", "manuscripttags", "tag_id"],
      ["bookmark", "/manuscript_bookmark", "manuscriptbookmarks", "bookmark_id"],
    ]) {
      const listed = await list(`worldanvil_list_${plural}`, { manuscript_id: manuscript });
      await readAll(
        label, listed, path, manuscript,
        `worldanvil_get_${plural.slice(0, -1)}`, arg,
      );
    }
  });

  it("reads plots and stats", async () => {
    const version = ledgerItem("/manuscript_version").id;
    for (const [label, path, plural, arg] of [
      ["plot", "/manuscript_plot", "manuscriptplots", "plot_id"],
      ["stat", "/manuscript_stat", "manuscriptstats", "stat_id"],
    ]) {
      const listed = await list(`worldanvil_list_${plural}`, { version_id: version });
      await readAll(
        label, listed, path, version,
        `worldanvil_get_${plural.slice(0, -1)}`, arg,
      );
    }
  });

  it("reads site-made articles and compares them with tool-made ones", async () => {
    // list_articles returns uncategorised articles only: on the test world
    // those are the ones made by hand on the site.
    const world = h.testWorldId;
    const listed = await list("worldanvil_list_articles", { world_id: world });
    const site = await readAll(
      "site-article", listed, "/article", world,
      "worldanvil_get_article", "article_id",
    );

    const IGNORE = /^(id|title|slug|url|editURL|.*Date|wordcount|category|content|.*Parsed)$/;
    for (const mine of site) {
      const twin = h.ledger
        .live()
        .find((e) => e.path === "/article" && e.title === `MCP-TEST-Template ${mine.entityClass}`);
      if (!twin) continue;
      const res = await h.call("worldanvil_get_article", { article_id: twin.id });
      if (res.isError) continue;
      dump[`tool-article ${mine.entityClass}`] = res.data;
      const keys = new Set([...Object.keys(mine), ...Object.keys(res.data)]);
      for (const k of [...keys].sort()) {
        if (IGNORE.test(k)) continue;
        const a = JSON.stringify(mine[k] ?? null);
        const b = JSON.stringify(res.data[k] ?? null);
        if (a !== b)
          note(`diff ${mine.entityClass} "${mine.title}" ${k}: site=${a.slice(0, 200)} tool=${b.slice(0, 200)}`);
      }
    }
  });

  it("reports icons set by hand on tool-made articles", async () => {
    // Tool-made articles start with no icon; any icon found here was chosen
    // on the site with the icon picker beside the article's title.
    const mine = h.ledger.live().filter((e) => e.path === "/article" && !e.auto);
    dump["tool-article icons"] = [];
    for (const e of mine) {
      const res = await h.call("worldanvil_get_article", { article_id: e.id });
      if (res.isError) continue;
      const { title, templateType, icon, articleMetadata } = res.data;
      dump["tool-article icons"].push({ title, templateType, icon, articleMetadata });
      if (icon || articleMetadata)
        note(`icon ${JSON.stringify({ title, templateType, icon, articleMetadata })}`);
    }
    note(`icon: checked ${mine.length} tool-made articles`);
  });

  it("writes the full read-back to the backup folder", () => {
    mkdirSync(PATHS.backups, { recursive: true });
    const file = join(PATHS.backups, `discovery-${new Date().toISOString().slice(0, 10)}.json`);
    writeFileSync(file, JSON.stringify(dump, null, 2) + "\n", "utf8");
    note(`full read-back written to ${file}`);
  });
});
