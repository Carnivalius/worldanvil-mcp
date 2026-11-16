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
  const [path] = endpoint.split("?");
  if (path === "/identity") return Promise.resolve({ id: USER });
  if (path === "/user/worlds") return Promise.resolve({ entities: [{ id: WORLD, title: "My Epic Saga" }] });
  if (path === "/article" && method === "GET") {
    if (failBackupRead) return Promise.reject(new Error("timeout"));
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
    expect(saved[0]).toMatch(/items[\\/]My Epic Saga-11111111[\\/]article[\\/]Hero - a0000000-[0-9a-f-]+[\\/][^\\/]+-update\.json$/);
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

  it("a copy under backup_keep_days old is never pruned, even over item_backup_keep", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    const c = await connect({ item_backup_keep: 3 }, dir);
    for (let v = 1; v <= 5; v++) {
      article = { ...article, content: `text v${v}` };
      await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: `v${v + 1}` } });
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(files(dir)).toHaveLength(5);
  });

  it("no backup, no change: refuses if the backup read fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    const c = await connect({}, dir);
    // A first edit succeeds; the article's world is now remembered, so the
    // next edit's only read is the backup read.
    await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: "v2" } });
    expect(calls.filter((x) => x.method === "PATCH")).toHaveLength(1);

    failBackupRead = true;
    // An icon change reads nothing first, and fresh_backup sets aside the read
    // remembered from the edit above: so the only read is the backup read.
    const r = await c.callTool({
      name: "worldanvil_update_article",
      arguments: { article_id: ARTICLE, icon: "fa-crown", fresh_backup: true },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/couldn't back up the item first.*nothing was changed/);

    // A text change reads the article first; that failing stops it just as surely.
    const t = await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: "v3" } });
    expect(t.isError).toBe(true);
    expect(t.content[0].text).toMatch(/Couldn't read the article before changing it.*Nothing was sent/);
    expect(calls.filter((x) => x.method === "PATCH")).toHaveLength(1);
    expect(files(dir)).toHaveLength(1);
  });

  it("refuses an edit when the item can't be read at all", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    failBackupRead = true;
    const c = await connect({}, dir);
    const r = await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: "v2" } });
    expect(r.isError).toBe(true);
    expect(calls.some((x) => x.method === "PATCH")).toBe(false);
    expect(files(dir)).toHaveLength(0);
  });

  it("backs up before the edit, and the backup holds the text as it was", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    const c = await connect({}, dir);
    await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: "v2" } });
    // The tool reads the article (to see whether anything would change); that read
    // is the backup; the edit is sent; the last GET is the read-back after saving.
    expect(calls.filter((x) => x.endpoint.startsWith("/article?")).map((x) => x.method)).toEqual(["GET", "PATCH", "GET"]);
    expect(JSON.parse(readFileSync(files(dir)[0], "utf8")).data.content).toBe("Original text v1");
  });

  it("refuses changes when no backup folder is configured", async () => {
    const c = await connect({}, undefined);
    const r = await c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, content: "v2" } });
    expect(r.content[0].text).toMatch(/backups aren't configured/);
    expect(calls.some((x) => x.method === "PATCH")).toBe(false);
  });

  describe("a read from the last few seconds stands in for the backup read", () => {
    const articleCalls = () => calls.filter((x) => x.endpoint.startsWith("/article?")).map((x) => x.method);
    const get = (c) => c.callTool({ name: "worldanvil_get_article", arguments: { article_id: ARTICLE } });
    const setIcon = (c, extra = {}) =>
      c.callTool({ name: "worldanvil_update_article", arguments: { article_id: ARTICLE, icon: "fa-crown", ...extra } });
    const backupText = (dir) => JSON.parse(readFileSync(files(dir).at(-1), "utf8")).data.content;

    it("an edit just after a read backs up that read, without reading again", async () => {
      const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
      const c = await connect({}, dir);
      await get(c);
      const r = await setIcon(c);
      expect(r.isError).toBeFalsy();
      expect(articleCalls()).toEqual(["GET", "PATCH"]);
      expect(files(dir)).toHaveLength(1);
      expect(backupText(dir)).toBe("Original text v1");
    });

    it("the remembered read is used once: a second edit reads afresh", async () => {
      const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
      const c = await connect({ item_backup_keep: 5 }, dir);
      await get(c);
      await setIcon(c);
      article = { ...article, content: "Text after the first edit" };
      await setIcon(c);
      expect(articleCalls()).toEqual(["GET", "PATCH", "GET", "PATCH"]);
      const texts = files(dir).map((f) => JSON.parse(readFileSync(f, "utf8")).data.content).sort();
      expect(texts).toEqual(["Original text v1", "Text after the first edit"]);
    });

    it("a read older than 15 seconds is not used", async () => {
      const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
      const c = await connect({}, dir);
      const start = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(start);
      await get(c);
      clock.mockReturnValue(start + 14_000);
      article = { ...article, content: "Edited elsewhere meanwhile" };
      clock.mockReturnValue(start + 16_000);
      await setIcon(c);
      clock.mockRestore();
      expect(articleCalls()).toEqual(["GET", "GET", "PATCH"]);
      expect(backupText(dir)).toBe("Edited elsewhere meanwhile");
    });

    it("fresh_backup reads afresh even straight after a read", async () => {
      const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
      const c = await connect({}, dir);
      await get(c);
      article = { ...article, content: "Edited elsewhere meanwhile" };
      await setIcon(c, { fresh_backup: true });
      expect(articleCalls()).toEqual(["GET", "GET", "PATCH"]);
      expect(backupText(dir)).toBe("Edited elsewhere meanwhile");
    });

    it("fresh_backup on a text update: read, backup read, edit, read-back", async () => {
      const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
      const c = await connect({}, dir);
      await c.callTool({
        name: "worldanvil_update_article",
        arguments: { article_id: ARTICLE, content: "v2", fresh_backup: true },
      });
      expect(articleCalls()).toEqual(["GET", "GET", "PATCH", "GET"]);
    });

    it("a delete always reads afresh for its backup", async () => {
      const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
      const c = await connect({}, dir);
      await get(c);
      article = { ...article, content: "Edited elsewhere meanwhile" };
      const r = await c.callTool({ name: "worldanvil_delete_article", arguments: { article_id: ARTICLE } });
      expect(r.isError).toBeFalsy();
      expect(articleCalls()).toEqual(["GET", "GET", "DELETE"]);
      expect(backupText(dir)).toBe("Edited elsewhere meanwhile");
    });

    it("the backup is the copy as it was read, not as the tool may have altered it", async () => {
      const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
      const c = await connect({}, dir);
      const shared = article;
      await get(c);
      shared.content = "Changed in memory after the read";
      await setIcon(c);
      expect(backupText(dir)).toBe("Original text v1");
    });
  });

  it("does not back up reads or creates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    const c = await connect({}, dir);
    await c.callTool({ name: "worldanvil_get_article", arguments: { article_id: ARTICLE } });
    await c.callTool({ name: "worldanvil_create_article", arguments: { title: "New", world_id: WORLD } });
    expect(files(dir)).toHaveLength(0);
  });
});

describe("pruning one item's copies", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const item = { worldId: WORLD, worldTitle: "W", path: "/article", id: ARTICLE, action: "update" };
  /** Save one copy per gap, waiting that long after each; returns what is left. */
  const run = (keep, gaps) => {
    const dir = mkdtempSync(join(tmpdir(), "wa-bk-"));
    let t = Date.parse("2026-11-13T10:00:00Z");
    const b = new Backups({ dir, keep, keepDays: 7, now: () => t });
    gaps.forEach((gap, i) => {
      b.saveItem({ ...item, data: { title: "Hero", content: `v${i + 1}` } });
      t += gap;
    });
    const kept = files(dir).sort().map((f) => JSON.parse(readFileSync(f, "utf8")).data.content);
    return { kept, report: b.report(join(dir, "items", "W-11111111", "article", `Hero - ${ARTICLE}`)) };
  };

  it("over the limit, the oldest go once they are older than the day limit", () => {
    const { kept, report } = run(3, [8 * DAY, 8 * DAY, 8 * DAY, 8 * DAY, 0]);
    expect(kept).toEqual(["v3", "v4", "v5"]);
    expect(report).toMatchObject({ backups_held: 3, backup_limit: 3 });
    expect(report.storing).toMatch(/^Storing 3\/3 backups using/);
  });

  it("age alone deletes nothing", () => {
    expect(run(3, [100 * DAY, 100 * DAY, 0]).kept).toEqual(["v1", "v2", "v3"]);
  });

  it("young copies over the limit are held, and the report says so", () => {
    const { kept, report } = run(2, [30 * DAY, 1000, 1000, 1000, 0]);
    // v1 is old and goes; v2..v5 are inside a week, so all four stay.
    expect(kept).toEqual(["v2", "v3", "v4", "v5"]);
    expect(report.storing).toMatch(/exceeded your set limit of 2; your retention of 7 days.*Storing 4\/2 backups/);
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
