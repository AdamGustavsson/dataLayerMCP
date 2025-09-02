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

