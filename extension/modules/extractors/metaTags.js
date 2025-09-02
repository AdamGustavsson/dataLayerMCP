// metaTags.js - Meta tags extraction logic

// Enhanced meta tags extraction
export function extractMetaTags() {
  try {
    const start = performance.now();
    
    console.log("🚀 Meta tags extraction started");
    console.log("📍 Current URL:", window.location.href);
    
    const metaData = {
      url: window.location.href,
      timestamp: Date.now()
    };
    
    // Extract title
    const titleElement = document.querySelector('title');
    metaData.title = titleElement ? titleElement.textContent.trim() : null;
    
    // Extract meta description
    const descriptionMeta = document.querySelector('meta[name="description"]');
    metaData.metaDescription = descriptionMeta ? descriptionMeta.getAttribute('content') : null;
    
    // Extract meta keywords (less common nowadays but still used)
    const keywordsMeta = document.querySelector('meta[name="keywords"]');
    metaData.metaKeywords = keywordsMeta ? keywordsMeta.getAttribute('content') : null;
    
    // Extract robots meta
    const robotsMeta = document.querySelector('meta[name="robots"]');
    metaData.robots = robotsMeta ? robotsMeta.getAttribute('content') : null;
    
    // Extract canonical URL
    const canonicalLink = document.querySelector('link[rel="canonical"]');
    metaData.canonical = canonicalLink ? canonicalLink.getAttribute('href') : null;
    
    // Extract hreflang links
    const hreflangLinks = document.querySelectorAll('link[rel="alternate"][hreflang]');
    metaData.hreflang = [];
    hreflangLinks.forEach(link => {
      const hreflang = link.getAttribute('hreflang');
      const href = link.getAttribute('href');
      if (hreflang && href) {
        metaData.hreflang.push({ hreflang, href });
      }
    });
    
    // Extract Open Graph tags
    metaData.openGraph = {};
    const ogTags = document.querySelectorAll('meta[property^="og:"]');
    ogTags.forEach(tag => {
      const property = tag.getAttribute('property');
      const content = tag.getAttribute('content');
      if (property && content) {
        // Remove 'og:' prefix for cleaner property names
        const cleanProperty = property.replace('og:', '');
        metaData.openGraph[cleanProperty] = content;
      }
    });
    
    // Extract Twitter Card tags
    metaData.twitterCard = {};
    const twitterTags = document.querySelectorAll('meta[name^="twitter:"]');
    twitterTags.forEach(tag => {
      const name = tag.getAttribute('name');
      const content = tag.getAttribute('content');
      if (name && content) {
        // Remove 'twitter:' prefix for cleaner property names
        const cleanName = name.replace('twitter:', '');
        metaData.twitterCard[cleanName] = content;
      }
    });
    
    // Extract other common meta tags
    metaData.other = {};
    const commonMetaTags = [
      'author', 'publisher', 'copyright', 'generator', 'application-name',
      'msapplication-TileColor', 'msapplication-TileImage', 'theme-color',
      'viewport', 'format-detection', 'apple-mobile-web-app-capable',
      'apple-mobile-web-app-status-bar-style', 'apple-mobile-web-app-title'
    ];
    
    commonMetaTags.forEach(tagName => {
      const meta = document.querySelector(`meta[name="${tagName}"]`);
      if (meta) {
        metaData.other[tagName] = meta.getAttribute('content');
      }
    });
    
    // Extract favicon and icon links
    metaData.icons = [];
    const iconLinks = document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]');
    iconLinks.forEach(link => {
      const rel = link.getAttribute('rel');
      const href = link.getAttribute('href');
      const sizes = link.getAttribute('sizes');
      const type = link.getAttribute('type');
      
      if (rel && href) {
        const iconData = { rel, href };
        if (sizes) iconData.sizes = sizes;
        if (type) iconData.type = type;
        metaData.icons.push(iconData);
      }
    });
    
    // Extract structured data references (JSON-LD script count)
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    metaData.structuredData = {
      jsonLdCount: jsonLdScripts.length
    };
    
    const end = performance.now();
    
    // Add processing metadata and summary
    metaData.processingTime = Math.round(end - start);
    metaData.summary = {
      totalTags: Object.keys(metaData.openGraph).length + 
                 Object.keys(metaData.twitterCard).length + 
                 Object.keys(metaData.other).length + 
                 (metaData.title ? 1 : 0) + 
                 (metaData.metaDescription ? 1 : 0) + 
                 (metaData.canonical ? 1 : 0) + 
                 metaData.hreflang.length + 
                 metaData.icons.length,
      hasTitle: !!metaData.title,
      hasDescription: !!metaData.metaDescription,
      hasCanonical: !!metaData.canonical,
      openGraphCount: Object.keys(metaData.openGraph).length,
      twitterCardCount: Object.keys(metaData.twitterCard).length,
      hreflangCount: metaData.hreflang.length,
      iconCount: metaData.icons.length
    };
    
    console.log(`✅ Meta tags extraction complete in ${metaData.processingTime}ms`);
    console.log(`📊 Summary: ${metaData.summary.totalTags} total tags found`);
    console.log(`📋 Title: ${metaData.title ? `"${metaData.title}" (${metaData.title.length} chars)` : 'Missing'}`);
    console.log(`📋 Description: ${metaData.metaDescription ? `"${metaData.metaDescription.substring(0, 100)}..." (${metaData.metaDescription.length} chars)` : 'Missing'}`);
    
    return metaData;
    
  } catch (error) {
    console.error("❌ Error in meta tags extraction:", error);
    return { 
      error: `Failed to extract meta tags: ${error.message}`, 
      url: window.location.href,
      timestamp: Date.now()
    };
  }
}

