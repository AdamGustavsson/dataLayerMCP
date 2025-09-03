// websocket.ts - WebSocket connection management for server
import WebSocket, { WebSocketServer } from "ws";
import net from "node:net";
import os from "node:os";
import { exec } from "node:child_process";
import { logInfo, logWarn, logError } from "../utils/logging.js";
import { amIActiveInstance, getInstanceInfo, initActiveInstance } from "../utils/instance.js";
// Connection configuration
export const WS_PORT = 57321;
export const EXTENSION_ORIGIN = process.env.EXTENSION_ORIGIN || "chrome-extension://<YOUR_EXTENSION_ID>";
export const CONNECTION_TIMEOUT = 15000; // 15 seconds
export const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
export const MAX_RECONNECT_ATTEMPTS = 10;
export const connectionState = {
    socket: null,
    isHealthy: false,
    lastActivity: Date.now(),
    reconnectAttempts: 0,
};
// WebSocket message sending utility
export function wsSend(socket, payload) {
    // Drop messages if this server instance is no longer the active one
    if (!amIActiveInstance()) {
        logWarn("Dropping wsSend: server instance is not active (a newer instance took over)");
        return false;
    }
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        logError("Cannot send message - WebSocket not connected");
        return false;
    }
    try {
        // Attach server identity for traceability
        const ident = getInstanceInfo();
        const message = { ...payload, _serverInstanceId: ident.instanceId, _serverStartedAt: ident.startedAt };
        socket.send(JSON.stringify(message));
        connectionState.lastActivity = Date.now();
        return true;
    }
    catch (error) {
        logError("Failed to send WebSocket message:", error);
        return false;
    }
}
// Health check functionality
let healthCheckInterval = null;
export function startHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }
    healthCheckInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceLastActivity = now - connectionState.lastActivity;
        if (connectionState.socket && connectionState.socket.readyState === WebSocket.OPEN) {
            if (timeSinceLastActivity > CONNECTION_TIMEOUT) {
                logWarn("Connection appears stale, marking as unhealthy");
                connectionState.isHealthy = false;
            }
            else {
                connectionState.isHealthy = true;
            }
        }
        else {
            connectionState.isHealthy = false;
        }
    }, HEALTH_CHECK_INTERVAL);
}
export function stopHealthCheck() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}
// WebSocket server setup
// --- Robust port handling helpers ---
async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function isPortInUse(port) {
    return new Promise((resolve) => {
        const tester = net
            .createServer()
            .once("error", (err) => {
            if (err && err.code === "EADDRINUSE") {
                resolve(true);
            }
            else {
                // Treat other errors as not-in-use for our purposes
                resolve(false);
            }
        })
            .once("listening", () => {
            tester.close(() => resolve(false));
        })
            .listen(port, "127.0.0.1");
    });
}
async function killProcessOnPort(port) {
    return new Promise((resolve) => {
        const platform = os.platform();
        let cmd = "";
        if (platform === "win32") {
            // Find the PID(s) listening on the port and kill them
            // Uses PowerShell for broader compatibility
            cmd = `powershell -Command \"$p = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess; if ($p) { $p | ForEach-Object { taskkill /PID $_ /F } }\"`;
        }
        else {
            // macOS/Linux: use lsof first, fallback to fuser
            cmd = `bash -lc 'if command -v lsof >/dev/null 2>&1; then lsof -ti tcp:${port} | xargs -r kill -9; elif command -v fuser >/dev/null 2>&1; then fuser -k ${port}/tcp; fi'`;
        }
        if (!cmd) {
            resolve();
            return;
        }
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                logWarn(`killProcessOnPort(${port}) encountered an error`, error.message || error);
            }
            if (stdout && stdout.trim())
                logInfo(`Killed processes on port ${port}: ${stdout.trim()}`);
            if (stderr && stderr.trim())
                logWarn(`killProcessOnPort stderr: ${stderr.trim()}`);
            resolve();
        });
    });
}
async function ensurePortAvailable(port, maxWaitMs = 5000) {
    // Attempt to free the port proactively
    await killProcessOnPort(port);
    const start = Date.now();
    while (await isPortInUse(port)) {
        if (Date.now() - start > maxWaitMs) {
            logWarn(`Port ${port} still in use after ${maxWaitMs}ms; proceeding to attempt bind.`);
            break;
        }
        await wait(100);
    }
}
export async function setupWebSocketServer(messageHandler, port = WS_PORT) {
    // Establish leadership marker for this instance
    initActiveInstance();
    await ensurePortAvailable(port);
    const wss = new WebSocketServer({
        port,
        verifyClient: (info) => {
            const origin = info.origin;
            logInfo(`WebSocket connection attempt from origin: ${origin}`);
            // Allow connections from Chrome extensions and localhost
            return (!origin || // Chrome extensions might not send origin
                origin.startsWith("chrome-extension://") ||
                origin === "http://localhost" ||
                origin === "https://localhost");
        }
    });
    wss.on("connection", (socket, request) => {
        const clientIP = request.socket.remoteAddress;
        logInfo(`New WebSocket connection from ${clientIP}`);
        // Update connection state
        connectionState.socket = socket;
        connectionState.isHealthy = true;
        connectionState.lastActivity = Date.now();
        connectionState.reconnectAttempts = 0;
        // Send connection acknowledgment with server identity
        const ident = getInstanceInfo();
        wsSend(socket, {
            type: "CONNECTION_ACK",
            serverVersion: "0.1.0",
            serverInstanceId: ident.instanceId,
            serverStartedAt: ident.startedAt,
            timestamp: Date.now(),
        });
        // Handle incoming messages
        socket.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                connectionState.lastActivity = Date.now();
                if (message.type === "KEEPALIVE_PING") {
                    logInfo("Received keepalive ping, sending pong");
                    wsSend(socket, { type: "KEEPALIVE_PONG", ts: Date.now() });
                    return;
                }
                messageHandler(socket, message);
            }
            catch (error) {
                logError("Error parsing WebSocket message:", error);
                wsSend(socket, {
                    type: "ERROR",
                    error: "Invalid JSON message format",
                    timestamp: Date.now(),
                });
            }
        });
        socket.on("close", (code, reason) => {
            logInfo(`WebSocket connection closed: ${code} ${reason}`);
            connectionState.socket = null;
            connectionState.isHealthy = false;
        });
        socket.on("error", (error) => {
            logError("WebSocket error:", error);
            connectionState.socket = null;
            connectionState.isHealthy = false;
        });
    });
    wss.on("error", (error) => {
        logError("WebSocket server error:", error);
    });
    startHealthCheck();
    logInfo(`WebSocket server listening on port ${port}`);
    return wss;
}
// Optional alias for symmetry with other servers
export const createWebSocketServer = setupWebSocketServer;
