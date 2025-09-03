// gtmContainerIds.ts - GTM Container IDs MCP tool
import { v4 as uuidv4 } from "uuid";
import WebSocket from "ws";
import { connectionState, wsSend } from "../connection/websocket.js";
import { logError, logInfo, logWarn } from "../utils/logging.js";
import { amIActiveInstance, getInstanceInfo } from "../utils/instance.js";
export function registerGtmContainerIdsTool(mcpServer) {
    mcpServer.tool("getGTMContainerIds", "Extract and return all (normally just one) Google Tag Manager container IDs installed on the current page from the human's attached browser tab via the connected extension, using the window.google_tag_manager object.", {}, async () => {
        if (!amIActiveInstance()) {
            const info = getInstanceInfo();
            return {
                content: [
                    {
                        type: "text",
                        text: `Inactive server instance (instanceId=${info.instanceId}). A newer instance took over. Use the latest server.`,
                    },
                ],
                isError: true,
            };
        }
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
            };
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
            };
        }
        if (!connectionState.isHealthy) {
            logWarn("Attempting getGTMContainerIds on potentially unhealthy connection");
        }
        const requestId = uuidv4();
        const payload = { type: "REQUEST_GTM_CONTAINER_IDS", requestId, timestamp: Date.now() };
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
            };
        }
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                cleanup();
                logWarn(`GTM container IDs request ${requestId} timed out`);
                resolve({
                    content: [
                        {
                            type: "text",
                            text: "Timeout waiting for GTM container IDs from extension. The extension may be busy or disconnected.",
                            _meta: { isError: true, requestId, connectionState: "timeout" },
                        },
                    ],
                    isError: true,
                });
            }, 15000);
            function handleMessage(data) {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === "GTM_CONTAINER_IDS_RESPONSE" && msg.requestId === requestId) {
                        cleanup();
                        connectionState.lastActivity = Date.now();
                        if (msg.payload?.error) {
                            logWarn(`GTM container IDs request ${requestId} returned error:`, msg.payload.error);
                            resolve({
                                content: [
                                    {
                                        type: "text",
                                        text: String(msg.payload.error),
                                        _meta: { isError: true, requestId }
                                    },
                                ],
                                isError: true,
                            });
                        }
                        else {
                            logInfo(`GTM container IDs request ${requestId} completed successfully`);
                            resolve({
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(msg.payload, null, 2),
                                        _meta: {
                                            requestId,
                                            containerCount: Array.isArray(msg.payload?.containerIds) ? msg.payload.containerIds.length : 0
                                        }
                                    },
                                ],
                            });
                        }
                    }
                }
                catch (err) {
                    logWarn("Received malformed JSON message:", err);
                }
            }
            function handleClose() {
                cleanup();
                logWarn(`WebSocket closed while waiting for GTM container IDs request ${requestId}`);
                resolve({
                    content: [
                        {
                            type: "text",
                            text: "Extension connection closed while processing request.",
                            _meta: { isError: true, requestId, connectionState: "closed" }
                        },
                    ],
                    isError: true,
                });
            }
            function handleError(error) {
                cleanup();
                logError(`WebSocket error while waiting for GTM container IDs request ${requestId}:`, error);
                resolve({
                    content: [
                        {
                            type: "text",
                            text: "Extension connection error while processing request.",
                            _meta: { isError: true, requestId, connectionState: "error" }
                        },
                    ],
                    isError: true,
                });
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
    });
}
