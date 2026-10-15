/**
 * Stage 4 (delete): remove the MCP-TEST- items stages 2-3 made, newest
 * first, and confirm each is gone from its parent's list.
 *
 *   WA_TEST_STAGE=delete npm run test:live -- test/live/03-delete.live.test.js
 *
 * Deletes and reads only. The harness re-reads every target first and
 * refuses unless it is a ledger item still titled MCP-TEST-, in a test
 * world; the server's guard backs it up locally before the delete.
 *
 * Left in place on purpose:
 *   - the stat: World Anvil stores its title as "untitled", so the harness
 *     refuses to delete it (checked below); it should go with the manuscript.
 *   - "Draft 1": made by World Anvil with the manuscript, never deleted
 *     directly; it should go with the manuscript.
 *   - the test world: world deletion is switched off. Delete it on the site,
 *     then move test-ledger.json and test-access.json aside.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;

function note(msg) {
  console.log(`[stage4] ${msg}`);
}

describe.runIf(stage === "delete")("stage 4: delete (test items only)", () => {
  let h;
  const ids = {};

  async function read(tool, args) {
    const res = await h.call(tool, args);
    expect(res.isError, res.text).toBe(false);
    return res.data;
  }

  /** Lowercase ids in a list response. */
  async function listed(tool, args) {
    const data = await read(tool, args);
    return (data?.entities ?? []).map((e) => String(e.id).toLowerCase());
  }

  async function remove(tool, args, id) {
    await read(tool, args);
    expect(h.ledger.get(id), "marked deleted in the ledger").toBeUndefined();
  }

  function fromLedger(path, { auto = false } = {}) {
    const entry = h.ledger.live().find((e) => e.path === path && !!e.auto === auto);
    expect(entry, `${path} is in the ledger (run stages 2-3 first)`).toBeTruthy();
    return entry.id;
  }

  beforeAll(async () => {
    h = await createHarness({ stage: "delete" });
  });

  it("is not aborted and finds the test items", () => {
    expect(h.aborted).toBe(false);
    ids.world = h.testWorldId;
    expect(ids.world).toBeTruthy();
    for (const path of [
      "/category",
      "/article",
      "/manuscript",
      "/manuscript_part",
      "/manuscript_beat",
      "/manuscript_plot",
      "/manuscript_stat",
    ])
      ids[path] = fromLedger(path);
    ids.version = fromLedger("/manuscript_version", { auto: true });
  });

  it("refuses to delete the stat, whose title World Anvil didn't keep", async () => {
    const res = await h.call("worldanvil_delete_manuscriptstat", { stat_id: ids["/manuscript_stat"] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/REFUSED.*MCP-TEST-/);
    expect(h.aborted).toBe(false);
    expect(h.ledger.get(ids["/manuscript_stat"])).toBeTruthy();
  });

  it("deletes the plot", async () => {
    await remove("worldanvil_delete_manuscriptplot", { plot_id: ids["/manuscript_plot"] }, ids["/manuscript_plot"]);
    const plots = await listed("worldanvil_list_manuscriptplots", { version_id: ids.version });
    expect(plots).not.toContain(ids["/manuscript_plot"]);
  });

  it("deletes the beat", async () => {
    await remove("worldanvil_delete_manuscriptbeat", { beat_id: ids["/manuscript_beat"] }, ids["/manuscript_beat"]);
    const beats = await listed("worldanvil_list_manuscriptbeats", { part_id: ids["/manuscript_part"] });
    expect(beats).not.toContain(ids["/manuscript_beat"]);
  });

  it("deletes the chapter", async () => {
    await remove("worldanvil_delete_manuscriptpart", { part_id: ids["/manuscript_part"] }, ids["/manuscript_part"]);
    const parts = await listed("worldanvil_list_manuscriptparts", { version_id: ids.version });
    expect(parts).not.toContain(ids["/manuscript_part"]);
  });

  it("deletes the manuscript", async () => {
    await remove("worldanvil_delete_manuscript", { manuscript_id: ids["/manuscript"] }, ids["/manuscript"]);
    const manuscripts = await listed("worldanvil_list_manuscripts", { world_id: ids.world });
    expect(manuscripts).not.toContain(ids["/manuscript"]);
  });

  it("reports whether Draft 1 and the stat went with the manuscript", async () => {
    for (const [label, tool, args] of [
      ["Draft 1", "worldanvil_get_manuscriptversion", { version_id: ids.version }],
      ["stat", "worldanvil_get_manuscriptstat", { stat_id: ids["/manuscript_stat"] }],
    ]) {
      const res = await h.call(tool, args);
      note(`${label} after the manuscript delete: ${res.isError ? `gone or unreadable (${res.text.slice(0, 160)})` : "still there"}`);
    }
    expect(h.aborted).toBe(false);
  });

  it("deletes the article", async () => {
    await remove("worldanvil_delete_article", { article_id: ids["/article"] }, ids["/article"]);
  });

  it("deletes the category", async () => {
    await remove("worldanvil_delete_category", { category_id: ids["/category"] }, ids["/category"]);
    const categories = await listed("worldanvil_list_categories", { world_id: ids.world });
    expect(categories).not.toContain(ids["/category"]);
  });

  it("never offers the world delete tool", async () => {
    const res = await h.call("worldanvil_delete_world", { world_id: ids.world });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Unknown tool/);
    note(`still in the ledger: ${h.ledger.live().map((e) => `${e.path} ${JSON.stringify(e.title)}`).join(", ")}`);
  });
});
