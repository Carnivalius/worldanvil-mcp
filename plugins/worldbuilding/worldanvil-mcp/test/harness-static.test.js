/**
 * Static safety checks for the live-test harness (offline).
 *
 *  - Only the harness may talk to the network in live test code.
 *  - Live tests are excluded from the default `npm test` run.
 *  - Credential and state files are gitignored.
 *  - No tracked file contains a protected world identifier (from the local snapshot).
 *  - No real-world identifiers or fingerprints are hard-coded in the harness.
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, it, expect } from "vitest";
import { PATHS, PACKAGE_DIR } from "./live/harness/state.js";
import { extractTokens } from "./live/harness/protected.js";

const LIVE_DIR = join(PACKAGE_DIR, "test", "live");
const CHOKE_POINT = join(LIVE_DIR, "harness", "harness.js");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const FORBIDDEN_NETWORK = [
  /\bfetch\s*\(/,
  /\bhttps?\.(request|get)\s*\(/,
  /from\s+["'](node:)?https?["']/,
  /require\(\s*["'](node:)?https?["']\s*\)/,
  /["'](undici|axios|node-fetch|got|superagent)["']/,
  /new\s+WorldAnvilClient\b/,
  /api-client(\.js)?["']/,
  /\.prototype\.request\b/,
  /XMLHttpRequest|WebSocket/,
];

describe("single network choke point", () => {
  const files = walk(LIVE_DIR).filter((f) => f.endsWith(".js") && f !== CHOKE_POINT);

  it("finds the live test sources", () => {
    expect(existsSync(CHOKE_POINT)).toBe(true);
  });

  for (const file of files)
    it(`${relative(PACKAGE_DIR, file)} makes no direct network calls`, () => {
      const src = readFileSync(file, "utf8");
      for (const re of FORBIDDEN_NETWORK) expect(src, `matches ${re}`).not.toMatch(re);
    });
});

describe("test configuration", () => {
  it("default config excludes live tests", () => {
    const cfg = readFileSync(join(PACKAGE_DIR, "vitest.config.js"), "utf8");
    expect(cfg).toMatch(/exclude:[^\]]*test\/live/s);
  });

  it("live config only includes live tests and never loads .env", () => {
    const cfg = readFileSync(join(PACKAGE_DIR, "vitest.live.config.js"), "utf8");
    expect(cfg).toMatch(/test\/live\/\*\*\/\*\.live\.test\.js/);
    expect(cfg).not.toMatch(/dotenv/);
  });

  it("upstream live API tests need an explicit opt-in", () => {
    for (const f of ["api.test.js", "timeline.test.js"]) {
      const src = readFileSync(join(PACKAGE_DIR, "test", f), "utf8");
      expect(src).toMatch(/WA_RUN_UPSTREAM_LIVE_TESTS/);
    }
  });
});

function git(args) {
  return execFileSync("git", args, { cwd: PACKAGE_DIR, encoding: "utf8" });
}

describe("no hard-coded world identifiers", () => {
  it("harness sources contain no UUIDs or hashes", () => {
    for (const f of walk(join(LIVE_DIR, "harness"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(src, f).not.toMatch(/\b[0-9a-f]{64}\b/i);
    }
  });
});

describe("gitignore", () => {
  for (const file of [PATHS.env, PATHS.ledger, PATHS.protected, PATHS.access, PATHS.backups])
    it(`${relative(PACKAGE_DIR, file)} is ignored`, () => {
      expect(() => git(["check-ignore", "-q", file])).not.toThrow();
    });
});

describe("no snapshot-protected identifiers in tracked files", () => {
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const tracked = git(["-C", root, "ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((f) => join(root, f))
    .filter((f) => existsSync(f) && statSync(f).size < 2_000_000);

  const local = new Set();
  if (existsSync(PATHS.protected))
    for (const w of JSON.parse(readFileSync(PATHS.protected, "utf8")).worlds) {
      local.add(w.id.toLowerCase());
      if (w.slug) local.add(w.slug.toLowerCase());
    }

  it("scans the repository", () => {
    expect(root).toBeTruthy();
    expect(tracked.length).toBeGreaterThan(10);
  });

  it("contains none of the locally protected world ids/slugs", () => {
    const offenders = [];
    for (const file of tracked) {
      const tokens = extractTokens(readFileSync(file, "utf8"));
      for (const t of tokens)
        if (local.has(t))
          offenders.push(relative(root, file));
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
