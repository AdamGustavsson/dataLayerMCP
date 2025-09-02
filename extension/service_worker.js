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
  LAST_EVENT_NUMBER: "lastGtmEventNumber", // For tracking GTM event numbers
  PREVIEW_SESSION: "gtmPreviewCb" // For tracking preview session callback ID
};

// GA4 hits storage - per tab
const ga4HitsPerTab = new Map(); // tabId -> hits array
const MAX_HITS_PER_PAGE = 50;

// Meta Pixel hits storage - per tab
const metaPixelHitsPerTab = new Map(); // tabId -> hits array
const MAX_META_PIXEL_HITS_PER_PAGE = 50;

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
        case "REQUEST_GA4_HITS":
          await handleGetGa4HitsRequest(msg.requestId);
          break;
        case "REQUEST_META_PIXEL_HITS":
          await handleGetMetaPixelHitsRequest(msg.requestId);
          break;
        case "REQUEST_NEW_GTM_PREVIEW_EVENTS":
          await handleGetNewGtmPreviewEventsRequest(msg.requestId);
          break;
        case "REQUEST_GTM_CONTAINER_IDS":
          await handleGetGtmContainerIdsRequest(msg.requestId);
          break;
        case "REQUEST_SCHEMA_MARKUP":
          await handleGetSchemaMarkupRequest(msg.requestId);
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

// Enhanced schema markup extraction (JSON-LD and microdata)
function extractSchemaMarkup() {
  try {
    const start = performance.now();
    
    console.log("🚀 Schema markup extraction started");
    console.log("📍 Current URL:", window.location.href);
    
    const schemaData = {
      jsonLd: [],
      microdata: [],
      url: window.location.href,
      timestamp: Date.now()
    };
    
    // Extract JSON-LD scripts
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    console.log(`🔍 Found ${jsonLdScripts.length} JSON-LD script tags`);
    
    jsonLdScripts.forEach((script, index) => {
      try {
        const content = script.textContent || script.innerText;
        if (content.trim()) {
          const parsed = JSON.parse(content);
          schemaData.jsonLd.push({
            index: index,
            raw: content.trim(),
            parsed: parsed,
            type: Array.isArray(parsed) ? 'array' : (parsed['@type'] || 'unknown'),
            context: parsed['@context'] || 'unknown'
          });
          console.log(`✅ Parsed JSON-LD ${index}: ${parsed['@type'] || 'array/unknown'}`);
        }
      } catch (parseError) {
        console.warn(`⚠️ Failed to parse JSON-LD script ${index}:`, parseError);
        schemaData.jsonLd.push({
          index: index,
          raw: script.textContent || script.innerText,
          parsed: null,
          error: parseError.message,
          type: 'parse_error'
        });
      }
    });
    
    // Extract microdata
    const microdataElements = document.querySelectorAll('[itemscope]');
    console.log(`🔍 Found ${microdataElements.length} microdata elements`);
    
    microdataElements.forEach((element, index) => {
      try {
        const microdataItem = {
          index: index,
          itemType: element.getAttribute('itemtype') || null,
          itemId: element.getAttribute('itemid') || null,
          tagName: element.tagName.toLowerCase(),
          properties: {},
          element: {
            id: element.id || null,
            className: element.className || null,
            textContent: element.textContent?.substring(0, 200) + (element.textContent?.length > 200 ? '...' : '') || null
          }
        };
        
        // Extract properties from this itemscope and its descendants
        const propertyElements = element.querySelectorAll('[itemprop]');
        propertyElements.forEach(propEl => {
          const propName = propEl.getAttribute('itemprop');
          let propValue = null;
          
          // Determine the property value based on element type
          if (propEl.hasAttribute('content')) {
            propValue = propEl.getAttribute('content');
          } else if (propEl.hasAttribute('datetime')) {
            propValue = propEl.getAttribute('datetime');
          } else if (propEl.hasAttribute('href')) {
            propValue = propEl.getAttribute('href');
          } else if (propEl.hasAttribute('src')) {
            propValue = propEl.getAttribute('src');
          } else if (propEl.hasAttribute('value')) {
            propValue = propEl.getAttribute('value');
          } else {
            propValue = propEl.textContent?.trim() || null;
          }
          
          // Handle multiple values for the same property
          if (microdataItem.properties[propName]) {
            if (Array.isArray(microdataItem.properties[propName])) {
              microdataItem.properties[propName].push(propValue);
            } else {
              microdataItem.properties[propName] = [microdataItem.properties[propName], propValue];
            }
          } else {
            microdataItem.properties[propName] = propValue;
          }
        });
        
        schemaData.microdata.push(microdataItem);
        console.log(`✅ Extracted microdata ${index}: ${microdataItem.itemType || 'no type'}`);
        
      } catch (microdataError) {
        console.warn(`⚠️ Error processing microdata element ${index}:`, microdataError);
        schemaData.microdata.push({
          index: index,
          error: microdataError.message,
          tagName: element.tagName.toLowerCase(),
          itemType: element.getAttribute('itemtype') || null
        });
      }
    });
    
    const end = performance.now();
    
    // Add processing metadata
    schemaData.processingTime = Math.round(end - start);
    schemaData.summary = {
      jsonLdCount: schemaData.jsonLd.length,
      microdataCount: schemaData.microdata.length,
      jsonLdTypes: schemaData.jsonLd.map(item => item.type).filter(type => type !== 'parse_error'),
      microdataTypes: schemaData.microdata.map(item => item.itemType).filter(Boolean)
    };
    
    console.log(`✅ Schema extraction complete in ${schemaData.processingTime}ms`);
    console.log(`📊 Summary: ${schemaData.summary.jsonLdCount} JSON-LD, ${schemaData.summary.microdataCount} microdata`);
    
    return schemaData;
    
  } catch (error) {
    console.error("❌ Error in schema markup extraction:", error);
    return { 
      error: `Failed to extract schema markup: ${error.message}`, 
      url: window.location.href,
      timestamp: Date.now()
    };
  }
}

// Enhanced GTM container ID extraction
function extractGtmContainerIds() {
  try {
    const start = performance.now();
    
    // Check if Google Tag Manager is available
    if (!window.google_tag_manager) {
      return { 
        error: "Google Tag Manager not found on this page. Make sure GTM is installed and loaded.", 
        url: window.location.href,
        timestamp: Date.now()
      };
    }
    
    // Extract container IDs from google_tag_manager object
    const gtmIds = Object.keys(window.google_tag_manager)
      .filter(id => id.startsWith('GTM-'));
    
    const end = performance.now();
    
    if (gtmIds.length === 0) {
      return {
        error: "No GTM container IDs found. The google_tag_manager object exists but contains no GTM containers.",
        url: window.location.href,
        timestamp: Date.now(),
        availableKeys: Object.keys(window.google_tag_manager)
      };
    }
    
    return {
      containerIds: gtmIds,
      url: window.location.href,
      timestamp: Date.now()
    };
  } catch (e) {
    return { 
      error: `Failed to extract GTM container IDs: ${e.message}`, 
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

async function handleGetGtmContainerIdsRequest(requestId) {
  logInfo(`Handling GTM container IDs request: ${requestId}`);
  
  const { attachedTabId } = await chrome.storage.local.get(STORAGE_KEYS.TAB_ID);
  
  if (!attachedTabId) {
    const errorResponse = {
      type: "GTM_CONTAINER_IDS_RESPONSE",
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
      func: extractGtmContainerIds,
      world: "MAIN",
    });

    const response = {
      type: "GTM_CONTAINER_IDS_RESPONSE",
      requestId,
      payload: result.result,
    };
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
      logInfo(`Successfully sent GTM container IDs response for request: ${requestId}`);
    } else {
      logError("Cannot send response - WebSocket not connected");
      // Try to reconnect
      attemptReconnect();
    }
    
  } catch (e) {
    logError(`Failed to execute GTM container IDs script:`, e);
    
    const errorResponse = {
      type: "GTM_CONTAINER_IDS_RESPONSE",
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

async function handleGetSchemaMarkupRequest(requestId) {
  logInfo(`Handling schema markup request: ${requestId}`);
  
  const { attachedTabId } = await chrome.storage.local.get(STORAGE_KEYS.TAB_ID);
  
  if (!attachedTabId) {
    const errorResponse = {
      type: "SCHEMA_MARKUP_RESPONSE",
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
      func: extractSchemaMarkup,
      world: "MAIN",
    });

    const response = {
      type: "SCHEMA_MARKUP_RESPONSE",
      requestId,
      payload: result.result,
    };
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
      logInfo(`Successfully sent schema markup response for request: ${requestId}`);
    } else {
      logError("Cannot send response - WebSocket not connected");
      // Try to reconnect
      attemptReconnect();
    }
    
  } catch (e) {
    logError(`Failed to execute schema markup script:`, e);
    
    const errorResponse = {
      type: "SCHEMA_MARKUP_RESPONSE",
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

async function handleGetGa4HitsRequest(requestId) {
  logInfo(`Handling GA4 hits request: ${requestId}`);
  
  const { attachedTabId } = await chrome.storage.local.get(STORAGE_KEYS.TAB_ID);
  
  if (!attachedTabId) {
    const errorResponse = {
      type: "GA4_HITS_RESPONSE",
      requestId,
      payload: { 
        error: "No tab attached. Please attach a tab to monitor GA4 hits.",
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

  const hits = ga4HitsPerTab.get(attachedTabId) || [];
  
  const response = {
    type: "GA4_HITS_RESPONSE",
    requestId,
    payload: {
      hits: hits,
      pageUrl: hits.length > 0 ? hits[0].pageUrl : null,
      totalHits: hits.length,
      timestamp: Date.now()
    }
  };
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(response));
    logInfo(`Successfully sent GA4 hits response for request: ${requestId}`);
  } else {
    logError("Cannot send response - WebSocket not connected");
    // Try to reconnect
    attemptReconnect();
  }
}

async function handleGetMetaPixelHitsRequest(requestId) {
  logInfo(`Handling Meta Pixel hits request: ${requestId}`);
  
  const { attachedTabId } = await chrome.storage.local.get(STORAGE_KEYS.TAB_ID);
  
  if (!attachedTabId) {
    const errorResponse = {
      type: "META_PIXEL_HITS_RESPONSE",
      requestId,
      payload: { 
        error: "No tab attached. Please attach a tab to monitor Meta Pixel hits.",
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

  const hits = metaPixelHitsPerTab.get(attachedTabId) || [];
  
  const response = {
    type: "META_PIXEL_HITS_RESPONSE",
    requestId,
    payload: {
      hits: hits,
      pageUrl: hits.length > 0 ? hits[0].pageUrl : null,
      totalHits: hits.length,
      timestamp: Date.now()
    }
  };
  
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(response));
    logInfo(`Successfully sent Meta Pixel hits response for request: ${requestId}`);
  } else {
    logError("Cannot send response - WebSocket not connected");
    // Try to reconnect
    attemptReconnect();
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

// Monitor page navigation to clear GA4 hits
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    ga4HitsPerTab.set(tabId, []); // Clear hits for new page
    metaPixelHitsPerTab.set(tabId, []); // Clear Meta Pixel hits for new page
    logInfo(`Cleared GA4 and Meta Pixel hits for tab ${tabId} - new page: ${changeInfo.url}`);
  }
});

// ---- GA4 Network Request Monitoring ----

// Monitor GA4 GET requests (these contain parsed parameters)
chrome.webRequest.onBeforeRequest.addListener(
  handleGa4GetRequest,
  {
    urls: [
      "https://www.google-analytics.com/g/collect*",
      "https://analytics.google.com/g/collect*",
      "https://*.analytics.google.com/*"
    ]
  },
  ["requestBody"]
);

// Monitor ALL requests (GET and POST) for server-side GA4 tracking
chrome.webRequest.onBeforeRequest.addListener(
  handlePotentialServerSideTracking,
  {
    urls: ["<all_urls>"],
    types: ["xmlhttprequest", "other"]
  },
  ["requestBody"]
);

// ---- Meta Pixel Network Request Monitoring ----

// Monitor direct Meta Pixel requests
chrome.webRequest.onBeforeRequest.addListener(
  handleMetaPixelRequest,
  {
    urls: [
      "https://www.facebook.com/tr*",
      "https://facebook.com/tr*"
    ]
  },
  ["requestBody"]
);

function handleGa4GetRequest(details) {
  try {
    const hit = parseGa4HitFromUrl(details);
    if (hit) {
      addHitToTab(details.tabId, hit);
    }
  } catch (error) {
    logError("Error handling GA4 GET request:", error);
  }
}

function parseGa4HitFromUrl(details) {
  try {
    const url = new URL(details.url);
    const params = Object.fromEntries(url.searchParams.entries());
    
    return {
      timestamp: Date.now(),
      tabId: details.tabId, 
      pageUrl: details.documentUrl,
      method: 'GET',
      eventName: params.en || 'page_view',
      parameters: params,
      measurementId: params.tid || 'unknown',
      domain: url.hostname
    };
  } catch (error) {
    logError("Error parsing GA4 URL hit:", error);
    return null;
  }
}

function addHitToTab(tabId, hit) {
  if (!ga4HitsPerTab.has(tabId)) {
    ga4HitsPerTab.set(tabId, []);
  }
  
  const hits = ga4HitsPerTab.get(tabId);
  hits.push(hit);
  
  // Keep only last MAX_HITS_PER_PAGE hits
  if (hits.length > MAX_HITS_PER_PAGE) {
    hits.splice(0, hits.length - MAX_HITS_PER_PAGE);
  }
  
  logInfo(`Added GA4 hit to tab ${tabId}: ${hit.eventName}`);
}

function handlePotentialServerSideTracking(details) {
  // Skip Google Analytics and Facebook domains (already handled by other listeners)
  if (details.url.includes('google-analytics.com') || 
      details.url.includes('analytics.google.com') ||
      details.url.includes('facebook.com')) {
    return;
  }
  
  try {
    let ga4Data = null;
    let metaPixelData = null;
    
    // Handle GET requests - check URL parameters
    if (details.method === 'GET') {
      ga4Data = detectGA4InUrl(details.url);
      metaPixelData = detectMetaPixelInUrl(details.url);
    }
    // Handle POST requests - check request body
    else if (details.method === 'POST') {
      ga4Data = detectGA4InRequestBody(details.requestBody);
      metaPixelData = detectMetaPixelInRequestBody(details.requestBody);
    }
    
    // Process GA4 data if found
    if (ga4Data) {
      const hit = {
        timestamp: Date.now(),
        tabId: details.tabId,
        method: details.method,
        eventName: ga4Data.en || 'server_side_event',
        parameters: ga4Data,
        measurementId: ga4Data.tid || 'unknown',
        serverSide: true,
        domain: new URL(details.url).hostname
      };
      
      addHitToTab(details.tabId, hit);
      logInfo(`Server-side GA4 hit detected: ${hit.eventName} on ${details.url}`);
    }
    
    // Process Meta Pixel data if found
    if (metaPixelData) {
      const hit = {
        timestamp: Date.now(),
        tabId: details.tabId,
        method: details.method,
        eventName: metaPixelData.ev || metaPixelData.event || 'server_side_event',
        pixelId: metaPixelData.id || metaPixelData.pixel_id || 'unknown',
        parameters: metaPixelData,
        serverSide: true,
        domain: new URL(details.url).hostname,
        customData: extractMetaPixelCustomData(metaPixelData),
        userData: extractMetaPixelUserData(metaPixelData)
      };
      
      addMetaPixelHitToTab(details.tabId, hit);
      logInfo(`Server-side Meta Pixel hit detected: ${hit.eventName} on ${details.url}`);
    }
  } catch (error) {
    // Silently ignore parsing errors to avoid spam
    // logError("Error detecting server-side tracking:", error);
  }
}

function detectGA4InUrl(url) {
  try {
    const urlObj = new URL(url);
    const params = {};
    
    // Extract all URL parameters
    for (const [key, value] of urlObj.searchParams.entries()) {
      params[key] = value;
    }
    
    // Check if this looks like GA4 data
    if (isGA4Payload(params)) {
      return params;
    }
  } catch (e) {
    // Invalid URL, skip
  }
  
  return null;
}

function detectGA4InRequestBody(requestBody) {
  if (!requestBody) return null;
  
  let payload = {};
  
  // Handle form data
  if (requestBody.formData) {
    for (const [key, values] of Object.entries(requestBody.formData)) {
      payload[key] = values[0];
    }
  }
  
  // Handle raw data
  if (requestBody.raw && requestBody.raw.length > 0) {
    try {
      const decoder = new TextDecoder();
      const text = decoder.decode(requestBody.raw[0].bytes);
      
      // Try parsing as URL-encoded
      if (text.includes('=') && text.includes('&')) {
        payload = parseUrlEncoded(text);
      }
      // Try parsing as JSON
      else if (text.trim().startsWith('{')) {
        payload = JSON.parse(text);
      }
    } catch (e) {
      // Not parseable, skip
      return null;
    }
  }
  
  // Check if this looks like GA4 data
  if (isGA4Payload(payload)) {
    return payload;
  }
  
  return null;
}

function isGA4Payload(payload) {
  // Check for GA4 indicators
  const hasTrackingId = payload.tid && payload.tid.startsWith('G-');
  const hasClientId = payload.cid && typeof payload.cid === 'string';
  const hasVersion2 = payload.v === '2' || payload.v === 2;
  const hasEventName = payload.en && typeof payload.en === 'string';
  
  // Must have at least tracking ID and one other GA4 indicator
  return hasTrackingId && (hasClientId || hasVersion2 || hasEventName);
}

function parseUrlEncoded(text) {
  const params = {};
      const pairs = text.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
    if (key && value !== undefined) {
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch (e) {
        // Skip malformed pairs
      }
    }
  }
  return params;
}

function handleMetaPixelRequest(details) {
  try {
    const hit = parseMetaPixelHitFromUrl(details);
    if (hit) {
      addMetaPixelHitToTab(details.tabId, hit);
    }
  } catch (error) {
    logError("Error handling Meta Pixel request:", error);
  }
}

function parseMetaPixelHitFromUrl(details) {
  try {
    const url = new URL(details.url);
    const parameters = {};
    
    // Extract all URL parameters
    for (const [key, value] of url.searchParams.entries()) {
      parameters[key] = value;
    }
    
    const hit = {
      timestamp: Date.now(),
      tabId: details.tabId,
      method: details.method,
      eventName: parameters.ev || parameters.event || 'PageView',
      pixelId: parameters.id || 'unknown',
      parameters: parameters,
      serverSide: false,
      domain: url.hostname,
      customData: extractMetaPixelCustomData(parameters),
      userData: extractMetaPixelUserData(parameters)
    };
    
    logInfo(`Meta Pixel hit captured: ${hit.eventName} (Pixel: ${hit.pixelId})`);
    return hit;
  } catch (error) {
    logError("Error parsing Meta Pixel hit from URL:", error);
    return null;
  }
}

function detectMetaPixelInUrl(url) {
  try {
    const urlObj = new URL(url);
    const params = {};
    
    // Extract all URL parameters
    for (const [key, value] of urlObj.searchParams.entries()) {
      params[key] = value;
    }
    
    // Check if this looks like Meta Pixel data
    if (isMetaPixelPayload(params)) {
      return params;
    }
  } catch (e) {
    // Invalid URL, skip
  }
  
  return null;
}

function detectMetaPixelInRequestBody(requestBody) {
  if (!requestBody) return null;
  
  let payload = {};
  
  // Handle form data
  if (requestBody.formData) {
    for (const [key, values] of Object.entries(requestBody.formData)) {
      payload[key] = values[0];
    }
  }
  
  // Handle raw data
  if (requestBody.raw && requestBody.raw.length > 0) {
    try {
      const decoder = new TextDecoder();
      const text = decoder.decode(requestBody.raw[0].bytes);
      
      // Try parsing as URL-encoded
      if (text.includes('=') && text.includes('&')) {
        payload = parseUrlEncoded(text);
      }
      // Try parsing as JSON
      else if (text.trim().startsWith('{')) {
        payload = JSON.parse(text);
      }
    } catch (e) {
      // Not parseable, skip
      return null;
    }
  }
  
  // Check if this looks like Meta Pixel data
  if (isMetaPixelPayload(payload)) {
    return payload;
  }
  
  return null;
}

function isMetaPixelPayload(payload) {
  // Check for Meta Pixel indicators
  const hasPixelId = payload.id && /^\d+$/.test(payload.id); // Numeric pixel ID
  const hasFacebookParams = Object.keys(payload).some(key => 
    key.startsWith('fb_') || key.startsWith('cd[') || key.startsWith('ud[')
  );
  const hasMetaPixelUrl = payload.dl && payload.dl.includes('facebook.com/tr');
  
  // Meta Pixel requires either:
  // 1. Numeric pixel ID AND event name, OR
  // 2. Facebook-specific parameters, OR  
  // 3. Facebook URL reference
  const hasEventName = payload.ev || payload.event;
  const hasMetaPixelCombo = hasPixelId && hasEventName;
  
  return hasMetaPixelCombo || hasFacebookParams || hasMetaPixelUrl;
}

function extractMetaPixelCustomData(params) {
  const customData = {};
  
  // Extract custom data parameters (cd[...])
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('cd[') && key.endsWith(']')) {
      const cdKey = key.slice(3, -1); // Remove 'cd[' and ']'
      customData[cdKey] = value;
    }
  }
  
  return Object.keys(customData).length > 0 ? customData : undefined;
}

function extractMetaPixelUserData(params) {
  const userData = {};
  
  // Extract user data parameters (ud[...])
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('ud[') && key.endsWith(']')) {
      const udKey = key.slice(3, -1); // Remove 'ud[' and ']'
      userData[udKey] = value;
    }
  }
  
  return Object.keys(userData).length > 0 ? userData : undefined;
}

function addMetaPixelHitToTab(tabId, hit) {
  if (!tabId || !hit) return;
  
  if (!metaPixelHitsPerTab.has(tabId)) {
    metaPixelHitsPerTab.set(tabId, []);
  }
  
  const hits = metaPixelHitsPerTab.get(tabId);
  hits.push(hit);
  
  // Keep only the most recent hits to prevent memory issues
  if (hits.length > MAX_META_PIXEL_HITS_PER_PAGE) {
    hits.shift(); // Remove oldest hit
  }
  
  logInfo(`Added Meta Pixel hit to tab ${tabId}: ${hit.eventName}`);
}

// Global tracking of last event number reported (per session)
async function extractNewGtmPreviewEvents() {
  try {
    // Get the last reported event number from storage
    const { lastGtmEventNumber = 0 } = await chrome.storage.local.get(STORAGE_KEYS.LAST_EVENT_NUMBER);
    
    console.log("🚀 GTM New Events Extraction Started");
    console.log("📍 Current URL:", window.location.href);
    console.log("📄 Page Title:", document.title);
    console.log(`🔢 Last reported event number: ${lastGtmEventNumber}`);
    console.log("📄 Document ready state:", document.readyState);
    
    // Check if we're on the right page
    if (!window.location.href.includes('tagassistant.google.com')) {
      console.error("❌ Not on Tag Assistant page!");
      return {
        error: "Not on Tag Assistant page",
        newEvents: [],
        lastEventNumber: lastGtmEventNumber
      };
    }

    // Helper function to introduce a delay
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Wait for UI to be fully loaded if document is not ready
    if (document.readyState !== 'complete') {
      console.log("⏳ Waiting for document to be ready...");
      await wait(2000);
    }

    console.log("🔍 Checking DOM access...");
    
    // Test basic DOM access
    try {
      const body = document.body;
      const html = document.documentElement;
      console.log("✅ Can access document body:", !!body);
      console.log("✅ Can access document root:", !!html);
      console.log("📄 Body class names:", body.className);
    } catch (domError) {
      console.error("❌ Cannot access basic DOM elements:", domError);
      return {
        error: "Cannot access DOM elements: " + domError.message,
        newEvents: [],
        lastEventNumber: lastGtmEventNumber,
        debug: {
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          timestamp: Date.now()
        }
      };
    }

    // Try multiple selectors to find event rows
    console.log("🔍 Searching for event rows...");
    
    let allEventRows = [];
    const selectors = [
      '.message-list__row--indented',
      '.message-list__row',
      '[class*="message-list__row"]',
      '[class*="message-list"] [class*="row"]',
      // Add more generic selectors
      'div[class*="row"]',
      '[role="row"]',
      '[class*="event"]'
    ];
    
    for (const selector of selectors) {
      try {
        const rows = document.querySelectorAll(selector);
        console.log(`🔍 Selector "${selector}" found ${rows.length} rows`);
        
        if (rows.length > 0) {
          // Log the first row found to help debug
          console.log(`📋 First row HTML for "${selector}":`, rows[0].outerHTML);
          console.log(`📋 First row classes for "${selector}":`, rows[0].className);
          
          if (!allEventRows.length) {
            allEventRows = rows;
          }
        }
      } catch (selectorError) {
        console.error(`❌ Error with selector "${selector}":`, selectorError);
      }
    }

    // If still no rows found, try to log some parent containers
    if (allEventRows.length === 0) {
      console.log("⚠️ No event rows found with any selector, checking containers...");
      
      // Try to find and log any relevant containers
      const containers = document.querySelectorAll('div[class*="container"], div[class*="list"], div[class*="events"]');
      console.log(`📋 Found ${containers.length} potential containers`);
      
      containers.forEach((container, index) => {
        console.log(`📋 Container ${index} classes:`, container.className);
        console.log(`📋 Container ${index} children count:`, container.children.length);
        // Log first few children if any
        if (container.children.length > 0) {
          console.log(`📋 First child of container ${index}:`, container.children[0].outerHTML);
        }
      });

      return {
        newEvents: [],
        lastEventNumber: lastGtmEventNumber,
        totalEventsOnPage: 0,
        debug: {
          url: window.location.href,
          title: document.title,
          timestamp: Date.now(),
          documentReady: document.readyState,
          containers: Array.from(containers).map(c => ({
            className: c.className,
            childCount: c.children.length
          }))
        }
      };
    }

    // Rest of the function remains the same...
    const newEvents = [];
    let highestEventNumber = lastGtmEventNumber;
    
    // Check each DOM row for new events
    for (const [index, eventRow] of allEventRows.entries()) {
      try {
        console.log(`📋 Processing row ${index}...`);
        
        // Extract event number and name from DOM
        const eventNumberElement = eventRow.querySelector('[class*="index"]') || 
                                eventRow.querySelector('[class*="number"]');
        const eventNameElement = eventRow.querySelector('[class*="title"]') || 
                              eventRow.querySelector('[class*="name"]');
        
        if (eventNumberElement && eventNameElement) {
          const eventNumber = parseInt(eventNumberElement.textContent.trim(), 10);
          const eventName = eventNameElement.textContent.trim();
          
          console.log(`🔍 Found event #${eventNumber} "${eventName}"`);
          
          if (isNaN(eventNumber)) {
            console.log("⚠️ Invalid event number:", eventNumberElement.textContent);
            continue;
          }
          
          // Only process events with numbers greater than last reported
          if (eventNumber > lastGtmEventNumber) {
            console.log(`🆕 New event detected: #${eventNumber} "${eventName}"`);
            
            try {
              // Click the event to load tag details
              console.log("🖱️ Clicking event to load tag details...");
              eventRow.click();
              await wait(250); // Wait for UI to update
            } catch (clickError) {
              console.error("❌ Error clicking row:", clickError);
            }
            
            let tagsFired = [];
            try {
              // Try to find tags section
              const tagSelectors = ['[class*="fired-tag"]', '[class*="tags-fired"]', '[class*="tag-list"]'];
              let firedTagsSection = null;
              
              for (const selector of tagSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                  firedTagsSection = element;
                  console.log(`✅ Found tags section with selector: ${selector}`);
                  break;
                }
              }
              
              if (firedTagsSection) {
                const sectionText = firedTagsSection.textContent?.trim();
                console.log(`📋 Tags section text: "${sectionText}"`);
                
                if (sectionText && !sectionText.includes('None') && !sectionText.includes('No tags')) {
                  const tagElements = firedTagsSection.querySelectorAll('*');
                  tagElements.forEach((el) => {
                    const text = el.textContent?.trim();
                    if (text && text.length > 1 && text.length < 200 &&
                        text !== 'Tags fired' && text !== 'None' &&
                        text !== 'No tags' && text !== sectionText) {
                      if (!tagsFired.includes(text)) {
                        tagsFired.push(text);
                        console.log(`  🏷️ Found tag: "${text}"`);
                      }
                    }
                  });
                }
              } else {
                console.log("⚠️ Could not find tags section");
              }
            } catch (tagsError) {
              console.error("❌ Error processing tags:", tagsError);
            }
            
            // Add to new events
            newEvents.push({
              eventNumber: eventNumber,
              eventName: eventName,
              tagsFired: tagsFired,
              timestamp: Date.now()
            });
            
            // Track highest event number
            if (eventNumber > highestEventNumber) {
              highestEventNumber = eventNumber;
            }
          }
        } else {
          console.log(`⚠️ Could not extract event info from row ${index}:`, {
            hasNumberElement: !!eventNumberElement,
            hasNameElement: !!eventNameElement,
            rowContent: eventRow.textContent?.trim()
          });
        }
      } catch (rowError) {
        console.error(`❌ Error processing row ${index}:`, rowError);
      }
    }
    
    // Update the last reported event number
    if (highestEventNumber > lastGtmEventNumber) {
      // Update the storage with new highest number
      await chrome.storage.local.set({
        [STORAGE_KEYS.LAST_EVENT_NUMBER]: highestEventNumber
      });
      console.log(`✅ Updated last reported event number in storage to: ${highestEventNumber}`);
    }
    
    // Sort new events by event number
    newEvents.sort((a, b) => a.eventNumber - b.eventNumber);
    
    console.log(`✅ GTM New Events Extraction Complete!`);
    console.log(`🆕 New events found: ${newEvents.length}`);
    console.log(`📊 Total events on page: ${allEventRows.length}`);

    return {
      newEvents: newEvents,
      lastEventNumber: highestEventNumber,
      totalEventsOnPage: allEventRows.length,
      debug: {
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
        documentReady: document.readyState,
        selectors: selectors.map(s => ({
          selector: s,
          count: document.querySelectorAll(s).length
        }))
      }
    };
  } catch (error) {
    console.error("❌ Top-level error in extractNewGtmPreviewEvents:", error);
    // Get the last event number even in case of error
    const { lastGtmEventNumber = 0 } = await chrome.storage.local.get(STORAGE_KEYS.LAST_EVENT_NUMBER);
    return {
      error: "Failed to extract events: " + error.message,
      newEvents: [],
      lastEventNumber: lastGtmEventNumber,
      debug: {
        url: window.location.href,
        title: document.title,
        timestamp: Date.now(),
        errorMessage: error.message,
        errorStack: error.stack
      }
    };
  }
}

async function handleGetNewGtmPreviewEventsRequest(requestId) {
  logInfo(`Handling new GTM preview events request: ${requestId}`);
  
  try {
    // Search for any open Tag Assistant tab
    const tagAssistantTabs = await chrome.tabs.query({
      url: "https://tagassistant.google.com/*"
    });
    
    if (tagAssistantTabs.length === 0) {
      const errorResponse = {
        type: "NEW_GTM_PREVIEW_EVENTS_RESPONSE",
        requestId,
        payload: { 
          error: "No Tag Assistant tab found. Please open https://tagassistant.google.com in a browser tab.",
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

    // Use the first Tag Assistant tab found
    const tagAssistantTab = tagAssistantTabs[0];
    logInfo(`Found Tag Assistant tab: ${tagAssistantTab.id} - ${tagAssistantTab.title}`);

    // Parse the URL and fragment
    const url = new URL(tagAssistantTab.url);
    const hashParams = new URLSearchParams(url.hash.replace('#', '').replace('/?', ''));
    const currentCb = hashParams.get('cb');
    const { gtmPreviewCb } = await chrome.storage.local.get(STORAGE_KEYS.PREVIEW_SESSION);

    logInfo("🔍 Current cb:", currentCb);
    logInfo("🔍 GTM preview cb:", gtmPreviewCb);
    if (currentCb && currentCb !== gtmPreviewCb) {
      logInfo(`New preview session detected. Old cb: ${gtmPreviewCb}, New cb: ${currentCb}`);
      // Reset event counter and update session
      await chrome.storage.local.set({
        [STORAGE_KEYS.LAST_EVENT_NUMBER]: 0,
        [STORAGE_KEYS.PREVIEW_SESSION]: currentCb
      });
      logInfo('Reset event counter for new preview session');
    }

    // Get the last event number from storage
    const { lastGtmEventNumber = 0 } = await chrome.storage.local.get(STORAGE_KEYS.LAST_EVENT_NUMBER);

    // Execute new events extraction on the Tag Assistant tab with the last event number
    const results = await chrome.scripting.executeScript({
      target: { tabId: tagAssistantTab.id },
      func: (lastEventNumber) => {
        return new Promise(async (resolve) => {
          try {
            console.log("🚀 GTM New Events Extraction Started");
            console.log("📍 Current URL:", window.location.href);
            console.log("📄 Page Title:", document.title);
            console.log(`🔢 Last reported event number: ${lastEventNumber}`);
            console.log("📄 Document ready state:", document.readyState);
            
            // Helper function to introduce a delay
            const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            // Wait for UI to be fully loaded if document is not ready
            if (document.readyState !== 'complete') {
              console.log("⏳ Waiting for document to be ready...");
              await wait(2000);
            }

            console.log("🔍 Checking DOM access...");
            
            // Test basic DOM access
            try {
              const body = document.body;
              const html = document.documentElement;
              console.log("✅ Can access document body:", !!body);
              console.log("✅ Can access document root:", !!html);
              console.log("📄 Body class names:", body.className);
            } catch (domError) {
              console.error("❌ Cannot access basic DOM elements:", domError);
              resolve({
                error: "Cannot access DOM elements: " + domError.message,
                newEvents: [],
                lastEventNumber: lastEventNumber,
                debug: {
                  url: window.location.href,
                  title: document.title,
                  readyState: document.readyState,
                  timestamp: Date.now()
                }
              });
              return;
            }

            // First, find all page groups
            console.log("🔍 Searching for page groups...");
            const pageGroups = [];
            const pageGroupElements = document.querySelectorAll('.message-list__title.wd-debug-message-title');
            
            console.log(`📋 Found ${pageGroupElements.length} page groups`);
            
            // Use for...of instead of forEach for async operations
            for (const [index, pageEl] of Array.from(pageGroupElements).entries()) {
              const pageTitle = pageEl.textContent?.trim();
              console.log(`📄 Page group ${index + 1}: "${pageTitle}"`);
              
              // Find URL for this page group
              let pageUrl = null;
              try {
                // Click the page group title to ensure URL is visible
                pageEl.click();
                // Wait a bit for UI to update
                await wait(100);
                // Look for URL in the next elements
                const urlInput = document.querySelector('.blg-body.content__url.wd-page-url, input.wd-page-url[type="text"]');
                if (urlInput) {
                  pageUrl = urlInput.value;
                  console.log(`📍 Found URL for page "${pageTitle}": ${pageUrl}`);
                }
              } catch (error) {
                console.error(`❌ Error getting URL for page "${pageTitle}":`, error);
              }
              
              pageGroups.push({
                title: pageTitle,
                element: pageEl,
                url: pageUrl,
                events: []
              });
            }

            // Try multiple selectors to find event rows
            console.log("🔍 Searching for event rows...");
            
            let allEventRows = [];
            const selectors = [
              '.message-list__row--indented',
              '.message-list__row',
              '[class*="message-list__row"]',
              '[class*="message-list"] [class*="row"]',
              'div[class*="row"]',
              '[role="row"]',
              '[class*="event"]'
            ];
            
            for (const selector of selectors) {
              try {
                const rows = document.querySelectorAll(selector);
                console.log(`🔍 Selector "${selector}" found ${rows.length} rows`);
                
                if (rows.length > 0) {
                  console.log(`📋 First row HTML for "${selector}":`, rows[0].outerHTML);
                  console.log(`📋 First row classes for "${selector}":`, rows[0].className);
                  
                  if (!allEventRows.length) {
                    allEventRows = rows;
                  }
                }
              } catch (selectorError) {
                console.error(`❌ Error with selector "${selector}":`, selectorError);
              }
            }

            if (allEventRows.length === 0) {
              console.log("⚠️ No event rows found with any selector");
              resolve({
                newEvents: [],
                lastEventNumber: lastEventNumber,
                totalEventsOnPage: 0,
                pages: pageGroups.map(pg => ({ title: pg.title, events: [] })),
                debug: {
                  url: window.location.href,
                  title: document.title,
                  timestamp: Date.now(),
                  documentReady: document.readyState,
                  pageGroupsFound: pageGroups.length
                }
              });
              return;
            }

            const newEvents = [];
            let highestEventNumber = lastEventNumber;
            
            // Process events and associate them with page groups
            for (const [index, eventRow] of allEventRows.entries()) {
              try {
                console.log(`📋 Processing row ${index}...`);
                
                const eventNumberElement = eventRow.querySelector('[class*="index"]') || 
                                       eventRow.querySelector('[class*="number"]');
                const eventNameElement = eventRow.querySelector('[class*="title"]') || 
                                     eventRow.querySelector('[class*="name"]');
                
                if (eventNumberElement && eventNameElement) {
                  const eventNumber = parseInt(eventNumberElement.textContent.trim(), 10);
                  const eventName = eventNameElement.textContent.trim();
                  
                  console.log(`🔍 Found event #${eventNumber} "${eventName}"`);
                  
                  if (isNaN(eventNumber)) {
                    console.log("⚠️ Invalid event number:", eventNumberElement.textContent);
                    continue;
                  }
                  
                  // Find which page group this event belongs to
                  let pageGroup = null;
                  for (let i = pageGroups.length - 1; i >= 0; i--) {
                    if (eventRow.compareDocumentPosition(pageGroups[i].element) & Node.DOCUMENT_POSITION_PRECEDING) {
                      pageGroup = pageGroups[i];
                      break;
                    }
                  }
                  
                  if (eventNumber > lastEventNumber) {
                    console.log(`🆕 New event detected: #${eventNumber} "${eventName}"`);
                    
                    let eventUrl = null; // Declare eventUrl here
                    try {
                      console.log("🖱️ Clicking event to load tag details...");
                      eventRow.click();
                      await wait(250);

                      // Look for URL element after clicking
                      const urlElement = document.querySelector('.blg-body.content__url.wd-page-url');
                      eventUrl = urlElement ? urlElement.value : null; // Assign to the variable in scope
                      if (eventUrl) {
                        console.log(`📍 Found event URL: ${eventUrl}`);
                      }

                    } catch (clickError) {
                      console.error("❌ Error clicking row:", clickError);
                    }
                    
                    let tagsFired = [];
                    try {
                      const tagSelectors = ['[class*="fired-tag"]', '[class*="tags-fired"]', '[class*="tag-list"]'];
                      let firedTagsSection = null;
                      
                      for (const selector of tagSelectors) {
                        const element = document.querySelector(selector);
                        if (element) {
                          firedTagsSection = element;
                          break;
                        }
                      }
                      
                      if (firedTagsSection) {
                        const sectionText = firedTagsSection.textContent?.trim();
                        
                        if (sectionText && !sectionText.includes('None') && !sectionText.includes('No tags')) {
                          const tagElements = firedTagsSection.querySelectorAll('*');
                          tagElements.forEach((el) => {
                            const text = el.textContent?.trim();
                            if (text && text.length > 1 && text.length < 200 &&
                                text !== 'Tags fired' && text !== 'None' &&
                                text !== 'No tags' && text !== sectionText) {
                              if (!tagsFired.includes(text)) {
                                tagsFired.push(text);
                              }
                            }
                          });
                        }
                      }
                    } catch (tagsError) {
                      console.error("❌ Error processing tags:", tagsError);
                    }
                    
                    const eventData = {
                      eventNumber: eventNumber,
                      eventName: eventName,
                      tagsFired: tagsFired,
                      timestamp: Date.now(),
                      page: pageGroup ? {
                        title: pageGroup.title,
                        index: pageGroups.indexOf(pageGroup),
                        url: pageGroup.url
                      } : null
                    };

                    newEvents.push(eventData);
                    if (pageGroup) {
                      pageGroup.events.push(eventData);
                    }
                    
                    if (eventNumber > highestEventNumber) {
                      highestEventNumber = eventNumber;
                    }
                  }
                } else {
                  console.log(`⚠️ Could not extract event info from row ${index}:`, {
                    hasNumberElement: !!eventNumberElement,
                    hasNameElement: !!eventNameElement,
                    rowContent: eventRow.textContent?.trim()
                  });
                }
              } catch (rowError) {
                console.error(`❌ Error processing row ${index}:`, rowError);
              }
            }
            
            newEvents.sort((a, b) => a.eventNumber - b.eventNumber);
            
            console.log(`✅ GTM New Events Extraction Complete!`);
            console.log(`🆕 New events found: ${newEvents.length}`);
            console.log(`📊 Total events on page: ${allEventRows.length}`);
            console.log(`📑 Events by page:`, pageGroups.map(pg => ({
              title: pg.title,
              eventCount: pg.events.length
            })));

            resolve({
              newEvents: newEvents,
              lastEventNumber: highestEventNumber,
              totalEventsOnPage: allEventRows.length,
              pages: pageGroups.map(pg => ({
                title: pg.title,
                events: pg.events
              })),
              debug: {
                url: window.location.href,
                title: document.title,
                timestamp: Date.now(),
                documentReady: document.readyState,
                pageGroupsFound: pageGroups.length,
                selectors: selectors.map(s => ({
                  selector: s,
                  count: document.querySelectorAll(s).length
                }))
              }
            });
          } catch (error) {
            console.error("❌ Top-level error in GTM events extraction:", error);
            resolve({
              error: "Failed to extract events: " + error.message,
              newEvents: [],
              lastEventNumber: lastEventNumber,
              pages: [],
              debug: {
                url: window.location.href,
                title: document.title,
                timestamp: Date.now(),
                errorMessage: error.message,
                errorStack: error.stack
              }
            });
          }
        });
      },
      args: [lastGtmEventNumber]
    });

    const gtmData = results[0]?.result;
    
    if (gtmData?.error) {
      const errorResponse = {
        type: "NEW_GTM_PREVIEW_EVENTS_RESPONSE",
        requestId,
        payload: { 
          error: gtmData.error,
          timestamp: Date.now()
        },
      };
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(errorResponse));
      }
      return;
    }

    // Update the last event number in storage if we found new events
    if (gtmData?.lastEventNumber > lastGtmEventNumber) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.LAST_EVENT_NUMBER]: gtmData.lastEventNumber
      });
      logInfo(`Updated last GTM event number to ${gtmData.lastEventNumber}`);
    }

    // Send successful response
    const response = {
      type: "NEW_GTM_PREVIEW_EVENTS_RESPONSE",
      requestId,
      payload: {
        newEvents: gtmData?.newEvents || [],
        metadata: {
          tabId: tagAssistantTab.id,
          tabTitle: tagAssistantTab.title,
          tabUrl: tagAssistantTab.url,
          timestamp: Date.now(),
          newEventsCount: gtmData?.newEvents?.length || 0,
          lastEventNumber: gtmData?.lastEventNumber || 0,
          totalEventsOnPage: gtmData?.totalEventsOnPage || 0
        }
      },
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(response));
      logInfo(`New GTM preview events sent: ${response.payload.metadata.newEventsCount} new events`);
    } else {
      logError("Cannot send new GTM preview events response - WebSocket not connected");
    }

  } catch (error) {
    logError(`Error in handleGetNewGtmPreviewEventsRequest: ${error.message}`);
    
    const errorResponse = {
      type: "NEW_GTM_PREVIEW_EVENTS_RESPONSE",
      requestId,
      payload: { 
        error: `Failed to extract new GTM preview events: ${error.message}`,
        timestamp: Date.now()
      },
    };
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(errorResponse));
    }
  }
}

// Clean up on service worker shutdown
self.addEventListener("beforeunload", () => {
  logInfo("Service worker shutting down");
  stopKeepAlive();
  stopReconnectTimeout();
  if (ws) {
    ws.close(1001, "Service worker shutdown");
  }
}); 