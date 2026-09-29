#!/usr/bin/env node

/**
 * World Anvil MCP Server
 *
 * Provides MCP tools for interacting with the World Anvil API from Claude Code.
 *
 * Environment variables:
 *   WA_AUTH_TOKEN   - Your World Anvil User Authentication Token (required)
 *   WA_APP_KEY      - Your own World Anvil Application Key (required). This
 *                     fork has no proxy mode and never uses anyone else's key.
 *   WA_TOOL_GROUPS  - Comma-separated tool groups or preset to load (optional;
 *                     defaults to 'all'). Reduces context overhead for LLMs.
 *                     Groups: core, content, images, campaign, maps, timeline,
 *                             blocks, manuscripts, canvas, variables, social, rpg
 *                     Presets: all, standard, worldbuilding, writing, gamemaster
 *
 * Changelog:
 *   v1.11.0 - Add 73 new tools (map layers/groups/types, manuscript sub-resources,
 *             user/image CRUD), tool group filtering via WA_TOOL_GROUPS env var
 *   v1.3.0 - Modular refactor, added Blocks/BlockFolders/Manuscripts, test infrastructure
 *   v1.2.0 - Improved template docs, better error messages, ordered list support
 *   v1.1.1 - Fixed PATCH endpoints to use query params
 *   v1.1.0 - Added automatic Markdown to BBCode conversion
 *   v1.0.1 - Added template-specific fields support, fixed world reference format
 *   v1.0.0 - Initial release with basic CRUD operations
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./src/server.js";

// Validate environment variables: both of YOUR keys are required, and no
// proxy is allowed, so requests only ever go to World Anvil itself.
const APP_KEY = process.env.WA_APP_KEY;
const AUTH_TOKEN = process.env.WA_AUTH_TOKEN;

if (process.env.WA_PROXY_URL) {
  console.error(
    "Error: WA_PROXY_URL is not supported. This server only talks to World Anvil directly.",
  );
  process.exit(1);
}

if (!AUTH_TOKEN || !APP_KEY) {
  console.error(
    "Error: both WA_AUTH_TOKEN (your user token) and WA_APP_KEY (your own " +
      "application key) must be set. See README: 'You need two keys'.",
  );
  process.exit(1);
}

const TOOL_GROUPS = process.env.WA_TOOL_GROUPS;
if (TOOL_GROUPS && TOOL_GROUPS.toLowerCase() !== "all") {
  console.error(
    `Info: WA_TOOL_GROUPS=${TOOL_GROUPS} — loading subset of tools`,
  );
}

/**
 * Start the server
 */
async function main() {
  const { server } = createServer({
    appKey: APP_KEY,
    authToken: AUTH_TOKEN,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("World Anvil MCP server running on stdio");
}

main().catch((error) => {
  // Settings problems are explained in plain words; anything else gets detail.
  console.error(
    error?.name === "AccessConfigError" ? `Error: ${error.message}` : ["Fatal error:", error].join(" "),
  );
  process.exit(1);
});
