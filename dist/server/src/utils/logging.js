// logging.ts - Server-side logging utilities
export function logInfo(message, ...args) {
    console.error(`[Server][INFO] ${message}`, ...args);
}
export function logWarn(message, ...args) {
    console.error(`[Server][WARN] ${message}`, ...args);
}
export function logError(message, ...args) {
    console.error(`[Server][ERROR] ${message}`, ...args);
}
