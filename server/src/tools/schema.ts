// schema.ts - Schema markup MCP tool

import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import { connectionState, wsSend } from "../connection/websocket.js";
import { logError } from "../utils/logging.js";

export function registerSchemaMarkupTool(mcpServer: any) {
  mcpServer.tool(
    "getSchemaMarkup",
    "Extract and return all schema markup (JSON-LD and microdata) found on the current page, including structured data for SEO and rich snippets.",
    {},
    async (): Promise<any> => {
      const socket = connectionState.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("Chrome extension is not connected. Please ensure the extension is installed and a tab is attached.");
      }

      const requestId = uuidv4();
      const payload = {
        type: "REQUEST_SCHEMA_MARKUP",
        requestId,
        timestamp: Date.now(),
      } as const;

      if (!wsSend(socket, payload)) {
        throw new Error("Failed to send request to extension");
      }

      return new Promise<any>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({
            content: [{ 
              type: "text", 
              text: "Request timed out after 30 seconds" 
            }],
            isError: true
          });
        }, 30000);

        const messageHandler = (data: any) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "SCHEMA_MARKUP_RESPONSE" && msg.requestId === requestId) {
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
              } else {
                resolve({
                  content: [{
                    type: "text",
                    text: JSON.stringify(msg.payload, null, 2)
                  }]
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
