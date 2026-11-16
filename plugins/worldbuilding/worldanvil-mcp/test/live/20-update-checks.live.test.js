/**
 * The update checks, live: the "unchanged" skip, if_unchanged_since, the
 * guard's reuse of a recent read as the backup, and fresh_backup.
 *
 *   WA_TEST_STAGE=update WA_TEST_UPDATE_CHECKS=1 npm run test:live -- test/live/20-update-checks.live.test.js
 *
 *   1. Sending the author notes World Anvil already holds sends nothing.
 *   2. An update carrying an old stamp is refused; nothing is sent.
 *   3. An update carrying the right stamp is saved with three requests
 *      (read, save, read back): the first read stood in for the backup.
 *   4. The notes are put back with fresh_backup: four requests, the extra
 *      one being the backup read afresh.
 *
 * Only the lore test article's author notes are changed, and they end as
 * they began. Requests are counted from the harness's own log lines.
 *
 * Needs the lore test article (13).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_UPDATE_CHECKS === "1";

const LORE = "MCP-TEST-Lore Format";
const ADDED = "[p]STAMP: added by the update-checks live test.[/p]";
const OLD_STAMP = "2020-01-01 00:00:00.000000";

function note(msg) {
  console.log(`[update-checks] ${msg}`);
}

describe.runIf(enabled && stage === "update")("update checks on an existing article", () => {
  let h, id, before, stamp, spy;

  /** Run one tool call and count the article requests it made. */
  const counted = async (tool, args) => {
    const from = spy.mock.calls.length;
    const res = await h.call(tool, args);
    const lines = spy.mock.calls.slice(from).map((c) => String(c[0]));
    const count = (method) => lines.filter((l) => l === `[harness] ${method} /article`).length;
    return { res, gets: count("GET"), patches: count("PATCH") };
  };
  const read = async () => {
    const res = await h.call("worldanvil_get_article", { article_id: id });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    return res.data;
  };

  beforeAll(async () => {
    spy = vi.spyOn(console, "log");
    h = await createHarness({ stage: "update" });
    id = h.ledger.live().find((e) => e.path === "/article" && e.title === LORE)?.id ?? null;
  });
  afterAll(() => spy?.mockRestore());

  it("has the lore test article, with author notes", async () => {
    expect(h.aborted).toBe(false);
    expect(id, `"${LORE}" is missing: run 13-lore-format create`).toBeTruthy();
    before = await read();
    expect(String(before.authornotes).length).toBeGreaterThan(10);
    stamp = before.updateDate.date;
    note(`stamp at the start: ${stamp}`);
  });

  it("unchanged: the notes it already holds send nothing", async () => {
    const { res, gets, patches } = await counted("worldanvil_update_article", {
      article_id: id,
      author_notes: before.authornotes,
      format: "bbcode",
    });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    note(`same notes -> unchanged ${res.data.unchanged}; ${gets} read, ${patches} save`);
    expect(res.data.unchanged).toBe(true);
    expect(res.data.stamp).toBe(stamp);
    expect(patches).toBe(0);
    expect(gets).toBe(1);
    expect((await read()).updateDate.date).toBe(stamp);
  });

  it("an old stamp is refused and nothing is sent", async () => {
    const { res, patches } = await counted("worldanvil_update_article", {
      article_id: id,
      author_notes: `${before.authornotes}${ADDED}`,
      format: "bbcode",
      if_unchanged_since: OLD_STAMP,
    });
    expect(h.aborted, res.text).toBe(false);
    note(`old stamp -> ${String(res.text).slice(0, 160)}`);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/has changed on World Anvil since it was compared/);
    expect(res.text).toMatch(/Nothing was sent/);
    expect(patches).toBe(0);
    const now = await read();
    expect(now.authornotes).toBe(before.authornotes);
    expect(now.updateDate.date).toBe(stamp);
  });

  it("the right stamp saves, and the first read stands in for the backup", async () => {
    const { res, gets, patches } = await counted("worldanvil_update_article", {
      article_id: id,
      author_notes: `${before.authornotes}${ADDED}`,
      format: "bbcode",
      if_unchanged_since: stamp,
    });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    note(`right stamp -> ${res.data.stored}; ${gets} reads, ${patches} save`);
    expect(res.data.stored).toBe("Checked: author notes are stored exactly as sent.");
    expect(patches).toBe(1);
    expect(gets).toBe(2);
    const now = await read();
    expect(now.authornotes).toBe(`${before.authornotes}${ADDED}`);
    expect(now.updateDate.date).not.toBe(stamp);
    stamp = now.updateDate.date;
  });

  it("fresh_backup: the notes go back, with the backup read afresh", async () => {
    const { res, gets, patches } = await counted("worldanvil_update_article", {
      article_id: id,
      author_notes: before.authornotes,
      format: "bbcode",
      if_unchanged_since: stamp,
      fresh_backup: true,
    });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 400)).toBeFalsy();
    note(`fresh backup -> ${res.data.stored}; ${gets} reads, ${patches} save`);
    expect(res.data.stored).toBe("Checked: author notes are stored exactly as sent.");
    expect(patches).toBe(1);
    expect(gets).toBe(3);
  });

  it("leaves the article as it began", async () => {
    const after = await read();
    expect(after.content).toBe(before.content);
    expect(after.authornotes).toBe(before.authornotes);
    expect(after.title).toBe(LORE);
    expect(after.state).toBe("private");
  });
});
