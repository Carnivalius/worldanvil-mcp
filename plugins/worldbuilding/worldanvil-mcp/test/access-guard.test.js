/**
 * World access enforcement: levels, allow-only, world resolution, id checks,
 * cross-world references, disabled endpoints, and the server wiring.
 * Uses a fake World Anvil; no network.
 */

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { validateSettings } from "../src/access/config.js";
import { AccessError, WorldAccess, collectRefs, parseEndpoint } from "../src/access/guard.js";
import { WorldAnvilClient } from "../src/api-client.js";
import { createServer, visibleTools, ALWAYS_DISABLED_TOOLS } from "../src/server.js";
import { sanitizeFields } from "../src/handlers.js";

// ---- fake account ---------------------------------------------------------
const USER = "00000000-0000-4000-8000-000000000000";
const W = {
  saga: "11111111-1111-4111-8111-111111111111", // "My Epic Saga"
  camp: "22222222-2222-4222-8222-222222222222", // "Old Campaign"
  notes: "33333333-3333-4333-8333-333333333333", // "Lore Notes"
  twin1: "44444444-4444-4444-8444-444444444444", // "Twin"
  twin2: "55555555-5555-4555-8555-555555555555", // "Twin"
};
const I = {
  article: "a0000000-0000-4000-8000-000000000001", // in saga
  campArticle: "a0000000-0000-4000-8000-000000000002", // in camp
  category: "c0000000-0000-4000-8000-000000000001", // in saga
  campCategory: "c0000000-0000-4000-8000-000000000002", // in camp
  manuscript: "d0000000-0000-4000-8000-000000000001", // in notes
  version: "e0000000-0000-4000-8000-000000000001", // -> manuscript
  part: "f0000000-0000-4000-8000-000000000001", // -> version
  orphan: "b0000000-0000-4000-8000-000000000001", // no world info
};

const ITEMS = {
  [I.article]: { id: I.article, title: "Hero", world: { id: W.saga } },
  [I.campArticle]: { id: I.campArticle, title: "Villain", world: { id: W.camp } },
  [I.category]: { id: I.category, world: { id: W.saga } },
  [I.campCategory]: { id: I.campCategory, world: { id: W.camp } },
  [I.manuscript]: { id: I.manuscript, world: { id: W.notes } },
  [I.version]: { id: I.version, manuscript: { id: I.manuscript } },
  [I.part]: { id: I.part, title: "Chapter 1", manuscriptVersion: { id: I.version } },
  [I.orphan]: { id: I.orphan, title: "???" },
};

const WORLDS = [
  { id: W.saga, title: "My Epic Saga" },
  { id: W.camp, title: "Old Campaign" },
  { id: W.notes, title: "Lore Notes" },
  { id: W.twin1, title: "Twin" },
  { id: W.twin2, title: "Twin" },
];

let calls;
function fakeSend(endpoint, method = "GET", body = null) {
  calls.push({ endpoint, method, body });
  const [path, q = ""] = endpoint.split("?");
  const id = new URLSearchParams(q).get("id");
  if (path === "/identity") return Promise.resolve({ id: USER, username: "tester" });
  if (path === "/user/worlds") return Promise.resolve({ entities: WORLDS });
  if (method === "GET" && path === "/world") return Promise.resolve({ id, title: "w" });
  if (method === "GET" && ITEMS[id]) return Promise.resolve(ITEMS[id]);
  if (method === "PUT") return Promise.resolve({ id: "99999999-9999-4999-8999-999999999999", success: true });
  return Promise.resolve({ success: true, entities: [] });
}

function makeAccess(settings = {}) {
  return new WorldAccess({
    settings: validateSettings(settings),
    file: "access.json",
    send: fakeSend,
    log: () => {},
  });
}

beforeEach(() => {
  calls = [];
});

const denied = (p, re) => expect(p).rejects.toThrow(re ?? AccessError);

// ---- request shape checks ---------------------------------------------------
describe("id and parameter checks", () => {
  it("accepts normal endpoints", () => {
    expect(parseEndpoint(`/article?id=${I.article}&granularity=2`)).toEqual({ path: "/article", id: I.article });
  });
  it("refuses a second id smuggled into the query", () => {
    expect(() => parseEndpoint(`/article?id=${I.article}&id=${I.campArticle}`)).toThrow(/more than one id/);
  });
  it("refuses ids that aren't World Anvil ids", () => {
    expect(() => parseEndpoint("/article?id=../../x")).toThrow(/not a valid World Anvil id/);
    expect(() => parseEndpoint("/article?id=undefined%20x")).toThrow(/not a valid/);
  });
  it("refuses unexpected parameters", () => {
    expect(() => parseEndpoint(`/article?id=${I.article}&world=${W.camp}`)).toThrow(/unexpected request parameter/);
  });
  it("collects references and refuses unknown reference fields", () => {
    expect(collectRefs({ title: "x", world: { id: W.saga }, category: { id: I.category } }, "/article")).toHaveLength(2);
    expect(() => collectRefs({ mystery: { id: W.saga } }, "/article")).toThrow(/can't tell which world "mystery"/);
    expect(() => collectRefs({ world: { id: "bad id!" } }, "/article")).toThrow(/not a valid/);
  });
});

// ---- resolution of world_list -------------------------------------------------
describe("resolving world_list", () => {
  it("matches names (case-insensitive) and ids", async () => {
    const a = makeAccess({ world_list: { "my epic saga": "read_only", [W.camp]: "blocked" } });
    await a.resolve();
    expect(a.levelFor(W.saga).level).toBe("read_only");
    expect(a.levelFor(W.camp).level).toBe("blocked");
  });
  it("refuses a name that matches no world", async () => {
    await denied(makeAccess({ world_list: { "Renamed World": "read_only" } }).resolve(), /doesn't match any of your worlds/);
  });
  it("refuses an ambiguous name and suggests the id", async () => {
    await denied(makeAccess({ world_list: { Twin: "read_only" } }).resolve(), /matches 2 worlds; use the world's id/);
  });
  it("refuses the same world listed by name and id", async () => {
    await denied(makeAccess({ world_list: { "My Epic Saga": "read_only", [W.saga]: "full_edit" } }).resolve(), /listed twice/);
  });
  it("summarises the effective rules in plain words", async () => {
    const a = makeAccess({ world_list: { "My Epic Saga": "read_only", "Old Campaign": "blocked" } });
    await a.resolve();
    expect(a.summary()).toMatch(/5 worlds: 3 full_edit, 1 read_only, 1 blocked/);
  });
});

// ---- levels -------------------------------------------------------------------
describe("access levels", () => {
  const settings = {
    world_list: { "My Epic Saga": "edit_only", "Old Campaign": "blocked", "Lore Notes": "read_only" },
  };

  it("full_edit (default) allows everything, including deletes", async () => {
    const a = makeAccess({});
    await a.check(`/article?id=${I.article}`, "DELETE");
    await a.check(`/article?id=${I.article}`, "PATCH", { title: "x" });
  });

  it("edit_only allows read, create and update but not delete", async () => {
    const a = makeAccess(settings);
    await a.check(`/article?id=${I.article}&granularity=2`, "GET");
    await a.check("/article", "PUT", { title: "x", world: { id: W.saga } });
    await a.check(`/article?id=${I.article}`, "PATCH", { title: "y" });
    await denied(a.check(`/article?id=${I.article}`, "DELETE"), /'My Epic Saga' is edit_only.*can't delete items in it/);
  });

  it("read_only allows only reads, through parent chains", async () => {
    const a = makeAccess(settings);
    await a.check(`/manuscript_part?id=${I.part}&granularity=2`, "GET");
    await a.check(`/manuscript_version/manuscript_parts?id=${I.version}`, "POST", {});
    await denied(a.check(`/manuscript_part?id=${I.part}`, "PATCH", { content: "x" }), /'Lore Notes' is read_only.*can't change it/);
    await denied(a.check("/manuscript_part", "PUT", { title: "c", manuscriptVersion: { id: I.version } }), /read_only/);
  });

  it("blocked allows nothing, with a clear reason", async () => {
    const a = makeAccess(settings);
    await denied(a.check(`/world?id=${W.camp}&granularity=2`, "GET"), /'Old Campaign' is blocked/);
    await denied(a.check(`/article?id=${I.campArticle}&granularity=2`, "GET"), /blocked/);
    await denied(a.check(`/world/articles?id=${W.camp}`, "POST", {}), /blocked/);
  });

  it("allow_only refuses unlisted worlds with an allow-list reason", async () => {
    const a = makeAccess({ allow_only: true, world_list: { "My Epic Saga": "full_edit", "Lore Notes": "read_only" } });
    await a.check(`/article?id=${I.article}`, "DELETE");
    await a.check(`/manuscript?id=${I.manuscript}`, "GET");
    await denied(a.check(`/article?id=${I.campArticle}`, "GET"), /'Old Campaign' is not on your allow list/);
  });

  it("default_access applies to unlisted worlds when allow_only is off", async () => {
    const a = makeAccess({ default_access: "read_only" });
    await a.check(`/article?id=${I.article}`, "GET");
    await denied(a.check(`/article?id=${I.article}`, "PATCH", {}), /read_only/);
  });
});

// ---- fail closed and cross-world ------------------------------------------------
describe("fail closed", () => {
  it("refuses items whose world can't be determined", async () => {
    await denied(makeAccess().check(`/article?id=${I.orphan}`, "GET"), /can't tell which world/);
  });
  it("refuses worlds that aren't the user's", async () => {
    await denied(makeAccess().check("/world?id=77777777-7777-4777-8777-777777777777", "GET"), /not one of your worlds/);
  });
  it("refuses creates with no world reference", async () => {
    await denied(makeAccess().check("/article", "PUT", { title: "x" }), /can't tell which world/);
  });
  it("refuses moving an item to another world", async () => {
    await denied(makeAccess().check(`/article?id=${I.article}`, "PATCH", { world: { id: W.camp } }), /moving items between worlds/);
  });
  it("refuses linking to an item in another world", async () => {
    await denied(
      makeAccess().check(`/article?id=${I.article}`, "PATCH", { category: { id: I.campCategory } }),
      /cross-world links aren't allowed/,
    );
    await denied(
      makeAccess().check("/article", "PUT", { title: "x", world: { id: W.saga }, category: { id: I.campCategory } }),
      /mixes items/,
    );
  });
});

// ---- worlds and disabled endpoints ----------------------------------------------
describe("world-level rules", () => {
  it("creating worlds follows allow_create_worlds", async () => {
    await makeAccess({ allow_create_worlds: true }).check("/world", "PUT", { title: "New" });
    await denied(makeAccess({ allow_create_worlds: false }).check("/world", "PUT", { title: "New" }), /creating worlds is turned off/);
  });
  it("renaming worlds is not supported", async () => {
    await denied(makeAccess().check(`/world?id=${W.saga}`, "PATCH", { title: "x" }), /renaming worlds/);
  });
  it("deleting worlds needs the switch, full_edit, and a world backup", async () => {
    await denied(makeAccess().check(`/world?id=${W.saga}`, "DELETE"), /deleting worlds is turned off/);
    await denied(
      makeAccess({ allow_delete_worlds: true, world_list: { "My Epic Saga": "edit_only" } }).check(`/world?id=${W.saga}`, "DELETE"),
      /edit_only/,
    );
    await denied(makeAccess({ allow_delete_worlds: true }).check(`/world?id=${W.saga}`, "DELETE"), /world backup/);
  });
  it("account, image and subscriber-group endpoints are disabled", async () => {
    const a = makeAccess();
    await denied(a.check(`/user?id=${USER}&granularity=2`, "GET"), /account-level/);
    await denied(a.check(`/user?id=${USER}`, "PATCH", {}), /account-level/);
    await denied(a.check(`/image?id=${I.article}`, "GET"), /image tools/);
    await denied(a.check(`/world/images?id=${W.saga}`, "POST", {}), /image tools/);
    await denied(a.check(`/world/subscribergroups?id=${W.saga}`, "POST", {}), /subscriber-group/);
  });
  it("lists every world with its access, hiding details of blocked ones", async () => {
    const a = makeAccess({ allow_only: true, world_list: { "My Epic Saga": "read_only", "Old Campaign": "blocked" } });
    await a.resolve();
    const out = a.annotateWorldList({ entities: WORLDS.map((w) => ({ ...w, description: "secret" })) });
    const by = Object.fromEntries(out.entities.map((w) => [w.title + (w.id === W.twin2 ? "2" : ""), w]));
    expect(by["My Epic Saga"]).toMatchObject({ access: "read_only", description: "secret" });
    expect(by["Old Campaign"]).toEqual({ id: W.camp, title: "Old Campaign", access: "blocked" });
    expect(by["Lore Notes"]).toEqual({ id: W.notes, title: "Lore Notes", access: "not on allow list" });
  });
});

// ---- server wiring ------------------------------------------------------------------
describe("server: tools and settings", () => {
  const names = (s) => visibleTools(validateSettings(s), null).map((t) => t.name);

  it("never offers account, image, subscriber-group or rename tools", () => {
    const visible = names({ allow_delete_worlds: true });
    for (const t of ALWAYS_DISABLED_TOOLS) expect(visible).not.toContain(t);
  });
  it("offers create/delete world only when switched on", () => {
    expect(names({})).toContain("worldanvil_create_world");
    expect(names({})).not.toContain("worldanvil_delete_world");
    expect(names({ allow_create_worlds: false })).not.toContain("worldanvil_create_world");
    expect(names({ allow_delete_worlds: true })).toContain("worldanvil_delete_world");
  });
  it("tells the AI to confirm the new world's access level", () => {
    const t = visibleTools(validateSettings({ new_world_access: "edit_only" }), null).find(
      (x) => x.name === "worldanvil_create_world",
    );
    expect(t.description).toMatch(/ask the user which access level.*suggested: edit_only/);
    expect(t.inputSchema.required).toContain("access_level");
  });
  it("rejects protected or structured article fields", () => {
    expect(sanitizeFields({ anatomy: "**x**", population: 3 })).toEqual({ anatomy: "[b]x[/b]", population: 3 });
    expect(() => sanitizeFields({ world: "x" })).toThrow(/can't be set through fields/);
    expect(() => sanitizeFields({ State: "public" })).toThrow(/can't be set/);
    expect(() => sanitizeFields({ anatomy: { id: "x" } })).toThrow(/text, a number/);
    expect(() => sanitizeFields({ "bad key": "x" })).toThrow(/not a valid/);
  });
});

describe("server: end to end (fake World Anvil)", () => {
  async function connect(settings, file = "access.json") {
    vi.restoreAllMocks();
    vi.spyOn(WorldAnvilClient.prototype, "request").mockImplementation(fakeSend);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { server } = createServer({
      appKey: "k",
      authToken: "t",
      access: { settings: validateSettings(settings), file },
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await Promise.all([client.connect(ct), server.connect(st)]);
    return client;
  }
  const text = (r) => r.content[0].text;

  it("refuses hidden tools even if called directly", async () => {
    const c = await connect({});
    const r = await c.callTool({ name: "worldanvil_update_user", arguments: { user_id: USER } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Unknown tool/);
    expect(calls.some((x) => x.endpoint.startsWith("/user?"))).toBe(false);
  });

  it("reports missing required arguments instead of sending 'undefined'", async () => {
    const c = await connect({});
    const r = await c.callTool({ name: "worldanvil_get_article", arguments: {} });
    expect(text(r)).toMatch(/missing required argument\(s\): article_id/);
    expect(calls).toHaveLength(0);
  });

  it("returns the reason when a blocked world's article is requested, never its content", async () => {
    const c = await connect({ world_list: { "Old Campaign": "blocked" } });
    const r = await c.callTool({ name: "worldanvil_get_article", arguments: { article_id: I.campArticle } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/'Old Campaign' is blocked/);
    expect(text(r)).not.toMatch(/Villain/);
  });

  it("refuses an id with a smuggled second id", async () => {
    const c = await connect({});
    const r = await c.callTool({
      name: "worldanvil_get_article",
      arguments: { article_id: `${I.article}&id=${I.campArticle}` },
    });
    expect(text(r)).toMatch(/more than one id|not a valid/);
  });

  it("list_worlds shows blocked worlds as blocked", async () => {
    const c = await connect({ world_list: { "Old Campaign": "blocked" } });
    const r = await c.callTool({ name: "worldanvil_list_worlds", arguments: {} });
    const out = JSON.parse(text(r));
    expect(out.entities.find((w) => w.id === W.camp).access).toBe("blocked");
  });

  it("create_world requires a level and adds the world to the settings file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-access-"));
    const file = join(dir, "access.json");
    writeFileSync(file, JSON.stringify({ allow_only: true, world_list: { "My Epic Saga": "full_edit" } }));
    WORLDS.push({ id: "99999999-9999-4999-8999-999999999999", title: "Brand New World" });
    try {
      const c = await connect({ allow_only: true, world_list: { "My Epic Saga": "full_edit" } }, file);
      const noLevel = await c.callTool({ name: "worldanvil_create_world", arguments: { title: "Brand New World" } });
      expect(text(noLevel)).toMatch(/missing required argument\(s\): access_level/);
      const r = await c.callTool({
        name: "worldanvil_create_world",
        arguments: { title: "Brand New World", access_level: "edit_only" },
      });
      expect(r.isError).toBeFalsy();
      expect(JSON.parse(text(r)).access_settings).toBe(
        'Added to your access settings as "Brand New World": edit_only',
      );
      const saved = JSON.parse(readFileSync(file, "utf8"));
      expect(saved.world_list).toEqual({ "My Epic Saga": "full_edit", "Brand New World": "edit_only" });
      expect(readdirSync(dir).some((f) => f.endsWith(".bak"))).toBe(true);
    } finally {
      WORLDS.pop();
    }
  });
});
