/**
 * Local backups before every edit/delete: written read-only, rotated to
 * item_backup_keep, and "no backup, no change". Fake World Anvil; no network.
 */

import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { validateSettings } from "../src/access/config.js";
import { Backups, safeName } from "../src/access/backup.js";
import { WorldAnvilClient } from "../src/api-client.js";
import { createServer } from "../src/server.js";

const USER = "00000000-0000-4000-8000-000000000000";
const WORLD = "11111111-1111-4111-8111-111111111111";
const ARTICLE = "a0000000-0000-4000-8000-000000000001";

let calls;
let article;
let failBackupRead;

function fakeSend(endpoint, method = "GET") {
  calls.push({ endpoint, method });
  const [path, q = ""] = endpoint.split("?");
  const params = new URLSearchParams(q);
  if (path === "/identity") return Promise.resolve({ id: USER });
  if (path === "/user/worlds") return Promise.resolve({ entities: [{ id: WORLD, title: "My Epic Saga" }] });
  if (path === "/article" && method === "GET") {
    if (failBackupRead && params.get("granularity") === "2") return Promise.reject(new Error("timeout"));
    return Promise.resolve(article);
  }
  return Promise.resolve({ success: true });
}

function files(dir) {
  const out = [];
  const walk = (d) =>
    readdirSync(d, { withFileTypes: true }).forEach((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : out.push(join(d, e.name)),
    );
  walk(dir);
  return out;
}

async function connect(settings, backupDir) {
  vi.restoreAllMocks();
  vi.spyOn(WorldAnvilClient.prototype, "request").mockImplementation(fakeSend);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { server } = createServer({
    appKey: "k",
    authToken: "t",
    access: { settings: validateSettings(settings), file: "access.json", backupDir },
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return client;
}

beforeEach(() => {
  calls = [];
  failBackupRead = false;
  article = { id: ARTICLE, title: "Hero", content: "Original text v1", world: { id: WORLD } };
});

describe("backups before changes", () => {
  it("saves the previous version before an edit, read-only, then edits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    const c = await connect({}, dir);
    const r = await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: "v2" } });
    expect(r.isError).toBeFalsy();
    const saved = files(dir);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/items[\\/]My Epic Saga-11111111[\\/]article[\\/]a0000000-.*-update\.json$/);
    const record = JSON.parse(readFileSync(saved[0], "utf8"));
    expect(record).toMatchObject({ reason: "before update", id: ARTICLE, data: { content: "Original text v1" } });
    expect(statSync(saved[0]).mode & 0o222).toBe(0); // not writable
    // backup read happened before the change was sent
    const backupRead = calls.findIndex((x) => x.method === "GET" && x.endpoint.includes("granularity=2"));
    const patch = calls.findIndex((x) => x.method === "PATCH");
    expect(backupRead).toBeGreaterThan(-1);
    expect(patch).toBeGreaterThan(backupRead);
  });

  it("saves the item before a delete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    const c = await connect({}, dir);
    await c.callTool({ name: "worldanvil_delete_article", arguments: { article_id: ARTICLE } });
    expect(files(dir)[0]).toMatch(/-delete\.json$/);
  });

  it("keeps only item_backup_keep copies per item", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    const c = await connect({ item_backup_keep: 3 }, dir);
    for (let v = 1; v <= 5; v++) {
      article = { ...article, content: `text v${v}` };
      await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: `v${v + 1}` } });
      await new Promise((r) => setTimeout(r, 5));
    }
    const kept = files(dir).sort();
    expect(kept).toHaveLength(3);
    expect(kept.map((f) => JSON.parse(readFileSync(f, "utf8")).data.content)).toEqual(["text v3", "text v4", "text v5"]);
  });

  it("no backup, no change: refuses if the backup read fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    failBackupRead = true;
    const c = await connect({}, dir);
    const r = await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: "v2" } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/couldn't back up the item first.*nothing was changed/);
    expect(calls.some((x) => x.method === "PATCH")).toBe(false);
  });

  it("refuses changes when no backup folder is configured", async () => {
    const c = await connect({}, undefined);
    const r = await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: "v2" } });
    expect(r.content[0].text).toMatch(/backups aren't configured/);
    expect(calls.some((x) => x.method === "PATCH")).toBe(false);
  });

  it("does not back up reads or creates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    const c = await connect({}, dir);
    await c.callTool({ name: "worldanvil_get_article", arguments: { article_id: ARTICLE } });
    await c.callTool({ name: "worldanvil_create_article", arguments: { title: "New", world_id: WORLD } });
    expect(files(dir)).toHaveLength(0);
  });
});

describe("Backups helpers", () => {
  it("makes safe folder names", () => {
    expect(safeName('Qu"est: <Saga>/1')).toBe("Quest Saga1");
    expect(safeName("")).toBe("untitled");
  });
  it("refuses to start without a folder", () => {
    expect(() => new Backups({ keep: 3 })).toThrow(/not configured/);
  });
  it("never overwrites an existing backup file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    const b = new Backups({ dir, keep: 10 });
    const f = b.saveItem({ worldId: WORLD, worldTitle: "W", path: "/article", id: ARTICLE, action: "update", data: 1 });
    expect(() => writeFileSync(f, "tamper")).toThrow();
  });
});
