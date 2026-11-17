/**
 * The archive of acted-on notes, through the real server.
 *
 *   WA_TEST_STAGE=read WA_TEST_ARCHIVE=1 npm run test:live -- test/live/27-archive.live.test.js
 *
 * Archives one small test note for the test world, lists the archive, and
 * reads the note back by its id. The only thing sent to World Anvil is the
 * read of the world that checks access; the note and the log are local
 * files beside the backups. Changes nothing on World Anvil.
 *
 * Safe to repeat: the first run saves the note, later runs are told it is
 * already archived (the saved copy is never changed or removed by a tool).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_ARCHIVE === "1";

const NAME = "MCP-TEST-Archive Try.md";
const TEXT = "# MCP-TEST-Archive Try\n\nA test note: add the salt trade to the harbour article.\n\n- one\n- two\n";
const ARTICLE = "MCP-TEST-Lore Format";

function note(msg) {
  console.log(`[archive] ${msg}`);
}

describe.runIf(enabled && stage === "read")("archive a note and find it again", () => {
  let h, world, saved, id;

  beforeAll(async () => {
    h = await createHarness({ stage: "read" });
    world = h.testWorldId;
  });

  it("saves the note, or says it is already there", async () => {
    expect(h.aborted).toBe(false);
    expect(world, "run the create stage (01) first").toBeTruthy();

    const started = Date.now();
    const res = await h.call("worldanvil_archive_file", {
      world_id: world,
      file_name: NAME,
      content: TEXT,
      what_was_done: "Live test: nothing was done with it",
      articles: [ARTICLE],
      source: "live test 27",
    });
    expect(h.aborted, res.text).toBe(false);
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    saved = res.data;
    note(`answered in ${Date.now() - started} ms: ${JSON.stringify(saved)}`);

    if (saved.archived) {
      expect(saved.file).toMatch(/^\d{4}-\d{2}-\d{2}_MCP-TEST-Archive-Try_[0-9a-f]{8}\.md$/);
      expect(saved.note).toMatch(/read back to check it matches/);
      id = saved.id;
    } else {
      expect(saved.already_archived?.file).toMatch(/_MCP-TEST-Archive-Try_[0-9a-f]{8}\.md$/);
      expect(saved.note).toMatch(/already in the archive/);
      id = saved.already_archived.id;
    }
    expect(id).toBeTruthy();
  });

  it("lists it for this world, found by a word in its name", async () => {
    const res = await h.call("worldanvil_list_archive", { world_id: world, text: "archive try" });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    note(`list: ${res.data.archived_notes} archived, ${res.data.matching} matching`);
    const entry = res.data.entries.find((e) => e.id === id);
    expect(entry, "the note is not in the list").toBeTruthy();
    expect(entry.original_name).toBe(NAME);
    expect(entry.articles).toEqual([ARTICLE]);
    expect(entry.characters).toBe(TEXT.length);
    expect(entry.sha256).toBeUndefined();
  });

  it("gives the note's text back, exactly, by the start of its id", async () => {
    const res = await h.call("worldanvil_list_archive", { world_id: world, id: id.slice(0, 8) });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    expect(res.data.entry.id).toBe(id);
    expect(res.data.content).toBe(TEXT);
    expect(res.data.warning).toBeUndefined();
    note(`read back ${res.data.content.length} characters from "${res.data.entry.file}"`);
  });

  it("a second save of the same note saves nothing new", async () => {
    const res = await h.call("worldanvil_archive_file", {
      world_id: world,
      file_name: NAME,
      content: TEXT,
      what_was_done: "Live test: second try",
    });
    expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
    expect(res.data.archived).toBe(false);
    expect(res.data.already_archived.id).toBe(id);
  });
});
