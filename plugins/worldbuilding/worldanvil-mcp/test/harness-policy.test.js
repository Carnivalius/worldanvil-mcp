/**
 * Offline tests for the live-test safety harness policy.
 * No network access. See test/live/harness/.
 */

import { existsSync, readFileSync } from "fs";
import { describe, it, expect } from "vitest";
import {
  GuardError,
  classify,
  evaluateRequest,
} from "./live/harness/policy.js";
import {
  extractTokens,
  findProtectedReference,
} from "./live/harness/protected.js";
import { PATHS } from "./live/harness/state.js";

const USER = "00000000-0000-4000-8000-000000000001";
const TEST_WORLD = "11111111-1111-4111-8111-111111111111";
const TEST_MS = "22222222-2222-4222-8222-222222222222";
const REAL_WORLD = "99999999-9999-4999-8999-999999999999"; // snapshot-protected
const STRANGER = "33333333-3333-4333-8333-333333333333"; // not in ledger

function ctx(overrides = {}) {
  return {
    stage: "read",
    aborted: false,
    userId: USER,
    ledgerIds: new Set([TEST_WORLD, TEST_MS]),
    ledgerWorldIds: new Set([TEST_WORLD]),
    localProtected: new Set([REAL_WORLD, "my-real-world-slug"]),
    allowWorldCreate: false,
    ...overrides,
  };
}

const allowed = (req, c) => evaluateRequest(req, ctx(c));
const refused = (req, c) =>
  expect(() => evaluateRequest(req, ctx(c))).toThrow(GuardError);

describe("classify", () => {
  it("maps methods to request kinds", () => {
    expect(classify("GET", "/world")).toBe("read");
    expect(classify("POST", "/world/articles")).toBe("read");
    expect(classify("PUT", "/manuscript")).toBe("create");
    expect(classify("PATCH", "/article")).toBe("update");
    expect(classify("DELETE", "/article")).toBe("delete");
  });

  it("refuses POST to non-list endpoints", () => {
    expect(() => classify("POST", "/article")).toThrow(GuardError);
  });
});

describe("snapshot-protected worlds", () => {
  const variants = [
    { method: "GET", endpoint: `/world?id=${REAL_WORLD}&granularity=2` },
    { method: "GET", endpoint: `/world?id=${REAL_WORLD.toUpperCase()}` },
    { method: "GET", endpoint: `/world?id=${encodeURIComponent(REAL_WORLD)}` },
    { method: "POST", endpoint: `/world/articles?id=${REAL_WORLD}`, body: {} },
    { method: "PATCH", endpoint: `/world?id=${REAL_WORLD}`, body: { title: "x" } },
    { method: "DELETE", endpoint: `/world?id=${REAL_WORLD}` },
    {
      method: "PUT",
      endpoint: "/manuscript",
      body: { title: "MCP-TEST-x", world: { id: REAL_WORLD } },
    },
    { method: "GET", endpoint: "/world?slug=my-real-world-slug" },
  ];

  for (const req of variants)
    it(`aborts on ${req.method} ${req.endpoint}`, () => {
      try {
        evaluateRequest(req, ctx({ stage: req.method === "DELETE" ? "delete" : "update" }));
        throw new Error("should have been refused");
      } catch (err) {
        expect(err).toBeInstanceOf(GuardError);
        expect(err.abort).toBe(true);
      }
    });

  it("is checked before stage and ledger rules", () => {
    try {
      evaluateRequest(
        { method: "GET", endpoint: `/world?id=${REAL_WORLD}` },
        ctx({ ledgerIds: new Set([REAL_WORLD]) }),
      );
      throw new Error("should have been refused");
    } catch (err) {
      expect(err.abort).toBe(true);
    }
  });
});

describe("sticky abort", () => {
  it("refuses everything once aborted", () => {
    refused({ method: "GET", endpoint: "/identity" }, { aborted: true });
  });
});

describe("reads (deny by default)", () => {
  it("allows identity, own world list and ledger items", () => {
    allowed({ method: "GET", endpoint: "/identity" });
    allowed({ method: "POST", endpoint: `/user/worlds?id=${USER}`, body: {} });
    allowed({ method: "GET", endpoint: `/world?id=${TEST_WORLD}&granularity=2` });
    allowed({ method: "POST", endpoint: `/world/manuscripts?id=${TEST_WORLD}`, body: {} });
  });

  it("refuses reads of anything not created by the tests", () => {
    refused({ method: "GET", endpoint: `/article?id=${STRANGER}` });
    refused({ method: "POST", endpoint: `/world/articles?id=${STRANGER}`, body: {} });
    refused({ method: "POST", endpoint: `/user/worlds?id=${STRANGER}`, body: {} });
    refused({ method: "GET", endpoint: "/world" });
  });
});

describe("stage gating", () => {
  const create = {
    method: "PUT",
    endpoint: "/manuscript",
    body: { title: "MCP-TEST-ms", world: { id: TEST_WORLD } },
  };
  const update = { method: "PATCH", endpoint: `/manuscript?id=${TEST_MS}`, body: {} };
  const del = { method: "DELETE", endpoint: `/manuscript?id=${TEST_MS}` };

  it("read stage allows no writes", () => {
    refused(create);
    refused(update);
    refused(del);
  });
  it("create stage allows only creates", () => {
    allowed(create, { stage: "create" });
    refused(update, { stage: "create" });
    refused(del, { stage: "create" });
  });
  it("update stage allows only updates", () => {
    allowed(update, { stage: "update" });
    refused(create, { stage: "update" });
    refused(del, { stage: "update" });
  });
  it("delete stage allows only deletes", () => {
    allowed(del, { stage: "delete" });
    refused(create, { stage: "delete" });
    refused(update, { stage: "delete" });
  });
  it("unknown stage is refused", () => {
    refused({ method: "GET", endpoint: "/identity" }, { stage: "anything" });
  });
});

describe("creates", () => {
  const c = { stage: "create" };
  it("require the MCP-TEST- prefix", () => {
    refused({ method: "PUT", endpoint: "/manuscript", body: { title: "My novel", world: { id: TEST_WORLD } } }, c);
    refused({ method: "PUT", endpoint: "/manuscript", body: { world: { id: TEST_WORLD } } }, c);
  });
  it("require a ledger parent", () => {
    refused({ method: "PUT", endpoint: "/manuscript", body: { title: "MCP-TEST-x" } }, c);
    refused({ method: "PUT", endpoint: "/manuscript", body: { title: "MCP-TEST-x", world: { id: STRANGER } } }, c);
  });
  it("refuse any non-ledger id anywhere in the body", () => {
    refused({
      method: "PUT",
      endpoint: "/manuscript_part",
      body: { title: "MCP-TEST-p", version: { id: TEST_MS }, image: { id: STRANGER } },
    }, c);
  });
  it("world creation needs explicit opt-in and is capped at two", () => {
    const req = { method: "PUT", endpoint: "/world", body: { title: "MCP-TEST-SCRATCH" } };
    refused(req, c);
    allowed(req, { ...c, allowWorldCreate: true });
    refused(req, {
      ...c,
      allowWorldCreate: true,
      ledgerWorldIds: new Set([TEST_WORLD, "44444444-4444-4444-8444-444444444444"]),
    });
  });
});

describe("updates and deletes", () => {
  it("only target ledger items", () => {
    refused({ method: "PATCH", endpoint: `/article?id=${STRANGER}`, body: {} }, { stage: "update" });
    refused({ method: "PATCH", endpoint: "/article", body: {} }, { stage: "update" });
    refused({ method: "DELETE", endpoint: `/article?id=${STRANGER}` }, { stage: "delete" });
  });
  it("cannot move a ledger item under a non-ledger parent", () => {
    refused({
      method: "PATCH",
      endpoint: `/manuscript?id=${TEST_MS}`,
      body: { world: { id: STRANGER } },
    }, { stage: "update" });
  });
  it("renames must keep the prefix", () => {
    refused({ method: "PATCH", endpoint: `/manuscript?id=${TEST_MS}`, body: { title: "Real title" } }, { stage: "update" });
    allowed({ method: "PATCH", endpoint: `/manuscript?id=${TEST_MS}`, body: { title: "MCP-TEST-renamed" } }, { stage: "update" });
  });
});

/**
 * Proof that the real worlds are refused. Their ids are never stored in the
 * repo: they come from the local (gitignored) snapshot, or from
 * WA_GUARD_PROOF_ID for a one-off local check.
 */
function localProtectedIds() {
  const ids = new Set();
  if (process.env.WA_GUARD_PROOF_ID) ids.add(process.env.WA_GUARD_PROOF_ID.toLowerCase());
  if (existsSync(PATHS.protected))
    for (const w of JSON.parse(readFileSync(PATHS.protected, "utf8")).worlds) ids.add(w.id);
  return [...ids];
}

describe.runIf(localProtectedIds().length > 0)("real protected worlds (local proof)", () => {
  const ids = localProtectedIds();
  it("are refused even if one wrongly appears in the ledger", () => {
    for (const id of ids)
      for (const req of [
        { method: "GET", endpoint: `/world?id=${id}` },
        { method: "GET", endpoint: `/world?id=${id.toUpperCase()}` },
        { method: "DELETE", endpoint: `/world?id=${id}` },
        { method: "PUT", endpoint: "/manuscript", body: { title: "MCP-TEST-x", world: { id } } },
      ]) {
        const c = ctx({ stage: "delete", localProtected: new Set(ids), ledgerIds: new Set([id]) });
        expect(() => evaluateRequest(req, c)).toThrow(GuardError);
      }
    expect(findProtectedReference(extractTokens(`/world?id=${ids[0]}`), new Set(ids))).toBe(
      "protected world",
    );
  });
});
