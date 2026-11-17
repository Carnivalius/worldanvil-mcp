/**
 * The Prose template's own text box, live.
 *
 *   WA_TEST_STAGE=update WA_TEST_PROSE=1 WA_TEST_PROSE_STEP=probe npm run test:live -- test/live/25-prose.live.test.js
 *   WA_TEST_STAGE=update WA_TEST_PROSE=1 WA_TEST_PROSE_STEP=tools npm run test:live -- test/live/25-prose.live.test.js
 *
 * A Prose article keeps what its editor shows in `prose`, not `content`
 * (found 2026-11-17). Two steps, each its own run:
 *
 *   probe  Writes a short formatted text to `prose` and a line to
 *          `sidenotes` as template fields, and reads them back: does
 *          `prose` take the same text form as `content`?
 *   tools  Sends main text the ordinary way (`content` on the update
 *          tool) and checks it lands in `prose`; compare and reformat
 *          look at `prose` too.
 *
 * Only "MCP-TEST-S1 Prose" in the first test world is changed. It is left
 * holding the test text for a person to look at on the site.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";
import { markdownToBBCode } from "../../src/utils.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_PROSE === "1";
const step = process.env.WA_TEST_PROSE_STEP;

const TITLE = "MCP-TEST-S1 Prose";
const LINKED = "MCP-TEST-S1 Organization";

const PROBE_TEXT = `A first paragraph written to the prose box, with **bold** words.

A second paragraph.

## A heading

- one
- two`;

const TOOL_TEXT = `Prose sent the ordinary way, as main text.

It mentions [[${LINKED}]].

## Second part

A closing paragraph.`;

function note(msg) {
  console.log(`[prose] ${msg}`);
}
const mask = (t) => String(t ?? "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>");

function setup(ctx) {
  beforeAll(async () => {
    ctx.h = await createHarness({ stage: "update" });
    const world = String(ctx.h.testWorldId).toLowerCase();
    ctx.id =
      ctx.h.ledger
        .live()
        .find((e) => e.path === "/article" && e.title === TITLE && String(e.worldId).toLowerCase() === world)?.id ?? null;
    ctx.read = async () => {
      const res = await ctx.h.call("worldanvil_get_article", { article_id: ctx.id });
      expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
      return res.data;
    };
    ctx.ok = async (tool, args) => {
      const res = await ctx.h.call(tool, args);
      expect(ctx.h.aborted, res.text).toBe(false);
      expect(res.isError, `${tool}: ${String(res.text).slice(0, 500)}`).toBeFalsy();
      return res.data;
    };
  });
}

describe.runIf(enabled && stage === "update" && step === "probe")("probe: write to the prose box as a template field", () => {
  const ctx = {};
  setup(ctx);
  let before;

  it("is a Prose article", async () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.id, `"${TITLE}" is missing: run the stage 1 create`).toBeTruthy();
    before = await ctx.read();
    note(`before: prose ${JSON.stringify(before.prose)}; sidenotes ${JSON.stringify(before.sidenotes)}; content ${String(before.content ?? "").length} characters`);
    expect(before.templateType).toBe("prose");
  });

  it("stores formatted text in prose, and a line in sidenotes", async () => {
    const answer = await ctx.ok("worldanvil_update_article", {
      article_id: ctx.id,
      fields: { prose: PROBE_TEXT, sidenotes: "A side note, written by the probe." },
    });
    note(`stored: ${answer.stored}`);
    const after = await ctx.read();
    for (const line of String(after.prose).split("\n")) note(`  prose: ${mask(line)}`);
    note(`sidenotes: ${JSON.stringify(after.sidenotes)}`);
    note(`word count ${before.wordcount} -> ${after.wordcount}; content unchanged ${after.content === before.content}`);
    expect(after.prose).toBe(markdownToBBCode(PROBE_TEXT));
    expect(after.sidenotes).toBe("A side note, written by the probe.");
    expect(after.content).toBe(before.content);
    expect(after.state).toBe("private");
  });
});

describe.runIf(enabled && stage === "update" && step === "tools")("tools: main text of a Prose article goes to prose", () => {
  const ctx = {};
  setup(ctx);
  let before, stamp;

  it("compare looks at the prose box", async () => {
    expect(ctx.h.aborted).toBe(false);
    before = await ctx.read();
    expect(before.templateType).toBe("prose");
    const same = await ctx.ok("worldanvil_compare_article", { article_id: ctx.id, content: before.prose, format: "bbcode" });
    note(`compare with its own prose -> ${same.status}`);
    expect(same.status).toBe("same");
    const changed = await ctx.ok("worldanvil_compare_article", { article_id: ctx.id, content: TOOL_TEXT });
    note(`compare with new text -> ${changed.status}`);
    expect(changed.status).toBe("changed");
    stamp = changed.stamp;
  });

  it("update sends main text to prose, makes the link, and leaves content alone", async () => {
    const answer = await ctx.ok("worldanvil_update_article", { article_id: ctx.id, content: TOOL_TEXT, if_unchanged_since: stamp });
    note(`stored: ${answer.stored}`);
    note(`links: ${JSON.stringify(answer.links?.linked?.map((l) => l.name))}`);
    const after = await ctx.read();
    for (const line of String(after.prose).split("\n")) note(`  prose: ${mask(line)}`);
    expect(answer.stored).toBe("Checked: main text is stored exactly as sent.");
    expect(after.prose).toMatch(/^\[p\]Prose sent the ordinary way, as main text\.\[\/p\]/);
    expect(after.prose).toMatch(new RegExp(`@\\[${LINKED}\\]\\(Article:[0-9a-f-]{36}\\)`));
    expect(after.content).toBe(before.content);
    expect(after.state).toBe("private");
  });

  it("the same text again sends nothing, and a reformat finds it current", async () => {
    const again = await ctx.ok("worldanvil_update_article", { article_id: ctx.id, content: TOOL_TEXT });
    note(`same text again -> unchanged ${again.unchanged}`);
    expect(again.unchanged).toBe(true);
    const reformat = await ctx.ok("worldanvil_reformat_article", { article_id: ctx.id, dry_run: true });
    note(`reformat dry run -> ${reformat.status}; main text ${reformat.main_text.status}`);
    expect(reformat.main_text.status).toBe("current");
  });
});
