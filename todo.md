# MVP Build TODO

Track progress by checking items as they are completed.

## Project Setup
- [x] Create project directory structure (`server/`, `extension/`, `scripts/`)
- [x] Initialize npm workspace & add root `package.json`
- [x] Configure TypeScript (`tsconfig.json`) for the server code
- [x] Add `eslint` + `prettier` configs for consistent code style

## MCP Server (Node + TypeScript)
- [x] Install dependencies: `@modelcontextprotocol/sdk`, `ws`, `uuid`, etc.
- [x] Create basic MCP server skeleton (`src/server.ts`)
- [x] Implement WebSocket server on `localhost:57321`
- [x] Validate WebSocket origin against extension ID
- [x] Define and expose `getDataLayer()` MCP tool
- [x] Implement request-response correlation with `requestId`
- [x] Handle timeouts & error responses

## Chrome Extension (Manifest V3)
### Common
- [x] Scaffold extension directory (`extension/`)
- [x] Create `manifest.json` with required permissions and metadata

### Service Worker
- [x] Implement `service_worker.js` skeleton
- [x] Manage attached tab state in `chrome.storage.local`
- [x] Establish/reconnect WebSocket client to MCP server
- [x] Keep-alive ping every 20s to prevent worker shutdown
- [x] Receive `REQUEST_DATALAYER`, inject script & reply with `DATALAYER_RESPONSE`

### Content Script Injection
- [x] Use `chrome.scripting.executeScript` to run function that clones `window.dataLayer`
- [x] Deep-clone via `JSON.parse(JSON.stringify())`
- [x] Return result or error to service worker

### Popup UI
- [x] Build `popup.html` with status display and attach/detach button
- [x] Implement `popup.js` messaging with service worker
- [x] Update UI based on attachment status

## Testing & Validation
- [ ] Manual test end-to-end flow retrieving dataLayer from a site
- [x] Add `npm` script to build & reload extension in Chrome for dev (server dev & extension manual reload)
- [x] Document testing steps in `README.md`
- [x] Replace stub SDK with real @modelcontextprotocol/sdk and update server code

## Documentation
- [x] Write detailed `README.md` with setup, build, and usage instructions

## Security & Privacy (MVP scope)
- [x] Enforce host permissions in `manifest.json`
- [x] Implement server-side origin check for WebSocket handshake