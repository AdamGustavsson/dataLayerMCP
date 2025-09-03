// crawlability.ts - Crawlability Audit MCP tool

import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import { connectionState, wsSend } from "../connection/websocket.js";
import { logError, logWarn } from "../utils/logging.js";
import { amIActiveInstance, getInstanceInfo } from "../utils/instance.js";

export function registerCrawlabilityTool(mcpServer: any) {
  mcpServer.tool(
    "checkCrawlability",
    "Audit the current page in the human's attached browser tab via the connected extension: meta robots, X-Robots-Tag headers, robots.txt sitemaps, and whether the page appears in a sitemap.",
    {},
    async (): Promise<any> => {
      if (!amIActiveInstance()) {
        const info = getInstanceInfo();
        throw new Error(
          `This server instance is not active (instanceId=${info.instanceId}). A newer instance likely took over. Please use the latest server instance.`
        );
      }
      const socket = connectionState.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("Chrome extension is not connected. Please ensure the extension is installed and a tab is attached.");
      }

      const requestId = uuidv4();
      const payload = {
        type: "REQUEST_CRAWLABILITY_AUDIT",
        requestId,
        timestamp: Date.now(),
      } as const;

      if (!wsSend(socket, payload)) {
        throw new Error("Failed to send request to extension (inactive server or no connection).");
      }

      return new Promise<any>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            content: [{ type: "text", text: "Request timed out after 30 seconds" }],
            isError: true,
          });
        }, 30000);

        const messageHandler = (data: any) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "CRAWLABILITY_AUDIT_RESPONSE" && msg.requestId === requestId) {
              clearTimeout(timeout);
              socket.off("message", messageHandler);

              if (msg.payload?.error) {
                resolve({
                  content: [
                    {
                      type: "text",
                      text: String(msg.payload.error),
                    },
                  ],
                  isError: true,
                });
              } else {
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
          } catch (error) {
            logError("Error parsing response:", error);
          }
        };

        socket.on("message", messageHandler);
      });
    }
  );
}
