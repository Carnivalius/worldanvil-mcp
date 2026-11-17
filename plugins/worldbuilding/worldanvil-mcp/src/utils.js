/**
 * World Anvil MCP Server - Utility Functions
 *
 * Markdown to BBCode conversion and field processing utilities.
 *
 * The BBCode written here is what World Anvil's own article editor stores
 * (read back from a site-made article, 2026-11-14; see the API guide):
 *   paragraph      [p]...[/p], a line break inside one is [br]
 *   heading        [h1|<anchor id>]...[/h1] up to h5
 *   list           [ul] / [ol], one "- item" line per item, then the close;
 *                  a nested item has one more dash per level ("-- item")
 *   checklist      "[] text[br]" / "[x] text[br]", one line each
 *   contents list  [articletoc] on its own line (built by the site from the headings)
 *   quote          [quote]text|author[/quote]
 *   line           [hr]
 *   table          [table][tr][th]..[/th][/tr][tr][td]..[/td][/tr][/table] on one line
 *   web link       [url:address]text[/url]
 *   mention        @[Title](Article:<id>), left exactly as written
 * Not seen in the editor's output, kept from the original project:
 * strikethrough [s] and code [code].
 */

import { createHash } from "crypto";

/** BBCode tags that stand as a block of their own, never inside a paragraph. */
const BLOCK_TAGS = new Set([
  "p", "h", "ul", "ol", "li", "quote", "table", "tr", "td", "th", "hr", "br",
  "code", "aloud", "spoiler", "container", "subcontainer", "section", "row",
  "col", "center", "right", "left", "justify", "in", "img", "map", "block",
  "articleblock", "articletoc", "toc", "book", "noparse",
]);
/** Block tags with no closing tag. */
const VOID_TAGS = new Set(["hr", "br", "img", "map", "block", "articleblock", "articletoc", "toc", "book"]);

/**
 * A heading's anchor id. The site's editor writes a random uuid; this one
 * is worked out from the heading (and `seed`, e.g. the article), so the
 * same text always converts to the same BBCode and two uploads of
 * unchanged lore compare equal.
 */
export function anchorId(seed, level, text, nth) {
  const h = createHash("sha256").update([seed, level, text, nth].join("\u0000")).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Bold, italic, strikethrough, inline code and web links within one line. */
function inline(text) {
  const kept = [];
  const keep = (s) => `\u0001${kept.push(s) - 1}\u0001`;
  let r = text;
  // Set aside what must not be touched: code, mentions, link addresses.
  r = r.replace(/`([^`]+)`/g, (_, code) => keep(`[code]${code}[/code]`));
  r = r.replace(/@\[[^\]]*\]\([^)]*\)/g, (mention) => keep(mention));
  r = r.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, address) => `${keep(`[url:${address}]`)}${label}[/url]`);
  r = r.replace(/\*\*([^*]+)\*\*/g, "[b]$1[/b]");
  r = r.replace(/__([^_]+)__/g, "[b]$1[/b]");
  r = r.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "[i]$1[/i]");
  r = r.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "[i]$1[/i]");
  r = r.replace(/~~([^~]+)~~/g, "[s]$1[/s]");
  return r.replace(/\u0001(\d+)\u0001/g, (_, i) => kept[Number(i)]);
}

/** The block tag a line opens with, if any: { name, base } in lower case. */
function blockTag(line) {
  const m = /^\s*\[([a-z]+\d*)(?=[\]|:=\s])[^\]]*\]/i.exec(line);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const base = name.replace(/\d+$/, "");
  return BLOCK_TAGS.has(base) ? { name, base } : null;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|[-:\s|]+\|\s*$/;

/** The site's editor nests a list five levels below the top one. */
const DEEPEST = 5;

/**
 * Lists as the site writes them: one line per item inside [ul] or [ol],
 * with one dash for a top-level item and one more for each level it is
 * nested ("-- item", "--- item"). The whole list is one kind: an inner
 * level can't be numbered inside bullets or the reverse, so nested items
 * take the kind of the list they are in.
 */
function renderLists(items) {
  const lowest = Math.min(...items.map((i) => i.depth));
  // An item can be at most one level deeper than the one before it.
  let previous = -1;
  for (const item of items) {
    item.depth = Math.min(item.depth - lowest, previous + 1, DEEPEST);
    previous = item.depth;
  }
  const lines = [];
  let ordered = null;
  for (const item of items) {
    if (item.depth === 0 && item.ordered !== ordered) {
      if (ordered !== null) lines.push(ordered ? "[/ol]" : "[/ul]");
      ordered = item.ordered;
      lines.push(ordered ? "[ol]" : "[ul]");
    }
    lines.push(`${"-".repeat(item.depth + 1)} ${inline(item.text)}`);
  }
  lines.push(ordered ? "[/ol]" : "[/ul]");
  return lines;
}

/** A checklist line as the site stores it: "[] text[br]" or "[x] text[br]". */
const CHECK_LINE = /^\s*\[(?: ?|x|X)\]\s/;
/** A Markdown task: the text of a list item starting "[ ]" or "[x]". */
const TASK = /^\[( |x|X)\]\s+(.*)$/;

/**
 * Convert Markdown to World Anvil BBCode, in the form the site's own
 * editor stores. BBCode already in the text is left as it is.
 *
 * @param {string} text - Markdown text to convert
 * @param {object} [options]
 * @param {true|"auto"} [options.paragraphs="auto"] - true: every paragraph
 *   is wrapped in [p] (an article's main text). "auto": only when the text
 *   has more than one line, so a short one-line value stays bare.
 * @param {string} [options.anchorSeed=""] - mixed into heading anchor ids
 * @returns {string} BBCode formatted text
 */
export function markdownToBBCode(text, options = {}) {
  if (!text || typeof text !== "string") return text;
  const { paragraphs = "auto", anchorSeed = "" } = options;

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const wrap = paragraphs === true || lines.filter((l) => l.trim()).length > 1;
  const out = [];
  const headingsSeen = new Map();
  let para = [];

  const flush = () => {
    if (!para.length) return;
    const body = para.map(inline).join("[br]");
    out.push(wrap ? `[p]${body}[/p]` : body);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block: nothing inside is converted.
    if (/^\s*```/.test(line)) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      out.push(`[code]${body.join("\n")}[/code]`);
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    // A checklist line already in the site's form: untouched.
    if (CHECK_LINE.test(line)) {
      flush();
      out.push(line);
      continue;
    }

    // BBCode that is already a block: passed through untouched, to its close.
    const tag = blockTag(line);
    if (tag) {
      flush();
      const raw = [line];
      if (!VOID_TAGS.has(tag.base)) {
        // Count opens against closes, so a block inside the same kind of
        // block (a list in a list) doesn't end it early.
        const opens = new RegExp(`\\[${tag.name}(?=[\\]|:=\\s])`, "gi");
        const closes = new RegExp(`\\[/${tag.name}\\]`, "gi");
        const balance = (l) => (l.match(opens)?.length ?? 0) - (l.match(closes)?.length ?? 0);
        let open = balance(line);
        while (open > 0 && i + 1 < lines.length) {
          raw.push(lines[++i]);
          open += balance(lines[i]);
        }
      }
      out.push(raw.join("\n"));
      continue;
    }

    const heading = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length, 5);
      const title = heading[2];
      const key = `${level}\u0000${title}`;
      const nth = (headingsSeen.get(key) ?? 0) + 1;
      headingsSeen.set(key, nth);
      out.push(`[h${level}|${anchorId(anchorSeed, level, title, nth)}]${inline(title)}[/h${level}]`);
      continue;
    }

    if (RULE.test(line)) {
      flush();
      out.push("[hr]");
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flush();
      const rows = [];
      for (; i < lines.length && TABLE_ROW.test(lines[i]); i++)
        if (!TABLE_SEPARATOR.test(lines[i])) rows.push(lines[i]);
      i--;
      const cells = (row) => row.trim().slice(1, -1).split("|").map((c) => inline(c.trim()));
      out.push(
        "[table]" +
          rows
            .map((row, n) => {
              const cell = n === 0 ? "th" : "td";
              return `[tr]${cells(row).map((c) => `[${cell}]${c}[/${cell}]`).join("")}[/tr]`;
            })
            .join("") +
          "[/table]",
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      flush();
      const quoted = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quoted.push(lines[i].replace(/^\s*>\s?/, "").trim());
      i--;
      while (quoted.length && !quoted.at(-1)) quoted.pop();
      // A last line starting with a dash names who said it.
      let author = "";
      const by = quoted.length > 1 ? /^(?:—|–|--|-)\s*(.+)$/.exec(quoted.at(-1)) : null;
      if (by) {
        author = `|${inline(by[1])}`;
        quoted.pop();
        while (quoted.length && !quoted.at(-1)) quoted.pop();
      }
      out.push(`[quote]${quoted.map(inline).join("\n")}${author}[/quote]`);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flush();
      const items = [];
      for (; i < lines.length && LIST_ITEM.test(lines[i]) && !RULE.test(lines[i]); i++) {
        const [, indent, marker, body] = LIST_ITEM.exec(lines[i]);
        items.push({
          depth: Math.floor(indent.replace(/\t/g, "  ").length / 2),
          ordered: /\d/.test(marker),
          text: body.trim(),
        });
      }
      i--;
      // Tasks ("- [ ] text") become checklist lines; the site can't nest those.
      for (let n = 0; n < items.length; ) {
        const isTask = TASK.test(items[n].text);
        let end = n;
        while (end < items.length && TASK.test(items[end].text) === isTask) end++;
        const run = items.slice(n, end);
        if (isTask)
          for (const item of run) {
            const [, mark, label] = TASK.exec(item.text);
            out.push(`[${mark === " " ? "" : "x"}] ${inline(label)}[br]`);
          }
        else out.push(...renderLists(run));
        n = end;
      }
      continue;
    }

    // Ordinary text: part of the current paragraph.
    para.push(line.trim().replace(/\\$/, ""));
  }
  flush();

  return out.join("\n");
}

/**
 * Convert all text fields in an object from Markdown to BBCode
 *
 * @param {Object} data - Object with string fields to convert
 * @returns {Object} New object with converted string fields
 */
const HEADING_LINE = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

/** The text of a Markdown heading line, or null if the line is not one. */
function headingText(line) {
  const m = HEADING_LINE.exec(line);
  if (!m) return null;
  // Bold / italic marks around the whole heading make no difference.
  return m[1].replace(/^(\*{1,3}|_{1,3})(.*)\1$/, "$2").trim();
}

const comparable = (s) => String(s ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

/** True when the first non-blank line of the text is a Markdown heading. */
export function opensWithHeading(markdown) {
  const first = String(markdown ?? "").split(/\r?\n/).find((l) => l.trim() !== "");
  return first !== undefined && headingText(first) !== null;
}

/**
 * Drop an opening Markdown heading that only repeats the article's title
 * (the site already shows the title above the text). Only the very first
 * non-blank line is looked at, at any heading level; capitals and extra
 * spaces make no difference. A heading that merely contains the title, or
 * the same heading further down, is kept.
 *
 * @returns {{ text: string, dropped: string|null }} dropped = the line removed
 */
export function dropTitleHeading(markdown, title) {
  const text = String(markdown ?? "");
  const wanted = comparable(title);
  if (!wanted) return { text, dropped: null };
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return { text, dropped: null };
  const heading = headingText(lines[i]);
  if (heading === null || comparable(heading) !== wanted) return { text, dropped: null };
  const dropped = lines[i].trim();
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === "") j++;
  return { text: lines.slice(j).join("\n"), dropped };
}

/** Code, where a link marker is just text: fenced blocks, `spans`, [code]. */
const CODE_PARTS = /(```[\s\S]*?```|`[^`\n]*`|\[code\][\s\S]*?\[\/code\])/gi;
// A link marker: [[Name]] as writers type it, or {{Name}} as a waiting
// one is stored. Square brackets cannot be the stored form: World Anvil's
// editor reads [words in brackets] as a tag, shows only the last word, and
// writes that back when the page is saved there (seen live 2026-11-17).
// Curly brackets are shown and saved exactly as written.
const LINK_MARKER = /\[\[([^\[\]\n]+?)\]\]|\{\{([^{}\n]+?)\}\}/g;

/**
 * A link placeholder as it is stored on World Anvil while its article does
 * not exist yet: {{Name}}, or {{Name|words to show}}.
 */
export function placeholderText(name, shown) {
  return shown ? `{{${name}|${shown}}}` : `{{${name}}}`;
}

/** True when a name or wording can be written inside a placeholder. */
export function fitsPlaceholder(text) {
  return typeof text === "string" && text.trim() !== "" && !/[\[\]{}|\n]/.test(text);
}

/** A marker's two parts: the article's name, and its own shown text if any. */
function markerParts(inside, whole) {
  const bar = inside.indexOf("|");
  const name = (bar === -1 ? inside : inside.slice(0, bar)).trim();
  const shown = bar === -1 ? null : inside.slice(bar + 1).trim();
  if (!name || shown === "")
    throw new Error(
      `${whole} is not a complete link. Write [[Article Title]], or [[Article Title|words to show]].`,
    );
  return { name, shown };
}

function eachLinkMarker(markdown, fn) {
  return String(markdown ?? "")
    .split(CODE_PARTS)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(LINK_MARKER, (whole, square, curly) => fn(markerParts(square ?? curly, whole), whole)),
    )
    .join("");
}

/**
 * Every [[Name]] or [[Name|shown text]] link marker in Markdown lore, in
 * order: `name` is the article's title, `shown` the words to display in
 * its place (null when the title itself is shown). Markers inside code
 * are not links.
 */
export function linkMarkers(markdown) {
  const markers = [];
  eachLinkMarker(markdown, (marker, whole) => {
    markers.push(marker);
    return whole;
  });
  return markers;
}

/** The article names in the link markers, each once (capitals and spacing aside). */
export function linkMarkerNames(markdown) {
  const names = [];
  const seen = new Set();
  for (const { name } of linkMarkers(markdown)) {
    const key = comparable(name);
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/**
 * Replace each link marker with what `replacement(name, shown)` returns
 * (a mention, or plain words).
 */
export function replaceLinkMarkers(markdown, replacement) {
  return eachLinkMarker(markdown, ({ name, shown }) => replacement(name, shown));
}

export function convertFieldsToBBCode(data) {
  if (!data || typeof data !== "object") return data;

  const converted = { ...data };

  for (const [key, value] of Object.entries(converted)) {
    if (typeof value === "string") {
      converted[key] = markdownToBBCode(value);
    }
  }

  return converted;
}
