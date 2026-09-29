# World Anvil MCP (independent fork)

An MCP server that lets your AI tools (Claude Desktop, Claude Code, Open WebUI and other MCP clients) work with **your own** [World Anvil](https://www.worldanvil.com/) worlds, articles and manuscripts.

This is an independent fork of [wlcarden/worldanvil-mcp](https://github.com/wlcarden/worldanvil-mcp). It is maintained separately, with a different approach, and is not intended to be merged back.

## How this fork differs

| | This fork | Upstream |
|---|---|---|
| Keys | **You must use your own two keys** | Works with only a user token |
| Where requests go | **Only `www.worldanvil.com`** | By default, via the upstream author's proxy server |
| Proxies | **Refused** (`WA_PROXY_URL` is an error) | Supported |
| Published to npm | **No** (install from this repo) | Yes (`worldanvil-mcp`) |

Nothing you read or write passes through any third-party server, and the server never uses anyone else's application key.

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

**Do not use `npx worldanvil-mcp`.** That runs the upstream package from npm, not this fork.

More detail (tools, features, development and tests) is in [plugins/worldbuilding/worldanvil-mcp/README.md](plugins/worldbuilding/worldanvil-mcp/README.md).

## World Anvil API licence

World Anvil's API may not be used for any commercial project without their permission, and access can be withdrawn if an application breaks their Terms of Service or gets round membership-tier feature locks. See the [API documentation](https://www.worldanvil.com/api/external/boromir/documentation#licence-section). This fork is for personal, non-commercial use.

## Licence

MIT. See [LICENSE](LICENSE). Original work © Leighton Carden; fork changes © Carnivalius.
