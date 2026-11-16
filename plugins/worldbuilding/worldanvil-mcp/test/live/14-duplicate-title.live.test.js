/**
 * One title, one article: live check that a create or a rename which would
 * give two articles the same title is refused before anything is sent.
 *
 *   WA_TEST_STAGE=read WA_TEST_DUPLICATE=1 npm run test:live -- test/live/14-duplicate-title.live.test.js
 *
 * Runs in the READ stage on purpose: the refusal must come from the tool
 * after it has only read the world's article list. If the tool ever failed
 * to refuse, the harness would stop the write, so nothing can change.
 *
 * Needs two test articles from earlier stages (01 and 13).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_DUPLICATE === "1";

const TAKEN = "MCP-TEST-Lore Format";
const OTHER = "MCP-TEST-S1 Organization";

function note(msg) {
  console.log(`[duplicate] ${msg}`);
}

describe.runIf(enabled && stage === "read")("duplicate titles are refused", () => {
  let h, world, takenId, otherId;
  const find = (title) =>
    h.ledger.live().find((e) => e.path === "/article" && e.title === title)?.id ?? null;
  const writes = () => h.ledger.live().length;

  beforeAll(async () => {
    h = await createHarness({ stage: "read" });
    world = h.testWorldId;
    takenId = find(TAKEN);
    otherId = find(OTHER);
  });

  it("has the test world and both test articles", () => {
    expect(h.aborted).toBe(false);
    expect(world, "run the create stage (01) first").toBeTruthy();
    expect(takenId, `"${TAKEN}" is missing: run 13-lore-format create`).toBeTruthy();
    expect(otherId, `"${OTHER}" is missing: run the stage 1 create`).toBeTruthy();
  });

  it("refuses a create with a title that is taken, capitals and spaces aside", async () => {
    const before = writes();
    const res = await h.call("worldanvil_create_article", {
      title: "  mcp-test-LORE   format ",
      world_id: world,
      template: "Generic",
      content: "This must never be sent.",
    });
    note(`create: ${String(res.text).slice(0, 400)}`);
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError).toBeTruthy();
    expect(String(res.text)).toMatch(/already has an article with that title/);
    expect(String(res.text).toLowerCase()).toContain(String(takenId).toLowerCase());
    expect(String(res.text)).toMatch(/Nothing was sent/);
    expect(writes()).toBe(before);
  });

  it("refuses a rename to a title another article has", async () => {
    const res = await h.call("worldanvil_update_article", { article_id: otherId, title: TAKEN });
    note(`rename: ${String(res.text).slice(0, 400)}`);
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError).toBeTruthy();
    expect(String(res.text)).toMatch(/already has an article with that title/);
    const still = await h.call("worldanvil_get_article", { article_id: otherId });
    expect(still.data?.title).toBe(OTHER);
  });

  it("only one article has the taken title afterwards", async () => {
    let offset = 0;
    const titles = [];
    for (let page = 0; page < 20; page++) {
      const res = await h.call("worldanvil_list_articles", { world_id: world, limit: 50, offset });
      expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
      titles.push(...(res.data.entities ?? []).map((a) => a.title));
      if (!res.data.paging?.more) break;
      offset = res.data.paging.next_offset;
    }
    note(`${titles.length} articles in the test world`);
    const same = titles.filter((t) => String(t).trim().replace(/\s+/g, " ").toLowerCase() === TAKEN.toLowerCase());
    expect(same).toHaveLength(1);
  });
});
