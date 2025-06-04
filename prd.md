Product Requirements Document: MCP dataLayer Access System (MVP)1. Introduction1.1. PurposeThis document outlines the requirements for a Minimal Viable Product (MVP) of a Model Context Protocol (MCP) server and an accompanying Chrome browser extension. The system's primary function is to enable a Large Language Model (LLM) to retrieve the current dataLayer object from a web page loaded in a user-specified "attached" browser tab. This MVP is intended for development by a junior developer and focuses on core functionality.1.2. Goals
Develop a functional MCP server using the official TypeScript SDK that exposes a single tool: getDataLayer().
Create a Chrome Manifest V3 extension that allows users to "attach" to a specific browser tab.
Enable the MCP server, upon an LLM's request via the getDataLayer() tool, to retrieve the current window.dataLayer content from the attached tab via the Chrome extension.
Ensure clear communication pathways and error handling between the LLM, MCP server, Chrome extension components, and the target web page.
Provide a stable foundation for future enhancements.
1.3. Non-Goals (Out of Scope for MVP)
dataLayer history tracking or change monitoring. The system will only fetch the dataLayer at the moment of request.
Advanced PII (Personally Identifiable Information) scrubbing or filtering from the dataLayer. (This is a critical future consideration).
Support for attaching to multiple tabs simultaneously.
User interface for viewing dataLayer content within the extension.
User-configurable server address/port in the extension (will use hardcoded defaults for MVP).
Complex authentication mechanisms beyond basic localhost security measures.
1.4. Target Audience for this DocumentThis PRD is primarily intended for a junior developer tasked with implementing the MVP. It aims to provide sufficient detail, technical guidance, and rationale for design choices.1.5. Key Terminology
LLM (Large Language Model): An AI model capable of understanding and generating human-like text, which will act as the client to the MCP server.
MCP (Model Context Protocol): An open standard for AI models to integrate with external tools and data sources.1
MCP Server: A server application that implements the MCP, exposing tools and resources to LLMs.
dataLayer: A JavaScript object (typically an array) present on many websites, used to pass information from the website to analytics and marketing tag management systems (e.g., Google Tag Manager).3 Its content is site-specific and can be dynamic.
Chrome Extension: A browser add-on that extends Chrome's functionality. This PRD refers to a Manifest V3 extension.

Service Worker (service_worker.js): The background script for Manifest V3 extensions. It handles events and manages the extension's core logic.6
Content Script (content_script.js): A script injected into web pages to interact with their DOM and JavaScript environment.7
Popup (popup.html, popup.js): A small HTML page displayed when the user clicks the extension's action icon in the toolbar.8


Attached Tab: The specific browser tab that the user has designated via the Chrome extension, from which the dataLayer will be retrieved.
WebSocket: A communication protocol providing full-duplex communication channels over a single TCP connection, suitable for real-time data transfer.10
PII (Personally Identifiable Information): Data that can be used to identify an individual.11
2. System Architecture2.1. OverviewThe system comprises three main components:
The LLM (Client): Interacts with the MCP Server to request dataLayer information. (External to this MVP's development scope, but its interaction defines the server's API).
MCP Server (Local Application): A Node.js application using the MCP TypeScript SDK. It runs locally on the user's machine, exposes the getDataLayer() tool, and communicates with the Chrome Extension.
Chrome Extension (Browser Add-on): Manages tab attachment and retrieves dataLayer from the attached tab, then sends it to the MCP Server.
The general flow for retrieving the dataLayer is as follows 13:
The LLM, through an MCP client, calls the getDataLayer() tool on the locally running MCP Server.
The MCP Server receives the request.
The MCP Server communicates with the Chrome Extension (specifically its background service worker) to request the dataLayer from the currently "attached" tab. This communication will use WebSockets.
The Chrome Extension's service worker instructs its content script (injected into the attached tab) to read the window.dataLayer.
The content script reads the dataLayer, performs a deep clone, and sends it back to the service worker.
The service worker transmits the dataLayer content to the MCP Server via the WebSocket connection.
The MCP Server receives the dataLayer, formats it as an MCP tool response, and sends it back to the LLM.
This architecture allows the LLM to access dynamic browser context without directly interacting with the browser, using the MCP server as a secure and standardized intermediary. The choice of local communication between the server and extension (localhost WebSockets) is for MVP simplicity, balancing ease of development with the need for server-initiated requests to the extension.2.2. Component ResponsibilitiesThe following table details the responsibilities of each software component:
ComponentKey ResponsibilitiesTechnologies/APIs Used (Examples)MCP Server- Implement MCP using TypeScript SDK.15<br>- Expose a single tool: getDataLayer().<br>- Manage WebSocket connection to the Chrome Extension's background script.<br>- Request dataLayer from the extension when the getDataLayer() tool is invoked.<br>- Receive dataLayer from the extension and forward it to the LLM as a tool response.<br>- Handle errors and timeouts in communication with the extension.Node.js, TypeScript, MCP TypeScript SDK (@modelcontextprotocol/sdk), ws (WebSocket library) 17Chrome Extension: Service Worker (service_worker.js)- Manage the "attached" tab's ID and title (store in chrome.storage.local).19<br>- Handle messages from the popup script for attaching/detaching tabs and status updates.21<br>- Establish and maintain a WebSocket client connection to the MCP Server.22<br>- Implement keep-alive for WebSocket connection in MV3.22<br>- On REQUEST_DATALAYER message from MCP Server: <br>  - Verify a tab is attached.<br>  - Inject and communicate with the content script in the attached tab using chrome.scripting.executeScript and chrome.runtime.sendMessage.7<br>- Receive dataLayer from content script.<br>- Send dataLayer (or error) to MCP Server via WebSocket.<br>- Handle errors from content script or WebSocket communication.JavaScript, Chrome Extension APIs (chrome.runtime, chrome.tabs, chrome.storage, chrome.scripting), WebSocket APIChrome Extension: Content Script (content_script.js)- Injected into the "attached" tab on demand by the service worker.<br>- Access window.dataLayer from the web page's context.7<br>- Perform a deep clone of the dataLayer object to avoid issues with mutability or complex objects.27<br>- Send the cloned dataLayer (or an error if dataLayer is not found/invalid) back to the service worker using chrome.runtime.sendMessage.7JavaScript, DOM APIs, window.dataLayerChrome Extension: Popup (popup.html, popup.js)- Provide UI for users to attach/detach the extension to the currently active tab.<br>- Display the current attachment status (e.g., "Attached to:" or "Not Attached").8<br>- Communicate user actions (attach/detach) to the service worker using chrome.runtime.sendMessage.HTML, CSS, JavaScript, Chrome Extension APIs (chrome.runtime, chrome.tabs)
This clear separation of concerns is vital. The MCP server handles LLM interaction and high-level orchestration. The extension's service worker manages state (like the attached tab) and external communication. The content script is a focused tool for DOM interaction. The popup provides the user interface. This modularity simplifies development, testing, and future maintenance, which is particularly beneficial for a junior developer.3. MCP Server Requirements3.1. Technology Stack
Language: TypeScript
Runtime: Node.js
MCP SDK: @modelcontextprotocol/sdk (official TypeScript SDK) 15
WebSocket Server Library: ws npm package 17
3.2. MCP Server Setup
Initialize an McpServer instance from the @modelcontextprotocol/sdk/server/mcp.js module.15

Provide a name (e.g., "DataLayerAccessServer") and version (e.g., "0.1.0").


The server should listen for MCP client connections. For MVP, a StdioServerTransport can be considered for simplicity if the LLM client runs locally and supports it, or a basic HTTP transport if that's simpler for the LLM client integration. The primary focus is the tool logic and WebSocket communication with the extension. The MCP specification mentions Streamable HTTP as a standard transport.15
The server will also host a WebSocket server on a distinct port (e.g., localhost:3001) to communicate with the Chrome extension. This is separate from the main MCP transport. This distinction is important because the MCP server's primary interface for the LLM might be HTTP, while its internal communication channel with the extension needs the bidirectional capabilities of WebSockets for the server to initiate requests to the extension.10
3.3. Tool Definition: getDataLayer()
The server MUST expose a single MCP tool named getDataLayer.
Input Parameters: The tool will take no input parameters from the LLM for this MVP.

server.tool("getDataLayer", {}, async () => { /*... logic... */ }); 15


Output:

On success: A JSON object representing the dataLayer array from the attached tab.

Example: {"result":}


On failure (e.g., no tab attached, error retrieving dataLayer, timeout): A JSON object indicating the error.

Example: {"error": {"message": "No browser tab is currently attached."}} or {"error": {"message": "Failed to retrieve dataLayer from the attached tab."}}
The MCP specification mentions error reporting as an additional utility 2, and REST API best practices suggest standard error codes/messages 31, which can be adapted for tool responses.




3.4. Logic for getDataLayer() Tool
When the getDataLayer() tool is invoked by an LLM:
Check if there is an active WebSocket connection to the Chrome extension's service worker.

If no connection, return an error to the LLM (e.g., "Extension not connected").


Generate a unique requestId (e.g., UUID).
Send a REQUEST_DATALAYER message over the WebSocket to the connected extension service worker, including the requestId.

Message format: { "type": "REQUEST_DATALAYER", "requestId": "<uuid>" }


Start a timeout (e.g., 10 seconds) to wait for a response from the extension.
Await a DATALAYER_RESPONSE message from the extension with the matching requestId.

Message format: { "type": "DATALAYER_RESPONSE", "requestId": "<uuid>", "payload": <dataLayerObjectOrError> }


If a response is received within the timeout:

If the payload contains the dataLayer, return it as the successful result to the LLM.
If the payload contains an error, return that error to the LLM.


If the timeout occurs, return a timeout error to the LLM.
The use of a requestId is crucial for correlating requests and responses, especially if the system were to handle concurrent requests in the future, though for MVP, single request handling is sufficient.3.5. WebSocket Server for Extension Communication
The MCP server application will also run a WebSocket server (e.g., using the ws library on localhost:3001).
Connection Handling:

When a new WebSocket connection is established by the Chrome extension:

The server should verify the Origin header of the incoming WebSocket handshake request. It should match chrome-extension://<YOUR_EXTENSION_ID>. If it doesn't match, the connection should be terminated.32 This is a basic security measure to ensure it's communicating with the intended extension.
Store a reference to the active WebSocket connection (for MVP, assume only one extension connects).


Handle message events from the extension (e.g., KEEPALIVE_PONG, DATALAYER_RESPONSE).
Handle close and error events for the WebSocket connection. If the connection drops, the getDataLayer() tool should report an error if invoked.


The decision to use WebSockets for server-to-extension communication is driven by the need for the server to initiate the dataLayer request. HTTP would require the extension to poll the server, which is less efficient and adds latency.104. Chrome Extension Requirements4.1. Manifest V3 (manifest.json)The extension MUST use Manifest V3. The manifest.json file will include:
"manifest_version": 3
"name": "MCP DataLayer Access Extension (MVP)"
"version": "0.1.0"
"description": "Allows an MCP server to access the dataLayer of an attached browser tab."
`"permissions": This permission grants temporary access without broad host permission warnings.

"scripting": To programmatically inject the content script (content_script.js) into the attached tab using chrome.scripting.executeScript().7
"storage": To use chrome.storage.local for persisting the ID and title of the attached tab.37


`"host_permissions":

It's important to be specific with host_permissions to limit the extension's capabilities only to the necessary local server endpoint.


"background": { "service_worker": "service_worker.js" } 6
"action": {

"default_popup": "popup.html",
"default_title": "Manage DataLayer Tab Attachment",
"default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
} 8


"icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
"minimum_chrome_version": "116": Required for reliable WebSocket support in service workers, particularly for keep-alive mechanisms.22
A minimal manifest.json structure is critical for security and performance, requesting only necessary permissions.6 The activeTab permission is preferred over broad host permissions like <all_urls> for actions initiated by user gesture, enhancing user privacy and trust.354.2. Service Worker (service_worker.js)The service worker is the central coordinator for the extension.

A. State Management:

attachedTabId (Number | null): Stores the ID of the currently attached tab. Persisted in chrome.storage.local. Initialize to null.
attachedTabTitle (String | null): Stores the title of the attached tab for display in the popup. Persisted in chrome.storage.local. Initialize to null.
webSocket (WebSocket | null): Holds the active WebSocket connection to the MCP server. Initialize to null.
Use chrome.storage.local.get() on startup to retrieve persisted attachedTabId and attachedTabTitle. chrome.storage.local is chosen over chrome.storage.sync because tab attachment is specific to the local browser session and doesn't need to be synced across devices.24



B. WebSocket Client Logic:

connectToMcServer() function:

If webSocket is already open, do nothing.
Attempt to create a new WebSocket connection to ws://localhost:3001 (or configured address).
onopen: Log success. Send an initial status message if a tab is already attached. Start keep-alive mechanism.
onmessage:

Parse the incoming JSON message.
If message.type === "REQUEST_DATALAYER":

Call handleGetDataLayerRequest(message.requestId).


If message.type === "KEEPALIVE_PING" (if server initiates pings):

Send { "type": "KEEPALIVE_PONG" } back.


Handle other message types as needed.


onerror: Log error. Set webSocket = null. Attempt reconnection with exponential backoff (e.g., try after 2s, 4s, 8s, up to a max).
onclose: Log closure. Set webSocket = null. If not an intentional disconnect, attempt reconnection. Clear keep-alive interval.


disconnectFromMcServer() function:

If webSocket exists, call webSocket.close().
Set webSocket = null. Clear keep-alive interval.


Keep-Alive Mechanism:

Implement a setInterval to send a { "type": "KEEPALIVE_PING" } message to the MCP server every 20 seconds. This is crucial to prevent the Manifest V3 service worker from becoming inactive and dropping the WebSocket connection.22 The interval should be less than the 30-second inactivity timeout of service workers.
The keepAlive function should only send pings if webSocket is connected and open. It should clear its interval if the WebSocket closes.
JavaScript// Conceptual keep-alive in service_worker.js
let keepAliveIntervalId = null;
function startKeepAlive() {
  if (keepAliveIntervalId) clearInterval(keepAliveIntervalId);
  keepAliveIntervalId = setInterval(() => {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
      webSocket.send(JSON.stringify({ type: "KEEPALIVE_PING" }));
    } else {
      // If WebSocket is not open, stop trying to send pings.
      // Connection logic should handle reconnection.
      stopKeepAlive();
    }
  }, 20000); // 20 seconds
}
function stopKeepAlive() {
  if (keepAliveIntervalId) clearInterval(keepAliveIntervalId);
  keepAliveIntervalId = null;
}
// Call startKeepAlive() in webSocket.onopen
// Call stopKeepAlive() in webSocket.onclose or when intentionally disconnecting







C. Message Handling from Popup and Content Scripts (chrome.runtime.onMessage.addListener): 21


handleGetDataLayerRequest(requestId) function (called from WebSocket onmessage):

Retrieve attachedTabId from chrome.storage.local.
If attachedTabId is null:

Send { "type": "DATALAYER_RESPONSE", "requestId": requestId, "payload": { "error": "No tab attached" } } to MCP server via WebSocket.
Return.


Use chrome.scripting.executeScript to inject content_script.js into the tab with attachedTabId.

Target: { tabId: attachedTabId }
Files: ["content_script.js"]
The executeScript call itself doesn't directly pass parameters to the file script. Communication post-injection will be via chrome.tabs.sendMessage or waiting for the content script to send a message. For this MVP, the content script will proactively send the dataLayer or an error.


After executeScript confirms injection (or if it fails):

Listen for a one-time message from the content script (e.g., FETCHED_DATALAYER_CONTENT) which will contain the dataLayer or an error. This requires setting up a listener before the content script might send its message, or the content script can send a message that the background script is always listening for.
Alternatively, and simpler for MVP, the content script will be designed to execute, get the dataLayer, and send it back in one go. The executeScript callback can be used to then send a message to the (now running) content script to request the data.
A more direct approach for executeScript with func:
JavaScript// Conceptual handleGetDataLayerRequest in service_worker.js
async function handleGetDataLayerRequest(requestId) {
  const { attachedTabId } = await chrome.storage.local.get();
  if (!attachedTabId) {
    webSocket.send(JSON.stringify({ type: "DATALAYER_RESPONSE", requestId, payload: { error: "No tab attached" } }));
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: attachedTabId },
      func: () => {
        // This function runs in the content script context
        if (typeof window.dataLayer!== 'undefined' && Array.isArray(window.dataLayer)) {
          // Perform deep clone here
          try {
            return JSON.parse(JSON.stringify(window.dataLayer));
          } catch (e) {
            return { error: "Failed to clone dataLayer: " + e.message };
          }
        } else {
          return { error: "dataLayer not found or not an array on this page." };
        }
      }
    });

    // executeScript returns an array of results, one for each frame injected.
    // For MVP, assume injection into main frame, so take first result.
    if (results && results && results.result) {
      webSocket.send(JSON.stringify({ type: "DATALAYER_RESPONSE", requestId, payload: results.result }));
    } else {
       // Handle cases where injection might have failed or result is unexpected
       const injectionError = chrome.runtime.lastError? chrome.runtime.lastError.message : "Unknown injection error";
       webSocket.send(JSON.stringify({ type: "DATALAYER_RESPONSE", requestId, payload: { error: `Failed to execute script or get result: ${injectionError}` } }));
    }
  } catch (e) {
    webSocket.send(JSON.stringify({ type: "DATALAYER_RESPONSE", requestId, payload: { error: "Error injecting script: " + e.message } }));
  }
}



This executeScript with func approach simplifies the interaction as the function's return value is directly available in results. The deep cloning logic is now embedded within this injected function.



Message from Popup: { type: "ATTACH_TAB", tabId: number, title: string }:

Store tabId as attachedTabId and title as attachedTabTitle in chrome.storage.local.set().
If WebSocket is connected, send a status update: { "type": "STATUS_UPDATE", "status": "attached", "tabInfo": { "id": tabId, "title": title } } (optional, for server awareness).
Attempt to connect to MCP server if not already connected (connectToMcServer()).
Send response to popup: { attachedTabInfo: {id: tabId, title: title} }.



Message from Popup: { type: "DETACH_TAB" }:

Set attachedTabId = null and attachedTabTitle = null in chrome.storage.local.set().
If WebSocket is connected, send status update: { "type": "STATUS_UPDATE", "status": "detached" } (optional).
Optionally, disconnect from MCP server if no other reason to stay connected (disconnectFromMcServer()). For MVP, keep connection if possible.
Send response to popup: { attachedTabInfo: null }.



Message from Popup: { type: "GET_ATTACHMENT_STATUS" }:

Retrieve attachedTabId and attachedTabTitle from chrome.storage.local.get().
Send response to popup: { attachedTabInfo: data } (where data is {id, title} or null).



Table 2: Message Format: Content Script to Background ScriptThis table becomes less critical if using the executeScript with func approach, as the result is returned directly. However, if a separate content_script.js file were used with message passing, it would be defined here.Given the executeScript with func approach, the direct return value serves this purpose. If a file-based content script were used and it needed to message back, the format would be:

Message Type: DATALAYER_CONTENT_RESPONSE
Payload Fields: { success: boolean, data?: any, error?: string }
Description: Content script sends the cloned dataLayer or an error message.





D. Initial Setup (chrome.runtime.onInstalled, chrome.runtime.onStartup):

On onInstalled, initialize chrome.storage.local for attachedTabId and attachedTabTitle to null if not already set.
On onStartup (and also after installation), attempt to connect to the MCP server (connectToMcServer()). The service worker may be started due to an event or an alarm, so having connection logic that can be called on startup is beneficial.


The service worker acts as the brain of the extension. Its ability to persist state (like attachedTabId) in chrome.storage.local 19 and manage the WebSocket connection (including MV3 keep-alives 22) is central to the system's operation. The direct injection of a function using chrome.scripting.executeScript simplifies the data retrieval from the content script context for an MVP.4.3. Content Script (content_script.js - if used as a separate file)This section would be relevant if not using the executeScript with func approach. Since the func approach is simpler for MVP and already outlined, this section can be minimized or state that the logic is embedded in service_worker.js's executeScript call.The content script's sole responsibility is to access window.dataLayer, clone it, and return it. As per the refined service_worker.js logic using chrome.scripting.executeScript({func:...}), this logic is directly embedded in the function passed to executeScript.The key operations performed within that injected function are:
Access window.dataLayer: Directly access the window.dataLayer object.7
Validate dataLayer: Check if it exists and is an array. If not, prepare an error object.
Deep Clone dataLayer:

Use JSON.parse(JSON.stringify(window.dataLayer)) for a simple deep clone suitable for JSON-serializable data.27 This is important because dataLayer objects can be complex and may be mutated by the page's scripts after being read. A shallow copy would not suffice.
Wrap this in a try-catch block, as JSON.stringify can fail for objects with circular references or non-serializable types (though dataLayer content is usually intended to be serializable).


Return Value: The function returns the cloned dataLayer or an error object. This return value is then passed back to the service worker as part of the InjectionResult array.
The "isolated worlds" concept for content scripts means they don't directly share JavaScript variables with the page, but they do share the DOM, which allows access to window.dataLayer.74.4. Popup (popup.html and popup.js)

A. UI (popup.html):

A simple HTML page.
Display area for status (e.g., <div id="status">Not Attached</div>).
A single button (e.g., <button id="attachButton">Attach to this Tab</button>).
Link to popup.js.



B. Logic (popup.js):


updateUi(attachedTabInfo) function:

Takes attachedTabInfo (e.g., { id: tabId, title: tabTitle } or null) as input.
Updates the #status text: "Attached to:" or "Not Attached".
Updates the #attachButton text: "Detach" or "Attach to this Tab".
Sets a data-action attribute on the button (e.g., "detach" or "attach") to manage state.



Initial Status Fetch:

On load, send a { type: "GET_ATTACHMENT_STATUS" } message to service_worker.js.
Use the response to call updateUi().



Button Click Handler (attachButton.addEventListener('click',...)):

Read the data-action attribute.
If action is "attach":

Get the current active tab: chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {... });
If a tab is found (tabs):

Send { type: "ATTACH_TAB", tabId: tabs.id, title: tabs.title } message to service_worker.js.
Update UI based on response.




If action is "detach":

Send { type: "DETACH_TAB" } message to service_worker.js.
Update UI based on response.





Table 3: Message Format: Popup Script to Background Script



Message Type (from popup.js)Payload FieldsResponse from Background (to popup.js)DescriptionGET_ATTACHMENT_STATUS(none)`{ attachedTabInfo: {id, title} \null }`ATTACH_TAB{ tabId: number, title: string }{ attachedTabInfo: {id, title} }Instructs service worker to attach to the specified tab.DETACH_TAB(none){ attachedTabInfo: null }Instructs service worker to detach from any currently attached tab.The popup provides the sole user interaction point for the core functionality of tab attachment. Its simplicity and clarity are paramount for a good user experience.8 The activeTab permission is implicitly used here when the popup queries for the active tab to attach.5. Communication Protocol (Extension Background Script <> MCP Server)5.1. Choice of Protocol: WebSocketsAs established, WebSockets are chosen for communication between the extension's service worker and the MCP server. This is primarily because the getDataLayer() flow requires the MCP server to initiate a request for data from the extension after an LLM calls the tool.13 WebSockets provide a persistent, bidirectional channel ideal for such server-initiated messages once the client (extension) establishes the connection.10The extension's service worker will act as a WebSocket client, connecting to a WebSocket server hosted by the local MCP application.5.2. WebSocket Connection Management
Extension Client (service_worker.js):

Initiation: On extension startup (chrome.runtime.onStartup) and potentially after a tab is successfully attached, the service worker will attempt to establish a WebSocket connection to the MCP server (e.g., ws://localhost:3001). The port for WebSocket communication (e.g., 3001) should be distinct from any HTTP port the MCP server might use for its primary MCP interface (e.g., 3000). This separation simplifies server routing and configuration.
Retry Logic: If the initial connection fails (e.g., MCP server not yet running), implement a simple exponential backoff retry mechanism (e.g., retry after 2s, 4s, 8s, maxing out at 30s, then periodically retrying).
Event Handlers:

onopen: Connection established. Log success. Start keep-alive mechanism.
onmessage: Process incoming messages from the MCP server (e.g., REQUEST_DATALAYER).
onerror: Log error. Attempt to reconnect as per retry logic.
onclose: Log closure. If the closure was unexpected, attempt to reconnect. Stop keep-alive pings.


Keep-Alive: To maintain the service worker's active state in Manifest V3 and prevent the WebSocket from being closed due to worker inactivity, the extension will send a small "ping" message to the server every ~20 seconds.22


MCP Server (Node.js/TypeScript using ws library):

Server Setup: Instantiate a WebSocketServer from the ws package, listening on the designated port (e.g., 3001).17
Connection Handling:

On a new 'connection' event:

Origin Check: Verify the req.headers.origin of the handshake request. It MUST match the expected Chrome extension ID (e.g., chrome-extension://<YOUR_EXTENSION_ID>). If not, terminate the connection immediately.32 This is a crucial security step.
Store the WebSocket object (ws) for later communication (for MVP, assume only one client connection).
Set up 'message', 'close', and 'error' handlers for this specific client connection.




Message Handling:

When the getDataLayer() tool is invoked by an LLM and an active extension WebSocket connection exists:

Generate a unique requestId.
Send a REQUEST_DATALAYER message (see format below) to the extension client via the stored WebSocket.
Implement a timeout mechanism to await a DATALAYER_RESPONSE from the extension.






5.3. Message Formats (JSON over WebSockets)All messages exchanged over WebSockets will be JSON strings.
Table 4: Message Format: Background Script to MCP Server (and vice-versa) via WebSocket
DirectionMessageType (type field)Payload FieldsPurposeServer -> ExtensionREQUEST_DATALAYER{ "requestId": "<uuid>" }Server requests the dataLayer from the extension for the attached tab.Server -> ExtensionKEEPALIVE_PING(none, or { timestamp: number })Server pings extension to keep connection alive (alternative to extension-initiated ping).Extension -> ServerDATALAYER_RESPONSE{ "requestId": "<uuid>", "payload": <dataLayerObjectOrError> }Extension responds with the dataLayer content or an error object for the given requestId.Extension -> ServerKEEPALIVE_PING(none, or { timestamp: number })Extension pings server to keep service worker and connection alive.Extension -> ServerKEEPALIVE_PONG(In response to server's ping, if that pattern is used)Extension acknowledges server's keep-alive ping.Extension -> ServerSTATUS_UPDATE`{ "status": "attached" \"detached", "tabInfo"?: { "id":..., "title":... } }`For the MVP, the extension will initiate KEEPALIVE_PING messages to the server. The server is not required to send pings back but should be prepared to receive them and not treat them as errors. The requestId in REQUEST_DATALAYER and DATALAYER_RESPONSE is essential for matching responses to requests, preventing data misattribution if the system were to handle multiple requests (though not an MVP requirement).6. Data Handling and Privacy6.1. dataLayer Content
A. Nature of dataLayer: The window.dataLayer is a JavaScript array conventionally used by websites to expose data for tag management and analytics systems like Google Tag Manager.3 The structure and content of this array are entirely determined by the website implementing it. It commonly includes objects detailing user interactions, page context, e-commerce transactions, user attributes, and custom events.
B. Personally Identifiable Information (PII) Risk: Due to its flexible nature and common use cases, dataLayer frequently contains Personally Identifiable Information (PII).43 This can include, but is not limited to:

User identifiers (login IDs, session IDs)
Email addresses (e.g., after a newsletter signup or login event)
Names, shipping/billing addresses (e.g., in e-commerce purchase events)
Phone numbers
Geolocation data
Sometimes, even more sensitive data depending on the website's configuration.11


C. MVP Handling of dataLayer Content:

For this MVP, the dataLayer retrieved by the content script will be transmitted from the Chrome extension to the local MCP server, and subsequently to the LLM, as-is. No PII filtering, scrubbing, masking, or redaction will be implemented in this version.
Critical Note to Developer: This approach is adopted for MVP simplicity to focus on the core data retrieval mechanism. However, transmitting raw dataLayer content, even to a local server and then potentially to an LLM, carries significant privacy implications if PII is present. This constitutes a known limitation of the MVP. Future iterations MUST prioritize the implementation of robust PII detection and sanitization mechanisms before this system is considered for any use beyond controlled development environments. The system handles data that is often sensitive, and this responsibility must be taken seriously in subsequent development phases.


6.2. Security between Extension and Localhost MCP Server
A. Host Permissions: The Chrome extension's manifest.json will declare a specific host_permissions entry for the MCP server's WebSocket endpoint (e.g., "ws://localhost:3001/").34 This strictly limits the extension's ability to initiate network connections to only this predefined local address and port, preventing it from communicating with arbitrary network locations.
B. CORS (Cross-Origin Resource Sharing):

CORS is primarily an HTTP-header based mechanism. Since WebSockets are used for the primary communication channel between the extension and the MCP server, traditional HTTP CORS headers on the MCP server for this specific path (/ws if applicable) are less directly relevant once the WebSocket handshake is complete.
However, the WebSocket handshake itself is initiated via an HTTP GET request with an Upgrade header. During this initial handshake, the browser will enforce same-origin policy unless the server responds appropriately. For localhost to localhost connections initiated by an extension, this is usually permissible if host_permissions are correctly set.
It's important to distinguish this from the MCP server's primary API for LLMs, which might be HTTP-based and would require standard CORS configuration (e.g., Access-Control-Allow-Origin: * or specific origins) if accessed from a different web origin.44 For the extension-to-server WebSocket, the main check is the Origin header.


C. Server-Side Origin Check for WebSockets:

The MCP server's WebSocket endpoint MUST inspect the Origin header of the incoming WebSocket handshake request.
This header will be chrome-extension://<YOUR_EXTENSION_ID> for requests originating from the extension.
The server should validate that this origin matches the known, expected extension ID. If the origin is missing, incorrect, or from an unexpected source (e.g., a malicious webpage trying to connect to the local WebSocket server), the server MUST reject the WebSocket connection.32
Example conceptual check in the ws server:
JavaScript// In MCP Server's WebSocket setup
// const expectedOrigin = "chrome-extension://youruniqueextensionidhere";
// wss.on('connection', (ws, req) => {
//   const clientOrigin = req.headers.origin;
//   if (clientOrigin!== expectedOrigin) {
//     console.warn(`WebSocket: Denying connection from invalid origin: ${clientOrigin}`);
//     ws.terminate();
//     return;
//   }
//   console.log(`WebSocket: Connection accepted from origin: ${clientOrigin}`);
//   //... proceed with handling the connection
// });


The extension ID is fixed upon packaging for the Chrome Web Store. During development with an unpacked extension, the ID can change if the extension's source directory changes. For MVP development, using the developer's current unpacked extension ID is acceptable. A production system would need a reliable way to know the deployed extension's ID.


D. Data Transmission Security:

All communication between the extension and the MCP server occurs over localhost. For the MVP, this communication will use unencrypted WebSockets (ws://).
Given the local-only nature of this traffic, encryption (e.g., WSS using TLS with self-signed certificates) is considered out of scope due to the added complexity for a junior developer and the setup hurdles it introduces for local development.32 This is a common simplification for local-only services.


E. Extension Storage Security:

The extension will only store the attachedTabId (a number) and attachedTabTitle (a string) in chrome.storage.local.19
The actual dataLayer content is fetched on demand and is NOT persisted in any extension storage. This minimizes the data footprint within the extension itself.
chrome.storage.local is not encrypted, but for non-sensitive identifiers like a tab ID, it is acceptable for this local-only use case.


The security model relies on the browser's sandboxing of extensions, strict host_permissions, and server-side validation of the client's origin during the WebSocket handshake. While localhost communication is generally less exposed than internet-facing services, these measures are important to prevent unintended interactions or access from other local processes or malicious web pages.7. Error Handling and ResilienceRobust error handling is essential for a usable and debuggable system, especially one involving multiple components and asynchronous communication.477.1. General Principles
No Silent Failures: All components must explicitly handle and report errors rather than failing silently. This is crucial for diagnostics and user feedback.48
Comprehensive Logging: Utilize console.log(), console.warn(), and console.error() extensively in both the Chrome extension (service worker, popup, injected script) and the MCP server for debugging purposes. Prefix logs with component names (e.g., ,) for clarity.
User-Friendly Feedback: Where appropriate (primarily in the extension popup), provide clear, concise error messages to the user.
Structured Error Responses: When errors are communicated programmatically (e.g., from extension to MCP server, or MCP server to LLM), use a consistent JSON error object structure (e.g., { "error": { "message": "Descriptive error", "code": "OPTIONAL_ERROR_CODE" } }).
7.2. Extension Error Handling
A. Injected Script (within executeScript func):

window.dataLayer Not Found: If window.dataLayer is undefined or not an array, the injected function should return an error object: { error: "dataLayer not found or not an array on this page." }.
Deep Cloning Failure: If JSON.parse(JSON.stringify(window.dataLayer)) throws an exception (e.g., due to circular references, though uncommon for typical dataLayer content), catch it and return: { error: "Failed to clone dataLayer: " + e.message }.


B. Service Worker (service_worker.js):

Storage Errors: When using chrome.storage.local.get() or chrome.storage.local.set(), check chrome.runtime.lastError in callbacks or use try/catch with promise versions. Log errors. For critical failures (e.g., cannot save attachedTabId), the impact might be a failure to operate, which should be handled gracefully.
chrome.scripting.executeScript Failure:

If executeScript fails (e.g., tab closed before execution, no permission for the target page, invalid tab ID), the promise will reject or chrome.runtime.lastError will be set.
Catch this error and send an appropriate error response to the MCP server: { type: "DATALAYER_RESPONSE", requestId, payload: { error: "Failed to inject script into tab: " + (e.message | | chrome.runtime.lastError.message) } }.


WebSocket Connection Errors:

Connection Failure: If new WebSocket() fails to connect, onerror will trigger. Log the error. Implement retry logic with exponential backoff. Update popup UI if persistently failing (see below).
Connection Dropped: If onclose is triggered unexpectedly, log it. Attempt to reconnect.


Timeout Waiting for DATALAYER_RESPONSE (from content script via executeScript): The executeScript promise itself handles the result. If it times out internally or the injected function doesn't return, this would manifest as an error in executeScript handling.
No Tab Attached: If handleGetDataLayerRequest is called but attachedTabId is null, send { type: "DATALAYER_RESPONSE", requestId, payload: { error: "No tab attached" } } to MCP server.


C. Popup UI (popup.js):

When sending messages to the service worker (e.g., ATTACH_TAB), if the response indicates an error or chrome.runtime.lastError is set, display a user-friendly message in the #status div (e.g., "Failed to attach tab. Try again.").
If the service worker indicates it cannot connect to the MCP server (e.g., after multiple retries), the popup could display "MCP Server not reachable. Ensure it's running." This requires the service worker to communicate this persistent failure state to the popup, perhaps when the popup requests status.


7.3. MCP Server Error Handling
A. WebSocket Server (ws):

Handle 'error' events on the WebSocket server itself and on individual client connections. Log these errors.
If an invalid message format is received from the extension (e.g., non-JSON, missing type field), log the error and ignore the message or send an error back if appropriate (though for MVP, ignoring malformed pings might be sufficient).


B. getDataLayer() Tool Logic:

Extension WebSocket Not Active: If the tool is called but webSocket (to extension) is null or not OPEN, return an error to the LLM: { "error": { "message": "Chrome extension is not connected." } }.
Error from Extension: If the DATALAYER_RESPONSE from the extension contains an error in its payload (e.g., payload.error), propagate this error message to the LLM: { "error": { "message": payload.error } }.
Timeout Waiting for Extension: If the MCP server sends REQUEST_DATALAYER and does not receive a DATALAYER_RESPONSE with the matching requestId within the defined timeout (e.g., 10 seconds), return a timeout error to the LLM: { "error": { "message": "Timeout waiting for dataLayer from extension." } }.


7.4. Communication Failures
A. Extension to Server (WebSocket Initialization):

The service worker's connectToMcServer() function should implement retry logic with exponential backoff for the initial WebSocket connection.
If the connection drops (unexpected onclose), the service worker should also attempt to reconnect.
The popup UI should be informed if the connection is persistently down, allowing the user to understand potential issues.


B. Server to Extension (WebSocket Request/Response):

If the MCP server sends REQUEST_DATALAYER and the WebSocket send operation itself fails, or if no timely DATALAYER_RESPONSE is received, the server must handle this by timing out and returning an error to the LLM.


C. Internal Extension Messaging (Popup <> Background, Background <> Injected Script):

When using chrome.runtime.sendMessage or chrome.scripting.executeScript, always check chrome.runtime.lastError in the callback or use try/catch with the promise versions to detect communication failures (e.g., if the receiving end doesn't exist or doesn't call sendResponse).


This multi-layered error handling strategy is vital. A failure in one part of this distributed system (LLM client -> MCP Server -> Extension Service Worker -> Injected Script -> Web Page) can prevent the entire operation. Clear logging helps the developer trace these issues, and structured error responses allow each component to react appropriately. For instance, if the injected script cannot find window.dataLayer, it returns an error object; the service worker receives this and forwards it (packaged in a DATALAYER_RESPONSE) to the MCP server; the MCP server then formats this into an error response for the LLM. This clear propagation of error status is key.8. Future Considerations (Out of Scope for MVP)This MVP establishes the foundational capability. Several enhancements can be considered for future iterations:
A. Advanced dataLayer Handling:

History and Change Tracking: Implement functionality to monitor dataLayer.push() calls in real-time and maintain a history of dataLayer states or changes. This would provide richer contextual information to the LLM over time. Existing extensions like dataslayer demonstrate such capabilities.55 This would likely involve overriding dataLayer.push in the content script.57
PII Scrubbing/Masking: Introduce mechanisms to detect and redact or mask Personally Identifiable Information (PII) from the dataLayer before it is sent to the MCP server and subsequently to the LLM. This is a critical privacy and security enhancement.43
Selective dataLayer Queries: Allow the LLM to request specific parts of the dataLayer (e.g., using JSONPath expressions or by specifying keys of interest), rather than always retrieving the entire object. This could reduce data transfer and focus the LLM's context.


B. Enhanced Extension Features:

Multiple Tab Attachments: Allow the user to attach the extension to multiple browser tabs simultaneously, with a mechanism for the LLM to specify which attached tab's dataLayer it wants.
dataLayer Viewer UI: Add a section to the extension popup or a dedicated DevTools panel to display the current dataLayer of the attached tab, aiding in debugging and user understanding.
Configurable Server Address/Port: Implement an options page (options.html) where users can configure the hostname and port for the MCP server, instead of using hardcoded localhost values. This would use chrome.storage.sync or chrome.storage.local to save settings.59


C. MCP Server Enhancements:

Additional Tools: Introduce more MCP tools, such as observeDataLayerChanges(filter?) to stream dataLayer events, or executeScriptInAttachedTab(script) for more general interactions.
Authentication/Authorization: Implement more robust authentication/authorization for MCP tool access, beyond the basic WebSocket origin check, if the server is to be used by multiple clients or in less trusted environments.32


D. Robustness and Scalability:

Advanced Retry Mechanisms: Implement more sophisticated retry strategies (e.g., with jitter) and circuit breaker patterns for communication between the extension and the server.
Concurrent Request Handling: Design the MCP server and extension to gracefully handle multiple concurrent getDataLayer() requests from one or more LLMs, if such a scenario becomes relevant.


E. Alternative Communication Channels:

Native Messaging: For scenarios where localhost WebSocket/HTTP communication might be problematic due to user network configurations, firewall restrictions, or a desire to avoid opening local ports, explore Chrome's Native Messaging API.22 This allows the extension to communicate with a locally installed native application via standard input/output, bypassing network sockets. However, Native Messaging has its own setup complexities (requiring a native host manifest and executable).


Acknowledging these future considerations helps contextualize the MVP's scope. It informs the junior developer about the system's potential evolution and highlights areas where current simple implementations (like PII handling or single tab attachment) are deliberate choices for the MVP stage, with more complex solutions planned for later. This roadmap also aids in making architectural decisions for the MVP that do not preclude these future enhancements.9. Glossary
activeTab Permission: A Chrome extension permission that grants temporary access to the currently active tab when the user invokes the extension (e.g., clicks its toolbar icon). It's a less permissive alternative to broad host permissions.34
Attached Tab: The specific browser tab selected by the user via the Chrome extension, from which the dataLayer is to be retrieved.
Content Script: JavaScript files that run in the context of web pages. They can read and modify the DOM and interact with the page's JavaScript environment, including window.dataLayer.7
CORS (Cross-Origin Resource Sharing): An HTTP-header based mechanism that allows a server to indicate any origins (domain, scheme, or port) other than its own from which a browser should permit loading resources.44
dataLayer: A JavaScript array (by convention) used on websites to pass data to tag management systems and analytics tools. Its content is arbitrary and defined by the website.3
Deep Clone: Creating a copy of an object where all nested objects and arrays are also copied, rather than just their references. JSON.parse(JSON.stringify(obj)) is a common method for JSON-serializable objects.27
Host Permissions: Permissions declared in an extension's manifest.json that grant the extension rights to interact with specified web origins (hosts), such as making network requests or injecting scripts.34
Isolated World: The private JavaScript execution environment content scripts run in. They share the DOM with the page but not JavaScript variables, preventing conflicts.7
JSON (JavaScript Object Notation): A lightweight data-interchange format. Easy for humans to read and write, and easy for machines to parse and generate.31
LLM (Large Language Model): An advanced AI model trained on vast amounts of text data, capable of understanding, generating, and interacting via natural language.
Manifest V3 (MV3): The current version of the Chrome extension platform, emphasizing security, privacy, and performance. Key changes include service workers replacing background pages and a more restrictive API surface.6
MCP (Model Context Protocol): An open standard protocol designed to facilitate communication and data exchange between LLMs and external tools or data sources.1
MCP Server: An application that implements the MCP, exposing "tools" (functions) and "resources" (data) that LLMs can utilize.
Native Messaging: A Chrome extension feature allowing communication with separate, native applications installed on the user's computer via standard input/output, rather than network protocols.62
PII (Personally Identifiable Information): Any data that could potentially identify a specific individual. Examples include names, email addresses, social security numbers, etc..43
Popup (action popup): A small HTML page displayed when a user clicks an extension's icon in the browser toolbar. Used for UIs that require user interaction.8
scripting Permission: A Chrome extension permission required to use the chrome.scripting API, which includes methods like executeScript for injecting code into pages.24
Service Worker (Extension): The event-driven background script in Manifest V3 extensions. It runs only when needed and handles tasks like event listening, message passing, and managing extension state.6
storage Permission: A Chrome extension permission required to use the chrome.storage API for persisting extension data (e.g., chrome.storage.local, chrome.storage.sync).37
WebSocket: A communication protocol that provides a persistent, full-duplex communication channel over a single TCP connection, allowing for real-time, bidirectional data exchange between a client and a server.10
ws (npm package): A popular Node.js library for implementing WebSocket clients and servers.17
10. ConclusionThis Product Requirements Document details the specifications for building a minimal viable Model Context Protocol server and Chrome Extension system. The core objective is to enable a Large Language Model to retrieve the window.dataLayer from a user-designated browser tab. Key components include a TypeScript-based MCP server exposing a getDataLayer() tool, and a Manifest V3 Chrome extension managing tab attachment and data retrieval via content script injection. Communication between the MCP server and the extension's service worker will be facilitated by WebSockets, chosen for their suitability in server-initiated messaging.The MVP focuses on delivering this core functionality with considerations for the junior developer role, emphasizing clear component responsibilities, defined communication interfaces, and straightforward data handling. While PII within the dataLayer is a known concern, its sanitization is deferred post-MVP to maintain focus on the primary data retrieval pipeline. Security measures for local communication, such as host permissions and WebSocket origin checks, are included. Comprehensive error handling across all components is also a priority.Successful completion of this MVP will provide a functional proof-of-concept and a solid foundation for future enhancements, such as dataLayer history tracking, PII scrubbing, and more advanced extension and server capabilities.