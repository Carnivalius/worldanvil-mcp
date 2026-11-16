/**
 * Probe (read only): how does World Anvil's own editor store formatted
 * article text? Reads back an article made by hand on the site in the
 * test world, so the Markdown converter can be made to write the same
 * tags (paragraphs, headings, lists, quotes, tables, links, mentions).
 *
 *   WA_TEST_STAGE=read WA_TEST_FORMAT=1 WA_TEST_FORMAT_TITLE="<title>" npm run test:live -- test/live/12-format-probe.live.test.js
 *
 * Nothing is created, edited or deleted on World Anvil. The article is
 * not in the ledger, so it is adopted under the test world first (the
 * harness checks it belongs to that world). The full read-back is written
 * to the live-test backup folder (outside the repository); every filled
 * text field is logged as a [format] line. Findings belong in the API
 * guide, without ids.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";
import { PATHS } from "./harness/state.js";

const title = process.env.WA_TEST_FORMAT_TITLE;
const enabled =
  process.env.WA_TEST_STAGE === "read" && process.env.WA_TEST_FORMAT === "1" && Boolean(title);

function note(msg) {
  console.log(`[format] ${msg}`);
}

describe.runIf(enabled)("format probe: read back a site-made article", () => {
  let h, world, article;

  beforeAll(async () => {
    h = await createHarness({ stage: "read" });
    world = h.testWorldId;
  });

  it("finds the article by title in the test world", async () => {
    expect(h.aborted).toBe(false);
    const wanted = title.trim().toLowerCase();
    let offset = 0;
    let hit = null;
    for (let page = 0; page < 20 && !hit; page++) {
      const res = await h.call("worldanvil_list_articles", { world_id: world, limit: 50, offset });
      expect(res.isError, res.text).toBeFalsy();
      const entities = res.data?.entities ?? [];
      hit = entities.find((a) => String(a.title).trim().toLowerCase() === wanted) ?? null;
      if (!res.data?.paging?.more) break;
      offset = res.data.paging.next_offset;
    }
    expect(hit, `no article titled "${title}" in the test world`).toBeTruthy();
    note(`found: entityClass ${hit.entityClass}, state ${hit.state}, icon ${hit.icon}`);
    article = String(hit.id).toLowerCase();
  });

  it("reads it in full and logs every filled text field", async () => {
    let full;
    if (h.ledger.ids().has(article)) {
      const res = await h.call("worldanvil_get_article", { article_id: article });
      expect(res.isError, res.text).toBeFalsy();
      full = res.data;
    } else {
      full = await h.adopt(article, "/article", world);
      note("adopted under the test world");
    }
    expect(full).toBeTruthy();

    mkdirSync(PATHS.backups, { recursive: true });
    const file = join(PATHS.backups, `format-probe-${new Date().toISOString().slice(0, 10)}.json`);
    writeFileSync(file, JSON.stringify(full, null, 2) + "\n", "utf8");
    note(`full read-back written to the backup folder (${file.split(/[\\/]/).pop()})`);

    note(`templateType ${full.templateType}, editor ${full.editor}, articleMetadata ${full.articleMetadata}`);
    const skip = new Set(["id", "title", "slug", "url", "editURL", "state", "entityClass", "templateType", "editor", "icon"]);
    for (const [key, value] of Object.entries(full)) {
      if (skip.has(key) || typeof value !== "string" || value === "") continue;
      note(`--- ${key} (${value.length} chars) ---`);
      for (const line of value.split("\n")) console.log(`[format]   ${line}`);
    }
    const linked = Object.entries(full)
      .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v) && "id" in v)
      .map(([k, v]) => `${k} -> ${v.entityClass ?? v.type ?? "?"} "${v.title ?? ""}"`);
    note(`linked objects: ${linked.join("; ") || "none"}`);
    const lists = Object.entries(full)
      .filter(([, v]) => Array.isArray(v) && v.length)
      .map(([k, v]) => `${k} (${v.length})`);
    note(`filled lists: ${lists.join(", ") || "none"}`);
  });
});
