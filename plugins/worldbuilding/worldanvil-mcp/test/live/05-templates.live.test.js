/**
 * Article templates (create): which `templateType` names does World Anvil
 * accept, and what does each read back as?
 *
 *   WA_TEST_STAGE=create WA_TEST_TEMPLATES=1 npm run test:live -- test/live/05-templates.live.test.js
 *
 * Needs the test world and category from stage 2. For each of the 25
 * article classes in World Anvil's spec other than the generic one, it
 * tries the guessed name(s) in order and stops at the first one accepted.
 * A rejected name creates nothing. Every article made is titled MCP-TEST-,
 * recorded in the ledger and left for the delete stage. A re-run reuses
 * what is already in the ledger.
 *
 * Results are logged as [templates] lines and summarised at the end, not
 * asserted: a rejected guess is a finding, not a failure.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHarness } from "./harness/harness.js";

const enabled =
  process.env.WA_TEST_STAGE === "create" && process.env.WA_TEST_TEMPLATES === "1";

/** Spec entityClass -> names to try, best guess first. */
const CANDIDATES = {
  Person: ["person"],
  Landmark: ["landmark"],
  Item: ["item"],
  Location: ["location"],
  Organization: ["organization"],
  Species: ["species"],
  Vehicle: ["vehicle"],
  Settlement: ["settlement"],
  Condition: ["condition"],
  // The site's Conflict tile links to .../create/militaryConflict (camel case).
  // Rejected live 2026-11-12: militaryconflict, conflict, military_conflict.
  MilitaryConflict: ["militaryConflict"],
  Document: ["document"],
  Ethnicity: ["ethnicity"],
  Language: ["language"],
  Material: ["material"],
  Formation: ["formation"],
  Myth: ["myth"],
  Law: ["law"],
  Plot: ["plot"],
  Profession: ["profession"],
  Prose: ["prose"],
  Rank: ["rank"],
  Spell: ["spell"],
  Technology: ["technology"],
  Ritual: ["ritual"],
  Report: ["report"],
};

function note(msg) {
  console.log(`[templates] ${msg}`);
}

describe.runIf(enabled)("article templates: which names are accepted", () => {
  let h;
  let world;
  let category;
  const results = [];

  beforeAll(async () => {
    h = await createHarness({ stage: "create" });
    world = h.testWorldId;
    category = h.ledger.live().find((e) => e.path === "/category")?.id;
  });

  it("is not aborted and has the stage 2 world and category", () => {
    expect(h.aborted).toBe(false);
    expect(world, "run the create stage first").toBeTruthy();
    expect(category, "run the create stage first").toBeTruthy();
  });

  for (const [cls, names] of Object.entries(CANDIDATES))
    it(`${cls}: tries ${names.join(", ")}`, async () => {
      const title = `MCP-TEST-Template ${cls}`;
      const earlier = h.ledger.live().find((e) => e.path === "/article" && e.title === title);
      let id = earlier?.id ?? null;
      let accepted = earlier ? "(made in an earlier run)" : null;
      const rejected = [];

      for (const name of id ? [] : names) {
        const res = await h.call("worldanvil_create_article", {
          title,
          world_id: world,
          template: name,
          category_id: category,
        });
        expect(h.aborted, res.text).toBe(false);
        if (res.isError) {
          rejected.push(name);
          note(`${cls}: "${name}" rejected: ${String(res.text).slice(0, 160)}`);
          continue;
        }
        id = String(res.data?.id ?? res.data?.entity?.id);
        accepted = name;
        break;
      }

      let readBack = null;
      if (id) {
        const res = await h.call("worldanvil_get_article", { article_id: id });
        if (!res.isError)
          readBack = {
            entityClass: res.data.entityClass ?? null,
            templateType: res.data.templateType ?? null,
            url: String(res.data.url ?? "").replace(/^.*\//, ""),
          };
      }
      results.push({ cls, accepted, rejected, readBack });
      note(`${cls}: accepted=${JSON.stringify(accepted)} read back ${JSON.stringify(readBack)}`);
    });

  it("summary", () => {
    for (const r of results)
      note(
        `SUMMARY ${r.cls.padEnd(17)} ${r.accepted ? `OK  ${r.accepted}` : "NONE ACCEPTED"}` +
          `${r.rejected.length ? `  (rejected: ${r.rejected.join(", ")})` : ""}` +
          `${r.readBack ? `  -> ${r.readBack.entityClass}` : ""}`,
      );
    expect(h.aborted).toBe(false);
  });
});
