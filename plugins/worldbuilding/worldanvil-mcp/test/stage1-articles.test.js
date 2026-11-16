/**
 * Stage 1: article templates, variants, icons, privacy, listing and the
 * world outline. Offline: a mock client stands in for World Anvil.
 */

import { describe, it, expect, vi } from "vitest";
import { handleToolCall } from "../src/handlers.js";
import {
  CATEGORY_DEFAULT_ICON,
  TEMPLATES,
  metadataWithVariant,
  resolveIcon,
  resolveTemplate,
  templateOfArticle,
  variantOf,
} from "../src/article-templates.js";
import { listAll, listPage, PROVEN_PAGE } from "../src/listing.js";
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

/** What the site was read to give each tile, 2026-11-12. */
const EXPECTED = [
  ["Generic", "article", null, "fa-books"],
  ["Building", "landmark", null, "fa-chart-pyramid"],
  ["Character", "person", null, "fa-person"],
  ["Geography", "location", null, "fa-mountain-sun"],
  ["Item", "item", null, "fa-sword"],
  ["Organization", "organization", null, "fa-gear"],
  ["Species", "species", null, "fa-fish-fins"],
  ["Vehicle", "vehicle", null, "fa-horse-saddle"],
  ["Settlement", "settlement", null, "fa-building-columns"],
  ["Condition", "condition", null, "fa-biohazard"],
  ["Conflict", "militaryConflict", null, "fa-swords"],
  ["Document", "document", null, "fa-scroll-old"],
  ["Culture / Ethnicity", "ethnicity", null, "fa-shoe-prints"],
  ["Language", "language", null, "fa-sign-hanging"],
  ["Material", "material", null, "fa-coins"],
  ["Military Formation", "formation", null, "fa-hammer-crash"],
  ["Myth", "myth", null, "fa-dragon"],
  ["Natural Law", "law", null, "fa-cloud-bolt"],
  ["Plot", "plot", null, "fa-staff"],
  ["Profession", "profession", null, "fa-hammer"],
  ["Prose", "prose", null, "fa-gem"],
  ["Title", "rank", null, "fa-crown"],
  ["Spell", "spell", null, "fa-wand-magic-sparkles"],
  ["Technology", "technology", null, "fa-vial"],
  ["Tradition", "ritual", null, "fa-heart"],
  ["Session Report", "report", null, "fa-book-sparkles"],
  ["Country", "organization", "country", "fa-fort"],
  ["Military", "organization", "military", "fa-flag-swallowtail"],
  ["Religion", "organization", "religion", "fa-ankh"],
  ["God/Deity", "person", "deity", "fa-omega"],
];

function articleClient(overrides = {}) {
  return {
    createArticle: vi.fn(async (data) => ({ id: "new-1", title: data.title, state: data.state })),
    updateArticle: vi.fn(async (id, data) => ({ id, ...data })),
    getArticle: vi.fn(async (id) => ({ id, state: "private", world: { id: "w1" } })),
    // The title check before a create or rename: an empty world.
    listArticles: vi.fn(async () => ({ entities: [] })),
    createCategory: vi.fn(async (data) => ({ id: "cat-1", ...data })),
    updateCategory: vi.fn(async (id, data) => ({ id, ...data })),
    ...overrides,
  };
}

describe("template table", () => {
  it("has the 30 tiles on the site's new-article screen", () => {
    expect(TEMPLATES).toHaveLength(30);
    expect(new Set(TEMPLATES.map((t) => t.siteName)).size).toBe(30);
  });

  it.each(EXPECTED)("%s -> %s (variant %s, icon %s)", (siteName, templateType, variant, icon) => {
    expect(resolveTemplate(siteName)).toEqual({ siteName, templateType, variant, icon });
  });

  it("accepts every API name for a plain template", () => {
    for (const [siteName, templateType, variant] of EXPECTED)
      if (!variant) expect(resolveTemplate(templateType).siteName).toBe(siteName);
  });

  it("is forgiving about case, spaces and punctuation", () => {
    expect(resolveTemplate("character").templateType).toBe("person");
    expect(resolveTemplate("natural law").templateType).toBe("law");
    expect(resolveTemplate("Culture/Ethnicity").templateType).toBe("ethnicity");
    expect(resolveTemplate("god / deity").variant).toBe("deity");
    expect(resolveTemplate("deity").variant).toBe("deity");
    expect(resolveTemplate("MILITARYCONFLICT").templateType).toBe("militaryConflict");
  });

  it("gives Generic when no template is named", () => {
    expect(resolveTemplate(undefined).templateType).toBe("article");
  });

  it("refuses an unknown name and lists the valid ones", () => {
    expect(() => resolveTemplate("kingdom")).toThrow(/not an article template.*Character.*Country/s);
    expect(() => resolveTemplate(42)).toThrow(/not an article template/);
  });

  it("recognises an article World Anvil returns", () => {
    expect(templateOfArticle({ templateType: "person" }).siteName).toBe("Character");
    expect(templateOfArticle({ entityClass: "MilitaryConflict" }).siteName).toBe("Conflict");
    expect(
      templateOfArticle({ templateType: "organization", articleMetadata: '{ "variant": "country" }' }).siteName,
    ).toBe("Country");
    // An unknown variant falls back to the base template.
    expect(
      templateOfArticle({ templateType: "organization", articleMetadata: '{ "variant": "guild" }' }).siteName,
    ).toBe("Organization");
    expect(templateOfArticle({ templateType: "widget" })).toBeNull();
  });

  it("reads and writes the variant the way the site stores it", () => {
    expect(metadataWithVariant(null, "country")).toBe('{ "variant": "country" }');
    expect(variantOf('{ "variant": "country" }')).toBe("country");
    expect(variantOf("not json")).toBeNull();
    expect(variantOf(null)).toBeNull();
    // Anything else already in the metadata is kept.
    expect(JSON.parse(metadataWithVariant('{"other":1,"variant":"military"}', "religion"))).toEqual({
      other: 1,
      variant: "religion",
    });
  });
});

describe("icon argument", () => {
  it("stores a chosen icon as the site's picker does", () => {
    expect(resolveIcon("fa-dragon")).toBe("fa-solid fa-dragon");
    expect(resolveIcon("dragon")).toBe("fa-solid fa-dragon");
    expect(resolveIcon("fa-solid fa-dragon")).toBe("fa-solid fa-dragon");
    expect(resolveIcon("fa-duotone fa-wand-magic-sparkles")).toBe("fa-duotone fa-wand-magic-sparkles");
    expect(resolveIcon("Duotone dragon")).toBe("fa-duotone fa-dragon");
  });

  it('"default" gives World Anvil\'s own icon', () => {
    expect(resolveIcon("default", "fa-person")).toBe("fa-person");
    expect(resolveIcon(" Default ", CATEGORY_DEFAULT_ICON)).toBe("fas fa-folder");
    expect(() => resolveIcon("default")).toThrow(/Can't tell what the default icon is/);
  });

  it("refuses anything else, including removing an icon", () => {
    for (const bad of ["", "   ", null, 7, "ra ra-crystal-ball", "fa-brands fa-github", "<b>", "fa-a b c"])
      expect(() => resolveIcon(bad, "fa-person")).toThrow(/icon/);
  });

  it("no tool description still advertises RPG-Awesome icons", () => {
    expect(JSON.stringify(getToolDefinitions())).not.toMatch(/RPG-Awesome|ra ra-/);
  });
});

describe("create article", () => {
  it("sends the template, its icon and private, and reports them", async () => {
    const client = articleClient();
    const result = await call(
      "worldanvil_create_article",
      { title: "Aldric", world_id: "w1", template: "Character" },
      client,
    );
    expect(client.createArticle).toHaveBeenCalledWith({
      title: "Aldric",
      world: { id: "w1" },
      templateType: "person",
      icon: "fa-person",
      state: "private",
    });
    expect(result).toMatchObject({ template: "Character", icon: "fa-person", privacy: "private" });
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("defaults to a Generic article", async () => {
    const client = articleClient();
    await call("worldanvil_create_article", { title: "Primer", world_id: "w1" }, client);
    expect(client.createArticle.mock.calls[0][0]).toMatchObject({ templateType: "article", icon: "fa-books" });
  });

  it("creates a variant as its base template plus metadata", async () => {
    const client = articleClient();
    await call("worldanvil_create_article", { title: "Valdor", world_id: "w1", template: "Country" }, client);
    expect(client.createArticle.mock.calls[0][0]).toMatchObject({
      templateType: "organization",
      articleMetadata: '{ "variant": "country" }',
      icon: "fa-fort",
    });
  });

  it("uses a chosen icon instead of the default", async () => {
    const client = articleClient();
    await call(
      "worldanvil_create_article",
      { title: "Wyrm", world_id: "w1", template: "Species", icon: "fa-duotone fa-dragon" },
      client,
    );
    expect(client.createArticle.mock.calls[0][0].icon).toBe("fa-duotone fa-dragon");
  });

  it("refuses an unknown template or icon before anything is sent", async () => {
    const client = articleClient();
    const bad = await handleToolCall(
      "worldanvil_create_article",
      { title: "X", world_id: "w1", template: "kingdom" },
      client,
    );
    expect(bad.isError).toBe(true);
    const badIcon = await handleToolCall(
      "worldanvil_create_article",
      { title: "X", world_id: "w1", icon: "ra ra-sword" },
      client,
    );
    expect(badIcon.isError).toBe(true);
    expect(client.createArticle).not.toHaveBeenCalled();
  });

  it("still can't be made public or re-iconed through fields", async () => {
    const client = articleClient();
    const res = await handleToolCall(
      "worldanvil_create_article",
      { title: "X", world_id: "w1", fields: { state: "public" } },
      client,
    );
    expect(res.isError).toBe(true);
    expect(client.createArticle).not.toHaveBeenCalled();

    await call("worldanvil_create_article", { title: "Y", world_id: "w1", fields: { icon: "fa-x" } }, client);
    expect(client.createArticle.mock.calls[0][0].icon).toBe("fa-books");
  });

  it("writes the main text as paragraphs and keeps author notes apart", async () => {
    const client = articleClient();
    await call(
      "worldanvil_create_article",
      {
        title: "Example Place",
        world_id: "w1",
        content: "An **ancient** being.\n\n- bound\n- patient",
        author_notes: "SECRET: he is the library's power.\nTO DEVELOP: his escape.",
      },
      client,
    );
    const sent = client.createArticle.mock.calls[0][0];
    expect(sent.content).toBe("[p]An [b]ancient[/b] being.[/p]\n[ul]\n- bound\n- patient\n[/ul]");
    expect(sent.authornotes).toBe("[p]SECRET: he is the library's power.[br]TO DEVELOP: his escape.[/p]");
  });

  it("leaves a one-line author note bare, and sends none when none is given", async () => {
    const client = articleClient();
    await call("worldanvil_create_article", { title: "A", world_id: "w1", content: "Text", author_notes: "CANON: one place." }, client);
    expect(client.createArticle.mock.calls[0][0].authornotes).toBe("CANON: one place.");
    await call("worldanvil_create_article", { title: "B", world_id: "w1", content: "Text" }, client);
    expect("authornotes" in client.createArticle.mock.calls[1][0]).toBe(false);
  });

  it('format "bbcode" sends content and author notes exactly as written', async () => {
    const client = articleClient();
    const content = "# not converted\n**nor this**";
    await call("worldanvil_create_article", { title: "A", world_id: "w1", content, author_notes: "*as is*", format: "bbcode" }, client);
    const sent = client.createArticle.mock.calls[0][0];
    expect(sent.content).toBe(content);
    expect(sent.authornotes).toBe("*as is*");
  });

  it("refuses an unknown format before anything is sent", async () => {
    const client = articleClient();
    const res = await handleToolCall("worldanvil_create_article", { title: "A", world_id: "w1", content: "x", format: "html" }, client);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/format must be "markdown" or "bbcode"/);
    expect(client.createArticle).not.toHaveBeenCalled();
  });

  it("the author_notes entry wins over one passed through fields", async () => {
    const client = articleClient();
    await call(
      "worldanvil_create_article",
      { title: "A", world_id: "w1", author_notes: "from the entry", fields: { authornotes: "from fields" } },
      client,
    );
    expect(client.createArticle.mock.calls[0][0].authornotes).toBe("from the entry");
  });

  it("an update changes only what is passed: notes alone leave the main text out", async () => {
    const client = articleClient();
    await call("worldanvil_update_article", { article_id: "a1", author_notes: "TO DEVELOP: her name." }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", { authornotes: "TO DEVELOP: her name." });
    await call("worldanvil_update_article", { article_id: "a1", content: "New text." }, client);
    expect(client.updateArticle).toHaveBeenLastCalledWith("a1", { content: "[p]New text.[/p]" });
  });

  it("reads the article back when the create answer doesn't say its state", async () => {
    const client = articleClient({ createArticle: vi.fn(async () => ({ id: "new-1" })) });
    const result = await call("worldanvil_create_article", { title: "A", world_id: "w1" }, client);
    expect(client.getArticle).toHaveBeenCalledWith("new-1");
    expect(result.privacy).toBe("private");
  });

  it("sets it private straight away if World Anvil made it public", async () => {
    let state = "public";
    const client = articleClient({
      createArticle: vi.fn(async () => ({ id: "new-1", state })),
      updateArticle: vi.fn(async () => {
        state = "private";
        return {};
      }),
      getArticle: vi.fn(async (id) => ({ id, state })),
    });
    const result = await call("worldanvil_create_article", { title: "A", world_id: "w1" }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("new-1", { state: "private" });
    expect(result.privacy).toMatch(/^private \(World Anvil created it as "public"/);
  });

  it("warns plainly if it can't be made private", async () => {
    const stuck = articleClient({
      createArticle: vi.fn(async () => ({ id: "new-1", state: "public" })),
      getArticle: vi.fn(async (id) => ({ id, state: "public" })),
    });
    expect((await call("worldanvil_create_article", { title: "A", world_id: "w1" }, stuck)).privacy).toMatch(
      /^WARNING: World Anvil created it as "public" and it could not be set to private/,
    );

    const failing = articleClient({
      createArticle: vi.fn(async () => ({ id: "new-1", state: "public" })),
      updateArticle: vi.fn(async () => {
        throw new Error("refused");
      }),
    });
    const result = await call("worldanvil_create_article", { title: "A", world_id: "w1" }, failing);
    expect(result.privacy).toMatch(/^WARNING: Couldn't confirm it is private \(refused\)/);
    expect(result.id).toBe("new-1"); // the article was still created, and says so
  });
});

describe("update article: icon and variant", () => {
  const existing = (article) =>
    articleClient({ getArticle: vi.fn(async (id) => ({ id, world: { id: "w1" }, ...article })) });

  it("sets a chosen icon without reading the article first", async () => {
    const client = existing({});
    await call("worldanvil_update_article", { article_id: "a1", icon: "fa-crown" }, client);
    expect(client.getArticle).not.toHaveBeenCalled();
    expect(client.updateArticle).toHaveBeenCalledWith("a1", { icon: "fa-solid fa-crown" });
  });

  it('"default" resets to the template\'s icon', async () => {
    const client = existing({ templateType: "person", icon: "fa-solid fa-crown" });
    await call("worldanvil_update_article", { article_id: "a1", icon: "default" }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", { icon: "fa-person" });
  });

  it('"default" on a variant resets to the variant\'s icon', async () => {
    const client = existing({
      templateType: "organization",
      articleMetadata: '{ "variant": "religion" }',
      icon: "",
    });
    await call("worldanvil_update_article", { article_id: "a1", icon: "default" }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", { icon: "fa-ankh" });
  });

  it("refuses a reset when the template is unknown", async () => {
    const client = existing({ templateType: "widget" });
    const res = await handleToolCall("worldanvil_update_article", { article_id: "a1", icon: "default" }, client);
    expect(res.isError).toBe(true);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("switches to a variant and moves the default icon with it", async () => {
    const client = existing({ templateType: "organization", icon: "fa-gear" });
    await call("worldanvil_update_article", { article_id: "a1", template: "Country" }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", {
      articleMetadata: '{ "variant": "country" }',
      icon: "fa-fort",
    });
  });

  it("keeps an icon the writer picked when the variant changes", async () => {
    const client = existing({ templateType: "organization", icon: "fa-solid fa-dragon" });
    await call("worldanvil_update_article", { article_id: "a1", template: "Religion" }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", { articleMetadata: '{ "variant": "religion" }' });
  });

  it("refuses a change to a different template", async () => {
    const client = existing({ templateType: "person", icon: "fa-person" });
    const res = await handleToolCall("worldanvil_update_article", { article_id: "a1", template: "Country" }, client);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/This article is a Character/);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("refuses turning a variant back into the plain template", async () => {
    const client = existing({ templateType: "organization", articleMetadata: '{ "variant": "country" }' });
    const res = await handleToolCall(
      "worldanvil_update_article",
      { article_id: "a1", template: "Organization" },
      client,
    );
    expect(res.isError).toBe(true);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("naming the template it already is changes nothing", async () => {
    const client = existing({ templateType: "person", icon: "fa-person" });
    await call("worldanvil_update_article", { article_id: "a1", template: "Character", title: "T" }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("a1", { title: "T" });
  });
});

describe("one title, one article", () => {
  const world = (...articles) => ({
    listArticles: vi.fn(async (worldId, { offset = 0, limit = 50 } = {}) => ({
      entities: articles.slice(offset, offset + limit),
    })),
  });
  const mountains = { id: "a-9", title: "Iron Mountains", entityClass: "Location", state: "private" };
  const create = (title, client) =>
    call("worldanvil_create_article", { title, world_id: "w1", template: "Geography" }, client);

  it("refuses a create whose title another article has, and sends nothing", async () => {
    const client = articleClient(world(mountains));
    await expect(create("Iron Mountains", client)).rejects.toThrow(
      /already has an article with that title: "Iron Mountains" \(Geography, id a-9, private\).*Nothing was sent.*different title.*worldanvil_update_article/s,
    );
    expect(client.createArticle).not.toHaveBeenCalled();
    expect(client.listArticles.mock.calls[0][0]).toBe("w1");
  });

  it("capitals and extra spaces make no difference", async () => {
    for (const title of ["iron mountains", "  IRON   Mountains ", "Iron	Mountains"]) {
      const client = articleClient(world(mountains));
      await expect(create(title, client)).rejects.toThrow(/already has an article/);
      expect(client.createArticle).not.toHaveBeenCalled();
    }
  });

  it("a title that only resembles another is allowed", async () => {
    for (const title of ["The Iron Mountains", "Iron Mountain", "Iron-Mountains"]) {
      const client = articleClient(world(mountains));
      await create(title, client);
      expect(client.createArticle).toHaveBeenCalledOnce();
    }
  });

  it("finds a clash beyond the first page of the list", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `a-${i}`, title: `Place ${i}` }));
    const client = articleClient(world(...many, { id: "a-last", title: "Far Shore" }));
    await expect(create("far shore", client)).rejects.toThrow(/id a-last/);
    expect(client.listArticles.mock.calls.length).toBeGreaterThan(1);
  });

  it("names every article that has the title", async () => {
    const client = articleClient(world(mountains, { id: "a-10", title: "IRON MOUNTAINS" }));
    await expect(create("Iron Mountains", client)).rejects.toThrow(/already has 2 articles.*a-9.*a-10/s);
  });

  it("refuses a rename to a title another article has", async () => {
    const client = articleClient(world(mountains, { id: "a1", title: "Old Name" }));
    await expect(
      call("worldanvil_update_article", { article_id: "a1", title: "iron mountains" }, client),
    ).rejects.toThrow(/already has an article with that title/);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });

  it("an article may keep, or re-case, its own title", async () => {
    const client = articleClient(world(mountains));
    await call("worldanvil_update_article", { article_id: "A-9", title: "IRON Mountains" }, client);
    expect(client.updateArticle).toHaveBeenCalledWith("A-9", { title: "IRON Mountains" });
  });

  it("an update that leaves the title alone reads no list", async () => {
    const client = articleClient(world(mountains));
    await call("worldanvil_update_article", { article_id: "a1", content: "New text." }, client);
    expect(client.listArticles).not.toHaveBeenCalled();
    expect(readsBeforeSave(client)).toBe(0);
  });

  it("refuses a rename when the article's world can't be told", async () => {
    const client = articleClient({ ...world(mountains), getArticle: vi.fn(async (id) => ({ id })) });
    await expect(
      call("worldanvil_update_article", { article_id: "a1", title: "Anything" }, client),
    ).rejects.toThrow(/Could not tell which world.*Nothing was sent/s);
    expect(client.updateArticle).not.toHaveBeenCalled();
  });
});

describe("an opening heading that repeats the title", () => {
  const create = (args, client) =>
    call("worldanvil_create_article", { title: "Iron Mountains", world_id: "w1", ...args }, client);
  const sent = (client) => client.createArticle.mock.calls[0][0].content;

  it("is left out on create, and the answer says so", async () => {
    const client = articleClient();
    const answer = await create({ content: "# Iron Mountains\n\nA cold range.\n\nSecond paragraph." }, client);
    expect(sent(client)).toBe("[p]A cold range.[/p]\n[p]Second paragraph.[/p]");
    expect(answer.title_heading).toMatch(/"# Iron Mountains" was left out because it repeats the article's title/);
  });

  it("matches at any level, whatever the capitals, spaces or emphasis", async () => {
    for (const heading of ["## iron mountains", "###   IRON   Mountains  ", "# **Iron Mountains**", "\n\n#### _Iron Mountains_", "# Iron Mountains #"]) {
      const client = articleClient();
      await create({ content: `${heading}\n\nA cold range.` }, client);
      expect(sent(client), heading).toBe("[p]A cold range.[/p]");
    }
  });

  it("keeps a heading that only contains the title, and says nothing", async () => {
    for (const heading of ["# Iron Mountains: Overview", "# The Iron Mountains", "# Overview"]) {
      const client = articleClient();
      const answer = await create({ content: `${heading}\n\nA cold range.` }, client);
      expect(sent(client), heading).toMatch(/^\[h1\|[0-9a-f-]{36}\]/);
      expect(answer.title_heading).toBeUndefined();
    }
  });

  it("keeps the same heading when it is not the first line", async () => {
    const client = articleClient();
    await create({ content: "Opening words.\n\n# Iron Mountains\n\nMore." }, client);
    expect(sent(client)).toMatch(/^\[p\]Opening words\.\[\/p\]\n\[h1\|[0-9a-f-]{36}\]Iron Mountains\[\/h1\]/);
  });

  it("drops only the first of two", async () => {
    const client = articleClient();
    await create({ content: "# Iron Mountains\n\n# Iron Mountains\n\nText." }, client);
    expect(sent(client)).toMatch(/^\[h1\|[0-9a-f-]{36}\]Iron Mountains\[\/h1\]\n\[p\]Text\.\[\/p\]$/);
  });

  it("leaves bbcode-format text and author notes exactly as written", async () => {
    const client = articleClient();
    const answer = await create(
      { content: "# Iron Mountains\n[p]Text[/p]", author_notes: "# Iron Mountains\n\nA note.", format: "bbcode" },
      client,
    );
    const data = client.createArticle.mock.calls[0][0];
    expect(data.content).toBe("# Iron Mountains\n[p]Text[/p]");
    expect(data.authornotes).toBe("# Iron Mountains\n\nA note.");
    expect(answer.title_heading).toBeUndefined();

    const md = articleClient();
    await create({ content: "Text.", author_notes: "# Iron Mountains\n\nA note." }, md);
    expect(md.createArticle.mock.calls[0][0].authornotes).toMatch(/^\[h1\|[0-9a-f-]{36}\]Iron Mountains\[\/h1\]/);
  });

  describe("on update", () => {
    const existing = () =>
      articleClient({
        getArticle: vi.fn(async (id) => ({ id, title: "Iron Mountains", world: { id: "w1" } })),
      });

    it("compares with the article's present title, read once", async () => {
      const client = existing();
      const answer = await call(
        "worldanvil_update_article",
        { article_id: "a1", content: "# iron mountains\n\nNew text." },
        client,
      );
      expect(client.updateArticle).toHaveBeenCalledWith("a1", { content: "[p]New text.[/p]" });
      expect(readsBeforeSave(client)).toBe(1);
      expect(answer.title_heading).toMatch(/left out because it repeats/);
    });

    it("compares with the new title when the article is being renamed", async () => {
      const client = existing();
      await call(
        "worldanvil_update_article",
        { article_id: "a1", title: "Frost Peaks", content: "# Frost Peaks\n\nNew text." },
        client,
      );
      expect(client.updateArticle.mock.calls[0][1]).toEqual({ title: "Frost Peaks", content: "[p]New text.[/p]" });

      const kept = existing();
      await call(
        "worldanvil_update_article",
        { article_id: "a1", title: "Frost Peaks", content: "# Iron Mountains\n\nNew text." },
        kept,
      );
      expect(kept.updateArticle.mock.calls[0][1].content).toMatch(/^\[h1\|/);
    });

    it("does not read the article when the text opens with no heading", async () => {
      const client = existing();
      await call("worldanvil_update_article", { article_id: "a1", content: "Plain opening.\n\n# Iron Mountains" }, client);
      expect(readsBeforeSave(client)).toBe(0);
    });
  });
});

describe("find articles by title", () => {
  const ARTICLES = [
    { id: "a-1", title: "The Iron Mountains", entityClass: "Location", state: "private" },
    { id: "a-2", title: "Queen Elara", entityClass: "Person", state: "private" },
    { id: "a-3", title: "Thronehold", entityClass: "Settlement", state: "public" },
    { id: "a-4", title: "thronehold", entityClass: "Article", state: "private" },
    { id: "a-5", title: "House Blackwood", entityClass: "Organization", state: "private" },
    { id: "a-6", title: "Blackwood", entityClass: "Person", state: "private" },
  ];
  const world = (articles = ARTICLES) => ({
    listArticles: vi.fn(async (worldId, { offset = 0, limit = 50 } = {}) => ({
      entities: articles.slice(offset, offset + limit),
    })),
  });
  const find = (titles, client = world()) =>
    call("worldanvil_find_articles", { world_id: "w1", titles }, client);

  it("finds an article whatever the capitals and spacing, with its link text", async () => {
    const answer = await find(["queen  ELARA "]);
    expect(answer.results).toEqual([
      {
        asked: "queen  ELARA ",
        status: "found",
        id: "a-2",
        title: "Queen Elara",
        template: "Character",
        icon: null,
        state: "private",
        draft: null,
        mention: "@[Queen Elara](Article:a-2)",
      },
    ]);
    expect(answer.totals).toEqual({ found: 1, more_than_one: 0, not_found: 0 });
    expect(answer.articles_in_world).toBe(6);
  });

  it("uses the type word Article in the link text whatever the template", async () => {
    const answer = await find(["House Blackwood"]);
    expect(answer.results[0].mention).toBe("@[House Blackwood](Article:a-5)");
  });

  it("lists every article when a title is shared", async () => {
    const answer = await find(["Thronehold"]);
    expect(answer.results[0].status).toBe("more_than_one");
    expect(answer.results[0].matches.map((m) => m.id)).toEqual(["a-3", "a-4"]);
    expect(answer.results[0].id).toBeUndefined();
  });

  it("says not found, and suggests a title differing only by The or punctuation", async () => {
    const answer = await find(["Iron Mountains", "the iron-mountains!"]);
    for (const r of answer.results) {
      expect(r.status).toBe("not_found");
      expect(r.suggestions.map((s) => s.id)).toEqual(["a-1"]);
      expect(r.id).toBeUndefined();
    }
  });

  it("suggests titles that contain, or are contained in, the one asked for", async () => {
    const answer = await find(["Elara", "Blackwood Hall"]);
    expect(answer.results[0].suggestions.map((s) => s.title)).toEqual(["Queen Elara"]);
    expect(answer.results[1].suggestions.map((s) => s.title)).toEqual(["Blackwood"]);
  });

  it("gives no suggestions when nothing is near, and never more than five", async () => {
    expect((await find(["Zzyzx"])).results[0]).toEqual({ asked: "Zzyzx", status: "not_found" });
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `r-${i}`, title: `River Ford ${i}` }));
    const answer = await find(["River Ford"], world(many));
    expect(answer.results[0].suggestions).toHaveLength(5);
  });

  it("answers many titles from one read of the world, in the order asked", async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `p-${i}`, title: `Place ${i}` }));
    const client = world(many);
    const answer = await find(["Place 129", "Nowhere", "place 0"], client);
    expect(answer.results.map((r) => r.status)).toEqual(["found", "not_found", "found"]);
    expect(answer.results[0].id).toBe("p-129");
    const firstReads = client.listArticles.mock.calls.filter(([, o]) => (o?.offset ?? 0) === 0);
    expect(firstReads).toHaveLength(1);
  });

  it("refuses no titles, an empty title, or too many", async () => {
    await expect(find([])).rejects.toThrow(/at least one title/);
    await expect(find(["Thronehold", "  "])).rejects.toThrow(/no empty ones/);
    await expect(find(Array.from({ length: 201 }, (_, i) => `T${i}`))).rejects.toThrow(/At most 200/);
  });

  it("is offered as a tool that needs a world and titles", () => {
    const tool = getToolDefinitions().find((t) => t.name === "worldanvil_find_articles");
    expect(tool.inputSchema.required).toEqual(["world_id", "titles"]);
  });
});

describe("category icons", () => {
  it("a new category gets the site's folder icon", async () => {
    const client = articleClient();
    await call("worldanvil_create_category", { title: "People", world_id: "w1" }, client);
    expect(client.createCategory.mock.calls[0][0].icon).toBe("fas fa-folder");
  });

  it("a chosen icon is used, and default resets it", async () => {
    const client = articleClient();
    await call("worldanvil_create_category", { title: "People", world_id: "w1", icon: "fa-users" }, client);
    expect(client.createCategory.mock.calls[0][0].icon).toBe("fa-solid fa-users");
    await call("worldanvil_update_category", { category_id: "c1", icon: "default" }, client);
    expect(client.updateCategory.mock.calls[0][1].icon).toBe("fas fa-folder");
  });

  it("an update without an icon leaves the icon alone", async () => {
    const client = articleClient();
    await call("worldanvil_update_category", { category_id: "c1", title: "T" }, client);
    expect(client.updateCategory.mock.calls[0][1]).not.toHaveProperty("icon");
  });
});

/** A fake list endpoint over `total` items, optionally capped per call. */
function fakeList(total, cap = Infinity) {
  const items = Array.from({ length: total }, (_, i) => ({ id: `id-${i}`, title: `Item ${i}` }));
  return vi.fn(async ({ limit, offset }) => ({
    success: true,
    entities: items.slice(Number(offset), Number(offset) + Math.min(Number(limit), cap)),
  }));
}

describe("paging", () => {
  it("75 items: 50 and 'more', then the other 25 and 'end'", async () => {
    const fetch = fakeList(75);
    const first = await listPage(fetch, {});
    expect(first.entities).toHaveLength(50);
    expect(first.paging).toMatchObject({ returned: 50, offset: 0, more: true, next_offset: 50 });
    expect(first.paging.note).toMatch(/Call again with offset 50/);

    const second = await listPage(fetch, { offset: first.paging.next_offset });
    expect(second.entities).toHaveLength(25);
    expect(second.entities[0].id).toBe("id-50"); // not the first 50 again
    expect(second.paging).toMatchObject({ returned: 25, more: false, next_offset: null });
    expect(second.paging.note).toMatch(/end of the list/);
  });

  it("exactly one page: says it is the end", async () => {
    const page = await listPage(fakeList(50), {});
    expect(page.entities).toHaveLength(50);
    expect(page.paging.more).toBe(false);
  });

  it("a short list costs one request", async () => {
    const fetch = fakeList(5);
    const page = await listPage(fetch, {});
    expect(page.paging).toMatchObject({ returned: 5, more: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still gets it right if World Anvil quietly caps a page", async () => {
    // Ask for 100 (+1), but the far end only ever returns 60 at a time.
    const fetch = fakeList(110, 60);
    const first = await listPage(fetch, { limit: 100 });
    expect(first.entities).toHaveLength(60);
    expect(first.paging).toMatchObject({ more: true, next_offset: 60 });
    const second = await listPage(fetch, { limit: 100, offset: 60 });
    expect(second.entities).toHaveLength(50);
    expect(second.entities[0].id).toBe("id-60");
    expect(second.paging.more).toBe(false);
    expect(PROVEN_PAGE).toBeLessThanOrEqual(60);
  });

  it("past the end: empty, and says so", async () => {
    const page = await listPage(fakeList(10), { offset: 50 });
    expect(page.entities).toEqual([]);
    expect(page.paging.note).toMatch(/list ended before it/);
  });

  it("caps limit at 100 and refuses nonsense", async () => {
    const fetch = fakeList(300);
    expect((await listPage(fetch, { limit: 500 })).entities).toHaveLength(100);
    await expect(listPage(fetch, { limit: 0 })).rejects.toThrow(/limit/);
    await expect(listPage(fetch, { limit: 2.5 })).rejects.toThrow(/limit/);
    await expect(listPage(fetch, { offset: -1 })).rejects.toThrow(/offset/);
    await expect(listPage(fetch, { offset: "abc" })).rejects.toThrow(/offset/);
  });

  it("listAll collects every page and stops on a repeat", async () => {
    expect(await listAll(fakeList(123))).toHaveLength(123);
    expect(await listAll(fakeList(0))).toEqual([]);
    const stuck = vi.fn(async ({ limit }) => ({ entities: Array.from({ length: Number(limit) }, (_, i) => ({ id: `same-${i}` })) }));
    expect(await listAll(stuck)).toHaveLength(50);
    expect(stuck).toHaveBeenCalledTimes(2);
    // A short page is the end: no extra request to prove it.
    const short = fakeList(7);
    expect(await listAll(short)).toHaveLength(7);
    expect(short).toHaveBeenCalledTimes(1);
  });
});

describe("list articles", () => {
  const listing = () => {
    const client = { listArticles: vi.fn(async () => ({ success: true, entities: [{ id: "a" }] })) };
    return client;
  };

  it("lists the whole world by default: no category is sent", async () => {
    const client = listing();
    const result = await call("worldanvil_list_articles", { world_id: "w1" }, client);
    expect(client.listArticles).toHaveBeenCalledWith("w1", { limit: 51, offset: 0 });
    expect(result.paging.more).toBe(false);
  });

  it("lists one category when asked", async () => {
    const client = listing();
    await call("worldanvil_list_articles", { world_id: "w1", category_id: "cat-9", limit: 10, offset: 20 }, client);
    expect(client.listArticles).toHaveBeenCalledWith("w1", { limit: 11, offset: 20, category: { id: "cat-9" } });
  });

  it.each(["uncategorised", "Uncategorized", "none", "-1"])('"%s" lists the uncategorised ones', async (word) => {
    const client = listing();
    await call("worldanvil_list_articles", { world_id: "w1", category_id: word }, client);
    expect(client.listArticles.mock.calls[0][1].category).toEqual({ id: "-1" });
  });
});

describe("world outline", () => {
  it("nests categories and files each article once", async () => {
    const articles = [
      { id: "A1", title: "Aldric", entityClass: "Person", icon: "fa-person", state: "private", isDraft: true },
      { id: "A2", title: "Thronehold", entityClass: "Settlement", icon: "fa-building-columns", state: "private", isDraft: false },
      { id: "A3", title: "Loose note", entityClass: "Article", icon: null, state: "public", isDraft: true },
    ];
    const categories = {
      c1: { id: "c1", title: "Valdor", icon: "fas fa-folder", parent: null, articles: [{ id: "a2", title: "Thronehold" }] },
      c2: { id: "c2", title: "People", icon: null, parent: { id: "C1" }, articles: [{ id: "A1" }, { id: "gone", title: "Ghost" }] },
    };
    const page = (items) => async (_world, { limit, offset }) => ({
      entities: items.slice(Number(offset), Number(offset) + Number(limit)),
    });
    const client = {
      listCategories: vi.fn(page([{ id: "c1", title: "Valdor" }, { id: "c2", title: "People" }])),
      listArticles: vi.fn(page(articles)),
      getCategory: vi.fn(async (id) => categories[id]),
    };

    const outline = await call("worldanvil_get_world_outline", { world_id: "w1" }, client);

    expect(outline.totals).toEqual({ categories: 2, articles: 3, uncategorised: 1 });
    expect(outline.categories).toHaveLength(1);
    const valdor = outline.categories[0];
    expect(valdor).toMatchObject({ id: "c1", title: "Valdor", icon: "fas fa-folder" });
    expect(valdor.articles).toEqual([
      { id: "A2", title: "Thronehold", template: "Settlement", icon: "fa-building-columns", state: "private", draft: false },
    ]);
    const people = valdor.categories[0];
    expect(people.title).toBe("People");
    expect(people.articles[0]).toMatchObject({ id: "A1", template: "Character" });
    // Listed by the category but not by the world: still shown, with what is known.
    expect(people.articles[1]).toMatchObject({ id: "gone", title: "Ghost", template: null });
    expect(outline.uncategorised).toEqual([
      { id: "A3", title: "Loose note", template: "Generic", icon: null, state: "public", draft: true },
    ]);
    // The whole-world article list is asked for without a category.
    expect(client.listArticles.mock.calls[0][1]).not.toHaveProperty("category");
    expect(client.getCategory).toHaveBeenCalledTimes(2);
  });

  it("a category whose parent isn't in the list sits at the top", async () => {
    const client = {
      listCategories: vi.fn(async (_w, { offset }) => ({ entities: offset ? [] : [{ id: "c1", title: "Orphan" }] })),
      listArticles: vi.fn(async () => ({ entities: [] })),
      getCategory: vi.fn(async () => ({ id: "c1", title: "Orphan", parent: { id: "missing" } })),
    };
    const outline = await call("worldanvil_get_world_outline", { world_id: "w1" }, client);
    expect(outline.categories.map((c) => c.title)).toEqual(["Orphan"]);
    expect(outline.categories[0].articles).toEqual([]);
  });
});
