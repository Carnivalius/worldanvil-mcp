/**
 * World access enforcement.
 *
 * Every request the server makes to World Anvil passes through
 * WorldAccess.check() before it is sent. The check works out which world the
 * request touches and whether the user's settings allow that action there.
 * Anything it cannot work out is refused (fail closed), always with a reason.
 */

import { LEVELS, appendWorldEntry } from "./config.js";

export class AccessError extends Error {
  constructor(message) {
    super(`Access denied: ${message}`);
    this.name = "AccessError";
  }
}

/** World Anvil ids are UUIDs (occasionally numeric). Nothing else is accepted. */
export const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const ALLOWED_PARAMS = new Set(["id", "granularity"]);

/** Which actions each level permits. */
const PERMITS = {
  full_edit: new Set(["read", "create", "update", "delete"]),
  edit_only: new Set(["read", "create", "update"]),
  read_only: new Set(["read"]),
  blocked: new Set(),
};

const ACTION_WORDS = {
  read: "read",
  create: "create items in",
  update: "change",
  delete: "delete items in",
};

/** Body keys that reference another World Anvil item, and that item's endpoint. */
const REF_PATHS = {
  world: "/world",
  article: "/article",
  targetArticle: "/article",
  location: "/article",
  category: "/category",
  manuscript: "/manuscript",
  version: "/manuscript_version",
  manuscriptVersion: "/manuscript_version",
  part: "/manuscript_part",
  manuscriptPart: "/manuscript_part",
  notebook: "/notebook",
  notesection: "/notesection",
  map: "/map",
  layer: "/layer",
  group: "/markergroup",
  markergroup: "/markergroup",
  timeline: "/timeline",
  era: "/era",
  history: "/history",
  collection: "/variablecollection",
  variableCollection: "/variablecollection",
  folder: "/blockfolder",
  blockfolder: "/blockfolder",
  block: "/block",
  template: "/blocktemplate",
  blocktemplate: "/blocktemplate",
  canvas: "/canvas",
  secret: "/secret",
};

/** When an item has no direct `world`, follow these parent keys (in order). */
const PARENT_KEYS = [
  "world",
  "manuscript",
  "manuscriptVersion",
  "version",
  "manuscriptPart",
  "part",
  "notebook",
  "notesection",
  "map",
  "timeline",
  "collection",
  "variableCollection",
  "folder",
  "blockfolder",
];

/** Endpoints that are never allowed in this fork. */
const DISABLED = [
  [/^\/user(\/(?!worlds$).*)?$/, "account-level tools are disabled in this fork"],
  [/^\/(image|world\/images)$/, "image tools are disabled in this fork"],
  [/^\/(subscribergroup|world\/subscribergroups)$/, "subscriber-group tools are disabled in this fork"],
];

/** Global reference data that belongs to no world (read-only). */
const GLOBAL_READS = new Set(["/rpgsystem", "/rpgsystems", "/markertypes"]);

function classify(method, path) {
  const m = String(method).toUpperCase();
  if (m === "GET") return "read";
  if (m === "POST" && /^\/[a-z_]+\/[a-z_]+$/.test(path)) return "read"; // list
  if (m === "POST" && GLOBAL_READS.has(path)) return "read";
  if (m === "PUT") return "create";
  if (m === "PATCH") return "update";
  if (m === "DELETE") return "delete";
  throw new AccessError(`unsupported request ${m} ${path}`);
}

export function parseEndpoint(endpoint) {
  const [path, query = ""] = String(endpoint).split("?");
  const params = new URLSearchParams(query);
  for (const key of params.keys())
    if (!ALLOWED_PARAMS.has(key))
      throw new AccessError(`unexpected request parameter "${key}"`);
  const ids = params.getAll("id");
  if (ids.length > 1) throw new AccessError("more than one id in a single request");
  const id = ids[0] ?? null;
  if (id !== null && !ID_RE.test(id))
    throw new AccessError(`"${id}" is not a valid World Anvil id`);
  return { path, id };
}

/** Collect every {key: {id}} reference in a request body. */
export function collectRefs(body, requestPath) {
  const refs = [];
  const visit = (value, key) => {
    if (Array.isArray(value)) return value.forEach((v) => visit(v, key));
    if (!value || typeof value !== "object") return;
    if (key && (typeof value.id === "string" || typeof value.id === "number")) {
      const id = String(value.id);
      if (!ID_RE.test(id)) throw new AccessError(`"${id}" is not a valid World Anvil id`);
      const path = key === "parent" ? requestPath : REF_PATHS[key];
      if (!path)
        throw new AccessError(`can't tell which world "${key}" belongs to, so it was refused`);
      refs.push({ key, id, path });
      return;
    }
    for (const [k, v] of Object.entries(value)) visit(v, k);
  };
  visit(body ?? {}, null);
  return refs;
}

export class WorldAccess {
  /**
   * @param {object} opts
   * @param {object} opts.settings - validated settings (see config.js)
   * @param {string} opts.file - settings file path (for messages)
   * @param {(endpoint, method, body) => Promise<any>} opts.send - raw transport
   * @param {(msg: string) => void} [opts.log]
   */
  constructor({ settings, file, send, log = console.error }) {
    this.settings = settings;
    this.file = file;
    this.send = send;
    this.log = log;
    this.worlds = null; // Map id -> title
    this.levels = null; // Map id -> level (explicit entries)
    this.worldCache = new Map(); // "path:id" -> worldId
    this.userId = null;
    this.resolveError = null;
  }

  /** Load the account's worlds and match world_list names/ids to world ids. */
  async resolve(force = false) {
    if (this.worlds && !force) return;
    const identity = await this.send("/identity", "GET");
    this.userId = String(identity.id);
    const list = await this.send(`/user/worlds?id=${this.userId}`, "POST", {});
    const worlds = new Map(
      (list?.entities ?? []).map((w) => [String(w.id).toLowerCase(), String(w.title ?? "")]),
    );

    const levels = new Map();
    const problems = [];
    for (const [key, level] of Object.entries(this.settings.world_list)) {
      const k = key.trim().toLowerCase();
      let matches = worlds.has(k) ? [k] : [];
      if (!matches.length)
        matches = [...worlds].filter(([, t]) => t.trim().toLowerCase() === k).map(([id]) => id);
      if (matches.length === 0) problems.push(`"${key}" doesn't match any of your worlds`);
      else if (matches.length > 1)
        problems.push(`"${key}" matches ${matches.length} worlds; use the world's id instead`);
      else if (levels.has(matches[0]))
        problems.push(`"${key}" is listed twice (by name and by id)`);
      else levels.set(matches[0], level);
    }
    if (problems.length) {
      this.resolveError = `problems in ${this.file}: ${problems.join("; ")}. Fix the file and restart.`;
      throw new AccessError(this.resolveError);
    }
    this.worlds = worlds;
    this.levels = levels;
    this.log(`World access: ${this.summary()}`);
  }

  /** Plain-words summary of the effective rules. */
  summary() {
    const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
    let notAllowed = 0;
    for (const id of this.worlds.keys()) {
      const { level, listed } = this.levelFor(id);
      if (!listed && this.settings.allow_only) notAllowed++;
      else counts[level]++;
    }
    const parts = LEVELS.filter((l) => counts[l]).map((l) => `${counts[l]} ${l}`);
    if (notAllowed) parts.push(`${notAllowed} not on allow list`);
    return `${this.worlds.size} worlds: ${parts.join(", ") || "none"} ` +
      `(allow_only=${this.settings.allow_only}, default_access=${this.settings.default_access})`;
  }

  levelFor(worldId) {
    const id = String(worldId).toLowerCase();
    if (this.levels.has(id)) return { level: this.levels.get(id), listed: true };
    if (this.settings.allow_only) return { level: "blocked", listed: false };
    return { level: this.settings.default_access, listed: false };
  }

  label(worldId) {
    const title = this.worlds.get(String(worldId).toLowerCase());
    return title ? `'${title}'` : `world ${worldId}`;
  }

  /** Throw an AccessError with a reason unless `action` is allowed in the world. */
  requireAction(worldId, action) {
    const id = String(worldId).toLowerCase();
    if (!this.worlds.has(id))
      throw new AccessError(`${this.label(id)} is not one of your worlds`);
    const { level, listed } = this.levelFor(id);
    if (PERMITS[level].has(action)) return level;
    if (level === "blocked" && !listed)
      throw new AccessError(
        `${this.label(id)} is not on your allow list (allow_only is on in ${this.file})`,
      );
    if (level === "blocked")
      throw new AccessError(`${this.label(id)} is blocked in your access settings`);
    throw new AccessError(
      `${this.label(id)} is ${level} in your access settings, so I can't ${ACTION_WORDS[action]} it`,
    );
  }

  /** Work out which world an item belongs to (cached; items never change world). */
  async worldOf(path, id, depth = 0) {
    if (path === "/world") return String(id).toLowerCase();
    const key = `${path}:${String(id).toLowerCase()}`;
    if (this.worldCache.has(key)) return this.worldCache.get(key);
    if (depth > 5) throw new AccessError("item nesting too deep to check");
    const item = await this.send(`${path}?id=${id}&granularity=1`, "GET");
    let world = null;
    if (item?.world?.id) world = String(item.world.id).toLowerCase();
    else
      for (const k of PARENT_KEYS)
        if (item?.[k]?.id && REF_PATHS[k]) {
          world = await this.worldOf(REF_PATHS[k], item[k].id, depth + 1);
          break;
        }
    if (!world)
      throw new AccessError(`can't tell which world ${path.slice(1)} ${id} belongs to, so it was refused`);
    this.worldCache.set(key, world);
    return world;
  }

  /**
   * Check a request. Resolves when allowed; throws AccessError otherwise.
   * @returns {Promise<{action: string, path: string, id: string|null, worldId: string|null}>}
   */
  async check(endpoint, method, body) {
    const { path, id } = parseEndpoint(endpoint);
    for (const [re, reason] of DISABLED) if (re.test(path)) throw new AccessError(reason);
    const action = classify(method, path);

    if (path === "/identity" || path === "/user/worlds" || GLOBAL_READS.has(path)) {
      if (action !== "read") throw new AccessError(`${path} is read-only`);
      return { action, path, id, worldId: null };
    }

    await this.resolve();

    // ---- worlds themselves ------------------------------------------------
    if (path === "/world") {
      if (action === "create") {
        if (!this.settings.allow_create_worlds)
          throw new AccessError(`creating worlds is turned off (allow_create_worlds in ${this.file})`);
        if (collectRefs(body, path).length)
          throw new AccessError("a new world can't reference other items");
        return { action, path, id, worldId: null };
      }
      if (!id) throw new AccessError("no world id given");
      if (action === "update")
        throw new AccessError("changing or renaming worlds isn't supported in this fork yet");
      if (action === "delete") {
        if (!this.settings.allow_delete_worlds)
          throw new AccessError(`deleting worlds is turned off (allow_delete_worlds in ${this.file})`);
        this.requireAction(id, "delete");
        throw new AccessError(
          "deleting a world needs a full world backup first, and backup_world isn't available yet",
        );
      }
      this.requireAction(id, "read");
      return { action, path, id, worldId: id.toLowerCase() };
    }

    // ---- lists: /<parent>/<children>?id=<parent id> -------------------------
    const list = path.match(/^(\/[a-z_]+)\/[a-z_]+$/);
    if (list) {
      if (!id) throw new AccessError("no id given for the list");
      const worldId = await this.worldOf(list[1], id);
      this.requireAction(worldId, "read");
      return { action, path, id, worldId };
    }

    // ---- creates: the target world comes from the references in the body --
    const refs = collectRefs(body, path);
    if (action === "create") {
      if (id) throw new AccessError("a create request can't target an existing id");
      if (!refs.length) throw new AccessError("can't tell which world this would be created in");
      const worldId = await this.sameWorld(refs);
      this.requireAction(worldId, "create");
      return { action, path, id, worldId };
    }

    // ---- read / update / delete an existing item ---------------------------
    if (!id) throw new AccessError(`no id given for ${path.slice(1)}`);
    const worldId = await this.worldOf(path, id);
    if (action !== "read" && refs.some((r) => r.key === "world"))
      throw new AccessError("moving items between worlds isn't allowed");
    if (refs.length) {
      const refWorld = await this.sameWorld(refs);
      if (refWorld !== worldId)
        throw new AccessError(
          `that would link ${this.label(worldId)} to an item in ${this.label(refWorld)}; cross-world links aren't allowed`,
        );
    }
    this.requireAction(worldId, action);
    return { action, path, id, worldId };
  }

  /** All references must be in one world; returns it. */
  async sameWorld(refs) {
    const worlds = new Set();
    for (const r of refs) worlds.add(await this.worldOf(r.path, r.id));
    if (worlds.size > 1)
      throw new AccessError(
        `that request mixes items from ${[...worlds].map((w) => this.label(w)).join(" and ")}; cross-world links aren't allowed`,
      );
    return [...worlds][0];
  }

  /**
   * Record a world the server has just created: add ONE entry to the user's
   * settings file (never changing existing entries) and refresh.
   */
  async onWorldCreated(worldId, title, level) {
    if (!["full_edit", "edit_only", "read_only"].includes(level))
      throw new AccessError(`"${level}" isn't a valid access level for a new world`);
    await this.resolve(true).catch(() => {});
    const sameTitle = [...(this.worlds ?? new Map()).values()].filter(
      (t) => t.trim().toLowerCase() === String(title).trim().toLowerCase(),
    ).length;
    const key = sameTitle === 1 ? String(title) : String(worldId);
    appendWorldEntry(this.file, key, level);
    this.settings = { ...this.settings, world_list: { ...this.settings.world_list, [key]: level } };
    this.worlds = null;
    await this.resolve(true);
    return key;
  }

  /** Add each world's access level to a /user/worlds listing (blocked ones included). */
  annotateWorldList(response) {
    if (!this.worlds || !Array.isArray(response?.entities)) return response;
    return {
      ...response,
      entities: response.entities.map((w) => {
        const { level, listed } = this.levelFor(w.id);
        const access = level === "blocked" && !listed ? "not on allow list" : level;
        return level === "blocked"
          ? { id: w.id, title: w.title, access }
          : { ...w, access };
      }),
    };
  }
}

/**
 * Put a WorldAccess guard in front of a WorldAnvilClient. After this, every
 * client method is checked before its request is sent, and every edit or
 * delete of an existing item is preceded by a local backup of that item.
 *
 * @param {object} [backups] - Backups instance (required for edits/deletes)
 * @param {Function} [transport] - underlying (endpoint, method, body) sender;
 *   defaults to the client's own HTTPS request. The live-test harness passes
 *   its own guarded transport here so both layers see every request.
 */
export function guardClient(client, access, backups = null, transport = null) {
  const raw = transport ?? Object.getPrototypeOf(client).request.bind(client);
  access.send = raw;
  Object.defineProperty(client, "request", {
    configurable: false,
    writable: false,
    value: async (endpoint, method = "GET", body = null) => {
      const decision = await access.check(endpoint, method, body);
      if (decision.path === "/user/worlds") await access.resolve();

      // No backup, no change.
      if ((decision.action === "update" || decision.action === "delete") && decision.id) {
        if (!backups)
          throw new AccessError("backups aren't configured, so changes are refused");
        let current;
        try {
          current = await raw(`${decision.path}?id=${decision.id}&granularity=2`, "GET");
          backups.saveItem({
            worldId: decision.worldId,
            worldTitle: access.worlds?.get(decision.worldId) ?? "",
            path: decision.path,
            id: decision.id,
            action: decision.action,
            data: current,
          });
        } catch (e) {
          throw new AccessError(`couldn't back up the item first (${e.message}), so nothing was changed`);
        }
      }

      const response = await raw(endpoint, method, body);
      if (decision.path === "/user/worlds") return access.annotateWorldList(response);
      return response;
    },
  });
  client.access = access;
  return client;
}
