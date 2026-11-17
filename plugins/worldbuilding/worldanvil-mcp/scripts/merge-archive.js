#!/usr/bin/env node
/**
 * Merge one archive of acted-on notes into another.
 *
 *   npm run archive:merge -- <from folder> <into folder>
 *
 * Both are `archive` folders as kept beside the backups (or one world's
 * folder inside one). Everything in <from> that <into> does not have yet
 * is copied across: the note files and their log lines. Nothing in either
 * folder is changed or removed, and it is safe to run twice.
 *
 * Reads and writes local files only. It never contacts World Anvil and
 * needs no keys.
 */

import { resolve } from "path";
import { mergeArchives } from "../src/access/archive.js";

const [from, into] = process.argv.slice(2);
if (!from || !into) {
  console.error("Usage: npm run archive:merge -- <from folder> <into folder>");
  process.exit(2);
}

try {
  const result = mergeArchives(resolve(from), resolve(into));
  console.log(
    `Merged ${result.worlds} world archive(s): ${result.files_copied} file(s) copied, ` +
      `${result.log_lines_added} log line(s) added.`,
  );
  for (const problem of result.problems) console.log(`  Problem: ${problem}`);
  process.exit(result.problems.length ? 1 : 0);
} catch (e) {
  console.error(`Could not merge: ${e.message}`);
  process.exit(1);
}
