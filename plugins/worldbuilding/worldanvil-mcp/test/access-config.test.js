/**
 * World access settings: parsing, validation, starter file, add-only updates.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, it, expect } from "vitest";
import {
  AccessConfigError,
  DEFAULT_SETTINGS,
  appendWorldEntry,
  loadSettings,
  parseStrictJson,
  validateSettings,
} from "../src/access/config.js";

const tmp = () => mkdtempSync(join(tmpdir(), "wa-access-"));

describe("parseStrictJson", () => {
  it("parses normal JSON", () => {
    expect(parseStrictJson('{"a": [1, "x", true, null], "b": {"c": -1.5}}')).toEqual({
      a: [1, "x", true, null],
      b: { c: -1.5 },
    });
  });

  it("rejects duplicate keys, ignoring case and spacing", () => {
    expect(() => parseStrictJson('{"world_list": {"My Saga": "read_only", "my saga ": "full_edit"}}')).toThrow(
      /listed more than once/,
    );
  });

  it("explains Python-style True/False", () => {
    expect(() => parseStrictJson('{"allow_only": True}')).toThrow(/use lowercase true/);
  });

  it("reports the line of a syntax error", () => {
    expect(() => parseStrictJson('{\n"a": 1,\n"b" 2\n}')).toThrow(/line 3/);
  });
});

describe("validateSettings", () => {
  it("fills in the agreed defaults", () => {
    expect(validateSettings({})).toEqual({ ...DEFAULT_SETTINGS, world_list: {} });
    expect(DEFAULT_SETTINGS).toMatchObject({
      allow_only: false,
      default_access: "full_edit",
      allow_create_worlds: true,
      allow_delete_worlds: false,
      new_world_access: "full_edit",
      item_backup_keep: 10,
      world_backup_keep: 5,
      allow_blocked_backup: false,
    });
  });

  const bad = [
    [{ allow_delete_world: true }, /unknown setting "allow_delete_world"/],
    [{ world_list: [] }, /world_list/],
    [{ world_list: { "My Saga": "admin" } }, /unknown level "admin"/],
    [{ world_list: { " ": "read_only" } }, /empty world name/],
    [{ default_access: "blocked" }, /cannot be "blocked".*allow_only/],
    [{ new_world_access: "blocked" }, /cannot be "blocked"/],
    [{ allow_only: "yes" }, /true or false/],
    [{ item_backup_keep: 0 }, /at least 1/],
    [{ world_backup_keep: 2.5 }, /whole number/],
  ];
  for (const [input, message] of bad)
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(() => validateSettings(input)).toThrow(AccessConfigError);
      expect(() => validateSettings(input)).toThrow(message);
    });
});

describe("loadSettings", () => {
  it("creates the starter file at the default location and warns loudly", () => {
    const file = join(tmp(), "sub", "access.json");
    const logs = [];
    const { settings, created } = loadSettings({ file, explicit: false, log: (m) => logs.push(m) });
    expect(created).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(DEFAULT_SETTINGS);
    expect(settings.default_access).toBe("full_edit");
    expect(logs.join("")).toMatch(/WARNING.*FULL ACCESS/s);
  });

  it("refuses (and creates nothing) when an explicit path is missing", () => {
    const file = join(tmp(), "typo.json");
    expect(() => loadSettings({ file, explicit: true })).toThrow(/file not found/);
    expect(existsSync(file)).toBe(false);
  });

  it("refuses when WA_ACCESS_FILE points at a missing file", () => {
    // test/setup.js points WA_ACCESS_FILE at a missing file
    expect(() => loadSettings()).toThrow(/WA_ACCESS_FILE/);
  });

  it("loads a valid file (with a BOM)", () => {
    const file = join(tmp(), "access.json");
    writeFileSync(file, "﻿" + JSON.stringify({ allow_only: true, world_list: { "My Saga": "edit_only" } }));
    const { settings, created } = loadSettings({ file, explicit: true });
    expect(created).toBe(false);
    expect(settings.allow_only).toBe(true);
    expect(settings.world_list).toEqual({ "My Saga": "edit_only" });
  });

  it("refuses an invalid file", () => {
    const file = join(tmp(), "access.json");
    writeFileSync(file, '{"allow_only": True}');
    expect(() => loadSettings({ file, explicit: true })).toThrow(/not valid JSON.*lowercase/);
  });
});

describe("appendWorldEntry (add-only)", () => {
  it("adds one entry, keeps a backup, and never changes existing entries", () => {
    const dir = tmp();
    const file = join(dir, "access.json");
    writeFileSync(file, JSON.stringify({ world_list: { "Old Campaign": "blocked" }, allow_only: true }));
    expect(appendWorldEntry(file, "New Draft World", "edit_only")).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.world_list).toEqual({ "Old Campaign": "blocked", "New Draft World": "edit_only" });
    expect(saved.allow_only).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toHaveLength(1);
  });

  it("does nothing if the world is already listed", () => {
    const dir = tmp();
    const file = join(dir, "access.json");
    writeFileSync(file, JSON.stringify({ world_list: { "Old Campaign": "blocked" } }));
    expect(appendWorldEntry(file, "old campaign", "full_edit")).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8")).world_list).toEqual({ "Old Campaign": "blocked" });
  });
});
