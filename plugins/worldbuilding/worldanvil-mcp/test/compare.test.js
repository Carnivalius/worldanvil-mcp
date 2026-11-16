/**
 * Changing existing lore: comparing new text with a stored article by what
 * a reader sees, saving nothing when nothing would change, and refusing to
 * overwrite an edit made on the website. Offline.
 */

import { describe, it, expect, vi } from "vitest";
import { handleToolCall } from "../src/handlers.js";
import { compareAsRead, readerBlocks } from "../src/reader-view.js";
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

/** The same page as the older tool stored it. */
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

const NEW_FORM = markdownToBBCode(MARKDOWN, { paragraphs: true, anchorSeed: "a1" });

describe("an article's text as a reader sees it", () => {
  it("reduces the editor's form to blocks", () => {
    expect(readerBlocks(NEW_FORM)).toEqual([
      "P: Opening [b]bold[/b] line. ⏎ Second line of the same paragraph.",
      "H2: Overview",
      "UL1: First",
      "UL1: Second",
      "UL2: Nested",
      "UL1: Third",
      "OL1: One",
      "OL1: Two",
      "QUOTE: A quote. — Its Author",
      "HR",
      "HEAD: Name | Role",
      "ROW: Aldric | Knight",
      "P: See [url:https://example.com]Wiki[/url].",
    ]);
  });

  it("reduces the older form to the same blocks", () => {
    expect(readerBlocks(OLD_FORM)).toEqual(readerBlocks(NEW_FORM));
  });

  it("reads checklists, the contents list, titles and empty paragraphs", () => {
    expect(
      readerBlocks("[h|x-1]A Title[/h]\n[articletoc]\n[] todo[br]\n[x] done[br]\n[p][/p]\n[p]End[br][/p]"),
    ).toEqual(["H: A Title", "TOC", "TASK[ ]: todo", "TASK[x]: done", "P: End"]);
  });

  it("keeps what it does not understand as text, so it can only show as a difference", () => {
    expect(readerBlocks("[p]Before [img:123] after[/p]\n[aloud]Read this[/aloud]")).toEqual([
      "P: Before [img:123] after",
      "P: [aloud]Read this[/aloud]",
    ]);
  });

  it("copes with nothing", () => {
    expect(readerBlocks("")).toEqual([]);
    expect(readerBlocks(null)).toEqual([]);
  });
});

describe("comparing as read", () => {
  it("same: stored exactly as it would be sent", () => {
    expect(compareAsRead(NEW_FORM, NEW_FORM)).toEqual({ status: "same" });
  });

  it("format only: the older form of the same page", () => {
    expect(compareAsRead(OLD_FORM, NEW_FORM)).toEqual({ status: "format_only" });
  });

  it("changed: says what was reworded, removed and added", () => {
    const wanted = NEW_FORM.replace("- Third", "- Third and last").replace("[hr]\n", "") + "\n[p]A new ending.[/p]";
    expect(compareAsRead(OLD_FORM, wanted)).toEqual({
      status: "changed",
      blocks: { stored: 13, wanted: 13 },
      reworded: [{ was: "UL1: Third", now: "UL1: Third and last" }],
      removed: ["HR"],
      added: ["P: A new ending."],
    });
  });

  it("a change of emphasis or of a link's address is a change", () => {
    expect(compareAsRead("[p]A bold word.[/p]", "[p]A [b]bold[/b] word.[/p]").status).toBe("changed");
    expect(
      compareAsRead("[p][url:https://a.example]x[/url][/p]", "[p][url:https://b.example]x[/url][/p]").status,
    ).toBe("changed");
  });

  it("something only World Anvil holds shows as removed", () => {
    const result = compareAsRead("[p]Text.[/p]\n[p][img:123][/p]", "[p]Text.[/p]");
    expect(result.status).toBe("changed");
    expect(result.removed).toEqual(["P: [img:123]"]);
  });

  it("shortens long blocks", () => {
    const long = "x".repeat(400);
    const result = compareAsRead(`[p]${long}[/p]`, "[p]short[/p]");
    expect(result.reworded[0].was.length).toBeLessThan(170);
    expect(result.reworded[0].was.endsWith("…")).toBe(true);
  });
});

function articleClient(article, overrides = {}) {
  const store = { ...article };
  return {
    store,
    listArticles: vi.fn(async () => ({ entities: [] })),
    getArticle: vi.fn(async () => ({ ...store })),
    updateArticle: vi.fn(async (id, data) => {
      Object.assign(store, data, { updateDate: { date: "2026-11-17 09:00:00.000000" } });
      return { id, title: store.title };
    }),
    ...overrides,
  };
}

const STAMP = "2026-11-16 22:12:46.000000";
const base = (extra = {}) => ({
  id: "a1",
  title: "Iron Mountains",
  state: "private",
  world: { id: "w1" },
  updateDate: { date: STAMP, timezone_type: 3, timezone: "Europe/London" },
  ...extra,
});

describe("compare article tool", () => {
  const compare = (args, client) => call("worldanvil_compare_article", { article_id: "a1", ...args }, client);

  it("says same, and changes nothing", async () => {
    const client = articleClient(base({ content: NEW_FORM }));
    const answer = await compare({ content: MARKDOWN }, client);
    expect(answer.status).toBe("same");
    expect(answer.main_text).toEqual({ status: "same" });
    expect(answer.stamp).toBe(STAMP);
    expect(answer.title).toBe("Iron Mountains");
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("says format only for an article stored in the older form", async () => {
    const answer = await compare({ content: MARKDOWN }, articleClient(base({ content: OLD_FORM })));
    expect(answer.status).toBe("format_only");
    expect(answer.note).toMatch(/stored in an older form/);
  });

  it("lists the differences a reader would see", async () => {
    const answer = await compare(
      { content: MARKDOWN.replace("- Third", "- Third and last") },
      articleClient(base({ content: OLD_FORM })),
    );
    expect(answer.status).toBe("changed");
    expect(answer.main_text.reworded).toEqual([{ was: "UL1: Third", now: "UL1: Third and last" }]);
    expect(answer.note).toMatch(/if_unchanged_since/);
  });

  it("compares author notes on their own, and both together", async () => {
    const client = articleClient(base({ content: NEW_FORM, authornotes: "CANON: cold." }));
    const notesOnly = await compare({ author_notes: "CANON: very cold." }, client);
    expect(notesOnly.main_text).toBeUndefined();
    expect(notesOnly.author_notes.reworded).toEqual([{ was: "P: CANON: cold.", now: "P: CANON: very cold." }]);

    const both = await compare({ content: MARKDOWN, author_notes: "CANON: cold." }, client);
    expect(both.status).toBe("same");
    expect(both.main_text.status).toBe("same");
    expect(both.author_notes.status).toBe("same");
  });

  it("treats the text as an update would: title heading left out, links made", async () => {
    const client = articleClient(base({ content: "[p]North of @[Thronehold](Article:a-9).[/p]" }), {
      listArticles: vi.fn(async () => ({ entities: [{ id: "a-9", title: "Thronehold" }] })),
    });
    const answer = await compare({ content: "# Iron Mountains\n\nNorth of [[Thronehold]]." }, client);
    expect(answer.status).toBe("same");
    expect(answer.title_heading).toMatch(/left out/);
    expect(answer.links.linked).toHaveLength(1);
  });

  it("does not refuse over a name with no article: it only looks, and says so", async () => {
    const answer = await compare({ content: "Near [[Nowhere]]." }, articleClient(base({ content: "[p]Near Nowhere.[/p]" })));
    expect(answer.status).toBe("same");
    expect(answer.unlinked_names).toMatch(/Nowhere/);
  });

  it("an article with no text yet compares as all added", async () => {
    const answer = await compare({ content: "First words." }, articleClient(base({})));
    expect(answer.main_text.added).toEqual(["P: First words."]);
  });

  it("needs something to compare", async () => {
    await expect(compare({}, articleClient(base({})))).rejects.toThrow(/Give content, author_notes, or both/);
  });

  it("is offered as a tool, and update offers if_unchanged_since", () => {
    const tools = getToolDefinitions();
    expect(tools.find((t) => t.name === "worldanvil_compare_article").inputSchema.required).toEqual(["article_id"]);
    const update = tools.find((t) => t.name === "worldanvil_update_article");
    expect(update.inputSchema.properties.if_unchanged_since.type).toBe("string");
    const create = tools.find((t) => t.name === "worldanvil_create_article");
    expect(create.inputSchema.properties.if_unchanged_since).toBeUndefined();
  });
});

describe("update: nothing to change, nothing sent", () => {
  const update = (args, client) => call("worldanvil_update_article", { article_id: "a1", ...args }, client);

  it("sends nothing when the text is already exactly what is stored", async () => {
    const client = articleClient(base({ content: NEW_FORM, authornotes: "CANON: cold." }));
    const answer = await update({ content: MARKDOWN, author_notes: "CANON: cold." }, client);
    expect(client.updateArticle).not.toHaveBeenCalled();
    expect(answer.unchanged).toBe(true);
    expect(answer.note).toMatch(/Nothing was sent.*No backup was taken/);
    expect(answer.stamp).toBe(STAMP);
    expect(answer.stored).toBeUndefined();
  });

  it("sends everything given when any part differs", async () => {
    const client = articleClient(base({ content: NEW_FORM, authornotes: "CANON: cold." }));
    await update({ content: MARKDOWN, author_notes: "CANON: very cold." }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", {
      content: NEW_FORM,
      authornotes: "CANON: very cold.",
    });
  });

  it("an article in the older form is rewritten even though it reads the same", async () => {
    const client = articleClient(base({ content: OLD_FORM }));
    const answer = await update({ content: MARKDOWN }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", { content: NEW_FORM });
    expect(answer.unchanged).toBeUndefined();
    expect(answer.stored).toMatch(/^Checked:/);
  });

  it("the same title and the same category count as no change", async () => {
    const client = articleClient(base({ category: { id: "CAT-1" } }));
    const answer = await update({ title: "Iron Mountains", category_id: "cat-1" }, client);
    expect(client.updateArticle).not.toHaveBeenCalled();
    expect(answer.unchanged).toBe(true);
  });

  it("a different category is sent", async () => {
    const client = articleClient(base({ category: { id: "cat-1" } }));
    await update({ title: "Iron Mountains", category_id: "cat-2" }, client);
    expect(client.updateArticle).toHaveBeenCalledOnce();
  });
});

describe("update: not over an edit made on the website", () => {
  const update = (args, client) => call("worldanvil_update_article", { article_id: "a1", ...args }, client);

  it("goes ahead when the stamp still matches", async () => {
    const client = articleClient(base({ content: "[p]Old.[/p]" }));
    await update({ content: "New.", if_unchanged_since: STAMP }, client);
    expect(client.updateArticle).toHaveBeenCalledOnce();
  });

  it("accepts the stamp as World Anvil's own date object too", async () => {
    const client = articleClient(base({ content: "[p]Old.[/p]" }));
    await update({ content: "New.", if_unchanged_since: { date: STAMP, timezone: "Europe/London" } }, client);
    expect(client.updateArticle).toHaveBeenCalledOnce();
  });

  it("refuses, sending nothing, when the article has changed since", async () => {
    const client = articleClient(base({ content: "[p]Edited on the site.[/p]" }));
    await expect(
      update({ content: "New.", if_unchanged_since: "2026-11-15 08:00:00.000000" }, client),
    ).rejects.toThrow(
      /has changed on World Anvil since it was compared \(then 2026-11-15 08:00:00\.000000, now 2026-11-16 22:12:46\.000000\).*Nothing was sent.*show the user both versions.*combined text/s,
    );
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("refuses an empty stamp instead of treating it as no check", async () => {
    const client = articleClient(base({ content: "[p]Old.[/p]" }));
    await expect(update({ content: "New.", if_unchanged_since: "  " }, client)).rejects.toThrow(/has changed on World Anvil/);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("checks the stamp even for a change with no text, such as an icon", async () => {
    const client = articleClient(base({}));
    await expect(update({ icon: "fa-crown", if_unchanged_since: "2026-01-01 00:00:00.000000" }, client)).rejects.toThrow(
      /has changed on World Anvil/,
    );
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("without a stamp, updates as before", async () => {
    const client = articleClient(base({ content: "[p]Old.[/p]" }));
    await update({ content: "New." }, client);
    expect(client.updateArticle).toHaveBeenCalledOnce();
  });

  it("says plainly when the article can't be read first", async () => {
    const client = articleClient(base({}), {
      getArticle: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    await expect(update({ content: "New." }, client)).rejects.toThrow(
      /Couldn't read the article before changing it \(timeout\)\. Nothing was sent/,
    );
    expect(client.updateArticle).not.toHaveBeenCalled();
  });
});
