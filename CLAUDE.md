# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is a monorepo. The actual MCP server package lives at `plugins/worldbuilding/worldanvil-mcp/`. All development commands run from that subdirectory.

```
plugins/worldbuilding/worldanvil-mcp/   ← main package (independent fork, not published to npm)
  index.js                              ← entry point, starts stdio transport (requires both keys)
  src/
    server.js                           ← MCP server factory
    tools.js                            ← tool schema definitions (90+ tools)
    handlers.js                         ← tool call dispatch (switch on tool name)
    api-client.js                       ← WorldAnvilClient HTTP wrapper
    utils.js                            ← Markdown→BBCode conversion
  test/                                 ← vitest tests (offline)
  test/live/harness/                    ← safety harness for live tests
  CLAUDE.md                             ← worldbuilding guidance for MCP users (not devs)
```

## Commands

All commands run from `plugins/worldbuilding/worldanvil-mcp/`:

```bash
npm start            # run the MCP server
npm run dev          # run with --watch (auto-restart on changes)
npm test             # run all tests
npm run test:watch   # run tests in watch mode
npm run test:coverage  # run tests with coverage report
```

To run a single test file:
```bash
npx vitest run test/utils.test.js
```

`npm test` never touches the network. Live tests use `npm run test:live` via the safety harness (see below). Upstream's own integration tests additionally require `WA_RUN_UPSTREAM_LIVE_TESTS=1`.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `WA_AUTH_TOKEN` | Always | User's own World Anvil user API token |
| `WA_APP_KEY` | Always | User's own World Anvil application key (no proxy mode in this fork) |
| `WA_I_ACCEPT_UNTESTED` | Dev only | Must be `1` for index.js to start while the fork is untested (lock removed at first release) |
| `WA_ACCESS_FILE` | Optional | Path to the world access settings (default `~/.worldanvil-mcp/access.json`; must exist if set) |
| `WA_TOOL_GROUPS` | Optional | Comma-separated tool groups or preset to load (default: all). Groups: core, content, images, campaign, maps, timeline, blocks, manuscripts, canvas, variables, social, rpg. Presets: all, standard, worldbuilding, writing, gamemaster |

## Architecture

**Direct mode only** (independent fork): the client always calls `www.worldanvil.com/api/external/boromir` with both `x-application-key` and `x-auth-token`. There is no proxy mode; `WA_PROXY_URL` is refused and the server exits unless both keys are set. Never add third-party hosts, proxies or shared keys.

**Request flow**: `index.js` → `createServer()` in `server.js` → registers two MCP handlers (list tools, call tool) → `handleToolCall()` in `handlers.js` dispatches by tool name → `WorldAnvilClient` methods in `api-client.js`. Every request passes through `src/access/guard.js` (`WorldAccess.check`) first: per-world access levels from the user's settings file, id validation, cross-world checks, and a local backup (`src/access/backup.js`) before any edit/delete. Never bypass it or call the raw transport directly.

**Adding a new tool** requires changes in three files:
1. `tools.js` — add the JSON schema definition
2. `handlers.js` — add a `case` in the switch statement
3. `api-client.js` — add the HTTP method on `WorldAnvilClient`

**Markdown→BBCode**: Article `content` fields and other text fields are automatically converted via `markdownToBBCode()` in `utils.js`. The function is called in handlers before sending to the API. WorldAnvil does not render Markdown natively.

**Known API quirks** (discovered through testing, documented in `api-client.js`):
- Swagger shows `/variable_collection` but the live API uses `/variablecollection`
- Variable creation requires nested `{ id: ... }` objects despite Swagger showing flat fields
- List endpoints use `POST` with a body (not `GET` with query params)
- Rate limiting: space API calls ~750ms apart to avoid Cloudflare 429s

## Live tests and safety

`npm test` is offline only. Live tests (`npm run test:live`, `WA_TEST_STAGE=read|create|update|delete`) must go through the harness in `test/live/harness/`: it protects every pre-existing world and only allows touching `MCP-TEST-` items recorded in the gitignored ledger. Never weaken it, never commit `.env.test`, `test-ledger.json` or `protected-worlds.json`, and never put real world names, IDs or content in code, tests, commits or PRs.
