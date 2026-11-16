/**
 * Compare new lore with an existing article, live and read-only.
 *
 *   WA_TEST_STAGE=read WA_TEST_COMPARE=1 npm run test:live -- test/live/18-compare.live.test.js
 *
 * Reads the lore test article and compares it with: its own text (same),
 * its own text with the heading anchors taken out (format only), and its
 * own text with one paragraph added and its author notes reworded
 * (changed). Checks the stamp is the article's change date.
 *
 * Needs the lore test article (13). Changes nothing.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_COMPARE === "1";

const LORE = "MCP-TEST-Lore Format";

function note(msg) {
  console.log(`[compare] ${msg}`);
}

describe.runIf(enabled && stage === "read")("compare an article with new text", () => {
  let h, id, article;
  const compare = async (args) => {
    const res = await h.call("worldanvil_compare_article", { article_id: id, format: "bbcode", ...args });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    return res.data;
  };

  beforeAll(async () => {
    h = await createHarness({ stage: "read" });
    id = h.ledger.live().find((e) => e.path === "/article" && e.title === LORE)?.id ?? null;
  });

  it("has the lore test article", async () => {
    expect(h.aborted).toBe(false);
    expect(id, `"${LORE}" is missing: run 13-lore-format create`).toBeTruthy();
    const res = await h.call("worldanvil_get_article", { article_id: id });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    article = res.data;
    expect(String(article.content).length).toBeGreaterThan(200);
  });

  it("same: the article's own text", async () => {
    const answer = await compare({ content: article.content, author_notes: article.authornotes });
    note(`own text -> ${answer.status}; stamp ${answer.stamp}`);
    expect(answer.status).toBe("same");
    expect(answer.title).toBe(LORE);
    expect(answer.stamp).toBe(article.updateDate.date);
  });

  it("format only: the same text with its heading anchors taken out", async () => {
    const plainHeadings = String(article.content).replace(/\[h(\d?)\|[0-9a-f-]{36}\]/gi, "[h$1]");
    expect(plainHeadings).not.toBe(article.content);
    const answer = await compare({ content: plainHeadings });
    note(`headings without anchors -> ${answer.status}`);
    expect(answer.status).toBe("format_only");
  });

  it("changed: one paragraph added, author notes reworded", async () => {
    const answer = await compare({
      content: `${article.content}\n[p]One more paragraph.[/p]`,
      author_notes: String(article.authornotes).replace("CANON:", "CANON (checked):"),
    });
    note(`with changes -> ${answer.status}`);
    note(`main text added: ${JSON.stringify(answer.main_text.added)}`);
    note(`author notes reworded: ${answer.author_notes.reworded.length} block(s)`);
    expect(answer.status).toBe("changed");
    expect(answer.main_text.added).toEqual(["P: One more paragraph."]);
    expect(answer.main_text.removed).toEqual([]);
    expect(answer.main_text.reworded).toEqual([]);
    expect(answer.author_notes.reworded).toHaveLength(1);
  });

  it("left the article as it was", async () => {
    const after = await h.call("worldanvil_get_article", { article_id: id });
    expect(after.data.content).toBe(article.content);
    expect(after.data.authornotes).toBe(article.authornotes);
    expect(after.data.updateDate.date).toBe(article.updateDate.date);
  });
});
