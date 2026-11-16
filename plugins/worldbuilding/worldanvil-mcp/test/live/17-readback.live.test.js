/**
 * The read-back check, live: an update of the lore test article's author
 * notes must come back saying they are stored exactly as sent.
 *
 *   WA_TEST_STAGE=update WA_TEST_READBACK=1 npm run test:live -- test/live/17-readback.live.test.js
 *
 * Sends the same author notes the links test (16) left there, so the
 * article ends as it began. The main text is not sent and must not move.
 *
 * Needs two test articles from earlier stages (01 and 13).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_READBACK === "1";

const LORE = "MCP-TEST-Lore Format";
const MISSING = "MCP-TEST-No Such Article Anywhere";

const NOTES = `CANON: this page exists only to test formatting.
LINKS: see [[mcp-test-s1 organization]] and [[${MISSING}]].
SELF: [[${LORE}]] is this page.`;

function note(msg) {
  console.log(`[readback] ${msg}`);
}

describe.runIf(enabled && stage === "update")("read-back after an update", () => {
  let h, loreId, before;

  beforeAll(async () => {
    h = await createHarness({ stage: "update" });
    loreId = h.ledger.live().find((e) => e.path === "/article" && e.title === LORE)?.id ?? null;
  });

  it("has the lore test article", async () => {
    expect(h.aborted).toBe(false);
    expect(loreId, `"${LORE}" is missing: run 13-lore-format create`).toBeTruthy();
    const res = await h.call("worldanvil_get_article", { article_id: loreId });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    before = res.data;
  });

  it("says the author notes are stored exactly as sent", async () => {
    const started = Date.now();
    const res = await h.call("worldanvil_update_article", {
      article_id: loreId,
      author_notes: NOTES,
      unresolved_links: "plain",
    });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    note(`stored: ${res.data.stored}`);
    note(`update with read-back took ${Date.now() - started} ms`);
    expect(res.data.stored).toBe("Checked: author notes are stored exactly as sent.");
  });

  it("leaves the main text and privacy as they were", async () => {
    const after = await h.call("worldanvil_get_article", { article_id: loreId });
    expect(after.data.content).toBe(before.content);
    expect(after.data.authornotes).toBe(before.authornotes);
    expect(after.data.state).toBe("private");
  });
});
