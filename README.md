# dataLayer MCP – MVP

This repository contains an MVP implementation that lets a Large Language Model (LLM) retrieve `window.dataLayer` from a user-selected browser tab using the Model Context Protocol (MCP).

Components
-----------

1. **MCP Server (Node + TypeScript)** – local process exposing a single MCP tool `getDataLayer()`. Communicates with the Chrome extension via WebSocket (`ws://localhost:57321`).
2. **Chrome Extension (Manifest V3)** – lets the user attach/detach a tab and, on request, reads that tab's `window.dataLayer` and returns it to the server.

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
   • Navigate to any site that defines `window.dataLayer` (e.g. a page using Google Tag Manager).  
   • Click the extension icon → **Attach**. The popup should now show "Attached to: <page title>".
2. **Run a sample request**  
   In a separate terminal session:
   ```bash
   echo '{ "tool": "getDataLayer", "args": {} }' | npm run start
   ```
   (Replace with your actual MCP client flow.) The server should output the dataLayer JSON or an error.
3. **Observe logs**  
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

#### a) Cursor (`.cursor/mcp.json`)

Create (or edit) `.cursor/mcp.json` in the repo root:

```json
{
  "mcpServers": {
    {
    "dataLayerMCP": {
        "command": "node",
        "args": ["dist/server/src/index.js"]
         }
    }
}
```

Save the file, then **reload the chat panel**.  Cursor will detect the new server, start it automatically, and a tool named `mcp_dataLayerMCP_getDataLayer` will appear in the tool list.

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

VS Code will show a **Start** code-lens at the top of the JSON — click it to launch the server and discover the tool.  Switch Copilot Chat to *Agent* mode ➜ click the **tools** icon to verify `dataLayerMCP` is listed.

> 🔍  JetBrains, Eclipse, or Xcode users can use the same JSON under `mcp.json` in the IDE-specific settings pane — just copy the `servers` block above.

### 3  Use the tool

1. Open or reload the IDE chat window.
2. In Agent mode, ask something like "What is the dataLayer contents?"
3. Make sure the Chrome extension is attached to the tab you want to inspect — the JSON response will appear in Chat.
Cobine with for example BrowserMCP to the the agent also control the page by clicking around and check the datalayer for changes 

That's it — you now have one-click, LLM-accessible access to any page's `window.dataLayer` right from your editor!

This MCP server includes a Chrome extension that communicates with the server and extracts `window.dataLayer` from the browser, then forwards it to the MCP server for AI access. The extension communicates with the extension via WebSocket (`ws://localhost:57321`).

