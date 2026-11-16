/**
 * The read-back check: after a create or update, the article is read back
 * and the answer says whether what was sent is what World Anvil holds.
 * Offline: a mock client stands in for World Anvil.
 */

import { describe, it, expect, vi } from "vitest";
import { handleToolCall } from "../src/handlers.js";

const parse = (response) => JSON.parse(response.content[0].text);
const call = async (name, args, client) => {
  const response = await handleToolCall(name, args, client);
  if (response.isError) throw new Error(response.content[0].text);
  return parse(response);
};

/**
 * A stand-in World Anvil that keeps what it is sent. `tamper(article)` can
 * change what it "stores", to play a World Anvil that rewrites text.
 */
function storingClient({ tamper = (a) => a, existing = {}, overrides = {} } = {}) {
  const store = new Map(Object.entries(existing));
  return {
    store,
    listArticles: vi.fn(async () => ({ entities: [] })),
    createArticle: vi.fn(async (data) => {
      store.set("new-1", tamper({ id: "new-1", world: { id: "w1" }, ...data }));
      return { id: "new-1", title: data.title, state: data.state };
    }),
    updateArticle: vi.fn(async (id, data) => {
      store.set(id, tamper({ ...(store.get(id) ?? { id, world: { id: "w1" } }), ...data }));
      return { id, title: store.get(id).title };
    }),
    getArticle: vi.fn(async (id) => store.get(id) ?? { id, world: { id: "w1" } }),
    ...overrides,
  };
}

const create = (args, client) =>
  call("worldanvil_create_article", { title: "Frost Peaks", world_id: "w1", ...args }, client);

describe("read-back after create", () => {
  it("says the title, main text and author notes are stored as sent", async () => {
    const answer = await create({ content: "A cold range.", author_notes: "CANON: cold." }, storingClient());
    expect(answer.stored).toBe("Checked: title, main text and author notes are stored exactly as sent.");
  });

  it("names only what was sent", async () => {
    expect((await create({}, storingClient())).stored).toBe("Checked: title is stored exactly as sent.");
    expect((await create({ content: "Text." }, storingClient())).stored).toBe(
      "Checked: title and main text are stored exactly as sent.",
    );
  });

  it("checks template text fields that were sent", async () => {
    const answer = await create({ template: "Character", fields: { motto: "Stand **fast**." } }, storingClient());
    expect(answer.stored).toBe('Checked: title and field "motto" are stored exactly as sent.');
  });

  it("warns, with where they first differ, when World Anvil stores something else", async () => {
    const client = storingClient({
      tamper: (a) => ({ ...a, content: String(a.content).replace("[b]", "<b>") }),
    });
    const answer = await create({ content: "A **cold** range.", author_notes: "CANON: cold." }, client);
    expect(answer.stored).toMatch(/^WARNING: what World Anvil stored is not what was sent\. main text: sent 27 characters, stored 27; they first differ at character 6: /);
    expect(answer.stored).toContain('sent "[p]A [b]cold[/b] range.[/p]"');
    expect(answer.stored).toContain('stored "[p]A <b>cold[/b] range.[/p]"');
    expect(answer.stored).toMatch(/Nothing was retried or undone/);
    expect(answer.stored).not.toMatch(/author notes:/);
    // Reports only: one create, no correcting edit.
    expect(client.createArticle).toHaveBeenCalledOnce();
    expect(client.updateArticle).not.toHaveBeenCalled();
    expect(answer.id).toBe("new-1");
  });

  it("warns when a sent field is missing from the read-back", async () => {
    const client = storingClient({ tamper: ({ authornotes, ...rest }) => rest });
    const answer = await create({ content: "Text.", author_notes: "A note." }, client);
    expect(answer.stored).toMatch(/author notes: sent 7 characters, but the read-back holds nothing/);
  });

  it("warns, without failing, when the article can't be read back", async () => {
    const client = storingClient({
      overrides: {
        getArticle: vi.fn(async () => {
          throw new Error("503 from World Anvil");
        }),
      },
    });
    const answer = await create({ content: "Text." }, client);
    expect(answer.id).toBe("new-1");
    expect(answer.stored).toMatch(/^WARNING: the article was saved but could not be read back to check it \(503 from World Anvil\)/);
  });

  it("keeps the privacy answer alongside", async () => {
    const answer = await create({ content: "Text." }, storingClient());
    expect(answer.privacy).toBe("private");
    expect(answer.stored).toMatch(/^Checked:/);
  });
});

describe("read-back after update", () => {
  const existing = {
    a1: { id: "a1", title: "Frost Peaks", world: { id: "w1" }, content: "[p]Old.[/p]", authornotes: "Old note." },
  };
  const update = (args, client) => call("worldanvil_update_article", { article_id: "a1", ...args }, client);

  it("checks only what the update sent", async () => {
    const client = storingClient({ existing });
    const answer = await update({ author_notes: "New note." }, client);
    expect(answer.stored).toBe("Checked: author notes are stored exactly as sent.");
    expect(client.store.get("a1").content).toBe("[p]Old.[/p]");
  });

  it("reads back after the save, once", async () => {
    const client = storingClient({ existing });
    await update({ content: "New text." }, client);
    const saved = client.updateArticle.mock.invocationCallOrder[0];
    const reads = client.getArticle.mock.invocationCallOrder;
    expect(reads.filter((n) => n > saved)).toHaveLength(1);
    expect(reads.filter((n) => n < saved)).toHaveLength(1);
  });

  it("warns when the stored text differs", async () => {
    const client = storingClient({ existing, tamper: (a) => ({ ...a, content: `${a.content}\n` }) });
    const answer = await update({ content: "New text." }, client);
    expect(answer.stored).toMatch(/main text: sent 16 characters, stored 17; they first differ at character 17/);
  });

  it("does no read-back when no text was sent", async () => {
    const client = storingClient({ existing });
    const answer = await update({ icon: "fa-crown" }, client);
    expect(answer.stored).toBeUndefined();
    expect(client.getArticle).not.toHaveBeenCalled();
  });

  it("covers a rename and links together", async () => {
    const client = storingClient({
      existing,
      overrides: {
        listArticles: vi.fn(async () => ({
          entities: [{ id: "a-9", title: "Thronehold", entityClass: "Settlement" }],
        })),
      },
    });
    const answer = await update({ title: "Frost Range", content: "North of [[Thronehold]]." }, client);
    expect(answer.stored).toBe("Checked: title and main text are stored exactly as sent.");
    expect(client.store.get("a1").content).toBe("[p]North of @[Thronehold](Article:a-9).[/p]");
  });
});
