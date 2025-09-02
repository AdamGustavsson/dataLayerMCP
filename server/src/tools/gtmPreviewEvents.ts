// gtmPreviewEvents.ts - GTM Preview Events MCP tool

import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import { connectionState, wsSend } from "../connection/websocket.js";
import { logError, logInfo, logWarn } from "../utils/logging.js";

export function registerGtmPreviewEventsTool(mcpServer: any) {
  mcpServer.tool(
    "getNewGTMPreviewEvents",
    "Get new GTM preview events from Google Tag Assistant that have occurred since the last call. Returns events with numbers greater than the last reported event. (Requires that a GTM preview is active in the human's browser)",
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
          logWarn(`GTM preview request ${requestId} timed out`);
          resolve({
            content: [
              {
                type: "text",
                text: "Timeout waiting for GTM preview data from extension. Make sure the attached tab is on Tag Assistant with GTM preview active.",
                _meta: { isError: true, requestId, connectionState: "timeout" },
              },
            ],
            isError: true,
          } as any);
        }, 15000);

        function handleMessage(data: any) {
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
    }
  );
}

