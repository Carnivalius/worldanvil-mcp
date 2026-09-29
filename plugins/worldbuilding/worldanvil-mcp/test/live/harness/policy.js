/**
 * Live-test safety harness - request policy (pure, no I/O).
 *
 * Deny by default: a request is only allowed if it is provably about
 * something the tests created (ledger), or is one of the few account-level
 * reads the harness needs (identity, the world list for the snapshot).
 */

import {
  TEST_PREFIX,
  extractTokens,
  extractUuids,
  findProtectedReference,
} from "./protected.js";

export class GuardError extends Error {
  constructor(message, { abort = false } = {}) {
    super(`[harness] REFUSED: ${message}`);
    this.name = "GuardError";
    this.abort = abort;
  }
}

/** Which request kinds each stage may perform. Reads are always allowed. */
export const STAGES = {
  read: new Set(["read"]),
  create: new Set(["read", "create"]),
  update: new Set(["read", "update"]),
  delete: new Set(["read", "delete"]),
};

export function parseEndpoint(endpoint) {
  const [path, query = ""] = String(endpoint).split("?");
  const params = new URLSearchParams(query);
  return { path, params, id: params.get("id")?.toLowerCase() ?? null };
}

/** Classify an API call as read / create / update / delete. */
export function classify(method, path) {
  const m = String(method).toUpperCase();
  if (m === "GET") return "read";
  // World Anvil list endpoints are POST /<parent>/<children>?id=<parent>
  if (m === "POST" && /^\/[a-z_]+\/[a-z_]+$/.test(path)) return "read";
  if (m === "PUT") return "create";
  if (m === "PATCH") return "update";
  if (m === "DELETE") return "delete";
  throw new GuardError(`unsupported request ${m} ${path}`);
}

function titleOf(body) {
  if (!body || typeof body !== "object") return undefined;
  return body.title ?? body.name;
}

/**
 * Evaluate a request against the safety rules. Throws GuardError if refused.
 *
 * @param {{method: string, endpoint: string, body?: object}} req
 * @param {object} ctx
 * @param {string} ctx.stage - read | create | update | delete
 * @param {boolean} ctx.aborted - sticky abort flag
 * @param {string|null} ctx.userId - account id from /identity (lowercase)
 * @param {Set<string>} ctx.ledgerIds - live (not deleted) ledger ids, lowercase
 * @param {Set<string>} ctx.ledgerWorldIds - live ledger world ids, lowercase
 * @param {Set<string>} ctx.localProtected - ids/slugs from protected-worlds.json
 * @param {boolean} [ctx.allowWorldCreate] - explicit opt-in for PUT /world
 * @returns {{kind: string, path: string, targetId: string|null}}
 */
export function evaluateRequest(req, ctx) {
  if (ctx.aborted)
    throw new GuardError("run was aborted earlier; restart required", {
      abort: true,
    });

  const { path, id: targetId } = parseEndpoint(req.endpoint);

  // 1. Protected worlds: any reference anywhere aborts the run.
  const hit = findProtectedReference(
    extractTokens(req.endpoint, req.body),
    ctx.localProtected,
  );
  if (hit)
    throw new GuardError(`request references a ${hit}`, { abort: true });

  // 2. Stage gating.
  const kind = classify(req.method, path);
  const allowed = STAGES[ctx.stage];
  if (!allowed) throw new GuardError(`unknown stage "${ctx.stage}"`);
  if (!allowed.has(kind))
    throw new GuardError(`${kind} is not allowed in stage "${ctx.stage}"`);

  // 3. Every UUID in the body must be a ledger item (or the account itself).
  const known = (id) => ctx.ledgerIds.has(id) || id === ctx.userId;
  for (const id of extractUuids(req.body))
    if (!known(id))
      throw new GuardError(`body references ${id}, which is not in the ledger`);

  // 4. Per-kind rules.
  if (kind === "read") {
    if (path === "/identity" && !targetId) return { kind, path, targetId };
    if (path === "/user/worlds" && targetId && targetId === ctx.userId)
      return { kind, path, targetId };
    if (targetId && ctx.ledgerIds.has(targetId))
      return { kind, path, targetId };
    throw new GuardError(
      `read of ${path}${targetId ? ` id=${targetId}` : ""} is not a ledger item`,
    );
  }

  if (kind === "create") {
    if (targetId) throw new GuardError("create must not target an existing id");
    const title = titleOf(req.body);
    if (typeof title !== "string" || !title.startsWith(TEST_PREFIX))
      throw new GuardError(`created items must be titled "${TEST_PREFIX}..."`);
    if (path === "/world") {
      if (!ctx.allowWorldCreate)
        throw new GuardError("world creation needs explicit allowWorldCreate");
      if (ctx.ledgerWorldIds.size >= 2)
        throw new GuardError("at most two test worlds may exist at once");
      return { kind, path, targetId };
    }
    if (extractUuids(req.body).size === 0)
      throw new GuardError("create must reference a ledger parent");
    return { kind, path, targetId };
  }

  // update / delete
  if (!targetId || !ctx.ledgerIds.has(targetId))
    throw new GuardError(
      `${kind} target ${targetId ?? "(none)"} is not in the ledger`,
    );
  if (kind === "update") {
    const title = titleOf(req.body);
    if (title !== undefined && !String(title).startsWith(TEST_PREFIX))
      throw new GuardError(`renamed items must keep the "${TEST_PREFIX}" prefix`);
  }
  return { kind, path, targetId };
}
