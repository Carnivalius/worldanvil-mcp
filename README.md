> ⚠️ **Work in progress: please don't use this yet.**
> This fork is still being built and hasn't yet been tested against a real World Anvil account. Until testing is finished, it could change or delete content in ways it shouldn't. Please wait for the first release before connecting it to worlds you care about. If you want a working World Anvil MCP today, the original [worldanvil-mcp](https://github.com/wlcarden/worldanvil-mcp) is available.

# World Anvil MCP: a writer-focused fork

An MCP server that connects AI assistants (Claude Desktop, Claude Code, Open WebUI and other MCP clients) to your own [World Anvil](https://www.worldanvil.com/) worlds, so they can help with the work *around* your writing: keeping track of lore, spotting contradictions, and supporting the editorial process.

## Who it's for

It's built for writers who write their own stories and want an assistant to:

- **keep track of lore:** find what you've already established about a place, person or event;
- **spot conflicts:** check a new chapter or article against your existing notes;
- **help with editing and organising:** file chapters into manuscripts in the right order, tidy articles, suggest links between them.

It isn't designed for having AI write your main prose, and its tools lean the other way: chapter text is stored exactly as you wrote it.

## Why this fork exists

This project builds on [worldanvil-mcp](https://github.com/wlcarden/worldanvil-mcp) by Leighton Carden. We've used and loved his tool, which did the hard work of connecting AI to World Anvil in the first place, and this fork wouldn't exist without it. Thank you.

What this fork adds comes from a very ordinary fear: losing work. After many hours of writing, having something deleted or overwritten with no way back is soul-destroying. So this fork adds a layer of care and responsibility:

- **You decide what the AI can touch.** Each world can be full edit, edit only (no deleting), read only, or completely off-limits, so private or finished work stays exactly as you left it.
- **Mistakes can be undone.** Before anything is changed or deleted, a copy is saved on your own computer.
- **Your writing goes straight to World Anvil.** Requests go directly to World Anvil with your own keys, with nothing in between.
- **It plays by World Anvil's rules.** Your own application key, clear identification of the app, personal and non-commercial use, and nothing that sidesteps membership tiers.

These choices change how the tool works quite fundamentally, so this is maintained as a separate project rather than as changes to the original. Both have their place.

### What the safety features are, and aren't

Access levels and backups are a **safety net for honest mistakes**: an AI misreading an instruction, an edit landing on the wrong article, a chapter overwritten by accident. They're there so an accident is unlikely, and if one happens, you can get your work back.

They are **not a security barrier** against a person or program deliberately trying to cause harm. Anyone with access to your computer could change the settings. That risk is managed by the keys: the tool only works with **your own** World Anvil user token and **your own** application key, so keep both private.

## At a glance

- **Your own two keys** (user token and application key) are required; the server won't start without both.
- **Direct to World Anvil only:** no proxies, no third-party servers.
- **Per-world access levels:** full edit, edit only, read only or blocked (see [World access settings](#world-access-settings)).
- **Automatic local backups** before every edit or delete.
- **A focused toolset:** no account, image-library or subscriber-group tools.
- **Not published to npm:** install from this repository.

## You need two keys

World Anvil's API requires **both** of these on every request:

1. **User API token** (`WA_AUTH_TOKEN`): says which account the request is for. Create one on your [User API Tokens](https://www.worldanvil.com/api/auth/key) page. Treat it like a password.
2. **Application key** (`WA_APP_KEY`): says which app is making the request. Request your own from the same page using the **Application Key Form**. World Anvil currently issues application keys to **Grandmaster** members and above, and reviews each request by hand.

The server refuses to start unless both are set.

### Never share keys

- **Do not share your application key** or use anyone else's. Each user of this fork needs their own. Running a shared key for other people turns you into a proxy operator, which is a grey area under World Anvil's API licence (non-commercial use, and no getting round membership-tier limits).
- **Do not commit keys.** Keep them in your MCP client's config or a local `.env` file (gitignored). This repository contains no keys and never will.
- If a token may have leaked, delete it on the User API Tokens page and create a new one.

## Installation

Clone this repository and install dependencies:

```bash
git clone https://github.com/Carnivalius/worldanvil-mcp.git
cd worldanvil-mcp/plugins/worldbuilding/worldanvil-mcp
npm ci
```

Then point your MCP client at `index.js`. For example, in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "worldanvil": {
      "command": "node",
      "args": ["/absolute/path/to/worldanvil-mcp/plugins/worldbuilding/worldanvil-mcp/index.js"],
      "env": {
        "WA_AUTH_TOKEN": "your-user-api-token",
        "WA_APP_KEY": "your-own-application-key"
      }
    }
  }
}
```

**Do not use `npx worldanvil-mcp`.** That runs the original package from npm, not this fork.

**During development** the server refuses to start unless `WA_I_ACCEPT_UNTESTED=1` is set, and prints a warning. Please don't set it unless you are helping to test. This lock will be removed at the first release.

More detail (tools, features, development and tests) is in [plugins/worldbuilding/worldanvil-mcp/README.md](plugins/worldbuilding/worldanvil-mcp/README.md).

## World access settings

This fork lets you decide exactly what the tool (and any AI using it) may do in each of your worlds, so nothing is changed by accident.

### Where the settings live

A JSON file **outside this repository**: `~/.worldanvil-mcp/access.json` by default (on Windows, `C:\Users\<you>\.worldanvil-mcp\access.json`), or wherever `WA_ACCESS_FILE` points.

- **First run, no file:** the server prints a loud warning and creates this starter file, then carries on:

  ```json
  {
    "world_list": {},
    "allow_only": false,
    "default_access": "full_edit",
    "allow_create_worlds": true,
    "allow_delete_worlds": false,
    "new_world_access": "full_edit",
    "item_backup_keep": 10,
    "world_backup_keep": 5,
    "allow_blocked_backup": false
  }
  ```

  That means full access to every world until you edit it.
- **`WA_ACCESS_FILE` set but the file is missing:** the server refuses to start (a typo in the path must never create an unrestricted file somewhere unexpected).
- Changes take effect when the server restarts.

### Access levels

| Level | Read | Create | Edit | Delete |
|---|---|---|---|---|
| `full_edit` | ✅ | ✅ | ✅ | ✅ |
| `edit_only` | ✅ | ✅ | ✅ | ❌ |
| `read_only` | ✅ | ❌ | ❌ | ❌ |
| `blocked` | ❌ | ❌ | ❌ | ❌ |

A level covers everything inside the world: articles, categories, manuscripts, chapters and so on. Adding a new item counts as a change.

### How a world's level is decided

1. Listed in `world_list` → that level.
2. Not listed and `"allow_only": true` → refused ("not on your allow list").
3. Not listed and `"allow_only": false` → `default_access` (which can't be `blocked`).

Every refusal explains why, for example *"Access denied: 'Old Campaign' is read_only in your access settings, so I can't change it."*

### Settings

| Setting | Default | Meaning |
|---|---|---|
| `world_list` | `{}` | Each world's level, by world **name or id**: `full_edit`, `edit_only`, `read_only` or `blocked` |
| `allow_only` | `false` | `true`: only worlds in `world_list` are accessible |
| `default_access` | `full_edit` | Level for unlisted worlds when `allow_only` is `false` |
| `allow_create_worlds` | `true` | Offer the create-world tool. The AI must ask you the new world's level first; the world is then added to `world_list` at that level |
| `allow_delete_worlds` | `false` | Offer the delete-world tool. The world must also be `full_edit`, and it is fully backed up first *(world backups are still being built, so world deletion is currently always refused)* |
| `new_world_access` | `full_edit` | Suggested level for new worlds |
| `item_backup_keep` | `10` | Backups kept per item (before-edit / before-delete copies) |
| `world_backup_keep` | `5` | Full world backups kept per world *(coming soon)* |
| `allow_blocked_backup` | `false` | Allow full backups of `blocked` worlds to your disk *(coming soon)* |

### Examples

Edit everything except two worlds, which the tool can't even read:

```json
{
  "world_list": { "Old Campaign": "blocked", "Private Journal": "blocked" }
}
```

Only see four worlds, two of them read-only:

```json
{
  "allow_only": true,
  "world_list": {
    "My Epic Saga": "full_edit",
    "Side Stories": "edit_only",
    "Series Bible": "read_only",
    "Map Notes": "read_only"
  }
}
```

No deleting anywhere, but otherwise free to write:

```json
{
  "default_access": "edit_only"
}
```

Settings you leave out use their defaults.

### Safety rules that always apply

- **The server won't start** if the file is invalid: bad JSON (including `True` instead of `true`), an unknown setting or level, a world listed twice, a name matching no world or several (use the world's id instead), `default_access` or `new_world_access` set to `blocked`, or a backup count below 1. It tells you exactly what to fix.
- **Fail closed:** if the server can't tell which world an item belongs to, the request is refused.
- **No cross-world changes:** items can't be moved to, or linked with items in, another world.
- **Backups before every edit or delete:** the item's previous state is saved to `backups/` next to your settings file, dated, read-only, keeping the newest `item_backup_keep` copies per item. If a backup can't be made, the change is refused.
- **Renaming worlds** isn't supported yet.
- **List worlds** shows every world with its level, including blocked ones (by name only), so a blocked world never looks deleted.
- **Not offered at all:** account changes, the image library, and subscriber groups (who can see your content).
- To check which world an item belongs to, the server may look the item up. The content of a blocked item is never passed on.

### What this protects against

It stops the tool, and any AI using it, from going beyond your settings. It does not stop a person (or an AI with direct access to your files) from editing the settings file itself, so keep that file under your own control.

## World Anvil API licence

World Anvil's API may not be used for any commercial project without their permission, and access can be withdrawn if an application breaks their Terms of Service or gets round membership-tier feature locks. See the [API documentation](https://www.worldanvil.com/api/external/boromir/documentation#licence-section). This fork is for personal, non-commercial use.

## Licence

MIT. See [LICENSE](LICENSE). Original work © Leighton Carden; fork changes © Carnivalius.
