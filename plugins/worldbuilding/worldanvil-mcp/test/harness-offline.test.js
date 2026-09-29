/**
 * Offline tests for the live-test harness wiring (createHarness).
 * The HTTP transport is replaced by a fake, and state files live in a
 * temporary directory, so nothing touches the network or the real ledger.
 */

import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorldAnvilClient } from "../src/api-client.js";
import { createHarness } from "./live/harness/harness.js";
import { GuardError } from "./live/harness/policy.js";

vi.setConfig({ testTimeout: 30000 });

const USER = "00000000-0000-4000-8000-000000000001";
const REAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEST_WORLD = "11111111-1111-4111-8111-111111111111";
const NEW_MS = "22222222-2222-4222-8222-222222222222";

let dir;
let paths;
let calls;
let worlds;
let entities;

function writeEnv(extra = "") {
  writeFileSync(
    paths.env,
    `WA_AUTH_TOKEN=fake-token\nWA_APP_KEY=fake-key\nWA_TEST_EXPECTED_WORLD_COUNT=9\n${extra}`,
  );
}

function fakeTransport(endpoint, method, body) {
  calls.push({ endpoint, method, body });
  const [path, query = ""] = endpoint.split("?");
  const id = new URLSearchParams(query).get("id");
  if (path === "/identity") return Promise.resolve({ id: USER, username: "tester" });
  if (path === "/user/worlds") return Promise.resolve({ entities: worlds });
  if (method === "PUT") return Promise.resolve({ id: NEW_MS, success: true });
  if (method === "GET" && entities[id]) return Promise.resolve(entities[id]);
  return Promise.resolve({ success: true });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wa-harness-"));
  paths = {
    env: join(dir, ".env.test"),
    ledger: join(dir, "test-ledger.json"),
    protected: join(dir, "protected-worlds.json"),
  };
  calls = [];
  worlds = [];
  entities = {};
  vi.spyOn(WorldAnvilClient.prototype, "request").mockImplementation(fakeTransport);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = 0;
});

/** Simulate a run after a successful first snapshot. */
function seedLaterRun() {
  writeFileSync(
    paths.protected,
    JSON.stringify({ version: 1, worlds: [{ id: REAL_A, slug: "real-a" }] }),
  );
  writeFileSync(
    paths.ledger,
    JSON.stringify({
      version: 1,
      entries: [
        { id: TEST_WORLD, path: "/world", title: "MCP-TEST-SCRATCH", worldId: TEST_WORLD, parentIds: [], auto: false, deletedAt: null },
      ],
    }),
  );
  worlds = [
    { id: REAL_A, title: "Real A" },
    { id: TEST_WORLD, title: "MCP-TEST-SCRATCH" },
  ];
}

describe("pre-flight", () => {
  it("requires a stage", async () => {
    await expect(createHarness({ paths })).rejects.toThrow(GuardError);
  });

  it("requires .env.test", async () => {
    await expect(createHarness({ stage: "read", paths })).rejects.toThrow(/\.env\.test not found/);
  });

  it("requires both keys", async () => {
    writeFileSync(paths.env, "WA_AUTH_TOKEN=only-token\n");
    await expect(createHarness({ stage: "read", paths })).rejects.toThrow(/WA_APP_KEY missing/);
  });

  it("refuses any proxy", async () => {
    writeEnv("WA_PROXY_URL=https://example.invalid\n");
    await expect(createHarness({ stage: "read", paths })).rejects.toThrow(/proxies are not allowed/);
  });

  it("refuses to run if the snapshot is missing after the first run", async () => {
    writeEnv();
    writeFileSync(paths.ledger, JSON.stringify({ version: 1, entries: [] }));
    await expect(createHarness({ stage: "read", paths })).rejects.toThrow(/protected-worlds.json is missing/);
    expect(calls).toHaveLength(0);
  });
});

describe("first-run snapshot", () => {
  const fakeWorlds = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${i}`,
      title: `Fake world ${i}`,
    }));

  it("requires the expected world count in .env.test", async () => {
    writeFileSync(paths.env, "WA_AUTH_TOKEN=t\nWA_APP_KEY=k\n");
    await expect(createHarness({ stage: "read", paths })).rejects.toThrow(/WA_TEST_EXPECTED_WORLD_COUNT/);
    expect(calls).toHaveLength(0);
  });

  it("aborts without writing anything if the world count does not match", async () => {
    writeEnv();
    worlds = fakeWorlds(8);
    await expect(createHarness({ stage: "create", paths })).rejects.toThrow(/snapshot mismatch/);
    expect(existsSync(paths.protected)).toBe(false);
    expect(existsSync(paths.ledger)).toBe(false);
    expect(calls.every((c) => c.method === "GET" || c.endpoint.startsWith("/user/worlds"))).toBe(true);
  });

  it("records every existing world when the count matches", async () => {
    writeEnv();
    worlds = fakeWorlds(9);
    const h = await createHarness({ stage: "read", paths });
    const saved = JSON.parse(readFileSync(paths.protected, "utf8"));
    expect(saved.worlds).toHaveLength(9);
    const res = await h.call("worldanvil_get_world", { world_id: worlds[3].id });
    expect(res.isError).toBe(true);
    expect(h.aborted).toBe(true);
  });
});

describe("later runs", () => {
  it("appends newly seen worlds to the protected list (never prunes)", async () => {
    writeEnv();
    seedLaterRun();
    worlds.push({ id: REAL_B, title: "Created by the owner since last run" });
    await createHarness({ stage: "read", paths });
    const saved = JSON.parse(readFileSync(paths.protected, "utf8"));
    expect(saved.worlds.map((w) => w.id)).toEqual([REAL_A, REAL_B]);
  });

  it("locks the choke point so tests cannot swap the transport", async () => {
    writeEnv();
    seedLaterRun();
    const h = await createHarness({ stage: "read", paths });
    expect(() => {
      h.client.request = () => {};
    }).toThrow();
    expect(Object.isFrozen(h.client)).toBe(true);
  });

  it("refuses snapshot-protected worlds through tool calls and aborts", async () => {
    writeEnv();
    seedLaterRun();
    const h = await createHarness({ stage: "read", paths });
    const before = calls.length;
    const res = await h.call("worldanvil_get_world", { world_id: REAL_A });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/REFUSED/);
    expect(calls.length).toBe(before);
    expect(h.aborted).toBe(true);
    const next = await h.call("worldanvil_get_world", { world_id: TEST_WORLD });
    expect(next.isError).toBe(true);
  });

  it("records created items in the ledger immediately", async () => {
    writeEnv();
    seedLaterRun();
    const h = await createHarness({ stage: "create", paths });
    const res = await h.call("worldanvil_create_manuscript", {
      title: "MCP-TEST-Manuscript",
      world_id: TEST_WORLD,
    });
    expect(res.isError).toBe(false);
    const saved = JSON.parse(readFileSync(paths.ledger, "utf8"));
    const entry = saved.entries.find((e) => e.id === NEW_MS);
    expect(entry).toMatchObject({ path: "/manuscript", worldId: TEST_WORLD, title: "MCP-TEST-Manuscript" });
  });

  it("refuses creates without the prefix", async () => {
    writeEnv();
    seedLaterRun();
    const h = await createHarness({ stage: "create", paths });
    const res = await h.call("worldanvil_create_manuscript", { title: "My Novel", world_id: TEST_WORLD });
    expect(res.isError).toBe(true);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("re-fetches before delete and refuses if the title lost its prefix", async () => {
    writeEnv();
    seedLaterRun();
    const ledger = JSON.parse(readFileSync(paths.ledger, "utf8"));
    ledger.entries.push({ id: NEW_MS, path: "/manuscript", title: "MCP-TEST-ms", worldId: TEST_WORLD, parentIds: [TEST_WORLD], auto: false, deletedAt: null });
    writeFileSync(paths.ledger, JSON.stringify(ledger));
    entities[NEW_MS] = { id: NEW_MS, title: "Somebody renamed me", world: { id: TEST_WORLD } };

    const h = await createHarness({ stage: "delete", paths });
    const res = await h.call("worldanvil_delete_manuscript", { manuscript_id: NEW_MS });
    expect(res.isError).toBe(true);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    entities[NEW_MS].title = "MCP-TEST-ms";
    const ok = await h.call("worldanvil_delete_manuscript", { manuscript_id: NEW_MS });
    expect(ok.isError).toBe(false);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    const saved = JSON.parse(readFileSync(paths.ledger, "utf8"));
    expect(saved.entries.find((e) => e.id === NEW_MS).deletedAt).toBeTruthy();
  });

  it("refuses delete of an item whose world is not a test world", async () => {
    writeEnv();
    seedLaterRun();
    const ledger = JSON.parse(readFileSync(paths.ledger, "utf8"));
    ledger.entries.push({ id: NEW_MS, path: "/manuscript", title: "MCP-TEST-ms", worldId: TEST_WORLD, parentIds: [TEST_WORLD], auto: false, deletedAt: null });
    writeFileSync(paths.ledger, JSON.stringify(ledger));
    entities[NEW_MS] = { id: NEW_MS, title: "MCP-TEST-ms", world: { id: REAL_B } };
    const h = await createHarness({ stage: "delete", paths });
    const res = await h.call("worldanvil_delete_manuscript", { manuscript_id: NEW_MS });
    expect(res.isError).toBe(true);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
