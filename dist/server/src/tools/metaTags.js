// metaTags.ts - Meta tags MCP tool
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import { connectionState, wsSend } from "../connection/websocket.js";
import { logError } from "../utils/logging.js";
export function registerMetaTagsTool(mcpServer) {
    mcpServer.tool("getMetaTags", "Extract and return all meta tags from the current page including title, meta description, Open Graph, Twitter Card, and other SEO-related meta information.", {}, async () => {
        const socket = connectionState.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            throw new Error("Chrome extension is not connected. Please ensure the extension is installed and a tab is attached.");
        }
        const requestId = uuidv4();
        const payload = {
            type: "REQUEST_META_TAGS",
            requestId,
            timestamp: Date.now(),
        };
        if (!wsSend(socket, payload)) {
            throw new Error("Failed to send request to extension");
        }
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({
                    content: [{
                            type: "text",
                            text: "Request timed out after 30 seconds"
                        }],
                    isError: true
                });
            }, 30000);
            const messageHandler = (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === "META_TAGS_RESPONSE" && msg.requestId === requestId) {
                        clearTimeout(timeout);
                        socket.off("message", messageHandler);
                        if (msg.payload?.error) {
                            resolve({
                                content: [{
                                        type: "text",
                                        text: String(msg.payload.error)
                                    }],
                                isError: true
                            });
                        }
                        else {
                            resolve({
                                content: [{
                                        type: "text",
                                        text: JSON.stringify(msg.payload, null, 2)
                                    }]
                            });
                        }
                    }
                }
                catch (error) {
                    logError("Error parsing response:", error);
                }
            };
            socket.on("message", messageHandler);
        });
    });
}
