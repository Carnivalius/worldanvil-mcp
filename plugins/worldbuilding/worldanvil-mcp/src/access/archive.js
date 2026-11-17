/**
 * The archive: where a note goes once it has been acted on.
 *
 * Lore notes pile up in a writing project ("update this article with X").
 * When a note has been put into World Anvil it should leave the project,
 * without being lost: a copy is saved here, beside the world's backups,
 * and one line is added to a running log saying what was done with it and
 * which articles it went into. "Where did that note go?" then always has
 * an answer.
 *
 *   <backups>/archive/<World>-<id8>/files/<date>_<name>_<id8>.<ext>
 *   <backups>/archive/<World>-<id8>/log.jsonl      one JSON object a line
 *
 * Everything here is local files; nothing is sent to World Anvil except
 * the read of the world that checks the user's access settings. Archived
 * files are never changed or deleted by a tool. Every file name and every
 * log line carries a unique id, so two archives of the same world (say
 * from two computers) can be merged by taking everything from both and
 * dropping exact duplicates: see mergeArchives.
 */

import { createHash, randomUUID } from "crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import { safeName } from "./backup.js";

/** The largest note the archive takes, in characters. */
export const ARCHIVE_MAX_CHARS = 1_000_000;

const lower = (id) => String(id ?? "").toLowerCase();
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function archiveRoot(client) {
  const dir = client.backups?.dir;
  if (!dir) throw new Error("backups aren't configured (no backup folder), so there is nowhere to keep an archive");
  return join(dir, "archive");
}

/** This world's archive folder, found by its id (the world may have been renamed). */
function worldArchive(root, worldId, worldTitle, { create = false } = {}) {
  const tail = `-${lower(worldId).slice(0, 8)}`;
  if (existsSync(root)) {
    const found = readdirSync(root).find((n) => lower(n).endsWith(tail) && statSync(join(root, n)).isDirectory());
    if (found) return join(root, found);
  }
  const dir = join(root, `${safeName(worldTitle, "world")}${tail}`);
  if (create) mkdirSync(join(dir, "files"), { recursive: true });
  return dir;
}

/** Every line of a log that is a readable entry, in file order. */
export function readLog(dir) {
  const file = join(dir, "log.jsonl");
  if (!existsSync(file)) return [];
  const entries = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry.id === "string") entries.push(entry);
    } catch {
      // A damaged line is skipped, never repaired or removed.
    }
  }
  return entries;
}

const asList = (value) =>
  (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .map((v) => String(v).trim())
    .filter(Boolean);

/**
 * Save a copy of a note and add its line to the log.
 *
 * @param {object} client - guarded WorldAnvilClient
 * @param {object} args
 * @param {string} args.world_id
 * @param {string} args.file_name - the note's name in the project
 * @param {string} args.content - the note's full text
 * @param {string} args.what_was_done - one line: what became of it
 * @param {string[]} [args.articles] - titles of the articles it went into
 * @param {string} [args.source] - where the note was (a project's name, say)
 * @param {object} [opts] - { now, newId } for tests
 */
export async function archiveFile(client, args, { now = () => new Date(), newId = randomUUID } = {}) {
  const root = archiveRoot(client);
  const name = String(args.file_name ?? "").trim();
  const content = args.content;
  const what = String(args.what_was_done ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("file_name is needed: the note's name in the project.");
  if (typeof content !== "string" || content.trim() === "")
    throw new Error("content is needed: the full text of the note. An empty note is not archived.");
  if (content.length > ARCHIVE_MAX_CHARS)
    throw new Error(`This note is ${content.length} characters; the archive takes up to ${ARCHIVE_MAX_CHARS}. Nothing was saved.`);
  if (!what) throw new Error("what_was_done is needed: one line saying what became of this note.");

  const world = await client.getWorld(args.world_id); // the access check
  const worldId = lower(world?.id ?? args.world_id);
  const dir = worldArchive(root, worldId, world?.title, { create: true });
  mkdirSync(join(dir, "files"), { recursive: true });

  const hash = sha256(content);
  const already = readLog(dir).find((e) => e.sha256 === hash && e.original_name === name);
  if (already)
    return {
      archived: false,
      already_archived: { id: already.id, date: already.date, file: already.file, what_was_done: already.what_was_done },
      note: "This exact note, under this name, is already in the archive. Nothing was saved again. It is safe to remove from the project.",
    };

  const id = newId();
  const date = now().toISOString();
  const ext = (extname(name).match(/^\.[A-Za-z0-9]{1,8}$/) ?? [".md"])[0].toLowerCase();
  const stem = safeName(basename(name, extname(name)), "note").replace(/ /g, "-");
  const file = `${date.slice(0, 10)}_${stem}_${id.slice(0, 8)}${ext}`;
  writeFileSync(join(dir, "files", file), content, { encoding: "utf8", flag: "wx" });

  const entry = {
    id,
    date,
    world_id: worldId,
    world: world?.title ?? "",
    file,
    original_name: name,
    ...(args.source ? { source: String(args.source).trim() } : {}),
    what_was_done: what,
    articles: asList(args.articles),
    characters: content.length,
    sha256: hash,
  };
  appendFileSync(join(dir, "log.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");

  // Read back: the copy must be the note, exactly.
  const saved = readFileSync(join(dir, "files", file), "utf8");
  if (saved !== content)
    throw new Error(`The archived copy of "${name}" does not match the note. Do NOT remove the note from the project. Look in ${dir}.`);

  return {
    archived: true,
    id,
    file,
    folder: join(dir, "files"),
    log_entries: readLog(dir).length,
    note:
      "A copy is saved and logged, and was read back to check it matches. The note can now be removed from the project " +
      "(remove it yourself if this session can change project files; otherwise list it for the user to remove).",
  };
}

/**
 * The log of what has been archived for a world, newest first, optionally
 * only the entries that mention some text (in the name, what was done, the
 * articles or the source). With `id`, also the text of that one note.
 */
export async function listArchive(client, { world_id, text, id, limit }) {
  const root = archiveRoot(client);
  const world = await client.getWorld(world_id); // the access check
  const worldId = lower(world?.id ?? world_id);
  const dir = worldArchive(root, worldId, world?.title);
  const all = readLog(dir).filter((e) => !e.world_id || lower(e.world_id) === worldId);
  const show = ({ sha256: _hash, world_id: _world, ...rest }) => rest;

  if (id !== undefined && id !== null && id !== "") {
    const entry = all.find((e) => e.id === id || e.id.startsWith(String(id)));
    if (!entry) throw new Error(`No archived note with id "${id}" for this world.`);
    const file = join(dir, "files", basename(entry.file));
    return {
      world: world?.title ?? "",
      entry: show(entry),
      content: existsSync(file) ? readFileSync(file, "utf8") : null,
      ...(existsSync(file) ? {} : { warning: "The log has this note but its file is missing from the archive folder." }),
    };
  }

  const needle = String(text ?? "").trim().toLowerCase();
  const max = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const matches = all
    .filter((e) =>
      needle
        ? [e.original_name, e.what_was_done, e.source, e.file, ...(e.articles ?? [])].some((v) =>
            String(v ?? "").toLowerCase().includes(needle),
          )
        : true,
    )
    .reverse();
  return {
    world: world?.title ?? "",
    archived_notes: all.length,
    ...(needle ? { matching: matches.length } : {}),
    entries: matches.slice(0, max).map(show),
    note:
      all.length === 0
        ? "Nothing has been archived for this world yet."
        : "Newest first. Call again with an entry's id to read that note's text.",
  };
}

/**
 * Bring everything from one archive folder into another (both are
 * `<backups>/archive` folders, or one world's folder inside it). Files and
 * log lines already present are left alone; nothing is ever overwritten or
 * removed. Safe to run twice.
 *
 * @returns {{ worlds: number, files_copied: number, log_lines_added: number, problems: string[] }}
 */
export function mergeArchives(fromRoot, intoRoot) {
  if (!existsSync(fromRoot)) throw new Error(`No such folder: ${fromRoot}`);
  const isWorldFolder = (d) => existsSync(join(d, "log.jsonl")) || existsSync(join(d, "files"));
  const pairs = isWorldFolder(fromRoot)
    ? [[fromRoot, intoRoot]]
    : readdirSync(fromRoot)
        .filter((n) => statSync(join(fromRoot, n)).isDirectory() && isWorldFolder(join(fromRoot, n)))
        .map((n) => {
          // The same world may be named differently on the other side: match by the id at the end.
          const tail = lower(n).slice(-9);
          const there = existsSync(intoRoot)
            ? readdirSync(intoRoot).find((m) => lower(m).endsWith(tail) && statSync(join(intoRoot, m)).isDirectory())
            : null;
          return [join(fromRoot, n), join(intoRoot, there ?? n)];
        });

  const result = { worlds: 0, files_copied: 0, log_lines_added: 0, problems: [] };
  for (const [from, into] of pairs) {
    result.worlds += 1;
    mkdirSync(join(into, "files"), { recursive: true });
    const have = new Set(readLog(into).map((e) => e.id));
    for (const entry of readLog(from)) {
      if (have.has(entry.id)) continue;
      const name = basename(String(entry.file ?? ""));
      const source = join(from, "files", name);
      const target = join(into, "files", name);
      if (!name || !existsSync(source)) {
        result.problems.push(`${entry.id}: its file "${name}" is missing in ${from}; the log line was still added.`);
      } else if (!existsSync(target)) {
        copyFileSync(source, target);
        result.files_copied += 1;
      } else if (readFileSync(source, "utf8") !== readFileSync(target, "utf8")) {
        result.problems.push(`${entry.id}: a different file named "${name}" is already there; it was left alone and the log line was not added.`);
        continue;
      }
      appendFileSync(join(into, "log.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
      have.add(entry.id);
      result.log_lines_added += 1;
    }
  }
  return result;
}
