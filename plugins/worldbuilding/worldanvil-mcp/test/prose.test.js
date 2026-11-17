/**
 * A Prose article keeps its main text in `prose`, not `content`: the
 * tools take main text as `content` and put it where the template keeps
 * it. Offline.
 */

import { describe, it, expect, vi } from "vitest";
import { handleToolCall } from "../src/handlers.js";
import { mainTextField } from "../src/article-templates.js";
import { copyArticles } from "../src/copy-world.js";

const parse = (response) => JSON.parse(response.content[0].text);
const call = async (name, args, client) => {
  const response = await handleToolCall(name, args, client);
  if (response.isError) throw new Error(response.content[0].text);
  return parse(response);
};

/** One stored article, read and updated in place. */
function articleClient(article) {
  const store = { id: "a1", title: "The Long Night", state: "private", world: { id: "w1" }, ...article };
  return {
    store,
    listArticles: vi.fn(async () => ({ entities: [{ id: "a1", title: store.title }, { id: "a2", title: "Queen Elara" }] })),
    getArticle: vi.fn(async () => ({ ...store })),
    updateArticle: vi.fn(async (id, data) => {
      Object.assign(store, data);
      return { id, title: store.title };
    }),
    createArticle: vi.fn(async (data) => {
      Object.assign(store, data, { id: "a1" });
      return { id: "a1", title: data.title, state: data.state };
    }),
  };
}

describe("mainTextField", () => {
  it("is prose for a Prose article and content for every other", () => {
    expect(mainTextField({ templateType: "prose" })).toBe("prose");
    expect(mainTextField({ entityClass: "Prose" })).toBe("prose");
    expect(mainTextField("prose")).toBe("prose");
    expect(mainTextField({ templateType: "article" })).toBe("content");
    expect(mainTextField({ templateType: "document" })).toBe("content");
    expect(mainTextField({})).toBe("content");
    expect(mainTextField(null)).toBe("content");
  });
});

describe("create article: Prose", () => {
  it("sends the main text as prose, and checks that field on read-back", async () => {
    const client = articleClient({});
    const answer = await call(
      "worldanvil_create_article",
      { title: "A New Tale", world_id: "w1", template: "Prose", content: "It was dark.\n\nVery dark.", author_notes: "Draft." },
      client,
    );
    const sent = client.createArticle.mock.calls[0][0];
    expect(sent.templateType).toBe("prose");
    expect(sent.prose).toBe("[p]It was dark.[/p]\n[p]Very dark.[/p]");
    expect(sent.content).toBeUndefined();
    expect(sent.authornotes).toBe("Draft.");
    expect(answer.stored).toBe("Checked: title, main text and author notes are stored exactly as sent.");
  });

  it("a generic article still gets content", async () => {
    const client = articleClient({});
    await call("worldanvil_create_article", { title: "A New Tale", world_id: "w1", content: "It was dark." }, client);
    const sent = client.createArticle.mock.calls[0][0];
    expect(sent.content).toBe("[p]It was dark.[/p]");
    expect(sent.prose).toBeUndefined();
  });
});

describe("update article: Prose", () => {
  it("sends new main text to prose and leaves content alone", async () => {
    const client = articleClient({ templateType: "prose", content: "[p]Old stray text.[/p]", prose: "[p]First draft.[/p]" });
    const answer = await call(
      "worldanvil_update_article",
      { article_id: "a1", content: "Second draft, for [[Queen Elara]]." },
      client,
    );
    expect(client.updateArticle.mock.calls[0][1]).toEqual({ prose: "[p]Second draft, for @[Queen Elara](Article:a2).[/p]" });
    expect(client.store.content).toBe("[p]Old stray text.[/p]");
    expect(answer.stored).toBe("Checked: main text is stored exactly as sent.");
  });

  it("sends nothing when the prose box already holds exactly this text", async () => {
    const client = articleClient({ templateType: "prose", prose: "[p]First draft.[/p]" });
    const answer = await call("worldanvil_update_article", { article_id: "a1", content: "First draft." }, client);
    expect(answer.unchanged).toBe(true);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("a generic article is updated in content, as before", async () => {
    const client = articleClient({ templateType: "article", content: "[p]First.[/p]" });
    await call("worldanvil_update_article", { article_id: "a1", content: "Second." }, client);
    expect(client.updateArticle.mock.calls[0][1]).toEqual({ content: "[p]Second.[/p]" });
  });
});

describe("compare and reformat: Prose", () => {
  it("compare reads the prose box, not content", async () => {
    const client = articleClient({ templateType: "prose", content: "[p]Stray.[/p]", prose: "[p]First draft.[/p]" });
    expect((await call("worldanvil_compare_article", { article_id: "a1", content: "First draft." }, client)).status).toBe("same");
    const changed = await call("worldanvil_compare_article", { article_id: "a1", content: "Stray." }, client);
    expect(changed.status).toBe("changed");
  });

  it("reformat rewrites the prose box and leaves content alone", async () => {
    const client = articleClient({ templateType: "prose", content: "Stray old line.\nAnother.", prose: "Dark.\nVery dark.\n\n[h2]Dawn[/h2]" });
    const answer = await call("worldanvil_reformat_article", { article_id: "a1" }, client);
    expect(answer.status).toBe("reformatted");
    const sent = client.updateArticle.mock.calls[0][1];
    expect(Object.keys(sent)).toEqual(["prose"]);
    expect(sent.prose).toMatch(/^\[p\]Dark\.\[br\]/);
    expect(client.store.content).toBe("Stray old line.\nAnother.");
    expect(answer.stored).toBe("Checked: main text is stored exactly as sent.");
  });
});

describe("copy: Prose", () => {
  it("copies the prose box as the main text, and any content as stored", async () => {
    const SRC = "11111111-1111-4111-8111-111111111111";
    const TGT = "22222222-2222-4222-8222-222222222222";
    const source = {
      id: "s1",
      title: "The Long Night",
      templateType: "prose",
      state: "private",
      world: { id: SRC },
      prose: "Dark.\nVery dark.",
      content: "Stray old line.\nAnother.",
      sidenotes: "A side note.",
    };
    const made = [];
    const client = {
      getWorld: async (id) => ({ id, title: id === SRC ? "Old" : "New" }),
      listCategories: async () => ({ entities: [] }),
      listSecrets: async () => ({ entities: [] }),
      listArticles: async (world) => ({
        entities: world === SRC ? [{ id: "s1", title: source.title }] : made.map((a) => ({ id: a.id, title: a.title })),
      }),
      getArticle: async (id) => ({ ...(id === "s1" ? source : made.find((a) => a.id === id)) }),
      createArticle: async (data) => {
        made.push({ ...data, id: "t1" });
        return { id: "t1" };
      },
      updateArticle: async () => ({}),
    };
    const answer = await copyArticles(client, { source_world_id: SRC, target_world_id: TGT, confirm: true });
    expect(answer.done).toBe(true);
    expect(answer.problems).toBeUndefined();
    expect(made[0].prose).toBe("[p]Dark.[br]Very dark.[/p]");
    expect(made[0].content).toBe("Stray old line.\nAnother.");
    expect(made[0].sidenotes).toBe("A side note.");
    expect(answer.created_this_call.articles[0].check).toBe("stored as sent; reads the same as the source");
  });
});
