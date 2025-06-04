import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// ---- Configuration ----
const MCP_SERVER_NAME = "DataLayerAccessServer";
const MCP_SERVER_VERSION = "0.1.0";
const WS_PORT = 57321;
const EXTENSION_ORIGIN = process.env.EXTENSION_ORIGIN || "chrome-extension://<YOUR_EXTENSION_ID>";
// ---- MCP Server Setup ----
const mcpServer = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    capabilities: {
        resources: {},
        tools: {},
    },
});
// Store active WebSocket connection (single client for MVP)
let extensionSocket = null;
// Utility to send JSON over WebSocket safely
function wsSend(socket, data) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    }
}
// ---- Tool Implementation ----
mcpServer.tool("getDataLayer", "Capture and return the full contents of window.dataLayer (as JSON) from the active browser tab, allowing inspection of all GTM events.", {}, async () => {
    if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
        return {
            content: [
                { type: "text", text: "Chrome extension is not connected.", _meta: { isError: true } },
            ],
            isError: true,
        };
    }
    const requestId = uuidv4();
    const payload = { type: "REQUEST_DATALAYER", requestId };
    wsSend(extensionSocket, payload);
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            cleanup();
            resolve({
                content: [
                    {
                        type: "text",
                        text: "Timeout waiting for dataLayer from extension.",
                        _meta: { isError: true },
                    },
                ],
                isError: true,
            });
        }, 10000);
        function handleMessage(data) {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === "DATALAYER_RESPONSE" && msg.requestId === requestId) {
                    cleanup();
                    if (msg.payload?.error) {
                        resolve({
                            content: [
                                { type: "text", text: String(msg.payload.error), _meta: { isError: true } },
                            ],
                            isError: true,
                        });
                    }
                    else {
                        resolve({
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(msg.payload, null, 2),
                                },
                            ],
                        });
                    }
                }
            }
            catch (err) {
                // ignore malformed JSON
            }
        }
        function handleClose() {
            cleanup();
            resolve({
                content: [
                    { type: "text", text: "Extension connection closed.", _meta: { isError: true } },
                ],
                isError: true,
            });
        }
        function cleanup() {
            clearTimeout(timeout);
            if (extensionSocket) {
                extensionSocket.off("message", handleMessage);
                extensionSocket.off("close", handleClose);
            }
        }
        extensionSocket?.on("message", handleMessage);
        extensionSocket?.on("close", handleClose);
    });
});
// ---- WebSocket Server for Extension Communication ----
const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });
wss.on("connection", (socket, req) => {
    const origin = req.headers.origin;
    const allowedOrigin = EXTENSION_ORIGIN === "*" ? true : origin === EXTENSION_ORIGIN || origin?.startsWith("chrome-extension://");
    if (!allowedOrigin) {
        console.warn(`Rejected WebSocket connection from invalid origin: ${origin}`);
        socket.close();
        return;
    }
    console.error("[Server] Extension connected via WebSocket");
    extensionSocket = socket;
    socket.on("close", () => {
        console.error("[Server] Extension WebSocket disconnected");
        if (extensionSocket === socket) {
            extensionSocket = null;
        }
    });
});
httpServer.listen(WS_PORT, () => {
    console.error(`[Server] WebSocket server listening on ws://localhost:${WS_PORT}`);
});
// ---- Start MCP Server ----
async function main() {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error(`[Server] ${MCP_SERVER_NAME} v${MCP_SERVER_VERSION} running via stdio`);
}
main().catch((err) => {
    console.error("Fatal error in main():", err);
    process.exit(1);
});
