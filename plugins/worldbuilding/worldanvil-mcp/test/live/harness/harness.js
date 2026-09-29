/**
 * Live-test safety harness - the single choke point for World Anvil traffic.
 *
 * Live tests must obtain their client and tool-caller from createHarness().
 * Every request goes through guardedRequest(), which enforces policy.js
 * BEFORE anything is sent. No other test code may make network calls
 * (enforced by test/harness-static.test.js).
 *
 * Usage (stage is required, one of read | create | update | delete):
 *   const h = await createHarness({ stage: "read" });
 *   const result = await h.call("worldanvil_get_world", { world_id: h.testWorldId });
 */

import { readFileSync, existsSync } from "fs";
import { parse as parseEnv } from "dotenv";
import { WorldAnvilClient } from "../../../src/api-client.js";
import { handleToolCall } from "../../../src/handlers.js";
import { GuardError, evaluateRequest, parseEndpoint } from "./policy.js";
import {
  TEST_PREFIX,
  extractTokens,
  findProtectedReference,
} from "./protected.js";
import { Ledger, PATHS, ProtectedWorlds } from "./state.js";

const RATE_LIMIT_MS = 750;
const DIRECT_API_HOST = "www.worldanvil.com";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  console.log(`[harness] ${msg}`);
}

/** Load credentials from .env.test WITHOUT touching process.env. */
export function loadTestEnv(file = PATHS.env) {
  if (!existsSync(file))
    throw new GuardError(`.env.test not found at ${file}`, { abort: true });
  const env = parseEnv(readFileSync(file));
  for (const key of ["WA_AUTH_TOKEN", "WA_APP_KEY"])
    if (!env[key])
      throw new GuardError(`${key} missing from .env.test`, { abort: true });
  if (env.WA_PROXY_URL || process.env.WA_PROXY_URL)
    throw new GuardError("proxies are not allowed; remove WA_PROXY_URL", {
      abort: true,
    });
  const expected = Number(env.WA_TEST_EXPECTED_WORLD_COUNT);
  if (!Number.isInteger(expected) || expected < 0)
    throw new GuardError(
      "WA_TEST_EXPECTED_WORLD_COUNT (how many real worlds the account has) " +
        "must be set in .env.test",
      { abort: true },
    );
  return { ...env, expectedWorldCount: expected };
}

function worldSlug(world) {
  if (world.slug) return String(world.slug);
  const m = String(world.url ?? "").match(/\/w\/([^/?#]+)/);
  return m ? m[1] : null;
}

function createdId(response) {
  return response?.id ?? response?.entity?.id ?? null;
}

/**
 * Build a guarded harness. Performs pre-flight and the protected-worlds
 * snapshot before returning.
 *
 * @param {object} opts
 * @param {"read"|"create"|"update"|"delete"} opts.stage
 * @param {object} [opts.paths] - override state file locations (unit tests only)
 */
export async function createHarness({ stage, paths = PATHS } = {}) {
  if (!stage) throw new GuardError("a stage must be specified", { abort: true });

  // ---- Pre-flight -------------------------------------------------------
  const env = loadTestEnv(paths.env);
  const ledger = new Ledger(paths.ledger);
  const firstRun =
    !ProtectedWorlds.exists(paths.protected) && !Ledger.exists(paths.ledger);
  if (!ProtectedWorlds.exists(paths.protected) && !firstRun)
    throw new GuardError(
      "protected-worlds.json is missing but a ledger exists; refusing to run",
      { abort: true },
    );
  const protectedWorlds = new ProtectedWorlds(paths.protected);

  const client = new WorldAnvilClient({
    appKey: env.WA_APP_KEY,
    authToken: env.WA_AUTH_TOKEN,
  });
  if (!client.appKey || client.apiBase !== DIRECT_API_HOST)
    throw new GuardError("client is not in direct mode", { abort: true });

  const rawRequest = WorldAnvilClient.prototype.request.bind(client);
  const state = {
    stage,
    aborted: false,
    userId: null,
    allowWorldCreate: false,
    lastCallAt: 0,
  };

  const ctx = () => ({
    stage: state.stage,
    aborted: state.aborted,
    userId: state.userId,
    ledgerIds: ledger.ids(),
    ledgerWorldIds: ledger.worldIds(),
    localProtected: protectedWorlds.tokens(),
    allowWorldCreate: state.allowWorldCreate,
  });

  async function send(endpoint, method, body) {
    const wait = state.lastCallAt + RATE_LIMIT_MS - Date.now();
    if (wait > 0) await sleep(wait);
    state.lastCallAt = Date.now();
    log(`${method} ${parseEndpoint(endpoint).path}`);
    return rawRequest(endpoint, method, body);
  }

  function refuse(err) {
    if (err instanceof GuardError && err.abort) {
      state.aborted = true;
      process.exitCode = 1;
    }
    throw err;
  }

  /** The choke point. Replaces client.request for all live test traffic. */
  async function guardedRequest(endpoint, method = "GET", body = null) {
    let decision;
    try {
      decision = evaluateRequest({ endpoint, method, body }, ctx());
    } catch (err) {
      refuse(err);
    }

    if (decision.kind === "delete") {
      // Re-fetch the target and confirm it is still a test item in a test world.
      const entry = ledger.get(decision.targetId);
      const current = await send(
        `${decision.path}?id=${decision.targetId}&granularity=-1`,
        "GET",
      );
      const title = current?.title ?? "";
      if (!entry || entry.auto || !String(title).startsWith(TEST_PREFIX))
        refuse(new GuardError(`delete target title is not ${TEST_PREFIX}*`));
      const worldRef =
        decision.path === "/world"
          ? current?.id?.toLowerCase()
          : current?.world?.id?.toLowerCase();
      if (worldRef && !ledger.worldIds().has(worldRef))
        refuse(new GuardError("delete target is not in a test world", { abort: true }));
    }

    const response = await send(endpoint, method, body);

    if (decision.kind === "create") {
      const id = createdId(response);
      if (!id) {
        refuse(
          new GuardError("created resource returned no id; cannot track it", {
            abort: true,
          }),
        );
      }
      const parentIds = [...ctx().ledgerIds].filter((l) =>
        JSON.stringify(body ?? {}).toLowerCase().includes(l),
      );
      const worlds = ledger.worldIds();
      const worldId =
        decision.path === "/world"
          ? id
          : (parentIds.find((p) => worlds.has(p)) ??
            ledger.get(parentIds[0])?.worldId ??
            null);
      ledger.record({
        id,
        path: decision.path,
        title: body.title ?? body.name,
        worldId,
        parentIds,
      });
      log(`ledger: recorded ${decision.path} ${id}`);
    }

    if (decision.kind === "delete") ledger.markDeleted(decision.targetId);
    return response;
  }

  Object.defineProperty(client, "request", {
    value: guardedRequest,
    writable: false,
    configurable: false,
  });
  Object.freeze(client);

  // ---- Identity + protected-worlds snapshot ------------------------------
  const identity = await client.getIdentity();
  state.userId = String(identity.id).toLowerCase();
  log(`account: ${identity.username}`);

  const worlds = [];
  for (let offset = 0; ; offset += 50) {
    const page = await client.request(
      `/user/worlds?id=${state.userId}`,
      "POST",
      { limit: "50", offset: String(offset) },
    );
    const entities = page?.entities ?? [];
    worlds.push(...entities);
    if (entities.length < 50) break;
  }

  const ledgerIds = ledger.ids();
  const realWorlds = worlds
    .filter((w) => !ledgerIds.has(String(w.id).toLowerCase()))
    .map((w) => ({ id: String(w.id), slug: worldSlug(w), title: w.title }));

  if (firstRun && realWorlds.length !== env.expectedWorldCount) {
    state.aborted = true;
    throw new GuardError(
      `first-run snapshot mismatch (found ${realWorlds.length} worlds, ` +
        `expected ${env.expectedWorldCount}). Nothing was written. Ask the owner.`,
      { abort: true },
    );
  }

  const added = protectedWorlds.append(realWorlds);
  log(
    `protected worlds: ${protectedWorlds.ids().size} ` +
      `(${added.length} newly added${firstRun ? ", first-run snapshot" : ""})`,
  );

  // ---- Public harness API -------------------------------------------------
  return {
    client,
    ledger,
    get testWorldId() {
      return [...ledger.worldIds()][0] ?? null;
    },
    get aborted() {
      return state.aborted;
    },

    /** Call an MCP tool handler through the guarded client. */
    async call(toolName, args = {}) {
      const result = await handleToolCall(toolName, args, client);
      const text = result?.content?.[0]?.text ?? "";
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { isError: !!result?.isError, data, text };
    },

    /** Explicit, one-shot permission to create a test world. */
    async createTestWorld(title) {
      state.allowWorldCreate = true;
      try {
        return await client.createWorld({ title });
      } finally {
        state.allowWorldCreate = false;
      }
    },

    /**
     * Adopt a child the API created implicitly under a ledger parent
     * (e.g. a default manuscript version). Adopted items can be read and
     * updated but are never deleted directly; they go with their parent.
     */
    async adopt(childId, childPath, parentId) {
      if (state.aborted) refuse(new GuardError("run was aborted earlier"));
      const parent = ledger.get(parentId);
      if (!parent) refuse(new GuardError(`adopt parent ${parentId} not in ledger`));
      const endpoint = `${childPath}?id=${childId}&granularity=2`;
      const hit = findProtectedReference(
        extractTokens(endpoint),
        protectedWorlds.tokens(),
      );
      if (hit) refuse(new GuardError(`adopt references a ${hit}`, { abort: true }));
      const child = await send(endpoint, "GET");
      if (!JSON.stringify(child).toLowerCase().includes(parent.id))
        refuse(new GuardError(`adopt: ${childId} does not reference its parent`));
      const childWorld = child?.world?.id?.toLowerCase();
      if (childWorld && !ledger.worldIds().has(childWorld))
        refuse(new GuardError("adopt: child is not in a test world", { abort: true }));
      ledger.record({
        id: childId,
        path: childPath,
        title: child?.title ?? null,
        worldId: parent.worldId,
        parentIds: [parent.id],
        auto: true,
      });
      return child;
    },
  };
}
