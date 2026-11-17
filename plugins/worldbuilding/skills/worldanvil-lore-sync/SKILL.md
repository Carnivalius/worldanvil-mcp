---
name: worldanvil-lore-sync
description: Sync lore from project files or the conversation into a World Anvil world as articles - create new articles, update existing ones without losing edits made on the website, and bring old-format articles up to date. Use when the user wants to upload, push, sync, save or update lore, worldbuilding notes or setting material in World Anvil. Not for manuscripts or story chapters.
---

# World Anvil lore sync

A fixed procedure for getting lore into World Anvil the same way every
time. Follow the steps in order. Do not skip the backup, the plan, or the
go-ahead.

Needs the World Anvil MCP server with these tools:
`worldanvil_backup_world`, `worldanvil_get_world_outline`,
`worldanvil_find_articles`, `worldanvil_compare_article`,
`worldanvil_create_article`, `worldanvil_update_article`,
`worldanvil_reformat_article`. If `worldanvil_compare_article` is
missing, stop and tell the user this skill needs the newer server.

## Rules that always hold

- Nothing is written before the user has seen the plan and said go.
- Every update carries the stamp from the compare (step 5). The user does
  make small edits on the website; the stamp is what stops them being
  overwritten.
- Never retry a failed or doubtful write silently. Report it.
- Never make anything public. Articles are created private; publishing is
  done by the user on the website.
- The access settings belong to the user. If a tool refuses because of
  them, say so and stop that item; do not look for a way round.
- Lore goes in `content`. Working notes, open questions and "to develop"
  points go in `author_notes`. A secret goes in `author_notes` on its own
  line starting `SECRET:`.
- Do not delete articles as part of a sync.

## 1. Before anything

1. Confirm which world the lore is for. One world per run.
2. Check what is allowed there: `worldanvil_list_worlds` gives each
   world's `access` level. Creating and updating need `edit_only` or
   `full_edit`. On a `read_only` world, say so now and offer what is
   still possible (backup, matching, comparing, a plan to keep for
   later); do not go further towards writing. If the create or update
   tools are missing from this session altogether, the server left them
   out because no world allows them: after the user changes their
   settings, a new session is needed.
3. Take a world backup with `worldanvil_backup_world`. If the answer has
   `done: false`, call it again until it is done. "No backup taken. No
   changes since ..." counts as success. If the backup fails, stop and
   tell the user; do not go on without one.
4. Look for a style note for this world (see "Style note" below).
   - Found: read it and follow it.
   - Not found: tell the user there isn't one and ask whether to make
     one. Offer two ways: suggest a short starting note for them to
     adjust, or read a handful of the world's existing articles and draft
     a note from how they are written. If the user says no, carry on
     without one. A style note is helpful, not required.

## 2. Match lore to articles

1. Gather the lore to sync (project files, or what the user points to)
   and split it into one piece per intended article, each with a title.
2. Read `worldanvil_get_world_outline` for the categories and what is
   already there.
3. Call `worldanvil_find_articles` once with every title.
   - `found`: an existing article. Keep its id.
   - `not_found` with suggestions: ask the user whether a suggestion is
     the same thing under another name before treating it as new.
   - `more_than_one`: ask the user which one.
4. For each existing article, call `worldanvil_compare_article` with the
   new text (and author notes if any). Keep the `stamp`.
   - `same`: leave.
   - `format_only`: reformat (wording untouched).
   - `changed`: update. Keep the added, removed and reworded lists for
     the plan. `removed` blocks are text only World Anvil holds: check
     whether the user wrote them on the website before planning to drop
     them.

## 3. Show the plan and wait

Show one table: title, action (create / update / reformat / leave),
template, category, and for updates a one-line summary of what changes
(and anything that would be removed). List open questions underneath.
Then wait for the user's go-ahead. If they change the plan, show the
changed rows again.

## 4. Create new articles

- `worldanvil_create_article` with the template that fits (site names,
  e.g. Character, Settlement, Organization), `category_id`, `content`,
  and `author_notes` when there are any. Leave the icon out unless the
  user asks for one.
- Write the text in Markdown. Do not start it with a heading that
  repeats the title.
- Link other articles as `[[Article Title]]` or
  `[[Article Title|words to show]]`. Use them freely, also for articles
  that do not exist yet: such a marker is kept in the stored text as a
  placeholder (the answer lists it under `links.waiting`) and becomes a
  link once its article exists.
- A batch of new articles that mention each other: just create them in
  turn. Links to articles not made yet are kept as placeholders. When
  the batch is done, run `worldanvil_reformat_article` on each article
  whose answer had `links.waiting`: it turns the placeholders whose
  articles now exist into links. Report any still waiting at the end
  (an article not written yet, or a name that needs correcting).
- Never pass `unresolved_links: "plain"` unless the user asks for a name
  to stay unlinked: it drops the marker for good.
- A duplicate title is refused. Do not work round it; ask the user
  whether to update the existing article or rename one.

## 5. Update existing articles

- `worldanvil_update_article` with the new text and
  `if_unchanged_since: <stamp from the compare>`. Always.
- **Refused because the article changed on the website:** nothing was
  sent. Run the compare again, show the user both versions (what World
  Anvil holds now, and the new text), and agree one combined text with
  them. Then update with that text and the new stamp.
- **Old-format articles** (`format_only`, or met along the way): use
  `worldanvil_reformat_article`. It rewrites how the text is stored and
  never the wording. If it refuses a part, report why and leave it.
- **House style** (a contents list, an opening summary, a standard set of
  headings) changes wording, so it is never part of a reformat. Apply it
  only where the user asked for it or the style note says to, and show
  it in the plan as an update.
- An answer with `unchanged: true` means nothing needed sending. That is
  fine.

## 6. Check every answer

After each create, update or reformat, read:
- `stored`: must say it is stored exactly as sent. A WARNING goes in the
  report with its detail.
- `links`: which names were linked, and which were kept as
  placeholders (`waiting`). Whenever the answer has `links.tell_the_user`,
  tell the user which links were not made and why, and ask whether each
  should wait for its article, be corrected, or be removed.
- `title_heading`: says if an opening heading was left out.

Anything not clean is reported, not fixed quietly.

## 7. Report

A short summary first: how many created, updated, reformatted, left.
Then problems and anything needing the user's decision. Then the list of
articles touched.

## 8. Tidy the project files

Project files must not go stale or pile up.
- Merge scattered notes on one topic into one file.
- A note that has been acted on ("update this lore with X") should be
  archived and leave the project.
- If the server has an archive tool, use it. If not, or if this session
  cannot change project files, finish with a list: files to merge, files
  now safe to archive or remove, and why. The user does the rest.

## Style note

One short note per world, saying how its articles are written. Look for
it among the project files as `World Anvil style - <World name>`. If the
session can save files, save it there; otherwise give the user the text
to add to the project.

Typical contents, all optional:
- Voice and tense (e.g. in-world encyclopedia, past tense).
- Whether an article opens with a one-paragraph summary.
- Usual headings for each kind of article.
- Contents list: none, or `[articletoc]` on its own line, where it goes,
  and whether it has a heading above it (a heading above it will appear
  in the list itself).
- How names, dates and units are written.
- What belongs in author notes for this world.

When drafting one from existing articles, read five or six of different
kinds, describe what they have in common, and show the draft to the user
before saving. Keep it under a page. Applying a new style note to
articles already in the world is a separate job the user asks for.
