/**
 * Lore upload, live check of the text format: a lore page written in
 * Markdown goes up through the real create tool and must be stored in the
 * form World Anvil's own editor writes; author notes stay apart from the
 * main text.
 *
 *   WA_TEST_STAGE=create WA_TEST_LORE=1 npm run test:live -- test/live/13-lore-format.live.test.js
 *   WA_TEST_STAGE=update WA_TEST_LORE=1 npm run test:live -- test/live/13-lore-format.live.test.js
 *
 *   create  One article with every kind of formatting (paragraphs, line
 *           break, headings 1 to 5, bulleted / numbered / nested lists,
 *           checklist, quote with author, line, table, web link, a mention
 *           of another test article, a table of contents) plus author
 *           notes. Read back: stored exactly as sent. Then it is for a
 *           person to look at on the site.
 *   update  Author notes alone are changed: the main text must not move,
 *           and the article's change date in the world's list must (the
 *           world backup's copy-unchanged shortcut relies on that date).
 *
 * Everything is titled MCP-TEST-, recorded in the ledger and left for the
 * delete stage. Nothing is made public.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";
import { markdownToBBCode } from "../../src/utils.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_LORE === "1";

const TITLE = "MCP-TEST-Lore Format";
const LINK_TO = "MCP-TEST-S1 Organization";
const CATEGORY = "MCP-TEST-Stage1";

function note(msg) {
  console.log(`[lore] ${msg}`);
}

const lore = (mention) => `This page was uploaded by the lore tool to check its formatting. It has **bold**, *italic* and ~~struck~~ words.
This second line is in the same paragraph, after a line break.

A second paragraph, with a web link to [Wikipedia](https://www.wikipedia.org/) and a mention of ${mention}.

## Contents

[articletoc]

# Heading one

Text under heading one.

## Heading two

- A bulleted list
- Second item
  - Nested one level
    - Nested two levels
  - Back to one level
- Third item

### Heading three

1. A numbered list
2. Second item
   1. Nested numbered item
3. Third item

#### Heading four

- [ ] A task not done
- [x] A task done

##### Heading five

> A quote worth keeping.
> — Its Author

---

| Name | Role | Home |
|---|---|---|
| Aldric | Knight | Valdor |
| Mira | Scholar | Eastmere |

Last paragraph, after the table.`;

const NOTES = `CANON: this page exists only to test formatting.
SECRET: nothing here is real lore.
TO DEVELOP: nothing.`;

const NOTES_EDITED = `${NOTES}
ADDED: this line was added by the update stage.`;

function setup(stageName) {
  const ctx = { h: null, world: null };
  ctx.find = (path, title) =>
    ctx.h.ledger.live().find((e) => e.path === path && e.title === title)?.id ?? null;
  ctx.ok = async (tool, args) => {
    const res = await ctx.h.call(tool, args);
    expect(ctx.h.aborted, res.text).toBe(false);
    expect(res.isError, `${tool}: ${String(res.text).slice(0, 300)}`).toBeFalsy();
    return res.data;
  };
  ctx.mention = () => {
    const target = ctx.find("/article", LINK_TO);
    return target ? `@[${LINK_TO}](Article:${target})` : "(no test article to mention)";
  };
  beforeAll(async () => {
    ctx.h = await createHarness({ stage: stageName });
    ctx.world = ctx.h.testWorldId;
  });
  return ctx;
}

const stampOf = (r) => (r?.updateDate == null ? null : JSON.stringify(r.updateDate));

async function listStamp(ctx, id) {
  for (let offset = 0, page = 0; page < 20; page++) {
    const res = await ctx.ok("worldanvil_list_articles", { world_id: ctx.world, limit: 50, offset });
    const hit = (res.entities ?? []).find((a) => String(a.id).toLowerCase() === String(id).toLowerCase());
    if (hit) return stampOf(hit);
    if (!res.paging?.more) break;
    offset = res.paging.next_offset;
  }
  return null;
}

describe.runIf(enabled && stage === "create")("lore format: create", () => {
  const ctx = setup("create");
  let id, sent;

  it("is not aborted and has the test world", () => {
    expect(ctx.h.aborted).toBe(false);
    expect(ctx.world, "run the create stage (01) first").toBeTruthy();
  });

  it("uploads a Markdown lore page with author notes, private", async () => {
    const markdown = lore(ctx.mention());
    sent = markdownToBBCode(markdown, { paragraphs: true, anchorSeed: TITLE });
    id = ctx.find("/article", TITLE);
    if (id) {
      note("already there from an earlier run; reading it back");
      return;
    }
    const category = ctx.find("/category", CATEGORY);
    const made = await ctx.ok("worldanvil_create_article", {
      title: TITLE,
      world_id: ctx.world,
      template: "Generic",
      content: markdown,
      author_notes: NOTES,
      ...(category ? { category_id: category } : {}),
    });
    id = String(made.id);
    expect(made.privacy, made.privacy).toMatch(/^private/);
  });

  it("is stored exactly as sent, in the site editor's form", async () => {
    const read = await ctx.ok("worldanvil_get_article", { article_id: id });
    for (const line of String(read.content).split("\n")) console.log(`[lore]   ${line}`);
    note(`author notes as stored: ${JSON.stringify(read.authornotes)}`);
    note(`state ${read.state}, editor ${read.editor}, wordcount ${read.wordcount}`);
    note(`edit it on the site: ${read.editURL}`);
    expect(read.content).toBe(sent);
    expect(read.authornotes).toBe(markdownToBBCode(NOTES, { anchorSeed: `${TITLE} notes` }));
    expect(read.state).toBe("private");
  });
});

describe.runIf(enabled && stage === "update")("lore format: author notes alone", () => {
  const ctx = setup("update");
  let id, before, beforeStamp;

  it("finds the lore page", async () => {
    expect(ctx.h.aborted).toBe(false);
    id = ctx.find("/article", TITLE);
    expect(id, "run the create stage of this test first").toBeTruthy();
    before = await ctx.ok("worldanvil_get_article", { article_id: id });
    beforeStamp = await listStamp(ctx, id);
    note(`list change date before: ${beforeStamp}`);
  });

  it("changing author notes leaves the main text alone and moves the list change date", async () => {
    const wanted = before.authornotes === markdownToBBCode(NOTES_EDITED, { anchorSeed: `${TITLE} notes` }) ? NOTES : NOTES_EDITED;
    await new Promise((r) => setTimeout(r, 1500));
    await ctx.ok("worldanvil_update_article", { article_id: id, author_notes: wanted });
    const after = await ctx.ok("worldanvil_get_article", { article_id: id });
    const afterStamp = await listStamp(ctx, id);
    note(`list change date after:  ${afterStamp}`);
    note(`list change date ${afterStamp === beforeStamp ? "DID NOT MOVE" : "moved"}; wordcount ${before.wordcount} -> ${after.wordcount}`);
    expect(after.content).toBe(before.content);
    expect(after.authornotes).toBe(markdownToBBCode(wanted, { anchorSeed: `${TITLE} notes` }));
    expect(after.state).toBe("private");
    expect(afterStamp, "an author-notes-only edit did not move the list change date").not.toBe(beforeStamp);
  });
});
