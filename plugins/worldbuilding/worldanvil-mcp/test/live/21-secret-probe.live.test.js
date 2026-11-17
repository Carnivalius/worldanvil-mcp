/**
 * Secrets, live: can a tool-made secret be created private, attached to
 * an article, with its text stored as sent?
 *
 *   WA_TEST_STAGE=create WA_TEST_SECRET=1 npm run test:live -- test/live/21-secret-probe.live.test.js
 *
 * Creates one secret ("MCP-TEST-Secret Probe") attached to the lore test
 * article, then reads it back and reads the article to see how the link
 * shows there. The article's own text is not changed.
 *
 * Needs the lore test article (13). Leaves the secret in the test world.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";
import { markdownToBBCode } from "../../src/utils.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_SECRET === "1";

const LORE = "MCP-TEST-Lore Format";
const TITLE = "MCP-TEST-Secret Probe";
const TEXT = `The first paragraph of a test secret, with **bold** words.

A second paragraph.`;

function note(msg) {
  console.log(`[secret] ${msg}`);
}

describe.runIf(enabled && stage === "create")("create a secret attached to an article", () => {
  let h, articleId, before, secretId;

  beforeAll(async () => {
    h = await createHarness({ stage: "create" });
    articleId = h.ledger.live().find((e) => e.path === "/article" && e.title === LORE)?.id ?? null;
  });

  it("has the lore test article and no probe secret yet", async () => {
    expect(h.aborted).toBe(false);
    expect(articleId, `"${LORE}" is missing: run 13-lore-format create`).toBeTruthy();
    expect(
      h.ledger.live().some((e) => e.path === "/secret" && e.title === TITLE),
      `"${TITLE}" already exists in the ledger`,
    ).toBe(false);
    const res = await h.call("worldanvil_get_article", { article_id: articleId });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    before = res.data;
  });

  it("creates it private, attached, and says so", async () => {
    const res = await h.call("worldanvil_create_secret", {
      title: TITLE,
      world_id: h.testWorldId,
      content: TEXT,
      article_id: articleId,
    });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    secretId = res.data.id;
    note(`create answer keys: ${Object.keys(res.data).join(", ")}`);
    note(`privacy: ${res.data.privacy}`);
    expect(secretId).toBeTruthy();
    expect(res.data.privacy).toBe("private");
  });

  it("reads back: private, text as sent, linked to the article and the world", async () => {
    const res = await h.call("worldanvil_get_secret", { secret_id: secretId });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    const s = res.data;
    note(`state ${s.state}; icon ${s.icon}; entityClass ${s.entityClass}`);
    note(`content stored: ${JSON.stringify(s.content)}`);
    note(`article link: ${s.article ? "set" : "not set"}; world link: ${s.world ? "set" : "not set"}`);
    expect(s.title).toBe(TITLE);
    expect(s.state).toBe("private");
    expect(s.content).toBe(markdownToBBCode(TEXT));
    expect(String(s.article?.id).toLowerCase()).toBe(String(articleId).toLowerCase());
    expect(String(s.world?.id).toLowerCase()).toBe(String(h.testWorldId).toLowerCase());
  });

  it("shows on the article, whose own text has not moved", async () => {
    const res = await h.call("worldanvil_get_article", { article_id: articleId });
    const a = res.data;
    const listed = Array.isArray(a.secrets) ? a.secrets.map((x) => String(x.id).toLowerCase()) : null;
    note(`article.secrets: ${listed ? `${listed.length} listed` : "no such field"}`);
    note(`article change date moved: ${a.updateDate.date !== before.updateDate.date}`);
    expect(a.content).toBe(before.content);
    expect(a.authornotes).toBe(before.authornotes);
    expect(a.state).toBe("private");
    expect(listed ?? []).toContain(String(secretId).toLowerCase());
  });
});
