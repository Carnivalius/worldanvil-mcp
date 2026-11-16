/**
 * Unit tests for utility functions
 *
 * The expected BBCode is what World Anvil's own editor stores, read back
 * from a site-made article on 2026-11-14 (see the API guide).
 */

import { describe, it, expect } from "vitest";
import { markdownToBBCode, convertFieldsToBBCode } from "../src/utils.js";

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
/** A heading as the site writes it: [h2|<anchor id>]Text[/h2]. */
const heading = (level, text) => new RegExp(`^\\[h${level}\\|${ID}\\]${text}\\[/h${level}\\]$`);
const body = (text) => markdownToBBCode(text, { paragraphs: true });

describe("markdownToBBCode", () => {
  describe("basic formatting", () => {
    it("should handle null and undefined", () => {
      expect(markdownToBBCode(null)).toBe(null);
      expect(markdownToBBCode(undefined)).toBe(undefined);
    });

    it("should handle empty string", () => {
      expect(markdownToBBCode("")).toBe("");
    });

    it("should pass through plain one-line text unchanged", () => {
      expect(markdownToBBCode("Hello world")).toBe("Hello world");
    });
  });

  describe("paragraphs", () => {
    it("wraps every paragraph of a main text in [p], one per line", () => {
      expect(body("First paragraph.\n\nSecond paragraph.")).toBe("[p]First paragraph.[/p]\n[p]Second paragraph.[/p]");
    });

    it("wraps even a one-line main text", () => {
      expect(body("Hello world")).toBe("[p]Hello world[/p]");
    });

    it("turns a line break inside a paragraph into [br]", () => {
      expect(body("Line one\nLine two")).toBe("[p]Line one[br]Line two[/p]");
    });

    it("writes no empty paragraphs for runs of blank lines", () => {
      expect(body("One\n\n\n\nTwo\n\n")).toBe("[p]One[/p]\n[p]Two[/p]");
    });

    it("by default wraps only when the text has more than one line", () => {
      expect(markdownToBBCode("A **short** value")).toBe("A [b]short[/b] value");
      expect(markdownToBBCode("One\n\nTwo")).toBe("[p]One[/p]\n[p]Two[/p]");
    });

    it("handles Windows line endings", () => {
      expect(body("One\r\n\r\nTwo")).toBe("[p]One[/p]\n[p]Two[/p]");
    });
  });

  describe("headers", () => {
    it("writes each level with an anchor id, as the site does", () => {
      expect(markdownToBBCode("# Header 1")).toMatch(heading(1, "Header 1"));
      expect(markdownToBBCode("## Header 2")).toMatch(heading(2, "Header 2"));
      expect(markdownToBBCode("### Header 3")).toMatch(heading(3, "Header 3"));
      expect(markdownToBBCode("#### Header 4")).toMatch(heading(4, "Header 4"));
      expect(markdownToBBCode("##### Header 5")).toMatch(heading(5, "Header 5"));
    });

    it("has no sixth level: ###### becomes Heading 5", () => {
      expect(markdownToBBCode("###### Deep")).toMatch(heading(5, "Deep"));
    });

    it("does not wrap a heading in a paragraph", () => {
      const lines = body("# Title\n## Section\nText").split("\n");
      expect(lines[0]).toMatch(heading(1, "Title"));
      expect(lines[1]).toMatch(heading(2, "Section"));
      expect(lines[2]).toBe("[p]Text[/p]");
    });

    it("gives the same text the same anchor every time, and repeats different ones", () => {
      const once = markdownToBBCode("## Overview\n\n## Overview");
      expect(markdownToBBCode("## Overview\n\n## Overview")).toBe(once);
      const [first, second] = once.split("\n");
      expect(first).toMatch(heading(2, "Overview"));
      expect(second).toMatch(heading(2, "Overview"));
      expect(first).not.toBe(second);
    });

    it("mixes the seed into the anchor, so two articles differ", () => {
      const a = markdownToBBCode("## Overview", { anchorSeed: "Article A" });
      const b = markdownToBBCode("## Overview", { anchorSeed: "Article B" });
      expect(a).not.toBe(b);
    });
  });

  describe("text formatting", () => {
    it("should convert bold with **", () => {
      expect(markdownToBBCode("**bold text**")).toBe("[b]bold text[/b]");
    });

    it("should convert bold with __", () => {
      expect(markdownToBBCode("__bold text__")).toBe("[b]bold text[/b]");
    });

    it("should convert italic with *", () => {
      expect(markdownToBBCode("*italic text*")).toBe("[i]italic text[/i]");
    });

    it("should convert italic with _", () => {
      expect(markdownToBBCode("_italic text_")).toBe("[i]italic text[/i]");
    });

    it("should convert strikethrough", () => {
      expect(markdownToBBCode("~~strikethrough~~")).toBe("[s]strikethrough[/s]");
    });

    it("should handle bold then italic separately", () => {
      expect(markdownToBBCode("**bold** and *italic*")).toBe("[b]bold[/b] and [i]italic[/i]");
    });

    it("leaves underscores inside words alone", () => {
      expect(markdownToBBCode("a snake_case_name here")).toBe("a snake_case_name here");
    });
  });

  describe("code", () => {
    it("should convert inline code, leaving what is inside alone", () => {
      expect(markdownToBBCode("Use `**code**` here")).toBe("Use [code]**code**[/code] here");
    });

    it("should convert code blocks without touching their contents", () => {
      expect(markdownToBBCode("```\nconst x = 1;\n# not a heading\n```")).toBe("[code]const x = 1;\n# not a heading[/code]");
    });

    it("should drop the language hint", () => {
      expect(markdownToBBCode("```javascript\nconst x = 1;\n```")).toBe("[code]const x = 1;[/code]");
    });
  });

  describe("links", () => {
    it("writes a web link with a colon, as the site does", () => {
      expect(markdownToBBCode("[text](https://example.com)")).toBe("[url:https://example.com]text[/url]");
    });

    it("should convert multiple links", () => {
      expect(markdownToBBCode("[link1](http://a.com) and [link2](http://b.com)")).toBe(
        "[url:http://a.com]link1[/url] and [url:http://b.com]link2[/url]",
      );
    });

    it("leaves underscores in an address alone", () => {
      expect(markdownToBBCode("[page](https://example.com/_a_/b_c_d)")).toBe("[url:https://example.com/_a_/b_c_d]page[/url]");
    });

    it("should preserve WA article mention syntax @[Name](Article:uuid)", () => {
      const input = "See @[Skill Progression](Article:f62fb09f-8477-4b56-9f00-169d78adf2d5) for details.";
      expect(markdownToBBCode(input)).toBe(input);
    });

    it("should preserve mentions while converting regular links", () => {
      expect(
        markdownToBBCode("See @[Mokravar](Article:3948b7db-cc4f-49da-a501-8fd387661289) and [external](https://example.com)."),
      ).toBe("See @[Mokravar](Article:3948b7db-cc4f-49da-a501-8fd387661289) and [url:https://example.com]external[/url].");
    });
  });

  describe("horizontal rules", () => {
    it("should convert ---, *** and ___ to hr", () => {
      expect(markdownToBBCode("---")).toBe("[hr]");
      expect(markdownToBBCode("***")).toBe("[hr]");
      expect(markdownToBBCode("___")).toBe("[hr]");
    });

    it("stands outside paragraphs", () => {
      expect(body("Above\n\n---\n\nBelow")).toBe("[p]Above[/p]\n[hr]\n[p]Below[/p]");
    });
  });

  describe("blockquotes", () => {
    it("should convert blockquotes", () => {
      expect(markdownToBBCode("> This is a quote")).toBe("[quote]This is a quote[/quote]");
    });

    it("should merge adjacent blockquote lines", () => {
      expect(markdownToBBCode("> Line 1\n> Line 2")).toBe("[quote]Line 1\nLine 2[/quote]");
    });

    it("puts who said it after a | when the last line starts with a dash", () => {
      expect(markdownToBBCode("> This is a quote\n> — Author of Quote")).toBe("[quote]This is a quote|Author of Quote[/quote]");
      expect(markdownToBBCode("> Said thing\n>\n> -- Someone")).toBe("[quote]Said thing|Someone[/quote]");
    });
  });

  describe("lists", () => {
    it("writes a bulleted list as dash lines inside [ul]", () => {
      expect(markdownToBBCode("- Item 1\n- Item 2\n- Item 3")).toBe("[ul]\n- Item 1\n- Item 2\n- Item 3\n[/ul]");
    });

    it("accepts * and + as bullets", () => {
      expect(markdownToBBCode("* One\n+ Two")).toBe("[ul]\n- One\n- Two\n[/ul]");
    });

    it("writes a numbered list as dash lines inside [ol]", () => {
      expect(markdownToBBCode("1. First\n2. Second\n3. Third")).toBe("[ol]\n- First\n- Second\n- Third\n[/ol]");
    });

    it("converts formatting inside items", () => {
      expect(markdownToBBCode("- **Bold** item\n- *Italic* item")).toBe("[ul]\n- [b]Bold[/b] item\n- [i]Italic[/i] item\n[/ul]");
    });

    it("should handle list followed by text", () => {
      expect(markdownToBBCode("- Item 1\n- Item 2\nSome text after")).toBe("[ul]\n- Item 1\n- Item 2\n[/ul]\n[p]Some text after[/p]");
    });

    it("starts a new list when the kind changes", () => {
      expect(markdownToBBCode("- a\n1. b")).toBe("[ul]\n- a\n[/ul]\n[ol]\n- b\n[/ol]");
    });

    it("nests by adding a dash per level, as the site does", () => {
      expect(markdownToBBCode("- one\n  - inner a\n  - inner b\n    - deeper\n- two")).toBe(
        "[ul]\n- one\n-- inner a\n-- inner b\n--- deeper\n- two\n[/ul]",
      );
      expect(markdownToBBCode("1. one\n   1. inner\n2. two")).toBe("[ol]\n- one\n-- inner\n- two\n[/ol]");
    });

    it("goes no deeper than five levels below the top", () => {
      const md = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => `${"  ".repeat(d)}- level ${d}`).join("\n");
      expect(markdownToBBCode(md).split("\n").slice(1, -1)).toEqual([
        "- level 0", "-- level 1", "--- level 2", "---- level 3", "----- level 4", "------ level 5", "------ level 6", "------ level 7",
      ]);
    });

    it("a nested level takes the kind of the list it is in", () => {
      expect(markdownToBBCode("- bullets\n  1. numbered inside\n- more")).toBe("[ul]\n- bullets\n-- numbered inside\n- more\n[/ul]");
    });

    it("never jumps more than one level at a time", () => {
      expect(markdownToBBCode("- one\n      - far in")).toBe("[ul]\n- one\n-- far in\n[/ul]");
    });
  });

  describe("checklists", () => {
    it("writes tasks as the site's checklist lines", () => {
      expect(markdownToBBCode("- [ ] To do\n- [x] Done\n- [X] Also done")).toBe("[] To do[br]\n[x] Done[br]\n[x] Also done[br]");
    });

    it("keeps a checklist apart from the list around it", () => {
      expect(markdownToBBCode("- plain\n- [ ] task\n- plain again")).toBe(
        "[ul]\n- plain\n[/ul]\n[] task[br]\n[ul]\n- plain again\n[/ul]",
      );
    });

    it("flattens a nested task: the site can't nest them", () => {
      expect(markdownToBBCode("- [ ] outer\n  - [x] inner")).toBe("[] outer[br]\n[x] inner[br]");
    });
  });

  describe("tables", () => {
    it("writes a table on one line, first row as headers", () => {
      expect(markdownToBBCode("| Header 1 | Header 2 |\n|---|---|\n| Cell 1 | Cell 2 |")).toBe(
        "[table][tr][th]Header 1[/th][th]Header 2[/th][/tr][tr][td]Cell 1[/td][td]Cell 2[/td][/tr][/table]",
      );
    });
  });

  describe("BBCode already in the text", () => {
    it("leaves block BBCode exactly as written", () => {
      const site = [
        "[p]A paragraph[/p]",
        "[ul]",
        "- This is a bullet list",
        "- Second item",
        "[/ul]",
        "[h|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa]Title of something important[/h]",
        "[h2|bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb]A second heading[/h2]",
        "[quote]This is a quote|Author of Quote[/quote]",
        "[hr]",
        "[table][tr][th]Heading[/th][/tr][tr][td]Item[/td][/tr][/table]",
        "[p][url:https://www.wikipedia.org/]Wikipedia[/url][/p]",
      ].join("\n");
      expect(body(site)).toBe(site);
    });

    it("leaves the old tool's format as written too", () => {
      const old = "[h2]Overview[/h2]\n[ul]\n[li]One[/li]\n[li]Two[/li]\n[/ul]";
      expect(body(old)).toBe(old);
    });

    it("leaves the site's nested lists and checklists as written", () => {
      const site = [
        "[ul]",
        "- This is a bullet list",
        "-- Nested bullet 1",
        "--- Nested bullet 2",
        "------ Nested Bullet 5",
        "- Second item",
        "[/ul]",
        "[] CHecklist[br]",
        "[x] asd[br]",
        "[] Can't be nested[br]",
      ].join("\n");
      expect(body(site)).toBe(site);
    });

    it("leaves the site's table of contents tag on its own line", () => {
      expect(body("Intro text.\n[articletoc]\n## First")).toMatch(/^\[p\]Intro text\.\[\/p\]\n\[articletoc\]\n\[h2\|/);
    });

    it("keeps a block inside the same kind of block together", () => {
      const nested = "[container]\nouter\n[container]\ninner\n[/container]\nstill outer\n[/container]";
      expect(body(nested)).toBe(nested);
    });

    it("converting its own output changes nothing", () => {
      const once = body("# Title\n\nText with **bold**.\nSecond line.\n\n- a\n  - b\n- c\n\n- [ ] task\n- [x] done\n\n> Quote\n> — Me\n\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |");
      expect(body(once)).toBe(once);
    });

    it("still wraps a line that only starts with inline BBCode", () => {
      expect(body("[b]Bold[/b] start of a sentence.")).toBe("[p][b]Bold[/b] start of a sentence.[/p]");
    });
  });

  describe("complex documents", () => {
    it("should handle mixed content", () => {
      const input = `# Welcome

This is **bold** and *italic* text.

## List
- Item one
- Item two

Some \`inline code\` here.`;

      const lines = body(input).split("\n");
      expect(lines[0]).toMatch(heading(1, "Welcome"));
      expect(lines[1]).toBe("[p]This is [b]bold[/b] and [i]italic[/i] text.[/p]");
      expect(lines[2]).toMatch(heading(2, "List"));
      expect(lines.slice(3)).toEqual(["[ul]", "- Item one", "- Item two", "[/ul]", "[p]Some [code]inline code[/code] here.[/p]"]);
    });
  });
});

describe("convertFieldsToBBCode", () => {
  it("should handle null and undefined", () => {
    expect(convertFieldsToBBCode(null)).toBe(null);
    expect(convertFieldsToBBCode(undefined)).toBe(undefined);
  });

  it("should convert string fields, leaving a one-line value bare", () => {
    const result = convertFieldsToBBCode({ alternativename: "The Pearl", description: "**Bold text**" });
    expect(result.alternativename).toBe("The Pearl");
    expect(result.description).toBe("[b]Bold text[/b]");
  });

  it("should preserve non-string fields", () => {
    const input = {
      count: 42,
      active: true,
      items: ["a", "b"],
    };
    const result = convertFieldsToBBCode(input);

    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.items).toEqual(["a", "b"]);
  });

  it("should not modify the original object", () => {
    const input = { text: "**bold**" };
    const result = convertFieldsToBBCode(input);

    expect(input.text).toBe("**bold**");
    expect(result.text).toBe("[b]bold[/b]");
  });
});
