/**
 * Link placeholders, live: a [[Name]] whose article does not exist yet is
 * kept in the stored text as {{Name}}, and the answer says so. (Stored in
 * curly brackets since 2026-11-17: the site's editor cuts square ones down.)
 *
 *   WA_TEST_STAGE=update WA_TEST_PLACEHOLDERS=1 npm run test:live -- test/live/23-placeholders.live.test.js
 *
 *   1. The main text of one test article ("MCP-TEST-S1 Generic", a
 *      generic article in the first test world) is replaced with a short
 *      page holding one link
 *      that can be made and two placeholders (one with its own shown
 *      words) for an article that does not exist.
 *   2. The answer names the kept placeholders and tells the session to
 *      tell the user; the text is stored exactly as sent.
 *   3. A reformat dry run finds nothing to do and lists them as waiting.
 *
 * The article is left like this for a person to look at on the site.
 *
 * First run 2026-11-17 on "MCP-TEST-S1 Prose": stored correctly, but the
 * site's editor for a Prose article shows its own `prose` box, not
 * `content`, so nothing could be seen there. Hence a generic article,
 * checked before anything is sent.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_PLACEHOLDERS === "1";

const TITLE = "MCP-TEST-S1 Generic";
const EXISTS = "MCP-TEST-S1 Organization";
const MISSING = "MCP-TEST-Not Written Yet";

const TEXT = `This page shows how links look.

A link that was made: [[${EXISTS}]].

A link waiting for its article: [[${MISSING}]].

The same, with other words shown: [[${MISSING}|the unwritten page]].`;

function note(msg) {
  console.log(`[placeholders] ${msg}`);
}

describe.runIf(enabled && stage === "update")("link placeholders in a stored article", () => {
  let h, id;

  beforeAll(async () => {
    h = await createHarness({ stage: "update" });
    // The first test world's own article (a copy may exist in the second).
    const world = String(h.testWorldId).toLowerCase();
    id =
      h.ledger.live().find((e) => e.path === "/article" && e.title === TITLE && String(e.worldId).toLowerCase() === world)?.id ??
      null;
  });

  it("keeps the placeholders, makes the link, and says which is which", async () => {
    expect(h.aborted).toBe(false);
    expect(id, `"${TITLE}" is missing: run the stage 1 create`).toBeTruthy();
    const before = await h.call("worldanvil_get_article", { article_id: id });
    note(`template of "${TITLE}": ${before.data?.templateType}`);
    expect(before.data?.templateType).toBe("article");
    const res = await h.call("worldanvil_update_article", { article_id: id, content: TEXT });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    const links = res.data.links;
    note(`linked: ${links.linked.map((l) => l.name).join(", ")}`);
    note(`waiting: ${JSON.stringify(links.waiting.map((w) => ({ name: w.name, why: w.why, shown_as: w.shown_as })))}`);
    note(`tell_the_user: ${links.tell_the_user}`);
    note(`stored: ${res.data.stored}`);
    expect(links.linked.map((l) => l.name)).toEqual([EXISTS]);
    expect(links.waiting.map((w) => w.name)).toEqual([MISSING]);
    expect(links.tell_the_user).toMatch(/^1 link was not made and is kept in the text as a placeholder/);
    expect(res.data.stored).toBe("Checked: main text is stored exactly as sent.");
  });

  it("stores the placeholders exactly as written, beside a real mention", async () => {
    const res = await h.call("worldanvil_get_article", { article_id: id });
    const content = String(res.data.content);
    for (const line of content.split("\n")) note(`  ${line.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>")}`);
    expect(content).toContain(`{{${MISSING}}}`);
    expect(content).toContain(`{{${MISSING}|the unwritten page}}`);
    expect(content).not.toContain("[[");
    expect(content).toMatch(new RegExp(`@\\[${EXISTS}\\]\\(Article:[0-9a-f-]{36}\\)`));
    expect(res.data.state).toBe("private");
  });

  it("a reformat dry run finds nothing to do and lists them as waiting", async () => {
    const res = await h.call("worldanvil_reformat_article", { article_id: id, dry_run: true });
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    note(`reformat dry run: ${res.data.status}; waiting ${JSON.stringify(res.data.links?.waiting?.map((w) => w.name))}`);
    expect(res.data.status).toBe("current");
    expect(res.data.links.waiting.map((w) => w.name)).toEqual([MISSING]);
  });
});
