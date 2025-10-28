import { Hono } from "hono";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { z } from "zod";

const mcp = new McpServer({
  name: "atlas-agent-mcp-server",
  version: "1.0.0",
  schemaAdapter: (schema) => z.toJSONSchema(schema as z.ZodType),
});

const ATLAS_AGENT_API_URL =
  "https://atlasagent.ai/api/v1/reports/generate-comps";
const ATLAS_AGENT_API_KEY = "Yv4MT66x8MzYg5";

const generateCompsInputSchema = z.object({
  listingAddress: z.string().min(1, "listingAddress is required"),
  email: z.string().email("email must be a valid email address"),
});

type GenerateCompsInput = z.infer<typeof generateCompsInputSchema>;

function generateRoomName(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

async function callAtlasAgentApi(
  reportType: "salesCMA" | "rentalCMA",
  { listingAddress, email }: GenerateCompsInput
) {
  const roomName = generateRoomName();
  const response = await fetch(ATLAS_AGENT_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ATLAS_AGENT_API_KEY}`,
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
  handler: async (args) => {
    const result = await callAtlasAgentApi("salesCMA", args);
    return { content: [{ type: "text", text: result }] };
  },
});

mcp.tool("generate_rental_comps", {
  description: "Generate a rental CMA report using the Atlas Agent API.",
  inputSchema: generateCompsInputSchema,
  handler: async (args) => {
    const result = await callAtlasAgentApi("rentalCMA", args);
    return { content: [{ type: "text", text: result }] };
  },
});

const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcp);

const app = new Hono();

app.all("/mcp", async (c) => {
  const response = await httpHandler(c.req.raw);
  return response;
});

app.get("/", (c) => {
  return c.text("MCP Server - Connect to /mcp");
});

export default app;
