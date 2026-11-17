/**
 * The archive of acted-on notes: save a copy, log it, find it again, and
 * merge two archives. Local files only; no network.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARCHIVE_MAX_CHARS, archiveFile, listArchive, mergeArchives, readLog } from "../src/access/archive.js";
import { handleToolCall } from "../src/handlers.js";
import { getToolDefinitions } from "../src/tools.js";
import { toolAction } from "../src/tool-groups.js";
import { visibleTools } from "../src/server.js";
import { validateSettings } from "../src/access/config.js";

const WORLD = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let dirs;
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "wa-archive-"));
  dirs.push(d);
  return d;
};
beforeEach(() => (dirs = []));
afterEach(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function client(dir, { title = "Saga: Test/World", blocked = false } = {}) {
  return {
    backups: dir ? { dir } : null,
    getWorld: vi.fn(async (id) => {
      if (blocked) throw new Error("Access denied: 'Saga' is blocked in your access settings");
      return { id, title: id === WORLD ? title : "Other World" };
    }),
  };
}

let n = 0;
const fixed = () => ({
  now: () => new Date("2026-11-17T09:30:00.000Z"),
  newId: () => `${String(++n).padStart(8, "0")}-aaaa-4bbb-8ccc-000000000000`,
});
const note = (over = {}) => ({
  world_id: WORLD,
  file_name: "Harbour notes (draft).md",
  content: "# Harbour\n\nAdd the salt trade.\n",
  what_was_done: "Merged into the Harbour article",
  articles: ["Harbour"],
  ...over,
});

describe("archive a note", () => {
  it("saves an exact copy with a unique name and adds a log line", async () => {
    const dir = tempDir();
    const answer = await archiveFile(client(dir), note({ source: "My Writing Project" }), fixed());
    expect(answer.archived).toBe(true);
    expect(answer.file).toMatch(/^2026-11-17_Harbour-notes-draft_[0-9]{8}\.md$/);
    const world = join(dir, "archive", readdirSync(join(dir, "archive"))[0]);
    expect(world).toMatch(/Saga TestWorld-11111111$/);
    expect(readFileSync(join(world, "files", answer.file), "utf8")).toBe("# Harbour\n\nAdd the salt trade.\n");
    const [entry] = readLog(world);
    expect(entry).toMatchObject({
      id: answer.id,
      date: "2026-11-17T09:30:00.000Z",
      world_id: WORLD,
      file: answer.file,
      original_name: "Harbour notes (draft).md",
      source: "My Writing Project",
      what_was_done: "Merged into the Harbour article",
      articles: ["Harbour"],
      characters: 31,
    });
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(answer.note).toMatch(/can now be removed from the project/);
  });

  it("does not save the same note twice, and says it is already there", async () => {
    const dir = tempDir();
    await archiveFile(client(dir), note(), fixed());
    const again = await archiveFile(client(dir), note({ what_was_done: "again" }), fixed());
    expect(again.archived).toBe(false);
    expect(again.already_archived.what_was_done).toBe("Merged into the Harbour article");
    const world = join(dir, "archive", readdirSync(join(dir, "archive"))[0]);
    expect(readdirSync(join(world, "files"))).toHaveLength(1);
    expect(readLog(world)).toHaveLength(1);
  });

  it("keeps a changed note with the same name as a separate copy", async () => {
    const dir = tempDir();
    const first = await archiveFile(client(dir), note(), fixed());
    const second = await archiveFile(client(dir), note({ content: "# Harbour\n\nA later note.\n" }), fixed());
    expect(second.archived).toBe(true);
    expect(second.file).not.toBe(first.file);
    expect(second.log_entries).toBe(2);
  });

  it("refuses an empty note, a missing name or reason, and an oversized note, saving nothing", async () => {
    const dir = tempDir();
    const c = client(dir);
    await expect(archiveFile(c, note({ content: "  \n" }))).rejects.toThrow(/empty note is not archived/);
    await expect(archiveFile(c, note({ file_name: "" }))).rejects.toThrow(/file_name is needed/);
    await expect(archiveFile(c, note({ what_was_done: " " }))).rejects.toThrow(/what_was_done is needed/);
    await expect(archiveFile(c, note({ content: "x".repeat(ARCHIVE_MAX_CHARS + 1) }))).rejects.toThrow(/Nothing was saved/);
    expect(existsSync(join(dir, "archive"))).toBe(false);
    expect(c.getWorld).not.toHaveBeenCalled();
  });

  it("follows the access settings, and needs a backup folder", async () => {
    const dir = tempDir();
    await expect(archiveFile(client(dir, { blocked: true }), note())).rejects.toThrow(/blocked in your access settings/);
    expect(existsSync(join(dir, "archive"))).toBe(false);
    await expect(archiveFile(client(null), note())).rejects.toThrow(/nowhere to keep an archive/);
  });

  it("keeps a file name safe: no folders, odd characters or strange extensions", async () => {
    const dir = tempDir();
    const answer = await archiveFile(client(dir), note({ file_name: "../../etc/pass wd?.verylongextension" }), fixed());
    expect(answer.file).toMatch(/^2026-11-17_[A-Za-z0-9._-]+_[0-9]{8}\.md$/);
    expect(answer.file).not.toMatch(/\.\.|\//);
    const world = join(dir, "archive", readdirSync(join(dir, "archive"))[0]);
    expect(readdirSync(join(world, "files"))).toEqual([answer.file]);
  });

  it("uses the world's existing folder after the world is renamed", async () => {
    const dir = tempDir();
    await archiveFile(client(dir, { title: "Old Name" }), note(), fixed());
    await archiveFile(client(dir, { title: "New Name" }), note({ file_name: "second.md", content: "two" }), fixed());
    expect(readdirSync(join(dir, "archive"))).toEqual(["Old Name-11111111"]);
  });
});

describe("list the archive", () => {
  async function filled() {
    const dir = tempDir();
    const c = client(dir);
    await archiveFile(c, note(), fixed());
    await archiveFile(c, note({ file_name: "Mara.md", content: "She owes money.", what_was_done: "Now a secret", articles: ["Mara"] }), fixed());
    await archiveFile(c, note({ world_id: OTHER, file_name: "elsewhere.md", content: "other world" }), fixed());
    return c;
  }

  it("lists this world's notes newest first, without the other world's", async () => {
    const answer = await listArchive(await filled(), { world_id: WORLD });
    expect(answer.archived_notes).toBe(2);
    expect(answer.entries.map((e) => e.original_name)).toEqual(["Mara.md", "Harbour notes (draft).md"]);
    expect(answer.entries[0].sha256).toBeUndefined();
  });

  it("finds entries by any of name, what was done or article", async () => {
    const c = await filled();
    expect((await listArchive(c, { world_id: WORLD, text: "secret" })).entries.map((e) => e.original_name)).toEqual(["Mara.md"]);
    expect((await listArchive(c, { world_id: WORLD, text: "HARBOUR" })).matching).toBe(1);
    expect((await listArchive(c, { world_id: WORLD, text: "nothing like this" })).entries).toEqual([]);
  });

  it("gives one note's text by its id, or the start of its id", async () => {
    const c = await filled();
    const [mara] = (await listArchive(c, { world_id: WORLD, text: "Mara" })).entries;
    expect((await listArchive(c, { world_id: WORLD, id: mara.id })).content).toBe("She owes money.");
    expect((await listArchive(c, { world_id: WORLD, id: mara.id.slice(0, 8) })).entry.original_name).toBe("Mara.md");
    await expect(listArchive(c, { world_id: WORLD, id: "ffffffff" })).rejects.toThrow(/No archived note/);
  });

  it("says so when nothing has been archived", async () => {
    const answer = await listArchive(client(tempDir()), { world_id: WORLD });
    expect(answer.entries).toEqual([]);
    expect(answer.note).toMatch(/Nothing has been archived/);
  });
});

describe("merge two archives", () => {
  async function two() {
    const laptop = tempDir();
    const desktop = tempDir();
    await archiveFile(client(laptop, { title: "Laptop Name" }), note(), fixed());
    await archiveFile(client(laptop, { title: "Laptop Name" }), note({ file_name: "only-laptop.md", content: "laptop" }), fixed());
    await archiveFile(client(desktop, { title: "Desktop Name" }), note({ file_name: "only-desktop.md", content: "desktop" }), fixed());
    return { laptop: join(laptop, "archive"), desktop: join(desktop, "archive") };
  }

  it("copies what is missing, into the same world's folder whatever it is called", async () => {
    const { laptop, desktop } = await two();
    const result = mergeArchives(laptop, desktop);
    expect(result).toEqual({ worlds: 1, files_copied: 2, log_lines_added: 2, problems: [] });
    expect(readdirSync(desktop)).toEqual(["Desktop Name-11111111"]);
    const world = join(desktop, "Desktop Name-11111111");
    expect(readdirSync(join(world, "files"))).toHaveLength(3);
    expect(readLog(world).map((e) => e.original_name).sort()).toEqual(["Harbour notes (draft).md", "only-desktop.md", "only-laptop.md"]);
  });

  it("changes nothing when run a second time, and never touches the source", async () => {
    const { laptop, desktop } = await two();
    mergeArchives(laptop, desktop);
    const before = readFileSync(join(desktop, "Desktop Name-11111111", "log.jsonl"), "utf8");
    expect(mergeArchives(laptop, desktop)).toEqual({ worlds: 1, files_copied: 0, log_lines_added: 0, problems: [] });
    expect(readFileSync(join(desktop, "Desktop Name-11111111", "log.jsonl"), "utf8")).toBe(before);
    expect(readLog(join(laptop, "Laptop Name-11111111"))).toHaveLength(2);
  });

  it("leaves a different file of the same name alone, and reports it", async () => {
    const { laptop, desktop } = await two();
    const [entry] = readLog(join(laptop, "Laptop Name-11111111"));
    writeFileSync(join(desktop, "Desktop Name-11111111", "files", entry.file), "something else");
    const result = mergeArchives(laptop, desktop);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/a different file named/);
    expect(readFileSync(join(desktop, "Desktop Name-11111111", "files", entry.file), "utf8")).toBe("something else");
    expect(result.log_lines_added).toBe(1);
  });

  it("makes a new archive when the target has none, and refuses a missing source", async () => {
    const { laptop } = await two();
    const fresh = join(tempDir(), "archive");
    expect(mergeArchives(laptop, fresh).files_copied).toBe(2);
    expect(() => mergeArchives(join(fresh, "nope"), fresh)).toThrow(/No such folder/);
  });

  it("runs as a command", async () => {
    const { laptop, desktop } = await two();
    const out = execFileSync(process.execPath, ["scripts/merge-archive.js", laptop, desktop], { encoding: "utf8" });
    expect(out).toMatch(/Merged 1 world archive\(s\): 2 file\(s\) copied, 2 log line\(s\) added\./);
  });
});

describe("archive tools in the server", () => {
  it("are offered, in the core group, even when every world is read-only", () => {
    const names = (s) => visibleTools(validateSettings(s), new Set(["core"])).map((t) => t.name);
    const readOnly = names({ allow_only: true, allow_create_worlds: false, world_list: { A: "read_only" } });
    expect(readOnly).toContain("worldanvil_archive_file");
    expect(readOnly).toContain("worldanvil_list_archive");
    expect(toolAction("worldanvil_archive_file")).toBe("read");
    const tool = getToolDefinitions().find((t) => t.name === "worldanvil_archive_file");
    expect(tool.inputSchema.required).toEqual(["world_id", "file_name", "content", "what_was_done"]);
  });

  it("work through the tool call", async () => {
    const c = client(tempDir());
    const saved = JSON.parse((await handleToolCall("worldanvil_archive_file", note(), c)).content[0].text);
    expect(saved.archived).toBe(true);
    const listed = JSON.parse((await handleToolCall("worldanvil_list_archive", { world_id: WORLD }, c)).content[0].text);
    expect(listed.entries[0].original_name).toBe("Harbour notes (draft).md");
  });
});
