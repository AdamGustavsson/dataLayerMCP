// connection.js - WebSocket connection management

import { logInfo, logWarn, logError } from './utils/logging.js';
import { STORAGE_KEYS } from './utils/storage.js';

// Connection configuration
export const WS_URL = "ws://localhost:57321";
export const KEEP_ALIVE_MS = 20_000;
export const MAX_RECONNECT_ATTEMPTS = 20;
export const BASE_RECONNECT_DELAY = 1000; // Start with 1 second
export const MAX_RECONNECT_DELAY = 30_000; // Cap at 30 seconds

// Connection state management
export const connectionState = {
  isConnecting: false,
  isConnected: false,
  reconnectAttempts: 0,
  lastConnectionTime: null,
  lastError: null,
};

// Global variables
let ws = null; // WebSocket instance

// Export getter function for WebSocket instance
export function getWebSocket() {
  return ws;
}
let keepAliveInterval = null;
let reconnectTimeout = null;

// Calculate exponential backoff delay
export function getReconnectDelay() {
  const exponentialDelay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, connectionState.reconnectAttempts),
    MAX_RECONNECT_DELAY
  );
  // Add some jitter to prevent thundering herd
  const jitter = Math.random() * 1000;
  return exponentialDelay + jitter;
}

// Utility: Start/stop keep-alive pings
export function startKeepAlive() {
  stopKeepAlive();
  keepAliveInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "KEEPALIVE_PING", ts: Date.now() }));
        logInfo("Sent keepalive ping");
      } catch (error) {
        logError("Failed to send keepalive ping:", error);
        connectionState.isConnected = false;
        attemptReconnect();
      }
    } else {
      logWarn("Keepalive: WebSocket not open, attempting reconnect");
      connectionState.isConnected = false;
      attemptReconnect();
    }
  }, KEEP_ALIVE_MS);
}

export function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    logInfo("Stopped keepalive");
  }
}

export function stopReconnectTimeout() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

export function handleConnectionFailure() {
  connectionState.reconnectAttempts++;
  
  if (connectionState.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logError(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
    connectionState.lastError = "Max reconnection attempts reached";
    broadcastConnectionStatus();
    return;
  }
  
  attemptReconnect();
}

export function attemptReconnect() {
  stopReconnectTimeout();
  
  const delay = getReconnectDelay();
  logInfo(`Scheduling reconnection attempt in ${Math.round(delay)}ms (attempt ${connectionState.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
  
  reconnectTimeout = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

// Broadcast connection status to popup and other parts of extension
export function broadcastConnectionStatus() {
  const status = {
    isConnected: connectionState.isConnected,
    isConnecting: connectionState.isConnecting,
    reconnectAttempts: connectionState.reconnectAttempts,
    lastConnectionTime: connectionState.lastConnectionTime,
    lastError: connectionState.lastError,
  };
  
  // Try to send to popup if it's listening
  chrome.runtime.sendMessage({ type: "CONNECTION_STATUS_UPDATE", status }).catch(() => {
    // Popup might not be open, that's okay
  });
}

// Enhanced connection attempt with better error handling
export async function connectWebSocket(messageHandler) {
  // Prevent multiple simultaneous connection attempts
  if (connectionState.isConnecting || (ws && ws.readyState === WebSocket.CONNECTING)) {
    logInfo("Connection attempt already in progress, skipping");
    return;
  }

  // Don't attempt if already connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    logInfo("Already connected, skipping connection attempt");
    return;
  }

  connectionState.isConnecting = true;
  connectionState.lastError = null;

  try {
    logInfo(`Attempting WebSocket connection (attempt ${connectionState.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
    
    ws = new WebSocket(WS_URL);
    
    // Set connection timeout
    const connectionTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        logError("Connection timeout");
        ws.close();
        connectionState.lastError = "Connection timeout";
        handleConnectionFailure();
      }
    }, 10000); // 10 second timeout

    ws.addEventListener("open", () => {
      clearTimeout(connectionTimeout);
      logInfo("WebSocket connected to MCP server");
      
      // Update connection state
      connectionState.isConnecting = false;
      connectionState.isConnected = true;
      connectionState.reconnectAttempts = 0;
      connectionState.lastConnectionTime = Date.now();
      connectionState.lastError = null;
      
      startKeepAlive();
      
      // Notify popup if it's open
      broadcastConnectionStatus();
    });

    ws.addEventListener("message", messageHandler);

    ws.addEventListener("close", (event) => {
      clearTimeout(connectionTimeout);
      const { code, reason } = event;
      logWarn(`WebSocket closed (code: ${code}, reason: ${reason || 'no reason'})`);
      
      connectionState.isConnecting = false;
      connectionState.isConnected = false;
      connectionState.lastError = `Connection closed: ${code} ${reason}`;
      
      stopKeepAlive();
      broadcastConnectionStatus();
      
      // Don't reconnect if it was a normal closure or server shutdown
      if (code !== 1000 && code !== 1001) {
        attemptReconnect();
      }
    });

    ws.addEventListener("error", (error) => {
      clearTimeout(connectionTimeout);
      logError("WebSocket error:", error);
      
      connectionState.isConnecting = false;
      connectionState.isConnected = false;
      connectionState.lastError = "WebSocket error";
      
      stopKeepAlive();
      broadcastConnectionStatus();
      handleConnectionFailure();
    });

  } catch (error) {
    connectionState.isConnecting = false;
    connectionState.lastError = `Connection failed: ${error.message}`;
    logError("Failed to create WebSocket connection:", error);
    handleConnectionFailure();
  }
}

// Force reconnection (used by popup)
export function forceReconnect(messageHandler) {
  logInfo("Force reconnect requested");
  connectionState.reconnectAttempts = 0;
  connectionState.lastError = null;
  stopReconnectTimeout();
  
  if (ws) {
    ws.close();
  }
  
  setTimeout(() => connectWebSocket(messageHandler), 100);
}

// Clean up connections
export function cleanup() {
  logInfo("Cleaning up connections");
  stopKeepAlive();
  stopReconnectTimeout();
  if (ws) {
    ws.close(1001, "Service worker shutdown");
  }
}
