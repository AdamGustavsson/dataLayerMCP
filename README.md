# dataLayer MCP – MVP

This repository contains an MVP implementation that lets a Large Language Model (LLM) retrieve `window.dataLayer` and monitor GA4 hits from a user-selected browser tab using the Model Context Protocol (MCP).

Components
-----------

1. **MCP Server (Node + TypeScript)** – local process exposing seven MCP tools:
   - `getDataLayer()` – captures the current contents of `window.dataLayer`
   - `getGa4Hits()` – returns all GA4 tracking events recorded from the current page (includes both direct Google Analytics requests and server-side tracking)
   - `getMetaPixelHits()` – returns all Meta Pixel (Facebook Pixel) tracking events recorded from the current page (includes both direct Facebook requests and server-side tracking)
   - `getNewGTMPreviewEvents()` – returns NEW GTM preview events from Google Tag Assistant (events with numbers greater than the last call)
   - `getSchemaMarkup()` – extracts and returns all schema markup (JSON-LD and microdata) found on the current page
   - `getMetaTags()` – extracts and returns all meta tags including title, description, Open Graph, Twitter Card, and other SEO metadata
   - `checkCrawlability()` – audits crawlability of the attached page (robots meta, X‑Robots‑Tag headers, robots.txt sitemaps, and sitemap inclusion)
   
   Communicates with the Chrome extension via WebSocket (`ws://localhost:57321`).
   
   Multi-instance safety: Only the most recently started server instance is allowed to
   send or receive messages. The server writes an active-instance lock in the OS temp
   directory and tags all WebSocket messages with a unique `serverInstanceId`. Older
   instances detect loss of leadership and drop outbound messages with a clear error.

2. **Chrome Extension (Manifest V3)** – lets the user attach/detach a tab and provides:
   - Access to the tab's `window.dataLayer` 
   - Automatic monitoring and recording of GA4 network requests
   - Automatic monitoring and recording of Meta Pixel network requests
   - GTM preview data scraping from Google Tag Assistant (when attached tab is on tagassistant.google.com)
   - Schema markup extraction (JSON-LD and microdata) from any webpage
   - Meta tags extraction (title, description, Open Graph, Twitter Card, canonical, etc.)

Quick start
-----------

```bash
# 1. Install dependencies (creates a stub SDK module until real one is published)
npm install

# 2. Start the MCP server (auto-restarts on file changes)
npm run dev
```


Chrome extension – load unpacked
--------------------------------

1. Open Chrome → `chrome://extensions/` → enable **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder.
3. Pin the *MCP DataLayer Access* icon to the toolbar for easy access.

Manual end-to-end test
----------------------

1. **Attach a tab**  
   • Navigate to any site that defines `window.dataLayer` and/or uses Google Analytics 4 (e.g. a page with GTM or GA4 tracking).  
   • Click the extension icon → **Attach**. The popup should now show "Attached to: <page title>".

2. **Test dataLayer access**  
   In a separate terminal session:
   ```bash
   echo '{ "tool": "getDataLayer", "args": {} }' | npm run start
   ```
   The server should output the dataLayer JSON or an error.

3. **Test GA4 hits monitoring**  
   • Perform some actions on the attached page (clicks, navigation, etc.) to trigger GA4 events.
   • Run the GA4 hits tool:
   ```bash
   echo '{ "tool": "getGa4Hits", "args": {} }' | npm run start  
   ```
   The server should output an array of recorded GA4 hits with event names, parameters, and timestamps. This includes both direct Google Analytics requests and server-side tracking endpoints that contain GA4 data.

4. **Test Meta Pixel hits monitoring**
   • Perform some actions on the attached page (clicks, purchases, etc.) to trigger Meta Pixel events.
   • Run the Meta Pixel hits tool:
   ```bash
   echo '{ "tool": "getMetaPixelHits", "args": {} }' | npm run start
   ```
   The server should output an array of recorded Meta Pixel hits with event names, pixel IDs, custom data, and timestamps. This includes both direct Facebook Pixel requests and server-side Conversions API tracking.

5. **Test GTM preview data scraping**
   • Navigate to https://tagassistant.google.com and enter GTM preview mode for your website
   • Attach the extension to your website tab (not the Tag Assistant tab - the tool automatically finds Tag Assistant)
   • Perform actions on your website to generate GTM events that appear in Tag Assistant
   • Run the GTM preview tool:
   ```bash
   echo '{ "tool": "getNewGTMPreviewEvents", "args": {} }' | npm run start
   ```
   The tool returns only NEW events since the last call (tracks event numbers internally). First call returns all events, subsequent calls return only newer events. No caching - session-based tracking only.

6. **Test schema markup extraction**
   • Navigate to any page with structured data (JSON-LD or microdata schema markup), or use the included test file: `file:///path/to/dataLayerMCP/test-schema.html`
   • Attach the extension to the tab with schema markup
   • Run the schema markup tool:
   ```bash
   echo '{ "tool": "getSchemaMarkup", "args": {} }' | npm run start
   ```
   The server should output all JSON-LD scripts and microdata elements found on the page, with parsed structured data for SEO and rich snippets analysis.

7. **Test meta tags extraction**
   • Navigate to any webpage (most pages have meta tags)
   • Attach the extension to the tab
   • Run the meta tags tool:
   ```bash
   echo '{ "tool": "getMetaTags", "args": {} }' | npm run start
   ```
   The server should output comprehensive meta tag information including title, description, Open Graph tags, Twitter Card data, canonical URLs, hreflang links, and favicon information.

8. **Observe logs**  
   • Server console will show request / response and WebSocket connection messages.  
   • Extension's background service-worker logs can be viewed in `chrome://extensions/` → *Service Worker* → **Inspect**.

Development scripts
-------------------

* `npm run dev`   – starts server with hot-reload (uses `tsx watch`).
* `npm run build` – Type-check & transpile server to `dist/`.
* `npm run lint`  – ESLint + Prettier formatting checks.

Project layout
--------------

```
server/          TypeScript MCP server source
extension/       Chrome extension (MV3)
stubs/           Local stub for @modelcontextprotocol/sdk until real SDK is available
dist/            Compiled JS output (ignored until you run build)
```

IDE integration (Cursor & GitHub Copilot)
----------------------------------------

Both Cursor and GitHub Copilot Chat can use **MCP servers** that run locally.  Follow the steps below to expose the `getDataLayer` tool inside your IDE.

Prerequisites
• Node 18 + installed
• Dependencies installed (`npm install`)
• Chrome extension loaded & a tab *attached* (see section above)

### 1  Compile the server (one-off)

```bash
npm run build   # outputs dist/server/src/index.js
```

You can keep using `npm run dev` during development, but the compiled file makes the JSON config a bit simpler.

### 2  Add an MCP config in your IDE

Pick the guide that matches your editor.

#### a) Cursor (Global Configuration)

Open Cursor Settings → **MCP Servers** (or manually edit the global MCP config file), and add:

```json
{
  "mcpServers": {
    "dataLayerMCP": {
      "command": "node",
      "args": ["/absolute/path/to/your/dataLayerMCP/dist/server/src/index.js"]
    }
  }
}
```

**Important**: Replace `/absolute/path/to/your/dataLayerMCP/` with the actual full path to where you cloned this repository.

For example:
- **macOS/Linux**: `"/Users/yourname/Documents/code/dataLayerMCP/dist/server/src/index.js"`
- **Windows**: `"C:\\Users\\yourname\\Documents\\code\\dataLayerMCP\\dist\\server\\src\\index.js"`

Save the configuration, then **restart Cursor**. The server will be globally available across all projects, and tools named `mcp_dataLayerMCP_getDataLayer`, `mcp_dataLayerMCP_getGa4Hits`, `mcp_dataLayerMCP_getMetaPixelHits`, `mcp_dataLayerMCP_getNewGTMPreviewEvents`, `mcp_dataLayerMCP_getSchemaMarkup`, and `mcp_dataLayerMCP_getMetaTags` will appear in the tool list for any chat session.

#### b) VS Code + GitHub Copilot Chat (`.vscode/mcp.json`)

Create `.vscode/mcp.json`:

```json
{
  "servers": {
    "dataLayerMCP": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/server/src/index.js"]
    }
  }
}
```

VS Code will show a **Start** code-lens at the top of the JSON — click it to launch the server and discover the tools.  Switch Copilot Chat to *Agent* mode ➜ click the **tools** icon to verify `dataLayerMCP` is listed.

> 🔍  JetBrains, Eclipse, or Xcode users can use the same JSON under `mcp.json` in the IDE-specific settings pane — just copy the `servers` block above.

### 3  Use the tools

1. Open any project in Cursor (the global MCP server will be available across all projects).
2. In the chat panel, ask questions like:
   - **DataLayer**: "What is the dataLayer contents?" or "Run the getDataLayer tool"
   - **GA4 Hits**: "Show me the GA4 hits" or "What GA4 events have been recorded?"
   - **Meta Pixel Hits**: "Show me the Meta Pixel hits" or "What Facebook Pixel events have been fired?"
   - **GTM Preview**: "Get new GTM events" or "What new events have occurred in Tag Assistant?"
   - **Schema Markup**: "Extract schema markup from this page" or "What structured data is on this page?"
   - **Meta Tags**: "What are the meta tags on this page?" or "Show me the SEO metadata"
3. Make sure the Chrome extension is attached to the tab you want to inspect — the JSON response will appear in Chat.

All tools connect to your browser via the extension and fetch data from your attached (active) tab.

**Available Tools:**
- `getDataLayer` - Captures current `window.dataLayer` contents from **attached tab**
- `getGa4Hits` - Returns array of GA4 tracking events from **attached tab** (resets on page navigation)
- `getMetaPixelHits` - Returns array of Meta Pixel tracking events from **attached tab** (resets on page navigation)  
- `getNewGTMPreviewEvents` - Returns NEW events from any open **Tag Assistant tab** (tracks last event number, no caching)
- `getSchemaMarkup` - Extracts all JSON-LD and microdata schema markup from **attached tab** for SEO analysis
- `getMetaTags` - Extracts all meta tags including title, description, Open Graph, Twitter Card, and SEO metadata from **attached tab**
- `checkCrawlability` - Audits crawlability of the **attached tab**: reports robots meta, X‑Robots‑Tag headers, robots.txt sitemap URLs, and whether the page appears in a discovered sitemap; includes a simple indexability verdict and reasons

**Pro tip**: Combine with BrowserMCP to have the agent control the page by clicking around and check the dataLayer changes, GA4 events, Meta Pixel events, GTM preview data, schema markup, and meta tags being updated!

That's it — you now have global, one-click, LLM-accessible access to any page's `window.dataLayer`, GA4 tracking events, Meta Pixel tracking events, GTM preview data, schema markup, and complete SEO metadata from any Cursor project!

This MCP server includes a Chrome extension that communicates with the server, extracts `window.dataLayer` from the browser, monitors GA4 and Meta Pixel network requests, scrapes GTM preview data from Tag Assistant, extracts schema markup (JSON-LD and microdata), extracts comprehensive meta tag information, and forwards all data to the MCP server for AI access. The extension communicates with the server via WebSocket (`ws://localhost:57321`).
