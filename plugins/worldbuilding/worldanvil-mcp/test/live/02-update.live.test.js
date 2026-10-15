/**
 * Stage 3 (update): change the MCP-TEST- items stage 2 made, and read each
 * change back.
 *
 *   WA_TEST_STAGE=update npm run test:live -- test/live/02-update.live.test.js
 *
 * Updates and reads only; nothing is created or deleted. Every update is
 * preceded by a local backup (the server's own guard); the last check counts
 * them. Renames keep the MCP-TEST- prefix. New values are fixed, so a re-run
 * sets the same values again.
 *
 * Not updated: the stat (World Anvil doesn't store its title, and the tool
 * can't change its notes) and the world (renaming worlds is switched off).
 */

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";
import { PATHS } from "./harness/state.js";

const stage = process.env.WA_TEST_STAGE;

const EDITED = {
  manuscript: "MCP-TEST-Manuscript (edited)",
  part: "MCP-TEST-Chapter 1 (edited)",
  plot: "MCP-TEST-Plot (edited)",
};

function note(msg) {
  console.log(`[stage3] ${msg}`);
}

/**
 * World Anvil may change a title on save (it stripped the brackets from a
 * manuscript's), so check the prefix and the word "edited", and log the rest.
 */
function expectRenamed(label, stored, sent) {
  note(`${label} title sent: ${JSON.stringify(sent)}, stored: ${JSON.stringify(stored)}`);
  expect(stored).toMatch(/^MCP-TEST-.*edited/);
}

/** Files under `dir` written at or after `since` (old backups get pruned). */
function countFilesSince(dir, since) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((n, name) => {
    const s = statSync(join(dir, name));
    if (s.isDirectory()) return n + countFilesSince(join(dir, name), since);
    return n + (s.mtimeMs >= since ? 1 : 0);
  }, 0);
}

describe.runIf(stage === "update")("stage 3: update (test items only)", () => {
  let h;
  let startedAt;
  let updates = 0;
  const ids = {};

  async function read(tool, args) {
    const res = await h.call(tool, args);
    expect(res.isError, res.text).toBe(false);
    return res.data;
  }

  async function update(tool, args) {
    await read(tool, args);
    updates++;
  }

  /** The id of a live ledger item made by stage 2. */
  function fromLedger(path, pick = () => true) {
    const entry = h.ledger.live().find((e) => e.path === path && !e.auto && pick(e));
    expect(entry, `${path} from stage 2 is in the ledger (run stage 2 first)`).toBeTruthy();
    return entry.id;
  }

  beforeAll(async () => {
    startedAt = Date.now() - 1000; // allow for coarse file timestamps
    h = await createHarness({ stage: "update" });
  });

  it("is not aborted and finds stage 2's items", () => {
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
    ])
      ids[path] = fromLedger(path);
  });

  it("updates the category description", async () => {
    await update("worldanvil_update_category", {
      category_id: ids["/category"],
      description: "Updated by the **live test**.",
    });
    const category = await read("worldanvil_get_category", { category_id: ids["/category"] });
    note(`category description as stored: ${JSON.stringify(category.description)}`);
    expect(category.description).toContain("[b]live test[/b]");
  });

  it("updates the article content", async () => {
    await update("worldanvil_update_article", {
      article_id: ids["/article"],
      content: "Edited by the **live test**.",
    });
    const article = await read("worldanvil_get_article", { article_id: ids["/article"] });
    note(`article content as stored: ${JSON.stringify(article.content)}`);
    expect(article.content).toBe("Edited by the [b]live test[/b].");
  });

  it("refuses a rename that drops the MCP-TEST- prefix, without sending it", async () => {
    const before = updates;
    const res = await h.call("worldanvil_update_article", {
      article_id: ids["/article"],
      title: "Renamed article",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/REFUSED.*MCP-TEST-/);
    expect(h.aborted).toBe(false);
    const article = await read("worldanvil_get_article", { article_id: ids["/article"] });
    expect(article.title).toMatch(/^MCP-TEST-/);
    expect(updates).toBe(before);
  });

  it("renames the manuscript", async () => {
    await update("worldanvil_update_manuscript", {
      manuscript_id: ids["/manuscript"],
      title: EDITED.manuscript,
    });
    const manuscript = await read("worldanvil_get_manuscript", {
      manuscript_id: ids["/manuscript"],
    });
    expectRenamed("manuscript", manuscript.title, EDITED.manuscript);
  });

  it("renames the chapter", async () => {
    await update("worldanvil_update_manuscriptpart", {
      part_id: ids["/manuscript_part"],
      title: EDITED.part,
    });
    const part = await read("worldanvil_get_manuscriptpart", { part_id: ids["/manuscript_part"] });
    expectRenamed("chapter", part.title, EDITED.part);
  });

  it("updates the beat's text", async () => {
    await update("worldanvil_update_manuscriptbeat", {
      beat_id: ids["/manuscript_beat"],
      content: "The edited first line of **chapter one**.",
    });
    const beat = await read("worldanvil_get_manuscriptbeat", { beat_id: ids["/manuscript_beat"] });
    note(`beat content as stored: ${JSON.stringify(beat.content)}`);
    expect(beat.content).toBe("The edited first line of [b]chapter one[/b].");
  });

  it("renames the plot", async () => {
    await update("worldanvil_update_manuscriptplot", {
      plot_id: ids["/manuscript_plot"],
      title: EDITED.plot,
    });
    const plot = await read("worldanvil_get_manuscriptplot", { plot_id: ids["/manuscript_plot"] });
    expectRenamed("plot", plot.title, EDITED.plot);
  });

  it("never offers the world rename tool", async () => {
    const res = await h.call("worldanvil_update_world", {
      world_id: ids.world,
      title: "MCP-TEST-World (edited)",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Unknown tool/);
  });

  it("backed up each item before changing it", () => {
    const made = countFilesSince(PATHS.backups, startedAt);
    note(`backups made this run: ${made} (updates sent: ${updates})`);
    expect(made).toBeGreaterThanOrEqual(updates);
  });
});
