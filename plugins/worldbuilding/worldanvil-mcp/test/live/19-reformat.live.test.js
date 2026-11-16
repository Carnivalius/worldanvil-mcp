/**
 * Reformat an article stored in the older form, live.
 *
 *   WA_TEST_STAGE=update WA_TEST_REFORMAT=1 npm run test:live -- test/live/19-reformat.live.test.js
 *
 *   1. One test article ("MCP-TEST-S1 Generic") is given a text in the
 *      older stored form (sent as written).
 *   2. A dry run says it would be reformatted and changes nothing.
 *   3. The reformat rewrites it: stored in the editor's form, reading the
 *      same, confirmed by the tool's own read-back.
 *   4. A second reformat finds nothing to do and sends nothing.
 *
 * Only that one test article's main text is changed. It is left holding
 * the reformatted test text, for a person to look at on the site.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";
import { readerBlocks, toEditorForm } from "../../src/reader-view.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_REFORMAT === "1";

const TITLE = "MCP-TEST-S1 Generic";

/** A page as the older tool stored it. */
const OLD_FORM = `This test page is stored in the [b]older[/b] form.
A second line of the same paragraph.

[h2]Overview[/h2]

A paragraph under the heading, with [i]italic[/i] words.

[ul]
[li][b]First:[/b] a bulleted item[/li]
[li]Second item[ul]
[li]Nested item[/li]
[/ul][/li]
[li]Third item[/li]
[/ul]

[h3]Steps[/h3]

[ol]
[li]Step one[/li]
[li]Step two[/li]
[/ol]

[hr]

[quote]A quote worth keeping.|Its Author[/quote]

See [url=https://www.wikipedia.org/]Wikipedia[/url] for more.`;

function note(msg) {
  console.log(`[reformat] ${msg}`);
}

describe.runIf(enabled && stage === "update")("reformat an old-form article", () => {
  let h, id, afterReformat;
  const read = async () => {
    const res = await h.call("worldanvil_get_article", { article_id: id });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    return res.data;
  };
  const ok = async (tool, args) => {
    const res = await h.call(tool, args);
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, `${tool}: ${String(res.text).slice(0, 400)}`).toBeFalsy();
    return res.data;
  };

  beforeAll(async () => {
    h = await createHarness({ stage: "update" });
    id = h.ledger.live().find((e) => e.path === "/article" && e.title === TITLE)?.id ?? null;
  });

  it("puts a text in the older form into the test article", async () => {
    expect(h.aborted).toBe(false);
    expect(id, `"${TITLE}" is missing: run the stage 1 create`).toBeTruthy();
    await ok("worldanvil_update_article", { article_id: id, content: OLD_FORM, format: "bbcode" });
    const now = await read();
    expect(now.content).toBe(OLD_FORM);
    expect(now.state).toBe("private");
  });

  it("dry run: says it would be reformatted, changes nothing", async () => {
    const answer = await ok("worldanvil_reformat_article", { article_id: id, dry_run: true });
    note(`dry run -> ${answer.status}; main text ${answer.main_text.status}; author notes ${answer.author_notes.status}`);
    expect(answer.status).toBe("would_reformat");
    expect(answer.main_text.status).toBe("reformatted");
    expect((await read()).content).toBe(OLD_FORM);
  });

  it("reformat: stored in the editor's form, reading the same", async () => {
    const answer = await ok("worldanvil_reformat_article", { article_id: id });
    note(`reformat -> ${answer.status}; ${answer.stored}`);
    expect(answer.status).toBe("reformatted");
    expect(answer.stored).toBe("Checked: main text is stored exactly as sent.");

    afterReformat = await read();
    for (const line of String(afterReformat.content).split("\n"))
      note(`  ${line.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>")}`);
    expect(afterReformat.content).toBe(toEditorForm(OLD_FORM, { anchorSeed: String(id) }).text);
    expect(readerBlocks(afterReformat.content)).toEqual(readerBlocks(OLD_FORM));
    expect(afterReformat.content).not.toMatch(/\[li\]|\[url=|\[h[23]\]/);
    expect(afterReformat.state).toBe("private");
    expect(afterReformat.title).toBe(TITLE);
  });

  it("a second reformat finds nothing to do and sends nothing", async () => {
    const answer = await ok("worldanvil_reformat_article", { article_id: id });
    note(`second pass -> ${answer.status}`);
    expect(answer.status).toBe("current");
    const now = await read();
    expect(now.content).toBe(afterReformat.content);
    expect(now.updateDate.date).toBe(afterReformat.updateDate.date);
  });
});
