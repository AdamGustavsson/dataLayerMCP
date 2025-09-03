// index.ts - MCP DataLayer Access Server - Modular Version

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { setupWebSocketServer } from "./connection/websocket.js";
import { logInfo, logWarn, logError } from "./utils/logging.js";
import { registerDataLayerTool } from "./tools/dataLayer.js";
import { registerSchemaMarkupTool } from "./tools/schema.js";
import { registerMetaTagsTool } from "./tools/metaTags.js";
import { registerGa4HitsTool } from "./tools/ga4Hits.js";
import { registerMetaPixelHitsTool } from "./tools/metaPixelHits.js";
import { registerGtmContainerIdsTool } from "./tools/gtmContainerIds.js";
import { registerGtmPreviewEventsTool } from "./tools/gtmPreviewEvents.js";
import { registerCrawlabilityTool } from "./tools/crawlability.js";

// Configuration
const MCP_SERVER_NAME = "DataLayerAccessServer";
const MCP_SERVER_VERSION = "0.1.0";

// MCP Server Setup
const mcpServer = new McpServer({
  name: MCP_SERVER_NAME,
  version: MCP_SERVER_VERSION,
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Register all tools
registerDataLayerTool(mcpServer);
registerSchemaMarkupTool(mcpServer);
registerMetaTagsTool(mcpServer);
registerGa4HitsTool(mcpServer);
registerMetaPixelHitsTool(mcpServer);
registerGtmContainerIdsTool(mcpServer);
registerGtmPreviewEventsTool(mcpServer);
registerCrawlabilityTool(mcpServer);

// WebSocket message handler
function handleWebSocketMessage(socket: any, message: any) {
  logInfo(`Received WebSocket message: ${message.type}`);
  // Additional message handling logic can be added here
}

// Start MCP Server
async function main() {
  try {
    // Start WebSocket server first
    const wss = await setupWebSocketServer(handleWebSocketMessage);
    
    // Then start MCP server
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    
    logInfo(`${MCP_SERVER_NAME} v${MCP_SERVER_VERSION} running via stdio`);
    logInfo("Server initialization completed successfully");
    
    // Handle graceful shutdown
    process.on("SIGINT", () => {
      logInfo("Received SIGINT, shutting down gracefully...");
      wss.close();
      process.exit(0);
    });
    
    process.on("SIGTERM", () => {
      logInfo("Received SIGTERM, shutting down gracefully...");
      wss.close();
      process.exit(0);
    });
    
  } catch (error) {
    logError("Fatal error during server startup:", error);
    process.exit(1);
  }
}

// Enhanced error handling for unhandled rejections and exceptions
process.on("unhandledRejection", (reason, promise) => {
  logError("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  logError("Uncaught Exception:", error);
  process.exit(1);
});

main().catch((err) => {
  logError("Fatal error in main():", err);
  process.exit(1);
});
