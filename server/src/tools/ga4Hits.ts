// ga4Hits.ts - GA4 hits MCP tool

import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import { connectionState, wsSend } from "../connection/websocket.js";
import { logError, logInfo, logWarn } from "../utils/logging.js";

export function registerGa4HitsTool(mcpServer: any) {
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
          logWarn(`GA4 hits request ${requestId} timed out`);
          resolve({
            content: [
              {
                type: "text",
                text: "Timeout waiting for GA4 hits from extension. The extension may be busy or disconnected.",
                _meta: { isError: true, requestId, connectionState: "timeout" },
              },
            ],
            isError: true,
          } as any);
        }, 15000);

        function handleMessage(data: any) {
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
    }
  );
}

