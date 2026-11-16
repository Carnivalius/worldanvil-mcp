/**
 * Bringing an article stored in the older form up to the form World
 * Anvil's editor writes, without changing a word. Offline.
 */

import { describe, it, expect, vi } from "vitest";
import { handleToolCall } from "../src/handlers.js";
import { compareAsRead, parseBlocks, readerBlocks, toEditorForm } from "../src/reader-view.js";
import { markdownToBBCode } from "../src/utils.js";
import { getToolDefinitions } from "../src/tools.js";

const parse = (response) => JSON.parse(response.content[0].text);
const call = async (name, args, client) => {
  const response = await handleToolCall(name, args, client);
  if (response.isError) throw new Error(response.content[0].text);
  return parse(response);
};

const MARKDOWN = `Opening **bold** line.
Second line of the same paragraph.

## Overview

- First
- Second
  - Nested
- Third

1. One
2. Two

> A quote.
> — Its Author

---

| Name | Role |
|---|---|
| Aldric | Knight |

See [Wiki](https://example.com).`;

const OLD_FORM = `Opening [b]bold[/b] line.
Second line of the same paragraph.

[h2]Overview[/h2]

[ul]
[li]First[/li]
[li]Second[ul]
[li]Nested[/li]
[/ul][/li]
[li]Third[/li]
[/ul]

[ol]
[li]One[/li]
[li]Two[/li]
[/ol]

[quote]A quote.|Its Author[/quote]

[hr]

[table][tr][th]Name[/th][th]Role[/th][/tr][tr][td]Aldric[/td][td]Knight[/td][/tr][/table]

See [url=https://example.com]Wiki[/url].`;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

describe("old form to the editor's form", () => {
  it("writes the same page exactly as new lore is written", () => {
    const result = toEditorForm(OLD_FORM, { anchorSeed: "a1" });
    expect(result.status).toBe("reformatted");
    expect(result.text).toBe(markdownToBBCode(MARKDOWN, { paragraphs: true, anchorSeed: "a1" }));
  });

  it("reads the same before and after, and a second pass leaves it alone", () => {
    const { text } = toEditorForm(OLD_FORM, { anchorSeed: "a1" });
    expect(compareAsRead(OLD_FORM, text)).toEqual({ status: "format_only" });
    expect(toEditorForm(text, { anchorSeed: "a1" })).toEqual({ status: "current" });
    expect(parseBlocks(text).old).toBe(false);
  });

  it("leaves text already in the editor's form alone, site quirks and all", () => {
    const siteMade =
      "[p][br][br][s]struck[/s][/p]\n[p][/p]\n[h|11111111-1111-4111-8111-111111111111]Title[br][/h]\n" +
      "[ul]\n- One\n-- Two\n[/ul]\n[] todo[br]\n[x] done[br]\n[p]@[Someone](Article:22222222-2222-4222-8222-222222222222)[br][/p]\n[articletoc]";
    expect(toEditorForm(siteMade)).toEqual({ status: "current" });
    expect(toEditorForm(markdownToBBCode(MARKDOWN, { paragraphs: true, anchorSeed: "x" }))).toEqual({ status: "current" });
    expect(toEditorForm("")).toEqual({ status: "current" });
    expect(toEditorForm(null)).toEqual({ status: "current" });
  });

  it("keeps a heading's existing anchor and gives one to a heading without", () => {
    const text = "[h2|33333333-3333-4333-8333-333333333333]Kept[/h2]\nBare words.\n\n[h3]New[/h3]";
    const result = toEditorForm(text, { anchorSeed: "a1" });
    expect(result.text).toMatch(
      new RegExp(`^\\[h2\\|33333333-3333-4333-8333-333333333333\\]Kept\\[/h2\\]\\n\\[p\\]Bare words\\.\\[/p\\]\\n\\[h3\\|${UUID}\\]New\\[/h3\\]$`),
    );
  });

  it("gives two headings with the same words different anchors", () => {
    const { text } = toEditorForm("[h2]Notes[/h2]\n\n[h2]Notes[/h2]", { anchorSeed: "a1" });
    const ids = [...text.matchAll(new RegExp(`\\[h2\\|(${UUID})\\]`, "g"))].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("turns bare lines into paragraphs with line breaks", () => {
    expect(toEditorForm("First line.\nSecond line.\n\nNext paragraph.").text).toBe(
      "[p]First line.[br]Second line.[/p]\n[p]Next paragraph.[/p]",
    );
  });

  it("leaves a one-line author note bare, and wraps a longer one", () => {
    expect(toEditorForm("CANON: cold.", { paragraphs: "auto" })).toEqual({ status: "current" });
    expect(toEditorForm("CANON: cold.\nSECRET: none.", { paragraphs: "auto" }).text).toBe(
      "[p]CANON: cold.[br]SECRET: none.[/p]",
    );
  });

  it("keeps a block it does not take apart outside any paragraph", () => {
    const result = toEditorForm("Words first.\n\n[aloud]Read this out.[/aloud]\n\n[img:123]");
    expect(result.text).toBe("[p]Words first.[/p]\n[aloud]Read this out.[/aloud]\n[img:123]");
  });

  it("keeps a quote's own line breaks", () => {
    const { text } = toEditorForm("Before.\n\n[quote]Line one.\nLine two.|Someone[/quote]");
    expect(text).toBe("[p]Before.[/p]\n[quote]Line one.\nLine two.|Someone[/quote]");
  });

  it("refuses text holding raw HTML", () => {
    const result = toEditorForm("<p>Pasted <strong>from a page</strong>.</p>\n\nMore.");
    expect(result.status).toBe("refused");
    expect(result.why).toMatch(/raw HTML/);
    expect(result.text).toBeUndefined();
  });

  it("refuses when the editor's form can't say the same thing, and says what would differ", () => {
    // A numbered list inside a bulleted one: the editor's lists are one kind throughout.
    const mixed = "[ul]\n[li]Bullet[ol]\n[li]Numbered inside[/li]\n[/ol][/li]\n[/ul]";
    expect(readerBlocks(mixed)).toEqual(["UL1: Bullet", "OL2: Numbered inside"]);
    const result = toEditorForm(mixed);
    expect(result.status).toBe("refused");
    expect(result.why).toMatch(/would change what a reader sees/);
    expect(result.differences.reworded).toEqual([{ was: "OL2: Numbered inside", now: "UL2: Numbered inside" }]);
  });
});

function articleClient(article, overrides = {}) {
  const store = { ...article };
  return {
    store,
    getArticle: vi.fn(async () => ({ ...store })),
    updateArticle: vi.fn(async (id, data) => {
      Object.assign(store, data);
      return { id, title: store.title };
    }),
    ...overrides,
  };
}
const base = (extra = {}) => ({ id: "a1", title: "Iron Mountains", state: "public", world: { id: "w1" }, ...extra });
const reformat = (args, client) => call("worldanvil_reformat_article", { article_id: "a1", ...args }, client);

describe("reformat article tool", () => {
  it("rewrites an old-form article and confirms what was stored", async () => {
    const client = articleClient(base({ content: OLD_FORM, authornotes: "CANON: cold." }));
    const answer = await reformat({}, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", {
      content: markdownToBBCode(MARKDOWN, { paragraphs: true, anchorSeed: "a1" }),
    });
    expect(answer.status).toBe("reformatted");
    expect(answer.main_text).toEqual({ status: "reformatted" });
    expect(answer.author_notes).toEqual({ status: "current" });
    expect(answer.stored).toBe("Checked: main text is stored exactly as sent.");
    expect(answer.note).toMatch(/wording is untouched/);
    expect(JSON.stringify(answer)).not.toContain("Opening");
  });

  it("gives headings the anchors a later upload of the same lore would", async () => {
    const client = articleClient(base({ content: OLD_FORM }));
    await reformat({}, client);
    const later = await call("worldanvil_update_article", { article_id: "a1", content: MARKDOWN }, client);
    expect(later.unchanged).toBe(true);
  });

  it("rewrites multi-line author notes too, and nothing else", async () => {
    const client = articleClient(base({ content: "[p]Fine.[/p]", authornotes: "CANON: cold.\nSECRET: none." }));
    const answer = await reformat({}, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", { authornotes: "[p]CANON: cold.[br]SECRET: none.[/p]" });
    expect(answer.main_text.status).toBe("current");
    expect(answer.stored).toBe("Checked: author notes are stored exactly as sent.");
  });

  it("never sends privacy, title or anything but the two texts", async () => {
    const client = articleClient(base({ content: OLD_FORM, authornotes: "A.\nB." }));
    await reformat({}, client);
    expect(Object.keys(client.updateArticle.mock.calls[0][1]).sort()).toEqual(["authornotes", "content"]);
    expect(client.store.state).toBe("public");
  });

  it("leaves an article in the editor's form alone", async () => {
    const client = articleClient(base({ content: markdownToBBCode(MARKDOWN, { paragraphs: true, anchorSeed: "z" }) }));
    const answer = await reformat({}, client);
    expect(answer.status).toBe("current");
    expect(answer.note).toMatch(/Nothing was sent/);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("an article with no text is left alone", async () => {
    const client = articleClient(base({}));
    expect((await reformat({}, client)).status).toBe("current");
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("dry run says what would happen and sends nothing", async () => {
    const client = articleClient(base({ content: OLD_FORM }));
    const answer = await reformat({ dry_run: true }, client);
    expect(answer.status).toBe("would_reformat");
    expect(answer.main_text.status).toBe("reformatted");
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("refuses raw HTML, saying why, and sends nothing", async () => {
    const client = articleClient(base({ content: "<p>Pasted.</p>\n\nMore." }));
    const answer = await reformat({}, client);
    expect(answer.status).toBe("refused");
    expect(answer.main_text.why).toMatch(/raw HTML/);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("rewrites the part it can when the other part is refused, and says so", async () => {
    const client = articleClient(base({ content: "<p>Pasted.</p>\n\nMore.", authornotes: "A.\nB." }));
    const answer = await reformat({}, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", { authornotes: "[p]A.[br]B.[/p]" });
    expect(answer.status).toBe("reformatted");
    expect(answer.main_text.status).toBe("refused");
    expect(answer.note).toMatch(/One part could not be rewritten/);
  });

  it("is offered as a tool", () => {
    const tool = getToolDefinitions().find((t) => t.name === "worldanvil_reformat_article");
    expect(tool.inputSchema.required).toEqual(["article_id"]);
    expect(tool.inputSchema.properties.dry_run.type).toBe("boolean");
  });
});
