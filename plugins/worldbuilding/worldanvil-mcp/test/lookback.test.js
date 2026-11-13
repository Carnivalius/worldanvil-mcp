/**
 * Looking back into backups: list, search, compare, back up one item on
 * request, restore one item. Through the real server and guard, with a
 * fake World Anvil and a temporary backup folder; no network.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { validateSettings } from "../src/access/config.js";
import { canonical, differences } from "../src/access/lookback.js";
import { WorldAnvilClient } from "../src/api-client.js";
import { createServer } from "../src/server.js";

const USER = "00000000-0000-4000-8000-000000000000";
const WORLD = "11111111-1111-4111-8111-111111111111";
const SECRET_WORLD = "22222222-2222-4222-8222-222222222222";
const ARTICLE = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const HIDDEN = "a0000000-0000-4000-8000-000000000009";

let calls;
let articles;
let edits;

function fakeSend(endpoint, method = "GET", body = null) {
  calls.push({ endpoint, method, body });
  const [path, query = ""] = endpoint.split("?");
  const id = new URLSearchParams(query).get("id");
  if (path === "/identity") return Promise.resolve({ id: USER });
  if (path === "/user/worlds")
    return Promise.resolve({
      entities: [
        { id: WORLD, title: "My Epic Saga" },
        { id: SECRET_WORLD, title: "Secret World" },
      ],
    });
  if (path === "/world" && method === "GET") return Promise.resolve({ id, title: id === WORLD ? "My Epic Saga" : "Secret World" });
  if (path === "/world/articles")
    return Promise.resolve({
      entities: Number(body?.offset ?? 0) === 0
        ? Object.values(articles).filter((a) => a.world.id === id).map(({ id: i, title, updateDate }) => ({ id: i, title, updateDate }))
        : [],
    });
  if (method === "POST") return Promise.resolve({ entities: [] }); // every other list is empty
  if (path === "/article" && method === "GET") {
    if (!articles[id]) return Promise.reject(Object.assign(new Error("not found"), { status: 404 }));
    return Promise.resolve(structuredClone(articles[id]));
  }
  if (path === "/article" && method === "PATCH") {
    edits += 1;
    // As World Anvil does: the change date moves, the word count follows the
    // text, and the nested world record's own change date moves too.
    const stamp = { date: `2026-11-13 10:00:0${edits}` };
    articles[id] = { ...articles[id], ...body, updateDate: stamp, world: { ...articles[id].world, updateDate: stamp } };
    articles[id].wordcount = String(articles[id].content ?? "").split(/\s+/).filter(Boolean).length;
    return Promise.resolve({ id });
  }
  return Promise.resolve({ success: true });
}

let dir;
async function connect(settings = {}) {
  vi.restoreAllMocks();
  vi.spyOn(WorldAnvilClient.prototype, "request").mockImplementation(fakeSend);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { server } = createServer({
    appKey: "k",
    authToken: "t",
    access: {
      settings: validateSettings({ world_list: { "Secret World": "blocked" }, ...settings }),
      file: "access.json",
      backupDir: dir,
    },
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  const call = async (name, args) => {
    const r = await client.callTool({ name: `worldanvil_${name}`, arguments: args });
    await new Promise((res) => setTimeout(res, 5)); // backup names carry the millisecond
    if (r.isError) return { error: r.content[0].text };
    return JSON.parse(r.content[0].text);
  };
  return call;
}

function files(root) {
  const out = [];
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : out.push(join(d, e.name))));
  walk(root);
  return out;
}

beforeEach(() => {
  calls = [];
  edits = 0;
  dir = mkdtempSync(join(tmpdir(), "wa-look-"));
  articles = {
    [ARTICLE]: {
      id: ARTICLE,
      title: "Hero",
      content: "First line of lore\nThe hero was born in Vale\nLast line",
      excerpt: "A hero",
      wordcount: 11,
      state: "private",
      updateDate: { date: "2026-11-01 09:00:00" },
      category: { id: "c0000000-0000-4000-8000-000000000001", title: "People" },
      world: { id: WORLD, title: "My Epic Saga", state: "private", updateDate: { date: "2026-11-01 09:00:00" } },
    },
    [OTHER]: { id: OTHER, title: "Vale", content: "A quiet valley", state: "private", updateDate: { date: "2026-11-01 09:00:00" }, world: { id: WORLD } },
    [HIDDEN]: { id: HIDDEN, title: "Hidden", content: "secret words", updateDate: { date: "2026-11-01 09:00:00" }, world: { id: SECRET_WORLD } },
  };
});

const item = { type: "article", id: ARTICLE };
const patches = () => calls.filter((c) => c.method === "PATCH");

describe("backing up one item on request", () => {
  it("saves the first copy, then says 'no change' until something changes or it is forced", async () => {
    const call = await connect();
    const first = await call("backup_item", item);
    expect(first).toMatchObject({ backup_taken: true, backups_held: 1, backup_limit: 10 });
    expect(first.note).toMatch(/first saved copy/);
    expect(first.file).toMatch(/items[\\/]My Epic Saga-11111111[\\/]article[\\/]Hero - a0000000-[0-9a-f-]+[\\/][^\\/]+-request\.json$/);
    expect(JSON.parse(readFileSync(first.file, "utf8"))).toMatchObject({ reason: "on request", data: { title: "Hero" } });

    const second = await call("backup_item", item);
    expect(second.backup_taken).toBe(false);
    expect(second.note).toMatch(/^No backup taken\. No change since \d{4}-/);
    expect(second.note).toMatch(/force: true/);
    expect(second.storing).toMatch(/^Storing 1\/10 backups using/);
    expect(files(dir)).toHaveLength(1);

    const forced = await call("backup_item", { ...item, force: true });
    expect(forced).toMatchObject({ backup_taken: true, backups_held: 2 });

    articles[ARTICLE].content += "\nA new line";
    const changed = await call("backup_item", item);
    expect(changed).toMatchObject({ backup_taken: true, backups_held: 3 });
    expect(patches()).toHaveLength(0); // nothing was changed on World Anvil
  });

  it("is never refused for being over the limit, and says when the day limit is holding extras", async () => {
    const call = await connect({ item_backup_keep: 2 });
    let last;
    for (let i = 0; i < 4; i++) last = await call("backup_item", { ...item, force: true });
    expect(last.backup_taken).toBe(true);
    expect(last.storing).toMatch(/exceeded your set limit of 2; your retention of 7 days.*Storing 4\/2 backups/);
  });

  it("counts an unchanged copy in a world backup as the newest saved copy", async () => {
    const call = await connect();
    expect((await call("backup_world", { world_id: WORLD })).backup_taken).toBe(true);
    const result = await call("backup_item", item);
    expect(result.backup_taken).toBe(false);
    expect(result.newest_saved_copy.saved).toBe("in a world backup");
  });

  it("refuses an unknown type, a bad id, and an item in a blocked world", async () => {
    const call = await connect();
    expect((await call("backup_item", { type: "../world", id: ARTICLE })).error).toMatch(/not an item type/);
    expect((await call("backup_item", { type: "article", id: "x y" })).error).toMatch(/not a valid World Anvil id/);
    expect((await call("backup_item", { type: "article", id: HIDDEN })).error).toMatch(/blocked/);
    expect(files(dir)).toHaveLength(0);
  });
});

describe("listing backups", () => {
  it("lists one item's versions newest first, world backup copies shown once", async () => {
    const call = await connect();
    await call("backup_world", { world_id: WORLD });
    await call("update_article", { article_id: ARTICLE, content: "Rewritten" }); // saves a copy first
    await call("backup_world", { world_id: WORLD });
    await call("backup_item", { ...item, force: true });

    const listed = await call("list_backups", { world_id: WORLD, ...item });
    expect(listed.versions.map((v) => v.saved)).toEqual(["on request", "in a world backup", "before an edit", "in a world backup"]);
    expect(listed.versions[0].version).toMatch(/^item:.*-request$/);
    expect(listed.versions[1].version).toMatch(/^world:2/);
    expect(listed.own_copies).toMatchObject({ backups_held: 2, backup_limit: 10 });

    // The untouched article is in both world backups, unchanged: one version.
    const other = await call("list_backups", { world_id: WORLD, type: "article", id: OTHER });
    expect(other.versions).toHaveLength(1);
    expect(other.versions[0].also_in_newer_world_backups).toBe(1);
  });

  it("summarises a world: its world backups and the items with copies of their own", async () => {
    const call = await connect();
    await call("backup_world", { world_id: WORLD });
    await call("backup_item", { ...item, force: true });
    const summary = await call("list_backups", { world_id: WORLD });
    expect(summary.world_backups).toHaveLength(1);
    expect(summary.world_backups[0]).toMatchObject({ items: 2 });
    expect(summary.world_backups_kept).toMatchObject({ backups_held: 1, backup_limit: 20 });
    expect(summary.items_with_copies_of_their_own).toEqual({ article: 1 });
  });

  it("needs type and id together", async () => {
    const call = await connect();
    expect((await call("list_backups", { world_id: WORLD, type: "article" })).error).toMatch(/both type and id/);
  });
});

describe("searching backups", () => {
  it("finds text that is in a saved copy and gone from the item now", async () => {
    const call = await connect();
    await call("update_article", { article_id: ARTICLE, content: "Rewritten, shorter" });
    const found = await call("search_backups", { world_id: WORLD, text: "BORN IN VALE" });
    expect(found.items_found).toBe(1);
    expect(found.results[0]).toMatchObject({ type: "article", id: ARTICLE, title: "Hero" });
    expect(found.results[0].found_in[0]).toMatchObject({ saved: "before an edit", field: "content" });
    expect(found.results[0].found_in[0].snippet).toMatch(/The hero was born in Vale/);
  });

  it("reads a copy carried between world backups once, and can be narrowed by type", async () => {
    const call = await connect();
    await call("backup_world", { world_id: WORLD });
    await call("update_article", { article_id: ARTICLE, content: "Rewritten" });
    await call("backup_world", { world_id: WORLD });
    const found = await call("search_backups", { world_id: WORLD, text: "quiet valley" });
    expect(found.items_found).toBe(1);
    expect(found.results[0].found_in).toHaveLength(1);
    expect((await call("search_backups", { world_id: WORLD, text: "quiet valley", type: "category" })).items_found).toBe(0);
  });

  it("refuses a one-letter search", async () => {
    const call = await connect();
    expect((await call("search_backups", { world_id: WORLD, text: "a" })).error).toMatch(/at least two characters/);
  });
});

describe("comparing a saved copy with the item now", () => {
  it("lists the lines lost and added since the copy saved before the edit", async () => {
    const call = await connect();
    await call("update_article", { article_id: ARTICLE, content: "First line of lore\nLast line\nAn added line" });
    const result = await call("compare_backup", item);
    expect(result.identical).toBe(false);
    expect(result.compared_with.saved).toBe("before an edit");
    expect(result.text_lost_from).toEqual(["content"]);
    const content = result.differences.find((d) => d.field === "content");
    expect(content).toMatchObject({ kind: "text", lines_lost: 1, lines_added: 1, lost: ["The hero was born in Vale"], added: ["An added line"] });
    // Only the text: not the change date, not the world record (only its
    // date moved), and the word count as a line of its own.
    expect(result.differences.map((d) => d.field)).toEqual(["content"]);
    expect(result.words).toEqual({ saved: 11, now: 9, change: -2 });
    expect(result.note).toMatch(/Lines that were in the saved copy and are not in the item now: content/);
  });

  it("says so when nothing differs, and when nothing was lost", async () => {
    const call = await connect();
    await call("backup_item", item);
    expect(await call("compare_backup", item)).toMatchObject({ identical: true, differences: [] });

    articles[ARTICLE].content += "\nOnly an addition";
    const added = await call("compare_backup", item);
    expect(added.text_lost_from).toEqual([]);
    expect(added.note).toMatch(/no line of text from the saved copy is missing/);
  });

  it("compares with a named version, and refuses one that doesn't exist", async () => {
    const call = await connect();
    await call("backup_item", item);
    await call("update_article", { article_id: ARTICLE, content: "Second text" });
    const { versions } = await call("list_backups", { world_id: WORLD, ...item });
    const oldest = versions[versions.length - 1].version;
    expect((await call("compare_backup", { ...item, version: oldest })).compared_with.version).toBe(oldest);
    expect((await call("compare_backup", { ...item, version: "item:nope" })).error).toMatch(/not a saved version/);
    expect((await call("compare_backup", { type: "article", id: OTHER })).error).toMatch(/no saved copy/);
  });

  it("differences() compares what the saved copy holds, whatever the key order", () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonical({ a: [{ c: 3, d: 2 }], b: 1 }));
    expect(differences({ title: "A", tags: null }, { tags: null, title: "A", extra: 1 })).toEqual([]);
    expect(differences({ title: "A" }, { title: "B" })).toEqual([{ field: "title", kind: "value", saved: "A", current: "B" }]);
    // Last-changed dates are ignored at any depth; a real change beside one is not.
    const world = (state, date) => ({ world: { id: "w", state, updateDate: { date } } });
    expect(differences(world("private", "d1"), world("private", "d2"))).toEqual([]);
    expect(differences(world("private", "d1"), world("public", "d2"))).toEqual([
      { field: "world", kind: "value", saved: '{"id":"w","state":"private"}', current: '{"id":"w","state":"public"}' },
    ]);
  });
});

describe("restoring one item", () => {
  const edited = async (call) => {
    await call("update_article", { article_id: ARTICLE, content: "Ruined", title: "Hero (broken)" });
    // Changed by hand since: privacy and filing, which restore must leave alone.
    articles[ARTICLE].state = "public";
    articles[ARTICLE].category = { id: "c0000000-0000-4000-8000-000000000002", title: "Elsewhere" };
    const { versions } = await call("list_backups", { world_id: WORLD, ...item });
    return versions[0].version;
  };

  it("previews first and changes nothing", async () => {
    const call = await connect();
    const version = await edited(call);
    const before = patches().length;
    const preview = await call("restore_item", { ...item, version });
    expect(preview).toMatchObject({ restored: false, confirm_needed: true });
    expect(preview.would_restore.map((f) => f.field).sort()).toEqual(["content", "title"]);
    expect(preview.not_restored.map((f) => f.field).sort()).toEqual(["category", "state", "wordcount"]);
    expect(preview.not_restored.find((f) => f.field === "wordcount").why).toMatch(/works this out itself/);
    expect(preview.note).toMatch(/Nothing has been changed/);
    expect(patches()).toHaveLength(before);
  });

  it("with confirm: backs up the item as it is, writes plain values only, and reads back", async () => {
    const call = await connect();
    const version = await edited(call);
    const copiesBefore = files(dir).length;
    const result = await call("restore_item", { ...item, version, confirm: true });

    expect(result).toMatchObject({ restored: true });
    expect(result.fields_restored.sort()).toEqual(["content", "title"]);
    const sent = patches().pop().body;
    expect(Object.keys(sent).sort()).toEqual(["content", "title"]); // no state, no category
    expect(articles[ARTICLE]).toMatchObject({ title: "Hero", state: "public" });
    expect(articles[ARTICLE].content).toMatch(/The hero was born in Vale/);
    // The broken state was saved first, so the restore can be undone.
    expect(files(dir)).toHaveLength(copiesBefore + 1);
    const { versions } = await call("list_backups", { world_id: WORLD, ...item });
    expect(versions[0].saved).toBe("before an edit");
    expect(JSON.parse(readFileSync(files(dir).sort().pop(), "utf8")).data.content).toBe("Ruined");
  });

  it("says plainly when World Anvil does not take a field", async () => {
    const call = await connect();
    const version = await edited(call);
    const real = WorldAnvilClient.prototype.request.getMockImplementation();
    WorldAnvilClient.prototype.request.mockImplementation((endpoint, method, body) =>
      method === "PATCH" && body ? real(endpoint, method, { content: body.content }) : real(endpoint, method, body),
    );
    const result = await call("restore_item", { ...item, version, confirm: true });
    expect(result.restored).toBe(false);
    expect(result.fields_restored).toEqual(["content"]);
    expect(result.warning).toMatch(/did not take 1 field\(s\): title/);
  });

  it("reports nothing to restore when the plain values already match", async () => {
    const call = await connect();
    await call("backup_item", item);
    const { versions } = await call("list_backups", { world_id: WORLD, ...item });
    const result = await call("restore_item", { ...item, version: versions[0].version, confirm: true });
    expect(result.note).toMatch(/Nothing to restore/);
    expect(patches()).toHaveLength(0);
  });

  it("never picks a version itself, and only works on tested item types", async () => {
    const call = await connect();
    expect((await call("restore_item", { ...item, version: "" })).error).toMatch(/missing required|Say which saved version/);
    expect((await call("restore_item", { type: "secret", id: ARTICLE, version: "item:x" })).error).toMatch(/isn't supported yet/);
  });

  it("is refused in a read-only world, even as a preview", async () => {
    const call = await connect();
    const version = await edited(call);
    const readOnly = await connect({ world_list: { "Secret World": "blocked", "My Epic Saga": "read_only" } });
    const before = patches().length;
    expect((await readOnly("restore_item", { ...item, version, confirm: true })).error).toMatch(/read_only/);
    expect(patches()).toHaveLength(before);
    // Reading the backups is still allowed there.
    expect((await readOnly("compare_backup", item)).identical).toBe(false);
  });
});

describe("the access settings cover backups too", () => {
  /** Plant backups for the blocked world, as if taken before it was blocked. */
  const plant = () => {
    const folder = join(dir, "items", "Secret World-22222222", "article", `Hidden - ${HIDDEN}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "2026-11-01T09-00-00-000Z-update.json"),
      JSON.stringify({ backed_up_at: "2026-11-01T09:00:00.000Z", world: { id: SECRET_WORLD }, type: "article", id: HIDDEN, title: "Hidden", data: { content: "secret words" } }),
    );
  };

  it("a blocked world's backups can't be listed, searched, compared or restored", async () => {
    plant();
    const call = await connect();
    for (const result of [
      await call("list_backups", { world_id: SECRET_WORLD }),
      await call("list_backups", { world_id: SECRET_WORLD, type: "article", id: HIDDEN }),
      await call("search_backups", { world_id: SECRET_WORLD, text: "secret" }),
      await call("compare_backup", { type: "article", id: HIDDEN }),
      await call("restore_item", { type: "article", id: HIDDEN, version: "item:2026-11-01T09-00-00-000Z-update" }),
    ]) {
      expect(result.error).toMatch(/blocked/);
      expect(JSON.stringify(result)).not.toMatch(/secret words/);
    }
  });

  it("a backup filed under another world's folder is not read as that world's", async () => {
    // A copy whose own record names the blocked world, sitting in the open world's folder.
    const folder = join(dir, "items", "My Epic Saga-11111111", "article", `Hidden - ${HIDDEN}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "2026-11-01T09-00-00-000Z-update.json"),
      JSON.stringify({ world: { id: SECRET_WORLD }, type: "article", id: HIDDEN, title: "Hidden", data: { content: "secret words" } }),
    );
    const call = await connect();
    expect((await call("search_backups", { world_id: WORLD, text: "secret words" })).items_found).toBe(0);
    expect((await call("list_backups", { world_id: WORLD })).items_with_copies_of_their_own).toEqual({});
  });

  it("the look-back tools never change or remove a backup file", async () => {
    const call = await connect();
    await call("update_article", { article_id: ARTICLE, content: "Rewritten" });
    await call("backup_world", { world_id: WORLD });
    const snapshot = () => files(dir).sort().map((f) => `${f}:${readFileSync(f, "utf8").length}`);
    const before = snapshot();
    await call("list_backups", { world_id: WORLD });
    await call("list_backups", { world_id: WORLD, ...item });
    await call("search_backups", { world_id: WORLD, text: "hero" });
    await call("compare_backup", item);
    expect(snapshot()).toEqual(before);
  });
});
