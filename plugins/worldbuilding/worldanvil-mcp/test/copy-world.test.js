/**
 * Copying categories, articles and secrets from one world into another.
 * Uses a fake World Anvil holding two worlds; no network.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, beforeEach } from "vitest";
import { copyArticles, repointMentions } from "../src/copy-world.js";
import { getToolDefinitions } from "../src/tools.js";
import { toolAction, filterTools, parseToolGroups } from "../src/tool-groups.js";
import { visibleTools } from "../src/server.js";
import { validateSettings } from "../src/access/config.js";

const SRC = "11111111-1111-4111-8111-111111111111";
const TGT = "22222222-2222-4222-8222-222222222222";
const uuid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const isWrite = (c) => /^(create|update)/.test(c.op);

/** A fake account: items keyed by id, each with a `world`. */
function fakeAccount() {
  const db = { category: new Map(), article: new Map(), secret: new Map() };
  const calls = [];
  let next = 9000;
  let createState = "private";
  const inWorld = (kind, worldId) => [...db[kind].values()].filter((x) => x.world.id === worldId);
  const page = (kind, thin) => async (worldId, { limit, offset }) => ({
    entities: inWorld(kind, worldId).slice(Number(offset), Number(offset) + Number(limit)).map(thin),
  });
  const make = (kind) => async (data) => {
    calls.push({ op: `create ${kind}`, world: data.world.id, data });
    const id = uuid(next++);
    db[kind].set(id, { ...data, id, state: createState });
    return { id, title: data.title };
  };
  const read = (kind) => async (id) => {
    const item = db[kind].get(String(id).toLowerCase());
    if (!item) throw new Error(`${kind} ${id} not found`);
    if (kind !== "category") return { ...item };
    return {
      ...item,
      articles: [...db.article.values()]
        .filter((a) => a.category?.id === item.id)
        .map((a) => ({ id: a.id, title: a.title })),
    };
  };
  const patch = (kind) => async (id, data) => {
    const item = db[kind].get(String(id).toLowerCase());
    calls.push({ op: `update ${kind}`, world: item.world.id, data });
    Object.assign(item, data);
    return { id };
  };
  const client = {
    getWorld: async (id) => ({ id, title: id === SRC ? "Old World" : "New World", state: "private" }),
    listCategories: page("category", ({ id, title }) => ({ id, title })),
    listArticles: page("article", ({ id, title, templateType, state }) => ({ id, title, entityClass: templateType, state })),
    listSecrets: page("secret", ({ id, title }) => ({ id, title })),
    getCategory: read("category"),
    getArticle: read("article"),
    getSecret: read("secret"),
    createCategory: make("category"),
    createArticle: make("article"),
    createSecret: make("secret"),
    updateArticle: patch("article"),
    updateSecret: patch("secret"),
  };
  const put = (kind, n, fields) => {
    const id = uuid(n);
    db[kind].set(id, { id, state: "private", world: { id: SRC }, ...fields });
    return id;
  };
  return { client, db, calls, put, inWorld, createsAs: (state) => (createState = state) };
}

/** The source world used by most tests. */
function seeded() {
  const acc = fakeAccount();
  const places = acc.put("category", 1, { title: "Places", icon: "fas fa-map", description: "[p]Where things are.[/p]" });
  const towns = acc.put("category", 2, { title: "Towns", parent: { id: places } });
  const people = acc.put("category", 3, { title: "People" });
  const harbour = acc.put("article", 10, {
    title: "Harbour",
    templateType: "settlement",
    icon: "fa-solid fa-anchor",
    category: { id: towns },
    population: "About 400",
    content: "A port town.\nBusy in summer.\n\n[h2]Trade[/h2]\n\n[ul]\n[li]Fish[/li]\n[li]Salt[/li]\n[/ul]",
    authornotes: "TODO: name the harbour master.",
  });
  const mara = acc.put("article", 11, {
    title: "Mara",
    templateType: "person",
    category: { id: people },
    content: `[p]Born in @[the port](Article:${harbour}).[/p]`,
  });
  acc.put("article", 12, { title: "Loose Note", templateType: "article", content: "[p]Uncategorised.[/p]" });
  acc.put("secret", 20, { title: "Mara and the debt", content: "[p]She owes money.[/p]", article: { id: mara } });
  acc.put("secret", 21, { title: "World secret", content: "[p]No article.[/p]" });
  return { acc, places, towns, people, harbour, mara };
}

const run = (acc, args = {}, opts) =>
  copyArticles(acc.client, { source_world_id: SRC, target_world_id: TGT, ...args }, opts);

describe("copy preview", () => {
  it("lists what would be created and changes nothing", async () => {
    const { acc } = seeded();
    const answer = await run(acc);
    expect(answer.status).toBe("preview");
    expect(answer.source).toBe("Old World");
    expect(answer.target).toBe("New World");
    expect(answer.would_create.categories).toEqual(["People", "Places", "Places / Towns"]);
    expect(answer.would_create.articles).toEqual([
      { title: "Harbour", template: "Settlement" },
      { title: "Mara", template: "Character" },
      { title: "Loose Note", template: "Generic" },
    ]);
    expect(answer.would_create.secrets_at_most).toBe(2);
    expect(answer.note).toMatch(/Preview only: nothing was changed/);
    expect(acc.calls.filter(isWrite)).toEqual([]);
  });

  it("refuses the same world twice, and a category that is not in the source", async () => {
    const { acc } = seeded();
    await expect(copyArticles(acc.client, { source_world_id: SRC, target_world_id: SRC })).rejects.toThrow(/same world/);
    await expect(run(acc, { category_id: uuid(999) })).rejects.toThrow(/not a category of the source world/);
  });
});

describe("copy with confirm", () => {
  let s, answer;
  beforeEach(async () => {
    s = seeded();
    answer = await run(s.acc, { confirm: true });
  });
  const target = (kind, title) => s.acc.inWorld(kind, TGT).find((x) => x.title === title);

  it("finishes in one call and never writes to the source", () => {
    expect(answer.status).toBe("done");
    expect(answer.done).toBe(true);
    expect(answer.problems).toBeUndefined();
    expect(s.acc.calls.filter(isWrite).filter((c) => c.world !== TGT)).toEqual([]);
    expect(s.acc.inWorld("article", SRC)).toHaveLength(3);
  });

  it("recreates the categories, parents first, with icon and description", () => {
    expect(answer.created_this_call.categories).toEqual(["People", "Places", "Places / Towns"]);
    const places = target("category", "Places");
    const towns = target("category", "Towns");
    expect(places.icon).toBe("fas fa-map");
    expect(places.description).toBe("[p]Where things are.[/p]");
    expect(towns.parent).toEqual({ id: places.id });
    expect(target("category", "People").icon).toBe("fas fa-folder");
  });

  it("copies each article private, in its category, with template, icon and fields", () => {
    const harbour = target("article", "Harbour");
    expect(harbour.state).toBe("private");
    expect(harbour.templateType).toBe("settlement");
    expect(harbour.icon).toBe("fa-solid fa-anchor");
    expect(harbour.population).toBe("About 400");
    expect(harbour.category).toEqual({ id: target("category", "Towns").id });
    expect(harbour.authornotes).toBe("TODO: name the harbour master.");
    expect(target("article", "Loose Note").category).toBeUndefined();
    // No icon of its own: the template's.
    expect(target("article", "Mara").icon).toBeTruthy();
  });

  it("asks for private in every create request", () => {
    const creates = s.acc.calls.filter((c) => c.op === "create article" || c.op === "create secret");
    expect(creates.length).toBe(5);
    expect(creates.every((c) => c.data.state === "private")).toBe(true);
  });

  it("writes old-form text in the editor's form, and leaves current text exactly as stored", () => {
    const harbour = target("article", "Harbour");
    expect(harbour.content).toMatch(/^\[p\]A port town\.\[br\]/);
    expect(harbour.content).toMatch(/\[h2\|[0-9a-f-]{36}\]Trade\[\/h2\]/);
    expect(harbour.content).not.toMatch(/\[li\]/);
    expect(target("article", "Loose Note").content).toBe("[p]Uncategorised.[/p]");
    const line = answer.created_this_call.articles.find((a) => a.title === "Harbour");
    expect(line.main_text).toBe("editor form");
    expect(line.check).toBe("stored as sent; reads the same as the source");
    expect(line.privacy).toBe("private");
  });

  it("re-points a mention at the copy, keeping the words shown", () => {
    const harbour = target("article", "Harbour");
    expect(target("article", "Mara").content).toBe(`[p]Born in @[the port](Article:${harbour.id}).[/p]`);
    expect(answer.created_this_call.articles.find((a) => a.title === "Mara").check).toBe(
      "stored as sent; reads the same as the source",
    );
  });

  it("copies secrets private: attached to the copied article, or to none", () => {
    const secret = target("secret", "Mara and the debt");
    expect(secret.state).toBe("private");
    expect(secret.content).toBe("[p]She owes money.[/p]");
    expect(secret.article).toEqual({ id: target("article", "Mara").id });
    expect(target("secret", "World secret").article).toBeUndefined();
    expect(answer.created_this_call.secrets.map((x) => x.check)).toEqual(["stored as sent", "stored as sent"]);
  });

  it("run again, it creates nothing", async () => {
    const before = s.acc.calls.filter(isWrite).length;
    const again = await run(s.acc, { confirm: true });
    expect(again.status).toBe("done");
    expect(again.created_this_call).toEqual({ categories: [], articles: [], secrets: [] });
    expect(again.left_alone.articles_in_target_before_this_call).toEqual(["Harbour", "Mara", "Loose Note"]);
    expect(s.acc.calls.filter(isWrite).length).toBe(before);
  });
});

describe("copy: harder cases", () => {
  it("works in several calls when time runs out, without copying anything twice", async () => {
    const { acc } = seeded();
    let t = 0;
    const slow = { budgetMs: 10, now: () => (t += 4) }; // room for about two items a call
    const answers = [];
    for (let i = 0; i < 12; i++) {
      answers.push(await run(acc, { confirm: true }, slow));
      if (answers.at(-1).done) break;
    }
    expect(answers.length).toBeGreaterThan(2);
    expect(answers[0].status).toBe("in_progress");
    expect(answers[0].note).toMatch(/call again with the same arguments/);
    expect(answers.at(-1).done).toBe(true);
    expect(acc.inWorld("category", TGT)).toHaveLength(3);
    expect(acc.inWorld("article", TGT).map((a) => a.title).sort()).toEqual(["Harbour", "Loose Note", "Mara"]);
    expect(acc.inWorld("secret", TGT)).toHaveLength(2);
  });

  it("finishes links between articles that mention each other", async () => {
    const acc = fakeAccount();
    const a = uuid(10);
    const b = uuid(11);
    acc.put("article", 10, { title: "Alpha", templateType: "article", content: `[p]See @[Beta](Article:${b}).[/p]` });
    acc.put("article", 11, { title: "Beta", templateType: "article", content: `[p]See @[Alpha](Article:${a}).[/p]` });
    const answer = await run(acc, { confirm: true });
    expect(answer.done).toBe(true);
    expect(answer.created_this_call.links_finished).toEqual(["Alpha"]);
    const [alpha, beta] = ["Alpha", "Beta"].map((t) => acc.inWorld("article", TGT).find((x) => x.title === t));
    expect(alpha.content).toBe(`[p]See @[Beta](Article:${beta.id}).[/p]`);
    expect(beta.content).toBe(`[p]See @[Alpha](Article:${alpha.id}).[/p]`);
    expect(answer.problems).toBeUndefined();
  });

  it("keeps unfinished links on disk, so a later call (even after a restart) finishes them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-copy-"));
    const acc = fakeAccount();
    acc.client.backups = { dir };
    const a = uuid(10);
    const b = uuid(11);
    acc.put("article", 10, { title: "Alpha", templateType: "article", content: `[p]See @[Beta](Article:${b}).[/p]` });
    acc.put("article", 11, { title: "Beta", templateType: "article", content: `[p]See @[Alpha](Article:${a}).[/p]` });
    // The update is refused this time (as in a stage that only allows creating).
    const update = acc.client.updateArticle;
    acc.client.updateArticle = async () => {
      throw new Error("Access denied: updates are not allowed now");
    };
    const first = await run(acc, { confirm: true });
    expect(first.done).toBe(false);
    expect(first.remaining.links_to_finish).toBe(1);
    expect(first.problems[0]).toMatch(/Links in "Alpha" could not be finished \(Access denied.*\{\{placeholders\}\} for now/);
    const alpha = () => acc.inWorld("article", TGT).find((x) => x.title === "Alpha");
    // Until then the copy holds a placeholder, which any later update or reformat can also finish.
    expect(alpha().content).toBe("[p]See {{Beta}}.[/p]");
    const file = join(dir, "copies", readdirSync(join(dir, "copies"))[0]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(1);

    // A different client object with the same backup folder: nothing in memory is needed.
    acc.client.updateArticle = update;
    const later = await copyArticles(
      { ...acc.client, backups: { dir } },
      { source_world_id: SRC.toUpperCase(), target_world_id: TGT, confirm: true },
    );
    expect(later.done).toBe(true);
    expect(later.created_this_call.links_finished).toEqual(["Alpha"]);
    const beta = acc.inWorld("article", TGT).find((x) => x.title === "Beta");
    expect(alpha().content).toBe(`[p]See @[Beta](Article:${beta.id}).[/p]`);
    expect(existsSync(file)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("forgets a remembered link whose copy is no longer in the target", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-copy-"));
    mkdirSync(join(dir, "copies"));
    const { acc } = seeded();
    acc.client.backups = { dir };
    const file = join(dir, "copies", `links-${SRC.slice(0, 8)}-${TGT.slice(0, 8)}-all.json`);
    writeFileSync(file, JSON.stringify([{ sourceId: uuid(10), targetId: uuid(777), title: "Gone" }]));
    const answer = await run(acc, { confirm: true });
    expect(answer.done).toBe(true);
    expect(answer.problems).toBeUndefined();
    expect(existsSync(file)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("copies only one category and what is under it, as a top-level category", async () => {
    const { acc, towns } = seeded();
    const answer = await run(acc, { confirm: true, category_id: towns });
    expect(answer.done).toBe(true);
    expect(acc.inWorld("category", TGT).map((c) => c.title)).toEqual(["Towns"]);
    expect(acc.inWorld("category", TGT)[0].parent).toBeUndefined();
    expect(acc.inWorld("article", TGT).map((x) => x.title)).toEqual(["Harbour"]);
    // Secrets: neither is attached to a copied article.
    expect(acc.inWorld("secret", TGT)).toEqual([]);
    expect(answer.left_alone.secrets_not_attached_to_a_copied_article.sort()).toEqual(["Mara and the debt", "World secret"]);
  });

  it("leaves a mention of an article outside the copy as written, and says so", async () => {
    const { acc, people, harbour } = seeded();
    const answer = await run(acc, { confirm: true, category_id: people });
    const mara = acc.inWorld("article", TGT).find((x) => x.title === "Mara");
    expect(mara.content).toBe(`[p]Born in @[the port](Article:${harbour}).[/p]`);
    expect(answer.created_this_call.articles[0].references).toMatch(/still point at the source world/);
  });

  it("leaves alone an article whose title is already in the target", async () => {
    const { acc } = seeded();
    acc.db.article.set(uuid(500), { id: uuid(500), title: "  harbour ", world: { id: TGT }, state: "private", content: "[p]Mine.[/p]" });
    const answer = await run(acc, { confirm: true });
    expect(answer.left_alone.articles_in_target_before_this_call).toEqual(["Harbour"]);
    expect(acc.db.article.get(uuid(500)).content).toBe("[p]Mine.[/p]");
    expect(acc.inWorld("article", TGT)).toHaveLength(3);
    // The mention in the other article points at the one already there.
    expect(acc.inWorld("article", TGT).find((x) => x.title === "Mara").content).toContain(`(Article:${uuid(500)})`);
  });

  it("copies only the first of two source articles with one title, and says so", async () => {
    const { acc } = seeded();
    acc.put("article", 13, { title: "MARA", templateType: "person", content: "[p]Another.[/p]" });
    const answer = await run(acc, { confirm: true });
    expect(answer.problems).toEqual(['The source has more than one article titled "MARA"; only the first is copied.']);
    expect(acc.inWorld("article", TGT).filter((x) => /mara/i.test(x.title))).toHaveLength(1);
  });

  it("copies text holding raw HTML exactly as stored", async () => {
    const acc = fakeAccount();
    const html = "Line one\n<div>raw</div>\n[li]old[/li]";
    acc.put("article", 10, { title: "Odd", templateType: "article", content: html });
    const answer = await run(acc, { confirm: true });
    expect(acc.inWorld("article", TGT)[0].content).toBe(html);
    expect(answer.created_this_call.articles[0].main_text).toBe("as stored");
    expect(answer.created_this_call.articles[0].main_text_note).toMatch(/raw HTML/);
  });

  it("sets an article or secret private straight away if World Anvil made it otherwise", async () => {
    const { acc } = seeded();
    acc.createsAs("public");
    const answer = await run(acc, { confirm: true });
    expect(acc.inWorld("article", TGT).every((a) => a.state === "private")).toBe(true);
    expect(acc.inWorld("secret", TGT).every((a) => a.state === "private")).toBe(true);
    expect(answer.problems).toBeUndefined();
  });

  it("warns when a copy is not stored as sent", async () => {
    const { acc, people } = seeded();
    const create = acc.client.createArticle;
    acc.client.createArticle = async (data) => {
      const made = await create(data);
      acc.db.article.get(made.id).content += " ";
      return made;
    };
    const answer = await run(acc, { confirm: true, category_id: people });
    expect(answer.problems[0]).toMatch(/Article "Mara": WARNING: stored differently from what was sent: content/);
  });
});

describe("repointMentions", () => {
  const id = uuid(1);
  const other = uuid(2);
  it("re-points, writes plain words, or leaves alone, by what the id is", () => {
    const text = `@[One](Article:${id}) @[Two](Article:${other}) @[Three](Article:${uuid(3)}) [h2|${uuid(4)}]H[/h2]`;
    const out = repointMentions(text, (x) => (x === id ? { targetId: uuid(7) } : x === other ? { pending: true } : null));
    expect(out.text).toBe(`@[One](Article:${uuid(7)}) Two @[Three](Article:${uuid(3)}) [h2|${uuid(4)}]H[/h2]`);
    expect(out.pending).toBe(1);
    expect(out.otherIds).toBe(true);
  });
  it("writes a mention that cannot be made yet as a placeholder naming the article", () => {
    const pending = (title) => () => ({ pending: true, title });
    expect(repointMentions(`@[Beta](Article:${id})`, pending("Beta")).text).toBe("{{Beta}}");
    expect(repointMentions(`@[the town](Article:${id})`, pending("Beta")).text).toBe("{{Beta|the town}}");
    expect(repointMentions(`@[the town](Article:${id})`, pending("Beta {old}")).text).toBe("the town");
    // A title or wording a placeholder cannot hold: plain words.
    expect(repointMentions(`@[the town](Article:${id})`, pending("Beta [old]")).text).toBe("the town");
    expect(repointMentions(`@[a|b](Article:${id})`, pending("Beta")).text).toBe("a|b");
  });
  it("heading anchors and re-pointed mentions are not other ids", () => {
    const out = repointMentions(`[h2|${uuid(4)}]H[/h2] @[One](Article:${id})`, () => ({ targetId: uuid(7) }));
    expect(out.otherIds).toBe(false);
  });
});

describe("copy tool in the tool list", () => {
  it("is defined, in the content group, and counts as creating", () => {
    const tool = getToolDefinitions().find((t) => t.name === "worldanvil_copy_articles");
    expect(tool.inputSchema.required).toEqual(["source_world_id", "target_world_id"]);
    expect(toolAction("worldanvil_copy_articles")).toBe("create");
    const content = filterTools(getToolDefinitions(), parseToolGroups("content")).map((t) => t.name);
    expect(content).toContain("worldanvil_copy_articles");
  });
  it("is not loaded when no world allows creating", () => {
    const names = (s) => visibleTools(validateSettings(s), null).map((t) => t.name);
    expect(names({ allow_only: true, allow_create_worlds: false, world_list: { A: "read_only" } })).not.toContain(
      "worldanvil_copy_articles",
    );
    expect(names({ allow_only: true, allow_create_worlds: false, world_list: { A: "read_only", B: "edit_only" } })).toContain(
      "worldanvil_copy_articles",
    );
  });
});
