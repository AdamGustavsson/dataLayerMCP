// service_worker.js – MCP DataLayer Access Extension - Modular Version

import { 
  connectWebSocket, 
  connectionState, 
  forceReconnect, 
  cleanup,
  getWebSocket 
} from './modules/connection.js';
import { 
  STORAGE_KEYS, 
  ga4HitsPerTab, 
  metaPixelHitsPerTab, 
  MAX_HITS_PER_PAGE, 
  MAX_META_PIXEL_HITS_PER_PAGE 
} from './modules/utils/storage.js';
import { logInfo, logWarn, logError } from './modules/utils/logging.js';
import { extractDataLayer } from './modules/extractors/dataLayer.js';
import { extractSchemaMarkup } from './modules/extractors/schema.js';
import { extractMetaTags } from './modules/extractors/metaTags.js';

// Track the currently connected server identity
let connectedServerId = null;
let connectedServerStartedAt = null;

// Helper function to send WebSocket message
function sendWebSocketMessage(message) {
  const ws = getWebSocket();
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Tag outbound messages with the server identity we acknowledged
    const payload = { 
      ...message, 
      _targetServerInstanceId: connectedServerId, 
      _targetServerStartedAt: connectedServerStartedAt 
    };
    ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

// Message handler for WebSocket messages
async function handleWebSocketMessage(event) {
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
    case "REQUEST_META_TAGS":
      await handleGetMetaTagsRequest(msg.requestId);
      break;
    case "REQUEST_CRAWLABILITY_AUDIT":
      await handleCrawlabilityAuditRequest(msg.requestId);
      break;
    case "KEEPALIVE_PONG":
      logInfo("Received keepalive pong");
      break;
    case "CONNECTION_ACK":
      logInfo(`Server acknowledged connection (version: ${msg.serverVersion})`);
      connectedServerId = msg.serverInstanceId || null;
      connectedServerStartedAt = msg.serverStartedAt || null;
      // Cache in storage for debugging/visibility
      try {
        await chrome.storage.local.set({ __activeServerInstanceId: connectedServerId, __activeServerStartedAt: connectedServerStartedAt });
      } catch {}
      break;
    default:
      logWarn("Unknown message type:", msg.type);
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

// Request handlers
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
    
    if (!sendWebSocketMessage(errorResponse)) {
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
    
    if (sendWebSocketMessage(response)) {
      logInfo(`Successfully sent dataLayer response for request: ${requestId}`);
    } else {
      logError("Cannot send response - WebSocket not connected");
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
    
    if (!sendWebSocketMessage(errorResponse)) {
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
    
    if (!sendWebSocketMessage(errorResponse)) {
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
    
    if (sendWebSocketMessage(response)) {
      logInfo(`Successfully sent schema markup response for request: ${requestId}`);
    } else {
      logError("Cannot send response - WebSocket not connected");
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
    
    if (!sendWebSocketMessage(errorResponse)) {
      logError("Cannot send error response - WebSocket not connected");
    }
  }
}

async function handleGetMetaTagsRequest(requestId) {
  logInfo(`Handling meta tags request: ${requestId}`);
  
  const { attachedTabId } = await chrome.storage.local.get(STORAGE_KEYS.TAB_ID);
  
  if (!attachedTabId) {
    const errorResponse = {
      type: "META_TAGS_RESPONSE",
      requestId,
      payload: { 
        error: "No tab attached. Ask the human to attach a tab by opening the extension and clicking the attach button.",
        timestamp: Date.now()
      },
    };
    
    if (!sendWebSocketMessage(errorResponse)) {
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
      func: extractMetaTags,
      world: "MAIN",
    });

    const response = {
      type: "META_TAGS_RESPONSE",
      requestId,
      payload: result.result,
    };
    
    if (sendWebSocketMessage(response)) {
      logInfo(`Successfully sent meta tags response for request: ${requestId}`);
    } else {
      logError("Cannot send response - WebSocket not connected");
    }
    
  } catch (e) {
    logError(`Failed to execute meta tags script:`, e);
    
    const errorResponse = {
      type: "META_TAGS_RESPONSE",
      requestId,
      payload: { 
        error: `Failed to execute script: ${e.message}`,
        timestamp: Date.now()
      },
    };
    
    if (!sendWebSocketMessage(errorResponse)) {
      logError("Cannot send error response - WebSocket not connected");
    }
  }
}

// Crawlability audit: meta robots, headers (X-Robots-Tag), robots.txt/sitemaps
async function handleCrawlabilityAuditRequest(requestId) {
  logInfo(`Handling crawlability audit request: ${requestId}`);

  try {
    const { attachedTabId } = await chrome.storage.local.get(STORAGE_KEYS.TAB_ID);
    if (!attachedTabId) {
      const errorResponse = {
        type: "CRAWLABILITY_AUDIT_RESPONSE",
        requestId,
        payload: {
          error: "No tab attached. Attach a tab from the extension popup.",
          timestamp: Date.now(),
        },
      };
      if (!sendWebSocketMessage(errorResponse)) {
        logError("Cannot send error response - WebSocket not connected");
      }
      return;
    }

    const tab = await chrome.tabs.get(attachedTabId).catch(() => null);
    if (!tab || !tab.url) {
      const errorResponse = {
        type: "CRAWLABILITY_AUDIT_RESPONSE",
        requestId,
        payload: {
          error: "Attached tab not found or has no URL",
          timestamp: Date.now(),
        },
      };
      if (!sendWebSocketMessage(errorResponse)) {
        logError("Cannot send error response - WebSocket not connected");
      }
      return;
    }

    const pageUrl = tab.url;
    const u = new URL(pageUrl);
    const origin = u.origin;
    const robotsUrl = `${origin}/robots.txt`;

    // 1) Extract meta tags (including robots)
    let meta = null;
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: attachedTabId },
        func: () => {
          try {
            const robotsMeta = document.querySelector('meta[name="robots"]');
            const canonical = document.querySelector('link[rel="canonical"]');
            const title = document.title || null;
            const descriptionMeta = document.querySelector('meta[name="description"]');
            return {
              title,
              robots: robotsMeta ? robotsMeta.getAttribute('content') : null,
              canonical: canonical ? canonical.getAttribute('href') : null,
              metaDescription: descriptionMeta ? descriptionMeta.getAttribute('content') : null,
              url: window.location.href,
            };
          } catch (e) {
            return { error: e.message, url: window.location.href };
          }
        },
        world: "MAIN",
      });
      meta = result?.result || null;
    } catch (e) {
      meta = { error: `Meta extraction failed: ${e?.message || e}` };
    }

    // 2) Fetch page headers (prefer HEAD; fallback to GET on non-2xx)
    async function fetchHeaders(url) {
      async function doFetch(method) {
        try {
          const res = await fetch(url, { method, redirect: 'follow', cache: 'no-store' });
          const headers = {};
          res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
          return { ok: res.ok, status: res.status, url: res.url, headers, method };
        } catch (err) {
          return { ok: false, error: String(err), method };
        }
      }

      // Try HEAD first
      const head = await doFetch('HEAD');
      // Some servers return 404/405 for HEAD even when GET is 200
      if (!head || !head.ok) {
        const get = await doFetch('GET');
        return get;
      }
      return head;
    }

    const headerInfo = await fetchHeaders(pageUrl);
    const xRobots = headerInfo?.headers?.['x-robots-tag'] || null;
    const contentType = headerInfo?.headers?.['content-type'] || null;

    // 3) robots.txt → collect sitemap URLs
    async function fetchText(url) {
      try {
        const res = await fetch(url, { redirect: 'follow', cache: 'no-store' });
        const txt = await res.text();
        return { status: res.status, url: res.url, text: txt };
      } catch (e) {
        return { error: String(e) };
      }
    }

    const robotsTxt = await fetchText(robotsUrl);
    let sitemapCandidates = [];
    let robotsFound = false;
    if (robotsTxt && robotsTxt.text) {
      robotsFound = true;
      const lines = robotsTxt.text.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^\s*Sitemap:\s*(.+)$/i);
        if (m && m[1]) {
          const loc = m[1].trim();
          try {
            const abs = new URL(loc, origin).toString();
            sitemapCandidates.push(abs);
          } catch {}
        }
      }
    }
    // Fallback default sitemap
    const defaultSitemap = `${origin}/sitemap.xml`;
    if (!sitemapCandidates.includes(defaultSitemap)) sitemapCandidates.push(defaultSitemap);

    // 4) Search sitemaps for the page URL (basic depth up to 5 files)
    function normalize(u) {
      try {
        const x = new URL(u);
        // Drop trailing slash for compare
        const noSlash = x.href.endsWith('/') ? x.href.slice(0, -1) : x.href;
        return noSlash;
      } catch {
        return u;
      }
    }
    const targetA = normalize(pageUrl);
    const targetB = targetA.endsWith('/') ? targetA.slice(0, -1) : `${targetA}/`; // both variants

    let sitemapFoundIn = null;
    const checked = [];
    for (const sm of sitemapCandidates.slice(0, 5)) {
      const smResp = await fetchText(sm);
      checked.push({ url: sm, status: smResp?.status || null });
      const body = smResp?.text || '';
      if (!body) continue;
      if (body.includes(targetA) || body.includes(targetB)) {
        sitemapFoundIn = sm;
        break;
      }
      // If sitemapindex, try to pull first few child sitemaps
      if (/\<sitemapindex[\s\S]*\<\/sitemapindex\>/i.test(body)) {
        const locs = Array.from(body.matchAll(/<loc>([^<]+)<\/loc>/gi)).map((m) => m[1]).slice(0, 5);
        for (const child of locs) {
          let childUrl = child;
          try { childUrl = new URL(child, origin).toString(); } catch {}
          const childResp = await fetchText(childUrl);
          checked.push({ url: childUrl, status: childResp?.status || null });
          const childBody = childResp?.text || '';
          if (childBody.includes(targetA) || childBody.includes(targetB)) {
            sitemapFoundIn = childUrl;
            break;
          }
        }
        if (sitemapFoundIn) break;
      }
    }

    // 5) Determine blocking signals
    const reasons = [];
    const robotsMetaStr = (meta && meta.robots) ? String(meta.robots).toLowerCase() : '';
    const xRobotsStr = xRobots ? String(xRobots).toLowerCase() : '';
    if (robotsMetaStr.includes('noindex') || robotsMetaStr.includes('none')) {
      reasons.push('robots meta contains noindex/none');
    }
    if (xRobotsStr.includes('noindex') || xRobotsStr.includes('none')) {
      reasons.push('X-Robots-Tag header contains noindex/none');
    }

    const verdict = {
      isProbablyIndexable: reasons.length === 0,
      reasons,
    };

    const payload = {
      url: pageUrl,
      meta: {
        title: meta?.title || null,
        robots: meta?.robots || null,
        canonical: meta?.canonical || null,
        metaDescription: meta?.metaDescription || null,
      },
      headers: {
        status: headerInfo?.status || null,
        finalUrl: headerInfo?.url || null,
        contentType: contentType,
        xRobotsTag: xRobots,
        methodUsed: headerInfo?.method || null,
      },
      robotsTxt: {
        url: robotsUrl,
        fetched: robotsFound,
        sitemapCandidates,
      },
      sitemap: {
        checked,
        included: !!sitemapFoundIn,
        matchedSitemap: sitemapFoundIn,
      },
      verdict,
      timestamp: Date.now(),
    };

    const response = { type: "CRAWLABILITY_AUDIT_RESPONSE", requestId, payload };
    if (sendWebSocketMessage(response)) {
      logInfo(`Successfully sent crawlability response for request: ${requestId}`);
    } else {
      logError("Cannot send crawlability response - WebSocket not connected");
    }
  } catch (e) {
    logError('Crawlability audit failed:', e);
    const response = {
      type: "CRAWLABILITY_AUDIT_RESPONSE",
      requestId,
      payload: { error: `Crawlability audit failed: ${e?.message || e}`, timestamp: Date.now() },
    };
    if (!sendWebSocketMessage(response)) {
      logError("Cannot send crawlability error response - WebSocket not connected");
    }
  }
}

// Placeholder handlers for other functions (to be modularized later)
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
    
    if (!sendWebSocketMessage(errorResponse)) {
      logError("Cannot send error response - WebSocket not connected");
    }
    return;
  }

  try {
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
    
    if (sendWebSocketMessage(response)) {
      logInfo(`Successfully sent GTM container IDs response for request: ${requestId}`);
    } else {
      logError("Cannot send response - WebSocket not connected");
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
    
    if (!sendWebSocketMessage(errorResponse)) {
      logError("Cannot send error response - WebSocket not connected");
    }
  }
}

// Stub handlers for GA4, Meta Pixel, and GTM Preview (to be modularized)
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
    
    sendWebSocketMessage(errorResponse);
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
  
  if (sendWebSocketMessage(response)) {
    logInfo(`Successfully sent GA4 hits response for request: ${requestId}`);
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
    
    sendWebSocketMessage(errorResponse);
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
  
  if (sendWebSocketMessage(response)) {
    logInfo(`Successfully sent Meta Pixel hits response for request: ${requestId}`);
  }
}

async function handleGetNewGtmPreviewEventsRequest(requestId) {
  logInfo(`Handling new GTM preview events request: ${requestId}`);
  logInfo('Preview debug: starting lookup for Tag Assistant tab');
  
  try {
    // Search for any open Tag Assistant tab
    const tagAssistantTabs = await chrome.tabs.query({
      url: "https://tagassistant.google.com/*"
    });
    
    if (tagAssistantTabs.length === 0) {
      logWarn('No Tag Assistant tabs found via chrome.tabs.query');
      const errorResponse = {
        type: "NEW_GTM_PREVIEW_EVENTS_RESPONSE",
        requestId,
        payload: { 
          error: "No Tag Assistant tab found. Please open https://tagassistant.google.com in a browser tab.",
          timestamp: Date.now()
        },
      };
      
      const ws = getWebSocket();
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
    logInfo(`Tag Assistant URL: ${tagAssistantTab.url}`);

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

    // Early host-permission/site-access check to surface clearer logging
    let hasAccess = false;
    try {
      hasAccess = await chrome.permissions.contains({ origins: ["https://tagassistant.google.com/*"] });
      logInfo(`Host permission for tagassistant.google.com granted: ${hasAccess}`);
    } catch (permErr) {
      logWarn("Permission check failed:", permErr?.message || String(permErr));
    }

    if (!hasAccess) {
      logError("Site access withheld for Tag Assistant; cannot inject scripts.");
      const helpful = {
        error: "Cannot access Tag Assistant page due to withheld site access.",
        details: "Open chrome://extensions → MCP DataLayer Access → Site access, choose 'On all sites' or add https://tagassistant.google.com. Then reload Tag Assistant and try again.",
        url: tagAssistantTab.url,
        timestamp: Date.now()
      };
      const errorResponse = { type: "NEW_GTM_PREVIEW_EVENTS_RESPONSE", requestId, payload: helpful };
      const ws = getWebSocket();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(errorResponse));
      } else {
        logError("Cannot send error response - WebSocket not connected");
      }
      return;
    }

    // Execute new events extraction on the Tag Assistant tab with the last event number
    let results;
    try {
      results = await chrome.scripting.executeScript({
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
    } catch (injectErr) {
      const msg = String(injectErr && injectErr.message ? injectErr.message : injectErr);
      if (msg && msg.includes('Cannot access contents of the page')) {
        logError("Injection failed due to withheld site access:", msg);
        const helpful = {
          error: "Cannot access Tag Assistant page due to withheld site access.",
          details: "Open chrome://extensions, find 'MCP DataLayer Access' > Site access, then choose 'On all sites' or 'On specific sites' and add https://tagassistant.google.com. Reload the Tag Assistant tab and try again.",
          url: tagAssistantTab.url,
          timestamp: Date.now(),
        };
        const errorResponse = { type: "NEW_GTM_PREVIEW_EVENTS_RESPONSE", requestId, payload: helpful };
        const ws = getWebSocket();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(errorResponse));
        } else {
          logError("Cannot send error response - WebSocket not connected");
        }
        return;
      }
      throw injectErr;
    }

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
      
      const ws = getWebSocket();
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

    const ws = getWebSocket();
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
    
    const ws = getWebSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(errorResponse));
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
        connectWebSocket(handleWebSocketMessage);
        
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
        return true;
      }
      
      case "FORCE_RECONNECT": {
        logInfo("Force reconnect requested");
        forceReconnect(handleWebSocketMessage);
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
logInfo("Service worker starting up (modular version)");

// Check if we have an attached tab and attempt connection
chrome.storage.local.get([STORAGE_KEYS.TAB_ID]).then((data) => {
  if (data[STORAGE_KEYS.TAB_ID]) {
    logInfo("Found attached tab on startup, attempting connection");
    connectWebSocket(handleWebSocketMessage);
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
  }
});

// Monitor page navigation to clear hits
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    ga4HitsPerTab.set(tabId, []); // Clear hits for new page
    metaPixelHitsPerTab.set(tabId, []); // Clear Meta Pixel hits for new page
    logInfo(`Cleared GA4 and Meta Pixel hits for tab ${tabId} - new page: ${changeInfo.url}`);
  }
});

// ---- Network Request Monitoring ----

// Monitor GA4 requests
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
        pageUrl: details.documentUrl
      };
      
      addMetaPixelHitToTab(details.tabId, hit);
      logInfo(`Server-side Meta Pixel hit detected: ${hit.eventName} on ${details.url}`);
    }
  } catch (error) {
    logError("Error handling potential server-side tracking:", error);
  }
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
    const params = Object.fromEntries(url.searchParams.entries());
    
    return {
      timestamp: Date.now(),
      tabId: details.tabId,
      pageUrl: details.documentUrl,
      method: 'GET',
      eventName: params.ev || params.event || 'PageView',
      pixelId: params.id || 'unknown',
      parameters: params,
      customData: extractMetaPixelCustomData(params),
      domain: url.hostname
    };
  } catch (error) {
    logError("Error parsing Meta Pixel URL hit:", error);
    return null;
  }
}

function addMetaPixelHitToTab(tabId, hit) {
  if (!metaPixelHitsPerTab.has(tabId)) {
    metaPixelHitsPerTab.set(tabId, []);
  }
  
  const hits = metaPixelHitsPerTab.get(tabId);
  hits.push(hit);
  
  // Keep only last MAX_META_PIXEL_HITS_PER_PAGE hits
  if (hits.length > MAX_META_PIXEL_HITS_PER_PAGE) {
    hits.splice(0, hits.length - MAX_META_PIXEL_HITS_PER_PAGE);
  }
  
  logInfo(`Added Meta Pixel hit to tab ${tabId}: ${hit.eventName}`);
}

// Detection functions
function detectGA4InUrl(url) {
  try {
    const urlObj = new URL(url);
    const params = Object.fromEntries(urlObj.searchParams.entries());
    
    // Check for GA4 measurement ID pattern
    if (params.tid && params.tid.startsWith('G-')) {
      return params;
    }
    
    // Check for GA4 event parameters
    if (params.en || params.ep || params.ea) {
      return params;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

function detectGA4InRequestBody(requestBody) {
  try {
    if (!requestBody || !requestBody.formData) {
      return null;
    }
    
    const formData = requestBody.formData;
    
    // Check for GA4 measurement ID
    if (formData.tid && formData.tid[0] && formData.tid[0].startsWith('G-')) {
      const params = {};
      for (const [key, value] of Object.entries(formData)) {
        params[key] = value[0];
      }
      return params;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

function detectMetaPixelInUrl(url) {
  try {
    const urlObj = new URL(url);
    const params = Object.fromEntries(urlObj.searchParams.entries());
    
    // Check for Meta Pixel ID pattern
    if (params.id && /^\d+$/.test(params.id)) {
      return params;
    }
    
    // Check for Meta Pixel event parameters
    if (params.ev || params.event || params.pixel_id) {
      return params;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

function detectMetaPixelInRequestBody(requestBody) {
  try {
    if (!requestBody || !requestBody.formData) {
      return null;
    }
    
    const formData = requestBody.formData;
    
    // Check for Meta Pixel ID
    if (formData.id && formData.id[0] && /^\d+$/.test(formData.id[0])) {
      const params = {};
      for (const [key, value] of Object.entries(formData)) {
        params[key] = value[0];
      }
      return params;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

function extractMetaPixelCustomData(params) {
  const customData = {};
  
  // Extract custom data parameters
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('cd[') || key.startsWith('ud[') || key.startsWith('cs[')) {
      customData[key] = value;
    }
  }
  
  return Object.keys(customData).length > 0 ? customData : null;
}

// Clean up on service worker shutdown
self.addEventListener("beforeunload", () => {
  logInfo("Service worker shutting down");
  cleanup();
});
