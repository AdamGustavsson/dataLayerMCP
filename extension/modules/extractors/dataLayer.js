// dataLayer.js - DataLayer extraction logic

// Enhanced dataLayer extraction with better error handling
export function extractDataLayer() {
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

