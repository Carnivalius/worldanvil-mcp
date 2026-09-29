/**
 * Own-keys-only tests
 *
 * This fork has no proxy mode. The client must:
 * - require BOTH the user's auth token and their own application key
 * - refuse any proxy configuration
 * - only ever target www.worldanvil.com
 * - send a User-Agent with app name, URL and version (World Anvil requirement)
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  WorldAnvilClient,
  API_HOST,
  USER_AGENT,
} from "../src/api-client.js";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Own keys only", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.WA_APP_KEY;
    delete process.env.WA_AUTH_TOKEN;
    delete process.env.WA_PROXY_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("works with both keys and targets World Anvil directly", () => {
    const client = new WorldAnvilClient({ appKey: "k", authToken: "t" });
    expect(client.appKey).toBe("k");
    expect(client.authToken).toBe("t");
    expect(client.apiBase).toBe("www.worldanvil.com");
    expect(client.apiPath).toBe("/api/external/boromir");
  });

  it("reads both keys from the environment", () => {
    process.env.WA_APP_KEY = "env-key";
    process.env.WA_AUTH_TOKEN = "env-token";
    const client = new WorldAnvilClient({});
    expect(client.appKey).toBe("env-key");
    expect(client.authToken).toBe("env-token");
  });

  it("requires the auth token", () => {
    expect(() => new WorldAnvilClient({ appKey: "k" })).toThrow(/WA_AUTH_TOKEN.*required/i);
  });

  it("requires the application key (no fallback to anyone else's)", () => {
    expect(() => new WorldAnvilClient({ authToken: "t" })).toThrow(/WA_APP_KEY.*required/i);
  });

  it("refuses a proxy passed in config, even with both keys", () => {
    expect(
      () => new WorldAnvilClient({ appKey: "k", authToken: "t", proxyUrl: "https://p.example" }),
    ).toThrow(/Proxies are not supported/);
  });

  it("refuses WA_PROXY_URL from the environment", () => {
    process.env.WA_PROXY_URL = "https://p.example";
    expect(() => new WorldAnvilClient({ appKey: "k", authToken: "t" })).toThrow(
      /Proxies are not supported/,
    );
  });

  it("ignores attempts to override the host", () => {
    const client = new WorldAnvilClient({
      appKey: "k",
      authToken: "t",
      apiBase: "evil.example",
      apiPath: "/x",
    });
    expect(client.apiBase).toBe("www.worldanvil.com");
    expect(client.apiPath).toBe("/api/external/boromir");
  });

  it("sends a User-Agent with name, URL and version", () => {
    const { version } = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"));
    expect(USER_AGENT).toBe(
      `worldanvil-mcp-fork (https://github.com/Carnivalius/worldanvil-mcp, ${version})`,
    );
  });
});

describe("No third-party hosts in server code", () => {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  const sources = [join(PACKAGE_DIR, "index.js"), ...walk(join(PACKAGE_DIR, "src"))];

  it("only references www.worldanvil.com as a network host", () => {
    expect(API_HOST).toBe("www.worldanvil.com");
    const hosts = new Set();
    for (const file of sources) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1].toLowerCase());
    }
    // github.com appears only inside the User-Agent string (identification, not a request)
    const unexpected = [...hosts].filter((h) => h !== "www.worldanvil.com" && h !== "github.com");
    expect(unexpected).toEqual([]);
  });

  it("uses no HTTP clients other than node:https to World Anvil", () => {
    for (const file of sources) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/\bfetch\s*\(|from\s+["']http["']|undici|axios|node-fetch/);
    }
  });
});
