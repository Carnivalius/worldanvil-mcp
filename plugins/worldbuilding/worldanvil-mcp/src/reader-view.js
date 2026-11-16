/**
 * World Anvil MCP Server - an article's text as a reader sees it
 *
 * Article text is stored as BBCode, and the same page can be stored in
 * more than one way: the form World Anvil's editor writes today
 * ([p]…[/p], [h2|id], dash lists) and the older form this tool once wrote
 * ([li] items, headings without ids, bare line breaks, [url=…]).
 *
 * To tell whether two texts SAY the same thing, both are reduced here to a
 * list of blocks (headings, paragraphs, list items, tasks, quotes, table
 * rows…). Two texts with the same blocks read the same on the page,
 * however they are stored. The same blocks can be written back out in the
 * editor's form, which is how an older article is brought up to date
 * without touching its wording.
 *
 * Bold, italic and other marks inside a line are kept: changing emphasis is
 * a change a reader sees. Anything not understood stays in the text as it
 * is, so it can only ever show up as a difference, never be hidden.
 */

import { anchorId } from "./utils.js";

const BLOCK_TOKEN =
  /\[(\/?)(p|ul|ol|li|h[1-6]?|hr|quote|table|tr|th|td|br|articletoc|code)((?:[|:=][^\]\n]*)?)\]/gi;

const TASK_LINE = /^\[( ?|x|X)\]\s+(.*)$/;
const DASH_ITEM = /^(-{1,6})\s+(.*)$/;

/**
 * Block containers this file does not take apart. A line that opens with
 * one stands on its own in the editor's form, outside any paragraph.
 */
const RAW_BLOCKS = new Set([
  "aloud", "spoiler", "container", "subcontainer", "section", "row", "col",
  "center", "right", "left", "justify", "in", "img", "map", "block",
  "articleblock", "toc", "book", "noparse",
]);
function opensRawBlock(line) {
  const m = /^\[([a-z]+)\d*(?=[\]|:=\s])/i.exec(line);
  return m !== null && RAW_BLOCKS.has(m[1].toLowerCase());
}

/** The site's editor nests a list five levels below the top one. */
const DEEPEST = 5;

/** One line of text as compared: old and new link forms alike, spacing evened out. */
function canon(text) {
  return String(text ?? "")
    .replace(/\[url=([^\]]*)\]/gi, "[url:$1]")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Take an article text apart into blocks.
 *
 * @returns {{ blocks: object[], old: boolean, html: boolean }}
 *   blocks  { kind: "h", level, text, id } | { kind: "p", lines } |
 *           { kind: "item", list: "UL"|"OL", depth, text } |
 *           { kind: "task", done, text } | { kind: "quote", text, author } |
 *           { kind: "row", head, cells } | { kind: "code", text } |
 *           { kind: "hr" } | { kind: "toc" }
 *   old     the text shows signs of the older stored form
 *   html    the text holds raw HTML tags
 */
export function parseBlocks(bbcode) {
  const text = String(bbcode ?? "").replace(/\r\n?/g, "\n");
  const blocks = [];
  let old = /\[url=/i.test(text);
  const html = /<\/?(p|br|strong|em|b|i|u|span|div|ul|ol|li|h[1-6]|table|tr|td|th|a|blockquote)\b[^>]*>/i.test(text);

  let para = []; // finished lines of the paragraph being read
  let line = ""; // the line being read
  let inP = false; // inside [p]…[/p]
  const lists = []; // open lists: "UL" / "OL"
  let capture = null; // while inside a heading, item, quote, cell or code

  const endLine = () => {
    const t = canon(line);
    line = "";
    if (!t) return false;
    para.push(t);
    // The editor's form keeps ordinary text inside [p]…[/p].
    if (!inP && !TASK_LINE.test(t) && !opensRawBlock(t)) old = true;
    return true;
  };
  const flushPara = () => {
    endLine();
    if (para.length === 0) return;
    let run = [];
    const flushRun = () => {
      if (run.length) blocks.push({ kind: "p", lines: run });
      run = [];
    };
    for (const l of para) {
      const task = TASK_LINE.exec(l);
      if (task) {
        flushRun();
        blocks.push({ kind: "task", done: task[1].trim() !== "", text: canon(task[2]) });
      } else if (opensRawBlock(l)) {
        // A block container stands alone, whatever lines sit next to it.
        flushRun();
        blocks.push({ kind: "p", lines: [l] });
      } else run.push(l);
    }
    flushRun();
    para = [];
  };
  const item = (depth, body) => {
    const t = canon(body);
    if (t) blocks.push({ kind: "item", list: lists.at(-1) ?? "UL", depth, text: t });
  };

  /** Text that is not a block tag, wherever it falls. */
  const takeText = (chunk) => {
    if (capture) {
      capture.text += chunk;
      return;
    }
    if (lists.length > 0) {
      // The editor's form: one item per line, dashes for depth.
      for (const raw of chunk.split("\n")) {
        const l = raw.trim();
        if (!l) continue;
        const dash = DASH_ITEM.exec(l);
        if (dash) item(lists.length - 1 + dash[1].length, dash[2]);
        else item(lists.length, l);
      }
      return;
    }
    const pieces = chunk.split("\n");
    pieces.forEach((piece, i) => {
      line += piece;
      // A newline: the line ends; an empty line ends the paragraph.
      if (i < pieces.length - 1 && !endLine()) flushPara();
    });
  };

  let table = null;
  let row = null;

  let last = 0;
  for (const m of text.matchAll(BLOCK_TOKEN)) {
    const [whole, closing, rawName, attr] = m;
    const name = rawName.toLowerCase();
    const before = text.slice(last, m.index);
    last = m.index + whole.length;

    // Inside code, everything up to [/code] is text.
    if (capture?.kind === "code" && !(closing && name === "code")) {
      capture.text += before + whole;
      continue;
    }
    if (before) takeText(before);

    if (name === "br") {
      if (capture) capture.text += " ⏎ ";
      else if (lists.length === 0) endLine();
      continue;
    }
    if (name === "p") {
      if (!capture) {
        flushPara();
        inP = !closing;
      }
      continue;
    }
    if (name === "hr") {
      if (!capture) {
        flushPara();
        blocks.push({ kind: "hr" });
      }
      continue;
    }
    if (name === "articletoc") {
      if (!capture) {
        flushPara();
        blocks.push({ kind: "toc" });
      }
      continue;
    }
    if (name === "ul" || name === "ol") {
      if (!closing) {
        if (capture?.kind === "li") {
          // An older nested list: the item so far is complete.
          item(lists.length, capture.text);
          capture = { kind: "li", text: "", spent: true };
        } else flushPara();
        lists.push(name.toUpperCase());
      } else lists.pop();
      continue;
    }
    if (name === "li") {
      old = true;
      if (!closing) capture = { kind: "li", text: "" };
      else if (capture?.kind === "li") {
        if (!capture.spent || canon(capture.text)) item(Math.max(lists.length, 1), capture.text);
        capture = null;
      }
      continue;
    }
    if (/^h[1-6]?$/.test(name)) {
      if (!closing) {
        flushPara();
        const id = attr && attr[0] === "|" ? attr.slice(1).trim() : "";
        if (!id) old = true;
        capture = { kind: "h", level: name.slice(1), id: id || null, text: "" };
      } else if (capture?.kind === "h") {
        const t = canon(capture.text.replace(/ ⏎ /g, " "));
        if (t) blocks.push({ kind: "h", level: capture.level, id: capture.id, text: t });
        capture = null;
      }
      continue;
    }
    if (name === "quote") {
      if (!closing) {
        flushPara();
        capture = { kind: "quote", text: "" };
      } else if (capture?.kind === "quote") {
        const bar = capture.text.lastIndexOf("|");
        blocks.push({
          kind: "quote",
          text: (bar === -1 ? capture.text : capture.text.slice(0, bar)).trim(),
          author: bar === -1 ? "" : canon(capture.text.slice(bar + 1)),
        });
        capture = null;
      }
      continue;
    }
    if (name === "code") {
      if (!closing) {
        flushPara();
        capture = { kind: "code", text: "" };
      } else if (capture?.kind === "code") {
        blocks.push({ kind: "code", text: capture.text });
        capture = null;
      }
      continue;
    }
    if (name === "table") {
      if (!closing) {
        flushPara();
        table = { rows: [] };
      } else if (table) {
        for (const r of table.rows) blocks.push({ kind: "row", head: r.head, cells: r.cells });
        table = null;
        row = null;
      }
      continue;
    }
    if (name === "tr") {
      if (!closing) row = { head: false, cells: [] };
      else if (row && table) {
        table.rows.push(row);
        row = null;
      }
      continue;
    }
    if (name === "th" || name === "td") {
      if (!closing) capture = { kind: "cell", head: name === "th", text: "" };
      else if (capture?.kind === "cell") {
        if (row) {
          row.cells.push(canon(capture.text));
          if (capture.head) row.head = true;
        }
        capture = null;
      }
      continue;
    }
  }
  const rest = text.slice(last);
  if (rest) takeText(rest);
  // Anything left open is still text a reader would see.
  if (capture && canon(capture.text)) blocks.push({ kind: "p", lines: [canon(capture.text)] });
  flushPara();
  return { blocks, old, html };
}

/** One block as a single line of plain description. */
function describe(b) {
  switch (b.kind) {
    case "h":
      return `H${b.level}: ${b.text}`;
    case "p":
      return `P: ${b.lines.join(" ⏎ ")}`;
    case "item":
      return `${b.list}${b.depth}: ${b.text}`;
    case "task":
      return `TASK[${b.done ? "x" : " "}]: ${b.text}`;
    case "quote":
      return `QUOTE: ${canon(b.text)}${b.author ? ` — ${b.author}` : ""}`;
    case "row":
      return `${b.head ? "HEAD" : "ROW"}: ${b.cells.join(" | ")}`;
    case "code":
      return `CODE: ${b.text.trim()}`;
    case "hr":
      return "HR";
    case "toc":
      return "TOC";
    default:
      return `?: ${JSON.stringify(b)}`;
  }
}

/**
 * The blocks of an article text, in order, one string each.
 *
 *   "H2: Overview"            heading (H = the editor's "Title" style)
 *   "P: first line ⏎ second"  paragraph; ⏎ marks a line break inside it
 *   "UL1: item" / "OL2: item" list item with its depth
 *   "TASK[ ]: …" "TASK[x]: …" checklist line
 *   "QUOTE: text — author"    quote
 *   "ROW: a | b" "HEAD: a | b" table rows
 *   "HR" "TOC" "CODE: …"
 */
export function readerBlocks(bbcode) {
  return parseBlocks(bbcode).blocks.map(describe);
}

/**
 * Write blocks out in the form World Anvil's editor stores.
 *
 * Headings keep the anchor id they have; one without gets an id worked out
 * from the seed and its text, as new lore does.
 *
 * @param {object[]} blocks - from parseBlocks
 * @param {object} [options]
 * @param {string} [options.anchorSeed=""]
 * @param {boolean} [options.paragraphs=true] - false leaves a paragraph bare
 *   (a one-line author note)
 */
function writeBlocks(blocks, { anchorSeed = "", paragraphs = true } = {}) {
  const out = [];
  const headingsSeen = new Map();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === "h") {
      const key = `${b.level}\u0000${b.text}`;
      const nth = (headingsSeen.get(key) ?? 0) + 1;
      headingsSeen.set(key, nth);
      const id = b.id ?? anchorId(anchorSeed, b.level, b.text, nth);
      out.push(`[h${b.level}|${id}]${b.text}[/h${b.level}]`);
    } else if (b.kind === "p") {
      if (b.lines.every(opensRawBlock)) out.push(b.lines.join("\n"));
      else out.push(paragraphs ? `[p]${b.lines.join("[br]")}[/p]` : b.lines.join("[br]"));
    } else if (b.kind === "item") {
      // A run of items is one or more lists; each list is one kind, set by
      // its top-level items, and an item is at most one level deeper than
      // the one before it.
      const run = [];
      for (; i < blocks.length && blocks[i].kind === "item"; i++) run.push(blocks[i]);
      i--;
      const lowest = Math.min(...run.map((r) => r.depth));
      let previous = -1;
      let kind = null;
      for (const r of run) {
        const depth = Math.min(r.depth - lowest, previous + 1, DEEPEST);
        previous = depth;
        if (depth === 0 && r.list !== kind) {
          if (kind !== null) out.push(`[/${kind.toLowerCase()}]`);
          kind = r.list;
          out.push(`[${kind.toLowerCase()}]`);
        }
        out.push(`${"-".repeat(depth + 1)} ${r.text}`);
      }
      out.push(`[/${kind.toLowerCase()}]`);
    } else if (b.kind === "task") {
      out.push(`[${b.done ? "x" : ""}] ${b.text}[br]`);
    } else if (b.kind === "quote") {
      out.push(`[quote]${b.text}${b.author ? `|${b.author}` : ""}[/quote]`);
    } else if (b.kind === "row") {
      const rows = [];
      for (; i < blocks.length && blocks[i].kind === "row"; i++) rows.push(blocks[i]);
      i--;
      out.push(
        "[table]" +
          rows
            .map((r) => {
              const cell = r.head ? "th" : "td";
              return `[tr]${r.cells.map((c) => `[${cell}]${c}[/${cell}]`).join("")}[/tr]`;
            })
            .join("") +
          "[/table]",
      );
    } else if (b.kind === "code") {
      out.push(`[code]${b.text}[/code]`);
    } else if (b.kind === "hr") {
      out.push("[hr]");
    } else if (b.kind === "toc") {
      out.push("[articletoc]");
    }
  }
  return out.join("\n");
}

/**
 * Bring a stored article text up to the form World Anvil's editor writes
 * today, without changing a word of it.
 *
 * @param {string} stored - the BBCode World Anvil holds
 * @param {object} [options]
 * @param {string} [options.anchorSeed=""] - for the ids of headings that have none
 * @param {true|"auto"} [options.paragraphs=true] - "auto" leaves a single
 *   one-line paragraph bare, as a short author note is stored
 * @returns {{ status: string, text?: string, why?: string, differences?: object }}
 *   "current"      already in the editor's form: leave it alone
 *   "reformatted"  `text` is the same page in the editor's form
 *   "refused"      it could not be done without a reader seeing a
 *                  difference (`why`, and `differences` where that helps)
 */
export function toEditorForm(stored, { anchorSeed = "", paragraphs = true } = {}) {
  const text = String(stored ?? "");
  if (!text.trim()) return { status: "current" };
  const { blocks, old, html } = parseBlocks(text);
  if (!old) return { status: "current" };
  if (html)
    return {
      status: "refused",
      why: "The text holds raw HTML tags, which this tool does not rewrite. It was left as it is.",
    };
  const oneLine = blocks.length === 1 && blocks[0].kind === "p" && blocks[0].lines.length === 1;
  const fresh = writeBlocks(blocks, { anchorSeed, paragraphs: paragraphs === true || !oneLine });
  if (fresh === text) return { status: "current" };
  const check = compareAsRead(text, fresh);
  if (check.status === "changed")
    return {
      status: "refused",
      why: "Rewriting it in the editor's form would change what a reader sees, so it was left as it is.",
      differences: { reworded: check.reworded, removed: check.removed, added: check.added },
    };
  // Written once more, it must not change again.
  const again = parseBlocks(fresh);
  if (again.old && writeBlocks(again.blocks, { anchorSeed, paragraphs: paragraphs === true || !oneLine }) !== fresh)
    return { status: "refused", why: "The rewritten text did not settle into one form. It was left as it is." };
  return { status: "reformatted", text: fresh };
}

const EXCERPT = 160;
const short = (block) => (block.length > EXCERPT ? `${block.slice(0, EXCERPT)}…` : block);

/**
 * Compare two article texts as a reader sees them.
 *
 * @param {string} stored - the BBCode World Anvil holds now
 * @param {string} wanted - the BBCode that would be sent
 * @returns {{ status: "same"|"format_only"|"changed", ... }}
 *   same         stored exactly as it would be sent
 *   format_only  reads the same, stored differently
 *   changed      a reader would see a difference: `removed`, `added` and
 *                `reworded` list the blocks (reworded = one block replaced
 *                by one other in the same place)
 */
export function compareAsRead(stored, wanted) {
  const a = String(stored ?? "");
  const b = String(wanted ?? "");
  if (a === b) return { status: "same" };
  const A = readerBlocks(a);
  const B = readerBlocks(b);

  // Longest common run of blocks, kept in order.
  const n = A.length;
  const m = B.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const removed = [];
  const added = [];
  const reworded = [];
  let goneRun = [];
  let newRun = [];
  const settle = () => {
    // Blocks dropped and blocks added in the same place: pair them off.
    const pairs = Math.min(goneRun.length, newRun.length);
    for (let k = 0; k < pairs; k++) reworded.push({ was: short(goneRun[k]), now: short(newRun[k]) });
    for (const g of goneRun.slice(pairs)) removed.push(short(g));
    for (const x of newRun.slice(pairs)) added.push(short(x));
    goneRun = [];
    newRun = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      settle();
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) newRun.push(B[j++]);
    else goneRun.push(A[i++]);
  }
  settle();

  if (removed.length + added.length + reworded.length === 0) return { status: "format_only" };
  return {
    status: "changed",
    blocks: { stored: n, wanted: m },
    reworded,
    removed,
    added,
  };
}
