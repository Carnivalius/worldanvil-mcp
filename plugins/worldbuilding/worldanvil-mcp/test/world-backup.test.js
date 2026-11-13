/**
 * Whole-world backup. Offline: a fake client and a temporary folder.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { backupWorld, INCLUDED, PARTIAL_MAX_AGE_MS, SECTIONS } from "../src/access/world-backup.js";
import { WorldAnvilClient } from "../src/api-client.js";
import { handleToolCall } from "../src/handlers.js";

const WORLD = "11111111-1111-4111-8111-111111111111";

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-world-backup-"));
});
afterEach(() => {
  const unlock = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) unlock(p);
      else chmodSync(p, 0o644);
    }
  };
  unlock(dir);
  rmSync(dir, { recursive: true, force: true });
});

/** A fake world: `articles` and `categories` are {id, title, updateDate, body}. */
function fakeClient(state, { keep = 5 } = {}) {
  const page = (items) => async (_world, { limit, offset }) => ({
    entities: items()
      .slice(Number(offset), Number(offset) + Number(limit))
      .map(({ id, title, updateDate }) => ({ id, title, updateDate })),
  });
  const read = (items, kind) =>
    vi.fn(async (id) => {
      const found = items().find((x) => x.id === id);
      if (!found) throw Object.assign(new Error(`${kind} gone`), { status: 403 });
      if (state.failOn === id) throw Object.assign(new Error("server error"), { status: 500 });
      return { id, title: found.title, content: found.body };
    });
  const client = {
    access: { settings: { world_backup_keep: keep } },
    backups: { dir },
    getWorld: vi.fn(async (id) => {
      if (state.blocked) throw new Error("'Saga' is blocked in your access settings");
      return { id, title: "Saga: Test/World", state: "private" };
    }),
  };
  // Every list and read the backup knows about. `state.extra` maps a list
  // method to (parentId) => records; anything else is an empty list.
  (function add(sections) {
    for (const section of sections) {
      client[section.list] ??= vi.fn(async (parentId, { limit, offset }) => {
        if (state.failList?.[section.list]) throw Object.assign(new Error(state.failList[section.list].message), { status: state.failList[section.list].status });
        const records = state.extra?.[section.list]?.(parentId) ?? [];
        return { entities: records.slice(Number(offset), Number(offset) + Number(limit)) };
      });
      client[section.read] ??= vi.fn(async (id) => ({ id, body: `full ${section.type} ${id}` }));
      if (section.children) add(section.children);
    }
  })(SECTIONS);
  client.listCategories = vi.fn(page(() => state.categories));
  client.listArticles = vi.fn(page(() => state.articles));
  client.getCategory = read(() => state.categories, "category");
  client.getArticle = read(() => state.articles, "article");
  return client;
}

const article = (n, stamp = "2026-01-01") => ({
  id: `a000000${n}`,
  title: `Article ${n}`,
  updateDate: { date: stamp },
  body: `text of ${n}`,
});
const worldState = () => ({
  categories: [{ id: "c0000001", title: "People", updateDate: { date: "2026-01-01" }, body: "" }],
  articles: [article(1), article(2), article(3)],
});

/** A clock that moves on `step` ms every time it is read. */
const clock = (step = 0, start = Date.parse("2026-11-13T10:00:00Z")) => {
  let t = start;
  const now = () => (t += step);
  now.jump = (ms) => (t += ms);
  return now;
};

const json = (...parts) => JSON.parse(readFileSync(join(...parts), "utf8"));

describe("world backup", () => {
  it("saves the world, every category and every article, with a manifest", async () => {
    const client = fakeClient(worldState());
    const result = await backupWorld(client, WORLD, { now: clock() });

    expect(result).toMatchObject({
      done: true,
      saved: 4,
      total: 4,
      counts: { categories: 1, articles: 3 },
      read_from_world_anvil: 4,
      copied_unchanged_from_previous_backup: 0,
    });
    expect(result.folder.startsWith(join(dir, "worlds", "Saga TestWorld-11111111"))).toBe(true);
    expect(result.folder).not.toMatch(/\.partial$/);

    const manifest = json(result.folder, "manifest.json");
    expect(manifest.items).toHaveLength(4);
    expect(manifest.not_included).toMatch(/image files/);
    expect(manifest.could_not_be_saved).toEqual([]);
    expect(result.warning).toBeUndefined();
    expect(json(result.folder, "world.json").title).toBe("Saga: Test/World");
    expect(json(result.folder, "articles", "Article 2 - a0000002.json")).toMatchObject({
      type: "article",
      title: "Article 2",
      data: { content: "text of 2" },
    });
    expect(existsSync(join(result.folder, "categories", "People - c0000001.json"))).toBe(true);
    expect(existsSync(join(result.folder, "progress.json"))).toBe(false);
  });

  it("writes the backup read-only", async () => {
    const result = await backupWorld(fakeClient(worldState()), WORLD, { now: clock() });
    expect(() => writeFileSync(join(result.folder, "articles", "Article 1 - a0000001.json"), "x")).toThrow();
  });

  it("is refused when the world can't be read, and writes nothing", async () => {
    const client = fakeClient({ ...worldState(), blocked: true });
    await expect(backupWorld(client, WORLD, { now: clock() })).rejects.toThrow(/blocked/);
    expect(existsSync(join(dir, "worlds"))).toBe(false);
    expect(client.listArticles).not.toHaveBeenCalled();
  });

  it("is refused when no backup folder is configured", async () => {
    const client = { ...fakeClient(worldState()), backups: null };
    await expect(backupWorld(client, WORLD)).rejects.toThrow(/backups aren't configured/);
  });

  it("stops when out of time and carries on where it left off", async () => {
    const state = worldState();
    const client = fakeClient(state);
    // Each look at the clock moves it on 10 s; budget 25 s => a couple of items a call.
    const now = clock(10_000);

    const first = await backupWorld(client, WORLD, { now, budgetMs: 25_000 });
    expect(first.done).toBe(false);
    expect(first.note).toMatch(/NOT finished.*Call worldanvil_backup_world again/s);
    expect(first.folder).toBeUndefined();

    let last = first;
    let calls = 1;
    for (; calls < 60 && !last.done; calls++) last = await backupWorld(client, WORLD, { now, budgetMs: 25_000 });
    expect(calls).toBeGreaterThan(2);
    const listCalls = client.listArticles.mock.calls.length;
    expect(last).toMatchObject({ done: true, saved: 4, total: 4, read_from_world_anvil: 4 });
    expect(last.notes).toContain("Carried on with the backup already in progress.");
    // The lists were taken once, and no item was read twice.
    expect(listCalls).toBe(1);
    expect(client.listMaps.mock.calls.length).toBe(1);
    expect(client.getArticle).toHaveBeenCalledTimes(3);
    expect(readdirSync(join(dir, "worlds", "Saga TestWorld-11111111")).filter((n) => n.endsWith(".partial"))).toEqual([]);
  });

  it("copies unchanged items from the last backup and reads only what changed", async () => {
    const state = worldState();
    const now = clock();
    await backupWorld(fakeClient(state), WORLD, { now });

    state.articles[1] = { ...article(2, "2026-02-02"), body: "new text" }; // edited
    state.articles.push(article(4)); // new
    now.jump(60_000);
    const client = fakeClient(state);
    const second = await backupWorld(client, WORLD, { now });

    expect(second).toMatchObject({ done: true, saved: 5, read_from_world_anvil: 2, copied_unchanged_from_previous_backup: 3 });
    expect(client.getArticle.mock.calls.map((c) => c[0]).sort()).toEqual(["a0000002", "a0000004"]);
    expect(client.getCategory).not.toHaveBeenCalled();
    expect(json(second.folder, "articles", "Article 2 - a0000002.json").data.content).toBe("new text");
    expect(json(second.folder, "articles", "Article 1 - a0000001.json").data.content).toBe("text of 1"); // complete in itself
  });

  it("full reads everything again", async () => {
    const state = worldState();
    const now = clock();
    await backupWorld(fakeClient(state), WORLD, { now });
    now.jump(60_000);
    const client = fakeClient(state);
    const second = await backupWorld(client, WORLD, { now, full: true });
    expect(second).toMatchObject({ read_from_world_anvil: 4, copied_unchanged_from_previous_backup: 0 });
  });

  it("an item with no change date is always read", async () => {
    const state = worldState();
    state.articles[0].updateDate = null;
    const now = clock();
    await backupWorld(fakeClient(state), WORLD, { now });
    now.jump(60_000);
    const client = fakeClient(state);
    await backupWorld(client, WORLD, { now });
    expect(client.getArticle.mock.calls.map((c) => c[0])).toEqual(["a0000001"]);
  });

  it("keeps only the newest world_backup_keep backups", async () => {
    const state = worldState();
    const now = clock();
    const folders = [];
    for (let i = 0; i < 4; i++) {
      folders.push((await backupWorld(fakeClient(state, { keep: 2 }), WORLD, { now })).folder);
      now.jump(60_000);
    }
    expect(folders.map((f) => existsSync(f))).toEqual([false, false, true, true]);
    // The newest still has every file, though most were copied forward.
    expect(json(folders[3], "articles", "Article 3 - a0000003.json").data.content).toBe("text of 3");
  });

  it("notes an item deleted since the list was taken, and still finishes", async () => {
    const state = worldState();
    const client = fakeClient(state);
    client.getArticle.mockImplementationOnce(async () => {
      throw Object.assign(new Error("access_denied"), { status: 403 });
    });
    const result = await backupWorld(client, WORLD, { now: clock() });
    expect(result).toMatchObject({ done: true, saved: 3, total: 4 });
    expect(result.notes.join(" ")).toMatch(/1 item\(s\) were listed but could not be read/);
    const manifest = json(result.folder, "manifest.json");
    expect(manifest.missing).toHaveLength(1);
    expect(manifest.items).toHaveLength(3);
  });

  it("any other failure stops the call; the next call carries on", async () => {
    const state = { ...worldState(), failOn: "a0000002" };
    const client = fakeClient(state);
    const now = clock();
    await expect(backupWorld(client, WORLD, { now })).rejects.toThrow(/server error/);
    const worldDir = join(dir, "worlds", "Saga TestWorld-11111111");
    expect(readdirSync(worldDir).every((n) => n.endsWith(".partial"))).toBe(true); // no half backup passed off as whole

    state.failOn = null;
    const result = await backupWorld(client, WORLD, { now });
    expect(result).toMatchObject({ done: true, saved: 4 });
    expect(client.getArticle.mock.calls.filter((c) => c[0] === "a0000001")).toHaveLength(1);
  });

  it("restart discards a backup in progress", async () => {
    const state = worldState();
    const client = fakeClient(state);
    const now = clock(10_000);
    expect((await backupWorld(client, WORLD, { now, budgetMs: 25_000 })).done).toBe(false);
    const again = await backupWorld(client, WORLD, { now: clock(), restart: true });
    expect(again).toMatchObject({ done: true, read_from_world_anvil: 4 });
    expect(again.notes).toBeUndefined();
  });

  it("a half-finished backup more than a day old is started again", async () => {
    const state = worldState();
    const client = fakeClient(state);
    const stepping = clock(10_000);
    expect((await backupWorld(client, WORLD, { now: stepping, budgetMs: 25_000 })).done).toBe(false);
    const later = clock(0, Date.parse("2026-11-13T10:00:00Z") + PARTIAL_MAX_AGE_MS + 3_600_000);
    const result = await backupWorld(client, WORLD, { now: later });
    expect(result.done).toBe(true);
    expect(result.notes.join(" ")).toMatch(/more than a day ago was discarded/);
    expect(result.read_from_world_anvil).toBe(4);
  });

  it("a world with nothing but articles is fine: empty sections are just empty", async () => {
    const client = fakeClient({ categories: [], articles: [article(1)] });
    const result = await backupWorld(client, WORLD, { now: clock() });
    expect(result).toMatchObject({ done: true, saved: 1, counts: { articles: 1 } });
    expect(client.listMaps).toHaveBeenCalledTimes(1);
    expect(client.listManuscripts).toHaveBeenCalledTimes(1);
    expect(existsSync(join(result.folder, "maps"))).toBe(false);
  });

  it("an entirely empty world still makes a backup", async () => {
    const result = await backupWorld(fakeClient({ categories: [], articles: [] }), WORLD, { now: clock() });
    expect(result).toMatchObject({ done: true, saved: 0, total: 0 });
    expect(result.note).toMatch(/the world is empty/);
    expect(existsSync(join(result.folder, "world.json"))).toBe(true);
  });

  it("saves nested things: a map's markers, a manuscript's drafts, chapters and beats", async () => {
    const state = {
      ...worldState(),
      extra: {
        listMaps: () => [{ id: "map1", title: "Realm" }],
        listMarkers: (mapId) => (mapId === "map1" ? [{ id: "mk1", title: "Capital" }, { id: "mk2", title: "Port" }] : []),
        listLayers: (mapId) => (mapId === "map1" ? [{ id: "ly1", title: "Political" }] : []),
        listManuscripts: () => [{ id: "ms1", title: "Novel" }],
        listManuscriptVersions: (id) => (id === "ms1" ? [{ id: "v1", title: "Draft 1" }] : []),
        listManuscriptParts: (id) => (id === "v1" ? [{ id: "p1", title: "Chapter 1" }, { id: "p2", title: "Scene 1" }] : []),
        listManuscriptBeats: (id) => (id === "p2" ? [{ id: "b1", title: "Beat" }] : []),
        listManuscriptLabels: (id) => (id === "ms1" ? [{ id: "lb1", title: "Blue" }] : []),
      },
    };
    const client = fakeClient(state);
    const result = await backupWorld(client, WORLD, { now: clock() });

    expect(result.done).toBe(true);
    expect(result.counts).toMatchObject({
      maps: 1,
      "map markers": 2,
      "map layers": 1,
      manuscripts: 1,
      "manuscript drafts": 1,
      "chapters and scenes": 2,
      beats: 1,
      "manuscript labels": 1,
    });
    expect(existsSync(join(result.folder, "map-markers", "Port - mk2.json"))).toBe(true);
    expect(json(result.folder, "manuscript-beats", "Beat - b1.json")).toMatchObject({
      type: "manuscript_beat",
      parent: { type: "manuscript_part", id: "p2" },
    });
    const manifest = json(result.folder, "manifest.json");
    expect(manifest.items.find((i) => i.id === "p1").parent).toEqual({ type: "manuscript_version", id: "v1" });
    expect(manifest.items.find((i) => i.id === "map1").parent).toBeNull();
    // Each part's beats were asked for exactly once.
    expect(client.listManuscriptBeats).toHaveBeenCalledTimes(2);
  });

  it("a list World Anvil refuses is reported, and everything else is still saved", async () => {
    const state = {
      ...worldState(),
      extra: { listManuscripts: () => [{ id: "ms1", title: "Novel" }] },
      failList: { listManuscriptBookmarks: { status: 422, message: "ManuscriptBookmark has no field named ASC" } },
    };
    const result = await backupWorld(fakeClient(state), WORLD, { now: clock() });
    expect(result.done).toBe(true);
    expect(result.saved).toBe(5);
    expect(result.warning).toMatch(/NOT in this backup.*manuscript bookmarks/);
    expect(result.could_not_be_saved).toEqual([
      { what: "manuscript bookmarks", of: { type: "manuscript", id: "ms1" }, reason: "ManuscriptBookmark has no field named ASC" },
    ]);
    expect(json(result.folder, "manifest.json").could_not_be_saved).toHaveLength(1);
  });

  it("never finishes without the articles or categories", async () => {
    for (const list of ["listArticles", "listCategories"]) {
      const client = fakeClient(worldState());
      client[list] = vi.fn(async () => {
        throw Object.assign(new Error("server error"), { status: 500 });
      });
      await expect(backupWorld(client, WORLD, { now: clock(), restart: true })).rejects.toThrow(/server error/);
      const worldDir = join(dir, "worlds", "Saga TestWorld-11111111");
      expect(readdirSync(worldDir).every((n) => n.endsWith(".partial"))).toBe(true);
    }
  });

  it("a rate limit on any list stops the call instead of skipping the section", async () => {
    const state = { ...worldState(), failList: { listMaps: { status: 429, message: "limiting requests" } } };
    const client = fakeClient(state);
    await expect(backupWorld(client, WORLD, { now: clock() })).rejects.toThrow(/limiting requests/);
    state.failList = null;
    const result = await backupWorld(client, WORLD, { now: clock() });
    expect(result).toMatchObject({ done: true, saved: 4 });
    expect(result.warning).toBeUndefined();
  });

  it("every list and read it names exists on the real client", () => {
    const names = [];
    (function collect(sections) {
      for (const x of sections) {
        names.push(x.list, x.read);
        if (x.children) collect(x.children);
      }
    })(SECTIONS);
    for (const name of names) expect(typeof WorldAnvilClient.prototype[name], name).toBe("function");
    expect(INCLUDED).toContain("articles");
    expect(INCLUDED).toContain("chapters and scenes");
  });

  it("is reachable as a tool", async () => {
    const response = await handleToolCall("worldanvil_backup_world", { world_id: WORLD }, fakeClient(worldState()));
    expect(response.isError).toBeFalsy();
    expect(JSON.parse(response.content[0].text)).toMatchObject({ done: true, saved: 4 });
  });
});

describe("item backup names", () => {
  it("names the folder by title and id, separately for each world", async () => {
    const { Backups } = await import("../src/access/backup.js");
    const backups = new Backups({ dir, keep: 10 });
    const save = (worldId, worldTitle, title) =>
      backups.saveItem({ worldId, worldTitle, path: "/article", id: "a0000001", action: "update", data: { title } });
    const one = save("11111111-aaaa", "World One", "Hello");
    const two = save("22222222-bbbb", "World Two", "Hello");
    expect(one).toContain(join("items", "World One-11111111", "article", "Hello - a0000001"));
    expect(two).toContain(join("items", "World Two-22222222", "article", "Hello - a0000001"));
  });

  it("keeps an item's versions together when it is renamed, and adopts an old id-only folder", async () => {
    const { Backups } = await import("../src/access/backup.js");
    const backups = new Backups({ dir, keep: 10 });
    const args = { worldId: "11111111-aaaa", worldTitle: "World One", path: "/article", id: "a0000001", action: "update" };
    backups.saveItem({ ...args, data: { title: "Hello" } });
    await new Promise((r) => setTimeout(r, 5));
    backups.saveItem({ ...args, data: { title: "Hello Again" } });
    const parent = join(dir, "items", "World One-11111111", "article");
    expect(readdirSync(parent)).toEqual(["Hello Again - a0000001"]);
    expect(readdirSync(join(parent, "Hello Again - a0000001"))).toHaveLength(2);

    // A folder from before titles were added (named by id alone) is picked up too.
    const { mkdirSync } = await import("fs");
    mkdirSync(join(parent, "b0000002"));
    backups.saveItem({ ...args, id: "b0000002", data: { title: "Old One" } });
    expect(readdirSync(parent).sort()).toEqual(["Hello Again - a0000001", "Old One - b0000002"]);
  });

  it("an item with no title is still saved", async () => {
    const { Backups } = await import("../src/access/backup.js");
    const file = new Backups({ dir, keep: 10 }).saveItem({
      worldId: "11111111-aaaa", worldTitle: "W", path: "/secret", id: "s1", action: "delete", data: {},
    });
    expect(file).toContain("untitled - s1");
  });
});
