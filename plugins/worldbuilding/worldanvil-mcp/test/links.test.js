/**
 * [[Name]] link markers in Markdown lore become mentions of the article
 * with that title. Offline: a mock client stands in for World Anvil.
 */

import { describe, it, expect, vi } from "vitest";
import { handleToolCall } from "../src/handlers.js";
import { linkMarkerNames, linkMarkers, replaceLinkMarkers } from "../src/utils.js";
import { getToolDefinitions } from "../src/tools.js";

const parse = (response) => JSON.parse(response.content[0].text);
const call = async (name, args, client) => {
  const response = await handleToolCall(name, args, client);
  if (response.isError) throw new Error(response.content[0].text);
  return parse(response);
};

/** How many times the article was read BEFORE the save (the read-back after it is not counted). */
const readsBeforeSave = (client) => {
  const saved = client.updateArticle.mock.invocationCallOrder[0] ?? Infinity;
  return client.getArticle.mock.invocationCallOrder.filter((n) => n < saved).length;
};

const ARTICLES = [
  { id: "a-1", title: "Queen Elara", entityClass: "Person", state: "private" },
  { id: "a-2", title: "Thronehold", entityClass: "Settlement", state: "private" },
  { id: "a-3", title: "The Iron Mountains", entityClass: "Location", state: "private" },
  { id: "a-4", title: "Silver Order", entityClass: "Organization", state: "private" },
  { id: "a-5", title: "silver order", entityClass: "Article", state: "private" },
];

function worldClient(articles = ARTICLES, overrides = {}) {
  return {
    listArticles: vi.fn(async (worldId, { offset = 0, limit = 50 } = {}) => ({
      entities: articles.slice(offset, offset + limit),
    })),
    createArticle: vi.fn(async (data) => ({ id: "new-1", title: data.title, state: data.state })),
    updateArticle: vi.fn(async (id, data) => ({ id, ...data })),
    getArticle: vi.fn(async (id) => {
      const known = articles.find((a) => a.id === id);
      return { id, title: known?.title ?? "Some Article", state: "private", world: { id: "w1" } };
    }),
    ...overrides,
  };
}

const create = (args, client) =>
  call("worldanvil_create_article", { title: "Frost Peaks", world_id: "w1", ...args }, client);
const sent = (client) => client.createArticle.mock.calls[0][0];

describe("link markers in text", () => {
  it("lists each name once, in order, capitals and spacing aside", () => {
    expect(linkMarkerNames("[[Queen Elara]] rules [[Thronehold]]. [[ queen  elara ]] again.")).toEqual([
      "Queen Elara",
      "Thronehold",
    ]);
    expect(linkMarkerNames("No links here, [not one], [b]nor[/b] this.")).toEqual([]);
  });

  it("ignores markers inside code", () => {
    const text = "Write `[[Name]]` to link.\n\n```\n[[Fenced]]\n```\n\n[code][[Tagged]][/code] but [[Real]].";
    expect(linkMarkerNames(text)).toEqual(["Real"]);
    expect(replaceLinkMarkers(text, (n) => `<${n}>`)).toBe(
      "Write `[[Name]]` to link.\n\n```\n[[Fenced]]\n```\n\n[code][[Tagged]][/code] but <Real>.",
    );
  });

  it("reads a marker's own shown text, and the name before the bar", () => {
    const text = "See [[Queen Elara|the queen]], [[ Thronehold | her seat ]] and [[Queen Elara]].";
    expect(linkMarkers(text)).toEqual([
      { name: "Queen Elara", shown: "the queen" },
      { name: "Thronehold", shown: "her seat" },
      { name: "Queen Elara", shown: null },
    ]);
    expect(linkMarkerNames(text)).toEqual(["Queen Elara", "Thronehold"]);
    expect(replaceLinkMarkers(text, (n, s) => `<${n}:${s}>`)).toBe(
      "See <Queen Elara:the queen>, <Thronehold:her seat> and <Queen Elara:null>.",
    );
  });

  it("refuses a marker with no name or empty shown text", () => {
    for (const text of ["[[|the queen]]", "[[Queen Elara|]]", "[[ | ]]", "[[  ]]"])
      expect(() => linkMarkers(text), text).toThrow(/is not a complete link/);
  });
});

describe("create article with [[links]]", () => {
  it("turns a found name into a mention, using the article's real title", async () => {
    const client = worldClient();
    const answer = await create({ content: "Ruled by [[queen elara]] from [[Thronehold]]." }, client);
    expect(sent(client).content).toBe(
      "[p]Ruled by @[Queen Elara](Article:a-1) from @[Thronehold](Article:a-2).[/p]",
    );
    expect(answer.links).toEqual({
      linked: [
        { name: "queen elara", title: "Queen Elara", id: "a-1" },
        { name: "Thronehold", title: "Thronehold", id: "a-2" },
      ],
      plain: [],
    });
  });

  it("links every marked occurrence, in main text and author notes", async () => {
    const client = worldClient();
    await create(
      { content: "[[Thronehold]] is old.\n\nVery old, [[Thronehold]].", author_notes: "Check [[Queen Elara]]." },
      client,
    );
    expect(sent(client).content).toBe(
      "[p]@[Thronehold](Article:a-2) is old.[/p]\n[p]Very old, @[Thronehold](Article:a-2).[/p]",
    );
    expect(sent(client).authornotes).toBe("Check @[Queen Elara](Article:a-1).");
  });

  it("reads the world's article list once for the title check and the links", async () => {
    const client = worldClient();
    await create({ content: "[[Queen Elara]] and [[Thronehold]]." }, client);
    expect(client.listArticles).toHaveBeenCalledTimes(1);
  });

  it("by default keeps a name with no article as a placeholder in the text, and says which", async () => {
    const client = worldClient();
    const answer = await create(
      { content: "[[Queen Elara]] visited [[Nowhere]], [[Nowhere|a lost place]] and the [[Silver Order]]." },
      client,
    );
    expect(sent(client).content).toBe(
      "[p]@[Queen Elara](Article:a-1) visited {{Nowhere}}, {{Nowhere|a lost place}} and the {{Silver Order}}.[/p]",
    );
    expect(answer.links.linked.map((l) => l.id)).toEqual(["a-1"]);
    expect(answer.links.plain).toEqual([]);
    expect(answer.links.waiting).toEqual([
      { name: "Nowhere", why: "no article with this title", shown_as: ["a lost place"] },
      { name: "Silver Order", why: "2 articles share this title (ids a-4, a-5)" },
    ]);
    // The session is told in words, so it can tell the user.
    expect(answer.links.tell_the_user).toMatch(
      /^2 links were not made and are kept in the text as placeholders: \{\{Nowhere\}\}, \{\{Silver Order\}\}\. Tell the user/,
    );
    expect(answer.links.tell_the_user).toMatch(/If one is not wanted.*unresolved_links: "plain"/);
  });

  it("takes a link written in curly brackets just like one in square brackets", async () => {
    const client = worldClient();
    const answer = await create({ content: "{{Queen Elara}} and {{queen elara|the queen}} visited {{Nowhere|a lost place}}." }, client);
    expect(sent(client).content).toBe(
      "[p]@[Queen Elara](Article:a-1) and @[the queen](Article:a-1) visited {{Nowhere|a lost place}}.[/p]",
    );
    expect(answer.links.waiting.map((w) => w.name)).toEqual(["Nowhere"]);
    expect(linkMarkerNames("[[One]] then {{Two}} then {{ one }}, not {single} or [single].")).toEqual(["One", "Two"]);
  });

  it("says nothing of the kind when every link was made", async () => {
    const answer = await create({ content: "[[Queen Elara]] rules." }, worldClient());
    expect(answer.links.waiting).toBeUndefined();
    expect(answer.links.tell_the_user).toBeUndefined();
  });

  it("keeps placeholders in author notes too, and through headings and lists", async () => {
    const client = worldClient();
    await create({ content: "## About [[Nowhere]]\n\n- See [[Nowhere]]", author_notes: "TODO: write [[Nowhere]]." }, client);
    expect(sent(client).content).toMatch(/\]About \{\{Nowhere\}\}\[\/h2\]/);
    expect(sent(client).content).toMatch(/- See \{\{Nowhere\}\}/);
    expect(sent(client).authornotes).toBe("TODO: write {{Nowhere}}.");
  });

  it("with unresolved_links refuse: sends nothing when a name has no article, and suggests near ones", async () => {
    const client = worldClient();
    await expect(
      create({ content: "Near the [[Iron Mountains]] and [[Nowhere]].", unresolved_links: "refuse" }, client),
    ).rejects.toThrow(
      /2 links could not be made\. \[\[Iron Mountains\]\]: no article with this title \(near: "The Iron Mountains"\); \[\[Nowhere\]\]: no article with this title\. Nothing was sent\..*leave unresolved_links out/s,
    );
    expect(client.createArticle).not.toHaveBeenCalled();
  });

  it("refuses when several articles share the name", async () => {
    const client = worldClient();
    await expect(create({ content: "The [[Silver Order]].", unresolved_links: "refuse" }, client)).rejects.toThrow(
      /A link could not be made\. \[\[Silver Order\]\]: 2 articles share this title \(ids a-4, a-5\)/,
    );
    expect(client.createArticle).not.toHaveBeenCalled();
  });

  it('with unresolved_links "plain", sends unlinkable names as text and says which', async () => {
    const client = worldClient();
    const answer = await create(
      { content: "[[Queen Elara]] visited [[Nowhere]] and the [[Silver Order]].", unresolved_links: "plain" },
      client,
    );
    expect(sent(client).content).toBe("[p]@[Queen Elara](Article:a-1) visited Nowhere and the Silver Order.[/p]");
    expect(answer.links.linked.map((l) => l.id)).toEqual(["a-1"]);
    expect(answer.links.plain).toEqual([
      { name: "Nowhere", why: "no article with this title" },
      { name: "Silver Order", why: "2 articles share this title (ids a-4, a-5)" },
    ]);
  });

  it("an article naming itself is plain text, with no refusal", async () => {
    const client = worldClient();
    const answer = await create({ content: "[[frost peaks]] is cold. See [[Thronehold]]." }, client);
    expect(sent(client).content).toBe("[p]frost peaks is cold. See @[Thronehold](Article:a-2).[/p]");
    expect(answer.links.plain).toEqual([{ name: "frost peaks", why: "the article itself" }]);
  });

  it("leaves markers alone in code and in bbcode-format text", async () => {
    const client = worldClient();
    const answer = await create({ content: "Type `[[Nowhere]]` to link." }, client);
    expect(sent(client).content).toContain("[[Nowhere]]");
    expect(answer.links).toBeUndefined();

    const raw = worldClient();
    await create({ content: "[p][[Nowhere]][/p]", format: "bbcode" }, raw);
    expect(sent(raw).content).toBe("[p][[Nowhere]][/p]");
  });

  it("a link with its own shown text displays those words and links by the name", async () => {
    const client = worldClient();
    const answer = await create(
      { content: "Ruled by [[queen elara|the Queen]] and, later, [[Queen Elara]] alone, from [[Thronehold|her seat]]." },
      client,
    );
    expect(sent(client).content).toBe(
      "[p]Ruled by @[the Queen](Article:a-1) and, later, @[Queen Elara](Article:a-1) alone, from @[her seat](Article:a-2).[/p]",
    );
    expect(answer.links.linked).toEqual([
      { name: "queen elara", title: "Queen Elara", id: "a-1", shown_as: ["the Queen"] },
      { name: "Thronehold", title: "Thronehold", id: "a-2", shown_as: ["her seat"] },
    ]);
  });

  it("an unlinkable or self link with shown text is sent as the shown words", async () => {
    const client = worldClient();
    const answer = await create(
      { content: "[[Nowhere|a lost place]] lies past [[Frost Peaks|these peaks]].", unresolved_links: "plain" },
      client,
    );
    expect(sent(client).content).toBe("[p]a lost place lies past these peaks.[/p]");
    expect(answer.links.plain).toEqual([
      { name: "Nowhere", why: "no article with this title", shown_as: ["a lost place"] },
      { name: "Frost Peaks", why: "the article itself", shown_as: ["these peaks"] },
    ]);
  });

  it("still refuses an unlinkable name that has shown text", async () => {
    const client = worldClient();
    await expect(create({ content: "[[Nowhere|a lost place]].", unresolved_links: "refuse" }, client)).rejects.toThrow(
      /\[\[Nowhere\]\]: no article with this title/,
    );
    expect(client.createArticle).not.toHaveBeenCalled();
  });

  it("refuses an unknown unresolved_links value", async () => {
    await expect(create({ content: "x", unresolved_links: "guess" }, worldClient())).rejects.toThrow(
      /unresolved_links must be "keep", "plain" or "refuse"/,
    );
  });

  it("says nothing about links when the text has none", async () => {
    const answer = await create({ content: "Plain lore." }, worldClient());
    expect(answer.links).toBeUndefined();
  });
});

describe("update article with [[links]]", () => {
  const update = (args, client) => call("worldanvil_update_article", { article_id: "a-2", ...args }, client);

  it("looks names up in the article's own world, reading the article once", async () => {
    const client = worldClient();
    const answer = await update({ content: "Seat of [[Queen Elara]]." }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a-2", { content: "[p]Seat of @[Queen Elara](Article:a-1).[/p]" });
    expect(readsBeforeSave(client)).toBe(1);
    expect(client.listArticles.mock.calls[0][0]).toBe("w1");
    expect(answer.links.linked).toEqual([{ name: "Queen Elara", title: "Queen Elara", id: "a-1" }]);
  });

  it("never links an article to itself", async () => {
    const client = worldClient();
    const answer = await update({ content: "[[Thronehold]] stands. [[Queen Elara]] rules." }, client);
    expect(client.updateArticle.mock.calls[0][1].content).toBe(
      "[p]Thronehold stands. @[Queen Elara](Article:a-1) rules.[/p]",
    );
    expect(answer.links.plain).toEqual([{ name: "Thronehold", why: "the article itself" }]);
  });

  it("by default an update keeps an unlinkable name as a placeholder", async () => {
    const client = worldClient();
    const answer = await update({ author_notes: "Ask about [[Nowhere]]." }, client);
    expect(client.updateArticle.mock.calls[0][1]).toEqual({ authornotes: "Ask about {{Nowhere}}." });
    expect(answer.links.waiting.map((w) => w.name)).toEqual(["Nowhere"]);
    expect(answer.links.tell_the_user).toMatch(/^1 link was not made and is kept in the text as a placeholder: \{\{Nowhere\}\}/);
  });

  it("with unresolved_links refuse: refuses an unlinkable name and changes nothing", async () => {
    const client = worldClient();
    await expect(update({ author_notes: "Ask about [[Nowhere]].", unresolved_links: "refuse" }, client)).rejects.toThrow(
      /A link could not be made.*Nothing was sent/s,
    );
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("a rename with links reads the article and the list once each", async () => {
    const client = worldClient();
    await update({ title: "Thronehold Keep", content: "# Thronehold Keep\n\nSeat of [[Queen Elara]]." }, client);
    expect(client.updateArticle.mock.calls[0][1]).toEqual({
      title: "Thronehold Keep",
      content: "[p]Seat of @[Queen Elara](Article:a-1).[/p]",
    });
    expect(readsBeforeSave(client)).toBe(1);
    expect(client.listArticles).toHaveBeenCalledTimes(1);
  });

  it("an update with no links and no heading reads the article once and no list", async () => {
    const client = worldClient();
    await update({ content: "Plain text." }, client);
    expect(readsBeforeSave(client)).toBe(1);
    expect(client.listArticles).not.toHaveBeenCalled();
  });

  it("refuses when the article's world can't be told", async () => {
    const client = worldClient(ARTICLES, { getArticle: vi.fn(async (id) => ({ id, title: "T" })) });
    await expect(update({ content: "[[Queen Elara]]" }, client)).rejects.toThrow(
      /Could not tell which world.*\[\[links\]\].*Nothing was sent/s,
    );
    expect(client.updateArticle).not.toHaveBeenCalled();
  });
});

describe("tool definitions", () => {
  it("both article tools offer unresolved_links", () => {
    for (const name of ["worldanvil_create_article", "worldanvil_update_article"]) {
      const tool = getToolDefinitions().find((t) => t.name === name);
      expect(tool.inputSchema.properties.unresolved_links.enum, name).toEqual(["keep", "plain", "refuse"]);
      expect(tool.description, name).toMatch(/\[\[/);
    }
  });
});
