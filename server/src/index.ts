import { createServer } from "http";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { v4 as uuidv4 } from "uuid";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { IncomingMessage } from "http";

// ---- Configuration ----
const MCP_SERVER_NAME = "DataLayerAccessServer";
const MCP_SERVER_VERSION = "0.1.0";
const WS_PORT = 57321;
const EXTENSION_ORIGIN = process.env.EXTENSION_ORIGIN || "chrome-extension://<YOUR_EXTENSION_ID>";
const CONNECTION_TIMEOUT = 15_000; // 15 seconds
const HEALTH_CHECK_INTERVAL = 30_000; // 30 seconds
const MAX_RECONNECT_ATTEMPTS = 10;

// ---- Connection State Management ----
interface ConnectionState {
  socket: WebSocket | null;
  isHealthy: boolean;
  lastActivity: number;
  reconnectAttempts: number;
}

const connectionState: ConnectionState = {
  socket: null,
  isHealthy: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
};

// ---- Logging Utilities ----
function logInfo(message: string, ...args: any[]) {
  console.error(`[Server][INFO] ${message}`, ...args);
}

function logWarn(message: string, ...args: any[]) {
  console.error(`[Server][WARN] ${message}`, ...args);
}

function logError(message: string, ...args: any[]) {
  console.error(`[Server][ERROR] ${message}`, ...args);
}

// ---- MCP Server Setup ----
const mcpServer = new McpServer({
  name: MCP_SERVER_NAME,
  version: MCP_SERVER_VERSION,
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Utility to send JSON over WebSocket safely with retry logic
function wsSend(socket: WebSocket, data: unknown, retries = 3): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    logWarn("Attempted to send data on closed/invalid WebSocket connection");
    return false;
  }
  
  try {
    socket.send(JSON.stringify(data));
    connectionState.lastActivity = Date.now();
    return true;
  } catch (error) {
    logError("Failed to send WebSocket message", error);
    if (retries > 0) {
      logInfo(`Retrying send in 100ms (${retries} attempts left)`);
      setTimeout(() => wsSend(socket, data, retries - 1), 100);
    }
    return false;
  }
}

// Connection health monitoring
function updateConnectionHealth() {
  const socket = connectionState.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connectionState.isHealthy = false;
    return;
  }
  
  const timeSinceActivity = Date.now() - connectionState.lastActivity;
  connectionState.isHealthy = timeSinceActivity < HEALTH_CHECK_INTERVAL * 2;
  
  if (!connectionState.isHealthy) {
    logWarn(`Connection health check failed - last activity ${timeSinceActivity}ms ago`);
  }
}

// Start health monitoring
setInterval(updateConnectionHealth, HEALTH_CHECK_INTERVAL);

// ---- Tool Implementation ----
mcpServer.tool(
  "getDataLayer",
  "Capture and return the full contents of window.dataLayer (as JSON) from the active browser tab, allowing inspection of all GTM events.",
  {},
  async (): Promise<any> => {
    const socket = connectionState.socket;
    
    // Enhanced connection checking
    if (!socket) {
      return {
        content: [
          { 
            type: "text", 
            text: "Chrome extension is not connected. Please ensure the extension is installed and a tab is attached.",
            _meta: { isError: true, connectionState: "no_socket" }
          },
        ],
        isError: true,
      } as any;
    }
    
    if (socket.readyState !== WebSocket.OPEN) {
      return {
        content: [
          { 
            type: "text", 
            text: `Chrome extension connection is not ready (state: ${socket.readyState}). Please try again in a moment.`,
            _meta: { isError: true, connectionState: "not_open" }
          },
        ],
        isError: true,
      } as any;
    }
    
    if (!connectionState.isHealthy) {
      logWarn("Attempting getDataLayer on potentially unhealthy connection");
    }

    const requestId = uuidv4();
    const payload = { type: "REQUEST_DATALAYER", requestId, timestamp: Date.now() } as const;
    
    if (!wsSend(socket, payload)) {
      return {
        content: [
          { 
            type: "text", 
            text: "Failed to send request to extension. Connection may be unstable.",
            _meta: { isError: true, connectionState: "send_failed" }
          },
        ],
        isError: true,
      } as any;
    }

    return new Promise<any>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        logWarn(`Request ${requestId} timed out after ${CONNECTION_TIMEOUT}ms`);
        resolve({
          content: [
            {
              type: "text",
              text: `Timeout waiting for dataLayer from extension (${CONNECTION_TIMEOUT}ms). The extension may be busy or disconnected.`,
              _meta: { isError: true, requestId, connectionState: "timeout" },
            },
          ],
          isError: true,
        } as any);
      }, CONNECTION_TIMEOUT);

      function handleMessage(data: RawData) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "DATALAYER_RESPONSE" && msg.requestId === requestId) {
            cleanup();
            connectionState.lastActivity = Date.now();
            
            if (msg.payload?.error) {
              logWarn(`Request ${requestId} returned error:`, msg.payload.error);
              resolve({
                content: [
                  { 
                    type: "text", 
                    text: String(msg.payload.error), 
                    _meta: { isError: true, requestId } 
                  },
                ],
                isError: true,
              } as any);
            } else {
              logInfo(`Request ${requestId} completed successfully`);
              resolve({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(msg.payload, null, 2),
                    _meta: { requestId, dataLayerLength: Array.isArray(msg.payload?.dataLayer) ? msg.payload.dataLayer.length : 0 }
                  },
                ],
              } as any);
            }
          }
        } catch (err) {
          logWarn("Received malformed JSON message:", err);
        }
      }

      function handleClose() {
        cleanup();
        logWarn(`WebSocket closed while waiting for request ${requestId}`);
        resolve({
          content: [
            { 
              type: "text", 
              text: "Extension connection closed while processing request.", 
              _meta: { isError: true, requestId, connectionState: "closed" } 
            },
          ],
          isError: true,
        } as any);
      }

      function handleError(error: any) {
        cleanup();
        logError(`WebSocket error while waiting for request ${requestId}:`, error);
        resolve({
          content: [
            { 
              type: "text", 
              text: "Extension connection error while processing request.", 
              _meta: { isError: true, requestId, connectionState: "error" } 
            },
          ],
          isError: true,
        } as any);
      }

      function cleanup() {
        clearTimeout(timeout);
        if (socket) {
          socket.off("message", handleMessage);
          socket.off("close", handleClose);
          socket.off("error", handleError);
        }
      }

      socket.on("message", handleMessage);
      socket.on("close", handleClose);
      socket.on("error", handleError);
    });
  },
);

mcpServer.tool(
  "getGa4Hits",
  "Get all GA4 hits (network requests) recorded from the current page. Recording is automatic and resets on page navigation.",
  {},
  async (): Promise<any> => {
    const socket = connectionState.socket;
    
    if (!socket) {
      return {
        content: [
          { 
            type: "text", 
            text: "Chrome extension is not connected. Please ensure the extension is installed and a tab is attached.",
            _meta: { isError: true, connectionState: "no_socket" }
          },
        ],
        isError: true,
      } as any;
    }
    
    if (socket.readyState !== WebSocket.OPEN) {
      return {
        content: [
          { 
            type: "text", 
            text: `Chrome extension connection is not ready (state: ${socket.readyState}). Please try again in a moment.`,
            _meta: { isError: true, connectionState: "not_open" }
          },
        ],
        isError: true,
      } as any;
    }

    const requestId = uuidv4();
    const payload = { type: "REQUEST_GA4_HITS", requestId, timestamp: Date.now() } as const;
    
    if (!wsSend(socket, payload)) {
      return {
        content: [
          { 
            type: "text", 
            text: "Failed to send request to extension. Connection may be unstable.",
            _meta: { isError: true, connectionState: "send_failed" }
          },
        ],
        isError: true,
      } as any;
    }

    return new Promise<any>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        logWarn(`GA4 hits request ${requestId} timed out after ${CONNECTION_TIMEOUT}ms`);
        resolve({
          content: [
            {
              type: "text",
              text: `Timeout waiting for GA4 hits from extension (${CONNECTION_TIMEOUT}ms). The extension may be busy or disconnected.`,
              _meta: { isError: true, requestId, connectionState: "timeout" },
            },
          ],
          isError: true,
        } as any);
      }, CONNECTION_TIMEOUT);

      function handleMessage(data: RawData) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "GA4_HITS_RESPONSE" && msg.requestId === requestId) {
            cleanup();
            connectionState.lastActivity = Date.now();
            
            if (msg.payload?.error) {
              logWarn(`GA4 hits request ${requestId} returned error:`, msg.payload.error);
              resolve({
                content: [
                  { 
                    type: "text", 
                    text: String(msg.payload.error), 
                    _meta: { isError: true, requestId } 
                  },
                ],
                isError: true,
              } as any);
            } else {
              logInfo(`GA4 hits request ${requestId} completed successfully`);
              resolve({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(msg.payload, null, 2),
                    _meta: { requestId, hitsCount: Array.isArray(msg.payload?.hits) ? msg.payload.hits.length : 0 }
                  },
                ],
              } as any);
            }
          }
        } catch (err) {
          logWarn("Received malformed JSON message:", err);
        }
      }

      function handleClose() {
        cleanup();
        logWarn(`WebSocket closed while waiting for GA4 hits request ${requestId}`);
        resolve({
          content: [
            { 
              type: "text", 
              text: "Extension connection closed while processing request.", 
              _meta: { isError: true, requestId, connectionState: "closed" } 
            },
          ],
          isError: true,
        } as any);
      }

      function handleError(error: any) {
        cleanup();
        logError(`WebSocket error while waiting for GA4 hits request ${requestId}:`, error);
        resolve({
          content: [
            { 
              type: "text", 
              text: "Extension connection error while processing request.", 
              _meta: { isError: true, requestId, connectionState: "error" } 
            },
          ],
          isError: true,
        } as any);
      }

      function cleanup() {
        clearTimeout(timeout);
        if (socket) {
          socket.off("message", handleMessage);
          socket.off("close", handleClose);
          socket.off("error", handleError);
        }
      }

      socket.on("message", handleMessage);
      socket.on("close", handleClose);
      socket.on("error", handleError);
    });
  },
);

mcpServer.tool(
  "getMetaPixelHits",
  "Get all Meta Pixel (Facebook Pixel) hits recorded from the current page. Recording is automatic and resets on page navigation.",
  {},
  async (): Promise<any> => {
    const socket = connectionState.socket;
    
    if (!socket) {
      return {
        content: [
          { 
            type: "text", 
            text: "Chrome extension is not connected. Please ensure the extension is installed and a tab is attached.",
            _meta: { isError: true, connectionState: "no_socket" }
          },
        ],
        isError: true,
      } as any;
    }
    
    if (socket.readyState !== WebSocket.OPEN) {
      return {
        content: [
          { 
            type: "text", 
            text: `Chrome extension connection is not ready (state: ${socket.readyState}). Please try again in a moment.`,
            _meta: { isError: true, connectionState: "not_open" }
          },
        ],
        isError: true,
      } as any;
    }

    const requestId = uuidv4();
    const payload = { type: "REQUEST_META_PIXEL_HITS", requestId, timestamp: Date.now() } as const;
    
    if (!wsSend(socket, payload)) {
      return {
        content: [
          { 
            type: "text", 
            text: "Failed to send request to extension. Connection may be unstable.",
            _meta: { isError: true, connectionState: "send_failed" }
          },
        ],
        isError: true,
      } as any;
    }

    return new Promise<any>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        logWarn(`Meta Pixel hits request ${requestId} timed out after ${CONNECTION_TIMEOUT}ms`);
        resolve({
          content: [
            {
              type: "text",
              text: `Timeout waiting for Meta Pixel hits from extension (${CONNECTION_TIMEOUT}ms). The extension may be busy or disconnected.`,
              _meta: { isError: true, requestId, connectionState: "timeout" },
            },
          ],
          isError: true,
        } as any);
      }, CONNECTION_TIMEOUT);

      function handleMessage(data: RawData) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "META_PIXEL_HITS_RESPONSE" && msg.requestId === requestId) {
            cleanup();
            connectionState.lastActivity = Date.now();
            
            if (msg.payload?.error) {
              logWarn(`Meta Pixel hits request ${requestId} returned error:`, msg.payload.error);
              resolve({
                content: [
                  { 
                    type: "text", 
                    text: String(msg.payload.error), 
                    _meta: { isError: true, requestId } 
                  },
                ],
                isError: true,
              } as any);
            } else {
              logInfo(`Meta Pixel hits request ${requestId} completed successfully`);
              resolve({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(msg.payload, null, 2),
                    _meta: { requestId, hitsCount: Array.isArray(msg.payload?.hits) ? msg.payload.hits.length : 0 }
                  },
                ],
              } as any);
            }
          }
        } catch (err) {
          logWarn("Received malformed JSON message:", err);
        }
      }

      function handleClose() {
        cleanup();
        logWarn(`WebSocket closed while waiting for Meta Pixel hits request ${requestId}`);
        resolve({
          content: [
            { 
              type: "text", 
              text: "Extension connection closed while processing request.", 
              _meta: { isError: true, requestId, connectionState: "closed" } 
            },
          ],
          isError: true,
        } as any);
      }

      function handleError(error: any) {
        cleanup();
        logError(`WebSocket error while waiting for Meta Pixel hits request ${requestId}:`, error);
        resolve({
          content: [
            { 
              type: "text", 
              text: "Extension connection error while processing request.", 
              _meta: { isError: true, requestId, connectionState: "error" } 
            },
          ],
          isError: true,
        } as any);
      }

      function cleanup() {
        clearTimeout(timeout);
        if (socket) {
          socket.off("message", handleMessage);
          socket.off("close", handleClose);
          socket.off("error", handleError);
        }
      }

      socket.on("message", handleMessage);
      socket.on("close", handleClose);
      socket.on("error", handleError);
    });
  },
);

mcpServer.tool(
  "getNewGTMPreviewEvents",
  "Get new GTM preview events from Google Tag Assistant that have occurred since the last call. Returns events with numbers greater than the last reported event.",
  {},
  async (): Promise<any> => {
    const socket = connectionState.socket;
    
    if (!socket) {
      return {
        content: [
          { 
            type: "text", 
            text: "Chrome extension is not connected. Please ensure the extension is installed and a tab is attached.",
            _meta: { isError: true, connectionState: "no_socket" }
          },
        ],
        isError: true,
      } as any;
    }
    
    if (socket.readyState !== WebSocket.OPEN) {
      return {
        content: [
          { 
            type: "text", 
            text: `Chrome extension connection is not ready (state: ${socket.readyState}). Please try again in a moment.`,
            _meta: { isError: true, connectionState: "not_open" }
          },
        ],
        isError: true,
      } as any;
    }

    const requestId = uuidv4();
    const payload = { type: "REQUEST_NEW_GTM_PREVIEW_EVENTS", requestId, timestamp: Date.now() } as const;
    
    if (!wsSend(socket, payload)) {
      return {
        content: [
          { 
            type: "text", 
            text: "Failed to send request to extension. Connection may be unstable.",
            _meta: { isError: true, connectionState: "send_failed" }
          },
        ],
        isError: true,
      } as any;
    }

    return new Promise<any>((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        logWarn(`GTM preview request ${requestId} timed out after ${CONNECTION_TIMEOUT}ms`);
        resolve({
          content: [
            {
              type: "text",
              text: `Timeout waiting for GTM preview data from extension (${CONNECTION_TIMEOUT}ms). Make sure the attached tab is on Tag Assistant with GTM preview active.`,
              _meta: { isError: true, requestId, connectionState: "timeout" },
            },
          ],
          isError: true,
        } as any);
      }, CONNECTION_TIMEOUT);

      function handleMessage(data: RawData) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "NEW_GTM_PREVIEW_EVENTS_RESPONSE" && msg.requestId === requestId) {
            cleanup();
            connectionState.lastActivity = Date.now();
            
            if (msg.payload?.error) {
              logWarn(`GTM preview request ${requestId} returned error:`, msg.payload.error);
              resolve({
                content: [
                  { 
                    type: "text", 
                    text: String(msg.payload.error), 
                    _meta: { isError: true, requestId } 
                  },
                ],
                isError: true,
              } as any);
            } else {
              logInfo(`GTM preview request ${requestId} completed successfully`);
              const events = msg.payload?.events || [];
              resolve({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(msg.payload, null, 2),
                    _meta: { 
                      requestId, 
                      totalEvents: msg.payload?.totalEvents || 0,
                      newEvents: msg.payload?.newEvents || 0,
                      cached: msg.payload?.cached || false,
                      eventsCount: events.length
                    }
                  },
                ],
              } as any);
            }
          }
        } catch (err) {
          logWarn("Received malformed JSON message:", err);
        }
      }

      function handleClose() {
        cleanup();
        logWarn(`WebSocket closed while waiting for GTM preview request ${requestId}`);
        resolve({
          content: [
            { 
              type: "text", 
              text: "Extension connection closed while processing request.", 
              _meta: { isError: true, requestId, connectionState: "closed" } 
            },
          ],
          isError: true,
        } as any);
      }

      function handleError(error: any) {
        cleanup();
        logError(`WebSocket error while waiting for GTM preview request ${requestId}:`, error);
        resolve({
          content: [
            { 
              type: "text", 
              text: "Extension connection error while processing request.", 
              _meta: { isError: true, requestId, connectionState: "error" } 
            },
          ],
          isError: true,
        } as any);
      }

      function cleanup() {
        clearTimeout(timeout);
        if (socket) {
          socket.off("message", handleMessage);
          socket.off("close", handleClose);
          socket.off("error", handleError);
        }
      }

      socket.on("message", handleMessage);
      socket.on("close", handleClose);
      socket.on("error", handleError);
    });
  },
);

// ---- WebSocket Server for Extension Communication ----
function createWebSocketServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const httpServer = createServer();
      const wss = new WebSocketServer({ server: httpServer });

      wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
        const origin = req.headers.origin;
        const userAgent = req.headers["user-agent"] || "";
        
        // Enhanced origin validation
        const allowedOrigin = EXTENSION_ORIGIN === "*" ? true : 
          origin === EXTENSION_ORIGIN || 
          origin?.startsWith("chrome-extension://") ||
          origin?.startsWith("moz-extension://"); // Firefox support
          
        if (!allowedOrigin) {
          logWarn(`Rejected WebSocket connection from invalid origin: ${origin}`);
          socket.close(1008, "Invalid origin");
          return;
        }

        logInfo(`Extension connected from origin: ${origin}, user-agent: ${userAgent.substring(0, 100)}`);
        
        // Update connection state
        connectionState.socket = socket;
        connectionState.isHealthy = true;
        connectionState.lastActivity = Date.now();
        connectionState.reconnectAttempts = 0;

        // Handle incoming messages for health checks
        socket.on("message", (data: RawData) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "KEEPALIVE_PING") {
              connectionState.lastActivity = Date.now();
              // Send pong back
              wsSend(socket, { type: "KEEPALIVE_PONG", timestamp: Date.now() });
            }
          } catch (err) {
            logWarn("Received malformed keepalive message:", err);
          }
        });

        socket.on("close", (code, reason) => {
          logWarn(`Extension WebSocket disconnected (code: ${code}, reason: ${reason})`);
          if (connectionState.socket === socket) {
            connectionState.socket = null;
            connectionState.isHealthy = false;
          }
        });

        socket.on("error", (error) => {
          logError("Extension WebSocket error:", error);
          connectionState.isHealthy = false;
        });
        
        // Send initial connection acknowledgment
        wsSend(socket, { 
          type: "CONNECTION_ACK", 
          serverVersion: MCP_SERVER_VERSION,
          timestamp: Date.now() 
        });
      });

      wss.on("error", (error) => {
        logError("WebSocket server error:", error);
        reject(error);
      });

      httpServer.on("error", (error) => {
        logError("HTTP server error:", error);
        reject(error);
      });

      httpServer.listen(WS_PORT, () => {
        logInfo(`WebSocket server listening on ws://localhost:${WS_PORT}`);
        resolve();
      });

    } catch (error) {
      logError("Failed to create WebSocket server:", error);
      reject(error);
    }
  });
}

// ---- Start MCP Server ----
async function main() {
  try {
    // Start WebSocket server first
    await createWebSocketServer();
    
    // Then start MCP server
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    
    logInfo(`${MCP_SERVER_NAME} v${MCP_SERVER_VERSION} running via stdio`);
    logInfo("Server initialization completed successfully");
    
    // Handle graceful shutdown
    process.on("SIGINT", () => {
      logInfo("Received SIGINT, shutting down gracefully...");
      if (connectionState.socket) {
        connectionState.socket.close(1001, "Server shutdown");
      }
      process.exit(0);
    });
    
    process.on("SIGTERM", () => {
      logInfo("Received SIGTERM, shutting down gracefully...");
      if (connectionState.socket) {
        connectionState.socket.close(1001, "Server shutdown");
      }
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