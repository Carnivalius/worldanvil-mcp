/**
 * Start-up refusals of index.js (run as a separate process, no network).
 */

import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";

const INDEX = join(dirname(fileURLToPath(import.meta.url)), "..", "index.js");

function start(env) {
  const home = mkdtempSync(join(tmpdir(), "wa-start-"));
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("WA_")),
  );
  return spawnSync(process.execPath, [INDEX], {
    env: { ...clean, HOME: home, USERPROFILE: home, ...env },
    input: "",
    encoding: "utf8",
    timeout: 20000,
  });
}

describe("start-up", () => {
  it("refuses to start during development without the explicit opt-in", () => {
    const r = start({ WA_AUTH_TOKEN: "t", WA_APP_KEY: "k" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/work in progress.*won't start/s);
  });

  it("refuses without both keys", () => {
    const r = start({ WA_I_ACCEPT_UNTESTED: "1", WA_AUTH_TOKEN: "t" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/both WA_AUTH_TOKEN.*and WA_APP_KEY/s);
  });

  it("refuses any proxy", () => {
    const r = start({ WA_I_ACCEPT_UNTESTED: "1", WA_AUTH_TOKEN: "t", WA_APP_KEY: "k", WA_PROXY_URL: "https://p.example" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/WA_PROXY_URL is not supported/);
  });

  it("refuses an invalid settings file with a plain message", () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-start-"));
    const file = join(dir, "access.json");
    writeFileSync(file, '{"default_access": "blocked"}');
    const r = start({ WA_I_ACCEPT_UNTESTED: "1", WA_AUTH_TOKEN: "t", WA_APP_KEY: "k", WA_ACCESS_FILE: file });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/default_access" cannot be "blocked"/);
  });
});
