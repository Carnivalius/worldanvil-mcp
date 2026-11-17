/**
 * World Anvil MCP Server - Tool Definitions
 *
 * All MCP tool schemas for the World Anvil integration.
 */

/**
 * Get all tool definitions
 * @returns {Array} Array of tool definition objects
 */
export function getToolDefinitions() {
  return [
    // ===== IDENTITY & WORLDS =====
    {
      name: "worldanvil_get_identity",
      description:
        "Get the current authenticated user's identity and information",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "worldanvil_list_worlds",
      description:
        "List all worlds belonging to the authenticated user. Each one carries `access`, the level the user's access settings give it: " +
        "full_edit (read, create, change, delete), edit_only (read, create, change; no deleting), read_only (read only), " +
        "blocked or \"not on allow list\" (nothing). Call this before planning any change, to see what is allowed in the world; " +
        "only the user can change a level, in their settings file, and the server reads that file when it starts.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "worldanvil_get_world",
      description: "Get details about a specific world by its ID",
      inputSchema: {
        type: "object",
        properties: {
          world_id: {
            type: "string",
            description: "The ID of the world to retrieve",
          },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_world",
      description:
        "Create a new world in WorldAnvil. The world is created private, with new articles private too; this tool never makes a world public (do that on the World Anvil website). The result's `privacy` field says whether World Anvil applied it.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title of the world" },
          access_level: {
            type: "string",
            enum: ["full_edit", "edit_only", "read_only"],
            description:
              "Access level for the new world in the user's access settings (confirm with the user first)",
          },
        },
        required: ["title", "access_level"],
      },
    },
    {
      name: "worldanvil_update_world",
      description: "Update an existing world in WorldAnvil",
      inputSchema: {
        type: "object",
        properties: {
          world_id: {
            type: "string",
            description: "The ID of the world to update",
          },
          title: {
            type: "string",
            description: "The new title of the world (optional)",
          },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_backup_world",
      description:
        "Save a local copy of everything in a world to the user's backup folder: categories, articles, secrets, timelines, maps, notebooks, statblocks, variables, canvases and manuscripts (a world need not have all of these). Take one before making changes to a world. A large world takes several minutes, so each call works for a limited time: if the answer has done: false, call again with the same world_id until it says done: true, and change nothing in the world until then. Items unchanged since the last backup are copied from it rather than read again. If nothing at all has changed since the last backup, no new one is kept and the answer says 'No backup taken. No changes since <date>': tell the user that, and only if they ask for one anyway call again with full: true. A backup is never refused for being over the limit; when the answer's `storing` text says the limit is exceeded, pass that on to the user. If World Anvil refuses one kind of content, the answer has a warning naming what is missing and everything else is still saved. Image files and subscriber groups are not included. Changes nothing on World Anvil.",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "The ID of the world to back up" },
          full: {
            type: "boolean",
            description:
              "Read every item from World Anvil afresh and always save a backup, even if nothing seems to have changed (slower). Use when the user asks for a backup anyway. Default false.",
          },
          restart: {
            type: "boolean",
            description: "Discard a backup that is in progress and start again. Default false.",
          },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_backup_item",
      description:
        "Save a local copy of ONE item (an article, a category, a chapter or scene...) to the user's backup folder, when the user asks for it. If the item is the same as its newest saved copy, nothing is saved and the answer says 'No backup taken. No change since <date>': tell the user that, and only if they ask for one anyway call again with force: true. (A copy is saved automatically before every edit or delete, so this is only needed on request.) The answer's `storing` text says how many copies are held against the limit; if it says the limit is exceeded, pass that on. Changes nothing on World Anvil.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description:
              "The kind of item, as World Anvil names it: article, category, secret, timeline, history, map, manuscript, manuscript_part (a chapter or scene), and so on",
          },
          id: { type: "string", description: "The item's ID" },
          force: {
            type: "boolean",
            description: "Save a copy even if nothing has changed since the newest saved copy. Use when the user asks for a backup anyway. Default false.",
          },
        },
        required: ["type", "id"],
      },
    },
    {
      name: "worldanvil_list_backups",
      description:
        "See what the local backups hold. With only world_id: the world's full backups and how many items have saved copies of their own. With type and id as well: every saved version of that one item, newest first (copies saved before an edit or delete, copies saved on request, and the copy in each world backup). Each version has a `version` text to give to worldanvil_compare_backup or worldanvil_restore_item. Follows the access settings: a blocked world's backups can't be read. Reads local files only; changes nothing.",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "The ID of the world" },
          type: {
            type: "string",
            description:
              "The kind of item, as World Anvil names it: article, category, secret, timeline, history, map, manuscript, manuscript_part (a chapter or scene), and so on",
          },
          id: { type: "string", description: "The item's ID (give together with type)" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_archive_file",
      description:
        "Archive a note that has been acted on (for example a lore note whose content is now in World Anvil), so it can leave the writing project without being lost. Saves a copy of the note's full text in the local archive beside the world's backups and adds one line to a running log: the date, the note's name, what was done with it and which articles it went into. The copy is read back to check it matches what was sent. The answer's copy gives its character count, line count and first and last lines: compare those with the note in the project, since only the text sent here is saved. Only after this succeeds and those match should the note be removed from the project. A note already archived under the same name with the same text is not saved twice. Local files only: nothing is sent to World Anvil and nothing there is changed.",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "The ID of the world the note belongs to" },
          file_name: { type: "string", description: "The note's file name in the project" },
          content: { type: "string", description: "The full text of the note, exactly as it is" },
          what_was_done: {
            type: "string",
            description: "One line saying what became of the note, e.g. \"merged into the article and its author notes\"",
          },
          articles: {
            type: "array",
            items: { type: "string" },
            description: "Titles of the articles the note went into (optional)",
          },
          source: { type: "string", description: "Where the note was kept, e.g. the project's name (optional)" },
        },
        required: ["world_id", "file_name", "content", "what_was_done"],
      },
    },
    {
      name: "worldanvil_list_archive",
      description:
        "Answer \"where did that note go?\": the log of notes archived for a world, newest first, each with its date, name, what was done and the articles it went into. Give text to see only entries that mention it. Give an entry's id to read that note's full text. Reads local files only; changes nothing.",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "The ID of the world" },
          text: { type: "string", description: "Optional: only entries whose name, description, source or articles mention this" },
          id: { type: "string", description: "Optional: an entry's id, to read that note's text" },
          limit: { type: "number", description: "Most entries to return (default 50)" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_search_backups",
      description:
        "Search a world's local backups for a piece of text (not case-sensitive), for example to find wording that has gone from an article. Returns the items whose saved copies contain it, with the version, when it was saved and a snippet. Newest copies are searched first. Follows the access settings. Reads local files only; changes nothing.",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "The ID of the world" },
          text: { type: "string", description: "The text to look for (at least two characters)" },
          type: {
            type: "string",
            description: "Only search this kind of item, e.g. article or manuscript_part (optional)",
          },
          limit: { type: "number", description: "Most items to return (default 20, at most 50)" },
        },
        required: ["world_id", "text"],
      },
    },
    {
      name: "worldanvil_compare_backup",
      description:
        "Compare a saved copy of one item with the item as it is on World Anvil now, field by field. For text it lists the lines that were in the saved copy and are missing now (`lost`) and the lines that are new (`added`). Use it after changing an article to check nothing was lost: with no version it compares against the newest saved copy, which after an edit is the copy saved just before that edit. Changes nothing.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description:
              "The kind of item, as World Anvil names it: article, category, secret, timeline, history, map, manuscript, manuscript_part (a chapter or scene), and so on",
          },
          id: { type: "string", description: "The item's ID" },
          version: {
            type: "string",
            description: "Which saved version to compare with, from worldanvil_list_backups (optional; default the newest)",
          },
        },
        required: ["type", "id"],
      },
    },
    {
      name: "worldanvil_restore_item",
      description:
        "Put ONE existing item back the way a saved copy had it. Call it first WITHOUT confirm: it changes nothing and shows which fields would be put back. Show that to the user, and only if they agree call again with confirm: true. The item as it is now is backed up first, so a restore can itself be undone. It writes text, numbers and yes/no values only: links, lists, privacy and placement are listed as not restored. Works on articles, categories and manuscript chapters/scenes; the item must still exist (a deleted item can't be recreated by this tool). Needs edit access to the world.",
      inputSchema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["article", "category", "manuscript_part"],
            description: "The kind of item",
          },
          id: { type: "string", description: "The item's ID" },
          version: {
            type: "string",
            description: "Which saved version to restore, from worldanvil_list_backups (required; never chosen for you)",
          },
          confirm: {
            type: "boolean",
            description: "true to make the change, after the user has seen the preview and agreed. Default false (preview only).",
          },
        },
        required: ["type", "id", "version"],
      },
    },
    {
      name: "worldanvil_delete_world",
      description: "Delete a world from WorldAnvil",
      inputSchema: {
        type: "object",
        properties: {
          world_id: {
            type: "string",
            description: "The ID of the world to delete",
          },
        },
        required: ["world_id"],
      },
    },

    // ===== ARTICLES =====
    {
      name: "worldanvil_list_articles",
      description:
        "List the articles in a world: all of them by default, wherever they are filed, or just one category's. Returns up to 50 at a time; the answer's `paging` says whether there are more and the offset to ask for next. Records are short (title, id, template, icon, state). For the whole world with its category nesting in one answer, use worldanvil_get_world_outline.",
      inputSchema: {
        type: "object",
        properties: {
          world_id: {
            type: "string",
            description: "The ID of the world to list articles from",
          },
          category_id: {
            type: "string",
            description:
              'Optional. A category ID lists only that category\'s articles; "uncategorised" lists only the articles in no category. Leave out for every article in the world.',
          },
          offset: {
            type: "number",
            description:
              "Where to start, counting from 0. Use the next_offset from the previous answer to get the following page.",
          },
          limit: {
            type: "number",
            description: "How many to return (default 50, at most 100)",
          },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_get_world_outline",
      description:
        "The whole world in one answer: the category tree with each category's articles under it, plus the articles in no category. Complete (it pages through World Anvil itself). Each article shows title, id, template, icon and privacy state. Use this to find where things are or to check whether an article already exists before creating one. It makes one request per category, so a world with many categories takes a little while.",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "The ID of the world" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_find_articles",
      description:
        "Find articles in a world by title: pass every title you need in one call (one read of the world, however many titles). Each title comes back as `found` (with id, template, privacy state and `mention`, the text that links to the article from lore), `more_than_one` (all the articles sharing that title, for you to choose between) or `not_found` (with up to five near matches as suggestions; never use a suggestion without checking it is the article meant). A match is exact apart from capitals and spacing. Changes nothing.",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "The ID of the world" },
          titles: {
            type: "array",
            items: { type: "string" },
            description: "The article titles to look for (up to 200)",
          },
        },
        required: ["world_id", "titles"],
      },
    },
    {
      name: "worldanvil_get_article",
      description: "Get a specific article by its ID",
      inputSchema: {
        type: "object",
        properties: {
          article_id: {
            type: "string",
            description: "The ID of the article to retrieve",
          },
        },
        required: ["article_id"],
      },
    },
    {
      name: "worldanvil_create_article",
      description:
        "Create a new article in WorldAnvil. Refused, with nothing sent, if the world already has an article with the same title (capitals and extra spaces ignored): use a different title or update the existing article. It is created private and gets the same icon World Anvil gives that template; the answer's `privacy` confirms it is private. This tool never makes anything public (that is done on the World Anvil website). Put the lore in content and working notes in author_notes. (For a Prose article, content is stored in the article's own Prose box, which is what its editor shows.) To link to another article in the same world write [[Its Title]] in content or author_notes: it becomes a World Anvil mention (capitals and spacing aside; the answer's `links` says what was linked). To display other words for the link write [[Its Title|words to show]]. A name with no article yet is stored as a {{Name}} placeholder and is linked later (see unresolved_links). After saving, the article is read back: the answer's `stored` says whether the title and text World Anvil now holds are exactly what was sent, or warns where they differ (nothing is retried or undone). Do not open content with a heading that repeats the title: World Anvil shows the title itself, and such an opening heading is left out (the answer says so in `title_heading`). Markdown in content, author_notes and all template-specific fields is converted to the BBCode World Anvil's own editor writes (paragraphs, headings, lists, quotes, tables, links); BBCode already in the text is left as it is. Use the fields parameter to set template-specific fields like localization, manifestation, lawtype (for Natural Law), anatomy, traits (for Species), seeded, authornotes, etc.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title of the article" },
          world_id: {
            type: "string",
            description: "The ID of the world to create the article in",
          },
          template: {
            type: "string",
            description:
              "The template, by the name on World Anvil's new-article screen: Generic, Building, Character, Geography, Item, Organization, Species, Vehicle, Settlement, Condition, Conflict, Document, Culture / Ethnicity, Language, Material, Military Formation, Myth, Natural Law, Plot, Profession, Prose, Title, Spell, Technology, Tradition, Session Report, Country, Military, Religion, God/Deity. Default: Generic. An unknown name is refused.",
          },
          content: {
            type: "string",
            description:
              "The main text of the article (markdown auto-converted to BBCode). No table of contents is added unless asked for: to have one, put [articletoc] on a line of its own where it should appear (World Anvil builds the list from the headings and keeps it current). It has no title of its own; add a line above it if the user wants one.",
          },
          format: {
            type: "string",
            enum: ["markdown", "bbcode"],
            description:
              "How content and author_notes are written. \"markdown\" (default): converted to the BBCode World Anvil's own editor writes. \"bbcode\": sent exactly as written, nothing converted.",
          },
          unresolved_links: {
            type: "string",
            enum: ["keep", "plain", "refuse"],
            description:
              "What to do when a [[Name]] link in the text has no article yet, or several articles share the name. \"keep\" (default): the name is stored as a placeholder in curly brackets, {{Name}} or {{Name|words to show}}, which the World Anvil website shows and saves exactly as written (square brackets are not safe there: its editor cuts them down); the answer lists it under `links.waiting` and says so in `links.tell_the_user` (always pass that on: the user may want the name corrected or the placeholder removed). It is made into a link once the article exists (by the next update of this text, or by worldanvil_reformat_article). Use it freely when writing many articles that are not all made yet. \"plain\": the words are stored without a link and the marker is gone. \"refuse\": nothing is sent and the answer lists each problem name with near matches.",
          },
          author_notes: {
            type: "string",
            description:
              "Working notes for the article's own Author Notes section, shown at the foot of the article and kept separate from the main text (e.g. why something is canon, what is still to develop). Not part of content.",
          },
          icon: {
            type: "string",
            description:
              "Leave out to get the icon World Anvil gives this template. To choose one, give a Font Awesome name in Solid or Duotone style, e.g. \"fa-dragon\" or \"fa-duotone fa-dragon\". \"default\" resets to the template's own icon.",
          },
          fields: {
            type: "object",
            description:
              "Template-specific fields as key-value pairs. Markdown in all text fields is auto-converted to BBCode (e.g., manifestation, anatomy, seeded, authornotes, culture, etc.)",
            additionalProperties: true,
          },
          category_id: {
            type: "string",
            description:
              "ID of the category to assign this article to (optional)",
          },
        },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_compare_article",
      description:
        "Compare new lore with an existing article WITHOUT changing anything. Give the article and the text you would send (content, author_notes, or both), written exactly as for worldanvil_update_article. The comparison is by what a reader sees, not by how the text is stored, so an article stored in an older form is not reported as all-changed. `status` is `same` (World Anvil holds exactly this), `format_only` (reads the same, stored in an older form: update it to bring it up to date) or `changed`, with the blocks `reworded` (was / now), `removed` (only on World Anvil: an update would delete them, e.g. an edit made on the website or an embedded image) and `added`. The answer's `stamp` is the article's change date: pass it to worldanvil_update_article as if_unchanged_since.",
      inputSchema: {
        type: "object",
        properties: {
          article_id: { type: "string", description: "The ID of the article to compare with" },
          content: { type: "string", description: "The main text you would send" },
          author_notes: { type: "string", description: "The author notes you would send" },
          format: {
            type: "string",
            enum: ["markdown", "bbcode"],
            description: "How content and author_notes are written, as for worldanvil_update_article (default markdown).",
          },
        },
        required: ["article_id"],
      },
    },
    {
      name: "worldanvil_copy_articles",
      description:
        "Copy categories, articles and their secrets from one world into another world of the same user. The source world is only read. Everything is created private. Each article keeps its title, template, icon, category, main text, author notes and template text fields; the text is copied by the tool exactly (written in the form World Anvil's editor uses where a reader would see no difference, otherwise as stored), and each copy is read back and compared with its source. Mentions of other copied articles are re-pointed at the copies. An article or secret whose title is already in the target is left alone, so a run can be repeated. Without confirm it changes nothing and answers with a preview: show that to the user and get their go-ahead first. With confirm: true each call works for about 40 seconds; while the answer says done: false, call again with the same arguments. Not copied: images, parent/child links between articles, display switches, dates, and other kinds of item (maps, timelines, manuscripts).",
      inputSchema: {
        type: "object",
        properties: {
          source_world_id: { type: "string", description: "The world to copy from (read only)" },
          target_world_id: { type: "string", description: "The world to copy into" },
          category_id: {
            type: "string",
            description:
              "Optional: a category of the source world. Only it, the categories under it and their articles are copied; it becomes a top-level category in the target.",
          },
          confirm: {
            type: "boolean",
            description: "true: do the copy. Left out: preview only, nothing is changed.",
          },
        },
        required: ["source_world_id", "target_world_id"],
      },
    },
    {
      name: "worldanvil_reformat_article",
      description:
        "Bring an article stored in an older form up to the form World Anvil's editor writes today, without changing a word. It rewrites the stored main text and author notes themselves (old list items, headings without anchors, bare lines, old-style web links); no new text is given. It saves only if a reader would see no difference, and refuses otherwise, saying what would differ. An article already in the editor's form is left alone. It also finishes links: a {{Name}} placeholder left in the stored text (or a [[Name]] typed on the website), whose article now exists, is made into a link, and a [[Name]] still waiting is rewritten as {{Name}} (the answer's `links` says which were linked and which are still waiting); that is the one change a reader can see. A backup is taken first, privacy is not touched, and the answer's `stored` confirms what was saved. Use dry_run to see what would happen without saving. This does not restyle or rewrite lore (adding a summary or a contents list is a change of wording: use worldanvil_compare_article and worldanvil_update_article for that).",
      inputSchema: {
        type: "object",
        properties: {
          article_id: { type: "string", description: "The ID of the article to bring up to date" },
          dry_run: {
            type: "boolean",
            description: "true: say what would be rewritten, and send nothing",
          },
          fresh_backup: {
            type: "boolean",
            description:
              "true: read the article afresh from World Anvil for the backup taken before this change. Normally the read made a moment earlier (at most 15 seconds old) is used as the backup, which saves a request. Ask for a fresh one if the article may have just been edited somewhere else.",
          },
        },
        required: ["article_id"],
      },
    },
    {
      name: "worldanvil_update_article",
      description:
        "Update an existing article in WorldAnvil. A new title is refused if another article in the world already has it. If what is given is already exactly what World Anvil holds, nothing is sent (the answer says `unchanged`). Compare first with worldanvil_compare_article and pass its stamp as if_unchanged_since. To link to another article in the same world write [[Its Title]] in content or author_notes: it becomes a World Anvil mention (capitals and spacing aside; the answer's `links` says what was linked). To display other words for the link write [[Its Title|words to show]]. A name with no article yet is stored as a {{Name}} placeholder and is linked later (see unresolved_links). After saving, the article is read back: the answer's `stored` says whether the title and text World Anvil now holds are exactly what was sent, or warns where they differ (nothing is retried or undone). An opening heading in content that only repeats the title is left out (the answer says so in `title_heading`). Only what is passed changes: content replaces the main text (for a Prose article, its Prose box), author_notes replaces the Author Notes section, and each leaves the other alone. Markdown in content, author_notes and template-specific fields is converted to the BBCode World Anvil's own editor writes; BBCode already in the text is left as it is. Can set a different icon or reset it to the template's own. Cannot change an article's template, except to a variant of the same one (Organization to Country, Military or Religion; Character to God/Deity).",
      inputSchema: {
        type: "object",
        properties: {
          article_id: {
            type: "string",
            description: "The ID of the article to update",
          },
          title: {
            type: "string",
            description: "The new title of the article (optional)",
          },
          content: {
            type: "string",
            description:
              "The new main text of the article (markdown auto-converted to BBCode). No table of contents is added unless asked for: to have one, put [articletoc] on a line of its own where it should appear (World Anvil builds the list from the headings and keeps it current). It has no title of its own; add a line above it if the user wants one.",
          },
          format: {
            type: "string",
            enum: ["markdown", "bbcode"],
            description:
              "How content and author_notes are written. \"markdown\" (default): converted to the BBCode World Anvil's own editor writes. \"bbcode\": sent exactly as written, nothing converted.",
          },
          fresh_backup: {
            type: "boolean",
            description:
              "true: read the article afresh from World Anvil for the backup taken before this change. Normally the read made a moment earlier (at most 15 seconds old) is used as the backup, which saves a request. Ask for a fresh one if the article may have just been edited somewhere else.",
          },
          if_unchanged_since: {
            type: "string",
            description:
              "The `stamp` from worldanvil_compare_article. If the article has changed on World Anvil since then (an edit made on the website, say), the update is refused and nothing is sent, so that edit is not overwritten. Always pass it when updating lore that was compared first.",
          },
          unresolved_links: {
            type: "string",
            enum: ["keep", "plain", "refuse"],
            description:
              "What to do when a [[Name]] link in the text has no article yet, or several articles share the name. \"keep\" (default): the name is stored as a placeholder in curly brackets, {{Name}} or {{Name|words to show}}, which the World Anvil website shows and saves exactly as written (square brackets are not safe there: its editor cuts them down); the answer lists it under `links.waiting` and says so in `links.tell_the_user` (always pass that on: the user may want the name corrected or the placeholder removed). It is made into a link once the article exists (by the next update of this text, or by worldanvil_reformat_article). Use it freely when writing many articles that are not all made yet. \"plain\": the words are stored without a link and the marker is gone. \"refuse\": nothing is sent and the answer lists each problem name with near matches.",
          },
          author_notes: {
            type: "string",
            description:
              "Working notes for the article's own Author Notes section, shown at the foot of the article and kept separate from the main text (e.g. why something is canon, what is still to develop). Not part of content.",
          },
          icon: {
            type: "string",
            description:
              "Leave out to get the icon World Anvil gives this template. To choose one, give a Font Awesome name in Solid or Duotone style, e.g. \"fa-dragon\" or \"fa-duotone fa-dragon\". \"default\" resets to the template's own icon.",
          },
          template: {
            type: "string",
            description:
              "Only for switching to a variant of the article's current template: Country, Military or Religion (for an Organization), God/Deity (for a Character). Any other change of template is refused.",
          },
          fields: {
            type: "object",
            description:
              "Template-specific fields to update as key-value pairs. Markdown in all text fields is auto-converted to BBCode.",
            additionalProperties: true,
          },
          category_id: {
            type: "string",
            description:
              "ID of the category to assign this article to (optional)",
          },
        },
        required: ["article_id"],
      },
    },
    {
      name: "worldanvil_delete_article",
      description: "Delete an article from WorldAnvil",
      inputSchema: {
        type: "object",
        properties: {
          article_id: {
            type: "string",
            description: "The ID of the article to delete",
          },
        },
        required: ["article_id"],
      },
    },

    // ===== CATEGORIES =====
    {
      name: "worldanvil_list_categories",
      description:
        "List the categories in a world. Returns up to 50 at a time; the answer's `paging` says whether there are more and the offset to ask for next. For the nesting of categories and their articles, use worldanvil_get_world_outline.",
      inputSchema: {
        type: "object",
        properties: {
          world_id: {
            type: "string",
            description: "The ID of the world to list categories from",
          },
          offset: {
            type: "number",
            description:
              "Where to start, counting from 0. Use the next_offset from the previous answer to get the following page.",
          },
          limit: {
            type: "number",
            description: "How many to return (default 50, at most 100)",
          },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_get_category",
      description: "Get a specific category by its ID",
      inputSchema: {
        type: "object",
        properties: {
          category_id: {
            type: "string",
            description: "The ID of the category to retrieve",
          },
        },
        required: ["category_id"],
      },
    },
    {
      name: "worldanvil_create_category",
      description:
        "Create a new category (a folder for articles) in WorldAnvil. It gets World Anvil's folder icon unless another is given.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title of the category" },
          world_id: {
            type: "string",
            description: "The ID of the world to create the category in",
          },
          icon: {
            type: "string",
            description:
              "Leave out to get World Anvil's folder icon. To choose one, give a Font Awesome name in Solid or Duotone style, e.g. \"fa-users\" or \"fa-duotone fa-users\". \"default\" resets to the folder icon.",
          },
          description: {
            type: "string",
            description:
              "Legacy top-of-page intro/body (markdown auto-converted to BBCode). Renders above any custom1-5 column layout.",
          },
          parent_category_id: {
            type: "string",
            description: "ID of the parent category for nesting (optional)",
          },
        },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_category",
      description:
        "Update an existing category in WorldAnvil. Markdown in content is auto-converted to BBCode.",
      inputSchema: {
        type: "object",
        properties: {
          category_id: {
            type: "string",
            description: "The ID of the category to update",
          },
          title: {
            type: "string",
            description: "The new title of the category (optional)",
          },
          icon: {
            type: "string",
            description:
              "Leave out to get World Anvil's folder icon. To choose one, give a Font Awesome name in Solid or Duotone style, e.g. \"fa-users\" or \"fa-duotone fa-users\". \"default\" resets to the folder icon.",
          },
          content: {
            type: "string",
            description:
              "Column-layout content for the category page (markdown auto-converted to BBCode, stored in custom1).",
          },
          description: {
            type: "string",
            description:
              "Legacy top-of-page intro/body (markdown auto-converted to BBCode). Renders above any custom1-5 column layout. Pass an empty string to clear.",
          },
          excerpt: {
            type: "string",
            description: "A short teaser/summary for the category",
          },
          parent_category_id: {
            type: "string",
            description: "ID of the parent category for nesting (optional)",
          },
        },
        required: ["category_id"],
      },
    },
    {
      name: "worldanvil_delete_category",
      description: "Delete a category from WorldAnvil",
      inputSchema: {
        type: "object",
        properties: {
          category_id: {
            type: "string",
            description: "The ID of the category to delete",
          },
        },
        required: ["category_id"],
      },
    },

    // ===== IMAGES =====
    {
      name: "worldanvil_list_images",
      description: "List images in a specific world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: {
            type: "string",
            description: "The ID of the world to list images from",
          },
          offset: {
            type: "number",
            description: "Pagination offset (optional)",
          },
          limit: {
            type: "number",
            description: "Maximum number of images to return (optional)",
          },
        },
        required: ["world_id"],
      },
    },

    // ===== NOTEBOOKS =====
    {
      name: "worldanvil_get_notebook",
      description: "Get notebook by ID",
      inputSchema: {
        type: "object",
        properties: {
          notebook_id: { type: "string", description: "Notebook ID" },
        },
        required: ["notebook_id"],
      },
    },
    {
      name: "worldanvil_list_notebooks",
      description:
        "List notebooks in world (WARNING: API endpoint currently broken per WorldAnvil docs - use get_notebook with known IDs instead)",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_notebook",
      description: "Create notebook",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, world_id: { type: "string" } },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_notebook",
      description: "Update notebook",
      inputSchema: {
        type: "object",
        properties: {
          notebook_id: { type: "string" },
          title: { type: "string" },
        },
        required: ["notebook_id"],
      },
    },
    {
      name: "worldanvil_delete_notebook",
      description: "Delete notebook",
      inputSchema: {
        type: "object",
        properties: { notebook_id: { type: "string" } },
        required: ["notebook_id"],
      },
    },

    // ===== NOTE SECTIONS =====
    {
      name: "worldanvil_get_notesection",
      description: "Get note section by ID",
      inputSchema: {
        type: "object",
        properties: {
          notesection_id: { type: "string", description: "Note section ID" },
        },
        required: ["notesection_id"],
      },
    },
    {
      name: "worldanvil_list_notesections",
      description: "List note sections in notebook",
      inputSchema: {
        type: "object",
        properties: {
          notebook_id: { type: "string", description: "Notebook ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["notebook_id"],
      },
    },
    {
      name: "worldanvil_create_notesection",
      description: "Create note section",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          notebook_id: { type: "string" },
        },
        required: ["title", "notebook_id"],
      },
    },
    {
      name: "worldanvil_update_notesection",
      description: "Update note section",
      inputSchema: {
        type: "object",
        properties: {
          notesection_id: { type: "string" },
          title: { type: "string" },
        },
        required: ["notesection_id"],
      },
    },
    {
      name: "worldanvil_delete_notesection",
      description: "Delete note section",
      inputSchema: {
        type: "object",
        properties: { notesection_id: { type: "string" } },
        required: ["notesection_id"],
      },
    },

    // ===== NOTES =====
    {
      name: "worldanvil_get_note",
      description: "Get note by ID",
      inputSchema: {
        type: "object",
        properties: { note_id: { type: "string", description: "Note ID" } },
        required: ["note_id"],
      },
    },
    {
      name: "worldanvil_list_notes",
      description: "List notes in section",
      inputSchema: {
        type: "object",
        properties: {
          notesection_id: { type: "string", description: "Note section ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["notesection_id"],
      },
    },
    {
      name: "worldanvil_create_note",
      description: "Create note",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          notesection_id: { type: "string" },
          content: { type: "string" },
        },
        required: ["title", "notesection_id"],
      },
    },
    {
      name: "worldanvil_update_note",
      description: "Update note",
      inputSchema: {
        type: "object",
        properties: {
          note_id: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["note_id"],
      },
    },
    {
      name: "worldanvil_delete_note",
      description: "Delete note",
      inputSchema: {
        type: "object",
        properties: { note_id: { type: "string" } },
        required: ["note_id"],
      },
    },

    // ===== SECRETS =====
    {
      name: "worldanvil_get_secret",
      description: "Get secret by ID",
      inputSchema: {
        type: "object",
        properties: { secret_id: { type: "string", description: "Secret ID" } },
        required: ["secret_id"],
      },
    },
    {
      name: "worldanvil_list_secrets",
      description: "List secrets in world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_secret",
      description:
        "Create a secret (hidden text, optionally attached to an article). It is created private; the answer's `privacy` line says whether World Anvil applied that. Markdown in `content` is converted to World Anvil's format.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          world_id: { type: "string" },
          content: { type: "string" },
          article_id: {
            type: "string",
            description:
              "ID of the article to attach this secret to (optional)",
          },
        },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_secret",
      description: "Update secret",
      inputSchema: {
        type: "object",
        properties: {
          secret_id: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          article_id: {
            type: "string",
            description:
              "ID of the article to attach this secret to (optional)",
          },
        },
        required: ["secret_id"],
      },
    },
    {
      name: "worldanvil_delete_secret",
      description: "Delete secret",
      inputSchema: {
        type: "object",
        properties: { secret_id: { type: "string" } },
        required: ["secret_id"],
      },
    },

    // ===== MAPS =====
    {
      name: "worldanvil_get_map",
      description: "Get map by ID",
      inputSchema: {
        type: "object",
        properties: { map_id: { type: "string", description: "Map ID" } },
        required: ["map_id"],
      },
    },
    {
      name: "worldanvil_list_maps",
      description: "List maps in world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_map",
      description: "Create map",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, world_id: { type: "string" } },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_map",
      description: "Update map",
      inputSchema: {
        type: "object",
        properties: { map_id: { type: "string" }, title: { type: "string" } },
        required: ["map_id"],
      },
    },
    {
      name: "worldanvil_delete_map",
      description: "Delete map",
      inputSchema: {
        type: "object",
        properties: { map_id: { type: "string" } },
        required: ["map_id"],
      },
    },

    // ===== MAP MARKERS =====
    {
      name: "worldanvil_get_marker",
      description: "Get map marker by ID",
      inputSchema: {
        type: "object",
        properties: { marker_id: { type: "string", description: "Marker ID" } },
        required: ["marker_id"],
      },
    },
    {
      name: "worldanvil_list_markers",
      description: "List markers on map",
      inputSchema: {
        type: "object",
        properties: {
          map_id: { type: "string", description: "Map ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["map_id"],
      },
    },
    {
      name: "worldanvil_create_marker",
      description: "Create map marker",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          map_id: { type: "string", description: "ID of the map" },
          world_id: {
            type: "string",
            description: "ID of the world (required by API)",
          },
          geo_x: { type: "number", description: "X coordinate on the map" },
          geo_y: { type: "number", description: "Y coordinate on the map" },
          description: {
            type: "string",
            description: "Marker description (popup body)",
          },
          article_id: {
            type: "string",
            description: "ID of the article to link to this marker (optional)",
          },
          group_id: {
            type: "string",
            description: "MarkerGroup ID (optional)",
          },
          label_title: {
            type: "string",
            description: "Custom label title shown on the marker",
          },
          label_type: {
            type: "string",
            description: "Label rendering style (e.g. 'tooltip', 'always')",
          },
          html_marker: {
            type: "string",
            description: "Custom HTML for the marker pin (advanced)",
          },
          state: {
            type: "string",
            enum: ["public", "private"],
            description: "Visibility state",
          },
          circle_radius: {
            type: "number",
            description: "Radius for circle-style markers (pixels)",
          },
          color_outline: {
            type: "string",
            description: "Outline color (hex, e.g. '#ff0000')",
          },
          color_fill: {
            type: "string",
            description: "Fill color (hex)",
          },
          opacity_outline: {
            type: "number",
            description: "Outline opacity 0.0-1.0",
          },
          opacity_fill: {
            type: "number",
            description: "Fill opacity 0.0-1.0",
          },
          line_weight: {
            type: "number",
            description: "Outline stroke weight (pixels)",
          },
        },
        required: ["title", "map_id", "world_id"],
      },
    },
    {
      name: "worldanvil_update_marker",
      description: "Update map marker",
      inputSchema: {
        type: "object",
        properties: {
          marker_id: { type: "string" },
          title: { type: "string" },
          geo_x: { type: "number" },
          geo_y: { type: "number" },
          description: { type: "string" },
          article_id: {
            type: "string",
            description: "ID of the article to link to this marker (optional)",
          },
          group_id: {
            type: "string",
            description: "MarkerGroup ID (optional)",
          },
          label_title: { type: "string" },
          label_type: { type: "string" },
          html_marker: { type: "string" },
          state: { type: "string", enum: ["public", "private"] },
          circle_radius: { type: "number" },
          color_outline: { type: "string" },
          color_fill: { type: "string" },
          opacity_outline: { type: "number" },
          opacity_fill: { type: "number" },
          line_weight: { type: "number" },
        },
        required: ["marker_id"],
      },
    },
    {
      name: "worldanvil_delete_marker",
      description: "Delete map marker",
      inputSchema: {
        type: "object",
        properties: { marker_id: { type: "string" } },
        required: ["marker_id"],
      },
    },

    // ===== TIMELINES =====
    {
      name: "worldanvil_get_timeline",
      description: "Get timeline by ID",
      inputSchema: {
        type: "object",
        properties: {
          timeline_id: { type: "string", description: "Timeline ID" },
        },
        required: ["timeline_id"],
      },
    },
    {
      name: "worldanvil_list_timelines",
      description: "List timelines in world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_timeline",
      description: "Create a timeline in a world",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Timeline title" },
          world_id: { type: "string", description: "World ID" },
          description: { type: "string", description: "Timeline description" },
          type: {
            type: "string",
            enum: ["parallel", "master"],
            description: "Timeline type",
          },
          state: {
            type: "string",
            enum: ["public", "private"],
            description: "Visibility state",
          },
          tags: { type: "string", description: "Comma-separated tags" },
        },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_timeline",
      description:
        "Update an existing timeline. Use history_ids to attach history events to this timeline.",
      inputSchema: {
        type: "object",
        properties: {
          timeline_id: { type: "string", description: "Timeline ID" },
          title: { type: "string", description: "Timeline title" },
          description: { type: "string", description: "Timeline description" },
          type: {
            type: "string",
            enum: ["parallel", "master"],
            description: "Timeline type",
          },
          state: {
            type: "string",
            enum: ["public", "private"],
            description: "Visibility state",
          },
          tags: { type: "string", description: "Comma-separated tags" },
          history_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "IDs of history events on this timeline. Replaces the full list — include all existing IDs alongside any new ones to avoid losing previously attached events.",
          },
        },
        required: ["timeline_id"],
      },
    },
    {
      name: "worldanvil_delete_timeline",
      description: "Delete timeline",
      inputSchema: {
        type: "object",
        properties: { timeline_id: { type: "string" } },
        required: ["timeline_id"],
      },
    },

    // ===== ERAS =====
    {
      name: "worldanvil_get_era",
      description: "Get era by ID",
      inputSchema: {
        type: "object",
        properties: { era_id: { type: "string", description: "Era ID" } },
        required: ["era_id"],
      },
    },
    {
      name: "worldanvil_create_era",
      description: "Create an era on a timeline",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Era title" },
          timeline_id: { type: "string", description: "Parent timeline ID" },
          world_id: {
            type: "string",
            description: "World ID (required by API)",
          },
          year: { type: "number", description: "Starting year of the era" },
          ending_year: {
            type: "number",
            description: "Ending year of the era",
          },
          state: {
            type: "string",
            enum: ["public", "private"],
            description: "Visibility state",
          },
        },
        required: ["title", "timeline_id", "world_id"],
      },
    },
    {
      name: "worldanvil_update_era",
      description: "Update an era",
      inputSchema: {
        type: "object",
        properties: {
          era_id: { type: "string" },
          title: { type: "string" },
          year: { type: "number" },
          ending_year: { type: "number" },
          state: { type: "string", enum: ["public", "private"] },
        },
        required: ["era_id"],
      },
    },
    {
      name: "worldanvil_delete_era",
      description: "Delete an era",
      inputSchema: {
        type: "object",
        properties: { era_id: { type: "string" } },
        required: ["era_id"],
      },
    },

    // ===== HISTORY EVENTS =====
    {
      name: "worldanvil_get_history",
      description: "Get history event by ID",
      inputSchema: {
        type: "object",
        properties: {
          history_id: { type: "string", description: "History event ID" },
        },
        required: ["history_id"],
      },
    },
    {
      name: "worldanvil_list_histories",
      description: "List history events in world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_history",
      description:
        "Create a history event (timeline entry). year is required by the WorldAnvil API. After creating, call worldanvil_update_timeline with history_ids to attach the event to a timeline.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          world_id: { type: "string", description: "World ID" },
          year: {
            type: "string",
            description:
              'Year of the event, e.g. "1247". Required by WorldAnvil API.',
          },
          month: { type: "integer", description: "Month of the event (1-12)" },
          day: { type: "integer", description: "Day of the event" },
          hour: { type: "integer", description: "Hour of the event" },
          endingYear: {
            type: "string",
            description: "End year for ranged/era events",
          },
          endingMonth: {
            type: "integer",
            description: "End month for ranged events",
          },
          endingDay: {
            type: "integer",
            description: "End day for ranged events",
          },
          endingHour: {
            type: "integer",
            description: "End hour for ranged events",
          },
          significance: {
            type: "integer",
            minimum: 0,
            maximum: 5,
            description: "Importance rating (0-5)",
          },
          state: {
            type: "string",
            enum: ["public", "private"],
            description: "Visibility state",
          },
          tags: { type: "string", description: "Comma-separated tags" },
          content: {
            type: "string",
            description: "Short summary/description of the event",
          },
          fullcontent: {
            type: "string",
            description:
              "Full content body (Markdown is auto-converted to BBCode)",
          },
          displayDateName: {
            type: "string",
            description: "Custom display name for the date",
          },
          displayRange: {
            type: "boolean",
            description: "Whether to display the date range",
          },
          alternativeDisplayRange: {
            type: "string",
            description: "Custom date range display text",
          },
          article_id: { type: "string", description: "ID of a linked article" },
          location_id: {
            type: "string",
            description: "ID of a linked location article",
          },
          character_ids: {
            type: "array",
            items: { type: "string" },
            description: "IDs of linked character articles",
          },
          organization_ids: {
            type: "array",
            items: { type: "string" },
            description: "IDs of linked organization articles",
          },
          era_id: {
            type: "string",
            description: "ID of the era this event belongs to",
          },
          timeline_ids: {
            type: "array",
            items: { type: "string" },
            description: "IDs of timelines to attach this event to directly",
          },
          category: {
            type: "string",
            description: "Category label for the event",
          },
          lane: {
            type: "integer",
            description: "Vertical lane position on timeline view",
          },
          backgroundColour: {
            type: "string",
            description:
              "Background colour of the event bar (hex, e.g. '#ff0000')",
          },
        },
        required: ["title", "world_id", "year"],
      },
    },
    {
      name: "worldanvil_update_history",
      description: "Update an existing history event",
      inputSchema: {
        type: "object",
        properties: {
          history_id: { type: "string", description: "History event ID" },
          title: { type: "string", description: "Event title" },
          year: { type: "string", description: "Year of the event" },
          month: { type: "integer", description: "Month of the event (1-12)" },
          day: { type: "integer", description: "Day of the event" },
          hour: { type: "integer", description: "Hour of the event" },
          endingYear: {
            type: "string",
            description: "End year for ranged/era events",
          },
          endingMonth: {
            type: "integer",
            description: "End month for ranged events",
          },
          endingDay: {
            type: "integer",
            description: "End day for ranged events",
          },
          endingHour: {
            type: "integer",
            description: "End hour for ranged events",
          },
          significance: {
            type: "integer",
            minimum: 0,
            maximum: 5,
            description: "Importance rating (0-5)",
          },
          state: {
            type: "string",
            enum: ["public", "private"],
            description: "Visibility state",
          },
          tags: { type: "string", description: "Comma-separated tags" },
          content: {
            type: "string",
            description: "Short summary/description of the event",
          },
          fullcontent: {
            type: "string",
            description:
              "Full content body (Markdown is auto-converted to BBCode)",
          },
          displayDateName: {
            type: "string",
            description: "Custom display name for the date",
          },
          displayRange: {
            type: "boolean",
            description: "Whether to display the date range",
          },
          alternativeDisplayRange: {
            type: "string",
            description: "Custom date range display text",
          },
          article_id: { type: "string", description: "ID of a linked article" },
          location_id: {
            type: "string",
            description: "ID of a linked location article",
          },
          character_ids: {
            type: "array",
            items: { type: "string" },
            description: "IDs of linked character articles",
          },
          organization_ids: {
            type: "array",
            items: { type: "string" },
            description: "IDs of linked organization articles",
          },
          era_id: {
            type: "string",
            description: "ID of the era this event belongs to",
          },
          timeline_ids: {
            type: "array",
            items: { type: "string" },
            description: "IDs of timelines to attach this event to directly",
          },
          category: {
            type: "string",
            description: "Category label for the event",
          },
          lane: {
            type: "integer",
            description: "Vertical lane position on timeline view",
          },
          backgroundColour: {
            type: "string",
            description:
              "Background colour of the event bar (hex, e.g. '#ff0000')",
          },
        },
        required: ["history_id"],
      },
    },
    {
      name: "worldanvil_delete_history",
      description: "Delete history event",
      inputSchema: {
        type: "object",
        properties: { history_id: { type: "string" } },
        required: ["history_id"],
      },
    },

    // ===== RPG SYSTEMS =====
    {
      name: "worldanvil_get_rpgsystem",
      description: "Get RPG system by ID",
      inputSchema: {
        type: "object",
        properties: {
          rpgsystem_id: { type: "string", description: "RPG system ID" },
        },
        required: ["rpgsystem_id"],
      },
    },
    {
      name: "worldanvil_list_rpgsystems",
      description: "List all RPG systems",
      inputSchema: {
        type: "object",
        properties: { offset: { type: "number" }, limit: { type: "number" } },
      },
    },

    // ===== BLOCKS =====
    {
      name: "worldanvil_get_block",
      description: "Get a reusable content block by ID",
      inputSchema: {
        type: "object",
        properties: { block_id: { type: "string", description: "Block ID" } },
        required: ["block_id"],
      },
    },
    {
      name: "worldanvil_list_blocks",
      description: "List all blocks in a world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_list_blocks_in_folder",
      description: "List blocks within a specific block folder",
      inputSchema: {
        type: "object",
        properties: {
          blockfolder_id: { type: "string", description: "Block folder ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["blockfolder_id"],
      },
    },
    {
      name: "worldanvil_create_block",
      description:
        "Create a new statblock/content block. Requires a BlockTemplate ID (templates define the block structure).",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          template_id: {
            type: "number",
            description:
              "ID of the BlockTemplate to use (required - create templates via WorldAnvil web UI)",
          },
          folder_id: {
            type: "number",
            description: "Optional BlockFolder ID to organize the block",
          },
        },
        required: ["title", "template_id"],
      },
    },
    {
      name: "worldanvil_update_block",
      description: "Update an existing block",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["block_id"],
      },
    },
    {
      name: "worldanvil_delete_block",
      description: "Delete a block",
      inputSchema: {
        type: "object",
        properties: { block_id: { type: "string" } },
        required: ["block_id"],
      },
    },

    // ===== BLOCK FOLDERS =====
    {
      name: "worldanvil_get_blockfolder",
      description: "Get a block folder by ID",
      inputSchema: {
        type: "object",
        properties: {
          blockfolder_id: { type: "string", description: "Block folder ID" },
        },
        required: ["blockfolder_id"],
      },
    },
    {
      name: "worldanvil_list_blockfolders",
      description: "List all block folders in a world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_blockfolder",
      description: "Create a new block folder",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, world_id: { type: "string" } },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_blockfolder",
      description: "Update a block folder",
      inputSchema: {
        type: "object",
        properties: {
          blockfolder_id: { type: "string" },
          title: { type: "string" },
        },
        required: ["blockfolder_id"],
      },
    },
    {
      name: "worldanvil_delete_blockfolder",
      description: "Delete a block folder",
      inputSchema: {
        type: "object",
        properties: { blockfolder_id: { type: "string" } },
        required: ["blockfolder_id"],
      },
    },

    // ===== BLOCK TEMPLATES =====
    {
      name: "worldanvil_get_blocktemplate",
      description:
        "Get a block template by ID. Block templates define the structure/fields for statblocks.",
      inputSchema: {
        type: "object",
        properties: {
          template_id: { type: "number", description: "Block template ID" },
        },
        required: ["template_id"],
      },
    },
    {
      name: "worldanvil_list_blocktemplates",
      description: "List all block templates belonging to a user",
      inputSchema: {
        type: "object",
        properties: {
          user_id: {
            type: "string",
            description: "User ID (from get_identity)",
          },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["user_id"],
      },
    },
    {
      name: "worldanvil_create_blocktemplate",
      description: "Create a new block template",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string", description: "Template name" } },
        required: ["title"],
      },
    },
    {
      name: "worldanvil_update_blocktemplate",
      description: "Update a block template",
      inputSchema: {
        type: "object",
        properties: {
          template_id: { type: "number" },
          title: { type: "string" },
        },
        required: ["template_id"],
      },
    },
    {
      name: "worldanvil_delete_blocktemplate",
      description: "Delete a block template (also deletes all its parts)",
      inputSchema: {
        type: "object",
        properties: { template_id: { type: "number" } },
        required: ["template_id"],
      },
    },

    // ===== BLOCK TEMPLATE PARTS =====
    {
      name: "worldanvil_get_blocktemplatepart",
      description: "Get a block template part by ID",
      inputSchema: {
        type: "object",
        properties: {
          part_id: { type: "number", description: "Block template part ID" },
        },
        required: ["part_id"],
      },
    },
    {
      name: "worldanvil_list_blocktemplateparts",
      description:
        "List all parts in a block template (WARNING: API has server-side bug - use get_blocktemplate with granularity=2 instead)",
      inputSchema: {
        type: "object",
        properties: {
          template_id: { type: "number", description: "Block template ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["template_id"],
      },
    },
    {
      name: "worldanvil_create_blocktemplatepart",
      description: "Create a new part/field in a block template",
      inputSchema: {
        type: "object",
        properties: {
          template_id: {
            type: "number",
            description: "Parent block template ID",
          },
          title: { type: "string", description: "Field label" },
          type: {
            type: "string",
            description: "Field type (e.g., text, number, textarea)",
          },
          description: {
            type: "string",
            description: "Help text for the field",
          },
          placeholder: { type: "string", description: "Placeholder text" },
          required: {
            type: "number",
            description: "1 if required, 0 if optional",
          },
          position: { type: "number", description: "Display order" },
          section: { type: "string", description: "Section grouping" },
          min: {
            type: "number",
            description: "Minimum value (for number fields)",
          },
          max: {
            type: "number",
            description: "Maximum value (for number fields)",
          },
          options: { type: "string", description: "Options for select fields" },
        },
        required: ["template_id", "title", "type"],
      },
    },
    {
      name: "worldanvil_update_blocktemplatepart",
      description: "Update a block template part",
      inputSchema: {
        type: "object",
        properties: {
          part_id: { type: "number" },
          title: { type: "string" },
          type: { type: "string" },
          description: { type: "string" },
          placeholder: { type: "string" },
          required: { type: "number" },
          position: { type: "number" },
          section: { type: "string" },
          min: { type: "number" },
          max: { type: "number" },
          options: { type: "string" },
        },
        required: ["part_id"],
      },
    },
    {
      name: "worldanvil_delete_blocktemplatepart",
      description: "Delete a block template part",
      inputSchema: {
        type: "object",
        properties: { part_id: { type: "number" } },
        required: ["part_id"],
      },
    },

    // ===== MANUSCRIPTS =====
    {
      name: "worldanvil_get_manuscript",
      description: "Get a manuscript by ID",
      inputSchema: {
        type: "object",
        properties: {
          manuscript_id: { type: "string", description: "Manuscript ID" },
        },
        required: ["manuscript_id"],
      },
    },
    {
      name: "worldanvil_list_manuscripts",
      description: "List all manuscripts in a world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_manuscript",
      description: "Create a new manuscript",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, world_id: { type: "string" } },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_manuscript",
      description: "Update a manuscript",
      inputSchema: {
        type: "object",
        properties: {
          manuscript_id: { type: "string" },
          title: { type: "string" },
        },
        required: ["manuscript_id"],
      },
    },
    {
      name: "worldanvil_delete_manuscript",
      description: "Delete a manuscript",
      inputSchema: {
        type: "object",
        properties: { manuscript_id: { type: "string" } },
        required: ["manuscript_id"],
      },
    },

    // ===== CANVAS (Visual Boards) =====
    {
      name: "worldanvil_get_canvas",
      description: "Get a visual board/canvas by ID",
      inputSchema: {
        type: "object",
        properties: { canvas_id: { type: "string", description: "Canvas ID" } },
        required: ["canvas_id"],
      },
    },
    {
      name: "worldanvil_list_canvases",
      description: "List all visual boards/canvases in a world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_canvas",
      description:
        "Create a new visual board/canvas for worldbuilding diagrams and connections",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Canvas title" },
          world_id: { type: "string", description: "World ID" },
          data: {
            type: "object",
            description:
              "Whiteboard content data (optional, defaults to empty)",
          },
        },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_canvas",
      description: "Update a visual board/canvas",
      inputSchema: {
        type: "object",
        properties: {
          canvas_id: { type: "string" },
          title: { type: "string" },
          data: {
            type: "object",
            description: "Whiteboard content data (optional)",
          },
        },
        required: ["canvas_id"],
      },
    },
    {
      name: "worldanvil_delete_canvas",
      description: "Delete a visual board/canvas",
      inputSchema: {
        type: "object",
        properties: { canvas_id: { type: "string" } },
        required: ["canvas_id"],
      },
    },

    // ===== SUBSCRIBER GROUPS =====
    {
      name: "worldanvil_get_subscribergroup",
      description: "Get a subscriber/access control group by ID",
      inputSchema: {
        type: "object",
        properties: {
          subscribergroup_id: {
            type: "string",
            description: "Subscriber group ID",
          },
        },
        required: ["subscribergroup_id"],
      },
    },
    {
      name: "worldanvil_list_subscribergroups",
      description: "List all subscriber/access control groups in a world",
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_subscribergroup",
      description: "Create a new subscriber/access control group",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, world_id: { type: "string" } },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_subscribergroup",
      description: "Update a subscriber/access control group",
      inputSchema: {
        type: "object",
        properties: {
          subscribergroup_id: { type: "string" },
          title: { type: "string" },
        },
        required: ["subscribergroup_id"],
      },
    },
    {
      name: "worldanvil_delete_subscribergroup",
      description: "Delete a subscriber/access control group",
      inputSchema: {
        type: "object",
        properties: { subscribergroup_id: { type: "string" } },
        required: ["subscribergroup_id"],
      },
    },

    // ===== VARIABLE COLLECTIONS =====
    {
      name: "worldanvil_get_variablecollection",
      description:
        "Get a variable collection by ID with its metadata and prefix. Use to inspect collection structure before creating variables. Collections organize reusable values referenced in articles as [prefix:key].",
      inputSchema: {
        type: "object",
        properties: {
          collection_id: {
            type: "string",
            description: "Variable collection ID",
          },
        },
        required: ["collection_id"],
      },
    },
    {
      name: "worldanvil_list_variablecollections",
      description:
        'List all variable collections in a world. ALWAYS call this before creating a new collection to avoid duplicates. PRINCIPLE: "Better to have too many collections than too few" - organize by theme (e.g., "Calendar", "Currency", "Titles") rather than catch-all buckets.',
      inputSchema: {
        type: "object",
        properties: {
          world_id: { type: "string", description: "World ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["world_id"],
      },
    },
    {
      name: "worldanvil_create_variablecollection",
      description:
        'Create a new variable collection with a prefix for referencing. CRITICAL: The prefix CANNOT be changed later without breaking all references. Use 3-6 character lowercase prefixes (e.g., "lore", "cal", "npc", "term"). Variables will be accessed as [prefix:key] in articles.',
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Collection name (displayed in UI, can be changed)",
          },
          world_id: { type: "string", description: "World ID" },
          description: {
            type: "string",
            description:
              "Explain what variables belong here - helps future organization",
          },
          prefix: {
            type: "string",
            description:
              "PERMANENT: Short prefix for [prefix:key] syntax. Cannot change without breaking references.",
          },
        },
        required: ["title", "world_id"],
      },
    },
    {
      name: "worldanvil_update_variablecollection",
      description:
        "Update collection title or description. WARNING: Changing prefix breaks ALL [prefix:key] references in articles - avoid unless absolutely necessary.",
      inputSchema: {
        type: "object",
        properties: {
          collection_id: {
            type: "string",
            description: "Collection ID to update",
          },
          title: { type: "string" },
          description: { type: "string" },
          prefix: {
            type: "string",
            description: "DANGER: Changing this breaks all existing references",
          },
        },
        required: ["collection_id"],
      },
    },
    {
      name: "worldanvil_delete_variablecollection",
      description:
        "Delete a collection AND ALL ITS VARIABLES. This is destructive and cannot be undone. All [prefix:key] references in articles will break. Consider updating variables instead.",
      inputSchema: {
        type: "object",
        properties: {
          collection_id: {
            type: "string",
            description: "Collection ID to delete",
          },
        },
        required: ["collection_id"],
      },
    },

    // ===== VARIABLES =====
    {
      name: "worldanvil_get_variable",
      description:
        "Get a variable's key, value, type, and parent collection. Variables are reusable values for content that appears in multiple articles but doesn't warrant its own article page.",
      inputSchema: {
        type: "object",
        properties: {
          variable_id: { type: "string", description: "Variable ID" },
        },
        required: ["variable_id"],
      },
    },
    {
      name: "worldanvil_list_variables",
      description:
        'List variables in a collection. Call before creating to avoid duplicate keys. NAMING: Use lowercase_snake_case keys, keep short (they\'re typed in articles). Good: "current_year", "gold_value". Bad: "the_current_year_of_the_realm".',
      inputSchema: {
        type: "object",
        properties: {
          collection_id: {
            type: "string",
            description: "Variable collection ID",
          },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["collection_id"],
      },
    },
    {
      name: "worldanvil_create_variable",
      description:
        'Create a variable in a collection, referenced as [prefix:key] in articles. TYPE BEHAVIORS: "string" = title displays, value shows as HOVER TOOLTIP (for glossary/terms). "rendered" = value renders INLINE with BBCode support (for reusable formatted blocks). "link" = creates clickable hyperlink. "number" = numeric value. Use string for most cases.',
      inputSchema: {
        type: "object",
        properties: {
          collection_id: {
            type: "string",
            description: "Parent collection ID",
          },
          k: {
            type: "string",
            description:
              "Variable key (lowercase_snake_case, used in [prefix:key])",
          },
          type: {
            type: "string",
            description:
              '"string" (hover tooltip), "rendered" (inline BBCode), "link" (hyperlink), "number", "json"',
          },
          v: {
            type: "string",
            description:
              "Value - for string type this is the tooltip text; for rendered type this is BBCode that replaces the variable",
          },
          world_id: { type: "string", description: "World ID" },
        },
        required: ["collection_id", "k", "type", "v", "world_id"],
      },
    },
    {
      name: "worldanvil_update_variable",
      description:
        "Update a variable's value (safe) or key (breaks references). PREFER updating value over deleting - keeps references working. WARNING: Changing key breaks existing [prefix:oldkey] references.",
      inputSchema: {
        type: "object",
        properties: {
          variable_id: { type: "string", description: "Variable ID to update" },
          k: {
            type: "string",
            description: "New key - DANGER: breaks existing references",
          },
          v: { type: "string", description: "New value - safe to change" },
          type: { type: "string", description: "New type" },
        },
        required: ["variable_id"],
      },
    },
    {
      name: "worldanvil_delete_variable",
      description:
        "Delete a variable. All [prefix:key] references will break. PREFER updating the value to empty/placeholder instead - preserves reference structure for future use.",
      inputSchema: {
        type: "object",
        properties: {
          variable_id: { type: "string", description: "Variable ID to delete" },
        },
        required: ["variable_id"],
      },
    },

    // ===== MAP LAYERS =====
    {
      name: "worldanvil_get_layer",
      description:
        "Get a map layer by ID. Layers control visibility groupings on interactive maps (e.g., political borders, trade routes, terrain).",
      inputSchema: {
        type: "object",
        properties: {
          layer_id: { type: "string", description: "Map layer ID" },
        },
        required: ["layer_id"],
      },
    },
    {
      name: "worldanvil_list_layers",
      description: "List all layers on a map",
      inputSchema: {
        type: "object",
        properties: {
          map_id: { type: "string", description: "Map ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["map_id"],
      },
    },
    {
      name: "worldanvil_create_layer",
      description:
        "Create a new layer on a map. Layers let you toggle visibility of different marker groups.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Layer name" },
          map_id: {
            type: "string",
            description: "ID of the map this layer belongs to",
          },
        },
        required: ["title", "map_id"],
      },
    },
    {
      name: "worldanvil_update_layer",
      description: "Update a map layer",
      inputSchema: {
        type: "object",
        properties: {
          layer_id: { type: "string", description: "Layer ID" },
          title: { type: "string", description: "New layer name" },
        },
        required: ["layer_id"],
      },
    },
    {
      name: "worldanvil_delete_layer",
      description: "Delete a map layer",
      inputSchema: {
        type: "object",
        properties: {
          layer_id: { type: "string", description: "Layer ID to delete" },
        },
        required: ["layer_id"],
      },
    },

    // ===== MARKER GROUPS =====
    {
      name: "worldanvil_get_markergroup",
      description:
        "Get a marker group by ID. Marker groups organize map markers into logical collections (e.g., cities, dungeons, points of interest).",
      inputSchema: {
        type: "object",
        properties: {
          markergroup_id: { type: "string", description: "Marker group ID" },
        },
        required: ["markergroup_id"],
      },
    },
    {
      name: "worldanvil_list_markergroups",
      description: "List all marker groups on a map",
      inputSchema: {
        type: "object",
        properties: {
          map_id: { type: "string", description: "Map ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["map_id"],
      },
    },
    {
      name: "worldanvil_list_markers_in_group",
      description: "List all markers within a specific marker group",
      inputSchema: {
        type: "object",
        properties: {
          markergroup_id: { type: "string", description: "Marker group ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["markergroup_id"],
      },
    },
    {
      name: "worldanvil_create_markergroup",
      description: "Create a new marker group on a map",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Group name" },
          map_id: {
            type: "string",
            description: "ID of the map this group belongs to",
          },
        },
        required: ["title", "map_id"],
      },
    },
    {
      name: "worldanvil_update_markergroup",
      description: "Update a marker group",
      inputSchema: {
        type: "object",
        properties: {
          markergroup_id: { type: "string", description: "Marker group ID" },
          title: { type: "string", description: "New group name" },
        },
        required: ["markergroup_id"],
      },
    },
    {
      name: "worldanvil_delete_markergroup",
      description: "Delete a marker group",
      inputSchema: {
        type: "object",
        properties: {
          markergroup_id: {
            type: "string",
            description: "Marker group ID to delete",
          },
        },
        required: ["markergroup_id"],
      },
    },

    // ===== MARKER TYPES =====
    {
      name: "worldanvil_get_markertype",
      description:
        "Get a marker type (pin style) by ID. Marker types define custom icons and styling for map markers.",
      inputSchema: {
        type: "object",
        properties: {
          markertype_id: { type: "string", description: "Marker type ID" },
        },
        required: ["markertype_id"],
      },
    },
    {
      name: "worldanvil_list_markertypes",
      description: "List all available marker types (pin styles)",
      inputSchema: {
        type: "object",
        properties: {
          offset: { type: "number" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "worldanvil_create_markertype",
      description: "Create a new marker type (custom pin style) for maps",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Marker type name" },
        },
        required: ["title"],
      },
    },
    {
      name: "worldanvil_update_markertype",
      description: "Update a marker type",
      inputSchema: {
        type: "object",
        properties: {
          markertype_id: { type: "string", description: "Marker type ID" },
          title: { type: "string", description: "New name" },
        },
        required: ["markertype_id"],
      },
    },
    {
      name: "worldanvil_delete_markertype",
      description: "Delete a marker type",
      inputSchema: {
        type: "object",
        properties: {
          markertype_id: {
            type: "string",
            description: "Marker type ID to delete",
          },
        },
        required: ["markertype_id"],
      },
    },

    // ===== USERS =====
    {
      name: "worldanvil_get_user",
      description:
        "Get a user profile by ID. Use get_identity to get the current user; this is for looking up other users (e.g., co-authors in collaborative worlds).",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "User ID to look up" },
        },
        required: ["user_id"],
      },
    },
    {
      name: "worldanvil_update_user",
      description: "Update the current user's profile",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "User ID to update" },
          title: { type: "string", description: "Display name" },
        },
        required: ["user_id"],
      },
    },

    // ===== IMAGES (single resource) =====
    {
      name: "worldanvil_get_image",
      description:
        "Get a single image by ID with metadata (dimensions, URL, tags). Use list_images to find images first.",
      inputSchema: {
        type: "object",
        properties: {
          image_id: { type: "string", description: "Image ID" },
        },
        required: ["image_id"],
      },
    },
    {
      name: "worldanvil_update_image",
      description: "Update image metadata (title, tags, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          image_id: { type: "string", description: "Image ID to update" },
          title: { type: "string", description: "New image title" },
        },
        required: ["image_id"],
      },
    },
    {
      name: "worldanvil_delete_image",
      description: "Delete an image from WorldAnvil",
      inputSchema: {
        type: "object",
        properties: {
          image_id: { type: "string", description: "Image ID to delete" },
        },
        required: ["image_id"],
      },
    },

    // ===== MANUSCRIPT VERSIONS =====
    {
      name: "worldanvil_get_manuscriptversion",
      description:
        "Get a manuscript version (draft) by ID. Versions represent different drafts of a manuscript.",
      inputSchema: {
        type: "object",
        properties: {
          version_id: { type: "string", description: "Manuscript version ID" },
        },
        required: ["version_id"],
      },
    },
    {
      name: "worldanvil_list_manuscriptversions",
      description: "List all versions (drafts) of a manuscript",
      inputSchema: {
        type: "object",
        properties: {
          manuscript_id: { type: "string", description: "Manuscript ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["manuscript_id"],
      },
    },
    {
      name: "worldanvil_create_manuscriptversion",
      description: "Create a new version (draft) of a manuscript",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Version/draft title" },
          manuscript_id: {
            type: "string",
            description: "Parent manuscript ID",
          },
        },
        required: ["title", "manuscript_id"],
      },
    },
    {
      name: "worldanvil_update_manuscriptversion",
      description: "Update a manuscript version",
      inputSchema: {
        type: "object",
        properties: {
          version_id: { type: "string", description: "Version ID" },
          title: { type: "string", description: "New title" },
        },
        required: ["version_id"],
      },
    },
    {
      name: "worldanvil_delete_manuscriptversion",
      description: "Delete a manuscript version",
      inputSchema: {
        type: "object",
        properties: {
          version_id: { type: "string", description: "Version ID to delete" },
        },
        required: ["version_id"],
      },
    },

    // ===== MANUSCRIPT PARTS =====
    {
      name: "worldanvil_get_manuscriptpart",
      description:
        "Get a manuscript part (chapter/section) by ID. Parts are the chapters or sections within a manuscript version.",
      inputSchema: {
        type: "object",
        properties: {
          part_id: { type: "string", description: "Manuscript part ID" },
        },
        required: ["part_id"],
      },
    },
    {
      name: "worldanvil_list_manuscriptparts",
      description: "List all parts (chapters/sections) in a manuscript version",
      inputSchema: {
        type: "object",
        properties: {
          version_id: {
            type: "string",
            description: "Manuscript version ID",
          },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["version_id"],
      },
    },
    {
      name: "worldanvil_create_manuscriptpart",
      description:
        "Create a new part (page or chapter) in a manuscript version. A part holds no text itself: add the writing with worldanvil_create_manuscriptbeat.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Chapter/section title" },
          version_id: {
            type: "string",
            description: "Parent manuscript version ID",
          },
          type: {
            type: "string",
            description:
              'Part type (default "manuscript", a text page; the only value World Anvil documents)',
          },
        },
        required: ["title", "version_id"],
      },
    },
    {
      name: "worldanvil_update_manuscriptpart",
      description: "Update a manuscript part (chapter/section)",
      inputSchema: {
        type: "object",
        properties: {
          part_id: { type: "string", description: "Part ID" },
          title: { type: "string", description: "New title" },
          content: {
            type: "string",
            description: "New content (Markdown auto-converted to BBCode)",
          },
        },
        required: ["part_id"],
      },
    },
    {
      name: "worldanvil_delete_manuscriptpart",
      description: "Delete a manuscript part",
      inputSchema: {
        type: "object",
        properties: {
          part_id: { type: "string", description: "Part ID to delete" },
        },
        required: ["part_id"],
      },
    },

    // ===== MANUSCRIPT BEATS =====
    {
      name: "worldanvil_get_manuscriptbeat",
      description:
        "Get a manuscript beat by ID. Beats are scene-level story elements within a manuscript part (chapter).",
      inputSchema: {
        type: "object",
        properties: {
          beat_id: { type: "string", description: "Manuscript beat ID" },
        },
        required: ["beat_id"],
      },
    },
    {
      name: "worldanvil_list_manuscriptbeats",
      description: "List all beats (scenes) in a manuscript part (chapter)",
      inputSchema: {
        type: "object",
        properties: {
          part_id: { type: "string", description: "Manuscript part ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["part_id"],
      },
    },
    {
      name: "worldanvil_create_manuscriptbeat",
      description:
        "Create a new beat in a manuscript part. Beats hold the part's text. Content supports Markdown.",
      inputSchema: {
        type: "object",
        properties: {
          part_id: {
            type: "string",
            description: "Parent manuscript part ID",
          },
          content: {
            type: "string",
            description: "Beat content (Markdown auto-converted to BBCode)",
          },
          title: {
            type: "string",
            description: "Beat title (optional; not in World Anvil's documented fields)",
          },
        },
        required: ["part_id", "content"],
      },
    },
    {
      name: "worldanvil_update_manuscriptbeat",
      description: "Update a manuscript beat",
      inputSchema: {
        type: "object",
        properties: {
          beat_id: { type: "string", description: "Beat ID" },
          title: { type: "string", description: "New title" },
          content: {
            type: "string",
            description: "New content (Markdown auto-converted to BBCode)",
          },
        },
        required: ["beat_id"],
      },
    },
    {
      name: "worldanvil_delete_manuscriptbeat",
      description: "Delete a manuscript beat",
      inputSchema: {
        type: "object",
        properties: {
          beat_id: { type: "string", description: "Beat ID to delete" },
        },
        required: ["beat_id"],
      },
    },

    // ===== MANUSCRIPT BOOKMARKS =====
    {
      name: "worldanvil_get_manuscriptbookmark",
      description:
        "Get a manuscript bookmark by ID. Bookmarks are quick-access points within a manuscript.",
      inputSchema: {
        type: "object",
        properties: {
          bookmark_id: {
            type: "string",
            description: "Manuscript bookmark ID",
          },
        },
        required: ["bookmark_id"],
      },
    },
    {
      name: "worldanvil_list_manuscriptbookmarks",
      description: "List all bookmarks in a manuscript",
      inputSchema: {
        type: "object",
        properties: {
          manuscript_id: { type: "string", description: "Manuscript ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["manuscript_id"],
      },
    },
    {
      name: "worldanvil_create_manuscriptbookmark",
      description: "Create a new bookmark in a manuscript",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Bookmark title" },
          manuscript_id: {
            type: "string",
            description: "Parent manuscript ID",
          },
        },
        required: ["title", "manuscript_id"],
      },
    },
    {
      name: "worldanvil_update_manuscriptbookmark",
      description: "Update a manuscript bookmark",
      inputSchema: {
        type: "object",
        properties: {
          bookmark_id: { type: "string", description: "Bookmark ID" },
          title: { type: "string", description: "New title" },
        },
        required: ["bookmark_id"],
      },
    },
    {
      name: "worldanvil_delete_manuscriptbookmark",
      description: "Delete a manuscript bookmark",
      inputSchema: {
        type: "object",
        properties: {
          bookmark_id: {
            type: "string",
            description: "Bookmark ID to delete",
          },
        },
        required: ["bookmark_id"],
      },
    },

    // ===== MANUSCRIPT TAGS =====
    {
      name: "worldanvil_get_manuscripttag",
      description:
        "Get a manuscript tag by ID. Tags categorize and organize content within manuscripts.",
      inputSchema: {
        type: "object",
        properties: {
          tag_id: { type: "string", description: "Manuscript tag ID" },
        },
        required: ["tag_id"],
      },
    },
    {
      name: "worldanvil_list_manuscripttags",
      description: "List all tags in a manuscript",
      inputSchema: {
        type: "object",
        properties: {
          manuscript_id: { type: "string", description: "Manuscript ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["manuscript_id"],
      },
    },
    {
      name: "worldanvil_create_manuscripttag",
      description: "Create a new tag in a manuscript",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Tag name" },
          manuscript_id: {
            type: "string",
            description: "Parent manuscript ID",
          },
        },
        required: ["title", "manuscript_id"],
      },
    },
    {
      name: "worldanvil_update_manuscripttag",
      description: "Update a manuscript tag",
      inputSchema: {
        type: "object",
        properties: {
          tag_id: { type: "string", description: "Tag ID" },
          title: { type: "string", description: "New tag name" },
        },
        required: ["tag_id"],
      },
    },
    {
      name: "worldanvil_delete_manuscripttag",
      description: "Delete a manuscript tag",
      inputSchema: {
        type: "object",
        properties: {
          tag_id: { type: "string", description: "Tag ID to delete" },
        },
        required: ["tag_id"],
      },
    },

    // ===== MANUSCRIPT STATS =====
    {
      name: "worldanvil_get_manuscriptstat",
      description:
        "Get a manuscript stat by ID. Stats track word counts, progress, and other metrics for a manuscript version.",
      inputSchema: {
        type: "object",
        properties: {
          stat_id: { type: "string", description: "Manuscript stat ID" },
        },
        required: ["stat_id"],
      },
    },
    {
      name: "worldanvil_list_manuscriptstats",
      description: "List all stats for a manuscript version",
      inputSchema: {
        type: "object",
        properties: {
          version_id: {
            type: "string",
            description: "Manuscript version ID",
          },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["version_id"],
      },
    },
    {
      name: "worldanvil_create_manuscriptstat",
      description: "Create a new stat entry for a manuscript version",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Stat name" },
          version_id: {
            type: "string",
            description: "Parent manuscript version ID",
          },
          notes: { type: "string", description: "Notes (optional)" },
        },
        required: ["title", "version_id"],
      },
    },
    {
      name: "worldanvil_update_manuscriptstat",
      description: "Update a manuscript stat",
      inputSchema: {
        type: "object",
        properties: {
          stat_id: { type: "string", description: "Stat ID" },
          title: { type: "string", description: "New stat name" },
        },
        required: ["stat_id"],
      },
    },
    {
      name: "worldanvil_delete_manuscriptstat",
      description: "Delete a manuscript stat",
      inputSchema: {
        type: "object",
        properties: {
          stat_id: { type: "string", description: "Stat ID to delete" },
        },
        required: ["stat_id"],
      },
    },

    // ===== MANUSCRIPT LABELS =====
    {
      name: "worldanvil_get_manuscriptlabel",
      description:
        "Get a manuscript label by ID. Labels provide color-coded categorization for manuscript content.",
      inputSchema: {
        type: "object",
        properties: {
          label_id: { type: "string", description: "Manuscript label ID" },
        },
        required: ["label_id"],
      },
    },
    {
      name: "worldanvil_list_manuscriptlabels",
      description: "List all labels in a manuscript",
      inputSchema: {
        type: "object",
        properties: {
          manuscript_id: { type: "string", description: "Manuscript ID" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["manuscript_id"],
      },
    },
    {
      name: "worldanvil_create_manuscriptlabel",
      description: "Create a new label in a manuscript",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Label name" },
          manuscript_id: {
            type: "string",
            description: "Parent manuscript ID",
          },
          color: {
            type: "string",
            description: 'Label color (e.g., "#FF5733" or color name)',
          },
        },
        required: ["title", "manuscript_id"],
      },
    },
    {
      name: "worldanvil_update_manuscriptlabel",
      description: "Update a manuscript label",
      inputSchema: {
        type: "object",
        properties: {
          label_id: { type: "string", description: "Label ID" },
          title: { type: "string", description: "New label name" },
          color: { type: "string", description: "New label color" },
        },
        required: ["label_id"],
      },
    },
    {
      name: "worldanvil_delete_manuscriptlabel",
      description: "Delete a manuscript label",
      inputSchema: {
        type: "object",
        properties: {
          label_id: { type: "string", description: "Label ID to delete" },
        },
        required: ["label_id"],
      },
    },

    // ===== MANUSCRIPT PLOTS =====
    {
      name: "worldanvil_get_manuscriptplot",
      description:
        "Get a manuscript plot by ID. Plots track narrative threads across manuscript parts.",
      inputSchema: {
        type: "object",
        properties: {
          plot_id: { type: "string", description: "Manuscript plot ID" },
        },
        required: ["plot_id"],
      },
    },
    {
      name: "worldanvil_list_manuscriptplots",
      description: "List all plot threads in a manuscript version",
      inputSchema: {
        type: "object",
        properties: {
          version_id: {
            type: "string",
            description: "Manuscript version ID",
          },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["version_id"],
      },
    },
    {
      name: "worldanvil_create_manuscriptplot",
      description: "Create a new plot thread in a manuscript version",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Plot thread name" },
          version_id: {
            type: "string",
            description: "Parent manuscript version ID",
          },
        },
        required: ["title", "version_id"],
      },
    },
    {
      name: "worldanvil_update_manuscriptplot",
      description: "Update a manuscript plot thread",
      inputSchema: {
        type: "object",
        properties: {
          plot_id: { type: "string", description: "Plot ID" },
          title: { type: "string", description: "New plot name" },
        },
        required: ["plot_id"],
      },
    },
    {
      name: "worldanvil_delete_manuscriptplot",
      description: "Delete a manuscript plot thread",
      inputSchema: {
        type: "object",
        properties: {
          plot_id: { type: "string", description: "Plot ID to delete" },
        },
        required: ["plot_id"],
      },
    },
  ];
}
