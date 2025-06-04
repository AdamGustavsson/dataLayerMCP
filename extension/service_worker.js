// service_worker.js – MCP DataLayer Access Extension (MVP)

const WS_URL = "ws://localhost:57321";
let ws = null; // WebSocket instance
let keepAliveInterval = null;
const KEEP_ALIVE_MS = 20_000;

// Stored tab info keys
const STORAGE_KEYS = {
  TAB_ID: "attachedTabId",
  TAB_TITLE: "attachedTabTitle",
};

// Utility: Start/stop keep-alive pings
function startKeepAlive() {
  stopKeepAlive();
  keepAliveInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "KEEPALIVE_PING", ts: Date.now() }));
    }
  }, KEEP_ALIVE_MS);
}
function stopKeepAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = null;
}

async function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  try {
    ws = new WebSocket(WS_URL);

    ws.addEventListener("open", () => {
      console.log("[Extension] WebSocket connected to MCP server");
      startKeepAlive();
    });

    ws.addEventListener("message", async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "REQUEST_DATALAYER") {
        handleGetDataLayerRequest(msg.requestId);
      }
    });

    ws.addEventListener("close", () => {
      console.warn("[Extension] WebSocket closed, retrying in 2s");
      stopKeepAlive();
      setTimeout(connectWebSocket, 2000);
    });

    ws.addEventListener("error", (err) => {
      console.error("[Extension] WebSocket error", err);
    });
  } catch (err) {
    console.error("[Extension] Failed to connect WebSocket", err);
  }
}

// Executes in page context to read window.dataLayer
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
        return `[DOMNode:${name}]`;
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
    if (Array.isArray(window.dataLayer)) {
      const json = JSON.stringify(window.dataLayer, getSafeReplacer());
      return {
        dataLayer: JSON.parse(json),
        url: window.location.href,
      };
    }
    return { error: "dataLayer not found or not an array on this page.", url: window.location.href };
  } catch (e) {
    return { error: `Failed to clone dataLayer: ${e.message}`, url: window.location.href };
  }
}

async function handleGetDataLayerRequest(requestId) {
  const { attachedTabId } = await chrome.storage.local.get(STORAGE_KEYS.TAB_ID);
  if (!attachedTabId) {
    ws.send(
      JSON.stringify({
        type: "DATALAYER_RESPONSE",
        requestId,
        payload: { error: "No tab attached. Ask the human to attach a tab by opening the extension and clicking the attach button." },
      })
    );
    return;
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: attachedTabId },
      func: extractDataLayer,
      world: "MAIN",
    });

    ws.send(
      JSON.stringify({
        type: "DATALAYER_RESPONSE",
        requestId,
        payload: result.result,
      })
    );
  } catch (e) {
    ws.send(
      JSON.stringify({
        type: "DATALAYER_RESPONSE",
        requestId,
        payload: { error: `Failed to execute script: ${e.message}` },
      })
    );
  }
}

// Message listener from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "ATTACH_TAB": {
      const { tabId, title } = message;
      chrome.storage.local.set({
        [STORAGE_KEYS.TAB_ID]: tabId,
        [STORAGE_KEYS.TAB_TITLE]: title,
      });
      connectWebSocket();
      sendResponse({ attachedTabInfo: { id: tabId, title } });
      break;
    }

    case "DETACH_TAB": {
      chrome.storage.local.remove([STORAGE_KEYS.TAB_ID, STORAGE_KEYS.TAB_TITLE]);
      sendResponse({ attachedTabInfo: null });
      break;
    }

    case "GET_ATTACHMENT_STATUS": {
      chrome.storage.local.get([STORAGE_KEYS.TAB_ID, STORAGE_KEYS.TAB_TITLE]).then((data) => {
        if (data[STORAGE_KEYS.TAB_ID]) {
          sendResponse({
            attachedTabInfo: {
              id: data[STORAGE_KEYS.TAB_ID],
              title: data[STORAGE_KEYS.TAB_TITLE],
            },
          });
        } else {
          sendResponse({ attachedTabInfo: null });
        }
      });
      // keep channel open
      return true;
    }
  }
});

// Attempt connection on service worker start
connectWebSocket(); 