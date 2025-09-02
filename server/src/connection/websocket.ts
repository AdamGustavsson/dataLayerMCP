// websocket.ts - WebSocket connection management for server

import WebSocket, { WebSocketServer } from "ws";
import { logInfo, logWarn, logError } from "../utils/logging.js";

// Connection configuration
export const WS_PORT = 57321;
export const EXTENSION_ORIGIN = process.env.EXTENSION_ORIGIN || "chrome-extension://<YOUR_EXTENSION_ID>";
export const CONNECTION_TIMEOUT = 15_000; // 15 seconds
export const HEALTH_CHECK_INTERVAL = 30_000; // 30 seconds
export const MAX_RECONNECT_ATTEMPTS = 10;

// Connection State Management
export interface ConnectionState {
  socket: WebSocket | null;
  isHealthy: boolean;
  lastActivity: number;
  reconnectAttempts: number;
}

export const connectionState: ConnectionState = {
  socket: null,
  isHealthy: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
};

// WebSocket message sending utility
export function wsSend(socket: WebSocket, payload: any): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    logError("Cannot send message - WebSocket not connected");
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    connectionState.lastActivity = Date.now();
    return true;
  } catch (error) {
    logError("Failed to send WebSocket message:", error);
    return false;
  }
}

// Health check functionality
let healthCheckInterval: NodeJS.Timeout | null = null;

export function startHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }

  healthCheckInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceLastActivity = now - connectionState.lastActivity;

    if (connectionState.socket && connectionState.socket.readyState === WebSocket.OPEN) {
      if (timeSinceLastActivity > CONNECTION_TIMEOUT) {
        logWarn("Connection appears stale, marking as unhealthy");
        connectionState.isHealthy = false;
      } else {
        connectionState.isHealthy = true;
      }
    } else {
      connectionState.isHealthy = false;
    }
  }, HEALTH_CHECK_INTERVAL);
}

export function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

// WebSocket server setup
export function setupWebSocketServer(messageHandler: (socket: WebSocket, message: any) => void) {
  const wss = new WebSocketServer({
    port: WS_PORT,
    verifyClient: (info: any) => {
      const origin = info.origin;
      logInfo(`WebSocket connection attempt from origin: ${origin}`);
      
      // Allow connections from Chrome extensions and localhost
      return (
        !origin || // Chrome extensions might not send origin
        origin.startsWith("chrome-extension://") ||
        origin === "http://localhost" ||
        origin === "https://localhost"
      );
    }
  });

  wss.on("connection", (socket, request) => {
    const clientIP = request.socket.remoteAddress;
    logInfo(`New WebSocket connection from ${clientIP}`);

    // Update connection state
    connectionState.socket = socket;
    connectionState.isHealthy = true;
    connectionState.lastActivity = Date.now();
    connectionState.reconnectAttempts = 0;

    // Send connection acknowledgment
    wsSend(socket, {
      type: "CONNECTION_ACK",
      serverVersion: "0.1.0",
      timestamp: Date.now(),
    });

    // Handle incoming messages
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        connectionState.lastActivity = Date.now();
        
        if (message.type === "KEEPALIVE_PING") {
          logInfo("Received keepalive ping, sending pong");
          wsSend(socket, { type: "KEEPALIVE_PONG", ts: Date.now() });
          return;
        }

        messageHandler(socket, message);
      } catch (error) {
        logError("Error parsing WebSocket message:", error);
        wsSend(socket, {
          type: "ERROR",
          error: "Invalid JSON message format",
          timestamp: Date.now(),
        });
      }
    });

    socket.on("close", (code, reason) => {
      logInfo(`WebSocket connection closed: ${code} ${reason}`);
      connectionState.socket = null;
      connectionState.isHealthy = false;
    });

    socket.on("error", (error) => {
      logError("WebSocket error:", error);
      connectionState.socket = null;
      connectionState.isHealthy = false;
    });
  });

  wss.on("error", (error) => {
    logError("WebSocket server error:", error);
  });

  startHealthCheck();
  logInfo(`WebSocket server listening on port ${WS_PORT}`);

  return wss;
}
