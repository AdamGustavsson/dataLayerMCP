// service_worker.js – MCP DataLayer Access Extension (MVP) - Enhanced Version

const WS_URL = "ws://localhost:57321";
let ws = null; // WebSocket instance
let keepAliveInterval = null;
let reconnectTimeout = null;
const KEEP_ALIVE_MS = 20_000;
const MAX_RECONNECT_ATTEMPTS = 20;
const BASE_RECONNECT_DELAY = 1000; // Start with 1 second
const MAX_RECONNECT_DELAY = 30_000; // Cap at 30 seconds

// Connection state management
const connectionState = {
  isConnecting: false,
  isConnected: false,
  reconnectAttempts: 0,
  lastConnectionTime: null,
  lastError: null,
};

// Stored tab info keys
const STORAGE_KEYS = {
  TAB_ID: "attachedTabId",
  TAB_TITLE: "attachedTabTitle",
};

// Enhanced logging
function logInfo(message, ...args) {
  console.log(`[Extension][INFO] ${message}`, ...args);
}

function logWarn(message, ...args) {
  console.warn(`[Extension][WARN] ${message}`, ...args);
}

function logError(message, ...args) {
  console.error(`[Extension][ERROR] ${message}`, ...args);
}

// Calculate exponential backoff delay
function getReconnectDelay() {
  const exponentialDelay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, connectionState.reconnectAttempts),
    MAX_RECONNECT_DELAY
  );
  // Add some jitter to prevent thundering herd
  const jitter = Math.random() * 1000;
  return exponentialDelay + jitter;
}

// Utility: Start/stop keep-alive pings
function startKeepAlive() {
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

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    logInfo("Stopped keepalive");
  }
}

function stopReconnectTimeout() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
}

// Enhanced connection attempt with better error handling
async function connectWebSocket() {
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

    ws.addEventListener("message", async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (error) {
        logWarn("Received malformed JSON:", error);
        return;
      }

      switch (msg.type) {
        case "REQUEST_DATALAYER":
          await handleGetDataLayerRequest(msg.requestId);
          break;
        case "KEEPALIVE_PONG":
          logInfo("Received keepalive pong");
          break;
        case "CONNECTION_ACK":
          logInfo(`Server acknowledged connection (version: ${msg.serverVersion})`);
          break;
        default:
          logWarn("Unknown message type:", msg.type);
      }
    });

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

function handleConnectionFailure() {
  connectionState.reconnectAttempts++;
  
  if (connectionState.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logError(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`);
    connectionState.lastError = "Max reconnection attempts reached";
    broadcastConnectionStatus();
    return;
  }
  
  attemptReconnect();
}

function attemptReconnect() {
  stopReconnectTimeout();
  
  const delay = getReconnectDelay();
  logInfo(`Scheduling reconnection attempt in ${Math.round(delay)}ms (attempt ${connectionState.reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
  
  reconnectTimeout = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

// Broadcast connection status to popup and other parts of extension
function broadcastConnectionStatus() {
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

// Enhanced dataLayer extraction with better error handling
function extractDataLayer() {
  // Helper to safely serialize objects that may contain circular references, DOM nodes, or functions
  function getSafeReplacer() {
    const seen = new WeakSet();
    return function (_key, value) {
      // Strip functions entirely
      if (typeof value === "function") {
        return "[Function]";
      }

      // Replace DOM nodes with a lightweight descriptor
      if (value && typeof value === "object" && value.nodeType) {
        const name = value.nodeName; // e.g., "DIV", "A"
        const id = value.id ? `#${value.id}` : "";
        const classes = value.className ? `.${value.className.replace(/\s+/g, '.')}` : "";
        return `[DOMNode:${name}${id}${classes}]`;
      }

      // Handle circular references
      if (value && typeof value === "object") {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }
      return value;
    };
  }

  try {
    const start = performance.now();
    
    if (!window.dataLayer) {
      return { 
        error: "dataLayer not found on this page. Make sure Google Tag Manager is installed.", 
        url: window.location.href,
        timestamp: Date.now()
      };
    }
    
    if (!Array.isArray(window.dataLayer)) {
      return { 
        error: `dataLayer exists but is not an array (type: ${typeof window.dataLayer})`, 
        url: window.location.href,
        timestamp: Date.now()
      };
    }
    
    const json = JSON.stringify(window.dataLayer, getSafeReplacer());
    const end = performance.now();
    
    return {
      dataLayer: JSON.parse(json),
      url: window.location.href,
      timestamp: Date.now(),
      processingTime: Math.round(end - start),
      itemCount: window.dataLayer.length
    };
  } catch (e) {
    return { 
      error: `Failed to clone dataLayer: ${e.message}`, 
      url: window.location.href,
      timestamp: Date.now()
    };
  }
}

async function handleGetDataLayerRequest(requestId) {
  logInfo(`Handling dataLayer request: ${requestId}`);
  
  const { attachedTabId } = await chrome.storage.local.get(STORAGE_KEYS.TAB_ID);
  
  if (!attachedTabId) {
    const errorResponse = {
      type: "DATALAYER_RESPONSE",
      requestId,
      payload: { 
        error: "No tab attached. Ask the human to attach a tab by opening the extension and clicking the attach button.",
        timestamp: Date.now()
      },
    };
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(errorResponse));
    } else {
      logError("Cannot send error response - WebSocket not connected");
    }
    return;
  }

  try {
    // Check if tab still exists
    const tab = await chrome.tabs.get(attachedTabId).catch(() => null);
    if (!tab) {
      throw new Error("Attached tab no longer exists");
    }
    
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: attachedTabId },
      func: extractDataLayer,
      world: "MAIN",
    });

    const response = {
      type: "DATALAYER_RESPONSE",
      requestId,
      payload: result.result,
    };
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
      logInfo(`Successfully sent dataLayer response for request: ${requestId}`);
    } else {
      logError("Cannot send response - WebSocket not connected");
      // Try to reconnect
      attemptReconnect();
    }
    
  } catch (e) {
    logError(`Failed to execute dataLayer script:`, e);
    
    const errorResponse = {
      type: "DATALAYER_RESPONSE",
      requestId,
      payload: { 
        error: `Failed to execute script: ${e.message}`,
        timestamp: Date.now()
      },
    };
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(errorResponse));
    } else {
      logError("Cannot send error response - WebSocket not connected");
    }
  }
}

// Enhanced message listener with better error handling
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    switch (message.type) {
      case "ATTACH_TAB": {
        const { tabId, title } = message;
        logInfo(`Attaching to tab: ${tabId} (${title})`);
        
        chrome.storage.local.set({
          [STORAGE_KEYS.TAB_ID]: tabId,
          [STORAGE_KEYS.TAB_TITLE]: title,
        });
        
        // Reset connection state and connect
        connectionState.reconnectAttempts = 0;
        connectWebSocket();
        
        sendResponse({ 
          attachedTabInfo: { id: tabId, title },
          connectionState: {
            isConnected: connectionState.isConnected,
            isConnecting: connectionState.isConnecting,
          }
        });
        break;
      }

      case "DETACH_TAB": {
        logInfo("Detaching from current tab");
        chrome.storage.local.remove([STORAGE_KEYS.TAB_ID, STORAGE_KEYS.TAB_TITLE]);
        sendResponse({ attachedTabInfo: null });
        break;
      }

      case "GET_ATTACHMENT_STATUS": {
        chrome.storage.local.get([STORAGE_KEYS.TAB_ID, STORAGE_KEYS.TAB_TITLE]).then((data) => {
          const attachedTabInfo = data[STORAGE_KEYS.TAB_ID] ? {
            id: data[STORAGE_KEYS.TAB_ID],
            title: data[STORAGE_KEYS.TAB_TITLE],
          } : null;
          
          sendResponse({
            attachedTabInfo,
            connectionState: {
              isConnected: connectionState.isConnected,
              isConnecting: connectionState.isConnecting,
              reconnectAttempts: connectionState.reconnectAttempts,
              lastConnectionTime: connectionState.lastConnectionTime,
              lastError: connectionState.lastError,
            }
          });
        }).catch((error) => {
          logError("Failed to get attachment status:", error);
          sendResponse({ 
            attachedTabInfo: null, 
            error: error.message,
            connectionState: {
              isConnected: false,
              isConnecting: false,
            }
          });
        });
        // keep channel open
        return true;
      }
      
      case "FORCE_RECONNECT": {
        logInfo("Force reconnect requested");
        connectionState.reconnectAttempts = 0;
        connectionState.lastError = null;
        stopReconnectTimeout();
        
        if (ws) {
          ws.close();
        }
        
        setTimeout(() => connectWebSocket(), 100);
        sendResponse({ success: true });
        break;
      }
      
      default: {
        logWarn("Unknown message type:", message.type);
        sendResponse({ error: "Unknown message type" });
      }
    }
  } catch (error) {
    logError("Error handling message:", error);
    sendResponse({ error: error.message });
  }
});

// Enhanced startup with connection attempt
logInfo("Service worker starting up");

// Check if we have an attached tab and attempt connection
chrome.storage.local.get([STORAGE_KEYS.TAB_ID]).then((data) => {
  if (data[STORAGE_KEYS.TAB_ID]) {
    logInfo("Found attached tab on startup, attempting connection");
    connectWebSocket();
  } else {
    logInfo("No attached tab found on startup");
  }
}).catch((error) => {
  logError("Failed to check for attached tab on startup:", error);
});

// Monitor tab closure
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { attachedTabId } = await chrome.storage.local.get(STORAGE_KEYS.TAB_ID);
  if (attachedTabId === tabId) {
    logInfo("Attached tab was closed, detaching");
    await chrome.storage.local.remove([STORAGE_KEYS.TAB_ID, STORAGE_KEYS.TAB_TITLE]);
    broadcastConnectionStatus();
  }
});

// Clean up on service worker shutdown
self.addEventListener("beforeunload", () => {
  logInfo("Service worker shutting down");
  stopKeepAlive();
  stopReconnectTimeout();
  if (ws) {
    ws.close(1001, "Service worker shutdown");
  }
}); 