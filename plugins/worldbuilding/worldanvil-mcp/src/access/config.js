/**
 * World access settings - loading, validation and the starter file.
 *
 * The settings file lives outside the repository (default
 * ~/.worldanvil-mcp/access.json, or WA_ACCESS_FILE). Any problem with it
 * stops the server at start-up with a clear message: we never guess.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export const LEVELS = ["full_edit", "edit_only", "read_only", "blocked"];

export const DEFAULT_SETTINGS = Object.freeze({
  world_list: {},
  allow_only: false,
  default_access: "full_edit",
  allow_create_worlds: true,
  allow_delete_worlds: false,
  new_world_access: "full_edit",
  item_backup_keep: 10,
  world_backup_keep: 5,
  allow_blocked_backup: false,
});

export class AccessConfigError extends Error {
  constructor(message, file) {
    super(`World access settings (${file}): ${message}`);
    this.name = "AccessConfigError";
  }
}

export function defaultSettingsPath() {
  return join(homedir(), ".worldanvil-mcp", "access.json");
}

/**
 * Minimal strict JSON parser that rejects duplicate object keys.
 * (JSON.parse silently keeps the last duplicate, which could hide a
 * world listed twice with different access levels.)
 */
export function parseStrictJson(text) {
  let i = 0;
  const fail = (msg) => {
    const line = text.slice(0, i).split("\n").length;
    throw new SyntaxError(`${msg} (line ${line})`);
  };
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "-" || /[0-9]/.test(c)) return number();
    for (const [word, v] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ])
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    const bare = text.slice(i).match(/^[A-Za-z_]+/)?.[0];
    if (bare === "True" || bare === "False")
      fail(`"${bare}" is not valid JSON; use lowercase ${bare.toLowerCase()}`);
    fail(`unexpected ${c === undefined ? "end of file" : `"${c}"`}`);
  };
  const string = () => {
    i++;
    let out = "";
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") {
        const esc = text[i + 1];
        const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (esc === "u") {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        if (!(esc in map)) fail("invalid escape in string");
        out += map[esc];
        i += 2;
        continue;
      }
      out += text[i++];
    }
    if (text[i] !== '"') fail("unterminated string");
    i++;
    return out;
  };
  const number = () => {
    const m = text.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
    if (!m) fail("invalid number");
    i += m[0].length;
    return Number(m[0]);
  };
  const array = () => {
    i++;
    const out = [];
    ws();
    if (text[i] === "]") {
      i++;
      return out;
    }
    for (;;) {
      out.push(value());
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return out;
      }
      fail('expected "," or "]"');
    }
  };
  const object = () => {
    i++;
    const out = {};
    const seen = new Map();
    ws();
    if (text[i] === "}") {
      i++;
      return out;
    }
    for (;;) {
      ws();
      if (text[i] !== '"') fail("expected a quoted key");
      const key = string();
      const norm = key.trim().toLowerCase();
      if (seen.has(norm))
        fail(`"${key}" is listed more than once (also as "${seen.get(norm)}")`);
      seen.set(norm, key);
      ws();
      if (text[i] !== ":") fail('expected ":"');
      i++;
      out[key] = value();
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return out;
      }
      fail('expected "," or "}"');
    }
  };
  const result = value();
  ws();
  if (i < text.length) fail("unexpected text after the settings");
  return result;
}

/** Validate a parsed settings object; returns a normalised copy. */
export function validateSettings(raw, file = "settings") {
  const err = (m) => new AccessConfigError(m, file);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw err("the file must contain a JSON object");

  for (const key of Object.keys(raw))
    if (!(key in DEFAULT_SETTINGS))
      throw err(
        `unknown setting "${key}". Allowed: ${Object.keys(DEFAULT_SETTINGS).join(", ")}`,
      );

  const s = { ...DEFAULT_SETTINGS, ...raw };

  if (!s.world_list || typeof s.world_list !== "object" || Array.isArray(s.world_list))
    throw err('"world_list" must be an object of { "world name or id": "level" }');
  for (const [world, level] of Object.entries(s.world_list)) {
    if (!world.trim()) throw err("world_list contains an empty world name");
    if (!LEVELS.includes(level))
      throw err(`"${world}" has unknown level "${level}". Use one of: ${LEVELS.join(", ")}`);
  }

  for (const key of ["allow_only", "allow_create_worlds", "allow_delete_worlds", "allow_blocked_backup"])
    if (typeof s[key] !== "boolean") throw err(`"${key}" must be true or false`);

  for (const key of ["default_access", "new_world_access"]) {
    if (!LEVELS.includes(s[key]))
      throw err(`"${key}" has unknown level "${s[key]}"`);
    if (s[key] === "blocked")
      throw err(`"${key}" cannot be "blocked"${key === "default_access" ? ' (use "allow_only": true instead)' : ""}`);
  }

  for (const key of ["item_backup_keep", "world_backup_keep"])
    if (!Number.isInteger(s[key]) || s[key] < 1)
      throw err(`"${key}" must be a whole number of at least 1`);

  return { ...s, world_list: { ...s.world_list } };
}

/**
 * Load settings for the server.
 *
 * - WA_ACCESS_FILE set but missing: refuse (a typo must not grant access).
 * - Default path missing: create the starter file and warn loudly.
 *
 * @returns {{settings: object, file: string, created: boolean}}
 */
export function loadSettings({ file, explicit, log = console.error } = {}) {
  const envFile = process.env.WA_ACCESS_FILE;
  const path = file ?? envFile ?? defaultSettingsPath();
  const isExplicit = explicit ?? (file !== undefined || envFile !== undefined);

  if (!existsSync(path)) {
    if (isExplicit)
      throw new AccessConfigError(
        "file not found. Fix the path in WA_ACCESS_FILE (no file was created, so a typo can't grant access).",
        path,
      );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(DEFAULT_SETTINGS, null, 2) + "\n", "utf8");
    const bar = "!".repeat(72);
    log(
      `\n${bar}\n` +
        `WARNING: no world access settings found.\n` +
        `Created a starter file at:\n  ${path}\n` +
        `It gives FULL ACCESS (full_edit) to every world your keys can reach.\n` +
        `Edit it to block worlds or make them read-only, then restart.\n` +
        `${bar}\n`,
    );
    return { settings: validateSettings({ ...DEFAULT_SETTINGS }, path), file: path, created: true };
  }

  let raw;
  try {
    raw = parseStrictJson(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    throw new AccessConfigError(`not valid JSON: ${e.message}`, path);
  }
  return { settings: validateSettings(raw, path), file: path, created: false };
}

/**
 * Add ONE entry for a world the server has just created. Never changes or
 * removes existing entries. The previous file is kept as a timestamped copy.
 */
export function appendWorldEntry(path, key, level) {
  const current = parseStrictJson(readFileSync(path, "utf8").replace(/^﻿/, ""));
  const settings = validateSettings(current, path);
  const exists = Object.keys(settings.world_list).some(
    (k) => k.trim().toLowerCase() === key.trim().toLowerCase(),
  );
  if (exists) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(path, `${path}.${stamp}.bak`);
  current.world_list = { ...(current.world_list ?? {}), [key]: level };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(current, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
  return true;
}
