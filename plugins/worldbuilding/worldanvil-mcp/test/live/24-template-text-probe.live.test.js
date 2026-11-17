/**
 * Where does each template keep its main text? Read-only.
 *
 *   WA_TEST_STAGE=read WA_TEST_TEMPLATE_TEXT=1 npm run test:live -- test/live/24-template-text-probe.live.test.js
 *
 * Reads a few stage 1 test articles of different templates and prints,
 * for each, every field that holds text (name and length) and every
 * field name it has. Found 2026-11-17: text sent as `content` to a Prose
 * article does not show in the site editor's "Prose" box.
 *
 * Changes nothing.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const stage = process.env.WA_TEST_STAGE;
const enabled = process.env.WA_TEST_TEMPLATE_TEXT === "1";

const TITLES = ["MCP-TEST-S1 Prose", "MCP-TEST-S1 Generic", "MCP-TEST-S1 Document", "MCP-TEST-S1 Character"];

function note(msg) {
  console.log(`[template-text] ${msg}`);
}

describe.runIf(enabled && stage === "read")("which fields hold an article's text", () => {
  let h, world;

  beforeAll(async () => {
    h = await createHarness({ stage: "read" });
    world = String(h.testWorldId).toLowerCase();
  });

  it("prints the text fields of a few templates", async () => {
    expect(h.aborted).toBe(false);
    let allKeys = null;
    for (const title of TITLES) {
      const id = h.ledger
        .live()
        .find((e) => e.path === "/article" && e.title === title && String(e.worldId).toLowerCase() === world)?.id;
      if (!id) {
        note(`${title}: not in the ledger`);
        continue;
      }
      const res = await h.call("worldanvil_get_article", { article_id: id });
      expect(res.isError, String(res.text).slice(0, 300)).toBeFalsy();
      const a = res.data;
      const text = Object.entries(a)
        .filter(([k, v]) => typeof v === "string" && v.trim() !== "" && !/id$|url|slug|date/i.test(k))
        .map(([k, v]) => `${k}(${v.length})`);
      note(`${title}: templateType ${a.templateType}; wordcount ${a.wordcount}; text fields: ${text.join(", ")}`);
      if (title === "MCP-TEST-S1 Generic") {
        note(`  change date ${a.updateDate?.date}; main text as stored now:`);
        for (const line of String(a.content).split("\n")) note(`    ${line.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>")}`);
      }
      const keys = Object.keys(a).sort();
      if (!allKeys) {
        allKeys = keys;
        note(`  all fields of ${title}: ${keys.join(", ")}`);
      } else {
        const extra = keys.filter((k) => !allKeys.includes(k));
        const missing = allKeys.filter((k) => !keys.includes(k));
        note(`  compared with the first: has also [${extra.join(", ")}]; lacks [${missing.join(", ")}]`);
      }
    }
  });
});
