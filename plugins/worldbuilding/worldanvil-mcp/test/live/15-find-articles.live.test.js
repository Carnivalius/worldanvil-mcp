/**
 * Find articles by title, live and read-only.
 *
 *   WA_TEST_STAGE=read WA_TEST_FIND=1 npm run test:live -- test/live/15-find-articles.live.test.js
 *
 * Asks the test world for two titles that exist (one in odd capitals), one
 * that does not, and one near miss. Checks the ids against the ledger and
 * that the link text is in the form World Anvil's editor writes.
 *
 * Needs two test articles from earlier stages (01 and 13). Changes nothing.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_FIND === "1";

const LORE = "MCP-TEST-Lore Format";
const ORG = "MCP-TEST-S1 Organization";

function note(msg) {
  console.log(`[find] ${msg}`);
}

describe.runIf(enabled && stage === "read")("find articles by title", () => {
  let h, world, answer;
  const ledgerId = (title) =>
    h.ledger.live().find((e) => e.path === "/article" && e.title === title)?.id ?? null;
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  beforeAll(async () => {
    h = await createHarness({ stage: "read" });
    world = h.testWorldId;
  });

  it("answers four titles in one call", async () => {
    expect(h.aborted).toBe(false);
    expect(world, "run the create stage (01) first").toBeTruthy();
    expect(ledgerId(LORE), `"${LORE}" is missing: run 13-lore-format create`).toBeTruthy();
    expect(ledgerId(ORG), `"${ORG}" is missing: run the stage 1 create`).toBeTruthy();

    const started = Date.now();
    const res = await h.call("worldanvil_find_articles", {
      world_id: world,
      titles: [LORE, "mcp-test-s1   ORGANIZATION", "MCP-TEST-No Such Article Anywhere", "S1 Organization"],
    });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    answer = res.data;
    note(`${answer.articles_in_world} articles read in ${Date.now() - started} ms; totals ${JSON.stringify(answer.totals)}`);
    for (const r of answer.results)
      note(
        `"${r.asked}" -> ${r.status}` +
          (r.title ? `: "${r.title}" (${r.template}, ${r.state})` : "") +
          (r.suggestions ? `; suggestions: ${r.suggestions.map((s) => `"${s.title}"`).join(", ")}` : ""),
      );
    expect(answer.results).toHaveLength(4);
  });

  it("finds the existing articles, with the right ids and link text", () => {
    const [lore, org] = answer.results;
    expect(lore.status).toBe("found");
    expect(same(lore.id, ledgerId(LORE))).toBe(true);
    expect(lore.mention).toBe(`@[${LORE}](Article:${lore.id})`);
    expect(lore.template).toBe("Generic");
    expect(lore.state).toBe("private");

    expect(org.status).toBe("found");
    expect(org.title).toBe(ORG);
    expect(same(org.id, ledgerId(ORG))).toBe(true);
    expect(org.template).toBe("Organization");
    expect(org.mention).toBe(`@[${ORG}](Article:${org.id})`);
  });

  it("says not found for a made-up title, and suggests for a near miss", () => {
    const [, , missing, near] = answer.results;
    expect(missing.status).toBe("not_found");
    expect(missing.id).toBeUndefined();
    expect(near.status).toBe("not_found");
    expect((near.suggestions ?? []).map((s) => s.title)).toContain(ORG);
    expect((near.suggestions ?? []).length).toBeLessThanOrEqual(5);
  });
});
