// schema.js - Schema markup extraction logic

// Enhanced schema markup extraction (JSON-LD and microdata)
export function extractSchemaMarkup() {
  try {
    const start = performance.now();
    
    console.log("🚀 Schema markup extraction started");
    console.log("📍 Current URL:", window.location.href);
    
    const schemaData = {
      jsonLd: [],
      microdata: [],
      // Structured, nested representation of microdata items
      microdataStructured: [],
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
    
    // Extract microdata (flat + nested structured)
    const allItemscopeEls = document.querySelectorAll('[itemscope]');
    console.log(`🔍 Found ${allItemscopeEls.length} microdata elements`);

    // Helper: get readable @type from itemtype URL
    function getMicrodataType(el) {
      const itemtype = el.getAttribute('itemtype') || '';
      if (!itemtype) return null;
      const firstType = itemtype.split(/\s+/)[0];
      try {
        const url = new URL(firstType, window.location.href);
        const parts = url.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || firstType;
      } catch {
        const parts = firstType.split('/').filter(Boolean);
        return parts[parts.length - 1] || firstType;
      }
    }

    // Helper: read a value from an element with itemprop (non-itemscope)
    function readPropValue(el) {
      if (el.hasAttribute('content')) return el.getAttribute('content');
      if (el.hasAttribute('datetime')) return el.getAttribute('datetime');
      if (el.hasAttribute('href')) return el.getAttribute('href');
      if (el.hasAttribute('src')) return el.getAttribute('src');
      if (el.hasAttribute('value')) return el.getAttribute('value');
      const txt = el.textContent || '';
      const trimmed = txt.trim();
      return trimmed || null;
    }

    // Helper: determine if el's nearest itemscope ancestor is exactly root
    function belongsToScope(el, root) {
      let cur = el.parentElement;
      while (cur && cur !== root) {
        if (cur.hasAttribute && cur.hasAttribute('itemscope')) return false;
        cur = cur.parentElement;
      }
      return cur === root;
    }

    function addProp(target, key, value) {
      if (key in target) {
        const existing = target[key];
        if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          target[key] = [existing, value];
        }
      } else {
        target[key] = value;
      }
    }

    // Recursive parse of an itemscope element into nested object
    function parseItemScope(el) {
      const obj = {};
      const t = getMicrodataType(el);
      if (t) obj['@type'] = t;

      // Collect direct properties of this scope
      const props = el.querySelectorAll('[itemprop]');
      props.forEach((propEl) => {
        if (!belongsToScope(propEl, el)) return;
        const name = propEl.getAttribute('itemprop');
        if (!name) return;
        if (propEl.hasAttribute('itemscope')) {
          // Nested object
          const nested = parseItemScope(propEl);
          addProp(obj, name, nested);
        } else {
          const val = readPropValue(propEl);
          if (val !== null && val !== undefined) addProp(obj, name, val);
        }
      });
      return obj;
    }

    // Build flat microdata (existing) and structured microdata (new)
    allItemscopeEls.forEach((element, index) => {
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
            textContent:
              element.textContent?.substring(0, 200) +
              (element.textContent?.length > 200 ? '...' : '') || null,
          },
        };

        // Flat property collection (legacy)
        const propertyElements = element.querySelectorAll('[itemprop]');
        propertyElements.forEach((propEl) => {
          const propName = propEl.getAttribute('itemprop');
          let propValue = null;
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
          if (!propName) return;
          if (microdataItem.properties[propName]) {
            if (Array.isArray(microdataItem.properties[propName])) {
              microdataItem.properties[propName].push(propValue);
            } else {
              microdataItem.properties[propName] = [
                microdataItem.properties[propName],
                propValue,
              ];
            }
          } else {
            microdataItem.properties[propName] = propValue;
          }
        });

        schemaData.microdata.push(microdataItem);

        // Structured nested form: only include top-level items (itemscope not acting as an itemprop)
        if (!element.hasAttribute('itemprop')) {
          const structured = parseItemScope(element);
          structured._meta = {
            tagName: element.tagName.toLowerCase(),
            itemtype: element.getAttribute('itemtype') || null,
            itemid: element.getAttribute('itemid') || null,
            index,
          };
          schemaData.microdataStructured.push(structured);
        }

        console.log(
          `✅ Extracted microdata ${index}: ${microdataItem.itemType || 'no type'}`
        );
      } catch (microdataError) {
        console.warn(
          `⚠️ Error processing microdata element ${index}:`,
          microdataError
        );
        schemaData.microdata.push({
          index: index,
          error: microdataError.message,
          tagName: element.tagName.toLowerCase(),
          itemType: element.getAttribute('itemtype') || null,
        });
      }
    });
    
    const end = performance.now();
    
    // Add processing metadata
    schemaData.processingTime = Math.round(end - start);
    schemaData.summary = {
      jsonLdCount: schemaData.jsonLd.length,
      microdataCount: schemaData.microdata.length,
      structuredTopLevelCount: schemaData.microdataStructured.length,
      jsonLdTypes: schemaData.jsonLd
        .map((item) => item.type)
        .filter((type) => type !== 'parse_error'),
      microdataTypes: schemaData.microdata
        .map((item) => item.itemType)
        .filter(Boolean),
      topLevelTypes: schemaData.microdataStructured
        .map((it) => it['@type'])
        .filter(Boolean),
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
