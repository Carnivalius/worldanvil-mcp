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
import { parseToolGroups, filterTools, toolAction } from "./tool-groups.js";
import { backupFolderFor, loadSettings } from "./access/config.js";
import { WorldAccess, guardClient, actionsAnyWorldAllows } from "./access/guard.js";
import { Backups } from "./access/backup.js";
import { dirname, isAbsolute, join } from "path";

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
  const missing = actionsNotLoaded(settings);
  return filterTools(getToolDefinitions(), enabledGroups)
    .filter((t) => !ALWAYS_DISABLED_TOOLS.has(t.name))
    .filter((t) => t.name !== "worldanvil_create_world" || settings.allow_create_worlds)
    .filter((t) => t.name !== "worldanvil_delete_world" || settings.allow_delete_worlds)
    // A tool no world's access level could let through is not listed: it
    // would only take up room and be refused. The two world tools above
    // have their own switches.
    .filter((t) => WORLD_SWITCH_TOOLS.has(t.name) || !missing.includes(toolAction(t.name)))
    .map((t) => {
      if (t.name === "worldanvil_create_world")
        return {
          ...t,
          description:
            `${t.description} Before calling, ask the user which access level the new ` +
            `world should have (suggested: ${settings.new_world_access}). The world is ` +
            `added to their access settings at that level.`,
        };
      if (t.name === "worldanvil_list_worlds" && missing.length)
        return { ...t, description: `${t.description} ${notLoadedNote(missing)}` };
      return t;
    });
}

/** The two tools switched by their own settings, not by a world's level. */
const WORLD_SWITCH_TOOLS = new Set(["worldanvil_create_world", "worldanvil_delete_world"]);

const ACTION_TOOL_WORDS = { create: "creating", update: "changing", delete: "deleting" };

/** The write actions no world could be allowed under these settings. */
export function actionsNotLoaded(settings) {
  const allowed = actionsAnyWorldAllows(settings);
  return ["create", "update", "delete"].filter((a) => !allowed.includes(a));
}

/** One sentence for the session: which kinds of tool are absent, and why. */
export function notLoadedNote(missing) {
  if (!missing.length) return "";
  const kinds = missing.map((a) => ACTION_TOOL_WORDS[a]);
  const list = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}` : kinds[0];
  return (
    `In this session the tools for ${list} items are not loaded, because no world's access level allows it. ` +
    "If the user changes their access settings, a new session is needed to load them."
  );
}

/**
 * Sent to every session when it connects, so the access check is not
 * something a session has to stumble on.
 */
export const SERVER_INSTRUCTIONS =
  "Before planning any change to a World Anvil world, call worldanvil_list_worlds. Each world carries `access`, " +
  "the level the user's own settings give it: full_edit (read, create, change, delete), edit_only (no deleting), " +
  "read_only (read only), blocked or \"not on allow list\" (nothing). Plan only what the level allows, and say so " +
  "early if it does not allow what the user asked for. Tools that no world's level could use are not loaded in the " +
  "session. Only the user can change a level, in their settings file; the server reads it when it starts, so a " +
  "changed level needs a new session. A refusal that starts \"Access denied\" is the user's settings at work: " +
  "report it, do not look for a way round.";

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
 * @property {{settings: object, file: string, backupDir?: string}} [access] - world access settings (default: loaded from file)
 * @property {Function} [transport] - underlying request sender (tests/harness only)
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

  const { settings, file, backupDir } = config.access ?? loadSettings();
  const access = new WorldAccess({ settings, file });
  // Backups go where the settings say (default: beside the settings file),
  // and never inside a git repository. Tests and the harness pass their own.
  const dir = backupDir ?? backupFolderFor(settings, file);
  if (dir) console.error(`Backups are kept in: ${dir}`);
  const backups = dir ? new Backups({ dir, keep: settings.item_backup_keep, keepDays: settings.backup_keep_days }) : null;
  guardClient(client, access, backups, config.transport);

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
      instructions: SERVER_INSTRUCTIONS,
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
