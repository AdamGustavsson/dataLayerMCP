// logging.js - Enhanced logging utilities

// Enhanced logging
function logInfo(message, ...args) {
  console.log(`[Extension][INFO] ${message}`, ...args);
}

function logWarn(message, ...args) {
  console.warn(`[Extension][WARN] ${message}`, ...args);
}

function logError(message, ...args) {
  console.error(`[Extension][ERROR] ${message}`, ...args);
}

export { logInfo, logWarn, logError };

