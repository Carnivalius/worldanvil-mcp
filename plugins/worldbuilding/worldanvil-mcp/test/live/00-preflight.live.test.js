/**
 * Stage 1 (read-only): pre-flight, identity and protected-worlds snapshot.
 *
 *   WA_TEST_STAGE=read npm run test:live -- test/live/00-preflight.live.test.js
 *
 * Makes no writes. On the very first run it records every existing world in
 * protected-worlds.json and aborts unless the snapshot matches the expected
 * nine worlds exactly.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;

describe.runIf(stage === "read")("stage 1: pre-flight (read only)", () => {
  let h;

  beforeAll(async () => {
    h = await createHarness({ stage: "read" });
  });

  it("is not aborted after pre-flight and snapshot", () => {
    expect(h.aborted).toBe(false);
  });

  it("refuses a write in the read stage without sending it", async () => {
    const res = await h.call("worldanvil_create_world", {
      title: "MCP-TEST-SHOULD-NOT-EXIST",
      access_level: "full_edit",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/REFUSED/);
  });

  it.runIf(() => !!h?.testWorldId)("can read the test world if it exists", async () => {
    const res = await h.call("worldanvil_get_world", { world_id: h.testWorldId });
    expect(res.isError).toBe(false);
    expect(String(res.data.title)).toMatch(/^MCP-TEST-/);
  });
});
