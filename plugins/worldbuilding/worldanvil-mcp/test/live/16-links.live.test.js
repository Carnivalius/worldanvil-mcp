/**
 * [[Name]] links, live: the author notes of the lore test article are
 * updated with one link to an existing test article and one to a name
 * that has no article.
 *
 *   WA_TEST_STAGE=update WA_TEST_LINKS=1 npm run test:live -- test/live/16-links.live.test.js
 *
 *   1. Default: the update is refused and nothing changes.
 *   2. unresolved_links "plain": the found name is stored as a mention in
 *      the form World Anvil's editor writes, the other as ordinary text;
 *      the main text does not move.
 *
 * Needs two test articles from earlier stages (01 and 13). Only the lore
 * test article's author notes are changed.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_LINKS === "1";

const LORE = "MCP-TEST-Lore Format";
const ORG = "MCP-TEST-S1 Organization";
const MISSING = "MCP-TEST-No Such Article Anywhere";

const NOTES = `CANON: this page exists only to test formatting.
LINKS: see [[mcp-test-s1 organization]] and [[${MISSING}]].
SELF: [[${LORE}]] is this page.`;

function note(msg) {
  console.log(`[links] ${msg}`);
}

describe.runIf(enabled && stage === "update")("links in author notes", () => {
  let h, loreId, orgId, before;
  const find = (title) =>
    h.ledger.live().find((e) => e.path === "/article" && e.title === title)?.id ?? null;

  beforeAll(async () => {
    h = await createHarness({ stage: "update" });
    loreId = find(LORE);
    orgId = find(ORG);
  });

  it("has both test articles", async () => {
    expect(h.aborted).toBe(false);
    expect(loreId, `"${LORE}" is missing: run 13-lore-format create`).toBeTruthy();
    expect(orgId, `"${ORG}" is missing: run the stage 1 create`).toBeTruthy();
    const res = await h.call("worldanvil_get_article", { article_id: loreId });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    before = res.data;
  });

  it("refuses by default when a name has no article, and changes nothing", async () => {
    const res = await h.call("worldanvil_update_article", { article_id: loreId, author_notes: NOTES });
    note(`default: ${String(res.text).slice(0, 500)}`);
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError).toBeTruthy();
    expect(String(res.text)).toMatch(/A link could not be made/);
    expect(String(res.text)).toContain(`[[${MISSING}]]: no article with this title`);
    expect(String(res.text)).toMatch(/Nothing was sent/);
    const after = await h.call("worldanvil_get_article", { article_id: loreId });
    expect(after.data.authornotes).toBe(before.authornotes);
    expect(after.data.content).toBe(before.content);
  });

  it('with "plain", stores a mention for the found name and text for the rest', async () => {
    const res = await h.call("worldanvil_update_article", {
      article_id: loreId,
      author_notes: NOTES,
      unresolved_links: "plain",
    });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    note(`answer links: ${JSON.stringify(res.data.links).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>")}`);
    expect(res.data.links.linked).toHaveLength(1);
    expect(res.data.links.linked[0].title).toBe(ORG);
    expect(res.data.links.plain.map((p) => p.name).sort()).toEqual([LORE, MISSING].sort());

    const after = await h.call("worldanvil_get_article", { article_id: loreId });
    const notes = String(after.data.authornotes);
    for (const line of notes.split("\n")) note(`  ${line.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>")}`);
    expect(notes.toLowerCase()).toContain(`@[${ORG}](Article:${orgId})`.toLowerCase());
    expect(notes).toContain(`and ${MISSING}.`);
    expect(notes).toContain(`SELF: ${LORE} is this page.`);
    expect(notes).not.toContain("[[");
    expect(after.data.content).toBe(before.content);
    expect(after.data.state).toBe("private");
  });
});
