/**
 * Probe: when something inside a manuscript changes, whose change date
 * moves? The scene's own, its draft's, the manuscript's?
 *
 *   WA_TEST_STAGE=update WA_TEST_DATES=1 npm run test:live -- test/live/10-dates-probe.live.test.js
 *
 * The world backup copies an item forward when the change date in World
 * Anvil's list matches the last backup. If a manuscript's date moved
 * whenever anything inside it changed, a backup could skip a whole
 * untouched manuscript (no lists, no reads). If it does not, skipping
 * would miss real changes. This finds out.
 *
 * Three small edits on test items, each put back afterwards:
 *   A. a scene's notes
 *   B. a label's title
 *   C. a beat's content
 * After each, the list dates of the manuscript, its draft and every part
 * are compared with before. Nothing is asserted about World Anvil's
 * answers; each is logged as a [dates] line.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const enabled = process.env.WA_TEST_STAGE === "update" && process.env.WA_TEST_DATES === "1";

function note(msg) {
  console.log(`[dates] ${msg}`);
}
const stamp = (r) => (r?.updateDate == null ? null : typeof r.updateDate === "string" ? r.updateDate : JSON.stringify(r.updateDate));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

describe.runIf(enabled)("change dates inside a manuscript", () => {
  let h, world, scene, version, manuscript, label, beat, beatPart;

  const find = (path, title) => h.ledger.live().find((e) => e.path === path && e.title === title)?.id ?? null;
  const entities = async (fn) => (await fn())?.entities ?? [];

  /** The list-level change date of the manuscript, its draft and each part. */
  async function snapshot() {
    const manuscripts = await entities(() => h.client.listManuscripts(world, { limit: 50, offset: 0 }));
    const versions = await entities(() => h.client.listManuscriptVersions(manuscript, { limit: 50, offset: 0 }));
    const parts = await entities(() => h.client.listManuscriptParts(version, { limit: 50, offset: 0 }));
    const full = {
      manuscript: stamp(await h.client.getManuscript(manuscript)),
      version: stamp(await h.client.getManuscriptVersion(version)),
    };
    return {
      manuscript: stamp(manuscripts.find((m) => same(m.id, manuscript))),
      version: stamp(versions.find((v) => same(v.id, version))),
      parts: Object.fromEntries(parts.map((p) => [String(p.id).toLowerCase(), { title: p.title, stamp: stamp(p) }])),
      full,
    };
  }

  function compare(label_, before, after) {
    const moved = (a, b) => (a === b ? "same" : "MOVED");
    const partsMoved = Object.entries(after.parts)
      .filter(([id, p]) => before.parts[id]?.stamp !== p.stamp)
      .map(([, p]) => p.title);
    note(
      `${label_}: manuscript ${moved(before.manuscript, after.manuscript)}, draft ${moved(before.version, after.version)}, ` +
        `parts moved: ${partsMoved.length ? partsMoved.join(", ") : "none"}`,
    );
    note(
      `${label_} (full reads): manuscript ${moved(before.full.manuscript, after.full.manuscript)}, ` +
        `draft ${moved(before.full.version, after.full.version)}`,
    );
  }

  beforeAll(async () => {
    h = await createHarness({ stage: "update" });
    world = h.testWorldId;
  });

  it("finds a test scene, its draft, manuscript, a label and a beat", async () => {
    expect(h.aborted).toBe(false);
    scene = find("/manuscript_part", "MCP-TEST-Probe Scene") ?? find("/manuscript_part", "MCP-TEST-Page");
    expect(scene, "no test scene in the ledger").toBeTruthy();
    const part = await h.client.getManuscriptPart(scene);
    version = String(part.version?.id ?? part.manuscriptVersion?.id);
    const draft = await h.client.getManuscriptVersion(version);
    manuscript = String(draft.manuscript?.id);
    expect(manuscript).toBeTruthy();

    const labels = await entities(() => h.client.listManuscriptLabels(manuscript, { limit: 50, offset: 0 }));
    label = labels.find((l) => l.title === "Blue") ?? labels[0];
    note(`label list record fields: ${label ? Object.keys(label).sort().join(", ") : "(no labels)"}`);

    beat = find("/manuscript_beat", "MCP-TEST-Beat");
    if (beat) {
      const b = await h.client.getManuscriptBeat(beat);
      beatPart = b.part?.id ?? b.manuscriptPart?.id ?? null;
      const inThisDraft = beatPart
        ? (await entities(() => h.client.listManuscriptParts(version, { limit: 50, offset: 0 }))).some((p) => same(p.id, beatPart))
        : false;
      note(`beat found; its part is in the same draft as the scene: ${inThisDraft}`);
      if (!inThisDraft) beat = null;
    }
    const start = await snapshot();
    note(`dates present: manuscript ${start.manuscript !== null}, draft ${start.version !== null}, parts ${Object.values(start.parts).filter((p) => p.stamp).length}/${Object.keys(start.parts).length}`);
  });

  it("A. editing a scene's notes", async () => {
    const original = (await h.client.getManuscriptPart(scene)).notes ?? "";
    const before = await snapshot();
    await pause(1500);
    await h.client.updateManuscriptPart(scene, { notes: `date probe ${new Date().toISOString()}` });
    compare("A scene edited", before, await snapshot());
    await h.client.updateManuscriptPart(scene, { notes: original });
  });

  // The harness (rightly) refuses to rename a test item, so the colour is changed instead.
  it("B. changing a label's colour", async () => {
    if (!label) return note("B skipped: no label");
    const full = await h.client.getManuscriptLabel(label.id);
    const original = full.color;
    note(`B label: list updateDate=${JSON.stringify(label.updateDate)}, full updateDate=${JSON.stringify(full.updateDate ?? null)}, colour=${original}`);
    if (typeof original !== "string") return note("B skipped: label has no colour to change");
    const before = await snapshot();
    await pause(1500);
    await h.client.updateManuscriptLabel(label.id, { color: original.toLowerCase() === "#123456" ? "#654321" : "#123456" });
    compare("B label changed", before, await snapshot());
    const after = (await entities(() => h.client.listManuscriptLabels(manuscript, { limit: 50, offset: 0 }))).find((l) => same(l.id, label.id));
    note(`B label list updateDate after the change: ${JSON.stringify(after?.updateDate ?? null)}`);
    await h.client.updateManuscriptLabel(label.id, { color: original });
    note(`B label colour restored: ${(await h.client.getManuscriptLabel(label.id)).color === original}`);
  });

  it("C. editing a beat", async () => {
    if (!beat) return note("C skipped: no beat in this draft");
    const original = (await h.client.getManuscriptBeat(beat)).content ?? "";
    const before = await snapshot();
    await pause(1500);
    await h.client.updateManuscriptBeat(beat, { content: `date probe ${new Date().toISOString()}` });
    compare("C beat edited", before, await snapshot());
    await h.client.updateManuscriptBeat(beat, { content: original });
  });
});
