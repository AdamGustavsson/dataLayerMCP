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

## GA4 Hits Recording Tool
### Phase 1: Server-Side Implementation
- [x] Add GA4 hits tool registration to MCP server (`server/src/index.ts`)
- [x] Add GA4 message type constants (`REQUEST_GA4_HITS`, `GA4_HITS_RESPONSE`)
- [x] Implement GA4 hits request logic (copy/modify from getDataLayer)
- [x] Add GA4 response handler in WebSocket message handler

### Phase 2: Chrome Extension Backend
- [x] Add GA4 storage structure (ga4HitsPerTab Map) to service worker
- [x] Add page navigation listener to clear hits on page changes
- [x] Add GA4 request handler case in message switch statement
- [x] Implement handleGetGa4HitsRequest function

### Phase 3: Network Request Monitoring
- [x] Add webRequest listeners for GA4 endpoints (POST and GET)
- [x] Implement handleGa4Request and handleGa4GetRequest functions
- [x] Implement GA4 payload parsing functions
- [x] Add server-side GA4 detection for custom endpoints
- [x] Implement content-based GA4 detection (GET and POST)

### Phase 4: Manifest Permissions
- [x] Add webRequest permission to manifest.json
- [x] Add GA4 host permissions (simplified with wildcards)

### Phase 5: Testing and Documentation
- [x] Update README.md with GA4 hits tool documentation
- [x] Test GA4 hits recording with real GA4 implementation
- [x] Verify server-side tracking detection works
- [x] Optimize to remove POST request noise (GET only)

### Phase 6: Server-Side GA4 Enhancement
- [x] Expand detection to include regional GA4 endpoints
- [x] Implement content-based detection for any endpoint
- [x] Add support for Google Tag Manager Server-side (sGTM)
- [x] Test with real server-side GA4 tracking

## Meta Pixel Tracking Tool
### Phase 1: Server-Side Implementation
- [ ] Add Meta Pixel tool registration to MCP server (`server/src/index.ts`)
- [ ] Add Meta Pixel message type constants (`REQUEST_META_PIXEL_HITS`, `META_PIXEL_HITS_RESPONSE`)
- [ ] Implement Meta Pixel hits request logic (similar to getGa4Hits)
- [ ] Add Meta Pixel response handler in WebSocket message handler

### Phase 2: Chrome Extension Backend
- [ ] Add Meta Pixel storage structure (metaPixelHitsPerTab Map) to service worker
- [ ] Add Meta Pixel request handler case in message switch statement
- [ ] Implement handleGetMetaPixelHitsRequest function
- [ ] Ensure page navigation clears Meta Pixel hits on page changes

### Phase 3: Network Request Monitoring
- [ ] Add webRequest listeners for Facebook endpoints (`facebook.com/tr`, `www.facebook.com/tr`)
- [ ] Implement handleMetaPixelRequest function for direct Facebook requests
- [ ] Extend server-side detection to identify Meta Pixel patterns in any endpoint
- [ ] Add Meta Pixel detection to existing handlePotentialServerSideGA4 function

### Phase 4: Meta Pixel Parameter Detection
- [ ] Implement detectMetaPixelInUrl function for GET request parameters
- [ ] Implement detectMetaPixelInRequestBody function for POST request payloads
- [ ] Create isMetaPixelPayload function to identify Meta Pixel indicators
- [ ] Define Meta Pixel parameter patterns (pixel ID, event names, fb_* parameters)

### Phase 5: Data Parsing and Extraction
- [ ] Implement Meta Pixel ID extraction (numeric format validation)
- [ ] Parse standard Meta Pixel events (PageView, Purchase, AddToCart, Lead, etc.)
- [ ] Extract custom data parameters (content_ids, value, currency, etc.)
- [ ] Parse user data parameters (hashed email, phone, names)
- [ ] Handle both URL-encoded and JSON payload formats

### Phase 6: Response Format Implementation
- [ ] Design Meta Pixel hit object structure with pixel-specific fields
- [ ] Add pixelId field extraction and validation
- [ ] Implement customData and userData object parsing
- [ ] Add serverSide flag to distinguish client vs server-side tracking
- [ ] Ensure consistent timestamp and tabId tracking

### Phase 7: Testing and Documentation
- [ ] Update README.md to document Meta Pixel tool alongside GA4 tool
- [ ] Test with real Meta Pixel implementations (client-side tracking)
- [ ] Test with Facebook Conversions API (server-side tracking)
- [ ] Validate e-commerce tracking event capture
- [ ] Test custom event detection and parsing

### Phase 8: Advanced Features (Optional)
- [ ] Implement Meta Pixel event classification (standard vs custom events)
- [ ] Add privacy compliance detection (hashed data, Limited Data Use)
- [ ] Implement cross-platform correlation with GA4 events
- [ ] Add Meta Pixel version detection and compatibility handling
- [ ] Create event frequency and timing analysis

### Phase 9: Integration and Polish
- [ ] Update manifest.json permissions for Facebook domains
- [ ] Add error handling for malformed Meta Pixel requests
- [ ] Implement rate limiting to prevent performance issues
- [ ] Add Meta Pixel specific logging and debugging
- [ ] Create comprehensive test suite for various Meta Pixel scenarios

## GTM Preview Data Tool
### Phase 1: Server-Side Implementation
- [x] Add GTM preview tool registration to MCP server (`server/src/index.ts`)
- [x] Add GTM preview message type constants (`REQUEST_GTM_PREVIEW`, `GTM_PREVIEW_RESPONSE`)
- [x] Implement GTM preview hits request logic (similar to getDataLayer)
- [x] Add GTM preview response handler in WebSocket message handler
- [x] **REFACTORED**: Renamed to `getNewGTMPreviewEvents` with `REQUEST_NEW_GTM_PREVIEW_EVENTS` message type
- [x] **REFACTORED**: Updated response handler to use `NEW_GTM_PREVIEW_EVENTS_RESPONSE`

### Phase 2: Chrome Extension Backend
- [x] Add Tag Assistant domain permissions to manifest.json (`tagassistant.google.com`)
- [x] Add GTM preview request handler case in message switch statement
- [x] Implement handleGetGtmPreviewRequest function
- [x] Modified to automatically find and use Tag Assistant tabs instead of requiring tab attachment
- [x] Implemented chrome.tabs.query to search for tagassistant.google.com tabs
- [x] Keep other tools (getDataLayer, etc.) working from attached tab as usual
- [x] **REFACTORED**: Renamed to `handleGetNewGtmPreviewEventsRequest` function
- [x] **REFACTORED**: Updated message types to use `REQUEST_NEW_GTM_PREVIEW_EVENTS` and `NEW_GTM_PREVIEW_EVENTS_RESPONSE`

### Phase 3: GTM Data Scraping - SIMPLIFIED APPROACH
- [x] **REMOVED**: localStorage caching system (too complex, caused duplicates)
- [x] **NEW**: Global `lastReportedEventNumber` tracking per session
- [x] **NEW**: Only return events with numbers > last reported event number
- [x] **NEW**: Session-based tracking (resets when service worker restarts)
- [x] Simplified tag extraction (basic check for "None" vs actual tag names)
- [x] Removed incremental caching and duplicate detection complexity
- [x] Add event numbering and timestamp tracking
- [x] **IMPROVED**: Much faster execution, no localStorage I/O

### Phase 4: Data Format and Response
- [x] **SIMPLIFIED**: Structure response as `{ newEvents: [], metadata: {} }`
- [x] **UPDATED**: Metadata includes `newEventsCount`, `lastEventNumber`, `totalEventsOnPage`
- [x] **REMOVED**: Cache status and complex event processing metadata
- [x] **IMPROVED**: Clear indication of only NEW events since last call

### Phase 5: Testing and Documentation
- [x] Update README.md with new tool name and behavior documentation
- [x] Update usage instructions to clarify NEW events behavior
- [x] Update Cursor tools list with correct tool name
- [x] **COMPLETED**: Document that tool tracks event numbers per session (no persistence)
- [ ] Test new GTM preview events extraction with real Tag Assistant sessions
- [ ] Verify session-based tracking works correctly across multiple calls

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