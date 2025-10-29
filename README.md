# Cloudflare MCP Demo

This Cloudflare Worker hosts an MCP server built with `mcp-lite`. The Worker exposes the MCP transport over HTTP while delegating work to Atlas Agent tooling backed by a Cloudflare KV namespace.

## HTTP Surface

- `POST /mcp` — Streams MCP protocol traffic via `StreamableHttpTransport`. Every request includes a KV binding in `authInfo.extra` so tools can reach secrets.
- `GET /` — Basic health response (`"MCP Server - Connect to /mcp"`).

## Registered MCP Tools

- `generate_sales_comps` — Validates `listingAddress` and `email` with Zod, then calls the Atlas Agent `salesCMA` report API.
- `generate_rental_comps` — Same validation and flow, using the `rentalCMA` report type.

Both tools:

- Resolve the `atlas-agent-mcp-server` context via `ctx.authInfo.extra`.
- Read `ATLAS_AGENT_API_KEY` from the Cloudflare KV binding before making the outbound request.
- Normalize success/error payloads into plain-text MCP content.

## Architecture Flow

```mermaid
flowchart LR
    Client[Atlas MCP client] -->|POST /mcp| Hono
    Hono --> Transport[Streamable\nHTTP transport]
    Transport --> Server[McpServer]
    Server -->|tool call| Tools{sales or rental}
    Tools --> KV[Cloudflare KV\n(Atlas Agent API key)]
    Tools --> AtlasAPI[Atlas Agent POST endpoint]
    AtlasAPI --> Tools --> Server --> Transport --> Client
```

## Configuration Notes

- Bind a KV namespace as `KV_NAMESPACE` so `ctx.authInfo.extra.kvNamespace` is available.
- Ensure the namespace stores `ATLAS_AGENT_API_KEY`. Missing keys short-circuit with MCP errors.
- The Worker relies on the platform `fetch` implementation; no additional HTTP client is required.
