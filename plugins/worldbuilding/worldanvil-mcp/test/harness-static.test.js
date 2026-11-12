/**
 * Static safety checks for the live-test harness (offline).
 *
 *  - Only the harness may talk to the network in live test code.
 *  - Live tests are excluded from the default `npm test` run.
 *  - Credential and state files are gitignored.
 *  - No tracked file contains a protected world identifier (from the local snapshot).
 *  - No real-world identifiers or fingerprints are hard-coded in the harness.
 *  - Neither API key from .env.test is in any tracked file or any commit.
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, it, expect } from "vitest";
import { parse as parseEnv } from "dotenv";
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

describe("no API keys in the repository", () => {
  // Reads the real keys from the local, gitignored .env.test and looks for
  // them (whole, or their first or last 20 characters) in every tracked file
  // and in the full history of every local branch. Only file names and
  // commit ids are ever reported; a key's value is never printed.
  const keys = [];
  if (existsSync(PATHS.env)) {
    const env = parseEnv(readFileSync(PATHS.env));
    for (const name of ["WA_AUTH_TOKEN", "WA_APP_KEY"]) {
      const value = env[name];
      if (typeof value !== "string" || value.length < 24) continue;
      keys.push({ name, parts: [value, value.slice(0, 20), value.slice(-20)] });
    }
  }
  const found = (text) => keys.filter((k) => k.parts.some((p) => text.includes(p))).map((k) => k.name);

  it.skipIf(!keys.length)("tracked files contain neither key", () => {
    const root = git(["rev-parse", "--show-toplevel"]).trim();
    const offenders = [];
    for (const rel of git(["-C", root, "ls-files", "-z"]).split("\0").filter(Boolean)) {
      const file = join(root, rel);
      if (!existsSync(file) || statSync(file).size > 2_000_000) continue;
      for (const name of found(readFileSync(file, "utf8"))) offenders.push(`${name} in ${rel}`);
    }
    expect(offenders).toEqual([]);
  });

  it.skipIf(!keys.length)("no commit on any local branch contains either key", () => {
    const log = execFileSync("git", ["log", "--all", "-p", "--format=%x00%h%n%B"], {
      cwd: PACKAGE_DIR,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 1024,
    });
    const offenders = [];
    for (const chunk of log.split("\0").filter(Boolean)) {
      const names = found(chunk);
      if (names.length) offenders.push(`${names.join(" and ")} in commit ${chunk.slice(0, chunk.indexOf("\n"))}`);
    }
    expect(offenders).toEqual([]);
  });
});
