/**
 * World Anvil MCP Server - Server Factory
 *
 * Creates and configures the MCP server instance.
 */

import { createRequire } from "module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json");

import { WorldAnvilClient } from "./api-client.js";
import { getToolDefinitions } from "./tools.js";
import { handleToolCall } from "./handlers.js";
import { parseToolGroups, filterTools } from "./tool-groups.js";
import { loadSettings } from "./access/config.js";
import { WorldAccess, guardClient } from "./access/guard.js";

/**
 * Tools this fork never offers: account changes, the image library,
 * subscriber groups (who can see your content) and world renaming.
 */
export const ALWAYS_DISABLED_TOOLS = new Set([
  "worldanvil_get_user",
  "worldanvil_update_user",
  "worldanvil_update_world",
  "worldanvil_list_images",
  "worldanvil_get_image",
  "worldanvil_update_image",
  "worldanvil_delete_image",
  "worldanvil_get_subscribergroup",
  "worldanvil_list_subscribergroups",
  "worldanvil_create_subscribergroup",
  "worldanvil_update_subscribergroup",
  "worldanvil_delete_subscribergroup",
]);

/**
 * The tools actually offered, given the tool-group filter and the user's
 * world access settings. Tools that are switched off are not listed at all.
 */
export function visibleTools(settings, enabledGroups) {
  return filterTools(getToolDefinitions(), enabledGroups)
    .filter((t) => !ALWAYS_DISABLED_TOOLS.has(t.name))
    .filter((t) => t.name !== "worldanvil_create_world" || settings.allow_create_worlds)
    .filter((t) => t.name !== "worldanvil_delete_world" || settings.allow_delete_worlds)
    .map((t) =>
      t.name === "worldanvil_create_world"
        ? {
            ...t,
            description:
              `${t.description} Before calling, ask the user which access level the new ` +
              `world should have (suggested: ${settings.new_world_access}). The world is ` +
              `added to their access settings at that level.`,
          }
        : t,
    );
}

/** Missing required arguments, per the tool's input schema. */
export function missingArgs(tool, args) {
  return (tool.inputSchema?.required ?? []).filter(
    (k) => args[k] === undefined || args[k] === null || args[k] === "",
  );
}

/**
 * Server configuration options
 * @typedef {Object} ServerConfig
 * @property {string} [appKey] - World Anvil Application Key (defaults to WA_APP_KEY env var)
 * @property {string} [authToken] - World Anvil Auth Token (defaults to WA_AUTH_TOKEN env var)
 * @property {string} [toolGroups] - Comma-separated tool groups or preset (defaults to WA_TOOL_GROUPS env var)
 * @property {{settings: object, file: string}} [access] - world access settings (default: loaded from file)
 * @property {string} [name='worldanvil-mcp'] - Server name
 * @property {string} [version] - Server version (defaults to package.json version)
 */

/**
 * Create and configure a World Anvil MCP server
 *
 * @param {ServerConfig} [config={}] - Server configuration
 * @returns {{ server: Server, client: WorldAnvilClient, access: WorldAccess }}
 */
export function createServer(config = {}) {
  const client = new WorldAnvilClient({
    appKey: config.appKey,
    authToken: config.authToken,
  });

  const { settings, file } = config.access ?? loadSettings();
  const access = new WorldAccess({ settings, file });
  guardClient(client, access);

  // Parse tool group filter (env var or config)
  const enabledGroups = parseToolGroups(
    config.toolGroups || process.env.WA_TOOL_GROUPS,
  );
  const tools = () => visibleTools(access.settings, enabledGroups);

  const server = new Server(
    {
      name: config.name || "worldanvil-mcp",
      version: config.version || PKG_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools() };
  });

  // Only offered tools can be called, and required arguments must be present.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    const tool = tools().find((t) => t.name === name);
    if (!tool)
      return {
        content: [
          {
            type: "text",
            text: `Error: Unknown tool: ${name} (it doesn't exist, or is switched off by your settings)`,
          },
        ],
        isError: true,
      };
    const missing = missingArgs(tool, args ?? {});
    if (missing.length)
      return {
        content: [{ type: "text", text: `Error: missing required argument(s): ${missing.join(", ")}` }],
        isError: true,
      };
    return handleToolCall(name, args ?? {}, client);
  });

  return { server, client, access };
}

/**
 * Re-export modules for testing and direct use
 */
export { WorldAnvilClient } from "./api-client.js";
export { getToolDefinitions } from "./tools.js";
export { handleToolCall } from "./handlers.js";
export { markdownToBBCode, convertFieldsToBBCode } from "./utils.js";
export { parseToolGroups, filterTools } from "./tool-groups.js";
