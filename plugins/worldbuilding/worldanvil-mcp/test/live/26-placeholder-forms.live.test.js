/**
 * Which written form of a link placeholder survives the site's editor?
 *
 *   WA_TEST_STAGE=update WA_TEST_FORMS=1 npm run test:live -- test/live/26-placeholder-forms.live.test.js
 *   WA_TEST_STAGE=read   WA_TEST_FORMS=1 npm run test:live -- test/live/26-placeholder-forms.live.test.js
 *
 * Found 2026-11-17: `[[Several Words]]` stored through the API is shown by
 * the site's editor as `[Words]`, and a save made in the editor writes
 * that back, so the placeholder is lost. (`[[HOME]]` typed in the editor
 * itself was saved as typed.)
 *
 *   update  Puts one numbered line per candidate form into the main text
 *           of "MCP-TEST-S1 Generic", sent exactly as written.
 *   read    Prints the stored text line by line and says which lines are
 *           still exactly as sent. Run it straight after the update, and
 *           again after a person has opened the article in the site's
 *           editor, changed something small, and saved.
 *
 * Result 2026-11-17, after a save in the editor: lines 1 to 4 unchanged;
 * 5 to 8 cut down further (to HOME, Yet, Not-Written-Yet, Yet). A line the
 * owner typed there, "[[MY LINK]]", was stored as typed. Curly brackets
 * became the stored form.
 *
 *   update, WA_TEST_FORMS_STEP=reformat
 *           Runs the reformat tool on the article as the owner left it: a
 *           [[...]] typed on the website must come out as {{...}}, and
 *           nothing else may change.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_FORMS === "1";

const TITLE = "MCP-TEST-S1 Generic";
const NAME = "MCP-TEST-Not Written Yet";
const WORDS = "the unwritten page";

/** One line per candidate. The number is how results are reported. */
const LINES = [
  `1. Special brackets: ⟦${NAME}⟧ and ⟦${NAME}|${WORDS}⟧`,
  `2. Curly brackets: {{${NAME}}} and {{${NAME}|${WORDS}}}`,
  `3. Round brackets: ((${NAME})) and ((${NAME}|${WORDS}))`,
  `4. Angle quotes: «${NAME}» and «${NAME}|${WORDS}»`,
  `5. Double square, one word: [[HOME]]`,
  `6. Double square, several words: [[Not Written Yet]]`,
  `7. Double square, joined words: [[Not-Written-Yet]]`,
  `8. Single square, several words: [Not Written Yet]`,
];
const TEXT = LINES.map((l) => `[p]${l}[/p]`).join("\n");

function note(msg) {
  console.log(`[forms] ${msg}`);
}

function setup(ctx, stageName) {
  beforeAll(async () => {
    ctx.h = await createHarness({ stage: stageName });
    const world = String(ctx.h.testWorldId).toLowerCase();
    ctx.id =
      ctx.h.ledger
        .live()
        .find((e) => e.path === "/article" && e.title === TITLE && String(e.worldId).toLowerCase() === world)?.id ?? null;
  });
}

const step = process.env.WA_TEST_FORMS_STEP ?? "write";

describe.runIf(enabled && stage === "update" && step === "write")("write one line per placeholder form", () => {
  const ctx = {};
  setup(ctx, "update");

  it("stores every line exactly as sent", async () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.id, `"${TITLE}" is missing`).toBeTruthy();
    const res = await ctx.h.call("worldanvil_update_article", { article_id: ctx.id, content: TEXT, format: "bbcode" });
    expect(ctx.h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    note(`stored: ${res.data.stored}`);
    expect(res.data.stored).toBe("Checked: main text is stored exactly as sent.");
  });
});

describe.runIf(enabled && stage === "read")("read the forms back", () => {
  const ctx = {};
  setup(ctx, "read");

  it("prints each stored line and whether it is still as sent", async () => {
    expect(ctx.h.aborted).toBe(false);
    const res = await ctx.h.call("worldanvil_get_article", { article_id: ctx.id });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    const stored = String(res.data.content);
    note(`change date ${res.data.updateDate?.date}; whole text as sent: ${stored === TEXT}`);
    const storedLines = stored.split("\n");
    for (const line of LINES) {
      const number = line.split(".")[0];
      const now = storedLines.find((l) => l.startsWith(`[p]${number}. `));
      const same = now === `[p]${line}[/p]`;
      note(`${same ? "SAME   " : "CHANGED"} ${now ?? `(line ${number} not found)`}`);
    }
    for (const extra of storedLines.filter((l) => !/^\[p\]\d\. /.test(l))) note(`other line: ${JSON.stringify(extra)}`);
  });
});

describe.runIf(enabled && stage === "update" && step === "reformat")("reformat rewrites a [[...]] typed on the website", () => {
  const ctx = {};
  setup(ctx, "update");

  it("stores it as {{...}} and changes nothing else", async () => {
    expect(ctx.h.aborted).toBe(false);
    const read = async () => (await ctx.h.call("worldanvil_get_article", { article_id: ctx.id })).data;
    const before = String((await read()).content);
    const squares = before.match(/\[\[[^\[\]\n]+\]\]/g) ?? [];
    note(`before: ${squares.length} square-bracket marker(s): ${squares.join(", ")}`);
    expect(squares.length).toBeGreaterThan(0);

    const res = await ctx.h.call("worldanvil_reformat_article", { article_id: ctx.id });
    expect(ctx.h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    note(`reformat: ${res.data.status}; main text ${res.data.main_text.status}; ${res.data.stored}`);
    note(`waiting: ${JSON.stringify(res.data.links?.waiting?.map((w) => w.name))}`);
    note(`tell_the_user: ${String(res.data.links?.tell_the_user).slice(0, 140)}`);
    expect(res.data.status).toBe("linked");

    const after = String((await read()).content);
    for (const line of after.split("\n")) if (line.trim()) note(`  ${line}`);
    const wanted = before.replace(/\[\[([^\[\]\n]+)\]\]/g, "{{$1}}");
    expect(after).toBe(wanted);
    expect(after).not.toMatch(/\[\[/);
  });
});
