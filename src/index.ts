import { Hono } from "hono";
import { McpServer, StreamableHttpTransport, type Ctx } from "mcp-lite";
import { z } from "zod";

type AtlasAgentKvNamespace = {
  get(key: string): Promise<string | null>;
};

const mcp = new McpServer({
  name: "atlas-agent-mcp-server",
  version: "1.0.0",
  schemaAdapter: (schema) => {
    const jsonSchema = z.toJSONSchema(schema as z.ZodType);
    if (
      jsonSchema &&
      typeof jsonSchema === "object" &&
      !Array.isArray(jsonSchema)
    ) {
      // Strip meta-schema markers the host validator doesn't understand yet.
      const { $schema, ...rest } = jsonSchema as Record<string, unknown>;
      return rest;
    }
    return jsonSchema;
  },
});

const ATLAS_AGENT_API_URL =
  "https://atlasagent.ai/api/v1/reports/generate-comps";

const generateCompsInputSchema = z.object({
  listingAddress: z.string().min(1, "listingAddress is required"),
  email: z.string().email("email must be a valid email address"),
});

type GenerateCompsInput = z.infer<typeof generateCompsInputSchema>;

function generateRoomName(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

type AuthExtra = {
  kvNamespace?: AtlasAgentKvNamespace;
};

function getKvNamespace(ctx: Ctx): AtlasAgentKvNamespace {
  const extras = ctx.authInfo?.extra as AuthExtra | undefined;
  const kvNamespace = extras?.kvNamespace;
  if (!kvNamespace) {
    throw new Error(
      "KV namespace binding is not available in the current request context."
    );
  }
  return kvNamespace;
}

async function callAtlasAgentApi(
  kvNamespace: AtlasAgentKvNamespace,
  reportType: "salesCMA" | "rentalCMA",
  { listingAddress, email }: GenerateCompsInput
): Promise<string> {
  const roomName = generateRoomName();
  const atlasAgentApiKey = await kvNamespace.get("ATLAS_AGENT_API_KEY");
  if (!atlasAgentApiKey) {
    throw new Error(
      "Missing Atlas Agent API key in KV storage (ATLAS_AGENT_API_KEY)."
    );
  }
  const response = await fetch(ATLAS_AGENT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${atlasAgentApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      listingAddress,
      reportType,
      roomName,
      email,
    }),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Atlas Agent API error ${response.status}: ${responseText}`
    );
  }

  try {
    const parsed = JSON.parse(responseText);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return responseText;
  }
}

mcp.tool("generate_sales_comps", {
  description: "Generate a sales CMA report using the Atlas Agent API.",
  inputSchema: generateCompsInputSchema,
  handler: async (args, ctx) => {
    try {
      const kvNamespace = getKvNamespace(ctx);
      const result = await callAtlasAgentApi(kvNamespace, "salesCMA", args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to generate sales comps: ${message}`,
          },
        ],
      };
    }
  },
});

mcp.tool("generate_rental_comps", {
  description: "Generate a rental CMA report using the Atlas Agent API.",
  inputSchema: generateCompsInputSchema,
  handler: async (args, ctx) => {
    try {
      const kvNamespace = getKvNamespace(ctx);
      const result = await callAtlasAgentApi(kvNamespace, "rentalCMA", args);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Failed to generate rental comps: ${message}`,
          },
        ],
      };
    }
  },
});

const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcp);

type Bindings = {
  KV_NAMESPACE: AtlasAgentKvNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.all("/mcp", async (c) => {
  const response = await httpHandler(c.req.raw, {
    authInfo: {
      token: "",
      scopes: [],
      extra: { kvNamespace: c.env.KV_NAMESPACE },
    },
  });
  return response;
});

app.get("/", (c) => {
  return c.text("MCP Server - Connect to /mcp");
});

export default app;
